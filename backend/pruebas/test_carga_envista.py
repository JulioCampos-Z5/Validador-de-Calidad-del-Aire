"""
La entrada de datos: del archivo de ENVISTA al formato BD.

Es la mitad del validador que nadie mira porque no tiene umbrales que discutir,
y es donde se pierden los datos en silencio. Un archivo mal leido no da error:
da un DataFrame vacio, o con las fechas cambiadas de mes, o con los numeros
convertidos en la bandera 'IO'. Las validaciones despues trabajan sin queja
sobre datos que ya estaban mal.

Todo lo de aqui se construye en una carpeta temporal. Ninguna prueba necesita
un Trs.xlsx de verdad ni deja nada en el disco de quien la ejecuta.
"""

import os
import shutil
import tempfile
import unittest

import pandas as pd

import app


# ---------------------------------------------------------------------------
# Archivos de ejemplo
#
# Los dos formatos que manda ENVISTA. Se escriben como CSV porque es lo que se
# puede leer al lado de la prueba: si alguien cambia el layout, aqui se ve.
# ---------------------------------------------------------------------------

ENVISTA_MULTIESTACION = [
    'Multiestacion Periodica:01-11-24 1:00 AM-30-11-24 12:00 AM Tipo:AVG 1 Hr.,,,',
    ',,,',
    ',Vallarta,Vallarta,Miravalle',
    'Fecha,O3,TempInt,O3',
    ',ppm,C,ppm',
    '01-11-24 1:00 AM,0.009,25.5,0.011',
    '01-11-24 2:00 AM,0.010,26.0,NoData',
]

ENVISTA_COMPACTO = [
    'Multiestacion:Vallarta Periodica:01-11-24 1:00 AM-30-11-24 12:00 AM Tipo:AVG 1 Hr.,,,',
    ',,,',
    'Fecha,O3,TempInt,PM10',
    ',ppm,%,ug/m3',
    '01-11-24 1:00 AM,0.009,25.5,45',
    '01-11-24 2:00 AM,0.010,26.0,48',
]


class ConCarpetaTemporal(unittest.TestCase):
    def setUp(self):
        self.carpeta = tempfile.mkdtemp(prefix='pruebas_envista_')
        self.addCleanup(shutil.rmtree, self.carpeta, True)

    def escribir_csv(self, nombre, lineas):
        ruta = os.path.join(self.carpeta, nombre)
        with open(ruta, 'w', encoding='utf-8', newline='') as f:
            f.write('\n'.join(lineas) + '\n')
        return ruta

    def ruta(self, nombre):
        return os.path.join(self.carpeta, nombre)


class NumerosEnEspanol(unittest.TestCase):
    """
    ENVISTA exporta con la configuracion regional del equipo. En es-MX el
    separador decimal es la coma, asi que "0,009" tiene que ser 0.009 y no un
    error de conversion que acabe marcado como 'IO'.
    """

    def test_la_coma_es_separador_decimal(self):
        self.assertEqual(app._intentar_float('0,009'), 0.009)

    def test_el_punto_sigue_valiendo(self):
        self.assertEqual(app._intentar_float('0.009'), 0.009)

    def test_los_espacios_alrededor_no_estorban(self):
        self.assertEqual(app._intentar_float('  12  '), 12.0)

    def test_con_punto_y_coma_la_coma_no_se_toca(self):
        """
        "1,234.5" es notacion inglesa con separador de millares: cambiar la
        coma por un punto daria 1.2345, un numero inventado. Mejor fallar y
        que el valor quede marcado.
        """
        with self.assertRaises(ValueError):
            app._intentar_float('1,234.5')

    def test_dos_comas_tampoco(self):
        with self.assertRaises(ValueError):
            app._intentar_float('1,234,5')


