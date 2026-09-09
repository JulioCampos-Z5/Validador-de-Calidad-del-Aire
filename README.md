# Validador de Calidad del Aire

Valida los datos horarios de la red de monitoreo atmosférico de Jalisco: aplica
las reglas del área técnica, marca cada dato dudoso con su bandera y produce el
Excel que se entrega.

Funciona como aplicación web y como aplicación de escritorio para Windows. La
de escritorio **no necesita nada instalado**: el motor de validación viaja
dentro.

---

## Cuatro orígenes de datos, un solo tablero

```
Importar archivo ENVISTA  ─┐
Importar archivo validado ─┤
Descargar del SIMAJ       ─┼─► formato BD ─► validación ─► tablero · gráficas · Excel
Consultar API Emisiones   ─┘
```

| Origen | Qué es | Necesita |
|---|---|---|
| **Archivo ENVISTA** | `Trs.xlsx` o `.csv` exportado a mano del software de la red | — |
| **Archivo validado** | Un `BD_{año}.xlsx` ya procesado, para volver a mirarlo | — |
| **SIMAJ** | Descarga directa de los `.lsi` de aire.jalisco.gob.mx | — |
| **API de Emisiones** | emisiones.jalisco.gob.mx, con token | Correo y contraseña |

De dónde vengan los datos es indiferente para el resto del sistema: los cuatro
caminos desembocan en el mismo formato y la misma validación. Por eso hay **un
solo botón**, «Consultar datos», que despliega los cuatro. Elegido uno, un
diálogo pide lo que ese origen necesite, en el orden en que hace falta:

```
archivo    →  soltar o buscar el archivo
SIMAJ      →  periodo → confirmar
Emisiones  →  acceso (solo si no hay token) → periodo → confirmar
```

El acceso va primero porque sin token no hay nada que consultar, y descubrirlo
después de elegir las fechas obligaría a repetirlas.

El periodo también se elige una sola vez, arriba del menú, y lo comparten el
SIMAJ y la API. Pedirle a cada fuente un tramo distinto sin darse cuenta era
fácil, y entonces dejan de ser comparables.

---

## Cómo se ejecuta

### Aplicación de escritorio (lo normal para usarla)

Descarga `Validador-instalador.exe` o `Validador-portable.exe` desde el menú
lateral de la web, o compílalos:

```bash
cd escritorio
npm install
pip install pyinstaller     # solo para compilar
npm run exe                 # deja los ejecutables en ../salida/
```

Windows 64 bits. **No requiere Python**: el intérprete y las librerías van
empaquetados dentro.

### En un servidor (Docker)

```bash
docker compose up -d --build
```

Queda en http://localhost:8080. La imagen lleva el backend y el frontend ya
compilado; Flask sirve los dos, así que no hace falta nginx delante para
funcionar —aunque sí conviene uno con **HTTPS**: la sesión de la API de
Emisiones viaja en las peticiones.

Tres cosas que conviene saber:

- **Los `.exe` de Windows no se generan ahí.** PyInstaller no compila para otro
  sistema. Se compilan aparte y se dejan en `salida/`, que el contenedor monta:
  si la carpeta tiene los ejecutables, la sección «App de escritorio» aparece en
  el menú; si está vacía, se oculta sola.
- **Un solo worker de gunicorn**, y no es un descuido: el backend guarda estado
  en variables de módulo —el token, el último periodo descargado, el progreso—.
  Con varios workers, cada uno tendría su propia copia y la sesión parpadearía
  al azar. El razonamiento está escrito en el `Dockerfile`.
- **Ese estado es común a todos los usuarios**, no de cada uno. Para una persona
  a la vez funciona; para varias hay que aislarlo antes (ver *Pendientes*).

### En desarrollo

```bash
cd backend && pip install -r requirements.txt && python app.py   # puerto 8000
cd frontend && npm install && npm run dev                        # puerto 3000
```

Requisitos: Python 3.10+ y Node 18+. El frontend habla con el backend por un
proxy configurado en Vite, así que basta con abrir el puerto 3000.

### Pruebas

```bash
cd backend
python -m unittest discover -s pruebas -t .
```

106 pruebas, sin dependencias externas. Ninguna toca la red ni escribe en el
perfil del usuario. Ver [pruebas/README.md](backend/pruebas/README.md).

---

## Qué valida

Las reglas y sus umbrales salen del documento del área técnica
([doc/script validación.pdf](doc/script%20validaci%C3%B3n.pdf)); el marco legal
es la NOM-156-SEMARNAT-2012.

