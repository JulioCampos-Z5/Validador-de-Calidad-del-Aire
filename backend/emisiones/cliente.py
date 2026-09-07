"""
Cliente de la API de Emisiones de Jalisco (emisiones.jalisco.gob.mx:4443).

Por qué existe este módulo
--------------------------
Es una tercera vía de entrada de datos, además del Trs.xlsx de ENVISTA y del
raspado de los .lsi del SIMAJ. A diferencia de aquellas, esta sí es una API
formal: se pide un token con usuario y contraseña y con él se consulta un rango
de fechas de una sola vez, en vez de bajar un archivo por estación y hora.

    POST /consultas/api/Authentication/requestToken   {email, password} -> token
    GET  /consultas/api/Minutales/?startDate=...&endDate=...            -> datos

Dos decisiones de diseño que conviene entender antes de tocar esto:

1. **La petición la hace el backend, no el navegador.** Aunque el servidor sí
   manda `Access-Control-Allow-Origin: *` y técnicamente el navegador podría
   llamarlo, la contraseña y el token se quedan en el proceso de Python y el
   DataFrame se arma donde ya vive pandas. Al frontend nunca le llega el token.

2. **El parseo es tolerante a la forma de la respuesta.** No hay contrato
   publicado ni swagger, así que en vez de fijar nombres de campo se reconocen
   por alias (`TempExt`/`Temperatura externa`/`ET` son la misma columna) y se
   aceptan tanto la forma anidada del documento de la API —cada variable con
   `{valor, unidad, bandera}`— como una fila plana de columnas. Si mañana la
   API cambia el nombre de un campo, se añade un alias aquí y no se toca nada
   más; si cambia de forma entera, `normalizar` avisa con un error explícito en
   vez de devolver un DataFrame vacío en silencio.
"""

from __future__ import annotations

import base64
import json
import math
import re
from datetime import datetime, timedelta
from typing import Any, Iterable

import numpy as np
import pandas as pd
import requests

BASE = 'https://emisiones.jalisco.gob.mx:4443/consultas/api'

RUTA_TOKEN = f'{BASE}/Authentication/requestToken'
RUTA_MINUTALES = f'{BASE}/Minutales/'

# Solo se usa cuando el token no es un JWT legible. Los que devuelve la API hoy
# sí lo son y traen su `exp`: el observado dura una semana, no un día, así que
# la caducidad real se lee del token y esta constante no llega a aplicarse.
VIGENCIA_SUPUESTA = timedelta(hours=8)

TIEMPO_ESPERA = 120

# Columnas del formato BD del validador, en el orden en que las espera el resto
# del sistema. Es el mismo juego de 17 parámetros que usa minutales/cliente.py.
CANALES_BD = [
    'O3', 'NO', 'NO2', 'NOX', 'SO2', 'CO', 'PM10', 'PM2.5',
    'WS', 'WD', 'ET', 'RH', 'ATM', 'RS', 'PP', 'UVI', 'IT',
]

# Alias -> canal BD. Se normaliza a minúsculas y sin acentos ni separadores
# antes de buscar aquí, así que 'Radiación Solar', 'radiacion_solar' y
# 'RADIACIONSOLAR' caen todos en la misma entrada.
ALIAS_CANALES = {
    'o3': 'O3', 'ozono': 'O3',
    'no': 'NO', 'monoxidodenitrogeno': 'NO',
    'no2': 'NO2', 'dioxidodenitrogeno': 'NO2',
    'nox': 'NOX', 'oxidosdenitrogeno': 'NOX',
    'so2': 'SO2', 'dioxidodeazufre': 'SO2',
    'co': 'CO', 'monoxidodecarbono': 'CO',
    'pm10': 'PM10',
    'pm25': 'PM2.5', 'pm2': 'PM2.5',
    'ws': 'WS', 'velocidaddelviento': 'WS', 'velviento': 'WS',
    'wd': 'WD', 'direcciondelviento': 'WD', 'dirviento': 'WD',
    'et': 'ET', 'tempext': 'ET', 'temperaturaexterna': 'ET', 'temperatura': 'ET',
    'rh': 'RH', 'humedadrelativa': 'RH', 'humedad': 'RH',
    'atm': 'ATM', 'presion': 'ATM', 'presionatmosferica': 'ATM', 'pa': 'ATM',
    'rs': 'RS', 'radsolar': 'RS', 'radiacion': 'RS', 'radiacionsolar': 'RS',
    'pp': 'PP', 'precip': 'PP', 'precipitacion': 'PP', 'lluvia': 'PP',
    'precipitacionpluvial': 'PP',
    'uvi': 'UVI', 'uv': 'UVI', 'iuv': 'UVI', 'indiceuv': 'UVI',
    'radiacionsolar': 'RS', 'presionatmosferica': 'ATM',
    'it': 'IT', 'tempint': 'IT', 'temperaturainterna': 'IT',
}

