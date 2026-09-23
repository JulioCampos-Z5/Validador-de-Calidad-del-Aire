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
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from html.parser import HTMLParser
from typing import Callable, Iterable

import horario

import pandas as pd
import requests

import red

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

# Segunda vuelta para lo que falló en la primera. Va con pocas descargas a la
# vez y más paciencia: en una red lenta, 25 peticiones simultáneas se estorban
# entre sí y vencen todas; de cuatro en cuatro sí pasan.
CONCURRENCIA_REINTENTO = 4
ESPERA_PRIMERA = 30
ESPERA_REINTENTO = 60
# El listado de una estación es una página de cientos de KB: más paciencia.
ESPERA_LISTADO = 60

# Fallos de red seguidos, sin un solo acierto en medio, a partir de los cuales
# se da la red por caída y se deja de insistir. Sin este corte, con la conexión
# muerta cada archivo agotaría sus reintentos y un mes tardaría casi una hora
# en decir que no había red. Con 25 hilos son unas dos tandas completas.
LIMITE_FALLOS_SEGUIDOS = 50

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


def _sesion(concurrencia: int = 25) -> requests.Session:
    """
    Sesión con el pool de conexiones dimensionado para los hilos que la usan, y
    con reintentos (ver red.py).

    Por defecto, requests guarda 10 conexiones por host. Con 25 hilos pidiendo a
    la vez, las 15 sobrantes se descartan y se rehacen en la siguiente petición:
    un saludo TCP y un TLS completos por cada archivo, miles de veces. Además
    urllib3 lo avisa en cada descarte, y esos avisos ahogaban el registro de
    errores.
    """
    return red.sesion(concurrencia)


def listar(url: str, sesion: requests.Session | None = None) -> list[str]:
    """Devuelve los href de un listado de IIS."""
    s = sesion or _sesion()
    r = s.get(url, timeout=(red.TIEMPO_CONEXION, ESPERA_LISTADO))
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


class InformeDescarga:
    """
    Qué tan completa quedó una descarga.

    Sin esto, un archivo que no llegó y uno que el SIMAJ nunca publicó eran lo
    mismo: un hueco. Pero el primero es un problema de la descarga, que se
    arregla reintentando, y el segundo es la realidad de la red de monitoreo.
    """

    def __init__(self) -> None:
        self.pedidos = 0
        self.descargados = 0
        self.no_publicados = 0
        self.reintentados = 0
        self.fallidos_por_estacion: dict[str, int] = {}
        self.motivos: dict[str, int] = {}
        self.segundos = 0.0
        self.red_caida = False
        self.estaciones_sin_listado: list[str] = []

    def anotar_fallo(self, estacion: str, motivo: str) -> None:
        clave = ABREVIATURAS.get(estacion, estacion[:3].upper())
        self.fallidos_por_estacion[clave] = self.fallidos_por_estacion.get(clave, 0) + 1
        self.motivos[motivo] = self.motivos.get(motivo, 0) + 1

    def anotar_estacion_fallida(self, estacion: str, motivo: str) -> None:
        self.estaciones_sin_listado.append(ABREVIATURAS.get(estacion, estacion[:3].upper()))
        self.motivos[motivo] = self.motivos.get(motivo, 0) + 1

    @property
    def fallidos(self) -> int:
        return sum(self.fallidos_por_estacion.values())

    def causa(self) -> str | None:
        """La causa que más pesó: 'red', 'servidor' o 'respuesta_invalida'."""
        if not self.motivos:
            return None
        return max(self.motivos, key=self.motivos.get)

    def como_dict(self) -> dict:
        esperados = self.pedidos - self.no_publicados
        return {
            'completa': self.fallidos == 0 and not self.estaciones_sin_listado,
            'estaciones_sin_listado': sorted(self.estaciones_sin_listado),
            'archivos_pedidos': self.pedidos,
            'archivos_descargados': self.descargados,
            'archivos_no_publicados': self.no_publicados,
            'archivos_fallidos': self.fallidos,
            'archivos_reintentados': self.reintentados,
            'porcentaje_descargado': (round(100.0 * self.descargados / esperados, 1)
                                      if esperados > 0 else 100.0),
            'fallidos_por_estacion': dict(sorted(self.fallidos_por_estacion.items())),
            'causa': 'red' if self.red_caida else self.causa(),
            'red_caida': self.red_caida,
            'segundos': self.segundos,
        }


