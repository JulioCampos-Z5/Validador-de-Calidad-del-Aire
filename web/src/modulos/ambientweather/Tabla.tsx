import { useEffect, useMemo, useRef, useState } from 'react'
import { IconAdjustments, IconDownload } from '@tabler/icons-react'
import type { Cliente } from '../../compartido/api'
import { fechaHora } from '../../compartido/tiempo'

import {
  COLUMNAS_TABLA, aCsv, cardinal, finDe, horaLocal, metrica, mostrar, nombreCorto, unidad,
  type Dispositivo, type Lectura,
} from './datos'

// Mismos rangos y tamaños de pagina que la app de escritorio.
const RANGOS = [
  { id: '6h', etq: '6 h', horas: 6 },
  { id: '24h', etq: '24 h', horas: 24 },
  { id: '7d', etq: '7 d', horas: 24 * 7 },
  { id: '30d', etq: '30 d', horas: 24 * 30 },
  { id: '90d', etq: '90 d', horas: 24 * 90 },
  { id: '1a', etq: '1 año', horas: 24 * 365 },
] as const
const TAMANOS = [50, 100, 250, 500]
// El CSV se arma en tramos de este tamaño (el maximo que da la API).
const POR_TRAMO_CSV = 5000

interface PaginaLecturas { lecturas: Lectura[]; total: number; columnas: string[] }

/**
 * Lecturas guardadas, como la tabla de la app de escritorio: todas las
 * columnas que la estacion reporta (las que no, se ocultan solas), selector
 * de columnas, orden por cualquiera y paginas. El orden y las paginas los hace
 * la API: un mes cada minuto son ~43 mil filas, no se traen todas.
 */
