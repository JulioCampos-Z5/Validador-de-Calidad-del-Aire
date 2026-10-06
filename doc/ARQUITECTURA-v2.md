# Arquitectura v2.0.0

Plan de la versión 2 del Validador de Calidad del Aire: una **API central en Go**,
el **backend de Python como motor de análisis** y un **frontend rediseñado por
módulos**. Este documento es la referencia para implementar; no describe nada
que ya exista.

> Estado: **planeación**. Rama `v2.0.0`.

---

## 1. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Dónde vive la API | En este mismo repositorio, carpeta `api/`, con su propio `go.mod` |
| Arquitectura de la API | Monolito modular: un binario, un módulo por dominio, y dentro de cada uno `handler → service → repository` |
| Papel de la API | Es el **centro**: toda escritura pasa por ella, es dueña de los datos y de la bitácora |
| Papel de Python | Solo **analizar** (validación, Excel, gráficas) para la web y el escritorio. No es dueño de datos |
| Login | Uno solo, emitido por la API. Python acepta el mismo token |
| Roles | **root**, **admin**, **técnico** (edita inventario, ve lo demás) y **user** (solo ve) |
| Tiempo real | El detector **avisa** (eventos + latido); el servidor no consulta a las estaciones |
| Hacia el navegador | SSE (Server-Sent Events) |
| Job de evaluación | Cada minuto: datos validados **y** estado de equipos |
| Inventario | Se maneja **desde el validador** (solo admin) |
| `formato-calibracion` | Lee equipos y **guarda sus calibraciones en la base de inventario**, a través de la API |
| Mantenimiento | La app de mantenimiento del diagrama es ahora la de **almacén** |
| Google | **No se usa** |
| Frontend | Shell con menú lateral + **un iframe por módulo**, sin pestañas |
| Inventario, puertos y almacén | **En proceso**: queda la estructura en la API, sin crear sus bases |

---

## 2. Vista general

```
 ESTACIONES                           SERVIDOR (8 GB · 4 núcleos)
┌─────────────────────┐   eventos   ┌────────────────────────────────────────┐
│ detector-puertos ⏳  │──HTTPS─────►│ API Go                                 │
│  caída · latido     │◄──── ack ───│  ├ usuarios · bitácora                 │
│  bandeja local      │             │  ├ envista · ambientweather · validación│
└─────────────────────┘             │  ├ inventario ⏳ · puertos ⏳ · almacen ⏳│
┌─────────────────────┐             │  ├ job c/1 min                         │
│ formato-calibracion │◄─GET/POST──►│  ├ SSE (alertas en vivo)               │
└─────────────────────┘             │  └ foto pública c/1 min                │
┌─────────────────────┐             │         │                    ▲         │
│ página web externa  │──GET───────►│         ▼                    │         │
└─────────────────────┘             │   MySQL (bases activas)   Python/Flask │
                                    └──────────────────────────────┬─────────┘
                                                                   ▼
                                        VALIDADOR · web y escritorio (Electron)
                                        shell + módulos en iframe
```

⏳ = en proceso: diseñado, sin integrar.

---

## 3. API en Go

### 3.1 Estructura

```
api/
├── cmd/
│   ├── api/main.go          servidor HTTP + jobs; registra los módulos
│   └── admin/main.go        tareas de mantenimiento (alta de admin, tokens de estación)
├── internal/
│   ├── modulo/              contrato común de los módulos
│   ├── usuarios/            ✅ login, tokens, roles, bitácora      → base semadet
│   ├── envista/             ✅ lecturas y banderas                  → base envista
│   ├── ambientweather/      ✅ datos de Ambient Weather             → base ambient_weather
│   ├── validacion/          ✅ puente con Python + evaluación c/1 min
│   ├── alertas/             ✅ niveles, umbrales, SSE
│   ├── publico/             ✅ foto en memoria para la página externa
│   ├── inventario/          ⏳ equipos, ubicación, movimientos
│   ├── puertos/             ⏳ eventos y latidos del detector
│   ├── almacen/             ⏳ mantenimientos y entradas/salidas de almacén
│   └── platform/
│       ├── config/          variables de entorno
│       ├── db/              conexión por base
│       ├── auth/            middleware de token y de rol
│       ├── httpx/           JSON, errores, registro de peticiones
│       └── outbox/          tareas pendientes con reintento
└── dev/                     MySQL de desarrollo (docker compose, puerto 3307)
```

Cada módulo trae sus migraciones en `internal/<modulo>/migraciones/`,
embebidas en el binario. Al encender un módulo, sus tablas se crean solas.

