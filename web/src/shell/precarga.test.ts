import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cliente } from '../compartido/api'
import { aConjunto, descripcionPrecarga, precargar } from './precarga'
import { esEscritorio } from '../compartido/escritorio'
import { visiblesPara } from '../compartido/modulos'

const info = (completando = false) => ({ anio: 2026, desde: '2026-01-01', hasta: '2026-10-10', completando, motivo: null })
const respuesta = (completando = false, total = 100) => ({
  summary: { total_registros: total, estaciones: 13 }, data_preview: [], mir: { estaciones: [] }, fallas: [],
  precarga: info(completando),
})

describe('aConjunto', () => {
  it('arma el conjunto compartido de la base local', () => {
    const c = aConjunto(respuesta() as never)!
    expect(c.origen).toBe('Base local · lo que va de 2026')
    expect(c.respuesta).not.toHaveProperty('precarga')
    expect(c.compartido).toMatchObject({ origen: 'historico', descripcion: c.origen, contaminantesMir: expect.any(Array) })
    expect(aConjunto({ vacio: true, precarga: info() } as never)).toBeNull()
    expect(descripcionPrecarga(2026, true)).toMatch(/completando con la API de Emisiones/)
  })
})

describe('precargar', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function cliente(posts: unknown[], avances: unknown[]) {
    const post = vi.fn(async () => posts.shift())
    const get = vi.fn(async () => avances.shift())
    return { api: { post, get } as unknown as Cliente, post, get }
  }

  it('entrega lo que va del año y, al terminar de completar, la version nueva', async () => {
    const { api, post, get } = cliente([respuesta(true), respuesta(false, 150)], [{ activo: true }, { activo: false }])
    const entregados: number[] = []
    precargar(api, (c) => entregados.push(c.respuesta.summary.total_registros), () => true)
    await vi.advanceTimersByTimeAsync(0)
    expect(entregados).toEqual([100])
    expect(post).toHaveBeenLastCalledWith('/api/analisis/historico/precarga', expect.objectContaining({ completar: true }))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(entregados).toEqual([100]) // sigue descargando
    await vi.advanceTimersByTimeAsync(5_000)
    expect(get).toHaveBeenCalledTimes(2)
    expect(post).toHaveBeenLastCalledWith('/api/analisis/historico/precarga', expect.objectContaining({ completar: false }))
    expect(entregados).toEqual([100, 150])
  })

  it('no pisa lo que la persona ya cargo', async () => {
    const { api } = cliente([respuesta(true), respuesta(false, 150)], [{ activo: false }])
    let vigente = true
    const entregar = vi.fn()
    precargar(api, entregar, () => vigente)
    await vi.advanceTimersByTimeAsync(0)
    vigente = false
    await vi.advanceTimersByTimeAsync(5_000)
    expect(entregar).toHaveBeenCalledTimes(1)
  })

  it('parar corta el seguimiento; sin base o sin red no entrega nada', async () => {
    const { api, get } = cliente([respuesta(true)], [{ activo: true }])
    const parar = precargar(api, vi.fn(), () => true)
    await vi.advanceTimersByTimeAsync(0)
    parar()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(get).not.toHaveBeenCalled()

    const vacia = cliente([{ vacio: true, precarga: info() }], [])
    const entregar = vi.fn()
    precargar(vacia.api, entregar, () => true)
    await vi.advanceTimersByTimeAsync(0)
    expect(entregar).not.toHaveBeenCalled()

    const caida = { post: vi.fn().mockRejectedValue(new Error('x')), get: vi.fn() } as unknown as Cliente
    precargar(caida, entregar, () => true)
    await vi.advanceTimersByTimeAsync(0)
    expect(entregar).not.toHaveBeenCalled()
  })
})

describe('escritorio', () => {
  it('se reconoce por la base local del motor', async () => {
    const si = { get: vi.fn().mockResolvedValue({ disponible: true }) } as unknown as Cliente
    const no = { get: vi.fn().mockResolvedValue({ disponible: false }) } as unknown as Cliente
    const caido = { get: vi.fn().mockRejectedValue(new Error('x')) } as unknown as Cliente
    expect(await esEscritorio(si)).toBe(true)
    expect(await esEscritorio(no)).toBe(false)
    expect(await esEscritorio(caido, { intentos: 2, esperaMs: 1 })).toBe(false)
    expect(caido.get).toHaveBeenCalledTimes(2)
  })

  it('reintenta mientras el motor arranca', async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error('502')).mockResolvedValueOnce({ disponible: true })
    expect(await esEscritorio({ get } as unknown as Cliente, { esperaMs: 1 })).toBe(true)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('Archivos solo aparece en escritorio', () => {
    expect(visiblesPara('user').map((m) => m.id)).not.toContain('archivos')
    expect(visiblesPara('user', true).map((m) => m.id)).toContain('archivos')
  })
})
