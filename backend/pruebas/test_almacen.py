"""
Sesión guardada en disco.

Lo que se prueba aquí no es que el JSON dé la vuelta, sino que **el archivo se
descarta cuando no sirve**: caducado, ilegible o a medio escribir. Un token
muerto que se lee como bueno manda al usuario contra un 401 sin explicación, y
un archivo corrupto que revienta al arrancar deja el backend sin sesión y sin
decir por qué.
"""

import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta

from emisiones import almacen


class GuardarYCargar(unittest.TestCase):
    def setUp(self):
        self.carpeta = tempfile.mkdtemp(prefix='prueba_almacen_')

    def tearDown(self):
        for f in os.listdir(self.carpeta):
            os.remove(os.path.join(self.carpeta, f))
        os.rmdir(self.carpeta)

    def test_ida_y_vuelta(self):
        caduca = datetime.now() + timedelta(days=3)
        almacen.guardar('tok-123', 'quien@ejemplo.mx', caduca, self.carpeta)

        recuperada = almacen.cargar(self.carpeta)
        self.assertIsNotNone(recuperada)
        self.assertEqual(recuperada['token'], 'tok-123')
        self.assertEqual(recuperada['email'], 'quien@ejemplo.mx')
        # Se compara al segundo: isoformat no conserva mas precision util aqui.
        self.assertEqual(recuperada['caduca'].replace(microsecond=0),
                         caduca.replace(microsecond=0))

    def test_la_contrasena_no_se_guarda_nunca(self):
        """
        `guardar` no recibe contraseña, y el archivo no debe contener nada que
        se le parezca. Es la garantía que sostiene toda la funcionalidad.
        """
        almacen.guardar('tok', 'quien@ejemplo.mx',
                        datetime.now() + timedelta(days=1), self.carpeta)
        with open(almacen.ruta(self.carpeta), encoding='utf-8') as fh:
            crudo = fh.read()
        self.assertNotIn('password', crudo)
        self.assertNotIn('contrasena', crudo)
        self.assertEqual(set(json.loads(crudo)), {'token', 'email', 'caduca', 'guardada'})

    def test_sin_archivo_devuelve_none(self):
        self.assertIsNone(almacen.cargar(self.carpeta))
        self.assertFalse(almacen.hay_guardada(self.carpeta))

    def test_token_caducado_se_descarta_y_se_borra(self):
        almacen.guardar('viejo', 'quien@ejemplo.mx',
                        datetime.now() - timedelta(minutes=1), self.carpeta)
        self.assertTrue(almacen.hay_guardada(self.carpeta))

        self.assertIsNone(almacen.cargar(self.carpeta))
        # No basta con ignorarlo: un token muerto en disco solo alarga la vida
        # de una credencial que ya no vale.
        self.assertFalse(almacen.hay_guardada(self.carpeta))

    def test_archivo_corrupto_no_revienta_y_se_borra(self):
        os.makedirs(self.carpeta, exist_ok=True)
        with open(almacen.ruta(self.carpeta), 'w', encoding='utf-8') as fh:
            fh.write('{"token": "a medio escr')

        self.assertIsNone(almacen.cargar(self.carpeta))
        self.assertFalse(almacen.hay_guardada(self.carpeta))

    def test_archivo_sin_token_se_descarta(self):
        os.makedirs(self.carpeta, exist_ok=True)
        with open(almacen.ruta(self.carpeta), 'w', encoding='utf-8') as fh:
            json.dump({'email': 'quien@ejemplo.mx', 'token': ''}, fh)

        self.assertIsNone(almacen.cargar(self.carpeta))

    def test_caducidad_ilegible_se_descarta(self):
        os.makedirs(self.carpeta, exist_ok=True)
        with open(almacen.ruta(self.carpeta), 'w', encoding='utf-8') as fh:
            json.dump({'token': 'tok', 'email': 'x', 'caduca': 'el martes'}, fh)

        self.assertIsNone(almacen.cargar(self.carpeta))
        self.assertFalse(almacen.hay_guardada(self.carpeta))

    def test_sin_caducidad_se_acepta(self):
        """Un token sin `exp` legible no es motivo para tirarlo."""
        almacen.guardar('tok', 'x', None, self.carpeta)
        recuperada = almacen.cargar(self.carpeta)
        self.assertIsNotNone(recuperada)
        self.assertIsNone(recuperada['caduca'])

    def test_olvidar_es_idempotente(self):
        almacen.olvidar(self.carpeta)  # no habia nada; no debe fallar
        almacen.guardar('tok', 'x', None, self.carpeta)
        almacen.olvidar(self.carpeta)
        almacen.olvidar(self.carpeta)
        self.assertFalse(almacen.hay_guardada(self.carpeta))

    def test_no_deja_archivos_a_medias(self):
        """La escritura es atómica: nunca queda un `.parcial` suelto."""
        almacen.guardar('tok', 'x', None, self.carpeta)
        sobrantes = [f for f in os.listdir(self.carpeta) if f.endswith('.parcial')]
        self.assertEqual(sobrantes, [])

    def test_guardar_dos_veces_sustituye(self):
        almacen.guardar('primero', 'a@b.mx', None, self.carpeta)
        almacen.guardar('segundo', 'c@d.mx', None, self.carpeta)
        recuperada = almacen.cargar(self.carpeta)
        self.assertEqual(recuperada['token'], 'segundo')
        self.assertEqual(recuperada['email'], 'c@d.mx')


if __name__ == '__main__':
    unittest.main()
