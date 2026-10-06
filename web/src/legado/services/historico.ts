import { crearApi } from '../sesion';
import type { ValidationResponse } from './api';

/**
 * Cliente del histórico en SQLite. Solo existe en la app de escritorio: en la
 * web `/estado` responde `disponible: false` y la página no se muestra.
 */
const api = crearApi('/api/historico');

export interface AnioGuardado {
  anio: number;
  registros: number;
  valores: number;
  estaciones: number;
  desde: string;
  hasta: string;
}

export interface Carga {
  id: number;
  fecha: string;
  origen: string | null;
  descripcion: string | null;
  desde: string;
  hasta: string;
  nuevos: number;
  cambiados: number;
  iguales: number;
}

export interface EstadoHistorico {
  disponible: boolean;
  ruta?: string;
  tamano?: number;
  anios?: AnioGuardado[];
  parametros?: string[];
  estaciones?: string[];
  cargas?: Carga[];
  error?: string;
}

export interface Cambio {
  estacion: string;
  parametro: string;
  fecha: string;
  hora: number;
  antes: number | null;
  bandera_antes: string | null;
  ahora: number | null;
  bandera_ahora: string | null;
}

export interface Analisis {
  id: string | null;
  total: number;
  nuevos: number;
  cambiados: number;
  iguales: number;
  desde: string | null;
  hasta: string | null;
  por_parametro: { clave: string; cambios: number }[];
  por_estacion: { clave: string; cambios: number }[];
  muestra: Cambio[];
}

/** La base local cubre desde aquí (igual que FECHA_MINIMA en el backend). */
export const FECHA_MINIMA = '2024-01-01';

export interface AvanceDescarga {
  activo: boolean;
  desde?: string;
  hasta?: string;
  total?: number;
  hechos?: number;
  mes?: string | null;
  nuevos?: number;
  pendientes?: number;
  fallidos?: { mes: string; error: string }[];
  vacios?: string[];
  error?: string | null;
  mensaje?: string | null;
}

export const historicoApi = {
  estado: async (): Promise<EstadoHistorico> => (await api.get('/estado')).data,
  /** Trae un periodo guardado; `hasta` excluye, como en los demás orígenes. */
  cargar: async (desde: string, hasta: string): Promise<ValidationResponse> =>
    (await api.post('/cargar', { desde, hasta })).data,
  /** Solo leer: filas de un parámetro en [desde, hasta), sin tocar lo cargado. */
  serie: async (desde: string, hasta: string, parametro: string)
    : Promise<Record<string, string | number | null>[]> =>
    (await api.get('/serie', { params: { desde, hasta, parametro } })).data,
  analizar: async (): Promise<Analisis> => (await api.post('/analizar')).data,
  aplicar: async (id: string, actualizarCambios: boolean) =>
    (await api.post('/aplicar', { id, actualizar_cambios: actualizarCambios })).data as
      { carga_id: number; nuevos: number; actualizados: number; omitidos: number },
  descartar: async (id: string) => { await api.post('/descartar', { id }); },
  /** Descarga mes a mes desde la API de Emisiones, en segundo plano. `hasta` excluye. */
  descargar: async (desde: string, hasta: string, config?: unknown): Promise<AvanceDescarga> =>
    (await api.post('/descargar', { desde, hasta, config })).data,
  avanceDescarga: async (): Promise<AvanceDescarga> => (await api.get('/descargar')).data,
  cancelarDescarga: async () => { await api.post('/descargar/cancelar'); },
  pendientes: async (): Promise<{ total: number; muestra: Cambio[] }> => (await api.get('/pendientes')).data,
  aplicarPendientes: async (): Promise<{ actualizados: number }> => (await api.post('/pendientes/aplicar')).data,
  descartarPendientes: async (): Promise<{ descartados: number }> => (await api.post('/pendientes/descartar')).data,
  cambiosDeCarga: async (id: number): Promise<Cambio[]> => (await api.get(`/cargas/${id}/cambios`)).data,
};

/** Mensaje de error del backend, o el genérico. */
export function mensajeError(e: unknown, generico: string): string {
  return (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? generico;
}
