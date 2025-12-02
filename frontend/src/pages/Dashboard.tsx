import { useEffect, useState } from 'react';
import { 
  Activity, 
  Database, 
  MapPin, 
  FileCheck,
  AlertTriangle,
  CheckCircle,
  Clock
} from 'lucide-react';
import StatCard from '../components/StatCard';
import apiService, { HealthResponse } from '../services/api';

export default function Dashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await apiService.healthCheck();
        setHealth(response);
      } catch (error) {
        console.error('Error checking API health:', error);
      } finally {
        setLoading(false);
      }
    };

    checkHealth();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-slate-500 mt-1">
          Bienvenido al Sistema de Validación de Datos de Calidad del Aire
        </p>
      </div>

      {/* API Status */}
      <div className={`p-4 rounded-lg flex items-center gap-3 ${
        health?.status === 'ok' 
          ? 'bg-green-50 border border-green-200' 
          : 'bg-red-50 border border-red-200'
      }`}>
        {loading ? (
          <>
            <Clock className="h-5 w-5 text-slate-400 animate-pulse" />
            <span className="text-slate-600">Verificando conexión con la API...</span>
          </>
        ) : health?.status === 'ok' ? (
          <>
            <CheckCircle className="h-5 w-5 text-green-600" />
            <span className="text-green-700">API conectada y funcionando correctamente</span>
            <span className="text-sm text-green-600 ml-auto">v{health.version}</span>
          </>
        ) : (
          <>
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <span className="text-red-700">Error de conexión con la API</span>
          </>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Estaciones"
          value={13}
          icon={<MapPin className="h-6 w-6" />}
          description="Estaciones de monitoreo"
          color="blue"
        />
        <StatCard
          title="Parámetros"
          value={17}
          icon={<Activity className="h-6 w-6" />}
          description="Parámetros validados"
          color="green"
        />
        <StatCard
          title="Rangos"
          value={17}
          icon={<Database className="h-6 w-6" />}
          description="Rangos de validación"
          color="orange"
        />
        <StatCard
          title="Banderas"
          value={10}
          icon={<FileCheck className="h-6 w-6" />}
          description="Tipos de banderas"
          color="purple"
        />
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Start */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">
            🚀 Inicio Rápido
          </h2>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-sm font-medium">
                1
              </span>
              <div>
                <p className="font-medium text-slate-700">Subir archivo ENVISTA</p>
                <p className="text-sm text-slate-500">Carga tu archivo .xlsx con los datos de ENVISTA</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-sm font-medium">
                2
              </span>
              <div>
                <p className="font-medium text-slate-700">Validar datos</p>
                <p className="text-sm text-slate-500">El sistema aplicará las validaciones automáticamente</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-sm font-medium">
                3
              </span>
              <div>
                <p className="font-medium text-slate-700">Descargar resultados</p>
                <p className="text-sm text-slate-500">Obtén el archivo Excel con datos validados y reportes</p>
              </div>
            </div>
          </div>
        </div>

        {/* Banderas Info */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">
            🏷️ Banderas de Validación
          </h2>
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
              <div 
                key={flag.code}
                className={`px-3 py-2 rounded-lg ${flag.color} text-sm`}
              >
                <span className="font-bold">{flag.code}</span>
                <span className="ml-2">{flag.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Validation Info */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">
          📊 Validaciones Aplicadas
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <h3 className="font-medium text-blue-800">Validación por Rangos</h3>
            <p className="text-sm text-blue-600 mt-1">
              Verifica que los valores estén dentro de los rangos establecidos para cada parámetro.
            </p>
          </div>
          <div className="p-4 bg-green-50 rounded-lg">
            <h3 className="font-medium text-green-800">Temperatura Interna</h3>
            <p className="text-sm text-green-600 mt-1">
              Invalida contaminantes cuando la temperatura de cabina está fuera de 20-30°C.
            </p>
          </div>
          <div className="p-4 bg-purple-50 rounded-lg">
            <h3 className="font-medium text-purple-800">Series Temporales</h3>
            <p className="text-sm text-purple-600 mt-1">
              Detecta valores constantes y valida relaciones NOX y PM.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