class BanderasDeEnvista(unittest.TestCase):
    """
    `mapear_bandera_envista` devuelve None cuando el valor es un numero: ese
    None es la senal de "esto es un dato, no una bandera". Confundirlo es
    perder la medicion.
    """

    def test_una_bandera_conocida_se_traduce(self):
        self.assertEqual(app.mapear_bandera_envista('NoData'), 'ND')
        self.assertEqual(app.mapear_bandera_envista('Zero'), 'IC')
        self.assertEqual(app.mapear_bandera_envista('Alarm'), 'IF')

    def test_las_variantes_de_invalido_que_escribe_el_script(self):
        """
        'InvId' lleva i mayuscula y 'Invld' lleva ele. Son la misma bandera
        escrita de dos maneras y ninguna de las dos puede quedarse fuera.
        """
        for escrito in ('InvId', 'Invld', 'InvLd', 'Invalid'):
            self.assertEqual(app.mapear_bandera_envista(escrito), 'IO', escrito)

    def test_fuera_de_rango_con_y_sin_espacio(self):
        for escrito in ('Above R', 'AboveR', 'Above_R', 'Below R', 'BelowR'):
            self.assertEqual(app.mapear_bandera_envista(escrito), 'IR', escrito)

    def test_un_numero_no_es_bandera(self):
        self.assertIsNone(app.mapear_bandera_envista('0.009'))
        self.assertIsNone(app.mapear_bandera_envista('0,009'))
        self.assertIsNone(app.mapear_bandera_envista(45))

    def test_el_hueco_es_sin_dato(self):
        self.assertEqual(app.mapear_bandera_envista(''), 'ND')
        self.assertEqual(app.mapear_bandera_envista('   '), 'ND')
        self.assertIsNone(app.mapear_bandera_envista(float('nan')))

    def test_texto_desconocido_se_invalida_por_operador(self):
        """
        Lo que no es numero ni bandera conocida no se puede dar por bueno.
        Queda como 'IO' para que alguien lo mire, no como dato.
        """
        self.assertEqual(app.mapear_bandera_envista('???'), 'IO')

    def test_una_bandera_dentro_de_un_texto_mas_largo(self):
        self.assertEqual(app.mapear_bandera_envista('Below R (5)'), 'IR')


class FormatoDelArchivo(ConCarpetaTemporal):
    """
    De esto depende que un archivo ya validado no vuelva a pasar por la
    normalizacion de ENVISTA, que lo dejaria vacio.
    """

    def test_un_csv_con_station_y_date_es_bd_procesado(self):
        ruta = self.escribir_csv('bd.csv', [
            'STATION,DATE,HOUR,O3',
            'VAL,2024-11-01,1,0.009',
        ])
        self.assertEqual(app.detectar_formato_archivo(ruta), ('bd_procesado', None))

    def test_las_columnas_se_comparan_sin_importar_mayusculas(self):
        ruta = self.escribir_csv('bd_minusculas.csv', [
            'station,date,hour,o3',
            'VAL,2024-11-01,1,0.009',
        ])
        formato, _ = app.detectar_formato_archivo(ruta)
        self.assertEqual(formato, 'bd_procesado')

    def test_un_csv_de_envista_es_crudo(self):
        ruta = self.escribir_csv('trs.csv', ENVISTA_MULTIESTACION)
        self.assertEqual(app.detectar_formato_archivo(ruta), ('envista_raw', None))

    def test_un_excel_con_hoja_data_es_bd_procesado(self):
        ruta = self.ruta('salida.xlsx')
        pd.DataFrame({'STATION': ['VAL'], 'DATE': ['2024-11-01']}).to_excel(
            ruta, sheet_name='Data', index=False)
        self.assertEqual(app.detectar_formato_archivo(ruta), ('bd_procesado', 'Data'))

    def test_tambien_vale_el_nombre_antiguo_de_la_hoja(self):
        """Los archivos de antes traen 'Datos_Validados' y siguen abriendose."""
        ruta = self.ruta('antiguo.xlsx')
        pd.DataFrame({'STATION': ['VAL'], 'DATE': ['2024-11-01']}).to_excel(
            ruta, sheet_name='Datos_Validados', index=False)
        self.assertEqual(app.detectar_formato_archivo(ruta),
                         ('bd_procesado', 'Datos_Validados'))

    def test_un_excel_sin_esas_hojas_se_trata_como_crudo(self):
        ruta = self.ruta('otro.xlsx')
        pd.DataFrame({'a': [1]}).to_excel(ruta, sheet_name='Hoja1', index=False)
        self.assertEqual(app.detectar_formato_archivo(ruta), ('envista_raw', None))

    def test_un_archivo_ilegible_no_revienta(self):
        """
        Peor que adivinar mal es caerse: el flujo de ENVISTA da un mensaje de
        error entendible, la excepcion aqui daria un 500.
        """
        self.assertEqual(app.detectar_formato_archivo(self.ruta('no_existe.xlsx')),
                         ('envista_raw', None))


