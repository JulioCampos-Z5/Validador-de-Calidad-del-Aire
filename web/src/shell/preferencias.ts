// Lo que el shell recuerda en el navegador. Todo en try/catch: en una ventana
// privada o con el almacenamiento bloqueado, el acceso puede fallar y la app
// tiene que funcionar igual.

import type { Sesion, Tema } from '../compartido/tipos'

const CLAVE_SESION = 'validador.sesion'
const CLAVE_TEMA = 'validador.tema'

// La sesion va en sessionStorage: dura lo que la pestana, no queda en disco.
export function leerSesion(): Sesion | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(CLAVE_SESION) ?? 'null') as Sesion | null
    if (s && new Date(s.expira).getTime() > Date.now()) return s
  } catch {
    // sin almacenamiento: se pide login
  }
  return null
}

export function guardarSesion(s: Sesion | null) {
  try {
    if (s) sessionStorage.setItem(CLAVE_SESION, JSON.stringify(s))
    else sessionStorage.removeItem(CLAVE_SESION)
  } catch {
    // la sesion sigue en memoria mientras la pestana este abierta
  }
}

// Sin preferencia guardada, el tema sigue al sistema.
export function leerTema(): Tema {
  try {
    const t = localStorage.getItem(CLAVE_TEMA)
    if (t === 'claro' || t === 'oscuro') return t
  } catch {
    // sin almacenamiento: se usa el del sistema
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro'
}

export function guardarTema(t: Tema) {
  try {
    localStorage.setItem(CLAVE_TEMA, t)
  } catch {
    // no se recuerda, pero el cambio aplica
  }
}
