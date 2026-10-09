"""
El MIR con archivos: ENVISTA crudo, BD ya validado y la base local.

Antes solo había MIR con el SIMAJ y la API de Emisiones. El cálculo nunca
dependió del periodo pedido —las horas esperadas salen de las fechas de cada
estación—, así que un archivo da para lo mismo; lo que faltaba era guardarle
las filas y devolverlo.

Lo delicado es el BD validado: ya no trae el crudo, la validación cambió el
número por su bandera. Si se contaran solo los números, la misma red daría un
MIR más bajo importada como BD que descargada del SIMAJ, y el indicador mide
cuánto publicó la red, no cuánto pasó las reglas.
"""

import io
import os
import shutil
import tempfile
import unittest

import pandas as pd

import app
import ultimo
from minutales.mir import calcular_mir


def _dia(valores, estacion='SAN', columna='O3'):
    """Un día de 24 horas con los valores dados, uno por hora."""
    return pd.DataFrame([
        {'STATION': estacion, 'DATE': '2026-06-01', 'HOUR': h, columna: v}
        for h, v in enumerate(valores)
    ])


class LecturasDeUnValidado(unittest.TestCase):
    def test_las_banderas_de_lectura_cuentan_como_dato_publicado(self):
        # 12 números y 6 horas que la validación marcó: hubo lectura en 18.
        df = _dia([0.02] * 12 + ['IR', 'DS', 'IO', 'VE', 'VZ', 'IR'] + ['ND'] * 6)
        mir = calcular_mir(df, ['O3'], validado=True)
        self.assertEqual(mir['estaciones'][0]['coberturas']['O3'], 75.0)

    def test_sin_dato_sin_equipo_falla_y_calibracion_no_cuentan(self):
        df = _dia([0.02] * 12 + ['ND', 'SE', 'NE', 'IF', 'IC', 'ND'] * 2)
        mir = calcular_mir(df, ['O3'], validado=True)
        self.assertEqual(mir['estaciones'][0]['coberturas']['O3'], 50.0)

    def test_en_crudo_las_banderas_siguen_sin_contar(self):
        """El SIMAJ, Emisiones y ENVISTA crudo no cambian."""
        df = _dia([0.02] * 12 + ['IR'] * 12)
        self.assertEqual(calcular_mir(df, ['O3'])['estaciones'][0]['coberturas']['O3'], 50.0)

    def test_un_canal_solo_con_huecos_sigue_siendo_sin_equipo(self):
        df = _dia([0.02] * 24).assign(SO2='SE')
        mir = calcular_mir(df, ['O3', 'SO2'], validado=True)
        self.assertIn('SO2', mir['estaciones'][0]['sin_equipo'])


class TramoComparado(unittest.TestCase):
    """Sin fechas, un 76% no dice de qué periodo es."""

    def test_lleva_el_tramo_general_y_el_de_cada_estacion(self):
        df = pd.concat([
            _dia([0.02] * 24, estacion='SAN'),
            _dia([0.02] * 24, estacion='VAL').assign(DATE='2026-06-03'),
        ])
        mir = calcular_mir(df, ['O3'])
        self.assertEqual((mir['desde'], mir['hasta']), ('2026-06-01', '2026-06-03'))
        val = next(e for e in mir['estaciones'] if e['estacion'] == 'VAL')
        self.assertEqual((val['desde'], val['hasta'], val['horas_esperadas']),
                         ('2026-06-03', '2026-06-03', 24))

    def test_sin_datos_no_revienta(self):
        mir = calcular_mir(pd.DataFrame(columns=['STATION', 'DATE', 'O3']), ['O3'])
        self.assertIsNone(mir['desde'])


class ConCarpetaDeSubidas(unittest.TestCase):
    def setUp(self):
        self.carpeta = tempfile.mkdtemp(prefix='pruebas_mir_')
        self.addCleanup(shutil.rmtree, self.carpeta, True)
        anterior = app.app.config['UPLOAD_FOLDER']
        app.app.config['UPLOAD_FOLDER'] = self.carpeta
        self.addCleanup(app.app.config.__setitem__, 'UPLOAD_FOLDER', anterior)
        self.addCleanup(ultimo.olvidar)
        self.cliente = app.app.test_client()

    def bd_excel(self, nombre, df):
        df.to_excel(os.path.join(self.carpeta, nombre), sheet_name='Data', index=False)
        return nombre

    def cobertura(self, respuesta, estacion, contaminante):
        mir = respuesta.get_json()['mir']
        fila = next(f for f in mir['estaciones'] if f['estacion'] == estacion)
        return fila['coberturas'][contaminante]


