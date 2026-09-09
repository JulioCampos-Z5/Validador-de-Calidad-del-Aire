import { useMemo } from 'react';
import { BarChart3, AlertCircle } from 'lucide-react';
import LineCharts from '../components/LineCharts';
import PerfilHorario from '../components/PerfilHorario';
import StatCharts from '../components/StatCharts';
import CalendarHeatmaps from '../components/CalendarHeatmaps';
import { useDatos } from '../estado/DatosContexto';

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
};

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="w-8 h-8 text-blue-600" />
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
            Elige un origen —archivo, SIMAJ o API de Emisiones— en el menú de la izquierda.
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
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
            <p className="text-blue-700">
              <strong>Datos cargados:</strong> {filename}
              {/* El rotulo sale del origen real y no de un selector propio de
                  esta pagina: los datos pueden venir de cuatro sitios. */}
              <span className="ml-2 text-sm">
                ({data.length.toLocaleString()} registros · {ORIGENES[origen ?? 'envista']})
              </span>
            </p>
            <button
              onClick={resetData}
              className="text-sm text-blue-600 hover:text-blue-800 underline ml-4"
            >
              Descartar
            </button>
          </div>

          <LineCharts data={data} />
          <PerfilHorario data={data} />
          <StatCharts data={data} />
          <CalendarHeatmaps data={data} />
        </>
      )}
    </div>
  );
};

export default Charts;
