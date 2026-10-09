// Si el validador corre en la app de escritorio: solo ahí existe la base local
// (el motor la tiene configurada). En la web responde disponible: false.
//
// Al abrir la app, la API de Go suele estar lista antes que el motor de Python
// (tarda unos segundos en arrancar): mientras la consulta falle se reintenta,
// en vez de concluir que no es escritorio.
import type { Cliente } from './api'

export async function esEscritorio(
  api: Cliente,
  { intentos = 30, esperaMs = 2_000, vivo = () => true }: { intentos?: number; esperaMs?: number; vivo?: () => boolean } = {},
): Promise<boolean> {
  for (let i = 0; i < intentos && vivo(); i++) {
    try {
      return (await api.get<{ disponible: boolean }>('/api/analisis/historico/estado')).disponible === true
    } catch {
      if (i < intentos - 1) await new Promise((ok) => setTimeout(ok, esperaMs))
    }
  }
  return false
}