class MirDesdeArchivos(ConCarpetaDeSubidas):
    def test_envista_crudo_trae_mir_sobre_el_crudo(self):
        with open(os.path.join(self.carpeta, 'trs.csv'), 'w', encoding='utf-8', newline='') as f:
            f.write('\n'.join([
                'Multiestacion Periodica:01-11-24 1:00 AM-30-11-24 12:00 AM Tipo:AVG 1 Hr.,,,',
                ',,,',
                ',Vallarta,Vallarta,Miravalle',
                'Fecha,O3,TempInt,O3',
                ',ppm,C,ppm',
                '01-11-24 1:00 AM,0.009,25.5,0.011',
                '01-11-24 2:00 AM,0.010,26.0,NoData',
            ]) + '\n')
        r = self.cliente.post('/api/validate/full', json={'filename': 'trs.csv'})
        self.assertEqual(r.status_code, 200, r.get_json())
        # Un día de calendario: Vallarta midió 2 de 24 horas, Miravalle 1.
        self.assertEqual(self.cobertura(r, 'VAL', 'O3'), 8.3)
        self.assertEqual(self.cobertura(r, 'MIR', 'O3'), 4.2)
        self.assertIsInstance(r.get_json()['fallas'], list)

    def test_bd_validado_trae_mir_y_cuenta_sus_banderas(self):
        nombre = self.bd_excel('BD_2026.xlsx', _dia([0.02] * 12 + ['IR'] * 6 + ['ND'] * 6))
        r = self.cliente.post('/api/preview-validated', json={'filename': nombre})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(self.cobertura(r, 'SAN', 'O3'), 75.0)

    def test_bd_por_validacion_completa_tambien(self):
        nombre = self.bd_excel('BD_2026.xlsx', _dia([0.02] * 12 + ['IR'] * 6 + ['ND'] * 6))
        for revalidar in (False, True):
            with self.subTest(revalidar=revalidar):
                r = self.cliente.post('/api/validate/full',
                                      json={'filename': nombre, 'revalidate': revalidar})
                self.assertEqual(r.status_code, 200, r.get_json())
                self.assertEqual(self.cobertura(r, 'SAN', 'O3'), 75.0)

    def test_respeta_los_contaminantes_elegidos(self):
        df = _dia([0.02] * 24).assign(NO2=0.01)
        nombre = self.bd_excel('BD_2026.xlsx', df)
        r = self.cliente.post('/api/preview-validated',
                              json={'filename': nombre, 'contaminantes': ['NO2']})
        self.assertEqual(r.get_json()['mir']['contaminantes'], ['NO2'])

    def test_el_reporte_en_excel_sale_del_archivo_cargado(self):
        """Antes daba 409: las filas del MIR solo se guardaban con SIMAJ o Emisiones."""
        nombre = self.bd_excel('BD_2026.xlsx', _dia([0.02] * 12 + ['IR'] * 6 + ['ND'] * 6))
        self.cliente.post('/api/preview-validated', json={'filename': nombre})

        r = self.cliente.get('/api/minutales/reporte.xlsx?contaminantes=O3')
        self.assertEqual(r.status_code, 200)
        hojas = pd.read_excel(io.BytesIO(r.data), sheet_name=None)
        self.assertEqual(hojas['MIR'].iloc[0]['O3'], 75.0)

        # Y recalcular con otra selección usa el mismo criterio de banderas.
        r = self.cliente.post('/api/minutales/mir', json={'contaminantes': ['O3']})
        self.assertEqual(r.get_json()['mir']['estaciones'][0]['coberturas']['O3'], 75.0)

    def test_un_archivo_sin_estacion_no_deja_el_mir_del_anterior(self):
        ultimo.guardar(_dia([0.02] * 24), 'simaj')
        nombre = self.bd_excel('sin_estacion.xlsx', pd.DataFrame({'DATE': ['2026-06-01'], 'O3': [0.02]}))
        self.cliente.post('/api/preview-validated', json={'filename': nombre})
        self.assertIsNone(ultimo.datos())


if __name__ == '__main__':
    unittest.main()
