"""
Endpoints del SIMAJ (/api/minutales) con la red simulada: el cliente que baja
los .lsi se reemplaza, así que aquí se prueba lo que hace la ruta con lo que
llega —errores de red, periodos vacíos, descargas incompletas y la respuesta
completa—, no el protocolo del SIMAJ (eso es test_minutales.py).
"""

import os
import unittest
from unittest import mock

import pandas as pd
import requests

import app as aplicacion
import red
import ultimo
from minutales import rutas


def descarga(incompleta=False):
    filas = [{'STATION': e, 'DATE': '2026-09-01', 'HOUR': h, 'O3': 0.03, 'PM10': 40.0}
             for e in ('CEN', 'MIR') for h in range(24)]
    df = pd.DataFrame(filas)
    df.attrs['descarga'] = ({'completa': False, 'causa': 'red', 'porcentaje_descargado': 90,
                             'archivos_fallidos': 5, 'fallidos_por_estacion': {'MIR': 5},
                             'estaciones_sin_listado': []}
                            if incompleta else {'completa': True})
    return df


class RutasSimaj(unittest.TestCase):
    def setUp(self):
        ultimo.olvidar()
        self.cliente = aplicacion.app.test_client()
        self.salidas = []

    def tearDown(self):
        ultimo.olvidar()
        for ruta in self.salidas:
            if ruta and os.path.exists(ruta):
                os.remove(ruta)

    def pedir(self, cuerpo, df=None, error=None):
        with mock.patch('minutales.cliente.descargar', side_effect=error, return_value=df):
            r = self.cliente.post('/api/minutales/descargar', json=cuerpo)
        datos = r.get_json() or {}
        if datos.get('output_filename'):
            self.salidas.append(os.path.join(aplicacion.app.config['UPLOAD_FOLDER'], datos['output_filename']))
        return r, datos

    def test_periodo_invalido(self):
        for cuerpo in ({'desde': 'ayer', 'hasta': 'hoy'},
                       {'desde': '2026-09-02', 'hasta': '2026-09-01'},
                       {'meses': 13}, {'meses': 0}):
            r, _ = self.pedir(cuerpo, df=descarga())
            self.assertEqual(r.status_code, 400, cuerpo)

    def test_sin_red_lo_dice_como_red(self):
        r, datos = self.pedir({'desde': '2026-09-01', 'hasta': '2026-09-02'},
                              error=requests.ConnectionError('cortada'))
        self.assertEqual(r.status_code, 503)
        self.assertEqual(datos['tipo'], 'red')
        self.assertEqual(datos['error'], red.MENSAJE_RED)
        self.assertFalse(rutas._progreso['activo'])  # el avance no queda colgado

    def test_otro_fallo_del_servidor(self):
        r, datos = self.pedir({'meses': 1}, error=RuntimeError('formato raro'))
        self.assertEqual(r.status_code, 502)
        self.assertIn('formato raro', datos['error'])

    def test_periodo_sin_datos(self):
        r, datos = self.pedir({'meses': 1}, df=pd.DataFrame())
        self.assertEqual(r.status_code, 404)
        self.assertIn('no devolvió datos', datos['error'])

    def test_nada_por_fallas_de_red_no_es_periodo_vacio(self):
        vacio = pd.DataFrame()
        vacio.attrs['descarga'] = {'completa': False, 'causa': 'red', 'porcentaje_descargado': 0,
                                   'archivos_fallidos': 48, 'estaciones_sin_listado': ['CEN']}
        r, datos = self.pedir({'meses': 1}, df=vacio)
        self.assertEqual(r.status_code, 503)
        self.assertEqual(datos['error'], red.MENSAJE_RED)

    def test_descarga_completa_misma_forma_que_validate_full(self):
        r, datos = self.pedir({'desde': '2026-09-01', 'hasta': '2026-09-02', 'contaminantes': ['O3', 'PM10']},
                              df=descarga())
        self.assertEqual(r.status_code, 200)
        for clave in ('summary', 'data_preview', 'estadisticas_detalladas', 'mir', 'fallas', 'output_filename'):
            self.assertIn(clave, datos)
        self.assertEqual(datos['summary']['total_registros'], 48)
        self.assertEqual(datos['summary']['estaciones'], 2)
        self.assertIsNone(datos['advertencia'])
        self.assertEqual(datos['mir']['contaminantes'], ['O3', 'PM10'])
        # Queda como el conjunto actual: el IAS y el MIR trabajan sobre el.
        self.assertIsNotNone(ultimo.validado()[0])
        self.assertEqual(self.cliente.post('/api/minutales/mir', json={'contaminantes': ['O3']}).status_code, 200)

    def test_descarga_incompleta_avisa(self):
        _, datos = self.pedir({'meses': 1}, df=descarga(incompleta=True))
        self.assertIn('Descarga incompleta', datos['advertencia'])
        self.assertIn('MIR: 5', datos['advertencia'])

    def test_listado_de_estaciones_y_progreso(self):
        with mock.patch('minutales.cliente.estaciones', return_value=['CEN', 'MIR']):
            self.assertEqual(self.cliente.get('/api/minutales/estaciones').get_json(), {'estaciones': ['CEN', 'MIR']})
        with mock.patch('minutales.cliente.estaciones', side_effect=RuntimeError('caído')):
            self.assertEqual(self.cliente.get('/api/minutales/estaciones').status_code, 502)
        self.assertIn('activo', self.cliente.get('/api/minutales/progreso').get_json())


class AvisosDeRed(unittest.TestCase):
    def test_sin_informe_o_completa_no_hay_aviso(self):
        self.assertIsNone(red.aviso_de_descarga(None))
        self.assertIsNone(red.aviso_de_descarga({'completa': True}))

    def test_por_dias_de_la_api_de_emisiones(self):
        aviso = red.aviso_de_descarga({'completa': False, 'causa': 'respuesta_invalida', 'porcentaje_descargado': 80,
                                       'dias_fallidos': ['2026-09-01', '2026-09-03']})
        self.assertIn('2 día(s)', aviso)
        self.assertIn('2026-09-01 a 2026-09-03', aviso)
        self.assertIn('proxy', aviso)

    def test_servidor_y_estaciones_sin_listado(self):
        aviso = red.aviso_de_descarga({'completa': False, 'causa': 'servidor', 'porcentaje_descargado': 50,
                                       'archivos_fallidos': 0, 'estaciones_sin_listado': ['TLA']})
        self.assertIn('ninguna hora de TLA', aviso)
        self.assertIn('El servidor de datos falló', aviso)

    def test_que_cuenta_como_error_de_red(self):
        self.assertTrue(red.es_error_de_red(requests.Timeout()))
        self.assertTrue(red.es_error_de_red(requests.exceptions.ChunkedEncodingError()))
        self.assertFalse(red.es_error_de_red(requests.HTTPError('500')))
        self.assertFalse(red.es_error_de_red(ValueError()))

    def test_sesion_con_reintentos_solo_en_get(self):
        s = red.sesion(4)
        politica = s.get_adapter('https://x').max_retries
        self.assertEqual(politica.total, 3)
        self.assertEqual(politica.allowed_methods, frozenset({'GET'}))
        self.assertIn(503, politica.status_forcelist)


if __name__ == '__main__':
    unittest.main()
