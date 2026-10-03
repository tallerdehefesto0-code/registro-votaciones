// ui-datos.js — Vista completa de la pestaña "Datos" (organizaciones, mesas, geografía).
//
// Responsabilidades:
//   • Subida e importación de archivos CSV/JSON de organizaciones y mesas.
//   • Formularios de alta manual de mesas y organizaciones.
//   • Edición en línea de las tablas de mesas y organizaciones.
//   • Paginación (50 filas) y búsqueda en tiempo real en esas tablas.
//   • Gestión de la geografía (Región → Provincia → Distrito).
//   • Acciones de reset: cargar datos de prueba, borrar votos, borrar todo.
//
// Dependencias:
//   state.js      → st (Proxy S), setEstado, vacio, save, asegurarGeografia
//   calc.js       → CARGOS, hayVotos
//   csv.js        → leerOrgs, leerMesas, plantilla
//   seed.js       → datosPrueba
//   navegacion.js → territoriosDeCargo
//   ui-helpers.js → h, btn
//
// `render` se recibe como parámetro en `datos(render)` para evitar
// una importación circular (ui-datos → app → ui-datos).

import { st, setEstado, vacio, save, asegurarGeografia } from './state.js';
import { CARGOS, hayVotos }                               from './calc.js';
import { leerOrgs, leerMesas, plantilla }                  from './csv.js';
import { datosPrueba }                                     from './seed.js';
import { territoriosDeCargo }                              from './navegacion.js';
import { h, btn }                                          from './ui-helpers.js';

// ─── Proxy local idéntico al de app.js ───────────────────────────────────────
// Permite escribir S.mesas, S.votos, etc. sin importar la variable directamente.
const S = new Proxy({}, {
  get: (_, prop) => st.S[prop],
  set: (_, prop, value) => { st.S[prop] = value; return true; },
});

// Lista de cargos (misma que CS en app.js)
const CS = Object.keys(CARGOS);

// ─── Estado local de la vista ─────────────────────────────────────────────────
// 'general' muestra organizaciones y mesas; 'geografia' muestra la tabla de distritos.
let datosVista = 'general';

// Paginación y búsqueda por tabla. Vive fuera de datos() para que, al editar una
// fila y volver a renderizar, se conserve la página y el texto buscado.
const POR_PAGINA = 50;
const listado = {
  mesas: { q: '', pag: 0 },
  orgs:  { q: '', pag: 0 },
};

// ─── Helpers internos ─────────────────────────────────────────────────────────
const fecha = t => new Date(t).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
const campo = (t, ...el) => h('label', { class: 'campo' }, h('span', {}, t), ...el);
const card  = (t, ...k)  => h('section', { class: 'card' }, h('h3', {}, t), ...k);

// Minúsculas y sin tildes, para que «Chiclayo» y «chíclayo» coincidan al buscar.
const norm = t => String(t ?? '')
  .toLocaleLowerCase('es')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

