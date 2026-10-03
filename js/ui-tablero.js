// ui-tablero.js — Vista del tablero de cargos (pantalla de inicio).
//
// Dependencias: calc.js, state.js, ui-helpers.js
// Sin dependencias de voz.

import { CARGOS, resumenCargo, pct }  from './calc.js';
import { st }                          from './state.js';
import { h, btn }                      from './ui-helpers.js';

const CS  = Object.keys(CARGOS);
const num = n => n.toLocaleString('es-PE');

// ─── Helpers de exportación reutilizados en el tablero ────────────────────────
// (panelExp y botonExp también los usa ui-tabla; se definen aquí y se
//  reexportan para no duplicarlos)
export async function bajar(descargar, id, param, msg) {
  msg.className = 'nota'; msg.textContent = 'Generando…';
  try {
    msg.className = 'ok';
    msg.textContent = '✔ Descargado: ' + await descargar(
      id,
      st.S,
      typeof param === 'function' ? param() : param
    );
  } catch (e) {
    msg.className = 'mal';
    msg.textContent = 'No se pudo generar el archivo: ' + e.message;
  }
}

export const mkOpciones = (descargar, items, msg) =>
  h('div', { class: 'acciones' }, ...items.map(([t, id, p]) => btn(t, () => bajar(descargar, id, p, msg))));

export function mkPanelExp(descargar, titulo, items) {
  const msg = h('p', { class: 'nota' });
  return h('div', { class: 'card', hidden: true },
    h('h3', {}, titulo),
    mkOpciones(descargar, items, msg),
    msg,
  );
}

export const mkBotonExp = (texto, panel) => btn(texto, () => { panel.hidden = !panel.hidden; });
export const FORMATOS   = pre => [['Excel (.xlsx)', pre + '-xlsx'], ['CSV', pre + '-csv'], ['PDF', pre + '-pdf']];

// ─── Resumen compacto (líder + cifras) ────────────────────────────────────────
const resumen = r => {
  const S = st.S;
  const lider = r.validos > 0 ? [...r.porOrg].sort((a, b) => b.votos - a.votos)[0] : null;
  return [
    h('div', { class: 'cifras' },
      h('div', {}, h('b', {}, num(r.validos)), h('span', {}, 'Válidos')),
      h('div', {}, h('b', {}, num(r.total)),   h('span', {}, 'Total')),
    ),
    lider && h('div', { class: 'lider' },
      'Primero: ', h('b', {}, lider.o.nombre),
      ` (${pct(lider.votos, r.validos)} válidos · ${pct(lider.votos, r.total)} del total)`,
    ),
  ];
};

// ─── Vista principal: tablero ──────────────────────────────────────────────────
export function tablero(descargar) {
  const S = st.S;
  const R  = Object.fromEntries(CS.map(c => [c, resumenCargo(S, c)]));
  const pe = mkPanelExp(descargar, 'Exportar tablero', FORMATOS('tablero'));

  const tarjeta = c => {
    const r      = R[c];
    const avance = r.nMesas ? Math.round(100 * r.cerradas / r.nMesas) : 0;
    return h('article', { class: 'card cargo-card' },
      h('div', { class: 'cab' },
        h('h3', {}, CARGOS[c]),
        r.provisional && h('span', { class: 'chip prov' }, 'Provisional'),
      ),
      h('div', {},
        h('div', { class: 'prog-t' },
          h('span', {}, 'Mesas cerradas'),
          h('b', {}, `${r.cerradas}/${r.nMesas}`),
        ),
        h('div', { class: 'prog', role: 'progressbar',
          'aria-valuenow': avance, 'aria-valuemin': 0, 'aria-valuemax': 100 },
          h('i', { style: `width:${avance}%` }),
        ),
      ),
      resumen(r),
      r.provisional && h('div', { class: 'mal' }, 'Provisional (hay mesas cerradas con observables)'),
      h('a', { href: '#/cargo/' + c, class: 'boton ir' }, 'Abrir tabla →'),
    );
  };

  return h('section', {},
    h('h2', {}, 'Tablero de cargos'),
    h('div', { class: 'cargos-grid' }, ...CS.map(tarjeta)),
    h('p', { class: 'acciones' },
      mkBotonExp('Exportar tablero', pe),
      h('a', { href: '#/reportes' }, 'Más reportes (libro completo, actas, resultados…)'),
    ),
    pe,
  );
}
