"""
Archivos importados, guardados para volver a consultarlos: /api/archivos/...

Solo en la app de escritorio: Electron pasa la carpeta en VALIDADOR_ARCHIVOS
(`datos/archivos` del perfil). En un servidor no hay carpeta y todo responde
que no está disponible, igual que la base local.

Cada Excel o CSV que se sube se copia aquí con su nombre original. Si ya hay
uno igual (mismo contenido) no se duplica; si hay otro con el mismo nombre y
distinto contenido, el nuevo queda como «nombre (2).xlsx».

Por seguridad solo se atienden nombres que existen en la carpeta: nunca se
arma una ruta con lo que mande el cliente.
"""

from __future__ import annotations

import hashlib
import os
import shutil
from datetime import datetime

import pandas as pd
from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename

import horario
import registros

bp = Blueprint('archivos', __name__, url_prefix='/api/archivos')

EXTENSIONES = {'.xlsx', '.xls', '.csv'}
NO_DISPONIBLE = {'disponible': False,
                 'error': 'Los archivos guardados solo están en la app de escritorio.'}
FILAS_VISTA = 200


def carpeta() -> str | None:
    ruta = os.environ.get('VALIDADOR_ARCHIVOS', '').strip()
    if not ruta:
        return None
    os.makedirs(ruta, exist_ok=True)
    return ruta


def _huella(ruta: str) -> str:
    h = hashlib.sha256()
    with open(ruta, 'rb') as f:
        for bloque in iter(lambda: f.read(1 << 20), b''):
            h.update(bloque)
    return h.hexdigest()


def guardar_subido(origen: str, nombre_original: str) -> str | None:
    """Copia lo subido a la carpeta de archivos. Devuelve el nombre o None."""
    destino = carpeta()
    if not destino:
        return None
    try:
        nombre = secure_filename(nombre_original or '') or 'archivo'
        base, ext = os.path.splitext(nombre)
        if ext.lower() not in EXTENSIONES:
            return None
        huella = _huella(origen)
        n = 1
        while True:
            candidato = nombre if n == 1 else f'{base} ({n}){ext}'
            ruta = os.path.join(destino, candidato)
            if not os.path.exists(ruta):
                shutil.copy2(origen, ruta)
                return candidato
            if os.path.getsize(ruta) == os.path.getsize(origen) and _huella(ruta) == huella:
                return candidato  # ya estaba guardado tal cual
            n += 1
    except Exception as e:
        registros.anotar_error(f'Archivos: no se pudo guardar {nombre_original}', e)
        return None


def _ruta_de(nombre: str) -> str | None:
    """La ruta de un archivo guardado, solo si existe con ese nombre exacto."""
    destino = carpeta()
    if not destino or os.path.splitext(nombre)[1].lower() not in EXTENSIONES:
        return None
    if nombre not in os.listdir(destino):
        return None
    return os.path.join(destino, nombre)


def _tipo(ruta: str) -> str:
    from app import detectar_formato_archivo
    formato, _hoja = detectar_formato_archivo(ruta)
    return 'validado' if formato == 'bd_procesado' else 'envista'


@bp.route('', methods=['GET'])
def listar():
    destino = carpeta()
    if not destino:
        return jsonify({'disponible': False, 'archivos': []})
    archivos = []
    for nombre in os.listdir(destino):
        ruta = os.path.join(destino, nombre)
        if not os.path.isfile(ruta) or os.path.splitext(nombre)[1].lower() not in EXTENSIONES:
            continue
        info = os.stat(ruta)
        archivos.append({
            'nombre': nombre,
            'tamano': info.st_size,
            'modificado': datetime.fromtimestamp(info.st_mtime).isoformat(timespec='seconds'),
            'tipo': _tipo(ruta),
        })
    archivos.sort(key=lambda a: a['modificado'], reverse=True)
    return jsonify({'disponible': True, 'carpeta': destino, 'archivos': archivos})


def _texto(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ''
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.isoformat(sep=' ')
    return v


@bp.route('/<path:nombre>/vista', methods=['GET'])
def vista(nombre: str):
    """Las primeras filas, para mirarlo sin cargarlo en el validador."""
    ruta = _ruta_de(nombre)
    if not ruta:
        return jsonify({'error': 'Ese archivo no está guardado.'}), 404
    filas = max(1, min(int(request.args.get('filas', FILAS_VISTA)), 1000))
    try:
        if ruta.lower().endswith('.csv'):
            df = pd.read_csv(ruta, nrows=filas)
            with open(ruta, 'rb') as f:
                total = max(0, sum(1 for _ in f) - 1)
            hojas, hoja = [], None
        else:
            # Cerrado al terminar: en Windows un archivo abierto no se puede borrar.
            with pd.ExcelFile(ruta) as libro:
                hojas = libro.sheet_names
                pedida = request.args.get('hoja')
                minus = {h.lower(): h for h in hojas}
                hoja = pedida if pedida in hojas else (minus.get('data') or minus.get('datos_validados') or hojas[0])
                df = libro.parse(hoja, nrows=filas)
            total = None
            if ruta.lower().endswith('.xlsx'):
                import openpyxl
                libro_x = openpyxl.load_workbook(ruta, read_only=True)
                total = max(0, (libro_x[hoja].max_row or 1) - 1)
                libro_x.close()
    except Exception as e:
        registros.anotar_error(f'Archivos: no se pudo leer {nombre}', e)
        return jsonify({'error': f'No se pudo leer el archivo: {e}'}), 422
    columnas = [str(c) for c in df.columns]
    datos = [[_texto(v) for v in fila] for fila in df.itertuples(index=False, name=None)]
    return jsonify({'nombre': nombre, 'hojas': hojas, 'hoja': hoja, 'columnas': columnas,
                    'filas': datos, 'total': total if total is not None else len(datos)})


@bp.route('/<path:nombre>/abrir', methods=['POST'])
def abrir(nombre: str):
    """
    Lo deja en la carpeta de trabajo como si se acabara de subir: el front lo
    carga con el mismo flujo (vista previa de validado o validación completa).
    """
    from app import app as flask_app
    ruta = _ruta_de(nombre)
    if not ruta:
        return jsonify({'error': 'Ese archivo no está guardado.'}), 404
    trabajo = f"{horario.ahora().strftime('%Y%m%d_%H%M%S')}_{secure_filename(nombre)}"
    shutil.copy2(ruta, os.path.join(flask_app.config['UPLOAD_FOLDER'], trabajo))
    return jsonify({'filename': trabajo, 'tipo': _tipo(ruta), 'nombre': nombre})


@bp.route('/<path:nombre>', methods=['DELETE'])
def borrar(nombre: str):
    ruta = _ruta_de(nombre)
    if not ruta:
        return jsonify({'error': 'Ese archivo no está guardado.'}), 404
    os.remove(ruta)
    return jsonify({'ok': True})
