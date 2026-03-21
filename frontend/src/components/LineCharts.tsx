import { useState, useMemo, useEffect, useRef } from 'react';
// @ts-ignore — el bundle dist es browser-ready pero no tiene declaraciones de tipo propias
import Plotly from 'plotly.js/dist/plotly.js';

interface DataPoint {
  STATION: string;
  DATE: string;
  HOUR: number;
  [key: string]: string | number | null;
}

interface LineChartsProps {
  data: DataPoint[];
}

const CONTAMINANTES = ['O3', 'NO', 'NO2', 'NOX', 'SO2', 'CO', 'PM10', 'PM2.5'];
const METEOROLOGICOS = ['IT', 'ET', 'RH', 'WS', 'WD', 'PP', 'ATM', 'RS', 'UVI'];

const PARAM_UNITS: Record<string, string> = {
  O3: 'ppm', NO: 'ppm', NO2: 'ppm', NOX: 'ppm', SO2: 'ppm', CO: 'ppm',
  PM10: 'µg/m³', 'PM2.5': 'µg/m³',
  IT: '°C', ET: '°C', RH: '%', WS: 'm/s', WD: '°',
  PP: 'mm', ATM: 'mmHg', RS: 'W/m²', UVI: '',
};

const STATION_COLORS: Record<string, string> = {
  AGU: '#06b6d4', ATM: '#3b82f6', CEN: '#f97316', COU: '#22c55e',
  LDO: '#ef4444', MIR: '#8b5cf6', OBL: '#ec4899', PIN: '#eab308',
  SAN: '#14b8a6', SFE: '#a855f7', SMT: '#0ea5e9', TLA: '#6366f1', VAL: '#f43f5e',
};

const PARAM_COLORS: Record<string, string> = {
  O3: '#3b82f6', NO: '#22c55e', NO2: '#ef4444', NOX: '#f59e0b',
  SO2: '#8b5cf6', CO: '#ec4899', PM10: '#f97316', 'PM2.5': '#06b6d4',
  IT: '#ef4444', ET: '#f59e0b', RH: '#3b82f6', WS: '#22c55e',
  WD: '#8b5cf6', PP: '#06b6d4', ATM: '#ec4899', RS: '#f97316', UVI: '#eab308',
};

// Paleta extra para multi-param/multi-station
const PALETTE = [
  '#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#ec4899',
  '#06b6d4','#f97316','#14b8a6','#a855f7','#0ea5e9','#6366f1',
];

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getNumeric(val: any): number | null {
  if (typeof val === 'number' && !isNaN(val)) return val;
  return null;
}

function getTime(row: DataPoint): string {
  return `${row.DATE.split(' ')[0]}T${String(row.HOUR).padStart(2, '0')}:00:00`;
}

// Detecta corridas de valores constantes > minRun puntos consecutivos
function detectConstantRuns(
  values: (number | null)[],
  times: string[],
  minRun = 3
): { x0: string; x1: string; value: number }[] {
  const runs: { x0: string; x1: string; value: number }[] = [];
  let i = 0;
  while (i < values.length) {
    if (values[i] === null) { i++; continue; }
    const startVal = values[i];
    let j = i + 1;
    while (j < values.length && values[j] === startVal) j++;
    if (j - i > minRun) {
      runs.push({ x0: times[i], x1: times[j - 1], value: startVal as number });
    }
    i = j;
  }
  return runs;
}

