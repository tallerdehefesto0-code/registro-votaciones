// voz-motor.js — Todo el sistema de entrada por voz.
//
// Lo que vive aquí (y solo aquí):
//   • Monitor de voz (aside flotante)
//   • Estado de voz y motor SpeechRecognition (reintentos de red incluidos)
//   • Lógica de voz: guardar / borrar / navegar columnas y territorios
//   • Despachador y procesador de comandos de voz
//   • pintarVoz() (actualiza el panel de voz sin re-render completo)
//   • `ctx`: el contexto que app.js pasa a ui-tabla.js
//
// app.js solo conserva el router, render() y el arranque.
//
// `render` es de app.js; se recibe con enlazarRender(render) para evitar una
// importación circular (voz-motor ↔ app). Nadie más importa este módulo.

import { CARGOS, key as key_of, maxCelda, errorHab,
         mesaCerradaEnAlgunCargo }                                  from './calc.js';
import { interpretar, coincideFonetico, coincideDistrito,
         leerDigitosDictados }                                     from './voz.js';
import { st, save, registrarEvento }                               from './state.js';
import { navegacionCargo, contextoDe, navegacionCompleta,
         pasoNavegacion, etiquetaPaso, opcionesNavegacion,
         fraseAmbito, territorioActivo }                           from './navegacion.js';
import { h }                                                       from './ui-helpers.js';
import { filasDe, mesasTrabajo, mesasVisibles,
         paginaPorCargo, setSel, actualizarTabla,
         agregarCodigoMesa, MAX_MESAS_BLOQUE, getApp }             from './ui-tabla.js';
import { setFiltroBit }                                            from './ui-bitacora.js';

// ─── Acceso al estado ─────────────────────────────────────────────────────────
const CS = Object.keys(CARGOS);
const S  = new Proxy({}, {
  get: (_, prop) => st.S[prop],
  set: (_, prop, value) => { st.S[prop] = value; return true; },
});

// ─── Enlace con el render de app.js ───────────────────────────────────────────
let renderApp = () => {};
export function enlazarRender(fn) { renderApp = fn; }
const render = () => renderApp();

// ─── Helpers de consulta de DOM ───────────────────────────────────────────────
const app = () => getApp();
const q   = k  => app()?.querySelector(`[data-k="${k}"]`);
const set = (k, t) => { const e = q(k); if (e) e.textContent = t; };
const on  = (k, f) => { const e = q(k); if (e) f(e); };

// ─────────────────────────────────────────────────────────────────────────────
// MONITOR DE VOZ (aside flotante)
// ─────────────────────────────────────────────────────────────────────────────
const monitorVozTexto = h('strong', {}, 'Esperando voz…');
const monitorVoz = h('aside',
  { class: 'monitor-voz', role: 'status', 'aria-live': 'polite', hidden: true },
  h('span', {}, 'Escuchando: '), monitorVozTexto,
);
document.body.append(monitorVoz);

let limpiezaMonitorVoz = null;
let versionMonitorVoz  = 0;

function mostrarMonitorVoz(texto, limpiar = false) {
  if (limpiezaMonitorVoz !== null) clearTimeout(limpiezaMonitorVoz);
  limpiezaMonitorVoz = null;
  const version = ++versionMonitorVoz;
  monitorVoz.hidden = false;
  monitorVoz.classList.remove('confirmado');
  monitorVozTexto.textContent = texto || 'Esperando voz…';
  if (limpiar) limpiezaMonitorVoz = setTimeout(() => {
    if (version !== versionMonitorVoz) return;
    monitorVozTexto.textContent = 'Esperando voz…';
    limpiezaMonitorVoz = null;
  }, 2200);
}

function ocultarMonitorVoz() {
  if (limpiezaMonitorVoz !== null) clearTimeout(limpiezaMonitorVoz);
  limpiezaMonitorVoz = null;
  versionMonitorVoz++;
  monitorVoz.classList.remove('confirmado');
  monitorVoz.hidden = true;
}

