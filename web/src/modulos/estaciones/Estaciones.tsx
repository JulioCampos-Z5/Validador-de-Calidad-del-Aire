import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconX } from '@tabler/icons-react'
import type { Cliente } from '../../compartido/api'
import type { EstadoEstacion, EventoPuerto } from '../../compartido/tipos'
import { desde, fechaHora, hace } from '../../compartido/tiempo'
import { resumen, tarjetas, type Color, type Tarjeta } from './estado'

// Sin SSE todavia: se pregunta a la API cada pocos segundos. La consulta es
// barata (una lectura de estado) y el detector ya avisa en tiempo real a la API.
const CADA_MS = 10_000

type Filtro = 'todas' | 'fallas'

export function Estaciones({ api }: { api: Cliente }) {
  const [estaciones, setEstaciones] = useState<EstadoEstacion[] | null>(null)
  const [actualizado, setActualizado] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [ahora, setAhora] = useState(Date.now())
  const [filtro, setFiltro] = useState<Filtro | null>(null)
  const [abierta, setAbierta] = useState<number | null>(null)

  useEffect(() => {
    let vivo = true
    const traer = () =>
      api.get<{ estaciones: EstadoEstacion[] }>('/api/puertos/estado')
        .then((r) => {
          if (!vivo) return
          setEstaciones(r.estaciones)
          setActualizado(Date.now())
          setError('')
        })
        .catch((e: Error) => vivo && setError(e.message))
    traer()
    const t = setInterval(traer, CADA_MS)
    return () => { vivo = false; clearInterval(t) }
  }, [api])

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const ts = useMemo(() => tarjetas(estaciones ?? [], ahora), [estaciones, ahora])
  const r = resumen(ts)
  const conFalla = ts.filter((t) => t.conFalla).length

  // Primera carga: si hay fallas se muestran solo esas; despues manda el usuario.
  const filtroEf: Filtro = filtro ?? (conFalla > 0 ? 'fallas' : 'todas')
  const visibles = filtroEf === 'fallas' ? ts.filter((t) => t.conFalla) : ts
  const seleccion = estaciones?.find((e) => e.id === abierta) ?? null

  if (estaciones === null) {
    return <div className="pagina">{error ? <div className="aviso-error">{error}</div> : <p className="cap">Cargando estaciones…</p>}</div>
  }

  return (
    <div className="pagina">
      <header className="cabecera">
        <div>
          <h1 className="titulo">Red de monitoreo</h1>
          <div className="cap" style={{ marginTop: 2 }}>
            {actualizado ? `Actualizado ${hace(ahora - actualizado)}` : ''}
          </div>
        </div>
        <div className="filtros" role="group" aria-label="Filtro de estaciones">
          <button type="button" className={`boton${filtroEf === 'todas' ? ' elegido' : ''}`}
            aria-pressed={filtroEf === 'todas'} onClick={() => setFiltro('todas')}>Todas · {ts.length}</button>
          <button type="button" className={`boton${filtroEf === 'fallas' ? ' elegido' : ''}`}
            aria-pressed={filtroEf === 'fallas'} onClick={() => setFiltro('fallas')}>Con fallas · {conFalla}</button>
        </div>
      </header>

      {error && <div className="aviso-error" style={{ marginBottom: 14 }}>No se pudo actualizar: {error}. Se muestra lo último que llegó.</div>}

      {ts.length > 0 && (
        <>
          <div className="barra-red" aria-hidden="true">
            {(['ok', 'wa', 'er', 'no'] as Color[]).map((c) => r[c] > 0 && <div key={c} className={c} style={{ flex: r[c] }} />)}
          </div>
          <div className="leyenda cap">
            <span><span className="punto ok" /> {r.ok} bien</span>
            <span><span className="punto wa" /> {r.wa} con falla</span>
            <span><span className="punto er" /> {r.er} incumple NOM</span>
            <span><span className="punto no" /> {r.no} sin comunicación</span>
          </div>
        </>
      )}

      {seleccion && <Detalle api={api} estacion={seleccion} ahora={ahora} cerrar={() => setAbierta(null)} />}

      {ts.length === 0 ? (
        <Vacio titulo="Todavía no hay estaciones" texto="Un administrador las da de alta y les entrega su token para el detector de puertos." />
      ) : visibles.length === 0 ? (
        <Vacio titulo="Ninguna estación con fallas" texto="Todas están dando datos.">
          <button type="button" className="boton" onClick={() => setFiltro('todas')}>Ver todas</button>
        </Vacio>
      ) : (
        <div className="mosaico">
          {visibles.map((t) => <TarjetaEstacion key={t.id} t={t} abierta={t.id === abierta} abrir={() => setAbierta(t.id === abierta ? null : t.id)} />)}
        </div>
      )}
    </div>
  )
}

