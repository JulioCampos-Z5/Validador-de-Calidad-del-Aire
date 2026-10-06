import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react';
import Plotly from '../graficas/plotly';
import {
  rejillaHoraria, serieEnRejilla, agregadoZona, promedioMovil, nowcast, type Agregado,
} from '../graficas/series';
import {
  CONTAMINANTES as CONTAMINANTES_CONST,
  METEOROLOGICOS as METEOROLOGICOS_CONST,
  COLORES_ESTACIONES,
  getUnitsAndName,
  getAxisLabel,
  umbralesEscala,
  UMBRALES_2026,
  CATEGORIAS_INDICE_JALISCO,
  type EscalaIndice,
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

// Los agregados de toda la zona no son una estación más, así que no toman
// color de estación: van en tinta y rojo oscuro para leerse por encima del
// resto de las líneas.
const AGREGADOS: { id: Agregado; etiqueta: string; color: string; dash: 'solid' | 'dash' }[] = [
  { id: 'promedio', etiqueta: 'Promedio AMG', color: '#111827', dash: 'solid' },
  { id: 'maximo', etiqueta: 'Máximo AMG', color: '#b91c1c', dash: 'dash' },
];

// Promedios que usan los índices para cada contaminante. Se dibujan por
// estación, encima del dato horario, con el color de la estación y un trazo
// propio para distinguirlos.
type Variante = 'm8' | 'm24' | 'nowcast';
const VARIANTES: Record<Variante, {
  etiqueta: string;
  dash: string;
  calcular: (v: (number | null)[]) => (number | null)[];
}> = {
  m8: { etiqueta: 'Móvil 8 h', dash: 'longdash', calcular: v => promedioMovil(v, 8) },
  m24: { etiqueta: 'Móvil 24 h', dash: 'longdash', calcular: v => promedioMovil(v, 24) },
  nowcast: { etiqueta: 'NowCast', dash: 'dashdot', calcular: nowcast },
};
const VARIANTES_POR_PARAM: Record<string, Variante[]> = {
  CO: ['m8'],
  PM10: ['m24', 'nowcast'],
  'PM2.5': ['m24', 'nowcast'],
};

const ESCALAS: { id: EscalaIndice; etiqueta: string }[] = [
  { id: 'aire-salud', etiqueta: 'Aire y Salud' },
  { id: 'imeca', etiqueta: 'IMECA' },
];

// Rango IMECA de cada categoría, para la leyenda del relleno.
const RANGOS_IMECA = ['0–50', '51–100', '101–150', '151–200', '>200'];

// Paleta extra para multi-param/multi-station
function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

type Eje = 'y1' | 'y2' | 'y3';

// Mismo color que el botón Y1/Y2/Y3 de cada parámetro, para que se vea a qué
// eje pertenece cada escala.
const COLORES_EJE: Record<Eje, string> = { y1: '#3b82f6', y2: '#f97316', y3: '#a855f7' };

// Trazo por eje cuando el usuario no eligió uno: así las líneas de Y2 y Y3 se
// distinguen de las de Y1 aunque compartan color de estación.
const TRAZO_EJE: Record<Eje, 'solid' | 'dash' | 'dot'> = { y1: 'solid', y2: 'dash', y3: 'dot' };

// Plotly 3 ya no acepta `title` como texto plano: hay que pasar
// `title.text`, o el eje se queda sin título.
//
// `fixedrange: false` va explícito porque, con el deslizador de rango en el
// eje X, Plotly bloquea por defecto los ejes Y anclados a él (Y1 y Y2) y no
// deja arrastrarlos para cambiar su escala. Y3 se salvaba solo por ir libre.
//
// `uirevision` con el título: la escala que ajuste el usuario sobrevive a los
// re-render (marcar una estación, cambiar un color) y solo se reinicia cuando
// cambian los parámetros de ese eje.
function estiloEje(titulo: string, color: string) {
  return {
    title: { text: titulo, font: { color } },
    fixedrange: false,
    uirevision: titulo,
    tickfont: { color },
    linecolor: color,
    showline: true,
    automargin: true,
    zeroline: false,
  };
}

// Combinaciones que se revisan a menudo juntas. Cada una dice en qué eje va
// cada parámetro: lo que comparte unidad y magnitud va en el mismo eje, y lo
// que no, aparte, para que ninguna curva quede aplastada contra el cero (el CO
// ronda 1 ppm y el O3 0.03 ppm: misma unidad, escalas incompatibles).
const ATAJOS: { nombre: string; ejes: Record<string, Eje> }[] = [
  { nombre: 'O3 / ET', ejes: { O3: 'y1', ET: 'y2' } },
  { nombre: 'O3 / NO2 / CO', ejes: { O3: 'y1', NO2: 'y1', CO: 'y2' } },
  { nombre: 'O3 / RS / UVI', ejes: { O3: 'y1', RS: 'y2', UVI: 'y3' } },
  { nombre: 'PM10 / PM2.5', ejes: { PM10: 'y1', 'PM2.5': 'y1' } },
  { nombre: 'PM10 / PM2.5 / CO', ejes: { PM10: 'y1', 'PM2.5': 'y1', CO: 'y2' } },
  { nombre: 'PM10 / PM2.5 / WS', ejes: { PM10: 'y1', 'PM2.5': 'y1', WS: 'y2' } },
  { nombre: 'PM10 / PM2.5 / PP', ejes: { PM10: 'y1', 'PM2.5': 'y1', PP: 'y2' } },
  { nombre: 'PM10 / PM2.5 / RH', ejes: { PM10: 'y1', 'PM2.5': 'y1', RH: 'y2' } },
  { nombre: 'PM / WS / RH', ejes: { PM10: 'y1', 'PM2.5': 'y1', WS: 'y2', RH: 'y3' } },
];

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
    // La marca de tiempo se arma una vez por fila y no en cada comparación:
    // con un año de la red eran ~3 millones de cadenas y medio segundo con la
    // página congelada. El formato ISO ordena igual como texto que como fecha.
    for (const estacion of Object.keys(index)) {
      index[estacion] = index[estacion]
        .map(fila => ({ fila, t: getTime(fila) }))
        .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
        .map(({ fila }) => fila);
    }
    return index;
  }, [data]);

  // Qué parámetros trae cada estación en los datos cargados: basta una hora
  // con número. Es solo informativo, para saber antes de marcar qué se puede
  // comparar con qué; no deshabilita nada.
  const disponibles = useMemo(() => {
    const todos = [...CONTAMINANTES, ...METEOROLOGICOS];
    const porEstacion: Record<string, Set<string>> = {};
    Object.entries(dataByStation).forEach(([estacion, filas]) => {
      porEstacion[estacion] = new Set(
        todos.filter(p => filas.some(f => getNumeric(f[p]) !== null)),
      );
    });
    return porEstacion;
  }, [dataByStation]);

  const resumenEstacion = (estacion: string) => {
    const tiene = disponibles[estacion] || new Set<string>();
    const cont = CONTAMINANTES.filter(p => tiene.has(p));
    const met = METEOROLOGICOS.filter(p => tiene.has(p));
    const faltan = [...CONTAMINANTES, ...METEOROLOGICOS].filter(p => !tiene.has(p));
    return {
      cont, met,
      detalle: [
        `Contaminantes (${cont.length}/${CONTAMINANTES.length}): ${cont.join(', ') || '—'}`,
        `Meteorológicos (${met.length}/${METEOROLOGICOS.length}): ${met.join(', ') || '—'}`,
        faltan.length ? `Sin datos: ${faltan.join(', ')}` : 'Tiene todos los parámetros',
      ].join('\n'),
    };
  };

  const estacionesCon = (param: string) => stations.filter(s => disponibles[s]?.has(param));

  // Todas las horas del periodo, hayan medido o no. Las estaciones se dibujan
  // sobre esta rejilla para que una hora sin dato sea un hueco y no una recta
  // uniendo la medición anterior con la siguiente. Ver graficas/series.ts.
  const rejilla = useMemo(() => rejillaHoraria(data), [data]);

  // Inicializar con TODAS las estaciones activas desde el primer render
  const [selectedStations, setSelectedStations] = useState<Set<string>>(
    () => new Set(data.map(d => d.STATION))
  );
  const [selectedParams, setSelectedParams] = useState<Set<string>>(new Set(['O3']));
  // Agregados de toda la zona metropolitana. Van aparte de las estaciones
  // porque no dependen de cuáles estén marcadas: se calculan siempre con las
  // 13, que es lo que significa «AMG».
  const [agregados, setAgregados] = useState<Set<Agregado>>(new Set());
  // Asignación de eje: default = y1, puede moverse a y2 o y3 (para mezclar unidades)
  const [axisAssignments, setAxisAssignments] = useState<Record<string, 'y1' | 'y2' | 'y3'>>({});
  const [showValidationAlerts, setShowValidationAlerts] = useState(true);
  // Contaminante cuyas categorías del índice Aire y Salud se pintan de fondo.
  // 'auto' = el primero con índice, empezando por Y1; 'ninguno' = apagado; o
  // un contaminante concreto elegido a mano.
  const [fondoIndice, setFondoIndice] = useState<string>('auto');
  // Escala de categorías del relleno.
  const [escala, setEscala] = useState<EscalaIndice>('aire-salud');
  // Serie que sigue el relleno: el dato horario o uno de los promedios.
  const [baseRelleno, setBaseRelleno] = useState<'horario' | Variante>('horario');
  // Dónde va el color del índice: franjas horizontales en el fondo de la
  // gráfica (cada categoría en su rango de concentración) o bajo la curva.
  const [modoRelleno, setModoRelleno] = useState<'fondo' | 'curva'>('fondo');
  // Promedios activos, como «param|variante».
  const [variantes, setVariantes] = useState<Set<string>>(new Set());
  const tieneVariante = (p: string, v: Variante) => variantes.has(`${p}|${v}`);
  // Casillas: se pueden activar varios promedios del mismo parámetro a la vez,
  // p. ej. el móvil de 24 h y el NowCast para compararlos. Cada uno se
  // distingue por su trazo (VARIANTES[v].dash).
  const alternarVariante = (p: string, v: Variante) =>
    setVariantes(prev => {
      const next = new Set(prev);
      const clave = `${p}|${v}`;
      if (next.has(clave)) next.delete(clave); else next.add(clave);
      return next;
    });
  // Estilo de línea por parámetro (override manual)
  const [lineStyles, setLineStyles] = useState<Record<string, 'solid' | 'dash' | 'dot'>>({});
  // Color de línea por parámetro (override manual)
  const [lineColors, setLineColors] = useState<Record<string, string>>({});
  // Color personalizado por estación
  const [stationColorOverrides, setStationColorOverrides] = useState<Record<string, string>>({});

  // Pestaña activa del panel de filtros. Pensado para crecer: cada pestaña
  // nueva es otra forma de elegir qué se grafica.
  const [pestanaFiltros, setPestanaFiltros] = useState<'parametros' | 'atajos'>('parametros');

  useEffect(() => {
    setSelectedStations(new Set(stations));
  }, [stations]);

  // La disponibilidad de parámetros se cuenta sobre las estaciones marcadas;
  // con todas o ninguna marcada, sobre la red completa.
  const porSeleccion = selectedStations.size > 0 && selectedStations.size < stations.length;
  const baseDisponibilidad = porSeleccion ? stations.filter(s => selectedStations.has(s)) : stations;
  const disponibleEnSeleccion = (param: string) =>
    baseDisponibilidad.some(s => disponibles[s]?.has(param));

  // Un atajo reemplaza la selección y los ejes; colores y trazos elegidos a
  // mano se conservan.
  const aplicarAtajo = (ejes: Record<string, Eje>) => {
    setSelectedParams(new Set(Object.keys(ejes)));
    setAxisAssignments({ ...ejes });
  };

  const atajoActivo = (ejes: Record<string, Eje>) => {
    const params = Object.keys(ejes);
    return params.length === selectedParams.size
      && params.every(p => selectedParams.has(p) && (axisAssignments[p] || 'y1') === ejes[p]);
  };

  const getAxis = (p: string): 'y1' | 'y2' | 'y3' => axisAssignments[p] || 'y1';
  const setAxis = (p: string, axis: 'y1' | 'y2' | 'y3') =>
    setAxisAssignments(prev => ({ ...prev, [p]: axis }));

  const getLineStyle = (p: string): 'solid' | 'dash' | 'dot' => lineStyles[p] || TRAZO_EJE[getAxis(p)];
  const setLineStyle = (p: string, style: 'solid' | 'dash' | 'dot') =>
    setLineStyles(prev => ({ ...prev, [p]: style }));

  const getLineColor = (p: string): string => lineColors[p] || PARAM_COLORS[p] || '#888';
  const setLineColor = (p: string, color: string) =>
    setLineColors(prev => ({ ...prev, [p]: color }));

  const getStationColor = (s: string): string => stationColorOverrides[s] || STATION_COLORS[s] || '#888';
  const setStationColor = (s: string, color: string) =>
    setStationColorOverrides(prev => ({ ...prev, [s]: color }));

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
        // Auto-asignación: si ya hay uno de su mismo tipo, comparte su eje
        // (NO2 junto al O3, no junto a la temperatura); si solo hay del otro
        // tipo, el nuevo va a Y2.
        const isMeteo = METEOROLOGICOS.includes(p);
        const otros = Array.from(next).filter(x => x !== p);
        const mismoTipo = otros.find(x => METEOROLOGICOS.includes(x) === isMeteo);
        if (mismoTipo) {
          setAxisAssignments(a => ({ ...a, [p]: a[mismoTipo] || 'y1' }));
        } else if (otros.length > 0) {
          setAxisAssignments(a => ({ ...a, [p]: 'y2' }));
        }
      }
      return next;
    });
  };

  const toggleAgregado = (id: Agregado) =>
    setAgregados(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectAllStations = () => setSelectedStations(new Set(stations));
  const clearAllStations = () => setSelectedStations(new Set());


  // Map lógico: 'y1' -> 'y' (default Plotly), 'y2' -> 'y2', 'y3' -> 'y3'
  const plotlyAxis = (a: 'y1' | 'y2' | 'y3') => (a === 'y1' ? 'y' : a);

  // Construir trazos Plotly
  const traces = useMemo(() => {
    const result: any[] = [];
    const paramsToShow = Array.from(selectedParams);
    const stationsToShow = Array.from(selectedStations);
    const multiStation = stationsToShow.length > 1;
    const multiParam = paramsToShow.length > 1;

    paramsToShow.forEach((param) => {
      const axis = getAxis(param);
      const yaxis = plotlyAxis(axis);
      const paramColor = getLineColor(param);
      const paramDash = getLineStyle(param);

      // Cada estación sobre la rejilla completa: donde no midió va null, y con
      // connectgaps en false la línea se parte ahí en vez de cruzar el hueco.
      const series: Record<string, (number | null)[]> = {};
      stationsToShow.forEach((station) => {
        series[station] = serieEnRejilla(dataByStation[station] || [], rejilla, param);
      });
      // Solo las estaciones con al menos un dato del parámetro: una sin datos
      // no dibuja nada y solo ensuciaba la leyenda.
      const conDatos = stationsToShow.filter(s => series[s].some(v => v !== null));

      conDatos.forEach((station) => {
        result.push({
          type: 'scatter',
          mode: 'lines',
          name: multiStation && multiParam
            ? `${station} · ${param}`
            : multiStation ? station
            : multiParam ? param
            : `${station} · ${param}`,
          x: rejilla,
          y: series[station],
          connectgaps: false,
          yaxis,
          line: { color: getStationColor(station), width: 1.5, dash: paramDash },
          legendgroup: multiStation ? station : param,
        });
      });

      // Promedios de índice (móvil 8 h, 24 h, NowCast) por estación.
      (VARIANTES_POR_PARAM[param] || []).forEach((v) => {
        if (!variantes.has(`${param}|${v}`)) return;
        const { etiqueta, dash, calcular } = VARIANTES[v];
        conDatos.forEach((station) => {
          const y = calcular(series[station]);
          if (!y.some(x => x !== null)) return;
          result.push({
            type: 'scatter',
            mode: 'lines',
            name: `${station} · ${param} ${etiqueta}`,
            x: rejilla,
            y,
            connectgaps: false,
            yaxis,
            line: { color: getStationColor(station), width: 2.5, dash },
            legendgroup: `${v}_${param}_${station}`,
            hovertemplate: `${station} ${param} ${etiqueta}=%{y:.4g}<extra></extra>`,
          });
        });
      });

      // Banda promedio ± σ de las estaciones marcadas.
      if (conDatos.length > 1) {
        const medias: (number | null)[] = [];
        const inferior: (number | null)[] = [];
        const superior: (number | null)[] = [];

        rejilla.forEach((_, i) => {
          const valores = conDatos
            .map((s) => series[s][i])
            .filter((v): v is number => v !== null);
          if (valores.length === 0) {
            medias.push(null); inferior.push(null); superior.push(null);
            return;
          }
          const media = valores.reduce((a, b) => a + b, 0) / valores.length;
          const desv = valores.length < 2
            ? 0
            : Math.sqrt(valores.reduce((acc, v) => acc + (v - media) ** 2, 0) / valores.length);
          medias.push(media);
          inferior.push(media - desv);
          superior.push(media + desv);
        });

        // Borde inferior (invisible, base del relleno)
        result.push({
          type: 'scatter', mode: 'lines',
          x: rejilla, y: inferior,
          line: { width: 0 }, showlegend: false, hoverinfo: 'skip',
          connectgaps: false, yaxis,
        });
        // Banda superior con relleno
        result.push({
          type: 'scatter', mode: 'lines',
          x: rejilla, y: superior,
          fill: 'tonexty', fillcolor: hexToRgba(paramColor, 0.12),
          line: { width: 0 }, name: `±σ ${param}`, hoverinfo: 'skip',
          connectgaps: false, yaxis, legendgroup: `avg_${param}`,
        });
        // Línea de promedio de lo seleccionado. Se dice «sel.» para no
        // confundirla con el promedio de la AMG, que son las 13 estaciones
        // estén marcadas o no.
        result.push({
          type: 'scatter', mode: 'lines',
          x: rejilla, y: medias,
          name: `Promedio sel. ${param}`,
          line: { color: paramColor, width: 3, dash: 'solid' },
          connectgaps: false, yaxis, legendgroup: `avg_${param}`,
        });
      }

      // Agregados de toda la zona metropolitana, con las 13 estaciones.
      AGREGADOS.forEach(({ id, etiqueta, color, dash }) => {
        if (!agregados.has(id)) return;
        const y = agregadoZona(dataByStation, stations, rejilla, param, id);
        if (!y.some(v => v !== null)) return;
        result.push({
          type: 'scatter',
          mode: 'lines',
          name: `${etiqueta} · ${param}`,
          x: rejilla,
          y,
          connectgaps: false,
          yaxis,
          line: { color, width: 2.5, dash },
          legendgroup: `amg_${id}_${param}`,
          hovertemplate: `<b>%{x}</b><br>${etiqueta} ${param}=%{y:.4g}<extra></extra>`,
        });
      });
    });

    return result;
  }, [dataByStation, stations, rejilla, selectedStations, selectedParams, agregados, variantes,
      axisAssignments, lineColors, lineStyles, stationColorOverrides]);

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
        name: `PM2.5>PM10 (${station})`,
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
        // Sobre la rejilla, para que un hueco corte la corrida: dos tramos
        // planos separados por horas sin dato no son un valor pegado.
        const values = serieEnRejilla(dataByStation[station] || [], rejilla, param);
        const runs = detectConstantRuns(values, rejilla, 3);

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
  }, [dataByStation, rejilla, selectedStations, selectedParams, showValidationAlerts]);

  // Los seleccionados que tienen índice, para ofrecerlos como fondo. Si el
  // elegido se desmarca, el fondo se apaga solo.
  const conIndice = Array.from(selectedParams).filter(p => umbralesEscala(p, escala));
  const orden: Record<Eje, number> = { y1: 0, y2: 1, y3: 2 };
  const fondoAuto = [...conIndice].sort((a, b) => orden[getAxis(a)] - orden[getAxis(b)])[0] ?? null;
  // Un contaminante elegido a mano que luego se desmarca vuelve a automático.
  const fondoActivo = fondoIndice === 'ninguno' ? null
    : fondoIndice !== 'auto' && selectedParams.has(fondoIndice) ? fondoIndice
    : fondoAuto;

  // Promedios activos del contaminante del relleno: son las otras curvas que
  // puede seguir. Si el elegido se apaga, vuelve al dato horario.
  const basesRelleno: Variante[] = fondoActivo
    ? (VARIANTES_POR_PARAM[fondoActivo] || []).filter(v => tieneVariante(fondoActivo, v))
    : [];
  const baseActiva: 'horario' | Variante =
    baseRelleno !== 'horario' && basesRelleno.includes(baseRelleno) ? baseRelleno : 'horario';

  // Relleno bajo la curva con las categorías del índice: cada tramo de área,
  // del color de la categoría en la que cae. Se rellena bajo una sola curva
  // —la envolvente superior: en cada hora, la estación con el valor más
  // alto— para no encimar rellenos y que el color coincida con la línea que
  // de verdad alcanza esa categoría. Un promedio la diluiría: una estación
  // en «Mala» y doce en «Buena» pintaban la hora de verde.
  //
  // Cada categoría es la franja entre min(v, desde) y min(v, hasta). Donde el
  // dato no llega a la categoría los dos bordes valen v y el relleno mide
  // cero, así el área sigue la curva sin cortes al cruzar un umbral.
  //
  // Se dibuja como polígonos cerrados, uno por tramo continuo de datos, y no
  // con fill:'tonexty': ese relleno no respeta los huecos y, al llegar a una
  // hora sin dato, une el área con el principio de la gráfica.
  const rellenoIndice = useMemo(() => {
    if (!fondoActivo || modoRelleno !== 'curva') return [];
    const cortes = umbralesEscala(fondoActivo, escala)!;
    const eje = plotlyAxis(getAxis(fondoActivo));

    const estaciones = Array.from(selectedStations);
    if (estaciones.length === 0) return [];
    const series = estaciones.map(s => {
      const horaria = serieEnRejilla(dataByStation[s] || [], rejilla, fondoActivo);
      return baseActiva === 'horario' ? horaria : VARIANTES[baseActiva].calcular(horaria);
    });
    const curva = rejilla.map((_, i) => {
      const valores = series.map(v => v[i]).filter((v): v is number => v !== null);
      return valores.length ? Math.max(...valores) : null;
    });

    // El piso del relleno es el dato más bajo del eje, no el cero: bajar más
    // obligaría a Plotly a estirar la escala para hacerle sitio.
    let piso = Infinity;
    traces.forEach(t => {
      if (t.yaxis !== eje) return;
      (t.y as (number | null)[]).forEach(v => {
        if (v !== null && v < piso) piso = v;
      });
    });
    if (piso === Infinity) return [];

    const limites = [piso, ...cortes, Infinity];

    // Tramos [inicio, fin] sin huecos.
    const tramos: [number, number][] = [];
    curva.forEach((v, i) => {
      if (v === null) return;
      const ultimo = tramos[tramos.length - 1];
      if (ultimo && ultimo[1] === i - 1) ultimo[1] = i;
      else tramos.push([i, i]);
    });

    return CATEGORIAS_INDICE_JALISCO.flatMap(({ color }, i) => {
      const desde = limites[i], hasta = limites[i + 1];
      if (desde === undefined || hasta === undefined) return [];
      // Categoría que el dato nunca alcanza: no hace falta dibujarla.
      if (!curva.some(v => v !== null && v > desde)) return [];
      // Contorno de cada tramo: el borde superior de ida y el inferior de
      // vuelta; un null separa un polígono del siguiente.
      const x: (string | null)[] = [];
      const y: (number | null)[] = [];
      tramos.forEach(([a, b]) => {
        for (let i = a; i <= b; i++) { x.push(rejilla[i]); y.push(Math.min(curva[i]!, hasta)); }
        for (let i = b; i >= a; i--) { x.push(rejilla[i]); y.push(Math.min(curva[i]!, desde)); }
        x.push(null); y.push(null);
      });
      return [{
        type: 'scatter', mode: 'lines', x, y, yaxis: eje,
        fill: 'toself', fillcolor: hexToRgba(color, 0.35),
        line: { width: 0 }, hoverinfo: 'skip', showlegend: false,
      }];
    });
  }, [traces, fondoActivo, modoRelleno, escala, baseActiva, axisAssignments, selectedStations, dataByStation, rejilla]);

  // Fondo por categorías: una franja horizontal por categoría, del ancho de
  // toda la gráfica, entre sus límites de concentración en el eje del
  // contaminante. La línea se lee contra el fondo: en qué color cae es su
  // categoría, hora a hora y estación por estación.
  //
  // Las franjas se recortan al rango de los datos del eje: Plotly incluye las
  // formas en su escala automática, y una franja de «Extremadamente mala»
  // hasta el infinito aplastaría la curva contra el piso.
  const bandasFondo = useMemo(() => {
    if (!fondoActivo || modoRelleno !== 'fondo') return [];
    const cortes = umbralesEscala(fondoActivo, escala)!;
    const eje = plotlyAxis(getAxis(fondoActivo));

    let piso = Infinity;
    let techo = -Infinity;
    traces.forEach(t => {
      if (t.yaxis !== eje) return;
      (t.y as (number | null)[]).forEach(v => {
        if (v === null) return;
        if (v < piso) piso = v;
        if (v > techo) techo = v;
      });
    });
    if (piso === Infinity) return [];

    const limites = [Math.min(piso, 0), ...cortes, Infinity];
    return CATEGORIAS_INDICE_JALISCO.flatMap(({ color }, i) => {
      const y0 = limites[i];
      const y1 = Math.min(limites[i + 1] ?? Infinity, techo);
      if (y0 === undefined || y1 <= y0) return [];
      return [{
        type: 'rect', layer: 'below',
        xref: 'paper', x0: 0, x1: 1,
        yref: eje, y0, y1,
        fillcolor: hexToRgba(color, 0.28),
        line: { width: 0 },
      }];
    });
  }, [traces, fondoActivo, modoRelleno, escala, axisAssignments]);

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
        domain: [0, hasY3 ? 0.9 : 1],
      },
      yaxis: {
        ...estiloEje(getAxisLabel(y1Params) || 'Valor', COLORES_EJE.y1),
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
      shapes: [...bandasFondo, ...constantRunShapes],
      // Sin esto, cada Plotly.react devolvía todos los ejes a su escala
      // automática y se perdía el zoom del usuario.
      uirevision: 'series',
    };

    if (y2Params.length > 0) {
      base.yaxis2 = {
        ...estiloEje(getAxisLabel(y2Params), COLORES_EJE.y2),
        overlaying: 'y',
        side: 'right',
        // Plotly 4 alinea por defecto las marcas de un eje superpuesto con las
        // de Y1 ('sync'); cada eje calcula las suyas, como antes.
        tickmode: 'auto',
        showgrid: false,
      };
    }

    if (hasY3) {
      base.yaxis3 = {
        ...estiloEje(getAxisLabel(y3Params), COLORES_EJE.y3),
        overlaying: 'y',
        side: 'right',
        position: 1,
        anchor: 'free',
        tickmode: 'auto',
        showgrid: false,
      };
    }

    return base;
  }, [selectedParams, axisAssignments, constantRunShapes, bandasFondo]);

  const chartRef = useRef<HTMLDivElement>(null);

  // Llama directamente a Plotly.react() para garantizar re-render inmediato
  useEffect(() => {
    if (!chartRef.current) return;
    const allTraces = [...rellenoIndice, ...traces, ...pm25pm10AlertTraces];
    const plotConfig = { responsive: true, displayModeBar: true, scrollZoom: true };
    Plotly.react(chartRef.current, allTraces, layout as any, plotConfig);
  }, [rellenoIndice, traces, pm25pm10AlertTraces, layout]);

  const sinSeleccion = selectedStations.size === 0 || selectedParams.size === 0;
  const enEje = (ax: Eje) => Array.from(selectedParams).filter(p => getAxis(p) === ax);

  // Controles a la izquierda, la grafica grande a la derecha: lo que se mira
  // es la grafica, y antes quedaba debajo de media pantalla de casillas.
  return (
    <div className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)] items-start">
      <aside className="bg-white border border-slate-200 rounded-2xl xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
        {/* Estaciones */}
        <Seccion
          titulo="Estaciones"
          detalle={`${selectedStations.size} de ${stations.length}`}
          accion={
            <span className="flex gap-2 text-xs">
              <button onClick={selectAllStations} className="text-slate-500 hover:text-slate-900">Todas</button>
              <button onClick={clearAllStations} className="text-slate-500 hover:text-slate-900">Ninguna</button>
            </span>
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {stations.map(station => {
              const activa = selectedStations.has(station);
              const { cont, met, detalle } = resumenEstacion(station);
              return (
                <span
                  key={station}
                  className={`inline-flex items-center gap-1.5 rounded-lg border pl-1.5 pr-2.5 py-1 text-[13px] transition-colors ${
                    activa ? 'border-slate-800 text-slate-900' : 'border-slate-200 text-slate-400 hover:border-slate-400'
                  }`}
                >
                  {/* El punto es el selector de color de la estacion. */}
                  <label className="relative w-3.5 h-3.5 cursor-pointer" title="Cambiar el color de la estación">
                    <span
                      className="block w-3.5 h-3.5 rounded-full"
                      style={{ backgroundColor: getStationColor(station), opacity: activa ? 1 : 0.4 }}
                    />
                    <input
                      type="color"
                      value={getStationColor(station)}
                      onChange={e => setStationColor(station, e.target.value)}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                      aria-label={`Color de ${station}`}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => toggleStation(station)}
                    aria-pressed={activa}
                    title={`${detalle}\n${cont.length} contaminantes · ${met.length} meteorológicos`}
                    className="font-medium"
                  >
                    {station}
                  </button>
                </span>
              );
            })}
          </div>

          {/* Agregados de la zona: no son estaciones, por eso van aparte. Se
              calculan siempre con las 13. */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {AGREGADOS.map(({ id, etiqueta, color, dash }) => {
              const activo = agregados.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleAgregado(id)}
                  aria-pressed={activo}
                  className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[13px] transition-colors ${
                    activo ? 'border-slate-800 text-slate-900' : 'border-slate-200 text-slate-400 hover:border-slate-400'
                  }`}
                >
                  <span className="inline-block w-4" style={{ borderTop: `2.5px ${dash === 'dash' ? 'dashed' : 'solid'} ${color}` }} />
                  {etiqueta}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-400 mt-1.5">
            Promedio y máximo de las {stations.length} estaciones, hora a hora.
          </p>
        </Seccion>

        {/* Parametros */}
        <Seccion
          titulo="Parámetros"
          detalle={`${selectedParams.size} elegidos`}
          accion={
            <Segmentado
              opciones={[['parametros', 'Lista'], ['atajos', 'Atajos']]}
              valor={pestanaFiltros}
              alCambiar={v => setPestanaFiltros(v as 'parametros' | 'atajos')}
            />
          }
        >
          {pestanaFiltros === 'atajos' && (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-400">Combinaciones frecuentes, ya repartidas en ejes. Reemplazan la selección.</p>
              {ATAJOS.map(({ nombre, ejes }) => {
                const activo = atajoActivo(ejes);
                return (
                  <button
                    key={nombre}
                    onClick={() => aplicarAtajo(ejes)}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                      activo ? 'border-slate-800' : 'border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    <span className="font-semibold text-slate-800">{nombre}</span>
                    <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-0.5 text-xs text-slate-500">
                      {Object.entries(ejes).map(([param, eje]) => (
                        <span key={param} className="inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: COLORES_EJE[eje] }} />
                          {param} <span className="text-slate-400">{eje.toUpperCase()}</span>
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {pestanaFiltros === 'parametros' && (
            <div className="space-y-3">
              {([
                { label: 'Contaminantes', items: CONTAMINANTES },
                { label: 'Meteorológicos', items: METEOROLOGICOS },
              ] as const).map(section => (
                <div key={section.label}>
                  <p className="text-[11px] font-semibold text-slate-400 mb-1">{section.label}</p>
                  <div className="space-y-0.5">
                    {section.items.map(param => {
                      const activo = selectedParams.has(param);
                      const base = baseDisponibilidad;
                      const con = estacionesCon(param).filter(st => base.includes(st));
                      const sin = base.filter(st => !con.includes(st));
                      const disponibilidad = con.length === 0
                        ? porSeleccion ? 'no disponible' : 'sin datos'
                        : porSeleccion && base.length === 1 ? 'disponible'
                        : `${con.length}/${base.length}`;
                      return (
                        <div key={param} className={`rounded-lg ${activo ? 'bg-slate-50 px-2 py-1.5' : 'px-2 py-1'}`}>
                          <label className={`flex items-center gap-2 cursor-pointer text-sm ${disponibleEnSeleccion(param) ? '' : 'opacity-40'}`}>
                            <input type="checkbox" checked={activo} onChange={() => toggleParam(param)} className="accent-slate-800" />
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getLineColor(param) }} />
                            <span className="font-semibold text-slate-800">{param}</span>
                            {getUnitsAndName(param).unit && <span className="text-slate-400 text-xs">{getUnitsAndName(param).unit}</span>}
                            <span
                              className={`ml-auto text-[11px] whitespace-nowrap ${con.length === 0 ? 'text-red-500' : 'text-slate-400'}`}
                              title={con.length === 0
                                ? porSeleccion ? 'Ninguna de las estaciones marcadas mide este parámetro' : 'Ninguna estación tiene datos de este parámetro'
                                : `Con datos: ${con.join(', ')}` + (sin.length ? `\nSin datos: ${sin.join(', ')}` : '')}
                            >
                              {disponibilidad}
                            </span>
                          </label>

                          {activo && (
                            <div className="mt-1.5 ml-6 space-y-1.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Segmentado
                                  opciones={(['y1', 'y2', 'y3'] as const).map(ax => [ax, ax.toUpperCase()] as [string, string])}
                                  valor={getAxis(param)}
                                  alCambiar={v => setAxis(param, v as Eje)}
                                  titulo={v => v === 'y1' ? 'Eje izquierdo' : v === 'y2' ? 'Eje derecho' : 'Eje derecho exterior'}
                                  punto={v => COLORES_EJE[v as Eje]}
                                />
                                <Segmentado
                                  opciones={[['solid', '—'], ['dash', '╌'], ['dot', '···']]}
                                  valor={getLineStyle(param)}
                                  alCambiar={v => setLineStyle(param, v as 'solid' | 'dash' | 'dot')}
                                  titulo={v => v === 'solid' ? 'Línea continua' : v === 'dash' ? 'Línea discontinua' : 'Línea punteada'}
                                  mono
                                />
                                <label className="relative w-5 h-5 cursor-pointer" title="Color de la línea">
                                  <span className="block w-5 h-5 rounded-md border border-slate-200" style={{ backgroundColor: getLineColor(param) }} />
                                  <input
                                    type="color"
                                    value={getLineColor(param)}
                                    onChange={e => setLineColor(param, e.target.value)}
                                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                                    aria-label={`Color de ${param}`}
                                  />
                                </label>
                              </div>
                              {VARIANTES_POR_PARAM[param] && (
                                <div role="group" aria-label={`Promedios de ${param}`} className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                                  <span>Promedios</span>
                                  {VARIANTES_POR_PARAM[param].map(v => {
                                    const on = tieneVariante(param, v);
                                    return (
                                      <button
                                        key={v}
                                        type="button"
                                        onClick={() => alternarVariante(param, v)}
                                        aria-pressed={on}
                                        className={`px-2 py-0.5 rounded-md border transition-colors ${
                                          on ? 'border-slate-800 text-slate-900' : 'border-slate-200 hover:border-slate-400'
                                        }`}
                                      >
                                        {VARIANTES[v].etiqueta}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Seccion>

        {/* Fondo del indice Aire y Salud / IMECA */}
        <Seccion
          titulo="Fondo del índice"
          detalle={fondoActivo ? `${fondoActivo} · ${ESCALAS.find(e => e.id === escala)?.etiqueta}` : 'apagado'}
          accion={conIndice.length > 0 ? (
            <Interruptor
              activo={!!fondoActivo}
              alCambiar={() => setFondoIndice(fondoActivo ? 'ninguno' : 'auto')}
              etiqueta="Mostrar el fondo del índice"
            />
          ) : undefined}
        >
          {conIndice.length === 0 ? (
            <p className="text-xs text-slate-400">Elige O3, NO2, SO2, CO, PM10 o PM2.5 para colorear la gráfica con las categorías del índice.</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-slate-500 space-y-1">
                  <span>Escala</span>
                  <select
                    value={escala}
                    onChange={e => setEscala(e.target.value as EscalaIndice)}
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white text-slate-800"
                  >
                    {ESCALAS.map(({ id, etiqueta }) => <option key={id} value={id}>{etiqueta}</option>)}
                  </select>
                </label>
                <label className="text-xs text-slate-500 space-y-1">
                  <span>Contaminante</span>
                  <select
                    value={fondoIndice !== 'auto' && fondoIndice !== 'ninguno' && !selectedParams.has(fondoIndice) ? 'auto' : fondoIndice}
                    onChange={e => setFondoIndice(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white text-slate-800"
                  >
                    <option value="auto">Automático{fondoAuto ? ` (${fondoAuto})` : ''}</option>
                    <option value="ninguno">Ninguno</option>
                    {conIndice.map(p => <option key={p} value={p}>{p} ({getAxis(p).toUpperCase()})</option>)}
                  </select>
                </label>
              </div>
              {fondoActivo && (
                <div className="flex flex-wrap items-center gap-2">
                  <Segmentado
                    opciones={[['fondo', 'Franjas'], ['curva', 'Bajo la curva']]}
                    valor={modoRelleno}
                    alCambiar={v => setModoRelleno(v as 'fondo' | 'curva')}
                    titulo={v => v === 'fondo'
                      ? 'Franjas con el rango de cada categoría; la línea se lee contra ellas'
                      : 'Rellena bajo la curva de la estación con el valor más alto'}
                  />
                  {modoRelleno === 'curva' && basesRelleno.length > 0 && (
                    <select
                      value={baseActiva}
                      onChange={e => setBaseRelleno(e.target.value as 'horario' | Variante)}
                      className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white text-slate-800"
                      title="Qué curva sigue el relleno"
                    >
                      <option value="horario">Sigue el dato horario</option>
                      {basesRelleno.map(v => <option key={v} value={v}>Sigue {VARIANTES[v].etiqueta}</option>)}
                    </select>
                  )}
                </div>
              )}
            </div>
          )}
        </Seccion>

        {/* Alertas */}
        <Seccion
          titulo="Alertas de validación"
          accion={<Interruptor activo={showValidationAlerts} alCambiar={() => setShowValidationAlerts(!showValidationAlerts)} etiqueta="Mostrar alertas de validación" />}
          ultima
        >
          <div className="space-y-1 text-xs text-slate-500">
            <p className="flex items-center gap-2"><span className="text-red-600 text-sm leading-none">▲</span>PM2.5 mayor que PM10 (con los dos elegidos)</p>
            <p className="flex items-center gap-2">
              <span className="inline-block w-5 h-2.5 rounded-sm" style={{ background: 'rgba(255,140,0,0.25)', border: '1.5px dotted rgba(255,140,0,0.7)' }} />
              Mismo valor más de 3 h seguidas
            </p>
          </div>
          <button
            onClick={() => { setLineStyles({}); setLineColors({}); setAxisAssignments({}); setStationColorOverrides({}); }}
            className="mt-3 text-xs text-slate-400 hover:text-slate-800 underline"
            title="Colores, estilos y ejes a sus valores de partida"
          >
            Restablecer colores, estilos y ejes
          </button>
        </Seccion>
      </aside>

      {/* Grafica */}
      <section className="min-w-0 bg-white border border-slate-200 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm mb-2">
          <span className="font-semibold text-slate-800">
            {selectedStations.size} {selectedStations.size === 1 ? 'estación' : 'estaciones'} · {selectedParams.size} {selectedParams.size === 1 ? 'parámetro' : 'parámetros'}
          </span>
          {(['y1', 'y2', 'y3'] as const).map(ax => enEje(ax).length > 0 && (
            <span key={ax} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORES_EJE[ax] }} />
              {ax.toUpperCase()}{ax === 'y1' ? ' izq.' : ax === 'y2' ? ' der.' : ' der. ext.'}: {enEje(ax).join(', ')}
            </span>
          ))}
          {selectedStations.size > 1 && selectedParams.size > 0 && (
            <span className="text-xs text-slate-400">banda: promedio ± desviación estándar</span>
          )}
        </div>

        {sinSeleccion && (
          <div className="flex items-center justify-center h-80 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
            Elige al menos una estación y un parámetro
          </div>
        )}
        <div ref={chartRef} style={{ width: '100%', minHeight: sinSeleccion ? '0px' : '560px' }} />

        {fondoActivo && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            {CATEGORIAS_INDICE_JALISCO.map(({ nombre, color }, i) => {
              const cortes = umbralesEscala(fondoActivo, escala)!;
              const desde = i === 0 ? 0 : cortes[i - 1];
              const rango = i < cortes.length ? `${desde}–${cortes[i]}` : `>${cortes[i - 1]}`;
              const etiqueta = escala === 'aire-salud' && i === 1 && fondoActivo in UMBRALES_2026 ? 'Aceptable' : nombre;
              return (
                <span key={nombre} className="inline-flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                  {etiqueta}
                  {escala === 'imeca' && <span className="text-slate-400">({RANGOS_IMECA[i]})</span>}
                  <span className="text-slate-400">{rango}</span>
                </span>
              );
            })}
            <span className="text-slate-400">
              {getUnitsAndName(fondoActivo).unit}
              {escala === 'imeca' ? ' · IMECA según NADF-009-AIRE-2017' : ''}
              {modoRelleno === 'fondo'
                ? ` · franjas de ${fondoActivo} en ${getAxis(fondoActivo).toUpperCase()}. El índice oficial usa promedios (8 h, 24 h o NowCast): actívalos en Parámetros.`
                : baseActiva === 'horario'
                  ? ' · sigue a la estación con el valor más alto en el dato horario.'
                  : ` · sigue a la estación con el valor más alto en ${VARIANTES[baseActiva].etiqueta}.`}
            </span>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-400">
          Arrastra el deslizador de abajo para cambiar el periodo · Arrastra un eje Y para cambiar su escala · Doble clic restablece
        </p>
      </section>
    </div>
  );
};


// ── Piezas de la interfaz ────────────────────────────────────────────────────

/** Bloque plegable del panel de controles. */
function Seccion({ titulo, detalle, accion, ultima, children }: {
  titulo: string; detalle?: string; accion?: ReactNode; ultima?: boolean; children: ReactNode;
}) {
  const [abierta, setAbierta] = useState(true);
  return (
    <section className={`px-4 py-3 ${ultima ? '' : 'border-b border-slate-200'}`}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAbierta(!abierta)}
          aria-expanded={abierta}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"
        >
          <span className={`inline-block text-slate-400 text-[10px] transition-transform ${abierta ? 'rotate-90' : ''}`}>▶</span>
          {titulo}
        </button>
        {detalle && <span className="text-xs text-slate-400 truncate">{detalle}</span>}
        <span className="ml-auto">{accion}</span>
      </div>
      {abierta && <div className="mt-2.5">{children}</div>}
    </section>
  );
}

/** Grupo de opciones excluyentes, con el estilo de los botones de v2. */
function Segmentado({ opciones, valor, alCambiar, titulo, punto, mono }: {
  opciones: [string, string][];
  valor: string;
  alCambiar: (v: string) => void;
  titulo?: (v: string) => string;
  punto?: (v: string) => string;
  mono?: boolean;
}) {
  return (
    <div role="radiogroup" className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
      {opciones.map(([v, texto]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={valor === v}
          onClick={() => alCambiar(v)}
          title={titulo?.(v)}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors ${mono ? 'font-mono' : ''} ${
            valor === v ? 'bg-slate-100 text-slate-900 ring-1 ring-slate-800' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {punto && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: punto(v) }} />}
          {texto}
        </button>
      ))}
    </div>
  );
}

/** Interruptor de encendido y apagado. */
function Interruptor({ activo, alCambiar, etiqueta }: { activo: boolean; alCambiar: () => void; etiqueta: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      title={etiqueta}
      onClick={alCambiar}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${activo ? 'bg-slate-800' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${activo ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default LineCharts;
