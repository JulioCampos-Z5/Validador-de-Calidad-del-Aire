import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Cliente } from '../compartido/api'
import type { PropsModulo } from '../compartido/modulo'
import type { Conjunto, EstadoEstacion, EventoPuerto } from '../compartido/tipos'
import { Tablero } from './tablero/Tablero'
import { Estaciones } from './estaciones/Estaciones'

const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

const RED: EstadoEstacion[] = [
  { id: 1, nombre: 'Centro', ultimoLatido: hace(0), sinComunicacion: false, puertos: [
    { clave: 'tcp:502', nombre: 'T400', estado: 'arriba' },
  ] },
  { id: 2, nombre: 'Miravalle', ultimoLatido: hace(0), sinComunicacion: false, puertos: [
    { clave: 'tcp:502', nombre: 'T400', estado: 'arriba' },
    { clave: 'com:COM3', nombre: 'BAM', estado: 'caido', desde: hace(400), nivel: 'incumple' },
  ] },
  { id: 3, nombre: 'Vallarta', ultimoLatido: hace(3000), sinComunicacion: true, nivel: 'incumple', puertos: [] },
]
const EVENTOS: EventoPuerto[] = [
  { id: 9, estacion: 'Miravalle', tipo: 'puerto_caido', clave: 'com:COM3', nombre: 'BAM', momento: hace(400), recibido: hace(400) },
]

function cliente(rutas: Record<string, unknown | Error>) {
  const get = vi.fn(async (ruta: string) => {
    const clave = Object.keys(rutas).find((r) => ruta.startsWith(r))
    const v = clave ? rutas[clave] : {}
    if (v instanceof Error) throw v
    return v
  })
  return { cliente: { get } as unknown as Cliente, get }
}

function modulosActivos(nombres: string[]) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    modulos: nombres.map((n) => ({ nombre: n, estado: 'activo', ruta: `/api/${n}/` })),
  })))
}

afterEach(() => vi.unstubAllGlobals())

function props(api: Cliente, extra: Partial<PropsModulo> = {}): PropsModulo {
  return {
    api, token: 't', avisarVencida: vi.fn(), versionDatos: 0, guardarDatos: vi.fn(), ir: vi.fn(), datos: null,
    usuario: { id: 1, nombre: 'Julio Campos', correo: 'j@x.mx', rol: 'root', estatus: 'activo' }, ...extra,
  }
}

describe('Tablero', () => {
  it('saluda, resume la red, los avisos y el inventario', async () => {
    modulosActivos(['puertos', 'validacion', 'inventario'])
    const { cliente: api } = cliente({
      '/api/puertos/estado': { estaciones: RED },
      '/api/puertos/eventos': { eventos: EVENTOS },
      '/api/inventario/equipos': { equipos: [
        { estatus: 'Activo', idEstacion: 1 }, { estatus: 'No Activo - Falla', idEstacion: null },
      ] },
    })
    const p = props(api)
    render(<Tablero {...p} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/, Julio$/)
    expect(await screen.findByText('1 / 3')).toBeInTheDocument() // estaciones bien
    const red = screen.getByText('Red de monitoreo').closest('section')!
    expect(within(red).getByText('Incumplen NOM').nextSibling).toHaveTextContent('2')
    expect(await screen.findByText(/Miravalle/)).toBeInTheDocument()
    expect(screen.getByText('En almacén').nextSibling).toHaveTextContent('1')
    await userEvent.click(screen.getByRole('button', { name: /Ver estaciones/ }))
    expect(p.ir).toHaveBeenCalledWith('estaciones')
    await userEvent.click(screen.getByRole('button', { name: /Cargar datos/ }))
    expect(p.ir).toHaveBeenCalledWith('validacion')
  })

  it('con datos cargados los resume y lleva a Gráficas', async () => {
    modulosActivos(['validacion'])
    const datos = { origen: 'BD_2026.xlsx', cargado: '2026-10-08T15:00:00Z', respuesta: { summary: { total_registros: 82979, estaciones: 13 } } } as unknown as Conjunto
    const p = props(cliente({}).cliente, { datos })
    render(<Tablero {...p} />)
    expect(await screen.findByText('BD_2026.xlsx')).toBeInTheDocument()
    expect(screen.getByText('82,979')).toBeInTheDocument()
    expect(screen.queryByText('Red de monitoreo')).not.toBeInTheDocument() // sin puertos (escritorio)
    await userEvent.click(screen.getByRole('button', { name: /Ver gráficas/ }))
    expect(p.ir).toHaveBeenCalledWith('graficas')
  })

  it('accesos a las vistas: segun el rol, los en proceso deshabilitados', async () => {
    modulosActivos(['validacion', 'ambientweather'])
    const p = props(cliente({}).cliente, { usuario: { id: 2, nombre: 'Ana', correo: 'a@x.mx', rol: 'user', estatus: 'activo' } })
    render(<Tablero {...p} />)
    const ir = within(screen.getByRole('region', { name: 'Ir a' }))
    await waitFor(() => expect(ir.getByRole('button', { name: /^Gráficas/ })).toBeEnabled())
    expect(ir.queryByRole('button', { name: /^Tablero/ })).not.toBeInTheDocument() // ya estoy aqui
    expect(ir.queryByRole('button', { name: /^Admin/ })).not.toBeInTheDocument() // solo root y admin
    expect(ir.getByRole('button', { name: /^Inventario/ })).toBeDisabled()
    expect(ir.getByRole('button', { name: /^Inventario/ })).toHaveTextContent('En proceso')
    await userEvent.click(ir.getByRole('button', { name: /^Ambient Weather/ }))
    expect(p.ir).toHaveBeenCalledWith('ambientweather')
  })

  it('sin el analisis conectado lo dice', async () => {
    modulosActivos([])
    render(<Tablero {...props(cliente({}).cliente)} />)
    expect(await screen.findByText('El análisis (Python) no está conectado.')).toBeInTheDocument()
  })
})

