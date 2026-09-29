"""
Histórico de mediciones en SQLite (base local de la app de escritorio).

Por qué existe
--------------
Todo lo demás del validador trabaja sobre el periodo que se acaba de cargar y
lo olvida al cerrar. Comparar 2024 contra 2025 obligaba a volver a bajar los
dos años, y no había forma de saber si el SIMAJ o la API habían cambiado un
dato desde la última vez que se miró: una recalibración o una corrección
posterior se colaban sin que nadie se enterara.

Aquí se guarda cada hora de cada estación y parámetro. Al volver a cargar un
periodo, se compara contra lo guardado **antes** de escribir, y el usuario
decide si actualiza: los datos nuevos se añaden, los que cambiaron se ven uno
por uno (antes y ahora) y quedan anotados en `cambios`, para poder saber
después qué se corrigió y cuándo.

Solo en la app de escritorio
----------------------------
Se activa cuando la app de Electron pasa la ruta del archivo en
`VALIDADOR_HISTORICO`. En el servidor web no hay variable y el histórico no
existe: la base es de quien usa la computadora, y compartirla entre varias
personas por la web pide otra cosa (usuarios, permisos, concurrencia).

Formato
-------
Una fila por estación, fecha, hora y parámetro (formato largo): así comparar
un dato con el guardado es comparar una fila con otra, y un parámetro nuevo no
pide cambiar el esquema. El valor numérico va en `valor`; si la celda traía
una bandera ('IR', 'ND'...) en lugar de número, va en `bandera` con `valor`
nulo. Las celdas 'SE' (sin equipo) no se guardan: no son un dato ni un hueco,
son la ausencia del instrumento.
"""

from __future__ import annotations

import os
import sqlite3
import threading
import uuid

import numpy as np
import pandas as pd

import horario

PARAMETROS = ['O3', 'NO', 'NO2', 'NOX', 'SO2', 'CO', 'PM10', 'PM2.5',
              'IT', 'ET', 'RH', 'WS', 'WD', 'PP', 'ATM', 'RS', 'UVI']

# Diferencia por debajo de la cual dos valores se consideran el mismo. Los
# datos llegan redondeados a 3–4 decimales; esto solo absorbe el ruido de la
# conversión a float, no oculta correcciones reales.
TOLERANCIA = 1e-9

# Cambios que se devuelven para revisar en pantalla. El total va aparte: con
# miles de cambios la tabla deja de servir y lo que importa es el resumen.
MUESTRA_CAMBIOS = 500

ESQUEMA = """
CREATE TABLE IF NOT EXISTS mediciones (
    estacion   TEXT NOT NULL,
    parametro  TEXT NOT NULL,
    fecha      TEXT NOT NULL,          -- AAAA-MM-DD
    hora       INTEGER NOT NULL,       -- 0–23
    valor      REAL,
    bandera    TEXT,
    origen     TEXT,
    actualizado TEXT NOT NULL,
    -- Fecha primero: la tabla queda ordenada en el disco por fecha, y leer un
    -- mes es leer un tramo seguido, sin importar cuántos años haya guardados.
    PRIMARY KEY (fecha, hora, estacion, parametro)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_mediciones_param_fecha ON mediciones (parametro, fecha);

CREATE TABLE IF NOT EXISTS cargas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha       TEXT NOT NULL,
    origen      TEXT,
    descripcion TEXT,
    desde       TEXT,
    hasta       TEXT,
    nuevos      INTEGER NOT NULL,
    cambiados   INTEGER NOT NULL,
    iguales     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cambios (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    carga_id          INTEGER NOT NULL REFERENCES cargas(id),
    estacion          TEXT NOT NULL,
    parametro         TEXT NOT NULL,
    fecha             TEXT NOT NULL,
    hora              INTEGER NOT NULL,
    valor_anterior    REAL,
    bandera_anterior  TEXT,
    valor_nuevo       REAL,
    bandera_nueva     TEXT
);

CREATE INDEX IF NOT EXISTS idx_cambios_carga ON cambios (carga_id);

-- Cambios detectados en una descarga automático (API de Emisiones, mes a mes)
-- que esperan a que el usuario los revise. La descarga mete lo nuevo solo,
-- pero nunca pisa un dato guardado sin que alguien lo vea.
CREATE TABLE IF NOT EXISTS pendientes (
    estacion          TEXT NOT NULL,
    parametro         TEXT NOT NULL,
    fecha             TEXT NOT NULL,
    hora              INTEGER NOT NULL,
    valor_anterior    REAL,
    bandera_anterior  TEXT,
    valor_nuevo       REAL,
    bandera_nueva     TEXT,
    origen            TEXT,
    detectado         TEXT NOT NULL,
    PRIMARY KEY (estacion, parametro, fecha, hora)
) WITHOUT ROWID;
"""