function confirmarComandoNueva() {
  voz.esperandoCodigo = true;
  voz.digitosCodigo   = '';
  voz.msg = 'Comando aceptado. Dicta el código de mesa de seis dígitos.';
  if (limpiezaMonitorVoz !== null) clearTimeout(limpiezaMonitorVoz);
  const version = ++versionMonitorVoz;
  monitorVoz.hidden = false;
  monitorVoz.classList.add('confirmado');
  monitorVozTexto.textContent = '¡Comando aceptado! Dicta el código de 6 dígitos…';
  limpiezaMonitorVoz = setTimeout(() => {
    if (version !== versionMonitorVoz) return;
    monitorVozTexto.textContent = 'Esperando voz…';
    monitorVoz.classList.remove('confirmado');
    limpiezaMonitorVoz = null;
  }, 7000);
  pintarVoz();
}

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO DE VOZ
// ─────────────────────────────────────────────────────────────────────────────
const voz = {
  abierto: false,
  c: '', m: null, pos: 0,
  escuchando: false, oido: '', msg: '',
  esperandoCodigo: false, digitosCodigo: '',
};
let rec                 = null;
let conservarVoz        = false;
let reintentoVoz        = null;
let reintentoRed        = 0;
let onlineHandler       = null;
let ultimaCeldaCentrada = null;
let cargoAutoIniciado   = '';
// Código de mesa dictado antes de elegir distrito: { cargo, codigo, opciones }.
// Mientras exista, lo siguiente que se diga se interpreta como el distrito de esa mesa.
let codigoPendiente     = null;

const RETRASOS_RED = [500, 1000, 2000, 4000];

// ─────────────────────────────────────────────────────────────────────────────
// API PARA app.js (router)
// ─────────────────────────────────────────────────────────────────────────────
// Devuelve el valor actual de «conservar voz» y lo reinicia. render() lo usa así:
//   if (!consumirConservarVoz()) pararVoz();
export function consumirConservarVoz() {
  const v = conservarVoz;
  conservarVoz = false;
  return v;
}

