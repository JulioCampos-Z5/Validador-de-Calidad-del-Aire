import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Front v2 del Validador: un shell y un iframe por módulo.
//
// Cada módulo es una página propia (m/<modulo>/index.html) que el shell monta
// en un iframe, pero todos salen de esta misma compilación: no hay un servidor
// por módulo. Agregar un módulo = agregar su página aquí y en src/shell/modulos.ts.

// API central en Go (api/). 127.0.0.1 y no localhost: Node puede resolver
// localhost a ::1 y no encontrarla.
const api = process.env.VALIDADOR_API ?? 'http://127.0.0.1:8081'

// Plotly se arma desde sus fuentes (solo las trazas que se usan, ver
// src/legado/graficas/plotly.ts) y estas esperan el `global` de Node: el build
// oficial de Plotly lo define igual. `define` cubre el código al compilar;
// esbuildOptions, las dependencias que Vite preempaqueta en desarrollo.
const globalDeNode = { global: 'globalThis' }
const plotly = ['plotly.js/lib/core', 'plotly.js/lib/bar', 'plotly.js/lib/heatmap', 'plotly.js/lib/violin']

// El tema, puesto antes del primer pintado en todas las páginas.
//
// Cada módulo es un iframe nuevo, y su página nacía en claro: el tema llegaba
// con el mensaje 'sesion' del shell, ya cargado el JS. En modo oscuro eso era
// un destello blanco en cada cambio de módulo. Aquí la página lo toma del
// shell (mismo origen) o, abierta sola, de la preferencia guardada o del
// sistema, como src/shell/preferencias.ts. El <style> cubre el rato antes de
// que cargue base.css (en desarrollo el CSS llega por JS) y sigue los cambios
// de data-tema; después manda base.css.
const temaSinDestello = {
  name: 'tema-sin-destello',
  transformIndexHtml: () => [
    {
      tag: 'style',
      injectTo: 'head-prepend' as const,
      children:
        ":root{color-scheme:light;background:var(--bg,#fff)}" +
        ":root[data-tema='oscuro']{color-scheme:dark;background:var(--bg,#0f1114)}",
    },
    {
      tag: 'script',
      injectTo: 'head-prepend' as const,
      children:
        "try{var t=window.parent!==window&&window.parent.document.documentElement.dataset.tema;" +
        "if(t!=='claro'&&t!=='oscuro'){t=localStorage.getItem('validador.tema')}" +
        "if(t!=='claro'&&t!=='oscuro'){t=matchMedia('(prefers-color-scheme: dark)').matches?'oscuro':'claro'}" +
        "document.documentElement.dataset.tema=t}catch(e){}",
    },
  ],
}

export default defineConfig({
  plugins: [react(), temaSinDestello],
  define: globalDeNode,
  optimizeDeps: {
    // Las vistas de Gráficas se cargan al abrir su pestaña; sin esto Vite
    // descubre Plotly tarde y recarga la página a media sesión.
    include: plotly,
    esbuildOptions: { define: globalDeNode },
  },
  build: {
    rollupOptions: {
      input: {
        shell: resolve(__dirname, 'index.html'),
        estaciones: resolve(__dirname, 'm/estaciones/index.html'),
        tablero: resolve(__dirname, 'm/tablero/index.html'),
        validacion: resolve(__dirname, 'm/validacion/index.html'),
        graficas: resolve(__dirname, 'm/graficas/index.html'),
        inventario: resolve(__dirname, 'm/inventario/index.html'),
        admin: resolve(__dirname, 'm/admin/index.html'),
        registros: resolve(__dirname, 'm/registros/index.html'),
        parametros: resolve(__dirname, 'm/parametros/index.html'),
        ambientweather: resolve(__dirname, 'm/ambientweather/index.html'),
        archivos: resolve(__dirname, 'm/archivos/index.html'),
      },
    },
  },
  // Pruebas: jsdom para los componentes; preparar.ts trae los matchers de
  // Testing Library y limpia el DOM entre pruebas.
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/pruebas/preparar.ts'],
  },
  server: {
    port: 3100,
    proxy: {
      '/api': {
        target: api,
        changeOrigin: true,
        // Con la API apagada, decirlo claro en vez de un 500 vacío.
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if (!('writeHead' in res) || res.headersSent) return
            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: `La API no responde en ${api}. Arráncala con: cd api && go run ./cmd/api` }))
          })
        },
      },
    },
  },
})