CLAVE = ['estacion', 'parametro', 'fecha', 'hora']
# El orden de la tabla en el disco. Insertar en este orden es varias veces más
# rápido que en desorden: SQLite escribe páginas seguidas.
ORDEN_DISCO = ['fecha', 'hora', 'estacion', 'parametro']

# La base cubre de aquí en adelante. Más atrás no se guarda ni se consulta:
# acota el tamaño del archivo y lo que se puede pedir de una vez.
FECHA_MINIMA = '2024-01-01'


def acotar(desde: str, hasta: str) -> tuple[str, str]:
    """El rango [desde, hasta) recortado a FECHA_MINIMA … mañana."""
    manana = (horario.ahora() + pd.Timedelta(days=1)).strftime('%Y-%m-%d')
    return max(desde, FECHA_MINIMA), min(hasta, manana)

_candado = threading.Lock()


def ruta_configurada() -> str | None:
    """La ruta del archivo si la app de escritorio la pasó; si no, None."""
    ruta = os.environ.get('VALIDADOR_HISTORICO', '').strip()
    return ruta or None


def conectar(ruta: str) -> sqlite3.Connection:
    """Abre (y crea si hace falta) la base. Una conexión por petición."""
    os.makedirs(os.path.dirname(os.path.abspath(ruta)), exist_ok=True)
    con = sqlite3.connect(ruta, timeout=30)
    # WAL: leer para una gráfica mientras se escribe una carga no bloquea.
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('PRAGMA synchronous=NORMAL')
    _migrar_orden(con)
    con.executescript(ESQUEMA)
    return con


def _migrar_orden(con: sqlite3.Connection) -> None:
    """
    Las primeras bases se crearon con la clave (estacion, parametro, fecha,
    hora). Se reordenan una sola vez a la clave por fecha: mismos datos, pero
    leer un periodo deja de recorrer el archivo entero.
    """
    columnas = con.execute('PRAGMA table_info(mediciones)').fetchall()
    if not columnas:
        return
    clave = [c[1] for c in sorted(columnas, key=lambda c: c[5]) if c[5]]
    if clave[:1] == ['fecha']:
        return
    with con:
        con.execute('ALTER TABLE mediciones RENAME TO mediciones_vieja')
        con.execute('DROP INDEX IF EXISTS idx_mediciones_param_fecha')
        con.executescript(ESQUEMA)
        con.execute('INSERT INTO mediciones SELECT estacion, parametro, fecha, hora, valor, '
                    'bandera, origen, actualizado FROM mediciones_vieja ORDER BY fecha, hora, '
                    'estacion, parametro')
        con.execute('DROP TABLE mediciones_vieja')


# ── Conversión ──────────────────────────────────────────────────────────────

def _fecha(valor) -> str | None:
    """'2026-09-10 00:00:00', Timestamp o date → '2026-09-10'."""
    if valor is None or (isinstance(valor, float) and np.isnan(valor)):
        return None
    texto = str(valor).strip()
    if len(texto) >= 10 and texto[4] == '-' and texto[7] == '-':
        return texto[:10]
    try:
        return pd.to_datetime(texto).strftime('%Y-%m-%d')
    except Exception:
        return None


