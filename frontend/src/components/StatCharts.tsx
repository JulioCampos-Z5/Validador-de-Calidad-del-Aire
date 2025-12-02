import { useState, useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ErrorBar,
  Cell,
} from 'recharts';

interface DataPoint {
  STATION: string;
  DATE: string;
  HOUR: number;
  [key: string]: string | number | null;
}

interface StatChartsProps {
  data: DataPoint[];
}

// Parámetros por categoría
const CONTAMINANTES = ['O3', 'NO', 'NO2', 'NOX', 'SO2', 'CO', 'PM10', 'PM2.5'];
const METEOROLOGICOS = ['IT', 'ET', 'RH', 'WS', 'WD', 'PP', 'ATM', 'RS', 'UVI'];

// Colores para cada parámetro
const PARAM_COLORS: Record<string, string> = {
  'O3': '#3b82f6',
  'NO': '#22c55e',
  'NO2': '#ef4444',
  'NOX': '#f59e0b',
  'SO2': '#8b5cf6',
  'CO': '#ec4899',
  'PM10': '#f97316',
  'PM2.5': '#06b6d4',
  'IT': '#ef4444',
  'ET': '#f59e0b',
  'RH': '#3b82f6',
  'WS': '#22c55e',
  'WD': '#8b5cf6',
  'PP': '#06b6d4',
  'ATM': '#ec4899',
  'RS': '#f97316',
  'UVI': '#eab308',
};

// Colores para estaciones
const STATION_COLORS: Record<string, string> = {
  'AGU': '#06b6d4',
  'ATM': '#3b82f6',
  'CEN': '#f97316',
  'COU': '#22c55e',
  'LDO': '#ef4444',
  'MIR': '#8b5cf6',
  'OBL': '#ec4899',
  'PIN': '#eab308',
  'SAN': '#14b8a6',
  'SFE': '#a855f7',
  'SMT': '#0ea5e9',
  'TLA': '#6366f1',
  'VAL': '#f43f5e',
};

