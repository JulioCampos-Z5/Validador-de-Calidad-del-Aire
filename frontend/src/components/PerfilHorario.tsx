import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// @ts-ignore — el bundle dist es browser-ready pero no tiene declaraciones de tipo propias
import Plotly from 'plotly.js/dist/plotly.js';
import { Clock, Info } from 'lucide-react';
import {
  rejillaHoraria, serieEnRejilla, agregadoZona,
  promedioPorHoraDelDia, type Registro,
} from '../graficas/series';
import {
  CONTAMINANTES, METEOROLOGICOS, COLORES_ESTACIONES,
  getUnitsAndName, isMeteorologico,
} from '../constants';

/**
 * Comportamiento horario: el promedio de cada hora del día en el periodo
 * cargado.
 *
 * La gráfica de arriba enseña la serie completa, hora a hora, y ahí el patrón
 * diario —el pico de tráfico de la mañana, el ozono de la tarde— queda
 * enterrado bajo la variación de un día a otro. Esta la dobla sobre 24 horas:
 * todas las 8:00 del periodo se promedian en un solo punto, y el patrón
 * aparece.
 *
 * El cruce con un segundo parámetro en el eje derecho es lo que hace que sirva
 * para algo más que mirar: el ozono contra la radiación solar, o el PM10
 * contra la velocidad del viento, explican en una sola imagen por qué la curva
 * tiene la forma que tiene.
 *
 * Las horas sin dato no cuentan. Un promedio hecho con tres valores y otro
 * hecho con treinta se dibujan igual, así que la cuenta va en el hover: sin
 * ella, un pico que solo existe porque esa hora casi no se midió pasa por real.
 */

interface Props {
  data: Registro[];
}

const NINGUNO = '';

/** Ámbito de la curva: una estación o un agregado de toda la zona. */
const AMG_PROMEDIO = '__amg_promedio';
const AMG_MAXIMO = '__amg_maximo';

const COLOR_PRINCIPAL = '#2563eb';
const COLOR_CRUCE = '#ea580c';

