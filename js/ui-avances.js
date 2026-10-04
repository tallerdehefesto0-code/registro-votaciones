// ui-avances.js — Panel del administrador: une los avances de los registradores con el estado local.
//
// Dos formas de traer avances; ambas pasan por el mismo camino (prepararCombinacion):
//   • Plan B: archivos JSON (el respaldo que cada registrador descarga y envía por WhatsApp o correo).
//   • Plan A: archivos "avance-<correo>.json" de la carpeta de la elección en Drive.
//
// Nada cambia en los datos del dispositivo hasta que se pulsa "Aplicar combinación":
// primero se combina sobre una COPIA y se muestra el resultado.
//
// Dependencias: ui-helpers.js, state.js, informes.js (leerRespaldo), combinar.js,
//               auth.js, drive-store.js, drive-api.js.

import { h, btn } from './ui-helpers.js';
import { st, setEstado, save, asegurarGeografia, registrarEvento } from './state.js';
import { leerRespaldo } from './exportar.js';
import { combinar, resolverConflictos, resumenCombinacion } from './combinar.js';
import { usuarioActual } from './auth.js';
import { eleccionActual, estructura } from './drive-store.js';
import * as api from './drive-api.js';

const copia = o => JSON.parse(JSON.stringify(o));
const MAX_FILAS = 150;   // filas de conflictos que se dibujan (las acciones masivas cubren todas)

// Respaldo con la misma forma que descarga Reportes, para que leerRespaldo lo valide igual.
export function armarRespaldo() {
  const s = st.S;
  return {
    app: 'registro-votaciones',
    version: 1,
    fecha: new Date().toISOString(),
    estado: copia({
      orgs: s.orgs, mesas: s.mesas, votos: s.votos, cerradas: s.cerradas,
      log: s.log, archivos: s.archivos, geografia: s.geografia,
    }),
  };
}

