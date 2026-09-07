"""
Endpoints de la integración con la API de Emisiones de Jalisco.

Blueprint aparte, igual que `minutales/`, y por la misma razón: app.py ya carga
con toda la lógica de validación de ENVISTA. Esto se monta encima y no sustituye
nada — los tres orígenes de datos conviven.

    POST /api/emisiones/login       correo + contraseña -> abre sesión
    GET  /api/emisiones/sesion      ¿hay token vivo y hasta cuándo?
    POST /api/emisiones/salir       olvida el token
    POST /api/emisiones/descargar   rango de fechas -> mismos datos validados

Dónde vive el token
-------------------
En memoria del proceso, nunca en disco ni en el navegador. Consecuencias
buscadas: al reiniciar el backend hay que volver a iniciar sesión, y el token no
queda en un archivo que alguien pueda leer más tarde. La contraseña se usa para
pedir el token y se descarta en el acto; no se guarda ni siquiera en memoria.
"""

from __future__ import annotations

import os
import threading
import traceback
from datetime import datetime, timedelta

import pandas as pd
from flask import Blueprint, jsonify, request

from . import cliente
from .cliente import ErrorEmisiones, SesionCaducada

bp = Blueprint('emisiones', __name__, url_prefix='/api/emisiones')

# Sesión única del proceso. El validador es una herramienta de escritorio para
# una persona a la vez —Electron arranca su propio backend—, así que una sesión
# global es lo que corresponde. Si esto se publicara como servicio multiusuario
# habría que pasar el token a la sesión de Flask; hoy sería complejidad sin uso.
_sesion: dict = {'token': None, 'email': None, 'caduca': None}
_candado = threading.Lock()

# Techo del rango consultable de una vez. Un minutal por estación son ~13 filas
# por minuto: un mes ya son cientos de miles de registros y la API se queda
# pensando. Es un límite del cliente, no de la API, y está aquí para que el
# error sea claro en vez de un tiempo de espera agotado sin explicación.
DIAS_MAXIMOS = 31


def _hay_sesion() -> bool:
    return bool(_sesion['token']) and (
        _sesion['caduca'] is None or _sesion['caduca'] > datetime.now()
    )


def _estado_sesion() -> dict:
    """Lo que se le cuenta al frontend. Nunca incluye el token."""
    return {
        'activa': _hay_sesion(),
        'email': _sesion['email'] if _hay_sesion() else None,
        'caduca': _sesion['caduca'].isoformat() if _hay_sesion() and _sesion['caduca'] else None,
    }


@bp.route('/sesion', methods=['GET'])
def sesion():
    return jsonify(_estado_sesion())


@bp.route('/login', methods=['POST'])
def login():
    """
    Pide el token diario con las credenciales del usuario.

    Las credenciales viajan en el cuerpo y no en la URL a propósito: una query
    string acaba en los logs del servidor y en el historial del navegador.
    """
    cuerpo = request.get_json(silent=True) or {}
    email = (cuerpo.get('email') or '').strip()
    password = cuerpo.get('password') or ''

    try:
        obtenido = cliente.solicitar_token(email, password)
    except ErrorEmisiones as e:
        return jsonify({'error': str(e)}), e.codigo
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': f'Error inesperado al iniciar sesión: {e}'}), 500

    with _candado:
        _sesion.update({
            'token': obtenido['token'],
            'email': email,
            'caduca': obtenido['caduca'],
        })

    return jsonify({'success': True, **_estado_sesion()})


@bp.route('/salir', methods=['POST'])
def salir():
    with _candado:
        _sesion.update({'token': None, 'email': None, 'caduca': None})
    return jsonify({'success': True, **_estado_sesion()})


def _rango_pedido(cuerpo: dict) -> tuple[datetime, datetime]:
    """
    Interpreta el rango. Acepta fechas explícitas o un número de días atrás.

    Sin nada, el último día completo: es la consulta que se hace el 90% de las
    veces y ahorra abrir el selector de fechas para lo de siempre.
    """
    desde_txt = (cuerpo.get('desde') or '').strip()
    hasta_txt = (cuerpo.get('hasta') or '').strip()

    if desde_txt and hasta_txt:
        try:
            desde = pd.to_datetime(desde_txt).to_pydatetime()
            hasta = pd.to_datetime(hasta_txt).to_pydatetime()
        except Exception:
            raise ErrorEmisiones('Fechas no reconocidas. Usa AAAA-MM-DD.', codigo=400)
    else:
        dias = int(cuerpo.get('dias', 1))
        hasta = datetime.now().replace(minute=0, second=0, microsecond=0)
        desde = hasta - timedelta(days=dias)

    if hasta <= desde:
        raise ErrorEmisiones('La fecha final debe ser posterior a la inicial.', codigo=400)
    if (hasta - desde).days > DIAS_MAXIMOS:
        raise ErrorEmisiones(
            f'El rango no puede pasar de {DIAS_MAXIMOS} días. '
            'Consulta el periodo por partes.',
            codigo=400,
        )
    return desde, hasta