# Id numérico de parámetro -> canal BD. El orden es el del catálogo del
# documento de la API ("API SIMAJ.md"): 1 O3 ... 17 TempInt. Hace falta porque
# una respuesta en formato largo puede identificar el parámetro por id y no por
# nombre, y entonces no hay ningún texto que buscar en ALIAS_CANALES.
ID_PARAMETROS = {i + 1: canal for i, canal in enumerate([
    'O3', 'NO', 'NO2', 'NOX', 'SO2', 'CO', 'PM10', 'PM2.5',
    'WS', 'WD', 'ET', 'RH', 'ATM', 'RS', 'PP', 'UVI', 'IT',
])}

# Campos que, en formato largo, dicen QUÉ se midió y CUÁNTO. Ver `_largo`.
ALIAS_PARAMETRO = {
    'parametro', 'parameter', 'variable', 'canal', 'channel',
    'contaminante', 'monitor', 'clave parametro', 'claveparametro',
    'nombreparametro', 'tipo', 'medicion',
}
ALIAS_ID_PARAMETRO = {
    'idparametro', 'parametroid', 'idvariable', 'idcanal', 'idmonitor',
    'parameterid', 'idparam',
}
ALIAS_VALOR = {'valor', 'value', 'dato', 'lectura', 'medida', 'resultado', 'concentracion'}
ALIAS_BANDERA = {'bandera', 'flag', 'status', 'estatus', 'estado', 'validacion', 'valido'}

# Campos que identifican la estación y el momento. Mismo criterio de alias.
ALIAS_ESTACION = {
    'estacion', 'station', 'idestacion', 'estacionid', 'stationid',
    'clave', 'claveestacion', 'nombreestacion', 'nombre', 'siglas', 'abreviatura',
}
ALIAS_FECHAHORA = {
    'fechahora', 'datetime', 'timestamp', 'fecha', 'date', 'marca',
    'fechamedicion', 'fechayhora',
}
ALIAS_HORA = {'hora', 'hour', 'time'}

# La API arrastra los mismos centinelas del datalogger que los .lsi.
CENTINELAS = {-9999.0, -999.0, 9999.0}

# Bandera de dato válido según el diccionario del SIMAJ (ver "API SIMAJ.md").
BANDERA_VALIDA = 1

# La respuesta real pone la bandera en un campo HERMANO, no anidada:
# `"O3": "0.018", "O3_Flag": "1"`. Estos son los sufijos con los que se busca.
SUFIJOS_BANDERA = ('flag', 'status', 'bandera', 'estatus')

# Clave reservada donde `_aplanar` deja la fecha de MEDICIÓN cuando choca con la
# del registro. Hacen falta las dos: el registro se sella cuando la red publica
# (`fechaHora`, :10 de cada hora) y `datos.Fecha` dice a qué hora se midió de
# verdad. La medición es la que manda. Ver `_momento`.
CLAVE_MEDICION = '__fecha_medicion'