function descargarRespaldoActual() {
  const blob = new Blob([JSON.stringify(armarRespaldo())], { type: 'application/json' });
  const a = document.createElement('a');
  const marca = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = URL.createObjectURL(blob);
  a.download = `respaldo-antes-de-combinar-${marca}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// items: [{ nombre, texto }] o [{ nombre, error }]. Combina sobre una copia del estado.
function prepararCombinacion(items) {
  const trabajo = copia(st.S);
  const informe = [];
  const conflictos = [];
  for (const it of items) {
    if (it.error) { informe.push({ nombre: it.nombre, error: it.error }); continue; }
    const r = leerRespaldo(it.texto);
    if (r.err.length) { informe.push({ nombre: it.nombre, error: r.err.slice(0, 4).join(' · ') }); continue; }
    const res = combinar(trabajo, r.estado);
    res.conflictos.forEach(c => conflictos.push({ ...c, archivo: it.nombre }));
    informe.push({ nombre: it.nombre, resumen: resumenCombinacion(res) });
  }
  return { trabajo, informe, conflictos };
}

// Plan A: lee los "avance-*.json" que la app puede ver en la carpeta (propios y autorizados).
async function itemsDeDrive() {
  const u = usuarioActual();
  if (!u || !u.drive) throw new Error('Inicia sesión con Google y acepta el permiso de Drive.');
  if (!eleccionActual()) throw new Error('Primero elige la carpeta en la pestaña Drive.');
  const { archivos } = await estructura();
  const propio = `avance-${u.email}.json`;   // el propio se omite: ya está en este dispositivo
  const lista = archivos.filter(a => a.name.startsWith('avance-') && a.name.endsWith('.json') && a.name !== propio);
  if (!lista.length) {
    throw new Error('La app no ve ningún avance de otras personas.\nEn la pestaña Drive pulsa «Elegir archivos de la carpeta» y marca los avance-….json.');
  }
  const items = [];
  for (const a of lista) {
    try {
      const r = await api.leerJSON(a.id);
      items.push({ nombre: a.name, texto: JSON.stringify(r.datos) });
    } catch (err) {
      items.push({ nombre: a.name, error: 'No se pudo leer: ' + (err.message || err) });
    }
  }
  return items;
}

const esResoluble = c => c.tipo === 'voto' || c.tipo === 'mesa-hab';

function nombreConflicto(c) {
  if (c.tipo === 'voto') { const [cg, mesa, x] = c.clave.split('|'); return `${cg} · mesa ${mesa} · ${x}`; }
  if (c.tipo === 'mesa-hab') return `Electores hábiles de la mesa ${c.clave}`;
  if (c.tipo === 'mesa-distrito') return `Mesa ${c.clave}: distrito distinto`;
  return `Organización ${c.clave}`;
}

export function panelAvances(render) {
  const salida = h('pre', { class: 'msg' }, 'Sin acciones todavía.');
  const detalle = h('div', {});
  const decir = t => { salida.textContent = t; };

  const mostrar = prep => {
    detalle.replaceChildren();
    const { trabajo, informe, conflictos } = prep;
    decir(informe.map(i => `${i.error ? '✘' : '✔'} ${i.nombre}: ${i.error || i.resumen}`).join('\n'));

    const validos = informe.filter(i => !i.error).length;
    if (!validos) return;

    const resolubles = conflictos.filter(esResoluble);
    const aRevisar = conflictos.filter(c => !esResoluble(c));
    const elegidos = new Set();   // conflictos donde se usará el valor del archivo
    const cajas = [];

    if (resolubles.length) {
      detalle.appendChild(h('p', {}, `Conflictos de valores: ${resolubles.length}. Marca los que quieras sustituir por el valor del archivo; sin marcar se conserva el actual.`));
      detalle.appendChild(h('div', { class: 'acciones' },
        btn('Usar todos los del archivo', () => { resolubles.forEach(c => elegidos.add(c)); cajas.forEach(x => { x.checked = true; }); }),
        btn('Conservar todos los actuales', () => { elegidos.clear(); cajas.forEach(x => { x.checked = false; }); }),
      ));
      resolubles.slice(0, MAX_FILAS).forEach(c => {
        const cb = h('input', { type: 'checkbox', onchange: e => { if (e.target.checked) elegidos.add(c); else elegidos.delete(c); } });
        cajas.push(cb);
        detalle.appendChild(h('div', { class: 'acciones' }, cb,
          h('span', {}, `${nombreConflicto(c)}: actual ${c.actual} → archivo ${c.nuevo} (${c.archivo})`)));
      });
      if (resolubles.length > MAX_FILAS) {
        detalle.appendChild(h('p', { class: 'nota' }, `Se muestran ${MAX_FILAS} de ${resolubles.length}. Los botones de arriba aplican a todos.`));
      }
    }

    if (aRevisar.length) {
      detalle.appendChild(h('p', {}, 'Para revisar a mano (no se cambian solos):'));
      detalle.appendChild(h('pre', { class: 'msg' },
        aRevisar.map(c => `• ${nombreConflicto(c)}: actual «${c.actual}» / archivo «${c.nuevo}» (${c.archivo})`).join('\n')));
    }

    detalle.appendChild(h('div', { class: 'acciones' },
      btn('Aplicar combinación', async () => {
        if (!confirm(`Se aplicará la combinación de ${validos} archivo(s) a los datos de ESTE dispositivo. Si aún no descargaste un respaldo del estado actual, cancela y hazlo primero. ¿Continuar?`)) return;
        const cambiados = resolverConflictos(trabajo, resolubles, c => elegidos.has(c));
        setEstado(trabajo);
        asegurarGeografia();
        registrarEvento('', '', `Combinación de avances: ${validos} archivo(s); ${cambiados} valor(es) sustituidos por los del archivo`);
        await save();
        render();
        alert(`Combinación aplicada: ${st.S.mesas.length} mesas, ${Object.keys(st.S.votos).length} votos.`);
      }),
    ));
  };

  const entrada = h('input', {
    type: 'file', accept: '.json,application/json', hidden: true,
    onchange: async e => {
      const fs = [...e.target.files];
      e.target.value = '';
      if (!fs.length) return;
      decir('Leyendo archivos…');
      detalle.replaceChildren();
      try {
        const items = [];
        for (const f of fs) items.push({ nombre: f.name, texto: await f.text() });
        mostrar(prepararCombinacion(items));
      } catch (err) {
        decir('Error: ' + (err.message || err));
      }
    },
  });
  entrada.multiple = true;

  return h('div', { class: 'card' },
    h('h3', {}, 'Unir avances de los registradores (administrador)'),
    h('p', { class: 'nota' }, 'Primero se combina sobre una copia y se muestra el resultado. Nada se guarda hasta pulsar «Aplicar combinación».'),
    h('div', { class: 'acciones' },
      btn('1. Descargar respaldo actual', () => descargarRespaldoActual()),
      h('label', { class: 'boton' }, '2. Cargar avances desde archivos (Plan B)', entrada),
      btn('2. Traer avances de Drive (Plan A)', async () => {
        decir('Trabajando…');
        detalle.replaceChildren();
        try { mostrar(prepararCombinacion(await itemsDeDrive())); }
        catch (err) { decir('Error: ' + (err.message || err)); }
      }),
    ),
    salida,
    detalle,
  );
}
