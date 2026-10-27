// Permite usar la app sin internet.
// Con conexión siempre se pide la versión nueva de cada archivo (así los cambios llegan enseguida);
// sin conexión se usa la última copia guardada.
const CACHE = 'disenador-nebela';

const FONTS = ['pacifico', 'dancing-script', 'great-vibes', 'sacramento', 'satisfy', 'cookie', 'courgette',
  'kaushan-script', 'lobster', 'caveat', 'patrick-hand', 'amatic-sc', 'playfair-display', 'poppins',
  'montserrat', 'quicksand', 'comfortaa', 'fredoka', 'baloo-2', 'oswald'];

// Todo lo que la app necesita para funcionar sin conexión
const FILES = [
  './', 'index.html', 'movil.css', 'movil.js', 'manifest.webmanifest',
  'iconos/icono-180.png', 'iconos/icono-192.png', 'iconos/icono-512.png',
  '../comun/estilos.css',
  '../comun/js/app.js', '../comun/js/geometry.js', '../comun/js/trace.js', '../comun/js/text.js', '../comun/js/export.js',
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
    fetch(e.request)
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
