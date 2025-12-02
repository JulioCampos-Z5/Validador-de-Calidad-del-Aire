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

# Configuración
UPLOAD_FOLDER = tempfile.mkdtemp()
ALLOWED_EXTENSIONS = {'xlsx', 'xls'}
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
    'PM10': {'min': 0, 'max': 1000},
    'PM2.5': {'min': 0, 'max': 1000},
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
        float(valor_str)
        return None
    except (ValueError, TypeError):
        return 'IO'


def cargar_y_procesar_envista(archivo_trs):
    """Cargar y procesar datos desde Trs.xlsx (formato ENVISTA)"""
    try:
        df_raw = pd.read_excel(archivo_trs, sheet_name=0, header=None)
        
        estaciones = df_raw.iloc[2, :].values
        parametros = df_raw.iloc[3, :].values
        
        nuevas_columnas = ['DateTime']
        for i in range(1, len(estaciones)):
            if pd.notna(estaciones[i]) and pd.notna(parametros[i]):
                nuevas_columnas.append(f"{estaciones[i]}_{parametros[i]}")
            else:
                nuevas_columnas.append(f"Col_{i}")
        
        df_datos = df_raw.iloc[5:, :len(nuevas_columnas)].copy()
        df_datos.columns = nuevas_columnas
        df_datos = df_datos.reset_index(drop=True)
        
        df_datos['DateTime'] = pd.to_datetime(df_datos['DateTime'], errors='coerce')
        df_datos = df_datos.dropna(subset=['DateTime'])
        
        return df_datos
    
    except Exception as e:
        print(f"Error al cargar datos ENVISTA: {e}")
        return None


def convertir_a_formato_base(df_envista):
    """Convertir formato ENVISTA al formato exacto de BD_2024.xlsx"""
    datos_convertidos = []
    
    for idx, fila in df_envista.iterrows():
        fecha_hora = fila['DateTime']
        if pd.isna(fecha_hora):
            continue
        
        fecha = fecha_hora.strftime('%Y-%m-%d %H:%M')
        hora = fecha_hora.hour
        
        for estacion_completa, abrev_estacion in MAPEO_ESTACIONES.items():
            fila_base = {
                'STATION': abrev_estacion,
                'DATE': fecha,
                'HOUR': hora
            }
            
            for param in COLUMNAS_BD[3:]:
                fila_base[param] = None
            
            for col in df_envista.columns:
                if col.startswith(estacion_completa + '_'):
                    parametro_envista = col.split('_', 1)[1]
                    parametro_base = MAPEO_PARAMETROS.get(parametro_envista, parametro_envista)
                    
                    if parametro_base in COLUMNAS_BD:
                        valor = fila[col]
                        if pd.notna(valor) and valor != '':
                            bandera_mapeada = mapear_bandera_envista(valor)
                            
                            if bandera_mapeada is not None:
                                fila_base[parametro_base] = bandera_mapeada
                            else:
                                try:
                                    valor_num = float(valor)
                                    fila_base[parametro_base] = valor_num
                                except (ValueError, TypeError):
                                    fila_base[parametro_base] = 'IO'
            
            datos_validos = sum(1 for k, v in fila_base.items()
                              if k not in ['STATION', 'DATE', 'HOUR'] and v is not None)
            
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


def validar_rangos(df):
    """Validar datos por rangos establecidos"""
    df_validado = df.copy()
    
    for parametro, config in RANGOS.items():
        if parametro in df_validado.columns:
            valores_num = pd.to_numeric(df_validado[parametro], errors='coerce')
            mask_numerico = valores_num.notna()
            
            if mask_numerico.sum() == 0:
                continue
            
            mask_fuera = mask_numerico & ((valores_num < config['min']) | (valores_num > config['max']))
            if mask_fuera.sum() > 0:
                df_validado.loc[mask_fuera, parametro] = 'IR'
            
            if 'limite_deteccion' in config and config['limite_deteccion'] is not None:
                mask_limite = (mask_numerico &
                             (valores_num >= config['min']) &
                             (valores_num < config['limite_deteccion']))
                if mask_limite.sum() > 0:
                    df_validado.loc[mask_limite, parametro] = config['limite_deteccion']
    
    return df_validado


def validar_temperatura_interna(df):
    """Validar por temperatura interna de cabina (20-30°C)"""
    if 'IT' not in df.columns:
        return df
    
    df_validado = df.copy()
    temp_interna = pd.to_numeric(df_validado['IT'], errors='coerce')
    
    mask_temp_invalida = (temp_interna < 20) | (temp_interna > 30)
    
    contaminantes = ['O3', 'NOX', 'NO', 'NO2', 'PM10', 'PM2.5', 'SO2', 'CO']
    
    for contaminante in contaminantes:
        if contaminante in df_validado.columns:
            mask_datos = pd.to_numeric(df_validado[contaminante], errors='coerce').notna()
            mask_invalidar = mask_temp_invalida & mask_datos
            
            if mask_invalidar.sum() > 0:
                df_validado.loc[mask_invalidar, contaminante] = 'IO'
    
    return df_validado


