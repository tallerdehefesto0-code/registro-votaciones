// Service worker: intenta la red primero y guarda copia; sin internet usa la copia guardada.
const V = 'votaciones-d13';
const F = ['./', 'index.html', 'manifest.json', 'css/styles.css',
  'js/app.js', 'js/calc.js', 'js/csv.js', 'js/db.js', 'js/excel.js', 'js/exportar.js', 'js/informes.js',
  'js/navegacion.js', 'js/pdf.js', 'js/seed.js', 'js/state.js',
  'js/ui-bitacora.js', 'js/ui-datos.js', 'js/ui-helpers.js', 'js/ui-reportes.js', 'js/ui-tabla.js', 'js/ui-tablero.js',
  'js/voz-motor.js', 'js/voz.js',
  'js/auth.js', 'js/config.js', 'js/ui-sesion.js',
  'js/drive-api.js', 'js/drive-picker.js', 'js/drive-store.js', 'js/ui-drive.js',
  'js/ui-avances.js', 'js/combinar.js', 'js/datos-oficiales.js',
  'datos/mesas-lambayeque.csv', 'datos/organizaciones-lambayeque-ferrenafe.csv','datos/organizaciones-chiclayo.csv',
  'vendor/exceljs.min.js', 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(V).then(c => c.addAll(F))); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => clients.claim())));
let sinRedHasta = 0; 
const ESPERA_RED = 3000;
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith((async () => {
    if (Date.now() < sinRedHasta) {
      const guardada = await caches.match(e.request);
      if (guardada) return guardada;
    }
    const red = fetch(e.request).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(V).then(c => c.put(e.request, copia)); }
      return r;
    });
    red.catch(() => {});   // evita avisos de error no atendido si solo se usa la copia
    const r = await Promise.race([red.catch(() => null), new Promise(res => setTimeout(res, ESPERA_RED, null))]);
    if (r) return r;
    sinRedHasta = Date.now() + 60000;
    return (await caches.match(e.request)) || red;   // sin copia: esperar a la red como antes
  })());
});
