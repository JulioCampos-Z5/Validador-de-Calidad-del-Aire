import { useEffect, useState } from 'react';
import { Settings, RefreshCw, HelpCircle } from 'lucide-react';
import apiService, { ConfigResponse } from '../services/api';

// Información de cada parámetro
const PARAM_INFO: Record<string, string> = {
  'O3': 'Ozono - Gas contaminante secundario formado por reacciones fotoquímicas',
  'NO': 'Óxido Nítrico - Gas emitido principalmente por vehículos y combustión',
  'NO2': 'Dióxido de Nitrógeno - Contaminante que afecta el sistema respiratorio',
  'NOX': 'Óxidos de Nitrógeno - Suma de NO + NO2',
  'SO2': 'Dióxido de Azufre - Gas producido por combustión de combustibles con azufre',
  'CO': 'Monóxido de Carbono - Gas tóxico producto de combustión incompleta',
  'PM10': 'Material Particulado <10μm - Partículas inhalables gruesas',
  'PM2.5': 'Material Particulado <2.5μm - Partículas finas que penetran pulmones',
  'IT': 'Temperatura Interna - Temperatura dentro del equipo de monitoreo (°C)',
  'ET': 'Temperatura Externa - Temperatura ambiente exterior (°C)',
  'RH': 'Humedad Relativa - Porcentaje de humedad en el aire (%)',
  'WS': 'Velocidad del Viento - Rapidez del viento (m/s)',
  'WD': 'Dirección del Viento - Dirección de donde viene el viento (grados)',
  'PP': 'Precipitación - Cantidad de lluvia (mm)',
  'ATM': 'Presión Atmosférica - Presión barométrica (mmHg)',
  'RS': 'Radiación Solar - Intensidad de radiación solar (W/m²)',
  'UVI': 'Índice UV - Índice de radiación ultravioleta',
};

export default function Config() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'rangos' | 'estaciones' | 'banderas'>('rangos');

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const response = await apiService.getConfig();
      setConfig(response);
    } catch (error) {
      console.error('Error loading config:', error);
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: 'rangos', label: 'Rangos de Validación' },
    { id: 'estaciones', label: 'Estaciones' },
    { id: 'banderas', label: 'Banderas' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Parámetros</h1>
          <p className="text-slate-500 mt-1">
            Parámetros y configuración del sistema de validación
          </p>
        </div>
        <button
          onClick={loadConfig}
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="border-b border-slate-200">
          <nav className="flex -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center py-8">
              <RefreshCw className="h-8 w-8 text-slate-300 animate-spin mx-auto mb-3" />
              <p className="text-slate-500">Cargando configuración...</p>
            </div>
          ) : config ? (
            <>
              {/* Rangos Tab */}
              {activeTab === 'rangos' && (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                          Parámetro
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                          Mínimo
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                          Máximo
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                          Límite Detección
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">
                          Decimales
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                      {Object.entries(config.rangos).map(([param, values]) => (
                        <tr key={param} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-800">
                            <div className="flex items-center gap-2">
                              {param}
                              {PARAM_INFO[param] && (
                                <div className="relative group">
                                  <HelpCircle className="h-4 w-4 text-slate-400 cursor-help" />
                                  <div className="absolute left-6 top-0 z-10 hidden group-hover:block w-64 p-2 bg-slate-800 text-white text-xs rounded-lg shadow-lg">
                                    {PARAM_INFO[param]}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {values.min}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {values.max}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {values.limite_deteccion ?? '-'}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {config.decimales[param] ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Estaciones Tab */}
              {activeTab === 'estaciones' && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {Object.entries(config.estaciones).map(([nombre, abrev]) => (
                    <div
                      key={abrev}
                      className="p-4 bg-slate-50 rounded-lg border border-slate-200"
                    >
                      <p className="font-medium text-slate-800">{nombre}</p>
                      <p className="text-sm text-slate-500 mt-1">
                        Código: <span className="font-mono text-primary-600">{abrev}</span>
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Banderas Tab */}
              {activeTab === 'banderas' && (
                <div className="space-y-3">
                  {Object.entries(config.banderas).map(([code, description]) => (
                    <div
                      key={code}
                      className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200"
                    >
                      <span className={`px-3 py-1 rounded-lg font-bold text-sm ${
                        code === 'IR' || code === 'IF' ? 'bg-red-100 text-red-700' :
                        code === 'IO' ? 'bg-orange-100 text-orange-700' :
                        code === 'IC' ? 'bg-yellow-100 text-yellow-700' :
                        code === 'ND' ? 'bg-slate-200 text-slate-600' :
                        code === 'DS' ? 'bg-purple-100 text-purple-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {code}
                      </span>
                      <span className="text-slate-700">{description}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8">
              <Settings className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">No se pudo cargar la configuración</p>
              <button
                onClick={loadConfig}
                className="mt-3 text-primary-600 hover:text-primary-700"
              >
                Reintentar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-sm text-blue-700">
          <strong>Nota:</strong> La configuración se carga desde el backend. 
          Para modificar los rangos de validación, edita el archivo <code className="bg-blue-100 px-1 rounded">app.py</code>.
        </p>
      </div>
    </div>
  );
}