// Detecta si se está entrando a un cargo por primera vez; reinicia su navegación
// territorial y paginación. Devuelve true si hay que abrir el panel de voz.
export function prepararEntradaCargo(ruta, cargo) {
  if (ruta !== 'cargo') cargoAutoIniciado = '';
  const entrar = ruta === 'cargo' && !!CARGOS[cargo] && cargoAutoIniciado !== cargo;
  if (entrar) {
    cargoAutoIniciado        = cargo;
    codigoPendiente          = null;
    navegacionCargo[cargo]   = { region: '', provincia: '', distrito: '' };
    paginaPorCargo[cargo]    = 0;
  }
  return entrar;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXTO (ctx) que se pasa a los módulos de UI
// Evita importación circular: los módulos de UI no importan app.js.
// ─────────────────────────────────────────────────────────────────────────────
export const ctx = {
  voz,
  render:       () => render(),
  pintarVoz:    () => pintarVoz(),
  conservarVoz: () => conservarVoz,
  setConservarVoz: v => { conservarVoz = v; },
  alternarVoz:  () => alternarVoz(),
  pararVoz:     () => pararVoz(),
  volverSeleccionTerritorio: c => volverSeleccionTerritorio(c),
  navegarColumna:            d => navegarColumna(d),
  irA:                       i => irA(i),
  borrarCeldaVoz:            () => borrarCeldaVoz(),
  seleccionarTerritorio:     (c, n) => seleccionarTerritorio(c, n),
  abrirVozSinTerritorio:     c => abrirVozSinTerritorio(c),
  irAColumna:                cod => irAColumna(cod),
  setFiltroBit:              c => setFiltroBit(c),
};

// ─────────────────────────────────────────────────────────────────────────────
// MOTOR DE VOZ
// ─────────────────────────────────────────────────────────────────────────────
function desplazarCeldaJuntoAColumnaFija(input) {
  const contenedor   = input.closest('.tabla-scroll');
  const columnaFija  = contenedor?.querySelector('.tabla-votacion tbody th:first-child');
  if (!contenedor || !columnaFija) return;
  const cajaContenedor = contenedor.getBoundingClientRect();
  const cajaInput      = input.getBoundingClientRect();
  const anchoFijo      = columnaFija.getBoundingClientRect().width;
  const separacion     = 8;
  const objetivo = contenedor.scrollLeft + cajaInput.left - cajaContenedor.left - anchoFijo - separacion;
  const maximo   = Math.max(0, contenedor.scrollWidth - contenedor.clientWidth);
  contenedor.scrollTo({ left: Math.max(0, Math.min(maximo, objetivo)), behavior: 'smooth' });
  const top = window.scrollY + cajaInput.top - (window.innerHeight - cajaInput.height) / 2;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function limpiarReintentoVoz() {
  if (reintentoVoz !== null) clearTimeout(reintentoVoz);
  reintentoVoz = null;
}

function detenerEscucha(cerrarPanel = false) {
  voz.escuchando = false;
  ocultarMonitorVoz();
  limpiarReintentoVoz();
  if (onlineHandler) window.removeEventListener('online', onlineHandler);
  onlineHandler = null;
  const anterior = rec; rec = null;
  try { anterior && anterior.abort(); } catch {}
  if (cerrarPanel) {
    voz.abierto         = false;
    voz.esperandoCodigo = false;
    voz.digitosCodigo   = '';
    codigoPendiente     = null;
  }
}

export function pararVoz() { detenerEscucha(true); }

function reintentarEn(delay) {
  limpiarReintentoVoz();
  reintentoVoz = setTimeout(() => {
    reintentoVoz = null;
    if (voz.escuchando) iniciarVoz(true);
  }, delay);
}

function iniciarVoz(automatico = false) {
  if (!automatico && voz.escuchando && rec) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    voz.msg = 'Este navegador no admite voz. Usa Chrome (Android o PC) o escribe en la tabla.';
    return pintarVoz();
  }
  limpiarReintentoVoz();
  if (onlineHandler) window.removeEventListener('online', onlineHandler);
  onlineHandler = () => {
    if (!voz.escuchando) return;
    reintentoRed = 0; voz.msg = '';
    reintentarEn(0);
  };
  window.addEventListener('online', onlineHandler);

  const anterior = rec; rec = null;
  try { anterior && anterior.abort(); } catch {}

  let r;
  try { r = new SR(); }
  catch {
    voz.escuchando = false;
    voz.msg = 'No se pudo iniciar el reconocimiento de voz.';
    return pintarVoz();
  }

  rec = r;
  let procesadoHasta = -1;
  let ultimoFinal = { texto: '', t: 0 };
  r.lang = 'es-PE'; r.interimResults = true; r.continuous = true;

  r.onresult = e => {
    if (rec !== r) return;
    reintentoRed = 0;
    if (voz.msg.startsWith('La conexión de voz')) voz.msg = '';
    let huboFinal = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const texto = res[0].transcript;
      voz.oido = texto;
      mostrarMonitorVoz(texto, res.isFinal);
      if (!res.isFinal || i <= procesadoHasta) continue;
      procesadoHasta = i;
      const clave = texto.trim().toLowerCase();
      const ahora = Date.now();
      const repetido = clave === ultimoFinal.texto && ahora - ultimoFinal.t < 1200;
      ultimoFinal = { texto: clave, t: ahora };
      if (repetido) continue;
      huboFinal = true;
      procesarVoz(texto);
      if (rec !== r) return;
    }
    if (!huboFinal) pintarVoz();
  };

  r.onerror = e => {
    if (rec !== r) return;
    if (['not-allowed', 'service-not-allowed'].includes(e.error)) {
      detenerEscucha(); voz.msg = 'El micrófono no tiene permiso. Toca el candado junto a la dirección, elige Permitir y recarga.';
    } else if (e.error === 'network') {
      const demora = RETRASOS_RED[Math.min(reintentoRed, RETRASOS_RED.length - 1)];
      reintentoRed++;
      if (reintentoRed > 3) voz.msg = 'La conexión de voz está intermitente; seguiré reintentando.';
      reintentarEn(demora);
    }
    else if (!['no-speech', 'aborted'].includes(e.error)) {
      voz.msg = `Error de micrófono: ${e.error}.`;
    }
    pintarVoz();
  };

  r.onend = () => {
    if (rec !== r) return;
    rec = null;
    if (voz.escuchando && reintentoVoz === null) reintentarEn(250);
    else pintarVoz();
  };

  voz.escuchando = true;
  mostrarMonitorVoz('Esperando voz…');
  if (!automatico) { reintentoRed = 0; voz.msg = ''; }

  try { r.start(); }
  catch {
    rec = null;
    const demora = RETRASOS_RED[Math.min(reintentoRed, RETRASOS_RED.length - 1)];
    reintentoRed++;
    if (reintentoRed > 3) voz.msg = 'La conexión de voz está intermitente; seguiré reintentando.';
    reintentarEn(demora);
  }
  pintarVoz();
}

