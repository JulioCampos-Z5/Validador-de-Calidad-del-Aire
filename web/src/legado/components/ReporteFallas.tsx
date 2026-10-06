import { AlertTriangle, PowerOff, Activity, MinusCircle } from 'lucide-react';
import type { Falla, TipoFalla } from '../services/minutales';

/**
 * Reporte de dónde están fallando las estaciones.
 *
 * El MIR dice "Vallarta 60, no cumple", que no le sirve a quien tiene que ir a
 * arreglarlo. Esto señala el canal concreto y separa tres situaciones que se
 * atienden de forma distinta: no hay instrumento, el instrumento está caído, o
 * reporta a ratos. La última suele ser la más cara de diagnosticar y la que más
 * conviene sacar a la luz.
 */

const ESTILOS: Record<TipoFalla, {
  etiqueta: string;
  icono: typeof AlertTriangle;
  clase: string;
  explicacion: string;
}> = {
  caido: {
    etiqueta: 'Caído',
    icono: PowerOff,
    clase: 'bg-red-50 text-red-700 border-red-200',
    explicacion: 'Hay equipo pero reporta menos del 25% de las horas.',
  },
  intermitente: {
    etiqueta: 'Intermitente',
    icono: Activity,
    clase: 'bg-amber-50 text-amber-700 border-amber-200',
    explicacion: 'Reporta a ratos, por debajo del umbral de suficiencia.',
  },
  sin_equipo: {
    etiqueta: 'Sin equipo',
    icono: MinusCircle,
    clase: 'bg-slate-50 text-slate-500 border-slate-200',
    explicacion: 'Ni una lectura en el periodo. Suele ser una decisión, no una avería.',
  },
};

export default function ReporteFallas({ fallas }: { fallas: Falla[] }) {
  if (fallas.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 text-center">
        <p className="text-sm text-slate-500">
          Ningún canal por debajo del umbral en este periodo.
        </p>
      </div>
    );
  }

  const criticas = fallas.filter((f) => f.hunde_a_la_estacion);
  const resto = fallas.filter((f) => !f.hunde_a_la_estacion);

  const porTipo = (t: TipoFalla) => fallas.filter((f) => f.tipo === t).length;

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
      <div className="p-5 border-b border-slate-200">
        <h2 className="text-lg font-semibold text-slate-800">Dónde están fallando las estaciones</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          {fallas.length} canales por debajo del umbral.
          {criticas.length > 0 && (
            <> <strong className="text-red-600">{criticas.length}</strong> tumban a su estación.</>
          )}
        </p>

        <div className="flex flex-wrap gap-2 mt-3">
          {(Object.keys(ESTILOS) as TipoFalla[]).map((t) => {
            const n = porTipo(t);
            if (n === 0) return null;
            const { etiqueta, icono: Icono, clase, explicacion } = ESTILOS[t];
            return (
              <span
                key={t}
                title={explicacion}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${clase}`}
              >
                <Icono size={13} /> {etiqueta}: {n}
              </span>
            );
          })}
        </div>
      </div>

      <Grupo
        titulo="Tumban a su estación"
        descripcion="Estos canales son los que hacen que la estación no alcance el umbral. Atender primero."
        fallas={criticas}
        destacar
      />
      <Grupo
        titulo="La estación cumple, pero el canal no"
        descripcion="No comprometen el indicador, aunque el dato de ese contaminante no es utilizable."
        fallas={resto}
      />
    </div>
  );
}

function Grupo({
  titulo, descripcion, fallas, destacar,
}: {
  titulo: string;
  descripcion: string;
  fallas: Falla[];
  destacar?: boolean;
}) {
  if (fallas.length === 0) return null;

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div className={`px-5 py-2.5 ${destacar ? 'bg-red-50/60' : 'bg-slate-50'}`}>
        <h3 className="text-sm font-medium text-slate-700">{titulo}</h3>
        <p className="text-xs text-slate-500">{descripcion}</p>
      </div>
      <div className="divide-y divide-slate-100">
        {fallas.map((f) => {
          const { etiqueta, icono: Icono, clase } = ESTILOS[f.tipo];
          return (
            <div
              key={`${f.estacion}-${f.contaminante}`}
              className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm"
            >
              <span className="font-medium text-slate-700 w-16 shrink-0">{f.estacion}</span>
              <span className="font-mono text-slate-600 w-16 shrink-0">{f.contaminante}</span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium shrink-0 ${clase}`}
              >
                <Icono size={12} /> {etiqueta}
              </span>
              <span className="text-slate-500 text-xs">{f.detalle}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
