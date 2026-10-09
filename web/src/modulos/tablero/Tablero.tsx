import { useEffect, useState, type ReactNode } from 'react'
import { IconArrowRight } from '@tabler/icons-react'
import { modulos as pedirModulos } from '../../compartido/api'
import { disponible, visiblesPara } from '../../compartido/modulos'
import { esEscritorio } from '../../compartido/escritorio'
import type { PropsModulo } from '../../compartido/modulo'
import type { EstadoEstacion, EventoPuerto } from '../../compartido/tipos'
import { fechaHora } from '../../compartido/tiempo'

interface Equipo { estatus: string; idEstacion: number | null }

const TEXTO_EVENTO: Record<EventoPuerto['tipo'], string> = {
  puerto_caido: 'Sin datos', puerto_arriba: 'Volvió a dar datos',
  sin_comunicacion: 'Sin comunicación', comunicacion_restablecida: 'Comunicación restablecida',
}

function saludo() {
  const h = Number(new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', hour: 'numeric', hour12: false }).format(new Date()))
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
}

export function Tablero({ api, usuario, datos, ir }: PropsModulo) {
  const [activos, setActivos] = useState<Set<string> | null>(null)
  const [red, setRed] = useState<EstadoEstacion[] | null>(null)
  const [eventos, setEventos] = useState<EventoPuerto[]>([])
  const [equipos, setEquipos] = useState<Equipo[] | null>(null)
  const [escritorio, setEscritorio] = useState(false)

  useEffect(() => {
    pedirModulos().then((r) => setActivos(new Set(r.modulos.filter((m) => m.estado === 'activo').map((m) => m.nombre)))).catch(() => setActivos(new Set()))
  }, [])

  useEffect(() => {
    if (!activos?.has('validacion')) return
    let vivo = true
    esEscritorio(api, { vivo: () => vivo }).then((e) => vivo && setEscritorio(e))
    return () => { vivo = false }
  }, [activos, api])

  useEffect(() => {
    if (!activos) return
    if (activos.has('puertos')) {
      const traer = () => {
        api.get<{ estaciones: EstadoEstacion[] }>('/api/puertos/estado').then((r) => setRed(r.estaciones)).catch(() => {})
        api.get<{ eventos: EventoPuerto[] }>('/api/puertos/eventos?limite=8').then((r) => setEventos(r.eventos)).catch(() => {})
      }
      traer()
      const t = setInterval(traer, 15_000)
      if (activos.has('inventario')) api.get<{ equipos: Equipo[] }>('/api/inventario/equipos').then((r) => setEquipos(r.equipos)).catch(() => {})
      return () => clearInterval(t)
    }
    if (activos.has('inventario')) api.get<{ equipos: Equipo[] }>('/api/inventario/equipos').then((r) => setEquipos(r.equipos)).catch(() => {})
  }, [activos, api])

  const sinCom = red?.filter((e) => e.sinComunicacion).length ?? 0
  const caidos = red?.reduce((s, e) => s + (e.sinComunicacion ? 0 : e.puertos.filter((p) => p.estado === 'caido').length), 0) ?? 0
  const incumplen = red?.filter((e) => (e.sinComunicacion && e.nivel === 'incumple') || e.puertos.some((p) => p.estado === 'caido' && p.nivel === 'incumple')).length ?? 0
  const bien = red ? red.length - red.filter((e) => e.sinComunicacion || e.puertos.some((p) => p.estado === 'caido')).length : 0

  const r = datos?.respuesta
  // Accesos a las vistas: las que ve este rol, menos el propio Tablero.
  const accesos = visiblesPara(usuario.rol, escritorio).filter((m) => m.id !== 'tablero')

  return (
    <div className="pagina">
      <header className="cabecera">
        <div>
          <h1 className="titulo">{saludo()}, {usuario.nombre.split(' ')[0]}</h1>
          <div className="cap" style={{ marginTop: 2 }}>Resumen del validador</div>
        </div>
      </header>

      {activos?.has('puertos') && (
        <Bloque titulo="Red de monitoreo" accion="Ver estaciones" alPulsar={() => ir('estaciones')}>
          <div className="numeros" style={{ marginBottom: 0 }}>
            <Numero etq="Estaciones bien" valor={red ? `${bien} / ${red.length}` : '…'} />
            <Numero etq="Puertos sin datos" valor={red ? caidos : '…'} color={caidos ? 'var(--wa)' : undefined} />
            <Numero etq="Sin comunicación" valor={red ? sinCom : '…'} color={sinCom ? 'var(--tx3)' : undefined} />
            <Numero etq="Incumplen NOM" valor={red ? incumplen : '…'} color={incumplen ? 'var(--er)' : undefined} />
          </div>
        </Bloque>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <Bloque titulo="Datos cargados" accion={datos ? 'Ver gráficas' : 'Cargar datos'} alPulsar={() => ir(datos ? 'graficas' : 'validacion')}
          deshabilitado={!activos?.has('validacion')}>
          {!activos?.has('validacion') ? <p className="cap">El análisis (Python) no está conectado.</p> : r ? (
            <>
              <div style={{ fontWeight: 600 }}>{datos!.origen}</div>
              <div className="cap" style={{ marginBottom: 10 }}>Cargado {fechaHora(datos!.cargado)}</div>
              <div className="numeros" style={{ marginBottom: 0 }}>
                <Numero etq="Registros" valor={r.summary.total_registros.toLocaleString('es-MX')} />
                <Numero etq="Estaciones" valor={r.summary.estaciones} />
              </div>
            </>
          ) : <p className="cap" style={{ fontSize: 13 }}>Todavía no hay un periodo cargado en esta sesión.</p>}
        </Bloque>

        {activos?.has('puertos') && (
          <Bloque titulo="Últimos avisos de las estaciones">
            {eventos.length === 0 ? <p className="cap">Sin avisos recientes.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {eventos.map((ev) => (
                  <li key={ev.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--linea)', fontSize: 13 }}>
                    <span className={`punto ${ev.tipo === 'puerto_arriba' || ev.tipo === 'comunicacion_restablecida' ? 'ok' : ev.tipo === 'sin_comunicacion' ? 'no' : 'wa'}`} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <b style={{ fontWeight: 600 }}>{ev.estacion}</b> · {TEXTO_EVENTO[ev.tipo]}{ev.clave && <span className="cap"> · {ev.nombre || ev.clave}</span>}
                    </span>
                    <span className="cap" style={{ whiteSpace: 'nowrap' }}>{fechaHora(ev.momento)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Bloque>
        )}

        {activos?.has('inventario') && (
          <Bloque titulo="Inventario" accion="Ver inventario" alPulsar={() => ir('inventario')}>
            {!equipos ? <p className="cap">Cargando…</p> : (
              <div className="numeros" style={{ marginBottom: 0 }}>
                <Numero etq="Equipos" valor={equipos.length} />
                <Numero etq="En almacén" valor={equipos.filter((e) => e.idEstacion === null).length} />
                <Numero etq="Con falla" valor={equipos.filter((e) => e.estatus === 'No Activo - Falla').length}
                  color={equipos.some((e) => e.estatus === 'No Activo - Falla') ? 'var(--er)' : undefined} />
              </div>
            )}
          </Bloque>
        )}
      </div>

      <section className="seccion" aria-labelledby="accesos-titulo">
        <h2 id="accesos-titulo" className="subtitulo">Ir a</h2>
        <div className="accesos">
          {accesos.map((m) => {
            const ok = activos !== null && disponible(m, activos)
            const Ico = m.icono
            return (
              <button key={m.id} type="button" className="acceso" disabled={!ok}
                onClick={() => ir(m.id)} title={ok ? m.nombre : `${m.nombre} · en proceso`}>
                <Ico size={20} stroke={1.7} aria-hidden="true" />
                <span>{m.nombre}</span>
                {!ok && activos !== null && <span className="cap">En proceso</span>}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Bloque({ titulo, accion, alPulsar, deshabilitado, children }: {
  titulo: string; accion?: string; alPulsar?: () => void; deshabilitado?: boolean; children: ReactNode
}) {
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h2 className="h2" style={{ margin: 0 }}>{titulo}</h2>
        {accion && !deshabilitado && (
          <button type="button" className="boton" onClick={alPulsar}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', fontSize: 12.5 }}>
            {accion} <IconArrowRight size={14} />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function Numero({ etq, valor, color }: { etq: string; valor: ReactNode; color?: string }) {
  return <div className="numero"><div className="etq">{etq}</div><div className="valor" style={{ color }}>{valor}</div></div>
}