const alternarVoz = () => {
  if (voz.escuchando) { detenerEscucha(); pintarVoz(); }
  else iniciarVoz();
};

const irA = i => { voz.pos = Math.max(0, Math.min(filasDe(voz.c).length, i)); };

export function abrirVozSinTerritorio(c, escuchar = true) {
  Object.assign(voz, {
    abierto: true, c, m: null, pos: 0, oido: '', msg: '',
    esperandoCodigo: false, digitosCodigo: '',
  });
  conservarVoz = true; render();
  if (escuchar) iniciarVoz();
}

// Las organizaciones ya no se agregan por voz: con el catálogo oficial cargado, un
// número mal oído cruzaría votos sin aviso. Se usa el formulario de la tabla.
function agregarOrgPorVoz() {
  voz.msg = 'Las organizaciones se administran en la pestaña Datos.';
  pintarVoz();
}

// ─────────────────────────────────────────────────────────────────────────────
// LÓGICA DE VOZ: guardar / borrar / navegar
// ─────────────────────────────────────────────────────────────────────────────
function proponer(v) {
  if (!voz.m) {
    voz.msg = 'Selecciona primero Región, Provincia y Distrito de trabajo.';
    return pintarVoz();
  }
  const fl = filasDe(voz.c);
  if (voz.pos === fl.length) {
    if (mesaCerradaEnAlgunCargo(S, voz.m)) {
      voz.msg = 'Mesa cerrada: reábrela para cambiar los electores hábiles';
      return pintarVoz();
    }
    const error = errorHab(S, voz.m, v);
    if (error) {
      voz.msg = error;
      return pintarVoz();
    }
    const antes = voz.m.hab || 0;
    voz.m.hab = v;
    registrarEvento(voz.c, voz.m.num, `Electores hábiles: ${antes} → ${v}`);
    save();
    actualizarTabla(voz.c, true, ctx);
    voz.msg = '';
    const mesas = mesasTrabajo(voz.c);
    const indice = mesas.findIndex(m => String(m.num) === String(voz.m.num));
    if (indice >= mesas.length - 1) {
      voz.msg = 'Última mesa. Revisa los totales y cierra la mesa.';
      return pintarVoz();
    }
    navegarColumna(1);
    return;
  }
  const max = maxCelda(S, voz.c, voz.m, fl[voz.pos][1]);
  if (v > max) {
    voz.msg = `${v} supera el máximo permitido (${max}) para esta casilla. Repite la cantidad.`;
    return pintarVoz();
  }
  guardarValorVoz(v);
}

function guardarValorVoz(v) {
  const fl = filasDe(voz.c);
  S.votos[key_of(voz.c, voz.m.num, fl[voz.pos][1])] = v;
  save();
  actualizarTabla(voz.c, true, ctx);
  voz.msg = '';
  irA(voz.pos + 1);
  pintarVoz();
}

function borrarCeldaVoz() {
  const fl = filasDe(voz.c);
  if (voz.pos === fl.length) {
    voz.msg = 'Los electores hábiles no se borran por voz. Corrígelos en la casilla.';
    return pintarVoz();
  }
  const x = fl[voz.pos][1];
  delete S.votos[key_of(voz.c, voz.m.num, x)];
  save();
  actualizarTabla(voz.c, true, ctx);
  const ci  = mesasVisibles(voz.c).findIndex(m => m.num === voz.m.num);
  const inp = app()?.querySelector(`input[data-c="${ci}"][data-r="${voz.pos}"]`);
  if (inp) inp.value = '';
  voz.msg = 'Celda olvidada.';
  pintarVoz();
}

