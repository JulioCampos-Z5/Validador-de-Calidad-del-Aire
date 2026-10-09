import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Cliente } from '../../compartido/api'
import type { Usuario } from '../../compartido/tipos'
import type { Dispositivo, EstadoSondeo, Lectura } from './datos'

const Plotly = vi.hoisted(() => ({ react: vi.fn(), newPlot: vi.fn(), purge: vi.fn() }))
vi.mock('../../legado/graficas/plotly', () => ({ default: Plotly }))

import { AmbientWeather } from './AmbientWeather'
import { Tabla } from './Tabla'

const reciente = new Date(Date.now() - 60_000).toISOString()
const vieja = new Date(Date.now() - 5 * 3_600_000).toISOString()

const DISPOSITIVOS: Dispositivo[] = [
  { mac: 'AA:BB:CC:DD:EE:01', nombre: 'SantaFe-AMBWeather-Pro', ubicacion: 'Tlajomulco', lat: null, lon: null, lecturas: 1200, primera: vieja,
    ultima: { fecha: reciente, valores: { tempf: 77, humidity: 40, windspeedmph: 10, winddir: 90, dailyrainin: 0.1 } } },
  { mac: 'AA:BB:CC:DD:EE:02', nombre: 'COUNTRY_AMBWeather-Pro', ubicacion: '', lat: null, lon: null, lecturas: 400, primera: vieja,
    ultima: { fecha: vieja, valores: { tempf: 59, humidity: 80 } } },
]
const ESTADO: EstadoSondeo = { llaves: true, intervaloSeg: 60, ultimoSondeo: reciente, descarga: null }
const LECTURAS: Lectura[] = [
  { fecha: new Date(Date.now() - 120_000).toISOString(), valores: { tempf: 77, winddir: 90, humidity: 40 } },
  { fecha: reciente, valores: { tempf: 80, winddir: 180, humidity: 42 } },
]

const ROOT: Usuario = { id: 1, nombre: 'J', correo: 'j@x.mx', rol: 'root', estatus: 'activo' }

function cliente(extra: Partial<Record<string, unknown>> = {}) {
  // La API recuerda la descarga pedida: el siguiente /estado la trae.
  let estado: EstadoSondeo = ESTADO
  const get = vi.fn(async (ruta: string) => {
    for (const [r, v] of Object.entries(extra)) if (ruta.startsWith(r)) { if (v instanceof Error) throw v; return v }
    if (ruta.startsWith('/api/ambient-weather/dispositivos')) return { dispositivos: DISPOSITIVOS }
    if (ruta.startsWith('/api/ambient-weather/estado')) return estado
    if (ruta.startsWith('/api/ambient-weather/serie')) return { lecturas: LECTURAS, cubetaSeg: 0 }
    if (ruta.startsWith('/api/ambient-weather/lecturas')) return { lecturas: LECTURAS, total: 2, columnas: ['tempf', 'humidity', 'winddir'] }
    return {}
  })
  const post = vi.fn(async () => {
    estado = { ...ESTADO, descarga: { mac: '', nombre: 'Todas', dias: 90, estado: 'descargando', recibidas: 0, nuevas: 0, llegoA: null, inicio: reciente, fin: null } }
    return estado
  })
  return { api: { get, post } as unknown as Cliente, get, post }
}