**Avance (2026-10-05):** construidos y probados en local `usuarios` y
`puertos`, con la integración del detector (eventos, latido, bandeja, sin
comunicación). Detalle en [api/README.md](../api/README.md).

Dentro de cada módulo:

| Archivo | Responsabilidad |
|---|---|
| `handler.go` | Lee la petición, valida forma, responde JSON. No toca la base |
| `service.go` | Reglas de negocio. Es lo único que otros módulos pueden usar |
| `repository.go` | SQL contra **su** base. No sabe de HTTP |
| `model.go` | Structs del dominio y forma del JSON de salida |

**Reglas:**

1. Un módulo **no importa el repository de otro**; usa su `service`.
2. Todo se arma en `main.go` (inyección de dependencias). Sin variables globales.
3. Las fechas se guardan en **UTC** y se pasan a hora de Guadalajara solo al mostrar.

### 3.2 Contrato de módulo y encendido por configuración

Todos los módulos cumplen el mismo contrato: **nombre, rutas, jobs y salud**.
`main.go` los registra todos, pero cada uno se **enciende solo si tiene su
configuración** (su cadena de conexión):

| Variable | Módulo |
|---|---|
| `MYSQL_DSN_SEMADET` | usuarios (obligatoria) |
| `MYSQL_DSN_ENVISTA` | envista |
| `MYSQL_DSN_AMBIENT_WEATHER` | ambientweather |
| `MYSQL_DSN_INVENTARIO` | inventario ⏳ |
| `MYSQL_DSN_PUERTOS` | puertos ⏳ |
| `MYSQL_DSN_ALMACEN` | almacen ⏳ |

Módulo apagado:

- no abre conexión ni corre jobs;
- sus rutas responden **`503 {"error": "módulo en proceso"}`**;
- aparece como `en_proceso` en `GET /api/modulos`.

`GET /api/modulos` es lo que usan el shell (para armar el menú) y
`formato-calibracion` (para decidir si usa su respaldo).

**Integrar un módulo en proceso** = crear su base → aplicar su migración →
agregar su variable → reiniciar la API. Sin tocar el código de otros módulos.

### 3.3 Rutas

| Ruta | Rol | Módulo |
|---|---|---|
| `POST /api/auth/login` · `POST /api/auth/renovar` · `POST /api/auth/salir` | público / sesión | usuarios |
| `GET /api/usuarios` · `POST` · `PATCH /api/usuarios/{id}` | admin | usuarios |
| `GET /api/bitacora` | admin | usuarios |
| `GET /api/modulos` | público | — |
| `GET /api/salud` | público | — |
| `GET /api/envista/...` | user | envista |
| `GET /api/ambient-weather/...` | user | ambientweather |
| `GET /api/validacion/estado` | user | validacion |
| `/api/analisis/*` → Python | user / admin | validacion (proxy) |
| `GET /api/alertas` · `GET /api/alertas/stream` (SSE) | user | alertas |
| `GET` · `PUT /api/alertas/umbrales` | user / admin | alertas |
| `GET /api/publico/resumen` | público | publico |
| `GET /api/inventario/equipos` · `/equipos/{ns}` | user | inventario ⏳ |
| `POST /api/inventario/movimientos` | admin · técnico | inventario ⏳ |
| `POST /api/puertos/eventos` · `POST /api/puertos/latido` | token de estación | puertos ⏳ |
| `GET /api/puertos/estado` · `/api/puertos/tramos` | user | puertos ⏳ |
| `GET /api/almacen/...` | user | almacen ⏳ |

---

## 4. Tiempo real y no perder trabajo

### 4.1 Del detector a la API (⏳ con el módulo puertos)

| Envío | Cuándo | Para qué |
|---|---|---|
| **Evento** `puerto_caido` / `puerto_recuperado` | Al cambiar de estado | Alerta inmediata |
| **Latido** | Cada 1 min, mensaje pequeño | Saber que la estación vive |

- El latido es indispensable: una estación sin luz o sin red **no puede avisar
  que murió**. La API genera "estación sin comunicación" cuando faltan latidos.
- **Bandeja local:** el detector guarda cada evento en disco antes de enviarlo.
  Si la API no responde, reintenta con espera creciente y lo indica en su
  pantalla. Al volver el servidor, vacía la bandeja en orden.
- **Idempotencia:** cada evento lleva un ID único generado en el detector; un
  reenvío no se duplica.
