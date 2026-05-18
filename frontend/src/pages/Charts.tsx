import { useState } from 'react';
import { BarChart3, Upload, AlertCircle, FileInput } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import apiService from '../services/api';
import LineCharts from '../components/LineCharts';
import StatCharts from '../components/StatCharts';

interface DataPoint {
  STATION: string;
  DATE: string;
  HOUR: number;
  [key: string]: string | number | null;
}

type FileMode = 'envista' | 'validado';

const Charts = () => {
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [fileMode, setFileMode] = useState<FileMode>('envista');

  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0];
    setLoading(true);
    setError(null);

    try {
      const uploadResult = await apiService.uploadFile(file);
      setFilename(uploadResult.filename);

      let result;
      if (fileMode === 'validado') {
        // Leer la hoja "Datos_Validados" sin aplicar validaciones
        result = await apiService.previewValidated(uploadResult.filename);
      } else {
        // Archivo ENVISTA: procesar y validar
        result = await apiService.validateFull(uploadResult.filename);
      }

      if (result.success && result.data_preview) {
        setData(result.data_preview as DataPoint[]);
      } else {
        setError('No se pudieron obtener los datos del archivo');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error al procesar el archivo');
    } finally {
      setLoading(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
    },
    multiple: false,
  });

  const resetData = () => { setData([]); setFilename(null); setError(null); };

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

      {/* Upload area */}
      {data.length === 0 && (
        <div className="space-y-3">
          {/* Selector de tipo de archivo */}
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
            <p className="text-sm font-semibold text-gray-700 mb-3">Tipo de archivo a cargar:</p>
            <div className="flex gap-3">
              <label className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-colors ${
                fileMode === 'envista'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}>
                <input
                  type="radio"
                  name="fileMode"
                  value="envista"
                  checked={fileMode === 'envista'}
                  onChange={() => setFileMode('envista')}
                  className="accent-blue-600"
                />
                <Upload className="w-4 h-4" />
                <div>
                  <p className="font-medium text-sm">Archivo ENVISTA</p>
                  <p className="text-xs opacity-75">Se validarán los datos al cargar</p>
                </div>
              </label>

              <label className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-colors ${
                fileMode === 'validado'
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}>
                <input
                  type="radio"
                  name="fileMode"
                  value="validado"
                  checked={fileMode === 'validado'}
                  onChange={() => setFileMode('validado')}
                  className="accent-green-600"
                />
                <FileInput className="w-4 h-4" />
                <div>
                  <p className="font-medium text-sm">Archivo Ya Validado</p>
                  <p className="text-xs opacity-75">Excel con hoja "Datos_Validados"</p>
                </div>
              </label>
            </div>
          </div>

          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
              isDragActive
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
            }`}
          >
            <input {...getInputProps()} />
            <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
            {loading ? (
              <div className="space-y-2">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto" />
                <p className="text-gray-600">
                  {fileMode === 'envista' ? 'Procesando y validando archivo...' : 'Leyendo archivo validado...'}
                </p>
              </div>
            ) : (
              <>
                <p className="text-lg text-gray-600 mb-2">
                  {isDragActive
                    ? 'Suelta el archivo aquí...'
                    : fileMode === 'envista'
                      ? 'Arrastra un archivo ENVISTA (.xlsx o .csv) o haz clic para seleccionar'
                      : 'Arrastra el Excel/CSV validado o haz clic para seleccionar'}
                </p>
                <p className="text-sm text-gray-500">Soporta archivos .xlsx, .xls y .csv</p>
              </>
            )}
          </div>
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
              <strong>Archivo cargado:</strong> {filename}
              <span className="ml-2 text-sm">({data.length.toLocaleString()} registros · {fileMode === 'validado' ? 'datos validados' : 'datos ENVISTA procesados'})</span>
            </p>
            <button
              onClick={resetData}
              className="text-sm text-blue-600 hover:text-blue-800 underline ml-4"
            >
              Cargar otro archivo
            </button>
          </div>

          <LineCharts data={data} />
          <StatCharts data={data} />
        </>
      )}
    </div>
  );
};

export default Charts;
