import axios from 'axios';

/**
 * Índice Aire y Salud (NOM-172) y cumplimiento NOM, calculados en el backend
 * sobre el último conjunto validado. Las gráficas de categorías y los Excel
 * salen del mismo cálculo (backend/ias/calculo.py), así que dicen lo mismo.
 */
const api = axios.create({ baseURL: '/api/ias' });

export type Contaminante = 'O3' | 'NO2' | 'SO2' | 'CO' | 'PM10' | 'PM2.5';

/** [indicador, categoría 0–4], null donde no hay indicador. */
export type ValorCat = [number | null, number | null];

export interface Evaluacion {
  /** 0 Buena … 4 Extremadamente mala; null sin ningún indicador. */
  cat: number | null;
  /** Contaminante responsable de la categoría. */
  pol: Contaminante | null;
  valores: Record<Contaminante, ValorCat>;
}

export interface DiaIas {
  /** `AAAA-MM-DD` */
  fecha: string;
  /** 24 horas; null donde la estación no tiene esa hora. */
  horas: (Evaluacion | null)[];
  /** Categoría diaria, null si no hubo registro ese día. */
  diaria: (Evaluacion & { nom: 'Si' | 'No' | null }) | null;
}

export interface ResumenIas {
  /** Estaciones con datos; AMG (máximo de la red) al final. */
  estaciones: string[];
  /** Meses `AAAA-MM` con datos de cada estación. */
  meses: Record<string, string[]>;
}

export const iasApi = {
  resumen: async (): Promise<ResumenIas> => (await api.get('/resumen')).data,

  categorias: async (estacion: string, mes: string): Promise<DiaIas[]> =>
    (await api.get('/categorias', { params: { estacion, mes } })).data.dias,

  /** Excel horario: indicadores, índice por contaminante y global, cumplimiento NOM. */
  urlHorario: '/api/ias/horario.xlsx',
  /** Excel diario: las 8 hojas (diaria, anuales, municipios y MIDE). */
  urlDiario: '/api/ias/diario.xlsx',
};
