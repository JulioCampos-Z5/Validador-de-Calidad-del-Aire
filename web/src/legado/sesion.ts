// Puente entre el codigo traido del frontend actual y v2.
//
// Ese codigo llamaba a Flask directo (/api/...). En v2 todo pasa por la API de
// Go: /api/analisis/... con la sesion del usuario, que la registra en la
// bitacora. Aqui se hace ese cambio en un solo lugar:
//   - crearApi(): instancia de axios con la ruta y el token correctos.
//   - instalarDescargas(): los <a href="/api/..."> de descarga se bajan con la
//     sesion (un enlace normal no lleva el token).

import axios, { AxiosError } from 'axios'

let token = ''
let alVencer: () => void = () => {}

export function configurarSesion(t: string, vencida: () => void) {
  token = t
  alVencer = vencida
}

// '/api/minutales' -> '/api/analisis/minutales'
export const aAnalisis = (ruta: string) => ruta.replace(/^\/api(?=\/|$)/, '/api/analisis')

// El 401 de la API de Go (sesion vencida) no es el de Flask (p. ej. el token de
// la API de Emisiones vencio): solo el primero saca del validador.
const MENSAJE_SESION_VENCIDA = 'token invalido o vencido'

export function crearApi(base: string) {
  const api = axios.create({ baseURL: aAnalisis(base) })
  api.interceptors.request.use((c) => {
    c.headers.set('Authorization', `Bearer ${token}`)
    return c
  })
  api.interceptors.response.use(undefined, (e: AxiosError<{ error?: string }>) => {
    if (e.response?.status === 401 && e.response.data?.error === MENSAJE_SESION_VENCIDA) alVencer()
    return Promise.reject(e)
  })
  return api
}

async function descargar(href: string, nombre: string) {
  const resp = await fetch(aAnalisis(href), { headers: { Authorization: `Bearer ${token}` } })
  if (resp.status === 401) {
    alVencer()
    return
  }
  if (!resp.ok) {
    let msg = `No se pudo descargar (${resp.status})`
    try { msg = (await resp.json()).error ?? msg } catch { /* sin cuerpo JSON */ }
    alert(msg)
    return
  }
  // El nombre que manda el servidor manda sobre el que se adivina de la URL.
  const cd = resp.headers.get('Content-Disposition') ?? ''
  const delServidor = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1]
  const url = URL.createObjectURL(await resp.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = delServidor ? decodeURIComponent(delServidor) : nombre
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// Un clic en cualquier enlace a /api/... se convierte en descarga con sesion.
export function instalarDescargas() {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="/api/"]') as HTMLAnchorElement | null
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href')!
    const nombre = a.getAttribute('download') || decodeURIComponent(href.split('?')[0]!.split('/').pop() || 'descarga')
    descargar(href, nombre)
  }, true)
}

// Para quien abria la descarga con window.open(url).
export const descargarConSesion = (href: string) =>
  descargar(href, decodeURIComponent(href.split('?')[0]!.split('/').pop() || 'descarga'))