const LineCharts = ({ data }: LineChartsProps) => {
  const stations = useMemo(() => [...new Set(data.map(d => d.STATION))].sort(), [data]);

  // Pre-indexar datos por estación (ya ordenados) para que el cambio de checkboxes sea instantáneo
  const dataByStation = useMemo(() => {
    const index: Record<string, DataPoint[]> = {};
    data.forEach(d => {
      if (!index[d.STATION]) index[d.STATION] = [];
      index[d.STATION].push(d);
    });
    Object.values(index).forEach(arr =>
      arr.sort((a, b) => getTime(a).localeCompare(getTime(b)))
    );
    return index;
  }, [data]);

  // Inicializar con TODAS las estaciones activas desde el primer render
  const [selectedStations, setSelectedStations] = useState<Set<string>>(
    () => new Set(data.map(d => d.STATION))
  );
  const [selectedParams, setSelectedParams] = useState<Set<string>>(new Set(['O3']));
  const [rightAxisParams, setRightAxisParams] = useState<Set<string>>(new Set());
  const [paramCategory, setParamCategory] = useState<'contaminantes' | 'meteorologicos'>('contaminantes');
  const [showValidationAlerts, setShowValidationAlerts] = useState(true);

  // Cuando se carga un archivo nuevo, actualizar estaciones seleccionadas
  useEffect(() => {
    setSelectedStations(new Set(stations));
  }, [stations]);

  const currentParams = paramCategory === 'contaminantes' ? CONTAMINANTES : METEOROLOGICOS;

  const toggleStation = (s: string) =>
    setSelectedStations(prev => { const next = new Set(prev); next.has(s) ? next.delete(s) : next.add(s); return next; });

  const toggleParam = (p: string) => {
    setSelectedParams(prev => {
      const next = new Set(prev);
      if (next.has(p)) { next.delete(p); setRightAxisParams(r => { const nr = new Set(r); nr.delete(p); return nr; }); }
      else next.add(p);
      return next;
    });
  };

  const toggleRightAxis = (p: string) =>
    setRightAxisParams(prev => { const next = new Set(prev); next.has(p) ? next.delete(p) : next.add(p); return next; });

  const selectAllStations = () => setSelectedStations(new Set(stations));
  const clearAllStations = () => setSelectedStations(new Set());


  // Construir trazos Plotly
  const traces = useMemo(() => {
    const result: any[] = [];
    const paramsToShow = Array.from(selectedParams);
    const stationsToShow = Array.from(selectedStations);
    const multiStation = stationsToShow.length > 1;
    const multiParam = paramsToShow.length > 1;

    paramsToShow.forEach((param, paramIdx) => {
      const isRightAxis = rightAxisParams.has(param);
      const paramColor = PARAM_COLORS[param] || PALETTE[paramIdx % PALETTE.length];

      stationsToShow.forEach((station, stIdx) => {
        const stationData = dataByStation[station] || [];

        const x = stationData.map(getTime);
        const y = stationData.map(d => getNumeric(d[param]));

        const color = multiParam
          ? PALETTE[(paramIdx * 3 + stIdx) % PALETTE.length]
          : STATION_COLORS[station] || PALETTE[stIdx % PALETTE.length];

        result.push({
          type: 'scatter',
          mode: 'lines',
          name: multiStation && multiParam
            ? `${station} · ${param}`
            : multiStation ? station
            : multiParam ? param
            : `${station} · ${param}`,
          x,
          y,
          connectgaps: false,          // ← SIN conexión entre nulos
          yaxis: isRightAxis ? 'y2' : 'y',
          line: { color, width: 1.5 },
          legendgroup: multiStation ? station : param,
        });
      });

      // Banda promedio ± σ cuando hay múltiples estaciones
      if (multiStation) {
        const timeValues: Record<string, number[]> = {};

        stationsToShow.forEach(station => {
          (dataByStation[station] || []).forEach(row => {
            const t = getTime(row);
            const val = getNumeric(row[param]);
            if (val !== null) {
              if (!timeValues[t]) timeValues[t] = [];
              timeValues[t].push(val);
            }
          });
        });

        const sortedTimes = Object.keys(timeValues).sort();
        if (sortedTimes.length === 0) return;

        const means = sortedTimes.map(t => {
          const vals = timeValues[t];
          return vals.reduce((a, b) => a + b, 0) / vals.length;
        });
        const stds = sortedTimes.map(t => {
          const vals = timeValues[t];
          if (vals.length < 2) return 0;
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
          return Math.sqrt(vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length);
        });

        const lower = means.map((m, i) => m - stds[i]);
        const upper = means.map((m, i) => m + stds[i]);

        // Borde inferior (invisible, base del fill)
        result.push({
          type: 'scatter',
          mode: 'lines',
          x: sortedTimes,
          y: lower,
          line: { width: 0 },
          showlegend: false,
          hoverinfo: 'skip',
          connectgaps: false,
          yaxis: isRightAxis ? 'y2' : 'y',
        });
        // Banda superior con relleno
        result.push({
          type: 'scatter',
          mode: 'lines',
          x: sortedTimes,
          y: upper,
          fill: 'tonexty',
          fillcolor: hexToRgba(paramColor, 0.12),
          line: { width: 0 },
          name: `±σ ${param}`,
          hoverinfo: 'skip',
          connectgaps: false,
          yaxis: isRightAxis ? 'y2' : 'y',
          legendgroup: `avg_${param}`,
        });
        // Línea de promedio
        result.push({
          type: 'scatter',
          mode: 'lines',
          x: sortedTimes,
          y: means,
          name: `Promedio ${param}`,
          line: { color: paramColor, width: 3, dash: 'dash' },
          connectgaps: false,
          yaxis: isRightAxis ? 'y2' : 'y',
          legendgroup: `avg_${param}`,
        });
      }
    });

    return result;
  }, [dataByStation, selectedStations, selectedParams, rightAxisParams]);

  // ── Trazos de alerta: PM2.5 > PM10 ──────────────────────────────────────────
  const pm25pm10AlertTraces = useMemo(() => {
    if (!showValidationAlerts) return [];
    if (!selectedParams.has('PM2.5') || !selectedParams.has('PM10')) return [];

    return Array.from(selectedStations).flatMap(station => {
      const stationData = dataByStation[station] || [];

      const violations = stationData.filter(d => {
        const pm10 = getNumeric(d['PM10']);
        const pm25 = getNumeric(d['PM2.5']);
        return pm10 !== null && pm25 !== null && pm25 > pm10;
      });

      if (violations.length === 0) return [];

      return [{
        type: 'scatter',
        mode: 'markers',
        name: `⚠️ PM2.5>PM10 (${station})`,
        x: violations.map(getTime),
        y: violations.map(d => getNumeric(d['PM2.5'])),
        marker: { color: 'red', size: 11, symbol: 'triangle-up', line: { color: '#7f0000', width: 1.5 } },
        yaxis: rightAxisParams.has('PM2.5') ? 'y2' : 'y',
        connectgaps: false,
        legendgroup: `alert_pm_${station}`,
        hovertemplate: '<b>%{x}</b><br>PM2.5=%{y} (> PM10)<extra></extra>',
      }] as any[];
    });
  }, [dataByStation, selectedStations, selectedParams, rightAxisParams, showValidationAlerts]);

  // ── Shapes de fondo: valores constantes > 3 h ────────────────────────────────
  const constantRunShapes = useMemo(() => {
    if (!showValidationAlerts) return [];

    const shapes: any[] = [];
    // Paleta de colores por parámetro (semitransparentes)
    const shapeColors: Record<string, string> = {
      O3: 'rgba(59,130,246,0.10)', NO: 'rgba(34,197,94,0.10)', NO2: 'rgba(239,68,68,0.10)',
      NOX: 'rgba(245,158,11,0.10)', SO2: 'rgba(139,92,246,0.10)', CO: 'rgba(236,72,153,0.10)',
      PM10: 'rgba(249,115,22,0.10)', 'PM2.5': 'rgba(6,182,212,0.10)',
      IT: 'rgba(239,68,68,0.10)', ET: 'rgba(245,158,11,0.10)',
      RH: 'rgba(59,130,246,0.10)', WS: 'rgba(34,197,94,0.10)',
    };

    Array.from(selectedParams).forEach(param => {
      Array.from(selectedStations).forEach(station => {
        const stationData = dataByStation[station] || [];

        const times = stationData.map(getTime);
        const values = stationData.map(d => getNumeric(d[param]));
        const runs = detectConstantRuns(values, times, 3);

        runs.forEach(run => {
          shapes.push({
            type: 'rect',
            xref: 'x',
            yref: 'paper',
            x0: run.x0,
            x1: run.x1,
            y0: 0,
            y1: 1,
            fillcolor: shapeColors[param] || 'rgba(255,165,0,0.10)',
            line: { width: 1.5, color: 'rgba(255,140,0,0.5)', dash: 'dot' },
          });
        });
      });
    });

    return shapes;
  }, [dataByStation, selectedStations, selectedParams, showValidationAlerts]);

  const layout = useMemo(() => {
    const leftParams = Array.from(selectedParams).filter(p => !rightAxisParams.has(p));
    const rightParams = Array.from(rightAxisParams);

    const leftTitle = leftParams.map(p => `${p}${PARAM_UNITS[p] ? ` (${PARAM_UNITS[p]})` : ''}`).join(', ');
    const rightTitle = rightParams.map(p => `${p}${PARAM_UNITS[p] ? ` (${PARAM_UNITS[p]})` : ''}`).join(', ');

    const base: any = {
      autosize: true,
      height: 520,
      margin: { t: 20, r: rightParams.length > 0 ? 80 : 30, b: 100, l: 70 },
      xaxis: {
        type: 'date',
        tickformat: '%d %b %y %H:%M',
        rangeslider: { visible: true, thickness: 0.05 },
        tickangle: -35,
      },
      yaxis: {
        title: leftTitle || 'Valor',
        automargin: true,
        zeroline: false,
      },
      legend: {
        orientation: 'h',
        x: 0.5,
        xanchor: 'center',
        y: -0.35,
        font: { size: 11 },
      },
      hovermode: 'x unified',
      plot_bgcolor: '#f9fafb',
      paper_bgcolor: '#ffffff',
      shapes: constantRunShapes,
    };

    if (rightParams.length > 0) {
      base.yaxis2 = {
        title: rightTitle,
        overlaying: 'y',
        side: 'right',
        automargin: true,
        zeroline: false,
      };
    }

    return base;
  }, [selectedParams, rightAxisParams, constantRunShapes]);

  const chartRef = useRef<HTMLDivElement>(null);

  // Llama directamente a Plotly.react() para garantizar re-render inmediato
  useEffect(() => {
    if (!chartRef.current) return;
    const allTraces = [...traces, ...pm25pm10AlertTraces];
    const plotConfig = { responsive: true, displayModeBar: true, scrollZoom: true };
    Plotly.react(chartRef.current, allTraces, layout as any, plotConfig);
  }, [traces, pm25pm10AlertTraces, layout]);

  return (
    <div className="space-y-4">
      {/* Controles */}
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Selector de estaciones */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-gray-700">Estaciones</h4>
              <div className="flex gap-2">
                <button onClick={selectAllStations} className="text-xs text-blue-600 hover:underline">Todas</button>
                <span className="text-gray-300">|</span>
                <button onClick={clearAllStations} className="text-xs text-gray-500 hover:underline">Ninguna</button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1 max-h-48 overflow-y-auto pr-1">
              {stations.map(station => (
                <label key={station} className="flex items-center gap-1.5 cursor-pointer text-sm py-0.5">
                  <input
                    type="checkbox"
                    checked={selectedStations.has(station)}
                    onChange={() => toggleStation(station)}
                    className="accent-blue-600"
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: STATION_COLORS[station] || '#888' }}
                  />
                  <span className="text-gray-700">{station}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Selector de parámetros */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-sm font-semibold text-gray-700">Parámetros</h4>
              <div className="flex rounded-lg overflow-hidden border border-gray-200 text-xs">
                <button
                  onClick={() => { setParamCategory('contaminantes'); setSelectedParams(new Set(['O3'])); setRightAxisParams(new Set()); }}
                  className={`px-3 py-1 transition-colors ${paramCategory === 'contaminantes' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  Contaminantes
                </button>
                <button
                  onClick={() => { setParamCategory('meteorologicos'); setSelectedParams(new Set(['IT'])); setRightAxisParams(new Set()); }}
                  className={`px-3 py-1 transition-colors ${paramCategory === 'meteorologicos' ? 'bg-purple-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  Meteorológicos
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-2">Selecciona uno o varios. <strong>Y1/Y2</strong> = eje vertical izquierdo / derecho (útil para variables con unidades distintas).</p>
            <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
              {currentParams.map(param => (
                <div key={param} className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={selectedParams.has(param)}
                      onChange={() => toggleParam(param)}
                      className="accent-blue-600"
                    />
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PARAM_COLORS[param] || '#888' }} />
                    <span className="font-medium" style={{ color: PARAM_COLORS[param] }}>{param}</span>
                    {PARAM_UNITS[param] && <span className="text-gray-400 text-xs">({PARAM_UNITS[param]})</span>}
                  </label>
                  {selectedParams.has(param) && (
                    <div className="flex gap-1 text-xs ml-2">
                      <button
                        onClick={() => rightAxisParams.has(param) && toggleRightAxis(param)}
                        className={`px-2 py-0.5 rounded transition-colors ${!rightAxisParams.has(param) ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                      >
                        Y1
                      </button>
                      <button
                        onClick={() => !rightAxisParams.has(param) && toggleRightAxis(param)}
                        className={`px-2 py-0.5 rounded transition-colors ${rightAxisParams.has(param) ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                      >
                        Y2
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Alertas de validación */}
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showValidationAlerts}
              onChange={e => setShowValidationAlerts(e.target.checked)}
              className="accent-orange-500"
            />
            <span className="text-sm font-medium text-gray-700">Mostrar alertas de validación</span>
          </label>
          {showValidationAlerts && (
            <div className="flex flex-wrap gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="text-red-600 font-bold text-base leading-none">▲</span>
                PM2.5 &gt; PM10 (solo cuando ambos están seleccionados)
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-6 h-3 rounded" style={{ background: 'rgba(255,140,0,0.25)', border: '1.5px dotted rgba(255,140,0,0.7)' }} />
                Valor constante &gt;3 h
              </span>
            </div>
          )}
        </div>

        {/* Info de selección */}
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
          <span>
            <strong>{selectedStations.size}</strong> estaciones · <strong>{selectedParams.size}</strong> parámetros
          </span>
          {selectedStations.size > 1 && selectedParams.size > 0 && (
            <span className="text-blue-600">✦ Mostrando banda promedio ± desviación estándar</span>
          )}
          {rightAxisParams.size > 0 && (
            <span className="text-orange-600">⇔ Y2 (eje derecho): {Array.from(rightAxisParams).join(', ')}</span>
          )}
          <span className="ml-auto text-gray-400">Usa el control deslizante inferior para enfocar un período</span>
        </div>
      </div>

      {/* Gráfica */}
      <div className="bg-white p-4 rounded-lg shadow">
        {selectedStations.size === 0 || selectedParams.size === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            Selecciona al menos una estación y un parámetro para ver la gráfica
          </div>
        ) : null}
        <div
          ref={chartRef}
          style={{ width: '100%', minHeight: selectedStations.size === 0 || selectedParams.size === 0 ? '0px' : '520px' }}
        />
      </div>
    </div>
  );
};

export default LineCharts;
