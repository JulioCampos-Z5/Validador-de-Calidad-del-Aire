// Ambient Weather: tipos de la API, catalogo de metricas y conversion a
// unidades del sistema metrico. La API (y la base) guardan en las unidades
// nativas de Ambient Weather, que son imperiales; aqui se convierten al mostrar.

import { horaLocal, type Lectura } from '../../compartido/ambientweather'

export { horaLocal, nombreCorto, type Dispositivo, type Lectura } from '../../compartido/ambientweather'

export interface Descarga {
  mac: string
  nombre: string
  dias: number
  estado: 'descargando' | 'terminada' | 'error'
  recibidas: number
  nuevas: number
  llegoA: string | null
  error?: string
  inicio: string
  fin: string | null
}

export interface EstadoSondeo {
  llaves: boolean
  intervaloSeg: number
  ultimoSondeo: string | null
  ultimoError?: string
  descarga: Descarga | null
}

type Tipo = 'temp' | 'viento' | 'lluvia' | 'intensidad' | 'presion' | 'pct' | 'grados' | 'solar' | 'uv' | 'pm'
  | 'cuenta' | 'bateria'

export interface Metrica {
  clave: string
  nombre: string
  tipo: Tipo
  grupo: 'Exterior' | 'Viento' | 'Lluvia' | 'Presión y sol' | 'Interior' | 'Calidad del aire' | 'Rayos' | 'Equipo'
}

export const METRICAS: Metrica[] = [
  { clave: 'tempf', nombre: 'Temperatura', tipo: 'temp', grupo: 'Exterior' },
  { clave: 'feelslikef', nombre: 'Sensación térmica', tipo: 'temp', grupo: 'Exterior' },
  { clave: 'dewpointf', nombre: 'Punto de rocío', tipo: 'temp', grupo: 'Exterior' },
  { clave: 'humidity', nombre: 'Humedad', tipo: 'pct', grupo: 'Exterior' },
  { clave: 'windspeedmph', nombre: 'Velocidad del viento', tipo: 'viento', grupo: 'Viento' },
  { clave: 'windgustmph', nombre: 'Ráfaga', tipo: 'viento', grupo: 'Viento' },
  { clave: 'maxdailygust', nombre: 'Ráfaga máxima del día', tipo: 'viento', grupo: 'Viento' },
  { clave: 'winddir', nombre: 'Dirección del viento', tipo: 'grados', grupo: 'Viento' },
  { clave: 'winddiravg10m', nombre: 'Dirección media 10 min', tipo: 'grados', grupo: 'Viento' },
  { clave: 'hourlyrainin', nombre: 'Intensidad de lluvia', tipo: 'intensidad', grupo: 'Lluvia' },
  { clave: 'eventrainin', nombre: 'Lluvia del evento', tipo: 'lluvia', grupo: 'Lluvia' },
  { clave: 'dailyrainin', nombre: 'Lluvia del día', tipo: 'lluvia', grupo: 'Lluvia' },
  { clave: 'weeklyrainin', nombre: 'Lluvia de la semana', tipo: 'lluvia', grupo: 'Lluvia' },
  { clave: 'monthlyrainin', nombre: 'Lluvia del mes', tipo: 'lluvia', grupo: 'Lluvia' },
  { clave: 'yearlyrainin', nombre: 'Lluvia del año', tipo: 'lluvia', grupo: 'Lluvia' },
  { clave: 'totalrainin', nombre: 'Lluvia total', tipo: 'lluvia', grupo: 'Lluvia' },
  { clave: 'baromrelin', nombre: 'Presión relativa', tipo: 'presion', grupo: 'Presión y sol' },
  { clave: 'baromabsin', nombre: 'Presión absoluta', tipo: 'presion', grupo: 'Presión y sol' },
  { clave: 'solarradiation', nombre: 'Radiación solar', tipo: 'solar', grupo: 'Presión y sol' },
  { clave: 'uv', nombre: 'Índice UV', tipo: 'uv', grupo: 'Presión y sol' },
  { clave: 'tempinf', nombre: 'Temperatura interior', tipo: 'temp', grupo: 'Interior' },
  { clave: 'humidityin', nombre: 'Humedad interior', tipo: 'pct', grupo: 'Interior' },
  { clave: 'feelslikeinf', nombre: 'Sensación interior', tipo: 'temp', grupo: 'Interior' },
  { clave: 'dewpointinf', nombre: 'Punto de rocío interior', tipo: 'temp', grupo: 'Interior' },
  { clave: 'pm25', nombre: 'PM2.5', tipo: 'pm', grupo: 'Calidad del aire' },
  { clave: 'pm25_24h', nombre: 'PM2.5 promedio 24 h', tipo: 'pm', grupo: 'Calidad del aire' },
  { clave: 'lightningday', nombre: 'Rayos del día', tipo: 'cuenta', grupo: 'Rayos' },
  { clave: 'lightningdistance', nombre: 'Distancia del último rayo', tipo: 'cuenta', grupo: 'Rayos' },
  { clave: 'battout', nombre: 'Batería', tipo: 'bateria', grupo: 'Equipo' },
]

/** Lo que se puede graficar: la bateria es OK/Baja, no una serie. */
export const GRAFICABLES = METRICAS.filter((m) => m.tipo !== 'bateria')

/**
 * Columnas de la tabla: las 29 de la app de escritorio, en su orden (el del
 * export de ambientweather.net) y con las mismas que arrancan ocultas.
 */
