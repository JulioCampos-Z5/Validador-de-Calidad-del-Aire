"""
Endpoints de la base local (/api/historico), de punta a punta sobre un SQLite
temporal: estado, comparar y guardar lo cargado, traer un periodo, la serie de
un parámetro, los cambios pendientes y el historial de cargas.

Fuera de la app de escritorio (sin VALIDADOR_HISTORICO) todo responde que no
está disponible: eso también se fija aquí.
"""

import os
import shutil
import tempfile
import unittest
from unittest import mock

import pandas as pd

import app as aplicacion
import ultimo
from historico import rutas


def conjunto(o3=0.030):
    """Dos estaciones, dos horas de 2025 (dentro de lo que cubre la base)."""
    return pd.DataFrame([
        {'STATION': 'CEN', 'DATE': '2025-03-01', 'HOUR': 0, 'O3': o3, 'PM10': 40.0},
        {'STATION': 'CEN', 'DATE': '2025-03-01', 'HOUR': 1, 'O3': 0.020, 'PM10': 'IR'},
        {'STATION': 'ATM', 'DATE': '2025-03-01', 'HOUR': 0, 'O3': 0.050, 'PM10': 60.0},
    ])


class SinEscritorio(unittest.TestCase):
    def setUp(self):
        self.cliente = aplicacion.app.test_client()
        self.antes = os.environ.pop('VALIDADOR_HISTORICO', None)

    def tearDown(self):
        if self.antes is not None:
            os.environ['VALIDADOR_HISTORICO'] = self.antes

    def test_todo_dice_que_no_esta_disponible(self):
        self.assertEqual(self.cliente.get('/api/historico/estado').get_json(), {'disponible': False})
        for metodo, ruta in [('post', '/api/historico/cargar'), ('get', '/api/historico/serie'),
                             ('post', '/api/historico/analizar'), ('post', '/api/historico/aplicar'),
                             ('get', '/api/historico/cargas/1/cambios'), ('get', '/api/historico/pendientes'),
                             ('post', '/api/historico/pendientes/aplicar'),
                             ('post', '/api/historico/pendientes/descartar')]:
            r = getattr(self.cliente, metodo)(ruta, json={})
            self.assertEqual(r.status_code, 404, ruta)
            self.assertFalse(r.get_json()['disponible'], ruta)
        self.assertIsNone(rutas.guardar_importado(conjunto(), 'a.xlsx'))


