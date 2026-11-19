// Permite usar la app sin internet.
// Con conexión siempre se pide la versión nueva de cada archivo (así los cambios llegan enseguida);
// sin conexión se usa la última copia guardada.
const CACHE = 'disenador-nebela';
const VERSION = '2026-11-19-matrices'; // cambiarlo en cada publicación hace que el celular instale la nueva enseguida

const FONTS = ['pacifico', 'dancing-script', 'great-vibes', 'sacramento', 'satisfy', 'cookie', 'courgette',
  'kaushan-script', 'lobster', 'caveat', 'patrick-hand', 'amatic-sc', 'playfair-display', 'poppins',
  'montserrat', 'quicksand', 'comfortaa', 'fredoka', 'baloo-2', 'oswald',
  'norican', 'yesteryear', 'oleo-script', 'pattaya', 'caveat-brush', 'kalam', 'knewave',
  'covered-by-your-grace', 'just-another-hand', 'sue-ellen-francisco', 'mali', 'barlow-semi-condensed'];

// Todo lo que la app necesita para funcionar sin conexión
const FILES = [
  './', 'index.html', 'movil.css', 'movil.js', 'manifest.webmanifest',
  'iconos/icono-180.png', 'iconos/icono-192.png', 'iconos/icono-512.png',
  '../comun/estilos.css',
  '../comun/js/app.js', '../comun/js/geometry.js', '../comun/js/trace.js', '../comun/js/text.js', '../comun/js/export.js', '../comun/js/matrix.js',
  '../comun/libs/three.module.js', '../comun/libs/OrbitControls.js', '../comun/libs/clipper.js',
  '../comun/libs/fflate.js', '../comun/libs/opentype.module.js',
  '../comun/fuentes/dm-sans-300.woff2', '../comun/fuentes/dm-sans-400.woff2', '../comun/fuentes/dm-sans-500.woff2',
  ...FONTS.map((f) => `../comun/fuentes/${f}.woff`),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    // "no-cache": siempre se pregunta al servidor si hay versión nueva. Si no, el celular
    // usa su copia guardada (GitHub Pages la deja 10 minutos) y los cambios tardan en llegar.
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
