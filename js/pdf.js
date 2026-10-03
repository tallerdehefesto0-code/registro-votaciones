// Reportes en PDF. Recibe { jsPDF, autoTable } como parámetro (así se prueba fuera del navegador).
// La letra estándar de PDF solo admite caracteres latinos: lo demás se cambia por «?».
import { CARGOS } from './calc.js';
import { AVISO, CS, modeloTabla, modeloTablero, modeloRanking, modeloActa, matrizTabla, estadoTxt, control, nota } from './informes.js';

const AZUL = [31, 95, 191], GRIS = [243, 246, 251], ROJO = [179, 38, 30];
const lat = t => String(t ?? '').replace(/[^\u0000-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u20ac]/g, '?');
const fx = R => R.map(f => f.map(x => (typeof x === 'number' ? x.toLocaleString('es-PE') : lat(x))));
const hoy = () => new Date().toLocaleString('es-PE');

function nuevo(lib, orient, titulo, sub = '') {
  const doc = new lib.jsPDF({ orientation: orient, unit: 'mm', format: 'a4' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(lat(titulo), 14, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(91, 101, 119);
  doc.text(lat(AVISO + (sub ? ' · ' + sub : '')), 14, 21); doc.setTextColor(0);
  return doc;
}
// Pie de cada página: aviso, fecha y número de página
function cerrar(doc) {
  const n = doc.getNumberOfPages(), w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120); doc.text(lat(`${AVISO} · ${hoy()}`), 14, h - 8); doc.text(`Página ${i} de ${n}`, w - 14, h - 8, { align: 'right' }); }
  return doc.output('arraybuffer');
}
const base = { styles: { fontSize: 8, cellPadding: 1.6, lineColor: [200, 205, 215], lineWidth: 0.1 }, headStyles: { fillColor: AZUL, halign: 'center', valign: 'middle' }, margin: { left: 14, right: 14, bottom: 14 } };
const finY = doc => doc.lastAutoTable.finalY;
const tablaPDF = (lib, doc, o) => lib.autoTable(doc, { ...base, ...o });
const roja = d => { if (d.section === 'body' && /NO CUADRA|REVISAR|supera/.test(String(d.cell.raw))) { d.cell.styles.textColor = ROJO; d.cell.styles.fontStyle = 'bold'; } };

/* ---------- Tabla de un cargo ---------- */
function bloqueTabla(lib, doc, M, y) {
  const X = matrizTabla(M);
  const compacto = M.filas.length > 10;                                  // muchas organizaciones: letra y márgenes menores para que quepa en una hoja
  tablaPDF(lib, doc, {
    styles: { ...base.styles, fontSize: compacto ? 6.5 : 8, cellPadding: compacto ? 0.8 : 1.6 },
    startY: y, head: [X.cab.map((t, i) => lat(i > 0 && i <= M.ms.length ? `${t}\n${M.ms[i - 1].local}` : t))], body: fx([...X.filas, ...X.calc]),
    columnStyles: { 0: { halign: 'left', cellWidth: 52, fontStyle: 'bold' } }, bodyStyles: { halign: 'right' },
    horizontalPageBreak: true, horizontalPageBreakRepeat: 0, rowPageBreak: 'avoid',
    didParseCell: d => { if (d.section === 'body' && d.row.index >= X.filas.length) { d.cell.styles.fillColor = GRIS; d.cell.styles.fontStyle = 'bold'; } roja(d); },
  });
}
export function pdfTabla(lib, S, c, territorio = '') {
  const M = modeloTabla(S, c, territorio), doc = nuevo(lib, 'landscape', 'Tabla de votos · ' + M.nombre + (territorio ? ' · ' + territorio : ''), nota(M.R));
  if (!M.listo) doc.text('Faltan organizaciones o mesas para este cargo.', 14, 30); else bloqueTabla(lib, doc, M, 26);
  return cerrar(doc);
}

/* ---------- Tablero ---------- */
function bloqueTablero(lib, doc, S, y) {
  const T = modeloTablero(S);
  tablaPDF(lib, doc, { startY: y, head: [['', ...T.cols.map(c => CARGOS[c])]], body: fx(T.filas.map(f => [f.et, ...f.vals])),
    columnStyles: { 0: { halign: 'left', cellWidth: 52, fontStyle: 'bold' } }, bodyStyles: { halign: 'right' } });
}
export function pdfTablero(lib, S) {
  const prov = CS.some(c => modeloTablero(S).R[c].provisional), doc = nuevo(lib, 'landscape', 'Tablero de cargos', prov ? 'RESULTADOS PROVISIONALES' : '');
  bloqueTablero(lib, doc, S, 26); return cerrar(doc);
}

/* ---------- Resultados por organización (ranking + gráfico de barras dibujado) ---------- */
function bloqueResultado(lib, doc, K, y) {
  const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
  const nuevaPag = () => { doc.addPage(); return 18; };
  const alto = 14 + (K.ranking.length + 5) * 7 + 16 + K.ranking.length * 6.4;      // estimado: título + tabla + gráfico
  if (y > 30 && y + alto > h - 16) y = nuevaPag();                                  // si el cargo no cabe completo, empieza en página nueva
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(lat(K.nombre + (nota(K.R) ? '  (PROVISIONAL)' : '')), 14, y);
  if (!K.listo) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text('Faltan organizaciones o mesas para este cargo.', 14, y + 6); return y + 12; }
  const R = K.R;
  tablaPDF(lib, doc, { startY: y + 3, head: [['Puesto', 'Organización', 'Candidato', 'Votos', '% válidos', '% total']],
    body: fx([...K.ranking.map(p => [p.puesto, p.o.n + ' – ' + p.o.nombre, p.o.cand, p.votos, p.pv, p.pt]),
      ['', 'Votos en blanco', '', R.blanco, '', K.filas.find(f => f.x === 'blanco').pt], ['', 'Votos nulos (viciados)', '', R.nulo, '', K.filas.find(f => f.x === 'nulo').pt],
      ['', 'Votos observables', '', R.obs, '', K.filas.find(f => f.x === 'obs').pt], ['', 'Total de votos', '', R.total, '', '']]),
    columnStyles: { 0: { halign: 'center', cellWidth: 14 }, 1: { halign: 'left' }, 2: { halign: 'left' } }, bodyStyles: { halign: 'right' },
    didParseCell: d => { if (d.section === 'body' && d.row.index >= K.ranking.length) { d.cell.styles.fillColor = GRIS; d.cell.styles.fontStyle = 'bold'; } } });
  y = finY(doc) + 7;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('Gráfico de barras (% sobre votos válidos)', 14, y); y += 4;
  const x0 = 70, ancho = w - x0 - 30;
  K.ranking.forEach(p => {
    if (y > h - 18) y = nuevaPag();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(0);
    doc.text(lat(doc.splitTextToSize(p.o.n + ' – ' + p.o.nombre, x0 - 18)[0]), 14, y + 3.6);
    doc.setFillColor(...AZUL); if (p.frac > 0) doc.rect(x0, y, Math.max(0.6, ancho * p.frac), 4.6, 'F');
    doc.setDrawColor(200, 205, 215); doc.rect(x0, y, ancho, 4.6);
    doc.text(lat(p.pv), x0 + ancho + 2, y + 3.6); y += 6.4;
  });
  return y + 6;
}
export function pdfResultados(lib, S) {
  const doc = nuevo(lib, 'portrait', 'Resultados por organización', CS.some(c => modeloTablero(S).R[c].provisional) ? 'RESULTADOS PROVISIONALES' : '');
  let y = 30; CS.forEach(c => { y = bloqueResultado(lib, doc, modeloRanking(S, c), y); });
  return cerrar(doc);
}

