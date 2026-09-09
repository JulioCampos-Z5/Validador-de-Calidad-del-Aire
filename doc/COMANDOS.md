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

Dependencias del frontend:

```bash
npm --prefix frontend install
```

Dependencias de la app de escritorio:

```bash
npm --prefix escritorio install
```

Herramienta para empaquetar el backend (solo si vas a compilar los ejecutables):

```bash
pip install pyinstaller
```

---

## Desarrollo

Backend, en el puerto 8000:

```bash
python backend/app.py
```

Frontend, en el puerto 3000 — en **otra** terminal, con el backend ya corriendo:

```bash
npm --prefix frontend run dev
```

Compilar el frontend para producción:

```bash
npm --prefix frontend run build
```

Comprobar los tipos de TypeScript sin compilar. `npm exec` no cambia de
directorio, por eso hay que decirle a `tsc` dónde está el proyecto:

```bash
npm --prefix frontend exec -- tsc -p frontend --noEmit
```

Revisar el estilo con ESLint:

```bash
npm --prefix frontend run lint
```

---

## Pruebas

Las 106 pruebas del backend:

```bash
python -m unittest discover -s backend/pruebas -t backend
```

Con el nombre de cada una:

```bash
python -m unittest discover -s backend/pruebas -t backend -v
```

Un solo módulo, por ejemplo el de las validaciones:

```bash
python -m unittest discover -s backend/pruebas -t backend -p test_validaciones.py
```

---

## App de escritorio (Windows)

Abrirla sin compilar, usando el Python del sistema:

```bash
npm --prefix escritorio run dev
```

Empaquetar solo el backend con PyInstaller:

```bash
npm --prefix escritorio run backend
```

Generar los ejecutables completos en `salida/` — frontend, backend empaquetado y
Electron, unos 5 minutos:

```bash
npm --prefix escritorio run exe
```

> Produce `Validador-instalador.exe` y `Validador-portable.exe`, de unos 97 MB.
> No hace falta tener Python para usarlos: va dentro.

---

## Docker (servidor)

Construir la imagen y levantar, en http://localhost:8080:

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

Los ejecutables de Windows **no se generan en el servidor**: PyInstaller no
compila para otro sistema. Se compilan en Windows y se copian a `salida/`, que
el contenedor monta.

Copiarlos al servidor (ajusta usuario, servidor y ruta):

```bash
scp salida/Validador-instalador.exe usuario@servidor:/ruta/al/proyecto/salida/
```

```bash
scp salida/Validador-portable.exe usuario@servidor:/ruta/al/proyecto/salida/
```

No hace falta reiniciar nada: el backend lee la carpeta en cada consulta. Si
está vacía, la sección «App de escritorio» simplemente no aparece en el menú.

---

## Comprobaciones rápidas

¿Responde el backend?

```bash
curl http://localhost:8000/api/health
```

¿Responde el contenedor?

```bash
curl http://localhost:8080/api/health
```

Ver la configuración que está usando — rangos, banderas y estaciones:

```bash
curl http://localhost:8000/api/config
```

¿Hay sesión abierta en la API de Emisiones?

```bash
curl http://localhost:8000/api/emisiones/sesion
```

¿Qué ejecutables ve el servidor para ofrecer en descarga?

```bash
curl http://localhost:8000/api/app-escritorio
```

Ver los últimos errores del servidor sin abrir la interfaz:

```bash
curl "http://localhost:8000/api/registros?limite=20"
```

Vaciarlos antes de reproducir un fallo:

```bash
curl -X DELETE http://localhost:8000/api/registros
```

Ver la respuesta cruda de la API de Emisiones, para diagnosticar un cambio de
formato — requiere sesión abierta:

```bash
curl "http://localhost:8000/api/emisiones/muestra?horas=1&limite=1"
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
rm -rf backend/build backend/dist salida/win-unpacked
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
