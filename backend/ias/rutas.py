"""
Endpoints del Índice Aire y Salud y del cumplimiento NOM.

Trabajan sobre el último conjunto validado (`ultimo.validado()`), venga del
origen que venga, así que el Excel y las gráficas de categorías dicen siempre lo
mismo que lo que se está viendo en pantalla. El cálculo se hace una vez por
conjunto y se guarda: pedir otro mes u otra estación no lo repite.
"""

from __future__ import annotations

import os
import tempfile
import threading

import pandas as pd
from flask import Blueprint, jsonify, request, send_file

import registros
import ultimo

from .calculo import (AMG, CATEGORIAS, CONTAMINANTES, calcular_diario, calcular_horario,
                      calcular_municipios, exportar_diario, exportar_horario, mide, mide_municipio)

bp = Blueprint('ias', __name__, url_prefix='/api/ias')

_candado = threading.Lock()
_cache: dict = {'df': None, 'horario': None, 'diario': None}

SIN_DATOS = ({'error': 'Todavía no hay datos validados cargados.'}, 409)


def calculado() -> tuple[pd.DataFrame, pd.DataFrame] | None:
    """(horario, diario) del conjunto validado actual, calculado una sola vez."""
    df, _origen, _desc = ultimo.validado()
    if df is None or df.empty:
        return None
    with _candado:
        if _cache['df'] is not df:
            horario = calcular_horario(df)
            diario = calcular_diario(horario) if not horario.empty else pd.DataFrame()
            _cache.update({'df': df, 'horario': horario, 'diario': diario})
        return _cache['horario'], _cache['diario']


def _anio(horario: pd.DataFrame) -> int:
    return int(horario['TS'].dt.year.mode().iloc[0])


def _num(v):
    return None if v is None or pd.isna(v) else float(v)


def _cat(nombre):
    return CATEGORIAS.index(nombre) if isinstance(nombre, str) else None


def _txt(v):
    return v if isinstance(v, str) else None


@bp.route('/resumen', methods=['GET'])
def resumen():
    """Estaciones (AMG al final) y los meses con datos de cada una."""
    try:
        r = calculado()
    except Exception as e:
        registros.anotar_error('IAS: falló el cálculo', e)
        return jsonify({'error': f'No se pudo calcular el índice: {e}'}), 500
    if r is None:
        return SIN_DATOS
    horario, _ = r
    con_dato = horario[horario[[f'IAS_{p}_CAT' for p in CONTAMINANTES]].notna().any(axis=1)]
    meses = (con_dato.assign(MES=con_dato['DATE'].str.slice(0, 7))
             .groupby('STATION')['MES'].apply(lambda s: sorted(s.unique())).to_dict())
    estaciones = sorted(e for e in meses if e != AMG) + ([AMG] if AMG in meses else [])
    return jsonify({'estaciones': estaciones, 'meses': meses})


