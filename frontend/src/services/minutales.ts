import axios from 'axios';

/**
 * Cliente de la integración con los minutales del SIMAJ.
 *
 * Todas las llamadas van al backend, nunca al SIMAJ directamente: ese servidor
 * no manda cabeceras CORS, así que un fetch desde el navegador falla siempre.
 */
const api = axios.create({ baseURL: '/api/minutales' });

export interface Coberturas {
  [contaminante: string]: number | null;
}

export interface EstacionMir {
  estacion: string;
  coberturas: Coberturas;
  sin_equipo: string[];
  horas_esperadas: number;
  /** null cuando la estación no tiene ni un contaminante medido. */
  total: number | null;
  cumple: boolean;
}

export interface Mir {
  contaminantes: string[];
  umbral: number;
  estaciones: EstacionMir[];
  promedio_periodo: number | null;
  estaciones_que_cumplen: number;
  total_estaciones: number;
}

export type TipoFalla = 'sin_equipo' | 'caido' | 'intermitente';

export interface Falla {
  estacion: string;
  contaminante: string;
  tipo: TipoFalla;
  cobertura: number | null;
  detalle: string;
  hunde_a_la_estacion: boolean;
}

export interface RespuestaDescarga {
  registros: number;
  estaciones: string[];
  periodo: { desde: string; hasta: string };
  mir: Mir;
  fallas: Falla[];
  validado: boolean;
  muestra: Record<string, string | number | null>[];
}

export interface Progreso {
  activo: boolean;
  estacion: string | null;
  indice: number;
  estaciones: number;
  hechos: number;
  total: number;
}

export const CONTAMINANTES_CRITERIO = ['O3', 'NO2', 'SO2', 'CO', 'PM10', 'PM2.5'];

export const minutalesApi = {
  estaciones: async (): Promise<string[]> =>
    (await api.get<{ estaciones: string[] }>('/estaciones')).data.estaciones,

  progreso: async (): Promise<Progreso> => (await api.get<Progreso>('/progreso')).data,

  /**
   * Devuelve la misma forma que /api/validate/full, mas `mir` y `fallas`.
   * Por eso el tipo de retorno es laxo: lo consume el mismo estado del tablero
   * que ya usa el flujo de subir archivo.
   */
  descargar: async (
    meses: number,
    contaminantes: string[],
    config?: Record<string, unknown>,
  ): Promise<any> =>
    (await api.post('/descargar', { meses, contaminantes, config })).data,

  /** Recalcula el MIR con otra selección sin volver a descargar. */
  recalcularMir: async (
    contaminantes: string[],
    umbral = 75,
  ): Promise<{ mir: Mir; fallas: Falla[] }> =>
    (await api.post<{ mir: Mir; fallas: Falla[] }>('/mir', { contaminantes, umbral })).data,

  urlReporteCsv: (contaminantes: string[]): string =>
    `/api/minutales/reporte.csv?contaminantes=${encodeURIComponent(contaminantes.join(','))}`,
};
