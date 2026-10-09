// Arranca el proyecto completo en desarrollo, desde la raiz y en cualquier
// terminal (PowerShell, cmd o bash):
//
//   motor de analisis (Flask)  -> 8010
//   API central (Go)           -> 8081  (corre dentro de api/, donde esta su .env)
//   front v2 (Vite)            -> 3100
//
// Uso: pnpm iniciar            (las tres piezas)
//      pnpm iniciar motor api  (solo las que se nombren)
//
// Si `go` no se puede ejecutar (p. ej. lo bloquea Device Guard), la API se
// arranca con el ejecutable ya compilado: api/bin/api.exe o
// escritorio-v2/build/validador-api.exe.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const enWindows = process.platform === 'win32'

function hayGo() {
  const r = spawnSync('go version', { stdio: 'ignore', shell: true })
  return r.status === 0
}

function comandoApi() {
  const cwd = join(raiz, 'api')
  if (hayGo()) return { cmd: 'go', args: ['run', './cmd/api'], cwd }
  const compilados = [join(raiz, 'api', 'bin', 'api.exe'), join(raiz, 'escritorio-v2', 'build', 'validador-api.exe')]
  // La mas reciente: api/bin/api.exe puede haberse quedado atras.
  const exe = compilados.filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  if (!exe) throw new Error('No se puede ejecutar `go` y no hay una API compilada en api/bin/api.exe ni en escritorio-v2/build/')
  console.log(`[api] go no esta disponible; se usa ${exe}`)
  return { cmd: exe, args: [], cwd }
}

const piezas = {
  motor: () => ({
    cmd: enWindows ? 'python' : 'python3', args: ['backend/app.py'], cwd: raiz,
    env: { VALIDADOR_PUERTO: process.env.VALIDADOR_PUERTO ?? '8010' },
  }),
  api: comandoApi,
  web: () => ({ cmd: 'pnpm', args: ['--dir', 'web', 'dev'], cwd: raiz }),
}

const pedidas = process.argv.slice(2)
const nombres = pedidas.length ? pedidas : Object.keys(piezas)
const desconocidas = nombres.filter((n) => !(n in piezas))
if (desconocidas.length) {
  console.error(`Pieza desconocida: ${desconocidas.join(', ')}. Opciones: ${Object.keys(piezas).join(', ')}`)
  process.exit(1)
}

const hijos = []
function terminar(codigo = 0) {
  // En Windows la pieza corre bajo cmd.exe: hay que cerrar el arbol entero.
  for (const h of hijos) {
    if (h.exitCode !== null) continue
    if (enWindows) spawnSync('taskkill', ['/pid', String(h.pid), '/T', '/F'], { stdio: 'ignore' })
    else h.kill()
  }
  process.exit(codigo)
}

for (const nombre of nombres) {
  const { cmd, args, cwd, env } = piezas[nombre]()
  // En Windows `python` y `pnpm` se resuelven por el shell; se pasa todo como
  // una sola linea (los argumentos son fijos, sin espacios).
  const porShell = enWindows && !existsSync(cmd)
  const opciones = { cwd, env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...env }, stdio: ['ignore', 'pipe', 'pipe'] }
  const hijo = porShell ? spawn([cmd, ...args].join(' '), { ...opciones, shell: true }) : spawn(cmd, args, opciones)
  const prefijo = (linea) => linea && console.log(`[${nombre}] ${linea}`)
  for (const flujo of [hijo.stdout, hijo.stderr]) {
    let resto = ''
    flujo.setEncoding('utf8')
    flujo.on('data', (t) => {
      const lineas = (resto + t).split(/\r?\n/)
      resto = lineas.pop()
      lineas.forEach(prefijo)
    })
  }
  hijo.on('exit', (codigo) => {
    console.log(`[${nombre}] termino (codigo ${codigo}); se detiene todo`)
    terminar(codigo ?? 1)
  })
  hijos.push(hijo)
}

process.on('SIGINT', () => terminar(0))
process.on('SIGTERM', () => terminar(0))
