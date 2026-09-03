"""
Descarga de los minutales del SIMAJ y conversión al formato BD del validador.

Por qué existe este módulo
--------------------------
Hasta ahora el validador dependía de que alguien exportara a mano un Trs.xlsx
desde ENVISTA. La red publica además un archivo por estación y hora en
https://aire.jalisco.gob.mx/minutales/, con los mismos 17 parámetros, así que
se puede alimentar el validador solo.

Dos cosas condicionan el diseño:

1. **No hay CORS.** El servidor no manda `Access-Control-Allow-Origin`, así que
   el navegador nunca podrá bajar esto. Tiene que hacerlo el backend.
2. **Son muchísimas peticiones pequeñas.** Cada archivo pesa unos 159 bytes,
   pero hay ~8,800 por estación y año: más de 120,000 para la red completa. De
   ahí el pool de hilos y la caché en disco.

Formato del archivo .lsi
------------------------
Una sola línea:

    idEstación, fechaHora, valor1, status1, ..., valor17, status17

El orden de los 17 monitores lo fija el documento del SIMAJ "Acceso a datos
horarios de las estaciones de monitoreo atmosférico". Solo son válidos los
valores con status igual a 1.
"""

from __future__ import annotations

import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from html.parser import HTMLParser
from typing import Callable, Iterable

import pandas as pd
import requests

BASE = 'https://aire.jalisco.gob.mx/minutales'

# Orden de los 17 monitores en el .lsi, con la clave que usa el formato BD del
# validador. El .lsi trae los parámetros en orden de instrumento; el formato BD
# los nombra distinto (ET, IT, ATM, RS, PP, UVI), así que aquí se traducen.
CANALES_BD = [
    'O3', 'NO', 'NO2', 'NOX', 'SO2', 'CO', 'PM10', 'PM2.5',
    'WS', 'WD', 'ET', 'RH', 'ATM', 'RS', 'PP', 'UVI', 'IT',
]

# Centinela del datalogger para "aquí no hay lectura". También aparecen
# negativos imposibles (-279) cuando el sensor está averiado.
SIN_DATO = -9999.0

STATUS_VALIDO = 1

# Nombre de carpeta en el servidor -> abreviatura del validador.
# Ojo: 'COUNTRY' aquí, mientras que MAPEO_ESTACIONES de app.py trae 'Counrty'
# (con la errata que viene del propio ENVISTA). Son dos fuentes distintas y por
# eso se mapea por separado en vez de reutilizar aquel diccionario.
ABREVIATURAS = {
    'ATEMAJAC': 'ATM',
    'CENTRO': 'CEN',
    'COUNTRY': 'COU',
    'LAS AGUILAS': 'AGU',
    'LAS PINTAS': 'PIN',
    'LOMA DORADA': 'LDO',
    'MIRAVALLE': 'MIR',
    'OBLATOS': 'OBL',
    'SANTA ANITA': 'SAN',
    'SANTA FE': 'SFE',
    'SANTA MARGARITA': 'SMT',
    'TLAQUEPAQUE': 'TLA',
    'VALLARTA': 'VAL',
}


class _ListadoIIS(HTMLParser):
    """
    Lee el listado de directorios que genera IIS.

    No hay API ni índice en JSON: lo único publicado es la página que arma el
    propio IIS, con un <A HREF> por entrada. Se raspa con HTMLParser en vez de
    con una expresión regular sobre el HTML crudo porque así el día que cambie
    el formato falla de forma visible y no devuelve una lista vacía en silencio.
    """

    def __init__(self) -> None:
        super().__init__()
        self.enlaces: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag != 'a':
            return
        for nombre, valor in attrs:
            if nombre == 'href' and valor:
                self.enlaces.append(valor)


def _sesion() -> requests.Session:
    s = requests.Session()
    s.headers.update({'User-Agent': 'validador-calidad-aire/1.0'})
    return s


def listar(url: str, sesion: requests.Session | None = None) -> list[str]:
    """Devuelve los href de un listado de IIS."""
    s = sesion or _sesion()
    r = s.get(url, timeout=30)
    r.raise_for_status()
    parser = _ListadoIIS()
    parser.feed(r.text)
    return parser.enlaces


def estaciones(sesion: requests.Session | None = None) -> list[str]:
    """Las carpetas del primer nivel son las estaciones de monitoreo."""
    nombres = []
    for href in listar(f'{BASE}/', sesion):
        # Las carpetas terminan en '/'; los archivos sueltos y el enlace al
        # directorio padre no interesan.
        m = re.match(r'^/minutales/([^/]+)/$', href)
        if m:
            nombres.append(requests.utils.unquote(m.group(1)))
    return sorted(nombres)


def _archivos(estacion: str, sesion: requests.Session | None = None) -> list[str]:
    url = f'{BASE}/{requests.utils.quote(estacion)}/'
    return [h for h in listar(url, sesion) if h.lower().endswith('.lsi')]