@bp.route('/muestra', methods=['GET'])
def muestra():
    """
    Devuelve la respuesta CRUDA de la API, sin normalizar, para un rango corto.

    Existe porque la API no publica swagger y su formato hay que averiguarlo
    mirándolo. Cuando `/descargar` dice que no reconoce los campos, esto enseña
    exactamente qué llegó, que es lo único que hace falta para añadir el alias
    que falta.

    Por defecto una hora y tres registros: lo justo para ver la forma sin
    volcar cientos de miles de filas en el navegador.
    """
    if not _hay_sesion():
        return jsonify({'error': 'No hay sesión. Inicia sesión en la API de Emisiones.'}), 401

    horas = max(1, min(int(request.args.get('horas', 1)), 24))
    limite = max(1, min(int(request.args.get('limite', 3)), 50))
    hasta = datetime.now().replace(minute=0, second=0, microsecond=0)
    desde = hasta - timedelta(hours=horas)

    try:
        crudos = cliente.consultar_minutales(_sesion['token'], desde, hasta)
    except ErrorEmisiones as e:
        return jsonify({'error': str(e)}), e.codigo

    return jsonify({
        'periodo': {'desde': desde.isoformat(), 'hasta': hasta.isoformat()},
        'total_registros': len(crudos),
        'muestra': crudos[:limite],
    })


@bp.route('/descargar', methods=['POST'])
def descargar():
    """
    Consulta el rango, valida y devuelve EXACTAMENTE la misma forma de respuesta
    que /api/validate/full y que /api/minutales/descargar.

    Es el mismo principio de la integración con el SIMAJ: para el tablero, las
    gráficas, la tabla y el Excel, este origen es indistinguible de subir un
    archivo. Lo único que cambia es de dónde salieron las filas.
    """
    from app import (validar_datos_completo, crear_resumen_validacion,
                     exportar_resultados, app as flask_app)

    if not _hay_sesion():
        return jsonify({'error': 'No hay sesión. Inicia sesión en la API de Emisiones.'}), 401

    cuerpo = request.get_json(silent=True) or {}
    config = cuerpo.get('config') or None

    try:
        desde, hasta = _rango_pedido(cuerpo)
        df = cliente.descargar(_sesion['token'], desde, hasta)
    except SesionCaducada as e:
        # El token murió a mitad de camino: se limpia para que la interfaz
        # muestre el formulario en vez de reintentar contra un token muerto.
        with _candado:
            _sesion.update({'token': None, 'caduca': None})
        return jsonify({'error': str(e)}), 401
    except ErrorEmisiones as e:
        return jsonify({'error': str(e)}), e.codigo
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': f'Falló la consulta: {e}'}), 502

    if df.empty:
        return jsonify({
            'error': 'La API no devolvió datos para ese periodo.'
        }), 404

    try:
        df_validado = validar_datos_completo(df, config)
        resumen_banderas, _detallado, estadisticas, stats_detalladas = crear_resumen_validacion(df_validado)
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': f'Error durante la validación: {e}'}), 500

    anio = pd.to_datetime(df_validado['DATE'], errors='coerce').dt.year.mode()
    anio = int(anio.iloc[0]) if not anio.empty else datetime.now().year
    marca = datetime.now().strftime('%Y%m%d_%H%M%S')
    salida = f'BD_{anio}_{marca}.xlsx'
    ruta_salida = os.path.join(flask_app.config['UPLOAD_FOLDER'], salida)
    exportar_resultados(df_validado, ruta_salida)

    # exportar_resultados atrapa sus propias excepciones y devuelve None sin
    # avisar, así que hay que comprobar el archivo: sin esto se ofrecería la
    # descarga de algo que nunca se escribió.
    if not os.path.exists(ruta_salida):
        salida = None

    return jsonify({
        'success': True,
        'message': 'Consulta y validación completadas',
        'output_filename': salida,
        'file_format': 'emisiones',
        'revalidated': True,
        'periodo': {'desde': desde.isoformat(), 'hasta': hasta.isoformat()},
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
    })
