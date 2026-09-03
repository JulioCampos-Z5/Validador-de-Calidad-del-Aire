import { CheckCircle2, XCircle, Info } from 'lucide-react';
import type { Mir } from '../services/minutales';
import { CONTAMINANTES_CRITERIO } from '../services/minutales';

/**
 * Indicador MIR: representatividad de los datos.
 *
 * No mide contaminación, mide cuánto dato hay. Se promedia el porcentaje de
 * horas válidas de los contaminantes elegidos y se compara contra el 75%.
 *
 * Dos reglas del área técnica que están replicadas tal cual, porque cambiarlas
 * altera el resultado:
 *   · El promedio es simple entre contaminantes, no ponderado por horas.
 *   · Un contaminante sin equipo se EXCLUYE del promedio, no cuenta como cero.
 */
export default function TarjetaMir({
  mir,
  contaminantes,
  onCambiarContaminantes,
}: {
  mir: Mir;
  contaminantes: string[];
  onCambiarContaminantes: (c: string[]) => void;
}) {
  const alternar = (c: string) => {
    const siguiente = contaminantes.includes(c)
      ? contaminantes.filter((x) => x !== c)
      : [...CONTAMINANTES_CRITERIO.filter((x) => contaminantes.includes(x) || x === c)];
    // Nunca se deja la selección vacía: sin contaminantes el indicador no
    // significa nada y la tabla saldría en blanco sin explicación.
    if (siguiente.length > 0) onCambiarContaminantes(siguiente);
  };

  const color = (v: number | null) => {
    if (v === null) return 'text-slate-300';
    if (v >= mir.umbral) return 'text-slate-700';
    if (v < 25) return 'text-red-600 font-semibold';
    return 'text-amber-600 font-medium';
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
      <div className="p-5 border-b border-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Indicador MIR</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Representatividad de los datos: promedio de horas válidas por estación,
              contra un umbral del {mir.umbral}%.
            </p>
          </div>
          <div className="flex gap-6">
            <div className="text-right">
              <div className="text-xs text-slate-500 uppercase tracking-wide">Promedio</div>
              <div className="text-2xl font-bold text-slate-800 tabular-nums">
                {mir.promedio_periodo ?? '—'}%
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500 uppercase tracking-wide">Cumplen</div>
              <div className="text-2xl font-bold text-primary-600 tabular-nums">
                {mir.estaciones_que_cumplen}/{mir.total_estaciones}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            Contaminantes en el promedio
          </div>
          <div className="flex flex-wrap gap-2">
            {CONTAMINANTES_CRITERIO.map((c) => (
              <label
                key={c}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm cursor-pointer transition-colors ${
                  contaminantes.includes(c)
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={contaminantes.includes(c)}
                  onChange={() => alternar(c)}
                  className="rounded border-slate-300"
                />
                {c}
              </label>
            ))}
          </div>
          <p className="flex items-start gap-1.5 text-xs text-slate-400 mt-2">
            <Info size={13} className="mt-0.5 shrink-0" />
            Solo contaminantes criterio de la NOM-172. La meteorología no entra en el indicador.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-2.5 text-left font-medium text-slate-600">Estación</th>
              {mir.contaminantes.map((c) => (
                <th key={c} className="px-4 py-2.5 text-right font-medium text-slate-600">{c}</th>
              ))}
              <th className="px-4 py-2.5 text-right font-semibold text-slate-700">Total</th>
              <th className="px-4 py-2.5 text-center font-semibold text-slate-700">Cumple</th>
            </tr>
          </thead>
          <tbody>
            {mir.estaciones.map((e) => (
              <tr
                key={e.estacion}
                className={`border-b border-slate-100 ${e.cumple ? '' : 'bg-red-50/40'}`}
              >
                <td className="px-4 py-2 font-medium text-slate-700">{e.estacion}</td>
                {mir.contaminantes.map((c) => {
                  const v = e.coberturas[c] ?? null;
                  return (
                    <td key={c} className={`px-4 py-2 text-right tabular-nums ${color(v)}`}>
                      {/* El hueco se deja vacío, no como 0: en la hoja original esa
                          distinción separa "sin equipo" de "no reportó". */}
                      {v === null ? '—' : Math.round(v)}
                    </td>
                  );
                })}
                <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-800">
                  {e.total ?? '—'}
                </td>
                <td className="px-4 py-2 text-center">
                  {e.cumple ? (
                    <span className="inline-flex items-center gap-1 text-green-700">
                      <CheckCircle2 size={15} /> Sí
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                      <XCircle size={15} /> No
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200">
              <td className="px-4 py-2.5 font-medium text-slate-600" colSpan={mir.contaminantes.length + 1}>
                Porcentaje de datos válidos del periodo
              </td>
              <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-800">
                {mir.promedio_periodo ?? '—'}
              </td>
              <td className="px-4 py-2.5 text-center font-bold tabular-nums text-slate-800">
                {mir.estaciones_que_cumplen}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
