import { useState } from 'react';
import { BarChart3, Upload, AlertCircle } from 'lucide-react';
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

const Charts = () => {
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0];
    setLoading(true);
    setError(null);

    try {
      // Subir archivo
      const uploadResult = await apiService.uploadFile(file);
      setFilename(uploadResult.filename);

      // Validar y obtener datos
      const validationResult = await apiService.validateFull(uploadResult.filename);
      
      if (validationResult.success && validationResult.data_preview) {
        setData(validationResult.data_preview as DataPoint[]);
      } else {
        setError('No se pudieron obtener los datos validados');
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
    },
    multiple: false,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="w-8 h-8 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gráficas</h1>
          <p className="text-gray-600">Visualización de datos por estación</p>
        </div>
      </div>

      {/* Upload area si no hay datos */}
      {data.length === 0 && (
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
              <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
              <p className="text-gray-600">Procesando archivo...</p>
            </div>
          ) : (
            <>
              <p className="text-lg text-gray-600 mb-2">
                {isDragActive
                  ? 'Suelta el archivo aquí...'
                  : 'Arrastra un archivo ENVISTA o haz clic para seleccionar'}
              </p>
              <p className="text-sm text-gray-500">
                Soporta archivos .xlsx
              </p>
            </>
          )}
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
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-blue-700">
              <strong>Archivo cargado:</strong> {filename} ({data.length} registros)
            </p>
            <button
              onClick={() => {
                setData([]);
                setFilename(null);
              }}
              className="mt-2 text-sm text-blue-600 hover:text-blue-800 underline"
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
