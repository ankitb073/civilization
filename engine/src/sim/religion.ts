// Religion and thought: ancestral pantheons, new movements (cults, universal religions, philosophies,
// sects, reform movements, ideologies), spread, state conversion, persecution, councils and schisms.
import type { State, Movement, Deity, Polity } from './state.ts';
import { event, ref, setReligion, alivePolity, addStress, topStress } from './state.ts';
import type { Geo } from './geo.ts';
import type { PolityAgg } from './polities.ts';
import { eraOf, has } from './tech.ts';
import { newPerson } from './people.ts';
import { Rng } from '../core/rng.ts';

export const DOMAINS: { concept: string; sex: 'm' | 'f' | 'x' }[] = [
  { concept: 'sky', sex: 'm' }, { concept: 'storm', sex: 'm' }, { concept: 'sun', sex: 'x' }, { concept: 'moon', sex: 'x' },
  { concept: 'earth', sex: 'f' }, { concept: 'river', sex: 'x' }, { concept: 'sea', sex: 'x' }, { concept: 'underworld', sex: 'x' },
  { concept: 'war', sex: 'x' }, { concept: 'wisdom', sex: 'x' }, { concept: 'grain', sex: 'f' }, { concept: 'fire', sex: 'x' },
];

/** Philosophies and ideologies live in cities, not in the cell religion layer. */
export interface ThoughtPresence {
  settlements: Map<number, Set<number>>; // movement -> settlements
}

export function makePantheon(s: State, culture: number, year: number, rng: Rng): Movement {
  const cu = s.cultures[culture];
  const id = s.movements.length;
  const m: Movement = {
    id, nameId: cu.nameId, kind: 'pantheon', parent: null, culture, founder: null, born: year, died: null,
    tenets: [-0.6 + rng.normal(0, 0.2), -0.8, 0.5 + rng.normal(0, 0.2), 0.4, -0.3, -0.8], originCell: cu.homeCell,
    foundEvent: null, deities: [], adherents: 0, cells: 0, peak: 0,
  };
  s.movements.push(m);
  const n = rng.int(5, 8);
  const doms = rng.sample(DOMAINS, n);
  // sky or storm always present (the head of the pantheon)
  if (!doms.some((d) => d.concept === 'sky' || d.concept === 'storm')) doms[0] = DOMAINS[rng.chance(0.5) ? 0 : 1];
  for (const d of doms) {
    const sex: 'm' | 'f' = d.sex === 'x' ? (rng.chance(0.5) ? 'm' : 'f') : d.sex;
    const did = s.deities.length;
    const nameId = s.lang.coinName(cu.lang, Math.max(year, s.lang.info(cu.lang).born), 'deity', `dei:${did}`, { meaning: [d.concept] });
    const dei: Deity = { id: did, nameId, culture, movement: id, domain: d.concept, sex, born: year };
    s.deities.push(dei);
    m.deities.push(did);
  }
  return m;
}

const RELIGIOUS = new Set(['pantheon', 'cult', 'religion', 'sect', 'reform']);