// ── Código de mesa dictado ANTES de elegir el distrito de trabajo ─────────────
// Distritos posibles para el cargo, respetando la región/provincia ya elegidas.
// En Alcalde Distrital las capitales de provincia no participan.
const distritosPosibles = c => {
  const n = contextoDe(c);
  return S.geografia.filter(g =>
    (!n.region    || g.region    === n.region) &&
    (!n.provincia || g.provincia === n.provincia) &&
    (c !== 'distrito' || !g.capital));
};

function codigoSinTerritorio(codigo) {
  const c = voz.c;
  if (!/^\d{6}$/.test(codigo)) {
    voz.msg = `El código debe tener 6 dígitos. Oí: ${codigo}.`;
    return pintarVoz();
  }
  const candidatos = distritosPosibles(c);
  const mesa       = S.mesas.find(m => String(m.num) === codigo);

  // La voz no crea mesas: el código tiene que estar en el catálogo.
  if (!mesa) {
    voz.msg = `La mesa ${codigo} no existe en el catálogo. Revisa el código.`;
    return pintarVoz();
  }

  // La mesa tiene distrito: se deduce solo.
  if (mesa.distrito) {
    const geo = S.geografia.find(g => g.distrito === mesa.distrito);
    if (!geo || !candidatos.includes(geo)) {
      voz.msg = `La mesa ${codigo} pertenece a ${mesa.distrito}, que no corresponde a este cargo o ámbito.`;
      return pintarVoz();
    }
    return entrarPorCodigo(geo, codigo);
  }
  if (!candidatos.length) {
    voz.msg = 'No hay distritos disponibles para este cargo. Revisa «Datos» → Geografía.';
    return pintarVoz();
  }
  if (candidatos.length === 1) return entrarPorCodigo(candidatos[0], codigo);

  // Mesa del catálogo sin distrito y varios distritos posibles: se pregunta por voz.
  codigoPendiente = { cargo: c, codigo, opciones: candidatos };
  voz.msg = `Código ${codigo}: di el distrito al que pertenece (${candidatos.map(g => g.distrito).join(', ')}).`;
  pintarVoz();
}

// Fija región/provincia/distrito del cargo según el distrito de la mesa y salta a su
// columna. La voz NUNCA crea mesas: solo navega a las del catálogo.
function entrarPorCodigo(geo, codigo) {
  const c = voz.c, n = contextoDe(c);
  codigoPendiente = null;
  voz.esperandoCodigo = false; voz.digitosCodigo = '';
  const mesa = S.mesas.find(m => String(m.num) === codigo);
  if (!mesa) {
    voz.msg = `La mesa ${codigo} no existe en el catálogo. Revisa el código.`;
    return pintarVoz();
  }
  n.region = geo.region; n.provincia = geo.provincia; n.distrito = geo.distrito;
  paginaPorCargo[c] = 0;
  if (!mesa.distrito) mesa.distrito = geo.distrito;
  save();
  return irAColumna(codigo);
}

function irAColumna(cod) {
  const codStr   = String(cod);
  if (!navegacionCompleta(voz.c)) return codigoSinTerritorio(codStr);
  const todas    = mesasTrabajo(voz.c);
  let   idxTotal = todas.findIndex(m => String(m.num) === codStr);
  if (idxTotal >= 0) paginaPorCargo[voz.c] = Math.floor(idxTotal / MAX_MESAS_BLOQUE);

  let nuevoIdx = mesasVisibles(voz.c).findIndex(m => String(m.num) === codStr);
  if (nuevoIdx < 0) {
    if (!/^\d{6}$/.test(codStr)) {
      voz.msg = `El código debe tener 6 dígitos. Oí: ${cod}.`;
      return pintarVoz();
    }
    // La voz no crea mesas: si no está en el catálogo, se avisa y no se hace nada.
    if (!S.mesas.some(m => String(m.num) === codStr)) {
      voz.msg = `La mesa ${codStr} no existe en el catálogo. Revisa el código.`;
      return pintarVoz();
    }
    if (!agregarCodigoMesa(voz.c, codStr, null, ctx)) return pintarVoz();
    idxTotal = mesasTrabajo(voz.c).findIndex(m => String(m.num) === codStr);
    paginaPorCargo[voz.c] = Math.floor(idxTotal / MAX_MESAS_BLOQUE);
    nuevoIdx = mesasVisibles(voz.c).findIndex(m => String(m.num) === codStr);
    voz.msg  = `Columna ${codStr}.`;
  } else {
    voz.msg = `Columna ${cod}.`;
  }

  const msActual = mesasVisibles(voz.c);
  const miFinal  = msActual[nuevoIdx] ?? msActual[msActual.length - 1];
  voz.m  = miFinal;
  setSel(msActual.findIndex(m => m.num === miFinal.num));
  const primeraVacia = filasDe(voz.c).findIndex(([, x]) => S.votos[key_of(voz.c, miFinal.num, x)] === undefined);
  voz.pos = Math.max(0, primeraVacia);
  conservarVoz = true; render(); pintarVoz();
}

