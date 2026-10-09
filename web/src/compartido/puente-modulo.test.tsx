import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { conectarConShell } from './puente'
import { MenuContexto, clasesIcono, useMenu } from '../legado/components/menu'
import type { Sesion } from './tipos'

// Dentro del iframe, window.parent es el shell. Se simula con un padre falso.
function dentroDeUnIframe() {
  const padre = { postMessage: vi.fn() } as unknown as Window
  const original = Object.getOwnPropertyDescriptor(window, 'parent')!
  Object.defineProperty(window, 'parent', { value: padre, configurable: true })
  return { padre, restaurar: () => Object.defineProperty(window, 'parent', original) }
}

describe('puente: lado modulo', () => {
  let restaurar = () => {}
  afterEach(() => restaurar())

  it('avisa que esta listo y recibe sesion, tema y datos solo del shell', () => {
    const r = dentroDeUnIframe()
    restaurar = r.restaurar
    const alSesion = vi.fn()
    const alDatos = vi.fn()
    const conexion = conectarConShell(alSesion, alDatos)!
    expect(r.padre.postMessage).toHaveBeenCalledWith({ tipo: 'listo' }, location.origin)

    const sesion = { token: 't' } as Sesion
    const llega = (data: unknown, source: unknown = r.padre, origin = location.origin) =>
      window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as Window }))

    llega({ tipo: 'sesion', sesion, tema: 'oscuro' })
    expect(alSesion).toHaveBeenCalledWith(sesion)
    expect(document.documentElement.dataset.tema).toBe('oscuro')
    llega({ tipo: 'tema', tema: 'claro' })
    expect(document.documentElement.dataset.tema).toBe('claro')
    llega({ tipo: 'datos', datos: null })
    expect(alDatos).toHaveBeenCalledWith(null)

    // De otro origen o de otra ventana: se ignora.
    llega({ tipo: 'sesion', sesion: { token: 'falso' }, tema: 'claro' }, r.padre, 'https://otro.mx')
    llega({ tipo: 'sesion', sesion: { token: 'falso' }, tema: 'claro' }, window)
    expect(alSesion).toHaveBeenCalledTimes(1)

    conexion.avisarVencida()
    conexion.guardarDatos(null)
    conexion.ir('graficas')
    expect(r.padre.postMessage).toHaveBeenCalledWith({ tipo: 'sesion-vencida' }, location.origin)
    expect(r.padre.postMessage).toHaveBeenCalledWith({ tipo: 'guardar-datos', datos: null }, location.origin)
    expect(r.padre.postMessage).toHaveBeenCalledWith({ tipo: 'ir', modulo: 'graficas' }, location.origin)
  })
})

describe('entrada del shell', () => {
  it('monta el shell en #raiz (sin sesion: el login)', async () => {
    document.body.innerHTML = '<div id="raiz"></div>'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ modulos: [] })))
    await act(async () => { await import('../shell/main') })
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})

describe('menu de legado', () => {
  it('desplegado por omision; el contexto lo cambia', () => {
    expect(renderHook(() => useMenu()).result.current.plegado).toBe(false)
    const desplegar = vi.fn()
    const { result } = renderHook(() => useMenu(), {
      wrapper: ({ children }) => <MenuContexto.Provider value={{ plegado: true, desplegar }}>{children}</MenuContexto.Provider>,
    })
    expect(result.current.plegado).toBe(true)
    result.current.desplegar()
    expect(desplegar).toHaveBeenCalled()
    renderHook(() => useMenu()).result.current.desplegar() // el de omision no hace nada
  })

  it('clases del icono activo e inactivo', () => {
    expect(clasesIcono(true)).toContain('bg-primary-50')
    expect(clasesIcono()).toContain('text-slate-500')
    render(<span className={clasesIcono()}>x</span>)
  })
})
