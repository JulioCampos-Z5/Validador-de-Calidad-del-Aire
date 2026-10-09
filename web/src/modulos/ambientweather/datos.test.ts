import { describe, expect, it } from 'vitest'
import {
  COLUMNAS_TABLA, GRAFICABLES, aCsv, cardinal, convertir, frescura, horaLocal, metrica, mostrar, nombreCorto,
} from './datos'

describe('columnas de la tabla', () => {
  it('son las 29 de la app de escritorio y todas tienen metrica', () => {
    expect(COLUMNAS_TABLA).toHaveLength(29)
    expect(new Set(COLUMNAS_TABLA.map((c) => c.clave)).size).toBe(29)
    for (const c of COLUMNAS_TABLA) expect(metrica(c.clave), c.clave).toBeDefined()
  })

  it('la bateria se lee OK/Baja y no se grafica', () => {
    expect(mostrar('battout', { battout: 1 })).toBe('OK')
    expect(mostrar('battout', { battout: 0 })).toBe('Baja')
    expect(GRAFICABLES.some((m) => m.clave === 'battout')).toBe(false)
  })
})

describe('conversion a unidades metricas', () => {
  it('temperatura, viento, lluvia y presion', () => {
    expect(convertir(metrica('tempf')!, 212)).toBeCloseTo(100)
    expect(convertir(metrica('windspeedmph')!, 10)).toBeCloseTo(16.09, 2)
    expect(convertir(metrica('dailyrainin')!, 1)).toBeCloseTo(25.4)
    expect(convertir(metrica('baromrelin')!, 29.92)).toBeCloseTo(1013.2, 1)
  })

  it('lo que no tiene conversion se deja igual', () => {
    expect(convertir(metrica('humidity')!, 54)).toBe(54)
    expect(convertir(metrica('pm25')!, 12.3)).toBe(12.3)
  })

  it('mostrar redondea, pone unidad y distingue lo que no llego', () => {
    expect(mostrar('tempf', { tempf: 77 })).toBe('25.0 °C')
    expect(mostrar('humidity', { humidity: 54 })).toBe('54%')
    expect(mostrar('tempf', {})).toBe('—')
  })
})

describe('direccion del viento', () => {
  it('rosa de 16 puntos con O de oeste', () => {
    expect(cardinal(0)).toBe('N')
    expect(cardinal(359)).toBe('N')
    expect(cardinal(90)).toBe('E')
    expect(cardinal(225)).toBe('SO')
    expect(cardinal(270)).toBe('O')
    expect(cardinal(-90)).toBe('O')
  })
})

describe('nombre de estacion', () => {
  it('quita el modelo que se repite en todas', () => {
    expect(nombreCorto({ nombre: 'SantaFe-AMBWeather-Pro', mac: 'x' })).toBe('SantaFe')
    expect(nombreCorto({ nombre: 'COUNTRY_AMBWeather-Pro', mac: 'x' })).toBe('COUNTRY')
    expect(nombreCorto({ nombre: 'Azotea', mac: 'x' })).toBe('Azotea')
    expect(nombreCorto({ nombre: '', mac: 'AA:BB' })).toBe('AA:BB')
  })
})

describe('frescura de la ultima lectura', () => {
  const ahora = Date.parse('2026-10-06T12:00:00Z')
  it('por minutos sin datos', () => {
    expect(frescura('2026-10-06T11:55:00Z', ahora)).toBe('ok')
    expect(frescura('2026-10-06T11:30:00Z', ahora)).toBe('wa')
    expect(frescura('2026-09-24T19:00:00Z', ahora)).toBe('er')
    expect(frescura(null, ahora)).toBe('no')
  })
})

describe('hora de Guadalajara', () => {
  it('UTC-6 sin horario de verano', () => {
    expect(horaLocal('2026-09-24T19:00:00Z')).toBe('2026-09-24 13:00')
  })
})

describe('CSV', () => {
  it('convierte, respeta huecos y escapa', () => {
    const csv = aCsv([{ fecha: '2026-09-24T19:00:00Z', valores: { tempf: 32 } }], ['tempf', 'humidity'])
    expect(csv.split('\n')).toEqual([
      'fecha (Guadalajara),Temperatura (°C),Humedad (%)',
      '2026-09-24 13:00,0,',
    ])
  })
})