function navegarColumna(delta) {
  const todas       = mesasTrabajo(voz.c);
  const indice      = todas.findIndex(m => m.num === voz.m.num);
  const nuevoGlobal = Math.max(0, Math.min(todas.length - 1, indice + delta));
  if (nuevoGlobal === indice || nuevoGlobal < 0) {
    voz.msg = delta > 0 ? 'Ya en la última columna.' : 'Ya en la primera columna.';
    return pintarVoz();
  }
  paginaPorCargo[voz.c] = Math.floor(nuevoGlobal / MAX_MESAS_BLOQUE);
  const ms       = mesasVisibles(voz.c);
  const nuevoIdx = nuevoGlobal % MAX_MESAS_BLOQUE;
  voz.m  = ms[nuevoIdx];
  setSel(nuevoIdx);
  const vacia = filasDe(voz.c).findIndex(([, x]) => S.votos[key_of(voz.c, voz.m.num, x)] === undefined);
  voz.pos = vacia < 0 ? 0 : vacia;
  voz.msg = `Columna ${voz.m.num}.`;
  conservarVoz = true; render(); pintarVoz();
}

function seleccionarTerritorio(c, nombre) {
  const n    = contextoDe(c);
  const paso = pasoNavegacion(c);
  if (!paso) return;
  codigoPendiente = null;
  n[paso] = nombre;
  if (paso === 'region')   { n.provincia = ''; n.distrito = ''; }
  if (paso === 'provincia') n.distrito = '';
  paginaPorCargo[c] = 0;
  voz.esperandoCodigo = false; voz.digitosCodigo = '';
  if (!navegacionCompleta(c)) {
    voz.m   = null;
    voz.msg = `${etiquetaPaso(paso)} ${nombre}.`;
    conservarVoz = true; render(); pintarVoz();
    return;
  }
  // Navegación completa: posicionar en la primera mesa no cerrada
  const territorio = (c === 'distrito' ? contextoDe(c).distrito
    : c === 'region' ? contextoDe(c).region : contextoDe(c).provincia);
  
  const ms              = mesasVisibles(c);
  const estaCerradaFn   = (cargo, m) => !!S.cerradas[cargo + '|' + m.num];
  const abierta         = ms.findIndex(m => !estaCerradaFn(c, m));
  const indice          = abierta >= 0 ? abierta : 0;
  voz.m   = ms[indice] || null;
  setSel(indice);
  const primeraVacia = voz.m
    ? filasDe(c).findIndex(([, x]) => S.votos[key_of(c, voz.m.num, x)] === undefined)
    : 0;
  voz.pos = Math.max(0, primeraVacia);
  voz.msg = ms.length
    ? `Distrito ${n.distrito} · ${ms.length} mesas en el bloque.`
    : `Distrito ${n.distrito} · plantilla lista.`;
  conservarVoz = true; render(); pintarVoz();
}

function volverSeleccionTerritorio(c) {
  navegacionCargo[c]        = { region: '', provincia: '', distrito: '' };
  voz.m = null; voz.esperandoCodigo = false; voz.digitosCodigo = '';
  codigoPendiente           = null;
  paginaPorCargo[c]         = 0;
  conservarVoz = true; render(); pintarVoz();
}

