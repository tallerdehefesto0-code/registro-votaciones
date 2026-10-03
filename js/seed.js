// Datos de prueba con mesas vinculadas a distritos; los cargos se deducen de la geografía.
import { CARGOS } from './calc.js';
export function datosPrueba() {
  const CG = Object.keys(CARGOS);
  const distritos = ['Lambayeque', 'Chóchope', 'Íllimo', 'Jayanca', 'Mochumí', 'Mórrope'];
  const s = {
    orgs: {}, mesas: [], votos: {}, cerradas: {}, log: [],
    geografia: distritos.map((distrito, i) => ({ region: 'Lambayeque', provincia: 'Lambayeque', distrito, capital: i === 0, codigos: [] })),
  };
  const base = [[100, 60, 20], [80, 70, 25], [90, 55, 40]];            // votos por organización, mesas 1 a 3
  const blanco = [8, 6, 3], nulo = [4, 3, 2], obs = [2, 1, 1];
  CG.forEach((c, ci) => {
    const nombres = c === 'distrito' ? distritos.slice(1) : [c === 'region' ? 'Lambayeque' : 'Lambayeque'];
    s.orgs[c] = nombres.flatMap(territorio => ['A', 'B', 'C'].map((l, i) => ({ n: i + 1, nombre: 'Organización ' + l, cand: 'Candidato ' + l, territorio })));
  });
  for (let i = 0; i < distritos.length; i++) {
    const num = String(i + 1).padStart(6, '0'), distrito = distritos[i];
    s.mesas.push({ num, distrito, local: 'I.E. ' + (10000 + i + 1), hab: 300 });
    if (i < 3) {
      const cargos = [...(i ? ['distrito'] : []), 'provincia', 'consejero', 'region'];
      cargos.forEach((c, ci) => {
        const territorio = c === 'distrito' ? distrito : c === 'region' ? 'Lambayeque' : 'Lambayeque';
        base[i].map((_, j) => base[i][(j + ci) % 3]).forEach((v, j) => { s.votos[`${c}|${num}|${territorio}::${j + 1}`] = v; });
        s.votos[`${c}|${num}|blanco`] = blanco[i];
        s.votos[`${c}|${num}|nulo`] = nulo[i];
        s.votos[`${c}|${num}|obs`] = obs[i];
      });
    }
  }
  s.cerradas['provincia|000001'] = true;
  s.log.push({ t: new Date().toISOString(), cargo: 'provincia', mesa: '000001', evento: 'Cierre (con observables, provisional)' });
  return s;
}
