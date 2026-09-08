"""
Sesión guardada en disco, opcional.

Por defecto el token vive solo en memoria y al reiniciar el backend hay que
volver a entrar. Eso es lo más seguro, pero también significa que cada
recompilación de la app —o cerrar y abrir la ventana— cuesta escribir otra vez
la contraseña, y en un flujo de trabajo que consulta la misma red varias veces
al día eso pesa.

Aquí vive la alternativa: si el usuario lo pide **explícitamente**, el token se
guarda para que sobreviva al reinicio.

Qué se guarda y qué no
----------------------
Se guarda el token, el correo y la caducidad. **La contraseña no**, ni cifrada
ni de ninguna forma: no hace falta para nada una vez que hay token, y guardarla
convertiría un archivo molesto de perder en un archivo grave de perder.

El token sigue siendo una credencial: quien pueda leer el archivo puede
consultar la API en nombre del usuario hasta que caduque —una semana, según los
que devuelve el servidor hoy—. Por eso el archivo va en el perfil del usuario y
no en la carpeta temporal del sistema, que en Windows es común a todas las
cuentas de la máquina.
"""

from __future__ import annotations

import json
import os
from datetime import datetime

CARPETA_POR_DEFECTO = os.path.join(os.path.expanduser('~'), '.validador-calidad-aire')
NOMBRE = 'sesion-emisiones.json'


def ruta(carpeta: str | None = None) -> str:
    return os.path.join(carpeta or CARPETA_POR_DEFECTO, NOMBRE)


def guardar(token: str, email: str, caduca: datetime | None,
            carpeta: str | None = None) -> None:
    """
    Escribe la sesión. La escritura es atómica.

    Sin el `os.replace` final, un corte a mitad de escritura dejaría un JSON
    truncado que en el siguiente arranque no se puede leer — y peor, podría
    leerse a medias.
    """
    destino = ruta(carpeta)
    os.makedirs(os.path.dirname(destino), exist_ok=True)

    contenido = {
        'token': token,
        'email': email,
        'caduca': caduca.isoformat() if caduca else None,
        'guardada': datetime.now().isoformat(timespec='seconds'),
    }

    temporal = destino + '.parcial'
    with open(temporal, 'w', encoding='utf-8') as fh:
        json.dump(contenido, fh)
    os.replace(temporal, destino)

    # En sistemas POSIX, solo el dueño. En Windows no hace nada útil, pero
    # tampoco falla, y la carpeta del perfil ya está restringida por ACL.
    try:
        os.chmod(destino, 0o600)
    except OSError:
        pass


def cargar(carpeta: str | None = None) -> dict | None:
    """
    Devuelve `{token, email, caduca}` si hay una sesión guardada y viva.

    Devuelve None —y borra el archivo— en los tres casos en que no sirve: no
    existe, no se puede leer, o el token ya caducó. Borrarlo es deliberado: un
    token muerto en disco no tiene ningún uso y solo alarga la vida de una
    credencial que ya no vale.
    """
    origen = ruta(carpeta)
    if not os.path.exists(origen):
        return None

    try:
        with open(origen, 'r', encoding='utf-8') as fh:
            datos = json.load(fh)
        token = datos['token']
        email = datos.get('email')
        caduca_txt = datos.get('caduca')
    except (OSError, ValueError, KeyError, TypeError):
        olvidar(carpeta)
        return None

    if not token:
        olvidar(carpeta)
        return None

    caduca = None
    if caduca_txt:
        try:
            caduca = datetime.fromisoformat(caduca_txt)
        except ValueError:
            olvidar(carpeta)
            return None
        if caduca <= datetime.now():
            olvidar(carpeta)
            return None

    return {'token': token, 'email': email, 'caduca': caduca}


def olvidar(carpeta: str | None = None) -> None:
    """Borra la sesión guardada. No falla si no había ninguna."""
    try:
        os.remove(ruta(carpeta))
    except OSError:
        pass


def hay_guardada(carpeta: str | None = None) -> bool:
    return os.path.exists(ruta(carpeta))
