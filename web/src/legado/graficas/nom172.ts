/**
 * Presentación de las categorías del índice Aire y Salud (NOM-172).
 *
 * El cálculo NO se hace aquí: lo hace el backend (backend/ias/calculo.py), el
 * mismo que produce los Excel horario y diario, para que pantalla y archivo
 * digan siempre lo mismo. Este módulo solo pone nombres, colores y textos.
 */
import type { Contaminante, DiaIas } from '../services/ias';

export const CATEGORIAS = [
  { nombre: 'Buena', color: '#00e400', texto: '#0f1b2d' },
  { nombre: 'Aceptable', color: '#ffff00', texto: '#0f1b2d' },
  { nombre: 'Mala', color: '#ff7e00', texto: '#0f1b2d' },
  { nombre: 'Muy Mala', color: '#ff0000', texto: '#ffffff' },
  { nombre: 'Extremadamente Mala', color: '#8f3f97', texto: '#ffffff' },
] as const;

export const CONTAMINANTES_INDICE: Contaminante[] = ['O3', 'NO2', 'SO2', 'CO', 'PM10', 'PM2.5'];

/** Cómo se escribe cada uno en pantalla, con subíndices. */
export const NOMBRE_CORTO: Record<Contaminante, string> = {
  O3: 'O₃', NO2: 'NO₂', SO2: 'SO₂', CO: 'CO', PM10: 'PM₁₀', 'PM2.5': 'PM₂.₅',
};

/** Un día con lo que las vistas derivan de él. */
export interface Dia extends DiaIas {
  /** Horas con categoría peor que la diaria. */
  horasPeores: number;
  /** La peor categoría horaria del día. */
  peorHora: number | null;
}

export function derivarDia(d: DiaIas): Dia {
  const cats = d.horas.map(h => h?.cat).filter((c): c is number => c !== null && c !== undefined);
  const peorHora = cats.length ? Math.max(...cats) : null;
  const diaria = d.diaria?.cat ?? null;
  const horasPeores = diaria === null ? 0 : cats.filter(c => c > diaria).length;
  return { ...d, horasPeores, peorHora };
}

// ── Utilidades de presentación ───────────────────────────────────────────────

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** `2024-03` → «marzo 2024». */
export function nombreMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} ${a}`;
}

/** Día de la semana abreviado de `AAAA-MM-DD`. */
export function diaSemana(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
}

/** La moda de una lista; null si está vacía. */
export function masFrecuente<T>(xs: T[]): T | null {
  const cuenta = new Map<T, number>();
  let mejor: T | null = null;
  let max = 0;
  for (const x of xs) {
    const n = (cuenta.get(x) ?? 0) + 1;
    cuenta.set(x, n);
    if (n > max) { max = n; mejor = x; }
  }
  return mejor;
}

/**
 * Tramos circulares de horas (0–23) que cumplen una condición; una franja que
 * cruza la medianoche sale entera. Del más largo al más corto.
 */
export function tramosCirculares(cumple: boolean[]): number[][] {
  if (cumple.every(Boolean)) return [Array.from({ length: 24 }, (_, h) => h)];
  const inicio = cumple.findIndex(c => !c);
  const tramos: number[][] = [];
  let actual: number[] = [];
  for (let k = 1; k <= 24; k++) {
    const h = (inicio + k) % 24;
    if (cumple[h]) actual.push(h);
    else if (actual.length) { tramos.push(actual); actual = []; }
  }
  if (actual.length) tramos.push(actual);
  return tramos.sort((a, b) => b.length - a.length);
}

/** `[6..12]` → «06:00–12:59»; `[16..23, 0]` → «16:00–00:59». */
export function textoTramo(horas: number[]): string {
  const hh = (h: number) => String(h).padStart(2, '0');
  return `${hh(horas[0])}:00–${hh(horas[horas.length - 1])}:59`;
}
