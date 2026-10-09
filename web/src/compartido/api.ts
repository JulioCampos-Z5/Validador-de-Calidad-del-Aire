// Cliente de la API central. Mismo origen que la pagina (en desarrollo, Vite
// reenvia /api a la API de Go), asi que no hay CORS ni URL que configurar.

export class ErrorApi extends Error {
  constructor(message: string, readonly estado: number) {
    super(message)
  }
}

async function leer<T>(resp: Response): Promise<T> {
  if (resp.status === 204) return undefined as T
  const texto = await resp.text()
  let cuerpo: unknown = undefined
  try {
    cuerpo = texto ? JSON.parse(texto) : undefined
  } catch {
    // Respuesta que no es JSON (p. ej. un proxy caido): se reporta abajo.
  }
  if (!resp.ok) {
    const msg = (cuerpo as { error?: string } | undefined)?.error ?? `La API respondió ${resp.status}`
    throw new ErrorApi(msg, resp.status)
  }
  return cuerpo as T
}

async function pedir<T>(ruta: string, init: RequestInit): Promise<T> {
  let resp: Response
  try {
    resp = await fetch(ruta, init)
  } catch {
    throw new ErrorApi('No hay conexión con el servidor', 0)
  }
  return leer<T>(resp)
}

// recordar: la API da un token de larga duracion (30 dias por omision).
export function login(correo: string, contrasena: string, recordar = false) {
  return pedir<import('./tipos').Sesion>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo, contrasena, recordar }),
  })
}

export function modulos() {
  return pedir<{ modulos: import('./tipos').ModuloApi[] }>('/api/modulos', {})
}

// Cliente con sesion. alVencer se llama ante un 401: el token ya no sirve
// (expiro o se cerro la sesion) y hay que volver a entrar.
export function cliente(token: string, alVencer: () => void) {
  const con = async <T>(ruta: string, init: RequestInit = {}): Promise<T> => {
    try {
      return await pedir<T>(ruta, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 401) alVencer()
      throw e
    }
  }
  const json = (cuerpo: unknown) => (cuerpo === undefined ? undefined : JSON.stringify(cuerpo))
  return {
    get: <T>(ruta: string) => con<T>(ruta),
    post: <T>(ruta: string, cuerpo?: unknown) => con<T>(ruta, { method: 'POST', body: json(cuerpo) }),
    put: <T>(ruta: string, cuerpo?: unknown) => con<T>(ruta, { method: 'PUT', body: json(cuerpo) }),
    patch: <T>(ruta: string, cuerpo?: unknown) => con<T>(ruta, { method: 'PATCH', body: json(cuerpo) }),

    // Subir un archivo (multipart). Sin Content-Type: el navegador pone el boundary.
    subir: async <T>(ruta: string, campo: string, archivo: File): Promise<T> => {
      const fd = new FormData()
      fd.append(campo, archivo)
      try {
        return await pedir<T>(ruta, { method: 'POST', body: fd, headers: { Authorization: `Bearer ${token}` } })
      } catch (e) {
        if (e instanceof ErrorApi && e.estado === 401) alVencer()
        throw e
      }
    },

    // Descargar un archivo con la sesion (un <a href> no lleva el token).
    descargar: async (ruta: string, nombre: string) => {
      let resp: Response
      try {
        resp = await fetch(ruta, { headers: { Authorization: `Bearer ${token}` } })
      } catch {
        throw new ErrorApi('No hay conexión con el servidor', 0)
      }
      if (!resp.ok) {
        if (resp.status === 401) alVencer()
        await leer(resp)
      }
      const url = URL.createObjectURL(await resp.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = nombre
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    },
  }
}

export type Cliente = ReturnType<typeof cliente>
