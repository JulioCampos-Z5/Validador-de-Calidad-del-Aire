import { crearApi } from '../sesion';

/**
 * Archivos Excel/CSV importados en la app de escritorio, guardados para
 * volver a consultarlos (backend/archivos/rutas.py). En la web no hay carpeta
 * y `listar` responde `disponible: false`.
 */
const api = crearApi('/api/archivos');

export interface ArchivoGuardado {
  nombre: string;
  /** Bytes. */
  tamano: number;
  /** ISO, hora local de la computadora. */
  modificado: string;
  /** `validado` = BD con hoja Data; `envista` = exportación cruda. */
  tipo: 'validado' | 'envista';
}

export interface VistaArchivo {
  nombre: string;
  hojas: string[];
  hoja: string | null;
  columnas: string[];
  filas: (string | number | null)[][];
  /** Filas de datos del archivo (la vista trae solo las primeras). */
  total: number;
}

const ruta = (nombre: string) => `/${encodeURIComponent(nombre)}`;

export const archivosApi = {
  listar: async (): Promise<{ disponible: boolean; carpeta?: string; archivos: ArchivoGuardado[] }> =>
    (await api.get('')).data,
  vista: async (nombre: string, hoja?: string): Promise<VistaArchivo> =>
    (await api.get(`${ruta(nombre)}/vista`, { params: hoja ? { hoja } : {} })).data,
  /** Lo deja listo para cargarse como si se acabara de subir. */
  abrir: async (nombre: string): Promise<{ filename: string; tipo: ArchivoGuardado['tipo']; nombre: string }> =>
    (await api.post(`${ruta(nombre)}/abrir`)).data,
  borrar: async (nombre: string): Promise<void> => { await api.delete(ruta(nombre)); },
};
