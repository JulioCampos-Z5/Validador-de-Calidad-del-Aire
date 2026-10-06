// Todas las horas se muestran en hora de Guadalajara, sin importar la zona de
// la computadora que abra la pagina (la API guarda en UTC).

const zona = 'America/Mexico_City'

const fmtHora = new Intl.DateTimeFormat('es-MX', { timeZone: zona, hour: '2-digit', minute: '2-digit', hour12: false })
const fmtFechaHora = new Intl.DateTimeFormat('es-MX', {
  timeZone: zona, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
})

export function hora(iso: string) {
  return fmtHora.format(new Date(iso))
}

export function fechaHora(iso: string) {
  return fmtFechaHora.format(new Date(iso))
}

// "6 h 32 min", "45 min", "2 d 3 h"
export function duracion(ms: number) {
  const min = Math.max(0, Math.floor(ms / 60000))
  if (min < 1) return 'menos de 1 min'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`
}

export function desde(iso: string, ahora: number) {
  return duracion(ahora - new Date(iso).getTime())
}

// "hace 4 s", "hace 3 min"
export function hace(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `hace ${s} s`
  return `hace ${duracion(ms)}`
}
