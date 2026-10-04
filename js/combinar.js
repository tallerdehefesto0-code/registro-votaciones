// combinar.js — Une el avance de otro dispositivo con el estado local, sin pisar nada.
// Funciones puras: no tocan la pantalla ni el guardado. Quien las llame decide
// cuándo hacer save(), render() y registrarEvento().
//
// Entrada: el "estado" de un respaldo (el que devuelve leerRespaldo en informes.js):
//   { orgs, mesas, votos, cerradas, log, ... }
//
// Reglas:
//   • Lo que solo existe en uno de los lados se incorpora.
//   • Si el mismo dato existe en ambos con el mismo valor, no se hace nada.
//   • Si el mismo dato existe con valores distintos, NO se pisa: va a la lista de conflictos.
//   • Un cierre de mesa en cualquiera de los lados se conserva (se unen).

const ev = e => [e.t, e.cargo, e.mesa, e.evento, e.usuario || ''].join('|');

export function combinar(S, otro) {
  const r = { mesas: 0, orgs: 0, votos: 0, cerradas: 0, log: 0, conflictos: [] };

  // Mesas
  const porNum = new Map((S.mesas || []).map(m => [String(m.num), m]));
  (otro.mesas || []).forEach(m => {
    const n = String(m.num), mine = porNum.get(n);
    if (!mine) { const nueva = { ...m, num: n }; S.mesas.push(nueva); porNum.set(n, nueva); r.mesas++; return; }
    if (mine.distrito !== m.distrito)
      r.conflictos.push({ tipo: 'mesa-distrito', clave: n, actual: mine.distrito, nuevo: m.distrito });
    if (!(mine.hab > 0) && m.hab > 0) { mine.hab = m.hab; r.mesas++; }
    else if (mine.hab > 0 && m.hab > 0 && mine.hab !== m.hab)
      r.conflictos.push({ tipo: 'mesa-hab', clave: n, actual: mine.hab, nuevo: m.hab });
    if (!mine.local && m.local) mine.local = m.local;
  });

  // Organizaciones (clave: cargo + territorio + número)
  Object.keys(otro.orgs || {}).forEach(c => {
    S.orgs[c] ||= [];
    otro.orgs[c].forEach(o => {
      const mine = S.orgs[c].find(x => x.n === o.n && (x.territorio || '') === (o.territorio || ''));
      if (!mine) { S.orgs[c].push({ ...o }); r.orgs++; }
      else if (mine.nombre !== o.nombre && !/^Organización \d+$/.test(o.nombre))
        r.conflictos.push({ tipo: 'org-nombre', clave: `${c}|${o.territorio || ''}::${o.n}`, actual: mine.nombre, nuevo: o.nombre });
    });
    S.orgs[c].sort((a, b) => (a.territorio || '').localeCompare(b.territorio || '') || a.n - b.n);
  });

  // Votos
  Object.entries(otro.votos || {}).forEach(([k, v]) => {
    if (!(k in S.votos)) { S.votos[k] = v; r.votos++; }
    else if (S.votos[k] !== v) r.conflictos.push({ tipo: 'voto', clave: k, actual: S.votos[k], nuevo: v });
  });

  // Cierres
  Object.entries(otro.cerradas || {}).forEach(([k, v]) => {
    if (v && !S.cerradas[k]) { S.cerradas[k] = true; r.cerradas++; }
  });

  // Bitácora (sin duplicar eventos)
  const vistos = new Set((S.log || []).map(ev));
  (otro.log || []).forEach(e => { if (!vistos.has(ev(e))) { S.log.push(e); vistos.add(ev(e)); r.log++; } });
  S.log.sort((a, b) => String(a.t).localeCompare(String(b.t)));

  return r;
}

// Aplica la decisión sobre los conflictos de votos y de electores.
// elegirNuevo(conflicto) → true usa el valor del otro dispositivo; false conserva el local.
export function resolverConflictos(S, conflictos, elegirNuevo) {
  let cambiados = 0;
  conflictos.forEach(c => {
    if (!elegirNuevo(c)) return;
    if (c.tipo === 'voto')           { S.votos[c.clave] = c.nuevo; cambiados++; }
    else if (c.tipo === 'mesa-hab')  { const m = S.mesas.find(x => String(x.num) === c.clave); if (m) { m.hab = c.nuevo; cambiados++; } }
  });
  return cambiados;
}

// Texto corto para mostrar el resultado al usuario.
export function resumenCombinacion(r) {
  const partes = [`${r.mesas} mesas`, `${r.orgs} organizaciones`, `${r.votos} votos`, `${r.cerradas} cierres`, `${r.log} eventos`];
  return `Se incorporó: ${partes.join(', ')}. Conflictos: ${r.conflictos.length}.`;
}
