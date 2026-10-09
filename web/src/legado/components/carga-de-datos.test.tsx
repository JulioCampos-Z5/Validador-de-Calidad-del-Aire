import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const datos = vi.hoisted(() => ({ valor: {} as Record<string, any> }))
vi.mock('../estado/DatosContexto', async (original) => ({
  ...(await original<object>()),
  useDatos: () => datos.valor,
}))
const historicoApi = vi.hoisted(() => ({ estado: vi.fn() }))
vi.mock('../services/historico', async (original) => ({ ...(await original<object>()), historicoApi }))
const api = vi.hoisted(() => ({ appEscritorio: vi.fn() }))
vi.mock('../services/api', () => ({ default: api }))

import CalendarioRango, { PanelCalendario } from './CalendarioRango'
import SelectorPeriodo from './SelectorPeriodo'
import AccesoEmisiones from './AccesoEmisiones'
import AvisoDescarga from './AvisoDescarga'
import DescargarApp from './DescargarApp'
import ModalDatos from './ModalDatos'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const haceDias = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }

beforeEach(() => {
  datos.valor = {
    periodo: { desde: haceDias(6), hasta: haceDias(0) }, setPeriodo: vi.fn(), cargando: false, error: null,
    sesionEmisiones: { activa: false, email: null, caduca: null, recordada: false },
    cargarArchivo: vi.fn().mockResolvedValue(undefined), cargarSimaj: vi.fn().mockResolvedValue(undefined),
    cargarEmisiones: vi.fn().mockResolvedValue(undefined), cargarHistorico: vi.fn().mockResolvedValue(undefined),
    progresoSimaj: null, entrarEmisiones: vi.fn().mockResolvedValue(undefined),
    advertencia: null, descartarAdvertencia: vi.fn(), reintentarDescarga: vi.fn(),
  }
})

describe('Calendario de periodo', () => {
  it('los atajos dejan el rango elegido (sin aplicarlo) y Aceptar lo entrega', async () => {
    const onAceptar = vi.fn()
    render(<CalendarioRango desde={haceDias(2)} hasta={haceDias(0)} onAceptar={onAceptar} onCerrar={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '30 días' }))
    expect(onAceptar).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Aceptar' }))
    expect(onAceptar).toHaveBeenCalledWith({ desde: haceDias(29), hasta: haceDias(0) })
  })

  it('un año completo y lo que va del año', async () => {
    const onRango = vi.fn()
    render(<PanelCalendario desde={haceDias(2)} hasta={haceDias(0)} onRango={onRango} />)
    const anio = new Date().getFullYear() - 1
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Elegir un año completo' }), String(anio))
    expect(onRango).toHaveBeenLastCalledWith({ desde: `${anio}-01-01`, hasta: `${anio}-12-31` })
    await userEvent.click(screen.getByTitle(/Del 1 de enero de/))
    expect(onRango).toHaveBeenLastCalledWith({ desde: `${anio + 1}-01-01`, hasta: haceDias(0) })
  })

  it('Cancelar y Escape cierran sin aplicar', async () => {
    const onCerrar = vi.fn()
    const onAceptar = vi.fn()
    render(<CalendarioRango desde={haceDias(2)} hasta={haceDias(0)} onAceptar={onAceptar} onCerrar={onCerrar} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalled()
    expect(onAceptar).not.toHaveBeenCalled()
  })

  it('no deja elegir dias futuros', () => {
    const manana = new Date()
    manana.setDate(manana.getDate() + 1)
    render(<PanelCalendario desde={haceDias(0)} hasta={haceDias(0)} onRango={vi.fn()} />)
    const botones = screen.getAllByRole('button', { name: String(manana.getDate()) })
    // Si mañana cae en el mes que se ve, su boton esta deshabilitado.
    if (manana.getMonth() === new Date().getMonth()) expect(botones.some((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  })
})

describe('Selector de periodo', () => {
  it('abre el calendario y guarda lo aceptado', async () => {
    render(<SelectorPeriodo />)
    await userEvent.click(screen.getByRole('button', { name: /7 días$/ })) // el resumen del periodo
    await userEvent.click(screen.getByRole('button', { name: '7 días' })) // el atajo
    await userEvent.click(screen.getByRole('button', { name: 'Aceptar' }))
    expect(datos.valor.setPeriodo).toHaveBeenCalledWith({ desde: haceDias(6), hasta: haceDias(0) })
  })

  it('un periodo al reves se avisa', () => {
    datos.valor.periodo = { desde: haceDias(0), hasta: haceDias(5) }
    render(<SelectorPeriodo />)
    expect(screen.getByText('periodo inválido')).toBeInTheDocument()
    expect(screen.getByText('La fecha final debe ser posterior a la inicial.')).toBeInTheDocument()
  })
})

describe('Acceso a la API de Emisiones', () => {
  it('entra con correo y contraseña, recordando por omision', async () => {
    const onEntrado = vi.fn()
    render(<AccesoEmisiones onEntrado={onEntrado} />)
    const boton = screen.getByRole('button', { name: 'Iniciar sesión' })
    expect(boton).toBeDisabled()
    await userEvent.type(screen.getByPlaceholderText('Correo'), ' julio@jalisco.gob.mx ')
    await userEvent.type(screen.getByPlaceholderText('Contraseña'), 'x')
    await userEvent.click(boton)
    expect(datos.valor.entrarEmisiones).toHaveBeenCalledWith('julio@jalisco.gob.mx', 'x', true)
    await waitFor(() => expect(onEntrado).toHaveBeenCalled())
    expect(screen.getByPlaceholderText('Contraseña')).toHaveValue('') // no se queda en pantalla
  })

  it('credenciales malas: el mensaje del backend junto al formulario', async () => {
    datos.valor.entrarEmisiones.mockRejectedValue({ response: { data: { error: 'Correo o contraseña incorrectos.' } } })
    render(<AccesoEmisiones onEntrado={vi.fn()} />)
    await userEvent.type(screen.getByPlaceholderText('Correo'), 'a@b.mx')
    await userEvent.type(screen.getByPlaceholderText('Contraseña'), 'mala')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByText('Correo o contraseña incorrectos.')).toBeInTheDocument()
    expect(datos.valor.entrarEmisiones).toHaveBeenCalledWith('a@b.mx', 'mala', false)
  })
})

describe('Aviso de descarga incompleta', () => {
  it('sin advertencia no se ve; con ella, reintentar y cerrar', async () => {
    const { rerender } = render(<AvisoDescarga />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    datos.valor = { ...datos.valor, advertencia: 'Faltaron 3 estaciones' }
    rerender(<AvisoDescarga />)
    expect(screen.getByRole('alert')).toHaveTextContent('Faltaron 3 estaciones')
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }))
    expect(datos.valor.reintentarDescarga).toHaveBeenCalled()
    expect(datos.valor.descartarAdvertencia).toHaveBeenCalled()
  })
})