function acumularDigitosCodigo(texto) {
  const digitos = leerDigitosDictados(texto);
  if (digitos === null || !digitos.length) {
    voz.msg = 'Di los seis dígitos del código.';
    return pintarVoz();
  }
  const codigo = voz.digitosCodigo + digitos;
  if (codigo.length > 6) {
    voz.esperandoCodigo = false; voz.digitosCodigo = '';
    voz.msg = 'Se oyeron más de seis dígitos. Di «Nueva» para empezar otra vez.';
    return pintarVoz();
  }
  voz.digitosCodigo = codigo;
  if (codigo.length === 6) {
    voz.esperandoCodigo = false; voz.digitosCodigo = '';
    return irAColumna(codigo);
  }
  voz.msg = `Código: ${codigo.length}/6 dígitos.`;
  pintarVoz();
}

function abrirSeccionElectoral(cargo) {
  if (!CARGOS[cargo]) return;
  const [, ruta, actual] = location.hash.slice(1).split('/');
  if (ruta === 'cargo' && actual === cargo) {
    cargoAutoIniciado = '';
    render();
  } else location.hash = '#/cargo/' + cargo;
}

// ─────────────────────────────────────────────────────────────────────────────
// DESPACHADOR Y PROCESADOR DE VOZ
// ─────────────────────────────────────────────────────────────────────────────
function despacharVoz(r) {
  const filas  = filasDe(voz.c);
  const indice = x => filas.findIndex(([, y]) => y === x);
  const acciones = {
    'cmd:olvida':  () => { if (voz.m) borrarCeldaVoz(); },
    'cmd:abajo':   () => { irA(voz.pos + 1); pintarVoz(); },
    'cmd:alto':    () => { irA(voz.pos - 1); pintarVoz(); },
    'cmd:cambiar': () => volverSeleccionTerritorio(voz.c),
    col_adelante:  () => navegarColumna(1),
    col_vuelve:    () => navegarColumna(-1),
    seccion:       () => { const i = CS.indexOf(voz.c); location.hash = '#/cargo/' + CS[(i + r.delta + CS.length) % CS.length]; },
    seccion_abrir: () => abrirSeccionElectoral(r.cargo),
    ir:            () => { const i = indice(r.x); if (i >= 0) irA(i); pintarVoz(); },
    votantes:      () => { irA(filasDe(voz.c).length); proponer(r.valor); },
    valor:         () => proponer(r.valor),
    otro:          () => { const i = indice(r.x); if (i >= 0) { irA(i); proponer(r.valor); } else pintarVoz(); },
  };
  const clave  = r.tipo === 'cmd' ? `${r.tipo}:${r.cmd}` : r.tipo;
  const accion = acciones[clave];
  if (!accion) return false;
  accion();
  return true;
}

function procesarVoz(texto) {
  const r = interpretar(texto);
  if (r.tipo === 'org_nueva') return agregarOrgPorVoz(r);

  if (r.tipo === 'seccion_abrir') return despacharVoz(r);

  // Código de mesa pendiente de distrito: lo que se diga se interpreta como distrito.
  // Va antes de la selección de territorio porque «Lambayeque» también es región y provincia.
  if (codigoPendiente) {
    if (codigoPendiente.cargo !== voz.c) codigoPendiente = null;
    else {
      const coincidencias = codigoPendiente.opciones.filter(g => coincideDistrito(texto, g.distrito));
      if (coincidencias.length === 1) return entrarPorCodigo(coincidencias[0], codigoPendiente.codigo);
      if (coincidencias.length > 1) {
        voz.msg = 'No distinguí el distrito. Repítelo más despacio.';
        return pintarVoz();
      }
    }
  }

  // Selección de territorio
  if (!navegacionCompleta(voz.c)) {
    const coincidir     = pasoNavegacion(voz.c) === 'distrito' ? coincideDistrito : coincideFonetico;
    const coincidencias = opcionesNavegacion(voz.c).filter(nombre => coincidir(texto, nombre));
    const digitosOidos  = leerDigitosDictados(texto);
    if (coincidencias.length === 1 && !digitosOidos?.length) return seleccionarTerritorio(voz.c, coincidencias[0]);
    if (coincidencias.length > 1  && !digitosOidos?.length) {
      voz.msg = `No distinguí la ${etiquetaPaso(pasoNavegacion(voz.c))}. Repítela o selecciónala con un botón.`;
      return pintarVoz();
    }
  }

  // Código de mesa
  if (voz.esperandoCodigo) {
    if (r.tipo === 'ir_col') { voz.esperandoCodigo = false; voz.digitosCodigo = ''; return irAColumna(r.cod); }
    if (r.tipo === 'nueva')  { confirmarComandoNueva(); return r.digitos ? acumularDigitosCodigo(r.digitos) : undefined; }
    return acumularDigitosCodigo(texto);
  }
  if (r.tipo === 'nueva')   { confirmarComandoNueva(); return r.digitos ? acumularDigitosCodigo(r.digitos) : undefined; }
  if (r.tipo === 'ir_col')  return irAColumna(r.cod);
  if (despacharVoz(r)) return;
  voz.msg = `No entendí «${texto}».`;
  pintarVoz();
}