# Nombres completos de estación -> abreviatura del validador. Es el mismo mapeo
# que usa app.py para ENVISTA, repetido aquí a propósito: son fuentes distintas
# y la de ENVISTA arrastra la errata 'Counrty'. Mezclarlas obligaría a que un
# arreglo en una rompiera la otra.
ABREVIATURAS = {
    'atemajac': 'ATM',
    'centro': 'CEN', 'estacioncentro': 'CEN',
    'country': 'COU', 'counrty': 'COU',
    'lasaguilas': 'AGU', 'aguilas': 'AGU',
    'laspintas': 'PIN', 'pintas': 'PIN',
    'lomadorada': 'LDO',
    'miravalle': 'MIR',
    'oblatos': 'OBL',
    'santaanita': 'SAN',
    'santafe': 'SFE',
    'santamargarita': 'SMT',
    'tlaquepaque': 'TLA',
    'vallarta': 'VAL',
}


class ErrorEmisiones(Exception):
    """Fallo atribuible a la API remota o a las credenciales, no al validador."""

    def __init__(self, mensaje: str, codigo: int = 502):
        super().__init__(mensaje)
        self.codigo = codigo


class CredencialesInvalidas(ErrorEmisiones):
    def __init__(self, mensaje: str = 'Correo o contraseña incorrectos.'):
        super().__init__(mensaje, codigo=401)


class SesionCaducada(ErrorEmisiones):
    def __init__(self, mensaje: str = 'El token caducó. Vuelve a iniciar sesión.'):
        super().__init__(mensaje, codigo=401)


def _clave(texto: Any) -> str:
    """
    Reduce un nombre de campo a su forma comparable.

    Quita acentos, mayúsculas y todo lo que no sea alfanumérico, que es lo que
    varía entre 'TempExt', 'temp_ext' y 'Temperatura Externa'. Sin esto haría
    falta una entrada de alias por cada forma de escribir lo mismo.
    """
    s = str(texto).strip().lower()
    for a, b in (('á', 'a'), ('é', 'e'), ('í', 'i'), ('ó', 'o'), ('ú', 'u'), ('ñ', 'n')):
        s = s.replace(a, b)
    return re.sub(r'[^a-z0-9]', '', s)


def _sesion_http() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        'User-Agent': 'validador-calidad-aire/1.0',
        'Accept': 'application/json',
    })
    return s


# ---------------------------------------------------------------------------
# Autenticación
# ---------------------------------------------------------------------------

def _extraer_token(respuesta: requests.Response) -> str:
    """
    Saca el token venga como venga.

    El endpoint puede devolver el token pelado en el cuerpo o envuelto en un
    JSON, y el nombre del campo no está documentado. Se prueban los habituales
    antes de rendirse; rendirse significa un error que dice qué llegó, no un
    token vacío que fallaría más tarde en la consulta y sin pistas.
    """
    texto = (respuesta.text or '').strip()
    if not texto:
        raise ErrorEmisiones('La API devolvió una respuesta vacía al pedir el token.')

    try:
        cuerpo = respuesta.json()
    except ValueError:
        # Token pelado, posiblemente entrecomillado.
        return texto.strip('"')

    if isinstance(cuerpo, str):
        return cuerpo.strip('"')

    if isinstance(cuerpo, dict):
        for campo in ('token', 'access_token', 'accessToken', 'jwt',
                      'Token', 'AccessToken', 'data', 'result'):
            valor = cuerpo.get(campo)
            if isinstance(valor, str) and valor.strip():
                return valor.strip()
            # Algunas APIs anidan el token dentro de 'data'/'result'.
            if isinstance(valor, dict):
                for interno in ('token', 'access_token', 'accessToken'):
                    if isinstance(valor.get(interno), str):
                        return valor[interno].strip()

    raise ErrorEmisiones(
        f'No se reconoció el token en la respuesta de la API: {texto[:200]}'
    )


def _caducidad(token: str) -> datetime:
    """
    Caducidad real si el token es un JWT; si no, la supuesta.

    Merece la pena intentarlo: si el token trae `exp`, la interfaz puede avisar
    con la hora exacta en vez de dejar que la siguiente consulta falle con un
    401 sin explicación.
    """
    partes = token.split('.')
    if len(partes) == 3:
        try:
            relleno = '=' * (-len(partes[1]) % 4)
            carga = json.loads(base64.urlsafe_b64decode(partes[1] + relleno))
            exp = carga.get('exp')
            if isinstance(exp, (int, float)):
                return datetime.fromtimestamp(exp)
        except Exception:
            pass  # No es un JWT legible; se usa la vigencia supuesta.
    return datetime.now() + VIGENCIA_SUPUESTA


