// Compila la API de Go en build/validador-api.exe para empaquetarla.
//
// Si `go` no se puede ejecutar (p. ej. lo bloquea Device Guard) y ya hay una
// API compilada, se avisa y se usa esa en vez de abortar todo el instalador.
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const salida = join(aqui, 'build', 'validador-api.exe')

const r = spawnSync('go', ['build', '-C', join(aqui, '..', 'api'), '-trimpath', '-ldflags', '-s -w', '-o', salida, './cmd/api'], { stdio: 'inherit' })
if (r.status === 0) process.exit(0)

if (existsSync(salida)) {
  console.warn(`\n[api] No se pudo compilar con go; se usa la API ya compilada (${statSync(salida).mtime.toLocaleString()}).`)
  console.warn('[api] Si cambiaste código de api/, este ejecutable no lo incluye.\n')
  process.exit(0)
}
console.error('[api] No se pudo compilar la API de Go y no hay una compilada en build/.')
process.exit(1)
