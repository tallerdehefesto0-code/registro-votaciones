// Guardado local con IndexedDB: un solo registro "estado" con todos los datos.
let dbp;
const abrir = () => dbp ||= new Promise((ok, err) => {
  const r = indexedDB.open('votaciones', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => err(r.error);
});
export async function cargar() {
  const db = await abrir();
  return new Promise((ok, err) => {
    const q = db.transaction('kv').objectStore('kv').get('estado');
    q.onsuccess = () => ok(q.result);
    q.onerror = () => err(q.error);
  });
}
export async function guardar(estado) {
  const db = await abrir();
  return new Promise((ok, err) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(estado, 'estado');
    t.oncomplete = ok;
    t.onerror = () => err(t.error);
  });
}
