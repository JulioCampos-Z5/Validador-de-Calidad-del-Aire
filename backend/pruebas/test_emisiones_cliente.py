"""
Cliente de la API de Emisiones.

Cada prueba de aquí corresponde a algo que la API hace de forma inesperada y que
costó descubrir mirando la respuesta real. Sin estas pruebas, el próximo cambio
en el parseo puede romper una de esas suposiciones sin que nada falle de forma
visible: la consulta seguiría devolviendo 200 y filas, solo que equivocadas.
"""

import contextlib
import gzip
import io
import json
import os
import tempfile
import unittest
from datetime import date, datetime, timedelta

import pandas as pd

from emisiones import cliente


# Un registro con la forma REAL que devuelve el servidor, recortado a lo
# esencial. Las mediciones cuelgan de `datos`, la bandera va en un campo
# hermano, todo son cadenas y hay dos fechas distintas.
REGISTRO_REAL = {
    'estacion': 'CENTRO',
    'fecha': '01/09/2026',
    'hora': '00:10',
    'fechaHora': '2026-09-01T00:10:00',
    'datos': {
        'Monitor / Variable': '1',
        'Fecha': '1/9/2026 00:00:00',
        'O3': '0.018', 'O3_Flag': '1',
        'WS': '-9999', 'WS_Flag': '0',
        'WD': '-279', 'WD_Flag': '4',
        'Presión_atmosférica': '660.8886', 'Presión_atmosférica_Flag': '1',
        'Radiación_solar': '1.9777', 'Radiación_solar_Flag': '2',
        'Precipitación_pluvial': '0', 'Precipitación_pluvial_Flag': '1',
        'Índice_UV': '4', 'Índice_UV_Flag': '1',
        'PM2_5': '16', 'PM2_5_Flag': '1',
        'TempExt': '18.3378', 'TempExt_Flag': '1',
        'U': '',
    },
}


class FormaRealDeLaRespuesta(unittest.TestCase):
    def setUp(self):
        self.df = cliente.normalizar([REGISTRO_REAL])

    def test_una_fila_por_estacion_y_hora(self):
        self.assertEqual(len(self.df), 1)
        self.assertEqual(self.df.loc[0, 'STATION'], 'CEN')

    def test_manda_la_fecha_de_medicion_no_la_de_publicacion(self):
        """
        `fechaHora` es cuando la red publicó (:10) y `datos.Fecha` cuando se
        midió (:00). La buena es la de medición: apoyarse en la de publicación
        haría que un reenvío tardío aterrizara en la hora equivocada.
        """
        self.assertEqual(self.df.loc[0, 'DATE'], '2026-09-01')
        self.assertEqual(int(self.df.loc[0, 'HOUR']), 0)

    def test_las_fechas_son_dia_mes_ano(self):
        """Sin dayfirst, `1/9/2026` se leeria como 9 de enero."""
        self.assertEqual(self.df.loc[0, 'DATE'], '2026-09-01')

    def test_valores_en_cadena_se_convierten(self):
        self.assertAlmostEqual(self.df.loc[0, 'O3'], 0.018)
        self.assertAlmostEqual(self.df.loc[0, 'PM2.5'], 16.0)

    def test_bandera_hermana_descarta_el_valor(self):
        """
        WS trae -9999 con bandera 0 y WD trae -279 con bandera 4. Son averias
        del equipo, no mediciones: si pasaran, el validador promediaria basura.
        """
        self.assertTrue(pd.isna(self.df.loc[0, 'WS']))
        self.assertTrue(pd.isna(self.df.loc[0, 'WD']))

    def test_bandera_distinta_de_uno_descarta_aunque_el_valor_sea_creible(self):
        """Radiación 1.9777 es plausible, pero viene con bandera 2."""
        self.assertTrue(pd.isna(self.df.loc[0, 'RS']))

    def test_nombres_con_acento_y_guion_bajo(self):
        self.assertAlmostEqual(self.df.loc[0, 'ATM'], 660.8886)
        self.assertAlmostEqual(self.df.loc[0, 'PP'], 0.0)
        self.assertAlmostEqual(self.df.loc[0, 'UVI'], 4.0)
        self.assertAlmostEqual(self.df.loc[0, 'ET'], 18.3378)

    def test_estan_las_17_columnas_aunque_falten_en_la_respuesta(self):
        """El resto del sistema espera el formato BD completo."""
        for canal in cliente.CANALES_BD:
            self.assertIn(canal, self.df.columns)


