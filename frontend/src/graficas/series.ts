/**
 * Utilidades de series temporales para las gráficas.
 *
 * El problema que resuelven
 * -------------------------
 * Los datos llegan como una lista de registros: si una estación no midió a las
 * 14:00, esa hora sencillamente no viene. Dibujando esa lista tal cual, Plotly
 * une el punto de las 13:00 con el de las 15:00 con una recta, y un hueco de
 * datos acaba pareciendo una medición que baja despacio. `connectgaps: false`
 * no lo evita: solo respeta los nulos que existen, y aquí no existe ni la fila.
 *
 * La solución es tener una rejilla horaria continua —todas las horas entre la
 * primera y la última del periodo— y colocar cada estación sobre ella. Las
 * horas sin dato quedan como `null`, que es lo que Plotly necesita para partir
 * la línea.
 *
 * Las horas se manejan como texto ISO sin zona (`2026-09-01T14:00:00`), que es
 * lo que ya usaban las gráficas. Para la aritmética se interpretan como UTC:
 * los datos vienen en hora local sin desplazamiento, y sumar horas en UTC evita
 * que un cambio de horario duplique o se salte una hora que en el archivo
 * existe una sola vez.
 */

export interface Registro {
  STATION: string;
  DATE: string;
  HOUR: number;
  [key: string]: string | number | null;
}

const HORA_MS = 3600000;

/** Una hora del rango es como máximo esto; más allá se deja de rellenar. */
const MAXIMO_REJILLA = 200000;

/** Marca de tiempo de un registro, en el mismo formato que usa Plotly. */
export function marcaDeTiempo(fila: Registro): string {
  return `${String(fila.DATE).split(' ')[0]}T${String(fila.HOUR).padStart(2, '0')}:00:00`;
}

function aMilisegundos(marca: string): number {
  return Date.parse(`${marca}Z`);
}

function aMarca(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

/** Solo los números sirven para dibujar; el resto es hueco. */
export function numero(valor: unknown): number | null {
  return typeof valor === 'number' && !Number.isNaN(valor) ? valor : null;
}

/**
 * Todas las horas entre la primera y la última del conjunto, sin saltos.
 *
 * Si el rango es tan largo que la rejilla se dispara —varios años de datos—,
 * devuelve las horas que de verdad existen: dibujar mal es preferible a colgar
 * el navegador, y con esa cantidad de puntos el hueco de una hora no se ve.
 */
export function rejillaHoraria(datos: Registro[]): string[] {
  let min = Infinity;
  let max = -Infinity;
  for (const fila of datos) {
    const t = aMilisegundos(marcaDeTiempo(fila));
    if (Number.isNaN(t)) continue;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];

  const cuantas = Math.floor((max - min) / HORA_MS) + 1;
  if (cuantas > MAXIMO_REJILLA) {
    return [...new Set(datos.map(marcaDeTiempo))].sort();
  }

  const horas: string[] = new Array(cuantas);
  for (let i = 0; i < cuantas; i++) horas[i] = aMarca(min + i * HORA_MS);
  return horas;
}

/** Índice hora → registro, para colocar una estación sobre la rejilla. */
export function porHora(filas: Registro[]): Map<string, Registro> {
  const indice = new Map<string, Registro>();
  for (const fila of filas) indice.set(marcaDeTiempo(fila), fila);
  return indice;
}

/**
 * Los valores de un parámetro sobre la rejilla, con `null` en los huecos.
 */
export function serieEnRejilla(
  filas: Registro[],
  rejilla: string[],
  parametro: string,
): (number | null)[] {
  const indice = porHora(filas);
  return rejilla.map((hora) => {
    const fila = indice.get(hora);
    return fila ? numero(fila[parametro]) : null;
  });
}

export type Agregado = 'promedio' | 'maximo';

/**
 * El valor de la zona metropolitana hora a hora: el promedio o el máximo de
 * cuantas estaciones midieron en esa hora.
 *
 * Una hora sin ninguna estación midiendo es `null`, no un cero: no es que la
 * zona tuviera cero, es que nadie midió, y esa diferencia es justo la que las
 * gráficas tienen que enseñar.
 */
export function agregadoZona(
  porEstacion: Record<string, Registro[]>,
  estaciones: string[],
  rejilla: string[],
  parametro: string,
  agregado: Agregado,
): (number | null)[] {
  const indices = estaciones.map((e) => porHora(porEstacion[e] || []));

  return rejilla.map((hora) => {
    let suma = 0;
    let cuantas = 0;
    let maximo = -Infinity;
    for (const indice of indices) {
      const fila = indice.get(hora);
      const valor = fila ? numero(fila[parametro]) : null;
      if (valor === null) continue;
      suma += valor;
      cuantas++;
      if (valor > maximo) maximo = valor;
    }
    if (cuantas === 0) return null;
    return agregado === 'promedio' ? suma / cuantas : maximo;
  });
}

/**
 * Promedio por hora del día (0–23) de una serie ya puesta sobre la rejilla.
 *
 * Devuelve también cuántos valores entraron en cada hora, que es lo que
 * permite distinguir un promedio sólido de uno hecho con dos datos sueltos.
 */
export function promedioPorHoraDelDia(
  rejilla: string[],
  valores: (number | null)[],
): { promedios: (number | null)[]; cuentas: number[] } {
  const sumas = new Array(24).fill(0);
  const cuentas = new Array(24).fill(0);

  rejilla.forEach((hora, i) => {
    const valor = valores[i];
    if (valor === null) return;
    const h = Number(hora.slice(11, 13));
    if (Number.isNaN(h)) return;
    sumas[h] += valor;
    cuentas[h]++;
  });

  return {
    promedios: sumas.map((s, h) => (cuentas[h] > 0 ? s / cuentas[h] : null)),
    cuentas,
  };
}
