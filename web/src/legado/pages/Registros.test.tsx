import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const datos = vi.hoisted(() => ({ valor: {} as Record<string, unknown> }))
const ias = vi.hoisted(() => ({ mide: vi.fn() }))
const api = vi.hoisted(() => ({ registros: vi.fn(), limpiarRegistros: vi.fn() }))

vi.mock('../estado/DatosContexto', () => ({ useDatos: () => datos.valor }))
vi.mock('../services/ias', () => ({ iasApi: ias }))
vi.mock('../services/api', () => ({ default: api }))
// Las tarjetas del MIR tienen sus propias pruebas; aqui solo importa donde van.
vi.mock('../components/TarjetaMir', () => ({ default: () => <div>tarjeta MIR</div> }))
vi.mock('../components/ReporteFallas', () => ({ default: () => <div>reporte de fallas</div> }))

import Registros from './Registros'

const fila = (MES: string, n: number, MUNICIPIO?: string) => ({
  MES, ...(MUNICIPIO ? { MUNICIPIO } : {}),
  IAS_GLOBAL_CAT_DIA_BUENA_ACEPTABLE: n, IAS_O3_CAT_DIA_BUENA_ACEPTABLE: n + 1,
  IAS_PM10_CAT_DIA_BUENA_ACEPTABLE: n + 2, 'IAS_PM2.5_CAT_DIA_BUENA_ACEPTABLE': n + 3,
})

const MIDE = {
  amg: [fila('Enero', 10), fila('Septiembre', 14), fila('TOTAL', 24)],
  municipios: [
    fila('Enero', 1, 'Guadalajara'), fila('Enero', 2, 'Zapopan'),
    fila('TOTAL', 5, 'Guadalajara'), fila('TOTAL', 6, 'Zapopan'),
  ],
}

beforeEach(() => {
  datos.valor = {
    resultado: { summary: {} }, mir: { estaciones: [] }, fallas: [], descripcion: 'BD_2026.xlsx',
    contaminantesMir: [], cambiarContaminantesMir: vi.fn(), alternarCeroMir: vi.fn(),
  }
  api.registros.mockResolvedValue({ registros: [], capacidad: 300 })
  api.limpiarRegistros.mockResolvedValue(undefined)
  ias.mide.mockResolvedValue(MIDE)
})

describe('Registros', () => {
  it('tres pestañas; arranca en MIR y fallas', async () => {
    render(<Registros />)
    const pestanas = screen.getAllByRole('tab')
    expect(pestanas.map((p) => p.textContent)).toEqual(['MIR y fallas', 'MIDE', 'MIDE por municipio'])
    expect(pestanas[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('tarjeta MIR')).toBeInTheDocument()
    expect(await screen.findByText('Sin errores registrados.')).toBeInTheDocument()
  })

  it('MIDE: la tabla del AMG con su fila TOTAL', async () => {
    render(<Registros />)
    await userEvent.click(screen.getByRole('tab', { name: 'MIDE' }))
    const tabla = await screen.findByRole('table')
    expect(screen.queryByText('tarjeta MIR')).not.toBeInTheDocument()
    const filas = within(tabla).getAllByRole('row')
    expect(filas).toHaveLength(4) // encabezado + 3
    expect(within(filas[0]).getAllByRole('columnheader').map((c) => c.textContent))
      .toEqual(['Mes', 'Global', 'O3', 'PM10', 'PM2.5'])
    expect(within(filas[3]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['TOTAL', '24', '25', '26', '27'])
  })

  it('MIDE: ordenar por columna; el mes va por calendario y TOTAL sigue al final', async () => {
    render(<Registros />)
    await userEvent.click(screen.getByRole('tab', { name: 'MIDE' }))
    await screen.findByRole('table')
    const meses = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)
    await userEvent.click(screen.getByRole('button', { name: 'Global' }))
    await userEvent.click(screen.getByRole('button', { name: 'Global' }))
    expect(meses()).toEqual(['Septiembre', 'Enero', 'TOTAL'])
    await userEvent.click(screen.getByRole('button', { name: 'Mes' }))
    expect(meses()).toEqual(['Enero', 'Septiembre', 'TOTAL'])
    expect(screen.getByRole('columnheader', { name: 'Mes' })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('MIDE por municipio: agrupado y con filtro', async () => {
    render(<Registros />)
    await userEvent.click(screen.getByRole('tab', { name: 'MIDE por municipio' }))
    await screen.findByRole('table')
    // Agrupado: primero todo Guadalajara y luego Zapopan, con la columna Municipio.
    const municipios = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)
    expect(municipios).toEqual(['Guadalajara', 'Guadalajara', 'Zapopan', 'Zapopan'])

    await userEvent.click(screen.getByRole('button', { name: 'Zapopan' }))
    const filas = screen.getAllByRole('row')
    expect(filas).toHaveLength(3)
    expect(within(filas[0]).queryByText('Municipio')).not.toBeInTheDocument()
    expect(within(filas[2]).getAllByRole('cell')[0]).toHaveTextContent('TOTAL')
  })

  it('las dos pestañas comparten un solo calculo del MIDE', async () => {
    render(<Registros />)
    await userEvent.click(screen.getByRole('tab', { name: 'MIDE' }))
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('tab', { name: 'MIDE por municipio' }))
    await screen.findByRole('button', { name: 'Zapopan' })
    expect(ias.mide).toHaveBeenCalledTimes(1)
  })

  it('sin datos cargados no pide el MIDE', async () => {
    datos.valor = { ...datos.valor, resultado: null, mir: null }
    render(<Registros />)
    expect(screen.getByText(/Carga un periodo o un archivo/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'MIDE' }))
    expect(screen.getByText(/para calcular el MIDE/)).toBeInTheDocument()
    expect(ias.mide).not.toHaveBeenCalled()
  })

  it('el error del calculo se muestra', async () => {
    datos.valor = { ...datos.valor, resultado: { otro: 1 } } // otro conjunto: pide de nuevo
    ias.mide.mockRejectedValue({ response: { data: { error: 'Todavía no hay datos validados cargados.' } } })
    render(<Registros />)
    await userEvent.click(screen.getByRole('tab', { name: 'MIDE' }))
    expect(await screen.findByText('Todavía no hay datos validados cargados.')).toBeInTheDocument()
  })

  it('errores del servidor: filtrar, ver la traza y vaciar', async () => {
    api.registros.mockResolvedValue({
      capacidad: 300,
      registros: [{ id: 1, momento: '2026-09-09T11:43:07', nivel: 'ERROR', origen: 'ias', mensaje: 'Falló el cálculo', traza: 'Traceback…' }],
    })
    render(<Registros />)
    expect(await screen.findByText('Falló el cálculo')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ver la traza' }))
    expect(screen.getByText('Traceback…')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Errores' }))
    await waitFor(() => expect(api.registros).toHaveBeenLastCalledWith('ERROR'))
    await userEvent.click(screen.getByRole('button', { name: /Vaciar/ }))
    expect(api.limpiarRegistros).toHaveBeenCalled()
  })

  it('servidor caido', async () => {
    api.registros.mockRejectedValue(new Error('x'))
    render(<Registros />)
    expect(await screen.findByText(/¿Está el servidor en marcha\?/)).toBeInTheDocument()
  })
})
