// Genera src/legado/tema.css: la paleta de Tailwind como variables CSS que
// cambian con el tema. Asi el codigo traido del frontend actual (cientos de
// clases bg-slate-50, text-red-700...) sigue al modo claro u oscuro sin
// reescribir cada clase.
//
//   node scripts/generar-tema.mjs
//
// Claro: los valores de Tailwind tal cual. Oscuro: grises y azul a mano (para
// que casen con base.css); el resto, la rampa invertida (50 <-> 950).

import { writeFileSync } from 'node:fs'
import colores from 'tailwindcss/colors.js'

const PASOS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']
const TONOS = ['red', 'green', 'purple', 'amber', 'orange', 'indigo', 'yellow', 'cyan', 'pink', 'emerald', 'sky', 'violet', 'rose', 'teal', 'lime']

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

// Grises oscuros alineados con base.css (--bg #0f1114, --panel #171a1e).
const GRIS_OSCURO = ['#1d2125', '#23272c', '#2c3036', '#3a3f46', '#6a717b', '#8b929c', '#a7adb6', '#c3c8cf', '#dde0e5', '#eef0f3', '#f7f8fa']
// Azul oscuro alineado con --acc #82acf5.
const AZUL_OSCURO = ['#16233a', '#1c2b46', '#233a63', '#2f5394', '#4a76c9', '#5f8be0', '#82acf5', '#a3c3f8', '#c3d7fb', '#e1ebfd', '#f0f5fe']

const claro = []
const oscuro = []
const variable = (nombre, paso) => `--tw-${nombre}-${paso}`

for (const [nombre, base, rampaOscura] of [
  ['slate', colores.slate, GRIS_OSCURO],
  ['gray', colores.gray, GRIS_OSCURO],
  ['blue', colores.blue, AZUL_OSCURO],
  ['primary', colores.blue, AZUL_OSCURO],
]) {
  PASOS.forEach((p, i) => {
    claro.push(`  ${variable(nombre, p)}: ${rgb(base[p])};`)
    oscuro.push(`  ${variable(nombre, p)}: ${rgb(rampaOscura[i])};`)
  })
}
for (const nombre of TONOS) {
  const base = colores[nombre]
  PASOS.forEach((p, i) => {
    claro.push(`  ${variable(nombre, p)}: ${rgb(base[p])};`)
    oscuro.push(`  ${variable(nombre, p)}: ${rgb(base[PASOS[PASOS.length - 1 - i]])};`)
  })
}
claro.push('  --tw-white: 255 255 255;', '  --tw-black: 0 0 0;')
oscuro.push('  --tw-white: 23 26 30;', '  --tw-black: 255 255 255;')

const css = `/* Generado por scripts/generar-tema.mjs. No editar a mano. */
:root {
${claro.join('\n')}
}

:root[data-tema='oscuro'] {
${oscuro.join('\n')}
}
`
writeFileSync(new URL('../src/legado/tema.css', import.meta.url), css)

// Lo que usa tailwind.config.js: cada color apunta a su variable.
const paleta = {}
for (const nombre of ['slate', 'gray', 'blue', 'primary', ...TONOS]) {
  paleta[nombre] = Object.fromEntries(PASOS.map((p) => [p, `rgb(var(${variable(nombre, p)}) / <alpha-value>)`]))
}
paleta.white = 'rgb(var(--tw-white) / <alpha-value>)'
paleta.black = 'rgb(var(--tw-black) / <alpha-value>)'
writeFileSync(new URL('../tema-tailwind.json', import.meta.url), JSON.stringify(paleta, null, 1))
console.log('tema.css y tema-tailwind.json generados')
