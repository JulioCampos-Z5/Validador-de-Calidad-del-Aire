import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conjunto, Sesion } from '../compartido/tipos'

// Cada modulo es una pagina aparte (m/<id>/index.html) que el shell abre en un
// iframe. Aqui se arranca cada main.tsx como lo haria esa pagina, con el
// puente al shell simulado: se le entrega la sesion y se mira que pinte.

const puente = vi.hoisted(() => ({
  conexion: null as null | { avisarVencida: () => void; guardarDatos: (d: unknown) => void; ir: (m: string) => void },
  alSesion: (_s: Sesion) => {},
  alDatos: (_d: Conjunto | null) => {},
}))
vi.mock('../compartido/puente', async (original) => ({
  ...(await original<object>()),
  conectarConShell: (alSesion: (s: Sesion) => void, alDatos: (d: Conjunto | null) => void) => {
    puente.alSesion = alSesion
    puente.alDatos = alDatos
    return puente.conexion
  },
}))
vi.mock('../legado/graficas/plotly', () => ({ default: { react: vi.fn(), newPlot: vi.fn(), purge: vi.fn() } }))

const SESION: Sesion = {
  token: 'tok', expira: new Date(Date.now() + 3_600_000).toISOString(),
  usuario: { id: 1, nombre: 'Julio Campos', correo: 'j@x.mx', rol: 'root', estatus: 'activo' },
}

// Respuestas minimas de la API para que cada modulo pinte.
function apiFalsa() {
  vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
    const r = String(ruta)
    if (r.startsWith('/api/modulos')) return Response.json({ modulos: [] })
    if (r.startsWith('/api/usuarios')) return Response.json({ usuarios: [] })
    if (r.startsWith('/api/puertos/estado')) return Response.json({ estaciones: [] })
    if (r.startsWith('/api/ambient-weather/dispositivos')) return Response.json({ dispositivos: [] })
    if (r.startsWith('/api/ambient-weather/estado')) return Response.json({ llaves: false, intervaloSeg: 60, ultimoSondeo: null, descarga: null })
    if (r.startsWith('/api/inventario/equipos')) return Response.json({ equipos: [] })
    if (r.startsWith('/api/inventario/estaciones')) return Response.json({ estaciones: [] })
    if (r.startsWith('/api/inventario/catalogos')) return Response.json({ tipos: ['Otro'], estatusEquipo: ['Activo'], conexiones: [], estatusEstacion: ['Disponible'] })
    return Response.json({})
  }))
  // Los modulos de legado usan axios (XHR) contra /api/analisis/...
  const analisis: [string, unknown][] = [
    ['/registros', { registros: [], capacidad: 300 }],
    ['/config', { rangos: {}, estaciones: {}, parametros: {}, banderas: {}, decimales: {} }],
    ['/health', { status: 'ok', version: '2.0.0' }],
    ['/app-escritorio', { disponible: false, archivos: [] }],
    ['/emisiones/sesion', { activa: false, email: null, caduca: null, recordada: false }],
    ['/historico/estado', { disponible: false }],
  ]
  vi.stubGlobal('XMLHttpRequest', class {
    status = 200; readyState = 4; responseText = '{}'; response = '{}'; responseURL = ''
    onloadend: null | (() => void) = null; onreadystatechange: null | (() => void) = null
    open(_m: string, url: string) {
      const r = analisis.find(([ruta]) => url.split('?')[0].endsWith(ruta))
      this.responseText = this.response = JSON.stringify(r ? r[1] : {})
    }
    setRequestHeader() {} getAllResponseHeaders() { return 'content-type: application/json' }
    addEventListener() {} upload = { addEventListener() {} }
    send() { setTimeout(() => { this.onreadystatechange?.(); this.onloadend?.() }) }
    abort() {}
  })
}

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = '<div id="raiz"></div>'
  puente.conexion = { avisarVencida: vi.fn(), guardarDatos: vi.fn(), ir: vi.fn() }
  apiFalsa()
})
afterEach(() => vi.unstubAllGlobals())

async function arrancar(modulo: string) {
  await act(async () => { await import(`./${modulo}/main`) })
  await act(async () => { puente.alSesion(SESION) })
}

describe('arranque de cada modulo', () => {
  const casos: [string, RegExp][] = [
    ['tablero', /Julio/],
    ['validacion', /Validación/],
    ['graficas', /Gráficas/],
    ['registros', /Registros/],
    ['parametros', /Parámetros/],
    ['estaciones', /Red de monitoreo|Todavía no hay estaciones/],
    ['ambientweather', /Todavía no hay estaciones/],
    ['inventario', /Inventario/],
    ['admin', /Administración/],
  ]
  for (const [modulo, texto] of casos) {
    it(`${modulo}: pinta al recibir la sesion`, async () => {
      await arrancar(modulo)
      await waitFor(() => expect(document.getElementById('raiz')!.textContent).toMatch(texto))
    })
  }
})

describe('montarModulo y montarLegado', () => {
  it('sin shell (pagina abierta sola) lo dice y enlaza al validador', async () => {
    puente.conexion = null
    await act(async () => { await import('./tablero/main') })
    expect(await screen.findByText(/Este módulo se abre desde el validador/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir al validador' })).toHaveAttribute('href', '/')
  })

  it('antes de la sesion no pinta nada', async () => {
    await act(async () => { await import('./tablero/main') })
    expect(document.getElementById('raiz')!.textContent).toBe('')
  })

  it('legado: lo cargado en el shell llega al contexto y un 401 de la API avisa al shell', async () => {
    await arrancar('graficas')
    await waitFor(() => expect(screen.getByText('No hay datos cargados.')).toBeInTheDocument())
    const conjunto = {
      origen: 'BD_2026.xlsx', cargado: '2026-10-08',
      respuesta: { data_preview: [{ STATION: 'CEN', DATE: '2026-09-01', HOUR: 0, O3: 0.03 }], summary: {} },
    } as unknown as Conjunto
    await act(async () => { puente.alDatos(conjunto) })
    expect(await screen.findByText('BD_2026.xlsx')).toBeInTheDocument()

    // La sesion del validador vencio: el modulo avisa al shell.
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'token invalido o vencido' }, { status: 401 })))
    const { cliente } = await import('../compartido/api')
    await cliente('tok', () => puente.conexion!.avisarVencida()).get('/api/x').catch(() => {})
    expect(puente.conexion!.avisarVencida).toHaveBeenCalled()
  })

  it('legado: Descartar le pide al shell borrar el conjunto', async () => {
    await arrancar('graficas')
    const conjunto = {
      origen: 'BD_2026.xlsx', cargado: '2026-10-08',
      respuesta: { data_preview: [{ STATION: 'CEN', DATE: '2026-09-01', HOUR: 0, O3: 0.03 }], summary: {} },
    } as unknown as Conjunto
    await act(async () => { puente.alDatos(conjunto) })
    await act(async () => { screen.getByRole('button', { name: 'Descartar' }).click() })
    await waitFor(() => expect(puente.conexion!.guardarDatos).toHaveBeenCalledWith(null))
  })
})
