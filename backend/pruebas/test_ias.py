"""
Índice Aire y Salud (NOM-172) y cumplimiento de las NOM de salud.

Además de fijar las reglas de la norma, varias pruebas existen por un error
concreto del script `validador_ENVISTA_IAS_NOM_num.py` que el port corrige:
el NowCast de PM2.5 con el factor de PM10, el «No cumple» por comparar contra
un hueco, las ventanas contadas por filas en vez de horas, los límites fijos de
2026 y el máximo de 8 h sin suficiencia. Si alguna vuelve a fallar, es que el
error regresó.
"""

import io
import unittest

import numpy as np
import pandas as pd

import app
import ultimo
from ias import rutas
from ias.calculo import (calcular_diario, calcular_horario, calcular_municipios, clasificar,
                         nowcast, redondear, redondear_serie)


def horas(estacion='MIR', desde='2026-09-01', n=24, **columnas):
    """`n` horas seguidas desde `desde` 00:00, con las columnas que se pasen."""
    inicio = pd.Timestamp(desde)
    filas = []
    for i in range(n):
        t = inicio + pd.Timedelta(hours=i)
        fila = {'STATION': estacion, 'DATE': t.strftime('%Y-%m-%d'), 'HOUR': t.hour}
        for nombre, valores in columnas.items():
            fila[nombre] = valores[i] if isinstance(valores, list) else valores
        filas.append(fila)
    return pd.DataFrame(filas)


def fila(h, estacion, fecha, hora):
    return h[(h['STATION'] == estacion) & (h['DATE'] == fecha) & (h['HOUR'] == hora)].iloc[0]


class Redondeo(unittest.TestCase):
    def test_cinco_sube(self):
        self.assertEqual(redondear(0.0585, 3), 0.059)
        self.assertEqual(redondear(2.5, 0), 3)
        self.assertEqual(redondear(8.125, 2), 8.13)

    def test_vectorizado_igual_que_escalar(self):
        """0.0585 × 1000 = 58.4999… en binario: sin cuidado bajaría."""
        s = pd.Series([0.0585, 2.5, 8.125, np.nan, 44.5])
        self.assertEqual(redondear_serie(s, 3).iloc[0], 0.059)
        self.assertEqual(redondear_serie(s, 0).iloc[1], 3)
        self.assertEqual(redondear_serie(s, 2).iloc[2], 8.13)
        self.assertTrue(np.isnan(redondear_serie(s, 0).iloc[3]))
        self.assertEqual(redondear_serie(s, 0).iloc[4], 45)


class NowCast(unittest.TestCase):
    def test_pm25_usa_su_factor(self):
        """Corrección 1: el script calculaba PM2.5 con 0.714 (el de PM10)."""
        doce = [100.0] * 12
        self.assertEqual(nowcast(doce, 0), 71)   # 100 × 0.714
        self.assertEqual(nowcast(doce, 1), 69)   # 100 × 0.694

    def test_exige_dos_de_las_tres_recientes(self):
        self.assertIsNone(nowcast([30.0] * 10 + [None, None], 0))
        self.assertIsNotNone(nowcast([30.0] * 10 + [None, 30.0], 0))

    def test_todo_ceros_da_cero(self):
        self.assertEqual(nowcast([0.0] * 12, 1), 0)

    def test_ejemplo_del_script(self):
        # w = 1 - (37-22)/37 = 0.59; se pondera con huecos y se ajusta.
        v = [32, 37, 29, 22, 30, 27, 30, 25, 22, 27, None, 32]
        r = nowcast([None if x is None else float(x) for x in v], 0)
        pares = [(float(x), h) for h, x in enumerate(reversed(v)) if x is not None]
        num = sum(x * 0.59 ** h for x, h in pares)
        den = sum(0.59 ** h for _, h in pares)
        self.assertEqual(r, round(round(num / den) * 0.714))


class Bandas(unittest.TestCase):
    def test_intervalos_abiertos_abajo(self):
        self.assertEqual(clasificar(0.058, 'O3', 2026), 0)
        self.assertEqual(clasificar(0.059, 'O3', 2026), 1)
        self.assertEqual(clasificar(16.01, 'CO', 2026), 4)

    def test_particulas_segun_el_anio(self):
        """Corrección 4: 55 µg/m³ de PM10 es Aceptable en 2024 y Mala en 2026."""
        self.assertEqual(clasificar(55, 'PM10', 2024), 1)
        self.assertEqual(clasificar(55, 'PM10', 2025), 1)
        self.assertEqual(clasificar(55, 'PM10', 2026), 2)
        self.assertEqual(clasificar(30, 'PM2.5', 2024), 1)
        self.assertEqual(clasificar(30, 'PM2.5', 2026), 2)


