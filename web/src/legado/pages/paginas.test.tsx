import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const datos = vi.hoisted(() => ({ valor: {} as Record<string, any> }))
vi.mock('../estado/DatosContexto', async (original) => ({
  ...(await original<object>()),
  useDatos: () => datos.valor,
}))
const api = vi.hoisted(() => ({
  healthCheck: vi.fn(), getConfig: vi.fn(), downloadFile: (f: string) => `/api/download/${f}`, appEscritorio: vi.fn(),
}))
vi.mock('../services/api', () => ({ default: api, apiService: api }))
const historicoApi = vi.hoisted(() => ({
  estado: vi.fn(), pendientes: vi.fn(), analizar: vi.fn(), aplicar: vi.fn(), descartar: vi.fn(),
  descargar: vi.fn(), avanceDescarga: vi.fn(), aplicarPendientes: vi.fn(), descartarPendientes: vi.fn(),
}))
vi.mock('../services/historico', async (original) => ({ ...(await original<object>()), historicoApi }))
const sesion = vi.hoisted(() => ({ descargarConSesion: vi.fn() }))
vi.mock('../sesion', async (original) => ({ ...(await original<object>()), ...sesion }))

import { CONFIG_POR_DEFECTO } from '../estado/DatosContexto'
import Dashboard from './Dashboard'
import Config from './Config'
import OrigenDatos from '../components/OrigenDatos'
import ModalBaseLocal, { TablaCambios } from '../components/ModalBaseLocal'

beforeEach(() => {
  datos.valor = {
    resultado: null, revalidar: true, setRevalidar: vi.fn(), config: CONFIG_POR_DEFECTO, setConfig: vi.fn(),
    cargando: false, descripcion: null, error: null, limpiar: vi.fn(), mir: null, contaminantesMir: ['O3'],
    comoCeroMir: [], progresoSimaj: null, historicoDisponible: false, origen: null,
    sesionEmisiones: { activa: false }, periodo: { desde: '2026-09-01', hasta: '2026-09-07' }, setPeriodo: vi.fn(),
  }
  api.healthCheck.mockResolvedValue({ status: 'ok', version: '2.0.0' })
  api.appEscritorio.mockResolvedValue({ disponible: false, archivos: [] })
})

describe('Validación (Dashboard)', () => {
  it('dice si el analisis esta conectado', async () => {
    render(<Dashboard />)
    expect(await screen.findByText('Análisis conectado')).toBeInTheDocument()
    expect(screen.getByText('· v2.0.0')).toBeInTheDocument()
  })

  it('sin backend lo dice claro', async () => {
    api.healthCheck.mockRejectedValue(new Error('x'))
    render(<Dashboard />)
    expect(await screen.findByText('Sin conexión con el análisis (Python)')).toBeInTheDocument()
  })

  it('apagar una validacion cambia la configuracion', async () => {
    // Como React con el estado al dia: el actualizador corre en el momento.
    let nueva: unknown = null
    datos.valor.setConfig = vi.fn((f: (c: typeof CONFIG_POR_DEFECTO) => unknown) => { nueva = f(CONFIG_POR_DEFECTO) })
    render(<Dashboard />)
    const fila = screen.getByText('Validación por Rangos').closest('.flex.items-center') as HTMLElement
    await userEvent.click(within(fila).getByRole('checkbox'))
    expect(nueva).toMatchObject({ rangos: false })
  })

  it('con resultado: resumen y descarga del Excel con sesion', async () => {
    datos.valor.resultado = {
      output_filename: 'BD_validado.xlsx', data_preview: [{ STATION: 'CEN', DATE: '2026-09-01', HOUR: 0, O3: 0.03 }],
      summary: { total_registros: 82979, estaciones: 13, fecha_inicio: '2026-01-01', fecha_fin: '2026-09-23', banderas: {}, estadisticas: {} },
      estadisticas_detalladas: [],
    }
    render(<Dashboard />)
    expect(screen.getByText('Resultados de Validación')).toBeInTheDocument()
    expect(screen.getByText((82979).toLocaleString())).toBeInTheDocument()
    expect(screen.getByText('2026-01-01')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Descargar Excel/ }))
    expect(sesion.descargarConSesion).toHaveBeenCalledWith('/api/download/BD_validado.xlsx')
  })
})

describe('Parámetros (Config)', () => {
  it('rangos, estaciones y banderas del backend', async () => {
    api.getConfig.mockResolvedValue({
      rangos: { O3: { min: -0.003, max: 0.5 } }, estaciones: { CEN: 'Centro' },
      parametros: { O3: 'Ozono' }, banderas: { IR: 'Fuera de rango' }, decimales: { O3: 3 },
    })
    render(<Config />)
    expect(await screen.findByText('-0.003')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Estaciones' }))
    expect(screen.getByText('Centro')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Banderas' }))
    expect(screen.getByText('Fuera de rango')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Actualizar/ }))
    expect(api.getConfig).toHaveBeenCalledTimes(2)
  })

  it('sin backend no se queda cargando', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api.getConfig.mockRejectedValue(new Error('x'))
    render(<Config />)
    await waitFor(() => expect(screen.queryByText('Cargando configuración...')).not.toBeInTheDocument())
  })
})

