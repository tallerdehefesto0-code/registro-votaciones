// ui-tabla.js — Vista de la tabla de votación y toda su lógica auxiliar.
//
// ACOPLAMIENTO CON LA VOZ:
//   La voz vive en app.js para esta fase. El puente se resuelve mediante un
//   objeto de contexto `ctx` que app.js construye y pasa a tabla(c, ctx):
//
//     ctx = {
//       voz,              // referencia al objeto de estado de voz (mutable)
//       render,           // función de re-render global
//       pintarVoz,        // actualiza la UI de voz sin re-render completo
//       conservarVoz,     // getter: () => conservarVoz
//       setConservarVoz,  // setter: v => { conservarVoz = v }
//       alternarVoz,      // alternar escucha
//       pararVoz,         // detener voz completamente
//       volverSeleccionTerritorio, // resetear navegación de cargo
//       navegarColumna,   // mover entre columnas por voz
//       abrirVozSinTerritorio,    // para abrirSeccionElectoral
//     }
//
//   ui-tabla.js EXPORTA las funciones que app.js necesita para operar la voz:
//     - filasDe(c)               → lista de filas del cargo
//     - mesasTrabajo(c)          → mesas totales (sin paginar)
//     - mesasVisibles(c)         → mesas de la página actual
//     - paginaPorCargo           → objeto mutable de páginas
//     - getApp()                 → referencia al elemento #app
//     - agregarCodigoMesa(c, codigo, aviso) → añade una columna
//     - actualizarTabla(c, diferido)        → refresca celdas sin re-render

import { CARGOS, OTROS, key, claveOrg, mesasDe, orgsDe, datosMesa,
         resumenCargo, pct, avisoMesa, maxCelda, cargosDeMesa }  from './calc.js';
import { st, save, registrarEvento }                            from './state.js';
import { contextoDe, territorioActivo, navegacionCompleta,
         pasoNavegacion, etiquetaPaso, frasePaso,
         opcionesNavegacion, geosDelAmbito }                    from './navegacion.js';
import { h, btn }                                               from './ui-helpers.js';
import { mkPanelExp, mkBotonExp, FORMATOS }                     from './ui-tablero.js';

// ─── Proxy local idéntico al de app.js ───────────────────────────────────────
const S = new Proxy({}, {
  get: (_, prop) => st.S[prop],
  set: (_, prop, value) => { st.S[prop] = value; return true; },
});

const CS  = Object.keys(CARGOS);
const num = n => n.toLocaleString('es-PE');

// ─── Estado de módulo ─────────────────────────────────────────────────────────
export const MAX_MESAS_BLOQUE = 12;
export const paginaPorCargo   = {};     // mutable, compartido con app.js via export
export let   sel              = 0;
export const setSel           = v => { sel = v; };

let vista      = localStorage.getItem('vista') || (matchMedia('(max-width:700px)').matches ? 'mesa' : 'completa');
let reabriendo = null;
let mesaPendiente = null;

// Referencia al elemento #app (necesaria para querySelector en pintarVoz de app.js)
const appEl = () => document.getElementById('app');
export const getApp = appEl;

// ─── Filas del cargo (organizaciones + otros) ─────────────────────────────────
export const filasDe = c => [
  ...orgsDe(S, c, territorioActivo(c)).map(o => [`${o.n} – ${o.nombre}`, claveOrg(o), true]),
  ...Object.entries(OTROS).map(([x, t]) => [t, x, false]),
];

// ─── Paginación de mesas ──────────────────────────────────────────────────────
export const mesasTrabajo = c => {
  const distrito = contextoDe(c)?.distrito;
  return mesasDe(S, c, territorioActivo(c)).filter(m => !distrito || m.distrito === distrito);
};

export const mesasVisibles = c => {
  const ms     = mesasTrabajo(c);
  const paginas = Math.max(1, Math.ceil(ms.length / MAX_MESAS_BLOQUE));
  paginaPorCargo[c] = Math.max(0, Math.min(paginaPorCargo[c] || 0, paginas - 1));
  const inicio = paginaPorCargo[c] * MAX_MESAS_BLOQUE;
  return ms.slice(inicio, inicio + MAX_MESAS_BLOQUE);
};

function cambiarVista(v, ctx) {
  vista = v;
  localStorage.setItem('vista', v);
  if (ctx.voz.abierto) ctx.setConservarVoz(true);
  ctx.render();
}