- La estación se identifica por su **token**, nunca por el cuerpo del mensaje.
  En la base solo se guarda el hash del token.

### 4.2 De la API al validador

**SSE**: el shell abre **una** conexión a `/api/alertas/stream` y reenvía cada
alerta al módulo activo por `postMessage`.

### 4.3 Garantías

| Riesgo | Cómo se evita |
|---|---|
| La API se cae a mitad de un evento | Se guarda en MySQL **antes** del ack; sin ack, el detector reintenta |
| Falla una tarea secundaria | **Outbox**: se anota en la base y un worker la reintenta |
| Reinicio del servidor | Jobs y pendientes viven en la base, no en memoria |
| Se cae Python o el validador | La API sigue recibiendo y sirviendo; solo se pausa el análisis |

### 4.4 Job de cada minuto

1. **Datos validados:** consulta al validador y, si no responde, a la
   **instancia separada**. Evalúa banderas, suficiencia, NOM-172 y MIR.
2. **Estado de equipos** (⏳ cuando estén inventario y puertos): ¿está en
   estación?, ¿su puerto da datos?, ¿mantenimiento al día y sin falla?
3. Guarda el resultado; si algo cambió, emite la alerta por SSE.
4. Si validador e instancia fallan: conserva el último resultado bueno, lo marca
   **desactualizado desde HH:MM** y genera una alerta.

El job evalúa **solo lo que esté encendido**; al integrar un módulo, su parte
se suma sola.

---

## 5. Login, roles y bitácora

- La API emite un **token de acceso** corto y un **token de renovación** guardado
  en `semadet`. Python valida el mismo token con la misma llave.
- Roles: **root**, **admin**, **técnico** y **user** (ver tabla). Se revisa el rol
  por ruta; no hace falta matriz de permisos.
- **Bitácora** en la API: quién, qué, cuándo, valor anterior y valor nuevo, para
  todo cambio; más los inicios de sesión. Como todas las escrituras pasan por la
  API, nada queda fuera.
- Los detectores usan tokens de estación y en la bitácora aparecen como la
  estación.

| Acción | root | admin | técnico | user |
|---|---|---|---|---|
| Ver tablero, análisis, gráficas, inventario | ✅ | ✅ | ✅ | ✅ |
| Editar inventario | ✅ | ✅ | ✅ | — |
| Configurar umbrales | ✅ | ✅ | — | — |
| Usuarios, tokens de estación, bitácora | ✅ | ✅ | — | — |

root y admin tienen los mismos permisos; solo cambia el cargo.

Base `semadet`:

```
usuarios  (id, nombre, correo, contrasena, rol, estatus)   rol: root · admin · tecnico · user
sesiones  (id, idUsuario, fechaInicio, fechaFin)
bitacora  (id, idUsuario, fecha, accion, detalle)
```

`contrasena` se guarda como hash, nunca en texto.

---

## 6. Umbrales de alerta

| Nivel | Condición | Significado |
|---|---|---|
| 🟡 Aviso | 1 h sin datos | Revisar |
| 🟠 Crítico | 4 h sin datos | Quedan ~2 h antes de perder el día |
| 🔴 Incumple NOM / MIR | > 6 h en el día, o suficiencia < 75 % | El promedio de 24 h ya no es válido (NOM-172: 18 de 24 horas) |

Se configuran desde **Admin**. Antes de implementar, confirmar contra lo que ya
calcula el backend (`ias/`, cumplimiento NOM, MIR).

---

## 6.1 Bases de las fuentes: `envista` y `ambient_weather`

Usan **los mismos campos que su fuente**, sin rediseñarlos:

- `envista`: las tablas y columnas del SQL Server de Envista.
- `ambient_weather`: los campos de la API de Ambient Weather, como ya los guarda
  la app `ambient-weather` (una fila por lectura, llave `(mac, dateutc)` para no
  duplicar, y el JSON crudo para campos extra).

---

## 7. Módulos en proceso (diseño, sin integrar)

### 7.1 Inventario ⏳

Fuente única de los equipos. Se maneja desde el validador, solo admin.

```
equipos         (id, noPieza, resguardante, anioAdquisicion, tipo, parametro,
                 marca, modelo, equipo, numeroSerie, conexion,
                 fechaUltimaActualizacion, estatus, comentarios)  ← catálogo
estaciones      (id, nombre, ubicacion, estatus)      ← catálogo
estacion_equipo (id, idEstacion, idEquipo)            ← unión estación ↔ equipo
complementos    (id, idEquipo, idEquipos JSON)        ← unión equipo ↔ equipos
```

