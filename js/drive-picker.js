// drive-picker.js — Selector de Google Drive (Google Picker).
//
// Con el permiso `drive.file`, la app solo accede a lo que el usuario elige aquí.
// Es el mecanismo para que un registrado "abra" la carpeta que creó otra persona.
//
// Requisitos (config.js): GOOGLE_API_KEY y GOOGLE_APP_ID (= número del proyecto de
// Google Cloud). Sin el App ID, el Picker abre pero Drive NO concede acceso a lo
// elegido.
//
// API pública:
//   elegirCarpeta()           → { id, nombre } o null si se cancela
//   elegirArchivos(carpetaId) → [ { id, nombre } ] (varios a la vez) o null si se cancela

import { obtenerToken } from './auth.js';
import { GOOGLE_API_KEY, GOOGLE_APP_ID } from './config.js';

const GAPI_URL = 'https://apis.google.com/js/api.js';
let promesaPicker = null;

// Carga perezosa: solo cuando el usuario abre el selector.
function cargarPicker() {
  if (window.google?.picker) return Promise.resolve();
  return promesaPicker ||= new Promise((ok, err) => {
    const fallo = () => { promesaPicker = null; err(new Error('No se pudo cargar el selector de Drive. Revisa tu conexión.')); };
    const cargar = () => window.gapi.load('picker', { callback: ok, onerror: fallo });
    if (window.gapi?.load) return cargar();
    const s = document.createElement('script');
    s.src = GAPI_URL;
    s.async = true;
    s.onload = cargar;
    s.onerror = fallo;
    document.head.appendChild(s);
  });
}

function validarConfig() {
  if (!GOOGLE_API_KEY || !GOOGLE_APP_ID || /NÚMERO|NUMERO|PEGA/i.test(GOOGLE_APP_ID)) {
    throw new Error('Falta configurar GOOGLE_API_KEY y GOOGLE_APP_ID (número del proyecto) en config.js.');
  }
}

// Abre el Picker con las vistas indicadas y devuelve los documentos elegidos.
async function abrir(crearVistas, { titulo, multiple = false }) {
  validarConfig();
  await cargarPicker();
  const token = await obtenerToken();
  const g = window.google.picker;

  return new Promise(ok => {
    const b = new g.PickerBuilder()
      .setAppId(GOOGLE_APP_ID)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setTitle(titulo)
      .setLocale('es')
      .setCallback(d => {
        if (d.action === g.Action.PICKED) ok(d.docs.map(x => ({ id: x.id, nombre: x.name })));
        else if (d.action === g.Action.CANCEL) ok(null);
      });
    crearVistas(g).forEach(v => b.addView(v));
    if (multiple) b.enableFeature(g.Feature.MULTISELECT_ENABLED);
    b.build().setVisible(true);
  });
}

export async function elegirCarpeta() {
  const r = await abrir(g => [
    new g.DocsView(g.ViewId.FOLDERS).setSelectFolderEnabled(true).setIncludeFolders(true).setOwnedByMe(false),
  ], { titulo: 'Elige la carpeta de la elección' });
  return r ? r[0] : null;
}

// Plan B: si elegir la carpeta no basta para ver sus archivos, se eligen los
// archivos de dentro (se puede marcar varios a la vez).
export function elegirArchivos(carpetaId) {
  return abrir(g => [
    new g.DocsView(g.ViewId.DOCS).setParent(carpetaId).setIncludeFolders(false).setMode(g.DocsViewMode.LIST),
  ], { titulo: 'Marca los archivos de la carpeta', multiple: true });
}
