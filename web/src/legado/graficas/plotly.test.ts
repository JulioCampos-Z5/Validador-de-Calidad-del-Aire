import { describe, expect, it, vi } from 'vitest'

// Plotly real necesita canvas; aqui solo se prueba el envoltorio: que ponga
// los colores del tema y los cambie al pasar a modo oscuro.
const base = vi.hoisted(() => ({
  register: vi.fn(), setPlotConfig: vi.fn(),
  react: vi.fn(), newPlot: vi.fn(), purge: vi.fn(), relayout: vi.fn(),
}))
vi.mock('plotly.js/lib/core', () => ({ default: base }))
vi.mock('plotly.js/lib/bar', () => ({ default: {} }))
vi.mock('plotly.js/lib/heatmap', () => ({ default: {} }))
vi.mock('plotly.js/lib/violin', () => ({ default: {} }))

import Plotly from './plotly'

describe('Plotly con el tema del validador', () => {
  it('se registra en español, sin logo ni nube', () => {
    expect(base.setPlotConfig).toHaveBeenCalledWith(expect.objectContaining({ displaylogo: false, locale: 'es' }))
    expect(base.register).toHaveBeenCalledWith(expect.objectContaining({ moduleType: 'locale', name: 'es' }))
  })

  it('react y newPlot llevan fondo transparente y los colores del tema en los ejes', () => {
    document.documentElement.style.setProperty('--tx', 'rgb(1, 2, 3)')
    const div = document.createElement('div')
    document.body.append(div)
    Plotly.react(div, [], { title: 'Serie', yaxis: { title: 'O3' }, yaxis2: {}, legend: {} })
    const layout = base.react.mock.calls[0][2]
    expect(layout.paper_bgcolor).toBe('rgba(0,0,0,0)')
    expect(layout.font.color).toBe('rgb(1, 2, 3)')
    expect(layout.title).toEqual({ text: 'Serie', font: { color: 'rgb(1, 2, 3)' } })
    expect(layout.yaxis.title.text).toBe('O3')
    expect(layout.yaxis2.gridcolor).toBeDefined()
    expect(layout.xaxis).toBeDefined() // se agrega aunque no venga

    Plotly.newPlot(div, [], undefined)
    expect(base.newPlot.mock.calls[0][2].xaxis).toBeDefined()
  })

  it('al cambiar el tema se vuelven a pintar las graficas vivas', async () => {
    const div = document.createElement('div')
    document.body.append(div)
    Plotly.react(div, [], {})
    base.relayout.mockClear()
    document.documentElement.dataset.tema = 'oscuro'
    const conEste = () => base.relayout.mock.calls.filter(([d]) => d === div).length
    await vi.waitFor(() => expect(conEste()).toBe(1))

    Plotly.purge(div)
    expect(base.purge).toHaveBeenCalledWith(div)
    base.relayout.mockClear()
    document.documentElement.dataset.tema = 'claro'
    await new Promise((r) => setTimeout(r, 10))
    expect(conEste()).toBe(0) // la purgada ya no se repinta
  })
})
