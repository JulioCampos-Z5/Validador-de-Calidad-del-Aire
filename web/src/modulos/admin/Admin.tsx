import { useEffect, useState, type FormEvent } from 'react'
import { IconCopy, IconPlus } from '@tabler/icons-react'
import { ErrorApi, type Cliente } from '../../compartido/api'
import type { PropsModulo } from '../../compartido/modulo'
import type { Rol, Usuario } from '../../compartido/tipos'
import { desde, fechaHora } from '../../compartido/tiempo'

type Seccion = 'usuarios' | 'estaciones' | 'bitacora'

const ROLES: { valor: Rol; texto: string }[] = [
  { valor: 'root', texto: 'Root' },
  { valor: 'admin', texto: 'Administrador' },
  { valor: 'tecnico', texto: 'Técnico' },
  { valor: 'user', texto: 'Usuario (solo ve)' },
]
const textoRol = (r: Rol) => ROLES.find((x) => x.valor === r)?.texto ?? r

const mensaje = (e: unknown) => (e instanceof ErrorApi ? e.message : 'Algo salió mal')

export function Admin({ api, usuario }: PropsModulo) {
  const [seccion, setSeccion] = useState<Seccion>('usuarios')
  return (
    <div className="pagina">
      <header className="cabecera">
        <h1 className="titulo">Administración</h1>
        <div className="acciones" role="group" aria-label="Sección">
          {([['usuarios', 'Usuarios'], ['estaciones', 'Estaciones del detector'], ['bitacora', 'Bitácora']] as const).map(([id, t]) => (
            <button key={id} type="button" className={`boton${seccion === id ? ' elegido' : ''}`}
              aria-pressed={seccion === id} onClick={() => setSeccion(id)}>{t}</button>
          ))}
        </div>
      </header>
      {seccion === 'usuarios' && <Usuarios api={api} yo={usuario} />}
      {seccion === 'estaciones' && <EstacionesDetector api={api} />}
      {seccion === 'bitacora' && <Bitacora api={api} />}
    </div>
  )
}

// ---------------------------------------------------------------- usuarios

