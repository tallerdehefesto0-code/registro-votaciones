// drive-api.js — Llamadas de bajo nivel a la API de Google Drive v3 (REST con fetch).
//
// No sabe nada de elecciones, mesas ni de la interfaz: solo habla con Drive.
// Todas las funciones piden el token a auth.js (que lo renueva si venció).
//
// Con el permiso `drive.file` Drive solo "ve" archivos creados por esta app o
// elegidos por el usuario con el Picker; por eso listar() puede devolver menos
// de lo que hay realmente en una carpeta compartida.
//
// API pública:
//   metadatos(id)                              → { id, name, mimeType, version, modifiedTime, lastModifyingUser }
//   listar(carpetaId, { nombre, mimeType })    → [ metadatos ]
//   crearCarpeta(nombre, padreId?)             → metadatos
//   crearJSON(nombre, padreId, objeto)         → metadatos
//   leerJSON(id)                               → { datos, version, modificado, modificadoPor }
//   actualizarJSON(id, objeto, versionEsperada?) → metadatos nuevos (lanza 409 si el archivo cambió)

import { obtenerToken } from './auth.js';

const API    = 'https://www.googleapis.com/drive/v3';
const SUBIDA = 'https://www.googleapis.com/upload/drive/v3';
export const MIME_CARPETA = 'application/vnd.google-apps.folder';

const CAMPOS = 'id,name,mimeType,version,modifiedTime,lastModifyingUser(emailAddress,displayName)';
const F      = encodeURIComponent(CAMPOS);
const JSON_H = { 'Content-Type': 'application/json; charset=UTF-8' };

export class DriveError extends Error {
  constructor(status, mensaje, detalle = '') {
    super(mensaje);
    this.name = 'DriveError';
    this.status = status;     // 0 = sin conexión
    this.detalle = detalle;   // texto técnico de Google, útil para depurar
  }
}

const MENSAJES = {
  401: 'La sesión de Google venció. Vuelve a iniciar sesión.',
  403: 'Drive negó el permiso. Revisa que tengas acceso de editor a la carpeta y que hayas aceptado el permiso de Drive.',
  404: 'No se encontró el archivo, o la app no tiene acceso a él (elígelo con el selector de Drive).',
  429: 'Demasiadas solicitudes a Drive. Espera un momento e intenta de nuevo.',
};

// Una sola puerta de salida: añade el token y traduce los errores.
async function pedir(url, opciones = {}) {
  const token = await obtenerToken();
  let r;
  try {
    r = await fetch(url, {
      ...opciones,
      headers: { ...opciones.headers, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new DriveError(0, 'Sin conexión con Google Drive.');
  }
  if (r.ok) return r;

  let detalle = '';
  try { detalle = (await r.json()).error?.message || ''; } catch { /* sin cuerpo */ }
  throw new DriveError(r.status, MENSAJES[r.status] || `Error de Drive (${r.status}).`, detalle);
}

// Escapa comillas y barras para usar un texto dentro de una consulta q='...'
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function metadatos(id) {
  const r = await pedir(`${API}/files/${encodeURIComponent(id)}?fields=${F}`);
  return r.json();
}

export async function listar(carpetaId, { nombre, mimeType } = {}) {
  const partes = [`'${esc(carpetaId)}' in parents`, 'trashed=false'];
  if (nombre)   partes.push(`name='${esc(nombre)}'`);
  if (mimeType) partes.push(`mimeType='${esc(mimeType)}'`);
  const q      = encodeURIComponent(partes.join(' and '));
  const campos = encodeURIComponent(`nextPageToken,files(${CAMPOS})`);

  const salida = [];
  let pagina = '';
  do {
    const r = await pedir(`${API}/files?q=${q}&pageSize=200&orderBy=name&fields=${campos}${pagina}`);
    const d = await r.json();
    salida.push(...(d.files || []));
    pagina = d.nextPageToken ? `&pageToken=${encodeURIComponent(d.nextPageToken)}` : '';
  } while (pagina);
  return salida;
}

export async function crearCarpeta(nombre, padreId) {
  const cuerpo = { name: nombre, mimeType: MIME_CARPETA };
  if (padreId) cuerpo.parents = [padreId];
  const r = await pedir(`${API}/files?fields=${F}`, {
    method: 'POST', headers: JSON_H, body: JSON.stringify(cuerpo),
  });
  return r.json();
}

// Subida "multipart": una parte con los metadatos y otra con el contenido JSON.
export async function crearJSON(nombre, padreId, objeto) {
  const frontera = 'votaciones' + Math.random().toString(36).slice(2);
  const meta = { name: nombre, mimeType: 'application/json', parents: [padreId] };
  const cuerpo =
    `--${frontera}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${frontera}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(objeto)}\r\n` +
    `--${frontera}--`;
  const r = await pedir(`${SUBIDA}/files?uploadType=multipart&fields=${F}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${frontera}` },
    body: cuerpo,
  });
  return r.json();
}

// Primero los metadatos y luego el contenido: si alguien guarda entre ambas
// llamadas, la versión que devolvemos queda "vieja" y el siguiente guardado
// avisará de conflicto (falla hacia el lado seguro).
export async function leerJSON(id) {
  const meta = await metadatos(id);
  const r = await pedir(`${API}/files/${encodeURIComponent(id)}?alt=media`);
  return {
    datos:         JSON.parse(await r.text()),
    version:       meta.version,
    modificado:    meta.modifiedTime,
    modificadoPor: meta.lastModifyingUser?.emailAddress || '',
  };
}

// Control de versiones optimista: si se pasa `versionEsperada` y el archivo en
// Drive ya tiene otra versión, no se sobrescribe y se lanza un error 409.
// Limitación: entre la comprobación y la escritura hay una ventana de milisegundos;
// es un aviso entre registrados, no un bloqueo absoluto (como pide el plan).
export async function actualizarJSON(id, objeto, versionEsperada) {
  if (versionEsperada != null) {
    const actual = await metadatos(id);
    if (String(actual.version) !== String(versionEsperada)) {
      throw new DriveError(
        409,
        `Conflicto: ${actual.lastModifyingUser?.emailAddress || 'otra persona'} modificó este archivo en Drive. Descarga la versión nueva antes de guardar.`,
      );
    }
  }
  const r = await pedir(`${SUBIDA}/files/${encodeURIComponent(id)}?uploadType=media&fields=${F}`, {
    method: 'PATCH', headers: JSON_H, body: JSON.stringify(objeto),
  });
  return r.json();
}
