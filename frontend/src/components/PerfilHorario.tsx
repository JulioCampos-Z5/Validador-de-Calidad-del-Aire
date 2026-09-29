import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Plotly from '../graficas/plotly';
import { CalendarRange, Clock, Info, Loader2 } from 'lucide-react';
import { useDatos } from '../estado/DatosContexto';
import { historicoApi } from '../services/historico';
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

/** Un periodo a comparar: fechas `AAAA-MM-DD`, ambas incluidas. */
interface Periodo { desde: string; hasta: string }

const MAX_PERIODOS = 6;
const COLORES_PERIODO = ['#2563eb', '#ea580c', '#16a34a', '#9333ea', '#dc2626', '#0891b2'];

/** Deja solo las horas de la serie que caen dentro del periodo. */
function recortar(rejilla: string[], valores: (number | null)[], { desde, hasta }: Periodo) {
  return valores.map((v, i) => {
    const dia = rejilla[i].slice(0, 10);
    return dia >= desde && dia <= hasta ? v : null;
  });
}

const etiquetaPeriodo = ({ desde, hasta }: Periodo) =>
  desde === hasta ? desde : `${desde} → ${hasta}`;

/** `AAAA-MM-DD` un año antes. El 29 de febrero pasa al 28. */
function anioAntes(fecha: string): string {
  const [a, m, d] = fecha.split('-');
  const dia = m === '02' && d === '29' ? '28' : d;
  return `${Number(a) - 1}-${m}-${dia}`;
}

/** El día siguiente, para pedir un rango con `hasta` excluyente. */
function diaSiguiente(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const f = new Date(a, m - 1, d + 1);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
}