// ─── Tabla paginada con búsqueda ──────────────────────────────────────────────
// Solo se crean en el DOM las filas de la página actual (máx. POR_PAGINA).
// Al escribir en el buscador o cambiar de página solo se repinta el <tbody> y el
// pie, sin llamar a render(): así el input no pierde el foco mientras se escribe.
//
//   clave       'mesas' | 'orgs' (selecciona el estado en `listado`)
//   items       arreglo completo de elementos a mostrar
//   texto(it)   texto donde se busca para cada elemento
//   fila(it)    devuelve el <tr> del elemento
function tablaPaginada({ clave, placeholder, claseTabla, columnas, items, texto, fila }) {
  const est    = listado[clave];
  const indice = items.map(it => norm(texto(it))); // se calcula una sola vez
  const tbody  = h('tbody', {});
  const info   = h('span', { class: 'pag-info', role: 'status', 'aria-live': 'polite' });
  const pie    = h('div', { class: 'acciones paginacion' });

  const pintar = () => {
    const q         = norm(est.q).trim();
    const filtrados = q ? items.filter((_, i) => indice[i].includes(q)) : items;
    const paginas   = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
    est.pag         = Math.min(Math.max(0, est.pag), paginas - 1);
    const ini       = est.pag * POR_PAGINA;
    const pagina    = filtrados.slice(ini, ini + POR_PAGINA);

    tbody.replaceChildren(...pagina.map(fila));

    info.textContent = filtrados.length
      ? `${ini + 1}–${ini + pagina.length} de ${filtrados.length}` +
        (q ? ` (filtrado de ${items.length})` : '') +
        ` · Página ${est.pag + 1} de ${paginas}`
      : (q ? 'Sin resultados para la búsqueda' : 'Sin registros');

    pie.replaceChildren(
      btn('← Anterior',  () => { est.pag--; pintar(); }, { disabled: est.pag <= 0 }),
      info,
      btn('Siguiente →', () => { est.pag++; pintar(); }, { disabled: est.pag >= paginas - 1 }),
    );
  };

  const buscador = h('input', {
    type: 'search',
    class: 'buscador',
    placeholder,
    value: est.q,
    'aria-label': placeholder,
    oninput: e => { est.q = e.target.value; est.pag = 0; pintar(); },
  });

  pintar();
  return h('div', {},
    h('div', { class: 'barra-busqueda' }, buscador),
    h('div', { class: 'scroll admin-scroll' },
      h('table', { class: claseTabla },
        h('thead', {}, h('tr', {}, ...columnas.map(t => h('th', {}, t)))),
        tbody,
      )
    ),
    pie,
  );
}

// ─── Subida de archivos CSV / JSON ────────────────────────────────────────────
async function subir(tipo, e, msg, render) {
  const f = e.target.files[0];
  if (!f) return;
  const r = (tipo === 'orgs' ? leerOrgs : leerMesas)(await f.text());
  e.target.value = ''; // permite volver a elegir el mismo archivo

  if (tipo === 'mesas' && !r.err.length) {
    r.mesas.forEach(m => {
      const encontrados = S.geografia.filter(
        g => g.distrito.toLocaleLowerCase('es') === m.distrito.toLocaleLowerCase('es')
      );
      if (encontrados.length !== 1)
        r.err.push(`Código ${m.num}: el distrito «${m.distrito}» no existe o es ambiguo en Geografía.`);
      else m.distrito = encontrados[0].distrito;
    });
  }

  if (tipo === 'orgs' && !r.err.length) {
    CS.forEach(c => r.orgs[c].forEach(o => {
      if (!o.territorio) return;
      const opciones = c === 'distrito'
        ? S.geografia.filter(g => !g.capital).map(g => g.distrito)
        : territoriosDeCargo(c);
      const encontrado = opciones.find(t => t.toLocaleLowerCase('es') === o.territorio.toLocaleLowerCase('es'));
      if (!encontrado)
        r.err.push(`Organización ${c} ${o.n}: territorio «${o.territorio}» no disponible.`);
      else o.territorio = encontrado;
    }));
  }

  if (r.err.length) {
    msg.textContent =
      `No se cargó «${f.name}»:\n` +
      r.err.slice(0, 10).join('\n') +
      (r.err.length > 10 ? `\n…y ${r.err.length - 10} errores más` : '');
    return;
  }

  if (tipo === 'orgs') S.orgs = r.orgs; else S.mesas = r.mesas;
  const filas = tipo === 'orgs'
    ? CS.reduce((a, c) => a + r.orgs[c].length, 0)
    : r.mesas.length;
  S.archivos = { ...(S.archivos || {}), [tipo]: { nombre: f.name, filas, t: Date.now() } };
  await save();
  render();
}

// ─── Indicador del último archivo cargado ─────────────────────────────────────
const estadoArchivo = tipo => {
  const a = (S.archivos || {})[tipo];
  return h('p', { class: a ? 'ok' : 'nota' },
    a
      ? `✔ Último archivo: ${a.nombre} · ${a.filas} ${tipo === 'orgs' ? 'organizaciones' : 'mesas'} · ${fecha(a.t)}`
      : 'No se ha seleccionado ningún archivo'
  );
};

