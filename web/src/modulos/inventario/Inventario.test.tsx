import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorApi, type Cliente } from '../../compartido/api'
import type { PropsModulo } from '../../compartido/modulo'
import type { Rol } from '../../compartido/tipos'
import { Inventario } from './Inventario'

const CAT = {
  tipos: ['Analizador', 'Sensor'], estatusEquipo: ['Activo', 'Activo - Requiere atención', 'No Activo - Falla', 'Baja'],
  conexiones: ['TCP/IP', 'RS232'], estatusEstacion: ['Disponible', 'Dañada'],
}
const equipo = (id: number, extra = {}) => ({
  id, noPieza: '', resguardante: 'Nayeli', anioAdquisicion: 2024, tipo: 'Analizador', parametro: 'O3', marca: 'ACOEM',
  modelo: `Serinus ${id}`, equipo: '', numeroSerie: `SN-${id}`, conexion: 'TCP/IP', fechaUltimaActualizacion: '2026-10-01T15:00:00Z',
  estatus: 'Activo', comentarios: '', idEstacion: null as number | null, estacion: null as string | null, complementos: [] as number[], ...extra,
})
const EQUIPOS = [
  equipo(1, { idEstacion: 10, estacion: 'Centro' }),
  equipo(2, { estatus: 'No Activo - Falla', parametro: 'PM10' }),
  equipo(3, { equipo: 'Datalogger', tipo: 'Sensor' }),
]
const ESTACIONES = [{ id: 10, nombre: 'Centro', ubicacion: 'GDL', estatus: 'Disponible', equipos: 1 }]

function montar(rol: Rol = 'tecnico', extra: Record<string, unknown> = {}) {
  const api = {
    get: vi.fn(async (ruta: string) => ({
      '/api/inventario/equipos': { equipos: EQUIPOS },
      '/api/inventario/estaciones': { estaciones: ESTACIONES },
      '/api/inventario/catalogos': CAT,
    })[ruta]),
    post: vi.fn(async () => equipo(99)),
    put: vi.fn(async (ruta: string) => (ruta.endsWith('/estacion') || ruta.endsWith('/complementos') ? {} : EQUIPOS[1])),
    ...extra,
  }
  const props = { api: api as unknown as Cliente, usuario: { id: 1, nombre: 'J', correo: 'j@x.mx', rol, estatus: 'activo' } } as PropsModulo
  render(<Inventario {...props} />)
  return api
}

const filas = () => screen.getAllByRole('row').slice(1)

describe('Inventario', () => {
  it('cuenta equipos, en almacen y con problema', async () => {
    montar()
    expect(await screen.findByRole('button', { name: 'Equipos · 3' })).toBeInTheDocument()
    expect(screen.getByText('En almacén').nextSibling).toHaveTextContent('2')
    expect(screen.getByText('Requieren atención o con falla').nextSibling).toHaveTextContent('1')
    expect(filas()).toHaveLength(3)
  })

  it('buscar y filtrar por ubicacion y estatus', async () => {
    montar()
    await screen.findByRole('button', { name: 'Equipos · 3' })
    await userEvent.type(screen.getByPlaceholderText(/Equipo, modelo, serie/), 'pm10')
    expect(filas()).toHaveLength(1)
    await userEvent.clear(screen.getByPlaceholderText(/Equipo, modelo, serie/))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Ubicación' }), 'Almacén')
    expect(filas()).toHaveLength(2)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Estatus' }), 'Baja')
    expect(screen.getByText('Nada coincide')).toBeInTheDocument()
  })

  it('alta de equipo: valida, guarda, lo ubica y le pone complementos', async () => {
    const api = montar()
    await userEvent.click(await screen.findByRole('button', { name: /Nuevo equipo/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe al menos el equipo o el modelo')

    await userEvent.type(screen.getByPlaceholderText('Analizador de ozono'), 'Analizador de ozono')
    const ficha = screen.getByRole('heading', { name: 'Nuevo equipo' }).closest('form')!
    await userEvent.selectOptions(within(ficha).getByLabelText('Ubicación'), 'Centro')
    const lista = screen.getByLabelText('Buscar complemento').nextElementSibling as HTMLElement
    await userEvent.click(within(lista).getAllByRole('checkbox')[0])
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(api.post).toHaveBeenCalled())
    const [ruta, cuerpo] = api.post.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(ruta).toBe('/api/inventario/equipos')
    expect(cuerpo).toMatchObject({ equipo: 'Analizador de ozono', tipo: 'Analizador', estatus: 'Activo', numeroSerie: null, conexion: null })
    expect(api.put).toHaveBeenCalledWith('/api/inventario/equipos/99/estacion', { idEstacion: 10 })
    expect(api.put).toHaveBeenCalledWith('/api/inventario/equipos/99/complementos', { idEquipos: [1] })
  })

  it('editar sin mover no llama a ubicar ni a complementos', async () => {
    const api = montar()
    await userEvent.click(await screen.findByText('ACOEM Serinus 2'))
    const ficha = screen.getByRole('heading', { name: 'ACOEM Serinus 2' }).closest('form')!
    await userEvent.selectOptions(within(ficha).getByLabelText('Estatus'), 'Activo')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1))
    expect(api.put.mock.calls[0][0]).toBe('/api/inventario/equipos/2')
  })

  it('un usuario de solo lectura ve la ficha sin poder guardar', async () => {
    montar('user')
    await screen.findByRole('button', { name: 'Equipos · 3' })
    expect(screen.queryByRole('button', { name: /Nuevo equipo/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getAllByText('Datalogger')[0])
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Analizador de ozono')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
  })

  it('estaciones: alta y edicion', async () => {
    const api = montar()
    await userEvent.click(await screen.findByRole('button', { name: 'Estaciones · 1' }))
    await userEvent.click(screen.getByRole('button', { name: /Nueva estación/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe el nombre')
    await userEvent.type(screen.getByPlaceholderText('Las Pintas'), 'Las Pintas')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(api.post).toHaveBeenCalledWith('/api/inventario/estaciones', { nombre: 'Las Pintas', ubicacion: '', estatus: 'Disponible' })

    await userEvent.click(await screen.findByText('GDL'))
    await userEvent.selectOptions(screen.getByLabelText('Estatus'), 'Dañada')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(api.put).toHaveBeenCalledWith('/api/inventario/estaciones/10', { nombre: 'Centro', ubicacion: 'GDL', estatus: 'Dañada' })
  })

  it('error de la API (p. ej. serie repetida) en la ficha', async () => {
    montar('tecnico', { post: vi.fn().mockRejectedValue(new ErrorApi('Ya existe uno con ese número de serie o nombre', 409)) })
    await userEvent.click(await screen.findByRole('button', { name: /Nuevo equipo/ }))
    await userEvent.type(screen.getByPlaceholderText('Serinus 10'), 'T400')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe uno con ese número de serie')
  })

  it('sin la API de inventario', async () => {
    montar('tecnico', { get: vi.fn().mockRejectedValue(new ErrorApi('módulo en proceso', 503)) })
    expect(await screen.findByText('módulo en proceso')).toBeInTheDocument()
  })
})
