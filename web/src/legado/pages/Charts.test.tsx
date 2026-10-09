import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cliente } from '../../compartido/api'

const datos = vi.hoisted(() => ({ valor: {} as Record<string, unknown> }))
vi.mock('../estado/DatosContexto', () => ({ useDatos: () => datos.valor }))

// Cada vista se reemplaza por un rotulo con lo que recibe: aqui se prueba la
// pagina (fuente, pestañas, carga), no las graficas.
const vista = (nombre: string) => ({
  default: ({ data }: { data: { STATION: string; ET?: number }[] }) => (
    <div data-testid="vista">{nombre}: {data.length} filas · {[...new Set(data.map((d) => d.STATION))].join(',')}</div>
  ),
})
vi.mock('../components/LineCharts', () => vista('series'))
vi.mock('../components/PerfilHorario', () => vista('horario'))
vi.mock('../components/StatCharts', () => vista('distribucion'))
vi.mock('../components/CalendarHeatmaps', () => vista('calendario'))
vi.mock('../components/CategoriasPorHora', () => vista('categorias'))
vi.mock('../components/DiaPorHora', () => vista('diahora'))
vi.mock('../components/VientoFlechas', () => vista('viento'))

import Charts from './Charts'

const red = [
  { STATION: 'CEN', DATE: '2026-09-01', HOUR: 0, O3: 0.03 },
  { STATION: 'MIR', DATE: '2026-09-01', HOUR: 0, O3: 0.04 },
]
const MAC = 'AA:BB:CC:DD:EE:FF'

function clienteFalso() {
  const get = vi.fn(async (ruta: string) => {
    if (ruta.endsWith('/dispositivos')) {
      return { dispositivos: [
        { mac: MAC, nombre: 'SantaFe-AMBWeather-Pro', lecturas: 10, ultima: null },
        { mac: '11:22:33:44:55:66', nombre: 'Sin lecturas', lecturas: 0, ultima: null },
      ] }
    }
    return { lecturas: [
      { fecha: '2026-10-01T18:05:00Z', valores: { tempf: 68 } },
      { fecha: '2026-10-01T19:05:00Z', valores: { tempf: 86 } },
    ], cubetaSeg: 0 }
  })
  return { cliente: { get } as unknown as Cliente, get }
}

beforeEach(() => {
  datos.valor = {
    resultado: { data_preview: red }, cargando: false, error: null,
    descripcion: 'BD_2026.xlsx', origen: 'validado', limpiar: vi.fn(),
  }
})

describe('Gráficas', () => {
  it('con la red: las siete pestañas sobre lo cargado', async () => {
    render(<Charts />)
    expect(screen.getAllByRole('tab')).toHaveLength(7)
    expect(await screen.findByTestId('vista')).toHaveTextContent('series: 2 filas · CEN,MIR')
    expect(screen.getByText(/2 registros · archivo ya validado/)).toBeInTheDocument()
    // Sin API de Go (escritorio v1) no hay selector de fuente.
    expect(screen.queryByRole('group', { name: 'Fuente de datos' })).not.toBeInTheDocument()
  })

  it('cambiar de pestaña y moverse con las flechas', async () => {
    render(<Charts />)
    await userEvent.click(screen.getByRole('tab', { name: /Viento/ }))
    expect(await screen.findByTestId('vista')).toHaveTextContent('viento')
    screen.getByRole('tab', { name: /Viento/ }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: /Series/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: /Viento/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('Descartar limpia lo cargado', async () => {
    render(<Charts />)
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(datos.valor.limpiar).toHaveBeenCalled()
  })

  it('sin datos ni error', () => {
    datos.valor = { ...datos.valor, resultado: null, error: 'Algo falló' }
    render(<Charts />)
    expect(screen.getByText('No hay datos cargados.')).toBeInTheDocument()
    expect(screen.getByText('Algo falló')).toBeInTheDocument()
  })

  it('Ambient Weather: carga todas las estaciones con lecturas, sin categorias ni dia × hora', async () => {
    const { cliente, get } = clienteFalso()
    render(<Charts api={cliente} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ambient Weather' }))
    expect(screen.getByRole('button', { name: 'Ambient Weather' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('tab')).not.toBeInTheDocument() // nada cargado aun
    expect(screen.queryByText('Datos cargados:')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cargar' }))
    expect(await screen.findByTestId('vista')).toHaveTextContent('series: 2 filas · SantaFe')
    const pestanas = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(pestanas).not.toContain('Categorías')
    expect(pestanas).not.toContain('Día × hora')
    expect(pestanas).toHaveLength(5)
    // Solo se pide la serie de la estacion que tiene lecturas.
    expect(get.mock.calls.filter(([r]) => r.includes('/serie'))).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Volver a cargar' })).toBeInTheDocument()

    // De vuelta a la red: otra vez lo validado y las siete pestañas.
    await userEvent.click(screen.getByRole('button', { name: 'Red de monitoreo' }))
    await waitFor(() => expect(screen.getByTestId('vista')).toHaveTextContent('CEN,MIR'))
    expect(screen.getAllByRole('tab')).toHaveLength(7)
  })

  it('si estaba en Categorías y cambia a Ambient Weather, cae en Series', async () => {
    const { cliente } = clienteFalso()
    render(<Charts api={cliente} />)
    await userEvent.click(screen.getByRole('tab', { name: /Categorías/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Ambient Weather' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cargar' }))
    expect(await screen.findByTestId('vista')).toHaveTextContent('series')
  })

  it('Ambient Weather: periodo invalido o demasiado largo no deja cargar', async () => {
    const { cliente } = clienteFalso()
    render(<Charts api={cliente} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ambient Weather' }))
    const [desde] = screen.getAllByDisplayValue(/^\d{4}-\d{2}-\d{2}$/)
    await userEvent.clear(desde)
    await userEvent.type(desde, '2020-01-01')
    expect(screen.getByText('El periodo pasa de 90 días.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar' })).toBeDisabled()
  })

  it('Ambient Weather: error de la API y periodo sin lecturas', async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error('La API respondió 503'))
      .mockResolvedValueOnce({ dispositivos: [] })
    render(<Charts api={{ get } as unknown as Cliente} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ambient Weather' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cargar' }))
    expect(await screen.findByText('La API respondió 503')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cargar' }))
    expect(await screen.findByText('Ninguna estación tiene lecturas en ese periodo.')).toBeInTheDocument()
  })
})