def fecha_de_archivo(nombre: str) -> datetime | None:
    """
    Fecha que codifica el nombre: `15_06_2026 12_10.lsi`.

    Permite filtrar por periodo sin bajar nada. Hace falta porque el listado de
    IIS viene ordenado alfabéticamente y no por fecha: el último nombre de la
    lista es `31_12_2025`, que no es el archivo más reciente. Recortar por
    nombre daría el periodo equivocado.
    """
    m = re.match(r'^(\d{2})_(\d{2})_(\d{4})[ _](\d{2})_(\d{2})', nombre)
    if not m:
        return None
    d, mes, anio, h, minuto = (int(g) for g in m.groups())
    try:
        return datetime(anio, mes, d, h, minuto)
    except ValueError:
        return None


def parsear_lsi(linea: str, estacion: str) -> dict | None:
    """
    Convierte una línea .lsi en una fila del formato BD.

    Solo pasa lo que trae status 1, como indica el documento del SIMAJ. Todo lo
    demás queda en None para que el validador lo trate como hueco y no como
    medición.
    """
    campos = linea.strip().rstrip(',').split(',')
    if len(campos) < 2:
        return None

    try:
        marca = datetime.strptime(campos[1].strip(), '%d/%m/%Y %H:%M:%S')
    except ValueError:
        return None

    fila: dict = {
        'STATION': ABREVIATURAS.get(estacion, estacion[:3].upper()),
        'DATE': marca.strftime('%Y-%m-%d'),
        'HOUR': marca.hour,
    }

    for i, clave in enumerate(CANALES_BD):
        pos_valor, pos_status = 2 + i * 2, 3 + i * 2
        if pos_status >= len(campos):
            fila[clave] = None
            continue
        try:
            valor = float(campos[pos_valor])
            status = int(float(campos[pos_status]))
        except (ValueError, IndexError):
            fila[clave] = None
            continue

        if status != STATUS_VALIDO or valor == SIN_DATO:
            fila[clave] = None
        else:
            fila[clave] = valor

    return fila


def descargar(
    meses: int = 1,
    estaciones_pedidas: Iterable[str] | None = None,
    carpeta_cache: str | None = None,
    concurrencia: int = 25,
    al_avanzar: Callable[[str, int, int, int, int], None] | None = None,
) -> pd.DataFrame:
    """
    Baja el periodo pedido y devuelve un DataFrame en formato BD.

    `carpeta_cache` evita volver a pedir lo ya bajado: el histórico no cambia,
    una hora ya publicada no se reescribe. Sin caché, cada corrida repetiría
    decenas de miles de peticiones para nada.
    """
    sesion = _sesion()
    lista = list(estaciones_pedidas) if estaciones_pedidas else estaciones(sesion)
    desde = datetime.now() - timedelta(days=31 * meses)
    desde = desde.replace(hour=0, minute=0, second=0, microsecond=0)

    filas: list[dict] = []

    for indice, estacion in enumerate(lista, start=1):
        nombres = []
        for href in _archivos(estacion, sesion):
            nombre = requests.utils.unquote(href.rsplit('/', 1)[-1])
            f = fecha_de_archivo(nombre)
            if f is not None and f >= desde:
                nombres.append(nombre)

        destino = os.path.join(carpeta_cache, estacion) if carpeta_cache else None
        if destino:
            os.makedirs(destino, exist_ok=True)

        hechos = [0]
        total = len(nombres)

        def traer(nombre: str) -> str | None:
            ruta = os.path.join(destino, nombre) if destino else None
            if ruta and os.path.exists(ruta):
                with open(ruta, 'r', encoding='utf-8') as fh:
                    return fh.read()
            url = f'{BASE}/{requests.utils.quote(estacion)}/{requests.utils.quote(nombre)}'
            try:
                r = sesion.get(url, timeout=30)
                if r.status_code == 404:
                    return None
                r.raise_for_status()
            except requests.RequestException:
                return None
            if ruta:
                with open(ruta, 'w', encoding='utf-8') as fh:
                    fh.write(r.text)
            return r.text

        def tarea(nombre: str):
            contenido = traer(nombre)
            hechos[0] += 1
            if al_avanzar and hechos[0] % 50 == 0:
                al_avanzar(estacion, indice, len(lista), hechos[0], total)
            return parsear_lsi(contenido, estacion) if contenido else None

        with ThreadPoolExecutor(max_workers=concurrencia) as pool:
            for fila in pool.map(tarea, nombres):
                if fila:
                    filas.append(fila)

        if al_avanzar:
            al_avanzar(estacion, indice, len(lista), total, total)

    if not filas:
        return pd.DataFrame(columns=['STATION', 'DATE', 'HOUR'] + CANALES_BD)

    df = pd.DataFrame(filas)
    return df.sort_values(['STATION', 'DATE', 'HOUR']).reset_index(drop=True)
