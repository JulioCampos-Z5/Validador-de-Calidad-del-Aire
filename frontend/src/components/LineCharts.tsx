import { useState, useMemo, useEffect, useRef } from 'react';
// @ts-ignore — el bundle dist es browser-ready pero no tiene declaraciones de tipo propias
import Plotly from 'plotly.js/dist/plotly.js';
import {
  CONTAMINANTES as CONTAMINANTES_CONST,
  METEOROLOGICOS as METEOROLOGICOS_CONST,
  COLORES_ESTACIONES,
  getUnitsAndName,
  getAxisLabel,
} from '../constants';

interface DataPoint {
  STATION: string;
  DATE: string;
  HOUR: number;
  [key: string]: string | number | null;
}

interface LineChartsProps {
  data: DataPoint[];
}

const CONTAMINANTES: string[] = [...CONTAMINANTES_CONST];
const METEOROLOGICOS: string[] = [...METEOROLOGICOS_CONST];

const STATION_COLORS = COLORES_ESTACIONES;

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
  // Asignación de eje: default = y1, puede moverse a y2 o y3 (para mezclar unidades)
  const [axisAssignments, setAxisAssignments] = useState<Record<string, 'y1' | 'y2' | 'y3'>>({});
  const [showValidationAlerts, setShowValidationAlerts] = useState(true);

  useEffect(() => {
    setSelectedStations(new Set(stations));
  }, [stations]);

  const getAxis = (p: string): 'y1' | 'y2' | 'y3' => axisAssignments[p] || 'y1';
  const setAxis = (p: string, axis: 'y1' | 'y2' | 'y3') =>
    setAxisAssignments(prev => ({ ...prev, [p]: axis }));

  const toggleStation = (s: string) =>
    setSelectedStations(prev => { const next = new Set(prev); next.has(s) ? next.delete(s) : next.add(s); return next; });

  const toggleParam = (p: string) => {
    setSelectedParams(prev => {
      const next = new Set(prev);
      if (next.has(p)) {
        next.delete(p);
        setAxisAssignments(a => { const { [p]: _, ...rest } = a; return rest; });
      } else {
        next.add(p);
        // Auto-asignación: al mezclar tipos distintos, el nuevo va a Y2.
        const isMeteo = METEOROLOGICOS.includes(p);
        const hasOtroTipo = Array.from(next).some(x => {
          if (x === p) return false;
          return METEOROLOGICOS.includes(x) !== isMeteo;
        });
        if (hasOtroTipo) {
          setAxisAssignments(a => ({ ...a, [p]: 'y2' }));
        }
      }
      return next;
    });
  };

  const selectAllStations = () => setSelectedStations(new Set(stations));
  const clearAllStations = () => setSelectedStations(new Set());


  // Map lógico: 'y1' -> 'y' (default Plotly), 'y2' -> 'y2', 'y3' -> 'y3'
  const plotlyAxis = (a: 'y1' | 'y2' | 'y3') => (a === 'y1' ? 'y' : a);
  // Estilo de línea por eje: Y1 sólido, Y2 discontinuo, Y3 punteado
  const dashFor = (a: 'y1' | 'y2' | 'y3') => (a === 'y1' ? 'solid' : a === 'y2' ? 'dash' : 'dot');

  // Construir trazos Plotly
  const traces = useMemo(() => {
    const result: any[] = [];
    const paramsToShow = Array.from(selectedParams);
    const stationsToShow = Array.from(selectedStations);
    const multiStation = stationsToShow.length > 1;
    const multiParam = paramsToShow.length > 1;

    paramsToShow.forEach((param, paramIdx) => {
      const axis = getAxis(param);
      const yaxis = plotlyAxis(axis);
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
          connectgaps: false,
          yaxis,
          line: { color, width: 1.5, dash: dashFor(axis) },
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
          yaxis,
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
          yaxis,
          legendgroup: `avg_${param}`,
        });
        // Línea de promedio — usa color "Mean" estándar de la paleta
        result.push({
          type: 'scatter',
          mode: 'lines',
          x: sortedTimes,
          y: means,
          name: `Promedio ${param}`,
          line: { color: STATION_COLORS.Mean || '#000000', width: 3, dash: dashFor(axis) === 'solid' ? 'dash' : dashFor(axis) },
          connectgaps: false,
          yaxis,
          legendgroup: `avg_${param}`,
        });
      }
    });

    return result;
  }, [dataByStation, selectedStations, selectedParams, axisAssignments]);

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
        yaxis: plotlyAxis(getAxis('PM2.5')),
        connectgaps: false,
        legendgroup: `alert_pm_${station}`,
        hovertemplate: '<b>%{x}</b><br>PM2.5=%{y} (> PM10)<extra></extra>',
      }] as any[];
    });
  }, [dataByStation, selectedStations, selectedParams, axisAssignments, showValidationAlerts]);

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
    const y1Params = Array.from(selectedParams).filter(p => getAxis(p) === 'y1');
    const y2Params = Array.from(selectedParams).filter(p => getAxis(p) === 'y2');
    const y3Params = Array.from(selectedParams).filter(p => getAxis(p) === 'y3');

    const hasY3 = y3Params.length > 0;

    const base: any = {
      autosize: true,
      height: 600,
      margin: {
        t: 20,
        r: (y2Params.length > 0 ? 80 : 30) + (hasY3 ? 70 : 0),
        b: 180,
        l: 70,
      },
      xaxis: {
        type: 'date',
        tickformat: '%d %b %y %H:%M',
        rangeslider: { visible: true, thickness: 0.05 },
        tickangle: -35,
        domain: [0, hasY3 ? 0.92 : 1],
      },
      yaxis: {
        title: getAxisLabel(y1Params) || 'Valor',
        automargin: true,
        zeroline: false,
        showgrid: true,
      },
      legend: {
        orientation: 'h',
        x: 0.5,
        xanchor: 'center',
        y: -0.55,
        yanchor: 'top',
        font: { size: 11 },
        bgcolor: 'rgba(255,255,255,0.9)',
      },
      hovermode: 'x unified',
      plot_bgcolor: '#f9fafb',
      paper_bgcolor: '#ffffff',
      shapes: constantRunShapes,
    };

    if (y2Params.length > 0) {
      base.yaxis2 = {
        title: getAxisLabel(y2Params),
        overlaying: 'y',
        side: 'right',
        automargin: true,
        zeroline: false,
        showgrid: false,
      };
    }

    if (hasY3) {
      base.yaxis3 = {
        title: getAxisLabel(y3Params),
        overlaying: 'y',
        side: 'right',
        position: 0.98,
        anchor: 'free',
        automargin: true,
        zeroline: false,
        showgrid: false,
      };
    }

    return base;
  }, [selectedParams, axisAssignments, constantRunShapes]);

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

          {/* Selector de parámetros (contaminantes y meteorológicos combinables) */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-1">Parámetros</h4>
            <p className="text-xs text-gray-400 mb-2">
              Mezcla libremente contaminantes y variables meteorológicas. <strong>Y1/Y2</strong> = eje izquierdo/derecho.
              Al combinar tipos, el nuevo se asigna automáticamente a Y2.
            </p>
            <div className="max-h-64 overflow-y-auto pr-1 space-y-3">
              {([
                { label: 'Contaminantes', color: 'text-green-700', items: CONTAMINANTES },
                { label: 'Meteorológicos', color: 'text-purple-700', items: METEOROLOGICOS },
              ] as const).map(section => (
                <div key={section.label}>
                  <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${section.color}`}>
                    {section.label}
                  </p>
                  <div className="space-y-1">
                    {section.items.map(param => (
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
                          {getUnitsAndName(param).unit && <span className="text-gray-400 text-xs">({getUnitsAndName(param).unit})</span>}
                        </label>
                        {selectedParams.has(param) && (
                          <div className="flex gap-1 text-xs ml-2">
                            {(['y1', 'y2', 'y3'] as const).map(ax => {
                              const isActive = getAxis(param) === ax;
                              const label = ax.toUpperCase();
                              const activeBg = ax === 'y1' ? 'bg-blue-500' : ax === 'y2' ? 'bg-orange-500' : 'bg-purple-500';
                              return (
                                <button
                                  key={ax}
                                  onClick={() => setAxis(param, ax)}
                                  title={
                                    ax === 'y1' ? 'Eje Y1 (izquierdo, línea sólida)' :
                                    ax === 'y2' ? 'Eje Y2 (derecho, línea discontinua)' :
                                    'Eje Y3 (derecho exterior, línea punteada)'
                                  }
                                  className={`px-2 py-0.5 rounded transition-colors ${isActive ? `${activeBg} text-white` : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
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
          {Array.from(selectedParams).some(p => getAxis(p) === 'y2') && (
            <span className="text-orange-600">
              ⇔ Y2 (derecho, discontinuo): {Array.from(selectedParams).filter(p => getAxis(p) === 'y2').join(', ')}
            </span>
          )}
          {Array.from(selectedParams).some(p => getAxis(p) === 'y3') && (
            <span className="text-purple-600">
              ⇔ Y3 (derecho exterior, punteado): {Array.from(selectedParams).filter(p => getAxis(p) === 'y3').join(', ')}
            </span>
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
