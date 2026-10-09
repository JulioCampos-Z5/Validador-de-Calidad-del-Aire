import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Falla, Mir } from '../services/minutales'

vi.mock('html-to-image', () => ({ toBlob: vi.fn().mockResolvedValue(new Blob(['png'])) }))
const ias = vi.hoisted(() => ({ resumen: vi.fn(), categorias: vi.fn() }))
vi.mock('../services/ias', () => ({ iasApi: ias }))

import TarjetaMir from './TarjetaMir'
import ReporteFallas from './ReporteFallas'
import DataTable from './DataTable'
import StatCard from './StatCard'
import SelectorEstacionMes from './SelectorEstacionMes'
import { useCategoriasMes } from '../graficas/useCategoriasMes'

const mir: Mir = {
  contaminantes: ['O3', 'PM10'], umbral: 75, desde: '2026-09-01', hasta: '2026-09-30',
  promedio_periodo: 82.5, estaciones_que_cumplen: 1, total_estaciones: 2,
  estaciones: [
    { estacion: 'CEN', coberturas: { O3: 99, PM10: 96 }, sin_equipo: [], como_cero: [], horas_esperadas: 720, total: 97.5, cumple: true },
    { estacion: 'TLA', coberturas: { O3: 70, PM10: null }, sin_equipo: ['PM10'], como_cero: [], horas_esperadas: 720, total: 70, cumple: false },
  ],
}

describe('Tarjeta MIR', () => {
  it('muestra promedio, cuantas cumplen y la tabla por estacion', () => {
    render(<TarjetaMir mir={mir} contaminantes={['O3', 'PM10']} onCambiarContaminantes={vi.fn()} onAlternarCero={vi.fn()} />)
    expect(screen.getAllByText(/82.5/).length).toBeGreaterThan(0)
    const tla = screen.getAllByRole('row').find((r) => within(r).queryByText('TLA'))!
    expect(within(tla).getAllByText('70')).toHaveLength(2) // O3 y el total (PM10 sin equipo no entra)
  })

  it('un clic en «—» marca el canal como 0; quitar un contaminante recalcula', async () => {
    const alternar = vi.fn()
    const cambiar = vi.fn()
    render(<TarjetaMir mir={mir} contaminantes={['O3', 'PM10']} onCambiarContaminantes={cambiar} onAlternarCero={alternar} />)
    const tla = screen.getAllByRole('row').find((r) => within(r).queryByText('TLA'))!
    await userEvent.click(within(tla).getByRole('button'))
    expect(alternar).toHaveBeenCalledWith('TLA', 'PM10')
    await userEvent.click(screen.getByRole('checkbox', { name: /PM10/ }))
    expect(cambiar).toHaveBeenCalledWith(['O3'])
  })

  it('descargar la tarjeta como PNG con el periodo en el nombre', async () => {
    let nombre = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { nombre = this.download })
    render(<TarjetaMir mir={mir} contaminantes={['O3', 'PM10']} onCambiarContaminantes={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /PNG/ }))
    await waitFor(() => expect(nombre).toBe('MIR_2026-09-01_a_2026-09-30.png'))
  })
})

describe('Reporte de fallas', () => {
  const falla = (estacion: string, tipo: Falla['tipo'], hunde: boolean): Falla => ({
    estacion, contaminante: 'PM10', tipo, cobertura: tipo === 'sin_equipo' ? null : 20, detalle: 'detalle', hunde_a_la_estacion: hunde,
  })

  it('separa las que tumban a la estacion de las demas', () => {
    render(<ReporteFallas fallas={[falla('TLA', 'caido', true), falla('CEN', 'intermitente', false)]} />)
    expect(screen.getByText('Tumban a su estación')).toBeInTheDocument()
    expect(screen.getByText('La estación cumple, pero el canal no')).toBeInTheDocument()
    expect(screen.getAllByText('Caído').length).toBeGreaterThan(0)
  })

  it('sin fallas lo dice', () => {
    render(<ReporteFallas fallas={[]} />)
    expect(screen.queryByText('Tumban a su estación')).not.toBeInTheDocument()
  })
})

describe('Tabla de datos', () => {
  const filas = Array.from({ length: 120 }, (_, i) => ({ PM10: i, STATION: 'CEN', DATE: '2026-09-01', HOUR: i % 24, O3: 'IO' }))

  it('columnas en el orden de la BD y paginada', async () => {
    render(<DataTable data={filas} maxRows={50} />)
    const cabeza = screen.getAllByRole('columnheader').map((c) => c.textContent?.trim())
    expect(cabeza.slice(0, 5)).toEqual(['STATION', 'DATE', 'HOUR', 'O3', 'PM10'])
    expect(screen.getAllByRole('row')).toHaveLength(51)
    const siguiente = screen.getAllByRole('button').find((b) => b.querySelector('svg') && !b.hasAttribute('disabled') && b.textContent === '')
    if (siguiente) await userEvent.click(siguiente)
  })

  it('vacia', () => {
    render(<DataTable data={[]} />)
    expect(screen.getByText('No hay datos para mostrar')).toBeInTheDocument()
  })
})

describe('Piezas chicas', () => {
  it('StatCard formatea numeros', () => {
    render(<StatCard title="Registros" value={82979} icon={null} description="13 estaciones" />)
    expect(screen.getByText((82979).toLocaleString())).toBeInTheDocument()
    expect(screen.getByText('13 estaciones')).toBeInTheDocument()
  })

  it('SelectorEstacionMes', async () => {
    const onEstacion = vi.fn()
    const onMes = vi.fn()
    render(<SelectorEstacionMes estaciones={['CEN', 'AMG']} estacion="CEN" onEstacion={onEstacion} meses={['2026-08', '2026-09']} mes="2026-09" onMes={onMes} />)
    expect(screen.getByRole('option', { name: 'AMG (máximo de la red)' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Estación/ }), 'AMG')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Mes/ }), 'agosto 2026')
    expect(onEstacion).toHaveBeenCalledWith('AMG')
    expect(onMes).toHaveBeenCalledWith('2026-08')
  })
})

describe('useCategoriasMes', () => {
  it('arranca en la primera estacion y el ultimo mes, y pide sus dias', async () => {
    ias.resumen.mockResolvedValue({ estaciones: ['CEN', 'AMG'], meses: { CEN: ['2026-08', '2026-09'], AMG: ['2026-09'] } })
    ias.categorias.mockResolvedValue([{ fecha: '2026-09-01', horas: Array(24).fill(null), diaria: null }])
    const { result } = renderHook(() => useCategoriasMes([]))
    await waitFor(() => expect(result.current.dias).toHaveLength(1))
    expect(result.current.estacion).toBe('CEN')
    expect(result.current.mes).toBe('2026-09')
    expect(ias.categorias).toHaveBeenCalledWith('CEN', '2026-09')
    expect(result.current.dias[0].horasPeores).toBe(0) // ya derivado

    act(() => result.current.setEstacion('AMG'))
    await waitFor(() => expect(ias.categorias).toHaveBeenLastCalledWith('AMG', '2026-09'))
  })

  it('el error del servidor llega como mensaje', async () => {
    ias.resumen.mockRejectedValue({ response: { data: { error: 'Todavía no hay datos validados cargados.' } } })
    const { result } = renderHook(() => useCategoriasMes([]))
    await waitFor(() => expect(result.current.error).toBe('Todavía no hay datos validados cargados.'))
    expect(result.current.cargando).toBe(false)
  })
})