export default function PerfilHorario({ data }: Props) {
  // En la app de escritorio, un periodo fuera de lo cargado (el año anterior,
  // por ejemplo) se lee de la base local sin tocar los datos en pantalla.
  const { historicoDisponible } = useDatos();
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

  // Comparación de periodos: el mismo perfil, una curva por rango de fechas.
  // Sirve para ver si un fin de semana, una contingencia o un mes se comporta
  // distinto del resto. El cruce también se compara: cada periodo lleva su
  // curva del cruce, punteada y del mismo color, en el eje derecho.
  const primerDia = rejilla[0]?.slice(0, 10) ?? '';
  const ultimoDia = rejilla[rejilla.length - 1]?.slice(0, 10) ?? '';
  const [comparar, setComparar] = useState(false);
  const [periodos, setPeriodos] = useState<Periodo[]>([]);

  // Al cambiar el conjunto cargado, los periodos vuelven a caber en él. Con
  // base local no hace falta: lo que no está cargado se lee de ahí.
  useEffect(() => {
    if (historicoDisponible) return;
    setPeriodos(prev => prev.map(p => ({
      desde: p.desde < primerDia || p.desde > ultimoDia ? primerDia : p.desde,
      hasta: p.hasta > ultimoDia || p.hasta < primerDia ? ultimoDia : p.hasta,
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primerDia, ultimoDia]);

  const activarComparacion = () => {
    if (!comparar && periodos.length === 0) {
      setPeriodos([
        { desde: primerDia, hasta: primerDia },
        { desde: ultimoDia, hasta: ultimoDia },
      ]);
    }
    setComparar(c => !c);
  };
  const cambiarPeriodo = (i: number, campo: keyof Periodo, valor: string) =>
    setPeriodos(prev => prev.map((p, j) => {
      if (j !== i) return p;
      const nuevo = { ...p, [campo]: valor };
      // Un rango al revés se corrige arrastrando el otro extremo.
      if (nuevo.desde > nuevo.hasta) {
        if (campo === 'desde') nuevo.hasta = nuevo.desde; else nuevo.desde = nuevo.hasta;
      }
      return nuevo;
    }));
  const agregarPeriodo = () =>
    setPeriodos(prev => [...prev, { desde: primerDia, hasta: ultimoDia }].slice(0, MAX_PERIODOS));
  const quitarPeriodo = (i: number) => setPeriodos(prev => prev.filter((_, j) => j !== i));
  /** Añade, justo debajo, las mismas fechas un año antes. */
  const anioAnterior = (i: number) =>
    setPeriodos(prev => {
      const p = prev[i];
      const nuevo = { desde: anioAntes(p.desde), hasta: anioAntes(p.hasta) };
      return [...prev.slice(0, i + 1), nuevo, ...prev.slice(i + 1)].slice(0, MAX_PERIODOS);
    });
  const cubierto = (p: Periodo) => p.desde >= primerDia && p.hasta <= ultimoDia;

  // Si el conjunto cargado no trae la estación elegida —se cambió de origen—,
  // se vuelve al promedio de la zona en vez de dibujar una gráfica vacía.
  useEffect(() => {
    if (ambito !== AMG_PROMEDIO && ambito !== AMG_MAXIMO && !estaciones.includes(ambito)) {
      setAmbito(AMG_PROMEDIO);
    }
  }, [estaciones, ambito]);

  /** La serie horaria del ámbito elegido sobre unas filas y su rejilla. */
  const serieDe = useCallback((
    indice: Record<string, Registro[]>, ests: string[], rej: string[], param: string,
  ): (number | null)[] => {
    if (ambito === AMG_PROMEDIO) return agregadoZona(indice, ests, rej, param, 'promedio');
    if (ambito === AMG_MAXIMO) return agregadoZona(indice, ests, rej, param, 'maximo');
    return serieEnRejilla(indice[ambito] || [], rej, param);
  }, [ambito]);

  /** La serie horaria del ámbito elegido, sobre la rejilla completa. */
  const serie = useCallback(
    (param: string) => serieDe(porEstacion, estaciones, rejilla, param),
    [serieDe, porEstacion, estaciones, rejilla],
  );

  // Filas de la base local para los periodos que no están en lo cargado,
  // por «desde|hasta|parámetro». `null` mientras se leen.
  const [externos, setExternos] = useState<Record<string, Registro[] | null>>({});
  const claveExterna = (p: Periodo, param: string) => `${p.desde}|${p.hasta}|${param}`;
  useEffect(() => {
    if (!comparar || !historicoDisponible) return;
    const params = cruce ? [parametro, cruce] : [parametro];
    periodos.filter(p => !cubierto(p)).forEach(p => params.forEach(param => {
      const clave = claveExterna(p, param);
      if (clave in externos) return;
      setExternos(prev => ({ ...prev, [clave]: null }));
      historicoApi.serie(p.desde, diaSiguiente(p.hasta), param)
        .then(filas => setExternos(prev => ({ ...prev, [clave]: filas as Registro[] })))
        .catch(() => setExternos(prev => ({ ...prev, [clave]: [] })));
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparar, historicoDisponible, periodos, parametro, cruce, primerDia, ultimoDia]);

  const perfiles = useMemo(() => ({
    principal: promedioPorHoraDelDia(rejilla, serie(parametro)),
    secundario: cruce && !comparar ? promedioPorHoraDelDia(rejilla, serie(cruce)) : null,
  }), [rejilla, serie, parametro, cruce, comparar]);

  const { principal, secundario } = perfiles;

  /** El perfil de `param` en cada periodo; null mientras se lee de la base. */
  const perfilesPorPeriodo = useCallback((param: string) => {
    const completa = serie(param);
    return periodos.map(p => {
      if (cubierto(p) || !historicoDisponible) {
        return promedioPorHoraDelDia(rejilla, recortar(rejilla, completa, p));
      }
      // Fuera de lo cargado: con las filas leídas de la base local.
      const filas = externos[claveExterna(p, param)];
      if (!filas) return null;
      const indice: Record<string, Registro[]> = {};
      for (const f of filas) (indice[f.STATION] ??= []).push(f);
      const rej = rejillaHoraria(filas);
      return promedioPorHoraDelDia(rej, serieDe(indice, Object.keys(indice).sort(), rej, param));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodos, rejilla, serie, serieDe, externos, historicoDisponible]);

  const comparados = useMemo(
    () => (comparar ? perfilesPorPeriodo(parametro) : []),
    [comparar, perfilesPorPeriodo, parametro],
  );
  // El cruce también se compara: una curva por periodo en el eje derecho.
  const comparadosCruce = useMemo(
    () => (comparar && cruce ? perfilesPorPeriodo(cruce) : []),
    [comparar, cruce, perfilesPorPeriodo],
  );

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
  const hayCruce = comparar
    ? comparadosCruce.some(p => p?.cuentas.some(c => c > 0))
    : !!secundario && secundario.cuentas.some(c => c > 0);

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

    const trazos: any[] = comparar ? comparados.flatMap((perfil, i) => !perfil ? [] : [{
      type: 'scatter',
      mode: 'lines+markers',
      name: etiquetaPeriodo(periodos[i]),
      x: horas,
      y: perfil.promedios,
      connectgaps: false,
      line: { color: COLORES_PERIODO[i % COLORES_PERIODO.length], width: 2.5 },
      marker: { size: 6 },
      customdata: perfil.cuentas,
      hovertemplate:
        `${etiquetaPeriodo(periodos[i])}: %{y:.4g} ${unidad(parametro)}`
        + ' (%{customdata} valores)<extra></extra>',
    }]) : [{
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

    if (comparar && cruce && hayCruce) {
      comparadosCruce.forEach((perfil, i) => {
        if (!perfil) return;
        trazos.push({
          type: 'scatter',
          mode: 'lines+markers',
          name: `${etiquetaPeriodo(periodos[i])} · ${cruce}`,
          x: horas,
          y: perfil.promedios,
          connectgaps: false,
          yaxis: 'y2',
          line: { color: COLORES_PERIODO[i % COLORES_PERIODO.length], width: 2, dash: 'dash' },
          marker: { size: 5, symbol: 'diamond' },
          customdata: perfil.cuentas,
          hovertemplate:
            `${etiquetaPeriodo(periodos[i])} ${cruce}: %{y:.4g} ${unidad(cruce)}`
            + ' (%{customdata} valores)<extra></extra>',
        });
      });
    }

    if (!comparar && secundario && cruce && hayCruce) {
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
        title: { text: 'Hora del día' },
        dtick: 1,
        range: [-0.5, 23.5],
        zeroline: false,
      },
      yaxis: {
        title: { text: `${parametro}${unidad(parametro) ? ` [${unidad(parametro)}]` : ''}` },
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
        title: { text: `${cruce}${unidad(cruce) ? ` [${unidad(cruce)}]` : ''}` },
        overlaying: 'y',
        side: 'right',
        tickmode: 'auto',  // Plotly 4 lo pondría en 'sync' con Y1
        automargin: true,
        zeroline: false,
        showgrid: false,
      };
    }

    Plotly.react(grafica.current, trazos, disposicion, {
      responsive: true, displayModeBar: true,
    });
  }, [horas, principal, secundario, parametro, cruce, hayCruce, nombreAmbito, colorPrincipal, hayDatos,
      comparar, comparados, comparadosCruce, periodos]);

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
          <select
            value={cruce}
            onChange={e => setCruce(e.target.value)}
            className={`${selector} disabled:bg-gray-100 disabled:text-gray-400`}
          >
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

        <button
          onClick={activarComparacion}
          disabled={!primerDia}
          className={`px-3 py-1 rounded-md text-sm font-medium border transition-colors ${
            comparar
              ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
              : 'border-gray-300 text-gray-700 hover:bg-gray-100'
          }`}
        >
          <CalendarRange size={14} className="inline -mt-0.5 mr-1" />
          {comparar ? 'Dejar de comparar' : 'Comparar fechas'}
        </button>
      </div>

      {comparar && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
          <p className="text-xs text-gray-500">
            Una curva por periodo, con el perfil de {parametro} en {nombreAmbito}. Para un
            solo día, pon la misma fecha en los dos extremos.
          </p>
          {periodos.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className="inline-block w-4 h-1 rounded"
                style={{ backgroundColor: COLORES_PERIODO[i % COLORES_PERIODO.length] }}
              />
              <span className="text-gray-600 w-16">Periodo {i + 1}</span>
              <input
                type="date" value={p.desde}
                min={historicoDisponible ? undefined : primerDia} max={historicoDisponible ? undefined : ultimoDia}
                onChange={e => e.target.value && cambiarPeriodo(i, 'desde', e.target.value)}
                className={selector}
              />
              <span className="text-gray-400">a</span>
              <input
                type="date" value={p.hasta}
                min={historicoDisponible ? undefined : primerDia} max={historicoDisponible ? undefined : ultimoDia}
                onChange={e => e.target.value && cambiarPeriodo(i, 'hasta', e.target.value)}
                className={selector}
              />
              {comparar && comparados[i] === null && (
                <Loader2 size={14} className="animate-spin text-gray-400" />
              )}
              {comparados[i] && !comparados[i]!.cuentas.some(c => c > 0) && (
                <span className="text-xs text-amber-700">
                  sin datos en este periodo
                  {!cubierto(p) && !historicoDisponible && ' (fuera de lo cargado)'}
                </span>
              )}
              {periodos.length < MAX_PERIODOS && (
                <button
                  onClick={() => anioAnterior(i)}
                  title="Agrega las mismas fechas del año anterior"
                  className="text-xs text-blue-600 hover:underline"
                >
                  Año anterior
                </button>
              )}
              {periodos.length > 1 && (
                <button
                  onClick={() => quitarPeriodo(i)}
                  className="text-xs text-red-500 hover:underline"
                >
                  Quitar
                </button>
              )}
            </div>
          ))}
          {periodos.length < MAX_PERIODOS && (
            <button onClick={agregarPeriodo} className="text-xs text-blue-600 hover:underline">
              + Agregar periodo
            </button>
          )}
        </div>
      )}

      {/* El aviso va antes de la gráfica y no dentro: quien elige un cruce y no
          ve la segunda curva necesita saber por qué ANTES de concluir que la
          pantalla está rota. */}
      {cruce && !comparar && !hayCruce && hayDatos && (
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
