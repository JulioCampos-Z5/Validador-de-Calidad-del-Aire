"""
Rutas del histórico: /api/historico/...

Todas responden `disponible: False` (o 404) si la app no se lanzó desde el
escritorio con `VALIDADOR_HISTORICO`. Ver `almacen.py`.
"""

from __future__ import annotations

from contextlib import closing

from flask import Blueprint, jsonify, request

import registros
import ultimo
from historico import almacen

bp = Blueprint('historico', __name__, url_prefix='/api/historico')

NO_DISPONIBLE = {'disponible': False,
                 'error': 'El histórico solo está disponible en la app de escritorio.'}


def _ruta():
    return almacen.ruta_configurada()


@bp.route('/estado', methods=['GET'])
def estado():
    ruta = _ruta()
    if not ruta:
        # 200 y no 404: la interfaz pregunta esto para saber si enseña la
        # página, y que no exista no es un error.
        return jsonify({'disponible': False})
    try:
        with closing(almacen.conectar(ruta)) as con:
            return jsonify(almacen.estado(con, ruta))
    except Exception as e:
        registros.anotar_error('Histórico: no se pudo leer la base', e)
        return jsonify({'disponible': True, 'ruta': ruta, 'error': f'No se pudo abrir el histórico: {e}'}), 500


@bp.route('/cargar', methods=['POST'])
def cargar():
    """
    Trae un periodo guardado como conjunto de trabajo, con la MISMA forma de
    respuesta que /api/validate/full: tablero, gráficas y «Exportar
    validación» funcionan igual que con cualquier otro origen.

    Rango acotado a 2024 en adelante (ver almacen.FECHA_MINIMA).

    No se vuelve a validar: lo guardado ya pasó por las validaciones cuando se
    cargó, y sus banderas son justo lo que se quiere recuperar.
    """
    from app import crear_resumen_validacion, mir_de_archivo

    ruta = _ruta()
    if not ruta:
        return jsonify(NO_DISPONIBLE), 404
    cuerpo = request.get_json(silent=True) or {}
    desde, hasta = str(cuerpo.get('desde', ''))[:10], str(cuerpo.get('hasta', ''))[:10]
    if len(desde) != 10 or len(hasta) != 10 or hasta <= desde:
        return jsonify({'error': 'Periodo no válido. Usa AAAA-MM-DD.'}), 400
    desde, hasta = almacen.acotar(desde, hasta)
    if hasta <= desde:
        return jsonify({'error': f'La base local cubre desde {almacen.FECHA_MINIMA}.'}), 400

    try:
        with closing(almacen.conectar(ruta)) as con:
            df = almacen.cargar_periodo(con, desde, hasta)
    except Exception as e:
        registros.anotar_error('Histórico: falló la lectura del periodo', e)
        return jsonify({'error': f'No se pudo leer la base local: {e}'}), 500
    if df.empty:
        return jsonify({'error': 'La base local no tiene datos guardados en ese periodo.'}), 404

    # Lo guardado ya está validado: el MIR cuenta sus banderas de lectura.
    mir, fallas = mir_de_archivo(df, validado=True, contaminantes=cuerpo.get('contaminantes'),
                                 origen='historico')
    ultimo.guardar_validado(df, 'historico', 'Base local')
    resumen_banderas, _detallado, estadisticas, stats_detalladas = crear_resumen_validacion(df)

    # Sin Excel: con más de un año tardaba minutos y rozaba el límite de filas.
    return jsonify({
        'success': True,
        'message': 'Periodo cargado de la base local',
        'output_filename': None,
        'file_format': 'historico',
        'revalidated': False,
        'summary': {
            'total_registros': len(df),
            'estaciones': int(df['STATION'].nunique()),
            'fecha_inicio': df['DATE'].min(),
            'fecha_fin': df['DATE'].max(),
            'banderas': resumen_banderas.to_dict() if not resumen_banderas.empty else {},
            'estadisticas': estadisticas.to_dict() if not estadisticas.empty else {},
        },
        'data_preview': df.astype(object).where(df.notna(), '').to_dict(orient='records'),
        'estadisticas_detalladas': (stats_detalladas.to_dict(orient='records')
                                    if not stats_detalladas.empty else []),
        'mir': mir,
        'fallas': fallas,
    })


