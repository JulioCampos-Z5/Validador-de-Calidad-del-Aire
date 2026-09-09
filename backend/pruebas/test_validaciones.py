"""
Reglas de validación.

Los números de aquí salen del documento «Script validación para datos de calidad
del aire». Cada umbral fijado en una prueba es un acuerdo con el área técnica, no
una preferencia del código: si alguien cambia 1000 por 900 o la tolerancia de
NOx de 0.15 a 0.10, estas pruebas lo dicen.
"""

import unittest

import pandas as pd

from app import (RANGOS, aplicar_decimales, marcar_huecos, validar_rangos,
                 validar_series_temporales, validar_temperatura_interna,
                 _amplitud_circular)


def horas(estacion='MIR', fecha='2026-09-01', n=24, **columnas):
    """Un día de filas horarias, con las columnas que se le pasen."""
    filas = []
    for h in range(n):
        fila = {'STATION': estacion, 'DATE': fecha, 'HOUR': h}
        for nombre, valores in columnas.items():
            fila[nombre] = valores[h] if isinstance(valores, list) else valores
        filas.append(fila)
    return pd.DataFrame(filas)


class RangosDelScript(unittest.TestCase):
    def test_particulas_llegan_hasta_1000(self):
        """
        El script dice 1000 ug/m3. Con el 900 que habia antes, un episodio de
        quema agricola se marcaba IR siendo valido.
        """
        self.assertEqual(RANGOS['PM10']['max'], 1000)
        self.assertEqual(RANGOS['PM2.5']['max'], 1000)

        df = horas(n=3, PM10=[950, 1200, 42])
        r = validar_rangos(df)
        self.assertEqual(r.loc[0, 'PM10'], 950, '950 esta dentro del rango')
        self.assertEqual(r.loc[1, 'PM10'], 'IR')
        self.assertEqual(r.loc[2, 'PM10'], 42)

    def test_fuera_de_rango_se_marca_IR(self):
        df = horas(n=2, O3=[0.6, 0.02])
        r = validar_rangos(df)
        self.assertEqual(r.loc[0, 'O3'], 'IR')
        self.assertEqual(r.loc[1, 'O3'], 0.02)

    def test_negativo_dentro_de_tolerancia_se_iguala_al_limite_de_deteccion(self):
        """
        El script: «si el dato esta entre limite minimo y limite de deteccion,
        sustituir por limite de deteccion». Ojo, la NOM-156 dice igualar a cero;
        esta prueba fija lo que hace el codigo hoy, que sigue al script.
        """
        df = horas(n=1, O3=-0.002)
        r = validar_rangos(df)
        self.assertAlmostEqual(r.loc[0, 'O3'], RANGOS['O3']['limite_deteccion'])

    def test_por_debajo_del_minimo_es_IR_no_sustitucion(self):
        df = horas(n=1, O3=-0.5)
        self.assertEqual(validar_rangos(df).loc[0, 'O3'], 'IR')

    def test_rangos_a_medida_sustituyen_a_los_por_defecto(self):
        df = horas(n=1, PM10=950)
        r = validar_rangos(df, {'PM10': {'min': 0, 'max': 900}})
        self.assertEqual(r.loc[0, 'PM10'], 'IR')


class TemperaturaDeCabina(unittest.TestCase):
    """
    Fuera de 20-30 grados la cabina no garantiza la medicion, asi que los ocho
    contaminantes de esa hora se marcan IO. La meteorologia no se toca.
    """

    def test_invalida_los_contaminantes_de_esa_hora(self):
        df = horas(n=3, IT=[25, 35, 22], O3=0.02, SO2=0.01, ET=18.0)
        r = validar_temperatura_interna(df)
        self.assertEqual(r.loc[0, 'O3'], 0.02)
        self.assertEqual(r.loc[1, 'O3'], 'IO')
        self.assertEqual(r.loc[1, 'SO2'], 'IO')
        self.assertEqual(r.loc[2, 'O3'], 0.02)

    def test_no_toca_la_meteorologia(self):
        df = horas(n=1, IT=35, O3=0.02, ET=18.0, WS=2.0)
        r = validar_temperatura_interna(df)
        self.assertEqual(r.loc[0, 'ET'], 18.0)
        self.assertEqual(r.loc[0, 'WS'], 2.0)

    def test_sin_temperatura_valida_no_invalida_nada(self):
        """«Si se tiene un dato valido de la TI, se verifica...»"""
        df = horas(n=1, IT=None, O3=0.02)
        r = validar_temperatura_interna(df)
        self.assertEqual(r.loc[0, 'O3'], 0.02)

    def test_limites_configurables(self):
        df = horas(n=1, IT=32, O3=0.02)
        self.assertEqual(validar_temperatura_interna(df, 20, 35).loc[0, 'O3'], 0.02)


