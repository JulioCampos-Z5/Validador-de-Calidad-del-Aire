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

type ModoViz = 'hora' | 'mov8h' | 'mov24h' | 'nowcast';
type VersionUmbrales = 'actual' | '2026';

// Umbrales actuales (Redspira / referencias previas a NOM-172-2026)
const UMBRALES: Record<string, number[]> = {
  'PM2.5': [25, 45, 79, 147],
  PM10:   [50, 75, 155, 235],
  O3:     [0.051, 0.070, 0.092, 0.114],
  NO2:    [0.107, 0.210, 0.230, 0.250],
  SO2:    [0.040, 0.075, 0.185, 0.304],
  CO:     [8.75, 11, 13.3, 15.5],
};

// Umbrales NOM-172-SEMARNAT-2023 (vigentes a partir de enero 2026) — solo PM
const UMBRALES_2026: Record<string, number[]> = {
  'PM2.5': [15, 25, 79, 130],
  PM10:   [45, 50, 132, 213],
};

const CATEGORIA_LABELS_ACTUAL = ['Buena', 'Regular', 'Mala', 'Muy Mala', 'Extr. Mala'];
const CATEGORIA_LABELS_2026   = ['Buena', 'Aceptable', 'Mala', 'Muy Mala', 'Extr. Mala'];
const CATEGORIA_COLORS = ['#66BB6A', '#FFEB3B', '#FF9800', '#F44336', '#9C27B0'];
const DI_COLOR = '#9E9E9E';

const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const HORAS_LABELS = [
  '12 AM', '01 AM', '02 AM', '03 AM', '04 AM', '05 AM', '06 AM', '07 AM',
  '08 AM', '09 AM', '10 AM', '11 AM', '12 PM', '01 PM', '02 PM', '03 PM',
  '04 PM', '05 PM', '06 PM', '07 PM', '08 PM', '09 PM', '10 PM', '11 PM',
];

const MODOS_DISPONIBLES: Record<string, { label: string; value: ModoViz }[]> = {
  CO:      [{ label: 'Por Hora', value: 'hora' }, { label: 'Prom. Móvil 8h', value: 'mov8h' }],
  O3:      [{ label: 'Por Hora', value: 'hora' }, { label: 'Prom. Móvil 8h', value: 'mov8h' }],
  'PM10':  [{ label: 'Por Hora', value: 'hora' }, { label: 'Prom. Móvil 24h', value: 'mov24h' }, { label: 'NowCast', value: 'nowcast' }],
  'PM2.5': [{ label: 'Por Hora', value: 'hora' }, { label: 'Prom. Móvil 24h', value: 'mov24h' }, { label: 'NowCast', value: 'nowcast' }],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, '0'); }

function dateHourKey(y: number, m: number, d: number, h: number) {
  return `${y}-${pad(m)}-${pad(d)}-${pad(h)}`;
}

function shiftHours(y: number, m: number, d: number, h: number, delta: number) {
  const dt = new Date(Date.UTC(y, m - 1, d, h + delta));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours() };
}

function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(v as string);
  return Number.isFinite(n) ? n : null;
}

function clasificar(valor: number, umbrales: number[]): number {
  for (let i = 0; i < umbrales.length; i++) {
    if (valor <= umbrales[i]) return i;
  }
  return umbrales.length;
}

// NowCast según NOM-172-SEMARNAT-2023 (portado desde NowCast.ipynb)
// valores: lista de 12 concentraciones, de más vieja a más reciente (null = sin dato)
// pm: 0=PM10, 1=PM2.5
function nowcastFn(valores: (number | null)[], pm: 0 | 1): number | null {
  const ultimas3 = valores.slice(-3);
  if (ultimas3.filter(x => x !== null).length < 2) return null;

  const reversed = [...valores].reverse();
  const pares: [number, number][] = [];
  let hora = 0;
  for (const val of reversed) {
    if (val !== null) pares.push([val, hora]);
    hora++;
  }
  if (pares.length < 2) return null;

  const vals = pares.map(p => p[0]);
  if (vals.every(v => v === 0)) return 0;

  const maxVal = Math.max(...vals);
  if (maxVal === 0) return null;

  const rango = maxVal - Math.min(...vals);
  const tasa = Math.round((1 - rango / maxVal) * 100) / 100;
  const factor = tasa >= 0.5 ? tasa : 0.5;

  let num = 0, den = 0;
  for (const [val, h] of pares) {
    const peso = Math.pow(factor, h);
    num += val * peso;
    den += peso;
  }
  if (den === 0) return null;

  let prom = Math.round(num / den);
  prom = Math.round(prom * (pm === 0 ? 0.714 : 0.694));
  return prom;
}