def _leer_cache(ruta: str) -> dict | None:
    """
    Una hora ya guardada, o None si no hay o no sirve.

    Un archivo en caché que no se puede leer se borra para que se vuelva a
    pedir. Antes se leía, fallaba el parseo y se descartaba en silencio: la hora
    quedaba perdida para siempre, porque la caché nunca se revisaba otra vez.
    """
    if not os.path.exists(ruta):
        return None
    try:
        with open(ruta, 'r', encoding='utf-8') as fh:
            fila = parsear_lsi(fh.read(), os.path.basename(os.path.dirname(ruta)))
    except (OSError, UnicodeDecodeError):
        fila = None
    if fila is None:
        try:
            os.remove(ruta)
        except OSError:
            pass
    return fila


def _guardar_cache(ruta: str, contenido: str) -> None:
    """Escritura atómica: o queda el archivo entero o no queda nada."""
    temporal = f'{ruta}.{threading.get_ident()}.parcial'
    try:
        with open(temporal, 'w', encoding='utf-8') as fh:
            fh.write(contenido)
        os.replace(temporal, ruta)
    except OSError:
        # Sin caché la descarga sigue valiendo; solo se repetirá la próxima vez.
        try:
            os.remove(temporal)
        except OSError:
            pass


def _traer(sesion: requests.Session, estacion: str, nombre: str,
           destino: str | None, espera: int,
           solo_cache: bool = False) -> tuple[str, dict | None]:
    """
    Una hora de una estación: de la caché o del SIMAJ.

    Devuelve (estado, fila). El estado es 'ok', 'no_publicado' (404: el SIMAJ no
    tiene esa hora, que es un dato real de la red), o el motivo del fallo:
    'red', 'servidor' o 'respuesta_invalida'. Antes cualquier fallo se volvía
    None y se confundía con un hueco de la red de monitoreo.
    """
    ruta = os.path.join(destino, nombre) if destino else None
    if ruta:
        guardada = _leer_cache(ruta)
        if guardada is not None:
            return 'ok', guardada
    if solo_cache:
        return 'red', None

    url = f'{BASE}/{requests.utils.quote(estacion)}/{requests.utils.quote(nombre)}'
    try:
        r = sesion.get(url, timeout=(red.TIEMPO_CONEXION, espera))
    except requests.RequestException as e:
        return ('red' if red.es_error_de_red(e) else 'servidor'), None
    if r.status_code == 404:
        return 'no_publicado', None
    if r.status_code >= 400:
        return 'servidor', None

    fila = parsear_lsi(r.text, estacion)
    if fila is None:
        # Un 200 que no es un .lsi: típicamente la página de un proxy o de un
        # portal de acceso a la red. No se guarda, o envenenaría la caché.
        return 'respuesta_invalida', None
    if ruta:
        _guardar_cache(ruta, r.text)
    return 'ok', fila