const StatCharts = ({ data }: StatChartsProps) => {
  const [showBoxPlot, setShowBoxPlot] = useState<boolean>(false);
  const [selectedParam, setSelectedParam] = useState<string>('O3');
  const [paramType, setParamType] = useState<'contaminantes' | 'meteorologicos'>('contaminantes');

  // Obtener estaciones únicas
  const stations = useMemo(() => {
    const uniqueStations = [...new Set(data.map((d) => d.STATION))];
    return uniqueStations.sort();
  }, [data]);

  const currentParams = paramType === 'contaminantes' ? CONTAMINANTES : METEOROLOGICOS;

  // Calcular estadísticas por estación para el parámetro seleccionado
  const statsData = useMemo(() => {
    const stationStats: Record<string, number[]> = {};

    data.forEach((row) => {
      const station = row.STATION;
      const value = row[selectedParam];
      
      if (value !== null && value !== undefined && typeof value === 'number' && !isNaN(value)) {
        if (!stationStats[station]) {
          stationStats[station] = [];
        }
        stationStats[station].push(value);
      }
    });

    return stations.map((station) => {
      const values = stationStats[station] || [];
      if (values.length === 0) {
        return {
          station,
          promedio: 0,
          desviacion: 0,
          min: 0,
          max: 0,
          q1: 0,
          mediana: 0,
          q3: 0,
          count: 0,
        };
      }

      // Ordenar valores para calcular cuartiles
      const sorted = [...values].sort((a, b) => a - b);
      const n = sorted.length;
      
      // Calcular estadísticas
      const sum = values.reduce((a, b) => a + b, 0);
      const promedio = sum / n;
      const varianza = values.reduce((acc, val) => acc + Math.pow(val - promedio, 2), 0) / n;
      const desviacion = Math.sqrt(varianza);
      
      const min = sorted[0];
      const max = sorted[n - 1];
      const mediana = n % 2 === 0 ? (sorted[n/2 - 1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)];
      const q1 = sorted[Math.floor(n * 0.25)];
      const q3 = sorted[Math.floor(n * 0.75)];

      return {
        station,
        promedio: Number(promedio.toFixed(4)),
        desviacion: Number(desviacion.toFixed(4)),
        min: Number(min.toFixed(4)),
        max: Number(max.toFixed(4)),
        q1: Number(q1.toFixed(4)),
        mediana: Number(mediana.toFixed(4)),
        q3: Number(q3.toFixed(4)),
        count: n,
        // Para error bars
        errorNeg: Number(desviacion.toFixed(4)),
        errorPos: Number(desviacion.toFixed(4)),
      };
    }).filter(s => s.count > 0);
  }, [data, selectedParam, stations]);

  // Datos para Box Plot (simulado con barras)
  const boxPlotData = useMemo(() => {
    return statsData.map((stat) => ({
      station: stat.station,
      // Rango inferior (min a q1)
      rangoInferior: stat.q1 - stat.min,
      // Caja inferior (q1 a mediana)
      cajaInferior: stat.mediana - stat.q1,
      // Base para apilado
      base: stat.min,
      // Caja superior (mediana a q3)
      cajaSuperior: stat.q3 - stat.mediana,
      // Rango superior (q3 a max)
      rangoSuperior: stat.max - stat.q3,
      // Valores originales para tooltip
      min: stat.min,
      q1: stat.q1,
      mediana: stat.mediana,
      q3: stat.q3,
      max: stat.max,
      promedio: stat.promedio,
    }));
  }, [statsData]);

  return (
    <div className="space-y-6">
      {/* Controles */}
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="flex flex-wrap gap-4 items-center">
          {/* Toggle Desviación / Box Plot */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tipo de gráfica
            </label>
            <div className="flex items-center gap-3">
              <span className={`text-sm ${!showBoxPlot ? 'text-cyan-600 font-medium' : 'text-gray-500'}`}>
                Desviación Estándar
              </span>
              <button
                onClick={() => setShowBoxPlot(!showBoxPlot)}
                className={`relative w-14 h-7 rounded-full transition-colors duration-200 focus:outline-none shadow-md ${
                  showBoxPlot ? 'bg-cyan-500' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transform transition-transform duration-200 ${
                    showBoxPlot ? 'translate-x-7' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className={`text-sm ${showBoxPlot ? 'text-cyan-600 font-medium' : 'text-gray-500'}`}>
                Box Plot
              </span>
            </div>
          </div>

          {/* Tipo de parámetro */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Categoría
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setParamType('contaminantes');
                  setSelectedParam('O3');
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  paramType === 'contaminantes'
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Contaminantes
              </button>
              <button
                onClick={() => {
                  setParamType('meteorologicos');
                  setSelectedParam('IT');
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  paramType === 'meteorologicos'
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Meteorológicos
              </button>
            </div>
          </div>

          {/* Selector de parámetro */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Parámetro
            </label>
            <select
              value={selectedParam}
              onChange={(e) => setSelectedParam(e.target.value)}
              className="block w-48 px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {currentParams.map((param) => (
                <option key={param} value={param}>
                  {param}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Gráfica */}
      <div className="bg-white p-4 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4 text-blue-700 flex items-center gap-2">
          <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
          {showBoxPlot 
            ? `Box Plot - ${selectedParam} por Estación`
            : `Desviación Estándar - ${selectedParam} por Estación`}
        </h3>

        {statsData.length > 0 ? (
          <ResponsiveContainer width="100%" height={450}>
            {showBoxPlot ? (
              // Box Plot simulado
              <ComposedChart data={boxPlotData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis dataKey="station" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-white p-3 border border-gray-300 rounded-lg shadow-lg">
                          <p className="font-semibold text-gray-800">{data.station}</p>
                          <div className="text-sm text-gray-600 mt-1 space-y-1">
                            <p>Mínimo: <span className="font-medium">{data.min}</span></p>
                            <p>Q1 (25%): <span className="font-medium">{data.q1}</span></p>
                            <p>Mediana: <span className="font-medium text-blue-600">{data.mediana}</span></p>
                            <p>Q3 (75%): <span className="font-medium">{data.q3}</span></p>
                            <p>Máximo: <span className="font-medium">{data.max}</span></p>
                            <p className="border-t pt-1 mt-1">Promedio: <span className="font-medium text-green-600">{data.promedio}</span></p>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend />
                {/* Línea de mínimo a máximo */}
                <Bar dataKey="base" stackId="box" fill="transparent" />
                <Bar dataKey="rangoInferior" stackId="box" fill="#94a3b8" name="Rango (Min-Q1)" />
                <Bar dataKey="cajaInferior" stackId="box" fill={PARAM_COLORS[selectedParam] || '#3b82f6'} name="Q1-Mediana" />
                <Bar dataKey="cajaSuperior" stackId="box" fill={PARAM_COLORS[selectedParam] || '#3b82f6'} name="Mediana-Q3" opacity={0.7} />
                <Bar dataKey="rangoSuperior" stackId="box" fill="#94a3b8" name="Rango (Q3-Max)" />
                {/* Línea de promedio */}
                <Line 
                  type="monotone" 
                  dataKey="promedio" 
                  stroke="#22c55e" 
                  strokeWidth={3}
                  dot={{ fill: '#22c55e', r: 5 }}
                  name="Promedio"
                />
              </ComposedChart>
            ) : (
              // Gráfica de Desviación Estándar
              <ComposedChart data={statsData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis dataKey="station" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-white p-3 border border-gray-300 rounded-lg shadow-lg">
                          <p className="font-semibold text-gray-800">{data.station}</p>
                          <div className="text-sm text-gray-600 mt-1 space-y-1">
                            <p>Promedio: <span className="font-medium text-blue-600">{data.promedio}</span></p>
                            <p>Desviación: <span className="font-medium text-orange-600">±{data.desviacion}</span></p>
                            <p>Mínimo: <span className="font-medium">{data.min}</span></p>
                            <p>Máximo: <span className="font-medium">{data.max}</span></p>
                            <p>Registros: <span className="font-medium">{data.count}</span></p>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend />
                {/* Barras con error bars */}
                <Bar dataKey="promedio" fill={PARAM_COLORS[selectedParam] || '#3b82f6'} name="Promedio">
                  <ErrorBar dataKey="desviacion" width={4} strokeWidth={2} stroke="#f97316" />
                  {statsData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={STATION_COLORS[entry.station] || PARAM_COLORS[selectedParam] || '#3b82f6'} />
                  ))}
                </Bar>
                {/* Línea de desviación para referencia visual */}
                <Line 
                  type="monotone" 
                  dataKey="desviacion" 
                  stroke="#f97316" 
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={{ fill: '#f97316', r: 4 }}
                  name="Desviación Estándar"
                />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-500">
            No hay datos para mostrar
          </div>
        )}
      </div>

      {/* Tabla de estadísticas */}
      <div className="bg-white p-4 rounded-lg shadow">
        <h4 className="text-md font-semibold mb-3 text-gray-700">
          Estadísticas de {selectedParam} por Estación
        </h4>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Estación</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Registros</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Mínimo</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Máximo</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Promedio</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Desv. Estándar</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Mediana</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {statsData.map((stat) => (
                <tr key={stat.station} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-800">{stat.station}</td>
                  <td className="px-4 py-2 text-gray-600">{stat.count}</td>
                  <td className="px-4 py-2 text-gray-600">{stat.min}</td>
                  <td className="px-4 py-2 text-gray-600">{stat.max}</td>
                  <td className="px-4 py-2 text-blue-600 font-medium">{stat.promedio}</td>
                  <td className="px-4 py-2 text-orange-600 font-medium">{stat.desviacion}</td>
                  <td className="px-4 py-2 text-gray-600">{stat.mediana}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default StatCharts;
