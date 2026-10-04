// navegacion.js — Lógica pura de ámbitos electorales: Región → Provincia → Distrito.
//
// Sin efectos secundarios de DOM ni de voz.
// Lee el estado a través de `st.S` (contenedor de state.js) para que siempre
// vea el estado más reciente, incluso después de un setEstado().
//
// USO:
//   import { contextoDe, territorioActivo, opcionesNavegacion, ... } from './navegacion.js';

import { st } from './state.js';

// ─── Tabla de contexto por cargo ──────────────────────────────────────────────
// Guarda qué región/provincia/distrito está seleccionado para cada cargo.
// Se muta en app.js a través de contextoDe(c).
export const navegacionCargo = {};

// Devuelve (creando si no existe) el contexto de navegación del cargo.
export const contextoDe = c => navegacionCargo[c] ??= { region: '', provincia: '', distrito: '' };

const CLAVE_UI = 'votaciones.ui';
const CARGOS_UI = ['distrito', 'provincia', 'region', 'consejero'];

export function restaurarNavegacionUI() {
  try {
    const ui = JSON.parse(localStorage.getItem(CLAVE_UI) || '{}');
    const guardada = ui?.navegacionCargo;
    if (!guardada || typeof guardada !== 'object' || Array.isArray(guardada)) return;
    const geos = Array.isArray(st.S.geografia) ? st.S.geografia : [];

    for (const c of CARGOS_UI) {
      const anterior = guardada[c];
      if (!anterior || typeof anterior !== 'object' || Array.isArray(anterior)) continue;
      const region = typeof anterior.region === 'string' &&
        geos.some(g => g.region === anterior.region) ? anterior.region : '';
      const provincia = region && typeof anterior.provincia === 'string' &&
        geos.some(g => g.region === region && g.provincia === anterior.provincia)
        ? anterior.provincia : '';
      const distrito = provincia && typeof anterior.distrito === 'string' &&
        geos.some(g => g.region === region && g.provincia === provincia && g.distrito === anterior.distrito)
        ? anterior.distrito : '';
      navegacionCargo[c] = { region, provincia, distrito };
    }
  } catch {}
}

export function guardarNavegacionUI() {
  try {
    const anterior = JSON.parse(localStorage.getItem(CLAVE_UI) || '{}');
    const ui = anterior && typeof anterior === 'object' && !Array.isArray(anterior) ? anterior : {};
    ui.navegacionCargo = Object.fromEntries(
      CARGOS_UI.filter(c => navegacionCargo[c])
        .map(c => [c, { ...navegacionCargo[c] }])
    );
    localStorage.setItem(CLAVE_UI, JSON.stringify(ui));
  } catch {}
}

// ─── Territorio activo según el tipo de cargo ─────────────────────────────────
// - 'distrito'  → usa el distrito seleccionado
// - 'region'    → usa la región seleccionada
// - cualquier otro (provincia, consejero) → usa la provincia
export const territorioActivo = c =>
  c === 'distrito' ? contextoDe(c).distrito
  : c === 'region' ? contextoDe(c).region
  : contextoDe(c).provincia;

// ─── Estado de navegación ─────────────────────────────────────────────────────
// Devuelve true solo cuando los tres niveles están seleccionados.
export const navegacionCompleta = c => {
  const n = contextoDe(c);
  return !!(n.region && n.provincia && n.distrito);
};

// Devuelve el siguiente nivel que falta completar ('region' | 'provincia' | 'distrito' | '').
export const pasoNavegacion = c => {
  const n = contextoDe(c);
  return !n.region ? 'region' : !n.provincia ? 'provincia' : !n.distrito ? 'distrito' : '';
};

// ─── Etiquetas de texto ───────────────────────────────────────────────────────
export const etiquetaPaso = paso =>
  paso === 'region' ? 'región' : paso === 'provincia' ? 'provincia' : 'distrito';

export const frasePaso = paso =>
  paso === 'region' ? 'una región' : paso === 'provincia' ? 'una provincia' : 'un distrito';

// Frase contextual según el cargo ("di el nombre de una provincia").
export const fraseAmbito = c => frasePaso(pasoNavegacion(c));

// ─── Opciones disponibles para el paso actual ─────────────────────────────────
// Devuelve la lista de nombres (región, provincia o distrito) que se puede
// elegir en el paso actual, ordenados alfabéticamente.
export const opcionesNavegacion = c => {
  const n    = contextoDe(c);
  const geos = st.S.geografia;
  const paso = pasoNavegacion(c);

  const candidatos =
    paso === 'region'    ? geos.map(g => g.region)
    : paso === 'provincia' ? geos.filter(g => g.region === n.region).map(g => g.provincia)
    : geos
        .filter(g =>
          g.region === n.region &&
          g.provincia === n.provincia &&
          (c !== 'distrito' || !g.capital)
        )
        .map(g => g.distrito);

  return [...new Set(candidatos)].sort((a, b) => a.localeCompare(b, 'es'));
};

// ─── Entradas geográficas del ámbito activo ───────────────────────────────────
// Devuelve las filas de S.geografia que pertenecen al ámbito actual del cargo.
// Se usa para saber a qué distritos pertenece una mesa que se quiere agregar.
export const geosDelAmbito = c => {
  const n    = contextoDe(c);
  const geos = st.S.geografia;

  return geos.filter(g =>
    n.distrito      ? g.distrito  === n.distrito
    : c === 'distrito' ? !g.capital
    : c === 'region'   ? g.region === n.region
    : g.provincia === n.provincia
  );
};

// ─── Lista de territorios disponibles para un cargo ───────────────────────────
// Se usa en la pantalla de Datos para poblar selectores de territorio.
export const territoriosDeCargo = c => {
  const geos =
    c === 'distrito' ? st.S.geografia.filter(g => !g.capital)
    : c === 'region' ? st.S.geografia.map(g => ({ nombre: g.region }))
    : st.S.geografia.map(g => ({ nombre: g.provincia }));

  const nombre = c === 'distrito' ? g => g.distrito : g => g.nombre || g.provincia;
  return [...new Set(geos.map(nombre))].sort((a, b) => a.localeCompare(b, 'es'));
};
