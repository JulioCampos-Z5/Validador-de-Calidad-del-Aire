import { useEffect, useMemo, useRef, useState } from 'react'
import { IconArrowNarrowUp, IconAlertTriangle } from '@tabler/icons-react'
import type { Cliente } from '../../compartido/api'
import type { Usuario } from '../../compartido/tipos'
import { esAdmin } from '../../compartido/modulo'
import { fechaHora, hace } from '../../compartido/tiempo'
import {
  GRAFICABLES, cardinal, convertir, finDe, frescura, horaLocal, metrica, mostrar, nombreCorto, unidad,
  type Dispositivo, type EstadoSondeo, type Lectura,
} from './datos'
import { Tabla } from './Tabla'
import { Historico } from './Historico'

// La API publica cada minuto; preguntar mas seguido no trae nada nuevo.
const CADA_MS = 60_000
// Mientras corre una descarga de historico se sigue su avance de cerca.
const CADA_MS_DESCARGA = 3_000

const RANGOS = [
  { id: '6h', etq: '6 h', horas: 6 },
  { id: '24h', etq: '24 h', horas: 24 },
  { id: '7d', etq: '7 días', horas: 24 * 7 },
  { id: '30d', etq: '30 días', horas: 24 * 30 },
  { id: '90d', etq: '90 días', horas: 24 * 90 },
] as const
type Rango = typeof RANGOS[number]['id']

// Lo que se ve de un vistazo en el detalle, en este orden.
const EN_VIVO = ['tempf', 'feelslikef', 'humidity', 'dewpointf', 'windspeedmph', 'windgustmph',
  'dailyrainin', 'hourlyrainin', 'baromrelin', 'solarradiation', 'uv', 'pm25']

export function AmbientWeather({ api, usuario }: { api: Cliente; usuario: Usuario }) {
  const [dispositivos, setDispositivos] = useState<Dispositivo[] | null>(null)
  const [estado, setEstado] = useState<EstadoSondeo | null>(null)
  const [error, setError] = useState('')
  const [ahora, setAhora] = useState(Date.now())
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

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  // Sin eleccion, la estacion con la lectura mas reciente.
  const actual = useMemo(() => {
    if (!dispositivos?.length) return null
    return dispositivos.find((d) => d.mac === elegida)
      ?? [...dispositivos].sort((a, b) => (b.ultima?.fecha ?? '').localeCompare(a.ultima?.fecha ?? ''))[0]
  }, [dispositivos, elegida])

  if (dispositivos === null) {
    return <div className="pagina">{error ? <div className="aviso-error">{error}</div> : <p className="cap">Cargando estaciones…</p>}</div>
  }

  return (
    <div className="pagina aw">
      <header className="cabecera">
        <div>
          <h1 className="titulo">Ambient Weather</h1>
          <div className="cap" style={{ marginTop: 2 }}>
            <LineaSondeo estado={estado} ahora={ahora} />
          </div>
        </div>
      </header>

      {estado && !estado.llaves && (
        <div className="aviso" style={{ marginBottom: 14 }}>
          La API no tiene las llaves de Ambient Weather, así que no consulta lecturas nuevas: se muestra lo
          guardado. Se configuran en <span className="mono">AMBIENT_WEATHER_API_KEY</span> y{' '}
          <span className="mono">AMBIENT_WEATHER_APPLICATION_KEY</span>.
        </div>
      )}
      {estado?.ultimoError && (
        <div className="aviso-error" style={{ marginBottom: 14 }}>Última consulta a Ambient Weather: {estado.ultimoError}</div>
      )}
      {error && <div className="aviso-error" style={{ marginBottom: 14 }}>No se pudo actualizar: {error}. Se muestra lo último que llegó.</div>}

      {dispositivos.length === 0 ? (
        <div className="vacio">
          <strong>Todavía no hay estaciones.</strong>
          <span className="cap">Aparecen solas con la primera consulta a Ambient Weather.</span>
        </div>
      ) : (
        <>
          <div className="mosaico" role="list" style={{ marginBottom: 16 }}>
            {dispositivos.map((d) => {
              const f = frescura(d.ultima?.fecha, ahora)
              return (
                <button key={d.mac} type="button" role="listitem"
                  className={`tarjeta${actual?.mac === d.mac ? ' abierta' : ''}${f === 'er' ? ' borde-er' : f === 'wa' ? ' borde-wa' : ''}`}
                  onClick={() => setElegida(d.mac)} aria-pressed={actual?.mac === d.mac} title={d.nombre}>
                  <div className="tarjeta-titulo">
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombreCorto(d)}</span>
                    <span className={`punto ${f}`} aria-hidden="true" />
                  </div>
                  <div className="aw-temp">{mostrar('tempf', d.ultima?.valores)}</div>
                  <div className="cap">
                    {mostrar('humidity', d.ultima?.valores)} humedad
                    {' · '}{d.ultima ? `hace ${hace(ahora - new Date(d.ultima.fecha).getTime()).replace('hace ', '')}` : 'sin lecturas'}
                  </div>
                </button>
              )
            })}
          </div>

          {actual && (
            <Detalle key={actual.mac} api={api} d={actual} todos={dispositivos} ahora={ahora}
              admin={esAdmin(usuario)} estado={estado} alPedir={setEstado} />
          )}
        </>
      )}
    </div>
  )
}

