// Reportes en Excel con fórmulas reales. Recibe la clase ExcelJS como parámetro (así se prueba fuera del navegador).
// Las fórmulas llevan también su resultado calculado por la app, para que cualquier visor muestre el valor.
import { CARGOS } from './calc.js';
import { AVISO, CS, modeloTabla, modeloTablero, modeloRanking, modeloActa, estadoTxt, control, nota, fechaExcel } from './informes.js';

const NUM = '#,##0', PCT = '0.00%';
const L = n => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };   // 1→A, 27→AA
const frac = (a, b) => (b > 0 ? a / b : '');
const borde = { top: { style: 'thin', color: { argb: 'FFBBC3D0' } }, left: { style: 'thin', color: { argb: 'FFBBC3D0' } }, bottom: { style: 'thin', color: { argb: 'FFBBC3D0' } }, right: { style: 'thin', color: { argb: 'FFBBC3D0' } } };
const relleno = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

const libro = X => { const wb = new X.Workbook(); wb.creator = 'Registro de votaciones'; wb.created = new Date(); return wb; };
const fx = (formula, result) => ({ formula, result });
const hoja = (wb, nombre) => { const ws = wb.addWorksheet(nombre.slice(0, 31)); ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }; return ws; };
const titulo = (ws, t, extra = '') => {
  ws.getCell('A1').value = t; ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = AVISO + (extra ? ' · ' + extra : ''); ws.getCell('A2').font = { italic: true, color: { argb: extra ? 'FFB3261E' : 'FF5B6577' } };
  ws.getCell('A3').value = 'Generado: ' + new Date().toLocaleString('es-PE'); ws.getCell('A3').font = { size: 9, color: { argb: 'FF5B6577' } };
};
const cabecera = (ws, fila, textos) => textos.forEach((t, i) => {
  const c = ws.getCell(fila, i + 1); c.value = t; c.font = { bold: true }; c.fill = relleno('FFE6EEF9'); c.border = borde;
  c.alignment = { horizontal: i ? 'center' : 'left', vertical: 'middle', wrapText: true };
});
const estilo = (ws, f1, f2, c2, calc = []) => { for (let f = f1; f <= f2; f++) for (let c = 1; c <= c2; c++) {
  const x = ws.getCell(f, c); x.border = borde; if (c > 1) x.alignment = { horizontal: 'right' };
  if (calc.includes(f)) { x.fill = relleno('FFF3F6FB'); x.font = { bold: true }; } } };
const rojoSi = (ws, ref, texto) => ws.addConditionalFormatting({ ref, rules: [{ type: 'containsText', operator: 'containsText', text: texto, priority: 1, style: { font: { bold: true, color: { argb: 'FFB3261E' } } } }] });

