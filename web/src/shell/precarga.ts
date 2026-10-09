// Precarga de la app de escritorio: al entrar sin nada cargado, lo que va del
// año sale de la base local (backend/historico/rutas.py, POST /precarga). Si
// hay sesion con la API de Emisiones, el backend baja en segundo plano los dias
// que falten; aqui se sigue su avance y, al terminar, se vuelve a pedir la
// precarga para mostrar lo nuevo.

import type { Cliente } from '../compartido/api'
import type { Conjunto, RespuestaValidacion } from '../compartido/tipos'

// Los mismos contaminantes del MIR que usa Validacion por omision.
const CONTAMINANTES = ['O3', 'NO2', 'SO2', 'CO', 'PM10', 'PM2.5']
const CADA_MS = 5_000

interface InfoPrecarga { anio: number; desde: string; hasta: string; completando: boolean; motivo: string | null }
type Respuesta = Partial<RespuestaValidacion> & {
  vacio?: boolean
  precarga: InfoPrecarga
  mir?: unknown
  fallas?: unknown[]
}

export function descripcionPrecarga(anio: number, completando: boolean) {
  return `Base local · lo que va de ${anio}${completando ? ' · completando con la API de Emisiones…' : ''}`
}

export function aConjunto(r: Respuesta): Conjunto | null {
  if (r.vacio || !r.summary) return null
  const descripcion = descripcionPrecarga(r.precarga.anio, r.precarga.completando)
  const { precarga: _info, ...respuesta } = r
  return {
    origen: descripcion,
    cargado: new Date().toISOString(),
    respuesta: respuesta as RespuestaValidacion,
    // Lo que interpreta src/legado (EstadoCompartido de DatosContexto).
    compartido: {
      resultado: respuesta, mir: r.mir ?? null, fallas: r.fallas ?? [], contaminantesMir: CONTAMINANTES,
      comoCeroMir: [], origen: 'historico', descripcion, advertencia: null,
    },
  }
}

export async function pedirPrecarga(api: Cliente, completar: boolean) {
  const r = await api.post<Respuesta>('/api/analisis/historico/precarga', { completar, contaminantes: CONTAMINANTES })
  return { conjunto: aConjunto(r), info: r.precarga }
}

/**
 * Carga lo que va del año y, si el backend esta completando con Emisiones,
 * espera a que termine y entrega la version completa. `entregar` recibe cada
 * conjunto; `vigente` dice si lo cargado sigue siendo el de la precarga (si la
 * persona ya cargo otra cosa, no se le pisa). Devuelve una funcion para parar.
 */
export function precargar(
  api: Cliente,
  entregar: (c: Conjunto) => void,
  vigente: () => boolean,
): () => void {
  let vivo = true
  let reloj: ReturnType<typeof setTimeout> | undefined

  const seguir = () => {
    reloj = setTimeout(async () => {
      if (!vivo) return
      try {
        const avance = await api.get<{ activo?: boolean; nuevos?: number }>('/api/analisis/historico/descargar')
        if (avance.activo) return seguir()
        if (!vivo || !vigente()) return
        const { conjunto } = await pedirPrecarga(api, false)
        if (conjunto && vivo && vigente()) entregar(conjunto)
      } catch {
        // Sin conexion un momento: se vuelve a intentar.
        seguir()
      }
    }, CADA_MS)
  }

  pedirPrecarga(api, true)
    .then(({ conjunto, info }) => {
      if (!vivo) return
      if (conjunto && vigente()) entregar(conjunto)
      if (info.completando) seguir()
    })
    .catch(() => { /* sin precarga: se carga a mano como siempre */ })

  return () => { vivo = false; clearTimeout(reloj) }
}