function LineaSondeo({ estado, ahora }: { estado: EstadoSondeo | null; ahora: number }) {
  if (!estado) return null
  if (!estado.llaves) return <>Sin consulta automática</>
  if (!estado.ultimoSondeo) return <>Consultando cada {estado.intervaloSeg} s · esperando la primera consulta</>
  return <>Consultando cada {estado.intervaloSeg} s · última consulta {hace(ahora - new Date(estado.ultimoSondeo).getTime())}</>
}

function Detalle({ api, d, todos, ahora, admin, estado, alPedir }: {
  api: Cliente; d: Dispositivo; todos: Dispositivo[]; ahora: number; admin: boolean
  estado: EstadoSondeo | null; alPedir: (e: EstadoSondeo) => void
}) {
  const v = d.ultima?.valores
  const f = frescura(d.ultima?.fecha, ahora)
  const presentes = EN_VIVO.filter((c) => v?.[c] !== undefined)

  return (
    <section className="detalle">
      <div className="detalle-cabecera">
        <div>
          <h2 className="detalle-titulo">{nombreCorto(d)}</h2>
          <div className="cap">
            {[d.ubicacion, d.mac, `${d.lecturas.toLocaleString('es-MX')} lecturas guardadas`].filter(Boolean).join(' · ')}
          </div>
        </div>
        {d.ultima && (
          <div className="cap" style={{ textAlign: 'right' }}>
            Última lectura<br />
            <strong style={{ color: 'var(--tx)' }}>{fechaHora(d.ultima.fecha)}</strong>
          </div>
        )}
      </div>

      {d.ultima && f === 'er' && (
        <div className="aviso aw-viejo" style={{ marginBottom: 14 }}>
          <IconAlertTriangle size={16} stroke={1.8} />
          Esta estación no reporta desde hace {hace(ahora - new Date(d.ultima.fecha).getTime()).replace('hace ', '')}.
          Las gráficas terminan en su última lectura.
        </div>
      )}

      {presentes.length > 0 && (
        <div className="numeros">
          {presentes.map((c) => (
            <div key={c} className="numero">
              <div className="valor">
                {mostrar(c, v)}
                {c === 'windspeedmph' && v?.winddir !== undefined && (
                  <span className="aw-dir" title={`Viene del ${cardinal(v.winddir)} (${Math.round(v.winddir)}°)`}>
                    {/* La flecha apunta hacia donde sopla: la direccion es de donde viene. */}
                    <IconArrowNarrowUp size={18} stroke={2} style={{ transform: `rotate(${v.winddir + 180}deg)` }} />
                    {cardinal(v.winddir)}
                  </span>
                )}
              </div>
              <div className="etq">{metrica(c)!.nombre}</div>
            </div>
          ))}
        </div>
      )}

      <Grafica api={api} d={d} todos={todos} ahora={ahora} />
      <Tabla api={api} d={d} ahora={ahora} />
      {admin && <Historico api={api} d={d} todos={todos} estado={estado} alPedir={alPedir} />}
    </section>
  )
}