- `equipos` y `estaciones` no tienen llaves entre sí; la relación vive en
  `estacion_equipo`.
- Un equipo que **no aparece en `estacion_equipo` está en almacén**.
- `complementos` liga un equipo con otros equipos: `idEquipos` es un JSON con
  los ids de sus complementos, que también están en `equipos`. Ejemplo:

  ```json
  { "id": 1, "idEquipo": 5, "idEquipos": [12, 18] }
  ```

- `formato-calibracion` guarda sus calibraciones en esta base.

Campos de `equipos`:

| Columna | Campo |
|---|---|
| `id` | |
| `noPieza` | No. Pieza |
| `resguardante` | Resguardante |
| `anioAdquisicion` | Año de adquisición |
| `tipo` | Tipo: Analizador · Monitor · Sensor · Calibrador · Otro · Datalogger · No Break · UPS general · Monitor VGA |
| `parametro` | Parámetro |
| `marca` | Marca |
| `modelo` | Modelo |
| `equipo` | Equipo |
| `numeroSerie` | N. serie |
| `conexion` | Conexión: texto libre (hasta 50 caracteres); `TCP/IP` y `RS232` como sugerencias |
| `fechaUltimaActualizacion` | Fecha Última Actualización |
| `estatus` | Estatus: Activo · Activo - Requiere atención · No Activo - Falla · Fuera de operación · Baja |
| `comentarios` | Comentarios |

`conexion` es el tipo de conexión, no el puerto. Para enlazar con el detector
(⏳ puertos) hará falta el puerto exacto (`tcp:502`, `com:COM3`); se define al
integrar ese módulo.

Campos de `estaciones`:

| Columna | Campo |
|---|---|
| `id` | |
| `nombre` | Nombre |
| `ubicacion` | Dirección en texto. Ej.: Av Enrique Díaz de León Nte 1215, Mezquitan Country, 44260 Guadalajara, Jal. |
| `estatus` | Disponible · Sin Energía · Sin Internet · Dañada · En Reparación · Dada de Baja |

Calibraciones y enlace con puertos: por definir. Los campos de calibraciones
quedan pendientes hasta tener acceso a ellos.

Regla: un equipo **en almacén no genera alertas** de su puerto.

### 7.2 Puertos ⏳

Recibe eventos y latidos del detector (sección 4.1).

Tablas: `estaciones` (con hash de token), `eventos` (con ID único),
`latidos` (último por estación), `etiquetas` (nombres de puertos).

Cambios en `detector-puertos` cuando se integre: paquete de envío colgado de
`monitor.AlAvisar`, bandeja en disco, latido, y configuración de URL y token.

### 7.3 Almacén ⏳

La app de mantenimiento del diagrama, ahora de almacén. Aporta las fechas y
resultados de mantenimiento (básico c/1 mes, cero-span c/3, completo c/6) y la
falla reportada, que alimentan el estado del equipo.

### 7.4 Estado del equipo (MIR · NOM-172) cuando los tres estén activos

| Condición | Fuente |
|---|---|
| Está en una estación | inventario |
| Su puerto da datos | puertos |
| Mantenimientos al día | almacén |
| Sin falla reportada | almacén |

Las cuatro → **óptimas condiciones**. Si falla una, el validador dice cuál.

---

## 8. Integraciones externas

| Cliente | Qué hace |
|---|---|
| `formato-calibracion` | Lee estación, n/s y modelo, y guarda cada calibración en la base de inventario por la API. Si `/api/modulos` dice que inventario está en proceso, usa sus diccionarios actuales como respaldo |
| Página web externa | `GET /api/publico/resumen`: foto en memoria recalculada cada minuto; no toca MySQL por visita |
| `detector-puertos` ⏳ | Eventos y latido (sección 4.1) |

---

## 9. Frontend

### 9.1 Shell con iframes

```
┌─────────────┬──────────────────────────────────┐
│ VCA Air     │                                  │
│ ▸ Tablero   │   <iframe> del módulo activo     │
│ ▸ Validación│   (uno a la vez)                 │
│ ▸ Gráficas  │                                  │
│ ▸ Inventario ⏳                                 │
│ ▸ Estaciones ⏳                                 │
│ ▸ Admin     │                                  │
│ 👤 usuario  │                                  │
└─────────────┴──────────────────────────────────┘
```

- **Sin pestañas**: menú lateral y un módulo a la vez.
- **Un build estático por módulo**, todos servidos desde el mismo servidor en
  `/m/<modulo>/`. Iframes independientes, sin un proceso por módulo.
