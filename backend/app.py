"""
API REST para el Sistema de Validación de Datos de Calidad del Aire

Este módulo contiene toda la lógica de validación integrada directamente.
No depende de archivos externos.
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename
import os
import tempfile
from datetime import datetime
import pandas as pd
import numpy as np
import warnings

warnings.filterwarnings('ignore')

app = Flask(__name__)
CORS(app)

# Integracion con los minutales del SIMAJ (blueprint aparte, ver minutales/).
from minutales.rutas import bp as bp_minutales
app.register_blueprint(bp_minutales)

# Configuración
UPLOAD_FOLDER = tempfile.mkdtemp()
ALLOWED_EXTENSIONS = {'xlsx', 'xls', 'csv'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max


# ============================================================================
# CONFIGURACIÓN DEL VALIDADOR (todo integrado aquí)
# ============================================================================

# Mapeo de estaciones (nombres completos a abreviaturas)
MAPEO_ESTACIONES = {
    'Atemajac': 'ATM',
    'Counrty': 'COU',
    'Estación Centro': 'CEN',
    'Las Aguilas': 'AGU',
    'Las Pintas': 'PIN',
    'Loma Dorada': 'LDO',
    'Miravalle': 'MIR',
    'Oblatos': 'OBL',
    'Santa Anita': 'SAN',
    'Santa Fe': 'SFE',
    'Santa Margarita': 'SMT',
    'Tlaquepaque': 'TLA',
    'Vallarta': 'VAL'
}

# Mapeo de parámetros ENVISTA a formato BASE
MAPEO_PARAMETROS = {
    'TempInt': 'IT',
    'TempExt': 'ET',
    'Radiación': 'RS',
    'Radidacion': 'RS',
    'IUV': 'UVI',
    'PRECIP': 'PP',
    'Presion': 'ATM',
    'O3': 'O3', 'NO': 'NO', 'NO2': 'NO2', 'NOX': 'NOX',
    'SO2': 'SO2', 'CO': 'CO', 'PM10': 'PM10', 'PM2.5': 'PM2.5',
    'RH': 'RH', 'WS': 'WS', 'WD': 'WD'
}

# Decimales según especificaciones
DECIMALES = {
    'O3': 3, 'NO': 3, 'NO2': 3, 'NOX': 3, 'SO2': 3, 'CO': 2,
    'PM10': 0, 'PM2.5': 0, 'IT': 2, 'ET': 2, 'RH': 1,
    'WS': 1, 'WD': 1, 'PP': 2, 'ATM': 1, 'RS': 1, 'UVI': 2
}

# Rangos de validación
RANGOS = {
    'O3': {'min': -0.003, 'max': 0.500, 'limite_deteccion': 0.001},
    'SO2': {'min': -0.003, 'max': 0.500, 'limite_deteccion': 0.001},
    'NO2': {'min': -0.003, 'max': 0.500, 'limite_deteccion': 0.001},
    'NO': {'min': -0.003, 'max': 0.500, 'limite_deteccion': 0.001},
    'NOX': {'min': -0.006, 'max': 0.500, 'limite_deteccion': 0.006},
    'CO': {'min': -0.04, 'max': 50, 'limite_deteccion': 0.04},
    'PM10': {'min': 0, 'max': 900},
    'PM2.5': {'min': 0, 'max': 900},
    'ET': {'min': -5, 'max': 50},
    'IT': {'min': 0, 'max': 50},
    'RH': {'min': 0, 'max': 100},
    'WS': {'min': 0, 'max': 50},
    'WD': {'min': 0, 'max': 360},
    'PP': {'min': 0, 'max': 10},
    'ATM': {'min': 500, 'max': 760},
    'RS': {'min': 0, 'max': 2000},
    'UVI': {'min': 0, 'max': 300}
}

# Banderas de validación
BANDERAS = {
    'IF': 'Inválido por falla en el equipo',
    'IO': 'Inválido por operador',
    'IR': 'Inválido por rango de operación',
    'ND': 'Sin dato (No Data)',
    'VE': 'Valor Extraordinario',
    'SE': 'Sin Equipo',
    'NE': 'No existía la estación de monitoreo',
    'IC': 'Inválido por calibración',
    'VZ': 'Válido igualado al límite de detección',
    'DS': 'Dato sospechoso'
}

# Mapeo de banderas ENVISTA
MAPEO_BANDERAS_ENVISTA = {
    'NoData': 'ND', 'InvId': 'IO', 'Zero': 'IC', 'Span': 'IC',
    'OutCal': 'IC', 'Alarm': 'IF', 'WarmUp': 'IF', 'Maintain': 'IF',
    'Above R': 'IR', 'Below R': 'IR', 'Calm': 'IO', '<Samp': 'IO',
    'OffScan': 'IO', 'NoData ': 'ND', 'OffScan ': 'IO',
    'Above_R': 'IR', 'Below_R': 'IR', '': 'ND', ' ': 'ND',
    'nan': 'ND', 'NaN': 'ND', 'NULL': 'ND', 'null': 'ND'
}

# Columnas del formato BD
COLUMNAS_BD = [
    'STATION', 'DATE', 'HOUR', 'O3', 'NO', 'NO2', 'NOX', 'SO2', 'CO',
    'PM10', 'PM2.5', 'IT', 'ET', 'RH', 'WS', 'WD', 'PP', 'ATM', 'RS', 'UVI'
]


# ============================================================================
# FUNCIONES DE VALIDACIÓN
# ============================================================================

def _intentar_float(valor_str):
    """Convertir un string a float aceptando coma como separador decimal (es-MX)."""
    s = valor_str.strip()
    # Decimal español: "0,009" -> "0.009" (solo si hay una sola coma y ningún punto)
    if s.count(',') == 1 and '.' not in s:
        s = s.replace(',', '.')
    return float(s)


def mapear_bandera_envista(valor):
    """Mapear una bandera de ENVISTA a formato estándar"""
    if pd.isna(valor):
        return None
    
    valor_str = str(valor).strip()
    
    if valor_str in MAPEO_BANDERAS_ENVISTA:
        return MAPEO_BANDERAS_ENVISTA[valor_str]
    
    for bandera_envista, bandera_std in MAPEO_BANDERAS_ENVISTA.items():
        if bandera_envista and bandera_envista.lower() in valor_str.lower():
            return bandera_std
    
    try:
        _intentar_float(valor_str)
        return None
    except (ValueError, TypeError):
        return 'IO'


def detectar_formato_archivo(filepath):
    """Detectar si el archivo es Envista crudo o un BD ya procesado.

    Retorna 'bd_procesado' si:
      - .xlsx/.xls: existe hoja 'Data' o 'Datos_Validados'.
      - .csv: las columnas incluyen STATION y DATE.
    En cualquier otro caso retorna 'envista_raw'.
    """
    ext = os.path.splitext(filepath)[1].lower()
    try:
        if ext == '.csv':
            try:
                df_head = pd.read_csv(filepath, nrows=1)
                cols_upper = {str(c).strip().upper() for c in df_head.columns}
                if 'STATION' in cols_upper and 'DATE' in cols_upper:
                    return 'bd_procesado', None
            except Exception:
                pass
            return 'envista_raw', None

        xl = pd.ExcelFile(filepath)
        sheets_lower = {s.lower(): s for s in xl.sheet_names}
        if 'data' in sheets_lower or 'datos_validados' in sheets_lower:
            return 'bd_procesado', sheets_lower.get('data') or sheets_lower.get('datos_validados')
        return 'envista_raw', None
    except Exception:
        return 'envista_raw', None


def cargar_archivo_procesado(filepath, sheet_name):
    """Cargar datos desde un archivo ya procesado (hoja Data o Datos_Validados, o CSV BD).

    Devuelve un DataFrame en formato BD (STATION, DATE, HOUR, ...) listo
    para pasar por validar_datos_completo.
    """
    ext = os.path.splitext(filepath)[1].lower()
    if ext == '.csv':
        df = pd.read_csv(filepath)
    else:
        df = pd.read_excel(filepath, sheet_name=sheet_name)

    if 'DATE' in df.columns:
        df['DATE'] = pd.to_datetime(df['DATE'], errors='coerce').dt.strftime('%Y-%m-%d')
    if 'HOUR' in df.columns:
        df['HOUR'] = pd.to_numeric(df['HOUR'], errors='coerce').fillna(0).astype(int)

    for col in COLUMNAS_BD:
        if col not in df.columns:
            df[col] = None
    df = df[[c for c in COLUMNAS_BD if c in df.columns]]

    df = df.dropna(subset=['STATION', 'DATE']).reset_index(drop=True)
    return df


def cargar_y_procesar_envista(archivo_trs):
    """Cargar y procesar datos desde Trs.xlsx o .csv (formato ENVISTA).

    Acepta archivos con una o varias estaciones. Las estaciones se descubren
    dinámicamente desde la fila 2 (encabezado de estación).
    """
    try:
        ext = os.path.splitext(archivo_trs)[1].lower()
        if ext == '.csv':
            df_raw = pd.read_csv(
                archivo_trs, header=None, dtype=str, keep_default_na=False
            )
        else:
            df_raw = pd.read_excel(archivo_trs, sheet_name=0, header=None)

        # Detectar layout:
        #  - Multi-estación: fila 2 = estaciones, fila 3 = parámetros, fila 4 = unidades, datos desde fila 5.
        #  - Compacto 1 estación: fila 0 = título, fila 2 = parámetros, fila 3 = unidades, datos desde fila 4.
        UNIDADES_CONOCIDAS = {
            'ppm', 'ppb', 'µg/m3', 'ug/m3', 'μg/m3', '°c', 'oc', '%',
            'm/s', 'mm', 'w/m2', 'mb', 'mbar', 'mmhg', 'deg', 'grados',
            'index', 'hpa'
        }

        def _es_fila_unidades(serie):
            vals = [str(v).strip().lower() for v in serie.values[1:] if pd.notna(v) and str(v).strip() != '']
            if not vals:
                return False
            coincidencias = sum(1 for v in vals if v in UNIDADES_CONOCIDAS)
            return coincidencias >= max(2, len(vals) // 2)

        layout_compacto = _es_fila_unidades(df_raw.iloc[3, :])

        if layout_compacto:
            # Una sola estación: extraer su nombre del título (fila 0).
            # Ejemplo: "Multiestación:Vallarta Periódica:01-04-26 1:00 AM-... Tipo:AVG 1 Hr."
            titulo = str(df_raw.iloc[0, 0]) if pd.notna(df_raw.iloc[0, 0]) else ''
            estacion_nombre = ''
            if ':' in titulo:
                partes = titulo.split(':')
                if len(partes) >= 2:
                    estacion_nombre = partes[1].strip()
                    for suf in (' Periódica', ' Periodica'):
                        if estacion_nombre.lower().endswith(suf.lower()):
                            estacion_nombre = estacion_nombre[: -len(suf)].strip()

            mapeo_lower = {k.lower(): k for k in MAPEO_ESTACIONES}
            estacion_match = mapeo_lower.get(estacion_nombre.lower(), estacion_nombre)

            parametros = df_raw.iloc[2, :].values
            nuevas_columnas = ['DateTime']
            for i in range(1, len(parametros)):
                par = parametros[i]
                par_ok = pd.notna(par) and str(par).strip() != ''
                if par_ok and estacion_match:
                    nuevas_columnas.append(f"{estacion_match}_{str(par).strip()}")
                elif par_ok:
                    nuevas_columnas.append(str(par).strip())
                else:
                    nuevas_columnas.append(f"Col_{i}")
            data_start = 4
        else:
            estaciones = df_raw.iloc[2, :].values
            parametros = df_raw.iloc[3, :].values
            nuevas_columnas = ['DateTime']
            for i in range(1, len(estaciones)):
                est = estaciones[i]
                par = parametros[i]
                est_ok = pd.notna(est) and str(est).strip() != ''
                par_ok = pd.notna(par) and str(par).strip() != ''
                if est_ok and par_ok:
                    nuevas_columnas.append(f"{str(est).strip()}_{str(par).strip()}")
                elif par_ok:
                    nuevas_columnas.append(str(par).strip())
                else:
                    nuevas_columnas.append(f"Col_{i}")
            data_start = 5

        df_datos = df_raw.iloc[data_start:, :len(nuevas_columnas)].copy()
        df_datos.columns = nuevas_columnas
        df_datos = df_datos.reset_index(drop=True)
        
        # Parseo con formato explícito de Envista: DD-MM-YY h:MM AM/PM (ej. "01-11-24 1:00 AM")
        # Reason: pd.to_datetime sin formato interpreta "01-11-24" como MM-DD-YY (11 enero)
        # en vez de DD-MM-YY (1 noviembre), generando "picos" en meses inexistentes.
        raw_dates = df_datos['DateTime'].copy()
        df_datos['DateTime'] = pd.to_datetime(
            raw_dates, format='%d-%m-%y %I:%M %p', errors='coerce'
        )
        mask_nat = df_datos['DateTime'].isna()
        if mask_nat.any():
            df_datos.loc[mask_nat, 'DateTime'] = pd.to_datetime(
                raw_dates.loc[mask_nat], dayfirst=True, errors='coerce'
            )
        nat_count = int(df_datos['DateTime'].isna().sum())
        if nat_count > 0:
            print(f"⚠️  {nat_count} filas con fecha inválida descartadas")
        df_datos = df_datos.dropna(subset=['DateTime']).reset_index(drop=True)

        return df_datos
    
    except Exception as e:
        print(f"Error al cargar datos ENVISTA: {e}")
        return None


def _abreviar_estacion(nombre):
    """Generar código de 3 letras para una estación que no esté en MAPEO_ESTACIONES."""
    limpio = ''.join(ch for ch in str(nombre).upper() if ch.isalnum())
    return (limpio[:3] or 'UNK')


def convertir_a_formato_base(df_envista):
    """Convertir formato ENVISTA al formato exacto de BD_2024.xlsx.

    Las estaciones se descubren dinámicamente a partir de los prefijos de
    columnas del DataFrame Envista. Esto permite procesar archivos con una
    sola estación, varias o incluso estaciones no listadas en MAPEO_ESTACIONES
    (se les asigna un código de 3 letras como fallback).

    También soporta archivos sin prefijo de estación (columnas directamente
    con nombres de parámetros): se trata todo como una única estación 'UNK'.
    """
    datos_convertidos = []

    # 1. Descubrir estaciones presentes en las columnas
    estaciones_presentes = {}  # nombre_completo -> abreviatura
    columnas_sin_prefijo = []
    for col in df_envista.columns:
        if col == 'DateTime':
            continue
        if '_' in col:
            estacion = col.split('_', 1)[0]
            if estacion not in estaciones_presentes:
                estaciones_presentes[estacion] = (
                    MAPEO_ESTACIONES.get(estacion) or _abreviar_estacion(estacion)
                )
        else:
            columnas_sin_prefijo.append(col)

    # 2. Si NO hay ninguna estación con prefijo pero sí columnas de parámetros,
    #    asumir archivo de una sola estación sin nombre (modo "UNK").
    if not estaciones_presentes and columnas_sin_prefijo:
        estaciones_presentes[''] = 'UNK'

    if not estaciones_presentes:
        return pd.DataFrame()

    for _, fila in df_envista.iterrows():
        fecha_hora = fila['DateTime']
        if pd.isna(fecha_hora):
            continue

        fecha = fecha_hora.strftime('%Y-%m-%d')
        hora = int(fecha_hora.hour)

        for estacion_completa, abrev_estacion in estaciones_presentes.items():
            fila_base = {'STATION': abrev_estacion, 'DATE': fecha, 'HOUR': hora}
            for param in COLUMNAS_BD[3:]:
                fila_base[param] = None

            for col in df_envista.columns:
                if col == 'DateTime':
                    continue

                if estacion_completa == '':
                    # Modo sin prefijo: solo columnas que NO tengan '_'
                    if '_' in col:
                        continue
                    parametro_envista = col
                else:
                    prefix = estacion_completa + '_'
                    if not col.startswith(prefix):
                        continue
                    parametro_envista = col[len(prefix):]

                parametro_base = MAPEO_PARAMETROS.get(parametro_envista, parametro_envista)
                if parametro_base not in COLUMNAS_BD:
                    continue

                valor = fila[col]
                if not pd.notna(valor) or valor == '':
                    continue

                bandera_mapeada = mapear_bandera_envista(valor)
                if bandera_mapeada is not None:
                    fila_base[parametro_base] = bandera_mapeada
                else:
                    try:
                        fila_base[parametro_base] = _intentar_float(str(valor))
                    except (ValueError, TypeError):
                        fila_base[parametro_base] = 'IO'

            datos_validos = sum(
                1 for k, v in fila_base.items()
                if k not in ['STATION', 'DATE', 'HOUR'] and v is not None
            )
            if datos_validos > 0:
                datos_convertidos.append(fila_base)

    if datos_convertidos:
        df_convertido = pd.DataFrame(datos_convertidos)
        for col in COLUMNAS_BD:
            if col not in df_convertido.columns:
                df_convertido[col] = None
        df_convertido = df_convertido[COLUMNAS_BD]
        df_convertido = df_convertido.sort_values(['STATION', 'DATE', 'HOUR']).reset_index(drop=True)
        return df_convertido
    else:
        return pd.DataFrame()


def _asegurar_columna_de_banderas(df, columna):
    """Convertir la columna a object antes de escribirle una bandera de texto.

    Las validaciones sustituyen el valor por su bandera ('IR', 'IO', 'DS') en la
    misma columna. Si la columna llegó como float64 —lo que pasa cuando los
    datos vienen limpios, por ejemplo desde los minutales— pandas 3 rechaza la
    escritura con "Invalid value 'IR' for dtype 'float64'" en vez de convertir
    el tipo en silencio como hacían las versiones antiguas.

    Con archivos de ENVISTA no se notaba porque ahí las columnas ya vienen
    mezcladas con texto y son object desde el inicio; era un fallo latente que
    esperaba a la primera fuente de datos bien tipada.
    """
    if columna in df.columns and df[columna].dtype != object:
        df[columna] = df[columna].astype(object)


def validar_rangos(df, rangos_config=None):
    """Validar datos por rangos establecidos"""
    if rangos_config is None:
        rangos_config = RANGOS
    df_validado = df.copy()

    for parametro, config in rangos_config.items():
        if parametro in df_validado.columns:
            valores_num = pd.to_numeric(df_validado[parametro], errors='coerce')
            mask_numerico = valores_num.notna()
            
            if mask_numerico.sum() == 0:
                continue
            
            mask_fuera = mask_numerico & ((valores_num < config['min']) | (valores_num > config['max']))
            if mask_fuera.sum() > 0:
                _asegurar_columna_de_banderas(df_validado, parametro)
                df_validado.loc[mask_fuera, parametro] = 'IR'
            
            if 'limite_deteccion' in config and config['limite_deteccion'] is not None:
                mask_limite = (mask_numerico &
                             (valores_num >= config['min']) &
                             (valores_num < config['limite_deteccion']))
                if mask_limite.sum() > 0:
                    df_validado.loc[mask_limite, parametro] = config['limite_deteccion']
    
    return df_validado


def validar_temperatura_interna(df, temp_min=20, temp_max=30):
    """Validar por temperatura interna de cabina"""
    if 'IT' not in df.columns:
        return df

    df_validado = df.copy()
    temp_interna = pd.to_numeric(df_validado['IT'], errors='coerce')

    mask_temp_invalida = (temp_interna < temp_min) | (temp_interna > temp_max)
    
    contaminantes = ['O3', 'NOX', 'NO', 'NO2', 'PM10', 'PM2.5', 'SO2', 'CO']
    
    for contaminante in contaminantes:
        if contaminante in df_validado.columns:
            mask_datos = pd.to_numeric(df_validado[contaminante], errors='coerce').notna()
            mask_invalidar = mask_temp_invalida & mask_datos
            
            if mask_invalidar.sum() > 0:
                _asegurar_columna_de_banderas(df_validado, contaminante)
                df_validado.loc[mask_invalidar, contaminante] = 'IO'
    
    return df_validado


# Parámetros sujetos a validación de valores constantes > 3 h.
# SO2 se excluye explícitamente: valores constantes en SO2 son normales en la zona,
# no implican falla del equipo.
PARAMETROS_CONSTANTES = ['CO', 'NOX', 'NO2', 'NO', 'O3', 'PM10', 'PM2.5']


def validar_series_temporales(df, opciones=None):
    """Validar datos por series temporales.

    Las validaciones de relación marcan TODOS los parámetros involucrados como 'IO'
    (NO, NO2, NOX en el caso de NOx; PM2.5 y PM10 en el caso de PM). Los valores
    originales se reemplazan por la bandera — no se eliminan filas.

    opciones (dict):
      - constantes (bool, True): marca como 'DS' series con el mismo valor por > 3 h.
      - nox (bool, True): marca como 'IO' cuando (NO+NO2)/NOX se desvía > tolerancia.
      - nox_tolerance (float, 0.10): tolerancia ±relativa para la relación NOx.
      - pm (bool, True): marca como 'IO' cuando PM2.5/PM10 > 1+pm_tolerance.
      - pm_tolerance (float, 0.15): tolerancia para relación PM2.5/PM10.
    """
    if opciones is None:
        opciones = {}

    activar_constantes = bool(opciones.get('constantes', True))
    activar_nox = bool(opciones.get('nox', True))
    activar_pm = bool(opciones.get('pm', True))
    nox_tol = float(opciones.get('nox_tolerance', 0.10))
    pm_tol = float(opciones.get('pm_tolerance', 0.15))

    df_validado = df.copy()

    df_validado['datetime_temp'] = pd.to_datetime(
        df_validado['DATE'].astype(str) + ' ' +
        df_validado['HOUR'].astype(int).astype(str).str.zfill(2) + ':00:00',
        format='%Y-%m-%d %H:%M:%S',
        errors='coerce'
    )
    df_validado = df_validado.dropna(subset=['datetime_temp']).reset_index(drop=True)

    for estacion in df_validado['STATION'].unique():
        df_estacion = df_validado[df_validado['STATION'] == estacion].copy()
        df_estacion = df_estacion.sort_values('datetime_temp').reset_index()

        if activar_constantes:
            for param in PARAMETROS_CONSTANTES:
                if param in df_estacion.columns:
                    valores = pd.to_numeric(df_estacion[param], errors='coerce')
                    grupos_constantes = (valores != valores.shift()).cumsum()
                    conteo_grupos = valores.groupby(grupos_constantes).size()
                    grupos_largos = conteo_grupos[conteo_grupos > 3].index

                    for grupo in grupos_largos:
                        mask_grupo = (grupos_constantes == grupo) & valores.notna()
                        indices_originales = df_estacion.loc[mask_grupo, 'index']
                        _asegurar_columna_de_banderas(df_validado, param)
                        df_validado.loc[indices_originales, param] = 'DS'

        # Relación NOX ≈ NO + NO2 (tolerancia relativa simétrica)
        if activar_nox and all(p in df_estacion.columns for p in ['NO', 'NO2', 'NOX']):
            no_vals = pd.to_numeric(df_estacion['NO'], errors='coerce')
            no2_vals = pd.to_numeric(df_estacion['NO2'], errors='coerce')
            nox_vals = pd.to_numeric(df_estacion['NOX'], errors='coerce')

            mask_validos = no_vals.notna() & no2_vals.notna() & nox_vals.notna() & (nox_vals != 0)

            if mask_validos.sum() > 0:
                relacion = (no_vals + no2_vals) / nox_vals
                mask_fuera_rango = mask_validos & (
                    (relacion < (1 - nox_tol)) | (relacion > (1 + nox_tol))
                )

                if mask_fuera_rango.sum() > 0:
                    indices_originales = df_estacion.loc[mask_fuera_rango, 'index']
                    for param in ['NO', 'NO2', 'NOX']:
                        _asegurar_columna_de_banderas(df_validado, param)
                        df_validado.loc[indices_originales, param] = 'IO'

        # Relación PM2.5/PM10
        if activar_pm and all(p in df_estacion.columns for p in ['PM2.5', 'PM10']):
            pm25_vals = pd.to_numeric(df_estacion['PM2.5'], errors='coerce')
            pm10_vals = pd.to_numeric(df_estacion['PM10'], errors='coerce')

            mask_validos = pm25_vals.notna() & pm10_vals.notna() & (pm10_vals != 0)

            if mask_validos.sum() > 0:
                relacion = pm25_vals / pm10_vals
                mask_fuera_rango = mask_validos & (relacion > (1 + pm_tol))

                if mask_fuera_rango.sum() > 0:
                    indices_originales = df_estacion.loc[mask_fuera_rango, 'index']
                    for param in ['PM2.5', 'PM10']:
                        _asegurar_columna_de_banderas(df_validado, param)
                        df_validado.loc[indices_originales, param] = 'IO'

    df_validado = df_validado.drop('datetime_temp', axis=1)

    return df_validado


def aplicar_decimales(df):
    """Aplicar formato de decimales"""
    df_formateado = df.copy()
    
    for parametro, decimales in DECIMALES.items():
        if parametro in df_formateado.columns:
            valores_num = pd.to_numeric(df_formateado[parametro], errors='coerce')
            mask_numerico = valores_num.notna()
            
            if mask_numerico.sum() > 0:
                df_formateado.loc[mask_numerico, parametro] = valores_num.round(decimales)
    
    return df_formateado


def validar_datos_completo(df, config=None):
    """Ejecutar validaciones según configuración"""
    if config is None:
        config = {}

    df_validado = df.copy()

    if config.get('rangos', True):
        rangos_custom = config.get('rangos_custom', None)
        df_validado = validar_rangos(df_validado, rangos_custom)

    if config.get('temperatura', True):
        temp_min = float(config.get('temp_min', 20))
        temp_max = float(config.get('temp_max', 30))
        df_validado = validar_temperatura_interna(df_validado, temp_min, temp_max)

    # Compatibilidad: `series` (bool) sigue actuando como interruptor global.
    # Las sub-opciones individuales se pueden activar/desactivar por separado.
    if config.get('series', True):
        opciones_series = {
            'constantes': config.get('series_constantes', True),
            'nox': config.get('series_nox', True),
            'pm': config.get('series_pm', True),
            'nox_tolerance': config.get('nox_tolerance', 0.10),
            'pm_tolerance': config.get('pm_tolerance', 0.15),
        }
        df_validado = validar_series_temporales(df_validado, opciones_series)

    return df_validado


def crear_resumen_validacion(df):
    """Crear resumen de la validación"""
    banderas_encontradas = {}
    columnas_parametros = [col for col in df.columns if col not in ['STATION', 'DATE', 'HOUR']]
    
    for col in columnas_parametros:
        if df[col].dtype == 'object':
            valores_unicos = df[col].unique()
            for valor in valores_unicos:
                if isinstance(valor, str) and valor in BANDERAS:
                    if valor not in banderas_encontradas:
                        banderas_encontradas[valor] = 0
                    banderas_encontradas[valor] += (df[col] == valor).sum()
    
    if banderas_encontradas:
        resumen = pd.DataFrame.from_dict(banderas_encontradas, orient='index', columns=['Cantidad'])
        resumen['Descripción'] = resumen.index.map(BANDERAS)
        resumen = resumen.sort_values('Cantidad', ascending=False)
    else:
        resumen = pd.DataFrame({'Cantidad': [0], 'Descripción': ['Sin banderas aplicadas']})
    
    # Resumen detallado
    resumen_detallado = []
    for estacion in df['STATION'].unique():
        df_est = df[df['STATION'] == estacion]
        for param in columnas_parametros:
            if df_est[param].dtype == 'object':
                for bandera in BANDERAS:
                    cantidad = (df_est[param] == bandera).sum()
                    if cantidad > 0:
                        resumen_detallado.append({
                            'Estación': estacion,
                            'Contaminante': param,
                            'Bandera': bandera,
                            'Descripción': BANDERAS[bandera],
                            'Cantidad': cantidad
                        })
    resumen_detallado = pd.DataFrame(resumen_detallado)
    
    # Estadísticas
    estadisticas = pd.DataFrame({
        'Cantidad': [
            len(df),
            len(df['STATION'].unique()),
            len(df['DATE'].unique()),
            sum(pd.to_numeric(df[col], errors='coerce').notna().sum() for col in columnas_parametros)
        ],
        'Descripción': [
            'Total de registros',
            'Estaciones procesadas',
            'Días procesados',
            'Valores numéricos válidos'
        ]
    }, index=['Total_Registros', 'Estaciones', 'Días', 'Valores_Válidos'])
    
    # Estadísticas detalladas
    estadisticas_detalladas = []
    for estacion in df['STATION'].unique():
        df_est = df[df['STATION'] == estacion]
        for param in columnas_parametros:
            valores = pd.to_numeric(df_est[param], errors='coerce')
            valores_validos = valores.dropna()
            if len(valores_validos) > 0:
                estadisticas_detalladas.append({
                    'Estación': estacion,
                    'Contaminante': param,
                    'Total de registros': len(df_est),
                    'Valores válidos': len(valores_validos),
                    'Mínimo': valores_validos.min(),
                    'Máximo': valores_validos.max(),
                    'Promedio': valores_validos.mean(),
                    'Desviación estándar': valores_validos.std(),
                })
    estadisticas_detalladas = pd.DataFrame(estadisticas_detalladas)
    
    return resumen, resumen_detallado, estadisticas, estadisticas_detalladas


def exportar_resultados(df_validado, archivo_salida):
    """Exportar resultados a Excel"""
    try:
        df_export = aplicar_decimales(df_validado)
        resumen_banderas, resumen_detallado, estadisticas, estadisticas_detalladas = crear_resumen_validacion(df_export)
        
        with pd.ExcelWriter(archivo_salida, engine='openpyxl') as writer:
            df_export.to_excel(writer, sheet_name='Data', index=False)
            resumen_banderas.to_excel(writer, sheet_name='Resumen_Banderas_Global', index=True)
            resumen_detallado.to_excel(writer, sheet_name='Resumen_Banderas_Detallado', index=False)
            estadisticas.to_excel(writer, sheet_name='Estadísticas_Generales', index=True)
            estadisticas_detalladas.to_excel(writer, sheet_name='Estadísticas_Detalladas', index=False)
            
            config_df = pd.DataFrame({
                'Parámetro': list(RANGOS.keys()),
                'Mín': [r['min'] for r in RANGOS.values()],
                'Máx': [r['max'] for r in RANGOS.values()],
                'Decimales': [DECIMALES.get(p, 0) for p in RANGOS.keys()]
            })
            config_df.to_excel(writer, sheet_name='Configuración', index=False)
        
        return resumen_banderas, estadisticas
    
    except Exception as e:
        print(f"Error al exportar: {e}")
        return None, None


# ============================================================================
# ENDPOINTS DE LA API
# ============================================================================

def allowed_file(filename):
    """Verificar si el archivo tiene una extensión permitida"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/api/health', methods=['GET'])
