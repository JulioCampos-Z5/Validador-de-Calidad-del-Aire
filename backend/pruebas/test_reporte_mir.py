"""
El reporte del MIR exportado.

Lo que se fija aquí es que el archivo lleve las DOS mitades: el indicador y el
diagnóstico de fallas. La tabla del MIR dice que una estación se queda en 60;
sola no le sirve a quien tiene que arreglarlo, porque no dice qué canal la
hunde ni si es una avería o un equipo que no existe. Ese diagnóstico ya se
calculaba y solo se veía en pantalla: al exportar se perdía.

También se comprueba la distinción entre «sin equipo» y «0%», que es la que
cambia la decisión: cero por ciento es un instrumento que hay que ir a mirar;
sin equipo es que ahí no hay instrumento y no hay nada que reparar.
"""

import unittest

import pandas as pd

import app
from minutales import rutas
from minutales.mir import calcular_mir, diagnostico_fallas


def _red(coberturas, estacion='SAN'):
    """Un mes de datos donde cada contaminante tiene la cobertura que se le pida."""
    filas = []
    total_horas = 30 * 24
    for hora in range(total_horas):
        fila = {'STATION': estacion,
                'DATE': f'2026-06-{hora // 24 + 1:02d}',
                'HOUR': hora % 24}
        for contaminante, pct in coberturas.items():
            if pct is None:
                fila[contaminante] = None
            else:
                fila[contaminante] = 0.02 if hora < total_horas * pct / 100 else None
        filas.append(fila)
    return pd.DataFrame(filas)


class TablaDeFallas(unittest.TestCase):
    def _fallas(self, coberturas):
        mir = calcular_mir(_red(coberturas), list(coberturas))
        return rutas._tabla_fallas(diagnostico_fallas(mir))

    def test_lleva_una_fila_por_canal_que_falla(self):
        tabla = self._fallas({'O3': 100, 'NO2': 40, 'SO2': None})
        self.assertEqual(len(tabla), 2)                      # el O3 no falla
        self.assertNotIn('O3', list(tabla['Contaminante']))

    def test_los_tipos_van_en_castellano(self):
        tabla = self._fallas({'O3': 40, 'NO2': 10, 'SO2': None})
        tipos = dict(zip(tabla['Contaminante'], tabla['Tipo']))
        self.assertEqual(tipos['O3'], 'Intermitente')
        self.assertEqual(tipos['NO2'], 'Caído')
        self.assertEqual(tipos['SO2'], 'Sin equipo')

    def test_sin_equipo_no_es_cero_por_ciento(self):
        """Un cero se va a arreglar; un hueco no, porque no hay qué arreglar."""
        tabla = self._fallas({'O3': 100, 'SO2': None})
        fila = tabla[tabla['Contaminante'] == 'SO2'].iloc[0]
        self.assertEqual(fila['Cobertura %'], '')

    def test_dice_cual_hunde_a_la_estacion(self):
        """Con una sola estación por debajo del umbral, todo lo suyo la hunde."""
        tabla = self._fallas({'O3': 30, 'NO2': 30})
        self.assertEqual(set(tabla['Hunde a la estación']), {'Si'})

    def test_sin_fallas_la_hoja_existe_igual(self):
        """Vacía pero con encabezados: una hoja sin columnas no se entiende."""
        tabla = self._fallas({'O3': 100, 'NO2': 100})
        self.assertTrue(tabla.empty)
        self.assertIn('Detalle', tabla.columns)


class ReporteExportado(unittest.TestCase):
    def setUp(self):
        self.cliente = app.app.test_client()
        self.anterior = rutas._ultimo['df']
        rutas._ultimo['df'] = _red({'O3': 100, 'NO2': 40, 'SO2': None})

    def tearDown(self):
        rutas._ultimo['df'] = self.anterior

    def test_el_excel_trae_las_dos_hojas(self):
        respuesta = self.cliente.get(
            '/api/minutales/reporte.xlsx?contaminantes=O3,NO2,SO2')
        self.assertEqual(respuesta.status_code, 200)

        import io
        hojas = pd.read_excel(io.BytesIO(respuesta.data), sheet_name=None)
        self.assertEqual(list(hojas), ['MIR', 'Fallas'])
        self.assertEqual(hojas['MIR'].iloc[0]['Estación'], 'SAN')
        # Las dos que fallan: el NO2 intermitente y el SO2 sin equipo.
        self.assertEqual(len(hojas['Fallas']), 2)

    def test_sin_periodo_descargado_lo_dice_y_no_revienta(self):
        rutas._ultimo['df'] = None
        respuesta = self.cliente.get('/api/minutales/reporte.xlsx')
        self.assertEqual(respuesta.status_code, 409)
        self.assertIn('error', respuesta.get_json())

    def test_el_csv_sigue_siendo_solo_la_tabla_del_mir(self):
        """Es lo que se pega tal cual en la hoja del área técnica."""
        respuesta = self.cliente.get(
            '/api/minutales/reporte.csv?contaminantes=O3,NO2,SO2')
        self.assertEqual(respuesta.status_code, 200)
        texto = respuesta.get_data(as_text=True)
        self.assertIn('Estación', texto)
        self.assertIn('Cumple', texto)
        self.assertNotIn('Hunde a la estación', texto)


if __name__ == '__main__':
    unittest.main()
