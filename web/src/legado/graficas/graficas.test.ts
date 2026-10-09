import { describe, expect, it } from 'vitest'
import {
  agregadoZona, marcaDeTiempo, nowcast, numero, parametroInicial, porHora, promedioMovil,
  promedioPorHoraDelDia, rejillaHoraria, serieEnRejilla, type Registro,
} from './series'
import {
  CATEGORIAS, derivarDia, diaSemana, masFrecuente, nombreMes, tramosCirculares, textoTramo,
} from './nom172'
import {
  getAxisLabel, getUnitsAndName, isMeteorologico, umbralesEscala, umbralesIndice,
  CONTAMINANTES, METEOROLOGICOS,
} from '../constants'
import type { DiaIas, Evaluacion } from '../services/ias'

const fila = (STATION: string, DATE: string, HOUR: number, extra: Record<string, number | string | null> = {}): Registro =>
  ({ STATION, DATE, HOUR, ...extra })

describe('series', () => {
  it('marca de tiempo: fecha sin hora y HOUR con dos digitos', () => {
    expect(marcaDeTiempo(fila('CEN', '2026-01-01', 5))).toBe('2026-01-01T05:00:00')
    // Si DATE viniera con hora (Excel), se toma solo la fecha.
    expect(marcaDeTiempo(fila('CEN', '2026-01-01 01:00:00', 1))).toBe('2026-01-01T01:00:00')
  })

  it('numero: solo numeros de verdad', () => {
    expect(numero(3)).toBe(3)
    expect([numero('IO'), numero(''), numero(null), numero(NaN), numero(undefined)]).toEqual([null, null, null, null, null])
  })

  it('parametroInicial: O3 si viene; si no, el primero con dato', () => {
    const red = [fila('CEN', '2026-01-01', 0, { O3: 0.03, ET: 20 })]
    const aw = [fila('Santa Fe', '2026-01-01', 0, { O3: '', IT: 22, ET: 20 })]
    expect(parametroInicial(red, ['O3', 'ET'])).toBe('O3')
    expect(parametroInicial(aw, [...CONTAMINANTES, ...METEOROLOGICOS])).toBe('IT')
    expect(parametroInicial([], ['O3'])).toBe('O3')
  })

  it('rejilla horaria continua: los huecos quedan como hora sin dato', () => {
    const datos = [fila('A', '2026-01-01', 22), fila('A', '2026-01-02', 1), fila('B', 'basura', 3)]
    const rejilla = rejillaHoraria(datos)
    expect(rejilla).toEqual([
      '2026-01-01T22:00:00', '2026-01-01T23:00:00', '2026-01-02T00:00:00', '2026-01-02T01:00:00',
    ])
    expect(serieEnRejilla(datos.slice(0, 2).map((f, i) => ({ ...f, O3: i + 1 })), rejilla, 'O3')).toEqual([1, null, null, 2])
    expect(rejillaHoraria([])).toEqual([])
  })

  it('porHora se arma una vez por arreglo', () => {
    const filas = [fila('A', '2026-01-01', 0)]
    expect(porHora(filas)).toBe(porHora(filas))
  })

  it('agregado de zona: promedio y maximo de las estaciones con dato', () => {
    const rejilla = ['2026-01-01T00:00:00', '2026-01-01T01:00:00']
    const por = {
      A: [fila('A', '2026-01-01', 0, { O3: 0.02 }), fila('A', '2026-01-01', 1, { O3: 'IO' })],
      B: [fila('B', '2026-01-01', 0, { O3: 0.04 })],
    }
    expect(agregadoZona(por, ['A', 'B', 'C'], rejilla, 'O3', 'promedio')[0]).toBeCloseTo(0.03)
    expect(agregadoZona(por, ['A', 'B'], rejilla, 'O3', 'maximo')).toEqual([0.04, null])
  })

  it('promedio movil exige suficiencia (75 %)', () => {
    expect(promedioMovil([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5])
    // Ventana de 4: hacen falta 3 datos.
    expect(promedioMovil([4, null, null, 8, 8, 8], 4)).toEqual([null, null, null, null, null, 8])
  })

  it('NowCast: necesita 2 de las 3 horas recientes y pesa hacia la ultima', () => {
    expect(nowcast([10, null, null])[2]).toBeNull()
    const constante = nowcast(Array(12).fill(20))
    expect(constante[11]).toBeCloseTo(20)
    // Subida brusca: el NowCast queda entre el promedio y el ultimo valor.
    const subida = nowcast([...Array(11).fill(10), 100])
    expect(subida[11]!).toBeGreaterThan(10 * 1.1)
    expect(subida[11]!).toBeLessThan(100)
    expect(nowcast([0, 0, 0])[2]).toBe(0)
  })

  it('promedio por hora del dia', () => {
    const rejilla = ['2026-01-01T05:00:00', '2026-01-02T05:00:00', '2026-01-02T06:00:00']
    const { promedios, cuentas } = promedioPorHoraDelDia(rejilla, [2, 4, null])
    expect(promedios[5]).toBe(3)
    expect(promedios[6]).toBeNull()
    expect(cuentas[5]).toBe(2)
  })
})

describe('NOM-172', () => {
  const ev = (cat: number | null): Evaluacion => ({ cat, pol: 'O3', valores: {} as Evaluacion['valores'] })

  it('derivarDia cuenta las horas peores que la diaria', () => {
    const dia: DiaIas = {
      fecha: '2026-09-29',
      horas: [ev(0), ev(1), ev(2), null, ...Array(20).fill(ev(0))],
      diaria: { ...ev(0), nom: 'Si' },
    }
    const d = derivarDia(dia)
    expect(d.peorHora).toBe(2)
    expect(d.horasPeores).toBe(2)
    expect(derivarDia({ ...dia, diaria: null }).horasPeores).toBe(0)
    expect(derivarDia({ ...dia, horas: Array(24).fill(null) }).peorHora).toBeNull()
  })

  it('cinco categorias con su color', () => {
    expect(CATEGORIAS.map((c) => c.nombre)).toEqual(['Buena', 'Aceptable', 'Mala', 'Muy Mala', 'Extremadamente Mala'])
  })

  it('fechas y moda', () => {
    expect(nombreMes('2026-09')).toBe('septiembre 2026')
    expect(diaSemana('2026-10-08')).toBe('jue')
    expect(masFrecuente(['O3', 'PM10', 'O3'])).toBe('O3')
    expect(masFrecuente([])).toBeNull()
  })

  it('tramos circulares de horas que cumplen', () => {
    const todas = Array(24).fill(true)
    expect(tramosCirculares(todas)[0]).toHaveLength(24)
    const cumple = Array(24).fill(false)
    for (const h of [22, 23, 0, 1, 10]) cumple[h] = true
    const tramos = tramosCirculares(cumple)
    expect(tramos[0]).toEqual([22, 23, 0, 1]) // cruza la medianoche y va primero por ser el mas largo
    expect(tramos[1]).toEqual([10])
    expect(textoTramo([22, 23, 0, 1])).toBe('22:00–01:59')
  })
})

describe('constantes', () => {
  it('unidades y etiquetas', () => {
    expect(getUnitsAndName('O3').unit).toBe('ppm')
    expect(getUnitsAndName('XYZ')).toEqual({ unit: '', name: 'XYZ' })
    expect(getAxisLabel([])).toBe('Valor')
    expect(getAxisLabel(['ET'])).toBe('Temperatura Externa (ET) [°C]')
    expect(isMeteorologico('WS')).toBe(true)
    expect(isMeteorologico('O3')).toBe(false)
  })

  it('umbrales vigentes (NOM-172 2026) e IMECA', () => {
    expect(umbralesIndice('PM2.5')).toEqual([15, 25, 79, 130])
    expect(umbralesIndice('ET')).toBeUndefined()
    expect(umbralesEscala('O3', 'imeca')).toEqual([0.070, 0.095, 0.154, 0.204])
    expect(umbralesEscala('O3', 'aire-salud')).toEqual(umbralesIndice('O3'))
  })
})

describe('bloquesMesHora', () => {
  it('un bloque por mes; dentro, hora por hora y en cada hora los dias en orden', async () => {
    const { bloquesMesHora } = await import('./series')
    const rejilla = ['2026-01-02T08:00:00', '2026-01-01T08:00:00', '2026-01-01T09:00:00', '2026-02-01T00:00:00', '2026-02-03T00:00:00']
    const b = bloquesMesHora(rejilla, [2, 1, 5, 7, null])
    expect(b.y).toEqual([1, 2, 5, 7])
    expect(b.x[0]).toBe(8)
    expect(b.x[1]).toBeCloseTo(8 + 0.9 / 31)
    expect(b.x[2]).toBe(9)
    expect(b.x[3]).toBe(24)
    expect(b.meses).toEqual([{ etiqueta: 'ene 2026', inicio: 0 }, { etiqueta: 'feb 2026', inicio: 24 }])
    expect(b.fechas[0]).toBe('2026-01-01 08:00')
  })
})