export default function PerfilHorario({ data }: Props) {
  const estaciones = useMemo(
    () => [...new Set(data.map(d => d.STATION))].sort(),
    [data],
  );

  const porEstacion = useMemo(() => {
    const indice: Record<string, Registro[]> = {};
    for (const fila of data) {
      if (!indice[fila.STATION]) indice[fila.STATION] = [];
      indice[fila.STATION].push(fila);
    }
    return indice;
  }, [data]);

  const rejilla = useMemo(() => rejillaHoraria(data), [data]);

  const [ambito, setAmbito] = useState<string>(AMG_PROMEDIO);
  const [parametro, setParametro] = useState('O3');
  const [cruce, setCruce] = useState<string>(NINGUNO);

  // Si el conjunto cargado no trae la estación elegida —se cambió de origen—,
  // se vuelve al promedio de la zona en vez de dibujar una gráfica vacía.
  useEffect(() => {
    if (ambito !== AMG_PROMEDIO && ambito !== AMG_MAXIMO && !estaciones.includes(ambito)) {
      setAmbito(AMG_PROMEDIO);
    }
  }, [estaciones, ambito]);

  /** La serie horaria del ámbito elegido, sobre la rejilla completa. */
  const serie = useCallback((param: string): (number | null)[] => {
    if (ambito === AMG_PROMEDIO) {
      return agregadoZona(porEstacion, estaciones, rejilla, param, 'promedio');
    }
    if (ambito === AMG_MAXIMO) {
      return agregadoZona(porEstacion, estaciones, rejilla, param, 'maximo');
    }
    return serieEnRejilla(porEstacion[ambito] || [], rejilla, param);
  }, [ambito, porEstacion, estaciones, rejilla]);

  const perfiles = useMemo(() => ({
    principal: promedioPorHoraDelDia(rejilla, serie(parametro)),
    secundario: cruce ? promedioPorHoraDelDia(rejilla, serie(cruce)) : null,
  }), [rejilla, serie, parametro, cruce]);

  const { principal, secundario } = perfiles;

  /**
   * Qué parámetros mide de verdad el ámbito elegido.
   *
   * No todas las estaciones traen todos los equipos: en la red, la radiación
   * solar la miden cuatro de las trece. Elegir RS en una estación que no la
   * mide dibujaba una leyenda, un eje derecho y ni una línea — que parece la
   * gráfica rota, no un dato que no existe. Con esto, el desplegable lo dice
   * antes de elegir y el aviso lo explica después.
   */
  const medidos = useMemo(() => {
    const conDatos = new Set<string>();
    for (const p of [...CONTAMINANTES, ...METEOROLOGICOS]) {
      if (serie(p).some(v => v !== null)) conDatos.add(p);
    }
    return conDatos;
  }, [serie]);

  const horas = useMemo(() => Array.from({ length: 24 }, (_, h) => h), []);
  const hayDatos = principal.cuentas.some(c => c > 0);
  // El cruce solo se dibuja si hay algo que dibujar; si no, sobra hasta el eje.
  const hayCruce = !!secundario && secundario.cuentas.some(c => c > 0);

  const nombreAmbito =
    ambito === AMG_PROMEDIO ? 'promedio AMG'
      : ambito === AMG_MAXIMO ? 'máximo AMG'
        : ambito;

  const colorPrincipal = ambito === AMG_PROMEDIO || ambito === AMG_MAXIMO
    ? COLOR_PRINCIPAL
    : COLORES_ESTACIONES[ambito] || COLOR_PRINCIPAL;

  const grafica = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!grafica.current || !hayDatos) return;

    const unidad = (p: string) => getUnitsAndName(p).unit;

    const trazos: any[] = [{
      type: 'scatter',
      mode: 'lines+markers',
      name: `${parametro} · ${nombreAmbito}`,
      x: horas,
      y: principal.promedios,
      // Una hora sin ningún dato en todo el periodo es un hueco de verdad, y
      // se ve como tal: la curva se parte.
      connectgaps: false,
      line: { color: colorPrincipal, width: 2.5 },
      marker: { size: 6 },
      customdata: principal.cuentas,
      hovertemplate:
        `<b>%{x}:00</b><br>${parametro} = %{y:.4g} ${unidad(parametro)}`
        + '<br>%{customdata} valores<extra></extra>',
    }];

    if (secundario && cruce && hayCruce) {
      trazos.push({
        type: 'scatter',
        mode: 'lines+markers',
        name: `${cruce} · ${nombreAmbito}`,
        x: horas,
        y: secundario.promedios,
        connectgaps: false,
        yaxis: 'y2',
        line: { color: COLOR_CRUCE, width: 2.5, dash: 'dash' },
        marker: { size: 6, symbol: 'diamond' },
        customdata: secundario.cuentas,
        hovertemplate:
          `<b>%{x}:00</b><br>${cruce} = %{y:.4g} ${unidad(cruce)}`
          + '<br>%{customdata} valores<extra></extra>',
      });
    }

    const disposicion: any = {
      autosize: true,
      height: 420,
      margin: { t: 20, r: hayCruce ? 70 : 30, b: 60, l: 70 },
      xaxis: {
        title: 'Hora del día',
        dtick: 1,
        range: [-0.5, 23.5],
        zeroline: false,
      },
      yaxis: {
        title: `${parametro}${unidad(parametro) ? ` [${unidad(parametro)}]` : ''}`,
        automargin: true,
        zeroline: false,
      },
      legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.2, yanchor: 'top' },
      hovermode: 'x unified',
      plot_bgcolor: '#f9fafb',
      paper_bgcolor: '#ffffff',
    };

    if (hayCruce && cruce) {
      disposicion.yaxis2 = {
        title: `${cruce}${unidad(cruce) ? ` [${unidad(cruce)}]` : ''}`,
        overlaying: 'y',
        side: 'right',
        automargin: true,
        zeroline: false,
        showgrid: false,
      };
    }

    Plotly.react(grafica.current, trazos, disposicion, {
      responsive: true, displayModeBar: true,
    });
  }, [horas, principal, secundario, parametro, cruce, hayCruce, nombreAmbito, colorPrincipal, hayDatos]);

  const selector = 'border border-gray-300 rounded-md px-2 py-1 text-sm bg-white '
    + 'focus:outline-none focus:ring-1 focus:ring-blue-400';

  /**
   * Las opciones de parámetro, agrupadas como en el resto de la interfaz y
   * marcando las que el ámbito elegido no mide.
   */
  const opcion = (p: string) => (
    <option key={p} value={p}>
      {p} ({getUnitsAndName(p).unit}){medidos.has(p) ? '' : ' — sin datos'}
    </option>
  );

  const opcionesParametro = (
    <>
      <optgroup label="Contaminantes">{CONTAMINANTES.map(opcion)}</optgroup>
      <optgroup label="Meteorológicos">{METEOROLOGICOS.map(opcion)}</optgroup>
    </>
  );

  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-4">
      <div className="flex items-start gap-3">
        <Clock className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="font-semibold text-gray-800">Comportamiento horario</h3>
          <p className="text-sm text-gray-500">
            Promedio de cada hora del día en todo el periodo cargado.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-600">Estación</span>
          <select value={ambito} onChange={e => setAmbito(e.target.value)} className={selector}>
            <optgroup label="Zona metropolitana">
              <option value={AMG_PROMEDIO}>Promedio AMG ({estaciones.length} estaciones)</option>
              <option value={AMG_MAXIMO}>Máximo AMG ({estaciones.length} estaciones)</option>
            </optgroup>
            <optgroup label="Estaciones">
              {estaciones.map(e => <option key={e} value={e}>{e}</option>)}
            </optgroup>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-600">Parámetro</span>
          <select
            value={parametro}
            onChange={e => setParametro(e.target.value)}
            className={selector}
          >
            {opcionesParametro}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-600">
            Cruce <span className="font-normal text-gray-400">(eje derecho)</span>
          </span>
          <select value={cruce} onChange={e => setCruce(e.target.value)} className={selector}>
            <option value={NINGUNO}>— ninguno —</option>
            {opcionesParametro}
          </select>
        </label>

        {cruce && hayCruce && (
          <p className="text-xs text-gray-500 max-w-xs leading-snug">
            {isMeteorologico(cruce)
              ? 'Variable meteorológica en el eje derecho: sirve para ver qué explica la forma de la curva.'
              : 'Segundo contaminante en el eje derecho, con su propia escala.'}
          </p>
        )}
      </div>

      {/* El aviso va antes de la gráfica y no dentro: quien elige un cruce y no
          ve la segunda curva necesita saber por qué ANTES de concluir que la
          pantalla está rota. */}
      {cruce && !hayCruce && hayDatos && (
        <p className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Info size={15} className="shrink-0 mt-0.5" />
          <span>
            <strong>{nombreAmbito}</strong> no tiene lecturas de {cruce} en este
            periodo, así que no hay segunda curva que dibujar. En la red no todas
            las estaciones llevan todos los equipos —la radiación solar, por
            ejemplo, la miden cuatro de las trece—: prueba con otra estación, con
            el promedio AMG, o mira en Registros si el canal figura como «sin
            equipo».
          </span>
        </p>
      )}

      {hayDatos ? (
        <div ref={grafica} style={{ width: '100%', minHeight: '420px' }} />
      ) : (
        <div className="flex flex-col items-center justify-center h-48 text-center px-6">
          <p className="text-gray-500 text-sm">
            <strong>{nombreAmbito}</strong> no tiene lecturas de {parametro} en
            el periodo cargado.
          </p>
          <p className="text-gray-400 text-xs mt-1">
            Los parámetros que sí mide salen sin la marca «sin datos» en el
            desplegable.
          </p>
        </div>
      )}
    </div>
  );
}
