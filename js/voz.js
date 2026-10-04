// voz.js — Interpreta transcripciones; la captura y la pantalla viven en app.js.
const UN = {
  cero:0, un:1, uno:1, una:1, dos:2, tre:3, tres:3,
  cuatro:4, cinco:5, ocho:8, nueve:9, diez:10,
  // "once" rescatado con todas sus variantes fonéticas frecuentes
  once:11, onse:11, ponce:11, honse:11, honze:11, onze:11,
  doce:12, trece:13, catorce:14, quince:15,
  dieciocho:18, diecinueve:19,
  veinte:20, veintiun:21, veintiuno:21, veintiuna:21,
  veintidos:22, veintitres:23, veinticuatro:24, veinticinco:25,
  veintiocho:28, veintinueve:29,
  cuarenta:40, ochenta:80, noventa:90,
  cien:100, ciento:100,
  cuatrocientos:400, ochocientos:800, novecientos:900,
  seis:6, siete:7, dieciseis:16, diecisiete:17,
  veintiseis:26, veintisiete:27,
  treinta:30, cincuenta:50, sesenta:60, setenta:70,
  doscientos:200, trescientos:300, quinientos:500,
  seiscientos:600, setecientos:700,
};

// Filas especiales de datos (nombres de campo, no comandos de navegación)
const OT = {
  blanco:'blanco', blancos:'blanco',
  nulo:'nulo', nulos:'nulo',
  observable:'obs', observables:'obs',
};
const COMANDOS = {
  siguiente: ['avanza', 'adelante', 'siguiente'],
  anterior: ['vuelve', 'retrocede', 'anterior'],
  cambiar: ['cambiar', 'cambia', 'seleccion'],
  borrar: ['quita', 'olvida', 'borra', 'borrar'],
};
const NUEVA_ALIASES = ['nueva', 'nueve', 'mueva', 'prueba', 'cueva', 'lleva'];
const ORG_ALIASES = ['organizacion', 'organizaciones'];
const SECCIONES = {
  distrito: ['abre distrito'],
  provincia: ['abre provincia'],
  consejero: ['abre consejero', 'abre consejero regional'],
  region: ['abre region', 'abre gobernador', 'abre gobernadora'],
};

