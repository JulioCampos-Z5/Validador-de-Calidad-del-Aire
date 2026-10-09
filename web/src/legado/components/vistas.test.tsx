import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Registro } from '../graficas/series'
import type { Dia } from '../graficas/nom172'

const Plotly = vi.hoisted(() => ({ react: vi.fn(), newPlot: vi.fn(), purge: vi.fn() }))
vi.mock('../graficas/plotly', () => ({ default: Plotly }))

const datos = vi.hoisted(() => ({ historicoDisponible: false }))
vi.mock('../estado/DatosContexto', () => ({ useDatos: () => datos }))
vi.mock('../services/historico', () => ({ historicoApi: { serie: vi.fn().mockResolvedValue([]) } }))

// Categorias y Dia × hora piden el indice al backend: aqui se simula el hook.
const categorias = vi.hoisted(() => ({ valor: {} as Record<string, unknown> }))
vi.mock('../graficas/useCategoriasMes', () => ({ useCategoriasMes: () => categorias.valor }))

import LineCharts from './LineCharts'
import PerfilHorario from './PerfilHorario'
import StatCharts from './StatCharts'
import CalendarHeatmaps from './CalendarHeatmaps'
import VientoFlechas from './VientoFlechas'
import CategoriasPorHora from './CategoriasPorHora'
import DiaPorHora from './DiaPorHora'

// Dos estaciones, dos dias completos.
function conjunto(extra: (h: number) => Record<string, number> = () => ({})): Registro[] {
  const filas: Registro[] = []
  for (const [STATION, base] of [['CEN', 0.03], ['MIR', 0.06]] as const) {
    for (let i = 0; i < 48; i++) {
      filas.push({
        STATION, DATE: `2026-09-0${1 + Math.floor(i / 24)}`, HOUR: i % 24,
        O3: base + (i % 24) / 1000, PM10: 40 + (i % 7), 'PM2.5': 12 + (i % 5), ET: 20 + (i % 10),
        WS: 2 + (i % 3), WD: (i * 15) % 360, ...extra(i),
      })
    }
  }
  return filas
}

const nombresDeTrazas = (llamada: unknown[]) => (llamada[1] as { name?: string }[]).map((t) => t.name ?? '')

beforeEach(() => {
  datos.historicoDisponible = false
})

describe('Series (LineCharts)', () => {
  it('dibuja una traza por estacion del parametro de partida (O3)', async () => {
    render(<LineCharts data={conjunto()} />)
    await waitFor(() => expect(Plotly.react).toHaveBeenCalled())
    const trazas = nombresDeTrazas(Plotly.react.mock.calls.at(-1)!)
    expect(trazas.some((n) => n.includes('CEN'))).toBe(true)
    expect(trazas.some((n) => n.includes('MIR'))).toBe(true)
  })

  it('sin O3 arranca en el primer parametro con datos (Ambient Weather)', async () => {
    const aw = conjunto().map(({ O3: _o3, PM10: _p, 'PM2.5': _q, ...resto }) => resto as Registro)
    render(<LineCharts data={aw} />)
    await waitFor(() => expect(Plotly.react).toHaveBeenCalled())
    expect(screen.getByRole('checkbox', { name: /^ET/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^O3/ })).not.toBeChecked()
  })

  it('desmarcar una estacion la quita de la grafica', async () => {
    render(<LineCharts data={conjunto()} />)
    await waitFor(() => expect(Plotly.react).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: /^MIR$/ }))
    await waitFor(() => {
      const trazas = nombresDeTrazas(Plotly.react.mock.calls.at(-1)!)
      expect(trazas.some((n) => n.includes('MIR'))).toBe(false)
    })
  })
})

describe('Comportamiento horario', () => {
  it('24 horas del promedio de la zona', async () => {
    render(<PerfilHorario data={conjunto()} />)
    await waitFor(() => expect(Plotly.react).toHaveBeenCalled())
    const trazas = Plotly.react.mock.calls.at(-1)![1] as { x: unknown[] }[]
    expect(trazas[0].x).toHaveLength(24)
  })
})

