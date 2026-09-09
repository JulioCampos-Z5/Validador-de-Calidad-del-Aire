import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { diasDelPeriodo, useDatos } from '../estado/DatosContexto';
import CalendarioRango from './CalendarioRango';

/**
 * Periodo a consultar, común a todos los orígenes de red.
 *
 * Va arriba del todo, antes de elegir de dónde bajar los datos, porque es lo
 * primero que se decide: el periodo es una propiedad de lo que se quiere
 * mirar, no del sitio de donde se baja. Con un selector dentro de cada panel
 * era fácil pedirle al SIMAJ un tramo y a la API de Emisiones otro sin
 * enterarse, y entonces las dos fuentes dejan de ser comparables.
 *
 * El rango se elige en un calendario aparte y no con dos `<input type="date">`:
 * en 256 px de ancho aquellos quedaban apretados, cambiaban de aspecto según el
 * navegador y obligaban a abrir dos veces sin ver nunca las dos fechas juntas.
 *
 * No valida nada más allá de que el final sea posterior al inicio. Los topes
 * son de cada origen —la API de Emisiones no acepta más de un año, el SIMAJ
 * sí— y avisa cada panel, que es donde importan.
 */

const ATAJOS: { etiqueta: string; dias: number }[] = [
  { etiqueta: '7 días', dias: 7 },
  { etiqueta: '30 días', dias: 30 },
  { etiqueta: '90 días', dias: 90 },
];

function isoDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

/** `2026-09-08` -> `8 sep`. El año solo cuando no es el corriente. */
function corta(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  if (!a || !m || !d) return iso;
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const anio = a === new Date().getFullYear() ? '' : ` ${a}`;
  return `${d} ${meses[m - 1]}${anio}`;
}

export default function SelectorPeriodo() {
  const { periodo, setPeriodo, cargando } = useDatos();
  const [abierto, setAbierto] = useState(false);

  // Cuenta los dos extremos, igual que el calendario: si no, el mismo periodo
  // tendria dos numeros distintos segun donde se mire.
  const dias = diasDelPeriodo(periodo);
  const invertido = Number.isFinite(dias) && dias <= 0;

  return (
    <div className="px-3 pb-3">
      <div className="px-2.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
        <button
          type="button"
          disabled={cargando}
          onClick={() => setAbierto(true)}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-white border border-slate-300 text-left hover:border-primary-400 transition-colors disabled:opacity-50"
        >
          <CalendarDays size={16} className="shrink-0 text-slate-400" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-700 truncate">
              {corta(periodo.desde)} — {corta(periodo.hasta)}
            </span>
            <span className="block text-[11px] text-slate-400 tabular-nums">
              {invertido ? 'periodo inválido' : `${dias} ${dias === 1 ? 'día' : 'días'}`}
            </span>
          </span>
        </button>

        <div className="flex gap-1">
          {ATAJOS.map(({ etiqueta, dias: d }) => {
            const activo = periodo.desde === isoDias(d - 1) && periodo.hasta === isoDias(0);
            return (
              <button
                key={d}
                type="button"
                disabled={cargando}
                onClick={() => setPeriodo({ desde: isoDias(d - 1), hasta: isoDias(0) })}
                className={`flex-1 px-1 py-1 rounded-md text-[11px] font-medium border transition-colors disabled:opacity-50 ${
                  activo
                    ? 'bg-primary-50 border-primary-300 text-primary-700'
                    : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {etiqueta}
              </button>
            );
          })}
        </div>

        {invertido && (
          <p className="text-[11px] text-amber-700 leading-snug">
            La fecha final debe ser posterior a la inicial.
          </p>
        )}
      </div>

      {abierto && (
        <CalendarioRango
          desde={periodo.desde}
          hasta={periodo.hasta}
          onCerrar={() => setAbierto(false)}
          onAceptar={(rango) => { setPeriodo(rango); setAbierto(false); }}
        />
      )}
    </div>
  );
}
