// Descarga de histórico de Ambient Weather fuera de su módulo (en el Tablero):
// trae las estaciones y el estado por su cuenta y usa el mismo componente que
// el detalle de una estación, con selector de estación.
import { useEffect, useState } from 'react'
import type { Cliente } from '../../compartido/api'
import { Historico } from './Historico'
import type { Dispositivo, EstadoSondeo } from './datos'
import './ambientweather.css'

const CADA_MS = 60_000
const CADA_MS_DESCARGA = 3_000

export function DescargaAmbient({ api }: { api: Cliente }) {
  const [dispositivos, setDispositivos] = useState<Dispositivo[] | null>(null)
  const [estado, setEstado] = useState<EstadoSondeo | null>(null)
  const [error, setError] = useState('')
  const [elegida, setElegida] = useState<string | null>(null)
  const descargando = estado?.descarga?.estado === 'descargando'

  useEffect(() => {
    let vivo = true
    const traer = () =>
      Promise.all([
        api.get<{ dispositivos: Dispositivo[] }>('/api/ambient-weather/dispositivos'),
        api.get<EstadoSondeo>('/api/ambient-weather/estado'),
      ])
        .then(([d, e]) => {
          if (!vivo) return
          setDispositivos(d.dispositivos)
          setEstado(e)
          setError('')
        })
        .catch((e: Error) => vivo && setError(e.message))
    traer()
    const t = setInterval(traer, descargando ? CADA_MS_DESCARGA : CADA_MS)
    return () => { vivo = false; clearInterval(t) }
  }, [api, descargando])

  if (error) return <div className="aviso-error">{error}</div>
  if (!dispositivos) return <p className="cap">Cargando estaciones…</p>
  if (!dispositivos.length) return <p className="cap">Todavía no hay estaciones de Ambient Weather.</p>
  const d = dispositivos.find((x) => x.mac === elegida) ?? dispositivos[0]
  return <Historico api={api} d={d} todos={dispositivos} estado={estado} alPedir={setEstado} alElegir={setElegida} />
}
