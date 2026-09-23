import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { useDatos } from '../estado/DatosContexto';

/**
 * Aviso de descarga incompleta, arriba de todas las páginas.
 *
 * Va aquí y no en el menú porque cambia cómo hay que leer todo lo demás: con
 * horas que no llegaron, el MIR y las validaciones marcan como falla de la
 * estación lo que en realidad fue la red de esta computadora. Tiene que verse
 * esté donde esté el usuario.
 */
export default function AvisoDescarga() {
  const { advertencia, descartarAdvertencia, reintentarDescarga, cargando } = useDatos();
  if (!advertencia) return null;

  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
      <p className="flex-1 leading-relaxed">{advertencia}</p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => { void reintentarDescarga(); }}
          disabled={cargando}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
        >
          <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} />
          {cargando ? 'Reintentando…' : 'Reintentar'}
        </button>
        <button
          type="button"
          onClick={descartarAdvertencia}
          aria-label="Cerrar aviso"
          title="Cerrar aviso"
          className="rounded p-1 text-amber-700 hover:bg-amber-100"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
