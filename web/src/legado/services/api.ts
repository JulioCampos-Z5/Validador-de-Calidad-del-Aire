import { crearApi } from '../sesion';
import type { Falla, Mir } from './minutales';

const API_BASE_URL = '/api';

const api = crearApi(API_BASE_URL);

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

/** Lo que se guardó en la base local al importar (solo app de escritorio). */
export interface GuardadoLocal {
  nuevos?: number;
  pendientes?: number;
  error?: string;
}

export interface ValidationResponse {
  historico?: GuardadoLocal | null;
  success: boolean;
  message: string;
  output_filename: string;
  file_format?: 'envista_raw' | 'bd_procesado';
  revalidated?: boolean;
  summary: ValidationSummary;
  data_preview: Record<string, any>[];
  estadisticas_detalladas: EstadisticaDetallada[];
  /** Indicador MIR de lo cargado; null si el archivo no trae estación o fecha. */
  mir?: Mir | null;
  fallas?: Falla[];
}

export interface StatsResponse {
  banderas_global: Record<string, any>;
  banderas_detallado: any[];
  estadisticas_generales: Record<string, any>;
  estadisticas_detalladas: any[];
}

export interface RegistroServidor {
  id: number;
  /** ISO-8601 con segundos. */
  momento: string;
  nivel: 'ERROR' | 'WARNING' | string;
  /** Que logger lo emitio: 'validador', 'werkzeug', 'requests'... */
  origen: string;
  mensaje: string;
  /** La traza completa, si el registro venia de una excepcion. */
  traza: string | null;
}

export interface ArchivoApp {
  nombre: string;
  etiqueta: string;
  detalle: string;
  tamano_mb: number;
  compilado: string;
  url: string;
}

// Servicios
export const apiService = {
  /**
   * Errores y avisos del backend. Existe para no tener que entrar por SSH al
   * servidor cada vez que alguien dice que algo no funciona.
   */
  registros: async (nivel?: string): Promise<{
    registros: RegistroServidor[]; total: number; capacidad: number;
  }> => {
    const response = await api.get('/registros', { params: { nivel, limite: 200 } });
    return response.data;
  },

  limpiarRegistros: async (): Promise<void> => {
    await api.delete('/registros');
  },

  /** Ejecutables de la app de escritorio disponibles en este servidor. */
  appEscritorio: async (): Promise<{ disponible: boolean; archivos: ArchivoApp[] }> => {
    const response = await api.get('/app-escritorio');
    return response.data;
  },

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

  validateFull: async (
    filename: string,
    config?: Record<string, any>,
    revalidate: boolean = true,
    // Los que entran en el MIR; sin ellos, el backend usa los seis criterio.
    contaminantes?: string[],
  ): Promise<ValidationResponse> => {
    const response = await api.post('/validate/full', { filename, config, revalidate, contaminantes });
    return response.data;
  },

  previewValidated: async (filename: string, contaminantes?: string[]): Promise<ValidationResponse> => {
    const response = await api.post('/preview-validated', { filename, contaminantes });
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
