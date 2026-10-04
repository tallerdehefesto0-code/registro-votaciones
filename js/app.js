// app.js — Orquestador: router y arranque.
//
// Solo hace tres cosas:
//   • render(): elige la vista según el hash y la monta en #app.
//   • Conecta el motor de voz (voz-motor.js) con el router.
//   • Arranque: carga el estado, registra el service worker y lanza el primer render.
//
// Todo lo visual está en:
//   ui-tablero.js · ui-tabla.js · ui-bitacora.js · ui-reportes.js · ui-datos.js
// La voz está en voz-motor.js (interpretación de frases en voz.js).
// El estado global en state.js, la geografía en navegacion.js.

import { CARGOS }                                                  from './calc.js';
import { cargar }                                                  from './db.js';
import { descargar }                                               from './exportar.js';
import { setEstado, vacio, save, asegurarGeografia }               from './state.js';
import { tablero }                                                 from './ui-tablero.js';
import { tabla, actualizarTabla }                                  from './ui-tabla.js';
import { bitacora }                                                from './ui-bitacora.js';
import { reportes }                                                from './ui-reportes.js';
import { datos }                                                   from './ui-datos.js';
import { drive }                                                   from './ui-drive.js';
import { ctx, enlazarRender, pararVoz, pintarVoz,
         abrirVozSinTerritorio, prepararEntradaCargo,
         consumirConservarVoz }                                    from './voz-motor.js';
import { iniciarAuth }   from './auth.js';
import { montarSesion }  from './ui-sesion.js';
import { cargarOficialesSiVacio } from './datos-oficiales.js';

// ─────────────────────────────────────────────────────────────────────────────
// ROUTER Y RENDER
// ─────────────────────────────────────────────────────────────────────────────
const appEl = document.getElementById('app');

function render() {
  const [, r, a] = location.hash.slice(1).split('/');
  const entrarCargo = prepararEntradaCargo(r, a);
  if (!consumirConservarVoz()) pararVoz();

  let vista;
  if      (r === 'datos')               vista = datos(render);
  else if (r === 'bitacora')            vista = bitacora(descargar, render);
  else if (r === 'drive')               vista = drive(render);
  else if (r === 'reportes')            vista = reportes(descargar, render);
  else if (r === 'cargo' && CARGOS[a])  vista = tabla(a, ctx, descargar);
  else                                  vista = tablero(descargar);

  appEl.replaceChildren(vista);

  const pestañaActiva = r === 'cargo' ? '#/' : location.hash || '#/';
  document.querySelectorAll('nav a').forEach(l =>
    l.classList.toggle('on', l.getAttribute('href') === pestañaActiva)
  );

  if (entrarCargo) {
    abrirVozSinTerritorio(a, false);
    return;
  }
  if (r === 'cargo' && CARGOS[a] && appEl.querySelector('table')) {
    actualizarTabla(a, false, ctx);
    pintarVoz();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ARRANQUE
// ─────────────────────────────────────────────────────────────────────────────
enlazarRender(render);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js')
  .catch(err => console.error('No se pudo registrar el service worker:', err));

(async () => {
  try {
    setEstado((await cargar()) || vacio());
    asegurarGeografia();
    iniciarAuth();
    montarSesion(document.getElementById('sesion'));
    await save();
    window.addEventListener('hashchange', render);
    render();
    cargarOficialesSiVacio()
      .then(ofi => { console.info(ofi.msg); if (ofi.cargado) render(); })
      .catch(err => console.error('No se pudieron cargar los datos oficiales:', err));
  } catch (err) {
    const motivo = err?.message || String(err);
    appEl.className = 'mal';
    appEl.textContent = `No se pudo iniciar la aplicación: ${motivo}. Recarga la página`;
  }
})();
