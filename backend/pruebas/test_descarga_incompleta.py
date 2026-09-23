"""
Descargas que no llegan completas: red lenta, cortes, proxys y red caída.

El problema que cubren
----------------------
En algunas computadoras la descarga quedaba a medias sin avisar: el cliente del
SIMAJ convertía cualquier fallo de red en «no hay dato» y el resto del sistema
—MIR incluido— leía esos huecos como fallas de las estaciones. Estas pruebas
fijan lo contrario: lo que falla se reintenta, lo que sigue fallando se cuenta
y se dice por qué, y la caché nunca guarda algo que no sea un dato.

Todo con un transporte simulado: ninguna prueba toca la red.
"""

import os
import shutil
import tempfile
import unittest
from datetime import date, datetime, timedelta

import requests

import red
from emisiones import cliente as emisiones
from minutales import cliente as simaj

LINEA_LSI = '1,{d:%d/%m/%Y} {h:02d}:00:00,0.018,1' + ',0,0' * 16


class RespuestaFalsa:
    def __init__(self, texto='', codigo=200):
        self.text = texto
        self.status_code = codigo


class SesionFalsa:
    """
    Hace de requests.Session para el SIMAJ. `plan` dice, por nombre de archivo,
    qué pasa en cada intento: una excepción, un código o un texto.
    """

    def __init__(self, plan=None, por_defecto='ok'):
        self.plan = {k: list(v) for k, v in (plan or {}).items()}
        self.por_defecto = por_defecto
        self.llamadas = 0

    def get(self, url, timeout=None):
        self.llamadas += 1
        nombre = requests.utils.unquote(url.rsplit('/', 1)[-1])
        pasos = self.plan.get(nombre)
        paso = pasos.pop(0) if pasos else self.por_defecto
        if isinstance(paso, Exception):
            raise paso
        if paso == 'ok':
            f = simaj.fecha_de_archivo(nombre)
            return RespuestaFalsa(LINEA_LSI.format(d=f, h=f.hour))
        if isinstance(paso, int):
            return RespuestaFalsa('', paso)
        return RespuestaFalsa(paso)


def nombres(horas, dia=date(2026, 6, 1)):
    return [f'{dia:%d_%m_%Y} {h:02d}_10.lsi' for h in range(horas)]