describe('Panel Datos (OrigenDatos)', () => {
  it('lista los origenes; la base local solo en escritorio', async () => {
    const { unmount } = render(<OrigenDatos />)
    await userEvent.click(screen.getByRole('button', { name: /Consultar datos/ }))
    for (const o of ['Archivo ENVISTA', 'Archivo ya validado', 'Descargar del SIMAJ', 'API de Emisiones']) {
      expect(screen.getByText(o)).toBeInTheDocument()
    }
    expect(screen.queryByText('Base local (SQLite)')).not.toBeInTheDocument()
    unmount()
    datos.valor.historicoDisponible = true
    render(<OrigenDatos />)
    await userEvent.click(screen.getByRole('button', { name: /Consultar datos/ }))
    expect(screen.getByText('Base local (SQLite)')).toBeInTheDocument()
  })

  it('en escritorio, «Archivos guardados» lleva al visor', async () => {
    const ir = vi.fn()
    const { unmount } = render(<OrigenDatos ir={ir} />)
    expect(screen.queryByRole('button', { name: 'Archivos guardados' })).not.toBeInTheDocument()
    unmount()
    datos.valor.historicoDisponible = true
    render(<OrigenDatos ir={ir} />)
    await userEvent.click(screen.getByRole('button', { name: 'Archivos guardados' }))
    expect(ir).toHaveBeenCalledWith('archivos')
  })

  it('elegir un origen abre su asistente', async () => {
    render(<OrigenDatos />)
    await userEvent.click(screen.getByRole('button', { name: /Consultar datos/ }))
    await userEvent.click(screen.getByText('Archivo ya validado'))
    expect(screen.getByRole('dialog', { name: 'Elegir el archivo' })).toBeInTheDocument()
  })

  it('con datos: exportaciones con la sesion (validacion, MIR, IAS/NOM)', () => {
    datos.valor = {
      ...datos.valor, descripcion: 'BD_2026.xlsx', mir: { estaciones: [] }, comoCeroMir: ['CEN:O3'],
      resultado: { output_filename: 'BD_validado.xlsx', summary: {} },
    }
    render(<OrigenDatos />)
    expect(screen.getByRole('link', { name: 'Exportar validación' })).toHaveAttribute('href', '/api/download/BD_validado.xlsx')
    expect(screen.getByRole('link', { name: 'Exportar reporte MIR' }).getAttribute('href')).toContain('como_cero=CEN%3AO3')
    expect(screen.getByRole('link', { name: 'Exportar IAS/NOM diario' })).toHaveAttribute('href', '/api/ias/diario.xlsx')
    expect(screen.getByRole('link', { name: 'Exportar IAS/NOM horario' })).toHaveAttribute('href', '/api/ias/horario.xlsx')
  })
})

describe('Base local', () => {
  beforeEach(() => {
    historicoApi.estado.mockResolvedValue({
      disponible: true, anios: [{ anio: 2026, registros: 100, valores: 1000, estaciones: 13, desde: '2026-01-01', hasta: '2026-09-23' }], cargas: [
        { id: 1, fecha: '2026-09-10T10:00:00', origen: 'simaj', descripcion: 'SIMAJ', desde: '2026-09-01', hasta: '2026-09-07', nuevos: 50, cambiados: 2, iguales: 0 },
      ],
    })
    historicoApi.pendientes.mockResolvedValue({ total: 0, muestra: [] })
    historicoApi.avanceDescarga.mockResolvedValue({ activo: false })
  })

  it('muestra las cargas guardadas y descarga un año', async () => {
    historicoApi.descargar.mockResolvedValue({ activo: true, total: 12, hechos: 0 })
    render(<ModalBaseLocal onCerrar={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Base local' })).toBeInTheDocument()
    expect(await screen.findByText('Últimas cargas guardadas')).toBeInTheDocument()
    expect(screen.getByText('Descargar desde la API de Emisiones')).toBeInTheDocument()
  })

  it('guardar lo cargado solo para SIMAJ o Emisiones', async () => {
    datos.valor = { ...datos.valor, resultado: { summary: { total_registros: 1000 } }, origen: 'simaj', descripcion: 'SIMAJ' }
    historicoApi.analizar.mockResolvedValue({ id: 'a1', total: 10, nuevos: 8, cambiados: 2, iguales: 0, desde: '2026-09-01', hasta: '2026-09-07', por_parametro: [], por_estacion: [], muestra: [] })
    render(<ModalBaseLocal onCerrar={vi.fn()} />)
    expect(await screen.findByText('Guardar lo cargado')).toBeInTheDocument()
  })

  it('la tabla de cambios: antes → ahora', () => {
    render(<TablaCambios cambios={[{ estacion: 'CEN', parametro: 'O3', fecha: '2026-09-01', hora: 5, antes: 0.03, bandera_antes: null, ahora: null, bandera_ahora: 'IR' }]} />)
    const fila = screen.getAllByRole('row')[1]
    expect(within(fila).getByText('CEN')).toBeInTheDocument()
    expect(within(fila).getByText('0.03')).toBeInTheDocument()
    expect(within(fila).getByText('IR')).toBeInTheDocument()
  })
})