function Grafica({ api, d, todos, ahora }: { api: Cliente; d: Dispositivo; todos: Dispositivo[]; ahora: number }) {
  const [rango, setRango] = useState<Rango>('24h')
  const [clave, setClave] = useState('tempf')
  const [comparar, setComparar] = useState(false)
  const [series, setSeries] = useState<{ d: Dispositivo; lecturas: Lectura[] }[] | null>(null)
  const [cubeta, setCubeta] = useState(0)
  const [error, setError] = useState('')
  const div = useRef<HTMLDivElement>(null)

  const estaciones = comparar ? todos.filter((x) => x.ultima) : [d]
  // El fin se fija al elegir, no a cada tic del reloj: si no, la grafica se
  // volveria a pedir cada 15 s sin que haya nada nuevo.
  const ultimaComun = estaciones.map((x) => x.ultima?.fecha ?? '').sort().at(-1)
  const minutoActual = Math.floor(ahora / 60_000)
  const hasta = useMemo(() => finDe(ultimaComun, minutoActual * 60_000), [ultimaComun, minutoActual])
  const horas = RANGOS.find((r) => r.id === rango)!.horas
  const macs = estaciones.map((x) => x.mac).join(',')

  useEffect(() => {
    let vivo = true
    setError('')
    const desde = new Date(hasta - horas * 3_600_000).toISOString()
    const hastaIso = new Date(hasta).toISOString()
    Promise.all(estaciones.map((x) =>
      api.get<{ lecturas: Lectura[]; cubetaSeg: number }>(
        `/api/ambient-weather/serie?mac=${encodeURIComponent(x.mac)}&desde=${desde}&hasta=${hastaIso}&puntos=1200`)
        .then((r) => ({ d: x, ...r }))))
      .then((rs) => {
        if (!vivo) return
        setSeries(rs.map((r) => ({ d: r.d, lecturas: r.lecturas })))
        setCubeta(Math.max(0, ...rs.map((r) => r.cubetaSeg)))
      })
      .catch((e: Error) => vivo && setError(e.message))
    return () => { vivo = false }
    // estaciones cambia de identidad en cada render; macs es lo que importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, macs, hasta, horas])

  const m = metrica(clave)!
  const conDatos = series?.some((s) => s.lecturas.some((l) => l.valores[clave] !== undefined)) ?? false

  useEffect(() => {
    const nodo = div.current
    if (!nodo || !series || !conDatos) return
    let vivo = true
    import('../../legado/graficas/plotly').then(({ default: Plotly }) => {
      if (!vivo) return
      const angular = m.tipo === 'grados'
      // Mas de esto sin lectura es un hueco: la linea se corta ahi en vez de
      // cruzarlo en recta, que parece una medicion que nadie hizo.
      const hueco = Math.max(15 * 60_000, 3 * cubeta * 1000)
      const trazas = series.map((s) => {
        const ls = s.lecturas.filter((l) => l.valores[clave] !== undefined)
        const x: (string | null)[] = []
        const y: (number | null)[] = []
        ls.forEach((l, i) => {
          if (i > 0 && new Date(l.fecha).getTime() - new Date(ls[i - 1].fecha).getTime() > hueco) {
            x.push(null)
            y.push(null)
          }
          x.push(horaLocal(l.fecha))
          y.push(Math.round(convertir(m, l.valores[clave]) * 100) / 100)
        })
        return {
          type: 'scatter',
          // Con pocos puntos una linea sola no se ve (un punto aislado no
          // dibuja nada): se marcan tambien.
          mode: angular ? 'markers' : ls.length < 60 ? 'lines+markers' : 'lines',
          connectgaps: false,
          name: nombreCorto(s.d),
          x,
          y,
          line: { width: 1.6 },
          marker: { size: 4 },
          hovertemplate: `%{y} ${unidad(m)}<extra>${nombreCorto(s.d)}</extra>`,
        }
      })
      Plotly.react(nodo, trazas, {
        height: 340,
        margin: { l: 56, r: 16, t: 10, b: 40 },
        showlegend: series.length > 1,
        legend: { orientation: 'h', y: -0.18 },
        hovermode: 'x unified',
        xaxis: { type: 'date', tickformat: horas <= 48 ? '%H:%M\n%d %b' : '%d %b' },
        yaxis: {
          title: unidad(m) ? `${m.nombre} (${unidad(m)})` : m.nombre,
          ...(angular ? { range: [0, 360], tickvals: [0, 90, 180, 270, 360], ticktext: ['N', 'E', 'S', 'O', 'N'] } : {}),
        },
      }, { responsive: true, displaylogo: false })
    })
    return () => { vivo = false }
  }, [series, clave, conDatos, horas, m, cubeta])

  useEffect(() => () => {
    if (div.current) import('../../legado/graficas/plotly').then(({ default: Plotly }) => div.current && Plotly.purge(div.current))
  }, [])

  return (
    <div className="seccion">
      <div className="aw-controles">
        <h3 className="h2" style={{ margin: 0 }}>Gráfica</h3>
        <div className="filtros" role="group" aria-label="Periodo">
          {RANGOS.map((r) => (
            <button key={r.id} type="button" className={`boton${rango === r.id ? ' elegido' : ''}`}
              aria-pressed={rango === r.id} onClick={() => setRango(r.id)}>{r.etq}</button>
          ))}
        </div>
        <label className="campo aw-select">
          <span className="sr-only">Métrica</span>
          <select value={clave} onChange={(e) => setClave(e.target.value)} aria-label="Métrica">
            {[...new Set(GRAFICABLES.map((x) => x.grupo))].map((g) => (
              <optgroup key={g} label={g}>
                {GRAFICABLES.filter((x) => x.grupo === g).map((x) => <option key={x.clave} value={x.clave}>{x.nombre}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="aw-check">
          <input type="checkbox" checked={comparar} onChange={(e) => setComparar(e.target.checked)} />
          Comparar todas las estaciones
        </label>
      </div>

      {error && <div className="aviso-error">{error}</div>}
      {!error && series === null && <p className="cap">Cargando…</p>}
      {!error && series !== null && !conDatos && (
        <div className="vacio"><span className="cap">Sin lecturas de {m.nombre.toLowerCase()} en este periodo.</span></div>
      )}
      <div ref={div} style={{ display: conDatos ? 'block' : 'none' }} />
      {conDatos && (
        <p className="cap" style={{ margin: '6px 0 0' }}>
          Hasta {fechaHora(new Date(hasta).toISOString())}
          {cubeta > 0 && ` · cada punto resume ${cubeta >= 3600 ? `${cubeta / 3600} h` : `${cubeta / 60} min`} (promedio; máximo en acumulados de lluvia)`}
        </p>
      )}
    </div>
  )
}