class Horario(unittest.TestCase):
    def test_banderas_no_cuentan_como_dato(self):
        df = horas(n=3, O3=[0.03, 'IR', 0.04])
        h = calcular_horario(df)
        self.assertTrue(pd.isna(fila(h, 'MIR', '2026-09-01', 1)['IAS_O3_CAT']))
        self.assertEqual(fila(h, 'MIR', '2026-09-01', 2)['IAS_O3_CAT'], 'Buena')

    def test_ventana_de_8h_por_horas_no_por_filas(self):
        """
        Corrección 3: faltan las filas de 06:00 a 09:00. A las 11:00 la ventana
        de 8 h (04–11) solo tiene 4 datos; contada por filas tendría 8.
        """
        df = horas(n=12, CO=1.0)
        df = df[~df['HOUR'].isin([6, 7, 8, 9])]
        h = calcular_horario(df)
        self.assertTrue(pd.isna(fila(h, 'MIR', '2026-09-01', 11)['CO_8H']))
        self.assertEqual(fila(h, 'MIR', '2026-09-01', 5)['CO_8H'], 1.0)

    def test_hueco_de_8h_no_es_incumplimiento(self):
        """
        Corrección 2: en la primera hora no hay promedio de 8 h. El script
        comparaba NaN <= límite, daba falso y la marcaba «No cumple».
        """
        h = calcular_horario(horas(n=2, O3=0.03, CO=1.0))
        primera = fila(h, 'MIR', '2026-09-01', 0)
        self.assertEqual(primera['NOM_O3_CUMPLE'], 'Si')
        self.assertEqual(primera['NOM_CO_CUMPLE'], 'Si')

    def test_global_es_el_peor_y_su_responsable(self):
        h = calcular_horario(horas(n=1, O3=0.10, SO2=0.01))
        f = fila(h, 'MIR', '2026-09-01', 0)
        self.assertEqual(f['IAS_GLOBAL_CAT'], 'Mala')
        self.assertEqual(f['IAS_GLOBAL_POL'], 'O3')

    def test_empate_lo_decide_la_fraccion_en_la_banda(self):
        """O3 y SO2 en Aceptable; SO2 está más adentro de su banda."""
        h = calcular_horario(horas(n=1, O3=0.060, SO2=0.070))
        self.assertEqual(fila(h, 'MIR', '2026-09-01', 0)['IAS_GLOBAL_POL'], 'SO2')

    def test_amg_es_el_maximo_entre_estaciones(self):
        df = pd.concat([horas('MIR', n=2, O3=0.03), horas('CEN', n=2, O3=0.07)])
        h = calcular_horario(df)
        self.assertEqual(fila(h, 'AMG', '2026-09-01', 0)['O3_1H'], 0.07)


class Diario(unittest.TestCase):
    def test_suficiencia_de_18_horas(self):
        h = calcular_horario(horas(n=24, O3=[0.03] * 17 + [None] * 7))
        d = calcular_diario(h)
        dia = d[d['STATION'] == 'MIR'].iloc[0]
        self.assertFalse(dia['O3_SUF_DIARIA'])
        self.assertIsNone(dia['NOM_O3_CUMPLE'])
        self.assertIsNone(dia['IAS_O3_CAT_DIA'])

    def test_maximo_de_8h_de_co_exige_suficiencia(self):
        """Corrección 5: con 10 horas de CO el día no se califica por CO."""
        h = calcular_horario(horas(n=24, CO=[1.0] * 10 + [None] * 14))
        dia = calcular_diario(h).query("STATION == 'MIR'").iloc[0]
        self.assertTrue(pd.isna(dia['CO_MAX_8H']))
        self.assertIsNone(dia['IAS_CO_CAT_DIA'])

    def test_indicadores_diarios_de_la_norma(self):
        df = horas(n=24, O3=[0.02] * 23 + [0.10], PM10=40)
        dia = calcular_diario(calcular_horario(df)).query("STATION == 'MIR'").iloc[0]
        self.assertEqual(dia['O3_MAX_1H'], 0.10)       # O3: máximo horario
        self.assertEqual(dia['PM10_AVG_24H'], 40)      # PM: promedio 24 h
        self.assertEqual(dia['IAS_GLOBAL_CAT_DIA'], 'Mala')
        self.assertEqual(dia['IAS_GLOBAL_POL_DIA'], 'O3')

    def test_limite_nom_de_particulas_segun_el_anio(self):
        """Corrección 4: 30 µg/m³ de PM2.5 cumple en 2024 (33) y no en 2026 (25)."""
        for anio, esperado in ((2024, 'Si'), (2026, 'No')):
            df = horas(desde=f'{anio}-03-01', n=24, **{'PM2.5': 30})
            dia = calcular_diario(calcular_horario(df)).query("STATION == 'MIR'").iloc[0]
            self.assertEqual(dia['NOM_PM2.5_CUMPLE'], esperado, anio)

    def test_amg_diario(self):
        df = pd.concat([horas('MIR', n=24, O3=0.03), horas('CEN', n=24, O3=0.07)])
        amg = calcular_diario(calcular_horario(df)).query("STATION == 'AMG'").iloc[0]
        self.assertEqual(amg['O3_MAX_1H'], 0.07)
        self.assertTrue(amg['O3_SUF_DIARIA'])