class ArchivoYaProcesado(ConCarpetaTemporal):
    def test_se_completan_las_columnas_que_faltan_y_en_orden(self):
        ruta = self.escribir_csv('bd.csv', [
            'STATION,DATE,HOUR,O3',
            'VAL,2024-11-01,1,0.009',
        ])
        df = app.cargar_archivo_procesado(ruta, None)

        self.assertEqual(list(df.columns), app.COLUMNAS_BD)
        self.assertTrue(df['PM10'].isna().all())

    def test_la_hora_queda_entera(self):
        """
        Llega como texto o como float segun quien escribiera el archivo, y
        `HOUR` se usa para ordenar series: un 1.0 y un 1 no se agrupan igual.
        """
        ruta = self.escribir_csv('bd.csv', [
            'STATION,DATE,HOUR,O3',
            'VAL,2024-11-01,1.0,0.009',
            'VAL,2024-11-01,,0.010',
        ])
        df = app.cargar_archivo_procesado(ruta, None)

        self.assertEqual(df['HOUR'].tolist(), [1, 0])
        self.assertEqual(df['HOUR'].dtype.kind, 'i')

    def test_la_fecha_se_normaliza_a_iso(self):
        ruta = self.escribir_csv('bd.csv', [
            'STATION,DATE,HOUR,O3',
            'VAL,2024-11-01 00:00:00,1,0.009',
        ])
        df = app.cargar_archivo_procesado(ruta, None)
        self.assertEqual(df['DATE'].iloc[0], '2024-11-01')

    def test_las_filas_sin_estacion_o_sin_fecha_se_van(self):
        """Una fila sin identificar no se puede validar ni contar."""
        ruta = self.escribir_csv('bd.csv', [
            'STATION,DATE,HOUR,O3',
            'VAL,2024-11-01,1,0.009',
            ',2024-11-01,2,0.010',
            'VAL,,3,0.011',
        ])
        df = app.cargar_archivo_procesado(ruta, None)
        self.assertEqual(len(df), 1)

    def test_desde_una_hoja_de_excel_con_nombre(self):
        ruta = self.ruta('salida.xlsx')
        with pd.ExcelWriter(ruta, engine='openpyxl') as w:
            pd.DataFrame({'a': [1]}).to_excel(w, sheet_name='Otra', index=False)
            pd.DataFrame({
                'STATION': ['VAL'], 'DATE': ['2024-11-01'], 'HOUR': [1],
                'O3': [0.009],
            }).to_excel(w, sheet_name='Data', index=False)

        df = app.cargar_archivo_procesado(ruta, 'Data')
        self.assertEqual(df['STATION'].tolist(), ['VAL'])
        self.assertEqual(df['O3'].iloc[0], 0.009)


class LecturaDeEnvista(ConCarpetaTemporal):
    def test_layout_multiestacion(self):
        """
        Fila 2 estaciones, fila 3 parametros, fila 4 unidades, datos desde la
        5. Las columnas salen como 'Estacion_Parametro'.
        """
        ruta = self.escribir_csv('trs.csv', ENVISTA_MULTIESTACION)
        df = app.cargar_y_procesar_envista(ruta)

        self.assertEqual(list(df.columns),
                         ['DateTime', 'Vallarta_O3', 'Vallarta_TempInt', 'Miravalle_O3'])
        self.assertEqual(len(df), 2)

    def test_layout_compacto_de_una_estacion(self):
        """
        Aqui la estacion no aparece en ninguna fila de encabezado: esta metida
        en el titulo, detras del primer ':' y antes de la palabra 'Periodica'.
        Si no se saca de ahi, el archivo entero se procesa como 'UNK'.
        """
        ruta = self.escribir_csv('trs_compacto.csv', ENVISTA_COMPACTO)
        df = app.cargar_y_procesar_envista(ruta)

        self.assertEqual(list(df.columns),
                         ['DateTime', 'Vallarta_O3', 'Vallarta_TempInt', 'Vallarta_PM10'])
        self.assertEqual(len(df), 2)

    def test_la_fecha_es_dia_mes_anio(self):
        """
        La que estropea meses enteros sin decir nada: "01-11-24" es el 1 de
        noviembre, no el 11 de enero. Leido al reves aparecen datos en meses
        en los que la estacion no midio nada, y faltan donde si midio.
        """
        ruta = self.escribir_csv('trs.csv', ENVISTA_MULTIESTACION)
        df = app.cargar_y_procesar_envista(ruta)

        primera = df['DateTime'].iloc[0]
        self.assertEqual((primera.year, primera.month, primera.day), (2024, 11, 1))
        self.assertEqual(primera.hour, 1)

    def test_la_tarde_se_distingue_de_la_manana(self):
        """Sin el %p, las 2:00 PM se guardan como las 2 de la madrugada."""
        ruta = self.escribir_csv('trs.csv', ENVISTA_MULTIESTACION[:5] + [
            '01-11-24 2:00 PM,0.009,25.5,0.011',
        ])
        df = app.cargar_y_procesar_envista(ruta)
        self.assertEqual(df['DateTime'].iloc[0].hour, 14)

    def test_las_filas_con_fecha_ilegible_se_descartan(self):
        ruta = self.escribir_csv('trs.csv', ENVISTA_MULTIESTACION + [
            'basura,0.009,25.5,0.011',
        ])
        df = app.cargar_y_procesar_envista(ruta)
        self.assertEqual(len(df), 2)

    def test_un_archivo_que_no_existe_devuelve_none(self):
        """
        `None` es lo que el endpoint traduce en "no se pudieron cargar los
        datos"; una excepcion aqui seria un 500 sin explicacion.
        """
        self.assertIsNone(app.cargar_y_procesar_envista(self.ruta('no_existe.csv')))


