// ui-sesion.js — Botón de sesión del encabezado.
//
// Muestra "Iniciar sesión con Google" o "Nombre · Salir". Usa DOM puro (sin h()
// de ui-helpers) para no depender de nada más que de auth.js.

import { usuarioActual, iniciarSesion, cerrarSesion, onSesion } from './auth.js';

function crear(tag, clase, texto) {
  const el = document.createElement(tag);
  if (clase) el.className = clase;
  if (texto != null) el.textContent = texto;
  return el;
}

export function montarSesion(el) {
  if (!el) return;
  let ocupado = false;
  let mensaje = '';

  async function entrar() {
    ocupado = true; mensaje = ''; pintar();
    try { await iniciarSesion(); }
    catch (e) { mensaje = e.message || 'No se pudo iniciar sesión.'; }
    ocupado = false; pintar();
  }

  function pintar() {
    el.replaceChildren();
    const u = usuarioActual();

    if (u) {
      const nombre = crear('span', 'sesion-nombre', u.nombre);
      nombre.title = u.email;
      const salir = crear('button', '', 'Salir');
      salir.type = 'button';
      salir.onclick = () => { mensaje = ''; cerrarSesion(); };
      el.append(nombre, salir);
      if (!u.drive) el.append(crear('span', 'sesion-error', 'Sin permiso de Drive'));
    } else {
      const b = crear('button', '', ocupado ? 'Conectando…' : 'Iniciar sesión con Google');
      b.type = 'button';
      b.disabled = ocupado;
      b.onclick = entrar;
      el.append(b);
    }

    if (mensaje) {
      const m = crear('span', 'sesion-error', mensaje);
      m.setAttribute('role', 'alert');
      el.append(m);
    }
  }

  onSesion(pintar);
  pintar();
}
