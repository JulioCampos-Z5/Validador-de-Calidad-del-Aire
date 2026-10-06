import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import {
  BarChart3, AlertCircle, Activity, Clock, BoxSelect, CalendarDays, Grid3x3, Wind,
} from 'lucide-react';
import { useDatos } from '../estado/DatosContexto';

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

const Charts = () => {
  // Los datos salen del contexto, no de una carga propia: asi venir del tablero
  // no obliga a volver a subir el archivo ni a repetir la descarga del SIMAJ.
  const {
    resultado, cargando: loading, error, descripcion: filename, origen, limpiar,
  } = useDatos();

  const data = useMemo<DataPoint[]>(
    () => (resultado?.data_preview as DataPoint[] | undefined) ?? [],
    [resultado],
  );

  // Descarta el conjunto compartido; el menu lateral queda listo para
  // elegir otro origen.
  const resetData = limpiar;

  const [pestana, setPestana] = useState<Pestana>('series');
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
    const i = PESTANAS.findIndex(p => p.id === pestana);
    const siguiente = PESTANAS[(i + paso + PESTANAS.length) % PESTANAS.length];
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

      {/* Sin datos no hay area de carga aqui: el origen se elige una sola vez
          en el menu lateral y lo comparten todas las paginas. Duplicar el
          selector invitaba a cargar dos veces lo mismo. */}
      {data.length === 0 && !loading && (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
          <BarChart3 className="w-10 h-10 mx-auto text-slate-300 mb-3" />
          <p className="text-slate-600">No hay datos cargados.</p>
          <p className="text-sm text-slate-500 mt-1">
            Elige un origen —archivo, SIMAJ o API de Emisiones— en el módulo Validación.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Gráficas */}
      {data.length > 0 && (
        <>
          <div className="bg-slate-50 rounded-xl px-4 py-3 flex items-center justify-between">
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
          </div>

          {/* Pestañas. `role=tablist` y las flechas del teclado no son adorno:
              cuatro botones sueltos obligan a tabular por todos para llegar al
              último. */}
          <div
            role="tablist"
            aria-label="Vistas de las gráficas"
            onKeyDown={alPulsarTecla}
            className="flex flex-wrap gap-1.5"
          >
            {PESTANAS.map(({ id, etiqueta, icono: Icono, detalle }) => {
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

          <Suspense fallback={<p className="text-sm text-slate-500 py-8 text-center">Cargando gráfica…</p>}>
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