describe('Distribucion', () => {
  it('estadisticas por estacion del parametro elegido', async () => {
    render(<StatCharts data={conjunto()} />)
    expect(await screen.findByText(/Estadísticas de O3 por Estación/)).toBeInTheDocument()
    const tabla = screen.getAllByRole('table')[0]
    expect(within(tabla).getByText('CEN')).toBeInTheDocument()
    expect(within(tabla).getByText('MIR')).toBeInTheDocument()
  })

  it('meteorologicos cambia de parametro', async () => {
    render(<StatCharts data={conjunto()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Meteorológicos' }))
    expect(await screen.findByText(/Estadísticas de IT por Estación|Estadísticas de ET por Estación/)).toBeInTheDocument()
  })
})

describe('Calendario', () => {
  it('pinta el mes de la estacion elegida', async () => {
    render(<CalendarHeatmaps data={conjunto()} />)
    expect(screen.getByText('Calendario por Hora')).toBeInTheDocument()
    await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled())
  })

  it('avisa si el contaminante no tiene datos', async () => {
    const sinPM = conjunto().map(({ 'PM2.5': _q, ...r }) => r as Registro)
    render(<CalendarHeatmaps data={sinPM} />)
    await userEvent.click(screen.getByRole('button', { name: 'PM2.5' }))
    expect(await screen.findByText(/No hay datos de PM2.5/)).toBeInTheDocument()
  })
})

describe('Viento', () => {
  it('una flecha por hora con velocidad y direccion', async () => {
    render(<VientoFlechas data={conjunto()} />)
    expect(screen.getByText('Velocidad y dirección del viento')).toBeInTheDocument()
    await waitFor(() => expect(Plotly.react).toHaveBeenCalled())
    expect(screen.getByText(/^96 flechas/)).toBeInTheDocument() // 2 estaciones × 48 h
  })
})

// ── Vistas NOM-172 (indice del backend) ────────────────────────────────────

const ev = (cat: number | null) => ({ cat, pol: 'O3' as const, valores: Object.fromEntries(
  ['O3', 'NO2', 'SO2', 'CO', 'PM10', 'PM2.5'].map((p) => [p, [0.05, cat]]),
) as never })

function dia(fecha: string, diaria: number, horas: (number | null)[]): Dia {
  const cats = horas.filter((c): c is number => c !== null)
  return {
    fecha, horas: horas.map((c) => (c === null ? null : ev(c))),
    diaria: { ...ev(diaria), nom: 'Si' }, peorHora: Math.max(...cats),
    horasPeores: cats.filter((c) => c > diaria).length,
  }
}

function conCategorias(dias: Dia[], extra = {}) {
  categorias.valor = {
    estaciones: ['CEN', 'AMG'], estacion: 'CEN', setEstacion: vi.fn(),
    meses: ['2026-09'], mes: '2026-09', setMes: vi.fn(), dias, cargando: false, error: null, ...extra,
  }
}

describe('Día × hora', () => {
  const dias = [
    dia('2026-09-28', 0, Array(24).fill(0)),
    dia('2026-09-29', 0, [1, ...Array(23).fill(0)]), // una hora peor que el dia
  ]

  it('sin la columna +peor; el resumen cuenta las horas peores', () => {
    conCategorias(dias)
    render(<DiaPorHora data={[]} />)
    expect(screen.queryByText(/\+peor/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Qué significa/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).not.toContain('+peor')
    expect(screen.getByText(/1 de 2 días tuvieron horas peores que su categoría diaria/)).toBeInTheDocument()
    expect(screen.getByText(/quedaron por encima de la categoría del día\.$/)).toBeInTheDocument()
    // 3 columnas fijas + 24 horas por fila, nada mas.
    expect(within(screen.getAllByRole('row')[1]).getAllByRole('cell')).toHaveLength(27)
  })

  it('tocar un dia abre su detalle; calendario como otra vista', async () => {
    conCategorias(dias)
    render(<DiaPorHora data={[]} />)
    await userEvent.click(screen.getByRole('button', { name: /29\s*sep/ }))
    expect(screen.getAllByText(/29/).length).toBeGreaterThan(1)
    await userEvent.click(screen.getByRole('tab', { name: 'Calendario' }))
    expect(screen.getByText('lun')).toBeInTheDocument()
  })

  it('error y sin datos', () => {
    conCategorias([], { error: 'No se pudo calcular el índice en el servidor.' })
    const { unmount } = render(<DiaPorHora data={[]} />)
    expect(screen.getByText('No se pudo calcular el índice en el servidor.')).toBeInTheDocument()
    unmount()
    conCategorias([])
    render(<DiaPorHora data={[]} />)
    expect(screen.getByText(/No hay contaminantes criterio suficientes en CEN/)).toBeInTheDocument()
  })
})

describe('Categorías por hora', () => {
  it('cuenta dias por categoria en cada hora', async () => {
    conCategorias([dia('2026-09-28', 0, Array(24).fill(0)), dia('2026-09-29', 1, Array(24).fill(1))])
    render(<CategoriasPorHora data={[]} />)
    await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled())
    const trazas = Plotly.newPlot.mock.calls.at(-1)![1] as { name: string; y: number[] }[]
    const buena = trazas.find((t) => t.name.startsWith('Buena'))!
    expect(buena.y).toHaveLength(24)
    expect(buena.y[0]).toBe(1)
  })
})

describe('Interacción de las vistas', () => {
  it('Comportamiento horario: estacion, cruce y comparar fechas', async () => {
    render(<PerfilHorario data={conjunto()} />)
    await waitFor(() => expect(Plotly.react).toHaveBeenCalled())
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Estación' }), 'CEN')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Cruce/ }), 'ET')
    await waitFor(() => expect((Plotly.react.mock.calls.at(-1)![1] as unknown[]).length).toBeGreaterThan(1))

    await userEvent.click(screen.getByRole('button', { name: 'Comparar fechas' }))
    const fechas = screen.getAllByDisplayValue(/^2026-09-0\d$/)
    expect(fechas.length).toBe(4) // dos periodos: primer y ultimo dia
    await userEvent.click(screen.getByRole('button', { name: '+ Agregar periodo' }))
    expect(screen.getAllByDisplayValue(/^2026-09-0\d$/).length).toBe(6)
    await userEvent.click(screen.getAllByRole('button', { name: 'Quitar' })[0])
    expect(screen.getAllByDisplayValue(/^2026-09-0\d$/).length).toBe(4)
    await userEvent.click(screen.getByRole('button', { name: 'Dejar de comparar' }))
  })

  it('Series: todas/ninguna, promedio y maximo AMG, atajos', async () => {
    render(<LineCharts data={conjunto()} />)
    await waitFor(() => expect(Plotly.react).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: 'Ninguna' }))
    await userEvent.click(screen.getByRole('button', { name: 'Todas' }))
    await userEvent.click(screen.getByRole('button', { name: /Promedio AMG/ }))
    await userEvent.click(screen.getByRole('button', { name: /Máximo AMG/ }))
    await waitFor(() => {
      const nombres = nombresDeTrazas(Plotly.react.mock.calls.at(-1)!)
      expect(nombres.some((n) => /Promedio/.test(n))).toBe(true)
      expect(nombres.some((n) => /Máximo/.test(n))).toBe(true)
    })
    await userEvent.click(screen.getByRole('checkbox', { name: /^PM10/ }))
    await userEvent.click(screen.getByRole('radio', { name: 'Atajos' }))
    await userEvent.click(screen.getByRole('button', { name: /^O3 \/ ET/ }))
    // El atajo deja exactamente O3 y ET, en ejes distintos.
    await waitFor(() => expect(screen.getAllByText('2 elegidos').length).toBeGreaterThan(0))
  })

  it('Distribucion: violin', async () => {
    render(<StatCharts data={conjunto()} />)
    // El interruptor no tiene nombre accesible: se llega por su rotulo vecino.
    await userEvent.click(screen.getByText('Desviación Estándar').nextElementSibling as HTMLElement)
    await waitFor(() => expect(Plotly.react).toHaveBeenCalled())
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'PM10')
    expect(await screen.findByText(/Violín - PM10 por Estación/)).toBeInTheDocument()
  })

  it('Viento: estaciones, sentido, cada cuanto y color por contaminante', async () => {
    render(<VientoFlechas data={conjunto()} />)
    await waitFor(() => expect(Plotly.react).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: 'Ninguna' }))
    await userEvent.click(screen.getByRole('button', { name: 'Todas' }))
    const [sentido, paso] = screen.getAllByRole('combobox')
    await userEvent.selectOptions(sentido, sentido.querySelectorAll('option')[1] as HTMLOptionElement)
    await userEvent.selectOptions(paso, paso.querySelectorAll('option')[1] as HTMLOptionElement)
    await userEvent.click(within(screen.getByRole('group', { name: 'Color de las flechas' })).getByRole('button', { name: 'O3' }))
    await waitFor(() => expect(Plotly.react.mock.calls.length).toBeGreaterThan(3))
  })

  it('Calendario: otra estacion y otro contaminante', async () => {
    render(<CalendarHeatmaps data={conjunto()} />)
    await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled())
    const llamadas = Plotly.newPlot.mock.calls.length
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'MIR')
    await userEvent.click(screen.getByRole('button', { name: 'PM10' }))
    await waitFor(() => expect(Plotly.newPlot.mock.calls.length).toBeGreaterThan(llamadas))
  })
})