def a_largo(df: pd.DataFrame) -> pd.DataFrame:
    """
    El conjunto validado (una columna por parámetro) en filas de la base.

    Devuelve columnas estacion, parametro, fecha, hora, valor, bandera. Una
    clave repetida —el mismo archivo trae dos veces una hora— se queda con la
    última aparición, igual que haría una actualización.
    """
    columnas = ['estacion', 'parametro', 'fecha', 'hora', 'valor', 'bandera']
    if df is None or df.empty or 'STATION' not in df.columns:
        return pd.DataFrame(columns=columnas)

    params = [p for p in PARAMETROS if p in df.columns]
    base = pd.DataFrame({
        'estacion': df['STATION'].astype(str).str.strip(),
        'fecha': df['DATE'].map(_fecha),
        'hora': pd.to_numeric(df['HOUR'], errors='coerce'),
    })
    base[params] = df[params].values
    largo = base.melt(id_vars=['estacion', 'fecha', 'hora'], value_vars=params,
                      var_name='parametro', value_name='celda')
    largo = largo.dropna(subset=['fecha', 'hora'])
    largo['hora'] = largo['hora'].astype(int)

    numero = pd.to_numeric(largo['celda'], errors='coerce')
    texto = largo['celda'].where(numero.isna()).astype('string').str.strip()
    texto = texto.where(texto.notna() & (texto != '') & (texto != 'nan'))

    largo['valor'] = numero
    largo['bandera'] = texto
    # Vacío del todo o sin equipo: no hay nada que guardar.
    largo = largo[(largo['valor'].notna() | largo['bandera'].notna())
                  & (largo['bandera'].fillna('') != 'SE')]
    largo = largo.drop_duplicates(subset=CLAVE, keep='last')
    return largo[columnas].reset_index(drop=True)


# ── Análisis y actualización ────────────────────────────────────────────────

# Lo analizado espera aquí a que el usuario decida. Solo uno a la vez: es un
# proceso de escritorio con un único usuario.
_pendiente: dict = {}


def _guardado_en_rango(con: sqlite3.Connection, largo: pd.DataFrame) -> pd.DataFrame:
    """Las filas de la base que podrían coincidir con las recién cargadas."""
    estaciones = sorted(largo['estacion'].unique())
    marcas = ','.join('?' * len(estaciones))
    consulta = (f'SELECT estacion, parametro, fecha, hora, valor, bandera FROM mediciones '
                f'WHERE estacion IN ({marcas}) AND fecha BETWEEN ? AND ?')
    return pd.read_sql_query(
        consulta, con,
        params=[*estaciones, largo['fecha'].min(), largo['fecha'].max()],
    )


def _distinto(a_val, a_ban, b_val, b_ban) -> pd.Series:
    ambos_num = a_val.notna() & b_val.notna()
    val_dif = (a_val.isna() != b_val.isna()) | (ambos_num & ((a_val - b_val).abs() > TOLERANCIA))
    ban_dif = a_ban.fillna('') != b_ban.fillna('')
    return val_dif | ban_dif


def _limpio(v):
    """NaN y NA de pandas a None, para JSON y SQLite."""
    if v is None or v is pd.NA:
        return None
    if isinstance(v, float) and np.isnan(v):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    return v


def _comparar(con: sqlite3.Connection, df: pd.DataFrame):
    """(largo, nuevos, cambiados, iguales) del conjunto frente a lo guardado."""
    largo = a_largo(df)
    largo = largo[largo['fecha'] >= FECHA_MINIMA]
    if largo.empty:
        return largo, largo, largo, 0

    guardado = _guardado_en_rango(con, largo)
    unido = largo.merge(guardado, on=CLAVE, how='left', suffixes=('', '_ant'),
                        indicator=True)
    es_nuevo = unido['_merge'] == 'left_only'
    existentes = unido[~es_nuevo]
    cambia = _distinto(existentes['valor'], existentes['bandera'],
                       existentes['valor_ant'], existentes['bandera_ant'])
    return (largo, unido[es_nuevo][largo.columns], existentes[cambia],
            int((~cambia).sum()))


