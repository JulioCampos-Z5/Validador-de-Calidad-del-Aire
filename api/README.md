# API central del Validador (Go)

Núcleo de la v2: toda escritura pasa por aquí y aquí queda quién hizo qué. El
plan completo está en [doc/ARQUITECTURA-v2.md](../doc/ARQUITECTURA-v2.md).

| Módulo | Estado | Se enciende con |
|---|---|---|
| `usuarios` | ✅ login, roles, sesiones, bitácora | `MYSQL_DSN_SEMADET` (obligatoria) |
| `puertos` | ✅ eventos y latidos del detector de puertos | `MYSQL_DSN_PUERTOS` |
| `inventario` | ✅ equipos, estaciones, ubicación, complementos | `MYSQL_DSN_INVENTARIO` (vacío en producción hasta crear su base) |
| `validacion` | ✅ puerta al backend de Python: `/api/analisis/*` → Flask `/api/*` | `VALIDADOR_BACKEND_URL` |
| `ambientweather` | ✅ consulta ambientweather.net cada minuto y guarda cada lectura; histórico bajo pedido | `MYSQL_DSN_AMBIENT_WEATHER` (sin `AMBIENT_WEATHER_API_KEY` y `AMBIENT_WEATHER_APPLICATION_KEY` solo sirve lo guardado) |
| `almacen`, `envista` | ⏳ en proceso (responden 503) | — |

Un módulo se enciende cuando tiene su `MYSQL_DSN_*`. Sus tablas se crean solas
al arrancar: cada módulo trae sus migraciones en `internal/<modulo>/migraciones/`.

## Correr en local

```bash
cp api/.env.example api/.env        # y cambia las contraseñas
docker compose --env-file api/.env -f api/dev/docker-compose.yml up -d   # MySQL en 127.0.0.1:3307
cd api
go run ./cmd/admin crear-usuario -nombre "Tu nombre" -correo tu@correo -rol root   # pide la contraseña
go run ./cmd/api                    # escucha en :8081
go test ./...
```

### Pruebas

`go test ./...` corre todo sin bases externas (usuarios y Ambient Weather sobre
SQLite temporal). Inventario y puertos solo existen en MySQL: sus pruebas
completas crean una base propia y desechable y la borran al terminar
(`internal/platform/db/dbprueba`); sin la variable se saltan:

```bash
PRUEBAS_MYSQL_DSN="root:<contraseña>@tcp(127.0.0.1:3307)/" go test ./...
```

En Windows, si el Control de aplicaciones bloquea el ejecutable de prueba en
la carpeta temporal («An Application Control policy has blocked this file»),
usa una carpeta del proyecto: `GOTMPDIR=$PWD/bin/gotmp go test ./...`.

## Roles

| | root | admin | técnico | user |
|---|---|---|---|---|
| Ver | ✅ | ✅ | ✅ | ✅ |
| Editar inventario | ✅ | ✅ | ✅ | — |
| Usuarios, estaciones, bitácora | ✅ | ✅ | — | — |

## Rutas

| Ruta | Quién |
|---|---|
| `POST /api/auth/login` `{correo, contrasena}` → `{token, expira, usuario}` | público |
| `POST /api/auth/salir` · `GET /api/auth/yo` | con sesión |
| `GET /api/usuarios` · `POST /api/usuarios` · `PATCH /api/usuarios/{id}` | root, admin |
| `GET /api/bitacora?limite=` | root, admin |
| `GET /api/modulos` · `GET /api/salud` | público |
| `POST /api/puertos/estaciones` `{nombre}` → token de la estación (solo se ve una vez) | root, admin |
| `GET /api/puertos/estaciones` | root, admin |
| `GET /api/puertos/estado` | con sesión |
| `GET /api/puertos/eventos?estacion=&desde=&hasta=&limite=` | con sesión |
| `POST /api/puertos/latido` · `POST /api/puertos/eventos` | token de estación |
| `GET /api/inventario/equipos` · `/estaciones` · `/catalogos` | con sesión |
| `POST /api/inventario/equipos` · `PUT /api/inventario/equipos/{id}` | root, admin, técnico |
| `PUT /api/inventario/equipos/{id}/estacion` `{idEstacion \| null}` (null = almacén) | root, admin, técnico |
| `PUT /api/inventario/equipos/{id}/complementos` `{idEquipos: []}` | root, admin, técnico |
| `POST /api/inventario/estaciones` · `PUT /api/inventario/estaciones/{id}` | root, admin, técnico |
| `/api/analisis/*` → Flask (upload, validate/full, download, minutales…) | con sesión; los POST quedan en bitácora |
| `GET /api/ambient-weather/estado` · `/dispositivos` | con sesión |
| `GET /api/ambient-weather/serie?mac=&desde=&hasta=&puntos=` (cruda si cabe; si no, en cubetas redondas: promedio, máximo en acumulados, promedio vectorial en dirección) | con sesión |
| `GET /api/ambient-weather/lecturas?mac=&desde=&hasta=&limite=&pagina=&orden=&dir=asc\|desc` → `{lecturas, total, columnas}` (`orden`: `fecha` o una columna; `columnas`: las que traen datos en el tramo) | con sesión |
| `POST /api/ambient-weather/historico` `{mac?, dias}` (en segundo plano, una a la vez) | root, admin |

## Integración con el detector de puertos

El servidor no consulta a las estaciones; el detector avisa:

- **Evento** (`puerto_caido` / `puerto_arriba`) en cuanto lo detecta. Lleva un
  `uuid`: reenviarlo no lo duplica.
- **Latido** cada minuto con los puertos que dan datos.
- Si la API no responde, el detector guarda los eventos en `bandeja.json` y
  los entrega en orden cuando vuelve.
- Sin latido por `PUERTOS_TOLERANCIA_LATIDO` (3 min), la API marca la estación
  **sin comunicación** y deja el evento; al volver el latido, **comunicación
  restablecida**.

Para conectar un detector: crea la estación (`POST /api/puertos/estaciones`) y
arráncalo con

```bash
detector.exe -web -api-url https://servidor -api-token <token>
```

(o las variables `DETECTOR_API_URL` y `DETECTOR_API_TOKEN`).

El estado de cada puerto lleva el nivel por tiempo sin datos: `reciente`,
`aviso` (1 h), `critico` (4 h), `incumple` (6 h).