class SeriesDeContaminantes(unittest.TestCase):
    def test_valores_constantes_mas_de_tres_horas_son_DS(self):
        df = horas(n=8, O3=[0.02, 0.02, 0.02, 0.02, 0.03, 0.04, 0.05, 0.06])
        r = validar_series_temporales(df, {'nox': False, 'pm': False,
                                           'radiacion': False, 'viento': False,
                                           'temp_externa': False})
        self.assertEqual(list(r.loc[0:3, 'O3']), ['DS'] * 4)
        self.assertEqual(r.loc[4, 'O3'], 0.03)

    def test_exactamente_tres_horas_iguales_no_bastan(self):
        """El criterio es «> 3 horas», no «>= 3»."""
        df = horas(n=6, O3=[0.02, 0.02, 0.02, 0.03, 0.04, 0.05])
        r = validar_series_temporales(df, {'nox': False, 'pm': False,
                                           'radiacion': False, 'viento': False,
                                           'temp_externa': False})
        self.assertEqual(r.loc[0, 'O3'], 0.02)

    def test_so2_queda_excluido_de_los_constantes(self):
        """Valores constantes en SO2 son normales en esta zona."""
        df = horas(n=6, SO2=0.001)
        r = validar_series_temporales(df, {'nox': False, 'pm': False,
                                           'radiacion': False, 'viento': False,
                                           'temp_externa': False})
        self.assertEqual(r.loc[0, 'SO2'], 0.001)

    def test_relacion_nox_con_tolerancia_del_script(self):
        """
        El script pide (NO+NO2)/NOX dentro de 0.85-1.15. Con la tolerancia de
        0.10 que habia antes se invalidaban horas que la especificacion acepta.
        """
        df = horas(n=2, NO=[0.010, 0.010], NO2=[0.002, 0.002],
                   NOX=[0.0109, 0.020])
        r = validar_series_temporales(df, {'constantes': False, 'pm': False,
                                           'radiacion': False, 'viento': False,
                                           'temp_externa': False})
        # 0.012/0.0109 = 1.10 -> dentro de 1.15
        self.assertEqual(r.loc[0, 'NO'], 0.010)
        # 0.012/0.020 = 0.60 -> fuera; se marcan los tres
        self.assertEqual(r.loc[1, 'NO'], 'IO')
        self.assertEqual(r.loc[1, 'NO2'], 'IO')
        self.assertEqual(r.loc[1, 'NOX'], 'IO')

    def test_pm25_no_puede_superar_a_pm10(self):
        df = pd.DataFrame([
            {'STATION': 'MIR', 'DATE': '2026-09-01', 'HOUR': 0,
             'PM10': 100, 'PM2.5': 110},
            {'STATION': 'MIR', 'DATE': '2026-09-01', 'HOUR': 1,
             'PM10': 100, 'PM2.5': 130},
        ])
        r = validar_series_temporales(df, {'constantes': False, 'nox': False,
                                           'radiacion': False, 'viento': False,
                                           'temp_externa': False})
        self.assertEqual(r.loc[0, 'PM2.5'], 110, '1.10 esta dentro de 1.15')
        self.assertEqual(r.loc[1, 'PM2.5'], 'IO')
        self.assertEqual(r.loc[1, 'PM10'], 'IO')


