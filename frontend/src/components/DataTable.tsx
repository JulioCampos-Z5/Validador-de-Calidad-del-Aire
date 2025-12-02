import { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';

interface DataTableProps {
  data: Record<string, any>[];
  columns?: string[];
  maxRows?: number;
  showAll?: boolean;
}

// Orden exacto de columnas según BD_2024.xlsx
const COLUMN_ORDER = [
  'STATION', 'DATE', 'HOUR', 'O3', 'NO', 'NO2', 'NOX', 'SO2', 'CO',
  'PM10', 'PM2.5', 'IT', 'ET', 'RH', 'WS', 'WD', 'PP', 'ATM', 'RS', 'UVI'
];

// Colores para los headers según tipo de parámetro
const HEADER_COLORS: Record<string, string> = {
  // Identificadores - Azul
  'STATION': 'bg-blue-600 text-white',
  'DATE': 'bg-blue-600 text-white',
  'HOUR': 'bg-blue-600 text-white',
  // Contaminantes gaseosos - Verde
  'O3': 'bg-green-600 text-white',
  'NO': 'bg-green-600 text-white',
  'NO2': 'bg-green-600 text-white',
  'NOX': 'bg-green-600 text-white',
  'SO2': 'bg-green-600 text-white',
  'CO': 'bg-green-600 text-white',
  // Material Particulado - Naranja
  'PM10': 'bg-orange-500 text-white',
  'PM2.5': 'bg-orange-500 text-white',
  // Temperatura - Rojo
  'IT': 'bg-red-500 text-white',
  'ET': 'bg-red-500 text-white',
  // Meteorológicos - Púrpura
  'RH': 'bg-purple-600 text-white',
  'WS': 'bg-purple-600 text-white',
  'WD': 'bg-purple-600 text-white',
  'PP': 'bg-purple-600 text-white',
  'ATM': 'bg-purple-600 text-white',
  'RS': 'bg-purple-600 text-white',
  'UVI': 'bg-purple-600 text-white',
};

export default function DataTable({ data, columns, maxRows = 50, showAll = false }: DataTableProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [showLegend, setShowLegend] = useState(false);
  const rowsPerPage = showAll ? 100 : maxRows;

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        No hay datos para mostrar
      </div>
    );
  }

  // Ordenar columnas según el orden establecido
  const getOrderedColumns = () => {
    if (columns) return columns;
    
    const dataColumns = Object.keys(data[0]);
    const orderedColumns: string[] = [];
    
    // Primero agregar las columnas en el orden definido
    COLUMN_ORDER.forEach(col => {
      if (dataColumns.includes(col)) {
        orderedColumns.push(col);
      }
    });
    
    // Agregar cualquier columna adicional que no esté en el orden definido
    dataColumns.forEach(col => {
      if (!orderedColumns.includes(col)) {
        orderedColumns.push(col);
      }
    });
    
    return orderedColumns;
  };

  const displayColumns = getOrderedColumns();
  
  // Paginación
  const totalPages = Math.ceil(data.length / rowsPerPage);
  const startIndex = currentPage * rowsPerPage;
  const endIndex = Math.min(startIndex + rowsPerPage, data.length);
  const displayData = data.slice(startIndex, endIndex);

  const getCellClass = (value: any, column: string) => {
    if (typeof value === 'string') {
      // Banderas de error con colores más vibrantes
      const flagColors: Record<string, string> = {
        'IR': 'bg-red-500 text-white font-bold',
        'IO': 'bg-orange-500 text-white font-bold',
        'IF': 'bg-red-600 text-white font-bold',
        'IC': 'bg-yellow-500 text-white font-bold',
        'ND': 'bg-slate-400 text-white font-bold',
        'DS': 'bg-purple-500 text-white font-bold',
        'VZ': 'bg-blue-500 text-white font-bold',
        'VE': 'bg-pink-500 text-white font-bold',
        'SE': 'bg-gray-500 text-white font-bold',
        'NE': 'bg-gray-600 text-white font-bold',
      };
      
      if (flagColors[value]) {
        return flagColors[value];
      }
    }
    
    // Colores para valores numéricos según columna
    if (typeof value === 'number' || !isNaN(Number(value))) {
      if (['O3', 'NO', 'NO2', 'NOX', 'SO2', 'CO'].includes(column)) {
        return 'text-green-700 bg-green-50';
      }
      if (['PM10', 'PM2.5'].includes(column)) {
        return 'text-orange-700 bg-orange-50';
      }
      if (['IT', 'ET'].includes(column)) {
        return 'text-red-700 bg-red-50';
      }
      if (['RH', 'WS', 'WD', 'PP', 'ATM', 'RS', 'UVI'].includes(column)) {
        return 'text-purple-700 bg-purple-50';
      }
    }
    
    return 'text-slate-700';
  };

  const formatValue = (value: any, column: string) => {
    if (value === null || value === undefined) return '-';
    
    // Si es bandera, mostrar tal cual
    if (typeof value === 'string' && ['IR', 'IO', 'IF', 'IC', 'ND', 'DS', 'VZ', 'VE', 'SE', 'NE'].includes(value)) {
      return value;
    }
    
    // Formatear números según el parámetro
    if (typeof value === 'number') {
      const decimals: Record<string, number> = {
        'O3': 3, 'NO': 3, 'NO2': 3, 'NOX': 3, 'SO2': 3, 'CO': 2,
        'PM10': 0, 'PM2.5': 0, 'IT': 2, 'ET': 2, 'RH': 1,
        'WS': 1, 'WD': 1, 'PP': 2, 'ATM': 1, 'RS': 1, 'UVI': 2, 'HOUR': 0
      };
      
      if (column in decimals) {
        return value.toFixed(decimals[column]);
      }
      return value.toString();
    }
    
    return String(value);
  };

  return (
    <div className="flex flex-col">
      {/* Leyenda de colores - ARRIBA (colapsable) */}
      <div className="mb-4 mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-slate-700 mb-3">Leyenda de Colores</h4>
            
            {showLegend && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-6 bg-blue-600 rounded text-white text-xs flex items-center justify-center font-bold">ID</span>
                    <span className="text-xs text-slate-600">Identificadores</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-6 bg-green-600 rounded text-white text-xs flex items-center justify-center font-bold">Gas</span>
                    <span className="text-xs text-slate-600">Contaminantes Gaseosos</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-6 bg-orange-500 rounded text-white text-xs flex items-center justify-center font-bold">PM</span>
                    <span className="text-xs text-slate-600">Material Particulado</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-6 bg-red-500 rounded text-white text-xs flex items-center justify-center font-bold">T°</span>
                    <span className="text-xs text-slate-600">Temperatura</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-6 bg-purple-600 rounded text-white text-xs flex items-center justify-center font-bold">Met</span>
                    <span className="text-xs text-slate-600">Meteorológicos</span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <h5 className="text-xs font-semibold text-slate-600 mb-2">Banderas de Validación:</h5>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-1 bg-orange-500 text-white text-xs rounded font-bold">IO</span>
                    <span className="px-2 py-1 bg-red-500 text-white text-xs rounded font-bold">IR</span>
                    <span className="px-2 py-1 bg-red-600 text-white text-xs rounded font-bold">IF</span>
                    <span className="px-2 py-1 bg-yellow-500 text-white text-xs rounded font-bold">IC</span>
                    <span className="px-2 py-1 bg-slate-400 text-white text-xs rounded font-bold">ND</span>
                    <span className="px-2 py-1 bg-purple-500 text-white text-xs rounded font-bold">DS</span>
                    <span className="px-2 py-1 bg-blue-500 text-white text-xs rounded font-bold">VZ</span>
                  </div>
                </div>
              </>
            )}
          </div>
          
          {/* Botón abajo a la derecha */}
          <div className="flex items-end self-end">
            <button
              onClick={() => setShowLegend(!showLegend)}
              className="flex items-center gap-2 px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-sm transition-colors"
            >
              {showLegend ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  Ocultar
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Mostrar
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Paginación - ARRIBA */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end px-4 py-3 mb-2 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="p-2 rounded-lg hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            
            <span className="text-sm text-slate-600">Página</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={currentPage + 1}
              onChange={(e) => {
                const page = parseInt(e.target.value, 10);
                if (!isNaN(page) && page >= 1 && page <= totalPages) {
                  setCurrentPage(page - 1);
                }
              }}
              onBlur={(e) => {
                const page = parseInt(e.target.value, 10);
                if (isNaN(page) || page < 1) {
                  setCurrentPage(0);
                } else if (page > totalPages) {
                  setCurrentPage(totalPages - 1);
                }
              }}
              className="w-16 px-2 py-1 text-center text-sm border border-slate-300 rounded-lg focus:outline-none"
            />
            <span className="text-sm text-slate-600">de {totalPages}</span>
            
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className="p-2 rounded-lg hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Tabla con scroll horizontal */}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full divide-y divide-slate-200">
          <thead>
            <tr>
              {displayColumns.map((column) => (
                <th
                  key={column}
                  className={`px-3 py-3 text-center text-xs font-bold uppercase tracking-wider whitespace-nowrap sticky top-0 ${
                    HEADER_COLORS[column] || 'bg-slate-600 text-white'
                  }`}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-100">
            {displayData.map((row, rowIndex) => (
              <tr 
                key={rowIndex} 
                className={`hover:bg-slate-100 ${rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}
              >
                {displayColumns.map((column) => {
                  const value = row[column];
                  const cellClass = getCellClass(value, column);
                  
                  return (
                    <td
                      key={column}
                      className={`px-3 py-2 text-sm text-center whitespace-nowrap ${cellClass}`}
                    >
                      {formatValue(value, column)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Contador de registros - ABAJO */}
      <div className="flex items-center justify-start px-4 py-3 mt-2 bg-slate-50 border border-slate-200 rounded-lg">
        <div className="text-sm text-slate-600">
          Mostrando <span className="font-medium">{startIndex + 1}</span> a{' '}
          <span className="font-medium">{endIndex}</span> de{' '}
          <span className="font-medium">{data.length.toLocaleString()}</span> registros
        </div>
      </div>
    </div>
  );
}
