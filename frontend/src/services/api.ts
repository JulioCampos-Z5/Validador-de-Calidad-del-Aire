import axios from 'axios';

const API_BASE_URL = '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Tipos
export interface HealthResponse {
  status: string;
  message: string;
  timestamp: string;
  version: string;
}

export interface ConfigResponse {
  estaciones: Record<string, string>;
  parametros: Record<string, string>;
  rangos: Record<string, { min: number; max: number; limite_deteccion?: number }>;
  banderas: Record<string, string>;
  decimales: Record<string, number>;
}

export interface UploadResponse {
  message: string;
  filename: string;
  filepath: string;
}

export interface ValidationSummary {
  total_registros: number;
  estaciones: number;
  fecha_inicio: string;
  fecha_fin: string;
  banderas: Record<string, { Cantidad: number; Descripción: string }>;
  estadisticas: Record<string, any>;
}

export interface EstadisticaDetallada {
  Estación: string;
  Contaminante: string;
  'Total de registros': number;
  'Valores válidos': number;
  Mínimo: number;
  Máximo: number;
  Promedio: number;
  'Desviación estándar': number;
}

export interface ValidationResponse {
  success: boolean;
  message: string;
  output_filename: string;
  summary: ValidationSummary;
  data_preview: Record<string, any>[];
  estadisticas_detalladas: EstadisticaDetallada[];
}

export interface StatsResponse {
  banderas_global: Record<string, any>;
  banderas_detallado: any[];
  estadisticas_generales: Record<string, any>;
  estadisticas_detalladas: any[];
}

// Servicios
export const apiService = {
  // Health check
  healthCheck: async (): Promise<HealthResponse> => {
    const response = await api.get('/health');
    return response.data;
  },

  // Configuración
  getConfig: async (): Promise<ConfigResponse> => {
    const response = await api.get('/config');
    return response.data;
  },

  getRangos: async () => {
    const response = await api.get('/config/rangos');
    return response.data;
  },

  getBanderas: async () => {
    const response = await api.get('/config/banderas');
    return response.data;
  },

  getEstaciones: async () => {
    const response = await api.get('/config/estaciones');
    return response.data;
  },

  // Upload
  uploadFile: async (file: File): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await api.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // Validación
  validateData: async (filename: string): Promise<ValidationResponse> => {
    const response = await api.post('/validate', { filename });
    return response.data;
  },

  validateFull: async (filename: string): Promise<ValidationResponse> => {
    const response = await api.post('/validate/full', { filename });
    return response.data;
  },

  // Descargas y previews
  downloadFile: (filename: string) => {
    return `${API_BASE_URL}/download/${filename}`;
  },

  previewFile: async (filename: string) => {
    const response = await api.get(`/preview/${filename}`);
    return response.data;
  },

  getStats: async (filename: string): Promise<StatsResponse> => {
    const response = await api.get(`/stats/${filename}`);
    return response.data;
  },
};

export default apiService;