class Municipios(unittest.TestCase):
    def test_maximo_de_su_area_y_estacion_peor(self):
        df = pd.concat([horas('MIR', n=24, O3=0.10), horas('CEN', n=24, O3=0.03)])
        m = calcular_municipios(calcular_diario(calcular_horario(df)))
        gdl = m[m['MUNICIPIO'] == 'Guadalajara'].iloc[0]
        self.assertEqual(gdl['O3_MAX_1H'], 0.10)
        self.assertEqual(gdl['ESTACION_IAS_GLOBAL_MAX'], 'MIR')
        self.assertEqual(gdl['IAS_GLOBAL_CAT_DIA'], 'Mala')
        # Tonalá solo tiene LDO, que no midió: sin suficiencia ni categoría.
        ton = m[m['MUNICIPIO'] == 'Tonalá'].iloc[0]
        self.assertFalse(ton['O3_SUF_DIARIA'])
        self.assertTrue(pd.isna(ton['IAS_GLOBAL_CAT_DIA']))


class Endpoints(unittest.TestCase):
    def setUp(self):
        ultimo.olvidar()
        rutas._cache.update({'df': None, 'horario': None, 'diario': None})
        self.cliente = app.app.test_client()

    def tearDown(self):
        ultimo.olvidar()

    def _cargar(self):
        df = pd.concat([horas('MIR', n=48, O3=0.03, PM10=40, CO=1.0),
                        horas('CEN', n=48, O3=0.07, PM10=20, CO=1.0)], ignore_index=True)
        ultimo.guardar_validado(df, 'archivo', 'prueba')

    def test_sin_datos_es_409(self):
        self.assertEqual(self.cliente.get('/api/ias/resumen').status_code, 409)
        self.assertEqual(self.cliente.get('/api/ias/diario.xlsx').status_code, 409)

    def test_resumen_y_categorias(self):
        self._cargar()
        r = self.cliente.get('/api/ias/resumen').get_json()
        self.assertEqual(r['estaciones'], ['CEN', 'MIR', 'AMG'])
        self.assertEqual(r['meses']['MIR'], ['2026-09'])

        c = self.cliente.get('/api/ias/categorias?estacion=CEN&mes=2026-09').get_json()
        self.assertEqual(len(c['dias']), 30)
        primer = c['dias'][0]
        self.assertEqual(primer['horas'][0]['cat'], 1)          # O3 0.07 → Aceptable
        self.assertEqual(primer['horas'][0]['pol'], 'O3')
        self.assertEqual(primer['diaria']['cat'], 1)
        self.assertIsNone(c['dias'][5]['horas'][0])             # sin datos ese día

    def test_excel_diario_con_las_ocho_hojas(self):
        self._cargar()
        r = self.cliente.get('/api/ias/diario.xlsx')
        self.assertEqual(r.status_code, 200)
        hojas = pd.ExcelFile(io.BytesIO(r.data)).sheet_names
        r.close()
        self.assertEqual(hojas, ['Data_Diaria', 'Resumen_Anual_Contam', 'Resumen_Anual_Estacion',
                                 'Data_Diaria_Municipio', 'Resumen_Anual_Mun_Contam',
                                 'Resumen_Anual_Municipio', 'MIDE', 'MIDE-municipio'])

    def test_excel_horario(self):
        self._cargar()
        r = self.cliente.get('/api/ias/horario.xlsx')
        self.assertEqual(r.status_code, 200)
        data = pd.read_excel(io.BytesIO(r.data), sheet_name='Data+IAS')
        r.close()
        self.assertIn('IAS_GLOBAL_CAT', data.columns)
        self.assertEqual(set(data['STATION']), {'MIR', 'CEN', 'AMG'})


if __name__ == '__main__':
    unittest.main()