def analizar(con: sqlite3.Connection, df: pd.DataFrame, origen: str | None,
             descripcion: str | None) -> dict:
    """
    Compara el conjunto cargado contra lo guardado, sin escribir nada.

    Devuelve el resumen (nuevos, cambiados, iguales), el desglose de los
    cambios por estación y parámetro, y una muestra de ellos con el valor de
    antes y el de ahora. El resultado completo queda pendiente con un `id`
    hasta que se aplica o se descarta.
    """
    largo, nuevos, cambiados, iguales = _comparar(con, df)
    if largo.empty:
        return {'id': None, 'total': 0, 'nuevos': 0, 'cambiados': 0, 'iguales': 0,
                'desde': None, 'hasta': None, 'por_parametro': [], 'por_estacion': [],
                'muestra': []}

    ident = uuid.uuid4().hex
    with _candado:
        _pendiente.clear()
        _pendiente[ident] = {
            'nuevos': nuevos.reset_index(drop=True),
            'cambiados': cambiados.reset_index(drop=True),
            'iguales': iguales,
            'origen': origen,
            'descripcion': descripcion,
            'desde': largo['fecha'].min(),
            'hasta': largo['fecha'].max(),
        }

    def conteo(columna):
        if cambiados.empty:
            return []
        c = cambiados.groupby(columna).size().sort_values(ascending=False)
        return [{'clave': k, 'cambios': int(v)} for k, v in c.items()]

    muestra = cambiados.sort_values(['fecha', 'hora', 'estacion', 'parametro']).head(MUESTRA_CAMBIOS)
    return {
        'id': ident,
        'total': int(len(largo)),
        'nuevos': int(len(nuevos)),
        'cambiados': int(len(cambiados)),
        'iguales': iguales,
        'desde': largo['fecha'].min(),
        'hasta': largo['fecha'].max(),
        'por_parametro': conteo('parametro'),
        'por_estacion': conteo('estacion'),
        'muestra': [
            {
                'estacion': f.estacion, 'parametro': f.parametro, 'fecha': f.fecha,
                'hora': int(f.hora),
                'antes': _limpio(f.valor_ant), 'bandera_antes': _limpio(f.bandera_ant),
                'ahora': _limpio(f.valor), 'bandera_ahora': _limpio(f.bandera),
            }
            for f in muestra.itertuples(index=False)
        ],
    }


def aplicar(con: sqlite3.Connection, ident: str, actualizar_cambios: bool = True) -> dict:
    """
    Escribe lo analizado: los nuevos siempre; los cambiados solo si se pide.

    Cada cambio aplicado deja su antes y su después en `cambios`, ligado a la
    carga, y todo va en una transacción: o entra la carga entera o nada.
    """
    with _candado:
        pendiente = _pendiente.pop(ident, None)
    if pendiente is None:
        raise KeyError('El análisis ya no está disponible. Vuelve a comparar.')

    ahora = horario.ahora().isoformat(timespec='seconds')
    origen = pendiente['origen']
    nuevos = pendiente['nuevos']
    cambiados = pendiente['cambiados'] if actualizar_cambios else pendiente['cambiados'].iloc[0:0]

    def filas(tabla):
        return [
            (f.estacion, f.parametro, f.fecha, int(f.hora),
             _limpio(f.valor), _limpio(f.bandera), origen, ahora)
            for f in tabla.itertuples(index=False)
        ]

    with con:
        cursor = con.execute(
            'INSERT INTO cargas (fecha, origen, descripcion, desde, hasta, nuevos, cambiados, iguales) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (ahora, origen, pendiente['descripcion'], pendiente['desde'], pendiente['hasta'],
             len(nuevos), len(cambiados), pendiente['iguales']),
        )
        carga_id = cursor.lastrowid
        con.executemany(
            'INSERT OR REPLACE INTO mediciones '
            '(estacion, parametro, fecha, hora, valor, bandera, origen, actualizado) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            filas(pd.concat([nuevos, cambiados[nuevos.columns]]).sort_values(ORDEN_DISCO)),
        )
        con.executemany(
            'INSERT INTO cambios (carga_id, estacion, parametro, fecha, hora, '
            'valor_anterior, bandera_anterior, valor_nuevo, bandera_nueva) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                (carga_id, f.estacion, f.parametro, f.fecha, int(f.hora),
                 _limpio(f.valor_ant), _limpio(f.bandera_ant),
                 _limpio(f.valor), _limpio(f.bandera))
                for f in cambiados.itertuples(index=False)
            ],
        )

    return {'carga_id': carga_id, 'nuevos': len(nuevos), 'actualizados': len(cambiados),
            'omitidos': len(pendiente['cambiados']) - len(cambiados)}


def descartar(ident: str) -> None:
    with _candado:
        _pendiente.pop(ident, None)


