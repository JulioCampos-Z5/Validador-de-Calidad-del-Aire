import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiService = vi.hoisted(() => ({
  uploadFile: vi.fn(), previewValidated: vi.fn(), validateFull: vi.fn(),
}))
const minutalesApi = vi.hoisted(() => ({ descargar: vi.fn(), progreso: vi.fn(), recalcularMir: vi.fn() }))
const emisionesApi = vi.hoisted(() => ({ sesion: vi.fn(), login: vi.fn(), salir: vi.fn(), descargar: vi.fn() }))
const historicoApi = vi.hoisted(() => ({ estado: vi.fn(), cargar: vi.fn() }))

vi.mock('../services/api', () => ({ default: apiService, apiService }))
vi.mock('../services/minutales', async (original) => ({ ...(await original<object>()), minutalesApi }))
vi.mock('../services/emisiones', () => ({ emisionesApi }))
vi.mock('../services/historico', () => ({ historicoApi }))
const archivosApi = vi.hoisted(() => ({ abrir: vi.fn() }))
vi.mock('../services/archivos', () => ({ archivosApi }))

import {
  DatosProvider, diasDelPeriodo, rangoConsultable, useDatos, type EstadoCompartido,
} from './DatosContexto'

const respuesta = (extra = {}) => ({
  success: true, summary: { total_registros: 10, estaciones: 2, fecha_inicio: '2026-09-01', fecha_fin: '2026-09-02' },
  data_preview: [], mir: { estaciones: [] }, fallas: [{ estacion: 'CEN' }], ...extra,
})

function montar(inicial?: EstadoCompartido | null) {
  const alCambiar = vi.fn()
  const envoltura = ({ children }: { children: ReactNode }) =>
    <DatosProvider inicial={inicial} alCambiar={alCambiar}>{children}</DatosProvider>
  return { ...renderHook(() => useDatos(), { wrapper: envoltura }), alCambiar }
}

beforeEach(() => {
  emisionesApi.sesion.mockResolvedValue({ activa: false, email: null, caduca: null, recordada: false })
  historicoApi.estado.mockResolvedValue({ disponible: false })
})

describe('periodo', () => {
  it('hasta inclusivo en pantalla, excluyente para el backend', () => {
    expect(rangoConsultable({ desde: '2026-09-01', hasta: '2026-09-07' })).toEqual({ desde: '2026-09-01', hasta: '2026-09-08' })
    expect(rangoConsultable({ desde: '2026-12-31', hasta: '2026-12-31' }).hasta).toBe('2027-01-01')
    expect(diasDelPeriodo({ desde: '2026-09-01', hasta: '2026-09-30' })).toBe(30)
  })

  it('useDatos fuera del proveedor avisa', () => {
    // React y jsdom reportan el error esperado; aqui solo importa que se lance.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const callar = (e: ErrorEvent) => e.preventDefault()
    window.addEventListener('error', callar)
    expect(() => renderHook(() => useDatos())).toThrow('DatosProvider')
    window.removeEventListener('error', callar)
  })
})

