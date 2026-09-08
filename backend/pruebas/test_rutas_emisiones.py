"""
Endpoints de Emisiones, con la red simulada.

El foco está en la sesión: quién la guarda, quién la borra y qué se le cuenta al
frontend. Es donde una equivocación tiene consecuencias fuera del programa —un
token de una API de gobierno olvidado en el disco de alguien—, así que conviene
que esté fijado por pruebas y no por la memoria de quien lo escribió.
"""

import os
import tempfile
import unittest
from datetime import datetime, timedelta

import pandas as pd

import app as aplicacion
from emisiones import almacen, cliente, rutas


class BaseRutas(unittest.TestCase):
    def setUp(self):
        # La sesión guardada va al perfil del usuario. En una prueba eso seria
        # escribir en el disco de quien la ejecuta, asi que se desvia a una
        # carpeta temporal.
        self.carpeta = tempfile.mkdtemp(prefix='prueba_rutas_')
        self.carpeta_original = almacen.CARPETA_POR_DEFECTO
        almacen.CARPETA_POR_DEFECTO = self.carpeta

        self.token_original = cliente.solicitar_token
        cliente.solicitar_token = self._token_falso

        rutas._sesion.update({'token': None, 'email': None, 'caduca': None})
        self.cliente = aplicacion.app.test_client()

    def tearDown(self):
        almacen.CARPETA_POR_DEFECTO = self.carpeta_original
        cliente.solicitar_token = self.token_original
        rutas._sesion.update({'token': None, 'email': None, 'caduca': None})
        for f in os.listdir(self.carpeta):
            os.remove(os.path.join(self.carpeta, f))
        os.rmdir(self.carpeta)

    def _token_falso(self, email, password):
        if password != 'correcta':
            raise cliente.CredencialesInvalidas()
        return {'token': 'tok-de-prueba',
                'caduca': datetime.now() + timedelta(days=7)}

    def entrar(self, recordar=False, password='correcta'):
        return self.cliente.post('/api/emisiones/login', json={
            'email': 'quien@ejemplo.mx', 'password': password,
            'recordar': recordar,
        })


class Sesion(BaseRutas):
    def test_sin_sesion_no_se_puede_consultar(self):
        r = self.cliente.post('/api/emisiones/descargar', json={})
        self.assertEqual(r.status_code, 401)

    def test_credenciales_malas_devuelven_401(self):
        r = self.entrar(password='mala')
        self.assertEqual(r.status_code, 401)
        self.assertIn('error', r.get_json())

    def test_entrar_sin_recordar_no_deja_nada_en_disco(self):
        r = self.entrar(recordar=False)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json()['activa'])
        self.assertFalse(r.get_json()['recordada'])
        self.assertFalse(almacen.hay_guardada(self.carpeta))

    def test_entrar_recordando_guarda_el_token(self):
        r = self.entrar(recordar=True)
        self.assertTrue(r.get_json()['recordada'])
        self.assertTrue(almacen.hay_guardada(self.carpeta))

    def test_el_token_nunca_sale_hacia_el_frontend(self):
        cuerpo = self.entrar(recordar=True).get_json()
        self.assertNotIn('token', cuerpo)
        self.assertNotIn('tok-de-prueba', str(cuerpo))

        estado = self.cliente.get('/api/emisiones/sesion').get_json()
        self.assertNotIn('token', estado)
        self.assertEqual(set(estado), {'activa', 'email', 'caduca', 'recordada'})

    def test_entrar_sin_recordar_borra_lo_guardado_antes(self):
        """
        Si desmarcar la casilla no borrara, quedaria un token viejo en disco que
        nadie recuerda haber dejado ahi.
        """
        self.entrar(recordar=True)
        self.assertTrue(almacen.hay_guardada(self.carpeta))

        self.entrar(recordar=False)
        self.assertFalse(almacen.hay_guardada(self.carpeta))

    def test_salir_borra_la_sesion_guardada(self):
        self.entrar(recordar=True)
        r = self.cliente.post('/api/emisiones/salir')
        self.assertFalse(r.get_json()['activa'])
        self.assertFalse(almacen.hay_guardada(self.carpeta))

    def test_la_sesion_guardada_se_restaura_al_arrancar(self):
        """Es el punto de la funcionalidad: sobrevivir al reinicio."""
        self.entrar(recordar=True)
        rutas._sesion.update({'token': None, 'email': None, 'caduca': None})
        self.assertFalse(self.cliente.get('/api/emisiones/sesion').get_json()['activa'])

        rutas._restaurar()

        estado = self.cliente.get('/api/emisiones/sesion').get_json()
        self.assertTrue(estado['activa'])
        self.assertEqual(estado['email'], 'quien@ejemplo.mx')

    def test_una_sesion_guardada_caducada_no_se_restaura(self):
        almacen.guardar('viejo', 'quien@ejemplo.mx',
                        datetime.now() - timedelta(hours=1), self.carpeta)
        rutas._restaurar()
        self.assertFalse(self.cliente.get('/api/emisiones/sesion').get_json()['activa'])
        self.assertFalse(almacen.hay_guardada(self.carpeta))


