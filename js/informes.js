// Datos de los reportes: arma los modelos y los textos (CSV, JSON) a partir del estado.
// No usa pantalla ni librerías externas, así se prueba sola. Excel y PDF parten de estos mismos modelos.
import { CARGOS, OTROS, key, claveOrg, cargosDeMesa, territorioDeMesa, orgsDe, pct, mesasDe, datosMesa, resumenCargo, avisoMesa } from './calc.js';
export const CS = Object.keys(CARGOS);
export const AVISO = 'Conteo de apoyo, no resultado oficial';

export const estadoTxt = d => d.estado + (d.estado === 'Cerrada' && d.obs > 0 ? ' (provisional)' : '') + (d.hab <= 0 ? ' · faltan electores hábiles' : d.cuadra ? '' : ' · supera a los hábiles');
export const control = d => (d.hab <= 0 ? 'Faltan electores hábiles' : d.omisos === null ? 'Sin datos' : d.cuadra ? 'Cuadra' : 'NO CUADRA');
export const nota = r => (r.provisional ? 'RESULTADOS PROVISIONALES: hay mesas cerradas con observables' : '');
export const etiqueta = o => `${o.n} – ${o.nombre}`;

// Fecha local legible (texto) y como Date "desplazada" para que Excel muestre la hora local
export const fechaHora = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
export const fechaExcel = t => { const d = new Date(t); return new Date(d.getTime() - d.getTimezoneOffset() * 60000); };

// Tabla de un cargo (sección 4.3): filas de organizaciones y otros votos, totales por mesa y por fila
export function modeloTabla(S, c, territorio = '') {
  const ms = mesasDe(S, c, territorio), orgs = orgsDe(S, c, territorio), R = resumenCargo(S, c, territorio), ds = ms.map(m => datosMesa(S, c, m));
  const fila = (et, x, esOrg, total, numero = x) => ({ et, x, numero, esOrg, total, vals: ms.map(m => S.votos[key(c, m.num, x)]), pv: esOrg ? pct(total, R.validos) : '', pt: pct(total, R.total) });
  const filas = [...R.porOrg.map(({ o, votos }) => ({ ...fila(etiqueta(o), claveOrg(o), true, votos, o.n), cand: o.cand })),
    ...Object.entries(OTROS).map(([x, t]) => fila(t, x, false, R[x]))];
  return { c, territorio, nombre: CARGOS[c], ms, orgs, R, ds, filas, listo: ms.length > 0 && orgs.length > 0 };
}

// Cabecera y cuerpo de la tabla tal como se ve en pantalla (para CSV y PDF)
export function matrizTabla(M) {
  const v = x => (x === undefined ? '' : x), suma = f => M.ms.reduce((a, m, i) => a + f(m, i), 0);
  const cab = ['', ...M.ms.map(m => 'Mesa ' + m.num), 'Total', '% válidos', '% total'];
  const filas = M.filas.map(f => [f.et, ...f.vals.map(v), f.total, f.pv, f.pt]);
  const calc = [
    ['Total por mesa', ...M.ds.map(d => d.total), M.R.total, '', ''],
    ['Omisos (no votaron)', ...M.ds.map(d => (d.omisos === null ? '—' : d.omisos)), M.R.omisos, '', ''],
    ['Votantes por mesa (electores hábiles)', ...M.ms.map(m => m.hab), suma(m => m.hab), '', ''],
    ['Control de cuadre', ...M.ds.map(control), M.ds.some(d => d.omisos !== null && !d.cuadra) ? 'REVISAR' : 'OK', '', ''],
    ['Estado', ...M.ds.map(estadoTxt), '', '', ''],
  ];
  return { cab, filas, calc };
}

