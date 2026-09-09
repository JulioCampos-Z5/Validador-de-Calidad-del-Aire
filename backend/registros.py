"""
Registro de errores del servidor, visible desde la propia aplicación.

Por qué existe
--------------
Hasta ahora, cuando algo fallaba en el backend la traza iba a la salida estándar
y ahí se quedaba. En desarrollo se ve en la terminal; **en un servidor no lo ve
nadie**, y menos dentro de un contenedor. La consecuencia práctica era que el
usuario reportaba «no funciona» y había que entrar por SSH a leer logs para
enterarse de qué había pasado — si es que el contenedor seguía vivo y no se
habían perdido.

Esto guarda los últimos avisos y errores en memoria y los expone por la API,
para poder mirarlos desde la interfaz.

Qué NO es
---------
No sustituye a los logs del sistema. Es un anillo en memoria: se pierde al
reiniciar y solo guarda los últimos `CAPACIDAD`. Para auditoría de verdad están
los logs del contenedor, que siguen recibiéndolo todo. Esto es para el caso
común: «acaba de fallar algo, ¿qué fue?».
"""

from __future__ import annotations

import logging
import threading
import traceback
from collections import deque
from datetime import datetime

# Cuántos se conservan. Suficiente para reconstruir lo que pasó en una sesión de
# trabajo sin que la memoria crezca sin control en un servidor de días de vida.
CAPACIDAD = 300

# Los mensajes de acceso de cada petición no son errores y ahogarían lo que sí
# importa. Werkzeug los emite en INFO, así que basta con el umbral.
NIVEL_MINIMO = logging.WARNING


class _Anillo(logging.Handler):
    """
    Handler que se queda con los últimos registros en vez de escribirlos.

    Un `deque` con `maxlen` descarta el más viejo solo, sin recortes manuales ni
    riesgo de crecer sin límite.
    """

    def __init__(self, capacidad: int = CAPACIDAD):
        super().__init__(level=NIVEL_MINIMO)
        self._registros: deque = deque(maxlen=capacidad)
        self._candado = threading.Lock()
        self._siguiente_id = 1

    def emit(self, record: logging.LogRecord) -> None:
        # Un fallo aquí dentro no puede tumbar la petición que lo genero: sería
        # convertir un aviso en una caída.
        try:
            entrada = {
                'id': 0,
                'momento': datetime.fromtimestamp(record.created).isoformat(timespec='seconds'),
                'nivel': record.levelname,
                'origen': record.name,
                'mensaje': record.getMessage(),
                'traza': None,
            }
            if record.exc_info:
                entrada['traza'] = ''.join(traceback.format_exception(*record.exc_info)).strip()

            with self._candado:
                entrada['id'] = self._siguiente_id
                self._siguiente_id += 1
                self._registros.append(entrada)
        except Exception:
            self.handleError(record)

    def ultimos(self, limite: int = 100, nivel: str | None = None) -> list[dict]:
        """Los más recientes primero, que es como se leen."""
        with self._candado:
            registros = list(self._registros)

        if nivel:
            registros = [r for r in registros if r['nivel'] == nivel.upper()]
        return registros[::-1][:limite]

    def limpiar(self) -> None:
        with self._candado:
            self._registros.clear()


_anillo = _Anillo()


def instalar() -> None:
    """
    Engancha el anillo al logger raíz.

    Al raíz y no al de Flask a propósito: así recoge también lo que emitan las
    librerías —requests, urllib3, pandas— y las excepciones no capturadas, que
    Flask registra por su cuenta antes de devolver el 500.
    """
    raiz = logging.getLogger()
    if any(isinstance(h, _Anillo) for h in raiz.handlers):
        return

    # Sin nivel en el logger raíz, los avisos no llegan siquiera al handler.
    if raiz.level > NIVEL_MINIMO or raiz.level == logging.NOTSET:
        raiz.setLevel(NIVEL_MINIMO)
    raiz.addHandler(_anillo)


def ultimos(limite: int = 100, nivel: str | None = None) -> list[dict]:
    return _anillo.ultimos(limite, nivel)


def limpiar() -> None:
    _anillo.limpiar()


def anotar_error(mensaje: str, excepcion: BaseException | None = None) -> None:
    """
    Registra un error del backend con su traza.

    Envoltorio para no repetir la configuración del logger en cada ruta, y para
    que quede claro en el código llamante que eso va a acabar en la vista de
    registros y no solo en la terminal.
    """
    logging.getLogger('validador').error(mensaje, exc_info=excepcion)
