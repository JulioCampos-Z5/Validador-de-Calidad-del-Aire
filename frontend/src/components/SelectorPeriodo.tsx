import { useDatos } from '../estado/DatosContexto';

/**
 * Periodo a consultar, común a todos los orígenes de red.
 *
 * Va arriba del todo, antes de elegir de dónde bajar los datos, porque es lo
 * primero que se decide: el periodo es una propiedad de lo que se quiere
 * mirar, no del sitio de donde se baja. Con un selector dentro de cada panel
 * era fácil pedirle al SIMAJ un tramo y a la API de Emisiones otro sin
 * enterarse, y entonces las dos fuentes dejan de ser comparables.
 *
 * No valida nada más allá de que el final sea posterior al inicio. Los topes
 * son de cada origen —la API de Emisiones no acepta más de 31 días, el SIMAJ
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

export default function SelectorPeriodo() {
  const { periodo, setPeriodo, cargando } = useDatos();

  const dias = Math.round(
    (new Date(periodo.hasta).getTime() - new Date(periodo.desde).getTime()) / 86_400_000,
  );
  const invertido = Number.isFinite(dias) && dias <= 0;

  const campo = 'w-full border border-slate-300 rounded-md px-2 py-1 text-sm ' +
    'bg-white disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-primary-400';

  return (
    <div className="px-3 pb-3">
      <div className="px-2.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
        <label className="block">
          <span className="text-[11px] text-slate-500">Desde</span>
          <input
            type="date"
            value={periodo.desde}
            max={periodo.hasta}
            disabled={cargando}
            onChange={(e) => setPeriodo((p) => ({ ...p, desde: e.target.value }))}
            className={campo}
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-slate-500">Hasta</span>
          <input
            type="date"
            value={periodo.hasta}
            min={periodo.desde}
            disabled={cargando}
            onChange={(e) => setPeriodo((p) => ({ ...p, hasta: e.target.value }))}
            className={campo}
          />
        </label>

        <div className="flex gap-1">
          {ATAJOS.map(({ etiqueta, dias: d }) => {
            const activo = periodo.desde === isoDias(d) && periodo.hasta === isoDias(0);
            return (
              <button
                key={d}
                type="button"
                disabled={cargando}
                onClick={() => setPeriodo({ desde: isoDias(d), hasta: isoDias(0) })}
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

        {invertido ? (
          <p className="text-[11px] text-amber-700 leading-snug">
            La fecha final debe ser posterior a la inicial.
          </p>
        ) : (
          <p className="text-[11px] text-slate-400 tabular-nums">
            {dias} {dias === 1 ? 'día' : 'días'}
          </p>
        )}
      </div>
    </div>
  );
}
