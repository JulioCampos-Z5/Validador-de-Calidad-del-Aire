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