class DescargaDelSimaj(unittest.TestCase):
    def setUp(self):
        self.cache = tempfile.mkdtemp(prefix='pruebas_simaj_')
        self.originales = (simaj._sesion, simaj._archivos)
        self.archivos = nombres(24)
        simaj._archivos = lambda estacion, sesion=None: [f'/minutales/CENTRO/{n}' for n in self.archivos]

    def tearDown(self):
        simaj._sesion, simaj._archivos = self.originales
        shutil.rmtree(self.cache, ignore_errors=True)

    def descargar(self, sesion, cache=True):
        simaj._sesion = lambda concurrencia=25: sesion
        df = simaj.descargar(
            estaciones_pedidas=['CENTRO'],
            desde=datetime(2026, 6, 1), hasta=datetime(2026, 6, 2),
            carpeta_cache=self.cache if cache else None, concurrencia=4)
        return df, df.attrs['descarga']

    def test_todo_bien_es_completa(self):
        df, informe = self.descargar(SesionFalsa())
        self.assertEqual(len(df), 24)
        self.assertTrue(informe['completa'])
        self.assertEqual(informe['archivos_fallidos'], 0)
        self.assertEqual(informe['porcentaje_descargado'], 100.0)
        self.assertIsNone(red.aviso_de_descarga(informe))

    def test_un_corte_pasajero_se_recupera_en_la_segunda_vuelta(self):
        # La primera vuelta vence; la segunda, más despacio, pasa.
        plan = {n: [requests.Timeout('lento')] for n in self.archivos[:5]}
        df, informe = self.descargar(SesionFalsa(plan))
        self.assertEqual(len(df), 24)
        self.assertTrue(informe['completa'])
        self.assertEqual(informe['archivos_reintentados'], 5)

    def test_lo_que_sigue_fallando_se_cuenta_y_se_explica(self):
        plan = {n: [requests.ConnectionError('corte')] * 2 for n in self.archivos[:6]}
        df, informe = self.descargar(SesionFalsa(plan))
        self.assertEqual(len(df), 18, 'lo que sí llegó se conserva')
        self.assertFalse(informe['completa'])
        self.assertEqual(informe['archivos_fallidos'], 6)
        self.assertEqual(informe['fallidos_por_estacion'], {'CEN': 6})
        self.assertEqual(informe['causa'], 'red')
        self.assertEqual(informe['porcentaje_descargado'], 75.0)

        aviso = red.aviso_de_descarga(informe)
        self.assertIn('Descarga incompleta', aviso)
        self.assertIn('75.0%', aviso)
        self.assertIn('conexión a internet', aviso)
        self.assertIn('NO son fallas de las estaciones', aviso)

    def test_no_publicado_no_es_un_fallo(self):
        # 404: el SIMAJ no tiene esa hora. Es un dato real de la red de
        # monitoreo, no un problema de la descarga.
        plan = {n: [404] for n in self.archivos[:3]}
        df, informe = self.descargar(SesionFalsa(plan))
        self.assertEqual(len(df), 21)
        self.assertTrue(informe['completa'])
        self.assertEqual(informe['archivos_no_publicados'], 3)

    def test_la_pagina_de_un_proxy_no_entra_a_la_cache(self):
        pagina = '<html><body>Inicia sesión en la red de invitados</body></html>'
        plan = {self.archivos[0]: [pagina, pagina]}
        df, informe = self.descargar(SesionFalsa(plan))
        self.assertEqual(informe['archivos_fallidos'], 1)
        self.assertEqual(informe['causa'], 'respuesta_invalida')
        self.assertFalse(os.path.exists(os.path.join(self.cache, 'CENTRO', self.archivos[0])))

        # Con la red ya bien, la hora se recupera sola al reintentar.
        df, informe = self.descargar(SesionFalsa())
        self.assertTrue(informe['completa'])
        self.assertEqual(len(df), 24)

    def test_un_archivo_de_cache_danado_se_vuelve_a_pedir(self):
        self.descargar(SesionFalsa())
        ruta = os.path.join(self.cache, 'CENTRO', self.archivos[0])
        with open(ruta, 'w', encoding='utf-8') as fh:
            fh.write('basura a medio escribir')

        sesion = SesionFalsa()
        df, informe = self.descargar(sesion)
        self.assertEqual(sesion.llamadas, 1, 'solo se repite el dañado')
        self.assertEqual(len(df), 24)

    def test_reintentar_solo_pide_lo_que_falto(self):
        plan = {n: [requests.ConnectionError('corte')] * 2 for n in self.archivos[:4]}
        self.descargar(SesionFalsa(plan))

        sesion = SesionFalsa()
        df, informe = self.descargar(sesion)
        self.assertEqual(sesion.llamadas, 4)
        self.assertTrue(informe['completa'])

    def test_no_deja_archivos_a_medias_en_la_cache(self):
        self.descargar(SesionFalsa())
        sobrantes = [f for f in os.listdir(os.path.join(self.cache, 'CENTRO'))
                     if f.endswith('.parcial')]
        self.assertEqual(sobrantes, [])

    def test_si_vence_el_listado_de_una_estacion_siguen_las_demas(self):
        def archivos(estacion, sesion=None):
            if estacion == 'CENTRO':
                raise requests.ConnectionError('venció el listado')
            return [f'/minutales/{estacion}/{n}' for n in self.archivos]
        simaj._archivos = archivos
        simaj._sesion = lambda concurrencia=25: SesionFalsa()
        df = simaj.descargar(estaciones_pedidas=['CENTRO', 'MIRAVALLE'],
                             desde=datetime(2026, 6, 1), hasta=datetime(2026, 6, 2),
                             carpeta_cache=self.cache, concurrencia=4)
        informe = df.attrs['descarga']
        self.assertEqual(set(df['STATION']), {'MIR'})
        self.assertFalse(informe['completa'])
        self.assertEqual(informe['estaciones_sin_listado'], ['CEN'])
        self.assertIn('ninguna hora de CEN', red.aviso_de_descarga(informe))

    def test_con_la_red_caida_deja_de_insistir(self):
        # Sin el corte, cada uno de los 300 archivos gastaría sus intentos: con
        # la red muerta, un mes tardaría casi una hora en decir que no hay red.
        self.archivos = [f'{d:%d_%m_%Y} {h:02d}_10.lsi'
                         for d in (date(2026, 6, 1) + timedelta(days=i) for i in range(13))
                         for h in range(24)]
        sesion = SesionFalsa(por_defecto=requests.ConnectionError('sin red'))
        simaj._sesion = lambda concurrencia=25: sesion
        df = simaj.descargar(estaciones_pedidas=['CENTRO'],
                             desde=datetime(2026, 6, 1), hasta=datetime(2026, 6, 14),
                             carpeta_cache=self.cache, concurrencia=4)
        informe = df.attrs['descarga']
        self.assertTrue(df.empty)
        self.assertTrue(informe['red_caida'])
        self.assertEqual(informe['causa'], 'red')
        self.assertLess(sesion.llamadas, 120, f'{sesion.llamadas} llamadas para {len(self.archivos)} archivos')


