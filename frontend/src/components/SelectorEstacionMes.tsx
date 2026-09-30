import { nombreMes } from '../graficas/nom172';

interface Props {
  estaciones: string[];
  estacion: string;
  onEstacion: (e: string) => void;
  meses: string[];
  mes: string;
  onMes: (m: string) => void;
}

/** Estación y mes de las vistas de categorías NOM-172. */
export default function SelectorEstacionMes({
  estaciones, estacion, onEstacion, meses, mes, onMes,
}: Props) {
  const clase = 'px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent';
  return (
    <div className="flex flex-wrap gap-4">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        Estación:
        <select value={estacion} onChange={e => onEstacion(e.target.value)} className={clase}>
          {estaciones.map(s => (
            <option key={s} value={s}>{s === 'AMG' ? 'AMG (máximo de la red)' : s}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        Mes:
        <select value={mes} onChange={e => onMes(e.target.value)} className={clase}>
          {meses.map(m => <option key={m} value={m}>{nombreMes(m)}</option>)}
        </select>
      </label>
    </div>
  );
}