def solicitar_token(email: str, password: str) -> dict:
    """
    Pide el token diario. Devuelve `{token, caduca}`.

    La contraseña no se guarda en ningún sitio: se usa aquí y se descarta. Si
    el token caduca hay que volver a escribirla, que es lo correcto para una
    credencial de una API de gobierno en una máquina compartida.
    """
    if not email or not password:
        raise CredencialesInvalidas('Faltan el correo o la contraseña.')

    try:
        r = _sesion_http().post(
            RUTA_TOKEN,
            json={'email': email, 'password': password},
            timeout=TIEMPO_ESPERA,
        )
    except requests.RequestException as e:
        raise ErrorEmisiones(f'No se pudo contactar con la API de Emisiones: {e}')

    # La API responde 400 "Invalid Request" a unas credenciales que no valen,
    # no un 401. Se traduce aquí para que la interfaz pueda decir "revisa el
    # correo y la contraseña" en vez de "petición inválida", que sugiere un
    # error de programación y manda a buscar por el sitio equivocado.
    if r.status_code in (400, 401, 403):
        raise CredencialesInvalidas()
    if r.status_code >= 400:
        raise ErrorEmisiones(
            f'La API de Emisiones respondió {r.status_code} al pedir el token.'
        )

    token = _extraer_token(r)
    return {'token': token, 'caduca': _caducidad(token)}


# ---------------------------------------------------------------------------
# Consulta
# ---------------------------------------------------------------------------

def consultar_minutales(
    token: str,
    desde: datetime,
    hasta: datetime,
    sesion: requests.Session | None = None,
) -> list[dict]:
    """
    Trae el crudo del rango pedido, tal cual lo devuelve la API.

    El formato de fecha es el del ejemplo de la documentación,
    `YYYY-MM-DD HH:MM`. Va por `params` para que requests lo codifique: el
    espacio literal funciona en el navegador pero no en toda librería HTTP.
    """
    s = sesion or _sesion_http()

    # `startDate` SIEMPRE a medianoche. No es un capricho: si lleva una hora
    # distinta de 00:00 la API ignora el rango entero y devuelve solo la primera
    # hora de ese día. Comprobado contra el servidor — pedir 05:00-23:00 del 1
    # de septiembre devuelve las 12 filas de las 00:10, no las 18 horas
    # pedidas, y con 00:30 pasa lo mismo. Un cliente que confiara en la hora se
    # llevaría datos silenciosamente equivocados: respuesta 200, filas válidas,
    # periodo que no es el que se pidió.
    #
    # `endDate` sí se respeta (excluyente). Se pide de más y luego se recorta en
    # `descargar`, que es exacto y no cuesta nada: es una sola petición.
    inicio_dia = desde.replace(hour=0, minute=0, second=0, microsecond=0)
    params = {
        'startDate': inicio_dia.strftime('%Y-%m-%d %H:%M'),
        'endDate': hasta.strftime('%Y-%m-%d %H:%M'),
    }

    # El esquema de autorización tampoco está documentado. `Bearer` es lo
    # habitual en .NET y es lo que se prueba primero; si devuelve 401 se
    # reintenta con el token pelado antes de dar la sesión por caducada, para
    # no mandar al usuario a iniciar sesión otra vez por una diferencia de
    # formato en la cabecera.
    intentos = [
        {'Authorization': f'Bearer {token}'},
        {'Authorization': token},
    ]

    ultima: requests.Response | None = None
    for cabeceras in intentos:
        try:
            r = s.get(RUTA_MINUTALES, params=params, headers=cabeceras,
                      timeout=TIEMPO_ESPERA)
        except requests.RequestException as e:
            raise ErrorEmisiones(f'No se pudo consultar la API de Emisiones: {e}')
        if r.status_code not in (401, 403):
            ultima = r
            break
        ultima = r

    assert ultima is not None
    if ultima.status_code in (401, 403):
        raise SesionCaducada()
    if ultima.status_code >= 400:
        raise ErrorEmisiones(
            f'La API de Emisiones respondió {ultima.status_code}: '
            f'{(ultima.text or "")[:200]}'
        )

    try:
        cuerpo = ultima.json()
    except ValueError:
        raise ErrorEmisiones('La API devolvió algo que no es JSON.')

    return _lista_de_registros(cuerpo)


