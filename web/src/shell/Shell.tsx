import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconLogout, IconMoon, IconSun } from '@tabler/icons-react'
import { cliente, modulos as pedirModulos } from '../compartido/api'
import { aplicarTema, enviar, escucharModulo } from '../compartido/puente'
import type { Conjunto, Sesion, Tema, Usuario } from '../compartido/tipos'
import { Login } from './Login'
import { disponible, visiblesPara, type ModuloFront } from './modulos'
import { borrarConjunto, guardarConjunto, leerConjunto } from './almacen'
import { esEscritorio } from '../compartido/escritorio'
import { precargar } from './precarga'
import { guardarSesion, guardarTema, leerSesion, leerTema } from './preferencias'

const NOMBRE_ROL: Record<string, string> = { root: 'Root', admin: 'Administrador', tecnico: 'Técnico', user: 'Usuario' }

function iniciales(nombre: string) {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'
}

export function Shell() {
  const [sesion, setSesion] = useState<Sesion | null>(leerSesion)
  const [tema, setTema] = useState<Tema>(leerTema)

  useEffect(() => aplicarTema(tema), [tema])

  const entrar = (s: Sesion, recordar: boolean) => {
    guardarSesion(s, recordar)
    setSesion(s)
  }
  const salir = useCallback(() => {
    guardarSesion(null)
    borrarConjunto()
    setSesion(null)
  }, [])

  const cambiarTema = () => {
    const t: Tema = tema === 'claro' ? 'oscuro' : 'claro'
    guardarTema(t)
    setTema(t)
  }

  if (!sesion) return <Login alEntrar={entrar} />
  return <Escritorio sesion={sesion} tema={tema} cambiarTema={cambiarTema} salir={salir} />
}

