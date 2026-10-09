# Front v2 del Validador

Shell con barra de iconos y **un iframe por módulo**. Diseño y decisiones en
[doc/ARQUITECTURA-v2.md](../doc/ARQUITECTURA-v2.md) (sección 9). Es el único front
del validador: el `frontend/` de la v1 se retiró.

| Módulo | Qué hace | Necesita en la API |
|---|---|---|
| Shell | Login, menú por rol, tema claro/oscuro, cerrar sesión | `usuarios` |
| Tablero | Resumen: red, datos cargados, inventario, últimos avisos | lo que esté activo |
| Validación | Todo lo del tablero de la v1: orígenes (archivo ENVISTA, archivo ya validado, SIMAJ, API de Emisiones, base local en escritorio), periodo con calendario, configuración de validaciones, aviso de descarga incompleta, vista previa de datos, estadísticas, exportaciones (validación, MIR, IAS/NOM diario y horario), descarga de la app | `validacion` (Flask) |
| Gráficas | Las 7 vistas: series, comportamiento horario, distribución, calendario, categorías NOM-172, día × hora, viento. Fuente: la red (lo cargado en Validación) o Ambient Weather (promedios horarios en unidades de la red; sin categorías ni día × hora) | `validacion` (y `ambientweather` para esa fuente) |
| Registros | Pestañas: MIR y fallas (indicador MIR, fallas por canal, errores del servidor), MIDE y MIDE por municipio (las hojas del Excel diario) | `validacion` |
| Archivos | Solo escritorio: los Excel/CSV importados, con vista previa, abrir en el validador y borrar | `validacion` (Flask, `VALIDADOR_ARCHIVOS`) |
| Parámetros | Rangos, estaciones y banderas del backend | `validacion` |
| Estaciones | Mosaico en vivo de puertos, detalle y avisos | `puertos` |
| Ambient Weather | Estaciones meteorológicas de la cuenta: última lectura, gráfica por métrica y periodo (y comparando estaciones), tabla, CSV y descarga de histórico (admin). Unidades métricas | `ambientweather` |
| Inventario | Equipos, estaciones, ubicación (estación ↔ almacén) y complementos | `inventario` |
| Admin | Usuarios, estaciones del detector (token), bitácora | `usuarios` (root/admin) |

Un módulo cuyo módulo de la API está apagado sale atenuado como “en proceso”.

## Correr en local

Necesita la API de Go en `:8081` (ver [api/README.md](../api/README.md)) y, para
Validación y Gráficas, el backend de Python en `:8010` (`VALIDADOR_BACKEND_URL`).

```bash
pnpm install   # todos desde la raíz del repo
pnpm dev       # http://localhost:3100  (/api se reenvía a :8081)
pnpm test      # pruebas unitarias (Vitest + jsdom + Testing Library)
pnpm build     # deja web/dist/
```

## Pruebas

`pnpm test` corre todo el front v2: shell,
módulos propios, las páginas de `legado/` con sus gráficas (Plotly simulado),
servicios HTTP (axios con un adaptador falso), el estado compartido y el
arranque de cada `m/<modulo>/index.html` con el puente al shell simulado.

- La preparación común está en `src/pruebas/preparar.ts` (matchers de Testing
  Library, IndexedDB falso y lo que jsdom no trae).
- Cobertura: `pnpm cobertura` (desde la raíz).
- Cada prueba vive junto a lo que prueba (`*.test.ts(x)`).

## Estructura

```
web/
├── index.html                 shell
├── m/<modulo>/index.html      una página por módulo (se carga en el iframe)
└── src/
    ├── compartido/            base.css (tokens, tema), api, puente, tiempo, tipos
    ├── shell/                 Shell, Login, catálogo de módulos, preferencias
    └── modulos/<modulo>/      el código de cada módulo
```

- **Un módulo no importa a otro**; lo común va en `src/compartido/`.
- **La sesión nunca va en la URL del iframe.** El módulo avisa `listo` y el shell
  le entrega la sesión y el tema por `postMessage` (mismo origen). Si la API
  responde 401, el módulo avisa `sesion-vencida` y el shell regresa al login.
- **Un módulo aparece disponible** cuando su página existe (`src/shell/modulos.ts`)
  y su módulo de la API está activo (`GET /api/modulos`); si no, sale atenuado
  como “en proceso” y no se carga iframe.
- Fuentes (Manrope, JetBrains Mono) e iconos (Tabler) van empaquetados: la app
  de escritorio funciona sin internet.
- Horas siempre en hora de Guadalajara.
- **El conjunto validado vive en el shell**: Validación lo carga y se lo pasa al
  shell (`guardar-datos`); Gráficas y Tablero lo reciben al abrir. Se guarda en
  IndexedDB para sobrevivir una recarga y se borra al cerrar sesión.
- Un módulo puede abrir otro con `ir('graficas')` (mensaje `ir` al shell).

## Código traído del front de la v1 (`src/legado/`)

Validación, Gráficas, Registros y Parámetros usan el código del front de la
v1 (ya retirado) casi sin cambios (unas 9,000 líneas con reglas del área técnica ya
probadas). Solo se adaptó en puntos únicos:

- `legado/sesion.ts`: axios va a `/api/analisis/*` con la sesión; los enlaces
  `<a href="/api/...">` de descarga se bajan con la sesión.
- `legado/graficas/plotly.ts`: tema claro/oscuro, Manrope y fechas en español
  para todas las gráficas.
- `legado/estado/DatosContexto.tsx`: recibe el conjunto del shell y le avisa
  cada cambio (MIR recalculado, contaminantes, etc.); la configuración de
  validaciones y el periodo se recuerdan en el navegador.
- Tailwind con la paleta como variables CSS (`scripts/generar-tema.mjs`): las
  clases de color siguen el modo oscuro sin reescribirlas.
- Estilo de v2 (`legado/pulido.css` y ajustes puntuales): sin sombras en
  tarjetas, sin emojis, tarjetas de números neutras, botones con borde en vez
  de relleno, estado del análisis en una línea, guía de banderas en mono.
- Gráficas: la navegación de las 7 vistas usa los botones de v2, y la vista
  Series se reorganizó (solo presentación, misma lógica): panel lateral fijo
  con secciones plegables (Estaciones como chips con su color, Parámetros con
  eje, línea, color y promedios, Fondo del índice, Alertas) y la gráfica
  grande a la derecha con el resumen de ejes encima.

## Agregar un módulo

1. `m/<modulo>/index.html` y `src/modulos/<modulo>/main.tsx` con
   `montarModulo(SuComponente)` (de `src/compartido/modulo.tsx`): conecta con el
   shell y le pasa `api`, `usuario`, `datos`, `guardarDatos` e `ir`.
2. Agregarlo a `build.rollupOptions.input` en `vite.config.ts`.
3. Ponerle `pagina: '/m/<modulo>/'` en `src/shell/modulos.ts`.

## Pendientes conocidos

- Si se sale de Validación mientras descarga del SIMAJ, el resultado se pierde
  (la descarga sigue en el servidor, pero nadie la recibe).
- El filtro de Estaciones vuelve a su valor inicial al cambiar de módulo.
