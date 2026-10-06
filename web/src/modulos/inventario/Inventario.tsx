import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { IconPlus, IconSearch } from '@tabler/icons-react'
import { ErrorApi, type Cliente } from '../../compartido/api'
import { puedeEditarInventario, type PropsModulo } from '../../compartido/modulo'
import { fechaHora } from '../../compartido/tiempo'

interface Equipo {
  id: number
  noPieza: string
  resguardante: string
  anioAdquisicion: number | null
  tipo: string
  parametro: string
  marca: string
  modelo: string
  equipo: string
  numeroSerie: string | null
  conexion: string | null
  fechaUltimaActualizacion: string
  estatus: string
  comentarios: string
  idEstacion: number | null
  estacion: string | null
  complementos: number[]
}

interface Estacion { id: number; nombre: string; ubicacion: string; estatus: string; equipos: number }

interface Catalogos { tipos: string[]; estatusEquipo: string[]; conexiones: string[]; estatusEstacion: string[] }

const mensaje = (e: unknown) => (e instanceof ErrorApi ? e.message : 'Algo salió mal')

// Color del estatus (solo el punto): verde bien, ambar atencion, rojo falla, gris fuera.
const COLOR_EQUIPO: Record<string, string> = {
  'Activo': 'ok', 'Activo - Requiere atención': 'wa', 'No Activo - Falla': 'er', 'Fuera de operación': 'no', 'Baja': 'no',
}
const COLOR_ESTACION: Record<string, string> = {
  'Disponible': 'ok', 'Sin Energía': 'wa', 'Sin Internet': 'wa', 'Dañada': 'er', 'En Reparación': 'wa', 'Dada de Baja': 'no',
}

const nombreEquipo = (e: Equipo) => e.equipo || [e.marca, e.modelo].filter(Boolean).join(' ') || `Equipo #${e.id}`

