import axios from 'axios';

/**
 * Cliente de la API de Emisiones de Jalisco.
 *
 * Todo pasa por el backend, incluido el inicio de sesión: la contraseña y el
 * token se quedan en el proceso de Python y al navegador nunca le llega el
 * token. Guardarlo aquí lo dejaría en memoria del renderer y a un paso de
 * acabar en localStorage, que es exactamente donde no debe estar la credencial
 * de una API de gobierno.
 */
const api = axios.create({ baseURL: '/api/emisiones' });

export interface SesionEmisiones {
  activa: boolean;
  email: string | null;
  /** ISO-8601. El token es diario; sirve para avisar antes de que caduque. */
  caduca: string | null;
}

export interface RangoEmisiones {
  /** 'AAAA-MM-DD' o 'AAAA-MM-DD HH:MM'. Si falta, se usa `dias`. */
  desde?: string;
  hasta?: string;
  dias?: number;
}

/** Techo del backend; el selector no ofrece más para no chocar contra el 400. */
export const DIAS_MAXIMOS = 31;

export const emisionesApi = {
  sesion: async (): Promise<SesionEmisiones> =>
    (await api.get<SesionEmisiones>('/sesion')).data,

  login: async (email: string, password: string): Promise<SesionEmisiones> =>
    (await api.post<SesionEmisiones>('/login', { email, password })).data,

  salir: async (): Promise<SesionEmisiones> =>
    (await api.post<SesionEmisiones>('/salir')).data,

  /**
   * Devuelve la misma forma que /api/validate/full, por eso el tipo es laxo:
   * lo consume el mismo estado del tablero que el flujo de subir archivo.
   */
  descargar: async (
    rango: RangoEmisiones,
    config?: Record<string, unknown>,
  ): Promise<any> => (await api.post('/descargar', { ...rango, config })).data,
};

export default emisionesApi;