function cambiarPaginaMesa(c, delta, ctx) {
  const paginas = Math.max(1, Math.ceil(mesasTrabajo(c).length / MAX_MESAS_BLOQUE));
  paginaPorCargo[c] = Math.max(0, Math.min(paginas - 1, (paginaPorCargo[c] || 0) + delta));
  sel = 0;
  const ms = mesasVisibles(c);
  if (ctx.voz.abierto && ctx.voz.c === c && ms.length) {
    ctx.voz.m   = ms[0];
    const vacia = filasDe(c).findIndex(([, x]) => S.votos[key(c, ctx.voz.m.num, x)] === undefined);
    ctx.voz.pos = Math.max(0, vacia);
  }
  ctx.setConservarVoz(true);
  ctx.render();
  ctx.pintarVoz();
}

// ─── Validación y guardado de celdas ─────────────────────────────────────────
function filtrar(c, m, x, el) {
  let v = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const max  = maxCelda(S, c, m, x);
  const pasa = v !== '' && Number(v) > max;
  if (pasa) v = String(max);
  if (v !== el.value) el.value = v;
  const nota = appEl()?.querySelector('[data-k="nota"]');
  if (nota) nota.textContent = pasa
    ? `Mesa ${m.num}: el máximo para esta casilla es ${num(max)} (electores hábiles: ${num(m.hab)}).`
    : '';
}

function guardarHab(c, m, el) {
  const n     = parseInt(el.value, 10);
  const mayor = Math.max(0, ...cargosDeMesa(S, m).map(cg => datosMesa(S, cg, m).total));
  const nota  = appEl()?.querySelector('[data-k="nota"]');
  if (!(n >= 1) || n < mayor) {
    if (nota) nota.textContent = `Mesa ${m.num}: los electores hábiles deben ser un entero mayor que 0 y no menor que ${mayor} (el mayor total ya registrado).`;
    el.value = m.hab > 0 ? m.hab : '';
    return;
  }
  if (nota) nota.textContent = '';
  m.hab = n;
  save();
  actualizarTabla(c, true, null);
}

function guardarCelda(c, m, x, el, ctx) {
  const k = key(c, m.num, x);
  if (el.value === '') delete S.votos[k];
  else S.votos[k] = parseInt(el.value, 10);
  save();
  actualizarTabla(c, true, ctx);
}

function sincronizarCeldaVoz(c, m, fila, el, ctx) {
  if (!ctx.voz.abierto || ctx.voz.c !== c || !el) return;
  ctx.voz.m   = m;
  ctx.voz.pos = fila;
  sel         = Number(el.dataset.c);
  const navMesa = appEl()?.querySelector('[data-k="nav|mesa"]');
  if (navMesa) navMesa.value = String(sel);
  ctx.pintarVoz();
}

