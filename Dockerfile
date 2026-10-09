# Validador de Calidad del Aire — motor de análisis (Flask) para servidor.
#
# Solo el backend de Python: valida, calcula el IAS y el MIR y consulta el
# SIMAJ y la API de Emisiones. El front v2 (web/dist) lo sirve la API de Go
# (api/), que reenvía /api/analisis/* a este contenedor.
#
# Qué NO contiene: el instalador de Windows. No se puede generar aquí —
# PyInstaller no compila para otro sistema— y por eso `salida-v2/` queda como
# punto de montaje: si tiene el instalador, «Descargar la app» aparece en
# Validación; si no, se oculta sola.

FROM python:3.12-slim

# `RAIZ_RECURSOS` del backend es el directorio padre de `backend/`, así que la
# estructura de dentro tiene que reflejar la del repositorio: ahí busca
# `salida-v2/` para la descarga de la app de escritorio.
WORKDIR /app

# La imagen slim no trae la base de datos de zonas horarias, y sin ella
# `zoneinfo` no encuentra America/Mexico_City: el backend arrancaría y
# reventaría en la primera fecha. `tzdata` de pip la trae sin pasar por apt.
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt \
    && pip install --no-cache-dir 'gunicorn==23.0.0' 'tzdata==2025.2'

# El programa fecha en hora de Guadalajara por su cuenta (ver backend/horario.py);
# esto alinea además lo que no pasa por ahí: las trazas de gunicorn y cualquier
# herramienta que se ejecute dentro del contenedor.
ENV TZ=America/Mexico_City

COPY backend/ ./backend/

# Punto de montaje para el instalador de Windows, que se compila fuera.
RUN mkdir -p /app/salida-v2

# Sin privilegios. Necesita un HOME propio porque ahí guarda la sesión de la API
# de Emisiones quien marque «recordar».
RUN useradd --create-home --uid 10001 validador \
    && chown -R validador:validador /app
USER validador
ENV HOME=/home/validador

EXPOSE 8000

# El servidor de desarrollo de Flask no vale para esto: sin reinicio ante
# fallos, sin límites de petición y el propio Werkzeug avisa de que no se use.
#
# --workers 1 NO es una errata ni un descuido de rendimiento
# ----------------------------------------------------------
# El backend guarda estado en variables de módulo: el token de la API de
# Emisiones, el último periodo descargado para recalcular el MIR sin volver a
# bajarlo, y el progreso de la descarga en curso. Cada worker de gunicorn es un
# proceso con su propia memoria, así que con dos o más el usuario inicia sesión
# en uno y la petición siguiente cae en otro que no sabe nada: la sesión
# parpadearía al azar. Con hilos, ese estado se comparte.
#
# El precio es que el estado sigue siendo COMÚN A TODOS los usuarios, no de cada
# uno. Para una sola persona a la vez funciona; para varias hay que aislarlo
# antes (ver «Pendientes» en el README).
#
# --timeout 600 tampoco es capricho: medido contra la API de Emisiones, un
# trimestre tarda unos 112 segundos la primera vez. Con los 30 s por defecto,
# gunicorn mataría la descarga a media faena.
CMD ["gunicorn", \
     "--chdir", "/app/backend", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "1", \
     "--threads", "8", \
     "--timeout", "600", \
     "--access-logfile", "-", \
     "app:app"]
