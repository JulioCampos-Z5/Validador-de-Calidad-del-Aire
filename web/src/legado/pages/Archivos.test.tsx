import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const datos = vi.hoisted(() => ({ valor: {} as Record<string, any> }))
vi.mock('../estado/DatosContexto', () => ({ useDatos: () => datos.valor }))
const archivosApi = vi.hoisted(() => ({ listar: vi.fn(), vista: vi.fn(), abrir: vi.fn(), borrar: vi.fn() }))
vi.mock('../services/archivos', () => ({ archivosApi }))

import Archivos from './Archivos'

const LISTA = [
  { nombre: 'BD_2026.xlsx', tamano: 90_310, modificado: '2026-10-09T10:00:00', tipo: 'validado' },
  { nombre: 'Trs_septiembre.csv', tamano: 512, modificado: '2026-10-01T09:00:00', tipo: 'envista' },
]
const VISTA = {
  nombre: 'BD_2026.xlsx', hojas: ['Data', 'Resumen_Banderas'], hoja: 'Data',
  columnas: ['STATION', 'DATE', 'HOUR', 'O3'], filas: [['AGU', '2026-01-01 01:00:00', 1, 0.018]], total: 82979,
}

beforeEach(() => {
  datos.valor = { cargarGuardado: vi.fn().mockResolvedValue(true), cargando: false, error: null, exito: '82,979 registros de BD_2026.xlsx.' }
  archivosApi.listar.mockResolvedValue({ disponible: true, carpeta: 'C:\\datos\\archivos', archivos: LISTA })
  archivosApi.vista.mockResolvedValue(VISTA)
  archivosApi.borrar.mockResolvedValue(undefined)
})

describe('Visor de archivos', () => {
  it('lista los guardados con tipo, tamaño y carpeta', async () => {
    render(<Archivos ir={vi.fn()} />)
    const fila = (await screen.findByText('BD_2026.xlsx')).closest('tr')!
    expect(within(fila).getByText('Ya validado')).toBeInTheDocument()
    expect(within(fila).getByText('88 KB')).toBeInTheDocument()
    expect(screen.getByText('Trs_septiembre.csv').closest('tr')).toHaveTextContent('ENVISTA')
    expect(screen.getByText('C:\\datos\\archivos')).toBeInTheDocument()
  })

  it('buscar por nombre', async () => {
    render(<Archivos ir={vi.fn()} />)
    await screen.findByText('BD_2026.xlsx')
    await userEvent.type(screen.getByPlaceholderText('Buscar por nombre…'), 'trs')
    expect(screen.queryByText('BD_2026.xlsx')).not.toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('Buscar por nombre…'), 'xyz')
    expect(screen.getByText(/Ningún archivo coincide/)).toBeInTheDocument()
  })

  it('vista previa: primeras filas, total y cambiar de hoja', async () => {
    render(<Archivos ir={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ver BD_2026.xlsx' }))
    const vista = await screen.findByRole('region', { name: 'Vista previa' })
    expect(within(vista).getByText(/Primeras 1 de 82,979 filas · 4 columnas/)).toBeInTheDocument()
    expect(within(vista).getByText('2026-01-01 01:00:00')).toBeInTheDocument()
    await userEvent.selectOptions(within(vista).getByRole('combobox'), 'Resumen_Banderas')
    expect(archivosApi.vista).toHaveBeenLastCalledWith('BD_2026.xlsx', 'Resumen_Banderas')
    await userEvent.click(within(vista).getByRole('button', { name: 'Cerrar vista previa' }))
    expect(screen.queryByRole('region', { name: 'Vista previa' })).not.toBeInTheDocument()
  })

  it('abrir en el validador y saltar a Validación o Gráficas', async () => {
    const ir = vi.fn()
    render(<Archivos ir={ir} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir BD_2026.xlsx en el validador' }))
    expect(datos.valor.cargarGuardado).toHaveBeenCalledWith('BD_2026.xlsx')
    expect(await screen.findByRole('status')).toHaveTextContent('82,979 registros de BD_2026.xlsx.')
    await userEvent.click(screen.getByRole('button', { name: 'Ver gráficas' }))
    expect(ir).toHaveBeenCalledWith('graficas')
    await userEvent.click(screen.getByRole('button', { name: 'Ver en Validación' }))
    expect(ir).toHaveBeenCalledWith('validacion')
  })

  it('si no se pudo abrir no ofrece ir a verlo', async () => {
    datos.valor.cargarGuardado.mockResolvedValue(false)
    datos.valor.error = 'El archivo no contiene hoja Data ni Datos_Validados'
    render(<Archivos ir={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir BD_2026.xlsx en el validador' }))
    expect(screen.getByRole('alert')).toHaveTextContent('no contiene hoja Data')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('borrar pide confirmación', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<Archivos ir={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Borrar BD_2026.xlsx' }))
    expect(archivosApi.borrar).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Borrar BD_2026.xlsx' }))
    expect(confirmar).toHaveBeenCalledTimes(2)
    expect(archivosApi.borrar).toHaveBeenCalledWith('BD_2026.xlsx')
    await waitFor(() => expect(archivosApi.listar).toHaveBeenCalledTimes(2))
  })

  it('sin archivos y fuera del escritorio', async () => {
    archivosApi.listar.mockResolvedValueOnce({ disponible: true, archivos: [] })
    const { unmount } = render(<Archivos ir={vi.fn()} />)
    expect(await screen.findByText('Todavía no hay archivos guardados.')).toBeInTheDocument()
    unmount()
    archivosApi.listar.mockResolvedValueOnce({ disponible: false, archivos: [] })
    render(<Archivos ir={vi.fn()} />)
    expect(await screen.findByText('Los archivos guardados están en la app de escritorio.')).toBeInTheDocument()
  })

  it('error de la API', async () => {
    archivosApi.listar.mockRejectedValue({ response: { data: { error: 'motor apagado' } } })
    render(<Archivos ir={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('motor apagado')
  })
})