// ─── Selector de archivo y enlace de plantilla ────────────────────────────────
const selector = (tipo, msg, render) =>
  h('label', { class: 'boton' }, 'Elegir CSV o JSON',
    h('input', {
      type: 'file',
      accept: '.csv,.json,application/json,text/csv',
      hidden: true,
      onchange: e => subir(tipo, e, msg, render),
    })
  );

const plantillaLink = (t, nombre) =>
  h('a', {
    href: 'data:text/csv;charset=utf-8,' + encodeURIComponent('\uFEFF' + plantilla(t)),
    download: nombre,
  }, 'Descargar plantilla');

// ─── Pestañas de la vista Datos ───────────────────────────────────────────────
function pestañasDatos(render) {
  return h('div', { class: 'barra tabs-datos' },
    btn('Organizaciones y mesas', () => { datosVista = 'general';   render(); },
      { class: datosVista === 'general'   ? 'on' : '' }),
    btn('Geografía',              () => { datosVista = 'geografia'; render(); },
      { class: datosVista === 'geografia' ? 'on' : '' }),
  );
}

// ─── Subvista: edición de geografía ───────────────────────────────────────────
function editarGeografia(render) {
  const aviso       = h('pre', { class: 'msg' });
  const hayCapturas = hayVotos(S);
  const region   = h('input', { name: 'region',   required: true, value: 'Lambayeque' });
  const provincia = h('input', { name: 'provincia', required: true, value: 'Lambayeque' });
  const distrito  = h('input', { name: 'distrito',  required: true });
  const capital   = h('input', { name: 'capital', type: 'checkbox' });

  const form = h('form', { class: 'form', onsubmit: e => {
    e.preventDefault();
    const entrada = {
      region:   region.value.trim(),
      provincia: provincia.value.trim(),
      distrito:  distrito.value.trim(),
      capital:   capital.checked,
      codigos:   [],
    };
    const existente = S.geografia.find(
      g => g.region === entrada.region && g.provincia === entrada.provincia && g.distrito === entrada.distrito
    );
    if (S.geografia.some(
      g => g !== existente && g.distrito.toLocaleLowerCase('es') === entrada.distrito.toLocaleLowerCase('es')
    )) { aviso.textContent = 'El nombre de distrito debe ser único para deducir su territorio sin ambigüedad.'; return; }
    if (existente && hayCapturas && existente.capital !== entrada.capital) {
      aviso.textContent = 'Borra las capturas antes de cambiar si este distrito es capital.'; return;
    }
    if (existente) existente.capital = entrada.capital;
    else S.geografia.push(entrada);
    save(); render();
  } },
    campo('Región / departamento', region),
    campo('Provincia', provincia),
    campo('Distrito', distrito),
    h('label', {}, capital, ' Capital de provincia (no elige alcalde distrital)'),
    h('div', { class: 'acciones' }, h('button', { type: 'submit' }, 'Guardar distrito')),
    aviso,
  );

  // Cuenta de mesas por distrito en una sola pasada (evita O(distritos × mesas)).
  const mesasPorDistrito = new Map();
  S.mesas.forEach(m => mesasPorDistrito.set(m.distrito, (mesasPorDistrito.get(m.distrito) || 0) + 1));

  const filas = S.geografia.map(g =>
    h('tr', {},
      h('td', {}, g.region),
      h('td', {}, g.provincia),
      h('th', {}, g.distrito),
      h('td', {}, g.capital ? 'Sí' : 'No'),
      h('td', {}, String(mesasPorDistrito.get(g.distrito) || 0)),
    )
  );

  return h('div', {},
    h('p', { class: 'nota' },
      'Región → Provincia → Distrito → mesas. Los códigos se asignan en el catálogo; las capitales no participan en Alcalde Distrital.'
    ),
    form,
    h('div', { class: 'scroll' },
      h('table', { class: 'izq' },
        h('thead', {}, h('tr', {},
          ...['Región', 'Provincia', 'Distrito', 'Capital', 'Mesas'].map(t => h('th', {}, t))
        )),
        h('tbody', {}, ...filas),
      )
    ),
  );
}

