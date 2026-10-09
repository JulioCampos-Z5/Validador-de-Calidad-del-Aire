// Descarga de histórico de Ambient Weather y su avance. Se usa en el detalle
// de una estación y en el Tablero (con selector de estación).
import { useState } from 'react'
import type { Cliente } from '../../compartido/api'
import { fechaHora } from '../../compartido/tiempo'
import {
  DIAS_MAXIMOS, avanceDescarga, duracion, nombreCorto,
  type Descarga, type Dispositivo, type EstadoSondeo,
} from './datos'

export function Historico({ api, d, todos, estado, alPedir, alElegir }: {
  api: Cliente; d: Dispositivo; todos: Dispositivo[]; estado: EstadoSondeo | null; alPedir: (e: EstadoSondeo) => void
  /** Fuera del detalle de una estación (Tablero): selector de estación. */
  alElegir?: (mac: string) => void
}) {
  const [dias, setDias] = useState(DIAS_MAXIMOS)
  const [todas, setTodas] = useState(false)
  const [error, setError] = useState('')
  // Con «todas las estaciones» la API las baja una tras otra en este orden;
  // se guarda para poder decir cuántas faltan.
  const [cola, setCola] = useState<string[] | null>(null)
  const desc = estado?.descarga
  const corriendo = desc?.estado === 'descargando'

  const pedir = async () => {
    setError('')
    try {
      setCola(todas ? todos.map((t) => t.mac) : null)
      alPedir(await api.post<EstadoSondeo>('/api/ambient-weather/historico', { mac: todas ? '' : d.mac, dias }))
      // La API contesta antes de que la descarga anote su estado: se vuelve a
      // preguntar enseguida para mostrar el avance sin esperar a la consulta
      // normal (cada minuto).
      await new Promise((ok) => setTimeout(ok, 1_000))
      alPedir(await api.get<EstadoSondeo>('/api/ambient-weather/estado'))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="seccion" style={{ marginBottom: 0 }}>
      <h3 className="h2">Descargar histórico</h3>
      <p className="cap" style={{ marginTop: -4 }}>
        Trae de Ambient Weather lo que falte hacia atrás. Lo repetido se ignora. Ambient Weather admite una
        petición por segundo: un año de una estación tarda unos 7 minutos.
      </p>
      {!estado?.llaves ? (
        <div className="aviso">Hace falta configurar las llaves de Ambient Weather en la API.</div>
      ) : (
        <div className="aw-controles">
          {alElegir && (
            <label className="campo aw-select">
              <select value={d.mac} onChange={(e) => alElegir(e.target.value)} aria-label="Estación" disabled={corriendo || todas}>
                {todos.map((t) => <option key={t.mac} value={t.mac}>{nombreCorto(t)}</option>)}
              </select>
            </label>
          )}
          <label className="campo aw-select">
            <select value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Días hacia atrás" disabled={corriendo}>
              <option value={DIAS_MAXIMOS}>Todo lo disponible (hasta 1 año)</option>
              {[7, 30, 90, 180].map((n) => <option key={n} value={n}>Últimos {n} días</option>)}
            </select>
          </label>
          <label className="aw-check">
            <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} disabled={corriendo} />
            Todas las estaciones
          </label>
          <button type="button" className="boton primario" onClick={pedir} disabled={corriendo}>
            {corriendo ? 'Descargando…' : 'Descargar'}
          </button>
        </div>
      )}
      {error && <div className="aviso-error" style={{ marginTop: 10 }}>{error}</div>}
      {desc && <AvanceDescarga desc={desc} cola={cola && cola.includes(desc.mac) ? cola : null} todos={todos} />}
    </div>
  )
}

/** Cuánto lleva la descarga de histórico y cuánto falta. */
function AvanceDescarga({ desc, cola, todos }: { desc: Descarga; cola: string[] | null; todos: Dispositivo[] }) {
  const a = avanceDescarga(desc, cola, Date.now())
  const nombre = (mac: string) => {
    const t = todos.find((x) => x.mac === mac)
    return t ? nombreCorto(t) : mac
  }
  const pct = (f: number) => `${Math.floor(f * 100)}%`
  const titulo = desc.estado === 'descargando' ? 'Descargando' : desc.estado === 'terminada' ? 'Terminó' : 'Falló'
  return (
    <div className="aw-avance" role="status" aria-label="Avance de la descarga">
      <div className="aw-avance-cabecera">
        <strong>{titulo}{cola ? ` · estación ${Math.min(a.hechas + (desc.estado === 'descargando' ? 1 : 0), a.estaciones)} de ${a.estaciones}` : ''}</strong>
        <span>{pct(cola ? a.total : a.estacion)}</span>
      </div>
      <div className="aw-progreso" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor((cola ? a.total : a.estacion) * 100)}>
        <div className={`aw-progreso-relleno${desc.estado === 'error' ? ' error' : ''}`} style={{ width: pct(cola ? a.total : a.estacion) }} />
      </div>
      <p className="cap" style={{ margin: '6px 0 0' }}>
        {nombreCorto(desc)} ({desc.dias === DIAS_MAXIMOS ? 'todo lo disponible' : `${desc.dias} días`}): {pct(a.estacion)}
        {' · '}{desc.recibidas.toLocaleString('es-MX')} lecturas recibidas, {desc.nuevas.toLocaleString('es-MX')} nuevas
        {desc.llegoA && ` · va en ${fechaHora(desc.llegoA)}`}
        {desc.estado === 'descargando' && (a.faltaMs === null ? ' · calculando cuánto falta…' : ` · faltan ${duracion(a.faltaMs)}`)}
        {desc.error && ` — ${desc.error}`}
      </p>
      {cola && (
        <ul className="aw-cola">
          {cola.map((mac, i) => {
            const pos = cola.indexOf(desc.mac)
            const est = i < pos || (i === pos && desc.estado === 'terminada') ? 'Lista'
              : i === pos ? (desc.estado === 'error' ? 'Falló' : pct(a.estacion))
                : desc.estado === 'error' ? 'No se bajó' : 'Pendiente'
            return (
              <li key={mac} className={i === pos ? 'actual' : ''}>
                <span>{nombre(mac)}</span><span>{est}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