def _lista_de_registros(cuerpo: Any) -> list[dict]:
    """Desenvuelve la lista de registros esté suelta o dentro de un sobre."""
    if isinstance(cuerpo, list):
        return [x for x in cuerpo if isinstance(x, dict)]
    if isinstance(cuerpo, dict):
        for campo in ('data', 'datos', 'result', 'results', 'items',
                      'registros', 'minutales', 'value'):
            valor = cuerpo.get(campo)
            if isinstance(valor, list):
                return [x for x in valor if isinstance(x, dict)]
        # Un único registro sin envolver también es una respuesta válida.
        return [cuerpo]
    raise ErrorEmisiones('La respuesta de la API no tiene la forma esperada.')


# ---------------------------------------------------------------------------
# Normalización al formato BD
# ---------------------------------------------------------------------------

def _numero(valor: Any) -> float | None:
    """Convierte a float descartando centinelas y no-números."""
    if valor is None or isinstance(valor, bool):
        return None
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return None
    if math.isnan(n) or math.isinf(n) or n in CENTINELAS:
        return None
    return n


def _valor_y_bandera(dato, bandera_externa: float | None = None) -> float | None:
    """
    Lee una variable en cualquiera de sus tres formas.

    Anidada —`{"valor": 0.041, "unidad": "ppm", "bandera": 1}`, la del
    documento—, con la bandera en un campo hermano —`"O3": "0.018",
    "O3_Flag": "1"`, la que devuelve la API de verdad— o el número pelado.

    Solo pasa lo que trae bandera 1. Cualquier otra cosa es un dato que el
    propio operador ya marcó como no válido, y meterlo en el validador sería
    validar ruido. En la respuesta real esto no es un detalle: las banderas 0,
    2, 3, 4, 28 y 90 aparecen a diario, y con ellas viajan valores como -9999
    o una dirección de viento de -279 grados.
    """
    if isinstance(dato, dict):
        valor = None
        bandera = None
        for k, v in dato.items():
            c = _clave(k)
            if c in ALIAS_VALOR:
                valor = _numero(v)
            elif c in ALIAS_BANDERA:
                bandera = _numero(v)
        if bandera is None:
            bandera = bandera_externa
    else:
        valor = _numero(dato)
        bandera = bandera_externa

    if bandera is not None and int(bandera) != BANDERA_VALIDA:
        return None
    return valor


def _aplanar(registro: dict) -> dict:
    """
    Deja el registro en un solo nivel de pares clave -> valor.

    La respuesta real mete todas las mediciones en un sub-objeto `datos`, y el
    documento de la API las reparte entre `estacion`, `timestamp` y
    `variables`. Aplanar un nivel deja que el mismo código sirva para las dos
    formas y para una fila plana, sin tres caminos de parseo que luego se
    desincronizan.

    En un choque de nombres gana el nivel de arriba, con una excepción: si lo
    que choca es una fecha, la de dentro se guarda aparte en `CLAVE_MEDICION`.
    Sin eso se perdería `datos.Fecha` —la hora en que se midió— y quedaría solo
    `fechaHora`, que es cuando la red lo publicó, diez minutos más tarde.
    """
    plano: dict = {}
    vistos: set[str] = set()

    def poner(clave, valor):
        c = _clave(clave)
        if c in vistos:
            if c in ALIAS_FECHAHORA:
                plano.setdefault(CLAVE_MEDICION, valor)
            return
        vistos.add(c)
        plano[clave] = valor

    for clave, valor in registro.items():
        if isinstance(valor, dict):
            continue
        poner(clave, valor)

    # Los sub-objetos van después para que el nivel de arriba gane los choques.
    for valor in registro.values():
        if isinstance(valor, dict):
            for k, v in valor.items():
                poner(k, v)

    return plano