/* ---------- Hoja de la tabla de un cargo (sección 4.3) ---------- */
// Devuelve las referencias a sus celdas para que el tablero del libro completo las enlace con fórmulas.
export function hojaTabla(wb, M, nombreHoja) {
  const ws = hoja(wb, nombreHoja), { ms, filas, ds, R } = M, n = ms.length, kOrg = filas.filter(f => f.esOrg).length;
  const T = L(n + 2), ult = L(n + 1), hr = 5, r0 = hr + 2, rO = r0 + kOrg - 1, rBl = rO + 1, rOb = rBl + 2;
  const rTot = rOb + 1, rOm = rTot + 1, rHab = rOm + 1, rCu = rHab + 1, rEs = rCu + 1;
  titulo(ws, 'Tabla de votos · ' + M.nombre, nota(R));
  cabecera(ws, hr, ['Organización o concepto', ...ms.map(m => 'Mesa ' + m.num), 'Total', '% válidos', '% total']);
  ws.getCell(hr + 1, 1).value = 'Local de votación'; ms.forEach((m, i) => { ws.getCell(hr + 1, i + 2).value = m.local; });
  filas.forEach((f, i) => {
    const r = r0 + i; ws.getCell(r, 1).value = f.et;
    f.vals.forEach((v, j) => { if (v !== undefined) ws.getCell(r, j + 2).value = v; });          // vacío = sin registrar
    ws.getCell(r, n + 2).value = fx(`SUM(B${r}:${ult}${r})`, f.total);
    if (f.esOrg) ws.getCell(r, n + 3).value = fx(`IF(SUM($${T}$${r0}:$${T}$${rO})>0,${T}${r}/SUM($${T}$${r0}:$${T}$${rO}),"")`, frac(f.total, R.validos));
    ws.getCell(r, n + 4).value = fx(`IF($${T}$${rTot}>0,${T}${r}/$${T}$${rTot},"")`, frac(f.total, R.total));
  });
  ms.forEach((m, i) => {
    const c = L(i + 2), d = ds[i], vacia = `COUNT(${c}${r0}:${c}${rOb})=0`;
    ws.getCell(rTot, i + 2).value = fx(`SUM(${c}${r0}:${c}${rOb})`, d.total);
    ws.getCell(rOm, i + 2).value = fx(`IF(${vacia},"",${c}${rHab}-${c}${rTot})`, d.omisos === null ? '' : d.omisos);
    ws.getCell(rHab, i + 2).value = m.hab;
    ws.getCell(rCu, i + 2).value = fx(`IF(${vacia},"Sin datos",IF(${c}${rHab}<=0,"Faltan electores hábiles",IF(${c}${rTot}<=${c}${rHab},"Cuadra","NO CUADRA")))`, control(d));
    ws.getCell(rEs, i + 2).value = estadoTxt(d);
  });
  ws.getCell(rTot, 1).value = 'Total por mesa'; ws.getCell(rOm, 1).value = 'Omisos (no votaron)';
  ws.getCell(rHab, 1).value = 'Votantes por mesa (electores hábiles)'; ws.getCell(rCu, 1).value = 'Control de cuadre'; ws.getCell(rEs, 1).value = 'Estado';
  [[rTot, R.total], [rOm, R.omisos], [rHab, ms.reduce((a, m) => a + m.hab, 0)]].forEach(([r, v]) => { ws.getCell(r, n + 2).value = fx(`SUM(B${r}:${ult}${r})`, v); });
  const malo = ds.some(d => d.omisos !== null && !d.cuadra);
  ws.getCell(rCu, n + 2).value = fx(`IF(COUNTIF(B${rCu}:${ult}${rCu},"NO CUADRA")>0,"REVISAR","OK")`, malo ? 'REVISAR' : 'OK');
  estilo(ws, hr + 1, rEs, n + 4, [rTot, rOm, rHab, rCu, rEs]);
  for (let r = r0; r <= rHab; r++) { for (let c = 2; c <= n + 2; c++) ws.getCell(r, c).numFmt = NUM; ws.getCell(r, n + 3).numFmt = PCT; ws.getCell(r, n + 4).numFmt = PCT; }
  ws.getRow(hr + 1).font = { size: 9, color: { argb: 'FF5B6577' } };
  rojoSi(ws, `B${rCu}:${T}${rCu}`, 'NO CUADRA'); rojoSi(ws, `${T}${rCu}`, 'REVISAR');
  ws.getColumn(1).width = 40; for (let c = 2; c <= n + 4; c++) ws.getColumn(c).width = c <= n + 1 ? 15 : 12;
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: hr }];
  const q = `'${ws.name}'!`, rango = col => `${q}$${col}$${r0}:$${col}$${rO}`;
  return { validos: kOrg ? `SUM(${q}${T}${r0}:${T}${rO})` : '0', blanco: `${q}${T}${rBl}`, nulo: `${q}${T}${rBl + 1}`, obs: `${q}${T}${rOb}`,
    total: `${q}${T}${rTot}`, omisos: `${q}${T}${rOm}`, hab: `${q}${T}${rHab}`, nombres: rango('A'), votos: rango(T) };
}

/* ---------- Hoja del tablero (sección 4.5) ---------- */
export function hojaTablero(wb, S, refs = {}) {
  const ws = hoja(wb, 'Tablero'), TB = modeloTablero(S), prov = CS.some(c => TB.R[c].provisional);
  titulo(ws, 'Tablero de cargos', prov ? 'RESULTADOS PROVISIONALES' : '');
  cabecera(ws, 5, ['', ...TB.cols.map(c => CARGOS[c])]);
  TB.filas.forEach((f, i) => {
    const r = 6 + i; ws.getCell(r, 1).value = f.et; ws.getCell(r, 1).font = { bold: true };
    f.vals.forEach((v, j) => {
      const rf = refs[TB.cols[j]], R = TB.R[TB.cols[j]], cel = ws.getCell(r, j + 2), hay = R.validos > 0;
      const maxV = R.porOrg.reduce((a, p) => Math.max(a, p.votos), 0), mx = rf && `MAX(${rf.votos})`;
      let val = v, fmt = NUM;
      if (rf && ['hab', 'validos', 'blanco', 'nulo', 'obs', 'total', 'omisos'].includes(f.k)) val = fx(rf[f.k], v);
      else if (f.k === 'primero' && rf && hay) val = fx(`IF(${rf.validos}>0,INDEX(${rf.nombres},MATCH(${mx},${rf.votos},0)),"—")`, v);
      else if (f.k === 'pv' || f.k === 'pt') {
        const den = f.k === 'pv' ? 'validos' : 'total', nu = hay ? maxV / R[den] : '—';
        val = rf && hay ? fx(`IF(${rf[den]}>0,${mx}/${rf[den]},"")`, nu) : nu; fmt = typeof nu === 'number' ? PCT : NUM;
      }
      cel.value = val; cel.numFmt = fmt;
    });
  });
  estilo(ws, 6, 5 + TB.filas.length, TB.cols.length + 1);
  ws.getColumn(1).width = 38; for (let c = 2; c <= 5; c++) ws.getColumn(c).width = 26;
  for (let r = 6; r < 6 + TB.filas.length; r++) for (let c = 2; c <= 5; c++) ws.getCell(r, c).alignment = { horizontal: 'right', wrapText: true };
  return ws;
}

