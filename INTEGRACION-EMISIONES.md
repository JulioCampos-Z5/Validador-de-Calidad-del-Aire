# Integración con la API de Emisiones de Jalisco

Cuarto origen de datos del validador, junto al Trs.xlsx de ENVISTA, el archivo
ya validado y la descarga de los minutales del SIMAJ.

A diferencia de los otros dos orígenes de red, este **sí es una API formal**:
se pide un token con correo y contraseña y con él se consulta un rango de
fechas de una sola vez, en vez de raspar un listado de IIS y bajar un archivo
por estación y hora.

```
POST /consultas/api/Authentication/requestToken   {email, password} -> token
GET  /consultas/api/Minutales/?startDate=&endDate=                  -> datos
```

Servidor: `https://emisiones.jalisco.gob.mx:4443`.

---

## Principio: sigue siendo el mismo tablero

Igual que con el SIMAJ, **consultar la API y subir un archivo son la misma cosa
para el resto del sistema**. `/api/emisiones/descargar` devuelve exactamente la
misma forma de respuesta que `/api/validate/full`, así que el tablero, las
gráficas, la tabla de datos, el resumen de banderas y la descarga del Excel
funcionan sin enterarse de por dónde entraron los datos.

```
Subir Trs.xlsx   ─┐
Descargar SIMAJ  ─┼─► formato BD ─► validar_datos_completo ─► tablero / gráficas / Excel
Consultar la API ─┘
```

Por eso no hay pantalla nueva: el origen se elige en el mismo menú lateral que
los otros tres.

---

## Qué se añadió

```
backend/emisiones/
├── cliente.py   Token, consulta y normalización al formato BD
└── rutas.py     Blueprint /api/emisiones

frontend/src/
├── services/emisiones.ts          Cliente
└── components/PanelEmisiones.tsx  Acceso + selector de rango
```

### Endpoints

| Ruta | Qué hace |
|---|---|
| `GET /api/emisiones/sesion` | ¿Hay token vivo y hasta cuándo? |
| `POST /api/emisiones/login` | Correo + contraseña → token del día |
| `POST /api/emisiones/salir` | Olvida el token |
| `POST /api/emisiones/descargar` | Rango de fechas → datos validados |
| `GET /api/emisiones/muestra` | Respuesta cruda sin normalizar, para diagnosticar |

---

## Dónde vive el token

En **memoria del proceso de Python**. Ni en disco, ni en el navegador, ni en
`localStorage`.

- La contraseña se usa para pedir el token y se descarta en el acto; no se
  guarda ni siquiera en memoria.
- Al frontend nunca le llega el token: solo si hay sesión, con qué correo y
  cuándo caduca.
- Al reiniciar el backend hay que volver a entrar. Es el precio de no dejar una
  credencial de una API de gobierno en un archivo que alguien pueda leer luego.

La petición la hace el backend aunque el servidor sí manda
`Access-Control-Allow-Origin: *` y el navegador técnicamente podría llamarlo
directo. Se hace así para que la contraseña no pase por el renderer y para
armar el DataFrame donde ya vive pandas.

**Caducidad.** Se lee del propio token: los que devuelve la API son JWT y
traen su `exp` — el observado dura **una semana**, no un día. Si algún día
dejara de ser un JWT legible, se asume una vigencia de 8 horas. Si el
token muere a mitad de una consulta, el backend responde 401, limpia la sesión
y la interfaz vuelve a mostrar el formulario de acceso — en vez de reintentar
contra un token muerto.

---

## Dos conversiones que importan

**De minuto a hora.** La API devuelve minutales; el validador razona en horas
—sus banderas, el MIR y los umbrales de la NOM están definidos sobre el valor
horario—. Los minutos se promedian dentro de cada hora, que es como el propio
SIMAJ construye su dato horario.

**La dirección del viento se promedia en vectores, no en números.** El promedio
aritmético de 350° y 10° da 180°: viento del sur, justo lo contrario del norte
que sopla de verdad. Se descompone en seno y coseno, se promedian esas
componentes y se recompone el ángulo.

---

## La forma real de la respuesta

Comprobada contra el servidor. Es una lista de registros, uno por estación y
hora:

```json
{
  "estacion": "CENTRO",
  "fecha": "01/09/2026",
  "hora": "00:10",
  "fechaHora": "2026-09-01T00:10:00",
  "datos": {
    "Monitor / Variable": "1",
    "Fecha": "1/9/2026 00:00:00",
    "O3": "0.018",  "O3_Flag": "1",
    "NO": "0.0002", "NO_Flag": "1",
    "WS": "-9999",  "WS_Flag": "0",
    "WD": "-279",   "WD_Flag": "4",
    "Presión_atmosférica": "660.8886", "Presión_atmosférica_Flag": "1",
    "…": "…"
  }
}
```

Cuatro cosas que condicionan el parseo:

1. **Las mediciones cuelgan de `datos`, no del registro.** Por eso `_aplanar`
   baja un nivel los sub-objetos.
2. **La bandera va en un campo hermano**, `O3` / `O3_Flag`, no anidada junto al
   valor. Solo pasa la bandera `1`; en un día cualquiera aparecen también 0, 2,
   3, 4, 28 y 90, y con ellas viajan valores como `-9999` o una dirección de
   viento de `-279` grados.
