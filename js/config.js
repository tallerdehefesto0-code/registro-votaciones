// config.js — Ajustes de Google para el Prototipo D.
//
// El ID de cliente NO es un secreto: va en el navegador y Google solo lo acepta
// desde los orígenes que autorizaste en Google Cloud. Lo que sí nunca debe
// subirse a ningún repositorio es un "client secret" (esta app no usa ninguno).

// Pega aquí el ID de cliente que te da Google Cloud (termina en .apps.googleusercontent.com)
export const GOOGLE_CLIENT_ID = '1042398302686-bi1ik0oo4q201enjomgi9nsguvllgoue.apps.googleusercontent.com';

// Identidad: correo y nombre del usuario (para la bitácora).
export const SCOPES_IDENTIDAD = 'openid email profile';

// Drive: solo archivos creados por la app o elegidos con el selector (Picker).
export const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive.file';

// Selector de Drive (Paso 3). La clave es pública por diseño: la protege su restricción por sitio web.
export const GOOGLE_API_KEY = 'AIzaSyDK2IirL_3kQGTnm4b5pCqSUvXIFg10x8Q';

export const GOOGLE_APP_ID  = '1042398302686';