def _a_fecha(texto) -> datetime | None:
    """
    Convierte a fecha probando primero ISO y luego día/mes/año.

    El orden importa: la respuesta trae las dos formas —`fechaHora` en ISO y
    `datos.Fecha` como `1/9/2026 00:00:00`— y sin `dayfirst` la segunda se leería
    como 9 de enero. Un mes entero de datos aterrizaría en la fecha equivocada
    sin que nada fallara de forma visible.
    """
    if isinstance(texto, datetime):
        return texto
    s = str(texto).strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        pass
    try:
        return pd.to_datetime(s, dayfirst=True).to_pydatetime()
    except Exception:
        return None


def _abreviatura(nombre: Any) -> str:
    """Nombre de estación -> las tres letras que usa el validador."""
    texto = str(nombre).strip()
    c = _clave(texto)
    if c in ABREVIATURAS:
        return ABREVIATURAS[c]
    # Un identificador que ya viene en clave corta ('COU', 'ZMG-012') se
    # respeta tal cual: inventarle una abreviatura lo haría irreconocible.
    if len(texto) <= 8:
        return texto.upper()
    return texto[:3].upper()


def _momento(plano: dict) -> datetime | None:
    """
    Cuándo se midió esto.

    Primero la fecha de medición si `_aplanar` la apartó, porque es la buena:
    la marca del registro es la de publicación y va diez minutos por detrás. En
    la práctica ambas caen en la misma hora, pero apoyarse en la de publicación
    haría que cualquier reenvío tardío aterrizara en la hora equivocada.
    """
    if CLAVE_MEDICION in plano:
        marca = _a_fecha(plano[CLAVE_MEDICION])
        if marca is not None:
            return marca

    crudo = None
    fecha = None
    hora = None
    for clave, valor in plano.items():
        c = _clave(clave)
        if c in ALIAS_FECHAHORA and crudo is None and valor is not None:
            crudo = valor
            if c in ('fecha', 'date'):
                fecha = valor
                crudo = None
        elif c in ALIAS_HORA and hora is None:
            hora = valor

    if crudo is not None:
        return _a_fecha(crudo)
    if fecha is not None:
        return _a_fecha(f'{fecha} {hora}' if hora is not None else fecha)
    return None


def _estacion(plano: dict) -> str | None:
    for clave, valor in plano.items():
        if _clave(clave) in ALIAS_ESTACION and valor not in (None, ''):
            return _abreviatura(valor)
    return None


def _canal_de(plano: dict) -> str | None:
    """
    En formato largo, qué parámetro es esta fila.

    Se busca primero por id numérico y luego por nombre, porque el id es
    inequívoco: el catálogo de la API lo fija (1 = O3 ... 17 = TempInt) y no
    depende de cómo esté escrito el nombre ese día.
    """
    for clave, valor in plano.items():
        if _clave(clave) in ALIAS_ID_PARAMETRO:
            n = _numero(valor)
            if n is not None and int(n) in ID_PARAMETROS:
                return ID_PARAMETROS[int(n)]

    for clave, valor in plano.items():
        if _clave(clave) not in ALIAS_PARAMETRO:
            continue
        if isinstance(valor, str):
            canal = ALIAS_CANALES.get(_clave(valor))
            if canal:
                return canal
        n = _numero(valor)
        if n is not None and int(n) in ID_PARAMETROS:
            return ID_PARAMETROS[int(n)]

    # Último recurso: cualquier campo de texto cuyo VALOR sea el nombre de un
    # parámetro. Cubre el caso en que la medición se rotula con una clave
    # genérica ('nombre', 'descripcion'), que no se puede meter en
    # ALIAS_PARAMETRO porque 'nombre' también designa la estación. Mirar el
    # valor en vez de la clave resuelve la ambigüedad: 'O3' solo puede ser un
    # parámetro.
    for valor in plano.values():
        if isinstance(valor, str):
            canal = ALIAS_CANALES.get(_clave(valor))
            if canal:
                return canal
    return None


def _valor_suelto(plano: dict) -> float | None:
    """
    En formato largo, el valor de la fila y su bandera, que van en campos
    hermanos en vez de anidados. Misma regla: solo pasa la bandera 1.
    """
    valor = None
    bandera = None
    for clave, dato in plano.items():
        c = _clave(clave)
        if c in ALIAS_VALOR and valor is None:
            valor = _numero(dato)
        elif c in ALIAS_BANDERA and bandera is None:
            bandera = _numero(dato)
    if bandera is not None and int(bandera) != BANDERA_VALIDA:
        return None
    return valor