// Retorna:
//   null  → sin datos en la ventana (celda blanca)
//   NaN   → datos insuficientes para el promedio / NowCast → D.I. (gris)
//   number → valor computado válido
function computeValue(
  y: number, m: number, d: number, h: number,
  modo: ModoViz,
  raw: Record<string, number | null>,
  param: string,
): number | null {
  if (modo === 'hora') {
    const key = dateHourKey(y, m, d, h);
    if (!(key in raw)) return null;
    return raw[key]; // puede ser null si el valor era inválido
  }

  const windowSize = modo === 'mov8h' ? 8 : modo === 'mov24h' ? 24 : 12;
  const vals: (number | null)[] = [];
  let anyPresent = false;

  for (let i = windowSize - 1; i >= 0; i--) {
    const t = shiftHours(y, m, d, h, -i);
    const key = dateHourKey(t.y, t.m, t.d, t.h);
    if (key in raw) {
      vals.push(raw[key]);
      anyPresent = true;
    } else {
      vals.push(null);
    }
  }

  if (!anyPresent) return null;

  if (modo === 'nowcast') {
    const r = nowcastFn(vals, param === 'PM10' ? 0 : 1);
    return r !== null ? r : NaN;
  }

  const minValid = modo === 'mov8h' ? 6 : 18;
  const validos = vals.filter(v => v !== null) as number[];
  if (validos.length < minValid) return NaN;
  return validos.reduce((a, b) => a + b, 0) / validos.length;
}

// ── Tooltip de ayuda ─────────────────────────────────────────────────────────