export function Inventario({ api, usuario }: PropsModulo) {
  const editar = puedeEditarInventario(usuario)
  const [vista, setVista] = useState<'equipos' | 'estaciones'>('equipos')
  const [equipos, setEquipos] = useState<Equipo[] | null>(null)
  const [estaciones, setEstaciones] = useState<Estacion[] | null>(null)
  const [cat, setCat] = useState<Catalogos | null>(null)
  const [error, setError] = useState('')
  const [ficha, setFicha] = useState<Equipo | 'nuevo' | null>(null)
  const [fichaEst, setFichaEst] = useState<Estacion | 'nueva' | null>(null)

  const cargar = () =>
    Promise.all([
      api.get<{ equipos: Equipo[] }>('/api/inventario/equipos'),
      api.get<{ estaciones: Estacion[] }>('/api/inventario/estaciones'),
      api.get<Catalogos>('/api/inventario/catalogos'),
    ]).then(([e, s, c]) => {
      setEquipos(e.equipos); setEstaciones(s.estaciones); setCat(c); setError('')
    }).catch((e) => setError(mensaje(e)))
  useEffect(() => { cargar() }, [])

  if (!equipos || !estaciones || !cat) {
    return <div className="pagina">{error ? <div className="aviso-error">{error}</div> : <p className="cap">Cargando inventario…</p>}</div>
  }

  const enAlmacen = equipos.filter((e) => e.idEstacion === null).length
  const conProblema = equipos.filter((e) => e.estatus !== 'Activo' && e.estatus !== 'Baja').length

  return (
    <div className="pagina">
      <header className="cabecera">
        <h1 className="titulo">Inventario</h1>
        <div className="acciones">
          <button type="button" className={`boton${vista === 'equipos' ? ' elegido' : ''}`} onClick={() => setVista('equipos')}>Equipos · {equipos.length}</button>
          <button type="button" className={`boton${vista === 'estaciones' ? ' elegido' : ''}`} onClick={() => setVista('estaciones')}>Estaciones · {estaciones.length}</button>
          {editar && (
            <button type="button" className="boton" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => (vista === 'equipos' ? setFicha('nuevo') : setFichaEst('nueva'))}>
              <IconPlus size={15} /> {vista === 'equipos' ? 'Nuevo equipo' : 'Nueva estación'}
            </button>
          )}
        </div>
      </header>

      {error && <div className="aviso-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="numeros">
        <div className="numero"><div className="etq">Equipos</div><div className="valor">{equipos.length}</div></div>
        <div className="numero"><div className="etq">En estaciones</div><div className="valor">{equipos.length - enAlmacen}</div></div>
        <div className="numero"><div className="etq">En almacén</div><div className="valor">{enAlmacen}</div></div>
        <div className="numero"><div className="etq">Requieren atención o con falla</div><div className="valor" style={{ color: conProblema ? 'var(--wa)' : undefined }}>{conProblema}</div></div>
      </div>

      {vista === 'equipos' ? (
        <>
          {ficha && (
            <FichaEquipo api={api} cat={cat} estaciones={estaciones} equipos={equipos} editar={editar}
              equipo={ficha === 'nuevo' ? null : ficha}
              cerrar={() => setFicha(null)} guardado={() => { setFicha(null); cargar() }} />
          )}
          <TablaEquipos equipos={equipos} estaciones={estaciones} cat={cat} abrir={setFicha} />
        </>
      ) : (
        <>
          {fichaEst && (
            <FichaEstacion api={api} cat={cat} editar={editar} estacion={fichaEst === 'nueva' ? null : fichaEst}
              cerrar={() => setFichaEst(null)} guardado={() => { setFichaEst(null); cargar() }} />
          )}
          {estaciones.length === 0 ? (
            <div className="vacio"><b>Sin estaciones</b><span className="cap">Da de alta las estaciones para ubicar los equipos.</span></div>
          ) : (
            <div className="tabla-caja">
              <table className="tabla">
                <thead><tr><th>Estación</th><th>Ubicación</th><th>Estatus</th><th className="num">Equipos</th></tr></thead>
                <tbody>
                  {estaciones.map((s) => (
                    <tr key={s.id} className="clic" tabIndex={0} onClick={() => setFichaEst(s)} onKeyDown={(e) => e.key === 'Enter' && setFichaEst(s)}>
                      <td style={{ fontWeight: 600 }}>{s.nombre}</td>
                      <td className="cap">{s.ubicacion || '—'}</td>
                      <td><span className="estado"><span className={`punto ${COLOR_ESTACION[s.estatus] ?? 'no'}`} />{s.estatus}</span></td>
                      <td className="num">{s.equipos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TablaEquipos({ equipos, estaciones, cat, abrir }: {
  equipos: Equipo[]; estaciones: Estacion[]; cat: Catalogos; abrir: (e: Equipo) => void
}) {
  const [texto, setTexto] = useState('')
  const [donde, setDonde] = useState('todas')
  const [estatus, setEstatus] = useState('todos')

  const visibles = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return equipos.filter((e) =>
      (!t || [e.equipo, e.marca, e.modelo, e.numeroSerie, e.noPieza, e.resguardante, e.parametro]
        .some((v) => v?.toLowerCase().includes(t))) &&
      (donde === 'todas' || (donde === 'almacen' ? e.idEstacion === null : String(e.idEstacion) === donde)) &&
      (estatus === 'todos' || e.estatus === estatus))
  }, [equipos, texto, donde, estatus])

  return (
    <>
      <div className="form" style={{ marginBottom: 12, gridTemplateColumns: 'minmax(220px, 2fr) repeat(2, minmax(160px, 1fr))' }}>
        <label className="campo" style={{ position: 'relative' }}>
          <span className="sr" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Buscar</span>
          <IconSearch size={15} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--tx3)' }} aria-hidden="true" />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Equipo, modelo, serie, resguardante…" style={{ paddingLeft: 32 }} />
        </label>
        <label className="campo"><select value={donde} onChange={(e) => setDonde(e.target.value)} aria-label="Ubicación">
          <option value="todas">Todas las ubicaciones</option>
          <option value="almacen">Almacén</option>
          {estaciones.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select></label>
        <label className="campo"><select value={estatus} onChange={(e) => setEstatus(e.target.value)} aria-label="Estatus">
          <option value="todos">Todos los estatus</option>
          {cat.estatusEquipo.map((s) => <option key={s}>{s}</option>)}
        </select></label>
      </div>

      {equipos.length === 0 ? (
        <div className="vacio"><b>Sin equipos</b><span className="cap">Da de alta el primero con «Nuevo equipo».</span></div>
      ) : visibles.length === 0 ? (
        <div className="vacio"><b>Nada coincide</b><span className="cap">Prueba con otra búsqueda o filtro.</span></div>
      ) : (
        <div className="tabla-caja">
          <table className="tabla">
            <thead><tr><th>Equipo</th><th>Tipo</th><th>Parámetro</th><th>N. serie</th><th>Ubicación</th><th>Estatus</th><th>Actualizado</th></tr></thead>
            <tbody>
              {visibles.map((e) => (
                <tr key={e.id} className="clic" tabIndex={0} onClick={() => abrir(e)} onKeyDown={(k) => k.key === 'Enter' && abrir(e)}>
                  <td><div style={{ fontWeight: 600 }}>{nombreEquipo(e)}</div>
                    <div className="cap">{[e.marca, e.modelo].filter(Boolean).join(' · ')}{e.complementos.length ? ` · ${e.complementos.length} complemento${e.complementos.length > 1 ? 's' : ''}` : ''}</div></td>
                  <td>{e.tipo}</td>
                  <td>{e.parametro || <span className="cap">—</span>}</td>
                  <td>{e.numeroSerie ? <span className="mono">{e.numeroSerie}</span> : <span className="cap">—</span>}</td>
                  <td>{e.estacion ?? <span className="cap">Almacén</span>}</td>
                  <td><span className="estado"><span className={`punto ${COLOR_EQUIPO[e.estatus] ?? 'no'}`} />{e.estatus}</span></td>
                  <td className="cap" style={{ whiteSpace: 'nowrap' }}>{fechaHora(e.fechaUltimaActualizacion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

type Datos = Omit<Equipo, 'id' | 'fechaUltimaActualizacion' | 'idEstacion' | 'estacion' | 'complementos'>

function FichaEquipo({ api, cat, estaciones, equipos, editar, equipo, cerrar, guardado }: {
  api: Cliente; cat: Catalogos; estaciones: Estacion[]; equipos: Equipo[]; editar: boolean
  equipo: Equipo | null; cerrar: () => void; guardado: () => void
}) {
  const [d, setD] = useState<Datos>(() => ({
    noPieza: equipo?.noPieza ?? '', resguardante: equipo?.resguardante ?? '', anioAdquisicion: equipo?.anioAdquisicion ?? null,
    tipo: equipo?.tipo ?? cat.tipos[0]!, parametro: equipo?.parametro ?? '', marca: equipo?.marca ?? '',
    modelo: equipo?.modelo ?? '', equipo: equipo?.equipo ?? '', numeroSerie: equipo?.numeroSerie ?? '',
    conexion: equipo?.conexion ?? '', estatus: equipo?.estatus ?? cat.estatusEquipo[0]!, comentarios: equipo?.comentarios ?? '',
  }))
  const [ubicacion, setUbicacion] = useState<string>(equipo?.idEstacion ? String(equipo.idEstacion) : 'almacen')
  const [comps, setComps] = useState<number[]>(equipo?.complementos ?? [])
  const [buscarComp, setBuscarComp] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const set = <K extends keyof Datos>(k: K, v: Datos[K]) => { setD({ ...d, [k]: v }); setError('') }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!d.equipo.trim() && !d.modelo.trim()) return setError('Escribe al menos el equipo o el modelo')
    setEnviando(true)
    setError('')
    try {
      const cuerpo = { ...d, numeroSerie: d.numeroSerie || null, conexion: d.conexion || null }
      const guardadoEq = equipo
        ? await api.put<Equipo>(`/api/inventario/equipos/${equipo.id}`, cuerpo)
        : await api.post<Equipo>('/api/inventario/equipos', cuerpo)
      const idEstacion = ubicacion === 'almacen' ? null : Number(ubicacion)
      if (idEstacion !== (guardadoEq.idEstacion ?? null)) {
        await api.put(`/api/inventario/equipos/${guardadoEq.id}/estacion`, { idEstacion })
      }
      const antes = [...(guardadoEq.complementos ?? [])].sort().join()
      if ([...comps].sort().join() !== antes) {
        await api.put(`/api/inventario/equipos/${guardadoEq.id}/complementos`, { idEquipos: comps })
      }
      guardado()
    } catch (err) {
      setError(mensaje(err))
      setEnviando(false)
    }
  }

  const candidatos = equipos.filter((x) => x.id !== equipo?.id &&
    (!buscarComp || nombreEquipo(x).toLowerCase().includes(buscarComp.toLowerCase()) || x.numeroSerie?.toLowerCase().includes(buscarComp.toLowerCase())))

  return (
    <form className="panel" style={{ marginBottom: 16 }} onSubmit={enviar} noValidate>
      <h2 className="h2">{equipo ? nombreEquipo(equipo) : 'Nuevo equipo'}</h2>
      {equipo && <p className="cap" style={{ margin: '-6px 0 12px' }}>Última actualización {fechaHora(equipo.fechaUltimaActualizacion)}</p>}
      <fieldset disabled={!editar} style={{ border: 'none', margin: 0, padding: 0 }}>
        <div className="form">
          <label className="campo">Equipo<input value={d.equipo} onChange={(e) => set('equipo', e.target.value)} placeholder="Analizador de ozono" /></label>
          <label className="campo">Tipo<select value={d.tipo} onChange={(e) => set('tipo', e.target.value)}>{cat.tipos.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="campo">Parámetro<input value={d.parametro} onChange={(e) => set('parametro', e.target.value)} placeholder="O3" /></label>
          <label className="campo">Marca<input value={d.marca} onChange={(e) => set('marca', e.target.value)} placeholder="ACOEM" /></label>
          <label className="campo">Modelo<input value={d.modelo} onChange={(e) => set('modelo', e.target.value)} placeholder="Serinus 10" /></label>
          <label className="campo">N. serie<input value={d.numeroSerie ?? ''} onChange={(e) => set('numeroSerie', e.target.value)} placeholder="24-0305" /></label>
          <label className="campo">No. pieza<input value={d.noPieza} onChange={(e) => set('noPieza', e.target.value)} /></label>
          <label className="campo">Resguardante<input value={d.resguardante} onChange={(e) => set('resguardante', e.target.value)} /></label>
          <label className="campo">Año de adquisición
            <input type="number" min={1980} max={2100} value={d.anioAdquisicion ?? ''}
              onChange={(e) => set('anioAdquisicion', e.target.value ? Number(e.target.value) : null)} />
          </label>
          <label className="campo">Conexión
            <input value={d.conexion ?? ''} onChange={(e) => set('conexion', e.target.value)} list="conexiones" placeholder="TCP/IP" />
            <datalist id="conexiones">{cat.conexiones.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="campo">Estatus<select value={d.estatus} onChange={(e) => set('estatus', e.target.value)}>{cat.estatusEquipo.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="campo">Ubicación<select value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}>
            <option value="almacen">Almacén</option>
            {estaciones.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select></label>
          <label className="campo ancho">Comentarios<textarea value={d.comentarios} onChange={(e) => set('comentarios', e.target.value)} /></label>
        </div>

        <div style={{ marginTop: 14 }}>
          <div className="subtitulo">Complementos {comps.length > 0 && `· ${comps.length}`}</div>
          {equipos.length <= 1 ? <p className="cap">No hay otros equipos para ligar.</p> : (
            <>
              <input value={buscarComp} onChange={(e) => setBuscarComp(e.target.value)} placeholder="Buscar equipo…"
                aria-label="Buscar complemento" style={{ height: 34, padding: '0 10px', borderRadius: 10, border: '1px solid var(--boton-borde)', background: 'var(--bg)', width: '100%', maxWidth: 320, marginBottom: 8 }} />
              <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--linea)', borderRadius: 10, padding: '4px 10px' }}>
                {candidatos.map((x) => (
                  <label key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', fontSize: 13 }}>
                    <input type="checkbox" checked={comps.includes(x.id)}
                      onChange={(e) => setComps(e.target.checked ? [...comps, x.id] : comps.filter((c) => c !== x.id))} />
                    {nombreEquipo(x)}{x.numeroSerie && <span className="mono cap">{x.numeroSerie}</span>}
                    <span className="cap" style={{ marginLeft: 'auto' }}>{x.estacion ?? 'Almacén'}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </fieldset>

      <div className="form-pie">
        {error && <p className="error-campo" role="alert" style={{ marginRight: 'auto' }}>{error}</p>}
        <button type="button" className="boton" onClick={cerrar}>{editar ? 'Cancelar' : 'Cerrar'}</button>
        {editar && <button type="submit" className="boton primario" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar'}</button>}
      </div>
    </form>
  )
}

function FichaEstacion({ api, cat, editar, estacion, cerrar, guardado }: {
  api: Cliente; cat: Catalogos; editar: boolean; estacion: Estacion | null; cerrar: () => void; guardado: () => void
}) {
  const [nombre, setNombre] = useState(estacion?.nombre ?? '')
  const [ubicacion, setUbicacion] = useState(estacion?.ubicacion ?? '')
  const [estatus, setEstatus] = useState(estacion?.estatus ?? cat.estatusEstacion[0]!)
  const [error, setError] = useState('')

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return setError('Escribe el nombre')
    try {
      const cuerpo = { nombre, ubicacion, estatus }
      if (estacion) await api.put(`/api/inventario/estaciones/${estacion.id}`, cuerpo)
      else await api.post('/api/inventario/estaciones', cuerpo)
      guardado()
    } catch (err) {
      setError(mensaje(err))
    }
  }

  return (
    <form className="panel" style={{ marginBottom: 16 }} onSubmit={enviar} noValidate>
      <h2 className="h2">{estacion ? estacion.nombre : 'Nueva estación'}</h2>
      <fieldset disabled={!editar} style={{ border: 'none', margin: 0, padding: 0 }}>
        <div className="form">
          <label className="campo">Nombre<input value={nombre} onChange={(e) => { setNombre(e.target.value); setError('') }} placeholder="Las Pintas" /></label>
          <label className="campo">Estatus<select value={estatus} onChange={(e) => setEstatus(e.target.value)}>{cat.estatusEstacion.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="campo ancho">Ubicación<input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}
            placeholder="Av Enrique Díaz de León Nte 1215, Mezquitan Country, 44260 Guadalajara, Jal." /></label>
        </div>
      </fieldset>
      <div className="form-pie">
        {error && <p className="error-campo" role="alert" style={{ marginRight: 'auto' }}>{error}</p>}
        <button type="button" className="boton" onClick={cerrar}>{editar ? 'Cancelar' : 'Cerrar'}</button>
        {editar && <button type="submit" className="boton primario">Guardar</button>}
      </div>
    </form>
  )
}