// Tab / Enter / flechas navegan por la columna activa
function mover(e) {
  if (!['Tab', 'Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
  const arriba = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey);
  const lista  = [...appEl().querySelectorAll('td input:not(:disabled)')]
    .sort((a, b) => a.dataset.c - b.dataset.c || a.dataset.r - b.dataset.r);
  const sig = lista[lista.indexOf(e.target) + (arriba ? -1 : 1)];
  if (sig) { e.preventDefault(); sig.focus(); sig.select(); }
}

// ─── Cierre y reapertura de mesas ────────────────────────────────────────────
const estaCerrada = (c, m) => !!S.cerradas[c + '|' + m.num];

function cerrar(c, m, ctx) {
  const d = datosMesa(S, c, m);
  if (!d.completo || !d.cuadra)
    return alert('La mesa no se puede cerrar: debe estar completa y cuadrar.');
  S.cerradas[c + '|' + m.num] = true;
  registrarEvento(c, m.num, d.obs > 0 ? 'Cierre (con observables, provisional)' : 'Cierre');
  save(); ctx.render();
}

function confirmarReabrir(c, m, motivo, ctx) {
  delete S.cerradas[c + '|' + m.num];
  registrarEvento(c, m.num, 'Reapertura: ' + motivo);
  reabriendo = null; save(); ctx.render();
}

function panelReabrir(c, ctx) {
  if (!reabriendo || reabriendo.c !== c) return null;
  const m = S.mesas.find(x => x.num === reabriendo.num);
  if (!m || !estaCerrada(c, m)) { reabriendo = null; return null; }
  const ta = h('textarea', { rows: 3, placeholder: 'Escribe por qué se reabre la mesa…' });
  const ok = btn('Confirmar reapertura',
    () => confirmarReabrir(c, m, ta.value.trim(), ctx), { disabled: true });
  ta.addEventListener('input', () => { ok.disabled = ta.value.trim().length < 5; });
  return h('div', { class: 'card', id: 'panel-reabrir' },
    h('h3', {}, `Reabrir Mesa ${m.num} · ${CARGOS[c]}`),
    h('label', { class: 'campo' },
      h('span', {}, 'Motivo (mínimo 5 caracteres, queda en la bitácora)'), ta),
    h('div', { class: 'acciones' },
      ok,
      btn('Cancelar', () => { reabriendo = null; ctx.render(); }),
    ),
  );
}

// ─── Actualización diferida de celdas calculadas (sin re-render) ─────────────
const resumenesPendientes   = new Set();
let   trabajoResumenPendiente = false;

function actualizarResumen(c) {
  const territorio = territorioActivo(c);
  const [, ruta, cargo] = location.hash.slice(1).split('/');
  if (ruta !== 'cargo' || cargo !== c) return;

  const app = appEl();
  const set = (k, t) => { const e = app?.querySelector(`[data-k="${k}"]`); if (e) e.textContent = t; };
  const on  = (k, f) => { const e = app?.querySelector(`[data-k="${k}"]`); if (e) f(e); };

  const R = resumenCargo(S, c, territorio);
  set('t|T', num(R.total)); set('om|T', num(R.omisos)); set('hab|T', num(R.hab));
  R.porOrg.forEach(({ o, votos }) => {
    const x = claveOrg(o);
    set('to|' + x, num(votos));
    set('p1|' + x, pct(votos, R.validos));
    set('p2|' + x, pct(votos, R.total));
  });
  Object.keys(OTROS).forEach(x => {
    set('to|' + x, num(R[x]));
    set('p2|' + x, pct(R[x], R.total));
  });
}

function agendarResumen(c) {
  resumenesPendientes.add(c);
  if (trabajoResumenPendiente) return;
  trabajoResumenPendiente = true;
  const ejecutar = () => {
    trabajoResumenPendiente = false;
    const pendientes = [...resumenesPendientes];
    resumenesPendientes.clear();
    pendientes.forEach(actualizarResumen);
    if (resumenesPendientes.size) agendarResumen(resumenesPendientes.values().next().value);
  };
  if (window.requestIdleCallback) window.requestIdleCallback(ejecutar, { timeout: 1000 });
  else setTimeout(ejecutar, 0);
}

// Iguala las casillas visibles con S.votos (la voz guarda sin repintar la tabla)
function sincronizarValores(c) {
  const ms    = mesasVisibles(c);
  const cols  = vista === 'completa' ? ms : ms[sel] ? [ms[sel]] : [];
  const filas = filasDe(c);
  document.querySelectorAll('.tabla-votacion input[data-c][data-r]').forEach(el => {
    const m = cols[Number(el.dataset.c)], f = filas[Number(el.dataset.r)];
    if (!m || !f) return;
    const v   = S.votos[key(c, m.num, f[1])];
    const txt = v === undefined ? '' : String(v);
    if (el.value !== txt) el.value = txt;
  });
}

export function actualizarTabla(c, diferido = false, ctx = null) {
  sincronizarValores(c);

  const territorio = territorioActivo(c);
  const ms = mesasVisibles(c);
  const avs = [];

  const app = appEl();
  const set = (k, t) => { const e = app?.querySelector(`[data-k="${k}"]`); if (e) e.textContent = t; };
  const on  = (k, f) => { const e = app?.querySelector(`[data-k="${k}"]`); if (e) f(e); };

  ms.forEach(m => {
    const d     = datosMesa(S, c, m);
    const k     = m.num;
    const aviso = avisoMesa(S, m);
    if (aviso) avs.push(
      `⚠ Mesa ${k}: el total por mesa no coincide entre cargos → ` +
      aviso.map(([cg, t]) => `${CARGOS[cg]} ${num(t)}`).join(' · ')
    );
    set('t|' + k,  num(d.total));
    set('om|' + k, d.omisos === null ? '—' : num(d.omisos));
    on('om|' + k, e => e.classList.toggle('mal', !d.cuadra));
    set('es|' + k,
      d.estado +
      (d.estado === 'Cerrada' && d.obs > 0 ? ' (provisional)' : '') +
      (m.hab <= 0 ? ' · faltan electores hábiles' : d.cuadra ? '' : ' · supera a los hábiles')
    );
    on('es|' + k, e => {
      e.dataset.est = d.estado;
      e.classList.toggle('sobra', m.hab > 0 && !d.cuadra);
    });
    on('bt|' + k, b => { if (d.estado !== 'Cerrada') b.disabled = !(d.completo && d.cuadra); });
    set('av|' + k, aviso ? ' ⚠' : '');
  });
  set('avtxt', avs.join('\n'));

  if (diferido || mesasDe(S, c, territorio).length > 200) agendarResumen(c);
  else actualizarResumen(c);
}

export function agregarOrganizacion(c, texto, nombre, aviso, ctx) {
  const territorio = territorioActivo(c);
  const dec = t => { if (aviso) aviso.textContent = t; else if (ctx) ctx.voz.msg = t; return false; };
  if (!territorio) return dec('Primero elige el territorio de trabajo.');
  const nom = String(nombre || '').trim();
  const propias = S.orgs[c].filter(o => o.territorio === territorio);
  const n = (texto === '' || texto == null) ? Math.max(0, ...propias.map(o => o.n)) + 1 : parseInt(texto, 10);
  if (!Number.isInteger(n) || n < 1 || n > 60) return dec('El número de orden debe estar entre 1 y 60.');
  if (propias.some(o => o.n === n)) return dec(`El número ${n} ya existe en ${territorio}.`);
  if (nom && propias.some(o => o.nombre.toLowerCase() === nom.toLowerCase())) return dec(`«${nom}» ya existe en ${territorio}.`);
  if (mesasDe(S, c, territorio).some(m => estaCerrada(c, m)))
    return dec('Hay mesas cerradas en este cargo: reábrelas antes de agregar una organización.');
  S.orgs[c].push({ n, nombre: nom || 'Organización ' + n, cand: '', territorio });
  S.orgs[c].sort((a, b) => (a.territorio || '').localeCompare(b.territorio || '') || a.n - b.n);
  save();
  if (ctx?.voz) ctx.voz.msg = `«${nom || 'Organización ' + n}» agregada como N.º ${n}.`;
  ctx?.setConservarVoz?.(true);
  ctx?.render();
  return true;
}

function comandosVoz() {
  const li = (a, b) => h('li', {}, h('b', {}, a), ' — ', b);
  return h('details', { class: 'nota', open: true },
    h('summary', {}, 'Comandos de voz'),
    h('ul', {},
      li('«cuarenta y cinco» o «cuatro cinco»', 'guarda la cantidad en la casilla activa y baja a la siguiente'),
      li('«siguiente» / «anterior»', 'cambia de casilla (también «avanza» / «vuelve»)'),
      li('«borra»', 'vacía la casilla activa'),
      li('«blanco», «nulo», «observable»', 'va a esa fila; «blanco ocho» guarda 8'),
      li('«nueva» y seis dígitos', 'agrega la columna de esa mesa'),
      li('«siguiente columna» / «anterior columna»', 'cambia de mesa'),
      li('«siguiente cargo» / «anterior cargo»', 'cambia de cargo'),
      li('«abre distrito», «abre provincia», «abre consejero», «abre región»', 'abre ese cargo'),
      li('«cambiar»', 'cambia el territorio de trabajo'),
      li('«organización cinco Apra»', 'agrega la organización N.º 5 llamada Apra'),
    ),
  );
}

function formOrgRapida(c, ctx) {
  const nom   = h('input', { placeholder: 'Nombre de la organización', autocomplete: 'off',
    'aria-label': 'Nombre de la organización' });
  const aviso = h('p', { class: 'mal' });
  return h('form', { class: 'acciones', onsubmit: e => {
      e.preventDefault();
      const nombre = nom.value.trim();
      if (!nombre) { aviso.textContent = 'Escribe el nombre de la organización.'; return; }
      const terr = territorioActivo(c);
      const sig  = S.orgs[c].filter(o => o.territorio === terr)
                            .reduce((mx, o) => Math.max(mx, o.n), 0) + 1;
      if (ctx?.voz?.abierto) ctx.setConservarVoz(true);
      agregarOrganizacion(c, String(sig), nombre, aviso, ctx);
    } },
    nom,
    h('button', { type: 'submit' }, 'Agregar organización'),
    aviso,
  );
}

// ─── Agregar columna (mesa) ───────────────────────────────────────────────────
export function agregarCodigoMesa(c, texto, aviso, ctx) {
  const codigo = String(texto).trim();
  if (!/^\d{6}$/.test(codigo)) {
    if (aviso) aviso.textContent = 'El código debe tener seis dígitos.';
    return false;
  }
  const territorio = territorioActivo(c);
  let mesa = S.mesas.find(m => String(m.num) === codigo);
  if (mesa && (!mesasDe(S, c, territorio).includes(mesa) || mesa.distrito !== contextoDe(c).distrito)) {
    const msg = `Ese código no pertenece al distrito ${contextoDe(c).distrito}.`;
    if (aviso) aviso.textContent = msg;
    else if (ctx) ctx.voz.msg = msg;
    return false;
  }
  if (!mesa) {
    const geos = geosDelAmbito(c);
    mesaPendiente = { cargo: c, codigo };
    const msg = geos.length === 1
      ? `El código ${codigo} no existe. Confírmalo para crearlo.`
      : `Código ${codigo}: di el distrito al que pertenece.`;
    if (ctx) ctx.voz.msg = msg;
    if (aviso) aviso.textContent = msg;
    ctx?.setConservarVoz(true);
    ctx?.render();
    return false;
  }
  if (ctx?.voz.abierto && ctx.voz.c === c) {
    ctx.voz.m   = mesa || S.mesas.find(m => String(m.num) === codigo);
    ctx.voz.pos = Math.max(0, filasDe(c).findIndex(([, x]) => S.votos[key(c, codigo, x)] === undefined));
    ctx.voz.msg = `Columna ${codigo} lista.`;
    ctx.voz.esperandoCodigo  = false;
    ctx.voz.digitosCodigo    = '';
    ctx.setConservarVoz(true);
  }
  sel = mesasVisibles(c).findIndex(m => String(m.num) === codigo);
  save(); ctx?.render();
  return true;
}

function crearControlMesa(c, ctx) {
  const codigo = h('input', {
    name: 'codigo', inputmode: 'numeric', pattern: '[0-9]{6}',
    maxlength: 6, required: true, placeholder: '123456', 'aria-label': 'Código de mesa',
  });
  const aviso = h('p', { class: 'mal' });
  return h('div', {},
    h('form', { class: 'acciones',
      onsubmit: e => { e.preventDefault(); agregarCodigoMesa(c, codigo.value, aviso, ctx); },
    }, codigo, h('button', { type: 'submit' }, 'Agregar columna'), aviso),
    formOrgRapida(c, ctx),
  );
}

function selectorMesaPendiente(c, ctx) {
  if (!mesaPendiente || mesaPendiente.cargo !== c) return null;
  const geos = geosDelAmbito(c);
  const texto = geos.length === 1
    ? `El código ${mesaPendiente.codigo} no existe. ¿Crearlo?`
    : `Código ${mesaPendiente.codigo}: indica su distrito.`;
  return h('div', { class: 'acciones' },
    h('span', { class: 'nota' }, texto),
    ...geos.map(g => btn(geos.length === 1 ? `Crear en ${g.distrito}` : g.distrito,
                         () => confirmarMesaPendiente(g, ctx))),
    btn('Cancelar', () => {
      mesaPendiente = null;
      ctx?.setConservarVoz(true);
      ctx?.render();
    }),
  );
}

function confirmarMesaPendiente(geo, ctx) {
  if (!mesaPendiente) return;
  const { codigo } = mesaPendiente;
  S.mesas.push({ num: codigo, distrito: geo.distrito, local: `${geo.distrito} · ${codigo}`, hab: 0 });
  paginaPorCargo[mesaPendiente.cargo] = Math.floor(mesasTrabajo(mesaPendiente.cargo).length / MAX_MESAS_BLOQUE);
  mesaPendiente = null;
  save();
  // irAColumna lo llamará app.js tras este retorno (ya tiene ctx.voz)
  ctx?.irAColumna?.(codigo);
}

// ─── Navegación geográfica visual ────────────────────────────────────────────
function vistaSeleccionTerritorios(c, ctx) {
  return h('section', {},
    h('p', {}, h('a', { href: '#/' }, '← Tablero')),
    h('h2', {}, 'Tabla de votos · ' + CARGOS[c]),
    panelSeleccionTerritorios(c, ctx),
  );
}

function panelSeleccionTerritorios(c, ctx) {
  const opciones = opcionesNavegacion(c);
  const n        = contextoDe(c);
  const paso     = pasoNavegacion(c);
  const ruta = (n.region || n.provincia || n.distrito) &&
    h('div', { class: 'barra breadcrumb' },
      n.region   && btn(n.region,   () => volverNivelNavegacion(c, 'region',   ctx)),
      n.provincia && btn(n.provincia, () => volverNivelNavegacion(c, 'provincia', ctx)),
      n.distrito  && h('span', { class: 'chip' }, n.distrito),
    );
  return h('div', { class: 'card voz selector-territorios' },
    h('div', { class: 'barra' },
      btn('🎤 Dictar', ctx.alternarVoz, { 'data-k': 'vb' }),
      btn('✕ Cerrar', () => { ctx.pararVoz(); ctx.render(); }),
    ),
    ruta,
    h('p', { class: 'nota' }, `Di el nombre de ${frasePaso(paso)} o selecciónalo:`),
    h('div', { class: 'nota voz-oido', 'data-k': 'voido' }),
    h('p', { class: 'mal', 'data-k': 'vmsg' }),
    h('div', { class: 'grid opciones-territorio' },
      ...opciones.map(nombre => btn(nombre, () => ctx.seleccionarTerritorio(c, nombre))),
    ),
    opciones.length === 0 &&
      h('p', { class: 'nota' }, 'Agrega territorios en «Datos» antes de registrar votos.'),
  );
}

export function rutaNavegacion(c, ctx) {
  const n = contextoDe(c);
  return h('div', { class: 'barra breadcrumb' },
    btn(n.region,   () => volverNivelNavegacion(c, 'region',   ctx)),
    btn(n.provincia, () => volverNivelNavegacion(c, 'provincia', ctx)),
    btn('Distrito: ' + n.distrito, () => volverNivelNavegacion(c, 'distrito', ctx)),
  );
}

function volverNivelNavegacion(c, nivel, ctx) {
  const n = contextoDe(c);
  if (nivel === 'region' || nivel === 'provincia') { n.provincia = ''; n.distrito = ''; }
  else n.distrito = '';
  ctx.voz.m = null;
  paginaPorCargo[c] = 0;
  ctx.setConservarVoz(true);
  ctx.render();
}

// ─── Paneles de voz dentro de la tabla ───────────────────────────────────────
export function panelVoz(c, m, ctx) {
  if (estaCerrada(c, m))
    return h('div', {},
      h('p', { class: 'nota' }, 'Columna cerrada: reabre para dictar.'),
      crearControlMesa(c, ctx),
    );
  if (!ctx.voz.abierto || ctx.voz.c !== c || ctx.voz.m?.num !== m.num) return null;
  return h('div', { class: 'card voz panel-voz' },
    h('div', { class: 'barra' },
      btn('🎤 Dictar', ctx.alternarVoz, { 'data-k': 'vb' }),
      btn('Cambiar ámbito', () => ctx.volverSeleccionTerritorio(c)),
      btn('✕ Cerrar', () => { ctx.pararVoz(); ctx.render(); }),
    ),
    h('div', { class: 'barra' },
      btn('◀ Col. ant.', () => ctx.navegarColumna(-1),
        { 'data-k': 'vcol|ant', 'aria-label': 'Columna anterior' }),
      h('span', { class: 'nota', 'data-k': 'vcol|num' }, `Columna ${m.num}`),
      btn('Col. adelante ▶', () => ctx.navegarColumna(+1),
        { 'data-k': 'vcol|sig', 'aria-label': 'Columna adelante' }),
    ),
    h('div', { class: 'vobj',  'data-k': 'vobj' }),
    h('div', { class: 'nota',  'data-k': 'vayuda' }),
    crearControlMesa(c, ctx),
    h('div', { class: 'nota voz-oido', 'data-k': 'voido' }),
    h('p',   { class: 'mal',   'data-k': 'vmsg' }),
    selectorMesaPendiente(c, ctx),
    h('div', { class: 'barra' },
      btn('▲ Alto',     () => { ctx.irA(ctx.voz.pos - 1); ctx.pintarVoz(); }),
      btn('🗑 Olvida',  ctx.borrarCeldaVoz, { title: 'Vacía la celda actual' }),
      btn('Adelanta ▼', () => { ctx.irA(ctx.voz.pos + 1); ctx.pintarVoz(); }),
    ),
    h('details', {},
      h('summary', {}, 'Comandos de voz'),
      h('table', { class: 'voz-tabla-cmd' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Di esto'), h('th', {}, 'Acción'))),
        h('tbody', {},
          h('tr', {}, h('td', {}, '«Avanza» · «Vuelve»'),           h('td', {}, 'Siguiente o anterior casilla')),
          h('tr', {}, h('td', {}, '«Quita» · «Olvida»'),            h('td', {}, 'Vaciar casilla actual')),
          h('tr', {}, h('td', {}, '«Avanza columna» · «Vuelve columna»'), h('td', {}, 'Cambiar de columna')),
          h('tr', {}, h('td', {}, '«Cambiar»'),                     h('td', {}, 'Volver al selector de ámbito')),
          h('tr', {}, h('td', {}, '«Siguiente cargo» · «Anterior cargo»'), h('td', {}, 'Navegar entre secciones')),
          h('tr', {}, h('td', {}, '«Nueva» + seis dígitos'),         h('td', {}, 'Crear o enfocar columna')),
          h('tr', {}, h('td', {}, 'Una cantidad'),                   h('td', {}, 'Guardar y avanzar')),
        ),
      ),
    ),
  );
}

export function panelVozTerritorioSinMesas(c, ctx) {
  return h('div', { class: 'card voz panel-voz' },
    h('div', { class: 'barra' },
      btn('🎤 Dictar', ctx.alternarVoz, { 'data-k': 'vb' }),
      btn('Cambiar ámbito', () => ctx.volverSeleccionTerritorio(c)),
      btn('✕ Cerrar', () => { ctx.pararVoz(); ctx.render(); }),
    ),
    h('p', { class: 'nota' },
      `Ámbito ${territorioActivo(c)} · sin mesas asignadas. Di «Nueva» y seis dígitos para añadir una mesa distrital, o impórtala en «Datos».`),
    h('p',   { class: 'nota',     'data-k': 'vayuda' }),
    h('div', { class: 'nota voz-oido', 'data-k': 'voido' }),
    h('p',   { class: 'mal',      'data-k': 'vmsg' }),
    selectorMesaPendiente(c, ctx),
    crearControlMesa(c, ctx),
  );
}

// ─── Vista principal: tabla de votación ───────────────────────────────────────
export function tabla(c, ctx, descargar) {
  if (!navegacionCompleta(c)) return vistaSeleccionTerritorios(c, ctx);

  const territorio = territorioActivo(c);

  const ms     = mesasVisibles(c);
  const titulo = h('h2', {}, 'Tabla de votos · ' + CARGOS[c] + (territorio ? ' · ' + territorio : ''));
  const volver = h('p', {}, h('a', { href: '#/' }, '← Tablero'));

  sel = ms.length ? Math.min(sel, ms.length - 1) : 0;
  const completa = vista === 'completa';
  const cols     = completa ? ms : ms[sel] ? [ms[sel]] : [];
  const filas    = filasDe(c);

  const inp = (m, x, ci, r) => h('input', {
    inputmode: 'numeric', pattern: '[0-9]*', enterkeyhint: 'next',
    autocomplete: 'off', 'aria-label': `Mesa ${m.num}`,
    maxlength: String(m.hab || Number.MAX_SAFE_INTEGER).length,
    'data-c': ci, 'data-r': r,
    value:    S.votos[key(c, m.num, x)] ?? '',
    disabled: estaCerrada(c, m),
    oninput:  e => filtrar(c, m, x, e.target),
    onchange: e => guardarCelda(c, m, x, e.target, ctx),
    onkeydown: mover,
    onfocus:  e => sincronizarCeldaVoz(c, m, r, e.target, ctx),
  });

  const fila = ([t, x, esOrg], r) => h('tr', { 'data-f': r, class: esOrg ? 'org-row' : '' },
    h('th', {}, esOrg ? h('span', { class: 'org-nombre', title: t }, t) : t),
    ...cols.map((m, ci) => h('td', {}, inp(m, x, ci, r))),
    completa && h('td', { 'data-k': 'to|' + x }),
    completa && h('td', esOrg ? { 'data-k': 'p1|' + x } : {}),
    completa && h('td', { 'data-k': 'p2|' + x }),
  );

  const calc = (label, k) => h('tr', { class: 'calc' },
    h('th', {}, label),
    ...cols.map(m => h('td', { 'data-k': k + '|' + m.num })),
    completa && h('td', { 'data-k': k + '|T' }),
    completa && h('td'),
    completa && h('td'),
  );

  const barra = h('div', { class: 'barra' },
    btn('Por columna',    () => cambiarVista('mesa',     ctx), { class: completa ? '' : 'on' }),
    btn('Bloque (máx. 12)', () => cambiarVista('completa', ctx), { class: completa ? 'on' : '' }),
  );

  const navMesa = !completa && ms.length > 0 && h('div', { class: 'nav-mesa' },
    btn('◀', () => { sel--; ctx.render(); }, { disabled: sel === 0, 'aria-label': 'Columna anterior' }),
    h('select', { 'aria-label': 'Elegir columna', 'data-k': 'nav|mesa',
      onchange: e => { sel = Number(e.target.value); ctx.render(); } },
      ...ms.map((m, i) => h('option', { value: i, selected: i === sel },
        String(m.num) + (m.local ? ' · ' + m.local : ''))),
    ),
    btn('▶', () => { sel++; ctx.render(); }, { disabled: sel === ms.length - 1, 'aria-label': 'Columna siguiente' }),
  );

  const totalMesasDistrito = mesasTrabajo(c).length;
  const totalPaginas       = Math.max(1, Math.ceil(totalMesasDistrito / MAX_MESAS_BLOQUE));
  const pagina             = paginaPorCargo[c] || 0;
  const navBloque          = totalPaginas > 1 && h('div', { class: 'nav-mesa' },
    btn('◀', () => cambiarPaginaMesa(c, -1, ctx),
      { disabled: pagina === 0, 'aria-label': 'Bloque anterior' }),
    h('span', {}, `Mesas ${pagina * MAX_MESAS_BLOQUE + 1}–${Math.min((pagina + 1) * MAX_MESAS_BLOQUE, totalMesasDistrito)} de ${totalMesasDistrito}`),
    btn('▶', () => cambiarPaginaMesa(c, 1, ctx),
      { disabled: pagina >= totalPaginas - 1, 'aria-label': 'Bloque siguiente' }),
  );

  const panel = ms.length ? panelVoz(c, ms[sel], ctx) : panelVozTerritorioSinMesas(c, ctx);
  const reg   = S.log.filter(e => e.cargo === c).slice(-5).reverse();
  const pe    = mkPanelExp(descargar, 'Exportar tabla · ' + CARGOS[c],
    FORMATOS('tabla').map(([t, id]) => [t, id, () => ({ cargo: c, territorio })]));

  return h('section', { class: 'vista-cargo' },
    volver, titulo, rutaNavegacion(c, ctx), barra, navBloque, navMesa, panel, comandosVoz(),
    h('div', { class: 'scroll tabla-scroll' },
      h('table', { class: 'tabla-votacion' },
        h('thead', {}, h('tr', {},
          h('th', {}),
          ...cols.map(m => h('th', {},
            String(m.num),
            h('span', { 'data-k': 'av|' + m.num, class: 'mal' }),
            h('div', { class: 'sub' }, m.local),
          )),
          completa && h('th', {}, 'Total'),
          completa && h('th', {}, '% válidos'),
          completa && h('th', {}, '% total'),
        )),
        h('tbody', {},
          ...filas.map(fila),
          calc('Total por mesa',  't'),
          calc('Omisos (no votaron)', 'om'),
          h('tr', { class: 'calc' },
            h('th', {}, 'Votantes por mesa (electores hábiles)'),
            ...cols.map(m => h('td', {}, h('input', {
              type: 'number', min: '1', inputmode: 'numeric', autocomplete: 'off',
              'aria-label': `Electores hábiles de la mesa ${m.num}`,
              value: m.hab > 0 ? m.hab : '',
              onchange: e => guardarHab(c, m, e.target),
            }))),
            completa && h('td', { 'data-k': 'hab|T' }),
            completa && h('td'),
            completa && h('td'),
          ),
          h('tr', {},
            h('th', {}, 'Estado'),
            ...cols.map(m => h('td', {},
              h('div', { 'data-k': 'es|' + m.num }),
              btn(estaCerrada(c, m) ? 'Reabrir' : 'Cerrar mesa', () => {
                if (!estaCerrada(c, m)) return cerrar(c, m, ctx);
                reabriendo = { c, num: m.num };
                ctx.render();
                const p = document.getElementById('panel-reabrir');
                p.scrollIntoView({ behavior: 'smooth', block: 'center' });
                p.querySelector('textarea').focus();
              }, { 'data-k': 'bt|' + m.num }),
            )),
            completa && h('td'),
            completa && h('td'),
            completa && h('td'),
          ),
        ),
      )
    ),
    h('p', { class: 'mal', 'data-k': 'nota' }),
    h('pre', { class: 'msg', 'data-k': 'avtxt' }),
    h('p', {}, mkBotonExp('Exportar tabla', pe)),
    pe,
    panelReabrir(c, ctx),
    h('h3', {}, 'Bitácora de este cargo (últimos 5)'),
    reg.length
      ? h('ul', { class: 'bitacora' }, ...reg.map(e =>
          h('li', {}, `${new Date(e.t).toLocaleString('es-PE')} · Mesa ${e.mesa} · ${e.evento} · ${e.usuario || '—'}`)
        ))
      : h('p', { class: 'nota' }, 'Sin eventos todavía.'),
    h('p', {}, h('a', { href: '#/bitacora',
      onclick: () => ctx.setFiltroBit?.(c),
    }, 'Ver bitácora completa')),
  );
}
