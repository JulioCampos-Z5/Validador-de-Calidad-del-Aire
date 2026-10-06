// De lo que devuelve GET /api/puertos/estado a lo que pinta el mosaico.
// Sin React a proposito: es la parte con reglas y se prueba sola.
//
// Color solo para el nivel (doc/ARQUITECTURA-v2.md, secciones 6 y 9.3):
//   er  rojo   incumple NOM (mas de 6 h sin datos)
//   wa  ambar  con falla (puerto sin datos, o sin comunicacion de 1 h o mas)
//   no  gris   sin comunicacion reciente, o sin datos de la estacion
//   ok  verde  todo dando datos

import type { EstadoEstacion, EstadoPuerto, Nivel } from '../../compartido/tipos'
import { desde, hora } from '../../compartido/tiempo'

export type Color = 'ok' | 'wa' | 'er' | 'no'

export interface PuntoPuerto {
  clave: string
  color: Color
  titulo: string
}

export interface Tarjeta {
  id: number
  nombre: string
  color: Color
  gravedad: number // para ordenar: lo que necesita atencion primero
  conFalla: boolean
  // Resumen de una linea: quien falla (nombre o clave) y desde hace cuanto.
  quien: string
  quienEsClave: boolean
  detalle: string
  puntos: PuntoPuerto[]
}

const PESO: Record<Nivel, number> = { reciente: 1, aviso: 2, critico: 3, incumple: 4 }

function colorDeNivel(n: Nivel | undefined, sinComunicacion: boolean): Color {
  if (n === 'incumple') return 'er'
  if (n === 'critico' || n === 'aviso') return 'wa'
  return sinComunicacion ? 'no' : 'wa' // un puerto recien caido ya es una falla
}

export function tarjeta(e: EstadoEstacion, ahora: number): Tarjeta {
  const puertos = [...e.puertos].sort((a, b) => a.clave.localeCompare(b.clave))
  const base = { id: e.id, nombre: e.nombre }

  if (e.sinComunicacion) {
    const color = colorDeNivel(e.nivel, true)
    return {
      ...base, color, conFalla: true,
      gravedad: 10 * PESO[e.nivel ?? 'reciente'] - 1,
      quien: 'Sin comunicación', quienEsClave: false,
      detalle: e.ultimoLatido ? desde(e.ultimoLatido, ahora) : 'nunca se ha conectado',
      // Sin comunicacion no se sabe nada de sus puertos.
      puntos: puertos.map((p) => ({ clave: p.clave, color: 'no', titulo: `${etiqueta(p)} — sin información` })),
    }
  }

  const caidos = puertos.filter((p) => p.estado === 'caido')
  const puntos = puertos.map((p): PuntoPuerto => ({
    clave: p.clave,
    color: p.estado === 'arriba' ? 'ok' : colorDeNivel(p.nivel, false),
    titulo: p.estado === 'arriba'
      ? `${etiqueta(p)} — con datos`
      : `${etiqueta(p)} — sin datos${p.desde ? ` desde las ${hora(p.desde)}` : ''}`,
  }))

  if (caidos.length === 0) {
    return {
      ...base, color: puertos.length ? 'ok' : 'no', gravedad: 0, conFalla: false,
      quien: puertos.length === 1 ? '1 puerto con datos' : `${puertos.length} puertos con datos`,
      quienEsClave: false,
      detalle: puertos.length ? '' : (e.ultimoLatido ? 'sin puertos reportados' : 'esperando el primer latido'),
      puntos,
    }
  }

  // El peor: mayor nivel y, a igual nivel, el que lleva mas tiempo.
  const peor = [...caidos].sort((a, b) =>
    PESO[b.nivel ?? 'reciente'] - PESO[a.nivel ?? 'reciente'] || (a.desde ?? '').localeCompare(b.desde ?? ''))[0]!
  const otros = caidos.length - 1
  return {
    ...base,
    color: colorDeNivel(peor.nivel, false),
    gravedad: 10 * PESO[peor.nivel ?? 'reciente'] + Math.min(otros, 9),
    conFalla: true,
    quien: peor.nombre || peor.clave,
    quienEsClave: !peor.nombre,
    detalle: (peor.desde ? desde(peor.desde, ahora) : 'sin datos') + (otros ? ` · +${otros}` : ''),
    puntos,
  }
}

export function etiqueta(p: EstadoPuerto) {
  return p.nombre ? `${p.nombre} (${p.clave})` : p.clave
}

export function tarjetas(estaciones: EstadoEstacion[], ahora: number): Tarjeta[] {
  return estaciones
    .map((e) => tarjeta(e, ahora))
    .sort((a, b) => b.gravedad - a.gravedad || a.nombre.localeCompare(b.nombre))
}

export interface ResumenRed { ok: number; wa: number; er: number; no: number }

export function resumen(ts: Tarjeta[]): ResumenRed {
  const r: ResumenRed = { ok: 0, wa: 0, er: 0, no: 0 }
  for (const t of ts) r[t.color]++
  return r
}