class AbreviaturaDeEstacion(unittest.TestCase):
    def test_tres_letras_de_lo_alfanumerico(self):
        self.assertEqual(app._abreviar_estacion('Zapopan Norte'), 'ZAP')
        self.assertEqual(app._abreviar_estacion('el paso'), 'ELP')

    def test_un_nombre_sin_letras_ni_numeros_cae_en_unk(self):
        self.assertEqual(app._abreviar_estacion('---'), 'UNK')
        self.assertEqual(app._abreviar_estacion(''), 'UNK')


class ConversionAFormatoBase(ConCarpetaTemporal):
    def test_estaciones_conocidas_con_su_abreviatura(self):
        ruta = self.escribir_csv('trs.csv', ENVISTA_MULTIESTACION)
        df = app.convertir_a_formato_base(app.cargar_y_procesar_envista(ruta))

        self.assertEqual(sorted(df['STATION'].unique()), ['MIR', 'VAL'])

    def test_columnas_y_orden_del_formato_bd(self):
        ruta = self.escribir_csv('trs.csv', ENVISTA_MULTIESTACION)
        df = app.convertir_a_formato_base(app.cargar_y_procesar_envista(ruta))

        self.assertEqual(list(df.columns), app.COLUMNAS_BD)
        self.assertEqual(df[['STATION', 'DATE', 'HOUR']].values.tolist(),
                         [['MIR', '2024-11-01', 1], ['MIR', '2024-11-01', 2],
                          ['VAL', '2024-11-01', 1], ['VAL', '2024-11-01', 2]])

    def test_los_parametros_de_envista_se_renombran(self):
        """'TempInt' es 'IT' en el formato BD; sin el mapeo, la columna se pierde."""
        ruta = self.escribir_csv('trs.csv', ENVISTA_MULTIESTACION)
        df = app.convertir_a_formato_base(app.cargar_y_procesar_envista(ruta))

        val = df[df['STATION'] == 'VAL'].reset_index(drop=True)
        self.assertEqual(val['IT'].iloc[0], 25.5)
        self.assertEqual(val['O3'].iloc[0], 0.009)

    def test_una_bandera_llega_como_bandera_y_no_como_texto_suelto(self):
        ruta = self.escribir_csv('trs.csv', ENVISTA_MULTIESTACION)
        df = app.convertir_a_formato_base(app.cargar_y_procesar_envista(ruta))

        mir = df[df['STATION'] == 'MIR'].reset_index(drop=True)
        self.assertEqual(mir['O3'].iloc[1], 'ND')

    def test_una_estacion_que_no_esta_en_el_mapeo_recibe_tres_letras(self):
        """
        El mapeo lista las estaciones de hoy. Si manana se instala una nueva,
        el archivo tiene que procesarse igual en vez de quedarse fuera.
        """
        crudo = pd.DataFrame({
            'DateTime': pd.to_datetime(['2024-11-01 01:00']),
            'Zapopan Norte_O3': ['0.009'],
        })
        df = app.convertir_a_formato_base(crudo)
        self.assertEqual(df['STATION'].tolist(), ['ZAP'])

    def test_sin_prefijo_de_estacion_todo_es_unk(self):
        crudo = pd.DataFrame({
            'DateTime': pd.to_datetime(['2024-11-01 01:00']),
            'O3': ['0.009'],
            'PM10': ['45'],
        })
        df = app.convertir_a_formato_base(crudo)

        self.assertEqual(df['STATION'].tolist(), ['UNK'])
        self.assertEqual(df['PM10'].iloc[0], 45.0)

    def test_una_hora_sin_un_solo_dato_no_ocupa_fila(self):
        """
        Con varias estaciones en el mismo archivo, cada hora genera una fila
        por estacion aunque esa estacion no midiera. Las vacias sobran: son
        huecos falsos que luego se cuentan como 'SE'.
        """
        crudo = pd.DataFrame({
            'DateTime': pd.to_datetime(['2024-11-01 01:00', '2024-11-01 02:00']),
            'Vallarta_O3': ['0.009', ''],
        })
        df = app.convertir_a_formato_base(crudo)
        self.assertEqual(len(df), 1)

    def test_sin_columnas_de_parametros_devuelve_vacio(self):
        crudo = pd.DataFrame({'DateTime': pd.to_datetime(['2024-11-01 01:00'])})
        self.assertTrue(app.convertir_a_formato_base(crudo).empty)

    def test_una_columna_que_no_es_del_formato_bd_se_ignora(self):
        crudo = pd.DataFrame({
            'DateTime': pd.to_datetime(['2024-11-01 01:00']),
            'Vallarta_O3': ['0.009'],
            'Vallarta_Bateria': ['12.4'],
        })
        df = app.convertir_a_formato_base(crudo)

        self.assertEqual(list(df.columns), app.COLUMNAS_BD)
        self.assertNotIn('Bateria', df.columns)