def _sublista(registro: dict) -> list[dict]:
    """
    Lista de mediciones colgando del registro, si la hay.

    Cubre la variante en que `variables` no es un objeto sino una lista de
    `{parametro, valor, bandera}`. Se acepta cualquier lista de objetos: si el
    registro trae una, sus elementos son las mediciones — no hay otra cosa que
    pueda ser.
    """
    for valor in registro.values():
        if isinstance(valor, list) and valor and all(isinstance(x, dict) for x in valor):
            return valor
    return []


def _medidas_anchas(plano: dict) -> dict:
    """
    Canales reconocidos cuando cada parámetro es una columna propia.

    Busca la bandera de cada canal en su campo hermano (`O3` -> `O3_Flag`),
    que es como la manda la API. Se prueban varios sufijos porque el nombre
    exacto no está documentado y no cuesta nada aceptar los cuatro habituales.
    """
    indice = {_clave(k): v for k, v in plano.items()}

    def bandera_de(clave_norm: str) -> float | None:
        for sufijo in SUFIJOS_BANDERA:
            valor = indice.get(clave_norm + sufijo)
            if valor is not None:
                return _numero(valor)
        return None

    medidas = {}
    for clave, valor in plano.items():
        clave_norm = _clave(clave)
        canal = ALIAS_CANALES.get(clave_norm)
        if canal is None:
            continue
        medidas[canal] = _valor_y_bandera(valor, bandera_de(clave_norm))
    return medidas


def normalizar(registros: Iterable[dict]) -> pd.DataFrame:
    """
    Pasa los registros minutales al formato BD horario del validador.

    Acepta las tres formas en que una API de monitoreo suele entregar esto, sin
    que haya que decirle cuál viene:

    - **Ancha**: cada parámetro es una columna del registro.
    - **Larga con lista**: el registro trae una lista de mediciones, cada una
      con su parámetro y su valor.
    - **Larga por fila**: cada registro ES una medición de un solo parámetro.

    Las tres acaban en filas de un canal y `_a_horario` las junta: agrupa por
    estación y hora promediando, y los huecos no estorban porque la media los
    ignora. Por eso no hace falta un pivote aparte para el formato largo.

    Dos conversiones ocurren aquí y las dos importan:

    **De minuto a hora.** El validador razona en horas: sus banderas, el MIR y
    los umbrales de la NOM están definidos sobre el valor horario. Los minutos
    se promedian dentro de cada hora, que es como el propio SIMAJ construye su
    dato horario.

    **La dirección del viento se promedia en vectores, no en números.** El
    promedio aritmético de 350° y 10° da 180°, viento del sur, justo lo
    contrario del norte que sopla de verdad. Se descompone en seno y coseno, se
    promedian esas componentes y se recompone el ángulo.
    """
    filas: list[dict] = []
    reconocidos: set[str] = set()
    campos_vistos: set[str] = set()
    muestra: dict | None = None

    def emitir(estacion: str, marca: datetime, medidas: dict) -> None:
        if not medidas:
            return
        reconocidos.update(medidas)
        filas.append({
            'STATION': estacion,
            'DATE': marca.strftime('%Y-%m-%d'),
            'HOUR': marca.hour,
            **medidas,
        })

    for registro in registros:
        if muestra is None:
            muestra = registro
        plano = _aplanar(registro)
        campos_vistos.update(str(k) for k in plano)
        marca = _momento(plano)
        estacion = _estacion(plano)
        if marca is None or estacion is None:
            continue

        anchas = _medidas_anchas(plano)
        if anchas:
            emitir(estacion, marca, anchas)
            continue

        sublista = _sublista(registro)
        if sublista:
            for item in sublista:
                p = _aplanar(item)
                campos_vistos.update(str(k) for k in p)
                canal = _canal_de(p)
                medidas = _medidas_anchas(p) or (
                    {canal: _valor_suelto(p)} if canal else {}
                )
                # La estación se toma siempre del registro padre, nunca del
                # elemento: dentro de una medición un campo 'nombre' es el del
                # parámetro, y leerlo como estación inventaría una estación
                # llamada 'O3'.
                emitir(estacion, _momento(p) or marca, medidas)
            continue

        # Larga por fila: el registro entero es una sola medición.
        canal = _canal_de(plano)
        if canal:
            emitir(estacion, marca, {canal: _valor_suelto(plano)})

    if not filas or not reconocidos:
        # O no se reconoció ni una fila, o se reconocieron pero sin una sola
        # variable. En ambos casos vale más decir QUÉ llegó que devolver un
        # DataFrame vacío: el validador lo procesaría tan campante y daría un
        # tablero en blanco sin que nadie sepa por qué.
        #
        # Los nombres de campo van en el propio mensaje a propósito: son
        # exactamente el dato que hace falta para añadir el alias que falta, y
        # sin ellos hay que ir a buscarlos al log del servidor.
        if muestra is None:
            return pd.DataFrame(columns=['STATION', 'DATE', 'HOUR'] + CANALES_BD)
        print('[emisiones] No se reconoció la respuesta. Primer registro: '
              + json.dumps(muestra, ensure_ascii=False, default=str)[:2000],
              flush=True)
        vistos = ', '.join(sorted(campos_vistos)[:25]) or '(ninguno)'
        raise ErrorEmisiones(
            'No se reconoció el formato de la respuesta. '
            f'Campos recibidos: {vistos}'
        )

    df = pd.DataFrame(filas)
    for canal in CANALES_BD:
        if canal not in df.columns:
            df[canal] = None
    df = df[['STATION', 'DATE', 'HOUR'] + CANALES_BD]

    return _a_horario(df)


