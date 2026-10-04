// state.js — Única fuente de la verdad para el estado global de la aplicación.
//
// PROBLEMA DE REASIGNACIÓN EN ES MODULES:
//   Los módulos ES exportan enlaces vivos (live bindings) en modo lectura.
//   Si exportáramos `export let S = ...`, los importadores verían el valor
//   actualizado al leerlo, pero NO podrían escribir `S = nuevo` desde fuera.
//   Para mutarlo legalmente se usa un objeto contenedor: todos los módulos
//   importan `st` y leen `st.S`. Cuando necesitamos reemplazar el estado
//   completo (restaurar respaldo, datos de prueba, borrar todo) llamamos a
//   `setEstado(nuevo)`, que muta `st.S` in-place y garantiza que todos los
//   importadores ven el nuevo valor sin romper ningún enlace.
//
// USO:
//   import { st, setEstado, vacio, save, asegurarGeografia } from './state.js';
//   // Leer:  st.S.mesas
//   // Mutar: st.S.votos[k] = v  ← mutación directa de propiedades, siempre OK
//   // Reemplazar completo: setEstado(nuevo)

import { guardar } from './db.js';
import { usuarioActual } from './auth.js';

// ─── Catálogo geográfico base (editar aquí para añadir provincias/distritos) ─
export const geoData = [
  {
    region: 'LAMBAYEQUE',
    provincias: [
      {
        nombre: 'LAMBAYEQUE',
        distritos: [
          'LAMBAYEQUE', 'CHOCHOPE', 'ILLIMO', 'JAYANCA', 'MOCHUMI',
          'MORROPE', 'MOTUPE', 'OLMOS', 'PACORA', 'SALAS',
          'SAN JOSE', 'TUCUME',
        ],
      },
      {
        nombre: 'FERREÑAFE',
        distritos: [
          'FERREÑAFE', 'CAÑARIS', 'INCAHUASI', 'MANUEL ANTONIO',
          'PITIPO', 'PUEBLO NUEVO',
        ],
      },
      { 
        nombre: 'CHICLAYO', 
        distritos: [
          'CHICLAYO', 'CAYALTI', 'CHONGOYAPE', 'ETEN', 'ETEN PUERTO', 
          'JOSE LEONARDO ORTIZ', 'LA VICTORIA', 'LAGUNAS', 'MONSEFU', 
          'NUEVA ARICA', 'OYOTUN', 'PATAPO', 'PICSI', 'PIMENTEL', 
          'POMALCA', 'PUCALA', 'REQUE', 'SANTA ROSA', 'SAÑA', 'TUMAN'
        ] 
      },
    ],
  },
];

export const geografiaInicial = () =>
  geoData.flatMap(r =>
    r.provincias.flatMap(p =>
      p.distritos.map(distrito => ({
        region: r.region,
        provincia: p.nombre,
        distrito,
        capital: distrito === p.nombre,
        codigos: [],
      }))
    )
  );

// ─── Estado vacío ─────────────────────────────────────────────────────────────
export const vacio = () => ({
  orgs: { distrito: [], provincia: [], region: [], consejero: [] },
  mesas: [],
  votos: {},
  cerradas: {},
  log: [],
  geografia: geografiaInicial(),
});

// ─── Contenedor del estado global ────────────────────────────────────────────
// Todos los módulos importan `st` y acceden a `st.S`.
// Nunca reasignes `st` — solo lee y muta `st.S`.
export const st = { S: vacio() };

// ─── Setter seguro para reemplazos completos ──────────────────────────────────
// Úsalo cuando necesites: restaurar respaldo, cargar datos de prueba, borrar todo.
// No uses `st.S = nuevo` directamente desde los módulos consumidores.
export function setEstado(nuevo) {
  st.S = nuevo;
}

// ─── Persistencia ─────────────────────────────────────────────────────────────
export const save = () => guardar(st.S);