function TarjetaEstacion({ t, abierta, abrir }: { t: Tarjeta; abierta: boolean; abrir: () => void }) {
  return (
    <button type="button" className={`tarjeta borde-${t.color}${abierta ? ' abierta' : ''}`} onClick={abrir}
      aria-expanded={abierta} aria-label={`${t.nombre}: ${t.quien} ${t.detalle}`}>
      <div className="tarjeta-titulo">{t.nombre}<span className={`punto ${t.color}`} /></div>
      <div className="cap tarjeta-resumen">
        {t.quienEsClave ? <span className="mono">{t.quien}</span> : t.quien}
        {t.detalle && ` · ${t.detalle}`}
      </div>
      <div className="puntos">
        {t.puntos.map((p) => <span key={p.clave} className={`punto ${p.color}`} title={p.titulo} />)}
      </div>
    </button>
  )
}

const TEXTO_EVENTO: Record<EventoPuerto['tipo'], string> = {
  puerto_caido: 'Sin datos',
  puerto_arriba: 'Volvió a dar datos',
  sin_comunicacion: 'Sin comunicación',
  comunicacion_restablecida: 'Comunicación restablecida',
}

function Detalle({ api, estacion, ahora, cerrar }: {
  api: Cliente; estacion: EstadoEstacion; ahora: number; cerrar: () => void
}) {
  const [eventos, setEventos] = useState<EventoPuerto[] | null>(null)
  const [error, setError] = useState('')
  const ref = useRef<HTMLElement>(null)
  const latido = estacion.ultimoLatido

  // Recargar los eventos cuando cambie algo de la estacion (nuevo latido).
  useEffect(() => {
    const semana = new Date(Date.now() - 7 * 86400_000).toISOString()
    api.get<{ eventos: EventoPuerto[] }>(
      `/api/puertos/eventos?estacion=${encodeURIComponent(estacion.nombre)}&desde=${encodeURIComponent(semana)}&limite=20`)
      .then((r) => { setEventos(r.eventos); setError('') })
      .catch((e: Error) => setError(e.message))
  }, [api, estacion.nombre, latido])

  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [estacion.id])

  const puertos = [...estacion.puertos].sort((a, b) => a.clave.localeCompare(b.clave))

  return (
    <section ref={ref} className="detalle" aria-label={`Detalle de ${estacion.nombre}`}>
      <div className="detalle-cabecera">
        <div>
          <h2 className="detalle-titulo">{estacion.nombre}</h2>
          <div className="cap">
            {estacion.sinComunicacion ? 'Sin comunicación · ' : ''}
            {latido ? `Último latido ${fechaHora(latido)} (hace ${desde(latido, ahora)})` : 'Nunca se ha conectado'}
          </div>
        </div>
        <button type="button" className="cerrar" onClick={cerrar} aria-label="Cerrar detalle"><IconX size={18} /></button>
      </div>

      <div className="detalle-columnas">
        <div>
          <h3 className="subtitulo">Puertos</h3>
          {puertos.length === 0 ? <p className="cap">Sin puertos reportados.</p> : (
            <ul className="lista">
              {puertos.map((p) => (
                <li key={p.clave}>
                  <span className={`punto ${estacion.sinComunicacion ? 'no' : p.estado === 'arriba' ? 'ok' : p.nivel === 'incumple' ? 'er' : 'wa'}`} />
                  <span className="lista-quien">{p.nombre || <span className="mono">{p.clave}</span>}
                    {p.nombre && <span className="mono cap"> {p.clave}</span>}</span>
                  <span className="cap lista-cuando">
                    {p.estado === 'arriba' ? 'con datos' : p.desde ? `sin datos · ${desde(p.desde, ahora)}` : 'sin datos'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="subtitulo">Últimos avisos</h3>
          {error && <div className="aviso-error">{error}</div>}
          {eventos === null ? <p className="cap">Cargando…</p> : eventos.length === 0 ? <p className="cap">Sin avisos en los últimos 7 días.</p> : (
            <ul className="lista">
              {eventos.map((ev) => (
                <li key={ev.id}>
                  <span className={`punto ${ev.tipo === 'puerto_arriba' || ev.tipo === 'comunicacion_restablecida' ? 'ok' : ev.tipo === 'sin_comunicacion' ? 'no' : 'wa'}`} />
                  <span className="lista-quien">{TEXTO_EVENTO[ev.tipo]}
                    {ev.clave && <span className="cap"> · {ev.nombre || <span className="mono">{ev.clave}</span>}</span>}</span>
                  <span className="cap lista-cuando">{fechaHora(ev.momento)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

function Vacio({ titulo, texto, children }: { titulo: string; texto: string; children?: ReactNode }) {
  return (
    <div className="vacio">
      <div style={{ fontWeight: 600, fontSize: 15 }}>{titulo}</div>
      <p className="cap" style={{ margin: '4px 0 12px', fontSize: 13 }}>{texto}</p>
      {children}
    </div>
  )
}

