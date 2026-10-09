import { afterEach, describe, expect, it, vi } from 'vitest'
import { borrarConjunto, guardarConjunto, leerConjunto } from './almacen'
import { MODULOS, disponible } from './modulos'
import {
  guardarRecordar, guardarSesion, guardarTema, leerRecordar, leerSesion, leerTema,
} from './preferencias'
import type { Conjunto, Sesion } from '../compartido/tipos'

const sesion = (expira: number): Sesion => ({
  token: 't', expira: new Date(expira).toISOString(),
  usuario: { id: 1, nombre: 'Julio', correo: 'j@x.mx', rol: 'root', estatus: 'activo' },
})

describe('preferencias', () => {
  afterEach(() => sessionStorage.clear())

  it('sin recordar la sesion va en sessionStorage; recordando, en localStorage', () => {
    const s = sesion(Date.now() + 3_600_000)
    guardarSesion(s)
    expect(sessionStorage.getItem('validador.sesion')).not.toBeNull()
    expect(localStorage.getItem('validador.sesion')).toBeNull()
    expect(leerSesion()).toEqual(s)

    guardarSesion(s, true)
    expect(sessionStorage.getItem('validador.sesion')).toBeNull()
    expect(localStorage.getItem('validador.sesion')).not.toBeNull()
    expect(leerSesion()).toEqual(s)

    guardarSesion(null)
    expect(leerSesion()).toBeNull()
    expect(localStorage.getItem('validador.sesion')).toBeNull()
  })

  it('una sesion vencida se descarta y se borra', () => {
    guardarSesion(sesion(Date.now() - 1000), true)
    expect(leerSesion()).toBeNull()
    expect(localStorage.getItem('validador.sesion')).toBeNull()
  })

  it('sin almacenamiento no truena', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    expect(leerSesion()).toBeNull()
    expect(() => guardarSesion(sesion(Date.now() + 1000))).not.toThrow()
    expect(leerRecordar()).toBe(false)
    expect(() => guardarRecordar(true)).not.toThrow()
    expect(() => guardarTema('oscuro')).not.toThrow()
    expect(leerTema()).toBe('claro')
  })

  it('recordar y tema', () => {
    expect(leerRecordar()).toBe(false)
    guardarRecordar(true)
    expect(leerRecordar()).toBe(true)
    guardarRecordar(false)
    expect(leerRecordar()).toBe(false)

    expect(leerTema()).toBe('claro') // sigue al sistema (claro en las pruebas)
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    expect(leerTema()).toBe('oscuro')
    guardarTema('claro')
    expect(leerTema()).toBe('claro') // lo elegido manda sobre el sistema
  })
})

describe('almacen del conjunto (IndexedDB)', () => {
  it('guarda, lee y borra', async () => {
    expect(await leerConjunto()).toBeNull()
    const c = { origen: 'BD_2026.xlsx', cargado: '2026-10-08', respuesta: { summary: {} } } as unknown as Conjunto
    await guardarConjunto(c)
    expect(await leerConjunto()).toEqual(c)
    await borrarConjunto()
    expect(await leerConjunto()).toBeNull()
  })

  it('sin IndexedDB devuelve null en vez de fallar', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('bloqueado') })
    expect(await leerConjunto()).toBeNull()
  })
})

describe('catalogo de modulos', () => {
  it('disponible si tiene pagina y su modulo de la API esta activo', () => {
    const porId = Object.fromEntries(MODULOS.map((m) => [m.id, m]))
    expect(disponible(porId.tablero, new Set())).toBe(true) // no depende de la API
    expect(disponible(porId.graficas, new Set())).toBe(false)
    expect(disponible(porId.graficas, new Set(['validacion']))).toBe(true)
    expect(disponible({ ...porId.graficas, pagina: null }, new Set(['validacion']))).toBe(false)
  })

  it('cada modulo tiene id unico y su pagina en /m/<id>/', () => {
    const ids = MODULOS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of MODULOS) expect(m.pagina).toBe(`/m/${m.id}/`)
    expect(MODULOS.find((m) => m.id === 'admin')?.roles).toEqual(['root', 'admin'])
    expect(MODULOS.find((m) => m.id === 'registros')?.nombre).toMatch(/MIDE/)
  })
})
