// El conjunto validado sobrevive a una recarga de la pagina: se guarda en
// IndexedDB del navegador (puede pesar decenas de MB, no cabe en
// sessionStorage). Se borra al cerrar sesion. Si el navegador no deja usar
// IndexedDB, todo sigue funcionando en memoria.

import type { Conjunto } from '../compartido/tipos'

const BASE = 'validador'
const TABLA = 'conjunto'
const CLAVE = 'actual'

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, mal) => {
    const req = indexedDB.open(BASE, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(TABLA)
    req.onsuccess = () => ok(req.result)
    req.onerror = () => mal(req.error)
  })
}

async function operar<T>(modo: IDBTransactionMode, f: (t: IDBObjectStore) => IDBRequest): Promise<T | null> {
  try {
    const db = await abrir()
    return await new Promise<T | null>((ok) => {
      const req = f(db.transaction(TABLA, modo).objectStore(TABLA))
      req.onsuccess = () => ok((req.result as T) ?? null)
      req.onerror = () => ok(null)
    })
  } catch {
    return null
  }
}

export const leerConjunto = () => operar<Conjunto>('readonly', (t) => t.get(CLAVE))
export const guardarConjunto = (c: Conjunto) => operar('readwrite', (t) => t.put(c, CLAVE))
export const borrarConjunto = () => operar('readwrite', (t) => t.delete(CLAVE))