// ─── Vista principal: Datos ───────────────────────────────────────────────────
// `render` es la función de re-renderizado de app.js, pasada como callback
// para evitar la importación circular app.js ↔ ui-datos.js.
export function datos(render) {
  const bloq  = hayVotos(S);
  const [msgO, msgM, msgA, msgB] = [0, 1, 2, 3].map(() => h('pre', { class: 'msg' }));
  const cuenta = CS.map(c => `${CARGOS[c]}: ${S.orgs[c].length}`).join(' · ');

  const carga = (titulo, tipo, msg, plantillaNombre) =>
    card(titulo,
      estadoArchivo(tipo),
      !bloq && h('div', { class: 'acciones' },
        selector(tipo, msg, render),
        plantillaLink(tipo, plantillaNombre),
      ),
      msg,
    );

  // Subvista Geografía
  if (datosVista === 'geografia')
    return h('section', {},
      h('h2', {}, 'Carga de datos'),
      pestañasDatos(render),
      editarGeografia(render),
    );

  // ── Formulario: agregar mesa ──────────────────────────────────────────────
  const formMesa = h('form', { class: 'form', onsubmit: e => {
    e.preventDefault();
    const f          = new FormData(e.target);
    const codigo     = String(f.get('num')).trim();
    const hab        = Number(f.get('hab'));
    const distMesa   = String(f.get('distrito')).trim();
    if (!/^\d{6}$/.test(codigo) || !Number.isInteger(hab) || hab < 1 || !distMesa)
      return void (msgA.textContent = 'Revisa: código de seis dígitos, distrito y electores hábiles son obligatorios.');
    if (S.mesas.some(m => String(m.num) === codigo))
      return void (msgA.textContent = 'Esa mesa ya existe.');
    S.mesas.push({ num: codigo, distrito: distMesa, local: String(f.get('local')).trim(), hab });
    S.mesas.sort((a, b) => String(a.num).localeCompare(String(b.num)));
    save(); render();
  } },
    campo('Código de mesa (6 dígitos)',
      h('input', { name: 'num', inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: 6, required: true }),
    ),
    campo('Distrito',
      h('select', { name: 'distrito', required: true },
        ...S.geografia.map(g => h('option', { value: g.distrito }, `${g.distrito} · ${g.provincia}`)),
      ),
    ),
    campo('Local de votación', h('input', { name: 'local' })),
    campo('Electores hábiles',
      h('input', { name: 'hab', type: 'number', min: 1, step: 1, required: true }),
    ),
    h('button', { type: 'submit' }, 'Agregar mesa'),
    msgA,
  );

  // ── Formulario: agregar organización ─────────────────────────────────────
  const opcionesTerritorioOrg = c => c === 'distrito'
    ? S.geografia.filter(g => !g.capital).map(g => ['distrito', g.distrito])
    : territoriosDeCargo(c).map(t => [c === 'region' ? 'region' : 'provincia', t]);

  const territorioOrg = h('select', { name: 'territorio', required: true },
    ...opcionesTerritorioOrg('distrito').map(([a, t]) =>
      h('option', { value: `${a}::${t}` }, `${a} · ${t}`)
    ),
  );
  const cargoOrg = h('select', { name: 'cargo',
    onchange: e => territorioOrg.replaceChildren(
      ...opcionesTerritorioOrg(e.target.value).map(([a, t]) =>
        h('option', { value: `${a}::${t}` }, `${a} · ${t}`)
      )
    ),
  }, ...CS.map(c => h('option', { value: c }, CARGOS[c])));

  const formOrg = h('form', { class: 'form', onsubmit: e => {
    e.preventDefault();
    const f   = new FormData(e.target);
    const c   = f.get('cargo');
    const n   = Number(f.get('n'));
    const nom = String(f.get('nombre')).trim();
    const [ambito, territorio] = String(f.get('territorio')).split('::');
    if (!Number.isInteger(n) || n < 1 || !nom)
      return void (msgB.textContent = 'Revisa: el número de orden debe ser un entero mayor que 0 y falta el nombre.');
    const ambitoEsperado = c === 'distrito' ? 'distrito' : c === 'region' ? 'region' : 'provincia';
    if (ambito !== ambitoEsperado || !territorio)
      return void (msgB.textContent = 'El territorio no corresponde al cargo elegido.');
    if (S.orgs[c].some(o => o.n === n && o.territorio === territorio))
      return void (msgB.textContent = 'Ese número de orden ya existe en ' + territorio + '.');
    S.orgs[c].push({ n, nombre: nom, cand: String(f.get('cand')).trim(), territorio });
    S.orgs[c].sort((a, b) => a.territorio.localeCompare(b.territorio) || a.n - b.n);
    save(); render();
  } },
    campo('Cargo', cargoOrg),
    campo('Ámbito y territorio', territorioOrg),
    campo('N.º de orden', h('input', { name: 'n', type: 'number', min: 1, step: 1, required: true })),
    campo('Organización', h('input', { name: 'nombre', required: true })),
    campo('Candidato principal', h('input', { name: 'cand' })),
    h('button', { type: 'submit' }, 'Agregar organización'),
    msgB,
  );

  // ── Edición en línea ──────────────────────────────────────────────────────
  const editarMesa = (m, prop, valor) => {
    if (bloq) return;
    if (prop === 'num'      && (!/^\d{6}$/.test(valor) || S.mesas.some(x => x !== m && String(x.num) === valor))) return render();
    if (prop === 'hab'      && (!Number.isInteger(Number(valor)) || Number(valor) < 1))                            return render();
    if (prop === 'distrito' && !S.geografia.some(g => g.distrito === valor))                                       return render();
    m[prop] = prop === 'hab' ? Number(valor) : valor;
    save(); render();
  };

  const editarOrg = (c, o, prop, valor) => {
    if (bloq) return;
    const nuevo = prop === 'n' ? Number(valor) : valor;
    if (prop === 'n' && (!Number.isInteger(nuevo) || nuevo < 1)) return render();
    if (prop === 'territorio' && nuevo && !(
      c === 'distrito'
        ? S.geografia.filter(g => !g.capital).some(g => g.distrito === nuevo)
        : territoriosDeCargo(c).includes(nuevo)
    )) return render();
    if ((prop === 'n' || prop === 'territorio') && S.orgs[c].some(x =>
      x !== o &&
      (prop === 'n' ? x.n === nuevo : x.territorio === nuevo) &&
      (prop === 'territorio' ? x.n === o.n : x.territorio === o.territorio)
    )) return render();
    o[prop] = nuevo;
    save(); render();
  };

  const quitar = f => !bloq && btn('✕', f, { 'aria-label': 'Quitar' });

  // ── Filas de las tablas (se crean solo para la página visible) ───────────
  const filaMesa = m =>
    h('tr', {},
      h('td', {}, h('input', {
        value: m.num, maxlength: 6, pattern: '[0-9]{6}', disabled: bloq,
        onchange: e => editarMesa(m, 'num', e.target.value),
      })),
      h('td', {}, h('select', { disabled: bloq, onchange: e => editarMesa(m, 'distrito', e.target.value) },
        !m.distrito && h('option', { value: '', selected: true }, 'Sin asignar'),
        ...S.geografia.map(g =>
          h('option', { value: g.distrito, selected: g.distrito === m.distrito }, g.distrito)
        ),
      )),
      h('td', {}, h('input', {
        value: m.local || '', disabled: bloq,
        onchange: e => editarMesa(m, 'local', e.target.value),
      })),
      h('td', {}, h('input', {
        type: 'number', min: 1, value: m.hab, disabled: bloq,
        onchange: e => editarMesa(m, 'hab', e.target.value),
      })),
      h('td', {}, quitar(() => { S.mesas = S.mesas.filter(x => x !== m); save(); render(); })),
    );

  const filaOrg = ({ c, o }) =>
    h('tr', {},
      h('td', {}, CARGOS[c]),
      h('td', {}, h('select', { disabled: bloq, onchange: e => editarOrg(c, o, 'territorio', e.target.value) },
        h('option', { value: '', selected: !o.territorio }, 'Plantilla heredada'),
        ...(c === 'distrito'
          ? S.geografia.filter(g => !g.capital).map(g => g.distrito)
          : territoriosDeCargo(c)
        ).map(t => h('option', { value: t, selected: t === o.territorio }, t)),
      )),
      h('td', {}, h('input', {
        type: 'number', min: 1, value: o.n, disabled: bloq,
        onchange: e => editarOrg(c, o, 'n', e.target.value),
      })),
      h('td', {}, h('input', {
        value: o.nombre, disabled: bloq,
        onchange: e => editarOrg(c, o, 'nombre', e.target.value),
      })),
      h('td', {}, h('input', {
        value: o.cand || '', disabled: bloq,
        onchange: e => editarOrg(c, o, 'cand', e.target.value),
      })),
      h('td', {}, quitar(() => { S.orgs[c] = S.orgs[c].filter(x => x !== o); save(); render(); })),
    );

  // ── Ensamblaje de la vista completa ──────────────────────────────────────
  return h('section', {},
    h('h2', {}, 'Carga de datos'),
    pestañasDatos(render),
    h('p', { class: 'nota' }, `Mesas: ${S.mesas.length} · Organizaciones → ${cuenta}`),
    h('div', { class: 'acciones' },
      btn('Cargar datos de prueba', () => {
        if ((S.mesas.length || bloq) && !confirm('Esto reemplaza todos los datos actuales. ¿Continuar?')) return;
        setEstado(datosPrueba()); asegurarGeografia(); save(); render();
      }),
      btn('Borrar votos', () => {
        if (confirm('¿Borrar todos los votos y cierres?')) { S.votos = {}; S.cerradas = {}; save(); render(); }
      }),
      btn('Borrar todo', () => {
        if (confirm('¿Borrar todos los datos?')) { setEstado(vacio()); save(); render(); }
      }),
    ),
    bloq && h('p', { class: 'nota' }, 'Hay votos registrados: para cambiar organizaciones o mesas, primero usa «Borrar votos».'),
    h('div', { class: 'grid' },
      carga('Organizaciones (CSV / JSON)', 'orgs',  msgO, 'plantilla-organizaciones.csv'),
      carga('Catálogo de mesas (CSV / JSON)', 'mesas', msgM, 'plantilla-mesas.csv'),
      !bloq && card('Agregar una mesa', formMesa),
      !bloq && card('Agregar una organización', formOrg),
    ),
    // Tabla de mesas cargadas (paginada y con búsqueda)
    card('Mesas cargadas',
      tablaPaginada({
        clave:       'mesas',
        placeholder: 'Buscar mesa por código, distrito o local…',
        claseTabla:  'tabla-admin mesas-admin',
        columnas:    ['Código', 'Distrito', 'Local', 'Electores', ''],
        items:       S.mesas,
        texto:       m => `${m.num} ${m.distrito || ''} ${m.local || ''}`,
        fila:        filaMesa,
      })
    ),
    // Tabla de organizaciones cargadas (paginada y con búsqueda)
    card('Organizaciones cargadas',
      tablaPaginada({
        clave:       'orgs',
        placeholder: 'Buscar organización por cargo, territorio, número, nombre o candidato…',
        claseTabla:  'tabla-admin organizaciones-admin',
        columnas:    ['Cargo', 'Territorio', 'N.º', 'Organización', 'Candidato', ''],
        items:       CS.flatMap(c => S.orgs[c].map(o => ({ c, o }))),
        texto:       ({ c, o }) => `${CARGOS[c]} ${o.territorio || ''} ${o.n} ${o.nombre} ${o.cand || ''}`,
        fila:        filaOrg,
      })
    ),
  );
}