const buf = wb => wb.xlsx.writeBuffer();
const sinDatos = (wb, M) => { const ws = hoja(wb, M.nombre); titulo(ws, 'Tabla de votos · ' + M.nombre); ws.getCell('A5').value = 'Faltan organizaciones o mesas para este cargo.'; };

export async function xlsxTabla(X, S, c, territorio = '') { const wb = libro(X), M = modeloTabla(S, c, territorio); if (M.listo) hojaTabla(wb, M, M.nombre); else sinDatos(wb, M); return buf(wb); }
export async function xlsxTablero(X, S) { const wb = libro(X); hojaTablero(wb, S); return buf(wb); }
// Libro completo: tablero con fórmulas que apuntan a las hojas de cada cargo
export async function xlsxLibro(X, S) {
  const wb = libro(X), refs = {};
  CS.map(c => modeloTabla(S, c)).forEach(M => { if (M.listo) refs[M.c] = hojaTabla(wb, M, M.nombre); else sinDatos(wb, M); });
  hojaTablero(wb, S, refs).orderNo = -1;                                  // se crea al final (necesita las referencias) pero queda como primera hoja
  return buf(wb);
}

/* ---------- Resultados por organización: ranking con barra ---------- */
export async function xlsxResultados(X, S) {
  const wb = libro(X);
  CS.forEach(c => {
    const K = modeloRanking(S, c), ws = hoja(wb, 'Resultados ' + K.nombre), R = K.R;
    titulo(ws, 'Resultados por organización · ' + K.nombre, nota(R));
    if (!K.listo) { ws.getCell('A5').value = 'Faltan organizaciones o mesas para este cargo.'; return; }
    cabecera(ws, 5, ['Puesto', 'N.º', 'Organización', 'Candidato', 'Votos', '% válidos', '% total', 'Barra (% válidos)']);
    const n = K.ranking.length, r0 = 6, rO = r0 + n - 1, rTot = rO + 4;
    K.ranking.forEach((p, i) => {
      const r = r0 + i;
      ws.getCell(r, 1).value = fx(`RANK(E${r},$E$${r0}:$E$${rO})`, p.puesto);
      ws.getCell(r, 2).value = p.o.n; ws.getCell(r, 3).value = p.o.nombre; ws.getCell(r, 4).value = p.o.cand; ws.getCell(r, 5).value = p.votos;
      ws.getCell(r, 6).value = fx(`IF(SUM($E$${r0}:$E$${rO})>0,E${r}/SUM($E$${r0}:$E$${rO}),"")`, frac(p.votos, R.validos));
      ws.getCell(r, 7).value = fx(`IF($E$${rTot}>0,E${r}/$E$${rTot},"")`, frac(p.votos, R.total));
      ws.getCell(r, 8).value = fx(`IF(F${r}="","",REPT("█",ROUND(F${r}*30,0)))`, p.frac > 0 ? '█'.repeat(Math.round(p.frac * 30)) : '');
    });
    [['Votos en blanco', R.blanco], ['Votos nulos (viciados)', R.nulo], ['Votos observables', R.obs]].forEach(([t, v], i) => {
      const r = rO + 1 + i; ws.getCell(r, 3).value = t; ws.getCell(r, 5).value = v;
      ws.getCell(r, 7).value = fx(`IF($E$${rTot}>0,E${r}/$E$${rTot},"")`, frac(v, R.total));
    });
    ws.getCell(rTot, 3).value = 'Total de votos'; ws.getCell(rTot, 5).value = fx(`SUM(E${r0}:E${rTot - 1})`, R.total);
    estilo(ws, r0, rTot, 8, [rTot]);
    for (let r = r0; r <= rTot; r++) { ws.getCell(r, 5).numFmt = NUM; ws.getCell(r, 6).numFmt = PCT; ws.getCell(r, 7).numFmt = PCT; ws.getCell(r, 8).alignment = { horizontal: 'left' }; ws.getCell(r, 8).font = { color: { argb: 'FF1F5FBF' } }; }
    [8, 6, 36, 24, 12, 12, 12, 36].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.views = [{ state: 'frozen', ySplit: 5 }];
  });
  return buf(wb);
}