| Verificación | Qué detecta | Bandera |
|---|---|---|
| **Rangos** | Valores fuera de los límites de cada parámetro | `IR` |
| **Temperatura de cabina** | Fuera de 20–30 °C no se garantiza la medición: invalida los 8 contaminantes de esa hora | `IO` |
| **Valores constantes** | El mismo número más de 3 h seguidas | `DS` |
| **Relación NOx** | (NO+NO₂)/NOx fuera de 0.85–1.15 | `IO` |
| **Relación PM** | PM2.5 mayor que PM10 | `IO` |
| **Radiación nocturna** | RS o UVI distintos de cero entre las 22:00 y las 05:00 | `IO` |
| **Viento sin variación** | Anemómetro o veleta clavados durante horas | `IO` |
| **Temperatura externa** | Saltos imposibles entre horas, o serie demasiado plana | `IO` |
| **Presión barométrica** | Cambios bruscos en 3 h — *desactivada por defecto* | `IO` |
| **Huecos** | Celdas sin dato: `SE` si la estación no mide ese parámetro en todo el periodo, `ND` si es un hueco suelto | `ND` `SE` |

Las cuatro últimas parten de la misma idea: **un sensor averiado no deja de dar
números, da números plausibles**; lo que lo delata es que no varían. Sobre un
mes real señalaron una veleta clavada el 73.7% de las horas y dos piranómetros
que reportan radiación de día pleno de madrugada.

**Ninguna celda queda en blanco.** El 10.2.1 de la NOM pide bandera en todos los
datos, y una celda vacía no distingue el dato que falta del que nadie revisó.
Se separan los dos casos porque llevan a acciones distintas: `SE` es que ahí no
hay instrumento; `ND` es que el instrumento no reportó esa hora.

Todas se activan y ajustan desde la pantalla del tablero. El detalle de cada
umbral, y por qué la de presión viene apagada, está en
[doc/VALIDACIONES.md](doc/VALIDACIONES.md).

### Banderas

| | | | |
|---|---|---|---|
| `IR` Fuera de rango | `IO` Inválido por operador | `IF` Falla del equipo | `IC` Calibración |
| `ND` Sin dato | `DS` Dato sospechoso | `VZ` Igualado al límite de detección | `VE` Valor extraordinario |
| `SE` Sin equipo | `NE` No existía la estación | | |

---

## Registros del servidor

Una pantalla con los últimos errores y avisos del backend, con su traza
completa. Existe porque en un servidor —y más dentro de un contenedor— la salida
estándar no la ve nadie: antes había que entrar por SSH cada vez que alguien
decía «no funciona».

Es un anillo en memoria de los últimos 300, así que se pierde al reiniciar. Para
auditoría están los logs del contenedor, que siguen recibiéndolo todo.

---

## Indicador MIR

Solo cuando los datos vienen del SIMAJ. Mide **cuánto dato hay**, no cuánta
contaminación: el porcentaje de horas válidas de cada contaminante criterio,
promediado por estación y comparado contra el 75% que exige el punto 10.4.2 de
la NOM-156.

Se calcula **antes** de validar, sobre los datos crudos: mide cuánto publicó la
red, no cuánto sobrevivió a las reglas. Y las horas esperadas son las del
calendario, no las filas del archivo — si no, una estación que dejó de publicar
una semana saldría al 100%, porque no hay filas malas cuando no hay filas.

Junto al MIR va el **reporte de fallas**, que traduce «COU 50, no cumple» al
canal concreto que hay que ir a arreglar, separando *sin equipo* de *caído* y de
*intermitente*.

---

## Excel de salida

Seis hojas: `Data` con todos los registros y sus banderas,
`Resumen_Banderas_Global`, `Resumen_Banderas_Detallado`,
`Estadísticas_Generales`, `Estadísticas_Detalladas` y `Configuración` con los
rangos y decimales que se usaron.

---

