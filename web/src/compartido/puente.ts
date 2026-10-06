// Comunicacion shell <-> modulo (iframe) por postMessage.
//
// La sesion nunca viaja en la URL del iframe (quedaria en el historial y en
// los logs): el modulo avisa que esta listo y el shell le entrega la sesion.
//
//   modulo -> shell : { tipo: 'listo' }            al cargar
//   shell -> modulo : { tipo: 'sesion', ... }      respuesta, con el tema
//   shell -> modulo : { tipo: 'tema', tema }       cuando se cambia el tema
//   modulo -> shell : { tipo: 'sesion-vencida' }   la API respondio 401
//   modulo -> shell : { tipo: 'guardar-datos', datos } conjunto validado (null = limpiar)
//   shell -> modulo : { tipo: 'datos', datos }     el conjunto actual (o null)
//   modulo -> shell : { tipo: 'ir', modulo }       abrir otro modulo
//
// El conjunto de datos validado vive en el shell (en memoria): asi Validacion
// lo carga y Graficas lo ve, aunque cada uno sea un iframe distinto.
//
// Solo se aceptan mensajes del mismo origen.

import type { Conjunto, Sesion, Tema } from './tipos'

export type Mensaje =
  | { tipo: 'listo' }
  | { tipo: 'sesion'; sesion: Sesion; tema: Tema }
  | { tipo: 'tema'; tema: Tema }
  | { tipo: 'sesion-vencida' }
  | { tipo: 'guardar-datos'; datos: Conjunto | null }
  | { tipo: 'datos'; datos: Conjunto | null }
  | { tipo: 'ir'; modulo: string }

const origen = () => window.location.origin

export function enviar(destino: Window, m: Mensaje) {
  destino.postMessage(m, origen())
}

// Lado shell: escucha a un iframe concreto.
export function escucharModulo(iframe: () => HTMLIFrameElement | null, alRecibir: (m: Mensaje) => void) {
  const f = (e: MessageEvent) => {
    const marco = iframe()
    if (e.origin !== origen() || !marco || e.source !== marco.contentWindow) return
    alRecibir(e.data as Mensaje)
  }
  window.addEventListener('message', f)
  return () => window.removeEventListener('message', f)
}

export function aplicarTema(tema: Tema) {
  document.documentElement.dataset.tema = tema
}

export interface ConexionShell {
  avisarVencida: () => void
  guardarDatos: (d: Conjunto | null) => void
  ir: (modulo: string) => void
}

// Lado modulo: pide la sesion al shell y queda atento a tema y datos.
// Si la pagina se abrio sola (no dentro del shell), no hay quien la entregue.
export function conectarConShell(
  alSesion: (s: Sesion) => void,
  alDatos: (d: Conjunto | null) => void,
): ConexionShell | null {
  if (window.parent === window) return null
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== origen() || e.source !== window.parent) return
    const m = e.data as Mensaje
    if (m.tipo === 'sesion') {
      aplicarTema(m.tema)
      alSesion(m.sesion)
    } else if (m.tipo === 'tema') {
      aplicarTema(m.tema)
    } else if (m.tipo === 'datos') {
      alDatos(m.datos)
    }
  })
  enviar(window.parent, { tipo: 'listo' })
  return {
    avisarVencida: () => enviar(window.parent, { tipo: 'sesion-vencida' }),
    guardarDatos: (d) => enviar(window.parent, { tipo: 'guardar-datos', datos: d }),
    ir: (modulo) => enviar(window.parent, { tipo: 'ir', modulo }),
  }
}