class OtrasFormasDeRespuesta(unittest.TestCase):
    """
    La API no publica contrato, así que el parseo acepta cuatro formas. Estas
    pruebas fijan las otras tres para que añadir un alias no rompa las demás.
    """

    def test_forma_anidada_del_documento(self):
        df = cliente.normalizar([{
            'estacion': {'nombre': 'Miravalle'},
            'timestamp': {'fecha': '2026-09-01', 'hora': '10:00'},
            'variables': {
                'O3': {'valor': 0.041, 'unidad': 'ppm', 'bandera': 1},
                'SO2': {'valor': 0.02, 'unidad': 'ppm', 'bandera': 6},
            },
        }])
        self.assertEqual(df.loc[0, 'STATION'], 'MIR')
        self.assertAlmostEqual(df.loc[0, 'O3'], 0.041)
        self.assertTrue(pd.isna(df.loc[0, 'SO2']))

    def test_forma_larga_con_lista_de_mediciones(self):
        df = cliente.normalizar([{
            'estacion': {'nombre': 'Oblatos'},
            'timestamp': {'fecha': '2026-09-01', 'hora': '12:00'},
            'variables': [
                {'nombre': 'O3', 'valor': 0.03, 'bandera': 1},
                {'nombre': 'WD', 'valor': 350, 'bandera': 1},
            ],
        }])
        self.assertEqual(df.loc[0, 'STATION'], 'OBL')
        self.assertAlmostEqual(df.loc[0, 'O3'], 0.03)
        # 'nombre' dentro de una medicion es el parametro, no la estacion: si se
        # leyera como estacion, aqui saldria una llamada 'O3'.
        self.assertNotEqual(df.loc[0, 'STATION'], 'O3')

    def test_forma_larga_por_fila(self):
        df = cliente.normalizar([
            {'estacion': 'MIRAVALLE', 'fechaHora': '2026-09-01 10:00:00',
             'parametro': 'O3', 'valor': 0.041, 'bandera': 1},
            {'estacion': 'MIRAVALLE', 'fechaHora': '2026-09-01 10:00:00',
             'parametro': 'PM10', 'valor': 42, 'bandera': 1},
        ])
        self.assertEqual(len(df), 1, 'las dos mediciones son la misma hora')
        self.assertAlmostEqual(df.loc[0, 'O3'], 0.041)
        self.assertAlmostEqual(df.loc[0, 'PM10'], 42.0)

    def test_parametro_por_id_del_catalogo(self):
        """1 = O3 ... 17 = TempInt. El id es inequívoco; el nombre no."""
        df = cliente.normalizar([
            {'idEstacion': 'COUNTRY', 'fecha': '2026-09-01 11:00:00',
             'idParametro': 7, 'valor': 50, 'status': 1},
            {'idEstacion': 'COUNTRY', 'fecha': '2026-09-01 11:00:00',
             'idParametro': 11, 'valor': 24.5, 'status': 1},
        ])
        self.assertAlmostEqual(df.loc[0, 'PM10'], 50.0)
        self.assertAlmostEqual(df.loc[0, 'ET'], 24.5)

    def test_respuesta_irreconocible_falla_diciendo_que_llego(self):
        """
        Es la alternativa a devolver un DataFrame de puros huecos, que el
        validador procesaria tan campante dando un tablero en blanco.
        """
        # El cliente vuelca el registro crudo al log del servidor, que aqui solo
        # seria ruido entre los resultados de las pruebas.
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(cliente.ErrorEmisiones) as caso:
                cliente.normalizar([{'estacion': 'X', 'fecha': '2026-09-01 00:00',
                                     'zzz': 1, 'qqq': 2}])
        mensaje = str(caso.exception)
        self.assertIn('zzz', mensaje)
        self.assertIn('qqq', mensaje)

    def test_sin_registros_devuelve_dataframe_vacio_con_columnas(self):
        df = cliente.normalizar([])
        self.assertTrue(df.empty)
        self.assertIn('STATION', df.columns)


class CentinelasYAgregacion(unittest.TestCase):
    def test_centinela_del_datalogger_se_descarta(self):
        df = cliente.normalizar([{'estacion': 'CENTRO',
                                  'fechaHora': '2026-09-01T05:00:00',
                                  'O3': -9999, 'PM10': 42}])
        self.assertTrue(pd.isna(df.loc[0, 'O3']))
        self.assertAlmostEqual(df.loc[0, 'PM10'], 42.0)

    def test_varios_minutos_de_la_misma_hora_se_promedian(self):
        df = cliente.normalizar([
            {'estacion': 'CENTRO', 'fechaHora': '2026-09-01T10:00:00', 'O3': 0.041},
            {'estacion': 'CENTRO', 'fechaHora': '2026-09-01T10:30:00', 'O3': 0.061},
        ])
        self.assertEqual(len(df), 1)
        self.assertAlmostEqual(df.loc[0, 'O3'], 0.051)

    def test_la_direccion_del_viento_se_promedia_en_vectores(self):
        """
        El promedio aritmetico de 350 y 10 da 180: viento del sur, lo contrario
        del norte que sopla de verdad.
        """
        df = cliente.normalizar([
            {'estacion': 'CENTRO', 'fechaHora': '2026-09-01T10:00:00', 'WD': 350},
            {'estacion': 'CENTRO', 'fechaHora': '2026-09-01T10:30:00', 'WD': 10},
        ])
        self.assertAlmostEqual(float(df.loc[0, 'WD']) % 360, 0.0, places=6)


