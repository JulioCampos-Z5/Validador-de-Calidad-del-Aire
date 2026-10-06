import { describe, expect, it } from 'vitest'
import type { EstadoEstacion } from '../../compartido/tipos'
import { resumen, tarjeta, tarjetas } from './estado'

const ahora = Date.parse('2026-10-05T18:00:00Z')
const haceHoras = (h: number) => new Date(ahora - h * 3600_000).toISOString()

const estacion = (p: Partial<EstadoEstacion>): EstadoEstacion => ({
  id: 1, nombre: 'Pintas', ultimoLatido: haceHoras(0.01), sinComunicacion: false, puertos: [], ...p,
})

describe('tarjeta', () => {
  it('todo con datos: verde, sin falla', () => {
    const t = tarjeta(estacion({
      puertos: [{ clave: 'tcp:502', estado: 'arriba' }, { clave: 'tcp:503', estado: 'arriba' }],
    }), ahora)
    expect(t.color).toBe('ok')
    expect(t.conFalla).toBe(false)
    expect(t.quien).toBe('2 puertos con datos')
    expect(t.puntos.map((p) => p.color)).toEqual(['ok', 'ok'])
  })

  it('un puerto critico: ambar, nombra al equipo y cuanto lleva', () => {
    const t = tarjeta(estacion({
      puertos: [
        { clave: 'tcp:502', nombre: 'Analizador NOx', estado: 'caido', desde: haceHoras(4.5), nivel: 'critico' },
        { clave: 'tcp:503', estado: 'arriba' },
      ],
    }), ahora)
    expect(t.color).toBe('wa')
    expect(t.quien).toBe('Analizador NOx')
    expect(t.quienEsClave).toBe(false)
    expect(t.detalle).toBe('4 h 30 min')
  })

  it('el peor puerto manda y cuenta a los demas', () => {
    const t = tarjeta(estacion({
      puertos: [
        { clave: 'tcp:502', estado: 'caido', desde: haceHoras(1.5), nivel: 'aviso' },
        { clave: 'com:COM3', estado: 'caido', desde: haceHoras(7), nivel: 'incumple' },
      ],
    }), ahora)
    expect(t.color).toBe('er')
    expect(t.quien).toBe('com:COM3')
    expect(t.quienEsClave).toBe(true)
    expect(t.detalle).toBe('7 h · +1')
  })

  it('sin comunicacion reciente: gris; larga: segun nivel', () => {
    const reciente = tarjeta(estacion({ sinComunicacion: true, nivel: 'reciente', ultimoLatido: haceHoras(0.1),
      puertos: [{ clave: 'tcp:502', estado: 'arriba' }] }), ahora)
    expect(reciente.color).toBe('no')
    expect(reciente.quien).toBe('Sin comunicación')
    expect(reciente.puntos[0]!.color).toBe('no')

    const larga = tarjeta(estacion({ sinComunicacion: true, nivel: 'incumple', ultimoLatido: haceHoras(8) }), ahora)
    expect(larga.color).toBe('er')
  })
})

describe('tarjetas y resumen', () => {
  it('ordena lo grave primero y cuenta por color', () => {
    const ts = tarjetas([
      estacion({ id: 1, nombre: 'Bien', puertos: [{ clave: 'tcp:1', estado: 'arriba' }] }),
      estacion({ id: 2, nombre: 'Aviso', puertos: [{ clave: 'tcp:1', estado: 'caido', desde: haceHoras(2), nivel: 'aviso' }] }),
      estacion({ id: 3, nombre: 'Incumple', puertos: [{ clave: 'tcp:1', estado: 'caido', desde: haceHoras(9), nivel: 'incumple' }] }),
      estacion({ id: 4, nombre: 'Muda', sinComunicacion: true, nivel: 'reciente' }),
    ], ahora)
    expect(ts.map((t) => t.nombre)).toEqual(['Incumple', 'Aviso', 'Muda', 'Bien'])
    expect(resumen(ts)).toEqual({ ok: 1, wa: 1, er: 1, no: 1 })
  })
})
