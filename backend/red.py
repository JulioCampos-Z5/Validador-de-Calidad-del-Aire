"""
Conexión con los servidores de datos: reintentos y diagnóstico de la red.

Por qué existe
--------------
En algunas computadoras la descarga quedaba incompleta sin avisar. La causa era
la red, no el código de validación: con una conexión lenta o inestable parte de
las peticiones vencía o se cortaba, el cliente las descartaba y el resto del
sistema trabajaba con los datos a medias como si estuvieran completos.

Aquí se juntan las dos defensas que comparten el SIMAJ y la API de Emisiones:

1. **Reintentos.** Un corte suelto no debe costar un archivo: urllib3 reintenta
   con espera creciente los fallos de conexión, los vencimientos y las
   respuestas 429/5xx del servidor.
2. **Diagnóstico.** Cuando aun así falla, se distingue un problema de la red
   —que se arregla cambiando de conexión o reintentando— de uno del servidor o
   de la respuesta, para decirle al usuario cuál es.
"""

from __future__ import annotations

import requests
from urllib3.util.retry import Retry

# Espera para conectar y para recibir. Conectar es rápido incluso en una red
# mala; lo que se alarga es la respuesta.
TIEMPO_CONEXION = 15

# Qué respuestas del servidor merecen otro intento: saturación (429) y fallos
# pasajeros de su lado (5xx). Un 404 o un 401 no mejoran reintentando.
REINTENTABLES = (429, 500, 502, 503, 504)

MENSAJE_RED = (
    'La conexión a internet no es suficiente para descargar todos los datos: '
    'las peticiones se vencieron o se cortaron incluso después de reintentar. '
    'Prueba con una red más estable (cable en vez de wifi, o fuera de la VPN), '
    'o pide un periodo más corto. Lo que sí se descargó queda guardado y no se '
    'vuelve a pedir.'
)


def sesion(concurrencia: int, reintentos: int = 3, metodos=('GET',)) -> requests.Session:
    """
    Sesión con pool dimensionado para `concurrencia` hilos y reintentos.

    Solo se reintentan los métodos de `metodos`: repetir un POST que sí llegó
    podría duplicar su efecto, así que por omisión solo GET.
    """
    politica = Retry(
        total=reintentos,
        connect=reintentos,
        read=reintentos,
        status=reintentos,
        backoff_factor=1.0,          # 1 s, 2 s, 4 s entre intentos
        status_forcelist=REINTENTABLES,
        allowed_methods=frozenset(metodos),
        respect_retry_after_header=True,
        raise_on_status=False,       # tras el último intento, la respuesta tal cual
    )
    s = requests.Session()
    s.headers.update({'User-Agent': 'validador-calidad-aire/1.0'})
    adaptador = requests.adapters.HTTPAdapter(
        pool_connections=concurrencia, pool_maxsize=concurrencia, max_retries=politica)
    s.mount('https://', adaptador)
    s.mount('http://', adaptador)
    return s


def aviso_de_descarga(informe: dict | None) -> str | None:
    """
    El aviso para la interfaz si la descarga quedó incompleta, o None.

    Se dice cuánto llegó, qué falta y por qué, y que reintentar es barato: lo
    descargado queda en caché y la segunda vez solo se pide lo que faltó.
    """
    if not informe or informe.get('completa', True):
        return None

    porcentaje = informe.get('porcentaje_descargado')
    if 'archivos_fallidos' in informe:
        partes = []
        if informe['archivos_fallidos']:
            texto = f"{informe['archivos_fallidos']:,} horas-estación no se pudieron descargar"
            estaciones = informe.get('fallidos_por_estacion') or {}
            if estaciones:
                texto += ' (' + ', '.join(f'{e}: {n}' for e, n in estaciones.items()) + ')'
            partes.append(texto)
        sin_listado = informe.get('estaciones_sin_listado') or []
        if sin_listado:
            partes.append('no se pudo consultar ninguna hora de ' + ', '.join(sin_listado))
        faltan = '; '.join(partes)
    else:
        dias = informe.get('dias_fallidos') or []
        faltan = (f'{len(dias)} día(s) no se pudieron descargar'
                  + (f" ({dias[0]} a {dias[-1]})" if dias else ''))

    causa = informe.get('causa')
    if causa == 'red':
        porque = ('La conexión a internet no fue suficiente: las peticiones se '
                  'vencieron o se cortaron aun después de reintentar.')
    elif causa == 'respuesta_invalida':
        porque = ('El servidor respondió con páginas que no son datos; suele ser un '
                  'proxy o un portal de acceso de la red de esta computadora.')
    else:
        porque = 'El servidor de datos falló al responder.'

    llego = (f'llegó el {porcentaje}% de los datos de las estaciones consultadas'
             if 'archivos_fallidos' in informe else f'llegó el {porcentaje}% de los datos')
    return (f'Descarga incompleta: {llego}; {faltan}. '
            f'{porque} Los huecos por esto NO son fallas de las estaciones, así que '
            'el indicador MIR y las validaciones de esas horas no son confiables. '
            'Vuelve a consultar el mismo periodo: solo se pedirá lo que faltó.')


def es_error_de_red(error: BaseException) -> bool:
    """
    Si el fallo es de la conexión y no del servidor.

    Vencimientos, conexiones rechazadas o cortadas, proxys y lecturas que se
    quedan a medias son la red. Un HTTPError con código es el servidor
    contestando, aunque sea mal.
    """
    return isinstance(error, (
        requests.ConnectionError,       # incluye ProxyError, SSLError y ConnectTimeout
        requests.Timeout,
        requests.exceptions.ChunkedEncodingError,
        requests.exceptions.ContentDecodingError,
    ))
