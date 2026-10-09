// Ambient Weather: lo que comparten su modulo y las Graficas (que lo usan
// como fuente): tipos de la API, nombre corto y hora de Guadalajara.

export interface Lectura {
  fecha: string // ISO UTC
  valores: Record<string, number>
}

export interface Dispositivo {
  mac: string
  nombre: string
  ubicacion: string
  lat: number | null
  lon: number | null
  lecturas: number
  primera: string | null
  ultima: Lectura | null
}

/**
 * Nombre para mostrar: las estaciones vienen como «SantaFe-AMBWeather-Pro» o
 * «COUNTRY_AMBWeather-Pro». El modelo se repite en todas y no distingue nada.
 */
export function nombreCorto(d: Pick<Dispositivo, 'nombre' | 'mac'>): string {
  const limpio = d.nombre.replace(/[-_ ]*AMB\s*Weather[-_ ]*Pro\s*$/i, '').trim()
  return limpio || d.nombre || d.mac
}

// Fecha para Plotly en hora de Guadalajara: Plotly dibuja el texto tal cual,
// sin zona, y un ISO en UTC saldria seis horas corrido.
const partes = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
export function horaLocal(iso: string): string {
  const p = Object.fromEntries(partes.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}
