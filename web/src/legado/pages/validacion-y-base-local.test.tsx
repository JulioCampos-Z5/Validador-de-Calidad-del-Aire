import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Con el DatosProvider de verdad: la configuracion cambia y se guarda como en
// la app. Solo se simulan los servicios.
const api = vi.hoisted(() => ({ healthCheck: vi.fn(), downloadFile: (f: string) => f }))
vi.mock('../services/api', () => ({ default: api, apiService: api }))
const historicoApi = vi.hoisted(() => ({
  estado: vi.fn(), pendientes: vi.fn(), analizar: vi.fn(), aplicar: vi.fn(), descartar: vi.fn(),
  descargar: vi.fn(), avanceDescarga: vi.fn(), cancelarDescarga: vi.fn(), aplicarPendientes: vi.fn(),
  descartarPendientes: vi.fn(), cambiosDeCarga: vi.fn(), cargar: vi.fn(),
}))
vi.mock('../services/historico', async (original) => ({ ...(await original<object>()), historicoApi }))
const emisionesApi = vi.hoisted(() => ({ sesion: vi.fn() }))
vi.mock('../services/emisiones', () => ({ emisionesApi }))

import { DatosProvider, type EstadoCompartido } from '../estado/DatosContexto'
import Dashboard from './Dashboard'
import ModalBaseLocal from '../components/ModalBaseLocal'

const config = () => JSON.parse(localStorage.getItem('validador.config') ?? '{}')

beforeEach(() => {
  api.healthCheck.mockResolvedValue({ status: 'ok', version: '2.0.0' })
  historicoApi.estado.mockResolvedValue({ disponible: true, anios: [], cargas: [] })
  historicoApi.pendientes.mockResolvedValue({ total: 0, muestra: [] })
  historicoApi.avanceDescarga.mockResolvedValue({ activo: false })
  emisionesApi.sesion.mockResolvedValue({ activa: false, email: null, caduca: null, recordada: false })
})

describe('Validación: editar las validaciones', () => {
  it('rangos: editar un limite y restablecer', async () => {
    render(<DatosProvider><Dashboard /></DatosProvider>)
    const rangos = screen.getByText('Validación por Rangos').closest('.border') as HTMLElement
    await userEvent.click(within(rangos).getByRole('button', { name: /Editar/ }))
    const [minO3] = within(rangos).getAllByRole('spinbutton')
    fireEvent.change(minO3, { target: { value: '-0.01' } })
    await waitFor(() => expect(Object.values(config().rangos_custom).some((r) => (r as { min: number }).min === -0.01)).toBe(true))
    fireEvent.change(minO3, { target: { value: 'abc' } }) // no numero: se ignora
    await userEvent.click(within(rangos).getByRole('button', { name: /Restaurar valores por defecto/ }))
    await waitFor(() => expect(Object.values(config().rangos_custom).some((r) => (r as { min: number }).min === -0.01)).toBe(false))
  })

  it('temperatura de cabina: limites y valores por defecto', async () => {
    render(<DatosProvider><Dashboard /></DatosProvider>)
    const temp = screen.getByText('Temperatura Interna').closest('.border') as HTMLElement
    await userEvent.click(within(temp).getByRole('button', { name: /Editar/ }))
    const [min, max] = within(temp).getAllByRole('spinbutton')
    fireEvent.change(min, { target: { value: '18' } })
    fireEvent.change(max, { target: { value: '32' } })
    await waitFor(() => expect(config()).toMatchObject({ temp_min: 18, temp_max: 32 }))
    await userEvent.click(within(temp).getAllByRole('button').at(-1)!)
    await waitFor(() => expect(config()).toMatchObject({ temp_min: 20, temp_max: 30 }))
    await userEvent.click(within(temp).getByRole('checkbox'))
    await waitFor(() => expect(config().temperatura).toBe(false))
  })

  it('series: cada regla se prende y apaga; la tolerancia se acota a 0–100 %', async () => {
    render(<DatosProvider><Dashboard /></DatosProvider>)
    const series = screen.getByText('Series Temporales').closest('.border') as HTMLElement
    await userEvent.click(within(series).getByRole('button', { name: /Editar/ }))
    const casillas = within(series).getAllByRole('checkbox')
    for (const c of casillas.slice(1)) await userEvent.click(c)
    await waitFor(() => expect(config()).toMatchObject({
      series_constantes: false, series_nox: false, series_pm: false, series_radiacion: false,
      series_viento: false, series_temp_externa: false,
    }))
    for (const c of casillas.slice(1, 3)) await userEvent.click(c) // NOx y constantes de vuelta
    const tolerancias = within(series).getAllByRole('spinbutton')
    fireEvent.change(tolerancias[0], { target: { value: '5' } })
    await waitFor(() => expect(config().nox_tolerance).toBe(1))
    await userEvent.click(casillas[0])
    await waitFor(() => expect(config().series).toBe(false))
  })
})