export const COLUMNAS_TABLA: { clave: string; etiqueta: string; oculta?: boolean }[] = [
  { clave: 'tempf', etiqueta: 'Temp. exterior' },
  { clave: 'feelslikef', etiqueta: 'Sensación' },
  { clave: 'dewpointf', etiqueta: 'Punto de rocío' },
  { clave: 'humidity', etiqueta: 'Humedad' },
  { clave: 'windspeedmph', etiqueta: 'Viento' },
  { clave: 'windgustmph', etiqueta: 'Ráfaga' },
  { clave: 'maxdailygust', etiqueta: 'Ráfaga máx. día' },
  { clave: 'winddir', etiqueta: 'Dirección' },
  { clave: 'winddiravg10m', etiqueta: 'Dir. media 10 min', oculta: true },
  { clave: 'hourlyrainin', etiqueta: 'Intensidad lluvia' },
  { clave: 'eventrainin', etiqueta: 'Lluvia evento' },
  { clave: 'dailyrainin', etiqueta: 'Lluvia día' },
  { clave: 'weeklyrainin', etiqueta: 'Lluvia semana', oculta: true },
  { clave: 'monthlyrainin', etiqueta: 'Lluvia mes', oculta: true },
  { clave: 'yearlyrainin', etiqueta: 'Lluvia año', oculta: true },
  { clave: 'totalrainin', etiqueta: 'Lluvia total', oculta: true },
  { clave: 'baromrelin', etiqueta: 'Presión rel.' },
  { clave: 'baromabsin', etiqueta: 'Presión abs.', oculta: true },
  { clave: 'uv', etiqueta: 'UV' },
  { clave: 'solarradiation', etiqueta: 'Radiación solar' },
  { clave: 'tempinf', etiqueta: 'Temp. interior' },
  { clave: 'humidityin', etiqueta: 'Humedad interior' },
  { clave: 'feelslikeinf', etiqueta: 'Sensación interior', oculta: true },
  { clave: 'dewpointinf', etiqueta: 'Rocío interior', oculta: true },
  { clave: 'battout', etiqueta: 'Batería' },
  { clave: 'pm25', etiqueta: 'PM2.5' },
  { clave: 'pm25_24h', etiqueta: 'PM2.5 24 h', oculta: true },
  { clave: 'lightningday', etiqueta: 'Rayos del día' },
  { clave: 'lightningdistance', etiqueta: 'Dist. rayos', oculta: true },
]

export const metrica = (clave: string) => METRICAS.find((m) => m.clave === clave)

const UNIDAD: Record<Tipo, string> = {
  temp: '°C', viento: 'km/h', lluvia: 'mm', intensidad: 'mm/h', presion: 'hPa',
  pct: '%', grados: '°', solar: 'W/m²', uv: '', pm: 'µg/m³', cuenta: '', bateria: '',
}
const DECIMALES: Record<Tipo, number> = {
  temp: 1, viento: 1, lluvia: 1, intensidad: 1, presion: 1, pct: 0, grados: 0, solar: 0, uv: 0, pm: 1,
  cuenta: 0, bateria: 0,
}

export const unidad = (m: Metrica) => UNIDAD[m.tipo]

/** De la unidad de Ambient Weather a la metrica. */
export function convertir(m: Metrica, v: number): number {
  switch (m.tipo) {
    case 'temp': return (v - 32) * 5 / 9
    case 'viento': return v * 1.609344
    case 'lluvia':
    case 'intensidad': return v * 25.4
    case 'presion': return v * 33.8638866667
    default: return v
  }
}

/** Valor ya convertido y redondeado, con su unidad; '—' si no llego. */
export function mostrar(clave: string, valores: Record<string, number> | undefined, conUnidad = true): string {
  const m = metrica(clave)
  const v = valores?.[clave]
  if (!m || v === undefined) return '—'
  // La API manda 1 si la bateria esta bien y 0 si esta baja.
  if (m.tipo === 'bateria') return v === 1 ? 'OK' : 'Baja'
  const n = convertir(m, v).toLocaleString('es-MX', {
    minimumFractionDigits: DECIMALES[m.tipo], maximumFractionDigits: DECIMALES[m.tipo],
  })
  const u = UNIDAD[m.tipo]
  return conUnidad && u ? `${n}${u === '°' || u === '%' ? '' : ' '}${u}` : n
}

const PUNTOS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']

/** 0° = norte. La O es oeste (en español), no la W. */
export function cardinal(grados: number): string {
  return PUNTOS[Math.round((((grados % 360) + 360) % 360) / 22.5) % 16]
}

/** Que tan fresca es la ultima lectura. La API publica cada minuto. */
export type Frescura = 'ok' | 'wa' | 'er' | 'no'
export function frescura(ultima: string | null | undefined, ahora: number): Frescura {
  if (!ultima) return 'no'
  const min = (ahora - new Date(ultima).getTime()) / 60000
  if (min <= 10) return 'ok'
  if (min <= 60) return 'wa'
  return 'er'
}

/** CSV de lecturas, en unidades metricas y hora de Guadalajara. */
export function aCsv(ls: Lectura[], claves: string[]): string {
  const cab = ['fecha (Guadalajara)', ...claves.map((c) => {
    const m = metrica(c)!
    return unidad(m) ? `${m.nombre} (${unidad(m)})` : m.nombre
  })]
  const filas = ls.map((l) => [horaLocal(l.fecha), ...claves.map((c) => {
    const m = metrica(c)!
    const v = l.valores[c]
    return v === undefined ? '' : String(Math.round(convertir(m, v) * 100) / 100)
  })])
  const celda = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return [cab, ...filas].map((f) => f.map(celda).join(',')).join('\n')
}

/** Fin del tramo: ahora, o la ultima lectura si la estacion dejo de reportar. */
export function finDe(ultima: string | undefined, ahora: number): number {
  const u = ultima ? new Date(ultima).getTime() : ahora
  return Math.min(ahora, u + 60_000)
}