def guardar_sin_revisar(con: sqlite3.Connection, df: pd.DataFrame, origen: str,
                        descripcion: str) -> dict:
    """
    Para la descarga automático: lo nuevo entra, lo que cambió va a
    `pendientes` para revisarlo después. Nunca pisa un dato guardado.
    """
    largo, nuevos, cambiados, iguales = _comparar(con, df)
    if largo.empty:
        return {'nuevos': 0, 'pendientes': 0, 'iguales': 0}

    ahora = horario.ahora().isoformat(timespec='seconds')
    with con:
        con.execute(
            'INSERT INTO cargas (fecha, origen, descripcion, desde, hasta, nuevos, cambiados, iguales) '
            'VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
            (ahora, origen, descripcion, largo['fecha'].min(), largo['fecha'].max(),
             len(nuevos), iguales),
        )
        con.executemany(
            'INSERT OR REPLACE INTO mediciones '
            '(estacion, parametro, fecha, hora, valor, bandera, origen, actualizado) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [(f.estacion, f.parametro, f.fecha, int(f.hora), _limpio(f.valor),
              _limpio(f.bandera), origen, ahora)
             for f in nuevos.sort_values(ORDEN_DISCO).itertuples(index=False)],
        )
        con.executemany(
            'INSERT OR REPLACE INTO pendientes (estacion, parametro, fecha, hora, '
            'valor_anterior, bandera_anterior, valor_nuevo, bandera_nueva, origen, detectado) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [(f.estacion, f.parametro, f.fecha, int(f.hora),
              _limpio(f.valor_ant), _limpio(f.bandera_ant),
              _limpio(f.valor), _limpio(f.bandera), origen, ahora)
             for f in cambiados.itertuples(index=False)],
        )
    return {'nuevos': len(nuevos), 'pendientes': len(cambiados), 'iguales': iguales}


def pendientes(con: sqlite3.Connection, limite: int = MUESTRA_CAMBIOS) -> dict:
    total = con.execute('SELECT COUNT(*) FROM pendientes').fetchone()[0]
    filas = con.execute(
        'SELECT estacion, parametro, fecha, hora, valor_anterior, bandera_anterior, '
        'valor_nuevo, bandera_nueva FROM pendientes ORDER BY fecha, hora, estacion, parametro '
        'LIMIT ?', (limite,)).fetchall()
    return {'total': total, 'muestra': [
        {'estacion': e, 'parametro': p, 'fecha': f, 'hora': h, 'antes': va,
         'bandera_antes': ba, 'ahora': vn, 'bandera_ahora': bn}
        for e, p, f, h, va, ba, vn, bn in filas
    ]}


def aplicar_pendientes(con: sqlite3.Connection) -> dict:
    """Los pendientes pasan a la base, anotados como una carga más."""
    ahora = horario.ahora().isoformat(timespec='seconds')
    with con:
        n, desde, hasta = con.execute(
            'SELECT COUNT(*), MIN(fecha), MAX(fecha) FROM pendientes').fetchone()
        if not n:
            return {'actualizados': 0}
        carga_id = con.execute(
            'INSERT INTO cargas (fecha, origen, descripcion, desde, hasta, nuevos, cambiados, iguales) '
            "VALUES (?, 'revision', 'Cambios pendientes revisados', ?, ?, 0, ?, 0)",
            (ahora, desde, hasta, n),
        ).lastrowid
        con.execute(
            'INSERT INTO cambios (carga_id, estacion, parametro, fecha, hora, valor_anterior, '
            'bandera_anterior, valor_nuevo, bandera_nueva) SELECT ?, estacion, parametro, fecha, '
            'hora, valor_anterior, bandera_anterior, valor_nuevo, bandera_nueva FROM pendientes',
            (carga_id,),
        )
        con.execute(
            'INSERT OR REPLACE INTO mediciones (estacion, parametro, fecha, hora, valor, bandera, '
            'origen, actualizado) SELECT estacion, parametro, fecha, hora, valor_nuevo, '
            'bandera_nueva, origen, ? FROM pendientes', (ahora,),
        )
        con.execute('DELETE FROM pendientes')
    return {'actualizados': n, 'carga_id': carga_id}


def descartar_pendientes(con: sqlite3.Connection) -> int:
    with con:
        return con.execute('DELETE FROM pendientes').rowcount


def meses(desde: str, hasta: str) -> list[tuple[str, str]]:
    """[desde, hasta) partido en tramos de un mes natural, como texto AAAA-MM-DD."""
    tramos = []
    inicio = pd.Timestamp(desde)
    fin = pd.Timestamp(hasta)
    while inicio < fin:
        siguiente = min((inicio + pd.offsets.MonthBegin(1)).normalize(), fin)
        tramos.append((inicio.strftime('%Y-%m-%d'), siguiente.strftime('%Y-%m-%d')))
        inicio = siguiente
    return tramos


