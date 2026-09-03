# Integración con los minutales del SIMAJ

Rama `integracion-minutales`.

El validador ya no depende de que alguien exporte un `Trs.xlsx` desde ENVISTA:
puede bajar los datos por su cuenta de `https://aire.jalisco.gob.mx/minutales/`.

---

## Principio de la integración

**Descargar del SIMAJ y subir un archivo son la misma cosa para el resto del
sistema.** El endpoint de descarga devuelve exactamente la misma forma de
respuesta que `/api/validate/full`, así que el tablero, las gráficas, la tabla
de datos, el resumen de banderas, las estadísticas detalladas y la descarga del
Excel funcionan sin enterarse de por dónde entraron los datos. Lo único que
cambia es el origen.

Por eso **no hay una pantalla nueva**. El selector de origen vive junto al área
de subir archivo, en el Dashboard y en Gráficas, y usa la misma configuración de
validación que ya estuviera puesta.

```
Subir Trs.xlsx  ─┐
                 ├─► formato BD ─► validar_datos_completo ─► tablero / gráficas / Excel
Descargar SIMAJ ─┘
```

---

## Qué se añadió

```
backend/minutales/
├── cliente.py   Descarga y parseo de los .lsi -> formato BD
├── mir.py       Indicador MIR y diagnóstico de fallas
└── rutas.py     Blueprint /api/minutales

frontend/src/
├── services/minutales.ts        Cliente
├── components/FuenteSimaj.tsx   Selector de origen (junto al de subir archivo)
├── components/TarjetaMir.tsx    Indicador MIR con selección de contaminantes
└── components/ReporteFallas.tsx Dónde falla cada estación

escritorio/      App de escritorio (Electron)
```

### Endpoints

| Ruta | Qué hace |
|---|---|
| `GET /api/minutales/estaciones` | Lista las 13 estaciones publicadas |
| `GET /api/minutales/progreso` | Avance de la descarga en curso |
| `POST /api/minutales/descargar` | Descarga + valida. Misma respuesta que `validate/full`, más `mir` y `fallas` |
| `POST /api/minutales/mir` | Recalcula el MIR con otra selección, sin volver a descargar |
| `GET /api/minutales/reporte.csv` | Exporta la tabla del MIR |

**Rendimiento medido:** un mes de las 13 estaciones son ~9,400 archivos y tarda
**unos 13 s** con la caché fría. Los `.lsi` se guardan en disco; el histórico no
cambia, así que la segunda corrida solo baja lo nuevo.

---

## Indicador MIR

Mide **representatividad de los datos**, no contaminación: para cada estación
promedia el porcentaje de horas válidas de los contaminantes criterio elegidos y
lo compara contra el 75%.

La regla se dedujo de la hoja del área técnica y **se comprobó reproduciendo sus
filas una a una**. Dos detalles que no son obvios y que cambian el resultado:

1. **El promedio es simple entre contaminantes, no ponderado por horas.**
2. **Un contaminante sin equipo se excluye del promedio; no cuenta como cero.**
   Es la diferencia entre "aquí no hay instrumento" y "el instrumento no
   reportó". Ejemplo comprobado: Santa Anita con `100, 100, (sin equipo), 33,
   99, 100` da **86** excluyendo el hueco; contándolo como cero daría 72 y la
   estación pasaría de cumplir a no cumplir.

Los contaminantes que entran se eligen con casillas, y cambiarlos **recalcula
sin volver a descargar**.

### Por qué el MIR se calcula antes de validar

Sobre los datos crudos, no sobre los validados. Mide cuánto publicó la red, no
cuánto sobrevivió a las reglas. Si se calculara después, una estación con un
sensor descalibrado se vería igual que una que no reporta, y son dos problemas
distintos que se atienden distinto.

### Horas esperadas, no filas presentes

La cobertura se calcula contra las horas del calendario, no contra las filas del
archivo. Si se contara sobre las filas presentes, una estación que dejó de
publicar una semana saldría con 100%: no hay filas malas porque no hay filas.

---

## Reporte de fallas

El MIR dice "COU 50, no cumple", que no le sirve a quien tiene que ir a
arreglarlo. El reporte señala el canal concreto y separa tres situaciones:

| Tipo | Qué significa |
|---|---|
| **Caído** | Hay equipo pero reporta menos del 25% de las horas |
| **Intermitente** | Reporta a ratos, por debajo del umbral |
| **Sin equipo** | Ni una lectura en el periodo; suele ser una decisión, no una avería |

Se ordenan poniendo primero los canales que **tumban a su estación**, que son los
que hay que atender para recuperar el indicador.

---

## App de escritorio

```bash
cd escritorio
npm install
npm run dev    # abre la app
npm run exe    # genera los ejecutables en ../salida/
```

Produce `Validador-portable.exe` y `Validador-instalador.exe` (73 MB cada uno).

**Cómo funciona.** Electron arranca el backend Flask como proceso hijo, espera a
que `/api/health` responda y abre la ventana. Flask sirve además el frontend ya
compilado, así que página y API comparten origen: las llamadas a `/api`
funcionan tal cual, sin proxy ni CORS, y **la misma compilación sirve para web y
para escritorio**.

El backend se mata al cerrar la ventana; si no, quedaría vivo ocupando el puerto
8000 y el siguiente arranque fallaría sin explicar por qué.

> **Requiere Python 3.10+ instalado.** El ejecutable trae Electron y el código
> del backend, pero no el intérprete. Si no lo encuentra, avisa con un diálogo
> claro en vez de fallar en silencio. Para un `.exe` verdaderamente autónomo
> habría que empaquetar el backend con PyInstaller — no está hecho.

---

## Dos correcciones al código existente

**1. Caída con pandas 3.** `validar_rangos` escribía la cadena `'IR'` dentro de
una columna `float64`. Pandas 2 lo convertía en silencio; **pandas 3.0.5 lanza
`TypeError`**. Con archivos de ENVISTA no se notaba porque ahí las columnas
llegan mezcladas con texto y son `object` desde el inicio; era un fallo latente
esperando a la primera fuente de datos bien tipada, y los minutales lo
destaparon de inmediato. Se corrigió en los cinco sitios que escriben banderas.

**2. `debug=True` en `0.0.0.0`.** El depurador de Werkzeug permite ejecutar
código arbitrario desde el navegador, y estaba expuesto a toda la red. Ahora
escucha en `127.0.0.1` con debug apagado; se reactiva con `VALIDADOR_DEBUG=1` y
`VALIDADOR_HOST` para desarrollo.

---

## Pendiente

- **NOM-172: ¿2019 o 2023?** Los umbrales de clasificación que hay en el
  ecosistema vienen etiquetados como NOM-172-SEMARNAT-**2019**. Conviene
  confirmar si deben actualizarse a la versión 2023 antes de usarlos en
  reportes oficiales. *No afecta al MIR*, que solo mide suficiencia de datos.
- Empaquetar el backend con PyInstaller para no depender de Python instalado.
- Firmar los ejecutables: sin certificado, SmartScreen avisa la primera vez.
