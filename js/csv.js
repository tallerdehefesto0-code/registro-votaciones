// Lectura y validación de los CSV de carga. Acepta coma o punto y coma (Excel en Perú).
import { CARGOS } from './calc.js';
const CG = Object.keys(CARGOS);
const ent = s => (/^\d+$/.test(String(s).trim()) ? parseInt(String(s), 10) : NaN);

export function parseCSV(t) {
  t = t.replace(/^\uFEFF/, '');
  const l1 = t.split('\n')[0];
  const d = l1.split(';').length > l1.split(',').length ? ';' : ',';
  const filas = []; let f = [], c = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === d) { f.push(c); c = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; f.push(c); c = ''; filas.push(f); f = []; }
    else c += ch;
  }
  if (c !== '' || f.length) { f.push(c); filas.push(f); }
  return filas.filter(r => r.some(x => x.trim() !== ''));
}

const encabezado = (f, esperado) => f.length && f[0].map(x => x.trim().toLowerCase()).join() === esperado;

export function leerOrgs(texto) {
  let filas;
  try {
    if (texto.trimStart().startsWith('{') || texto.trimStart().startsWith('[')) {
      const json = JSON.parse(texto.replace(/^\uFEFF/, ''));
      filas = Array.isArray(json) ? json : json.organizaciones;
      if (!Array.isArray(filas)) return { err: ['El JSON debe contener una lista "organizaciones".'] };
      filas = [['cargo', 'ambito', 'territorio', 'numero', 'nombre', 'candidato'], ...filas.map(o => [o.cargo, o.territorio ? (o.ambito || o.cargo) : '', o.territorio || '', o.numero ?? o.n, o.nombre, o.candidato || o.cand || ''])];
    }
  } catch { return { err: ['El archivo no contiene JSON válido.'] }; }
  const f = filas || parseCSV(texto), err = [], orgs = { distrito: [], provincia: [], region: [], consejero: [] };
  const extendido = encabezado(f, 'cargo,ambito,territorio,numero,nombre,candidato');
  const legado = encabezado(f, 'cargo,numero,nombre,candidato');
  if (!extendido && !legado) return { err: ['Encabezado esperado: cargo,ambito,territorio,numero,nombre,candidato'] };
  (filas ? f.slice(1) : f.slice(1)).forEach((r, i) => {
    const ln = i + 2, c = String(r[0] || '').trim().toLowerCase();
    const ambito = extendido ? String(r[1] || '').trim().toLowerCase() : '';
    const territorio = extendido ? String(r[2] || '').trim() : '';
    const n = ent(extendido ? r[3] || '' : r[1] || '');
    const nom = String(extendido ? r[4] || '' : r[2] || '').trim();
    const candidato = String(extendido ? r[5] || '' : r[3] || '').trim();
    if (!CG.includes(c)) err.push(`Línea ${ln}: cargo no válido (${c || 'vacío'}). Usa: ${CG.join(', ')}`);
    else if (!(n > 0)) err.push(`Línea ${ln}: el número de orden debe ser un entero mayor que 0`);
    else if (!nom) err.push(`Línea ${ln}: falta el nombre de la organización`);
    else if (extendido && (ambito !== (c === 'distrito' ? 'distrito' : c === 'region' ? 'region' : 'provincia') || !territorio)) err.push(`Línea ${ln}: el ámbito no corresponde al cargo o falta territorio`);
    else if (orgs[c].some(o => o.n === n && o.territorio === territorio)) err.push(`Línea ${ln}: el número ${n} está repetido para ${territorio || c}`);
    else orgs[c].push({ n, nombre: nom, cand: candidato, ...(territorio ? { territorio } : {}) });
  });
  if (!err.length && !CG.some(c => orgs[c].length)) err.push('El archivo no tiene filas de datos');
  CG.forEach(c => orgs[c].sort((a, b) => a.n - b.n));
  return { err, orgs };
}

export function leerMesas(texto) {
  let filas;
  try {
    if (texto.trimStart().startsWith('{') || texto.trimStart().startsWith('[')) {
      const json = JSON.parse(texto.replace(/^\uFEFF/, ''));
      filas = Array.isArray(json) ? json : json.mesas;
      if (!Array.isArray(filas)) return { err: ['El JSON debe contener una lista "mesas".'] };
      filas = [['codigo', 'distrito', 'local', 'electores'], ...filas.map(m => [m.codigo ?? m.mesa ?? m.num, m.distrito, m.local || '', m.electores ?? m.hab])];
    }
  } catch { return { err: ['El archivo no contiene JSON válido.'] }; }
  const f = filas || parseCSV(texto), err = [], mesas = [];
  if (!encabezado(f, 'codigo,distrito,local,electores') && !encabezado(f, 'mesa,distrito,local,electores')) return { err: ['Encabezado esperado: codigo,distrito,local,electores'] };
  f.slice(1).forEach((r, i) => {
        const ln = i + 2, n = String(r[0] || '').trim(), distrito = String(r[1] || '').trim(),
          hs = String(r[3] ?? '').trim(), hab = hs === '' ? 0 : ent(hs);
    if (!/^\d{6}$/.test(n)) err.push(`Línea ${ln}: el código de mesa debe tener seis dígitos`);
    else if (!distrito) err.push(`Línea ${ln}: falta el distrito de la mesa`);
    else if (hs !== '' && !(hab > 0)) err.push(`Línea ${ln}: los electores hábiles deben estar vacíos o ser un entero mayor que 0`);
    else if (mesas.some(m => m.num === n)) err.push(`Línea ${ln}: la mesa ${n} está repetida`);
    else mesas.push({ num: n, distrito, local: (r[2] || '').trim(), hab });
  });
  if (!err.length && !mesas.length) err.push('El archivo no tiene filas de datos');
  mesas.sort((a, b) => a.num - b.num);
  return { err, mesas };
}

export const plantilla = t => t === 'orgs'
  ? 'cargo,ambito,territorio,numero,nombre,candidato\ndistrito,distrito,Chóchope,1,Organización A,Candidato A\ndistrito,distrito,Chóchope,2,Organización B,Candidato B\nprovincia,provincia,Lambayeque,1,Organización A,Candidato A\nconsejero,provincia,Lambayeque,1,Organización A,Candidato A\nregion,region,Lambayeque,1,Organización A,Candidato A\n'
  : 'codigo,distrito,local,electores\n000001,Lambayeque,I.E. 10001,300\n000002,Chóchope,I.E. 10002,300\n';