def health_check():
    """Endpoint de salud de la API"""
    return jsonify({
        'status': 'ok',
        'message': 'API de Validación de Calidad del Aire funcionando',
        'timestamp': datetime.now().isoformat(),
        'version': '2.0.0'
    })


@app.route('/api/config', methods=['GET'])
def get_config():
    """Obtener configuración del validador"""
    return jsonify({
        'estaciones': MAPEO_ESTACIONES,
        'parametros': MAPEO_PARAMETROS,
        'rangos': RANGOS,
        'banderas': BANDERAS,
        'decimales': DECIMALES,
        'series_temporales': {
            'constantes': {
                'default': True,
                'descripcion': 'Marca como DS (dato sospechoso) cualquier serie con el mismo valor durante más de 3 horas consecutivas.',
                'parametros': PARAMETROS_CONSTANTES,
                'excluye': ['SO2'],
            },
            'nox': {
                'default': True,
                'tolerancia_default': 0.10,
                'descripcion': 'Verifica que (NO + NO2) / NOX ≈ 1 dentro de la tolerancia. Si se desvía, marca NO, NO2 y NOX como IO en esa hora.',
            },
            'pm': {
                'default': True,
                'tolerancia_default': 0.15,
                'descripcion': 'Verifica que PM2.5 / PM10 ≤ 1 + tolerancia. Si excede, marca PM2.5 y PM10 como IO en esa hora.',
            },
            'comportamiento': 'Las validaciones de relación reemplazan los valores detectados por la bandera correspondiente. No se eliminan filas.',
        }
    })


