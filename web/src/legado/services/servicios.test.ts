import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Adaptador falso: anota cada peticion y responde lo que diga `responder`.
// Se instala antes de importar los servicios: axios.create copia los valores
// por defecto al crear cada instancia.
interface Pedido { metodo: string; url: string; params?: Record<string, unknown>; cuerpo: unknown; auth?: string }
const pedidos: Pedido[] = []
let responder: (p: Pedido) => { estado?: number; datos: unknown } = () => ({ datos: {} })

const adaptador: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  const p: Pedido = {
    metodo: (config.method ?? 'get').toUpperCase(),
    url: `${config.baseURL ?? ''}${config.url ?? ''}`,
    params: config.params,
    cuerpo: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
    auth: config.headers?.get?.('Authorization') as string | undefined,
  }
  pedidos.push(p)
  const { estado = 200, datos } = responder(p)
  const r = { data: datos, status: estado, statusText: '', headers: {}, config, request: {} }
  if (estado >= 400) {
    const e = new axios.AxiosError('error', 'ERR', config, {}, r)
    throw e
  }
  return r
}
axios.defaults.adapter = adaptador

let sesion: typeof import('../sesion')
let api: typeof import('./api').default
let ias: typeof import('./ias').iasApi
let minutales: typeof import('./minutales').minutalesApi
let emisiones: typeof import('./emisiones').emisionesApi
let historico: typeof import('./historico')

beforeAll(async () => {
  sesion = await import('../sesion')
  api = (await import('./api')).default
  ias = (await import('./ias')).iasApi
  minutales = (await import('./minutales')).minutalesApi
  emisiones = (await import('./emisiones')).emisionesApi
  historico = await import('./historico')
})

beforeEach(() => {
  pedidos.length = 0
  responder = () => ({ datos: {} })
})

describe('sesion (puente con la API de Go)', () => {
  it('aAnalisis: /api/... pasa por /api/analisis/...', () => {
    expect(sesion.aAnalisis('/api/minutales')).toBe('/api/analisis/minutales')
    expect(sesion.aAnalisis('/api')).toBe('/api/analisis')
    expect(sesion.aAnalisis('/apix')).toBe('/apix')
  })

  it('cada peticion lleva el token; solo el 401 de la API de Go saca de la sesion', async () => {
    const vencida = vi.fn()
    sesion.configurarSesion('tok-1', vencida)
    responder = () => ({ estado: 401, datos: { error: 'token invalido o vencido' } })
    await expect(api.healthCheck()).rejects.toBeTruthy()
    expect(pedidos[0].auth).toBe('Bearer tok-1')
    expect(vencida).toHaveBeenCalledOnce()

    // Un 401 de Flask (p. ej. el token de Emisiones vencio) no cierra la sesion del validador.
    responder = () => ({ estado: 401, datos: { error: 'No hay sesión. Inicia sesión en la API de Emisiones.' } })
    await expect(emisiones.descargar({ desde: 'a', hasta: 'b' })).rejects.toBeTruthy()
    expect(vencida).toHaveBeenCalledOnce()
  })
})

