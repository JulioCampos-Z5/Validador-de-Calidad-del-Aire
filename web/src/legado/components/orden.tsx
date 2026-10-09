import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

/**
 * Orden por columna para las tablas: un clic en el título ordena de menor a
 * mayor, otro de mayor a menor y el tercero vuelve al orden original.
 *
 * Los números se comparan como números (también "12" frente a "9"), el texto
 * con la intercalación del español. En una columna de números, el texto
 * (p. ej. las banderas IR, ND) va después de los números, y lo vacío al final,
 * en los dos sentidos.
 */

export type Direccion = 'asc' | 'desc';
export interface Orden { clave: string; dir: Direccion }

const vacio = (v: unknown) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));

export function comparar(a: unknown, b: unknown): number {
  if (vacio(a) || vacio(b)) return vacio(a) === vacio(b) ? 0 : vacio(a) ? 1 : -1;
  const na = typeof a === 'number' ? a : Number(a);
  const nb = typeof b === 'number' ? b : Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && typeof a !== 'boolean') return na - nb;
  return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
}

const esNumero = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)));
// 0 número, 1 texto, 2 vacío: entre grupos distintos el orden no se invierte.
const grupo = (v: unknown) => (vacio(v) ? 2 : esNumero(v) ? 0 : 1);

export function ordenar<T>(filas: T[], orden: Orden | null, valor: (fila: T, clave: string) => unknown): T[] {
  if (!orden) return filas;
  const signo = orden.dir === 'asc' ? 1 : -1;
  return filas
    .map((f, i) => ({ f, i }))
    .sort((x, y) => {
      const va = valor(x.f, orden.clave), vb = valor(y.f, orden.clave);
      if (grupo(va) !== grupo(vb)) return grupo(va) - grupo(vb);
      return signo * comparar(va, vb) || x.i - y.i;
    })
    .map(({ f }) => f);
}

export function useOrden<T>(filas: T[], valor: (fila: T, clave: string) => unknown = (f, c) => (f as Record<string, unknown>)[c]) {
  const [orden, setOrden] = useState<Orden | null>(null);
  const ordenadas = useMemo(() => ordenar(filas, orden, valor), [filas, orden]); // eslint-disable-line react-hooks/exhaustive-deps
  const alternar = (clave: string) => setOrden(o =>
    o?.clave !== clave ? { clave, dir: 'asc' } : o.dir === 'asc' ? { clave, dir: 'desc' } : null);
  return { ordenadas, orden, alternar };
}

/** Contenido de un <th> ordenable: el título como botón y la flecha del sentido. */
export function TituloOrden({ clave, orden, alternar, children, derecha }: {
  clave: string;
  orden: Orden | null;
  alternar: (clave: string) => void;
  children: ReactNode;
  derecha?: boolean;
}) {
  const activo = orden?.clave === clave;
  const Icono = !activo ? ArrowUpDown : orden.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => alternar(clave)}
      className={`inline-flex items-center gap-1 hover:opacity-80 ${derecha ? 'flex-row-reverse' : ''}`}
      title={!activo ? 'Ordenar' : orden.dir === 'asc' ? 'De menor a mayor (clic: de mayor a menor)' : 'De mayor a menor (clic: quitar orden)'}
    >
      {children}
      <Icono className={`w-3 h-3 shrink-0 ${activo ? '' : 'opacity-40'}`} aria-hidden />
    </button>
  );
}

/** Valor de aria-sort para el <th>. */
export const ariaOrden = (orden: Orden | null, clave: string) =>
  orden?.clave === clave ? (orden.dir === 'asc' ? 'ascending' : 'descending') : undefined;
