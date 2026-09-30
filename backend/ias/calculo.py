"""
Índice Aire y Salud (NOM-172-SEMARNAT-2023) y cumplimiento de las NOM de salud
(NOM-020, 021, 022, 023 y 025), a partir del conjunto ya validado.

Es el port de las secciones 2 y 3 de `validador_ENVISTA_IAS_NOM_num.py`, con
cinco correcciones respecto al script:

1. **NowCast de PM2.5 con su factor.** El script lo calculaba con el de PM10
   (0.714 en vez de 0.694): todo PM2.5 horario salía ~3 % alto.
2. **Cumplimiento combinado de O3 y CO.** El script comparaba contra NaN cuando
   faltaba el promedio de 8 h, y NaN <= límite es falso: las primeras horas de
   cada estación y las que siguen a un hueco salían «No cumple». Aquí se evalúa
   con lo que haya; sin ningún dato, queda sin evaluar.
3. **Ventanas por horas, no por filas.** `rolling(8)` sobre filas abarca más de
   8 horas cuando falta una fila, y el NowCast pesaba con horas equivocadas.
   Cada estación se pone sobre una rejilla horaria continua antes de promediar.
4. **Límites según el año de los datos.** El script tenía fijos los de 2026;
   aquí 2024–2025 usan la columna «a partir de 2024» y 2026 en adelante la de
   2026, tanto para el índice de partículas como para las NOM de salud.
5. **Máximo diario de 8 h con suficiencia.** El script calificaba el día de CO
   con el máximo del promedio de 8 h aunque el día no tuviera 18 horas.

Lo demás sigue al script: categorías, desempate del contaminante responsable
(fracción dentro de su banda y luego orden conservador), estación virtual AMG,
tabla por municipio, resúmenes anuales y MIDE.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

import numpy as np
import pandas as pd

CONTAMINANTES = ['O3', 'NO2', 'SO2', 'CO', 'PM10', 'PM2.5']
CONTAMINANTES_BD = ['O3', 'NO', 'NO2', 'NOX', 'SO2', 'CO', 'PM10', 'PM2.5']
METEOROLOGIA = ['IT', 'ET', 'RH', 'WS', 'WD', 'PP', 'ATM', 'RS', 'UVI']

CATEGORIAS = ['Buena', 'Aceptable', 'Mala', 'Muy mala', 'Extremadamente mala']

# Desempate final entre contaminantes igual de desfavorables.
ORDEN_CONSERVADOR = ['PM2.5', 'O3', 'PM10', 'NO2', 'SO2', 'CO']

SUF_MIN_HORAS = 18  # 75 % de 24 h

AMG = 'AMG'

ESTACIONES_POR_MUNICIPIO = {
    'Guadalajara': ['CEN', 'VAL', 'ATM', 'OBL', 'TLA', 'LDO', 'AGU', 'MIR', 'COU'],
    'Zapopan': ['VAL', 'ATM', 'AGU', 'SMT'],
    'San Pedro Tlaquepaque': ['TLA', 'PIN', 'AGU', 'MIR', 'SFE'],
    'Tonalá': ['LDO'],
    'El Salto': ['PIN', 'SFE'],
    'Tlajomulco de Zúñiga': ['PIN', 'SFE', 'SAN'],
}

MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']


# ── Límites ──────────────────────────────────────────────────────────────────

def etapa(anio: int) -> int:
    """Columna de la norma que rige para un año: 2024 hasta 2025, 2026 después."""
    return 2026 if anio >= 2026 else 2024


# Límite superior de Buena, Aceptable, Mala y Muy mala (tablas 4 a 9).
_CORTES_GASES = {
    'O3': [0.058, 0.090, 0.135, 0.175],
    'NO2': [0.053, 0.106, 0.160, 0.213],
    'SO2': [0.035, 0.075, 0.185, 0.304],
    'CO': [5.00, 9.00, 12.00, 16.00],
}
_CORTES_PM = {
    2024: {'PM10': [45, 60, 132, 213], 'PM2.5': [15, 33, 79, 130]},
    2026: {'PM10': [45, 50, 132, 213], 'PM2.5': [15, 25, 79, 130]},
}


def cortes(pol: str, anio: int) -> list[float]:
    return _CORTES_GASES[pol] if pol in _CORTES_GASES else _CORTES_PM[etapa(anio)][pol]


# Límites de las NOM de salud. Gases en ppm, partículas en µg/m³.
LIMITES_NOM = {
    2024: {
        'O3': {'1H': 0.090, '8H': 0.060}, 'NO2': {'1H': 0.106}, 'SO2': {'1H': 0.075},
        'CO': {'1H': 26.0, '8H': 9.0}, 'PM10': {'24H': 60}, 'PM2.5': {'24H': 33},
    },
    2026: {
        'O3': {'1H': 0.090, '8H': 0.051}, 'NO2': {'1H': 0.106}, 'SO2': {'1H': 0.075},
        'CO': {'1H': 26.0, '8H': 9.0}, 'PM10': {'24H': 50}, 'PM2.5': {'24H': 25},
    },
}
LIMITES_ANUALES = {
    2024: {
        'O3': ('max_1h', 0.090), 'NO2': ('prom_24h', 0.021), 'SO2': ('max_prom24', 0.040),
        'CO': ('max_1h', 26.0), 'PM10': ('prom_24h', 28), 'PM2.5': ('prom_24h', 10),
    },
    2026: {
        'O3': ('max_1h', 0.090), 'NO2': ('prom_24h', 0.021), 'SO2': ('max_prom24', 0.040),
        'CO': ('max_1h', 26.0), 'PM10': ('prom_24h', 20), 'PM2.5': ('prom_24h', 10),
    },
}

# Numeral 5.2.4: gases a 3 decimales, CO a 2, partículas a entero.
DECIMALES = {'O3': 3, 'NO2': 3, 'SO2': 3, 'CO': 2, 'PM10': 0, 'PM2.5': 0}


# ── Redondeo y clasificación ─────────────────────────────────────────────────

def redondear(valor, decimales: int):
    """Half-up de la NOM-172 para un escalar; NaN y None dan NaN."""
    if valor is None or pd.isna(valor):
        return np.nan
    q = Decimal(str(valor)).quantize(Decimal(1).scaleb(-decimales), rounding=ROUND_HALF_UP)
    return float(q)


def redondear_serie(s: pd.Series, decimales: int) -> pd.Series:
    """
    Half-up vectorizado. El `round(.., 6)` previo absorbe el error binario
    (0.0585 × 1000 = 58.4999…) que haría bajar un 5 que debe subir.
    """
    f = 10.0 ** decimales
    x = s.astype(float).to_numpy()
    y = np.sign(x) * np.floor(np.round(np.abs(x) * f, 6) + 0.5) / f
    return pd.Series(y, index=s.index)


def clasificar(valor, pol: str, anio: int) -> int | None:
    """Índice 0–4 de la categoría, intervalos (lo, hi]; None sin valor."""
    if valor is None or pd.isna(valor):
        return None
    return int(np.searchsorted(cortes(pol, anio), valor, side='left'))


def _clasificar_serie(valores: pd.Series, anios: pd.Series, pol: str) -> pd.Series:
    cat = pd.Series(np.nan, index=valores.index)
    for anio in anios.dropna().unique():
        m = (anios == anio) & valores.notna()
        if m.any():
            cat[m] = np.searchsorted(cortes(pol, int(anio)), valores[m].to_numpy(), side='left')
    return cat


def _fraccion_en_banda(valores: pd.Series, cats: pd.Series, anios: pd.Series, pol: str) -> pd.Series:
    """
    Qué tan adentro de su banda está el valor, 0–1, como `fraccion_en_rango`
    del script: la banda Buena (sin piso) da 0 y la última (sin techo) da 1.
    """
    frac = pd.Series(0.0, index=valores.index)
    for anio in anios.dropna().unique():
        c = cortes(pol, int(anio))
        for k in range(1, 4):
            m = (anios == anio) & (cats == k)
            if m.any():
                frac[m] = (valores[m] - c[k - 1]) / (c[k] - c[k - 1])
        frac[(anios == anio) & (cats == 4)] = 1.0
    return frac


def _dominante(valores: dict[str, pd.Series], cats: dict[str, pd.Series],
               anios: pd.Series, indice) -> tuple[pd.Series, pd.Series]:
    """
    Categoría global y contaminante responsable por fila: la categoría más
    desfavorable; si empatan, la mayor fracción dentro de la banda; si sigue el
    empate, el orden conservador.
    """
    pols = [p for p in ORDEN_CONSERVADOR if p in cats]
    if not pols:
        return pd.Series(np.nan, index=indice), pd.Series(None, index=indice, dtype=object)
    n = len(indice)
    primaria = np.full((n, len(pols)), -np.inf)
    for j, p in enumerate(pols):
        c = cats[p]
        f = _fraccion_en_banda(valores[p], c, anios, p)
        primaria[:, j] = np.where(c.notna(), c.fillna(0) * 10 + f, -np.inf)
    mejor = primaria.max(axis=1)
    hay = np.isfinite(mejor)
    # Entre los empatados, el primero del orden conservador.
    empatados = np.where(primaria == mejor[:, None], np.arange(len(pols)), len(pols))
    elegido = empatados.min(axis=1)
    pol = np.array([pols[j] if h else None for j, h in zip(np.minimum(elegido, len(pols) - 1), hay)],
                   dtype=object)
    cat = np.where(hay, np.floor(mejor / 10), np.nan)
    return pd.Series(cat, index=indice), pd.Series(pol, index=indice)


# ── NowCast ──────────────────────────────────────────────────────────────────

def nowcast(valores: list, pm: int):
    """
    NowCast de la NOM-172 (función de referencia). `valores`: hasta 12 horas de
    la más vieja a la más reciente, None sin dato; `pm`: 0 PM10, 1 PM2.5.
    Devuelve entero en µg/m³ o None si no hay 2 de las 3 horas recientes.
    """
    if sum(1 for x in valores[-3:] if x is not None) < 2:
        return None
    pares = [(float(v), h) for h, v in enumerate(reversed(valores)) if v is not None]
    if len(pares) < 2:
        return None
    solo = [v for v, _ in pares]
    if all(v == 0 for v in solo):
        return 0
    v_max = max(solo)
    if v_max == 0:
        return 0
    tasa = redondear(1 - (v_max - min(solo)) / v_max, 2)
    factor = tasa if tasa >= 0.5 else 0.5
    num = sum(v * factor ** h for v, h in pares)
    den = sum(factor ** h for _, h in pares)
    if den == 0:
        return None
    prom = redondear(num / den, 0)
    return int(redondear(prom * (0.714 if pm == 0 else 0.694), 0))


def _serie_nowcast(s: pd.Series, pm: int) -> pd.Series:
    """NowCast deslizante sobre una serie YA continua en horas."""
    vals = [None if pd.isna(v) else float(v) for v in s.to_numpy()]
    out = [nowcast(vals[max(0, i - 11):i + 1], pm) for i in range(len(vals))]
    return pd.Series(out, index=s.index, dtype=float)


# ── Cumplimiento ─────────────────────────────────────────────────────────────

def _cumple(v: pd.Series, lim: pd.Series | float) -> pd.Series:
    """'Si' si v <= lim, 'No' si lo excede, None sin dato."""
    out = pd.Series(None, index=v.index, dtype=object)
    m = v.notna()
    out[m] = np.where(v[m] <= (lim[m] if isinstance(lim, pd.Series) else lim), 'Si', 'No')
    return out


def _combinar(*columnas: pd.Series) -> pd.Series:
    """'No' si alguna evaluada es 'No'; 'Si' si hay alguna y todas cumplen; None si ninguna."""
    df = pd.concat(columnas, axis=1)
    out = pd.Series(None, index=df.index, dtype=object)
    out[(df == 'Si').any(axis=1)] = 'Si'
    out[(df == 'No').any(axis=1)] = 'No'
    return out


def _limite(anios: pd.Series, pol: str, clave: str) -> pd.Series:
    """El límite que rige en el año de cada fila."""
    por_anio = {a: LIMITES_NOM[etapa(int(a))][pol][clave] for a in anios.dropna().unique()}
    return anios.map(por_anio).astype(float)


# ── Horario ──────────────────────────────────────────────────────────────────

def preparar(df: pd.DataFrame) -> pd.DataFrame:
    """
    Del conjunto validado a números: las banderas (IR, IO, ND…) pasan a NaN y
    cada fila recibe su marca de tiempo `TS` (DATE + HOUR).
    """
    d = df.copy()
    d['STATION'] = d['STATION'].astype(str).str.strip()
    fecha = pd.to_datetime(d['DATE'].astype(str).str.slice(0, 10), errors='coerce')
    d['TS'] = fecha + pd.to_timedelta(pd.to_numeric(d['HOUR'], errors='coerce'), unit='h')
    d = d.dropna(subset=['TS'])
    for c in CONTAMINANTES_BD + METEOROLOGIA:
        d[c] = pd.to_numeric(d[c], errors='coerce') if c in d.columns else np.nan
    return d[['STATION', 'TS'] + CONTAMINANTES_BD + METEOROLOGIA]


def _rejilla(g: pd.DataFrame) -> pd.DataFrame:
    """Una estación sobre todas sus horas entre la primera y la última."""
    g = g.groupby('TS').last(numeric_only=True)
    return g.reindex(pd.date_range(g.index.min(), g.index.max(), freq='h'))


def _indicadores_horarios(r: pd.DataFrame) -> pd.DataFrame:
    """Indicadores, índice y cumplimiento de una estación ya en rejilla."""
    anios = pd.Series(r.index.year, index=r.index)

    r['PM10_NOWCAST'] = _serie_nowcast(r['PM10'], 0)
    r['PM2.5_NOWCAST'] = _serie_nowcast(r['PM2.5'], 1)
    for pm in ('PM10', 'PM2.5'):
        r[f'{pm}_24H'] = redondear_serie(r[pm].rolling(24, min_periods=18).mean(), 0)
    r['CO_8H'] = redondear_serie(r['CO'].rolling(8, min_periods=6).mean(), 2)
    r['O3_8H'] = redondear_serie(r['O3'].rolling(8, min_periods=6).mean(), 3)
    for g in ('O3', 'NO2', 'SO2', 'CO'):
        r[f'{g}_1H'] = redondear_serie(r[g], DECIMALES[g])

    fuente = {'PM10': 'PM10_NOWCAST', 'PM2.5': 'PM2.5_NOWCAST', 'CO': 'CO_8H',
              'O3': 'O3_1H', 'NO2': 'NO2_1H', 'SO2': 'SO2_1H'}
    valores, cats = {}, {}
    for pol, col in fuente.items():
        valores[pol] = r[col]
        cats[pol] = _clasificar_serie(r[col], anios, pol)
        r[f'IAS_{pol}_VALOR'] = r[col]
        r[f'IAS_{pol}_CAT'] = cats[pol].map(lambda c: CATEGORIAS[int(c)] if pd.notna(c) else None)
    cat, pol = _dominante(valores, cats, anios, r.index)
    r['IAS_GLOBAL_CAT'] = cat.map(lambda c: CATEGORIAS[int(c)] if pd.notna(c) else None)
    r['IAS_GLOBAL_POL'] = pol

    r['NOM_O3_1H_CUMPLE'] = _cumple(r['O3_1H'], _limite(anios, 'O3', '1H'))
    r['NOM_O3_8H_CUMPLE'] = _cumple(r['O3_8H'], _limite(anios, 'O3', '8H'))
    r['NOM_O3_CUMPLE'] = _combinar(r['NOM_O3_1H_CUMPLE'], r['NOM_O3_8H_CUMPLE'])
    r['NOM_NO2_1H_CUMPLE'] = _cumple(r['NO2_1H'], _limite(anios, 'NO2', '1H'))
    r['NOM_SO2_1H_CUMPLE'] = _cumple(r['SO2_1H'], _limite(anios, 'SO2', '1H'))
    r['NOM_CO_1H_CUMPLE'] = _cumple(r['CO_1H'], _limite(anios, 'CO', '1H'))
    r['NOM_CO_8H_CUMPLE'] = _cumple(r['CO_8H'], _limite(anios, 'CO', '8H'))
    r['NOM_CO_CUMPLE'] = _combinar(r['NOM_CO_1H_CUMPLE'], r['NOM_CO_8H_CUMPLE'])
    r['NOM_PM10_24H_CUMPLE'] = _cumple(r['PM10_24H'], _limite(anios, 'PM10', '24H'))
    r['NOM_PM2.5_24H_CUMPLE'] = _cumple(r['PM2.5_24H'], _limite(anios, 'PM2.5', '24H'))
    r['NOM_GLOBAL_CUMPLE'] = _combinar(
        r['NOM_O3_CUMPLE'], r['NOM_NO2_1H_CUMPLE'], r['NOM_SO2_1H_CUMPLE'],
        r['NOM_CO_CUMPLE'], r['NOM_PM10_24H_CUMPLE'], r['NOM_PM2.5_24H_CUMPLE'])
    return r


def calcular_horario(df_validado: pd.DataFrame) -> pd.DataFrame:
    """
    Tabla horaria por estación, más la estación virtual AMG (máximo horario de
    cada contaminante entre estaciones), cada una sobre su rejilla continua.
    """
    d = preparar(df_validado)
    if d.empty:
        return pd.DataFrame()

    bloques = []
    for est, g in d.groupby('STATION', sort=True):
        if est == AMG:
            continue
        r = _indicadores_horarios(_rejilla(g))
        r.insert(0, 'STATION', est)
        bloques.append(r)

    amg = d[d['STATION'] != AMG].groupby('TS')[CONTAMINANTES_BD].max(min_count=1)
    amg = amg.reindex(pd.date_range(amg.index.min(), amg.index.max(), freq='h'))
    for m in METEOROLOGIA:
        amg[m] = np.nan
    amg = _indicadores_horarios(amg)
    amg.insert(0, 'STATION', AMG)
    bloques.append(amg)

    h = pd.concat(bloques)
    h.index.name = 'TS'
    h = h.reset_index()
    h.insert(1, 'DATE', h['TS'].dt.strftime('%Y-%m-%d'))
    h.insert(2, 'HOUR', h['TS'].dt.hour)
    return h


# ── Diario ───────────────────────────────────────────────────────────────────

def _diaria_por_estacion(h: pd.DataFrame) -> pd.DataFrame:
    """Métricas diarias de cada estación (sin AMG), con suficiencia 18/24."""
    h = h[h['STATION'] != AMG]
    grupos = h.groupby(['STATION', 'DATE'], sort=True)
    d = pd.DataFrame(index=grupos.size().index)

    for pol in CONTAMINANTES:
        hv = grupos[pol].count()
        suf = hv >= SUF_MIN_HORAS
        d[f'{pol}_HORAS_VALIDAS'] = hv
        d[f'{pol}_SUF_DIARIA'] = suf
        d[f'{pol}_AVG_24H'] = redondear_serie(grupos[pol].mean(), DECIMALES[pol]).where(suf)
        d[f'{pol}_MAX_1H'] = redondear_serie(grupos[pol].max(), DECIMALES[pol]).where(suf)

    # Corrección 5: el máximo de 8 h solo vale si el día tiene suficiencia.
    d['O3_MAX_8H'] = grupos['O3_8H'].max().where(d['O3_SUF_DIARIA'])
    d['CO_MAX_8H'] = grupos['CO_8H'].max().where(d['CO_SUF_DIARIA'])
    # Informativo, como en el script: no entra al global.
    d['PM10_NOWCAST_MAX'] = grupos['PM10_NOWCAST'].max()
    d['PM2.5_NOWCAST_MAX'] = grupos['PM2.5_NOWCAST'].max()

    d = d.reset_index().rename(columns={'DATE': 'FECHA'})
    d['FECHA'] = pd.to_datetime(d['FECHA'])
    # Un día que solo existe por la rejilla y no tiene ni un dato no es un día.
    con_dato = d[[f'{p}_HORAS_VALIDAS' for p in CONTAMINANTES]].sum(axis=1) > 0
    return d[con_dato].reset_index(drop=True)


_METRICAS = ('_AVG_24H', '_MAX_1H', '_MAX_8H', '_NOWCAST_MAX')


def _amg_diario(dfd: pd.DataFrame) -> pd.DataFrame:
    """AMG diario: el máximo diario de cada métrica entre estaciones."""
    cols = [c for c in dfd.columns if c.endswith(_METRICAS)]
    base = dfd.groupby('FECHA')[cols].max(min_count=1).reset_index()
    for pol in CONTAMINANTES:
        ref = (f'{pol}_MAX_8H' if pol == 'CO' else
               f'{pol}_AVG_24H' if pol in ('PM10', 'PM2.5') else f'{pol}_MAX_1H')
        base[f'{pol}_SUF_DIARIA'] = base[ref].notna()
    base.insert(0, 'STATION', AMG)
    return base


def banderas_nom_diarias(dfd: pd.DataFrame) -> pd.DataFrame:
    dfd = dfd.copy()
    anios = dfd['FECHA'].dt.year

    def evaluar(pol, pares):
        """Cumplimiento del día con las métricas que haya, solo con suficiencia."""
        partes = [_cumple(dfd[col], _limite(anios, pol, clave)) for col, clave in pares if col in dfd]
        r = _combinar(*partes)
        r[~dfd[f'{pol}_SUF_DIARIA'].fillna(False).astype(bool)] = None
        return r

    dfd['NOM_O3_CUMPLE'] = evaluar('O3', [('O3_MAX_1H', '1H'), ('O3_MAX_8H', '8H')])
    dfd['NOM_NO2_CUMPLE'] = evaluar('NO2', [('NO2_MAX_1H', '1H')])
    dfd['NOM_SO2_CUMPLE'] = evaluar('SO2', [('SO2_MAX_1H', '1H')])
    dfd['NOM_CO_CUMPLE'] = evaluar('CO', [('CO_MAX_1H', '1H'), ('CO_MAX_8H', '8H')])
    dfd['NOM_PM10_CUMPLE'] = evaluar('PM10', [('PM10_AVG_24H', '24H')])
    dfd['NOM_PM2.5_CUMPLE'] = evaluar('PM2.5', [('PM2.5_AVG_24H', '24H')])
    dfd['NOM_PM10_NOWCAST_CUMPLE'] = evaluar('PM10', [('PM10_NOWCAST_MAX', '24H')])
    dfd['NOM_PM2.5_NOWCAST_CUMPLE'] = evaluar('PM2.5', [('PM2.5_NOWCAST_MAX', '24H')])
    dfd['NOM_GLOBAL_CUMPLE'] = _combinar(*[dfd[f'NOM_{p}_CUMPLE'] for p in CONTAMINANTES])
    return dfd


FUENTE_IAS_DIARIA = {'PM10': 'PM10_AVG_24H', 'PM2.5': 'PM2.5_AVG_24H', 'CO': 'CO_MAX_8H',
                     'O3': 'O3_MAX_1H', 'NO2': 'NO2_MAX_1H', 'SO2': 'SO2_MAX_1H'}


def ias_diario(dfd: pd.DataFrame) -> pd.DataFrame:
    dfd = dfd.copy()
    anios = dfd['FECHA'].dt.year
    valores, cats = {}, {}
    for pol, col in FUENTE_IAS_DIARIA.items():
        valores[pol] = redondear_serie(dfd[col], DECIMALES[pol])
        cats[pol] = _clasificar_serie(valores[pol], anios, pol)
        dfd[f'IAS_{pol}_VALOR_DIA'] = valores[pol]
        dfd[f'IAS_{pol}_CAT_DIA'] = cats[pol].map(lambda c: CATEGORIAS[int(c)] if pd.notna(c) else None)
    for pm in ('PM10', 'PM2.5'):
        c = _clasificar_serie(dfd[f'{pm}_NOWCAST_MAX'], anios, pm)
        dfd[f'IAS_{pm}_NOWCAST_CAT_DIA'] = c.map(lambda x: CATEGORIAS[int(x)] if pd.notna(x) else None)
    cat, pol = _dominante(valores, cats, anios, dfd.index)
    dfd['IAS_GLOBAL_POL_DIA'] = pol
    dfd['IAS_GLOBAL_CAT_DIA'] = cat.map(lambda c: CATEGORIAS[int(c)] if pd.notna(c) else None)
    dfd['IAS_GLOBAL_SCORE_DIA'] = cat + 1
    return dfd


def calcular_diario(h: pd.DataFrame) -> pd.DataFrame:
    """Tabla diaria por estación y AMG, con cumplimiento NOM e índice diario."""
    dfd = _diaria_por_estacion(h)
    if dfd.empty:
        return dfd
    todo = pd.concat([dfd, _amg_diario(dfd)], ignore_index=True, sort=False)
    todo = todo.sort_values(['STATION', 'FECHA']).reset_index(drop=True)
    return ias_diario(banderas_nom_diarias(todo))


# ── Municipios ───────────────────────────────────────────────────────────────

def calcular_municipios(dfd: pd.DataFrame) -> pd.DataFrame:
    """
    Un día por municipio con el máximo diario de las estaciones de su área de
    influencia; NOM e índice se recalculan sobre ese máximo.
    """
    est = dfd[dfd['STATION'] != AMG]
    if est.empty:
        return pd.DataFrame()
    fechas = pd.date_range(est['FECHA'].min(), est['FECHA'].max(), freq='D')
    metricas = [c for c in est.columns if c.endswith(_METRICAS)]
    sufs = [f'{p}_SUF_DIARIA' for p in CONTAMINANTES]
    horas_validas = [f'{p}_HORAS_VALIDAS' for p in CONTAMINANTES]
    est = est.assign(**{s: est[s].fillna(False).astype(bool) for s in sufs})
    peor = _orden_de_peor(est)

    bloques = []
    for municipio, estaciones in ESTACIONES_POR_MUNICIPIO.items():
        g = est[est['STATION'].isin(estaciones)].groupby('FECHA')
        m = pd.concat([g[metricas].max(), g[sufs].any(), g[horas_validas].max()], axis=1)
        m['ESTACION_IAS_GLOBAL_MAX'] = (peor[peor['STATION'].isin(estaciones)]
                                        .groupby('FECHA')['STATION'].first())
        m = m.reindex(fechas)
        m[sufs] = m[sufs].fillna(False).astype(bool)
        m.index.name = 'FECHA'
        m = m.reset_index()
        m.insert(0, 'MUNICIPIO', municipio)
        m.insert(2, 'FECHA_INICIO_PERIODO', fechas[0])
        m.insert(3, 'FECHA_FIN_PERIODO', fechas[-1])
        m.insert(4, 'ESTACIONES_AREA_INFLUENCIA', ', '.join(estaciones))
        bloques.append(m)
    m = pd.concat(bloques, ignore_index=True)
    m = ias_diario(banderas_nom_diarias(m))
    return m.sort_values(['MUNICIPIO', 'FECHA']).reset_index(drop=True)


def _orden_de_peor(est: pd.DataFrame) -> pd.DataFrame:
    """
    Estaciones con índice diario, ordenadas de peor a mejor dentro de cada
    fecha: categoría, fracción dentro de la banda y, al final, nombre. La
    primera de cada fecha y grupo es la «ESTACION_IAS_GLOBAL_MAX».
    """
    g = est[est['IAS_GLOBAL_SCORE_DIA'].notna()]
    anios = g['FECHA'].dt.year
    frac = pd.Series(0.0, index=g.index)
    for pol in CONTAMINANTES:
        m = g['IAS_GLOBAL_POL_DIA'] == pol
        if m.any():
            cats = g.loc[m, 'IAS_GLOBAL_SCORE_DIA'] - 1
            frac[m] = _fraccion_en_banda(g.loc[m, f'IAS_{pol}_VALOR_DIA'], cats, anios[m], pol)
    return g.assign(_f=frac).sort_values(['FECHA', 'IAS_GLOBAL_SCORE_DIA', '_f', 'STATION'],
                                         ascending=[True, False, False, True])


# ── Resúmenes ────────────────────────────────────────────────────────────────

def _dias_anio(anio: int) -> int:
    return 366 if pd.Timestamp(anio, 12, 31).is_leap_year else 365


def resumen_anual_contaminante(dfd: pd.DataFrame, clave: str = 'STATION') -> pd.DataFrame:
    """Por estación (o municipio), año y contaminante. Porcentajes sobre el año, como el script."""
    dfd = dfd.assign(ANIO=dfd['FECHA'].dt.year)
    filas = []
    for (est, anio), g in dfd.groupby([clave, 'ANIO'], sort=True):
        dias_anio = _dias_anio(int(anio))
        for pol in CONTAMINANTES:
            validos = int(g[f'{pol}_SUF_DIARIA'].fillna(False).astype(bool).sum())
            pct_valid = redondear(100 * validos / dias_anio, 2)
            nom = g[f'NOM_{pol}_CUMPLE']
            si, no = int((nom == 'Si').sum()), int((nom == 'No').sum())
            cats = g.loc[g[f'{pol}_SUF_DIARIA'].fillna(False).astype(bool), f'IAS_{pol}_CAT_DIA'].value_counts()
            max_1h = g[f'{pol}_MAX_1H'].max()
            prom = redondear(g[f'{pol}_AVG_24H'].mean(), DECIMALES[pol])
            tipo, lim = LIMITES_ANUALES[etapa(int(anio))][pol]
            ref = {'max_1h': max_1h, 'prom_24h': prom, 'max_prom24': g[f'{pol}_AVG_24H'].max()}[tipo]
            filas.append({
                clave: est, 'ANIO': int(anio), 'CONTAMINANTE': pol,
                'DIAS_VALIDOS': validos, 'DIAS_ANIO': dias_anio, 'DIAS_PERIODO': len(g),
                '%VALIDOS': pct_valid, 'SUFICIENCIA_ANUAL': 'Si' if pct_valid >= 75 else 'No',
                'DIAS_IAS_BUENA': int(cats.get('Buena', 0)),
                'DIAS_IAS_ACEPTABLE': int(cats.get('Aceptable', 0)),
                'DIAS_IAS_MALA': int(cats.get('Mala', 0)),
                'DIAS_IAS_MUY_MALA': int(cats.get('Muy mala', 0)),
                'DIAS_IAS_EXTREMADAMENTE_MALA': int(cats.get('Extremadamente mala', 0)),
                'MAX_HORARIO': max_1h, 'PROM_ANUAL': prom,
                'DIAS_CUMPLE_NOM': si, '%CUMPLE_NOM': redondear(100 * si / dias_anio, 2),
                'DIAS_NO_CUMPLE_NOM': no, '%NO_CUMPLE_NOM': redondear(100 * no / dias_anio, 2),
                'NOM_ANUAL_LIMITE': lim, 'NOM_ANUAL_CRITERIO': tipo,
                'NOM_ANUAL_CUMPLE': None if pd.isna(ref) else ('Si' if ref <= lim else 'No'),
            })
    return pd.DataFrame(filas)


def resumen_anual_global(dfd: pd.DataFrame, clave: str = 'STATION') -> pd.DataFrame:
    """Índice global y NOM global por estación (o municipio) y año, sobre los días del periodo."""
    dfd = dfd.assign(ANIO=dfd['FECHA'].dt.year)
    filas = []
    for (est, anio), g in dfd.groupby([clave, 'ANIO'], sort=True):
        n = len(g)
        cont = g['IAS_GLOBAL_CAT_DIA'].value_counts()
        c = [int(cont.get(k, 0)) for k in CATEGORIAS]
        di = n - sum(c)
        si = int((g['NOM_GLOBAL_CUMPLE'] == 'Si').sum())
        no = int((g['NOM_GLOBAL_CUMPLE'] == 'No').sum())
        pct = lambda x: redondear(100 * x / n, 2)  # noqa: E731
        filas.append({
            clave: est, 'ANIO': int(anio), 'DIAS_ANIO': _dias_anio(int(anio)), 'DIAS_PERIODO': n,
            'DIAS_IAS_BUENA': c[0], 'DIAS_IAS_ACEPTABLE': c[1], 'DIAS_IAS_MALA': c[2],
            'DIAS_IAS_MUY_MALA': c[3], 'DIAS_IAS_EXTREMADAMENTE_MALA': c[4], 'DIAS_IAS_DI': di,
            '%IAS_BUENA': pct(c[0]), '%IAS_ACEPTABLE': pct(c[1]), '%IAS_MALA': pct(c[2]),
            '%IAS_MUY_MALA': pct(c[3]), '%IAS_EXTREMADAMENTE_MALA': pct(c[4]), '%IAS_DI': pct(di),
            'DIAS_NOM_SI': si, 'DIAS_NOM_NO': no, 'DIAS_NOM_DI': n - si - no,
            '%NOM_SI': pct(si), '%NOM_NO': pct(no), '%NOM_DI': pct(n - si - no),
        })
    return pd.DataFrame(filas)


_MIDE = {'IAS_GLOBAL_CAT_DIA': 'IAS_GLOBAL_CAT_DIA_BUENA_ACEPTABLE',
         'IAS_O3_CAT_DIA': 'IAS_O3_CAT_DIA_BUENA_ACEPTABLE',
         'IAS_PM10_CAT_DIA': 'IAS_PM10_CAT_DIA_BUENA_ACEPTABLE',
         'IAS_PM2.5_CAT_DIA': 'IAS_PM2.5_CAT_DIA_BUENA_ACEPTABLE'}


def _conteo_mide(g: pd.DataFrame) -> dict:
    return {salida: int(g[col].isin(['Buena', 'Aceptable']).sum()) for col, salida in _MIDE.items()}


def mide(dfd: pd.DataFrame) -> pd.DataFrame:
    """Días Buena + Aceptable por mes en el AMG (formato del script: 12 meses + TOTAL)."""
    g = dfd[dfd['STATION'] == AMG] if (dfd['STATION'] == AMG).any() else dfd
    filas = [{'MES': nombre, **_conteo_mide(g[g['FECHA'].dt.month == i])}
             for i, nombre in enumerate(MESES_ES, start=1)]
    filas.append({'MES': 'TOTAL', **{k: sum(f[k] for f in filas) for k in _MIDE.values()}})
    return pd.DataFrame(filas)


def mide_municipio(dfm: pd.DataFrame) -> pd.DataFrame:
    if dfm.empty:
        return pd.DataFrame()
    municipios = sorted(dfm['MUNICIPIO'].unique())
    filas = [{'MUNICIPIO': m, 'MES': nombre,
              **_conteo_mide(dfm[(dfm['MUNICIPIO'] == m) & (dfm['FECHA'].dt.month == i)])}
             for i, nombre in enumerate(MESES_ES, start=1) for m in municipios]
    filas += [{'MUNICIPIO': m, 'MES': 'TOTAL', **_conteo_mide(dfm[dfm['MUNICIPIO'] == m])}
              for m in municipios]
    return pd.DataFrame(filas)


# ── Exportación ──────────────────────────────────────────────────────────────

COLUMNAS_HORARIO = [
    'STATION', 'DATE', 'HOUR', *CONTAMINANTES_BD, *METEOROLOGIA,
    'PM10_NOWCAST', 'PM10_24H', 'PM2.5_NOWCAST', 'PM2.5_24H', 'CO_8H', 'O3_8H',
    'IAS_PM10_CAT', 'IAS_PM2.5_CAT', 'IAS_CO_CAT', 'IAS_O3_CAT', 'IAS_NO2_CAT', 'IAS_SO2_CAT',
    'IAS_GLOBAL_CAT', 'IAS_GLOBAL_POL',
    'NOM_O3_CUMPLE', 'NOM_CO_CUMPLE', 'NOM_NO2_1H_CUMPLE', 'NOM_SO2_1H_CUMPLE',
    'NOM_PM10_24H_CUMPLE', 'NOM_PM2.5_24H_CUMPLE', 'NOM_GLOBAL_CUMPLE',
]

COLUMNAS_DIARIO = [
    'STATION', 'FECHA',
    *[f'{p}_HORAS_VALIDAS' for p in CONTAMINANTES], *[f'{p}_SUF_DIARIA' for p in CONTAMINANTES],
    'O3_AVG_24H', 'O3_MAX_1H', 'O3_MAX_8H', 'NO2_AVG_24H', 'NO2_MAX_1H',
    'SO2_AVG_24H', 'SO2_MAX_1H', 'CO_AVG_24H', 'CO_MAX_1H', 'CO_MAX_8H',
    'PM10_AVG_24H', 'PM10_MAX_1H', 'PM10_NOWCAST_MAX',
    'PM2.5_AVG_24H', 'PM2.5_MAX_1H', 'PM2.5_NOWCAST_MAX',
    *[f'NOM_{p}_CUMPLE' for p in CONTAMINANTES],
    'NOM_PM10_NOWCAST_CUMPLE', 'NOM_PM2.5_NOWCAST_CUMPLE', 'NOM_GLOBAL_CUMPLE',
    'IAS_PM10_CAT_DIA', 'IAS_PM2.5_CAT_DIA', 'IAS_O3_CAT_DIA', 'IAS_NO2_CAT_DIA',
    'IAS_SO2_CAT_DIA', 'IAS_CO_CAT_DIA', 'IAS_PM10_NOWCAST_CAT_DIA', 'IAS_PM2.5_NOWCAST_CAT_DIA',
    'IAS_GLOBAL_POL_DIA', 'IAS_GLOBAL_CAT_DIA',
]


def exportar_horario(h: pd.DataFrame, ruta: str) -> None:
    with pd.ExcelWriter(ruta, engine='openpyxl') as w:
        h[[c for c in COLUMNAS_HORARIO if c in h.columns]].to_excel(w, sheet_name='Data+IAS', index=False)


def exportar_diario(dfd: pd.DataFrame, ruta: str) -> None:
    """Las 8 hojas del script, en el mismo orden y con los mismos nombres."""
    dfm = calcular_municipios(dfd)
    cols = [c for c in COLUMNAS_DIARIO if c in dfd.columns]
    cols_mun = ['MUNICIPIO', 'FECHA', 'FECHA_INICIO_PERIODO', 'FECHA_FIN_PERIODO',
                'ESTACIONES_AREA_INFLUENCIA', 'ESTACION_IAS_GLOBAL_MAX',
                *[c for c in cols if c != 'STATION']]
    with pd.ExcelWriter(ruta, engine='openpyxl') as w:
        dfd[cols].to_excel(w, sheet_name='Data_Diaria', index=False)
        resumen_anual_contaminante(dfd).to_excel(w, sheet_name='Resumen_Anual_Contam', index=False)
        resumen_anual_global(dfd).to_excel(w, sheet_name='Resumen_Anual_Estacion', index=False)
        if not dfm.empty:
            dfm[[c for c in cols_mun if c in dfm.columns]].to_excel(
                w, sheet_name='Data_Diaria_Municipio', index=False)
            resumen_anual_contaminante(dfm, 'MUNICIPIO').to_excel(
                w, sheet_name='Resumen_Anual_Mun_Contam', index=False)
            resumen_anual_global(dfm, 'MUNICIPIO').to_excel(
                w, sheet_name='Resumen_Anual_Municipio', index=False)
        mide(dfd).to_excel(w, sheet_name='MIDE', index=False)
        mide_municipio(dfm).to_excel(w, sheet_name='MIDE-municipio', index=False)