function InfoTooltip({ lines }: { lines: string[] }) {
  return (
    <div className="relative group inline-flex items-center">
      <span className="w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-xs font-bold flex items-center justify-center cursor-help select-none leading-none">
        ?
      </span>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20 w-72 bg-gray-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none">
        {lines.map((l, i) => <p key={i} className={i > 0 ? 'mt-1' : ''}>{l}</p>)}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

type CeldaInfo = { cat: number; val: number | null };

export default function CalendarHeatmaps({ data }: CalendarHeatmapsProps) {
  const estaciones = useMemo(
    () => Array.from(new Set(data.map(d => d.STATION))).sort(),
    [data],
  );

  const parametrosDisponibles = useMemo(
    () => CONTAMINANTES_CONST.filter(p => p in UMBRALES),
    [],
  );

  const [estacion, setEstacion] = useState('');
  const [parametro, setParametro] = useState('PM2.5');
  const [modo, setModo] = useState<ModoViz>('hora');
  const [version, setVersion] = useState<VersionUmbrales>('actual');

  useEffect(() => {
    if (estaciones.length > 0 && !estaciones.includes(estacion)) {
      setEstacion(estaciones[0]);
    }
  }, [estaciones, estacion]);

  // Resetear modo si el nuevo parámetro no lo soporta
  useEffect(() => {
    const modos = MODOS_DISPONIBLES[parametro];
    if (modos && !modos.find(m => m.value === modo)) setModo('hora');
  }, [parametro]);

  // Serie cruda: key "YYYY-MM-DD-HH" → valor (null = dato inválido reportado)
  const rawSeries = useMemo(() => {
    const result: Record<string, number | null> = {};
    for (const fila of data) {
      if (fila.STATION !== estacion) continue;
      const fecha = new Date(fila.DATE);
      if (Number.isNaN(fecha.getTime())) continue;
      const h = Number(fila.HOUR);
      if (!Number.isInteger(h) || h < 0 || h > 23) continue;
      const key = dateHourKey(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, fecha.getUTCDate(), h);
      result[key] = toNumber(fila[parametro] as string | number | null);
    }
    return result;
  }, [data, estacion, parametro]);

  const umbralesActivos = useMemo(() => {
    if (version === '2026' && UMBRALES_2026[parametro]) return UMBRALES_2026[parametro];
    return UMBRALES[parametro];
  }, [parametro, version]);

  // Categorías por mes/día/hora
  const datosPorMes = useMemo(() => {
    const result: Record<string, Record<number, Record<number, CeldaInfo>>> = {};
    if (!estacion || !umbralesActivos) return result;

    const meses = new Set<string>();
    for (const key of Object.keys(rawSeries)) meses.add(key.slice(0, 7));

    for (const yyyymm of meses) {
      const [y, m] = yyyymm.split('-').map(Number);
      const diasEnMes = new Date(y, m, 0).getDate();

      for (let d = 1; d <= diasEnMes; d++) {
        for (let h = 0; h < 24; h++) {
          const val = computeValue(y, m, d, h, modo, rawSeries, parametro);
          if (val === null) continue;

          if (!result[yyyymm]) result[yyyymm] = {};
          if (!result[yyyymm][d]) result[yyyymm][d] = {};

          if (isNaN(val as number)) {
            result[yyyymm][d][h] = { cat: -1, val: null };
          } else {
            result[yyyymm][d][h] = { cat: clasificar(val as number, umbralesActivos), val: val as number };
          }
        }
      }
    }
    return result;
  }, [rawSeries, modo, umbralesActivos, parametro, estacion]);

  const mesesOrdenados = useMemo(() => Object.keys(datosPorMes).sort(), [datosPorMes]);

  if (estaciones.length === 0 || parametrosDisponibles.length === 0) return null;

  const info = getUnitsAndName(parametro);
  const modosDisponibles = MODOS_DISPONIBLES[parametro] ?? null;
  const mostrarVersion2026 = parametro in UMBRALES_2026;
  const mostrarDI = modo !== 'hora';
  const catLabels = (version === '2026' && mostrarVersion2026) ? CATEGORIA_LABELS_2026 : CATEGORIA_LABELS_ACTUAL;

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

      {/* Fila 1: Estación + Contaminante */}
      <div className="flex flex-wrap gap-4 mb-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Estación:</label>
          <select
            value={estacion}
            onChange={e => setEstacion(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {estaciones.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Contaminante:</label>
          <div className="flex gap-1 flex-wrap">
            {parametrosDisponibles.map(p => (
              <button
                key={p}
                onClick={() => setParametro(p)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  parametro === p ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Fila 2: Modo de visualización + Versión de umbrales */}
      {(modosDisponibles || mostrarVersion2026) && (
        <div className="flex flex-wrap gap-4 mb-4">
          {modosDisponibles && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Visualización:</label>
              <InfoTooltip lines={
                parametro === 'CO' || parametro === 'O3'
                  ? [
                      '📊 Por Hora: valor medido en cada hora individual.',
                      `⏱ Prom. Móvil 8h: promedio de las 8 horas anteriores. Requiere al menos 6 horas válidas; si no, se muestra como D.I. (gris).`,
                    ]
                  : [
                      '📊 Por Hora: valor medido en cada hora individual.',
                      '⏱ Prom. Móvil 24h: promedio de las 24 horas anteriores. Requiere al menos 18 horas válidas; si no, D.I. (gris).',
                      '🔬 NowCast (NOM-172-SEMARNAT-2023): promedio ponderado de las últimas 12 horas. Requiere al menos 2 de las 3 horas más recientes válidas; si no, D.I. (gris).',
                    ]
              } />
              <div className="flex gap-1">
                {modosDisponibles.map(m => (
                  <button
                    key={m.value}
                    onClick={() => setModo(m.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      modo === m.value ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mostrarVersion2026 && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Umbrales:</label>
              <InfoTooltip lines={[
                '📌 Actuales: umbrales de referencia anteriores a NOM-172-2026 (usados por Redspira).',
                `   PM2.5: 25 / 45 / 79 / 147 µg/m³`,
                `   PM10:  50 / 75 / 155 / 235 µg/m³`,
                '📋 NOM-172 2026: umbrales vigentes desde enero 2026. Categoría "Aceptable" en lugar de "Regular".',
                `   PM2.5: 15 / 25 / 79 / 130 µg/m³`,
                `   PM10:  45 / 50 / 132 / 213 µg/m³`,
              ]} />
              <div className="flex gap-1">
                {(['actual', '2026'] as VersionUmbrales[]).map(v => (
                  <button
                    key={v}
                    onClick={() => setVersion(v)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      version === v ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {v === 'actual' ? 'Actuales' : 'NOM-172 2026'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Nota del modo activo */}
      {modo === 'mov8h' && (
        <p className="text-xs text-indigo-600 bg-indigo-50 rounded-lg px-3 py-2 mb-3">
          Promedio móvil de 8 horas — se requieren al menos 6 horas válidas en la ventana; si no, se muestra como D.I.
        </p>
      )}
      {modo === 'mov24h' && (
        <p className="text-xs text-indigo-600 bg-indigo-50 rounded-lg px-3 py-2 mb-3">
          Promedio móvil de 24 horas anteriores — se requieren al menos 18 horas válidas; si no, se muestra como D.I.
        </p>
      )}
      {modo === 'nowcast' && (
        <p className="text-xs text-indigo-600 bg-indigo-50 rounded-lg px-3 py-2 mb-3">
          NowCast (NOM-172-SEMARNAT-2023) — promedio ponderado de 12 horas; requiere al menos 2 de las últimas 3 horas válidas.
        </p>
      )}

      {/* Leyenda */}
      <div className="flex flex-wrap gap-3 mb-4 text-xs items-center">
        {catLabels.map((label, i) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded" style={{ backgroundColor: CATEGORIA_COLORS[i] }} />
            <span className="text-gray-700">{label}</span>
          </div>
        ))}
        {mostrarDI && (
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded" style={{ backgroundColor: DI_COLOR }} />
            <span className="text-gray-700">D.I.</span>
          </div>
        )}
        <span className="text-gray-500 ml-2">
          ({info.name}, umbrales: {(umbralesActivos || []).join(' / ')} {info.unit})
        </span>
      </div>

      {/* Heatmaps por mes */}
      {mesesOrdenados.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No hay datos de {parametro} para {estacion}.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {mesesOrdenados.map(yyyymm => (
            <MesHeatmap
              key={yyyymm}
              yyyymm={yyyymm}
              datos={datosPorMes[yyyymm]}
              mostrarDI={mostrarDI}
              catLabels={catLabels}
              unidad={info.unit}
              modo={modo}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Heatmap de un mes ─────────────────────────────────────────────────────────

interface MesHeatmapProps {
  yyyymm: string;
  datos: Record<number, Record<number, CeldaInfo>>;
  mostrarDI: boolean;
  catLabels: string[];
  unidad: string;
  modo: ModoViz;
}

function MesHeatmap({ yyyymm, datos, mostrarDI, catLabels, unidad, modo }: MesHeatmapProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const [anio, mes] = yyyymm.split('-').map(Number);
    const diasEnMes = new Date(anio, mes, 0).getDate();
    const dias = Array.from({ length: diasEnMes }, (_, i) => i + 1);

    // z: -1=D.I., 0-4=categorías, null=sin dato (blanco)
    const z: (number | null)[][] = HORAS_LABELS.map((_, h) =>
      dias.map(d => {
        const e = datos[d]?.[h];
        return e !== undefined ? e.cat : null;
      })
    );

    const hover: string[][] = HORAS_LABELS.map((horaLabel, h) =>
      dias.map(d => {
        const e = datos[d]?.[h];
        if (!e) return `Día ${d} – ${horaLabel}<br>Sin dato`;
        if (e.cat === -1) return `Día ${d} – ${horaLabel}<br>D.I. (datos insuficientes)`;
        const cat = catLabels[e.cat] ?? '';
        const decimales = modo === 'nowcast' ? 0 : 3;
        const valStr = e.val !== null ? `<br>${e.val.toFixed(decimales)} ${unidad}` : '';
        return `Día ${d} – ${horaLabel}<br>${cat}${valStr}`;
      })
    );

    // Colorscale: con D.I. → rango -1..4 (6 buckets); sin D.I. → rango 0..4 (5 buckets)
    let colorscale: [number, string][];
    let zmin: number;
    let zmax = 4;

    if (mostrarDI) {
      zmin = -1;
      // 6 valores en [0,1]: -1,0,1,2,3,4 → segmentos de 1/6
      colorscale = [
        [0 / 6, DI_COLOR],           [1 / 6, DI_COLOR],
        [1 / 6, CATEGORIA_COLORS[0]], [2 / 6, CATEGORIA_COLORS[0]],
        [2 / 6, CATEGORIA_COLORS[1]], [3 / 6, CATEGORIA_COLORS[1]],
        [3 / 6, CATEGORIA_COLORS[2]], [4 / 6, CATEGORIA_COLORS[2]],
        [4 / 6, CATEGORIA_COLORS[3]], [5 / 6, CATEGORIA_COLORS[3]],
        [5 / 6, CATEGORIA_COLORS[4]], [6 / 6, CATEGORIA_COLORS[4]],
      ];
    } else {
      zmin = 0;
      colorscale = [
        [0.0, CATEGORIA_COLORS[0]], [0.2, CATEGORIA_COLORS[0]],
        [0.2, CATEGORIA_COLORS[1]], [0.4, CATEGORIA_COLORS[1]],
        [0.4, CATEGORIA_COLORS[2]], [0.6, CATEGORIA_COLORS[2]],
        [0.6, CATEGORIA_COLORS[3]], [0.8, CATEGORIA_COLORS[3]],
        [0.8, CATEGORIA_COLORS[4]], [1.0, CATEGORIA_COLORS[4]],
      ];
    }

    const trace = {
      type: 'heatmap',
      z,
      x: dias,
      y: HORAS_LABELS,
      text: hover,
      hoverinfo: 'text',
      zmin,
      zmax,
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

    return () => { if (ref.current) Plotly.purge(ref.current); };
  }, [yyyymm, datos, mostrarDI, catLabels, unidad, modo]);

  return <div ref={ref} className="w-full" />;
}
