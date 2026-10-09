import { describe, expect, it, vi } from 'vitest'
import type { Cliente } from '../../compartido/api'
import { aFilasHorarias, cargarAmbientWeather, EQUIVALENCIAS } from './ambientweather'

describe('aFilasHorarias', () => {
  it('agrupa por hora de Guadalajara y convierte a unidades de la red', () => {
    const filas = aFilasHorarias('Santa Fe', [
      // 18:05 y 18:35 UTC = 12 h de Guadalajara
      { fecha: '2026-10-01T18:05:00.000Z', valores: { tempf: 68, windspeedmph: 10, baromrelin: 30, pm25: 10 } },
      { fecha: '2026-10-01T18:35:00.000Z', valores: { tempf: 86, windspeedmph: 0, baromrelin: 30, pm25: 20 } },
      { fecha: '2026-10-01T19:00:00.000Z', valores: { tempf: 32 } },
    ])
    expect(filas).toHaveLength(2)
    expect(filas[0]).toMatchObject({ STATION: 'Santa Fe', DATE: '2026-10-01', HOUR: 12, ET: 25, 'PM2.5': 15, ATM: 762 })
    expect(filas[0].WS).toBeCloseTo(2.235, 3)
    expect(filas[1]).toMatchObject({ HOUR: 13, ET: 0 })
    expect(filas[1]['PM2.5']).toBeUndefined() // sin lectura no se inventa la columna
  })

  it('promedia la direccion del viento como vector', () => {
    const [f] = aFilasHorarias('X', [
      { fecha: '2026-10-01T18:00:00.000Z', valores: { winddir: 350 } },
      { fecha: '2026-10-01T18:10:00.000Z', valores: { winddir: 10 } },
    ])
    expect(Math.min(f.WD as number, 360 - (f.WD as number))).toBeCloseTo(0, 6)
  })

  it('la medianoche local cae en el dia local', () => {
    const [f] = aFilasHorarias('X', [{ fecha: '2026-10-02T05:30:00.000Z', valores: { humidity: 50 } }])
    expect(f).toMatchObject({ DATE: '2026-10-01', HOUR: 23, RH: 50 })
  })

  it('el indice UV de Ambient Weather no se mezcla con el UVI de la red (mW/m²)', () => {
    const [f] = aFilasHorarias('X', [{ fecha: '2026-10-01T18:00:00.000Z', valores: { uv: 7, solarradiation: 800 } }])
    expect(f.UVI).toBeUndefined()
    expect(f.RS).toBe(800)
    expect(EQUIVALENCIAS.map((e) => e.aw)).not.toContain('uv')
  })
})

describe('cargarAmbientWeather', () => {
  it('pide cada estacion con lecturas, del inicio del dia al fin del ultimo, en cubetas de 1 h como mucho', async () => {
    const get = vi.fn(async (ruta: string) => ruta.endsWith('/dispositivos')
      ? { dispositivos: [
        { mac: 'AA:BB:CC:DD:EE:FF', nombre: 'SantaFe-AMBWeather-Pro', lecturas: 3 },
        { mac: '11:22:33:44:55:66', nombre: 'Vacia', lecturas: 0 },
      ] }
      : { lecturas: [{ fecha: '2026-10-01T18:05:00.000Z', valores: { tempf: 68 } }] })
    const filas = await cargarAmbientWeather({ get } as unknown as Cliente, '2026-10-01', '2026-10-02')

    expect(filas).toEqual([expect.objectContaining({ STATION: 'SantaFe', DATE: '2026-10-01', HOUR: 12, ET: 20 })])
    const series = get.mock.calls.map(([r]) => r).filter((r) => r.includes('/serie'))
    expect(series).toHaveLength(1)
    const q = new URLSearchParams(series[0].split('?')[1])
    expect(q.get('mac')).toBe('AA:BB:CC:DD:EE:FF')
    expect(q.get('desde')).toBe('2026-10-01T06:00:00.000Z') // 00:00 de Guadalajara
    expect(q.get('hasta')).toBe('2026-10-03T06:00:00.000Z') // fin del dia 2, incluido
    expect(q.get('puntos')).toBe('48')
  })
})
