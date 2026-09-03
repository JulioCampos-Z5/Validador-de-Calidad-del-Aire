"""
Endpoints de la integración con los minutales del SIMAJ.

Van en un Blueprint aparte y no dentro de app.py a propósito: app.py ya carga
con toda la lógica de validación de ENVISTA y meterle aquí la ingesta lo
volvería inmanejable. Esto se monta encima, no lo sustituye — el flujo de subir
un Trs.xlsx a mano sigue igual.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import traceback
from datetime import datetime

import pandas as pd
from flask import Blueprint, jsonify, request, send_file

from . import cliente
from .mir import CONTAMINANTES_CRITERIO, calcular_mir, diagnostico_fallas

bp = Blueprint('minutales', __name__, url_prefix='/api/minutales')

# Los .lsi ya bajados se guardan aquí. El histórico no cambia: una hora ya
# publicada no se reescribe, así que la segunda corrida solo baja lo nuevo.
CACHE = os.path.join(tempfile.gettempdir(), 'minutales_cache')

# Último periodo descargado, para que MIR y el reporte no obliguen a repetir la
# descarga cada vez que se cambian los contaminantes elegidos.
_ultimo: dict = {'df': None, 'meses': None}
_candado = threading.Lock()

# Progreso de la descarga en curso. La descarga de tres meses de trece
# estaciones son decenas de miles de peticiones; sin esto la interfaz no tiene
# forma de decir si sigue viva.
_progreso: dict = {'activo': False, 'estacion': None, 'indice': 0,
                   'estaciones': 0, 'hechos': 0, 'total': 0}


def _anotar_avance(estacion, indice, total_estaciones, hechos, total):
    _progreso.update({
        'activo': True, 'estacion': estacion, 'indice': indice,
        'estaciones': total_estaciones, 'hechos': hechos, 'total': total,
    })


@bp.route('/estaciones', methods=['GET'])
def listar_estaciones():
    try:
        return jsonify({'estaciones': cliente.estaciones()})
    except Exception as e:
        return jsonify({'error': f'No se pudo leer el listado del SIMAJ: {e}'}), 502


@bp.route('/progreso', methods=['GET'])
def progreso():
    return jsonify(_progreso)


@bp.route('/descargar', methods=['POST'])
def descargar():
    """
    Baja el periodo pedido y devuelve EXACTAMENTE la misma forma de respuesta
    que /api/validate/full.

    Esto es deliberado y es el corazón de la integración: para el resto del
    sistema, descargar del SIMAJ y subir un Trs.xlsx son la misma cosa. El
    tablero, las gráficas, la tabla de datos, el resumen de banderas y la
    descarga del Excel funcionan sin enterarse de que los datos llegaron por
    otra vía. Lo único que cambia es el origen.

    Se añaden dos campos propios, `mir` y `fallas`, que el flujo de archivo no
    puede calcular porque necesita saber qué horas DEBERÍA haber en el periodo.
    """
    from app import (validar_datos_completo, crear_resumen_validacion,
                     exportar_resultados, app as flask_app)

    cuerpo = request.get_json(silent=True) or {}
    meses = int(cuerpo.get('meses', 1))
    estaciones_pedidas = cuerpo.get('estaciones') or None
    config = cuerpo.get('config') or None
    contaminantes = cuerpo.get('contaminantes') or CONTAMINANTES_CRITERIO

    if meses < 1 or meses > 12:
        return jsonify({'error': 'meses debe estar entre 1 y 12'}), 400

    _progreso.update({'activo': True, 'hechos': 0, 'total': 0})
    try:
        with _candado:
            df = cliente.descargar(
                meses=meses,
                estaciones_pedidas=estaciones_pedidas,
                carpeta_cache=CACHE,
                al_avanzar=_anotar_avance,
            )
    except Exception as e:
        # La traza va al log del servidor y al cliente solo el mensaje: sin esto
        # un 500 en el navegador no dice nada de donde reventó, y se acaba
        # persiguiendo el error a ciegas.
        traceback.print_exc()
        return jsonify({'error': f'Falló la descarga: {e}'}), 502
    finally:
        _progreso['activo'] = False

    if df.empty:
        return jsonify({'error': 'El SIMAJ no devolvió datos para ese periodo.'}), 404

    # El MIR se calcula sobre los datos crudos, ANTES de validar. Mide cuánto
    # publicó la red, no cuánto sobrevivió a las reglas: si se calculara después,
    # una estación con un sensor descalibrado se vería igual que una que no
    # reporta, y son dos problemas distintos que se atienden distinto.
    mir = calcular_mir(df, contaminantes)
    _ultimo['df'] = df
    _ultimo['meses'] = meses

    try:
        df_validado = validar_datos_completo(df, config)
        resumen_banderas, _detallado, estadisticas, stats_detalladas = crear_resumen_validacion(df_validado)
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': f'Error durante la validación: {e}'}), 500

    # Mismo Excel y mismo nombre que produce el flujo de archivo, para que el
    # botón de descarga del tablero funcione igual venga de donde venga el dato.
    anio = pd.to_datetime(df_validado['DATE'], errors='coerce').dt.year.mode()
    anio = int(anio.iloc[0]) if not anio.empty else datetime.now().year
    marca = datetime.now().strftime('%Y%m%d_%H%M%S')
    salida = f'BD_{anio}_{marca}.xlsx'
    exportar_resultados(df_validado, os.path.join(flask_app.config['UPLOAD_FOLDER'], salida))

    return jsonify({
        'success': True,
        'message': 'Descarga y validación completadas',
        'output_filename': salida,
        'file_format': 'minutales',
        'revalidated': True,
        'summary': {
            'total_registros': len(df_validado),
            'estaciones': int(df_validado['STATION'].nunique()),
            'fecha_inicio': df_validado['DATE'].min(),
            'fecha_fin': df_validado['DATE'].max(),
            'banderas': resumen_banderas.to_dict() if not resumen_banderas.empty else {},
            'estadisticas': estadisticas.to_dict() if not estadisticas.empty else {},
        },
        # fillna('') replica lo que hace validate/full: el frontend ya sabe
        # tratar la cadena vacía como hueco.
        'data_preview': df_validado.fillna('').to_dict(orient='records'),
        'estadisticas_detalladas': (stats_detalladas.to_dict(orient='records')
                                    if not stats_detalladas.empty else []),
        'mir': mir,
        'fallas': diagnostico_fallas(mir),
    })


@bp.route('/mir', methods=['POST'])
def recalcular_mir():
    """Recalcula el MIR cambiando los contaminantes elegidos, sin volver a bajar."""
    if _ultimo['df'] is None:
        return jsonify({'error': 'Todavía no se ha descargado ningún periodo.'}), 409

    cuerpo = request.get_json(silent=True) or {}
    contaminantes = cuerpo.get('contaminantes') or CONTAMINANTES_CRITERIO
    umbral = float(cuerpo.get('umbral', 75))

    mir = calcular_mir(_ultimo['df'], contaminantes, umbral)
    return jsonify({'mir': mir, 'fallas': diagnostico_fallas(mir)})


@bp.route('/reporte.csv', methods=['GET'])
def reporte_csv():
    """Exporta la tabla del MIR con el mismo aspecto que la hoja del área técnica."""
    if _ultimo['df'] is None:
        return jsonify({'error': 'Todavía no se ha descargado ningún periodo.'}), 409

    contaminantes = request.args.get('contaminantes')
    elegidos = contaminantes.split(',') if contaminantes else CONTAMINANTES_CRITERIO
    mir = calcular_mir(_ultimo['df'], elegidos)

    filas = []
    for f in mir['estaciones']:
        fila = {'Estación': f['estacion']}
        for c in mir['contaminantes']:
            v = f['coberturas'].get(c)
            # El hueco se exporta vacío, no como 0: en la hoja original esa
            # distinción es la que separa "sin equipo" de "no reportó".
            fila[c] = '' if v is None else v
        fila['Total'] = f['total']
        fila['Cumple'] = 'Si' if f['cumple'] else 'No'
        filas.append(fila)

    df = pd.DataFrame(filas)
    ruta = os.path.join(tempfile.gettempdir(), 'reporte_mir.csv')
    df.to_csv(ruta, index=False, encoding='utf-8-sig')
    return send_file(ruta, as_attachment=True, download_name='reporte_mir.csv')