class ColumnasBienTipadas(unittest.TestCase):
    """
    Las validaciones escriben la bandera encima del numero, en la misma
    columna. Cuando los datos vienen limpios --los minutales del SIMAJ, por
    ejemplo-- la columna es float64 y pandas 3 rechaza escribir 'IR' ahi.
    Con archivos de ENVISTA no se notaba porque esas columnas ya vienen
    mezcladas con texto.
    """

    def test_una_columna_float_admite_la_bandera(self):
        df = pd.DataFrame({
            'STATION': ['VAL'] * 3,
            'DATE': ['2024-11-01'] * 3,
            'HOUR': [1, 2, 3],
            'PM10': [10.0, 20.0, 5000.0],
        })
        self.assertEqual(df['PM10'].dtype.kind, 'f')

        validado = app.validar_datos_completo(df, {'series': False})
        self.assertEqual(validado['PM10'].iloc[2], 'IR')


class ResumenDeLaValidacion(unittest.TestCase):
    def df_validado(self):
        return pd.DataFrame({
            'STATION': ['VAL', 'VAL', 'MIR'],
            'DATE': ['2024-11-01'] * 3,
            'HOUR': [1, 2, 1],
            'O3': [0.009, 'IR', 'ND'],
            'PM10': [45.0, 48.0, 'IR'],
        })

    def test_cuenta_las_banderas_de_todo_el_archivo(self):
        resumen, _, _, _ = app.crear_resumen_validacion(self.df_validado())

        self.assertEqual(resumen.loc['IR', 'Cantidad'], 2)
        self.assertEqual(resumen.loc['ND', 'Cantidad'], 1)
        self.assertEqual(resumen.loc['IR', 'Descripción'], app.BANDERAS['IR'])

    def test_sin_banderas_el_resumen_lo_dice_en_vez_de_quedarse_vacio(self):
        """Una tabla vacia en el Excel parece un fallo de exportacion."""
        limpio = pd.DataFrame({
            'STATION': ['VAL'], 'DATE': ['2024-11-01'], 'HOUR': [1], 'O3': [0.009],
        })
        resumen, _, _, _ = app.crear_resumen_validacion(limpio)

        self.assertEqual(resumen['Cantidad'].iloc[0], 0)

    def test_el_detalle_separa_por_estacion_y_contaminante(self):
        _, detalle, _, _ = app.crear_resumen_validacion(self.df_validado())

        filas = {(f['Estación'], f['Contaminante'], f['Bandera'])
                 for f in detalle.to_dict(orient='records')}
        self.assertIn(('VAL', 'O3', 'IR'), filas)
        self.assertIn(('MIR', 'PM10', 'IR'), filas)
        self.assertNotIn(('MIR', 'O3', 'IR'), filas)

    def test_las_estadisticas_generales(self):
        _, _, estadisticas, _ = app.crear_resumen_validacion(self.df_validado())

        self.assertEqual(estadisticas.loc['Total_Registros', 'Cantidad'], 3)
        self.assertEqual(estadisticas.loc['Estaciones', 'Cantidad'], 2)
        # Tres numeros: dos de PM10 y uno de O3. Las banderas no cuentan.
        self.assertEqual(estadisticas.loc['Valores_Válidos', 'Cantidad'], 3)

    def test_las_estadisticas_por_contaminante_ignoran_las_banderas(self):
        _, _, _, detalladas = app.crear_resumen_validacion(self.df_validado())

        pm10_val = [f for f in detalladas.to_dict(orient='records')
                    if f['Contaminante'] == 'PM10' and f['Estación'] == 'VAL'][0]
        self.assertEqual(pm10_val['Valores válidos'], 2)
        self.assertEqual(pm10_val['Mínimo'], 45.0)
        self.assertEqual(pm10_val['Máximo'], 48.0)


