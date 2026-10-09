import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorApi, cliente, login, modulos } from './api'
import { aplicarTema, conectarConShell, enviar, escucharModulo } from './puente'
import { desde, duracion, fechaHora, hace, hora } from './tiempo'
import { esAdmin, puedeEditarInventario } from './modulo'
import type { Usuario } from './tipos'

const respuesta = (estado: number, cuerpo?: unknown, texto?: string) =>
  new Response(texto ?? (cuerpo === undefined ? null : JSON.stringify(cuerpo)), { status: estado })

describe('tiempo', () => {
  it('muestra la hora de Guadalajara, no la de la computadora', () => {
    // 18:05 UTC = 12:05 en Guadalajara (UTC-6, sin horario de verano)
    expect(hora('2026-10-01T18:05:00Z')).toBe('12:05')
    expect(fechaHora('2026-10-02T05:30:00Z')).toMatch(/1 oct.*23:30/)
  })

  it('duracion en palabras', () => {
    expect(duracion(-5)).toBe('menos de 1 min')
    expect(duracion(30_000)).toBe('menos de 1 min')
    expect(duracion(45 * 60_000)).toBe('45 min')
    expect(duracion(6 * 3_600_000)).toBe('6 h')
    expect(duracion(6 * 3_600_000 + 32 * 60_000)).toBe('6 h 32 min')
    expect(duracion(48 * 3_600_000)).toBe('2 d')
    expect(duracion(51 * 3_600_000)).toBe('2 d 3 h')
  })

  it('desde y hace', () => {
    const ahora = Date.parse('2026-10-01T12:00:00Z')
    expect(desde('2026-10-01T11:15:00Z', ahora)).toBe('45 min')
    expect(hace(4_000)).toBe('hace 4 s')
    expect(hace(-1)).toBe('hace 0 s')
    expect(hace(3 * 60_000)).toBe('hace 3 min')
  })
})

describe('api', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('login manda las credenciales en el cuerpo, nunca en la URL', async () => {
    const fetch = vi.fn().mockResolvedValue(respuesta(200, { token: 't' }))
    vi.stubGlobal('fetch', fetch)
    await expect(login('a@b.mx', 'secreta', true)).resolves.toEqual({ token: 't' })
    const [ruta, init] = fetch.mock.calls[0]
    expect(ruta).toBe('/api/auth/login')
    expect(ruta).not.toContain('secreta')
    expect(JSON.parse(init.body)).toEqual({ correo: 'a@b.mx', contrasena: 'secreta', recordar: true })
  })

  it('un error de la API trae su mensaje y su estado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(401, { error: 'Correo o contraseña incorrectos' })))
    const e = await login('a', 'b').catch((x) => x)
    expect(e).toBeInstanceOf(ErrorApi)
    expect(e.message).toBe('Correo o contraseña incorrectos')
    expect(e.estado).toBe(401)
  })

  it('una respuesta que no es JSON o sin red se explica', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(502, undefined, '<html>Bad gateway</html>')))
    await expect(modulos()).rejects.toThrow('La API respondió 502')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const e = await modulos().catch((x) => x)
    expect(e.message).toBe('No hay conexión con el servidor')
    expect(e.estado).toBe(0)
  })

  it('el cliente lleva el token y avisa si la sesion vencio', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(respuesta(200, { ok: 1 }))
      .mockResolvedValueOnce(respuesta(204))
      .mockResolvedValueOnce(respuesta(401, { error: 'token invalido o vencido' }))
    vi.stubGlobal('fetch', fetch)
    const alVencer = vi.fn()
    const api = cliente('tok', alVencer)

    await expect(api.get('/api/x')).resolves.toEqual({ ok: 1 })
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')

    await expect(api.post('/api/y', { a: 1 })).resolves.toBeUndefined()
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: '{"a":1}' })

    await expect(api.patch('/api/z', {})).rejects.toBeInstanceOf(ErrorApi)
    expect(alVencer).toHaveBeenCalledOnce()
  })

  it('subir y descargar llevan la sesion', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(respuesta(200, { id: 1 }))
      .mockResolvedValueOnce(new Response('datos'))
    vi.stubGlobal('fetch', fetch)
    const api = cliente('tok', vi.fn())
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await api.subir('/api/archivo', 'archivo', new File(['x'], 'a.csv'))
    const init = fetch.mock.calls[0][1]
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' }) // sin Content-Type: lo pone el navegador

    await api.descargar('/api/archivo.xlsx', 'reporte.xlsx')
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer tok')
    expect(click).toHaveBeenCalled()
  })

  it('una descarga fallida avisa la sesion vencida y lanza el error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(401, { error: 'vencida' })))
    const alVencer = vi.fn()
    await expect(cliente('t', alVencer).descargar('/api/a', 'a')).rejects.toThrow('vencida')
    expect(alVencer).toHaveBeenCalled()
  })
})

describe('puente shell <-> modulo', () => {
  it('fuera del shell no hay conexion', () => {
    // En las pruebas la pagina no esta dentro de un iframe.
    expect(conectarConShell(vi.fn(), vi.fn())).toBeNull()
  })

  it('el shell solo escucha a su iframe y del mismo origen', () => {
    const marco = document.createElement('iframe')
    document.body.append(marco)
    const recibido = vi.fn()
    const dejar = escucharModulo(() => marco, recibido)

    window.dispatchEvent(new MessageEvent('message', { data: { tipo: 'listo' }, origin: location.origin, source: marco.contentWindow }))
    window.dispatchEvent(new MessageEvent('message', { data: { tipo: 'listo' }, origin: 'https://otro.mx', source: marco.contentWindow }))
    window.dispatchEvent(new MessageEvent('message', { data: { tipo: 'listo' }, origin: location.origin, source: window }))
    expect(recibido).toHaveBeenCalledTimes(1)

    dejar()
    window.dispatchEvent(new MessageEvent('message', { data: { tipo: 'listo' }, origin: location.origin, source: marco.contentWindow }))
    expect(recibido).toHaveBeenCalledTimes(1)
    marco.remove()
  })

  it('enviar va al mismo origen; aplicarTema marca el documento', () => {
    const destino = { postMessage: vi.fn() } as unknown as Window
    enviar(destino, { tipo: 'ir', modulo: 'graficas' })
    expect(destino.postMessage).toHaveBeenCalledWith({ tipo: 'ir', modulo: 'graficas' }, location.origin)
    aplicarTema('oscuro')
    expect(document.documentElement.dataset.tema).toBe('oscuro')
  })
})

describe('permisos', () => {
  const u = (rol: Usuario['rol']): Usuario => ({ id: 1, nombre: 'X', correo: 'x@y.mx', rol, estatus: 'activo' })
  it('inventario: todos menos user; admin: root y admin', () => {
    expect(['root', 'admin', 'tecnico', 'user'].map((r) => puedeEditarInventario(u(r as Usuario['rol'])))).toEqual([true, true, true, false])
    expect(['root', 'admin', 'tecnico', 'user'].map((r) => esAdmin(u(r as Usuario['rol'])))).toEqual([true, true, false, false])
  })
})