# ── Consultas ───────────────────────────────────────────────────────────────

def estado(con: sqlite3.Connection, ruta: str) -> dict:
    """Qué hay guardado: por año, cuántas horas, estaciones y parámetros."""
    anios = con.execute(
        'SELECT substr(fecha, 1, 4) AS anio, COUNT(*), COUNT(valor), '
        'COUNT(DISTINCT estacion), MIN(fecha), MAX(fecha) '
        'FROM mediciones GROUP BY anio ORDER BY anio'
    ).fetchall()
    parametros = [r[0] for r in con.execute(
        'SELECT DISTINCT parametro FROM mediciones')]
    estaciones = [r[0] for r in con.execute(
        'SELECT DISTINCT estacion FROM mediciones ORDER BY estacion')]
    cargas = con.execute(
        'SELECT id, fecha, origen, descripcion, desde, hasta, nuevos, cambiados, iguales '
        'FROM cargas ORDER BY id DESC LIMIT 20'
    ).fetchall()
    tamano = os.path.getsize(ruta) if os.path.exists(ruta) else 0

    return {
        'disponible': True,
        'ruta': ruta,
        'tamano': tamano,
        'anios': [
            {'anio': int(a), 'registros': n, 'valores': v, 'estaciones': e,
             'desde': d, 'hasta': h}
            for a, n, v, e, d, h in anios
        ],
        'parametros': [p for p in PARAMETROS if p in parametros],
        'estaciones': estaciones,
        'cargas': [
            {'id': i, 'fecha': f, 'origen': o, 'descripcion': ds, 'desde': d,
             'hasta': h, 'nuevos': n, 'cambiados': c, 'iguales': ig}
            for i, f, o, ds, d, h, n, c, ig in cargas
        ],
    }


def cambios_de_carga(con: sqlite3.Connection, carga_id: int, limite: int = 1000) -> list[dict]:
    filas = con.execute(
        'SELECT estacion, parametro, fecha, hora, valor_anterior, bandera_anterior, '
        'valor_nuevo, bandera_nueva FROM cambios WHERE carga_id = ? '
        'ORDER BY fecha, hora, estacion, parametro LIMIT ?',
        (carga_id, limite),
    ).fetchall()
    return [
        {'estacion': e, 'parametro': p, 'fecha': f, 'hora': h, 'antes': va,
         'bandera_antes': ba, 'ahora': vn, 'bandera_ahora': bn}
        for e, p, f, h, va, ba, vn, bn in filas
    ]


def cargar_periodo(con: sqlite3.Connection, desde: str, hasta: str) -> pd.DataFrame:
    """
    Lo guardado entre `desde` (incluido) y `hasta` (excluido), en el formato de
    siempre: una fila por estación y hora, una columna por parámetro, con el
    valor o su bandera. Es lo inverso de `a_largo`, para que el resto de la app
    lo trate igual que un archivo o una descarga.
    """
    largo = pd.read_sql_query(
        'SELECT estacion, parametro, fecha, hora, valor, bandera FROM mediciones '
        'WHERE fecha >= ? AND fecha < ?',
        con, params=[desde, hasta],
    )
    if largo.empty:
        return pd.DataFrame(columns=['STATION', 'DATE', 'HOUR'])

    # Dos unstack sobre columnas simples (número y bandera) y se combinan:
    # pivot_table con aggfunc sobre texto era mucho más lento.
    largo = largo.set_index(['estacion', 'fecha', 'hora', 'parametro'])
    valores = largo['valor'].unstack('parametro')
    banderas = largo['bandera'].unstack('parametro').reindex(columns=valores.columns)
    ancho = valores.astype(object).where(valores.notna(), banderas).reset_index()
    ancho.columns.name = None
    ancho = ancho.rename(columns={'estacion': 'STATION', 'fecha': 'DATE', 'hora': 'HOUR'})
    params = [p for p in PARAMETROS if p in ancho.columns]
    return ancho[['STATION', 'DATE', 'HOUR', *params]].sort_values(
        ['STATION', 'DATE', 'HOUR']).reset_index(drop=True)