describe('servicios', () => {
  beforeEach(() => sesion.configurarSesion('t', vi.fn()))

  it('validacion y configuracion', async () => {
    responder = (p) => ({ datos: p.url.endsWith('/registros') ? { registros: [], capacidad: 300 } : { ok: p.url } })
    await api.registros('ERROR')
    await api.limpiarRegistros()
    await api.appEscritorio()
    await api.getConfig()
    await api.getRangos()
    await api.getBanderas()
    await api.getEstaciones()
    await api.validateData('BD.xlsx')
    await api.validateFull('BD.xlsx', { rangos: true }, true, ['O3'])
    await api.previewValidated('BD.xlsx', ['O3'])
    await api.previewFile('BD.xlsx')
    await api.getStats('BD.xlsx')
    await api.uploadFile(new File(['x'], 'BD.xlsx'))
    expect(pedidos.map((p) => `${p.metodo} ${p.url}`)).toEqual([
      'GET /api/analisis/registros', 'DELETE /api/analisis/registros', 'GET /api/analisis/app-escritorio',
      'GET /api/analisis/config', 'GET /api/analisis/config/rangos', 'GET /api/analisis/config/banderas',
      'GET /api/analisis/config/estaciones', 'POST /api/analisis/validate', 'POST /api/analisis/validate/full',
      'POST /api/analisis/preview-validated', 'GET /api/analisis/preview/BD.xlsx', 'GET /api/analisis/stats/BD.xlsx',
      'POST /api/analisis/upload',
    ])
    expect(pedidos[0].params).toEqual({ nivel: 'ERROR', limite: 200 })
    expect(pedidos[8].cuerpo).toEqual({ filename: 'BD.xlsx', config: { rangos: true }, revalidate: true, contaminantes: ['O3'] })
    expect(pedidos[12].cuerpo).toBeInstanceOf(FormData)
    expect(api.downloadFile('BD.xlsx')).toBe('/api/download/BD.xlsx')
  })

  it('IAS: resumen, categorias y las dos tablas MIDE', async () => {
    responder = (p) => ({
      datos: p.url.endsWith('/categorias') ? { dias: [{ fecha: '2026-09-01' }] }
        : p.url.endsWith('/mide') ? { amg: [{ MES: 'TOTAL' }], municipios: [] } : { estaciones: ['CEN'] },
    })
    expect(await ias.resumen()).toEqual({ estaciones: ['CEN'] })
    expect(await ias.categorias('CEN', '2026-09')).toEqual([{ fecha: '2026-09-01' }])
    expect(pedidos[1].params).toEqual({ estacion: 'CEN', mes: '2026-09' })
    expect(await ias.mide()).toEqual({ amg: [{ MES: 'TOTAL' }], municipios: [] })
    expect(pedidos[2].url).toBe('/api/analisis/ias/mide')
    expect(ias.urlDiario).toBe('/api/ias/diario.xlsx')
  })

  it('minutales (SIMAJ y MIR)', async () => {
    responder = (p) => ({ datos: p.url.endsWith('/estaciones') ? { estaciones: ['CEN'] } : { mir: {}, fallas: [] } })
    expect(await minutales.estaciones()).toEqual(['CEN'])
    await minutales.progreso()
    await minutales.descargar({ desde: '2026-09-01', hasta: '2026-09-02' }, ['O3'])
    await minutales.recalcularMir(['O3'], ['CEN:O3'])
    expect(pedidos[2].cuerpo).toMatchObject({ desde: '2026-09-01', hasta: '2026-09-02', contaminantes: ['O3'] })
    expect(pedidos[3].cuerpo).toEqual({ contaminantes: ['O3'], umbral: 75, como_cero: ['CEN:O3'] })
    expect(minutales.urlReporteMir(['O3', 'PM2.5'])).toBe('/api/minutales/reporte.xlsx?contaminantes=O3%2CPM2.5')
    expect(minutales.urlReporteMir(['O3'], ['CEN:O3'])).toContain('&como_cero=CEN%3AO3')
  })

  it('Emisiones: la contraseña va en el cuerpo, no en la URL', async () => {
    responder = () => ({ datos: { activa: true } })
    await emisiones.sesion()
    await emisiones.login('a@b.mx', 'secreta', true)
    await emisiones.salir()
    expect(pedidos[1]).toMatchObject({ metodo: 'POST', url: '/api/analisis/emisiones/login', cuerpo: { email: 'a@b.mx', password: 'secreta', recordar: true } })
    expect(pedidos.every((p) => !p.url.includes('secreta'))).toBe(true)
  })

  it('base local (historico)', async () => {
    const h = historico.historicoApi
    await h.estado()
    await h.cargar('2026-01-01', '2026-02-01', ['O3'])
    await h.serie('2026-01-01', '2026-02-01', 'O3')
    await h.analizar()
    await h.aplicar('x', true)
    await h.descartar('x')
    await h.descargar('2026-01-01', '2026-02-01')
    await h.avanceDescarga()
    await h.cancelarDescarga()
    await h.pendientes()
    await h.aplicarPendientes()
    await h.descartarPendientes()
    await h.cambiosDeCarga(7)
    expect(pedidos.every((p) => p.url.startsWith('/api/analisis/historico/'))).toBe(true)
    expect(pedidos[4].cuerpo).toEqual({ id: 'x', actualizar_cambios: true })
    expect(pedidos.at(-1)?.url).toBe('/api/analisis/historico/cargas/7/cambios')
    expect(historico.mensajeError({ response: { data: { error: 'falló' } } }, 'genérico')).toBe('falló')
    expect(historico.mensajeError(new Error('x'), 'genérico')).toBe('genérico')
  })
})

describe('descargas con sesion', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('un enlace a /api/... se baja por /api/analisis con el token y el nombre del servidor', async () => {
    sesion.configurarSesion('tok-d', vi.fn())
    sesion.instalarDescargas()
    const fetch = vi.fn().mockResolvedValue(new Response('xlsx', {
      headers: { 'Content-Disposition': 'attachment; filename="BD_2026_DIARIO.xlsx"' },
    }))
    vi.stubGlobal('fetch', fetch)
    let descargado = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      if (this.download) descargado = this.download
    })

    const a = document.createElement('a')
    a.href = '/api/ias/diario.xlsx'
    document.body.append(a)
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(descargado).toBe('BD_2026_DIARIO.xlsx'))
    expect(fetch.mock.calls[0][0]).toBe('/api/analisis/ias/diario.xlsx')
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-d')
    a.remove()
  })

  it('un error se muestra con el mensaje del servidor; un 401 cierra la sesion', async () => {
    const vencida = vi.fn()
    sesion.configurarSesion('t', vencida)
    const alerta = vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Sin datos' }), { status: 409 })))
    await sesion.descargarConSesion('/api/ias/mide.xlsx')
    expect(alerta).toHaveBeenCalledWith('Sin datos')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
    await sesion.descargarConSesion('/api/ias/mide.xlsx')
    expect(vencida).toHaveBeenCalled()
  })
})