## API

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/health` | Estado del servidor |
| `GET` | `/api/config` | Rangos, banderas, estaciones y decimales |
| `POST` | `/api/upload` | Subir un archivo |
| `POST` | `/api/validate/full` | Validar el archivo subido |
| `POST` | `/api/preview-validated` | Leer un archivo ya validado sin tocarlo |
| `GET` | `/api/download/<archivo>` | Descargar el Excel generado |
| `GET` | `/api/app-escritorio` | Ejecutables disponibles para descargar |
| `GET` | `/api/registros` | Últimos errores y avisos del servidor |
| `DELETE` | `/api/registros` | Vaciar esa lista |
| `GET` | `/api/minutales/estaciones` | Las 13 estaciones publicadas |
| `GET` | `/api/minutales/progreso` | Avance de la descarga en curso |
| `POST` | `/api/minutales/descargar` | Descargar del SIMAJ y validar |
| `POST` | `/api/minutales/mir` | Recalcular el MIR sin volver a descargar |
| `GET` | `/api/minutales/reporte.csv` | Exportar la tabla del MIR |
| `GET` | `/api/emisiones/sesion` | ¿Hay token vivo? |
| `POST` | `/api/emisiones/login` | Correo y contraseña → token |
| `POST` | `/api/emisiones/salir` | Cerrar sesión |
| `POST` | `/api/emisiones/descargar` | Consultar la API y validar |
| `GET` | `/api/emisiones/muestra` | Respuesta cruda, para diagnosticar |

`/api/minutales/descargar` y `/api/emisiones/descargar` devuelven **exactamente
la misma forma** que `/api/validate/full`. Es deliberado: el tablero, las
gráficas y la descarga del Excel funcionan sin enterarse de por dónde entraron
los datos.

---

## Estructura

```
backend/            API Flask; toda la lógica de validación vive en app.py
├── registros.py    Errores del servidor en memoria, para verlos desde la web
├── minutales/      Descarga del SIMAJ, indicador MIR y reporte de fallas
├── emisiones/      Cliente de la API de Emisiones, sesión y caché
├── pruebas/        106 pruebas con unittest
└── validador-backend.spec   Empaquetado con PyInstaller

frontend/           React + TypeScript + Vite + Tailwind
├── components/     Menú de datos, calendario de periodo, tablas y gráficas
├── estado/         Conjunto de datos y configuración compartidos
├── services/       Clientes de la API
└── pages/          Tablero, Gráficas, Parámetros y Registros

escritorio/         Electron: arranca el backend y abre la ventana
salida/             Ejecutables compilados (no versionado)
doc/                Documentación y documentos de referencia
Dockerfile          Imagen para servidor: frontend compilado + backend
docker-compose.yml  Despliegue con volúmenes para caché, sesión y ejecutables
```

---

## Documentación

| Documento | Contenido |
|---|---|
| [doc/VALIDACIONES.md](doc/VALIDACIONES.md) | Cada regla, su umbral y de dónde sale. Qué encontró en datos reales y qué falta contra la NOM-156 |
| [doc/INTEGRACION-MINUTALES.md](doc/INTEGRACION-MINUTALES.md) | Descarga del SIMAJ, el MIR, el reporte de fallas y la app de escritorio |
| [doc/INTEGRACION-EMISIONES.md](doc/INTEGRACION-EMISIONES.md) | La API de Emisiones: su formato real, sus trampas, la sesión y el rendimiento |
| [doc/API SIMAJ.md](doc/API%20SIMAJ.md) | Catálogo de las 17 variables, unidades y diccionario de banderas |
| [doc/COMANDOS.md](doc/COMANDOS.md) | Todos los comandos, uno por bloque: instalar, desarrollar, probar, compilar, desplegar y limpiar |
| [backend/pruebas/README.md](backend/pruebas/README.md) | Qué cubren las pruebas y cómo están escritas |

En `doc/` están además la NOM-156-SEMARNAT-2012 y el script de validación del
área técnica, que son las dos fuentes de las que salen las reglas.

---

## Pendientes conocidos

- **Firmar los ejecutables.** Sin certificado, SmartScreen avisa y, en equipos
  con Smart App Control activo, Windows llega a bloquear el archivo. Es hoy el
  mayor obstáculo para repartir la app.
- **La bandera `VZ` no se asigna.** Cuando un valor cae entre el mínimo y el
  límite de detección se sustituye en silencio; el punto 10.2.1 de la NOM pide
  identificar con bandera todos los datos tocados.
- **La bandera sustituye al valor** en la misma columna, así que el dato crudo
  desaparece del archivo validado. El 10.2.2 dice que no se borrará ningún dato.
- **El MIR solo mide contaminantes.** El 10.4.2 exige el 75% de compleción
  también en meteorología.
- **El Excel se genera en cada consulta** aunque nadie lo descargue: unos 6 s en
  periodos largos que se ahorrarían generándolo bajo demanda.
- **El estado del servidor es global, no por usuario.** El token de Emisiones,
  el último periodo descargado y el progreso viven en variables de módulo. En
  escritorio da igual —un proceso por persona—, pero en un servidor compartido
  todos usan la misma sesión: quien entra último se la cambia a los demás, y las
  consultas de cualquiera salen con la cuenta de quien entró. Hay que moverlo a
  la sesión de Flask antes de abrirlo a varias personas.
