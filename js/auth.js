// auth.js — Sesión con Google Identity Services (modelo de token de acceso).
//
// Responsabilidades:
//   • Cargar la librería de Google solo cuando hace falta (la app sigue
//     funcionando sin internet porque nada se carga al arrancar).
//   • Iniciar y cerrar sesión; saber quién es el usuario actual.
//   • Entregar un token de acceso válido a quien lo necesite (Drive, Paso 3).
//
// Decisiones de seguridad:
//   • El token vive SOLO en memoria: al recargar la página se descarta.
//   • En el dispositivo solo se guarda el perfil (correo y nombre), para poder
//     atribuir eventos de la bitácora aunque no haya internet.
//   • Al renovar el token se comprueba que siga siendo la misma cuenta.
//
// API pública:
//   iniciarAuth()      → lee el perfil guardado (síncrona, sin red)
//   iniciarSesion()    → abre el selector de cuenta de Google (llamar desde un clic)
//   cerrarSesion()     → olvida perfil y token de este dispositivo
//   usuarioActual()    → { email, nombre, drive } o null
//   obtenerToken()     → token válido (lo renueva si venció)
//   onSesion(fn)       → avisa cuando cambia la sesión; devuelve la función para darse de baja

import { GOOGLE_CLIENT_ID, SCOPES_IDENTIDAD, SCOPE_DRIVE } from './config.js';

const GIS_URL      = 'https://accounts.google.com/gsi/client';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const CLAVE_PERFIL = 'votaciones.perfil';
const SCOPES       = `${SCOPES_IDENTIDAD} ${SCOPE_DRIVE}`;

let perfil       = null;   // { email, nombre, drive }  (drive = ¿concedió el permiso de Drive?)
let token        = null;   // { valor, expira }          (solo en memoria)
let clienteToken = null;   // cliente de Google ya inicializado
let promesaGIS   = null;   // carga de la librería en curso
let solicitud    = null;   // petición de token en curso (evita ventanas duplicadas)
let pendiente    = null;   // { ok, err } de la petición en curso
const oyentes    = new Set();

function avisar() {
  const copia = usuarioActual();
  oyentes.forEach(fn => { try { fn(copia); } catch (e) { console.error(e); } });
}

// ─── Carga perezosa de la librería de Google ─────────────────────────────────
function cargarGIS() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return promesaGIS ||= new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = GIS_URL;
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => {
      promesaGIS = null;
      err(new Error('No se pudo cargar Google. Revisa tu conexión a internet.'));
    };
    document.head.appendChild(s);
  });
}

async function asegurarCliente() {
  await cargarGIS();
  clienteToken ||= window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: resp => {
      const p = pendiente; pendiente = null;
      if (!p) return;
      if (resp.error) p.err(new Error(resp.error_description || resp.error));
      else p.ok(resp);
    },
    error_callback: e => {
      const p = pendiente; pendiente = null;
      if (!p) return;
      const msg =
        e?.type === 'popup_closed'          ? 'Cerraste la ventana de Google antes de terminar.' :
        e?.type === 'popup_failed_to_open'  ? 'El navegador bloqueó la ventana de Google. Intenta de nuevo con el botón.' :
                                              'Error de Google: ' + (e?.type || 'desconocido');
      p.err(new Error(msg));
    },
  });
  return clienteToken;
}

// Pide un token a Google. Si ya hay una petición en curso, comparte su resultado.
function pedirToken(opciones) {
  if (solicitud) return solicitud;
  solicitud = (async () => {
    const c = await asegurarCliente();
    return new Promise((ok, err) => {
      pendiente = { ok, err };
      c.requestAccessToken(opciones);
    });
  })().finally(() => { solicitud = null; });
  return solicitud;
}

function guardarToken(resp) {
  // Se descuentan 60 s para no usar un token justo cuando está por vencer.
  token = {
    valor:  resp.access_token,
    expira: Date.now() + (Number(resp.expires_in) - 60) * 1000,
  };
}

function concedioDrive(resp) {
  return window.google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE_DRIVE);
}

async function leerPerfil(accessToken) {
  const r = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error('Google no devolvió los datos de la cuenta.');
  const d = await r.json();
  if (!d.email) throw new Error('No se pudo leer el correo de la cuenta. Acepta todos los permisos solicitados.');
  return { email: d.email, nombre: d.name || d.email };
}

function persistirPerfil() {
  try {
    if (perfil) localStorage.setItem(CLAVE_PERFIL, JSON.stringify(perfil));
    else        localStorage.removeItem(CLAVE_PERFIL);
  } catch { /* modo privado o almacenamiento bloqueado: la sesión dura hasta recargar */ }
}

// ─── API pública ─────────────────────────────────────────────────────────────
export function iniciarAuth() {
  try { perfil = JSON.parse(localStorage.getItem(CLAVE_PERFIL)); } catch { perfil = null; }
  if (!perfil || !perfil.email) perfil = null;
  return usuarioActual();
}

export function usuarioActual() {
  return perfil ? { ...perfil } : null;
}

export function onSesion(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

// Debe llamarse desde un clic del usuario (si no, el navegador bloquea la ventana).
export async function iniciarSesion() {
  const resp = await pedirToken({ prompt: 'select_account' });
  guardarToken(resp);
  const datos = await leerPerfil(resp.access_token);
  perfil = { ...datos, drive: concedioDrive(resp) };
  persistirPerfil();
  avisar();
  return usuarioActual();
}

// No revoca los permisos en Google: solo olvida la sesión en este dispositivo.
// (Revocar obligaría a volver a dar consentimiento completo en cada ingreso.)
export function cerrarSesion() {
  token  = null;
  perfil = null;
  persistirPerfil();
  avisar();
}

// Devuelve un token vigente. Si venció, pide otro sin cambiar de cuenta.
export async function obtenerToken() {
  if (!perfil) throw new Error('Inicia sesión con Google primero.');
  if (token && Date.now() < token.expira) return token.valor;

  const resp  = await pedirToken({ prompt: '', login_hint: perfil.email });
  const datos = await leerPerfil(resp.access_token);
  if (datos.email !== perfil.email) {
    throw new Error(`La sesión de Google cambió a otra cuenta (${datos.email}). Vuelve a iniciar sesión.`);
  }
  guardarToken(resp);
  perfil.drive = concedioDrive(resp);
  persistirPerfil();
  return token.valor;
}