class Exportacion(ConCarpetaTemporal):
    def test_el_excel_lleva_todas_las_hojas(self):
        """
        El archivo que se descarga es el entregable. Si falta una hoja, quien
        lo recibe no tiene como saber que validaciones se aplicaron.
        """
        df = pd.DataFrame({
            'STATION': ['VAL', 'VAL'],
            'DATE': ['2024-11-01'] * 2,
            'HOUR': [1, 2],
            'O3': [0.009123, 'IR'],
            'PM10': [45.6, 48.2],
        })
        salida = self.ruta('BD_2024.xlsx')
        resumen, estadisticas = app.exportar_resultados(df, salida)

        self.assertIsNotNone(resumen)
        with pd.ExcelFile(salida) as xl:
            hojas = set(xl.sheet_names)
        self.assertTrue({'Data', 'Resumen_Banderas_Global',
                         'Resumen_Banderas_Detallado'}.issubset(hojas))
        self.assertEqual(len(hojas), 6)

    def test_los_decimales_son_los_del_script(self):
        df = pd.DataFrame({
            'STATION': ['VAL'], 'DATE': ['2024-11-01'], 'HOUR': [1],
            'O3': [0.0091234], 'PM10': [45.6], 'CO': [1.23456],
        })
        salida = self.ruta('BD_2024.xlsx')
        app.exportar_resultados(df, salida)

        data = pd.read_excel(salida, sheet_name='Data')
        self.assertEqual(data['O3'].iloc[0], 0.009)   # 3 decimales
        self.assertEqual(data['PM10'].iloc[0], 46)    # entero
        self.assertEqual(data['CO'].iloc[0], 1.23)    # 2 decimales

    def test_un_destino_imposible_no_tumba_la_validacion(self):
        """
        El resto de la respuesta --resumenes, vista previa-- sirve aunque el
        archivo no se haya podido escribir.
        """
        df = pd.DataFrame({
            'STATION': ['VAL'], 'DATE': ['2024-11-01'], 'HOUR': [1], 'O3': [0.009],
        })
        resumen, estadisticas = app.exportar_resultados(
            df, os.path.join(self.carpeta, 'no', 'existe', 'x.xlsx'))

        self.assertIsNone(resumen)
        self.assertIsNone(estadisticas)


class ExtensionesPermitidas(unittest.TestCase):
    def test_las_tres_que_manda_envista(self):
        for nombre in ('Trs.xlsx', 'Trs.xls', 'Trs.csv'):
            self.assertTrue(app.allowed_file(nombre), nombre)

    def test_la_extension_no_distingue_mayusculas(self):
        self.assertTrue(app.allowed_file('TRS.XLSX'))

    def test_lo_demas_no_entra(self):
        for nombre in ('script.py', 'datos.txt', 'sin_extension', '.xlsx.exe'):
            self.assertFalse(app.allowed_file(nombre), nombre)


if __name__ == '__main__':
    unittest.main()
