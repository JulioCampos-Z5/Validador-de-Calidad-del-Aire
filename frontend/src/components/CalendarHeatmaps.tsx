import { useMemo, useState, useEffect, useRef } from 'react';
// @ts-ignore — bundle browser-ready sin .d.ts
import Plotly from 'plotly.js/dist/plotly.js';
import { CalendarDays } from 'lucide-react';
import { CONTAMINANTES as CONTAMINANTES_CONST, getUnitsAndName } from '../constants';

interface DataPoint {
  STATION: string;
  DATE: string;
  HOUR: number;
  [key: string]: string | number | null;
}

interface CalendarHeatmapsProps {
  data: DataPoint[];
}

// Umbrales aproximados del Índice "Aire y Salud" (NOM / Redspira) por parámetro.
// 5 categorías: Buena, Regular, Mala, Muy Mala, Extremadamente Mala.
const UMBRALES: Record<string, number[]> = {
  'PM2.5': [25, 45, 79, 147],     // µg/m³
  PM10:   [50, 75, 155, 235],     // µg/m³
  O3:     [0.051, 0.070, 0.092, 0.114], // ppm 1h
  NO2:    [0.107, 0.210, 0.230, 0.250], // ppm
  SO2:    [0.040, 0.075, 0.185, 0.304], // ppm
  CO:     [8.75, 11, 13.3, 15.5],       // ppm
};

const CATEGORIA_LABELS = ['Buena', 'Regular', 'Mala', 'Muy Mala', 'Extr. Mala'];
const CATEGORIA_COLORS = ['#66BB6A', '#FFEB3B', '#FF9800', '#F44336', '#9C27B0'];

const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const HORAS_LABELS = [
  '12 AM', '01 AM', '02 AM', '03 AM', '04 AM', '05 AM', '06 AM', '07 AM',
  '08 AM', '09 AM', '10 AM', '11 AM', '12 PM', '01 PM', '02 PM', '03 PM',
  '04 PM', '05 PM', '06 PM', '07 PM', '08 PM', '09 PM', '10 PM', '11 PM',
];

function clasificar(valor: number, umbrales: number[]): number {
  for (let i = 0; i < umbrales.length; i++) {
    if (valor <= umbrales[i]) return i;
  }
  return umbrales.length; // 4
}