def _a_horario(df: pd.DataFrame) -> pd.DataFrame:
    """Promedia los minutos de cada hora. Ver la nota de `normalizar`."""
    numericos = [c for c in CANALES_BD if c != 'WD']
    for c in CANALES_BD:
        df[c] = pd.to_numeric(df[c], errors='coerce')

    llaves = ['STATION', 'DATE', 'HOUR']
    if not df.duplicated(subset=llaves).any():
        return df.sort_values(llaves).reset_index(drop=True)

    agrupado = df.groupby(llaves, as_index=False)[numericos].mean()

    if df['WD'].notna().any():
        aux = df[llaves].copy()
        ang = np.deg2rad(df['WD'].astype(float))
        aux['_sin'] = np.sin(ang)
        aux['_cos'] = np.cos(ang)
        medias = aux.groupby(llaves, as_index=False)[['_sin', '_cos']].mean()
        grados = np.degrees(np.arctan2(medias['_sin'], medias['_cos'])) % 360
        medias['WD'] = grados.where(medias['_sin'].notna())
        agrupado = agrupado.merge(medias[llaves + ['WD']], on=llaves, how='left')
    else:
        agrupado['WD'] = None

    agrupado = agrupado[['STATION', 'DATE', 'HOUR'] + CANALES_BD]
    return agrupado.sort_values(llaves).reset_index(drop=True)


def _recortar(df: pd.DataFrame, desde: datetime, hasta: datetime) -> pd.DataFrame:
    """
    Deja solo las horas del rango pedido.

    Hace falta porque `consultar_minutales` pide desde el principio del día:
    ver la nota de allí sobre `startDate`. Sin este recorte, pedir "del 5 al 6"
    devolvería también las horas del 5 anteriores a la hora pedida.
    """
    if df.empty:
        return df
    marcas = pd.to_datetime(df['DATE'], errors='coerce') + pd.to_timedelta(df['HOUR'], unit='h')
    dentro = (marcas >= pd.Timestamp(desde)) & (marcas < pd.Timestamp(hasta))
    return df[dentro].reset_index(drop=True)


def descargar(token: str, desde: datetime, hasta: datetime) -> pd.DataFrame:
    """Consulta, normalización y recorte, que es lo único que necesita la ruta."""
    df = normalizar(consultar_minutales(token, desde, hasta))
    return _recortar(df, desde, hasta)
