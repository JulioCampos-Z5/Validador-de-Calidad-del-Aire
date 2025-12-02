import { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface DataPoint {
  STATION: string;
  DATE: string;
  HOUR: number;
  [key: string]: string | number | null;
}

interface LineChartsProps {
  data: DataPoint[];
}

// Colores para cada estación - todos distintos y vibrantes
const STATION_COLORS: Record<string, string> = {
  'AGU': '#06b6d4', // cyan
  'ATM': '#3b82f6', // azul 
  'CEN': '#f97316', // naranja
  'COU': '#22c55e', // verde
  'LDO': '#ef4444', // rojo
  'MIR': '#8b5cf6', // púrpura
  'OBL': '#ec4899', // rosa
  'PIN': '#eab308', // amarillo
  'SAN': '#14b8a6', // teal
  'SFE': '#a855f7', // violeta
  'SMT': '#0ea5e9', // sky blue
  'TLA': '#6366f1', // indigo
  'VAL': '#f43f5e', // rose
  'NOR': '#84cc16', // lima
  'NTE': '#fb923c', // naranja claro
  'SUR': '#34d399', // esmeralda
  'LDM': '#c084fc', // púrpura claro
  'SAL': '#fbbf24', // ámbar
  'SJA': '#2dd4bf', // cyan claro
  'APO': '#f472b6', // rosa claro
  'MER': '#818cf8', // indigo claro
  'PED': '#4ade80', // verde claro
  'XAL': '#facc15', // amarillo brillante
  'CAM': '#fb7185', // rojo claro
  'CUA': '#a3e635', // lima brillante
  'TAC': '#c026d3', // fuchsia
  'BJU': '#0891b2', // cyan oscuro
  'COR': '#dc2626', // rojo oscuro
  'CHO': '#16a34a', // verde oscuro
  'FAC': '#7c3aed', // violet
  'HAN': '#db2777', // pink oscuro
  'INN': '#ea580c', // naranja oscuro
  'LAA': '#059669', // emerald
  'MPA': '#9333ea', // purple
  'MON': '#0284c7', // light blue
  'NEZ': '#65a30d', // lime oscuro
  'SAG': '#be185d', // rose oscuro
  'UIZ': '#4f46e5', // indigo oscuro
  'VIF': '#15803d', // green oscuro
};

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

const LineCharts = ({ data }: LineChartsProps) => {
  const [compareByStation, setCompareByStation] = useState<boolean>(false);
  const [selectedStation, setSelectedStation] = useState<string>('all');
  const [selectedContaminante, setSelectedContaminante] = useState<string>('O3');
  const [selectedMeteorologico, setSelectedMeteorologico] = useState<string>('IT');

  // Obtener estaciones únicas
  const stations = useMemo(() => {
    const uniqueStations = [...new Set(data.map((d) => d.STATION))];
    return uniqueStations.sort();
  }, [data]);

  // Procesar datos para gráfica de contaminantes
  const contaminantesData = useMemo(() => {
    if (compareByStation) {
      // Comparar por estaciones - promedios por estación para cada contaminante
      const stationData: Record<string, Record<string, { sum: number; count: number }>> = {};
      
      data.forEach((row) => {
        const station = row.STATION;
        if (!stationData[station]) {
          stationData[station] = {};
        }

        CONTAMINANTES.forEach((param) => {
          const value = row[param];
          if (value !== null && value !== undefined && typeof value === 'number' && !isNaN(value)) {
            if (!stationData[station][param]) {
              stationData[station][param] = { sum: 0, count: 0 };
            }
            stationData[station][param].sum += value;
            stationData[station][param].count += 1;
          }
        });
      });

      // Convertir a formato para gráfica de barras (estaciones en X, contaminantes como barras)
      return stations.map((station) => {
        const result: Record<string, string | number> = { station };
        CONTAMINANTES.forEach((param) => {
          if (stationData[station]?.[param]) {
            result[param] = Number((stationData[station][param].sum / stationData[station][param].count).toFixed(2));
          }
        });
        return result;
      });
    } else {
      // Serie temporal
      const processedData: Record<string, Record<string, number | null>> = {};
      
      data.forEach((row) => {
        const timeKey = `${row.DATE} ${String(row.HOUR).padStart(2, '0')}:00`;
        
        if (!processedData[timeKey]) {
          processedData[timeKey] = {};
        }

        if (selectedStation === 'all') {
          const value = row[selectedContaminante];
          if (value !== null && value !== undefined && typeof value === 'number' && !isNaN(value)) {
            processedData[timeKey][row.STATION] = value;
          }
        } else {
          if (row.STATION === selectedStation) {
            CONTAMINANTES.forEach((param) => {
              const value = row[param];
              if (value !== null && value !== undefined && typeof value === 'number' && !isNaN(value)) {
                processedData[timeKey][param] = value;
              }
            });
          }
        }
      });

      return Object.entries(processedData)
        .map(([time, values]) => ({ time, ...values }))
        .sort((a, b) => a.time.localeCompare(b.time));
    }
  }, [data, selectedStation, selectedContaminante, compareByStation, stations]);

  // Procesar datos para gráfica de meteorológicos
  const meteorologicosData = useMemo(() => {
    if (compareByStation) {
      // Comparar por estaciones - promedios por estación para cada meteorológico
      const stationData: Record<string, Record<string, { sum: number; count: number }>> = {};
      
      data.forEach((row) => {
        const station = row.STATION;
        if (!stationData[station]) {
          stationData[station] = {};
        }

        METEOROLOGICOS.forEach((param) => {
          const value = row[param];
          if (value !== null && value !== undefined && typeof value === 'number' && !isNaN(value)) {
            if (!stationData[station][param]) {
              stationData[station][param] = { sum: 0, count: 0 };
            }
            stationData[station][param].sum += value;
            stationData[station][param].count += 1;
          }
        });
      });

      // Convertir a formato para gráfica de barras
      return stations.map((station) => {
        const result: Record<string, string | number> = { station };
        METEOROLOGICOS.forEach((param) => {
          if (stationData[station]?.[param]) {
            result[param] = Number((stationData[station][param].sum / stationData[station][param].count).toFixed(2));
          }
        });
        return result;
      });
    } else {
      // Serie temporal
      const processedData: Record<string, Record<string, number | null>> = {};
      
      data.forEach((row) => {
        const timeKey = `${row.DATE} ${String(row.HOUR).padStart(2, '0')}:00`;
        
        if (!processedData[timeKey]) {
          processedData[timeKey] = {};
        }

        if (selectedStation === 'all') {
          const value = row[selectedMeteorologico];
          if (value !== null && value !== undefined && typeof value === 'number' && !isNaN(value)) {
            processedData[timeKey][row.STATION] = value;
          }
        } else {
          if (row.STATION === selectedStation) {
            METEOROLOGICOS.forEach((param) => {
              const value = row[param];
              if (value !== null && value !== undefined && typeof value === 'number' && !isNaN(value)) {
                processedData[timeKey][param] = value;
              }
            });
          }
        }
      });

      return Object.entries(processedData)
        .map(([time, values]) => ({ time, ...values }))
        .sort((a, b) => a.time.localeCompare(b.time));
    }
  }, [data, selectedStation, selectedMeteorologico, compareByStation, stations]);

  // Líneas para contaminantes
  const contaminantesLines = useMemo(() => {
    if (selectedStation === 'all') {
      return stations.map((station) => ({
        key: station,
        color: STATION_COLORS[station] || '#888888',
      }));
    } else {
      return CONTAMINANTES.map((param) => ({
        key: param,
        color: PARAM_COLORS[param] || '#888888',
      }));
    }
  }, [selectedStation, stations]);

  // Líneas para meteorológicos
  const meteorologicosLines = useMemo(() => {
    if (selectedStation === 'all') {
      return stations.map((station) => ({
        key: station,
        color: STATION_COLORS[station] || '#888888',
      }));
    } else {
      return METEOROLOGICOS.map((param) => ({
        key: param,
        color: PARAM_COLORS[param] || '#888888',
      }));
    }
  }, [selectedStation, stations]);

  return (
    <div className="space-y-6">
      {/* Control de estación */}
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="flex flex-wrap gap-4 items-center">
          {/* Toggle comparar por estaciones */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Modo de comparación
            </label>
            <div className="flex items-center gap-3">
              <span className={`text-sm ${!compareByStation ? 'text-cyan-600 font-medium' : 'text-gray-500'}`}>
                Serie temporal
              </span>
              <button
                onClick={() => setCompareByStation(!compareByStation)}
                className={`relative w-14 h-7 rounded-full transition-colors duration-200 focus:outline-none shadow-md ${
                  compareByStation ? 'bg-cyan-500' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transform transition-transform duration-200 ${
                    compareByStation ? 'translate-x-7' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className={`text-sm ${compareByStation ? 'text-cyan-600 font-medium' : 'text-gray-500'}`}>
                Por estaciones
              </span>
            </div>
          </div>

          {/* Selector de estación - solo en modo serie temporal */}
          {!compareByStation && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Estación
              </label>
              <select
                value={selectedStation}
                onChange={(e) => setSelectedStation(e.target.value)}
                className="block w-48 px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">Todas las estaciones</option>
                {stations.map((station) => (
                  <option key={station} value={station}>
                    {station}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Selector de parámetro contaminante (solo en serie temporal con todas las estaciones) */}
          {!compareByStation && selectedStation === 'all' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Contaminante
              </label>
              <select
                value={selectedContaminante}
                onChange={(e) => setSelectedContaminante(e.target.value)}
                className="block w-48 px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {CONTAMINANTES.map((param) => (
                  <option key={param} value={param}>
                    {param}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Selector de parámetro meteorológico (solo en serie temporal con todas las estaciones) */}
          {!compareByStation && selectedStation === 'all' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Meteorológico
              </label>
              <select
                value={selectedMeteorologico}
                onChange={(e) => setSelectedMeteorologico(e.target.value)}
                className="block w-48 px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {METEOROLOGICOS.map((param) => (
                  <option key={param} value={param}>
                    {param}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Leyenda de estaciones - solo en serie temporal */}
      {!compareByStation && selectedStation === 'all' && (
        <div className="bg-white p-4 rounded-lg shadow">
          <h4 className="text-sm font-semibold mb-2">Estaciones</h4>
          <div className="flex flex-wrap gap-3">
            {stations.map((station) => (
              <div key={station} className="flex items-center gap-2">
                <div
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: STATION_COLORS[station] || '#888888' }}
                />
                <span className="text-sm">{station}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gráfica de Contaminantes */}
      <div className="bg-white p-4 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4 text-green-700 flex items-center gap-2">
          <span className="w-3 h-3 bg-green-500 rounded-full"></span>
          {compareByStation
            ? 'Contaminantes - Promedio por estación'
            : selectedStation === 'all'
              ? `Contaminantes - ${selectedContaminante} (Serie temporal)`
              : `Contaminantes - Estación ${selectedStation} (Serie temporal)`}
        </h3>
        
        {contaminantesData.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            {compareByStation ? (
              <LineChart data={contaminantesData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis dataKey="station" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid #22c55e',
                    borderRadius: '8px',
                  }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                {CONTAMINANTES.map((param) => (
                  <Line
                    key={param}
                    type="monotone"
                    dataKey={param}
                    stroke={PARAM_COLORS[param]}
                    strokeWidth={2}
                    dot={{ fill: PARAM_COLORS[param], strokeWidth: 2, r: 4 }}
                    connectNulls
                    name={param}
                  />
                ))}
              </LineChart>
            ) : (
              <LineChart data={contaminantesData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid #22c55e',
                    borderRadius: '8px',
                  }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                {contaminantesLines.map(({ key, color }) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    name={key}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-500">
            No hay datos de contaminantes para mostrar
          </div>
        )}
      </div>

      {/* Gráfica de Meteorológicos */}
      <div className="bg-white p-4 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4 text-purple-700 flex items-center gap-2">
          <span className="w-3 h-3 bg-purple-500 rounded-full"></span>
          {compareByStation
            ? 'Meteorológicos - Promedio por estación'
            : selectedStation === 'all'
              ? `Meteorológicos - ${selectedMeteorologico} (Serie temporal)`
              : `Meteorológicos - Estación ${selectedStation} (Serie temporal)`}
        </h3>
        
        {meteorologicosData.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            {compareByStation ? (
              <LineChart data={meteorologicosData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis dataKey="station" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid #8b5cf6',
                    borderRadius: '8px',
                  }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                {METEOROLOGICOS.map((param) => (
                  <Line
                    key={param}
                    type="monotone"
                    dataKey={param}
                    stroke={PARAM_COLORS[param]}
                    strokeWidth={2}
                    dot={{ fill: PARAM_COLORS[param], strokeWidth: 2, r: 4 }}
                    connectNulls
                    name={param}
                  />
                ))}
              </LineChart>
            ) : (
              <LineChart data={meteorologicosData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid #8b5cf6',
                    borderRadius: '8px',
                  }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                {meteorologicosLines.map(({ key, color }) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    name={key}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-500">
            No hay datos meteorológicos para mostrar
          </div>
        )}
      </div>
    </div>
  );
};

export default LineCharts;