class RecorteDelRango(unittest.TestCase):
    """
    `startDate` tiene que ir a medianoche o la API ignora el rango y devuelve
    solo la primera hora del dia, con un 200 y filas validas. Por eso se pide de
    mas y se recorta despues; sin el recorte, pedir "del 5 desde las 12" traeria
    tambien la madrugada.
    """

    def setUp(self):
        self.df = pd.DataFrame([
            {'STATION': 'CEN', 'DATE': '2026-09-05', 'HOUR': h}
            for h in range(24)
        ])
        for canal in cliente.CANALES_BD:
            self.df[canal] = 1.0

    def test_recorta_por_los_dos_extremos(self):
        recortado = cliente._recortar(
            self.df, datetime(2026, 9, 5, 12), datetime(2026, 9, 5, 18))
        self.assertEqual(sorted(int(h) for h in recortado['HOUR']),
                         [12, 13, 14, 15, 16, 17])

    def test_el_final_es_excluyente(self):
        recortado = cliente._recortar(
            self.df, datetime(2026, 9, 5), datetime(2026, 9, 5, 1))
        self.assertEqual([int(h) for h in recortado['HOUR']], [0])


class TroceadoDelPeriodo(unittest.TestCase):
    """
    La API se degrada de forma cuadratica con el rango: 7 dias tardan 4.4 s y
    21 dias, 48.8 s. Por eso se trocea en bloques de una semana.
    """

    def test_dias_del_rango_con_final_excluyente(self):
        dias = cliente._dias_del_rango(datetime(2026, 9, 1), datetime(2026, 9, 4))
        self.assertEqual(dias, [date(2026, 9, 1), date(2026, 9, 2), date(2026, 9, 3)])

    def test_rango_dentro_del_mismo_dia_cuenta_ese_dia(self):
        dias = cliente._dias_del_rango(
            datetime(2026, 9, 1, 10), datetime(2026, 9, 1, 18))
        self.assertEqual(dias, [date(2026, 9, 1)])

    def test_bloques_de_como_mucho_siete_dias(self):
        dias = cliente._dias_del_rango(datetime(2026, 8, 17), datetime(2026, 9, 7))
        bloques = cliente._bloques(dias, 7)
        self.assertEqual(bloques, [
            (date(2026, 8, 17), date(2026, 8, 23)),
            (date(2026, 8, 24), date(2026, 8, 30)),
            (date(2026, 8, 31), date(2026, 9, 6)),
        ])

    def test_los_huecos_cortan_el_bloque(self):
        """
        Si faltan el 1, el 2 y el 10, son dos peticiones cortas y no una de diez
        dias que volveria a pedir lo que ya esta en cache.
        """
        bloques = cliente._bloques(
            [date(2026, 9, 1), date(2026, 9, 2), date(2026, 9, 10)], 7)
        self.assertEqual(bloques, [
            (date(2026, 9, 1), date(2026, 9, 2)),
            (date(2026, 9, 10), date(2026, 9, 10)),
        ])

    def test_sin_dias_no_hay_bloques(self):
        self.assertEqual(cliente._bloques([], 7), [])


