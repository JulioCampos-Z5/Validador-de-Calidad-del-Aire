/*
 * Service worker del Validador.
 *
 * Hace dos cosas y ninguna más: que la aplicación abra al instante en visitas
 * siguientes, y que abra siquiera cuando la red está caída o el servidor no
 * responde. No es una app offline: sin backend no hay validación posible,
 * porque quien valida es Flask. Lo que se guarda es la cáscara —el HTML y los
 * bundles—, no los datos.
 *
 * Qué NO se guarda nunca
 * ----------------------
 * Todo lo que cuelga de /api. Ahí viven las consultas, la sesión de Emisiones
 * y los Excel generados: servir eso desde una caché significaría enseñar
 * mediciones viejas como si fueran las de ahora, que es justo el error que este
 * programa existe para detectar. Va siempre a la red, sin excepción.
 *
 * Cómo se actualiza
 * -----------------
 * Los bundles de Vite llevan el hash en el nombre, así que un archivo con un
 * nombre dado no cambia nunca: se pueden servir de caché sin mirar. El HTML sí
 * cambia —apunta a los bundles nuevos—, y por eso va a la red primero y solo
 * cae a la caché si la red falla. Al activarse una versión nueva se borran las
 * cachés de las anteriores; subir VERSION es lo único que hace falta para
 * forzar esa limpieza.
 */

const VERSION = 'v1';
const CACHE = `validador-${VERSION}`;

// La cáscara mínima para que la aplicación pinte algo sin red.
const BASICOS = ['/', '/icono.svg', '/manifest.json'];

self.addEventListener('install', (evento) => {
  // Se instala sin esperar a que se cierren las pestañas viejas: como el HTML
  // va a red primero, no hay riesgo de mezclar una versión con los bundles de
  // otra.
  self.skipWaiting();
  evento.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(BASICOS)).catch(() => {
      // Sin red en la primera visita no hay nada que precargar; se irá
      // llenando sobre la marcha.
    }),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(
      nombres.filter((n) => n.startsWith('validador-') && n !== CACHE)
        .map((n) => caches.delete(n)),
    );
    await self.clients.claim();
  })());
});

/** Guarda una respuesta buena, sin que un fallo de caché tumbe la petición. */
async function guardar(peticion, respuesta) {
  if (!respuesta || !respuesta.ok || respuesta.type === 'opaque') return respuesta;
  const copia = respuesta.clone();
  try {
    const cache = await caches.open(CACHE);
    await cache.put(peticion, copia);
  } catch {
    // Cuota llena o modo privado: se sirve igual, solo que sin guardar.
  }
  return respuesta;
}

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;

  // Datos, sesión y descargas: siempre a la red. Ver la cabecera.
  if (url.pathname.startsWith('/api/')) return;

  // El HTML va a la red primero para no quedarse en una versión vieja de la
  // aplicación; la caché es solo el paracaídas.
  if (peticion.mode === 'navigate') {
    evento.respondWith((async () => {
      try {
        return await guardar(peticion, await fetch(peticion));
      } catch {
        return (await caches.match(peticion)) || (await caches.match('/'))
          || Response.error();
      }
    })());
    return;
  }

  // El resto —bundles con hash, iconos, fuentes— de caché si está, y si no de
  // la red guardando una copia para la próxima.
  evento.respondWith((async () => {
    const guardada = await caches.match(peticion);
    if (guardada) return guardada;
    try {
      return await guardar(peticion, await fetch(peticion));
    } catch {
      return Response.error();
    }
  })());
});