@bp.route('/serie', methods=['GET'])
def serie():
    """
    ?desde&hasta&parametro — solo leer: las filas de un parámetro en un
    periodo, sin tocar lo cargado. Lo usa «Año anterior» en el comportamiento
    horario cuando ese año no está en los datos que se ven.
    """
    ruta = _ruta()
    if not ruta:
        return jsonify(NO_DISPONIBLE), 404
    desde, hasta = request.args.get('desde', '')[:10], request.args.get('hasta', '')[:10]
    parametro = request.args.get('parametro', '')
    if len(desde) != 10 or len(hasta) != 10 or parametro not in almacen.PARAMETROS:
        return jsonify({'error': 'Petición no válida.'}), 400
    with closing(almacen.conectar(ruta)) as con:
        filas = con.execute(
            'SELECT estacion, fecha, hora, valor FROM mediciones '
            'WHERE fecha >= ? AND fecha < ? AND parametro = ? AND valor IS NOT NULL',
            (desde, hasta, parametro),
        ).fetchall()
    return jsonify([{'STATION': e, 'DATE': f, 'HOUR': h, parametro: v} for e, f, h, v in filas])


@bp.route('/analizar', methods=['POST'])
def analizar():
    """Compara el conjunto cargado contra lo guardado, sin escribir."""
    ruta = _ruta()
    if not ruta:
        return jsonify(NO_DISPONIBLE), 404
    df, origen, descripcion = ultimo.validado()
    if df is None or df.empty:
        return jsonify({'error': 'No hay datos cargados. Carga un periodo primero.'}), 400
    try:
        with closing(almacen.conectar(ruta)) as con:
            return jsonify(almacen.analizar(con, df, origen, descripcion))
    except Exception as e:
        registros.anotar_error('Histórico: falló la comparación', e)
        return jsonify({'error': f'No se pudo comparar con el histórico: {e}'}), 500


@bp.route('/aplicar', methods=['POST'])
def aplicar():
    ruta = _ruta()
    if not ruta:
        return jsonify(NO_DISPONIBLE), 404
    cuerpo = request.get_json(silent=True) or {}
    ident = cuerpo.get('id')
    if not ident:
        return jsonify({'error': 'Falta el id del análisis.'}), 400
    try:
        with closing(almacen.conectar(ruta)) as con:
            return jsonify(almacen.aplicar(con, ident, bool(cuerpo.get('actualizar_cambios', True))))
    except KeyError as e:
        return jsonify({'error': str(e.args[0])}), 409
    except Exception as e:
        registros.anotar_error('Histórico: falló la escritura', e)
        return jsonify({'error': f'No se pudo guardar en el histórico: {e}'}), 500


@bp.route('/descartar', methods=['POST'])
def descartar():
    cuerpo = request.get_json(silent=True) or {}
    if cuerpo.get('id'):
        almacen.descartar(cuerpo['id'])
    return jsonify({'ok': True})


@bp.route('/cargas/<int:carga_id>/cambios', methods=['GET'])
def cambios(carga_id: int):
    ruta = _ruta()
    if not ruta:
        return jsonify(NO_DISPONIBLE), 404
    with closing(almacen.conectar(ruta)) as con:
        return jsonify(almacen.cambios_de_carga(con, carga_id))


# ── Descarga desde la API de Emisiones ───────────────────────────────────────
#
# Mes a mes y en un hilo aparte: cada mes se consulta, se valida y se guarda
# antes de pasar al siguiente. Lo que ya entró se queda aunque se corte la red
# o se cancele, y la memoria es la de un mes, no la del rango entero. La
# interfaz sondea el avance, igual que con la descarga del SIMAJ.

import threading

_descarga: dict = {'activo': False}
_cancelar = threading.Event()


def _descargar_meses(ruta: str, token: str, tramos: list, config: dict | None) -> None:
    import pandas as pd
    from app import validar_datos_completo
    from emisiones import cliente
    from emisiones.cliente import SesionCaducada
    from emisiones.rutas import CACHE

    for i, (a, b) in enumerate(tramos):
        if _cancelar.is_set():
            _descarga.update({'activo': False, 'mensaje': 'Cancelado. Lo ya guardado se queda.'})
            return
        _descarga.update({'mes': a[:7], 'hechos': i})
        try:
            df = cliente.descargar(token, pd.Timestamp(a).to_pydatetime(),
                                   pd.Timestamp(b).to_pydatetime(), carpeta_cache=CACHE)
            if df.empty:
                _descarga['vacios'].append(a[:7])
                continue
            validado = validar_datos_completo(df, config)
            with closing(almacen.conectar(ruta)) as con:
                r = almacen.guardar_sin_revisar(con, validado, 'emisiones',
                                                f'API de Emisiones · {a[:7]}')
            _descarga['nuevos'] += r['nuevos']
            _descarga['pendientes'] += r['pendientes']
        except SesionCaducada as e:
            _descarga.update({'activo': False, 'error': str(e)})
            return
        except Exception as e:
            # Un mes que falla no tumba el resto: se anota y se sigue.
            registros.anotar_error(f'Histórico: falló la descarga de {a[:7]}', e)
            _descarga['fallidos'].append({'mes': a[:7], 'error': str(e)})

    _descarga.update({'activo': False, 'hechos': len(tramos), 'mes': None,
                     'mensaje': 'Terminado.'})


