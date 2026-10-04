// ui-drive.js — Vista "Drive" (#/drive): crear o elegir la carpeta de la elección y
// probar el acceso entre cuentas distintas (el riesgo señalado en la sección 12 del plan).
//
// Dependencias: ui-helpers.js (h, btn), auth.js, drive-api.js, drive-store.js, drive-picker.js.

import { h, btn }       from './ui-helpers.js';
import { usuarioActual } from './auth.js';
import * as api          from './drive-api.js';
import { eleccionActual, crearEleccion, elegirEleccion, olvidarEleccion,
         estructura, guardarJSON } from './drive-store.js';
import { elegirArchivos } from './drive-picker.js';
import { armarRespaldo, panelAvances } from './ui-avances.js';

// Último mensaje: vive en el módulo para sobrevivir a los re-render.
let salida = 'Sin acciones todavía.';

const fecha = iso => (iso ? new Date(iso).toLocaleString('es-PE') : '—');

export function drive(render) {
  const u = usuarioActual();
  const e = eleccionActual();
  const puede = !!(u && u.drive);

  const pre = h('pre', { class: 'msg' }, salida);
  const decir = t => { salida = t; pre.textContent = t; };

  // Ejecuta una acción mostrando "Trabajando…" y traduciendo errores a texto.
  const accion = (fn, { redibujar = false } = {}) => async () => {
    decir('Trabajando…');
    try {
      decir(await fn());
      if (redibujar) render();
    } catch (err) {
      decir('Error: ' + (err.message || err) + (err.detalle ? `\n(${err.detalle})` : ''));
    }
  };

  const nombreEleccion = h('input', { type: 'text', placeholder: 'Ej.: ERM 2026 Lambayeque' });

  const verContenido = async () => {
    const { archivos, carpetas } = await estructura();
    const nc = Object.keys(carpetas).length;
    const lineas = [
      `La app ve ${nc} carpeta(s) y ${archivos.length} archivo(s) dentro de "${e.nombre}":`,
      ...Object.keys(carpetas).map(n => `  📁 ${n}`),
      ...archivos.map(a => `  📄 ${a.name} · v${a.version} · ${a.lastModifyingUser?.emailAddress || '—'} · ${fecha(a.modifiedTime)}`),
    ];
    if (!nc && !archivos.length) {
      lineas.push('', 'No se ve nada. Si la carpeta es de otra cuenta, Drive pudo conceder acceso solo a la carpeta y no a su contenido: usa "Elegir archivos de la carpeta".');
    }
    return lineas.join('\n');
  };

  // Escribe un archivo propio y lee todos los "prueba-*.json" visibles (de cualquier cuenta).
  const probarAcceso = async () => {
    const nombre = `prueba-${u.email}.json`;
    const { archivos, eleccion } = await estructura();
    const propio = archivos.find(a => a.name === nombre);
    const nuevo = await guardarJSON(eleccion.id, nombre, { por: u.email, t: new Date().toISOString() },
      propio ? propio.version : undefined);

    const { archivos: ahora } = await estructura();
    const pruebas = ahora.filter(a => a.name.startsWith('prueba-'));
    const lineas = [`Escritura correcta: ${nombre} (v${nuevo.version}).`, '', `Archivos de prueba visibles para ${u.email}:`];
    for (const p of pruebas) {
      try {
        const r = await api.leerJSON(p.id);
        lineas.push(`  ✔ ${p.name} → escrito por ${r.datos.por} (${fecha(r.datos.t)})`);
      } catch (err) {
        lineas.push(`  ✘ ${p.name} → no se pudo leer: ${err.message}`);
      }
    }
    if (pruebas.length < 2) lineas.push('', 'Solo ves tu propio archivo. Repite la prueba desde la otra cuenta y vuelve a pulsar este botón aquí.');
    return lineas.join('\n');
  };

  const guardarAvance = async () => {
    if (!u || !u.email) throw new Error('Inicia sesión con Google para guardar el avance.');
    const { eleccion } = await estructura();
    const nombre = `avance-${u.email}.json`;
    const r = armarRespaldo();
    const nuevo = await guardarJSON(eleccion.id, nombre, r);
    const cierres = Object.values(r.estado.cerradas).filter(Boolean).length;
    return `Avance guardado: ${nombre} (v${nuevo.version}).\nContenido: ${Object.keys(r.estado.votos).length} votos, ${cierres} cierres.`;
  };

  return h('section', {},
    h('h2', {}, 'Google Drive'),
    h('p', { class: 'nota' }, u
      ? `Sesión: ${u.email}${u.drive ? '' : ' · sin permiso de Drive (vuelve a iniciar sesión y acepta todos los permisos)'}`
      : 'Inicia sesión con Google (botón de arriba) para usar Drive.'),

    h('div', { class: 'card' },
      h('h3', {}, 'Carpeta de la elección'),
      h('p', {}, e ? `Carpeta actual: ${e.nombre}` : 'Ninguna carpeta elegida todavía.'),
      h('label', { class: 'campo' }, h('span', {}, 'Nombre de la elección nueva'), nombreEleccion),
      h('div', { class: 'acciones' },
        btn('Crear elección nueva', accion(async () => {
          const c = await crearEleccion(nombreEleccion.value);
          return `Elección creada: Votaciones/${c.nombre}\nAhora compártela desde Drive (clic derecho → Compartir) con los demás registrados como Editor.`;
        }, { redibujar: true }), { disabled: !puede }),
        btn('Elegir carpeta compartida', accion(async () => {
          const c = await elegirEleccion();
          return c ? `Carpeta elegida: ${c.nombre}` : 'Selección cancelada.';
        }, { redibujar: true }), { disabled: !puede }),
        btn('Olvidar', () => { olvidarEleccion(); salida = 'Carpeta olvidada en este dispositivo (no se borra nada en Drive).'; render(); },
          { disabled: !e }),
      ),
    ),

    h('div', { class: 'card' },
      h('h3', {}, 'Pruebas de acceso'),
      h('div', { class: 'acciones' },
        btn('Ver contenido', accion(verContenido), { disabled: !puede || !e }),
        btn('Elegir archivos de la carpeta', accion(async () => {
          const r = await elegirArchivos(e.id);
          return r ? `Archivos autorizados: ${r.map(x => x.nombre).join(', ')}\nPulsa "Ver contenido" para comprobarlo.` : 'Selección cancelada.';
        }), { disabled: !puede || !e }),
        btn('Probar escritura y lectura', accion(probarAcceso), { disabled: !puede || !e }),
      ),
    ),
    
    h('div', { class: 'card' },
      h('h3', {}, 'Mi avance'),
      h('p', { class: 'nota' }, 'Sube una copia de tus datos a la carpeta compartida. Es un solo archivo por persona y se sobrescribe cada vez.'),
      h('div', { class: 'acciones' },
        btn('Guardar mi avance', accion(guardarAvance), { disabled: !puede || !e }),
      ),
    ),
    
    panelAvances(render),

    pre,
  );
}
