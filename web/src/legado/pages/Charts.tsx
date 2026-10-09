import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import {
  BarChart3, AlertCircle, Activity, Clock, BoxSelect, CalendarDays, Grid3x3, Wind,
} from 'lucide-react';
import { useDatos } from '../estado/DatosContexto';
import type { Cliente } from '../../compartido/api';
import { cargarAmbientWeather, EQUIVALENCIAS, type FilaRed } from '../services/ambientweather';

// Cada vista se descarga al abrir su pestaña. Plotly (y Recharts en
// Distribución) pesan casi todo el módulo; sin datos cargados no se usa
// ninguna, y con datos solo la pestaña que se mira.
const LineCharts = lazy(() => import('../components/LineCharts'));
const PerfilHorario = lazy(() => import('../components/PerfilHorario'));
const StatCharts = lazy(() => import('../components/StatCharts'));
const CalendarHeatmaps = lazy(() => import('../components/CalendarHeatmaps'));
const CategoriasPorHora = lazy(() => import('../components/CategoriasPorHora'));
const DiaPorHora = lazy(() => import('../components/DiaPorHora'));
const VientoFlechas = lazy(() => import('../components/VientoFlechas'));

interface DataPoint {
  STATION: string;
  DATE: string;
  HOUR: number;
  [key: string]: string | number | null;
}

/** Como describir la procedencia de lo que hay cargado. */
const ORIGENES: Record<string, string> = {
  envista: 'archivo ENVISTA procesado',
  validado: 'archivo ya validado',
  simaj: 'descarga del SIMAJ',
  emisiones: 'API de Emisiones',
  historico: 'base local',
};

/**
 * Las vistas de la página, en pestañas. Las dos últimas —categorías por hora
 * y día × hora— siguen el método NOM-172 del Observatorio de Calidad del Aire
 * (ver `graficas/nom172.ts`).
 *
 * Antes iban una debajo de otra: cuatro gráficas de Plotly con sus controles,
 * unas cuatro pantallas de alto. Para comparar el calendario con la serie
 * había que recordar lo que se acababa de ver mientras se llegaba a la otra, y
 * además el navegador dibujaba las cuatro aunque solo se estuviera mirando
 * una.
 *
 * Con pestañas se monta solo la que se mira. La que se deja no guarda su
 * estado —los parámetros elegidos vuelven a los de partida al volver—, que es
 * el precio de no tener cuatro Plotly vivos a la vez; los datos, que es lo
 * caro, siguen en el contexto y no se vuelven a pedir.
 */
const PESTANAS = [
  {
    id: 'series' as const,
    etiqueta: 'Series',
    icono: Activity,
    detalle: 'La serie completa, hora a hora, por estación',
  },
  {
    id: 'horario' as const,
    etiqueta: 'Comportamiento horario',
    icono: Clock,
    detalle: 'El promedio de cada hora del día en el periodo',
  },
  {
    id: 'distribucion' as const,
    etiqueta: 'Distribución',
    icono: BoxSelect,
    detalle: 'Violín y desviación estándar por estación',
  },
  {
    id: 'calendario' as const,
    etiqueta: 'Calendario',
    icono: CalendarDays,
    detalle: 'Cada hora del mes coloreada por su índice de calidad',
  },
  {
    id: 'categorias' as const,
    etiqueta: 'Categorías',
    icono: BarChart3,
    detalle: 'Días en cada categoría NOM-172 según la hora del día',
  },
  {
    id: 'diahora' as const,
    etiqueta: 'Día × hora',
    icono: Grid3x3,
    detalle: 'Cada día, su categoría diaria y sus 24 horas',
  },
  {
    id: 'viento' as const,
    etiqueta: 'Viento',
    icono: Wind,
    detalle: 'Velocidad y dirección del viento con flechas, por estación',
  },
];

type Pestana = typeof PESTANAS[number]['id'];

/**
 * De dónde salen las filas. Ambient Weather no pasa por Validación: se lee de
 * la API de Go y se convierte al formato de la red (services/ambientweather).
 */
type Fuente = 'red' | 'ambientweather';

// Categorías y Día × hora piden el índice al backend, que lo calcula sobre el
// conjunto validado de la red: con Ambient Weather no tendrían que ver con lo
// que se grafica.
const SOLO_RED: Pestana[] = ['categorias', 'diahora'];

// Mismo tope que el modulo Ambient Weather: un tramo mas largo pesa en el
// navegador sin aportar a estas vistas.
const MAX_DIAS_AW = 90;

