/**
 * Bitácora en archivo (registro.log), aparte de main.mjs para poder probarla
 * sin arrancar Electron.
 *
 * La app instalada no tiene consola: sin esto, lo que el backend escribe y los
 * errores del arranque se pierden, y cuando algo falla en otra computadora no
 * hay de dónde sacar una pista.
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Al pasar de este tamaño se aparta como registro.log.1 (se conserva solo esa
// copia) para que el archivo no crezca sin límite en equipos que nunca se
// reinstalan.
export const LIMITE_BYTES = 5 * 1024 * 1024;

const dos = (n) => String(n).padStart(2, '0');

/** Fecha y hora local, que es la que el usuario ve en su reloj. */
export function marcaDeTiempo(d = new Date()) {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} `
    + `${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}

/**
 * Abre (o crea) registro.log dentro de `carpeta`.
 *
 * Nunca lanza: si no se puede escribir, la app sigue funcionando igual, solo
 * que sin bitácora.
 */
export function crearBitacora(carpeta, nombre = 'registro.log') {
  const ruta = join(carpeta, nombre);
  try {
    mkdirSync(carpeta, { recursive: true });
    if (statSync(ruta).size > LIMITE_BYTES) renameSync(ruta, ruta + '.1');
  } catch {
    // No existe todavía, o no se pudo rotar: se escribe igual.
  }

  function escribir(nivel, ...partes) {
    const texto = partes
      .map((p) => (p instanceof Error ? p.stack || p.message : String(p)))
      .join(' ');
    try {
      appendFileSync(ruta, `${marcaDeTiempo()} [${nivel}] ${texto}\n`, 'utf8');
    } catch {
      // Sin permiso o disco lleno: no hay a dónde avisar.
    }
  }

  /**
   * Devuelve una función para `proceso.stdout.on('data', ...)`. Junta los
   * pedazos hasta tener líneas completas, porque un 'data' puede cortar una
   * línea a la mitad.
   */
  function flujo(nivel) {
    let pendiente = '';
    return (datos) => {
      pendiente += String(datos);
      const lineas = pendiente.split(/\r?\n/);
      pendiente = lineas.pop();
      for (const l of lineas) if (l.trim()) escribir(nivel, l);
    };
  }

  return {
    ruta,
    info: (...p) => escribir('INFO', ...p),
    aviso: (...p) => escribir('AVISO', ...p),
    error: (...p) => escribir('ERROR', ...p),
    flujo,
  };
}