def validar_series_temporales(df):
    """Validar datos por series temporales"""
    df_validado = df.copy()
    
    df_validado['datetime_temp'] = pd.to_datetime(df_validado['DATE'].astype(str) + ' ' +
                                                   df_validado['HOUR'].astype(str) + ':00:00')
    
    for estacion in df_validado['STATION'].unique():
        df_estacion = df_validado[df_validado['STATION'] == estacion].copy()
        df_estacion = df_estacion.sort_values('datetime_temp').reset_index()
        
        # Validación de valores constantes > 3 horas
        parametros_constantes = ['CO', 'NOX', 'NO2', 'NO', 'O3', 'PM10', 'PM2.5']
        
        for param in parametros_constantes:
            if param in df_estacion.columns:
                valores = pd.to_numeric(df_estacion[param], errors='coerce')
                grupos_constantes = (valores != valores.shift()).cumsum()
                conteo_grupos = valores.groupby(grupos_constantes).size()
                grupos_largos = conteo_grupos[conteo_grupos > 3].index
                
                for grupo in grupos_largos:
                    mask_grupo = (grupos_constantes == grupo) & valores.notna()
                    indices_originales = df_estacion.loc[mask_grupo, 'index']
                    df_validado.loc[indices_originales, param] = 'DS'
        
        # Validación de relación (NO+NO2)/NOX
        if all(param in df_estacion.columns for param in ['NO', 'NO2', 'NOX']):
            no_vals = pd.to_numeric(df_estacion['NO'], errors='coerce')
            no2_vals = pd.to_numeric(df_estacion['NO2'], errors='coerce')
            nox_vals = pd.to_numeric(df_estacion['NOX'], errors='coerce')
            
            mask_validos = no_vals.notna() & no2_vals.notna() & nox_vals.notna() & (nox_vals != 0)
            
            if mask_validos.sum() > 0:
                relacion = (no_vals + no2_vals) / nox_vals
                mask_fuera_rango = mask_validos & ((relacion < 0.85) | (relacion > 1.15))
                
                if mask_fuera_rango.sum() > 0:
                    indices_originales = df_estacion.loc[mask_fuera_rango, 'index']
                    for param in ['NO', 'NO2', 'NOX']:
                        df_validado.loc[indices_originales, param] = 'IO'
        
        # Validación de relación PM2.5/PM10
        if all(param in df_estacion.columns for param in ['PM2.5', 'PM10']):
            pm25_vals = pd.to_numeric(df_estacion['PM2.5'], errors='coerce')
            pm10_vals = pd.to_numeric(df_estacion['PM10'], errors='coerce')
            
            mask_validos = pm25_vals.notna() & pm10_vals.notna() & (pm10_vals != 0)
            
            if mask_validos.sum() > 0:
                relacion = pm25_vals / pm10_vals
                mask_fuera_rango = mask_validos & (relacion > 1.15)
                
                if mask_fuera_rango.sum() > 0:
                    indices_originales = df_estacion.loc[mask_fuera_rango, 'index']
                    for param in ['PM2.5', 'PM10']:
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


def validar_datos_completo(df):
    """Ejecutar todas las validaciones"""
    df_validado = validar_rangos(df)
    df_validado = validar_temperatura_interna(df_validado)
    df_validado = validar_series_temporales(df_validado)
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
            df_export.to_excel(writer, sheet_name='Datos_Validados', index=False)
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
        'decimales': DECIMALES
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
    
    return jsonify({'error': 'Tipo de archivo no permitido. Use .xlsx o .xls'}), 400


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
        # 1. Cargar datos ENVISTA
        df_envista = cargar_y_procesar_envista(filepath)
        
        if df_envista is None or len(df_envista) == 0:
            return jsonify({'error': 'No se pudieron cargar los datos del archivo'}), 400
        
        # 2. Convertir a formato base
        df_convertido = convertir_a_formato_base(df_envista)
        
        if len(df_convertido) == 0:
            return jsonify({'error': 'No se pudieron convertir los datos'}), 400
        
        # 3. Aplicar TODAS las validaciones
        df_validado = validar_datos_completo(df_convertido)
        
        # 4. Crear resúmenes
        resumen_banderas, resumen_detallado, estadisticas, stats_detalladas = crear_resumen_validacion(df_validado)
        
        # 5. Guardar archivo validado
        output_filename = f"validado_{filename}"
        output_filepath = os.path.join(app.config['UPLOAD_FOLDER'], output_filename)
        exportar_resultados(df_validado, output_filepath)
        
        # 6. Preparar respuesta
        df_json = df_validado.fillna('').to_dict(orient='records')
        
        response = {
            'success': True,
            'message': 'Validación completa realizada exitosamente',
            'output_filename': output_filename,
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


if __name__ == '__main__':
    print("\n" + "="*60)
    print("API DE VALIDACIÓN DE CALIDAD DEL AIRE")
    print("="*60)
    print(f"Servidor iniciando en http://localhost:8000")
    print("="*60 + "\n")
    
    app.run(debug=True, host='0.0.0.0', port=8000)
