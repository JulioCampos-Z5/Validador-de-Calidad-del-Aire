// Preparación común de las pruebas del front v2 (vite.config.ts → test).
import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  try { localStorage.clear() } catch { /* sin almacenamiento */ }
})

// jsdom no trae lo que usan Plotly, Recharts y los paneles con tamaño.
class SinObservar {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= SinObservar as unknown as typeof ResizeObserver
globalThis.IntersectionObserver ??= SinObservar as unknown as typeof IntersectionObserver
if (!window.matchMedia) {
  window.matchMedia = (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }) as MediaQueryList
}
URL.createObjectURL ??= () => 'blob:prueba'
URL.revokeObjectURL ??= () => {}
if (!('fonts' in document)) {
  Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() } })
}
Element.prototype.scrollIntoView ??= function () {}
