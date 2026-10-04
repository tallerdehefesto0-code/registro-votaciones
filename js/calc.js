// Cálculos y validaciones: funciones puras, sin pantalla (se pueden probar solas).
export const CARGOS = { distrito: 'Distrito', provincia: 'Provincia', consejero: 'Consejero regional', region: 'Región' };
export const OTROS = { blanco: 'Votos en blanco', nulo: 'Votos nulos (viciados)', obs: 'Votos observables' };

export const key = (cargo, mesa, x) => `${cargo}|${mesa}|${x}`;           // x = n.º de organización o blanco/nulo/obs
export const claveOrg = o => o.territorio ? `${o.territorio}::${o.n}` : o.n;
export const pct = (a, b) => (b > 0 ? (100 * a / b).toFixed(2) + '%' : '—');
export const hayVotos = s => Object.keys(s.votos).length > 0;
const distritoDe = (s, mesa) => (s.geografia || []).find(g => g.distrito === mesa.distrito);
export const territorioDeMesa = (s, cargo, mesa) => {
  const geo = distritoDe(s, mesa);
  if (!geo) return '';
  return cargo === 'distrito' ? geo.distrito
    : cargo === 'provincia' || cargo === 'consejero' ? geo.provincia : geo.region;
};
export const cargosDeMesa = (s, mesa) => {
  const geo = distritoDe(s, mesa);
  if (!geo) return [];
  return [...(!geo.capital ? ['distrito'] : []), 'provincia', 'consejero', 'region'];
};
export const orgsDe = (s, cargo, territorio = '') => (s.orgs[cargo] || []).filter(o =>
  !o.territorio || !territorio || o.territorio === territorio);
export const mesasDe = (s, cargo, territorio = '') => (s.mesas || []).filter(m =>
  cargosDeMesa(s, m).includes(cargo) && (!territorio || territorioDeMesa(s, cargo, m) === territorio));
const orgsDeMesa = (s, cargo, mesa) => orgsDe(s, cargo, territorioDeMesa(s, cargo, mesa));

// Todo lo que se calcula de una mesa en un cargo (reglas 2, 3, 4 y 5 de la sección 4.4)
export function datosMesa(s, cargo, mesa) {
  const orgs = orgsDeMesa(s, cargo, mesa);
  const v = x => s.votos[key(cargo, mesa.num, x)];
  const celdas = [...orgs.map(o => v(claveOrg(o))), v('blanco'), v('nulo'), v('obs')];
  const orgsSum = orgs.reduce((a, o) => a + (v(claveOrg(o)) || 0), 0);
  const blanco = v('blanco') || 0, nulo = v('nulo') || 0, obs = v('obs') || 0;
  const total = orgsSum + blanco + nulo + obs;                              // Total por mesa
  const omisos = mesa.hab > 0 ? mesa.hab - total : null;                    // Omisos (calculado)
  const llenas = celdas.filter(x => x !== undefined).length;
  const completo = llenas === celdas.length;
  const cuadra = omisos !== null && omisos >= 0;                            // requiere padrón para validar el cuadre
  const estado = s.cerradas[cargo + '|' + mesa.num] ? 'Cerrada'
    : llenas === 0 ? 'Pendiente' : completo && cuadra ? 'Cuadrada' : 'En registro';
  return { orgsSum, blanco, nulo, obs, total, hab: mesa.hab, omisos: llenas > 0 ? omisos : null, completo, cuadra, estado };
}

// Totales de un cargo sumando todas sus mesas
export function resumenCargo(s, cargo, territorio = '') {
  const ms = mesasDe(s, cargo, territorio), orgs = orgsDe(s, cargo, territorio);
  const suma = x => ms.reduce((a, m) => a + (s.votos[key(cargo, m.num, x)] || 0), 0);
  const porOrg = orgs.map(o => ({ o, votos: suma(claveOrg(o)) }));
  const validos = porOrg.reduce((a, p) => a + p.votos, 0);
  const blanco = suma('blanco'), nulo = suma('nulo'), obs = suma('obs');
  const ds = ms.map(m => datosMesa(s, cargo, m));
  return {
    nMesas: ms.length, cerradas: ds.filter(d => d.estado === 'Cerrada').length,
    hab: ms.reduce((a, m) => a + m.hab, 0), porOrg, validos, blanco, nulo, obs,
    total: validos + blanco + nulo + obs,
    omisos: ds.reduce((a, d) => a + (d.omisos ?? 0), 0),   // solo mesas con datos
    provisional: ds.some(d => d.estado === 'Cerrada' && d.obs > 0),
  };
}

export const mesaCerradaEnAlgunCargo = (s, mesa) =>
  cargosDeMesa(s, mesa).some(c => !!s.cerradas?.[c + '|' + mesa.num]);

// Regla 6: aviso (no bloqueo) si el Total por mesa difiere entre cargos ya completos. Devuelve [[cargo,total],...] o null
export function avisoMesa(s, mesa) {
  const t = cargosDeMesa(s, mesa).map(c => [c, datosMesa(s, c, mesa)]).filter(([, d]) => d.completo).map(([c, d]) => [c, d.total]);
  return new Set(t.map(x => x[1])).size > 1 ? t : null;
}

// Máximo que admite una casilla sin pasar de los electores hábiles de la mesa
export const maxCelda = (s, cargo, mesa, x) => mesa.hab > 0
  ? mesa.hab - (datosMesa(s, cargo, mesa).total - (s.votos[key(cargo, mesa.num, x)] || 0))
  : Number.MAX_SAFE_INTEGER;

  // Mayor total de votos ya registrado en la mesa entre sus cargos: es el piso de los electores hábiles
export const mayorTotalMesa = (s, mesa) =>
  Math.max(0, ...cargosDeMesa(s, mesa).map(c => datosMesa(s, c, mesa).total || 0));

// Motivo de rechazo de un valor de electores hábiles, o null si es válido
export function errorHab(s, mesa, v) {
  if (!Number.isInteger(v) || v < 1) return 'Los electores hábiles deben ser un entero mayor que 0.';
  const piso = mayorTotalMesa(s, mesa);
  if (v < piso) return `No puede ser menor que los votos ya registrados en la mesa (${piso}).`;
  return null;
}