class SeriesMeteorologicas(unittest.TestCase):
    """
    Las cinco reglas que faltaban. Todas parten de la misma idea: un sensor
    averiado no deja de dar numeros, da numeros plausibles; lo que lo delata es
    que no varian.
    """

    SOLO_METEO = {'constantes': False, 'nox': False, 'pm': False}

    def test_radiacion_distinta_de_cero_de_noche(self):
        rs = [0.0] * 24
        rs[23] = 30.0          # de noche, muy por encima del ruido
        rs[13] = 800.0         # de dia, normal
        rs[2] = 3.0            # de noche, pero es ruido del sensor
        r = validar_series_temporales(horas(RS=rs), self.SOLO_METEO)
        self.assertEqual(r.loc[23, 'RS'], 'IO')
        self.assertEqual(r.loc[13, 'RS'], 800.0)
        self.assertEqual(r.loc[2, 'RS'], 3.0, 'por debajo del umbral de 5 W/m2')

    def test_umbral_de_radiacion_configurable(self):
        opciones = dict(self.SOLO_METEO, radiacion_umbrales={'RS': 1.0})
        rs = [0.0] * 24
        rs[2] = 3.0
        r = validar_series_temporales(horas(RS=rs), opciones)
        self.assertEqual(r.loc[2, 'RS'], 'IO')

    def test_velocidad_de_viento_clavada_tres_horas(self):
        ws = [1.0 + h * 0.4 for h in range(24)]
        ws[5] = ws[6] = ws[7] = 1.30
        r = validar_series_temporales(horas(WS=ws), self.SOLO_METEO)
        self.assertEqual(list(r.loc[5:7, 'WS']), ['IO'] * 3)
        self.assertNotEqual(r.loc[4, 'WS'], 'IO')

    def test_direccion_de_viento_se_compara_en_circulo(self):
        """
        Una veleta trabada al norte oscila entre 359 y 1. Restando maximo menos
        minimo la amplitud saldria 358 y parecería estar girando.
        """
        wd = [(h * 37) % 360 for h in range(24)]
        # Amplitud circular 0.7 grados: por dentro del umbral de 1. Restando
        # maximo menos minimo saldria 359.6 y no se marcaria nada.
        wd[10], wd[11], wd[12] = 359.7, 0.1, 0.4
        r = validar_series_temporales(horas(WD=wd), self.SOLO_METEO)
        self.assertEqual(list(r.loc[10:12, 'WD']), ['IO'] * 3)

    def test_direccion_de_viento_que_si_varia_no_se_marca(self):
        """Justo por encima del umbral: 1.1 grados en tres horas."""
        wd = [(h * 37) % 360 for h in range(24)]
        wd[10], wd[11], wd[12] = 359.5, 0.2, 0.6
        r = validar_series_temporales(horas(WD=wd), self.SOLO_METEO)
        self.assertNotEqual(r.loc[10, 'WD'], 'IO')

    def test_salto_de_temperatura_externa(self):
        et = [18.0 + h * 0.3 for h in range(24)]
        et[15] = 40.0
        r = validar_series_temporales(horas(ET=et), self.SOLO_METEO)
        self.assertEqual(r.loc[15, 'ET'], 'IO')
        self.assertEqual(r.loc[14, 'ET'], 'IO', 'se marcan las dos horas del salto')

    def test_temperatura_externa_demasiado_plana(self):
        r = validar_series_temporales(horas(ET=20.0), self.SOLO_METEO)
        self.assertEqual(r.loc[0, 'ET'], 'IO')

    def test_presion_desactivada_por_defecto(self):
        """
        El umbral de 0.75 mmHg del script marca el 54.6% de los datos reales de
        la red. Se deja apagada hasta que el area tecnica fije un numero.
        """
        atm = [640.0 + (3.0 if h > 19 else 0.0) for h in range(24)]
        r = validar_series_temporales(horas(ATM=atm), self.SOLO_METEO)
        self.assertNotIn('IO', list(r['ATM']))

    def test_presion_marca_cuando_se_activa(self):
        atm = [640.0 + (3.0 if h > 19 else 0.0) for h in range(24)]
        r = validar_series_temporales(horas(ATM=atm),
                                      dict(self.SOLO_METEO, presion=True))
        self.assertIn('IO', list(r['ATM']))

    def test_un_hueco_de_horas_no_es_una_serie_plana(self):
        """
        La ventana se mide en horas de calendario. Si la estacion dejo de
        publicar, las filas de antes y despues son contiguas en el DataFrame
        pero no en el tiempo, y compararlas inventaria una serie que no existio.
        """
        df = pd.DataFrame([
            {'STATION': 'MIR', 'DATE': '2026-09-01', 'HOUR': 0, 'WS': 1.30},
            {'STATION': 'MIR', 'DATE': '2026-09-01', 'HOUR': 9, 'WS': 1.30},
            {'STATION': 'MIR', 'DATE': '2026-09-01', 'HOUR': 18, 'WS': 1.30},
        ])
        r = validar_series_temporales(df, self.SOLO_METEO)
        self.assertNotIn('IO', list(r['WS']))

    def test_cada_estacion_se_evalua_por_separado(self):
        a = horas(estacion='MIR', WS=1.30)
        b = horas(estacion='CEN', WS=[1.0 + h * 0.9 for h in range(24)])
        r = validar_series_temporales(pd.concat([a, b], ignore_index=True),
                                      self.SOLO_METEO)
        marcadas = r[r['WS'] == 'IO']['STATION'].unique()
        self.assertEqual(list(marcadas), ['MIR'])