describe('DatosProvider', () => {
  it('cargar un archivo ya validado lo comparte con el shell', async () => {
    apiService.uploadFile.mockResolvedValue({ filename: 'srv_BD.xlsx' })
    apiService.previewValidated.mockResolvedValue(respuesta())
    const { result, alCambiar } = montar()

    await act(() => result.current.cargarArchivo(new File(['x'], 'BD_2026.xlsx'), 'validado'))
    expect(apiService.previewValidated).toHaveBeenCalledWith('srv_BD.xlsx', expect.any(Array))
    expect(apiService.validateFull).not.toHaveBeenCalled()
    expect(result.current.origen).toBe('validado')
    expect(result.current.descripcion).toBe('BD_2026.xlsx')
    expect(result.current.exito).toMatch(/10 registros de BD_2026.xlsx/)
    expect(result.current.fallas).toHaveLength(1)
    expect(alCambiar).toHaveBeenLastCalledWith(expect.objectContaining({ origen: 'validado', descripcion: 'BD_2026.xlsx' }))
  })

  it('un archivo ENVISTA se valida completo con la configuracion', async () => {
    apiService.uploadFile.mockResolvedValue({ filename: 'f' })
    apiService.validateFull.mockResolvedValue(respuesta({ historico: { nuevos: 5, pendientes: 2 } }))
    const { result } = montar()
    await act(() => result.current.cargarArchivo(new File(['x'], 'Trs.xlsx'), 'envista'))
    const [, config, revalidar] = apiService.validateFull.mock.calls[0]
    expect(config).toMatchObject({ rangos: true, series_presion: false })
    expect(revalidar).toBe(true)
    expect(result.current.exito).toMatch(/Base local: 5 datos nuevos, 2 cambios pendientes/)
  })

  it('un archivo guardado se abre con el mismo flujo que uno subido', async () => {
    archivosApi.abrir.mockResolvedValueOnce({ filename: 'w_BD.xlsx', tipo: 'validado', nombre: 'BD_2026.xlsx' })
      .mockResolvedValueOnce({ filename: 'w_Trs.csv', tipo: 'envista', nombre: 'Trs.csv' })
    apiService.previewValidated.mockResolvedValue(respuesta())
    apiService.validateFull.mockResolvedValue(respuesta())
    const { result } = montar()
    let ok = false
    await act(async () => { ok = await result.current.cargarGuardado('BD_2026.xlsx') })
    expect(ok).toBe(true)
    expect(apiService.uploadFile).not.toHaveBeenCalled()
    expect(apiService.previewValidated).toHaveBeenCalledWith('w_BD.xlsx', expect.any(Array))
    expect(result.current.descripcion).toBe('BD_2026.xlsx')
    await act(async () => { await result.current.cargarGuardado('Trs.csv') })
    expect(apiService.validateFull.mock.calls[0][0]).toBe('w_Trs.csv')
    expect(result.current.origen).toBe('envista')

    archivosApi.abrir.mockRejectedValue({ response: { data: { error: 'Ese archivo no está guardado.' } } })
    await act(async () => { ok = await result.current.cargarGuardado('x.xlsx') })
    expect(ok).toBe(false)
    expect(result.current.error).toBe('Ese archivo no está guardado.')
  })

  it('el error del backend se muestra tal cual', async () => {
    apiService.uploadFile.mockRejectedValue({ response: { data: { error: 'El archivo no contiene hoja Data' } } })
    const { result } = montar()
    await act(() => result.current.cargarArchivo(new File(['x'], 'a.xlsx'), 'validado'))
    expect(result.current.error).toBe('El archivo no contiene hoja Data')
    expect(result.current.cargando).toBe(false)
  })

  it('SIMAJ usa el periodo que se le pasa, no el anterior del estado', async () => {
    minutalesApi.descargar.mockResolvedValue(respuesta({ advertencia: 'Faltaron 3 estaciones' }))
    minutalesApi.progreso.mockResolvedValue({ activo: false })
    const { result } = montar()
    await act(() => result.current.cargarSimaj({ desde: '2026-09-01', hasta: '2026-09-07' }))
    expect(minutalesApi.descargar.mock.calls[0][0]).toEqual({ desde: '2026-09-01', hasta: '2026-09-08' })
    expect(result.current.origen).toBe('simaj')
    expect(result.current.descripcion).toBe('SIMAJ · 2026-09-01 a 2026-09-02')
    expect(result.current.advertencia).toBe('Faltaron 3 estaciones')
    act(() => result.current.descartarAdvertencia())
    expect(result.current.advertencia).toBeNull()
  })

  it('Emisiones: un 401 a media sesion apaga la sesion de Emisiones', async () => {
    emisionesApi.descargar.mockRejectedValue({ response: { status: 401, data: { error: 'Sesión vencida' } } })
    emisionesApi.sesion.mockResolvedValue({ activa: true, email: 'a@b.mx', caduca: null, recordada: true })
    const { result } = montar()
    await waitFor(() => expect(result.current.sesionEmisiones.activa).toBe(true))
    await act(() => result.current.cargarEmisiones({ desde: '2026-09-01', hasta: '2026-09-01' }))
    expect(emisionesApi.descargar.mock.calls[0][0]).toEqual({ desde: '2026-09-01 00:00', hasta: '2026-09-02 00:00' })
    expect(result.current.sesionEmisiones.activa).toBe(false)
    expect(result.current.error).toBe('Sesión vencida')
  })

  it('Emisiones: entrar y salir', async () => {
    emisionesApi.login.mockResolvedValue({ activa: true, email: 'a@b.mx', caduca: null, recordada: false })
    emisionesApi.salir.mockResolvedValue({ activa: false, email: null, caduca: null, recordada: false })
    const { result } = montar()
    await act(() => result.current.entrarEmisiones('a@b.mx', 'x', false))
    expect(result.current.sesionEmisiones.email).toBe('a@b.mx')
    await act(() => result.current.salirEmisiones())
    expect(result.current.sesionEmisiones.activa).toBe(false)
  })

  it('base local y descarga correcta', async () => {
    historicoApi.estado.mockResolvedValue({ disponible: true })
    historicoApi.cargar.mockResolvedValue(respuesta())
    emisionesApi.descargar.mockResolvedValue(respuesta())
    const { result } = montar()
    await waitFor(() => expect(result.current.historicoDisponible).toBe(true))
    await act(() => result.current.cargarHistorico({ desde: '2026-01-01', hasta: '2026-01-31' }))
    expect(historicoApi.cargar.mock.calls[0].slice(0, 2)).toEqual(['2026-01-01', '2026-02-01'])
    expect(result.current.origen).toBe('historico')
    await act(() => result.current.cargarEmisiones({ desde: '2026-09-01', hasta: '2026-09-01' }))
    expect(result.current.origen).toBe('emisiones')
  })

  it('MIR: cambiar contaminantes y marcar celdas en cero recalcula', async () => {
    minutalesApi.recalcularMir.mockResolvedValue({ mir: { estaciones: [1] }, fallas: [] })
    const { result } = montar()
    await act(() => result.current.alternarCeroMir('CEN', 'O3'))
    expect(minutalesApi.recalcularMir).toHaveBeenLastCalledWith(expect.any(Array), ['CEN:O3'])
    expect(result.current.comoCeroMir).toEqual(['CEN:O3'])
    await act(() => result.current.alternarCeroMir('CEN', 'O3'))
    expect(result.current.comoCeroMir).toEqual([])
    await act(() => result.current.cambiarContaminantesMir(['O3']))
    expect(result.current.contaminantesMir).toEqual(['O3'])

    minutalesApi.recalcularMir.mockRejectedValue(new Error('x'))
    await act(() => result.current.cambiarContaminantesMir(['PM10']))
    expect(result.current.error).toBe('No se pudo recalcular el indicador MIR.')
  })

  it('arranca con lo que entrega el shell y limpiar lo descarta', () => {
    const inicial = {
      resultado: respuesta() as never, mir: null, fallas: [], contaminantesMir: ['O3'], comoCeroMir: [],
      origen: 'simaj' as const, descripcion: 'SIMAJ', advertencia: null,
    }
    const { result, alCambiar } = montar(inicial)
    expect(result.current.origen).toBe('simaj')
    expect(alCambiar).not.toHaveBeenCalled() // el primer render es lo que el shell acaba de dar
    act(() => result.current.limpiar())
    expect(result.current.resultado).toBeNull()
    expect(alCambiar).toHaveBeenLastCalledWith(expect.objectContaining({ resultado: null }))
  })

  it('la configuracion y el periodo se recuerdan en el navegador', () => {
    const { result } = montar()
    act(() => result.current.setConfig((c) => ({ ...c, nox_tolerance: 0.3 })))
    act(() => result.current.setPeriodo({ desde: '2026-01-01', hasta: '2026-01-31' }))
    expect(JSON.parse(localStorage.getItem('validador.config')!).nox_tolerance).toBe(0.3)
    expect(JSON.parse(localStorage.getItem('validador.periodo')!)).toEqual({ desde: '2026-01-01', hasta: '2026-01-31' })
  })
})