@bp.route('/categorias', methods=['GET'])
def categorias():
    """
    Un mes de una estación, día por día: la categoría global de cada hora con
    su responsable y el indicador de cada contaminante, y la categoría diaria.
    Las categorías van como índice 0–4 (Buena … Extremadamente mala).
    """
    estacion = request.args.get('estacion', '')
    mes = request.args.get('mes', '')
    try:
        r = calculado()
    except Exception as e:
        registros.anotar_error('IAS: falló el cálculo', e)
        return jsonify({'error': f'No se pudo calcular el índice: {e}'}), 500
    if r is None:
        return SIN_DATOS
    horario, diario = r

    try:
        inicio = pd.Timestamp(f'{mes}-01')
    except ValueError:
        return jsonify({'error': 'Mes no reconocido. Usa AAAA-MM.'}), 400
    fechas = pd.date_range(inicio, inicio + pd.offsets.MonthEnd(0), freq='D').strftime('%Y-%m-%d')

    h = horario[(horario['STATION'] == estacion) & horario['DATE'].str.startswith(mes)]
    h = h.set_index(['DATE', 'HOUR'])
    d = diario[(diario['STATION'] == estacion)] if not diario.empty else diario
    d = d.set_index(d['FECHA'].dt.strftime('%Y-%m-%d')) if not d.empty else d

    dias = []
    for fecha in fechas:
        horas = []
        for hora in range(24):
            if (fecha, hora) not in h.index:
                horas.append(None)
                continue
            fila = h.loc[(fecha, hora)]
            horas.append({
                'cat': _cat(fila['IAS_GLOBAL_CAT']),
                'pol': _txt(fila['IAS_GLOBAL_POL']),
                'valores': {p: [_num(fila[f'IAS_{p}_VALOR']), _cat(fila[f'IAS_{p}_CAT'])]
                            for p in CONTAMINANTES},
            })
        diaria = None
        if not d.empty and fecha in d.index:
            f = d.loc[fecha]
            diaria = {
                'cat': _cat(f['IAS_GLOBAL_CAT_DIA']),
                'pol': _txt(f['IAS_GLOBAL_POL_DIA']),
                'valores': {p: [_num(f[f'IAS_{p}_VALOR_DIA']), _cat(f[f'IAS_{p}_CAT_DIA'])]
                            for p in CONTAMINANTES},
                'nom': _txt(f['NOM_GLOBAL_CUMPLE']),
            }
        dias.append({'fecha': fecha, 'horas': horas, 'diaria': diaria})

    return jsonify({'estacion': estacion, 'mes': mes, 'dias': dias})


@bp.route('/mide', methods=['GET'])
def mide_tablas():
    """
    Las dos hojas MIDE del Excel diario, para verlas en pantalla: días Buena +
    Aceptable por mes en el AMG y por municipio. Mismo cálculo que el Excel.
    """
    try:
        r = calculado()
        if r is None:
            return SIN_DATOS
        _, diario = r
        if diario.empty:
            return jsonify({'amg': [], 'municipios': []})
        amg = mide(diario)
        mun = mide_municipio(calcular_municipios(diario))
    except Exception as e:
        registros.anotar_error('IAS: falló el MIDE', e)
        return jsonify({'error': f'No se pudo calcular el MIDE: {e}'}), 500
    return jsonify({'amg': amg.to_dict(orient='records'),
                    'municipios': mun.to_dict(orient='records')})


def _enviar(escribir, nombre: str):
    """Calcula, escribe el Excel en temporal y lo manda."""
    try:
        r = calculado()
        if r is None:
            return SIN_DATOS
        horario, diario = r
        if horario.empty:
            return jsonify({'error': 'Los datos no tienen fechas u horas reconocibles.'}), 422
        nombre = nombre.format(anio=_anio(horario),
                               fecha=horario['TS'].max().strftime('%Y%m%d'))
        ruta = os.path.join(tempfile.gettempdir(), nombre)
        escribir(horario, diario, ruta)
    except Exception as e:
        registros.anotar_error(f'IAS: falló la exportación de {nombre}', e)
        return jsonify({'error': f'No se pudo generar el archivo: {e}'}), 500
    return send_file(ruta, as_attachment=True, download_name=nombre)


@bp.route('/horario.xlsx', methods=['GET'])
def horario_xlsx():
    """Hoja horaria: indicadores, índice por contaminante y global, cumplimiento NOM."""
    return _enviar(lambda h, _d, ruta: exportar_horario(h, ruta),
                   'BD_{anio}_HORARIO_IAS_NOM_{fecha}.xlsx')


@bp.route('/diario.xlsx', methods=['GET'])
def diario_xlsx():
    """Las 8 hojas diarias y anuales del script, con municipios y MIDE."""
    return _enviar(lambda _h, d, ruta: exportar_diario(d, ruta),
                   'BD_{anio}_DIARIO_IAS_NOM_{fecha}.xlsx')