function Escritorio({ sesion, tema, cambiarTema, salir }: {
  sesion: Sesion; tema: Tema; cambiarTema: () => void; salir: () => void
}) {
  const api = useMemo(() => cliente(sesion.token, salir), [sesion.token, salir])
  const [activos, setActivos] = useState<Set<string> | null>(null)
  const [errorModulos, setErrorModulos] = useState('')
  const [menu, setMenu] = useState(false)
  const marco = useRef<HTMLIFrameElement>(null)
  // El conjunto validado que se esta mirando. Vive aqui para que Validacion lo
  // cargue y Graficas o el Tablero lo vean, aunque cada uno sea otro iframe.
  const [datos, setDatos] = useState<Conjunto | null>(null)
  const [datosListos, setDatosListos] = useState(false)

  // Lo que se habia cargado antes de recargar la pagina.
  useEffect(() => {
    leerConjunto().then((c) => { setDatos((d) => d ?? c); setDatosListos(true) })
  }, [])

  // En la app de escritorio hay modulos propios (Archivos) y precarga.
  const [escritorio, setEscritorio] = useState(false)
  const rol = sesion.usuario.rol
  const visibles = useMemo(() => visiblesPara(rol, escritorio), [rol, escritorio])
  // Sin modulo en la direccion se abre Estaciones; si esa no esta (la app de
  // escritorio no la lleva), el primero disponible en cuanto se sabe cuales hay.
  const sinElegir = useRef(!location.hash.slice(1))
  const [actual, setActual] = useState<string>(() => location.hash.slice(1) || 'estaciones')
  const modulo: ModuloFront = visibles.find((m) => m.id === actual) ?? visibles[0]!
  useEffect(() => {
    if (!activos || !sinElegir.current) return
    sinElegir.current = false
    if (!disponible(modulo, activos)) {
      const primero = visibles.find((m) => disponible(m, activos))
      if (primero) setActual(primero.id)
    }
  }, [activos, modulo, visibles])

  // El token puede haber vencido o la sesion cerrado en otro lado.
  useEffect(() => {
    api.get<Usuario>('/api/auth/yo').catch(() => {})
  }, [api])

  useEffect(() => {
    if (!activos?.has('validacion')) return
    let vivo = true
    esEscritorio(api, { vivo: () => vivo }).then((e) => vivo && setEscritorio(e))
    return () => { vivo = false }
  }, [activos, api])

  // Precarga (solo escritorio): sin nada cargado —o con una precarga de una
  // sesion anterior—, lo que va del año de la base local. Ver precarga.ts.
  const datosRef = useRef<Conjunto | null>(null)
  datosRef.current = datos
  const propio = useRef<Conjunto | null>(null)
  useEffect(() => {
    if (!escritorio || !datosListos) return
    const vigente = () => {
      const d = datosRef.current
      return d === null || d === propio.current || d.origen.startsWith('Base local · lo que va de')
    }
    if (!vigente()) return
    return precargar(api, (c) => {
      propio.current = c
      setDatos(c)
      guardarConjunto(c)
      const destino = marco.current?.contentWindow
      if (destino) enviar(destino, { tipo: 'datos', datos: c })
    }, vigente)
    // Una vez por sesion de la ventana: no al cambiar de datos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escritorio, datosListos, api])

  useEffect(() => {
    pedirModulos()
      .then((r) => setActivos(new Set(r.modulos.filter((m) => m.estado === 'activo').map((m) => m.nombre))))
      .catch((e: Error) => setErrorModulos(e.message))
  }, [])

  useEffect(() => {
    history.replaceState(null, '', `#${modulo.id}`)
    setMenu(false)
  }, [modulo.id])

  // El menu del usuario se cierra con Escape, con un clic fuera de el, y al
  // hacer clic dentro del modulo: ese clic ocurre en el iframe y no llega
  // aqui, pero la ventana del shell pierde el foco (blur).
  useEffect(() => {
    if (!menu) return
    const cerrar = () => setMenu(false)
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && cerrar()
    const fuera = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.usuario')) cerrar()
    }
    window.addEventListener('keydown', tecla)
    window.addEventListener('mousedown', fuera)
    window.addEventListener('blur', cerrar)
    return () => {
      window.removeEventListener('keydown', tecla)
      window.removeEventListener('mousedown', fuera)
      window.removeEventListener('blur', cerrar)
    }
  }, [menu])

  // Entrega de sesion y datos al modulo cuando avisa que cargo.
  useEffect(() => escucharModulo(() => marco.current, (m) => {
    const destino = marco.current?.contentWindow
    if (m.tipo === 'listo' && destino) {
      enviar(destino, { tipo: 'sesion', sesion, tema })
      enviar(destino, { tipo: 'datos', datos })
    }
    if (m.tipo === 'sesion-vencida') salir()
    if (m.tipo === 'guardar-datos') {
      setDatos(m.datos)
      if (m.datos) guardarConjunto(m.datos)
      else borrarConjunto()
    }
    if (m.tipo === 'ir' && visibles.some((v) => v.id === m.modulo)) setActual(m.modulo)
  }), [sesion, tema, salir, datos, visibles])

  // Datos recuperados despues de que el modulo ya cargo: se le mandan.
  useEffect(() => {
    const destino = marco.current?.contentWindow
    if (datosListos && destino) enviar(destino, { tipo: 'datos', datos })
  }, [datosListos])

  // Cambio de tema: el modulo abierto lo aplica sin recargar.
  useEffect(() => {
    const destino = marco.current?.contentWindow
    if (destino) enviar(destino, { tipo: 'tema', tema })
  }, [tema])

  async function cerrarSesion() {
    setMenu(false)
    await api.post('/api/auth/salir').catch(() => {})
    salir()
  }

  const listo = activos !== null && disponible(modulo, activos)

  return (
    <div className="shell">
      <nav className="riel" aria-label="Módulos">
        <div className="marca">VA</div>
        {visibles.map((m) => {
          const ok = activos !== null && disponible(m, activos)
          const Ico = m.icono
          return (
            <button key={m.id} type="button"
              className={`riel-boton${m.id === modulo.id ? ' activo' : ''}${ok ? '' : ' en-proceso'}`}
              data-etiqueta={ok ? m.nombre : `${m.nombre} · en proceso`}
              aria-label={ok ? m.nombre : `${m.nombre} (en proceso)`}
              aria-current={m.id === modulo.id ? 'page' : undefined}
              onClick={() => setActual(m.id)}>
              <Ico size={19} stroke={1.7} />
            </button>
          )
        })}

        <button type="button" className="riel-boton abajo" onClick={cambiarTema}
          data-etiqueta={tema === 'claro' ? 'Modo oscuro' : 'Modo claro'}
          aria-label={tema === 'claro' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}>
          {tema === 'claro' ? <IconMoon size={19} stroke={1.7} /> : <IconSun size={19} stroke={1.7} />}
        </button>
        <div className="usuario">
          <button type="button" className="avatar" onClick={() => setMenu(!menu)}
            aria-label={`Cuenta de ${sesion.usuario.nombre}`} aria-expanded={menu}>
            {iniciales(sesion.usuario.nombre)}
          </button>
          {menu && (
            <div className="menu-usuario" role="menu">
              <div style={{ fontWeight: 600 }}>{sesion.usuario.nombre}</div>
              <div className="cap">{sesion.usuario.correo}</div>
              <div className="cap" style={{ marginBottom: 10 }}>{NOMBRE_ROL[sesion.usuario.rol]}</div>
              <button type="button" className="boton" role="menuitem" onClick={cerrarSesion}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <IconLogout size={16} /> Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="contenido">
        {errorModulos && <div className="aviso-error" style={{ margin: 20 }}>{errorModulos}</div>}
        {listo && modulo.pagina ? (
          <iframe key={modulo.id} ref={marco} src={modulo.pagina} title={modulo.nombre} className="marco" />
        ) : activos !== null ? (
          <EnProceso modulo={modulo} />
        ) : null}
      </main>
    </div>
  )
}

// Un modulo en proceso no carga iframe: solo lo dice.
function EnProceso({ modulo }: { modulo: ModuloFront }) {
  const Ico = modulo.icono
  return (
    <div className="en-proceso-caja">
      <Ico size={28} stroke={1.5} />
      <h1 className="titulo" style={{ fontSize: 18 }}>{modulo.nombre}</h1>
      <p className="cap" style={{ fontSize: 13, maxWidth: 340, textAlign: 'center', margin: 0 }}>
        Este módulo está en proceso. Aparecerá aquí en cuanto se integre.
      </p>
    </div>
  )
}