@bp.route('/descargar', methods=['POST'])
def descargar():
    """{desde, hasta, config?} — hasta excluye. Arranca la descarga en segundo plano."""
    from emisiones.rutas import _hay_sesion, _sesion

    ruta = _ruta()
    if not ruta:
        return jsonify(NO_DISPONIBLE), 404
    if _descarga.get('activo'):
        return jsonify({'error': 'Ya hay una descarga en curso.'}), 409
    if not _hay_sesion():
        return jsonify({'error': 'Inicia sesión en la API de Emisiones (Consultar datos → API de Emisiones).'}), 401

    cuerpo = request.get_json(silent=True) or {}
    desde, hasta = str(cuerpo.get('desde', ''))[:10], str(cuerpo.get('hasta', ''))[:10]
    if len(desde) != 10 or len(hasta) != 10:
        return jsonify({'error': 'Periodo no válido. Usa AAAA-MM-DD.'}), 400
    desde, hasta = almacen.acotar(desde, hasta)
    if hasta <= desde:
        return jsonify({'error': f'La base local cubre desde {almacen.FECHA_MINIMA}.'}), 400

    tramos = almacen.meses(desde, hasta)
    _cancelar.clear()
    _descarga.clear()
    _descarga.update({'activo': True, 'desde': desde, 'hasta': hasta, 'total': len(tramos),
                     'hechos': 0, 'mes': None, 'nuevos': 0, 'pendientes': 0,
                     'fallidos': [], 'vacios': [], 'error': None, 'mensaje': None})
    threading.Thread(target=_descargar_meses, args=(ruta, _sesion['token'], tramos, cuerpo.get('config')),
                     daemon=True).start()
    return jsonify(_descarga)


@bp.route('/descargar', methods=['GET'])
def avance_descarga():
    return jsonify(_descarga)


@bp.route('/descargar/cancelar', methods=['POST'])
def cancelar_descarga():
    _cancelar.set()
    return jsonify({'ok': True})


# ── Cambios pendientes de revisar ───────────────────────────────────────────

@bp.route('/pendientes', methods=['GET'])
def ver_pendientes():
    ruta = _ruta()
    if not ruta:
        return jsonify(NO_DISPONIBLE), 404
    with closing(almacen.conectar(ruta)) as con:
        return jsonify(almacen.pendientes(con))


@bp.route('/pendientes/aplicar', methods=['POST'])
def aplicar_pendientes():
    ruta = _ruta()
    if not ruta:
        return jsonify(NO_DISPONIBLE), 404
    with closing(almacen.conectar(ruta)) as con:
        return jsonify(almacen.aplicar_pendientes(con))


@bp.route('/pendientes/descartar', methods=['POST'])
def descartar_pendientes():
    ruta = _ruta()
    if not ruta:
        return jsonify(NO_DISPONIBLE), 404
    with closing(almacen.conectar(ruta)) as con:
        return jsonify({'descartados': almacen.descartar_pendientes(con)})


# ── Guardado automático al importar un archivo ──────────────────────────────

def guardar_importado(df, nombre: str) -> dict | None:
    """
    Guarda en la base local lo que se acaba de importar (Excel o CSV), solo en
    la app de escritorio. Misma regla que la descarga de la API: lo nuevo
    entra, lo que cambió queda en «Cambios pendientes». Un fallo aquí no
    estropea la importación: se anota y la respuesta lo dice.

    Devuelve {nuevos, pendientes} o {error}, y None fuera del escritorio.
    """
    ruta = _ruta()
    if not ruta:
        return None
    try:
        with closing(almacen.conectar(ruta)) as con:
            r = almacen.guardar_sin_revisar(con, df, 'archivo', nombre)
        return {'nuevos': r['nuevos'], 'pendientes': r['pendientes']}
    except Exception as e:
        registros.anotar_error(f'Histórico: no se pudo guardar {nombre}', e)
        return {'error': f'No se guardó en la base local: {e}'}
