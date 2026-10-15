// The Age of Contact: first contact between landmasses, virgin-soil epidemics, overseas
// colonization and colonial wars.
import type { State, Polity } from './state.ts';
import { event, ref, setOwner, alivePolity, addStress } from './state.ts';
import { Rng } from '../core/rng.ts';
import { TK, eraOf, seaRange, has } from './tech.ts';
import { foundSettlement } from './settlements.ts';
import { startWar, atWar } from './war.ts';
import { RES } from '../world/biomes.ts';

export interface ContactMemory {
  pairs: Set<string>; // landmass pairs already in contact
}

export function initContact(): ContactMemory {
  return { pairs: new Set() };
}

/** Decadal: detect first contact across the sea along new trade routes; spread a virgin-soil epidemic. */
export function contactStep(s: State, mem: ContactMemory, y0: number): void {
  const w = s.world;
  const rng = s.rng.fork('contact', y0);
  for (const [a, b] of s.activeRoutes) {
    const ta = s.settlements[a], tb = s.settlements[b];
    const la = w.landmass[ta.cell], lb = w.landmass[tb.cell];
    if (la === lb || w.landmassSize[la] < 60 || w.landmassSize[lb] < 60) continue;
    const key = la < lb ? `${la}:${lb}` : `${lb}:${la}`;
    if (mem.pairs.has(key)) continue;
    mem.pairs.add(key);
    const year = y0 + rng.int(0, 9);
    const pa = s.owner[ta.cell], pb = s.owner[tb.cell];
    const parts: [string, string][] = [[ref('set', a), 'port'], [ref('set', b), 'port']];
    if (pa >= 0) parts.push([ref('pol', pa), 'party']);
    if (pb >= 0) parts.push([ref('pol', pb), 'party']);
    const continents = w.landmassSize[la] > 300 && w.landmassSize[lb] > 300;
    const ev = event(s, 'first-contact', year, { cell: tb.cell, parts, data: { landmasses: [la, lb], continents }, sig: continents ? 0.9 : 0.5 });
    // the less-connected side suffers a virgin-soil epidemic
    const devA = pa >= 0 ? s.polities[pa].techs.size : 0;
    const devB = pb >= 0 ? s.polities[pb].techs.size : 0;
    const victim = devA < devB ? ta : tb;
    if (rng.chance(0.8)) epidemic(s, victim.id, Math.min(y0 + 9, year + rng.int(0, 6)), 0.3 + rng.next() * 0.25, 8, [ev.id], rng);
  }
}

export function epidemic(s: State, originSettlement: number, year: number, mortality: number, maxDepth: number, causes: number[], rng: Rng): void {
  const adj = new Map<number, number[]>();
  for (const [a, b] of s.activeRoutes) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  const lm = s.world.landmass[s.settlements[originSettlement].cell];
  const depth = new Map<number, number>([[originSettlement, 0]]);
  let frontier = [originSettlement];
  for (let d = 1; d <= maxDepth; d++) {
    const next: number[] = [];
    for (const f of frontier) for (const k of adj.get(f) ?? []) {
      if (depth.has(k) || s.world.landmass[s.settlements[k].cell] !== lm) continue;
      if (rng.chance(0.85)) { depth.set(k, d); next.push(k); }
    }
    frontier = next;
  }
  let deaths = 0;
  const pols = new Set<number>();
  for (const [sid, d] of depth) {
    const t = s.settlements[sid];
    const m = mortality * Math.pow(0.92, d);
    for (const c of [t.cell, ...s.world.neighbors[t.cell]]) {
      if (!s.world.land[c]) continue;
      // the disease outruns the trade routes into the countryside
      const ring = [c, ...s.world.neighbors[c]];
      for (const r of ring) {
        if (!s.world.land[r]) continue;
        deaths += s.pop[r] * m * 0.5;
        s.pop[r] *= 1 - m * 0.5;
      }
      if (s.owner[c] >= 0) pols.add(s.owner[c]);
    }
  }
  const parts: [string, string][] = [[ref('set', originSettlement), 'origin']];
  for (const sid of depth.keys()) if (sid !== originSettlement) parts.push([ref('set', sid), 'stricken']);
  for (const p of pols) parts.push([ref('pol', p), 'stricken']);
  const fixed = causes.filter((c) => s.events[c].year <= year);
  const ev = event(s, 'plague', year, {
    cell: s.settlements[originSettlement].cell, parts, causes: fixed,
    data: { deaths: Math.round(deaths), mortality: Math.round(mortality * 100) / 100, reach: depth.size, virginSoil: true },
    sig: Math.min(0.95, 0.5 + deaths / 4_000_000), end: year + rng.int(5, 25),
  });
  for (const pid of pols) {
    const p = s.polities[pid];
    if (!alivePolity(p, year)) continue;
    p.stability = Math.max(0, p.stability - 0.18);
    addStress(p, year, ev.id, 2.5);
  }
}