// ─────────────────────────────────────────────────────────────────────────────
// PINTAR VOZ (actualiza la UI de voz sin re-render completo)
// ─────────────────────────────────────────────────────────────────────────────
export function pintarVoz() {
  if (!voz.abierto) return;
  if (!voz.m) {
    set('vayuda', codigoPendiente
      ? `Código ${codigoPendiente.codigo}: di el distrito al que pertenece.`
      : voz.esperandoCodigo
      ? `Esperando código: ${voz.digitosCodigo.length}/6 dígitos. Di solo los dígitos.`
      : navegacionCompleta(voz.c)
        ? 'Di «Nueva» y los seis dígitos del código de mesa.'
        : `Di el nombre de ${fraseAmbito(voz.c)} para continuar.`);
    set('voido',   voz.oido ? `Oí: «${voz.oido}»` : '');
    set('vmsg',    voz.msg);
    set('vb',      voz.escuchando ? '⏹ Detener' : '🎤 Dictar');
    set('vcodigo', voz.esperandoCodigo ? `Esperando código: ${voz.digitosCodigo.length}/6 dígitos.` : '');
    return;
  }

  const fl    = filasDe(voz.c);
  if (!fl.length) return;
  const esHab   = voz.pos === fl.length;
  const [et, x] = esHab ? ['Votantes por mesa (electores hábiles)', null] : fl[voz.pos];
  const actual  = esHab
    ? (voz.m.hab > 0 ? voz.m.hab : undefined)
    : S.votos[key_of(voz.c, voz.m.num, x)];
  const todasLasMesas = mesasTrabajo(voz.c);
  const indiceGlobal  = todasLasMesas.findIndex(m => m.num === voz.m.num);

  set('vobj',   et + (actual !== undefined ? ` · actual: ${actual}` : ' · vacía'));
  set('vayuda', voz.esperandoCodigo
    ? `Esperando código: ${voz.digitosCodigo.length}/6 dígitos. Di solo los dígitos.`
    : 'Guiado y sin confirmación: cada cantidad válida se guarda al instante.');
  set('voido', voz.oido ? `Oí: «${voz.oido}»` : '');
  set('vmsg',  voz.msg);
  set('vb',    voz.escuchando ? '⏹ Detener' : '🎤 Dictar');

  on('vcol|ant', e => { e.disabled = indiceGlobal <= 0; });
  on('vcol|sig', e => { e.disabled = indiceGlobal < 0 || indiceGlobal >= todasLasMesas.length - 1; });
  set('vcol|num', voz.m ? `Columna ${voz.m.num}` : '');

  // Resaltar fila activa
  app()?.querySelectorAll('tr.activa').forEach(t => t.classList.remove('activa'));
  const tr = app()?.querySelector(`tr[data-f="${voz.pos}"]`);
  if (tr) tr.classList.add('activa');

  // Foco y auto-scroll en el input de la fila activa
  const ci  = mesasVisibles(voz.c).findIndex(m => m.num === voz.m.num);
  const inp = esHab
    ? app()?.querySelector(`input[data-c="${ci}"][data-hab="1"]`)
    : app()?.querySelector(`input[data-c="${ci}"][data-r="${voz.pos}"]`);
  if (inp && !inp.disabled) {
    if (document.activeElement !== inp) inp.focus({ preventScroll: true });
    if (inp !== ultimaCeldaCentrada) {
      ultimaCeldaCentrada = inp;
      desplazarCeldaJuntoAColumnaFija(inp);
    }
  }
}
