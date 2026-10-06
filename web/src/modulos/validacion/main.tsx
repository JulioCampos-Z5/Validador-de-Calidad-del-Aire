// Validacion: traer datos (archivo, SIMAJ, API de Emisiones, base local),
// ajustar las validaciones y revisar el resultado. Son las piezas del
// frontend actual (src/legado) acomodadas en dos columnas: a la izquierda el
// panel Datos —lo que en el frontend actual era el menu lateral—, a la
// derecha el tablero de validacion.
import { montarLegado } from '../../legado/montar'
import OrigenDatos from '../../legado/components/OrigenDatos'
import DescargarApp from '../../legado/components/DescargarApp'
import AvisoDescarga from '../../legado/components/AvisoDescarga'
import Dashboard from '../../legado/pages/Dashboard'

montarLegado(() => (
  <div className="grid gap-5 p-5 lg:grid-cols-[300px_minmax(0,1fr)]">
    <aside className="lg:sticky lg:top-5 self-start bg-white border border-slate-200 rounded-2xl p-3 space-y-2">
      <h2 className="px-2 pt-1 text-xs font-semibold text-slate-500">Datos</h2>
      <OrigenDatos />
      <DescargarApp />
    </aside>
    <main className="min-w-0 space-y-4">
      <AvisoDescarga />
      <Dashboard />
    </main>
  </div>
))