// ─────────────────────────────────────────────────────────────────────────────
// normalizarFonetica — aplica la misma equivalencia al texto oído y a los
// diccionarios, garantizando comparaciones independientes de ortografía.
//
// Reglas de unificación "ye/ll/y/ie":
//   ll  →  y   (lleque = yeque)
//   ie  →  ye  (Lambaieque = Lambayeque)
//   y   →  y   (ya era y, se mantiene)
//   lle →  ye  (Lamballeque = Lambayeque)
//   lly →  y   (variante rara)
//   ei  →  ey  (vocal+i antes de vocal, variante menor)
//
// La lógica aplica primero el reemplazo de dígrafos para evitar solapamientos.
// ─────────────────────────────────────────────────────────────────────────────
export function normalizarFonetica(texto) {
  return String(texto ?? '').toLowerCase()
    // 1. Eliminar tildes y diacríticos
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // 2. Eliminar todo salvo letras y números
    .replace(/[^a-z0-9 ]+/g, ' ')
    // 3. Unificar sonido "ye":
    //    - "lle" → "ye"  (antes de ll simple para no solapar)
    //    - "ll"  → "y"
    //    - "ie"  → "ye"
    //    - "y"   → "y"   (identidad, queda como está)
    .replace(/lle/g, 'ye')
    .replace(/ll/g, 'y')
    .replace(/ie/g, 'ye')
    // 4. Unificar sibilantes (s/c/x/z → s)
    .replace(/[scxz]/g, 's')
    // 5. Unificar b/v → b (el reconocedor confunde ambas)
    .replace(/v/g, 'b')
    // 6. Limpiar espacios
    .replace(/\s+/g, ' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Diccionario de alias duros — rescata transcripciones erróneas frecuentes.
// Las claves se construyen DESPUÉS de definir normalizarFonetica.
//
// Correcciones incluidas:
//   • "once": onse, ponce, honse, honze, onze → clave normalizada de "once"
//     (el rescate fonético ocurre al normalizar la clave "once" en UN_NORMALIZADO;
//      aquí se protege el uso como parte de un nombre de lugar o texto libre)
//   • Silabas "pe" (Motupe, Mórrope, Chóchope, Jayanca, Lambayeque):
//     el motor confunde "p" con t/b/f o la omite.
// ─────────────────────────────────────────────────────────────────────────────
const DISTRITO_ERRORES = {
  // ── Íllimo ──────────────────────────────────────────────────────────────
  [normalizarFonetica('Illimo')]:   ['hilimo', 'minimo', 'ilimo', 'iimo', 'yimo', 'elimo', 'ilemo', 'hilemo',
                                     'digimon', 'idioma', 'egman', 'eggman', 'egg man', 'ijimu', 'ijimo', 'igimo', 'ilimu'],
  // ── Pacora ──────────────────────────────────────────────────────────────
  [normalizarFonetica('Pacora')]:   ['atora', 'tacora', 'bacora'],

  // ── Motupe — sílaba "pe" confundida con te/be/fe o suprimida ───────────
  [normalizarFonetica('Motupe')]: [
    'motute', 'motube', 'motufe', 'motue',
    'motuto', 'motubo', 'motufo',           // variantes con vocal final
    'motupes', 'motup',                     // con s extra o truncado
  ],

  // ── Mórrope — sílaba "pe" confundida ────────────────────────────────────
  [normalizarFonetica('Morrope')]: [
    'morrote', 'morrobe', 'morrofe', 'morroe',
    'morroto', 'morrobo', 'morrofo',
    'morropes', 'morrop',
  ],

  // ── Chóchope — sílaba "pe" confundida, más variantes de "ch" ────────────
  [normalizarFonetica('Chochope')]: [
    'chocote', 'chocobe', 'chocofe', 'chochoe',
    'chochote', 'chochobe', 'chochofe',
    'chochoto', 'chochobo', 'chochofo',
    'chochopes', 'chochop',
  ],

  // ── Jayanca — "y" puede sonar "ll" o "j"; "ca" puede sonar "ga"/"ja" ───
  [normalizarFonetica('Jayanca')]: [
    'llayanca', 'jallanca', 'jayanga', 'jallanka',
    'jayanca', 'jayanka',
  ],

  // ── Lambayeque — "ye" transcrito como "ie", "lle", "ll", "e" ───────────
  [normalizarFonetica('Lambayeque')]: [
    'lambaieque', 'lamballeque', 'lambaleque',
    'lambayeque', 'lambayeke', 'lambayekes',
    'lambaieke', 'lambaleke',
  ],
};

const norm = texto => normalizarFonetica(texto).split(' ').filter(Boolean);
const UN_NORMALIZADO = Object.fromEntries(Object.entries(UN).map(([k, v]) => [normalizarFonetica(k), v]));
const OT_NORMALIZADO = Object.fromEntries(Object.entries({
  blanco:'blanco', blancos:'blanco', nulo:'nulo', nulos:'nulo',
  observable:'obs', observables:'obs',
}).map(([k, v]) => [normalizarFonetica(k), v]));

// ─────────────────────────────────────────────────────────────────────────────
// Levenshtein de dos filas — rápido y sin asignación de matriz completa
// ─────────────────────────────────────────────────────────────────────────────
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++)
      curr[j] = a[i-1] === b[j-1] ? prev[j-1] : 1 + Math.min(prev[j], curr[j-1], prev[j-1]);
    prev = curr;
  }
  return prev[b.length];
}

export function coincideFonetico(a, b) {
  const x = norm(a).join(' '), y = norm(b).join(' ');
  return x === y || levenshtein(x, y) <= Math.max(1, Math.floor(y.length * 0.15));
}

export function coincideDistrito(texto, nombre) {
  const transcripcion = norm(texto).join(' '), distrito = normalizarFonetica(nombre);
  const errores = DISTRITO_ERRORES[distrito] || [];
  if (errores.some(alias => {
    const canon = normalizarFonetica(alias);
    return transcripcion === canon || transcripcion.endsWith(' ' + canon) || transcripcion.startsWith(canon + ' ');
  })) return true;
  return coincideFonetico(texto, nombre);
}

// Compara también variantes de una letra para tolerar errores del reconocedor.
function parecido(cand, variantes) {
  if (!cand) return false;
  const u = cand.length <= 5 ? 1 : 2;
  return variantes.some(v => levenshtein(cand, normalizarFonetica(v)) <= u);
}

