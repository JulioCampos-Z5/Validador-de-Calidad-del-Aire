/**
 * Registro del service worker.
 *
 * Se registra solo en la web compilada, y por dos motivos distintos:
 *
 * En desarrollo estorba. Un worker cacheando delante de Vite hace que un
 * cambio guardado no se vea, y se acaba persiguiendo un error que ya estaba
 * corregido.
 *
 * En la app de escritorio no pinta nada. Ahí el servidor es local: no hay red
 * que se caiga ni latencia que ahorrar, y una caché que sobreviva a una
 * actualización de la app solo puede servir una versión vieja de la interfaz
 * contra un backend nuevo.
 */

function enEscritorio(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');
}

export function registrarServiceWorker(): void {
  if (!import.meta.env.PROD || enEscritorio()) return;
  if (!('serviceWorker' in navigator)) return;

  // Después de `load`: registrarlo antes compite por ancho de banda con lo que
  // la página necesita para pintarse.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Sin service worker la aplicación funciona igual, solo que sin caché.
      // No hay nada que avisar al usuario.
    });
  });
}