export function religionStep(s: State, geo: Geo, agg: PolityAgg, tp: ThoughtPresence, y0: number): void {
  const w = s.world;
  const rng = s.rng.fork('religion', y0);
  const yLog = Math.max(y0 + 9, s.lastLogYear.religion);

  // adherents
  for (const m of s.movements) { m.adherents = 0; m.cells = 0; }
  for (const c of geo.landCells) {
    const r = s.religion[c];
    if (r < 0) continue;
    s.movements[r].adherents += s.pop[c];
    s.movements[r].cells++;
  }
  for (const [mid, set] of tp.settlements) {
    const m = s.movements[mid];
    for (const sid of set) m.adherents += s.settlements[sid].pop * 0.1;
  }
  for (const m of s.movements) if (m.adherents > m.peak) m.peak = m.adherents;

  // founding new movements
  for (const p of s.polities) {
    if (!alivePolity(p, y0) || p.kind === 'rebel') continue;
    const era = eraOf(p);
    const urban = p.pop > 0 ? p.urbanPop / p.pop : 0;
    if (!has(p, 'writing') && era > 0) continue;
    const axial = y0 > 2250 && y0 < 2950 ? 2.2 : 1;
    const crisis = Math.min(2, p.stress.filter((x) => x.year > y0 - 40).reduce((a, x) => a + x.weight, 0) / 3);
    const pr = 0.0035 * (0.3 + urban * 6) * axial * (1 + crisis) * (era >= 5 ? 1.8 : 1);
    if (!rng.chance(pr)) continue;
    let kind: Movement['kind'];
    if (era === 0) kind = 'cult';
    else if (era <= 2) kind = rng.chance(0.5) ? 'philosophy' : 'religion';
    else if (era === 3) kind = rng.chance(0.6) ? 'sect' : rng.chance(0.5) ? 'religion' : 'philosophy';
    else if (era === 4) kind = rng.chance(0.5) ? 'reform' : 'philosophy';
    else kind = rng.chance(0.75) ? 'ideology' : 'philosophy';
    foundMovement(s, tp, p, kind, y0 + rng.int(0, 9), rng, crisis > 0.5 ? topStress(p, y0 + 9, 40, 1) : []);
  }

  // spread of religious movements in the cell layer
  const stateRel = new Int32Array(s.polities.length).fill(-1);
  for (const p of s.polities) if (alivePolity(p, y0)) stateRel[p.id] = p.religion;
  const attract = s.movements.map((m) => {
    if (!RELIGIOUS.has(m.kind) || m.died !== null) return 0;
    let a = m.kind === 'pantheon' ? 0.4 : m.kind === 'cult' ? 0.7 : m.kind === 'religion' ? 1.4 : 1.1;
    a *= 1 + 0.5 * m.tenets[5];
    if (y0 - m.born < 300) a *= 1.3;
    return a;
  });
  const changes: [number, number][] = [];
  for (const c of geo.landCells) {
    const cur = s.religion[c];
    if (!rng.chance(0.08)) continue;
    const o = s.owner[c];
    const counts = new Map<number, number>();
    for (const k of w.neighbors[c]) {
      const r = s.religion[k];
      if (r >= 0 && r !== cur) counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    if (o >= 0 && stateRel[o] >= 0 && stateRel[o] !== cur) counts.set(stateRel[o], (counts.get(stateRel[o]) ?? 0) + 2.5);
    if (counts.size === 0) continue;
    let best = -1, bw = 0;
    for (const [r, n] of counts) {
      const wgt = n * attract[r];
      if (wgt > bw || (wgt === bw && r < best)) { bw = wgt; best = r; }
    }
    if (best < 0) continue;
    const resist = cur >= 0 ? attract[cur] * (o >= 0 && stateRel[o] === cur ? 2.2 : 1) * 2.4 : 0.5;
    if (rng.chance(Math.min(0.6, (bw / (bw + resist)) * 0.55))) changes.push([c, best]);
  }
  for (const [c, r] of changes) setReligion(s, c, r, yLog, -1);

  // philosophies & ideologies spread between cities along trade routes
  for (const [mid, set] of tp.settlements) {
    const m = s.movements[mid];
    if (m.died !== null) continue;
    for (const [a, b] of s.activeRoutes) {
      if (set.has(a) && !set.has(b) && rng.chance(0.08)) set.add(b);
      else if (set.has(b) && !set.has(a) && rng.chance(0.08)) set.add(a);
    }
    for (const sid of [...set]) if (s.settlements[sid].abandoned !== null || rng.chance(0.015)) set.delete(sid);
    if (set.size === 0) {
      m.died = y0 + 9;
    }
  }

  // state conversion
  for (const p of s.polities) {
    if (!alivePolity(p, y0) || p.kind === 'rebel') continue;
    const cells = agg.cells.get(p.id) ?? [];
    if (cells.length === 0) continue;
    const share = new Map<number, number>();
    let tot = 0;
    for (const c of cells) {
      const r = s.religion[c];
      if (r < 0) continue;
      share.set(r, (share.get(r) ?? 0) + s.pop[c]);
      tot += s.pop[c];
    }
    if (tot <= 0) continue;
    let top = -1, tw = 0;
    for (const [r, v] of share) if (v > tw || (v === tw && r < top)) { tw = v; top = r; }
    if (top >= 0 && top !== p.religion && tw / tot > 0.42 && rng.chance(0.35)) convert(s, p, top, y0 + rng.int(0, 9), 'majority', rng);
    else if (rng.chance(0.004)) {
      // a ruler converts to a prestigious neighbour's universal faith
      const cand = s.movements.filter((m) => m.kind === 'religion' && m.died === null && m.adherents > 2_000_000 && m.id !== p.religion);
      if (cand.length) convert(s, p, rng.pick(cand).id, y0 + rng.int(0, 9), 'ruler', rng);
    }
    // persecution of a large minority by an intolerant establishment
    const est = s.movements[p.religion];
    if (est && est.tenets[2] > 0.25 && est.tenets[5] > 0.2) {
      for (const [r, v] of share) {
        if (r === p.religion) continue;
        const frac = v / tot;
        if (frac > 0.1 && frac < 0.45 && rng.chance(0.06)) {
          const year = y0 + rng.int(0, 9);
          const ev = event(s, 'persecution', year, { cell: s.settlements[p.capital].cell, parts: [[ref('pol', p.id), 'persecutor'], [ref('mov', r), 'persecuted'], [ref('mov', p.religion), 'establishment']], sig: 0.3 });
          addStress(p, year, ev.id, 0.7);
          p.stability = Math.max(0, p.stability - 0.06);
          for (const c of cells) if (s.religion[c] === r && rng.chance(0.3)) setReligion(s, c, p.religion, Math.max(yLog, s.lastLogYear.religion), ev.id);
          break;
        }
      }
    }
  }

  // councils and schisms in large old faiths
  for (const m of s.movements.slice()) {
    if (m.died !== null || (m.kind !== 'religion' && m.kind !== 'sect') || m.cells < 140 || y0 - m.born < 250) continue;
    const polities = new Set<number>();
    for (const c of geo.landCells) if (s.religion[c] === m.id && s.owner[c] >= 0) polities.add(s.owner[c]);
    if (polities.size < 3 || !rng.chance(0.03)) continue;
    schism(s, geo, m, [...polities], y0, rng);
  }

  // movement deaths
  for (const m of s.movements) {
    if (m.died !== null || !RELIGIOUS.has(m.kind)) continue;
    if (m.cells === 0 && y0 - m.born > 20 && !s.polities.some((p) => p.died === null && p.religion === m.id)) m.died = y0 + 9;
  }
}

function tenetsFor(kind: Movement['kind'], rng: Rng, parent?: Movement): number[] {
  if (parent) return parent.tenets.map((t, i) => Math.max(-1, Math.min(1, t + (rng.chance(0.4) || i === rng.int(0, 5) ? rng.normal(0, 0.7) : rng.normal(0, 0.1)))));
  const t = [0, 0, 0, 0, 0, 0].map(() => Math.max(-1, Math.min(1, rng.normal(0, 0.6))));
  if (kind === 'religion') { t[5] = Math.abs(t[5]) * 0.5 + 0.5; t[1] = Math.abs(t[1]) * 0.6 + 0.3; }
  if (kind === 'philosophy') { t[2] = -Math.abs(t[2]); }
  if (kind === 'cult') { t[5] = -Math.abs(t[5]); }
  return t.map((x) => Math.round(x * 100) / 100);
}

export function foundMovement(s: State, tp: ThoughtPresence, p: Polity, kind: Movement['kind'], year: number, rng: Rng, causes: number[], parent?: Movement): Movement {
  const id = s.movements.length;
  const cap = s.settlements[p.capital];
  const cities = s.settlements.filter((t) => t.abandoned === null && t.founded <= year && s.owner[t.cell] === p.id);
  const origin = cities.length ? rng.weighted(cities, cities.map((t) => t.pop)) : cap;
  const founderRole = kind === 'philosophy' ? 'philosopher' : kind === 'ideology' ? 'philosopher' : 'prophet';
  const founder = newPerson(s, { sex: rng.chance(kind === 'ideology' ? 0.2 : 0.12) ? 'f' : 'm', born: year - rng.int(28, 50), culture: s.culture[origin.cell] >= 0 ? s.culture[origin.cell] : p.culture, polity: p.id, key: `founder:mov:${id}`, adult: true, minDeath: year + 1 });
  const lang = s.cultures[founder.culture].lang;
  const nameId = s.lang.coinName(lang, year, 'movement', `mov:${id}`);
  const fixed = causes.filter((c) => s.events[c].year <= year);
  const ev = event(s, 'movement-founding', year, {
    cell: origin.cell,
    parts: [[ref('mov', id), 'movement'], [ref('per', founder.id), 'founder'], [ref('pol', p.id), 'polity'], [ref('set', origin.id), 'place'], ...(parent ? [[ref('mov', parent.id), 'parent'] as [string, string]] : [])],
    causes: fixed, data: { kind }, sig: kind === 'religion' ? 0.6 : kind === 'ideology' ? 0.45 : 0.35,
  });
  const m: Movement = {
    id, nameId, kind, parent: parent ? parent.id : null, culture: founder.culture, founder: founder.id, born: year, died: null,
    tenets: tenetsFor(kind, rng, parent), originCell: origin.cell, foundEvent: ev.id, deities: [], adherents: 0, cells: 0, peak: 0,
  };
  s.movements.push(m);
  founder.roles.push({ role: founderRole, polity: p.id, start: year, end: null, event: ev.id, ref: ref('mov', id) });
  if (RELIGIOUS.has(kind)) {
    const yLog = Math.max(year, s.lastLogYear.religion);
    setReligion(s, origin.cell, id, yLog, ev.id);
    for (const k of s.world.neighbors[origin.cell]) if (s.world.land[k] && rng.chance(0.5)) setReligion(s, k, id, yLog, ev.id);
  } else {
    tp.settlements.set(id, new Set([origin.id]));
  }
  return m;
}

function convert(s: State, p: Polity, movement: number, year: number, reason: string, rng: Rng): void {
  const m = s.movements[movement];
  if (m.born > year) return;
  const parts: [string, string][] = [[ref('pol', p.id), 'polity'], [ref('mov', movement), 'adopted'], [ref('mov', p.religion), 'abandoned']];
  if (p.ruler !== null) parts.push([ref('per', p.ruler), 'ruler']);
  event(s, 'conversion', year, { cell: s.settlements[p.capital].cell, parts, data: { reason }, sig: m.kind === 'religion' ? 0.4 : 0.2 });
  p.religion = movement;
  void rng;
}

function schism(s: State, geo: Geo, m: Movement, polities: number[], y0: number, rng: Rng): void {
  // the polity farthest from the movement's origin breaks away
  const ox = s.world.x[m.originCell], oy = s.world.y[m.originCell];
  const cand = polities.map((pid) => s.polities[pid]).filter((p) => alivePolity(p, y0) && p.kind !== 'rebel');
  if (cand.length === 0) return;
  const far = cand.sort((a, b) => {
    const ca = s.settlements[a.capital].cell, cb = s.settlements[b.capital].cell;
    return Math.hypot(s.world.x[cb] - ox, s.world.y[cb] - oy) - Math.hypot(s.world.x[ca] - ox, s.world.y[ca] - oy) || a.id - b.id;
  })[0];
  let year = y0 + rng.int(0, 7);
  const causes: number[] = [];
  if (rng.chance(0.6)) {
    const host = cand[cand.length - 1];
    const council = event(s, 'council', year, {
      cell: s.settlements[host.capital].cell,
      parts: [[ref('mov', m.id), 'movement'], [ref('pol', host.id), 'host'], [ref('pol', far.id), 'dissenters']],
      data: { outcome: 'failed' }, sig: 0.3,
    });
    causes.push(council.id);
    year = Math.min(y0 + 9, year + rng.int(1, 2));
  }
  const kind = eraOf(far) >= 4 ? 'reform' : 'sect';
  const child = foundMovement(s, { settlements: new Map() }, far, kind, year, rng, causes, m);
  const ev = s.events[child.foundEvent!];
  ev.sub = 'schism';
  ev.sig = 0.5;
  const yLog = Math.max(y0 + 9, s.lastLogYear.religion);
  for (const c of geo.landCells) if (s.owner[c] === far.id && s.religion[c] === m.id && rng.chance(0.85)) setReligion(s, c, child.id, yLog, ev.id);
  if (far.religion === m.id) far.religion = child.id;
}
