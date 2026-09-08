"""
Minutales del SIMAJ: parseo de los .lsi e indicador MIR.

El MIR se comprueba contra la fila que el área técnica ya tenía calculada a
mano. Es la única forma de saber que la regla deducida de su hoja es la suya y
no una parecida.
"""

import unittest
from datetime import datetime

import pandas as pd

from minutales import cliente
from minutales.mir import calcular_mir, diagnostico_fallas


class ParseoLsi(unittest.TestCase):
    """
    Una linea: idEstacion, fechaHora, valor1, status1, ..., valor17, status17.
    Solo son validos los valores con status 1.
    """

    def linea(self, valores):
        return '1,01/06/2026 00:00:00,' + ','.join(str(v) for v in valores)

    def test_solo_pasa_lo_que_trae_status_uno(self):
        # O3 valido, NO invalido, NO2 valido; el resto sin datos.
        campos = [0.018, 1, 0.005, 0, 0.014, 1] + [0, 0] * 14
        fila = cliente.parsear_lsi(self.linea(campos), 'CENTRO')
        self.assertEqual(fila['STATION'], 'CEN')
        self.assertEqual(fila['DATE'], '2026-06-01')
        self.assertEqual(fila['HOUR'], 0)
        self.assertAlmostEqual(fila['O3'], 0.018)
        self.assertIsNone(fila['NO'], 'status 0 no es una medicion')
        self.assertAlmostEqual(fila['NO2'], 0.014)

    def test_centinela_se_descarta_aunque_el_status_sea_uno(self):
        campos = [-9999, 1] + [0, 0] * 16
        fila = cliente.parsear_lsi(self.linea(campos), 'CENTRO')
        self.assertIsNone(fila['O3'])

    def test_linea_incompleta_no_revienta(self):
        self.assertIsNone(cliente.parsear_lsi('1', 'CENTRO'))
        self.assertIsNone(cliente.parsear_lsi('1,fecha invalida,0.1,1', 'CENTRO'))

    def test_faltan_columnas_al_final(self):
        """Un .lsi recortado deja los canales que faltan en None, no falla."""
        fila = cliente.parsear_lsi('1,01/06/2026 00:00:00,0.018,1', 'CENTRO')
        self.assertAlmostEqual(fila['O3'], 0.018)
        self.assertIsNone(fila['IT'])

    def test_abreviaturas_de_estacion(self):
        for carpeta, clave in (('LAS AGUILAS', 'AGU'), ('COUNTRY', 'COU'),
                               ('SANTA MARGARITA', 'SMT')):
            fila = cliente.parsear_lsi('1,01/06/2026 00:00:00,0.1,1', carpeta)
            self.assertEqual(fila['STATION'], clave)


class FechaDelNombreDeArchivo(unittest.TestCase):
    """
    Hace falta para filtrar por periodo sin bajar nada. El listado de IIS viene
    ordenado alfabeticamente, no por fecha: recortar por nombre daria el periodo
    equivocado.
    """

    def test_nombre_normal(self):
        self.assertEqual(cliente.fecha_de_archivo('15_06_2026 12_10.lsi'),
                         datetime(2026, 6, 15, 12, 10))

    def test_separador_con_guion_bajo(self):
        self.assertEqual(cliente.fecha_de_archivo('15_06_2026_12_10.lsi'),
                         datetime(2026, 6, 15, 12, 10))

    def test_nombre_que_no_es_una_fecha(self):
        self.assertIsNone(cliente.fecha_de_archivo('index.html'))

    def test_fecha_imposible(self):
        self.assertIsNone(cliente.fecha_de_archivo('32_13_2026 00_10.lsi'))


class IndicadorMir(unittest.TestCase):
    def _red(self, coberturas):
        """
        Construye un mes de datos donde cada contaminante tiene el porcentaje de
        horas validas que se le pida. `None` significa que no hay equipo.
        """
        filas = []
        total_horas = 30 * 24
        for hora in range(total_horas):
            fila = {'STATION': 'SAN',
                    'DATE': f'2026-06-{hora // 24 + 1:02d}',
                    'HOUR': hora % 24}
            for contaminante, pct in coberturas.items():
                if pct is None:
                    fila[contaminante] = None
                else:
                    fila[contaminante] = 0.02 if hora < total_horas * pct / 100 else None
            filas.append(fila)
        return pd.DataFrame(filas)

    def test_el_hueco_sin_equipo_se_excluye_del_promedio(self):
        """
        El caso comprobado contra la hoja del area tecnica: Santa Anita con
        100, 100, (sin equipo), 33, 99, 100 da 86 excluyendo el hueco.
        Contandolo como cero daria 72, y la estacion pasaria de cumplir a no
        cumplir. Es la diferencia entre «aqui no hay instrumento» y «el
        instrumento no reporto».
        """
        df = self._red({'O3': 100, 'NO2': 100, 'SO2': None,
                        'CO': 33, 'PM10': 99, 'PM2.5': 100})
        mir = calcular_mir(df)
        estacion = mir['estaciones'][0]

        self.assertIn('SO2', estacion['sin_equipo'])
        self.assertEqual(estacion['total'], 86)
        self.assertTrue(estacion['cumple'])

    def test_el_promedio_es_simple_no_ponderado(self):
        """Se promedian los porcentajes, no se suman horas sobre horas."""
        df = self._red({'O3': 100, 'NO2': 50})
        mir = calcular_mir(df, ['O3', 'NO2'])
        self.assertEqual(mir['estaciones'][0]['total'], 75)

    def test_umbral_del_75(self):
        df = self._red({'O3': 70, 'NO2': 70})
        mir = calcular_mir(df, ['O3', 'NO2'])
        self.assertFalse(mir['estaciones'][0]['cumple'])
        self.assertEqual(mir['estaciones_que_cumplen'], 0)

    def test_las_horas_esperadas_son_las_del_calendario(self):
        """
        Si se contara sobre las filas presentes, una estacion que dejo de
        publicar una semana saldria con 100%: no hay filas malas porque no hay
        filas.
        """
        df = pd.DataFrame([
            {'STATION': 'MIR', 'DATE': '2026-06-01', 'HOUR': h, 'O3': 0.02}
            for h in range(24)
        ] + [
            {'STATION': 'MIR', 'DATE': '2026-06-10', 'HOUR': 0, 'O3': 0.02}
        ])
        mir = calcular_mir(df, ['O3'])
        # 25 horas con dato sobre 10 dias de calendario, no sobre 25 filas.
        self.assertLess(mir['estaciones'][0]['coberturas']['O3'], 100)

    def test_diagnostico_separa_sin_equipo_de_caido(self):
        df = self._red({'O3': 100, 'NO2': 5, 'SO2': None})
        fallas = diagnostico_fallas(calcular_mir(df, ['O3', 'NO2', 'SO2']))
        tipos = {f['contaminante']: f['tipo'] for f in fallas}
        self.assertEqual(tipos.get('SO2'), 'sin_equipo')
        self.assertEqual(tipos.get('NO2'), 'caido')
        self.assertNotIn('O3', tipos)


if __name__ == '__main__':
    unittest.main()