class AmplitudCircular(unittest.TestCase):
    def test_extremos_del_circulo(self):
        self.assertAlmostEqual(_amplitud_circular([359, 1]), 2.0)

    def test_valores_normales(self):
        self.assertAlmostEqual(_amplitud_circular([10, 20, 30]), 20.0)

    def test_un_solo_angulo(self):
        self.assertAlmostEqual(_amplitud_circular([180]), 0.0)


class HuecosConBandera(unittest.TestCase):
    """
    Una celda en blanco no dice nada: no se distingue el dato que falta del que
    nadie revisó. El 10.2.1 de la NOM pide bandera en todos.
    """

    def test_hueco_de_un_canal_que_si_mide_es_ND(self):
        df = horas(n=3, O3=[0.02, None, 0.03])
        r = marcar_huecos(df)
        self.assertEqual(r.loc[1, 'O3'], 'ND')
        self.assertEqual(r.loc[0, 'O3'], 0.02)

    def test_canal_sin_una_sola_medicion_es_SE(self):
        """
        Sin equipo no es lo mismo que averiado: confundirlos haría que una
        estación sin sensor de PM pareciera una con el sensor roto todo el año.
        """
        df = horas(n=3, O3=0.02, SO2=None)
        r = marcar_huecos(df)
        self.assertEqual(list(r['SO2']), ['SE'] * 3)

    def test_una_bandera_no_cuenta_como_medicion(self):
        """
        Si lo único que hay en la columna son banderas, el equipo no entregó un
        solo dato: el canal está sin equipo, no con huecos sueltos.
        """
        df = horas(n=3, CO=['IR', None, 'IR'])
        r = marcar_huecos(df)
        self.assertEqual(r.loc[1, 'CO'], 'SE')

    def test_cada_estacion_se_juzga_por_separado(self):
        """Que una estación tenga el sensor no dice nada de las demás."""
        a = horas(estacion='MIR', n=2, SO2=[0.01, None])
        b = horas(estacion='CEN', n=2, SO2=[None, None])
        r = marcar_huecos(pd.concat([a, b], ignore_index=True))
        self.assertEqual(r.loc[1, 'SO2'], 'ND', 'MIR sí mide SO2')
        self.assertEqual(list(r.loc[2:3, 'SO2']), ['SE', 'SE'], 'CEN no')

    def test_no_toca_los_identificadores(self):
        df = horas(n=2, O3=0.02)
        r = marcar_huecos(df)
        self.assertEqual(list(r['STATION']), ['MIR', 'MIR'])
        self.assertEqual(list(r['HOUR']), [0, 1])

    def test_la_cadena_vacia_tambien_es_un_hueco(self):
        """Según de dónde vengan los datos, el hueco llega como '' o como None."""
        df = horas(n=2, O3=[0.02, ''])
        self.assertEqual(marcar_huecos(df).loc[1, 'O3'], 'ND')

    def test_dataframe_vacio_no_revienta(self):
        self.assertTrue(marcar_huecos(pd.DataFrame()).empty)


class Decimales(unittest.TestCase):
    def test_cada_parametro_con_las_cifras_del_script(self):
        df = pd.DataFrame([{'STATION': 'MIR', 'DATE': '2026-09-01', 'HOUR': 0,
                            'O3': 0.0184567, 'CO': 0.83791, 'PM10': 23.6,
                            'RH': 74.5222, 'ET': 18.3378}])
        r = aplicar_decimales(df)
        self.assertEqual(r.loc[0, 'O3'], 0.018)
        self.assertEqual(r.loc[0, 'CO'], 0.84)
        self.assertEqual(r.loc[0, 'PM10'], 24)
        self.assertEqual(r.loc[0, 'RH'], 74.5)
        self.assertEqual(r.loc[0, 'ET'], 18.34)


if __name__ == '__main__':
    unittest.main()
