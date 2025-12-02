import { useState } from 'react';
import { FileSearch, Download, Trash2, Eye } from 'lucide-react';
import DataTable from '../components/DataTable';

interface ProcessedFile {
  filename: string;
  date: string;
  records: number;
  status: 'completed' | 'error';
}

export default function Results() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<any[] | null>(null);

  // Simulated processed files - in production this would come from API
  const [files] = useState<ProcessedFile[]>([
    {
      filename: 'validado_20241130_.xlsx',
      date: '2024-11-30 22:01:43',
      records: 9360,
      status: 'completed'
    }
  ]);

  const handlePreview = (filename: string) => {
    setSelectedFile(filename);
    // In production, fetch preview data from API
    setPreviewData([
      { STATION: 'CEN', DATE: '2024-01-11 01:00', HOUR: 1, O3: 0.025, NO: 0.012, NO2: 0.015 },
      { STATION: 'CEN', DATE: '2024-01-11 02:00', HOUR: 2, O3: 0.023, NO: 0.010, NO2: 0.014 },
      { STATION: 'ATM', DATE: '2024-01-11 01:00', HOUR: 1, O3: 0.028, NO: 'IO', NO2: 0.018 },
    ]);
  };

  const handleDownload = (filename: string) => {
    window.open(`/api/download/${filename}`, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Resultados</h1>
        <p className="text-slate-500 mt-1">
          Archivos procesados y disponibles para descarga
        </p>
      </div>

      {/* Files List */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="p-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">
            Archivos Procesados
          </h2>
        </div>

        {files.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {files.map((file) => (
              <div
                key={file.filename}
                className="p-4 flex items-center justify-between hover:bg-slate-50"
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <FileSearch className="h-6 w-6 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-800">{file.filename}</p>
                    <p className="text-sm text-slate-500">
                      {file.date} • {file.records.toLocaleString()} registros
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    file.status === 'completed' 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-red-100 text-red-700'
                  }`}>
                    {file.status === 'completed' ? 'Completado' : 'Error'}
                  </span>
                  <button
                    onClick={() => handlePreview(file.filename)}
                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                    title="Vista previa"
                  >
                    <Eye className="h-5 w-5 text-slate-500" />
                  </button>
                  <button
                    onClick={() => handleDownload(file.filename)}
                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                    title="Descargar"
                  >
                    <Download className="h-5 w-5 text-slate-500" />
                  </button>
                  <button
                    className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                    title="Eliminar"
                  >
                    <Trash2 className="h-5 w-5 text-red-500" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <FileSearch className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No hay archivos procesados</p>
            <p className="text-sm text-slate-400 mt-1">
              Sube un archivo ENVISTA para comenzar
            </p>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {selectedFile && previewData && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">
                Vista Previa: {selectedFile}
              </h2>
              <p className="text-sm text-slate-500">
                Mostrando una muestra de los datos
              </p>
            </div>
            <button
              onClick={() => {
                setSelectedFile(null);
                setPreviewData(null);
              }}
              className="px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cerrar
            </button>
          </div>
          <DataTable data={previewData} />
        </div>
      )}

      {/* Statistics Summary */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">
          Resumen de Procesamiento
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 bg-blue-50 rounded-lg text-center">
            <p className="text-3xl font-bold text-blue-700">{files.length}</p>
            <p className="text-sm text-blue-600">Archivos Procesados</p>
          </div>
          <div className="p-4 bg-green-50 rounded-lg text-center">
            <p className="text-3xl font-bold text-green-700">
              {files.reduce((acc, f) => acc + f.records, 0).toLocaleString()}
            </p>
            <p className="text-sm text-green-600">Registros Totales</p>
          </div>
          <div className="p-4 bg-purple-50 rounded-lg text-center">
            <p className="text-3xl font-bold text-purple-700">13</p>
            <p className="text-sm text-purple-600">Estaciones</p>
          </div>
          <div className="p-4 bg-orange-50 rounded-lg text-center">
            <p className="text-3xl font-bold text-orange-700">17</p>
            <p className="text-sm text-orange-600">Parámetros</p>
          </div>
        </div>
      </div>
    </div>
  );
}