- **Sesión por `postMessage`**: el shell entrega el token al iframe al cargar.
  Nunca en la URL.
- **Tema y alertas** también por `postMessage`.
- Módulo en proceso: el shell muestra "Módulo en proceso" **sin cargar el
  iframe**. El menú se arma con `GET /api/modulos` y el rol del usuario.

### 9.2 Estructura

El front nuevo va en una **carpeta nueva**, junto al `frontend/` actual, que
sigue funcionando hasta que el nuevo lo reemplace módulo por módulo. Antes de
escribir código se revisa una maqueta del diseño.

```
web/
├── index.html                shell
├── m/<modulo>/index.html     una página por módulo (iframe), misma compilación
└── src/
    ├── compartido/           tema, cliente de la API, puente postMessage, horas
    ├── shell/                menú, login, catálogo de módulos, preferencias
    └── modulos/
        ├── estaciones/       ✅ mosaico de puertos en vivo
        ├── tablero/  validacion/  graficas/       ⏳
        └── inventario/  admin/                   ⏳
```

Regla: un módulo no importa a otro; lo común va a `src/compartido/`.

**Avance (2026-10-05):** construidos y probados en el navegador el shell y
ocho módulos: Tablero, Validación, Gráficas, Registros y Parámetros (todo lo
del frontend actual, traído a `web/src/legado` y pasando por la API de Go →
Flask), Estaciones, Inventario y Admin. Inventario se activa
solo con `MYSQL_DSN_INVENTARIO`; en producción sigue apagado hasta crear su
base. Detalle en [web/README.md](../web/README.md).

### 9.3 Diseño

Minimalista: paleta neutra, color solo para el estado del dato y el nivel de
alerta, dos tamaños de texto, mucho espacio, una acción principal por pantalla.
Una sola librería de gráficas (hoy conviven Plotly y Recharts).

Decidido con maquetas (2026-10-05):

- **Fuente:** Manrope para todo el texto; JetBrains Mono para claves técnicas
  (`tcp:502`, `COM3`).
- **Tema:** fondo blanco por defecto y botón de modo oscuro en la barra
  (luna / sol). Se recuerda la preferencia; sin elegir, sigue la del sistema.
- **Navegación:** barra angosta de iconos a la izquierda; el nombre del módulo
  aparece al pasar el cursor; los módulos en proceso se ven atenuados.
- **Estaciones:** barra de estado de toda la red + mosaico de estaciones, un
  punto por puerto, las que tienen fallas primero, filtro con dos botones de
  separados «Todas / Con fallas» con el mismo estilo: fondo blanco, borde gris
  y texto oscuro (esquinas de 10 px); el elegido solo oscurece el borde.
- Esquinas redondeadas (10–14 px), botones en píldora, color solo para el
  nivel: verde bien, ámbar aviso/crítico, rojo incumple NOM, gris sin
  comunicación.

---

## 10. Despliegue y recursos

`docker-compose` con tres servicios: `api` (Go), `analisis` (Flask) y `mysql`.
Solo se expone HTTPS; MySQL y Flask quedan en la red interna.

| Proceso | RAM aprox. |
|---|---|
| API Go | ~100 MB |
| MySQL (`innodb_buffer_pool` 2 GB) | ~2.5 GB |
| Python/Flask con pandas | ~1 GB |
| Sistema y margen | ~4 GB |

---

## 11. Fases

1. **Base de la API:** `platform`, contrato de módulo, `/api/modulos`, `usuarios`
   (login, roles, bitácora).
2. **Módulos activos:** `envista`, `ambientweather`, `validacion` (proxy a Python +
   job de cada minuto), `alertas` con SSE, `publico`.
3. **Estructura de los módulos en proceso:** carpetas y migraciones de
   `inventario`, `puertos` y `almacen`, apagados.
4. **Frontend:** shell + `packages/ui` + módulos tablero, validación, gráficas
   y admin.
5. **Integraciones:** `formato-calibracion` lee y guarda por la API, con respaldo mientras inventario esté en proceso.
6. **Después:** encender inventario, puertos y almacén y adaptar el detector.

---

## 12. Pendientes

- Confirmar los umbrales contra los cálculos actuales de NOM y MIR del backend.
- Definir qué entrega exactamente la app de almacén y si consulta la API o
  escribe en ella.
- Ubicación y forma de acceso a la instancia separada del validador.
- Si el detector llega al servidor por HTTPS (red, VPN o IP pública).
