import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorApi, type Cliente } from '../../compartido/api'
import type { PropsModulo } from '../../compartido/modulo'
import type { Usuario } from '../../compartido/tipos'
import { Admin } from './Admin'

const YO: Usuario = { id: 1, nombre: 'Julio Campos', correo: 'julio@jalisco.gob.mx', rol: 'root', estatus: 'activo' }
const OTRA: Usuario = { id: 2, nombre: 'Nayeli', correo: 'nayeli@jalisco.gob.mx', rol: 'tecnico', estatus: 'activo' }

function montar(extra: Partial<Record<'get' | 'post' | 'patch', ReturnType<typeof vi.fn>>> = {}) {
  const api = {
    get: vi.fn(async (ruta: string) => {
      if (ruta === '/api/usuarios') return { usuarios: [YO, OTRA].map((u) => ({ ...u, creado: '2026-10-01T15:00:00Z' })) }
      if (ruta === '/api/puertos/estaciones') return { estaciones: [
        { id: 1, nombre: 'Centro', activa: true, ultimoLatido: new Date().toISOString(), sinComunicacion: false },
        { id: 2, nombre: 'Pintas', activa: true, ultimoLatido: null, sinComunicacion: false },
      ] }
      if (ruta.startsWith('/api/bitacora')) return { registros: [
        { id: 1, usuario: 'Julio Campos', fecha: '2026-10-08T15:00:00Z', accion: 'equipo_movido', detalle: { de: 'Almacén', a: 'Centro' } },
        { id: 2, fecha: '2026-10-08T15:01:00Z', accion: 'login_fallido', detalle: { correo: 'x@y.mx', ip: '1.2.3.4' } },
        { id: 3, usuario: 'Julio Campos', fecha: '2026-10-08T15:02:00Z', accion: 'analisis', detalle: { ruta: 'ias/mide' } },
      ] }
      return {}
    }),
    post: vi.fn().mockResolvedValue({ nombre: 'Las Pintas', token: 'a'.repeat(64) }),
    patch: vi.fn().mockResolvedValue({}),
    ...extra,
  }
  const props = { api: api as unknown as Cliente, usuario: YO } as PropsModulo
  render(<Admin {...props} />)
  return api
}

describe('Admin · usuarios', () => {
  it('lista con el rol en palabras y marca quien soy', async () => {
    montar()
    const fila = (await screen.findByText('Nayeli')).closest('tr')!
    expect(within(fila).getByText('Técnico')).toBeInTheDocument()
    expect(screen.getByText(/· tú/)).toBeInTheDocument()
  })

  it('alta: valida antes de enviar y manda los datos', async () => {
    const api = montar()
    await userEvent.click(await screen.findByRole('button', { name: /Nuevo usuario/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe el nombre')
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana')
    await userEvent.type(screen.getByPlaceholderText('nombre@jalisco.gob.mx'), 'ana@jalisco.gob.mx')
    await userEvent.type(screen.getByPlaceholderText('Al menos 10 caracteres'), 'corta')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('al menos 10 caracteres')
    await userEvent.type(screen.getByPlaceholderText('Al menos 10 caracteres'), '-y-mas-larga')
    await userEvent.selectOptions(screen.getByLabelText('Rol'), 'tecnico')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(api.post).toHaveBeenCalledWith('/api/usuarios', { nombre: 'Ana', correo: 'ana@jalisco.gob.mx', contrasena: 'corta-y-mas-larga', rol: 'tecnico' })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Nuevo usuario' })).not.toBeInTheDocument())
  })

  it('editar manda solo lo que cambio; no puedo desactivarme', async () => {
    const api = montar()
    await userEvent.click(await screen.findByText('Nayeli'))
    expect(screen.getByRole('heading', { name: 'Editar a Nayeli' })).toBeInTheDocument()
    expect(screen.getByLabelText('Correo')).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Estatus'), 'inactivo')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(api.patch).toHaveBeenCalledWith('/api/usuarios/2', { estatus: 'inactivo' })

    await userEvent.click(await screen.findByText('Julio Campos'))
    expect(screen.getByLabelText('Estatus')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(api.patch).toHaveBeenCalledTimes(1) // sin cambios no se llama
  })

  it('el error de la API se muestra en el formulario', async () => {
    montar({ post: vi.fn().mockRejectedValue(new ErrorApi('ya hay un usuario con ese correo', 409)) })
    await userEvent.click(await screen.findByRole('button', { name: /Nuevo usuario/ }))
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana')
    await userEvent.type(screen.getByPlaceholderText('nombre@jalisco.gob.mx'), 'julio@jalisco.gob.mx')
    await userEvent.type(screen.getByPlaceholderText('Al menos 10 caracteres'), 'una-larga-123')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ya hay un usuario con ese correo')
  })
})

describe('Admin · estaciones del detector', () => {
  it('crear una muestra su token una sola vez y se puede copiar', async () => {
    const escribir = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escribir }, configurable: true })
    const api = montar()
    await userEvent.click(screen.getByRole('button', { name: 'Estaciones del detector' }))
    expect(await screen.findByText('Nunca se ha conectado')).toBeInTheDocument()
    expect(screen.getByText('Comunicada')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Nueva estación/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Crear y ver token' }))
    expect(screen.getByText('Escribe el nombre de la estación')).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('Las Pintas'), '  Las Pintas ')
    await userEvent.click(screen.getByRole('button', { name: 'Crear y ver token' }))
    expect(api.post).toHaveBeenCalledWith('/api/puertos/estaciones', { nombre: 'Las Pintas' })
    expect(await screen.findByText('a'.repeat(64))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Copiar/ }))
    expect(escribir).toHaveBeenCalledWith('a'.repeat(64))
    expect(await screen.findByRole('button', { name: /Copiado/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Listo' }))
    expect(screen.queryByText('a'.repeat(64))).not.toBeInTheDocument()
  })
})

describe('Admin · bitácora', () => {
  it('acciones en palabras con su detalle', async () => {
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Bitácora' }))
    expect(await screen.findByText('Movió un equipo')).toBeInTheDocument()
    expect(screen.getByText('Almacén → Centro')).toBeInTheDocument()
    expect(screen.getByText('Intento de entrada fallido')).toBeInTheDocument()
    expect(screen.getByText('x@y.mx')).toBeInTheDocument()
    expect(screen.getByText('Sistema')).toBeInTheDocument()
    expect(screen.getByText('ias/mide')).toBeInTheDocument()
  })

  it('error al leerla', async () => {
    montar({ get: vi.fn().mockRejectedValue(new ErrorApi('tu rol no tiene permiso para esto', 403)) })
    await userEvent.click(screen.getByRole('button', { name: 'Bitácora' }))
    expect(await screen.findByText('tu rol no tiene permiso para esto')).toBeInTheDocument()
  })
})