3. **Todos los valores son cadenas**, incluidos los números y las banderas.
4. **Hay dos fechas y no son la misma.** `fechaHora` es cuando la red publicó
   —siempre a los :10 de cada hora— y `datos.Fecha` es cuándo se midió. Manda
   la de medición. Además viene en día/mes/año: sin `dayfirst`, `1/9/2026` se
   leería como 9 de enero y un mes entero aterrizaría en la fecha equivocada
   sin que nada fallara de forma visible.

Pese al nombre del endpoint, **el dato es horario**, no minutal: un registro por
estación y hora. La agregación a hora se queda como red de seguridad por si
algún día llegan minutos de verdad.

---

## La trampa de `startDate`

**`startDate` tiene que ir a medianoche.** Si lleva cualquier otra hora, la API
ignora el rango y devuelve solo la primera hora de ese día — con un `200` y
filas perfectamente válidas. Comprobado:

| Petición | Devuelve |
|---|---|
| `01 00:00` → `02 00:00` | 21 horas del día 1 ✔ |
| `02 00:00` → `02 12:00` | 12 horas, de 00:10 a 11:10 ✔ |
| `01 05:00` → `01 23:00` | **solo las 00:10** ✘ |
| `01 00:30` → `01 03:00` | **solo las 00:10** ✘ |

`endDate` sí se respeta y es excluyente.

Es el peor tipo de fallo —no hay error, hay datos del periodo equivocado—, así
que el cliente **siempre pide desde el principio del día y recorta después**
(`_recortar`). Cuesta una petición igual y el rango que sale es exacto.

---

## El parseo es tolerante a propósito

No hay swagger ni contrato publicado (`/swagger/v1/swagger.json` devuelve 404),
así que en lugar de fijar nombres de campo:

- Las columnas se reconocen **por alias normalizados**: `TempExt`,
  `Presión_atmosférica` y `ET` se reducen a una forma sin acentos ni
  separadores antes de buscarse. Añadir una variante es añadir una entrada en
  `ALIAS_CANALES`.
- Se aceptan **cuatro formas de respuesta**: la real (mediciones en `datos` con
  banderas hermanas), la anidada del documento (`{valor, unidad, bandera}`), la
  larga con lista de mediciones y la larga por fila. El parámetro se reconoce
  también **por id numérico** del catálogo (1 = O₃ … 17 = TempInt), que es
  inequívoco.
- Se descartan los centinelas del datalogger (`-9999`, `-999`, `9999`).

Si llega algo que no encaja en ninguna forma, la consulta falla con un mensaje
que **lista los campos recibidos** y vuelca el primer registro al log. Es
justo el dato que hace falta para añadir el alias que falte, y evita el otro
final posible: un DataFrame de puros huecos que el validador procesaría tan
campante, dando un tablero en blanco sin que nadie sepa por qué. `GET
/api/emisiones/muestra` enseña la respuesta cruda cuando hace falta mirarla.

El esquema de autorización tampoco está documentado: se prueba
`Authorization: Bearer <token>` y, si devuelve 401, el token pelado, antes de
dar la sesión por caducada. Así una diferencia de formato en la cabecera no
manda al usuario a iniciar sesión otra vez.

---

## Límite de rango

Máximo **31 días por consulta** (`DIAS_MAXIMOS` en `rutas.py`). Un minutal por
estación son ~13 filas por minuto: un mes ya son cientos de miles de registros.
Es un límite del cliente, no de la API, y está para que el error sea claro en
vez de un tiempo de espera agotado sin explicación. El selector de fechas avisa
antes de enviar.

---

## Por qué aquí no hay MIR

El indicador necesita saber qué horas **debería** haber en el periodo, y eso
solo lo sabe el flujo del SIMAJ, que recorre el calendario estación por
estación. Una consulta a la API trae las filas que hay, no las que faltan —
igual que un archivo—, así que se comporta como el flujo de archivo: tablero,
gráficas y Excel sí; MIR y reporte de fallas no.

---

## Comprobado

Contra el servidor real, con token válido:

- **Un día completo (1 sep):** 252 filas, 12 estaciones, 21 horas — exactamente
  los registros que trae la respuesta cruda. Ni un `-9999` ni un `-279`
  sobrevive al filtro de banderas.
- **Dos días (5–6 sep) por la ruta completa:** 623 filas, 13 estaciones,
  validadas y con su Excel generado.
- **El caso de la trampa:** pedir `12:00`–`18:00` ahora devuelve las horas 12 a
  15 (16 y 17 no están en origen). Antes del recorte habría devuelto la hora 0.
- Credenciales inválidas: la API responde `400 Invalid Request`, que se traduce
  a "Correo o contraseña incorrectos" (un 400 crudo sugiere un error de
  programación y manda a buscar por el sitio equivocado).
- Consulta sin sesión: `401` con mensaje, no una traza.
- Rango invertido y rango de más de 31 días: avisan en el panel y desactivan el
  botón.
- Promedio vectorial de `WD` (350° y 10° → 0°, no 180°) y las cuatro formas de
  respuesta, con datos sintéticos.

**Nota:** la respuesta trae 12 o 13 estaciones según el periodo; ATEMAJAC no
aparece en algunos días.
