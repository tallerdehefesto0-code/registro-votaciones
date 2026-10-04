// datos-oficiales.js — Carga los datos oficiales que vienen DENTRO de la app (carpeta datos/)
// cuando el dispositivo todavía no tiene mesas, organizaciones ni votos.
//
// Usa los mismos lectores y validadores de csv.js que los botones de subir archivo
// (leerMesas, leerOrgs), así que las reglas son las mismas.
//
// Solo escribe en el estado si TODO es válido: si algo falla, no se toca nada.
// Nunca pisa datos existentes: si el dispositivo ya tiene mesas, organizaciones o votos, no hace nada.
//
// Archivos esperados (relativos a la raíz de la app):
//   datos/mesas-lambayeque.csv
//   datos/organizaciones-lambayeque-ferrenafe.csv
//   datos/organizaciones-chiclayo.csv
//
// Dependencias: state.js, csv.js.

import { st, save } from './state.js';
import { leerMesas, leerOrgs } from './csv.js';

const ARCHIVO_MESAS = 'mesas-lambayeque.csv';
const ARCHIVOS_ORGS = ['organizaciones-lambayeque-ferrenafe.csv', 'organizaciones-chiclayo.csv'];
const CARGOS = ['distrito', 'provincia', 'region', 'consejero'];

// La ruta se calcula respecto a este módulo (js/), así que sirve en GitHub Pages y en localhost.
async function leerTexto(nombre) {
  const res = await fetch(new URL(`../datos/${nombre}`, import.meta.url));
  if (!res.ok) throw new Error(`No se pudo leer ${nombre} (código ${res.status})`);
  return (await res.text()).replace(/^\uFEFF/, '');
}

export function dispositivoVacio(S) {
  return !(S.mesas || []).length
    && !Object.keys(S.votos || {}).length
    && CARGOS.every(c => !((S.orgs || {})[c] || []).length);
}

// Devuelve { cargado: boolean, msg: string }. No lanza errores.
export async function cargarOficialesSiVacio() {
  const S = st.S;
  if (!dispositivoVacio(S)) return { cargado: false, msg: 'El dispositivo ya tiene datos: no se cargó nada.' };

  try {
    // 1. Leer y validar todo, sin tocar el estado
    const rm = leerMesas(await leerTexto(ARCHIVO_MESAS));
    if (rm.err.length) throw new Error(`${ARCHIVO_MESAS}: ${rm.err.slice(0, 3).join(' · ')}`);

    const orgs = { distrito: [], provincia: [], region: [], consejero: [] };
    for (const f of ARCHIVOS_ORGS) {
      const ro = leerOrgs(await leerTexto(f));
      if (ro.err.length) throw new Error(`${f}: ${ro.err.slice(0, 3).join(' · ')}`);
      CARGOS.forEach(c => orgs[c].push(...(ro.orgs[c] || [])));
    }
    CARGOS.forEach(c => orgs[c].sort((a, b) => (a.territorio || '').localeCompare(b.territorio || '') || a.n - b.n));

    // 2. Comprobar que mesas y organizaciones apunten a lugares que existen en la geografía
    const geo = S.geografia || [];
    const distritos = new Set(geo.map(g => g.distrito));
    const provincias = new Set(geo.map(g => g.provincia));
    const regiones = new Set(geo.map(g => g.region));
    const faltan = new Set();
    rm.mesas.forEach(m => { if (!distritos.has(m.distrito)) faltan.add(`mesa ${m.num}: ${m.distrito}`); });
    const lugares = { distrito: distritos, provincia: provincias, consejero: provincias, region: regiones };
    CARGOS.forEach(c => orgs[c].forEach(o => {
      if (o.territorio && !lugares[c].has(o.territorio)) faltan.add(`${c}: ${o.territorio}`);
    }));
    if (faltan.size) {
      throw new Error('Lugares que no existen en la geografía de la app: ' + [...faltan].slice(0, 5).join(', ') + (faltan.size > 5 ? '…' : ''));
    }

    // 3. Todo válido: recién ahora se escribe
    S.mesas = rm.mesas;
    S.orgs = orgs;
    await save();
    const total = CARGOS.reduce((n, c) => n + orgs[c].length, 0);
    return { cargado: true, msg: `Datos oficiales cargados: ${rm.mesas.length} mesas y ${total} organizaciones.` };
  } catch (err) {
    return { cargado: false, msg: 'No se cargaron los datos oficiales: ' + (err.message || err) };
  }
}
