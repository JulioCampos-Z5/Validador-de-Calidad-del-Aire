import { useEffect, useState } from 'react';
import {
  Activity,
  Database,
  MapPin,
  FileCheck,
  AlertTriangle,
  CheckCircle,
  Clock,
  Edit2,
  ChevronDown,
  ChevronUp,
  Download,
} from 'lucide-react';
import StatCard from '../components/StatCard';
import FileUpload from '../components/FileUpload';
import DataTable from '../components/DataTable';
import apiService, { HealthResponse, ValidationResponse } from '../services/api';

// Rangos por defecto (deben coincidir con el backend)
const DEFAULT_RANGOS: Record<string, { min: number; max: number }> = {
  O3:    { min: -0.003, max: 0.500 },
  SO2:   { min: -0.003, max: 0.500 },
  NO2:   { min: -0.003, max: 0.500 },
  NO:    { min: -0.003, max: 0.500 },
  NOX:   { min: -0.006, max: 0.500 },
  CO:    { min: -0.04,  max: 50    },
  PM10:  { min: 0,      max: 1000  },
  'PM2.5': { min: 0,    max: 1000  },
  ET:    { min: -5,     max: 50    },
  IT:    { min: 0,      max: 50    },
  RH:    { min: 0,      max: 100   },
  WS:    { min: 0,      max: 50    },
  WD:    { min: 0,      max: 360   },
  PP:    { min: 0,      max: 10    },
  ATM:   { min: 500,    max: 760   },
  RS:    { min: 0,      max: 2000  },
  UVI:   { min: 0,      max: 300   },
};

interface ValidationConfig {
  rangos: boolean;
  temperatura: boolean;
  series: boolean;
  rangos_custom: Record<string, { min: number; max: number }>;
  temp_min: number;
  temp_max: number;
}