def descargar(
    meses: int = 1,
    estaciones_pedidas: Iterable[str] | None = None,
    carpeta_cache: str | None = None,
    concurrencia: int = 25,
    al_avanzar: Callable[[str, int, int, int, int], None] | None = None,
    desde: datetime | None = None,
    hasta: datetime | None = None,
) -> pd.DataFrame:
    """
    Baja el periodo pedido y devuelve un DataFrame en formato BD.

    El periodo se da con `desde`/`hasta`, que es lo que manda la interfaz desde
    que el selector de fechas es común a todos los orígenes. `meses` se queda
    como respaldo para quien llame sin fechas —"el último mes hasta hoy"—, que
    era la única forma de pedir un periodo antes.

    `carpeta_cache` evita volver a pedir lo ya bajado: el histórico no cambia,
    una hora ya publicada no se reescribe. Sin caché, cada corrida repetiría
    decenas de miles de peticiones para nada. También hace barato reintentar
    una descarga incompleta: la segunda vez solo se pide lo que faltó.

    Qué tan completa quedó la descarga va en `df.attrs['descarga']` (ver
    `InformeDescarga`).
    """
    sesion = _sesion(concurrencia)
    lista = list(estaciones_pedidas) if estaciones_pedidas else estaciones(sesion)

    if desde is None:
        desde = horario.ahora() - timedelta(days=31 * meses)
    desde = desde.replace(hour=0, minute=0, second=0, microsecond=0)
    # Sin `hasta`, hasta donde llegue lo publicado. El límite es excluyente: un
    # archivo se nombra por la hora en que se publica (`00_10` es la hora 00),
    # así que pedir hasta el día siguiente a las 00:00 recoge el 23_10 del día
    # anterior y ni un archivo más.
    tope = hasta or datetime.max

    filas: list[dict] = []
    informe = InformeDescarga()
    reloj = time.monotonic()
    # Compartido por todas las estaciones: si la red se cayó, se cayó para
    # todas, y no tiene sentido volver a descubrirlo estación por estación.
    fallos_seguidos = [0]
    candado_red = threading.Lock()

    for indice, estacion in enumerate(lista, start=1):
        # El listado de la estación es una página grande (una línea por hora
        # del histórico) y en una red lenta también vence. Si falla, esa
        # estación queda fuera y se dice, pero las demás siguen: antes el
        # primer listado vencido tiraba la descarga entera.
        try:
            hrefs = _archivos(estacion, sesion)
        except requests.RequestException as e:
            informe.anotar_estacion_fallida(
                estacion, 'red' if red.es_error_de_red(e) else 'servidor')
            if al_avanzar:
                al_avanzar(estacion, indice, len(lista), 0, 0)
            continue

        nombres = []
        for href in hrefs:
            nombre = requests.utils.unquote(href.rsplit('/', 1)[-1])
            f = fecha_de_archivo(nombre)
            if f is not None and desde <= f < tope:
                nombres.append(nombre)

        destino = os.path.join(carpeta_cache, estacion) if carpeta_cache else None
        if destino:
            os.makedirs(destino, exist_ok=True)

        total = len(nombres)
        hechos = [0]
        candado = threading.Lock()

        def tarea(nombre: str, espera: int, reintento: bool):
            with candado_red:
                red_caida = fallos_seguidos[0] >= LIMITE_FALLOS_SEGUIDOS
            resultado = _traer(sesion, estacion, nombre, destino, espera,
                               solo_cache=red_caida)
            with candado_red:
                if resultado[0] == 'red':
                    fallos_seguidos[0] += 1
                elif resultado[0] == 'ok':
                    fallos_seguidos[0] = 0
            with candado:
                if not reintento:
                    hechos[0] += 1
                    if al_avanzar and hechos[0] % 50 == 0:
                        al_avanzar(estacion, indice, len(lista), hechos[0], total)
            return nombre, resultado

        fallidos: list[str] = []
        with ThreadPoolExecutor(max_workers=concurrencia) as pool:
            for nombre, (estado, dato) in pool.map(
                    lambda n: tarea(n, ESPERA_PRIMERA, False), nombres):
                if estado == 'ok':
                    filas.append(dato)
                elif estado == 'no_publicado':
                    informe.no_publicados += 1
                else:
                    fallidos.append(nombre)

        # Lo que falló va a una segunda vuelta, despacio. Si la red solo estaba
        # saturada por la primera, aquí se recupera casi todo.
        if fallidos:
            informe.reintentados += len(fallidos)
            with ThreadPoolExecutor(max_workers=CONCURRENCIA_REINTENTO) as pool:
                for nombre, (estado, dato) in pool.map(
                        lambda n: tarea(n, ESPERA_REINTENTO, True), fallidos):
                    if estado == 'ok':
                        filas.append(dato)
                    elif estado == 'no_publicado':
                        informe.no_publicados += 1
                    else:
                        informe.anotar_fallo(estacion, estado)

        informe.pedidos += total
        informe.red_caida = fallos_seguidos[0] >= LIMITE_FALLOS_SEGUIDOS
        if al_avanzar:
            al_avanzar(estacion, indice, len(lista), total, total)

    informe.descargados = len(filas)
    informe.segundos = round(time.monotonic() - reloj, 1)

    if not filas:
        df = pd.DataFrame(columns=['STATION', 'DATE', 'HOUR'] + CANALES_BD)
    else:
        df = pd.DataFrame(filas)
        df = df.sort_values(['STATION', 'DATE', 'HOUR']).reset_index(drop=True)
    # Viaja con el DataFrame para no cambiar lo que devuelve la función: quien
    # necesite saber si la descarga quedó completa lo lee de aquí.
    df.attrs['descarga'] = informe.como_dict()
    return df
