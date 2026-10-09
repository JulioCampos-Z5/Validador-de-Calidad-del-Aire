// Lo que el shell recuerda en el navegador. Todo en try/catch: en una ventana
// privada o con el almacenamiento bloqueado, el acceso puede fallar y la app
// tiene que funcionar igual.

import type { Sesion, Tema } from '../compartido/tipos'

const CLAVE_SESION = 'validador.sesion'
const CLAVE_TEMA = 'validador.tema'

// La sesion va en sessionStorage: dura lo que la pestana, no queda en disco.
// Con «Mantener la sesión iniciada» va en localStorage: sobrevive a cerrar la
// pestana (o la app de escritorio) hasta que el token vence o se sale.
export function leerSesion(): Sesion | null {
  for (const almacen of [() => sessionStorage, () => localStorage]) {
    try {
      const s = JSON.parse(almacen().getItem(CLAVE_SESION) ?? 'null') as Sesion | null
      if (s && new Date(s.expira).getTime() > Date.now()) return s
      // Vencida: se borra para no volver a intentarla.
      if (s) almacen().removeItem(CLAVE_SESION)
    } catch {
      // sin almacenamiento: se prueba el otro, o se pide login
    }
  }
  return null
}

export function guardarSesion(s: Sesion | null, recordar = false) {
  try {
    // Nunca en los dos: salir la borra de ambos.
    sessionStorage.removeItem(CLAVE_SESION)
    localStorage.removeItem(CLAVE_SESION)
    if (s) (recordar ? localStorage : sessionStorage).setItem(CLAVE_SESION, JSON.stringify(s))
  } catch {
    // la sesion sigue en memoria mientras la pestana este abierta
  }
}

// Si la casilla quedó marcada la última vez: se ofrece igual al volver.
const CLAVE_RECORDAR = 'validador.recordar'
export function leerRecordar(): boolean {
  try {
    return localStorage.getItem(CLAVE_RECORDAR) === '1'
  } catch {
    return false
  }
}
export function guardarRecordar(v: boolean) {
  try {
    if (v) localStorage.setItem(CLAVE_RECORDAR, '1')
    else localStorage.removeItem(CLAVE_RECORDAR)
  } catch {
    // sin almacenamiento: se olvida la preferencia
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