class DescargaDeEmisiones(unittest.TestCase):
    def setUp(self):
        self.cache = tempfile.mkdtemp(prefix='pruebas_emisiones_')
        self.original = emisiones.consultar_minutales
        self.fallos = {}      # inicio de bloque -> excepciones pendientes
        self.peticiones = []
        emisiones.consultar_minutales = self._falso

    def tearDown(self):
        emisiones.consultar_minutales = self.original
        shutil.rmtree(self.cache, ignore_errors=True)

    def _falso(self, token, desde, hasta, sesion=None):
        self.peticiones.append(desde.date())
        pendientes = self.fallos.get(desde.date())
        if pendientes:
            raise pendientes.pop(0)
        registros, momento = [], desde
        while momento < hasta:
            registros.append({'estacion': 'CENTRO', 'fechaHora': momento.isoformat(),
                              'datos': {'O3': '0.02', 'O3_Flag': '1'}})
            momento += timedelta(hours=1)
        return registros

    def descargar(self):
        return emisiones.descargar('tok', datetime(2026, 8, 17), datetime(2026, 9, 7),
                                   carpeta_cache=self.cache)

    def test_un_bloque_que_vence_se_reintenta(self):
        self.fallos[date(2026, 8, 24)] = [emisiones.ErrorDeRed()]
        df = self.descargar()
        self.assertTrue(df.attrs['descarga']['completa'])
        self.assertEqual(len(df), 21 * 24)

    def test_un_bloque_perdido_no_tira_lo_demas(self):
        self.fallos[date(2026, 8, 24)] = [emisiones.ErrorDeRed(), emisiones.ErrorDeRed()]
        df = self.descargar()
        informe = df.attrs['descarga']
        self.assertEqual(len(df), 14 * 24, 'las otras dos semanas sí llegan')
        self.assertFalse(informe['completa'])
        self.assertEqual(len(informe['dias_fallidos']), 7)
        self.assertEqual(informe['causa'], 'red')
        self.assertIn('7 día(s)', red.aviso_de_descarga(informe))

        # Lo que llegó quedó en caché: reintentar pide solo la semana perdida.
        self.peticiones.clear()
        df = self.descargar()
        self.assertEqual(self.peticiones, [date(2026, 8, 24)])
        self.assertTrue(df.attrs['descarga']['completa'])

    def test_sin_nada_que_mostrar_es_un_error_de_red(self):
        for inicio in (date(2026, 8, 17), date(2026, 8, 24), date(2026, 8, 31)):
            self.fallos[inicio] = [emisiones.ErrorDeRed(), emisiones.ErrorDeRed()]
        with self.assertRaises(emisiones.ErrorDeRed) as ctx:
            self.descargar()
        self.assertEqual(ctx.exception.codigo, 503)

    def test_la_sesion_caducada_no_se_disfraza_de_red(self):
        self.fallos[date(2026, 8, 24)] = [emisiones.SesionCaducada()]
        with self.assertRaises(emisiones.SesionCaducada):
            self.descargar()


class ClasificacionDeErrores(unittest.TestCase):
    def test_que_es_la_red_y_que_no(self):
        for e in (requests.ConnectionError(), requests.Timeout(), requests.ConnectTimeout(),
                  requests.ReadTimeout(), requests.exceptions.ChunkedEncodingError(),
                  requests.exceptions.ProxyError(), requests.exceptions.SSLError()):
            self.assertTrue(red.es_error_de_red(e), type(e).__name__)
        for e in (requests.HTTPError(), ValueError(), requests.exceptions.InvalidURL()):
            self.assertFalse(red.es_error_de_red(e), type(e).__name__)


class RutaDelSimaj(unittest.TestCase):
    """La interfaz recibe un 503 con el mensaje de red, no un 502 genérico."""

    def setUp(self):
        import app
        self.cliente_http = app.app.test_client()
        from minutales import rutas
        self.rutas = rutas
        self.original = rutas.cliente.descargar

    def tearDown(self):
        self.rutas.cliente.descargar = self.original

    def pedir(self):
        return self.cliente_http.post('/api/minutales/descargar',
                                      json={'desde': '2026-06-01', 'hasta': '2026-06-02'})

    def test_sin_red_responde_503_con_el_motivo(self):
        def sin_red(**_):
            raise requests.ConnectionError('no se pudo resolver aire.jalisco.gob.mx')
        self.rutas.cliente.descargar = sin_red
        r = self.pedir()
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.get_json()['tipo'], 'red')
        self.assertIn('conexión a internet no es suficiente', r.get_json()['error'])

    def test_si_no_llego_nada_no_dice_que_no_hay_datos(self):
        import pandas as pd

        def todo_fallo(**_):
            df = pd.DataFrame(columns=['STATION', 'DATE', 'HOUR'] + simaj.CANALES_BD)
            df.attrs['descarga'] = {'completa': False, 'archivos_fallidos': 24,
                                    'porcentaje_descargado': 0.0, 'causa': 'red',
                                    'fallidos_por_estacion': {'CEN': 24}}
            return df
        self.rutas.cliente.descargar = todo_fallo
        r = self.pedir()
        self.assertEqual(r.status_code, 503)
        self.assertNotIn('no devolvió datos', r.get_json()['error'])


if __name__ == '__main__':
    unittest.main()
