/**
 * Comprobaciones de seguridad de la ventana, aparte de main.mjs para poder
 * probarlas sin arrancar Electron.
 */

/** Si la dirección es una página web normal (http o https). */
export function esWeb(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
