// Arranque comun de un modulo (iframe): se conecta con el shell, espera la
// sesion y le pasa al componente lo que necesita. Cada m/<modulo>/main.tsx
// solo llama a montarModulo(SuComponente).

import { StrictMode, useMemo, useState, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import './fuentes'
import { cliente, type Cliente } from './api'
import { conectarConShell } from './puente'
import type { Conjunto, Sesion, Usuario } from './tipos'

export interface PropsModulo {
  api: Cliente
  usuario: Usuario
  token: string
  avisarVencida: () => void
  datos: Conjunto | null
  // Sube cada vez que el shell manda datos (no cuando este modulo los guarda):
  // quien guarde estado propio a partir de `datos` puede reiniciarse con ella.
  versionDatos: number
  guardarDatos: (d: Conjunto | null) => void
  ir: (modulo: string) => void
}

export function montarModulo(Componente: ComponentType<PropsModulo>) {
  // La conexion se abre una sola vez, fuera de React (StrictMode repite efectos).
  let alSesion: (s: Sesion) => void = () => {}
  let alDatos: (d: Conjunto | null) => void = () => {}
  let sesionPendiente: Sesion | null = null
  let datosPendientes: Conjunto | null = null
  let version = 0
  const conexion = conectarConShell(
    (s) => { sesionPendiente = s; alSesion(s) },
    (d) => { datosPendientes = d; version++; alDatos(d) },
  )

  function Modulo() {
    const [sesion, setSesion] = useState<Sesion | null>(sesionPendiente)
    const [datos, setDatos] = useState<Conjunto | null>(datosPendientes)
    const [versionDatos, setVersionDatos] = useState(version)
    alSesion = setSesion
    alDatos = (d) => { setDatos(d); setVersionDatos(version) }
    const api = useMemo(
      () => (sesion ? cliente(sesion.token, () => conexion?.avisarVencida()) : null),
      [sesion],
    )

    if (!conexion) {
      return (
        <div style={{ padding: 24 }}>
          <p className="cap">Este módulo se abre desde el validador. <a href="/">Ir al validador</a></p>
        </div>
      )
    }
    if (!api || !sesion) return null
    return (
      <Componente api={api} usuario={sesion.usuario} token={sesion.token} avisarVencida={conexion.avisarVencida}
        datos={datos} versionDatos={versionDatos}
        guardarDatos={(d) => { setDatos(d); conexion.guardarDatos(d) }}
        ir={conexion.ir} />
    )
  }

  createRoot(document.getElementById('raiz')!).render(
    <StrictMode>
      <Modulo />
    </StrictMode>,
  )
}

// Roles que pueden editar el inventario (doc, seccion 5).
export const puedeEditarInventario = (u: Usuario) => u.rol !== 'user'
export const esAdmin = (u: Usuario) => u.rol === 'root' || u.rol === 'admin'