describe('Ambient Weather', () => {
  it('mosaico de estaciones y detalle de la mas reciente, en unidades metricas', async () => {
    const { api } = cliente()
    render(<AmbientWeather api={api} usuario={ROOT} />)
    expect(await screen.findByTitle('SantaFe-AMBWeather-Pro')).toBeInTheDocument()
    const detalle = screen.getByRole('heading', { level: 2, name: 'SantaFe' }).closest('section')!
    expect(within(detalle).getAllByText('25.0 °C').length).toBeGreaterThan(0) // 77 °F
    expect(within(detalle).getByText('16.1 km/h')).toBeInTheDocument() // 10 mph
    expect(within(detalle).getByText('E')).toBeInTheDocument() // 90°
    expect(screen.getByText(/Consultando cada 60 s/)).toBeInTheDocument()
  })

  it('una estacion que no reporta lo avisa; elegirla cambia el detalle', async () => {
    const { api } = cliente()
    render(<AmbientWeather api={api} usuario={ROOT} />)
    await userEvent.click(await screen.findByTitle('COUNTRY_AMBWeather-Pro'))
    expect(screen.getByRole('heading', { level: 2, name: 'COUNTRY' })).toBeInTheDocument()
    expect(screen.getByText(/Esta estación no reporta desde hace/)).toBeInTheDocument()
  })

  it('la grafica: una traza por estacion al comparar, y la metrica elegida', async () => {
    const { api, get } = cliente()
    render(<AmbientWeather api={api} usuario={ROOT} />)
    await waitFor(() => expect(Plotly.react).toHaveBeenCalled())
    expect((Plotly.react.mock.calls.at(-1)![1] as unknown[]).length).toBe(1)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Comparar todas las estaciones' }))
    await waitFor(() => expect((Plotly.react.mock.calls.at(-1)![1] as unknown[]).length).toBe(2))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Métrica' }), 'humidity')
    await waitFor(() => expect((Plotly.react.mock.calls.at(-1)![2] as { yaxis: { title: string } }).yaxis.title).toMatch(/Humedad/))
    await userEvent.click(screen.getByRole('button', { name: '7 días' }))
    await waitFor(() => expect(get.mock.calls.filter(([r]) => r.includes('/serie')).length).toBeGreaterThan(3))
  })

  it('sin llaves avisa y no ofrece descargar historico', async () => {
    const { api } = cliente({ '/api/ambient-weather/estado': { ...ESTADO, llaves: false } })
    render(<AmbientWeather api={api} usuario={ROOT} />)
    expect(await screen.findByText(/no tiene las llaves de Ambient Weather/)).toBeInTheDocument()
    expect(screen.getByText('Hace falta configurar las llaves de Ambient Weather en la API.')).toBeInTheDocument()
  })

  it('historico: solo admin; pide los dias elegidos para todas', async () => {
    const { api, post } = cliente()
    const { unmount } = render(<AmbientWeather api={api} usuario={{ ...ROOT, rol: 'user' }} />)
    await screen.findByTitle('SantaFe-AMBWeather-Pro')
    expect(screen.queryByText('Descargar histórico')).not.toBeInTheDocument()
    unmount()

    render(<AmbientWeather api={api} usuario={ROOT} />)
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Días hacia atrás' }), '90')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Todas las estaciones' }))
    await userEvent.click(screen.getByRole('button', { name: 'Descargar' }))
    expect(post).toHaveBeenCalledWith('/api/ambient-weather/historico', { mac: '', dias: 90 })
    expect(await screen.findByRole('button', { name: 'Descargando…' })).toBeDisabled()
  })

  it('sin estaciones y con la API caida', async () => {
    const { api } = cliente({ '/api/ambient-weather/dispositivos': { dispositivos: [] } })
    const { unmount } = render(<AmbientWeather api={api} usuario={ROOT} />)
    expect(await screen.findByText('Todavía no hay estaciones.')).toBeInTheDocument()
    unmount()
    const { api: caida } = cliente({ '/api/ambient-weather/dispositivos': new Error('módulo en proceso') })
    render(<AmbientWeather api={caida} usuario={ROOT} />)
    expect(await screen.findByText('módulo en proceso')).toBeInTheDocument()
  })
})

describe('Tabla de lecturas', () => {
  it('solo las columnas con datos, direccion en grados y cardinal, orden y paginas por la API', async () => {
    const { api, get } = cliente()
    render(<Tabla api={api} d={DISPOSITIVOS[0]} ahora={Date.now()} />)
    expect(await screen.findByText('180° S')).toBeInTheDocument()
    expect(screen.getByText(/3 de 3 columnas/)).toBeInTheDocument()
    expect(screen.queryByText(/Lluvia/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('columnheader', { name: /Temp. exterior/ }))
    await waitFor(() => expect(get.mock.calls.at(-1)![0]).toContain('orden=tempf&dir=desc'))
    await userEvent.click(screen.getByRole('columnheader', { name: /Temp. exterior/ }))
    await waitFor(() => expect(get.mock.calls.at(-1)![0]).toContain('orden=tempf&dir=asc'))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Filas por página/ }), '250')
    await waitFor(() => expect(get.mock.calls.at(-1)![0]).toContain('limite=250&pagina=0'))
  })

  it('ocultar una columna con el selector', async () => {
    const { api } = cliente()
    render(<Tabla api={api} d={DISPOSITIVOS[0]} ahora={Date.now()} />)
    await screen.findByText('180° S')
    await userEvent.click(screen.getByRole('button', { name: /Columnas/ }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Columnas visibles' })).getByRole('checkbox', { name: 'Humedad' }))
    expect(screen.getByText(/2 de 3 columnas/)).toBeInTheDocument()
  })

  it('exportar CSV con nombre de la estacion y del periodo', async () => {
    const { api } = cliente()
    let nombre = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { nombre = this.download })
    render(<Tabla api={api} d={DISPOSITIVOS[0]} ahora={Date.now()} />)
    await screen.findByText('180° S')
    await userEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }))
    await waitFor(() => expect(nombre).toMatch(/^ambient-weather_SantaFe_24h_\d{4}-\d{2}-\d{2}\.csv$/))
  })

  it('periodo sin lecturas', async () => {
    const { api } = cliente({ '/api/ambient-weather/lecturas': { lecturas: [], total: 0, columnas: [] } })
    render(<Tabla api={api} d={DISPOSITIVOS[0]} ahora={Date.now()} />)
    expect(await screen.findByText('No hay lecturas guardadas en este periodo.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Exportar CSV/ })).toBeDisabled()
  })
})