class CacheDeDias(unittest.TestCase):
    """
    Una hora ya publicada no se reescribe, asi que un dia cerrado no hace falta
    volver a pedirlo. Es lo que hace que afinar los parametros de validacion
    sobre el mismo mes no repita la descarga.
    """

    def setUp(self):
        self.carpeta = tempfile.mkdtemp(prefix='prueba_cache_')
        self.peticiones = []
        self.original = cliente.consultar_minutales
        cliente.consultar_minutales = self._falso

    def tearDown(self):
        cliente.consultar_minutales = self.original
        for f in os.listdir(self.carpeta):
            os.remove(os.path.join(self.carpeta, f))
        os.rmdir(self.carpeta)

    def _falso(self, token, desde, hasta, sesion=None):
        """Transporte simulado: anota qué se pidió y devuelve una fila por hora."""
        self.peticiones.append((desde.date(), hasta.date()))
        registros = []
        momento = desde
        while momento < hasta:
            registros.append({
                'estacion': 'CENTRO',
                'fechaHora': momento.isoformat(),
                'datos': {'Fecha': momento.strftime('%d/%m/%Y %H:%M:%S'),
                          'O3': '0.02', 'O3_Flag': '1'},
            })
            momento += timedelta(hours=1)
        return registros

    def _descargar(self, desde, hasta):
        return cliente.descargar('tok', desde, hasta, carpeta_cache=self.carpeta)

    def test_la_segunda_pasada_no_toca_la_red(self):
        self._descargar(datetime(2026, 8, 17), datetime(2026, 9, 7))
        self.assertEqual(len(self.peticiones), 3, 'tres bloques de siete dias')

        self.peticiones.clear()
        df = self._descargar(datetime(2026, 8, 17), datetime(2026, 9, 7))
        self.assertEqual(self.peticiones, [], 'todo estaba en cache')
        self.assertEqual(len(df), 21 * 24)

    def test_ampliar_el_rango_solo_pide_lo_que_falta(self):
        self._descargar(datetime(2026, 8, 17), datetime(2026, 9, 7))
        self.peticiones.clear()

        self._descargar(datetime(2026, 8, 14), datetime(2026, 9, 7))
        self.assertEqual(self.peticiones, [(date(2026, 8, 14), date(2026, 8, 17))])

    def test_el_dia_de_hoy_no_se_cachea(self):
        """Hoy sigue creciendo: congelarlo dejaria la consulta clavada."""
        hoy = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        self._descargar(hoy, hoy + timedelta(hours=5))

        guardados = os.listdir(self.carpeta)
        self.assertNotIn(f'{hoy.date().isoformat()}.json.gz', guardados)

    def test_un_dia_cacheado_corrupto_se_vuelve_a_pedir(self):
        ayer = (datetime.now() - timedelta(days=2)).replace(
            hour=0, minute=0, second=0, microsecond=0)
        self._descargar(ayer, ayer + timedelta(days=1))
        self.peticiones.clear()

        ruta = cliente._ruta_cache(self.carpeta, ayer.date())
        with gzip.open(ruta, 'wt', encoding='utf-8') as fh:
            fh.write('{"esto no es')

        self._descargar(ayer, ayer + timedelta(days=1))
        self.assertEqual(len(self.peticiones), 1,
                         'un archivo ilegible se ignora y se vuelve a bajar')

    def test_no_deja_archivos_a_medias(self):
        self._descargar(datetime(2026, 8, 17), datetime(2026, 8, 20))
        sobrantes = [f for f in os.listdir(self.carpeta) if f.endswith('.parcial')]
        self.assertEqual(sobrantes, [])

    def test_sin_carpeta_de_cache_sigue_funcionando(self):
        df = cliente.descargar('tok', datetime(2026, 8, 17), datetime(2026, 8, 18))
        self.assertEqual(len(df), 24)


class Autenticacion(unittest.TestCase):
    def test_caducidad_leida_del_jwt(self):
        """
        Un JWT trae su `exp`. Leerlo permite avisar con la hora exacta en vez de
        dejar que la siguiente consulta falle con un 401 sin explicacion.
        """
        import base64
        carga = base64.urlsafe_b64encode(
            json.dumps({'exp': 1789408758}).encode()).decode().rstrip('=')
        token = f'cabecera.{carga}.firma'
        self.assertEqual(cliente._caducidad(token),
                         datetime.fromtimestamp(1789408758))

    def test_token_opaco_usa_la_vigencia_supuesta(self):
        antes = datetime.now()
        caduca = cliente._caducidad('esto-no-es-un-jwt')
        self.assertGreater(caduca, antes)
        # Un segundo de margen: entre `antes` y la llamada pasa un instante.
        self.assertLessEqual(caduca - antes,
                             cliente.VIGENCIA_SUPUESTA + timedelta(seconds=1))

    def test_credenciales_vacias_no_llegan_a_la_red(self):
        with self.assertRaises(cliente.CredencialesInvalidas):
            cliente.solicitar_token('', '')


class NormalizacionDeNombres(unittest.TestCase):
    def test_clave_ignora_acentos_mayusculas_y_separadores(self):
        for texto in ('Presión_atmosférica', 'presion atmosferica',
                      'PRESION-ATMOSFERICA', 'Presion.Atmosferica'):
            self.assertEqual(cliente._clave(texto), 'presionatmosferica')

    def test_abreviaturas_de_estacion(self):
        self.assertEqual(cliente._abreviatura('LAS AGUILAS'), 'AGU')
        self.assertEqual(cliente._abreviatura('Santa Margarita'), 'SMT')
        # La errata 'Counrty' viene de ENVISTA y tambien tiene que caer en COU.
        self.assertEqual(cliente._abreviatura('Counrty'), 'COU')

    def test_clave_corta_desconocida_se_respeta(self):
        """Inventarle una abreviatura a 'ZMG-012' lo haria irreconocible."""
        self.assertEqual(cliente._abreviatura('ZMG-012'), 'ZMG-012')


if __name__ == '__main__':
    unittest.main()
