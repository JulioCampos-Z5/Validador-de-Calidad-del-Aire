import { useState } from 'react';
import { Download, FileCheck } from 'lucide-react';
import FileUpload from '../components/FileUpload';
import DataTable from '../components/DataTable';
import apiService, { ValidationResponse } from '../services/api';

export default function Upload() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResponse | null>(null);

  const handleFileUpload = async (file: File) => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    setValidationResult(null);

    try {
      // 1. Subir archivo
      const uploadResponse = await apiService.uploadFile(file);
      
      // 2. Validar datos (siempre validación completa)
      const validationResponse = await apiService.validateFull(uploadResponse.filename);

      setValidationResult(validationResponse);
      setSuccess(`Archivo procesado exitosamente. ${validationResponse.summary.total_registros.toLocaleString()} registros validados.`);

    } catch (err: any) {
      setError(err.response?.data?.error || 'Error al procesar el archivo');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = () => {
    if (validationResult?.output_filename) {
      window.open(apiService.downloadFile(validationResult.output_filename), '_blank');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Subir Archivo</h1>
        <p className="text-slate-500 mt-1">
          Carga un archivo ENVISTA (.xlsx) para validar los datos de calidad del aire
        </p>
      </div>

      {/* Upload Section */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <FileUpload
          onFileUpload={handleFileUpload}
          isLoading={isLoading}
          error={error}
          success={success}
        />
      </div>

      {/* Results Section */}
      {validationResult && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <FileCheck className="h-6 w-6 text-green-600" />
                <h2 className="text-lg font-semibold text-slate-800">
                  Resultados de Validación
                </h2>
              </div>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
              >
                <Download className="h-4 w-4" />
                Descargar Excel
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-500">Total Registros</p>
                <p className="text-2xl font-bold text-slate-800">
                  {validationResult.summary.total_registros.toLocaleString()}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-500">Estaciones</p>
                <p className="text-2xl font-bold text-slate-800">
                  {validationResult.summary.estaciones}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-500">Fecha Inicio</p>
                <p className="text-lg font-bold text-slate-800">
                  {validationResult.summary.fecha_inicio}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-500">Fecha Fin</p>
                <p className="text-lg font-bold text-slate-800">
                  {validationResult.summary.fecha_fin}
                </p>
              </div>
            </div>

            {/* Banderas */}
            {Object.keys(validationResult.summary.banderas).length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-slate-700 mb-3">Banderas Aplicadas</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(validationResult.summary.banderas).map(([key, value]: [string, any]) => (
                    <span
                      key={key}
                      className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm"
                    >
                      {key}: {typeof value === 'object' ? value.Cantidad?.toLocaleString() : value}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Data Preview */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800">
                Vista Previa de Datos
              </h2>
              <p className="text-sm text-slate-500">
                Mostrando {validationResult.data_preview.length.toLocaleString()} registros (paginados de 50 en 50)
              </p>
            </div>
            <DataTable data={validationResult.data_preview} />
          </div>

          {/* Estadísticas Detalladas */}
          {validationResult.estadisticas_detalladas && validationResult.estadisticas_detalladas.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-200">
                <h2 className="text-lg font-semibold text-slate-800">
                  📊 Estadísticas Detalladas
                </h2>
                <p className="text-sm text-slate-500">
                  Estadísticas por estación y parámetro
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Estación</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Parámetro</th>
                      <th className="px-4 py-3 text-right font-semibold text-slate-700">Total Registros</th>
                      <th className="px-4 py-3 text-right font-semibold text-slate-700">Valores Válidos</th>
                      <th className="px-4 py-3 text-right font-semibold text-slate-700">Mínimo</th>
                      <th className="px-4 py-3 text-right font-semibold text-slate-700">Máximo</th>
                      <th className="px-4 py-3 text-right font-semibold text-slate-700">Promedio</th>
                      <th className="px-4 py-3 text-right font-semibold text-slate-700">Desv. Estándar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {validationResult.estadisticas_detalladas.map((stat: any, index: number) => (
                      <tr key={index} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-medium text-slate-800">{stat['Estación']}</td>
                        <td className="px-4 py-2 text-slate-600">{stat['Contaminante']}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{stat['Total de registros']?.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{stat['Valores válidos']?.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{typeof stat['Mínimo'] === 'number' ? stat['Mínimo'].toFixed(4) : stat['Mínimo']}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{typeof stat['Máximo'] === 'number' ? stat['Máximo'].toFixed(4) : stat['Máximo']}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{typeof stat['Promedio'] === 'number' ? stat['Promedio'].toFixed(4) : stat['Promedio']}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{typeof stat['Desviación estándar'] === 'number' ? stat['Desviación estándar'].toFixed(4) : stat['Desviación estándar']}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
