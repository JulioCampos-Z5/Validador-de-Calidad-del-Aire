import { useState, useMemo, useEffect, useRef } from 'react';
import Plotly from '../graficas/plotly';
import {
  rejillaHoraria, serieEnRejilla, agregadoZona, type Agregado,
} from '../graficas/series';
import {
  CONTAMINANTES as CONTAMINANTES_CONST,
  METEOROLOGICOS as METEOROLOGICOS_CONST,
  COLORES_ESTACIONES,
  getUnitsAndName,
  getAxisLabel,
  umbralesIndice,
  UMBRALES_2026,
  CATEGORIAS_INDICE_JALISCO,
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
    Object.values(index).forEach(arr =>
      arr.sort((a, b) => getTime(a).localeCompare(getTime(b)))
    );
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

      stationsToShow.forEach((station) => {
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

      // Banda promedio ± σ de las estaciones marcadas.
      if (multiStation) {
        const medias: (number | null)[] = [];
        const inferior: (number | null)[] = [];
        const superior: (number | null)[] = [];

        rejilla.forEach((_, i) => {
          const valores = stationsToShow
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
        result.push({
          type: 'scatter',
          mode: 'lines',
          name: `${etiqueta} · ${param}`,
          x: rejilla,
          y: agregadoZona(dataByStation, stations, rejilla, param, id),
          connectgaps: false,
          yaxis,
          line: { color, width: 2.5, dash },
          legendgroup: `amg_${id}_${param}`,
          hovertemplate: `<b>%{x}</b><br>${etiqueta} ${param}=%{y:.4g}<extra></extra>`,
        });
      });
    });

    return result;
  }, [dataByStation, stations, rejilla, selectedStations, selectedParams, agregados,
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
  const conIndice = Array.from(selectedParams).filter(p => umbralesIndice(p));
  const orden: Record<Eje, number> = { y1: 0, y2: 1, y3: 2 };
  const fondoAuto = [...conIndice].sort((a, b) => orden[getAxis(a)] - orden[getAxis(b)])[0] ?? null;
  // Un contaminante elegido a mano que luego se desmarca vuelve a automático.
  const fondoActivo = fondoIndice === 'ninguno' ? null
    : fondoIndice !== 'auto' && selectedParams.has(fondoIndice) ? fondoIndice
    : fondoAuto;

  // Relleno bajo la curva con las categorías del índice: cada tramo de área,
  // del color de la categoría en la que cae. Se rellena bajo una sola curva
  // —la de la estación si hay una, el promedio de lo seleccionado si hay
  // varias— para no encimar rellenos.
  //
  // Cada categoría es la franja entre min(v, desde) y min(v, hasta). Donde el
  // dato no llega a la categoría los dos bordes valen v y el relleno mide
  // cero, así el área sigue la curva sin cortes al cruzar un umbral.
  //
  // Se dibuja como polígonos cerrados, uno por tramo continuo de datos, y no
  // con fill:'tonexty': ese relleno no respeta los huecos y, al llegar a una
  // hora sin dato, une el área con el principio de la gráfica.
  const rellenoIndice = useMemo(() => {
    if (!fondoActivo) return [];
    const cortes = umbralesIndice(fondoActivo)!;
    const eje = plotlyAxis(getAxis(fondoActivo));

    const estaciones = Array.from(selectedStations);
    if (estaciones.length === 0) return [];
    const series = estaciones.map(s => serieEnRejilla(dataByStation[s] || [], rejilla, fondoActivo));
    const curva = rejilla.map((_, i) => {
      const valores = series.map(v => v[i]).filter((v): v is number => v !== null);
      return valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null;
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
  }, [traces, fondoActivo, axisAssignments, selectedStations, dataByStation, rejilla]);

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
      shapes: constantRunShapes,
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
  }, [selectedParams, axisAssignments, constantRunShapes]);

  const chartRef = useRef<HTMLDivElement>(null);

  // Llama directamente a Plotly.react() para garantizar re-render inmediato
  useEffect(() => {
    if (!chartRef.current) return;
    const allTraces = [...rellenoIndice, ...traces, ...pm25pm10AlertTraces];
    const plotConfig = { responsive: true, displayModeBar: true, scrollZoom: true };
    Plotly.react(chartRef.current, allTraces, layout as any, plotConfig);
  }, [rellenoIndice, traces, pm25pm10AlertTraces, layout]);

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
                <div key={station} className="flex items-center gap-1.5 text-sm py-0.5">
                  <input
                    type="checkbox"
                    checked={selectedStations.has(station)}
                    onChange={() => toggleStation(station)}
                    className="accent-blue-600 cursor-pointer flex-shrink-0"
                  />
                  <div
                    className="relative flex-shrink-0 cursor-pointer"
                    title="Color de la estación"
                    style={{ width: 16, height: 16 }}
                  >
                    <span
                      className="w-4 h-4 rounded block border border-gray-300 shadow-sm"
                      style={{ backgroundColor: getStationColor(station) }}
                    />
                    <input
                      type="color"
                      value={getStationColor(station)}
                      onChange={e => setStationColor(station, e.target.value)}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    />
                  </div>
                  {(() => {
                    const { cont, met, detalle } = resumenEstacion(station);
                    return (
                      <span
                        className="flex flex-col leading-tight cursor-pointer"
                        onClick={() => toggleStation(station)}
                        title={detalle}
                      >
                        <span className="text-gray-700">{station}</span>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">
                          <span className="text-green-700">{cont.length} cont</span>
                          {' · '}
                          <span className="text-purple-700">{met.length} met</span>
                        </span>
                      </span>
                    );
                  })()}
                </div>
              ))}
            </div>

            {/* Agregados de la zona: no son estaciones, por eso van aparte y
                debajo. Se calculan siempre con las 13. */}
            <div className="mt-2 pt-2 border-t border-gray-100">
              <div className="flex items-center gap-4">
                {AGREGADOS.map(({ id, etiqueta, color, dash }) => (
                  <label key={id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agregados.has(id)}
                      onChange={() => toggleAgregado(id)}
                      className="accent-blue-600 cursor-pointer"
                    />
                    <span
                      className="inline-block w-5 flex-shrink-0"
                      style={{
                        borderTop: `3px ${dash === 'dash' ? 'dashed' : 'solid'} ${color}`,
                      }}
                    />
                    <span className="text-gray-700">{etiqueta}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Sobre las {stations.length} estaciones y el parámetro seleccionado,
                hora a hora. Independiente de las casillas de arriba.
              </p>
            </div>
          </div>

          {/* Selector de parámetros (contaminantes y meteorológicos combinables) */}
          <div>
            <div className="flex items-center justify-between mb-2 border-b border-gray-200">
              <div className="flex gap-1" role="tablist">
                {([
                  { id: 'parametros' as const, etiqueta: 'Parámetros' },
                  { id: 'atajos' as const, etiqueta: 'Atajos' },
                ]).map(({ id, etiqueta }) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={pestanaFiltros === id}
                    onClick={() => setPestanaFiltros(id)}
                    className={`px-3 py-1.5 text-sm font-semibold -mb-px border-b-2 transition-colors ${
                      pestanaFiltros === id
                        ? 'border-blue-600 text-blue-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {etiqueta}
                  </button>
                ))}
              </div>
              <button
                onClick={() => { setLineStyles({}); setLineColors({}); setAxisAssignments({}); setStationColorOverrides({}); }}
                className="text-xs text-red-500 hover:text-red-700 hover:underline transition-colors"
                title="Restablecer colores, estilos y ejes a los valores predeterminados"
              >
                Restablecer
              </button>
            </div>
            {pestanaFiltros === 'atajos' && (
              <div>
                <p className="text-xs text-gray-400 mb-2">
                  Combinaciones frecuentes, ya repartidas en ejes. Reemplazan la selección actual;
                  después puedes ajustarla en <strong>Parámetros</strong>.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ATAJOS.map(({ nombre, ejes }) => {
                    const activo = atajoActivo(ejes);
                    return (
                      <button
                        key={nombre}
                        onClick={() => aplicarAtajo(ejes)}
                        className={`text-left px-3 py-2 rounded-md border text-sm transition-colors ${
                          activo
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                        }`}
                      >
                        <span className="font-semibold text-gray-800">{nombre}</span>
                        <span className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(ejes).map(([param, eje]) => (
                            <span
                              key={param}
                              className="text-[11px] px-1.5 py-0.5 rounded text-white"
                              style={{ backgroundColor: COLORES_EJE[eje] }}
                              title={`${param} en ${eje.toUpperCase()}`}
                            >
                              {param} · {eje.toUpperCase()}
                            </span>
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {pestanaFiltros === 'parametros' && (<>
            <p className="text-xs text-gray-400 mb-2">
              Mezcla libremente contaminantes y variables meteorológicas. <strong>Y1/Y2</strong> = eje izquierdo/derecho.
              Cada parámetro nuevo va al eje de los de su tipo; si no hay ninguno, a Y2.
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
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: getLineColor(param) }}
                          />
                          <span className="font-medium" style={{ color: getLineColor(param) }}>{param}</span>
                          {getUnitsAndName(param).unit && <span className="text-gray-400 text-xs">({getUnitsAndName(param).unit})</span>}
                          {(() => {
                            const con = estacionesCon(param);
                            const sin = stations.filter(s => !con.includes(s));
                            return (
                              <span
                                className={`text-[10px] whitespace-nowrap ${con.length === 0 ? 'text-red-400' : 'text-gray-400'}`}
                                title={con.length === 0
                                  ? 'Ninguna estación tiene datos de este parámetro'
                                  : `Con datos: ${con.join(', ')}` + (sin.length ? `\nSin datos: ${sin.join(', ')}` : '')}
                              >
                                {con.length === 0 ? 'sin datos' : `${con.length}/${stations.length} est.`}
                              </span>
                            );
                          })()}
                        </label>
                        {selectedParams.has(param) && (
                          <div className="flex items-center gap-1 ml-2 flex-wrap">
                            {/* Ejes Y */}
                            <div className="flex gap-1 text-xs">
                              {(['y1', 'y2', 'y3'] as const).map(ax => {
                                const isActive = getAxis(param) === ax;
                                const activeBg = ax === 'y1' ? 'bg-blue-500' : ax === 'y2' ? 'bg-orange-500' : 'bg-purple-500';
                                return (
                                  <button
                                    key={ax}
                                    onClick={() => setAxis(param, ax)}
                                    title={ax === 'y1' ? 'Eje izquierdo' : ax === 'y2' ? 'Eje derecho' : 'Eje derecho exterior'}
                                    className={`px-2 py-0.5 rounded transition-colors ${isActive ? `${activeBg} text-white` : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                                  >
                                    {ax.toUpperCase()}
                                  </button>
                                );
                              })}
                            </div>
                            {/* Estilo de línea */}
                            <div className="flex gap-1 text-xs">
                              {([
                                { val: 'solid' as const, label: '—', title: 'Línea continua' },
                                { val: 'dash'  as const, label: '╌', title: 'Línea discontinua' },
                                { val: 'dot'   as const, label: '···', title: 'Línea punteada' },
                              ]).map(({ val, label, title }) => {
                                const isActive = getLineStyle(param) === val;
                                return (
                                  <button
                                    key={val}
                                    onClick={() => setLineStyle(param, val)}
                                    title={title}
                                    className={`px-2 py-0.5 rounded transition-colors font-mono ${isActive ? 'bg-slate-700 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                            {/* Color picker del parámetro */}
                            <div
                              className="relative flex-shrink-0 cursor-pointer"
                              title="Color de la línea del parámetro"
                              style={{ width: 16, height: 16 }}
                            >
                              <span
                                className="w-4 h-4 rounded block border border-gray-300 shadow-sm"
                                style={{ backgroundColor: getLineColor(param) }}
                              />
                              <input
                                type="color"
                                value={getLineColor(param)}
                                onChange={e => setLineColor(param, e.target.value)}
                                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            </>)}
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

        {/* Relleno bajo la curva con el índice Aire y Salud */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <span className="font-medium">Relleno índice Aire y Salud:</span>
            <select
              value={fondoIndice !== 'auto' && fondoIndice !== 'ninguno' && !selectedParams.has(fondoIndice) ? 'auto' : fondoIndice}
              onChange={e => setFondoIndice(e.target.value)}
              disabled={conIndice.length === 0}
              className="border border-gray-300 rounded-md px-2 py-1 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400"
              title={conIndice.length === 0
                ? 'Selecciona O3, NO2, SO2, CO, PM10 o PM2.5 para usar el relleno'
                : 'Rellena bajo la curva de ese contaminante con el color de su categoría del índice'}
            >
              <option value="auto">Automático{fondoAuto ? ` (${fondoAuto})` : ''}</option>
              <option value="ninguno">Ninguno</option>
              {conIndice.map(p => (
                <option key={p} value={p}>{p} ({getAxis(p).toUpperCase()})</option>
              ))}
            </select>
          </label>
          {conIndice.length > 0 && (
            <button
              onClick={() => setFondoIndice(fondoActivo ? 'ninguno' : 'auto')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                fondoActivo
                  ? 'border-gray-300 text-gray-600 hover:bg-gray-100'
                  : 'border-green-600 bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {fondoActivo ? 'Ocultar relleno' : 'Mostrar relleno'}
            </button>
          )}
          {fondoActivo && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
              {CATEGORIAS_INDICE_JALISCO.map(({ nombre, color }, i) => {
                const cortes = umbralesIndice(fondoActivo)!;
                const desde = i === 0 ? 0 : cortes[i - 1];
                const rango = i < cortes.length ? `${desde}–${cortes[i]}` : `>${cortes[i - 1]}`;
                const etiqueta = i === 1 && fondoActivo in UMBRALES_2026 ? 'Aceptable' : nombre;
                return (
                  <span key={nombre} className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                    {etiqueta} <span className="text-gray-400">{rango}</span>
                  </span>
                );
              })}
              <span className="text-gray-400">
                {getUnitsAndName(fondoActivo).unit} · referencia visual: el índice oficial usa promedios
                (8 h, 24 h o NowCast), aquí se compara con el dato horario.
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
          <span className="ml-auto text-gray-400">Deslizador inferior: periodo · Arrastra un eje Y para cambiar su escala (extremos estiran, centro desplaza) · Doble clic restablece</span>
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