function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export default function CalendarHeatmaps({ data }: CalendarHeatmapsProps) {
  const estaciones = useMemo(
    () => Array.from(new Set(data.map(d => d.STATION))).sort(),
    [data],
  );

  const parametrosDisponibles = useMemo(
    () => CONTAMINANTES_CONST.filter(p => p in UMBRALES),
    [],
  );

  const [estacion, setEstacion] = useState<string>('');
  const [parametro, setParametro] = useState<string>('PM2.5');

  useEffect(() => {
    if (estaciones.length > 0 && !estaciones.includes(estacion)) {
      setEstacion(estaciones[0]);
    }
  }, [estaciones, estacion]);

  // Agrupar datos: { 'YYYY-MM': { day: { hour: value } } }
  const datosPorMes = useMemo(() => {
    const result: Record<string, Record<number, Record<number, number | null>>> = {};
    const umbrales = UMBRALES[parametro];
    if (!umbrales || !estacion) return result;

    for (const fila of data) {
      if (fila.STATION !== estacion) continue;
      const valor = toNumber(fila[parametro] as any);
      if (valor === null) continue;

      const fecha = new Date(fila.DATE);
      if (Number.isNaN(fecha.getTime())) continue;

      const yyyymm = `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}`;
      const dia = fecha.getUTCDate();
      const hora = Number(fila.HOUR);
      if (!Number.isInteger(hora) || hora < 0 || hora > 23) continue;

      if (!result[yyyymm]) result[yyyymm] = {};
      if (!result[yyyymm][dia]) result[yyyymm][dia] = {};
      result[yyyymm][dia][hora] = clasificar(valor, umbrales);
    }
    return result;
  }, [data, estacion, parametro]);

  const mesesOrdenados = useMemo(
    () => Object.keys(datosPorMes).sort(),
    [datosPorMes],
  );

  if (estaciones.length === 0 || parametrosDisponibles.length === 0) {
    return null;
  }

  const info = getUnitsAndName(parametro);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mt-6">
      <div className="flex items-center gap-3 mb-4">
        <CalendarDays className="w-6 h-6 text-blue-600" />
        <div>
          <h2 className="text-xl font-bold text-gray-900">Calendario por Hora</h2>
          <p className="text-sm text-gray-600">
            Visualización tipo Redspira: cada celda es una hora de un día, coloreada por el índice
            de calidad del aire del contaminante seleccionado.
          </p>
        </div>
      </div>

      {/* Controles */}
      <div className="flex flex-wrap gap-4 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Estación:</label>
          <select
            value={estacion}
            onChange={e => setEstacion(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {estaciones.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Contaminante:</label>
          <div className="flex gap-1">
            {parametrosDisponibles.map(p => (
              <button
                key={p}
                onClick={() => setParametro(p)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  parametro === p
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-3 mb-4 text-xs">
        {CATEGORIA_LABELS.map((label, i) => (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className="w-4 h-4 rounded"
              style={{ backgroundColor: CATEGORIA_COLORS[i] }}
            />
            <span className="text-gray-700">{label}</span>
          </div>
        ))}
        <span className="text-gray-500 ml-2">
          ({info.name}, umbrales: {(UMBRALES[parametro] || []).join(' / ')} {info.unit})
        </span>
      </div>

      {/* Heatmaps por mes */}
      {mesesOrdenados.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No hay datos numéricos de {parametro} para {estacion}.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {mesesOrdenados.map(yyyymm => (
            <MesHeatmap key={yyyymm} yyyymm={yyyymm} datos={datosPorMes[yyyymm]} />
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Heatmap de un mes ─────────────────────────────

interface MesHeatmapProps {
  yyyymm: string;
  datos: Record<number, Record<number, number | null>>;
}

function MesHeatmap({ yyyymm, datos }: MesHeatmapProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const [anio, mes] = yyyymm.split('-').map(Number);
    const diasEnMes = new Date(anio, mes, 0).getDate();
    const dias = Array.from({ length: diasEnMes }, (_, i) => i + 1);

    // Matriz [hora=0..23][dia=1..N] de bucket (0..4) o null
    const z: (number | null)[][] = HORAS_LABELS.map((_, h) =>
      dias.map(d => {
        const v = datos[d]?.[h];
        return v === undefined ? null : v;
      })
    );

    // Texto hover
    const hover: string[][] = HORAS_LABELS.map((horaLabel, h) =>
      dias.map(d => {
        const v = datos[d]?.[h];
        const cat = v === undefined || v === null ? 'Sin dato' : CATEGORIA_LABELS[v];
        return `Día ${d} – ${horaLabel}<br>${cat}`;
      })
    );

    const colorscale = [
      [0.0, CATEGORIA_COLORS[0]],
      [0.2, CATEGORIA_COLORS[0]],
      [0.2, CATEGORIA_COLORS[1]],
      [0.4, CATEGORIA_COLORS[1]],
      [0.4, CATEGORIA_COLORS[2]],
      [0.6, CATEGORIA_COLORS[2]],
      [0.6, CATEGORIA_COLORS[3]],
      [0.8, CATEGORIA_COLORS[3]],
      [0.8, CATEGORIA_COLORS[4]],
      [1.0, CATEGORIA_COLORS[4]],
    ];

    const trace = {
      type: 'heatmap',
      z,
      x: dias,
      y: HORAS_LABELS,
      text: hover,
      hoverinfo: 'text',
      zmin: 0,
      zmax: 4,
      colorscale,
      showscale: false,
      xgap: 1,
      ygap: 1,
    };

    const layout = {
      title: {
        text: `${MESES_ES[mes - 1]} ${anio}`.toUpperCase(),
        font: { size: 13, color: '#374151' },
        x: 0.02,
        xanchor: 'left' as const,
      },
      margin: { l: 55, r: 10, t: 30, b: 40 },
      xaxis: {
        title: { text: 'Días', font: { size: 11 } },
        tickmode: 'array' as const,
        tickvals: dias.filter(d => d % 2 === 1),
        ticktext: dias.filter(d => d % 2 === 1).map(d => String(d).padStart(2, '0')),
        tickfont: { size: 9 },
        showgrid: false,
        zeroline: false,
      },
      yaxis: {
        title: { text: 'Horas', font: { size: 11 } },
        autorange: 'reversed' as const,
        tickfont: { size: 8 },
        showgrid: false,
        zeroline: false,
      },
      height: 320,
      paper_bgcolor: 'white',
      plot_bgcolor: '#f9fafb',
    };

    Plotly.newPlot(ref.current, [trace], layout, {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'],
    });

    return () => {
      if (ref.current) Plotly.purge(ref.current);
    };
  }, [yyyymm, datos]);

  return <div ref={ref} className="w-full" />;
}