class TokenMuertoAMitadDeConsulta(BaseRutas):
    def setUp(self):
        super().setUp()
        self.descargar_original = cliente.descargar
        cliente.descargar = self._caducado

    def tearDown(self):
        cliente.descargar = self.descargar_original
        super().tearDown()

    def _caducado(self, *args, **kwargs):
        raise cliente.SesionCaducada()

    def test_se_limpia_la_sesion_en_memoria_y_en_disco(self):
        """
        Reintentar contra un token muerto no lleva a ningun sitio, y dejarlo en
        disco solo alarga la vida de una credencial que ya no vale.
        """
        self.entrar(recordar=True)
        r = self.cliente.post('/api/emisiones/descargar',
                              json={'desde': '2026-09-01', 'hasta': '2026-09-02'})
        self.assertEqual(r.status_code, 401)
        self.assertFalse(self.cliente.get('/api/emisiones/sesion').get_json()['activa'])
        self.assertFalse(almacen.hay_guardada(self.carpeta))


class ValidacionDelRango(BaseRutas):
    def setUp(self):
        super().setUp()
        self.entrar()
        # Un rango valido llegaria a la red de verdad. Una prueba que sale a
        # internet no es una prueba unitaria: falla cuando falla el wifi y
        # castiga a un servidor ajeno cada vez que alguien corre la suite.
        self.descargar_original = cliente.descargar
        cliente.descargar = lambda *a, **k: pd.DataFrame(
            columns=['STATION', 'DATE', 'HOUR'])

    def tearDown(self):
        cliente.descargar = self.descargar_original
        super().tearDown()

    def pedir(self, desde, hasta):
        return self.cliente.post('/api/emisiones/descargar',
                                 json={'desde': desde, 'hasta': hasta})

    def test_rango_invertido(self):
        r = self.pedir('2026-09-05', '2026-09-01')
        self.assertEqual(r.status_code, 400)
        self.assertIn('posterior', r.get_json()['error'])

    def test_rango_demasiado_largo(self):
        r = self.pedir('2024-01-01', '2026-06-01')
        self.assertEqual(r.status_code, 400)
        self.assertIn(str(rutas.DIAS_MAXIMOS), r.get_json()['error'])

    def test_un_trimestre_ya_no_se_rechaza(self):
        """
        El tope de 31 dias era del cliente, no de la API, y existia porque el
        periodo se pedia de una sola vez. Con el troceado y la cache dejo de
        tener sentido.
        """
        r = self.pedir('2026-06-10', '2026-09-08')
        self.assertNotEqual(r.status_code, 400)

    def test_fechas_ilegibles(self):
        r = self.pedir('el martes', 'el jueves')
        self.assertEqual(r.status_code, 400)


if __name__ == '__main__':
    unittest.main()