// ─────────────────────────────────────────────────────────────────────────────
// numero(tokens) — convierte palabras o dígitos a entero en una sola pasada
// "cuarenta y cinco", "45" y "cuatro cinco" → 45
// ─────────────────────────────────────────────────────────────────────────────
export function numero(tokens) {
  const tk = tokens.filter(x => x !== 'y' && x !== 'e');
  if (!tk.length) return null;
  const val = x => /^\d+$/.test(x) ? parseInt(x, 10) : UN_NORMALIZADO[x];
  const vals = [];
  for (const t of tk) {
    const v = val(t);
    if (v === undefined) return null;
    vals.push(v);
  }
  // Código de 6 dígitos dictado como "uno cero uno dos cuatro cinco" → 101245
  if (vals.length >= 5 && vals.length <= 6 && vals.every(v => v <= 9))
    return parseInt(vals.join(''), 10);
  // Dígito a dígito: "cuatro cinco" → 45
  if (vals.length > 1 && vals.every(v => v <= 9))
    return parseInt(vals.join(''), 10);
  // Forma compuesta: treinta + cuatro = 34
  return vals.reduce((a, v) => a + v, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
const RUIDO_CODIGO = new Set(['codigo', 'numero', 'mesa', 'y', 'e', 'por', 'favor', 'eh'].map(normalizarFonetica));
function digitosDeTokens(tokens) {
  let digitos = '';
  for (const token of tokens) {
    if (/^\d+$/.test(token)) digitos += token;
    else if (Number.isInteger(UN_NORMALIZADO[token]) && UN_NORMALIZADO[token] >= 0 && UN_NORMALIZADO[token] <= 9)
      digitos += String(UN_NORMALIZADO[token]);
    else if (UN_NORMALIZADO[token] === 11) digitos += '11';
    else if (!RUIDO_CODIGO.has(token)) return null;
  }
  return digitos;
}

export function leerDigitosDictados(texto) {
  return digitosDeTokens(norm(texto));
}

function codigoSeis(tokens) {
  const digitos = digitosDeTokens(tokens);
  return digitos?.length === 6 ? digitos : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rescate pre-normalización para tokens problemáticos.
// Se ejecuta sobre el texto crudo ANTES de normalizar, capturando palabras
// que el reconocedor confunde con frecuencia antes de que el pipeline fonético
// las desfigure aún más.
// ─────────────────────────────────────────────────────────────────────────────
function preNormalizar(texto) {
  return texto
    // "once" y sus variantes fonéticas → siempre "11"
    // Captura: once / onse / onze / ponce / honse / honze (palabra completa)
    .replace(/\b(?:once|onse|onze|ponce|honse|honze)\b/gi, '11');
}

export function interpretar(texto) {
  const tk = norm(preNormalizar(texto));
  if (!tk.length) return { tipo: 'nada' };
  const [t0, t1] = tk;
  const cmd = (token, aliases) => aliases.some(a => token === normalizarFonetica(a) || parecido(token, [a]));
  const cargo = Object.entries(SECCIONES).find(([, alias]) => alias.some(a => normalizarFonetica(a) === tk.join(' ')))?.[0];
  if (cargo) return { tipo: 'seccion_abrir', cargo };

  if (tk.length === 1) {
    if (cmd(t0, COMANDOS.siguiente)) return { tipo: 'cmd', cmd: 'abajo' };
    if (cmd(t0, COMANDOS.anterior)) return { tipo: 'cmd', cmd: 'alto' };
    if (cmd(t0, COMANDOS.cambiar)) return { tipo: 'cmd', cmd: 'cambiar' };
    if (cmd(t0, COMANDOS.borrar)) return { tipo: 'cmd', cmd: 'olvida' };
    if (OT_NORMALIZADO[t0]) return { tipo: 'ir', x: OT_NORMALIZADO[t0] };
  }

  if (tk.length === 2 && [normalizarFonetica('seccion'), normalizarFonetica('cargo')].includes(t1)) {
    if (cmd(t0, COMANDOS.siguiente)) return { tipo: 'seccion', delta: 1 };
    if (cmd(t0, COMANDOS.anterior)) return { tipo: 'seccion', delta: -1 };
  }

  if (tk.length === 2 && t1 === normalizarFonetica('columna')) {
    if (cmd(t0, COMANDOS.siguiente)) return { tipo: 'col_adelante' };
    if (cmd(t0, COMANDOS.anterior)) return { tipo: 'col_vuelve' };
  }

  if (cmd(t0, NUEVA_ALIASES)) {
    const iOrg = cmd(t0, NUEVA_ALIASES) ? 1 : 0;
    if (parecido(tk[iOrg], ORG_ALIASES)) {
      const palabras = String(texto).trim().split(/\s+/);
      let n = null, k = Math.min(3, tk.length - iOrg - 1);
      for (; k >= 1; k--) { n = numero(tk.slice(iOrg + 1, iOrg + 1 + k)); if (n !== null) break; }
      const nombre = palabras.slice(iOrg + 1 + (n !== null ? k : 0)).join(' ').replace(/[.,;:!?]+$/, '');
      return { tipo: 'org_nueva', n, nombre };
    } 

    const cod = codigoSeis(tk.slice(1));
    if (cod !== null) return { tipo: 'ir_col', cod };
    return { tipo: 'nueva', digitos: digitosDeTokens(tk.slice(1)) ?? '' };
  }

  if (OT_NORMALIZADO[t0] && tk.length > 1) {
    const valor = numero(tk.slice(1));
    if (valor !== null) return { tipo: 'otro', x: OT_NORMALIZADO[t0], valor };
  }

  const valor = numero(tk);
  return valor !== null ? { tipo: 'valor', valor } : { tipo: 'nada' };
}