class ConEscritorio(unittest.TestCase):
    def setUp(self):
        self.carpeta = tempfile.mkdtemp(prefix='prueba_rutas_historico_')
        self.antes = os.environ.get('VALIDADOR_HISTORICO')
        os.environ['VALIDADOR_HISTORICO'] = os.path.join(self.carpeta, 'historico.sqlite')
        self.cliente = aplicacion.app.test_client()
        ultimo.olvidar()

    def tearDown(self):
        ultimo.olvidar()
        if self.antes is None:
            os.environ.pop('VALIDADOR_HISTORICO', None)
        else:
            os.environ['VALIDADOR_HISTORICO'] = self.antes
        shutil.rmtree(self.carpeta, ignore_errors=True)

    def guardar(self, df, origen='simaj'):
        ultimo.guardar_validado(df, origen, 'SIMAJ · marzo')
        r = self.cliente.post('/api/historico/analizar').get_json()
        return r, self.cliente.post('/api/historico/aplicar', json={'id': r['id']}).get_json()

    def test_estado_de_una_base_nueva(self):
        e = self.cliente.get('/api/historico/estado').get_json()
        self.assertTrue(e['disponible'])
        self.assertEqual(e.get('cargas', []), [])

    def test_analizar_sin_datos_cargados(self):
        r = self.cliente.post('/api/historico/analizar')
        self.assertEqual(r.status_code, 400)

    def test_guardar_lo_cargado_y_traerlo_de_vuelta(self):
        analisis, aplicado = self.guardar(conjunto())
        self.assertEqual(analisis['nuevos'], 6)
        self.assertEqual(aplicado['nuevos'], 6)

        e = self.cliente.get('/api/historico/estado').get_json()
        self.assertEqual(len(e['cargas']), 1)
        self.assertEqual([a['anio'] for a in e['anios']], [2025])

        r = self.cliente.post('/api/historico/cargar', json={'desde': '2025-03-01', 'hasta': '2025-03-02'})
        self.assertEqual(r.status_code, 200)
        datos = r.get_json()
        self.assertEqual(datos['summary']['total_registros'], 3)
        self.assertEqual(datos['summary']['fecha_inicio'], '2025-03-01')
        self.assertIsNone(datos['output_filename'])  # sin Excel
        self.assertIn('mir', datos)
        # La bandera guardada vuelve como estaba.
        cen1 = next(f for f in datos['data_preview'] if f['STATION'] == 'CEN' and f['HOUR'] == 1)
        self.assertEqual(cen1['PM10'], 'IR')

    def test_cargar_valida_el_periodo(self):
        for cuerpo, estado in [({'desde': '2025-03-02', 'hasta': '2025-03-01'}, 400),
                               ({'desde': 'ayer', 'hasta': 'hoy'}, 400),
                               ({'desde': '2020-01-01', 'hasta': '2021-01-01'}, 400),  # antes de 2024
                               ({'desde': '2025-06-01', 'hasta': '2025-06-02'}, 404)]:  # sin datos
            r = self.cliente.post('/api/historico/cargar', json=cuerpo)
            self.assertEqual(r.status_code, estado, cuerpo)

    def test_serie_de_un_parametro_sin_tocar_lo_cargado(self):
        self.guardar(conjunto())
        r = self.cliente.get('/api/historico/serie?desde=2025-03-01&hasta=2025-03-02&parametro=O3')
        self.assertEqual(len(r.get_json()), 3)
        self.assertEqual(r.get_json()[0].keys(), {'STATION', 'DATE', 'HOUR', 'O3'})
        self.assertEqual(self.cliente.get('/api/historico/serie?desde=2025-03-01&hasta=2025-03-02&parametro=XYZ').status_code, 400)

    def test_un_cambio_queda_en_la_carga_y_se_puede_ver(self):
        self.guardar(conjunto())
        analisis, aplicado = self.guardar(conjunto(o3=0.099))
        self.assertEqual(analisis['cambiados'], 1)
        self.assertEqual(aplicado['actualizados'], 1)
        carga = self.cliente.get('/api/historico/estado').get_json()['cargas'][0]
        cambios = self.cliente.get(f"/api/historico/cargas/{carga['id']}/cambios").get_json()
        self.assertEqual(len(cambios), 1)
        self.assertEqual((cambios[0]['antes'], cambios[0]['ahora']), (0.03, 0.099))

    def test_aplicar_sin_id_o_con_uno_vencido(self):
        self.assertEqual(self.cliente.post('/api/historico/aplicar', json={}).status_code, 400)
        r = self.cliente.post('/api/historico/aplicar', json={'id': 'no-existe'})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.cliente.post('/api/historico/descartar', json={'id': 'no-existe'}).get_json(), {'ok': True})

    def test_importar_un_archivo_deja_los_cambios_pendientes(self):
        self.guardar(conjunto())
        r = rutas.guardar_importado(conjunto(o3=0.077), 'BD_2025.xlsx')
        self.assertEqual(r, {'nuevos': 0, 'pendientes': 1})

        p = self.cliente.get('/api/historico/pendientes').get_json()
        self.assertEqual(p['total'], 1)
        self.assertEqual(self.cliente.post('/api/historico/pendientes/descartar').get_json(), {'descartados': 1})
        self.assertEqual(self.cliente.get('/api/historico/pendientes').get_json()['total'], 0)

        rutas.guardar_importado(conjunto(o3=0.066), 'BD_2025.xlsx')
        self.assertEqual(self.cliente.post('/api/historico/pendientes/aplicar').get_json()['actualizados'], 1)

    def test_un_fallo_al_importar_no_estropea_la_importacion(self):
        with mock.patch('historico.almacen.guardar_sin_revisar', side_effect=RuntimeError('disco lleno')):
            r = rutas.guardar_importado(conjunto(), 'a.xlsx')
        self.assertIn('disco lleno', r['error'])

    def test_base_ilegible_en_estado(self):
        with mock.patch('historico.almacen.estado', side_effect=RuntimeError('base corrupta')):
            r = self.cliente.get('/api/historico/estado')
        self.assertEqual(r.status_code, 500)
        self.assertIn('base corrupta', r.get_json()['error'])

    def test_descarga_avance_y_cancelar(self):
        self.assertIn('activo', self.cliente.get('/api/historico/descargar').get_json())
        self.assertEqual(self.cliente.post('/api/historico/descargar/cancelar').get_json(), {'ok': True})


if __name__ == '__main__':
    unittest.main()