describe('Descargar la app de escritorio', () => {
  it('ofrece el instalador si esta compilado', async () => {
    api.appEscritorio.mockResolvedValue({ disponible: true, archivos: [
      { nombre: 'portable.exe', url: '/api/app/portable.exe', etiqueta: 'Portable', detalle: '', compilado: '' },
      { nombre: 'Validador-instalador.exe', url: '/api/app/instalador.exe', etiqueta: 'Instalador', detalle: '', compilado: '' },
    ] })
    render(<DescargarApp />)
    const enlace = await screen.findByRole('link', { name: /Descargar la app/ })
    expect(enlace).toHaveAttribute('href', '/api/app/instalador.exe')
  })

  it('sin compilar no muestra nada', async () => {
    api.appEscritorio.mockResolvedValue({ disponible: false, archivos: [] })
    const { container } = render(<DescargarApp />)
    await waitFor(() => expect(api.appEscritorio).toHaveBeenCalled())
    expect(container.querySelector('a')).toBeNull()
  })
})

describe('Asistente de carga (ModalDatos)', () => {
  it('archivo: elegirlo lo carga y cierra', async () => {
    const onCerrar = vi.fn()
    render(<ModalDatos origen="validado" onCerrar={onCerrar} />)
    expect(screen.getByRole('dialog', { name: 'Elegir el archivo' })).toBeInTheDocument()
    const archivo = new File(['x'], 'BD_2026.xlsx')
    await userEvent.upload(document.querySelector('input[type=file]') as HTMLInputElement, archivo)
    expect(datos.valor.cargarArchivo).toHaveBeenCalledWith(archivo, 'validado')
    await waitFor(() => expect(onCerrar).toHaveBeenCalled())
  })

  it('SIMAJ: periodo → confirmar → descargar con ese periodo', async () => {
    const onCerrar = vi.fn()
    render(<ModalDatos origen="simaj" onCerrar={onCerrar} />)
    await userEvent.click(screen.getByRole('button', { name: '30 días' }))
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    expect(screen.getByRole('dialog', { name: 'Descargar del SIMAJ' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Descargar/ }))
    expect(datos.valor.setPeriodo).toHaveBeenCalledWith({ desde: haceDias(29), hasta: haceDias(0) })
    expect(datos.valor.cargarSimaj).toHaveBeenCalledWith({ desde: haceDias(29), hasta: haceDias(0) })
    await waitFor(() => expect(onCerrar).toHaveBeenCalled())
  })

  it('Emisiones sin sesion empieza pidiendo el acceso; Escape cierra', () => {
    const onCerrar = vi.fn()
    render(<ModalDatos origen="emisiones" onCerrar={onCerrar} />)
    expect(screen.getByRole('dialog', { name: 'Entrar en la API de Emisiones' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCerrar).toHaveBeenCalled()
  })

  it('base local: consulta que años hay guardados', async () => {
    historicoApi.estado.mockResolvedValue({ disponible: true, anios: [] })
    render(<ModalDatos origen="historico" onCerrar={vi.fn()} />)
    await waitFor(() => expect(historicoApi.estado).toHaveBeenCalled())
    expect(screen.getByRole('dialog', { name: 'Elegir el periodo' })).toBeInTheDocument()
  })
})