// Tablero: una columna por cargo (sección 4.5). k = clave del dato para enlazar fórmulas en el libro completo.
export function modeloTablero(S) {
  const R = Object.fromEntries(CS.map(c => [c, resumenCargo(S, c)]));
  const lider = r => (r.validos > 0 ? [...r.porOrg].sort((a, b) => b.votos - a.votos)[0] : null);
  const f = (et, k, fn, num = true) => ({ et, k, num, vals: CS.map(c => fn(R[c], c)) });
  const filas = [
    f('Mesas (total)', 'nMesas', r => r.nMesas), f('Mesas cerradas', 'cerradas', r => r.cerradas),
    f('Estado de mesas (cerradas / total)', 'estado', r => `${r.cerradas}/${r.nMesas}`, false),
    f('Electores hábiles', 'hab', r => r.hab), f('Votos válidos (organizaciones)', 'validos', r => r.validos),
    f('Votos en blanco', 'blanco', r => r.blanco), f('Votos nulos (viciados)', 'nulo', r => r.nulo), f('Votos observables', 'obs', r => r.obs),
    f('Total de votos', 'total', r => r.total), f('Omisos (no votaron)', 'omisos', r => r.omisos),
    f('Primero', 'primero', r => (lider(r) ? etiqueta(lider(r).o) : '—'), false),
    f('% válidos del primero', 'pv', r => (lider(r) ? pct(lider(r).votos, r.validos) : '—'), false),
    f('% del total del primero', 'pt', r => (lider(r) ? pct(lider(r).votos, r.total) : '—'), false),
    f('Resultados', 'prov', r => (r.provisional ? 'Provisional (mesas cerradas con observables)' : 'Sin observables en mesas cerradas'), false),
  ];
  return { R, cols: CS, filas };
}

// Resultados por organización: ranking de mayor a menor (en empate se respeta el orden de lista)
export function modeloRanking(S, c) {
  const M = modeloTabla(S, c), orden = [...M.R.porOrg].sort((a, b) => b.votos - a.votos);
  return { ...M, ranking: orden.map(({ o, votos }, i) => ({ puesto: 1 + orden.findIndex(p => p.votos === votos), o, votos, pv: pct(votos, M.R.validos), pt: pct(votos, M.R.total), frac: M.R.validos > 0 ? votos / M.R.validos : 0 })) };
}

// Acta de una mesa: todos los cargos que le aplican
export function modeloActa(S, mesa) {
  return { mesa, aviso: avisoMesa(S, mesa), cargos: cargosDeMesa(S, mesa).map(c => {
    const orgs = orgsDe(S, c, territorioDeMesa(S, c, mesa));
    const d = datosMesa(S, c, mesa), v = x => S.votos[key(c, mesa.num, x)];
    return { c, nombre: CARGOS[c], d, filas: [...orgs.map(o => [etiqueta(o), v(claveOrg(o))]), ...Object.entries(OTROS).map(([x, t]) => [t, v(x)])] };
  }) };
}