/** Yearly: navigating states plant colonies overseas or make war on weaker overseas states. */
export function colonizeYear(s: State, year: number, rng: Rng): void {
  const w = s.world;
  for (const p of s.polities) {
    if (!alivePolity(p, year) || p.kind === 'rebel') continue;
    const nav = p.techs.get(TK.navigation);
    if (nav === undefined || nav > year || eraOf(p) < 4) continue;
    if (p.stability < 0.3 || p.treasury < 0 || atWar(s, p.id).length > 1) continue;
    if (!rng.chance(0.014)) continue;
    const capCell = s.settlements[p.capital].cell;
    const ports = s.settlements.filter((t) => t.port && t.abandoned === null && t.founded <= year && s.owner[t.cell] === p.id);
    if (!ports.length) continue;
    const range = seaRange(p);
    let best = -1, bestScore = 0;
    for (let c = 0; c < w.n; c++) {
      if (!w.land[c] || !w.coastal[c]) continue;
      const overseas = w.landmass[c] !== w.landmass[capCell];
      const far = Math.hypot(w.x[c] - w.x[capCell], w.y[c] - w.y[capCell]);
      if (!overseas && far < 700) continue;
      let near = Infinity;
      for (const t of ports) near = Math.min(near, Math.hypot(w.x[c] - w.x[t.cell], w.y[c] - w.y[t.cell]));
      if (near > range) continue;
      const o = s.owner[c];
      if (o === p.id) continue;
      if (o >= 0) {
        const q = s.polities[o];
        if (eraOf(q) >= eraOf(p) || q.cells > p.cells) continue;
      }
      let score = (s.cap[c] + 20000) / (near + 200);
      if (w.resources[c] & (RES.silver | RES.gold | RES.spice)) score *= 2.5;
      if (o >= 0) score *= 0.6;
      score *= 0.8 + rng.next() * 0.4;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best < 0) continue;
    const o = s.owner[best];
    if (o >= 0) {
      const q = s.polities[o];
      const ev = event(s, 'colonial-claim', year, { cell: best, parts: [[ref('pol', p.id), 'claimant'], [ref('pol', q.id), 'target']], sig: 0.3 });
      startWar(s, year, [p.id], [q.id], 'colonial', w.region[best], [ev.id], rng);
      continue;
    }
    if (s.settlementAt[best] >= 0) continue;
    const local = s.culture[best] >= 0 ? s.culture[best] : p.culture;
    const ev = event(s, 'colonization', year, { cell: best, parts: [[ref('pol', p.id), 'colonizer'], [ref('reg', w.region[best]), 'region']], data: { overseas: w.landmass[best] !== w.landmass[capCell] }, sig: 0.45 });
    const t = foundSettlement(s, best, year, local, { polity: p.id, nameCulture: p.culture, causes: [ev.id], sig: 0.25, key: `colony:${p.id}:${year}` });
    ev.parts.push([ref('set', t.id), 'colony']);
    setOwner(s, best, p.id, year, ev.id);
    for (const k of w.neighbors[best]) if (w.land[k] && s.owner[k] < 0) setOwner(s, k, p.id, year, ev.id);
    p.treasury -= p.pop * 0.0005;
    void has;
  }
}

export function isOverseas(s: State, p: Polity, cell: number): boolean {
  return s.world.landmass[cell] !== s.world.landmass[s.settlements[p.capital].cell];
}