describe('Estaciones', () => {
  it('con fallas arranca mostrando solo esas', async () => {
    const { cliente: api } = cliente({ '/api/puertos/estado': { estaciones: RED }, '/api/puertos/eventos': { eventos: EVENTOS } })
    render(<Estaciones api={api} />)
    expect(await screen.findByRole('button', { name: /Con fallas · 2/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /^Centro:/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Miravalle:/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Todas · 3/ }))
    expect(screen.getByRole('button', { name: /^Centro:/ })).toBeInTheDocument()
  })

  it('abrir una estacion muestra sus puertos y sus avisos de la semana', async () => {
    const { cliente: api, get } = cliente({ '/api/puertos/estado': { estaciones: RED }, '/api/puertos/eventos': { eventos: EVENTOS } })
    render(<Estaciones api={api} />)
    await userEvent.click(await screen.findByRole('button', { name: /^Miravalle:/ }))
    const detalle = screen.getByRole('region', { name: 'Detalle de Miravalle' })
    expect(within(detalle).getByText('BAM')).toBeInTheDocument()
    expect(within(detalle).getByText(/sin datos · 6 h/)).toBeInTheDocument()
    expect(await within(detalle).findByText('Sin datos')).toBeInTheDocument()
    expect(get.mock.calls.some(([r]) => r.includes('estacion=Miravalle'))).toBe(true)
    await userEvent.click(within(detalle).getByRole('button', { name: 'Cerrar detalle' }))
    expect(screen.queryByRole('region', { name: 'Detalle de Miravalle' })).not.toBeInTheDocument()
  })

  it('sin estaciones y sin fallas', async () => {
    const { cliente: vacia } = cliente({ '/api/puertos/estado': { estaciones: [] } })
    const { unmount } = render(<Estaciones api={vacia} />)
    expect(await screen.findByText('Todavía no hay estaciones')).toBeInTheDocument()
    unmount()
    const { cliente: bien } = cliente({ '/api/puertos/estado': { estaciones: [RED[0]] } })
    render(<Estaciones api={bien} />)
    await userEvent.click(await screen.findByRole('button', { name: /Con fallas · 0/ }))
    expect(screen.getByText('Ninguna estación con fallas')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ver todas' }))
    expect(screen.getByRole('button', { name: /^Centro:/ })).toBeInTheDocument()
  })

  it('la API caida antes de la primera carga', async () => {
    const { cliente: api } = cliente({ '/api/puertos/estado': new Error('No hay conexión con el servidor') })
    render(<Estaciones api={api} />)
    await waitFor(() => expect(screen.getByText('No hay conexión con el servidor')).toBeInTheDocument())
  })
})
