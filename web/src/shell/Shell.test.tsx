import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Shell } from './Shell'
import { Login } from './Login'
import { guardarSesion } from './preferencias'
import { guardarConjunto, leerConjunto, borrarConjunto } from './almacen'
import type { Rol, Sesion } from '../compartido/tipos'

// Un solo vencimiento para todas: si no, dos sesiones iguales no compararian.
const EXPIRA = new Date(Date.now() + 3_600_000).toISOString()
const sesion = (rol: Rol = 'root'): Sesion => ({
  token: 'tok', expira: EXPIRA,
  usuario: { id: 1, nombre: 'Julio Campos', correo: 'julio@jalisco.gob.mx', rol, estatus: 'activo' },
})

const ACTIVOS = ['usuarios', 'validacion', 'ambientweather']

function api(rutas: Record<string, (init?: RequestInit) => Response> = {}) {
  const fetch = vi.fn(async (ruta: string, init?: RequestInit) => {
    if (rutas[ruta]) return rutas[ruta](init)
    if (ruta === '/api/modulos') {
      return Response.json({ modulos: ['usuarios', 'validacion', 'ambientweather', 'puertos', 'inventario'].map((n) => ({
        nombre: n, estado: ACTIVOS.includes(n) ? 'activo' : 'en_proceso', ruta: `/api/${n}/`,
      })) })
    }
    if (ruta === '/api/auth/yo') return Response.json(sesion().usuario)
    if (ruta === '/api/auth/salir') return new Response(null, { status: 204 })
    return Response.json({})
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

beforeEach(async () => {
  sessionStorage.clear()
  history.replaceState(null, '', '/')
  await borrarConjunto()
})
afterEach(() => vi.unstubAllGlobals())

describe('Login', () => {
  it('pide correo y contraseña antes de llamar a la API', async () => {
    const fetch = api()
    render(<Login alEntrar={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe tu correo y tu contraseña')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('entra y recuerda la casilla', async () => {
    api({ '/api/auth/login': () => Response.json(sesion()) })
    const alEntrar = vi.fn()
    render(<Login alEntrar={alEntrar} />)
    await userEvent.type(screen.getByPlaceholderText('nombre@jalisco.gob.mx'), ' julio@jalisco.gob.mx ')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'secreta-larga')
    await userEvent.click(screen.getByRole('checkbox', { name: /Mantener la sesión iniciada/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    await waitFor(() => expect(alEntrar).toHaveBeenCalledWith(sesion(), true))
    expect(localStorage.getItem('validador.recordar')).toBe('1')
  })

  it('credenciales malas: el mensaje de la API', async () => {
    api({ '/api/auth/login': () => Response.json({ error: 'Correo o contraseña incorrectos' }, { status: 401 }) })
    render(<Login alEntrar={vi.fn()} />)
    await userEvent.type(screen.getByPlaceholderText('nombre@jalisco.gob.mx'), 'a@b.mx')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos')
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled()
  })
})

describe('Shell', () => {
  it('sin sesion: el login; al entrar, el escritorio', async () => {
    api({ '/api/auth/login': () => Response.json(sesion()) })
    render(<Shell />)
    await userEvent.type(screen.getByPlaceholderText('nombre@jalisco.gob.mx'), 'julio@jalisco.gob.mx')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'secreta-larga')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('navigation', { name: 'Módulos' })).toBeInTheDocument()
    expect(sessionStorage.getItem('validador.sesion')).not.toBeNull() // sin recordar: solo la pestaña
  })

  it('modulos segun el rol y su estado en la API', async () => {
    api()
    guardarSesion(sesion('user'))
    render(<Shell />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gráficas' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Estaciones (en proceso)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Admin/ })).not.toBeInTheDocument() // solo root/admin
    expect(screen.getByRole('button', { name: /Registros \(MIR, fallas y MIDE\)/ })).toBeInTheDocument()
  })

  it('sin modulo en la direccion abre el primero disponible y carga su iframe', async () => {
    api()
    guardarSesion(sesion())
    render(<Shell />)
    const marco = await screen.findByTitle('Tablero')
    expect(marco).toHaveAttribute('src', '/m/tablero/')
    expect(location.hash).toBe('#tablero')
  })

  it('un modulo en proceso no carga iframe', async () => {
    api()
    guardarSesion(sesion())
    history.replaceState(null, '', '/#estaciones')
    render(<Shell />)
    expect(await screen.findByText(/Este módulo está en proceso/)).toBeInTheDocument()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('cambiar de modulo y de tema', async () => {
    api()
    guardarSesion(sesion())
    render(<Shell />)
    await userEvent.click(await screen.findByRole('button', { name: 'Gráficas' }))
    expect(await screen.findByTitle('Gráficas')).toHaveAttribute('src', '/m/graficas/')
    expect(screen.getByRole('button', { name: 'Gráficas' })).toHaveAttribute('aria-current', 'page')

    const antes = document.documentElement.dataset.tema
    await userEvent.click(screen.getByRole('button', { name: /Cambiar a modo/ }))
    expect(document.documentElement.dataset.tema).not.toBe(antes)
    expect(localStorage.getItem('validador.tema')).toBe(document.documentElement.dataset.tema)
  })

  it('cerrar sesion avisa a la API, borra la sesion y lo cargado', async () => {
    const fetch = api()
    guardarSesion(sesion(), true)
    await guardarConjunto({ origen: 'x', cargado: '', respuesta: {} } as never)
    render(<Shell />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cuenta de Julio Campos' }))
    expect(screen.getByRole('menu')).toHaveTextContent('Root')
    await userEvent.click(screen.getByRole('menuitem', { name: /Cerrar sesión/ }))
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument()
    expect(fetch.mock.calls.some(([r]) => r === '/api/auth/salir')).toBe(true)
    expect(localStorage.getItem('validador.sesion')).toBeNull()
    await waitFor(async () => expect(await leerConjunto()).toBeNull())
  })

  it('protocolo con el modulo: listo → sesion y datos; guardar-datos; ir; sesion vencida', async () => {
    api()
    guardarSesion(sesion())
    history.replaceState(null, '', '/#validacion')
    render(<Shell />)
    const marco = await screen.findByTitle('Validación') as HTMLIFrameElement
    const ventana = marco.contentWindow!
    const recibido = vi.spyOn(ventana, 'postMessage')
    const desde = (data: unknown) => act(() => {
      window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin, source: ventana }))
    })

    await desde({ tipo: 'listo' })
    expect(recibido).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'sesion', sesion: sesion() }), location.origin)
    expect(recibido).toHaveBeenCalledWith({ tipo: 'datos', datos: null }, location.origin)

    const conjunto = { origen: 'BD_2026.xlsx', cargado: '2026-10-08', respuesta: { summary: {} } }
    await desde({ tipo: 'guardar-datos', datos: conjunto })
    await waitFor(async () => expect(await leerConjunto()).toEqual(conjunto))

    await desde({ tipo: 'ir', modulo: 'graficas' })
    const graficas = await screen.findByTitle('Gráficas')
    expect(graficas).toBeInTheDocument()

    await desde({ tipo: 'sesion-vencida' }) // del iframe anterior: ya no se escucha
    expect(screen.queryByRole('button', { name: 'Entrar' })).not.toBeInTheDocument()
    await act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { tipo: 'sesion-vencida' }, origin: location.origin, source: (graficas as HTMLIFrameElement).contentWindow,
      }))
    })
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('en escritorio: Archivos en el menu y precarga de lo que va del año', async () => {
    const precarga = vi.fn(() => Response.json({
      summary: { total_registros: 500, estaciones: 13 }, data_preview: [], mir: null, fallas: [],
      precarga: { anio: 2026, desde: '2026-01-01', hasta: '2026-10-10', completando: false, motivo: 'sin_sesion' },
    }))
    api({
      '/api/analisis/historico/estado': () => Response.json({ disponible: true }),
      '/api/analisis/historico/precarga': precarga,
    })
    guardarSesion(sesion())
    render(<Shell />)
    expect(await screen.findByRole('button', { name: 'Archivos' })).toBeInTheDocument()
    await waitFor(async () => expect((await leerConjunto())?.origen).toBe('Base local · lo que va de 2026'))
    expect(precarga).toHaveBeenCalledTimes(1)
  })

  it('en la web no hay Archivos ni precarga', async () => {
    const fetch = api()
    guardarSesion(sesion())
    render(<Shell />)
    await screen.findByRole('button', { name: 'Gráficas' })
    expect(screen.queryByRole('button', { name: /Archivos/ })).not.toBeInTheDocument()
    expect(fetch.mock.calls.some(([r]) => String(r).includes('precarga'))).toBe(false)
  })

  it('la API caida se dice', async () => {
    api({ '/api/modulos': () => { throw new TypeError('Failed to fetch') } })
    guardarSesion(sesion())
    render(<Shell />)
    expect(await screen.findByText('No hay conexión con el servidor')).toBeInTheDocument()
  })
})