/* ---------- Resumen general: tablero + totales de cada cargo, listo para imprimir ---------- */
export function pdfResumen(lib, S) {
  const doc = nuevo(lib, 'portrait', 'Resumen general · ERM 2026', CS.some(c => modeloTablero(S).R[c].provisional) ? 'RESULTADOS PROVISIONALES' : '');
  bloqueTablero(lib, doc, S, 27);
  let y = finY(doc) + 10;
  CS.forEach(c => { y = bloqueResultado(lib, doc, modeloRanking(S, c), y); });
  return cerrar(doc);
}

/* ---------- Acta de una mesa ---------- */
export function pdfActa(lib, S, mesa) {
  const A = modeloActa(S, mesa), doc = nuevo(lib, 'portrait', `Acta de la mesa ${mesa.num}`);
  const h = doc.internal.pageSize.getHeight();
  doc.setFontSize(10); doc.text(lat(`Local de votación: ${mesa.local || '—'}`), 14, 28); doc.text(`Electores hábiles: ${mesa.hab.toLocaleString('es-PE')}`, 14, 34);
  let y = 40;
  A.cargos.forEach(({ nombre, d, filas }) => {
    const fv = v => (v === undefined ? '—' : v);
    if (y + (filas.length + 5) * 6.4 + 8 > h - 16) { doc.addPage(); y = 20; }                // el cargo no se parte entre páginas
    tablaPDF(lib, doc, { startY: y, head: [[lat(nombre), 'Votos']], rowPageBreak: 'avoid',
      body: fx([...filas.map(([t, v]) => [t, fv(v)]), ['Total por mesa', d.total], ['Omisos (no votaron)', d.omisos === null ? '—' : d.omisos], ['Control de cuadre', control(d)], ['Estado', estadoTxt(d)]]),
      columnStyles: { 0: { halign: 'left' }, 1: { halign: 'right', cellWidth: 55 } }, tableWidth: 140,
      didParseCell: d2 => { if (d2.section === 'body' && d2.row.index >= filas.length) { d2.cell.styles.fillColor = GRIS; d2.cell.styles.fontStyle = 'bold'; } roja(d2); } });
    y = finY(doc) + 7;
  });
  if (y > h - 55) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(A.aviso ? 179 : 0, A.aviso ? 38 : 0, A.aviso ? 30 : 0);
  doc.text(lat(A.aviso ? 'AVISO: el total por mesa difiere entre cargos → ' + A.aviso.map(([c, t]) => `${CARGOS[c]} ${t}`).join(' · ') : 'Control entre cargos: los totales coinciden en los cargos completos.'), 14, y);
  doc.setTextColor(0); doc.setFont('helvetica', 'normal'); y += 22;
  [['Registrado por', 14], ['Revisado por', 105]].forEach(([t, x]) => { doc.line(x, y, x + 80, y); doc.text(t, x, y + 5); });
  doc.text('Fecha: ____ / ____ / ________', 14, y + 16);
  return cerrar(doc);
}
