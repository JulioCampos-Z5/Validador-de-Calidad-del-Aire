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

// Índices ya armados, por arreglo de filas. Las gráficas piden la serie de la
// misma estación una vez por parámetro (y Comportamiento horario, por los 17
// para saber cuáles se miden): sin esto, cada pedido volvía a formar la marca
// de tiempo de todas las filas. Con un año de la red eran ~1.8 millones de
// cadenas y más de un segundo con la página congelada al abrir la pestaña.
// Se indexa por identidad del arreglo, así que supone que no se modifica
// después de pedir su índice; las gráficas lo arman una vez en un useMemo.
const indices = new WeakMap<Registro[], Map<string, Registro>>();

/** Índice hora → registro, para colocar una estación sobre la rejilla. */
export function porHora(filas: Registro[]): Map<string, Registro> {
  let indice = indices.get(filas);
  if (indice) return indice;
  indice = new Map<string, Registro>();
  for (const fila of filas) indice.set(marcaDeTiempo(fila), fila);
  indices.set(filas, indice);
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
 * Promedio móvil de `ventana` horas, sobre una serie ya puesta en la rejilla.
 *
 * El valor de la hora i es la media de las horas [i - ventana + 1, i], como
 * lo reportan los índices (el promedio de 8 h de las 14:00 cubre 07:00–14:00).
 * Se exige el 75 % de la ventana con dato; con menos, esa hora queda en `null`
 * en vez de dar un promedio que en realidad son dos lecturas sueltas.
 */
export function promedioMovil(
  valores: (number | null)[],
  ventana: number,
  suficiencia = 0.75,
): (number | null)[] {
  const minimo = Math.ceil(ventana * suficiencia);
  const salida: (number | null)[] = new Array(valores.length).fill(null);
  let suma = 0;
  let cuantas = 0;
  for (let i = 0; i < valores.length; i++) {
    const entra = valores[i];
    if (entra !== null) { suma += entra; cuantas++; }
    const sale = i - ventana >= 0 ? valores[i - ventana] : null;
    if (sale !== null) { suma -= sale; cuantas--; }
    if (i >= ventana - 1 && cuantas >= minimo) salida[i] = suma / cuantas;
  }
  return salida;
}

/**
 * NowCast de partículas sobre las últimas 12 horas (método de la EPA, el que
 * retoma la NOM-172 para PM10 y PM2.5).
 *
 * El peso w = mín/máx de la ventana, con piso de 0.5, y cada hora hacia atrás
 * pesa w veces la siguiente. Así, si la concentración cambia rápido, el
 * NowCast sigue a las horas recientes; si está estable, se parece al promedio.
 * Requiere dato en al menos dos de las tres horas más recientes.
 */
export function nowcast(valores: (number | null)[]): (number | null)[] {
  return valores.map((_, i) => {
    const recientes = [valores[i], valores[i - 1], valores[i - 2]]
      .filter(v => v !== null && v !== undefined).length;
    if (recientes < 2) return null;

    const ventana: (number | null)[] = [];
    for (let k = 0; k < 12; k++) ventana.push(i - k >= 0 ? valores[i - k] : null);
    const datos = ventana.filter((v): v is number => v !== null);
    const max = Math.max(...datos);
    const min = Math.min(...datos);
    const w = max <= 0 ? 1 : Math.max(min / max, 0.5);

    let num = 0;
    let den = 0;
    ventana.forEach((v, k) => {
      if (v === null) return;
      const peso = w ** k;
      num += peso * v;
      den += peso;
    });
    return den > 0 ? num / den : null;
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