@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Subir archivo ENVISTA para procesar"""
    if 'file' not in request.files:
        return jsonify({'error': 'No se encontró archivo en la solicitud'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No se seleccionó ningún archivo'}), 400
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"{timestamp}_{filename}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        return jsonify({
            'message': 'Archivo subido exitosamente',
            'filename': filename,
            'filepath': filepath
        })
    
    return jsonify({'error': 'Tipo de archivo no permitido. Use .xlsx, .xls o .csv'}), 400


@app.route('/api/validate/full', methods=['POST'])
def validate_full():
    """Validación completa de datos"""
    data = request.get_json()
    
    if not data or 'filename' not in data:
        return jsonify({'error': 'Se requiere el nombre del archivo'}), 400
    
    filename = data['filename']
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    if not os.path.exists(filepath):
        return jsonify({'error': 'Archivo no encontrado'}), 404
    
    try:
        revalidate = bool(data.get('revalidate', True))
        formato, hoja = detectar_formato_archivo(filepath)

        if formato == 'bd_procesado':
            # Archivo ya procesado: saltar normalización Envista
            df_convertido = cargar_archivo_procesado(filepath, hoja)
            if len(df_convertido) == 0:
                return jsonify({'error': 'El archivo procesado no contiene datos'}), 400
        else:
            # 1. Cargar datos ENVISTA crudo
            df_envista = cargar_y_procesar_envista(filepath)

            if df_envista is None or len(df_envista) == 0:
                return jsonify({'error': 'No se pudieron cargar los datos del archivo'}), 400

            # 2. Convertir a formato base
            df_convertido = convertir_a_formato_base(df_envista)

            if len(df_convertido) == 0:
                return jsonify({'error': 'No se pudieron convertir los datos'}), 400

        # 3. Aplicar validaciones según config recibida (opcional para bd_procesado)
        config_validacion = data.get('config', None)
        if formato == 'bd_procesado' and not revalidate:
            df_validado = df_convertido.copy()
        else:
            df_validado = validar_datos_completo(df_convertido, config_validacion)
        
        # 4. Crear resúmenes
        resumen_banderas, resumen_detallado, estadisticas, stats_detalladas = crear_resumen_validacion(df_validado)
        
        # 5. Guardar archivo validado con nombre estándar BD_{año}.xlsx
        try:
            anio = pd.to_datetime(df_validado['DATE'], errors='coerce').dt.year.mode().iloc[0]
            anio = int(anio)
        except Exception:
            anio = datetime.now().year
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_filename = f"BD_{anio}_{timestamp}.xlsx"
        output_filepath = os.path.join(app.config['UPLOAD_FOLDER'], output_filename)
        exportar_resultados(df_validado, output_filepath)
        
        # 6. Preparar respuesta
        df_json = df_validado.fillna('').to_dict(orient='records')
        
        response = {
            'success': True,
            'message': 'Validación completa realizada exitosamente',
            'output_filename': output_filename,
            'file_format': formato,
            'revalidated': formato != 'bd_procesado' or revalidate,
            'summary': {
                'total_registros': len(df_validado),
                'estaciones': df_validado['STATION'].nunique(),
                'fecha_inicio': df_validado['DATE'].min(),
                'fecha_fin': df_validado['DATE'].max(),
                'banderas': resumen_banderas.to_dict() if not resumen_banderas.empty else {},
                'estadisticas': estadisticas.to_dict() if not estadisticas.empty else {}
            },
            'data_preview': df_json,
            'estadisticas_detalladas': stats_detalladas.to_dict(orient='records') if not stats_detalladas.empty else []
        }
        
        return jsonify(response)
    
    except Exception as e:
        return jsonify({'error': f'Error durante la validación: {str(e)}'}), 500


@app.route('/api/download/<filename>', methods=['GET'])
def download_file(filename):
    """Descargar archivo procesado"""
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    if not os.path.exists(filepath):
        return jsonify({'error': 'Archivo no encontrado'}), 404
    
    return send_file(
        filepath,
        as_attachment=True,
        download_name=filename,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )


@app.route('/api/preview-validated', methods=['POST'])
def preview_validated():
    """Cargar un archivo Excel ya validado (con hoja Datos_Validados)"""
    data = request.get_json()

    if not data or 'filename' not in data:
        return jsonify({'error': 'Se requiere el nombre del archivo'}), 400

    filename = data['filename']
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)

    if not os.path.exists(filepath):
        return jsonify({'error': 'Archivo no encontrado'}), 404

    try:
        # Aceptar ambos nombres de hoja (nuevo: 'Data', anterior: 'Datos_Validados')
        formato, hoja = detectar_formato_archivo(filepath)
        if formato != 'bd_procesado' or not hoja:
            return jsonify({'error': 'El archivo no contiene hoja Data ni Datos_Validados'}), 400
        df = pd.read_excel(filepath, sheet_name=hoja)

        if df is None or len(df) == 0:
            return jsonify({'error': f'No se encontraron datos en la hoja {hoja}'}), 400

        resumen_banderas, _, estadisticas, stats_detalladas = crear_resumen_validacion(df)

        df_json = df.fillna('').to_dict(orient='records')

        return jsonify({
            'success': True,
            'message': 'Archivo validado cargado correctamente',
            'output_filename': filename,
            'summary': {
                'total_registros': len(df),
                'estaciones': int(df['STATION'].nunique()) if 'STATION' in df.columns else 0,
                'fecha_inicio': str(df['DATE'].min()) if 'DATE' in df.columns else '',
                'fecha_fin': str(df['DATE'].max()) if 'DATE' in df.columns else '',
                'banderas': resumen_banderas.to_dict() if not resumen_banderas.empty else {},
                'estadisticas': estadisticas.to_dict() if not estadisticas.empty else {}
            },
            'data_preview': df_json,
            'estadisticas_detalladas': stats_detalladas.to_dict(orient='records') if not stats_detalladas.empty else []
        })

    except Exception as e:
        return jsonify({'error': f'Error al leer archivo validado: {str(e)}'}), 500



# ============================================================================
# FRONTEND EMPAQUETADO (app de escritorio)
# ============================================================================
# En desarrollo el frontend corre en Vite con un proxy hacia /api. En la app de
# escritorio no hay Vite, asi que Flask sirve tambien el HTML ya compilado. La
# ventaja de servirlo desde aqui en vez de abrirlo como file:// es que asi la
# pagina y la API comparten origen: las llamadas a /api funcionan tal cual y no
# hay que tocar CORS ni reescribir rutas.

FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'frontend', 'dist')


@app.route('/', defaults={'ruta': ''})
@app.route('/<path:ruta>')
def servir_frontend(ruta):
    if not os.path.isdir(FRONTEND_DIST):
        return jsonify({'error': 'Frontend no compilado. Ejecuta: npm --prefix frontend run build'}), 404

    archivo = os.path.join(FRONTEND_DIST, ruta)
    if ruta and os.path.isfile(archivo):
        return send_file(archivo)
    # Cualquier otra ruta devuelve index.html: el enrutado es del lado del
    # cliente (react-router), asi que /minutales no es un archivo en disco.
    return send_file(os.path.join(FRONTEND_DIST, 'index.html'))


if __name__ == '__main__':
    print("\n" + "="*60)
    print("API DE VALIDACIÓN DE CALIDAD DEL AIRE")
    print("="*60)
    print(f"Servidor iniciando en http://localhost:8000")
    print("="*60 + "\n")
    
    # debug=True expone el depurador de Werkzeug, que permite ejecutar codigo
    # arbitrario desde el navegador; en 0.0.0.0 quedaba accesible a toda la red.
    # Se puede reactivar con VALIDADOR_DEBUG=1 para desarrollo local.
    depurar = os.environ.get('VALIDADOR_DEBUG') == '1'
    host = os.environ.get('VALIDADOR_HOST', '127.0.0.1')
    app.run(debug=depurar, host=host, port=8000)
