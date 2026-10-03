// ui-helpers.js — Utilidades de construcción de DOM compartidas por todos los módulos de UI.
//
// Exporta `h` y `btn` para que cada vista los importe en lugar de redefinirlos.
// app.js también los importará desde aquí en la próxima refactorización.

// ─── Constructor de elementos DOM ─────────────────────────────────────────────
// h('tag', { atributos, onEvento }, ...hijos)
// - Los atributos que empiezan con "on" se registran como addEventListener.
// - true → setAttribute sin valor (atributo booleano).
// - false / null / undefined → el atributo se omite.
export const h = (t, a = {}, ...k) => {
  const e = document.createElement(t);
  for (const [n, v] of Object.entries(a)) {
    if (n.startsWith('on')) e.addEventListener(n.slice(2), v);
    else if (v === true)  e.setAttribute(n, '');
    else if (v !== false && v != null) e.setAttribute(n, v);
  }
  e.append(...k.flat().filter(x => x != null && x !== false));
  return e;
};

// ─── Botón estándar ───────────────────────────────────────────────────────────
export const btn = (t, f, extra = {}) => h('button', { type: 'button', onclick: f, ...extra }, t);
