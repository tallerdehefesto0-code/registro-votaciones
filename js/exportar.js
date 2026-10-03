// Exportación: carga las librerías solo cuando se piden (están copiadas en /vendor, funcionan sin internet),
// genera el archivo y lo descarga. Los datos salen de informes.js; el formato, de excel.js y pdf.js.
import { CARGOS } from './calc.js';
import * as I from './informes.js';
import * as XL from './excel.js';
import * as PD from './pdf.js';

const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf', csv: 'text/csv;charset=utf-8', json: 'application/json' };
const cargadas = {};
const script = src => cargadas[src] ||= new Promise((ok, no) => {
  const s = document.createElement('script'); s.src = src; s.onload = ok;
  s.onerror = () => { delete cargadas[src]; no(new Error('No se pudo cargar ' + src)); }; document.head.append(s);
});
const libExcel = async () => { await script('vendor/exceljs.min.js'); return window.ExcelJS; };
const libPdf = async () => {
  await script('vendor/jspdf.umd.min.js'); await script('vendor/jspdf.plugin.autotable.min.js');
  return { jsPDF: window.jspdf.jsPDF, autoTable: (doc, o) => (window.autoTable ? window.autoTable(doc, o) : doc.autoTable(o)) };
};

const sello = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };
const arch = (base, ext) => `votaciones_${base}_${sello()}.${ext}`;
const slug = c => c;                                                  // distrito, provincia, region, consejero
const parametrosTabla = p => typeof p === 'object' && p !== null ? p : { cargo: p };

// Cada reporte: id → (estado, parámetro) → { datos, nombre, ext }
const REPORTES = {
  'tabla-xlsx': async (S, p) => { const { cargo, territorio = '' } = parametrosTabla(p); return { datos: await XL.xlsxTabla(await libExcel(), S, cargo, territorio), nombre: arch('tabla-' + slug(cargo), 'xlsx'), ext: 'xlsx' }; },
  'tabla-csv': async (S, p) => { const { cargo, territorio = '' } = parametrosTabla(p); return { datos: I.csvTabla(S, cargo, territorio), nombre: arch('tabla-' + slug(cargo), 'csv'), ext: 'csv' }; },
  'tabla-pdf': async (S, p) => { const { cargo, territorio = '' } = parametrosTabla(p); return { datos: PD.pdfTabla(await libPdf(), S, cargo, territorio), nombre: arch('tabla-' + slug(cargo), 'pdf'), ext: 'pdf' }; },
  'tablero-xlsx': async S => ({ datos: await XL.xlsxTablero(await libExcel(), S), nombre: arch('tablero', 'xlsx'), ext: 'xlsx' }),
  'tablero-csv': async S => ({ datos: I.csvTablero(S), nombre: arch('tablero', 'csv'), ext: 'csv' }),
  'tablero-pdf': async S => ({ datos: PD.pdfTablero(await libPdf(), S), nombre: arch('tablero', 'pdf'), ext: 'pdf' }),
  'libro-xlsx': async S => ({ datos: await XL.xlsxLibro(await libExcel(), S), nombre: arch('libro-completo', 'xlsx'), ext: 'xlsx' }),
  'resultados-xlsx': async S => ({ datos: await XL.xlsxResultados(await libExcel(), S), nombre: arch('resultados', 'xlsx'), ext: 'xlsx' }),
  'resultados-pdf': async S => ({ datos: PD.pdfResultados(await libPdf(), S), nombre: arch('resultados', 'pdf'), ext: 'pdf' }),
  'resumen-pdf': async S => ({ datos: PD.pdfResumen(await libPdf(), S), nombre: arch('resumen-general', 'pdf'), ext: 'pdf' }),
  'acta-xlsx': async (S, n) => ({ datos: await XL.xlsxActa(await libExcel(), S, S.mesas.find(m => String(m.num) === String(n))), nombre: arch('acta-mesa-' + String(n).padStart(3, '0'), 'xlsx'), ext: 'xlsx' }),
  'acta-pdf': async (S, n) => ({ datos: PD.pdfActa(await libPdf(), S, S.mesas.find(m => String(m.num) === String(n))), nombre: arch('acta-mesa-' + String(n).padStart(3, '0'), 'pdf'), ext: 'pdf' }),
  'plano-csv': async S => ({ datos: I.csvPlano(S), nombre: arch('datos-largo', 'csv'), ext: 'csv' }),
  'matriz-csv': async S => ({ datos: I.csvMatriz(S), nombre: arch('datos-matriz', 'csv'), ext: 'csv' }),
  'bitacora-xlsx': async S => ({ datos: await XL.xlsxBitacora(await libExcel(), S), nombre: arch('bitacora', 'xlsx'), ext: 'xlsx' }),
  'bitacora-csv': async S => ({ datos: I.csvBitacora(S), nombre: arch('bitacora', 'csv'), ext: 'csv' }),
  'respaldo-json': async S => ({ datos: I.jsonRespaldo(S), nombre: arch('respaldo', 'json'), ext: 'json' }),
};

// Genera y descarga. Devuelve el nombre del archivo.
export async function descargar(id, S, param) {
  const r = await REPORTES[id](S, param);
  const url = URL.createObjectURL(new Blob([r.datos], { type: MIME[r.ext] }));
  const a = document.createElement('a'); a.href = url; a.download = r.nombre; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  return r.nombre;
}
export { leerRespaldo } from './informes.js';
