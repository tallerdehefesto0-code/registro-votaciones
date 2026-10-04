// Service worker: intenta la red primero y guarda copia; sin internet usa la copia guardada.
const V = 'votaciones-d6';
const F = ['./', 'index.html', 'manifest.json', 'css/styles.css',
  'js/app.js', 'js/calc.js', 'js/csv.js', 'js/db.js', 'js/excel.js', 'js/exportar.js', 'js/informes.js',
  'js/navegacion.js', 'js/pdf.js', 'js/seed.js', 'js/state.js',
  'js/ui-bitacora.js', 'js/ui-datos.js', 'js/ui-helpers.js', 'js/ui-reportes.js', 'js/ui-tabla.js', 'js/ui-tablero.js',
  'js/voz-motor.js', 'js/voz.js',
  'js/auth.js', 'js/config.js', 'js/ui-sesion.js',
  'js/drive-api.js', 'js/drive-picker.js', 'js/drive-store.js', 'js/ui-drive.js',
  'vendor/exceljs.min.js', 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(V).then(c => c.addAll(F))); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(e.request).then(r => { const copia = r.clone(); caches.open(V).then(c => c.put(e.request, copia)); return r; })
    .catch(() => caches.match(e.request)));
});
