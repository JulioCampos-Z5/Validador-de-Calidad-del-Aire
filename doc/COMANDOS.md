# Comandos

Un comando por bloque, para copiar y pegar de uno en uno.

**Todos se ejecutan desde la raíz del proyecto.** Ese es el único `cd` que hace
falta; el resto llevan la ruta dentro:

```bash
cd Validador-de-Calidad-del-Aire
```

---

## Instalar

Dependencias del backend:

```bash
pip install -r backend/requirements.txt
```

Dependencias del front v2 y de la app de escritorio (pnpm, desde la raíz):

```bash
pnpm install
```

Herramienta para empaquetar el backend (solo si vas a compilar el instalador):

```bash
pip install pyinstaller
```

---

## Desarrollo

El proyecto v2 son **tres piezas** que tienen que estar corriendo a la vez:

| Pieza | Carpeta | Puerto |
|---|---|---|
| Motor de análisis (Flask) | `backend/` | 8010 |
| API central (Go) — login, módulos, proxy al motor | `api/` | 8081 |
| Front v2 (Vite) | `web/` | 3100 |

La API de Go es la carpeta nueva respecto a la v1: corre **dentro de `api/`**,
porque de ahí lee su `api/.env`.

Arrancar las tres de una vez (funciona igual en PowerShell, cmd o bash) y abrir
http://localhost:3100:

```bash
pnpm iniciar
```

> Ctrl+C las detiene todas. Si Windows bloquea `go.exe` (Device Guard), la API
> se arranca con el ejecutable ya compilado más reciente
> (`escritorio-v2/build/validador-api.exe` o `api/bin/api.exe`).

Solo una pieza, cada una en su terminal:

```bash
pnpm motor
```

```bash
pnpm api
```

```bash
pnpm dev
```

A mano, sin el script — motor en PowerShell:

```bash
$env:VALIDADOR_PUERTO=8010; python backend/app.py
```

Motor en bash:

```bash
VALIDADOR_PUERTO=8010 python backend/app.py
```

API de Go (el `-C api` la ejecuta dentro de `api/`):

```bash
go -C api run ./cmd/api
```

Front v2:

```bash
pnpm dev
```

Compilar el front v2 (comprueba también los tipos):

```bash
pnpm build
```

---

## Pruebas

Las del backend:

```bash
python -m unittest discover -s backend/pruebas -t backend
```

Un solo módulo, por ejemplo el de las validaciones:

```bash
python -m unittest discover -s backend/pruebas -t backend -p test_validaciones.py
```

Las del front v2:

```bash
pnpm test
```

Las de la API de Go (inventario y puertos necesitan `PRUEBAS_MYSQL_DSN`, ver
`api/README.md`):

```bash
go -C api test ./...
```

Las de la app de escritorio:

```bash
pnpm test:escritorio
```

---

## App de escritorio (Windows)

Abrirla sin compilar, usando el Python del sistema:

```bash
pnpm escritorio
```

Generar el instalador en `salida-v2/` — front, API de Go, motor empaquetado y
Electron:

```bash
pnpm instalador
```

> Produce `Validador-v2-instalador.exe`.
> No hace falta tener Python para usarlo: va dentro.
> Si `go` está bloqueado, se empaqueta la API ya compilada
> (`escritorio-v2/build/validador-api.exe`) y lo avisa en la consola.

---

## Docker (servidor)

Construir la imagen del motor de análisis y levantarla, en http://localhost:8080:

```bash
docker compose up -d --build
```

Levantar sin reconstruir:

```bash
docker compose up -d
```

Ver los registros en vivo:

```bash
docker compose logs -f
```

Ver el estado y si está sano:

```bash
docker compose ps
```

Reiniciar:

```bash
docker compose restart
```

Parar y borrar el contenedor, conservando la caché:

```bash
docker compose down
```

Parar y borrar **también los volúmenes** — se pierden la caché de descargas y la
sesión guardada:

```bash
docker compose down -v
```

Entrar al contenedor a mirar:

```bash
docker compose exec validador bash
```

---

## Publicar en el servidor

El instalador de Windows **no se genera en el servidor**: PyInstaller no
compila para otro sistema. Se compila en Windows y se copia a `salida-v2/`, que
el contenedor monta.

Copiarlo al servidor (ajusta usuario, servidor y ruta):

```bash
scp salida-v2/Validador-v2-instalador.exe usuario@servidor:/ruta/al/proyecto/salida-v2/
```

No hace falta reiniciar nada: el backend lee la carpeta en cada consulta. Si
está vacía, «Descargar la app» simplemente no aparece.

---

## Comprobaciones rápidas

¿Responde el motor?

```bash
curl http://localhost:8010/api/health
```

¿Responde la API de Go?

```bash
curl http://localhost:8081/api/salud
```

¿Responde el contenedor?

```bash
curl http://localhost:8080/api/health
```

Ver la configuración que está usando — rangos, banderas y estaciones:

```bash
curl http://localhost:8010/api/config
```

¿Hay sesión abierta en la API de Emisiones?

```bash
curl http://localhost:8010/api/emisiones/sesion
```

¿Ve el servidor el instalador para ofrecerlo en descarga?

```bash
curl http://localhost:8010/api/app-escritorio
```

Ver los últimos errores del servidor sin abrir la interfaz:

```bash
curl "http://localhost:8010/api/registros?limite=20"
```

Vaciarlos antes de reproducir un fallo:

```bash
curl -X DELETE http://localhost:8010/api/registros
```

Ver la respuesta cruda de la API de Emisiones, para diagnosticar un cambio de
formato — requiere sesión abierta:

```bash
curl "http://localhost:8010/api/emisiones/muestra?horas=1&limite=1"
```

---

## Limpiar

Borrar la caché de la API de Emisiones; la siguiente consulta vuelve a bajarlo
todo:

```bash
rm -rf "$TEMP/emisiones_cache"
```

Borrar la caché de los `.lsi` del SIMAJ:

```bash
rm -rf "$TEMP/minutales_cache"
```

Borrar los Excel generados, que se acumulan uno por consulta:

```bash
rm -rf "$TEMP/validador_calidad_aire"
```

Olvidar la sesión guardada de Emisiones — equivale a pulsar «cerrar sesión»:

```bash
rm -rf ~/.validador-calidad-aire
```

Borrar lo que dejan PyInstaller y electron-builder:

```bash
rm -rf backend/build backend/dist salida-v2/win-unpacked
```

---

## Git

Ver qué ha cambiado:

```bash
git status --short
```

Ver en qué rama estás:

```bash
git branch --show-current
```

Subir la rama actual:

```bash
git push
```