describe('Base local: guardar, pendientes y descargas', () => {
  const inicial = (origen: 'simaj' | 'archivo') => ({
    resultado: { summary: { total_registros: 1000 } } as never, mir: null, fallas: [], contaminantesMir: [], comoCeroMir: [],
    origen: origen === 'simaj' ? 'simaj' : 'validado', descripcion: 'SIMAJ · sep', advertencia: null,
  } as EstadoCompartido)

  it('lo descargado del SIMAJ se compara y se guarda con o sin los cambios', async () => {
    historicoApi.analizar.mockResolvedValue({
      id: 'a1', total: 10, nuevos: 8, cambiados: 2, iguales: 0, desde: '2026-09-01', hasta: '2026-09-07',
      por_parametro: [{ clave: 'O3', cambios: 2 }], por_estacion: [{ clave: 'CEN', cambios: 2 }],
      muestra: [{ estacion: 'CEN', parametro: 'O3', fecha: '2026-09-01', hora: 3, antes: 0.03, bandera_antes: null, ahora: 0.04, bandera_ahora: null }],
    })
    historicoApi.aplicar.mockResolvedValue({ carga_id: 1, nuevos: 8, actualizados: 2, omitidos: 0 })
    render(<DatosProvider inicial={inicial('simaj')}><ModalBaseLocal onCerrar={vi.fn()} /></DatosProvider>)
    await userEvent.click(await screen.findByRole('button', { name: /Guardar nuevos y actualizar 2 cambios/ }))
    expect(historicoApi.aplicar).toHaveBeenCalledWith('a1', true)
    expect(await screen.findByText(/Guardado: 8 datos nuevos, 2 actualizados\./)).toBeInTheDocument()
  })

  it('cerrar sin aplicar descarta el analisis en el backend', async () => {
    historicoApi.analizar.mockResolvedValue({ id: 'a2', total: 5, nuevos: 5, cambiados: 0, iguales: 0, desde: null, hasta: null, por_parametro: [], por_estacion: [], muestra: [] })
    historicoApi.descartar.mockResolvedValue(undefined)
    const onCerrar = vi.fn()
    render(<DatosProvider inicial={inicial('simaj')}><ModalBaseLocal onCerrar={onCerrar} /></DatosProvider>)
    await screen.findByRole('button', { name: /Guardar 5 datos nuevos/ })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(historicoApi.descartar).toHaveBeenCalledWith('a2')
    expect(onCerrar).toHaveBeenCalled()
  })

  it('pendientes: actualizar o descartar', async () => {
    historicoApi.pendientes.mockResolvedValue({ total: 3, muestra: [
      { estacion: 'CEN', parametro: 'PM10', fecha: '2026-09-01', hora: 1, antes: 40, bandera_antes: null, ahora: 45, bandera_ahora: null },
    ] })
    historicoApi.aplicarPendientes.mockResolvedValue({ actualizados: 3 })
    historicoApi.descartarPendientes.mockResolvedValue({ descartados: 3 })
    render(<DatosProvider><ModalBaseLocal onCerrar={vi.fn()} /></DatosProvider>)
    await userEvent.click(await screen.findByRole('button', { name: 'Actualizar 3 datos' }))
    expect(await screen.findByText('Actualizados 3 datos.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Descartar y conservar lo guardado' }))
    expect(await screen.findByText(/Descartados 3 cambios/)).toBeInTheDocument()
  })

  it('descargar un año desde la API y seguir su avance', async () => {
    // Descargar por año pide sesion con la API de Emisiones.
    emisionesApi.sesion.mockResolvedValue({ activa: true, email: 'a@b.mx', caduca: null, recordada: true })
    historicoApi.descargar.mockResolvedValue({ activo: true, desde: '2025-01-01', total: 12, hechos: 3, nuevos: 100 })
    render(<DatosProvider><ModalBaseLocal onCerrar={vi.fn()} /></DatosProvider>)
    await userEvent.click(await screen.findByTitle('Descargar 2025 completo'))
    expect(historicoApi.descargar).toHaveBeenCalledWith('2025-01-01', '2026-01-01', expect.any(Object))
    expect(await screen.findByText(/100 nuevos · 25%/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Cancelar/ }))
    expect(historicoApi.cancelarDescarga).toHaveBeenCalled()
  })

  it('ver los cambios de una carga anterior', async () => {
    historicoApi.estado.mockResolvedValue({ disponible: true, anios: [], cargas: [
      { id: 7, fecha: '2026-09-10T10:00:00', origen: 'simaj', descripcion: 'SIMAJ', desde: '2026-09-01', hasta: '2026-09-07', nuevos: 50, cambiados: 1, iguales: 0 },
    ] })
    historicoApi.cambiosDeCarga.mockResolvedValue([
      { estacion: 'MIR', parametro: 'SO2', fecha: '2026-09-02', hora: 8, antes: 0.01, bandera_antes: null, ahora: null, bandera_ahora: 'IR' },
    ])
    render(<DatosProvider><ModalBaseLocal onCerrar={vi.fn()} /></DatosProvider>)
    await userEvent.click(await screen.findByRole('button', { name: 'Ver cambios' }))
    expect(historicoApi.cambiosDeCarga).toHaveBeenCalledWith(7)
    expect(await screen.findByText('MIR')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar' }))
    expect(screen.queryByText('MIR')).not.toBeInTheDocument()
  })

  it('errores del backend en el dialogo', async () => {
    historicoApi.estado.mockRejectedValue({ response: { data: { error: 'La base local está bloqueada.' } } })
    render(<DatosProvider><ModalBaseLocal onCerrar={vi.fn()} /></DatosProvider>)
    expect(await screen.findByText('La base local está bloqueada.')).toBeInTheDocument()
  })
})