const isoHoy = (dias = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const claseBoton = (activo: boolean) =>
  `inline-flex items-center gap-2 px-3.5 py-1.5 rounded-[10px] text-[13px] font-medium border bg-white transition-colors ${
    activo ? 'border-slate-800 text-slate-900' : 'border-slate-300 text-slate-600 hover:border-slate-500'
  }`;

const Charts = ({ api }: { api?: Cliente }) => {
  // Los datos salen del contexto, no de una carga propia: asi venir del tablero
  // no obliga a volver a subir el archivo ni a repetir la descarga del SIMAJ.
  const {
    resultado, cargando: loading, error, descripcion: filename, origen, limpiar,
  } = useDatos();

  const datosRed = useMemo<DataPoint[]>(
    () => (resultado?.data_preview as DataPoint[] | undefined) ?? [],
    [resultado],
  );

  const [fuente, setFuente] = useState<Fuente>('red');
  const [awDesde, setAwDesde] = useState(() => isoHoy(6));
  const [awHasta, setAwHasta] = useState(() => isoHoy(0));
  const [datosAw, setDatosAw] = useState<FilaRed[] | null>(null);
  const [awCargando, setAwCargando] = useState(false);
  const [awError, setAwError] = useState<string | null>(null);

  const awDias = Math.round((new Date(awHasta).getTime() - new Date(awDesde).getTime()) / 86_400_000) + 1;
  const awInvalido = !awDesde || !awHasta || !(awDias >= 1) ? 'Elige un periodo válido.'
    : awDias > MAX_DIAS_AW ? `El periodo pasa de ${MAX_DIAS_AW} días.` : null;

  const cargarAw = async () => {
    if (!api || awInvalido) return;
    setAwCargando(true);
    setAwError(null);
    try {
      setDatosAw(await cargarAmbientWeather(api, awDesde, awHasta));
    } catch (e) {
      setAwError((e as Error).message || 'No se pudieron leer las estaciones de Ambient Weather.');
    } finally {
      setAwCargando(false);
    }
  };

  const esAw = fuente === 'ambientweather';
  const data = esAw ? (datosAw as DataPoint[] | null) ?? [] : datosRed;
  const pestanas = esAw ? PESTANAS.filter(p => !SOLO_RED.includes(p.id)) : PESTANAS;

  // Descarta el conjunto compartido; el menu lateral queda listo para
  // elegir otro origen.
  const resetData = limpiar;

  const [pestanaElegida, setPestana] = useState<Pestana>('series');
  const pestana = pestanas.some(p => p.id === pestanaElegida) ? pestanaElegida : 'series';
  const botones = useRef<Record<string, HTMLButtonElement | null>>({});

  /**
   * Flechas para moverse entre pestañas, como manda el patrón de tablist.
   * Sin esto hay que tabular por las cuatro para llegar a la última, y quien
   * navega con teclado se come todos los controles de la gráfica activa por el
   * camino.
   */
  const alPulsarTecla = (e: React.KeyboardEvent) => {
    const paso = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!paso) return;
    e.preventDefault();
    const i = pestanas.findIndex(p => p.id === pestana);
    const siguiente = pestanas[(i + paso + pestanas.length) % pestanas.length];
    setPestana(siguiente.id);
    botones.current[siguiente.id]?.focus();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="hidden" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gráficas</h1>
          <p className="text-gray-600">Visualización interactiva de datos por estación y parámetro</p>
        </div>
      </div>

      {/* Fuente: la red (lo cargado en Validación) o Ambient Weather. Sin la
          API de Go (p. ej. la app de escritorio) solo hay red. */}
      {api && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Fuente de datos">
          <span className="text-sm text-slate-500 mr-1">Fuente</span>
          <button type="button" aria-pressed={!esAw} onClick={() => setFuente('red')} className={claseBoton(!esAw)}>
            Red de monitoreo
          </button>
          <button type="button" aria-pressed={esAw} onClick={() => setFuente('ambientweather')} className={claseBoton(esAw)}>
            Ambient Weather
          </button>
        </div>
      )}

      {esAw && (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-600">
              <span className="block text-xs text-slate-500 mb-1">Desde</span>
              <input type="date" value={awDesde} max={awHasta} onChange={e => setAwDesde(e.target.value)}
                className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm bg-white" />
            </label>
            <label className="text-sm text-slate-600">
              <span className="block text-xs text-slate-500 mb-1">Hasta</span>
              <input type="date" value={awHasta} min={awDesde} max={isoHoy(0)} onChange={e => setAwHasta(e.target.value)}
                className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm bg-white" />
            </label>
            <button type="button" onClick={cargarAw} disabled={awCargando || !!awInvalido}
              className="px-3.5 py-1.5 rounded-[10px] text-[13px] font-medium border border-slate-800 bg-slate-800 text-white disabled:opacity-50">
              {awCargando ? 'Cargando…' : datosAw ? 'Volver a cargar' : 'Cargar'}
            </button>
            {awInvalido && <span className="text-sm text-amber-700">{awInvalido}</span>}
          </div>
          <p className="text-xs text-slate-500">
            Todas las estaciones de Ambient Weather, en promedios horarios y convertidas a las unidades de la red:{' '}
            {EQUIVALENCIAS.map(e => e.red).join(', ')}. Categorías y Día × hora solo aplican a la red validada.
          </p>
          {awError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-red-700 text-sm">{awError}</p>
            </div>
          )}
          {datosAw && datosAw.length === 0 && !awCargando && (
            <p className="text-sm text-slate-600">Ninguna estación tiene lecturas en ese periodo.</p>
          )}
        </div>
      )}

      {/* Sin datos no hay area de carga aqui: el origen se elige una sola vez
          en el menu lateral y lo comparten todas las paginas. Duplicar el
          selector invitaba a cargar dos veces lo mismo. */}
      {!esAw && data.length === 0 && !loading && (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
          <BarChart3 className="w-10 h-10 mx-auto text-slate-300 mb-3" />
          <p className="text-slate-600">No hay datos cargados.</p>
          <p className="text-sm text-slate-500 mt-1">
            Elige un origen —archivo, SIMAJ o API de Emisiones— en el módulo Validación.
          </p>
        </div>
      )}

      {/* Error */}
      {!esAw && error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Gráficas */}
      {data.length > 0 && (
        <>
          {!esAw && <div className="bg-slate-50 rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-slate-700">
              <strong>Datos cargados:</strong> {filename}
              {/* El rotulo sale del origen real y no de un selector propio de
                  esta pagina: los datos pueden venir de cuatro sitios. */}
              <span className="ml-2 text-sm">
                ({data.length.toLocaleString()} registros · {ORIGENES[origen ?? 'envista']})
              </span>
            </p>
            <button
              onClick={resetData}
              className="text-sm text-slate-500 hover:text-slate-800 underline ml-4"
            >
              Descartar
            </button>
          </div>}

          {/* Pestañas. `role=tablist` y las flechas del teclado no son adorno:
              cuatro botones sueltos obligan a tabular por todos para llegar al
              último. */}
          <div
            role="tablist"
            aria-label="Vistas de las gráficas"
            onKeyDown={alPulsarTecla}
            className="flex flex-wrap gap-1.5"
          >
            {pestanas.map(({ id, etiqueta, icono: Icono, detalle }) => {
              const activa = pestana === id;
              return (
                <button
                  key={id}
                  ref={el => { botones.current[id] = el; }}
                  role="tab"
                  type="button"
                  aria-selected={activa}
                  // Solo la activa entra en el orden de tabulación; a las
                  // demás se llega con las flechas.
                  tabIndex={activa ? 0 : -1}
                  title={detalle}
                  onClick={() => setPestana(id)}
                  // Mismo boton que el resto de v2: borde gris, y el elegido
                  // con borde y texto oscuros.
                  className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-[10px] text-[13px] font-medium border bg-white transition-colors ${
                    activa
                      ? 'border-slate-800 text-slate-900'
                      : 'border-slate-300 text-slate-600 hover:border-slate-500'
                  }`}
                >
                  <Icono size={15} className={`shrink-0 ${activa ? 'text-slate-800' : 'text-slate-400'}`} />
                  {etiqueta}
                </button>
              );
            })}
          </div>

          {/* key: al cambiar de fuente cada vista arranca de cero (estaciones,
              parametro elegido), como al cambiar de pestaña. */}
          <Suspense key={fuente} fallback={<p className="text-sm text-slate-500 py-8 text-center">Cargando gráfica…</p>}>
            {pestana === 'series' && <LineCharts data={data} />}
            {pestana === 'horario' && <PerfilHorario data={data} />}
            {pestana === 'distribucion' && <StatCharts data={data} />}
            {pestana === 'calendario' && <CalendarHeatmaps data={data} />}
            {pestana === 'categorias' && <CategoriasPorHora data={data} />}
            {pestana === 'diahora' && <DiaPorHora data={data} />}
            {pestana === 'viento' && <VientoFlechas data={data} />}
          </Suspense>
        </>
      )}
    </div>
  );
};

export default Charts;
