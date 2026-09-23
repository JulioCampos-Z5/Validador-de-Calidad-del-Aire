// Constantes compartidas: paleta de colores de estaciones y metadatos de parámetros.
// Fuente de verdad para componentes de gráficas (LineCharts, StatCharts, etc.).

export const CONTAMINANTES = ['O3', 'NO', 'NO2', 'NOX', 'SO2', 'CO', 'PM10', 'PM2.5'] as const;
export const METEOROLOGICOS = ['IT', 'ET', 'RH', 'WS', 'WD', 'PP', 'ATM', 'RS', 'UVI'] as const;

// Paleta fija por estación — mandatada por el revisor técnico.
export const COLORES_ESTACIONES: Record<string, string> = {
  SMT: '#1f77b4',
  VAL: '#d62728',
  AGU: '#2ca02c',
  ATM: '#ff7f0e',
  COU: '#9467bd',
  CEN: '#17becf',
  OBL: '#e377c2',
  LDO: '#8c564b',
  TLA: '#bcbd22',
  MIR: '#7f7f7f',
  PIN: '#2b8cbe',
  SFE: '#e6550d',
  SAN: '#31a354',
  Mean: '#000000',
};

interface ParamInfo {
  unit: string;
  name: string;
}

const PARAM_INFO: Record<string, ParamInfo> = {
  O3:    { unit: 'ppm',   name: 'Ozono (O3)' },
  NO:    { unit: 'ppm',   name: 'Monóxido de Nitrógeno (NO)' },
  NO2:   { unit: 'ppm',   name: 'Bióxido de Nitrógeno (NO2)' },
  NOX:   { unit: 'ppm',   name: 'Óxidos de Nitrógeno (NOx)' },
  SO2:   { unit: 'ppm',   name: 'Bióxido de Azufre (SO2)' },
  CO:    { unit: 'ppm',   name: 'Monóxido de Carbono (CO)' },
  PM10:  { unit: 'µg/m³', name: 'Partículas menores a 10 micras (PM10)' },
  'PM2.5': { unit: 'µg/m³', name: 'Partículas menores a 2.5 micras (PM2.5)' },
  IT:    { unit: '°C',    name: 'Temperatura Interna (IT)' },
  ET:    { unit: '°C',    name: 'Temperatura Externa (ET)' },
  RH:    { unit: '%',     name: 'Humedad Relativa (RH)' },
  WS:    { unit: 'm/s',   name: 'Velocidad del Viento (WS)' },
  WD:    { unit: 'Grados', name: 'Dirección del Viento (WD)' },
  PP:    { unit: 'mm',    name: 'Precipitación Pluvial (PP)' },
  ATM:   { unit: 'mmHg',  name: 'Presión Atmosférica (ATM)' },
  RS:    { unit: 'W/m²',  name: 'Radiación Solar (RS)' },
  UVI:   { unit: 'mW/m²', name: 'Índice UV (UVI)' },
};

export function getUnitsAndName(param: string): ParamInfo {
  return PARAM_INFO[param] ?? { unit: '', name: param };
}

export function getAxisLabel(params: string[]): string {
  if (params.length === 0) return 'Valor';
  return params
    .map(p => {
      const info = getUnitsAndName(p);
      return info.unit ? `${info.name} [${info.unit}]` : info.name;
    })
    .join(' / ');
}

export function isMeteorologico(param: string): boolean {
  return (METEOROLOGICOS as readonly string[]).includes(param);
}

// ── Índice Aire y Salud ──────────────────────────────────────────────────────
// Límites superiores de cada categoría, en las unidades de los datos (ppm y
// µg/m³). Los usan el calendario y el fondo de las series.

// Umbrales de referencia anteriores a la NOM-172 (los de Redspira). Siguen
// aquí porque la norma nueva solo cambió las partículas: para O3, NO2, SO2 y
// CO estos son los únicos que hay.

export const UMBRALES: Record<string, number[]> = {
  'PM2.5': [25, 45, 79, 147],
  PM10:   [50, 75, 155, 235],
  O3:     [0.051, 0.070, 0.092, 0.114],
  NO2:    [0.107, 0.210, 0.230, 0.250],
  SO2:    [0.040, 0.075, 0.185, 0.304],
  CO:     [8.75, 11, 13.3, 15.5],
};

/**
 * Umbrales de la NOM-172-SEMARNAT-2023, vigentes desde enero de 2026.
 *
 * Se aplican siempre que existen para el parámetro, sin opción de volver a los
 * anteriores: son los que están en vigor, y dejar elegir invitaba a leer un
 * mes de 2026 con la vara de 2025 —y a que dos personas mirando la misma
 * pantalla vieran categorías distintas para el mismo dato.
 *
 * Solo cubren partículas; el resto de contaminantes sigue con `UMBRALES`.
 */
export const UMBRALES_2026: Record<string, number[]> = {
  'PM2.5': [15, 25, 79, 130],
  PM10:   [45, 50, 132, 213],
};

/** Los límites vigentes de un contaminante, o undefined si no tiene índice. */
export function umbralesIndice(param: string): number[] | undefined {
  return UMBRALES_2026[param] ?? UMBRALES[param];
}

/**
 * Colores y nombres de las categorías tal como los publica Jalisco en
 * aire.jalisco.gob.mx/contaysalud (escala IMECA de su página). Solo se usan las
 * cinco primeras: los umbrales de la NOM-172 tienen cuatro cortes.
 */
export const CATEGORIAS_INDICE_JALISCO: { nombre: string; color: string }[] = [
  { nombre: 'Buena', color: '#339933' },
  { nombre: 'Regular', color: '#FFCC00' },  // «Aceptable» en partículas (NOM-172-2023)
  { nombre: 'Mala', color: '#FF6600' },
  { nombre: 'Muy mala', color: '#CC0000' },
  { nombre: 'Extremadamente mala', color: '#993399' },
];
