// ui-bitacora.js — Vista completa de la bitácora de eventos.
//
// Dependencias: calc.js, state.js, ui-helpers.js, ui-tablero.js (mkPanelExp, mkBotonExp)
// Sin dependencias de voz ni de tabla.

import { CARGOS }                        from './calc.js';
import { st }                            from './state.js';
import { h, btn }                        from './ui-helpers.js';
import { mkPanelExp, mkBotonExp }        from './ui-tablero.js';

const CS = Object.keys(CARGOS);

// Estado local de la vista: cargo seleccionado en el filtro
let filtroBit = '';
export const setFiltroBit = c => { filtroBit = c; };

// ─── Vista principal: bitácora ─────────────────────────────────────────────────
export function bitacora(descargar, render) {
  const S  = st.S;
  const pe = mkPanelExp(descargar, 'Exportar bitácora', [
    ['Excel (.xlsx)', 'bitacora-xlsx'],
    ['CSV',           'bitacora-csv'],
  ]);
  const reg = S.log
    .filter(e => !filtroBit || e.cargo === filtroBit)
    .slice()
    .reverse(); // más reciente primero

  return h('section', {},
    h('h2', {}, 'Bitácora'),
    h('div', { class: 'barra' },
      h('label', {}, 'Cargo: ',
        h('select', { onchange: e => { filtroBit = e.target.value; render(); } },
          h('option', { value: '' }, 'Todos'),
          ...CS.map(c => h('option', { value: c, selected: c === filtroBit }, CARGOS[c])),
        ),
      ),
      h('span', { class: 'nota' }, `${reg.length} eventos`),
    ),
    h('p', {}, mkBotonExp('Exportar bitácora', pe)),
    pe,
    reg.length
      ? h('div', { class: 'scroll' },
          h('table', { class: 'izq' },
            h('thead', {}, h('tr', {},
              ...['Fecha y hora', 'Cargo', 'Mesa', 'Evento', 'Usuario'].map(x => h('th', {}, x)),
            )),
            h('tbody', {}, ...reg.map(e =>
              h('tr', {},
                h('td', {}, new Date(e.t).toLocaleString('es-PE')),
                h('td', {}, CARGOS[e.cargo]),
                h('td', {}, e.mesa),
                h('td', {}, e.evento),
                h('td', {}, e.usuario || '—'),
              )
            )),
          )
        )
      : h('p', { class: 'nota' }, 'Sin eventos todavía.'),
  );
}