export function Tabla({ api, d, ahora }: { api: Cliente; d: Dispositivo; ahora: number }) {
  const [rango, setRango] = useState<typeof RANGOS[number]['id']>('24h')
  const [orden, setOrden] = useState('fecha')
  const [asc, setAsc] = useState(false)
  const [tamano, setTamano] = useState(100)
  const [pagina, setPagina] = useState(0)
  const [manual, setManual] = useState<Record<string, boolean>>({})
  const [selector, setSelector] = useState(false)
  const [datos, setDatos] = useState<PaginaLecturas | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [csv, setCsv] = useState<number | null>(null) // avance 0-100 mientras se arma
  const cajaSelector = useRef<HTMLDivElement>(null)

  const hasta = finDe(d.ultima?.fecha, Math.floor(ahora / 60_000) * 60_000)
  const horas = RANGOS.find((r) => r.id === rango)!.horas
  const tramo = (desde: number) =>
    `mac=${encodeURIComponent(d.mac)}&desde=${new Date(desde).toISOString()}&hasta=${new Date(hasta).toISOString()}`

  // Cambiar rango, orden o tamaño vuelve a la primera pagina.
  useEffect(() => setPagina(0), [rango, orden, asc, tamano, d.mac])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    api.get<PaginaLecturas>(`/api/ambient-weather/lecturas?${tramo(hasta - horas * 3_600_000)}`
      + `&limite=${tamano}&pagina=${pagina}&orden=${orden}&dir=${asc ? 'asc' : 'desc'}`)
      .then((r) => { if (vivo) { setDatos(r); setError('') } })
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false))
    return () => { vivo = false }
    // tramo depende de d.mac, hasta y horas, que ya estan aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, d.mac, hasta, horas, tamano, pagina, orden, asc])

  useEffect(() => {
    if (!selector) return
    const fuera = (e: MouseEvent) => {
      if (!cajaSelector.current?.contains(e.target as Node)) setSelector(false)
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [selector])

  const conDatos = useMemo(() => new Set(datos?.columnas ?? []), [datos])
  const disponibles = COLUMNAS_TABLA.filter((c) => conDatos.has(c.clave))
  const visibles = disponibles.filter((c) => manual[c.clave] ?? !c.oculta)
  const total = datos?.total ?? 0
  const paginas = Math.max(1, Math.ceil(total / tamano))

  const ordenarPor = (clave: string) => {
    if (clave === orden) setAsc(!asc)
    else { setOrden(clave); setAsc(false) }
  }
  const flecha = (clave: string) => (clave !== orden ? '↕' : asc ? '↑' : '↓')

  // CSV del rango elegido, con todas las columnas que traen datos (no solo
  // las visibles), de la mas antigua a la mas reciente.
  const exportar = async () => {
    setCsv(0)
    setError('')
    try {
      const desde = hasta - horas * 3_600_000
      const todas: Lectura[] = []
      for (let p = 0; ; p++) {
        const r = await api.get<PaginaLecturas>(
          `/api/ambient-weather/lecturas?${tramo(desde)}&limite=${POR_TRAMO_CSV}&pagina=${p}&orden=fecha&dir=asc`)
        todas.push(...r.lecturas)
        setCsv(r.total ? Math.round((todas.length / r.total) * 100) : 100)
        if (r.lecturas.length < POR_TRAMO_CSV) break
      }
      const claves = disponibles.map((c) => c.clave)
      const blob = new Blob(['﻿' + aCsv(todas, claves)], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ambient-weather_${nombreCorto(d)}_${rango}_${horaLocal(new Date(hasta).toISOString()).slice(0, 10)}.csv`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCsv(null)
    }
  }

  const celda = (l: Lectura, clave: string) => {
    const v = l.valores[clave]
    if (v !== undefined && (clave === 'winddir' || clave === 'winddiravg10m')) {
      return `${Math.round(v)}° ${cardinal(v)}`
    }
    return mostrar(clave, l.valores, false)
  }

  const encabezado = (clave: string, etiqueta: string) => {
    const m = metrica(clave)!
    const u = m.tipo === 'grados' ? '' : unidad(m)
    return u ? <>{etiqueta} <span className="aw-unidad">({u})</span></> : etiqueta
  }

  return (
    <div className="seccion">
      <div className="aw-controles">
        <h3 className="h2" style={{ margin: 0 }}>Lecturas guardadas</h3>
        <div className="filtros" role="group" aria-label="Periodo de la tabla">
          {RANGOS.map((r) => (
            <button key={r.id} type="button" className={`boton${rango === r.id ? ' elegido' : ''}`}
              aria-pressed={rango === r.id} onClick={() => setRango(r.id)}>{r.etq}</button>
          ))}
        </div>
        <button type="button" className="boton" onClick={exportar} disabled={csv !== null || total === 0}
          title="CSV del periodo elegido, con todas las columnas que trae la estación, en unidades métricas y hora de Guadalajara">
          <IconDownload size={14} stroke={1.8} style={{ verticalAlign: -2, marginRight: 4 }} />
          {csv !== null ? `Preparando… ${csv}%` : 'Exportar CSV'}
        </button>
      </div>

      <div className="aw-controles aw-barra">
        <span className="cap">
          <strong style={{ color: 'var(--tx)' }}>{total.toLocaleString('es-MX')}</strong> filas
          {' · '}{visibles.length} de {disponibles.length} columnas
        </span>
        <div className="aw-selector" ref={cajaSelector}>
          <button type="button" className="boton" onClick={() => setSelector(!selector)} aria-expanded={selector}>
            <IconAdjustments size={14} stroke={1.8} style={{ verticalAlign: -2, marginRight: 4 }} />
            Columnas
          </button>
          {selector && (
            <div className="aw-menu" role="group" aria-label="Columnas visibles">
              {disponibles.map((c) => (
                <label key={c.clave} className="aw-check">
                  <input type="checkbox" checked={manual[c.clave] ?? !c.oculta}
                    onChange={(e) => setManual({ ...manual, [c.clave]: e.target.checked })} />
                  {c.etiqueta}
                </label>
              ))}
            </div>
          )}
        </div>
        <label className="cap aw-tamano">
          Filas por página
          <select value={tamano} onChange={(e) => setTamano(Number(e.target.value))}>
            {TAMANOS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      {error && <div className="aviso-error" style={{ marginBottom: 10 }}>{error}</div>}
      {datos && total === 0 && !cargando && (
        <div className="vacio"><span className="cap">No hay lecturas guardadas en este periodo.</span></div>
      )}
      {datos && total > 0 && (
        <>
          <div className={`tabla-caja aw-tabla${cargando ? ' aw-cargando' : ''}`}>
            <table className="tabla">
              <thead>
                <tr>
                  <th className="aw-fija aw-orden" onClick={() => ordenarPor('fecha')}>
                    Fecha <span className="aw-flecha">{flecha('fecha')}</span>
                  </th>
                  {visibles.map((c) => (
                    <th key={c.clave} className="num aw-orden" onClick={() => ordenarPor(c.clave)}
                      aria-sort={orden === c.clave ? (asc ? 'ascending' : 'descending') : undefined}>
                      {encabezado(c.clave, c.etiqueta)} <span className="aw-flecha">{flecha(c.clave)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {datos.lecturas.map((l) => (
                  <tr key={l.fecha}>
                    <td className="aw-fija" style={{ whiteSpace: 'nowrap' }}>{fechaHora(l.fecha)}</td>
                    {visibles.map((c) => <td key={c.clave} className="num" style={{ whiteSpace: 'nowrap' }}>{celda(l, c.clave)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="aw-paginas cap">
            <span>
              Mostrando {(pagina * tamano + 1).toLocaleString('es-MX')}–
              {Math.min((pagina + 1) * tamano, total).toLocaleString('es-MX')} de {total.toLocaleString('es-MX')}
            </span>
            <div className="filtros">
              <button type="button" className="boton" onClick={() => setPagina(0)} disabled={pagina === 0} aria-label="Primera página">««</button>
              <button type="button" className="boton" onClick={() => setPagina(pagina - 1)} disabled={pagina === 0}>‹ Anterior</button>
              <span className="aw-pagina">Página {pagina + 1} de {paginas.toLocaleString('es-MX')}</span>
              <button type="button" className="boton" onClick={() => setPagina(pagina + 1)} disabled={pagina >= paginas - 1}>Siguiente ›</button>
              <button type="button" className="boton" onClick={() => setPagina(paginas - 1)} disabled={pagina >= paginas - 1} aria-label="Última página">»»</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
