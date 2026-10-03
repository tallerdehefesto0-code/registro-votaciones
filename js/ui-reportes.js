// ui-reportes.js — Vista de reportes y exportación.
//
// Dependencias: calc.js, state.js, exportar.js, ui-helpers.js, ui-tablero.js
// Sin dependencias de voz ni de tabla.

import { CARGOS }                              from './calc.js';
import { st, setEstado, save, asegurarGeografia } from './state.js';
import { leerRespaldo }                        from './exportar.js';
import { h }                                   from './ui-helpers.js';
import { mkPanelExp, mkBotonExp, mkOpciones }  from './ui-tablero.js';

const CS = Object.keys(CARGOS);

// ─── Vista principal: reportes ─────────────────────────────────────────────────
export function reportes(descargar, render) {
  const S    = st.S;
  const msgR = h('pre', { class: 'msg' });

  // Helper local para tarjetas de reporte
  const card = (t, desc, items, extra, despues) => {
    const msg = h('p', { class: 'nota' });
    return h('section', { class: 'card' },
      h('h3', {}, t),
      h('p', { class: 'nota' }, desc),
      extra,
      mkOpciones(descargar, items, msg),
      msg,
      despues,
    );
  };

  const selMesa = h('select', { 'aria-label': 'Mesa' },
    ...S.mesas.map(m => h('option', { value: m.num }, `Mesa ${m.num}${m.local ? ' · ' + m.local : ''}`)),
  );
  const mesa = () => selMesa.value;

  const restaurar = h('label', { class: 'boton' },
    'Restaurar desde respaldo (JSON)',
    h('input', {
      type: 'file', accept: '.json,application/json', hidden: true,
      onchange: async e => {
        const f = e.target.files[0];
        if (!f) return;
        e.target.value = '';
        const r = leerRespaldo(await f.text());
        if (r.err.length) {
          msgR.textContent = `No se restauró «${f.name}»:\n` + r.err.slice(0, 10).join('\n');
          return;
        }
        if (!confirm('Esto reemplaza TODOS los datos actuales por los del respaldo. Conviene descargar antes un respaldo del estado actual. ¿Continuar?')) return;
        setEstado(r.estado);
        asegurarGeografia();
        await save();
        render();
        alert(`Respaldo restaurado: ${st.S.mesas.length} mesas, ${Object.keys(st.S.votos).length} votos.`);
      },
    }),
  );

  return h('section', {},
    h('h2', {}, 'Reportes y exportación'),
    h('p', { class: 'nota' },
      S.mesas.length
        ? 'Los archivos reflejan lo que muestran las pantallas en este momento. Las mesas sin registrar quedan en blanco, no en cero.'
        : 'Aún no hay datos cargados: los reportes saldrían vacíos. Carga datos en «Datos».',
    ),
    h('div', { class: 'grid' },
      card('Libro completo',
        'Una hoja por cargo y la hoja del tablero, con fórmulas enlazadas.',
        [['Excel (.xlsx)', 'libro-xlsx']],
      ),
      card('Resultados por organización',
        'Ranking, ambos porcentajes y gráfico de barras.',
        [['Excel (.xlsx)', 'resultados-xlsx'], ['PDF', 'resultados-pdf']],
      ),
      card('Resumen general',
        'Tablero y totales de cada cargo, listo para imprimir.',
        [['PDF', 'resumen-pdf']],
      ),
      card('Acta por mesa',
        'Todos los cargos de una mesa, para auditar.',
        [['PDF', 'acta-pdf', mesa], ['Excel (.xlsx)', 'acta-xlsx', mesa]],
        S.mesas.length ? h('label', { class: 'campo' }, h('span', {}, 'Mesa'), selMesa) : null,
      ),
      card('Datos planos (CSV)',
        'Largo: una fila por dato registrado. Matriz: una fila por organización y una columna por mesa.',
        [['Formato largo', 'plano-csv'], ['Formato matriz', 'matriz-csv']],
      ),
      card('Bitácora',
        'Historial de cierres y reaperturas.',
        [['Excel (.xlsx)', 'bitacora-xlsx'], ['CSV', 'bitacora-csv']],
      ),
      card('Respaldo (JSON)',
        'Estado completo de la app. Se puede restaurar desde aquí mismo.',
        [['Descargar respaldo', 'respaldo-json']],
        null,
        h('div', {}, h('div', { class: 'acciones' }, restaurar), msgR),
      ),
    ),
    h('p', { class: 'nota' }, 'Para exportar la tabla de un cargo o el tablero, usa el botón «Exportar» de esa pantalla.'),
  );
}