function Usuarios({ api, yo }: { api: Cliente; yo: Usuario }) {
  const [lista, setLista] = useState<(Usuario & { creado: string })[] | null>(null)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState<Usuario | 'nuevo' | null>(null)

  const cargar = () =>
    api.get<{ usuarios: (Usuario & { creado: string })[] }>('/api/usuarios')
      .then((r) => { setLista(r.usuarios); setError('') })
      .catch((e) => setError(mensaje(e)))
  useEffect(() => { cargar() }, [])

  return (
    <section className="seccion">
      <div className="cabecera" style={{ marginBottom: 10 }}>
        <p className="cap" style={{ margin: 0, fontSize: 13 }}>Root y administrador pueden todo; técnico edita el inventario; usuario solo ve.</p>
        <button type="button" className="boton" onClick={() => setEditando('nuevo')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconPlus size={15} /> Nuevo usuario</button>
      </div>
      {error && <div className="aviso-error" style={{ marginBottom: 12 }}>{error}</div>}
      {editando && (
        <FormUsuario api={api} yo={yo} usuario={editando === 'nuevo' ? null : editando}
          cerrar={() => setEditando(null)} guardado={() => { setEditando(null); cargar() }} />
      )}
      {lista === null ? <p className="cap">Cargando…</p> : (
        <div className="tabla-caja">
          <table className="tabla">
            <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estatus</th><th>Alta</th></tr></thead>
            <tbody>
              {lista.map((u) => (
                <tr key={u.id} className="clic" onClick={() => setEditando(u)} tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setEditando(u)}>
                  <td style={{ fontWeight: 600 }}>{u.nombre}{u.id === yo.id && <span className="cap"> · tú</span>}</td>
                  <td>{u.correo}</td>
                  <td>{textoRol(u.rol)}</td>
                  <td><span className="estado"><span className={`punto ${u.estatus === 'activo' ? 'ok' : 'no'}`} />{u.estatus === 'activo' ? 'Activo' : 'Inactivo'}</span></td>
                  <td className="cap">{fechaHora(u.creado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function FormUsuario({ api, yo, usuario, cerrar, guardado }: {
  api: Cliente; yo: Usuario; usuario: Usuario | null; cerrar: () => void; guardado: () => void
}) {
  const nuevo = usuario === null
  const [nombre, setNombre] = useState(usuario?.nombre ?? '')
  const [correo, setCorreo] = useState(usuario?.correo ?? '')
  const [rol, setRol] = useState<Rol>(usuario?.rol ?? 'user')
  const [estatus, setEstatus] = useState(usuario?.estatus ?? 'activo')
  const [contrasena, setContrasena] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return setError('Escribe el nombre')
    if (nuevo && !correo.trim()) return setError('Escribe el correo')
    if ((nuevo || contrasena) && contrasena.length < 10) return setError('La contraseña debe tener al menos 10 caracteres')
    setEnviando(true)
    setError('')
    try {
      if (nuevo) {
        await api.post('/api/usuarios', { nombre, correo, contrasena, rol })
      } else {
        const cambios: Record<string, string> = {}
        if (nombre !== usuario.nombre) cambios.nombre = nombre
        if (rol !== usuario.rol) cambios.rol = rol
        if (estatus !== usuario.estatus) cambios.estatus = estatus
        if (contrasena) cambios.contrasena = contrasena
        if (Object.keys(cambios).length) await api.patch(`/api/usuarios/${usuario.id}`, cambios)
      }
      guardado()
    } catch (err) {
      setError(mensaje(err))
      setEnviando(false)
    }
  }

  return (
    <form className="panel" style={{ marginBottom: 16 }} onSubmit={enviar} noValidate>
      <h2 className="h2">{nuevo ? 'Nuevo usuario' : `Editar a ${usuario.nombre}`}</h2>
      <div className="form">
        <label className="campo">Nombre<input value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
        <label className="campo">Correo
          <input type="email" value={correo} disabled={!nuevo} onChange={(e) => setCorreo(e.target.value)} placeholder="nombre@jalisco.gob.mx" />
        </label>
        <label className="campo">Rol
          <select value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
            {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.texto}</option>)}
          </select>
        </label>
        {!nuevo && (
          <label className="campo">Estatus
            <select value={estatus} disabled={usuario.id === yo.id} onChange={(e) => setEstatus(e.target.value)}>
              <option value="activo">Activo</option><option value="inactivo">Inactivo</option>
            </select>
          </label>
        )}
        <label className="campo">{nuevo ? 'Contraseña' : 'Nueva contraseña (opcional)'}
          <input type="password" autoComplete="new-password" value={contrasena} onChange={(e) => setContrasena(e.target.value)} placeholder="Al menos 10 caracteres" />
        </label>
      </div>
      {!nuevo && <p className="cap" style={{ margin: '10px 0 0' }}>Cambiar rol, estatus o contraseña cierra sus sesiones abiertas.</p>}
      <div className="form-pie">
        {error && <p className="error-campo" role="alert" style={{ marginRight: 'auto' }}>{error}</p>}
        <button type="button" className="boton" onClick={cerrar}>Cancelar</button>
        <button type="submit" className="boton primario" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  )
}

// ------------------------------------------------- estaciones del detector

interface EstacionDetector { id: number; nombre: string; activa: boolean; ultimoLatido: string | null; sinComunicacion: boolean }

function EstacionesDetector({ api }: { api: Cliente }) {
  const [lista, setLista] = useState<EstacionDetector[] | null>(null)
  const [error, setError] = useState('')
  const [nueva, setNueva] = useState(false)
  const [nombre, setNombre] = useState('')
  const [token, setToken] = useState<{ nombre: string; token: string } | null>(null)
  const [copiado, setCopiado] = useState(false)
  const ahora = Date.now()

  const cargar = () =>
    api.get<{ estaciones: EstacionDetector[] }>('/api/puertos/estaciones')
      .then((r) => { setLista(r.estaciones); setError('') })
      .catch((e) => setError(mensaje(e)))
  useEffect(() => { cargar() }, [])

  async function crear(e: FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return setError('Escribe el nombre de la estación')
    try {
      const r = await api.post<{ nombre: string; token: string }>('/api/puertos/estaciones', { nombre: nombre.trim() })
      setToken(r)
      setNueva(false)
      setNombre('')
      setCopiado(false)
      cargar()
    } catch (err) {
      setError(mensaje(err))
    }
  }

  return (
    <section className="seccion">
      <div className="cabecera" style={{ marginBottom: 10 }}>
        <p className="cap" style={{ margin: 0, fontSize: 13 }}>Cada estación tiene su token para que el detector de puertos le avise a la API.</p>
        <button type="button" className="boton" onClick={() => { setNueva(true); setToken(null) }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconPlus size={15} /> Nueva estación</button>
      </div>
      {error && <div className="aviso-error" style={{ marginBottom: 12 }}>{error}</div>}
      {nueva && (
        <form className="panel" style={{ marginBottom: 16 }} onSubmit={crear} noValidate>
          <h2 className="h2">Nueva estación</h2>
          <div className="form"><label className="campo">Nombre<input value={nombre} onChange={(e) => { setNombre(e.target.value); setError('') }} placeholder="Las Pintas" /></label></div>
          <div className="form-pie">
            <button type="button" className="boton" onClick={() => setNueva(false)}>Cancelar</button>
            <button type="submit" className="boton primario">Crear y ver token</button>
          </div>
        </form>
      )}
      {token && (
        <div className="panel" style={{ marginBottom: 16, borderColor: 'var(--wa-linea)' }}>
          <h2 className="h2">Token de {token.nombre}</h2>
          <p className="cap" style={{ margin: 0, fontSize: 13 }}>Cópialo ahora: no se vuelve a mostrar. Va en el detector como <span className="mono">-api-token</span>.</p>
          <div className="token">{token.token}</div>
          <div className="form-pie" style={{ marginTop: 4 }}>
            <button type="button" className="boton" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => navigator.clipboard?.writeText(token.token).then(() => setCopiado(true))}>
              <IconCopy size={15} /> {copiado ? 'Copiado' : 'Copiar'}
            </button>
            <button type="button" className="boton" onClick={() => setToken(null)}>Listo</button>
          </div>
        </div>
      )}
      {lista === null ? <p className="cap">Cargando…</p> : lista.length === 0 ? (
        <div className="vacio"><b>Sin estaciones</b><span className="cap">Crea la primera para conectar su detector.</span></div>
      ) : (
        <div className="tabla-caja">
          <table className="tabla">
            <thead><tr><th>Estación</th><th>Comunicación</th><th>Último latido</th></tr></thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 600 }}>{e.nombre}</td>
                  <td><span className="estado"><span className={`punto ${!e.ultimoLatido ? 'no' : e.sinComunicacion ? 'er' : 'ok'}`} />
                    {!e.ultimoLatido ? 'Nunca se ha conectado' : e.sinComunicacion ? 'Sin comunicación' : 'Comunicada'}</span></td>
                  <td className="cap">{e.ultimoLatido ? `${fechaHora(e.ultimoLatido)} · hace ${desde(e.ultimoLatido, ahora)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- bitacora

interface Registro { id: number; usuario?: string; fecha: string; accion: string; detalle?: Record<string, unknown> }

const ACCIONES: Record<string, string> = {
  login: 'Inició sesión', logout: 'Cerró sesión', login_fallido: 'Intento de entrada fallido',
  usuario_creado: 'Creó un usuario', usuario_actualizado: 'Modificó un usuario',
  estacion_creada: 'Dio de alta una estación del detector', analisis: 'Usó el análisis',
  equipo_creado: 'Dio de alta un equipo', equipo_actualizado: 'Modificó un equipo', equipo_movido: 'Movió un equipo',
  complementos_actualizados: 'Cambió complementos', estacion_inventario_creada: 'Dio de alta una estación (inventario)',
  estacion_inventario_actualizada: 'Modificó una estación (inventario)',
}

function resumenDetalle(r: Registro): string {
  const d = r.detalle ?? {}
  if (r.accion === 'equipo_movido') return `${d.de} → ${d.a}`
  if (r.accion === 'analisis') return String(d.ruta ?? '')
  if ('correo' in d) return String(d.correo)
  if ('nombre' in d) return String(d.nombre)
  if ('ip' in d) return `IP ${d.ip}`
  return ''
}

function Bitacora({ api }: { api: Cliente }) {
  const [regs, setRegs] = useState<Registro[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api.get<{ registros: Registro[] }>('/api/bitacora?limite=300')
      .then((r) => setRegs(r.registros)).catch((e) => setError(mensaje(e)))
  }, [api])

  if (error) return <div className="aviso-error">{error}</div>
  if (regs === null) return <p className="cap">Cargando…</p>
  return (
    <div className="tabla-caja">
      <table className="tabla">
        <thead><tr><th>Fecha</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead>
        <tbody>
          {regs.map((r) => (
            <tr key={r.id}>
              <td className="cap" style={{ whiteSpace: 'nowrap' }}>{fechaHora(r.fecha)}</td>
              <td>{r.usuario || <span className="cap">Sistema</span>}</td>
              <td>{ACCIONES[r.accion] ?? r.accion}</td>
              <td className="cap">{resumenDetalle(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