/* ---------- Acta de una mesa ---------- */
export async function xlsxActa(X, S, mesa) {
  const wb = libro(X), A = modeloActa(S, mesa), ws = hoja(wb, 'Acta Mesa ' + mesa.num);
  titulo(ws, `Acta de la mesa ${mesa.num}`);
  ws.getCell('A4').value = 'Local de votación'; ws.getCell('B4').value = mesa.local || '—';
  ws.getCell('A5').value = 'Electores hábiles'; ws.getCell('B5').value = mesa.hab; ws.getCell('B5').numFmt = NUM;
  ['A4', 'A5'].forEach(a => { ws.getCell(a).font = { bold: true }; }); ws.getCell('B4').alignment = ws.getCell('B5').alignment = { horizontal: 'left' };
  let r = 7;
  A.cargos.forEach(({ nombre, d, filas }) => {
    cabecera(ws, r, [nombre, 'Votos']); const r0 = r + 1, rO = r0 + filas.length - 1;
    filas.forEach(([t, v], i) => { ws.getCell(r0 + i, 1).value = t; if (v !== undefined) ws.getCell(r0 + i, 2).value = v; });
    const rT = rO + 1;
    ws.getCell(rT, 1).value = 'Total por mesa'; ws.getCell(rT, 2).value = fx(`SUM(B${r0}:B${rO})`, d.total);
    ws.getCell(rT + 1, 1).value = 'Omisos (no votaron)'; ws.getCell(rT + 1, 2).value = fx(`IF(COUNT(B${r0}:B${rO})=0,"",$B$5-B${rT})`, d.omisos === null ? '' : d.omisos);
    ws.getCell(rT + 2, 1).value = 'Control de cuadre'; ws.getCell(rT + 2, 2).value = fx(`IF(COUNT(B${r0}:B${rO})=0,"Sin datos",IF($B$5<=0,"Faltan electores hábiles",IF(B${rT}<=$B$5,"Cuadra","NO CUADRA")))`, control(d));
    ws.getCell(rT + 3, 1).value = 'Estado'; ws.getCell(rT + 3, 2).value = estadoTxt(d);
    estilo(ws, r0, rT + 3, 2, [rT, rT + 1, rT + 2, rT + 3]); for (let k = r0; k <= rT + 1; k++) ws.getCell(k, 2).numFmt = NUM;
    rojoSi(ws, `B${rT + 2}`, 'NO CUADRA'); r = rT + 5;
  });
  ws.getCell(r, 1).value = 'Control entre cargos'; ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 2).value = A.aviso ? 'AVISO: el total por mesa difiere → ' + A.aviso.map(([c, t]) => `${CARGOS[c]} ${t}`).join(' · ') : 'Los totales coinciden entre cargos completos';
  ws.getCell(r, 2).alignment = { horizontal: 'left' };
  ws.getColumn(1).width = 38; ws.getColumn(2).width = 22;
  return buf(wb);
}

/* ---------- Bitácora ---------- */
export async function xlsxBitacora(X, S) {
  const wb = libro(X), ws = hoja(wb, 'Bitácora'), reg = S.log.slice().reverse();     // más reciente primero, igual que en pantalla
  titulo(ws, 'Bitácora de cambios'); cabecera(ws, 5, ['Fecha y hora', 'Cargo', 'Mesa', 'Evento', 'Usuario']);
  reg.forEach((e, i) => { const r = 6 + i; ws.getCell(r, 1).value = fechaExcel(e.t); ws.getCell(r, 1).numFmt = 'dd/mm/yyyy hh:mm:ss'; ws.getCell(r, 2).value = CARGOS[e.cargo] || e.cargo; ws.getCell(r, 3).value = e.mesa; ws.getCell(r, 4).value = e.evento; ws.getCell(r, 5).value = e.usuario || '—'; });
  estilo(ws, 6, 5 + reg.length, 5); for (let r = 6; r < 6 + reg.length; r++) [1, 2, 4, 5].forEach(c => { ws.getCell(r, c).alignment = { horizontal: 'left' }; });
  [22, 22, 8, 60, 28].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  if (reg.length) ws.autoFilter = { from: 'A5', to: `E${5 + reg.length}` };
  ws.views = [{ state: 'frozen', ySplit: 5 }];
  return buf(wb);
}