// Único punto de entrada para escribir en la bitácora: añade fecha y usuario.
export function registrarEvento(cargo, mesa, evento) {
  const u = usuarioActual();
  st.S.log.push({
    t: new Date().toISOString(),
    cargo, mesa, evento,
    usuario: u ? u.email : 'sin sesión',
  });
}

// ─── Normalización de geografía y renumeración de mesas ──────────────────────
// Garantiza que la geografía almacenada esté alineada con geoData y que todos
// los códigos de mesa tengan exactamente 6 dígitos.
export function asegurarGeografia() {
  const S = st.S;
  const anterior = Array.isArray(S.geografia) ? S.geografia : [];
  const base = geografiaInicial();
  const mesas = Array.isArray(S.mesas) ? S.mesas : [];
  const votos = Object.keys(S.votos || {});
  const organizaciones = Object.values(S.orgs || {}).flatMap(xs => Array.isArray(xs) ? xs : []);
  const normalizarCodigo = n => {
    const texto = String(n);
    return /^\d{1,6}$/.test(texto) ? texto.padStart(6, '0') : texto;
  };
  const coincideCodigo = (a, b) =>
    String(a) === String(b) || normalizarCodigo(a) === normalizarCodigo(b);
  const geosConocidas = [...base, ...anterior];
  const mesaApuntaAGeo = (m, g) =>
    m.distrito === g.distrito ||
    String(m.local || '').startsWith(g.distrito + ' · ') ||
    (Array.isArray(g.codigos) && g.codigos.some(c => coincideCodigo(c, m.num)));
  const hayVotosSinUbicacion = votos.some(clave => {
    const codigo = clave.split('|')[1];
    const mesa = mesas.find(m => coincideCodigo(m.num, codigo));
    return !mesa || !geosConocidas.some(g => mesaApuntaAGeo(mesa, g));
  });
  const tieneReferencia = g =>
    hayVotosSinUbicacion ||
    mesas.some(m => mesaApuntaAGeo(m, g)) ||
    organizaciones.some(o => [g.distrito, g.provincia, g.region].includes(o.territorio));

  S.geografia = [
    ...base.map(g => ({
      ...g,
      ...anterior.find(
        x => x.region === g.region && x.provincia === g.provincia && x.distrito === g.distrito
      ),
    })),
    ...anterior.filter(
      x => !base.some(
        g => g.region === x.region && g.provincia === x.provincia && g.distrito === x.distrito
      ) && tieneReferencia(x)
    ),
  ]
    .filter(g => g.region && g.provincia && g.distrito)
    .map(g => ({
      ...g,
      capital: !!g.capital,
      codigos: Array.isArray(g.codigos) ? g.codigos.filter(c => /^\d{6}$/.test(c)) : [],
    }));

  // Renumerar códigos de mesa al formato de 6 dígitos
  const renumerar = {};
  S.mesas.forEach(m => {
    const original = String(m.num);
    const codigo = /^\d{1,6}$/.test(original) ? original.padStart(6, '0') : original;
    if (/^\d{6}$/.test(codigo)) {
      renumerar[original] = codigo;
      m.num = codigo;
      if (!m.distrito) {
        const asignados = S.geografia.filter(
          g =>
            g.codigos.includes(codigo) ||
            g.codigos.includes(original) ||
            String(m.local || '').startsWith(g.distrito + ' · ')
        );
        if (asignados.length === 1) m.distrito = asignados[0].distrito;
      }
    }
  });

  // Propagar renumeración a votos, cerradas y log
  if (Object.keys(renumerar).some(n => n !== renumerar[n])) {
    S.votos = Object.fromEntries(
      Object.entries(S.votos).map(([k, v]) => {
        const [c, n, ...x] = k.split('|');
        return [`${c}|${renumerar[n] || n}|${x.join('|')}`, v];
      })
    );
    S.cerradas = Object.fromEntries(
      Object.entries(S.cerradas).map(([k, v]) => {
        const [c, n] = k.split('|');
        return [`${c}|${renumerar[n] || n}`, v];
      })
    );
    S.log.forEach(e => { e.mesa = renumerar[String(e.mesa)] || e.mesa; });
  }
}