/* ---------- CSV ---------- */
// Entre comillas si lleva coma, comillas o saltos; un texto que empieza con = + - @ se neutraliza (Excel lo leería como fórmula)
const esc = v => {
  let s = v == null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?%?$/.test(s)) s = "'" + s;
  return /[",;\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export const aCSV = filas => '\uFEFF' + filas.map(f => f.map(esc).join(',')).join('\r\n') + '\r\n';

export function csvTabla(S, c, territorio = '') {
  const M = modeloTabla(S, c, territorio), X = matrizTabla(M);
  return aCSV([X.cab, ['Local', ...M.ms.map(m => m.local), '', '', ''], ...X.filas, ...X.calc, [AVISO + (nota(M.R) ? ' · ' + nota(M.R) : '')]]);
}
export function csvTablero(S) {
  const T = modeloTablero(S), prov = CS.some(c => T.R[c].provisional);
  return aCSV([['', ...T.cols.map(c => CARGOS[c])], ...T.filas.map(f => [f.et, ...f.vals]), [AVISO + (prov ? ' · RESULTADOS PROVISIONALES' : '')]]);
}
// Formato largo: una fila por dato registrado (las casillas sin registrar no aparecen)
export function csvPlano(S) {
  const filas = [['cargo', 'mesa', 'local', 'tipo', 'numero_organizacion', 'organizacion', 'votos', 'estado_mesa']];
  CS.forEach(c => mesasDe(S, c).forEach(m => {
    const est = datosMesa(S, c, m).estado, add = (tipo, n, nom, x) => { const v = S.votos[key(c, m.num, x)]; if (v !== undefined) filas.push([CARGOS[c], m.num, m.local, tipo, n, nom, v, est]); };
    orgsDe(S, c, territorioDeMesa(S, c, m)).forEach(o => add('organizacion', o.n, o.nombre, claveOrg(o)));
    add('blanco', '', '', 'blanco'); add('nulo', '', '', 'nulo'); add('observable', '', '', 'obs');
  }));
  return aCSV(filas);
}
// Formato matriz: una fila por organización u otro voto, una columna por mesa (en blanco si la mesa no aplica o no se registró)
export function csvMatriz(S) {
  const todas = [...S.mesas].sort((a, b) => a.num - b.num), filas = [['cargo', 'numero', 'fila', ...todas.map(m => 'Mesa ' + m.num), 'Total']];
  CS.forEach(c => {
    const M = modeloTabla(S, c); if (!M.listo) return;
    M.filas.forEach(f => filas.push([CARGOS[c], f.esOrg ? f.numero : '', f.et, ...todas.map(m => { const i = M.ms.indexOf(m); return i < 0 ? '' : f.vals[i] ?? ''; }), f.total]));
  });
  return aCSV(filas);
}
export const csvBitacora = S => aCSV([['fecha_hora', 'cargo', 'mesa', 'evento', 'usuario'],
  ...S.log.slice().reverse().map(e => [fechaHora(e.t), CARGOS[e.cargo] || e.cargo, e.mesa, e.evento, e.usuario || '—'])]);

/* ---------- Respaldo JSON ---------- */
export const jsonRespaldo = S => JSON.stringify({ app: 'registro-votaciones', version: 1, exportado: new Date().toISOString(), estado: S }, null, 1);

// Valida un respaldo antes de reemplazar los datos. Devuelve { err, estado }.
export function leerRespaldo(texto) {
  let o; try { o = JSON.parse(texto.replace(/^\uFEFF/, '')); } catch { return { err: ['El archivo no es un JSON válido.'] }; }
  const s = o && o.estado, err = [], ent = x => Number.isInteger(x) && x >= 0;
  if (!o || o.app !== 'registro-votaciones' || !s || typeof s !== 'object') return { err: ['No parece un respaldo de esta aplicación.'] };
  if (o.version !== 1) return { err: ['Versión de respaldo no reconocida: ' + o.version] };
  CS.forEach(c => {
    if (!Array.isArray(s.orgs && s.orgs[c])) return err.push(`Faltan las organizaciones de ${c}.`);
    const vistos = new Set();
    s.orgs[c].forEach(g => { const k = g && `${g.territorio || ''}|${g.n}`; if (!(g && Number.isInteger(g.n) && g.n > 0 && g.nombre) || vistos.has(k)) err.push(`Organización no válida o repetida en ${c}.`); else vistos.add(k); });
  });
  if (!Array.isArray(s.geografia)) err.push('La configuración geográfica no es válida.');
  else {
    const distritos = new Set();
    s.geografia.forEach(g => {
      if (!(g && typeof g.region === 'string' && typeof g.provincia === 'string' && typeof g.distrito === 'string') || distritos.has(g && g.distrito)) err.push('Distrito geográfico no válido o repetido.');
      else distritos.add(g.distrito);
    });
  }
  if (!Array.isArray(s.mesas)) err.push('Faltan las mesas.');
  else {
    const codigos = new Set();
    s.mesas.forEach(m => {
      if (!(m && typeof m.num === 'string' && /^\d{6}$/.test(m.num) && Number.isInteger(m.hab) && m.hab >= 0 && typeof m.distrito === 'string' && Array.isArray(s.geografia) && s.geografia.some(g => g.distrito === m.distrito)) || codigos.has(m && m.num)) err.push('Mesa no válida, repetida o sin distrito: ' + (m && m.num));
      else codigos.add(m.num);
    });
  }
  if (!s.votos || typeof s.votos !== 'object' || Array.isArray(s.votos)) err.push('Faltan los votos.');
  else if (!err.length) Object.entries(s.votos).forEach(([k, v]) => {
    const [c, mn, x] = k.split('|'), m = s.mesas.find(y => String(y.num) === mn);
    const ok = ent(v) && m && cargosDeMesa(s, m).includes(c) && (['blanco', 'nulo', 'obs'].includes(x) || s.orgs[c]?.some(g => String(claveOrg(g)) === x));
    if (!ok && err.length < 12) err.push('Voto no válido: ' + k + ' = ' + v);
  });
  if (!s.cerradas || typeof s.cerradas !== 'object') err.push('Faltan los cierres de mesa.');
  if (!Array.isArray(s.log)) err.push('Falta la bitácora.');
  if (err.length) return { err };
  return { err, estado: JSON.parse(JSON.stringify({ orgs: s.orgs, mesas: s.mesas, votos: s.votos, cerradas: s.cerradas, log: s.log, archivos: s.archivos, geografia: s.geografia })) };
}
