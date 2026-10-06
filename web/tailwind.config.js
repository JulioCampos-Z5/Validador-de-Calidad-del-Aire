// Tailwind solo para el codigo traido del frontend actual (src/legado) y los
// modulos que lo usan. Los colores leen variables CSS (src/legado/tema.css)
// para seguir el modo claro u oscuro; ver scripts/generar-tema.mjs.
import { readFileSync } from 'node:fs'

const paleta = JSON.parse(readFileSync(new URL('./tema-tailwind.json', import.meta.url), 'utf8'))

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/legado/**/*.{ts,tsx}', './src/modulos/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ...paleta,
        success: { 50: paleta.green[50], 500: paleta.green[500], 600: paleta.green[600] },
        warning: { 50: paleta.amber[50], 500: paleta.amber[500], 600: paleta.amber[600] },
        danger: { 50: paleta.red[50], 500: paleta.red[500], 600: paleta.red[600] },
      },
      // Plano: las tarjetas van con borde, sin sombra. Dialogos y menus (lg,
      // xl) conservan la suya para separarse del fondo.
      boxShadow: { sm: 'none', DEFAULT: 'none', md: 'none' },
      fontWeight: { bold: '600' },
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
