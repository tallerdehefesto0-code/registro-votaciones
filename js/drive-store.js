// drive-store.js — Estructura de la elección en Drive y guardado/lectura de archivos JSON.
//
// Estructura (sección 6 del plan):
//   Votaciones/<elección>/
//     ├─ mesas/  respaldos/  exportaciones/
//     └─ configuracion.json, consolidado-*.json, ... (los crean los pasos 4 y 5)
//
// Usa drive-api.js (REST) y drive-picker.js (selector). No toca la interfaz ni el
// estado de la app: solo sabe de carpetas y archivos.
//
// La carpeta de la elección en uso se recuerda en este dispositivo (localStorage).
//
// API pública:
//   eleccionActual()                  → { id, nombre } o null
//   olvidarEleccion()
//   crearEleccion(nombre)             → crea Votaciones/<nombre>/ con sus subcarpetas
//   elegirEleccion()                  → abre el Picker y recuerda la carpeta elegida
//   estructura()                      → { eleccion, carpetas: {nombre: id}, archivos: [metadatos] }
//   guardarJSON(carpetaId, nombre, objeto, versionEsperada?)  → crea o actualiza
//   leerJSON(carpetaId, nombre)       → { id, nombre, datos, version, modificado, modificadoPor } o null

import * as api from './drive-api.js';
import { elegirCarpeta } from './drive-picker.js';

const CLAVE        = 'votaciones.eleccion';
const RAIZ         = 'Votaciones';
const SUBCARPETAS  = ['mesas', 'respaldos', 'exportaciones'];

export function eleccionActual() {
  try {
    const e = JSON.parse(localStorage.getItem(CLAVE));
    return e && e.id ? e : null;
  } catch { return null; }
}

function fijar(e) {
  try { localStorage.setItem(CLAVE, JSON.stringify(e)); } catch { /* almacenamiento bloqueado */ }
}

export function olvidarEleccion() {
  try { localStorage.removeItem(CLAVE); } catch { /* nada */ }
}

// Crea (o reutiliza) la carpeta "Votaciones" y dentro la carpeta de la elección.
export async function crearEleccion(nombre) {
  nombre = String(nombre || '').trim();
  if (!nombre) throw new Error('Escribe un nombre para la elección.');

  let [raiz] = await api.listar('root', { nombre: RAIZ, mimeType: api.MIME_CARPETA });
  raiz ||= await api.crearCarpeta(RAIZ);

  const carpeta = await api.crearCarpeta(nombre, raiz.id);
  for (const s of SUBCARPETAS) await api.crearCarpeta(s, carpeta.id);

  const e = { id: carpeta.id, nombre: carpeta.name };
  fijar(e);
  return e;
}

export async function elegirEleccion() {
  const c = await elegirCarpeta();
  if (!c) return null;
  const e = { id: c.id, nombre: c.nombre };
  fijar(e);
  return e;
}

// Lo que la app puede ver hoy dentro de la carpeta de la elección.
export async function estructura() {
  const eleccion = eleccionActual();
  if (!eleccion) throw new Error('Primero crea o elige la carpeta de la elección.');
  const hijos = await api.listar(eleccion.id);
  const carpetas = {};
  const archivos = [];
  hijos.forEach(x => {
    if (x.mimeType === api.MIME_CARPETA) carpetas[x.name] = x.id;
    else archivos.push(x);
  });
  return { eleccion, carpetas, archivos };
}

// Crea el archivo si no existe; si existe lo actualiza (con control de versión opcional).
export async function guardarJSON(carpetaId, nombre, objeto, versionEsperada) {
  const [existente] = await api.listar(carpetaId, { nombre });
  if (!existente) return api.crearJSON(nombre, carpetaId, objeto);
  return api.actualizarJSON(existente.id, objeto, versionEsperada);
}

export async function leerJSON(carpetaId, nombre) {
  const [existente] = await api.listar(carpetaId, { nombre });
  if (!existente) return null;
  return { id: existente.id, nombre, ...(await api.leerJSON(existente.id)) };
}
