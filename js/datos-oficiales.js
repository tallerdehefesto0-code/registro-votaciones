// datos-oficiales.js — Carga los datos oficiales que vienen DENTRO de la app (carpeta datos/)
// cuando el dispositivo todavía no tiene mesas, organizaciones ni votos.
//
// Usa los mismos lectores y validadores de csv.js que los botones de subir archivo
// (leerMesas, leerOrgs), así que las reglas son las mismas.
//
// • Solo escribe en el estado si TODO es válido: si algo falla, no se toca nada.
// • Nunca pisa datos existentes (se vuelve a comprobar justo antes de escribir).
// • Cada lectura tiene un límite de 8 segundos: sin internet o con red lenta no se queda esperando.
// • No lanza errores: devuelve { cargado, msg }.
//
// Archivos esperados (relativos a la raíz de la app):
//   datos/mesas-lambayeque.csv
//   datos/organizaciones-lambayeque-ferrenafe.csv
//   datos/organizaciones-chiclayo.csv
//
// IMPORTANTE: llamar SIN await en el arranque (ver app.js), para que la app abra primero.
//
// Dependencias: state.js, csv.js.

import { st, save } from './state.js';
import { leerMesas, leerOrgs } from './csv.js';

const ARCHIVO_MESAS = 'mesas-lambayeque.csv';
const ARCHIVOS_ORGS = ['organizaciones-lambayeque-ferrenafe.csv', 'organizaciones-chiclayo.csv'];
const CARGOS = ['distrito', 'provincia', 'region', 'consejero'];
const LIMITE_MS = 8000;

// La ruta se calcula respecto a este módulo (js/), así que sirve en GitHub Pages y en localhost.
async function leerTexto(nombre) {
  const ctl = new AbortController();
  const reloj = setTimeout(() => ctl.abort(), LIMITE_MS);
  try {
    const res = await fetch(new URL(`../datos/${nombre}`, import.meta.url), { signal: ctl.signal });
    if (!res.ok) throw new Error(`No se pudo leer ${nombre} (código ${res.status})`);
    return (await res.text()).replace(/^\uFEFF/, '');
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(`${nombre}: tardó demasiado en responder`);
    throw err;
  } finally {
    clearTimeout(reloj);
  }
}

export function dispositivoVacio(S) {
  return !(S.mesas || []).length
    && !Object.keys(S.votos || {}).length
    && CARGOS.every(c => !((S.orgs || {})[c] || []).length);
}

export async function cargarOficialesSiVacio() {
  if (!dispositivoVacio(st.S)) return { cargado: false, msg: 'El dispositivo ya tiene datos: no se cargó nada.' };

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

    // 2. El estado pudo cambiar mientras se leía (por ejemplo, el usuario cargó algo a mano): volver a mirar
    const S = st.S;
    if (!dispositivoVacio(S)) return { cargado: false, msg: 'Mientras se leían los datos oficiales el dispositivo recibió datos: no se cargó nada.' };

    // 3. Comprobar que mesas y organizaciones apunten a lugares que existen en la geografía
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

    // 4. Todo válido: recién ahora se escribe
    S.mesas = rm.mesas;
    S.orgs = orgs;
    await save();
    const total = CARGOS.reduce((n, c) => n + orgs[c].length, 0);
    return { cargado: true, msg: `Datos oficiales cargados: ${rm.mesas.length} mesas y ${total} organizaciones.` };
  } catch (err) {
    return { cargado: false, msg: 'No se cargaron los datos oficiales: ' + (err.message || err) };
  }
}