export default function Dashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(true);

  // Config de validaciones
  const [validationConfig, setValidationConfig] = useState<ValidationConfig>({
    rangos: true,
    temperatura: true,
    series: true,
    rangos_custom: { ...DEFAULT_RANGOS },
    temp_min: 20,
    temp_max: 30,
  });
  const [editingSection, setEditingSection] = useState<'rangos' | 'temperatura' | null>(null);

  // Estado del upload en Dashboard
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResponse | null>(null);

  useEffect(() => {
    apiService.healthCheck()
      .then(setHealth)
      .catch(() => {})
      .finally(() => setLoadingHealth(false));
  }, []);

  // Construir config para el backend
  const buildBackendConfig = () => ({
    rangos: validationConfig.rangos,
    temperatura: validationConfig.temperatura,
    series: validationConfig.series,
    rangos_custom: validationConfig.rangos ? validationConfig.rangos_custom : undefined,
    temp_min: validationConfig.temp_min,
    temp_max: validationConfig.temp_max,
  });

  const handleFileUpload = async (file: File) => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    setValidationResult(null);
    try {
      const uploadResponse = await apiService.uploadFile(file);
      const validationResponse = await apiService.validateFull(uploadResponse.filename, buildBackendConfig());
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

  const updateRango = (param: string, field: 'min' | 'max', value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    setValidationConfig(prev => ({
      ...prev,
      rangos_custom: {
        ...prev.rangos_custom,
        [param]: { ...prev.rangos_custom[param], [field]: num },
      },
    }));
  };

  const resetRangos = () => {
    setValidationConfig(prev => ({ ...prev, rangos_custom: { ...DEFAULT_RANGOS } }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-slate-500 mt-1">Bienvenido al Sistema de Validación de Datos de Calidad del Aire</p>
      </div>

      {/* API Status */}
      <div className={`p-4 rounded-lg flex items-center gap-3 ${
        health?.status === 'ok' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
      }`}>
        {loadingHealth ? (
          <><Clock className="h-5 w-5 text-slate-400 animate-pulse" /><span className="text-slate-600">Verificando conexión con la API...</span></>
        ) : health?.status === 'ok' ? (
          <><CheckCircle className="h-5 w-5 text-green-600" /><span className="text-green-700">API conectada y funcionando correctamente</span><span className="text-sm text-green-600 ml-auto">v{health.version}</span></>
        ) : (
          <><AlertTriangle className="h-5 w-5 text-red-600" /><span className="text-red-700">Error de conexión con la API</span></>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Estaciones" value={13} icon={<MapPin className="h-6 w-6" />} description="Estaciones de monitoreo" color="blue" />
        <StatCard title="Parámetros" value={17} icon={<Activity className="h-6 w-6" />} description="Parámetros validados" color="green" />
        <StatCard title="Rangos" value={17} icon={<Database className="h-6 w-6" />} description="Rangos de validación" color="orange" />
        <StatCard title="Banderas" value={10} icon={<FileCheck className="h-6 w-6" />} description="Tipos de banderas" color="purple" />
      </div>

      {/* Info: Banderas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">🚀 Inicio Rápido</h2>
          <div className="space-y-3">
            {[
              { n: 1, title: 'Configurar validaciones', desc: 'Selecciona y personaliza las validaciones en la sección inferior' },
              { n: 2, title: 'Subir archivo ENVISTA', desc: 'Arrastra tu archivo .xlsx al área de carga' },
              { n: 3, title: 'Descargar resultados', desc: 'Obtén el Excel con datos validados y reportes' },
            ].map(({ n, title, desc }) => (
              <div key={n} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-sm font-medium">{n}</span>
                <div><p className="font-medium text-slate-700">{title}</p><p className="text-sm text-slate-500">{desc}</p></div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">🏷️ Banderas de Validación</h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { code: 'IR', desc: 'Fuera de rango', color: 'bg-red-100 text-red-700' },
              { code: 'IO', desc: 'Inválido operador', color: 'bg-orange-100 text-orange-700' },
              { code: 'IF', desc: 'Falla equipo', color: 'bg-red-100 text-red-700' },
              { code: 'IC', desc: 'Calibración', color: 'bg-yellow-100 text-yellow-700' },
              { code: 'ND', desc: 'Sin dato', color: 'bg-slate-100 text-slate-600' },
              { code: 'DS', desc: 'Dato sospechoso', color: 'bg-purple-100 text-purple-700' },
              { code: 'VZ', desc: 'Límite detección', color: 'bg-blue-100 text-blue-700' },
              { code: 'VE', desc: 'Valor extraordinario', color: 'bg-pink-100 text-pink-700' },
            ].map((flag) => (
              <div key={flag.code} className={`px-3 py-2 rounded-lg ${flag.color} text-sm`}>
                <span className="font-bold">{flag.code}</span>
                <span className="ml-2">{flag.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── VALIDACIONES CONFIGURABLES ─── */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">📊 Validaciones Aplicadas</h2>
        <p className="text-sm text-slate-500 mb-4">Selecciona las validaciones a aplicar y personaliza sus criterios.</p>

        <div className="space-y-3">
          {/* ── Rangos ── */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 p-4">
              <input
                type="checkbox"
                checked={validationConfig.rangos}
                onChange={e => setValidationConfig(prev => ({ ...prev, rangos: e.target.checked }))}
                className="w-4 h-4 accent-blue-600 cursor-pointer"
              />
              <div className="flex-1">
                <p className={`font-medium ${validationConfig.rangos ? 'text-blue-800' : 'text-slate-400'}`}>Validación por Rangos</p>
                <p className="text-sm text-slate-500">Verifica que los valores estén dentro de los rangos establecidos para cada parámetro. Marca <strong>IR</strong> si está fuera.</p>
              </div>
              <button
                onClick={() => setEditingSection(editingSection === 'rangos' ? null : 'rangos')}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <Edit2 className="h-3.5 w-3.5" />
                Editar
                {editingSection === 'rangos' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>

            {editingSection === 'rangos' && (
              <div className="border-t border-slate-100 p-4 bg-slate-50">
                <div className="flex justify-between items-center mb-3">
                  <p className="text-sm font-medium text-slate-700">Rangos de validación por parámetro</p>
                  <button onClick={resetRangos} className="text-xs text-slate-500 hover:text-slate-700 underline">Restaurar valores por defecto</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-semibold text-slate-500 uppercase">
                        <th className="pb-2 pr-4">Parámetro</th>
                        <th className="pb-2 pr-4">Mínimo</th>
                        <th className="pb-2">Máximo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {Object.entries(validationConfig.rangos_custom).map(([param, range]) => (
                        <tr key={param}>
                          <td className="py-1.5 pr-4 font-medium text-slate-700">{param}</td>
                          <td className="py-1.5 pr-4">
                            <input
                              type="number"
                              value={range.min}
                              step="any"
                              onChange={e => updateRango(param, 'min', e.target.value)}
                              className="w-24 px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          </td>
                          <td className="py-1.5">
                            <input
                              type="number"
                              value={range.max}
                              step="any"
                              onChange={e => updateRango(param, 'max', e.target.value)}
                              className="w-24 px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ── Temperatura Interna ── */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 p-4">
              <input
                type="checkbox"
                checked={validationConfig.temperatura}
                onChange={e => setValidationConfig(prev => ({ ...prev, temperatura: e.target.checked }))}
                className="w-4 h-4 accent-green-600 cursor-pointer"
              />
              <div className="flex-1">
                <p className={`font-medium ${validationConfig.temperatura ? 'text-green-800' : 'text-slate-400'}`}>Temperatura Interna</p>
                <p className="text-sm text-slate-500">
                  Invalida contaminantes cuando la temperatura de cabina está fuera de {validationConfig.temp_min}–{validationConfig.temp_max}°C. Marca <strong>IO</strong>.
                </p>
              </div>
              <button
                onClick={() => setEditingSection(editingSection === 'temperatura' ? null : 'temperatura')}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-green-600 border border-green-200 rounded-lg hover:bg-green-50 transition-colors"
              >
                <Edit2 className="h-3.5 w-3.5" />
                Editar
                {editingSection === 'temperatura' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>

            {editingSection === 'temperatura' && (
              <div className="border-t border-slate-100 p-4 bg-slate-50">
                <p className="text-sm font-medium text-slate-700 mb-3">Rango de temperatura válido para la cabina</p>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    Mínimo:
                    <input
                      type="number"
                      value={validationConfig.temp_min}
                      step="0.5"
                      onChange={e => setValidationConfig(prev => ({ ...prev, temp_min: parseFloat(e.target.value) || 0 }))}
                      className="w-20 px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-400"
                    />
                    °C
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    Máximo:
                    <input
                      type="number"
                      value={validationConfig.temp_max}
                      step="0.5"
                      onChange={e => setValidationConfig(prev => ({ ...prev, temp_max: parseFloat(e.target.value) || 0 }))}
                      className="w-20 px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-400"
                    />
                    °C
                  </label>
                  <button
                    onClick={() => setValidationConfig(prev => ({ ...prev, temp_min: 20, temp_max: 30 }))}
                    className="text-xs text-slate-500 hover:text-slate-700 underline"
                  >
                    Restaurar (20–30°C)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Series Temporales ── */}
          <div className="border border-slate-200 rounded-lg">
            <div className="flex items-center gap-3 p-4">
              <input
                type="checkbox"
                checked={validationConfig.series}
                onChange={e => setValidationConfig(prev => ({ ...prev, series: e.target.checked }))}
                className="w-4 h-4 accent-purple-600 cursor-pointer"
              />
              <div className="flex-1">
                <p className={`font-medium ${validationConfig.series ? 'text-purple-800' : 'text-slate-400'}`}>Series Temporales</p>
                <p className="text-sm text-slate-500">
                  Detecta valores constantes &gt;3 horas (<strong>DS</strong>) y relaciones inválidas NOX/PM (<strong>IO</strong>).
                </p>
              </div>
              <span className="text-xs text-slate-400 italic px-3">Sin parámetros adicionales</span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── UPLOAD AL FINAL DEL DASHBOARD ─── */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">📁 Validar Archivo ENVISTA</h2>
        <p className="text-sm text-slate-500 mb-4">
          Las validaciones seleccionadas arriba se aplicarán al archivo que subas.
        </p>

        <FileUpload
          onFileUpload={handleFileUpload}
          isLoading={isLoading}
          error={error}
          success={success}
        />

        {validationResult && (
          <div className="mt-6 space-y-4">
            {/* Resumen */}
            <div className="border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <FileCheck className="h-5 w-5 text-green-600" />
                  <h3 className="font-semibold text-slate-800">Resultados de Validación</h3>
                </div>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors text-sm"
                >
                  <Download className="h-4 w-4" />
                  Descargar Excel
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Total Registros', value: validationResult.summary.total_registros.toLocaleString() },
                  { label: 'Estaciones', value: validationResult.summary.estaciones },
                  { label: 'Fecha Inicio', value: validationResult.summary.fecha_inicio },
                  { label: 'Fecha Fin', value: validationResult.summary.fecha_fin },
                ].map(({ label, value }) => (
                  <div key={label} className="p-3 bg-slate-50 rounded-lg">
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="text-lg font-bold text-slate-800">{value}</p>
                  </div>
                ))}
              </div>

              {Object.keys(validationResult.summary.banderas).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(validationResult.summary.banderas).map(([key, value]: [string, any]) => (
                    <span key={key} className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm">
                      {key}: {typeof value === 'object' ? value.Cantidad?.toLocaleString() : value}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Tabla de datos */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-200">
                <h3 className="font-semibold text-slate-800">Vista Previa de Datos</h3>
                <p className="text-sm text-slate-500">
                  {validationResult.data_preview.length.toLocaleString()} registros (paginados de 50 en 50)
                </p>
              </div>
              <DataTable data={validationResult.data_preview} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
