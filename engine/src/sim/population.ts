// Population: carrying capacity, growth, famine, plague, migration.
import type { State, Polity } from './state.ts';
import { event, ref, addStress, setCulture, alivePolity } from './state.ts';
import { BIOME, BIOMES } from '../world/biomes.ts';
import { agriMult, irrigationMult, forestWorkable, eraOf, GROWTH } from './tech.ts';
import { activeAnomalyAt } from './climate.ts';
import type { Geo } from './geo.ts';
import { majority } from './geo.ts';

export interface PopMemory {
  lastFamine: Int32Array; // per region
  recentBattles: { year: number; cell: number; event: number }[];
}

export function initPopMemory(s: State): PopMemory {
  return { lastFamine: new Int32Array(s.world.regionCount).fill(-1000), recentBattles: [] };
}

const HEAVY = new Set<number>([BIOME.temperateForest, BIOME.taiga, BIOME.tropicalForest, BIOME.steppe]);

export function capacity(s: State, i: number, p: Polity | null): number {
  const w = s.world;
  const b = w.biome[i];
  const work = HEAVY.has(b) ? forestWorkable(p) : 1;
  const river = w.flux[i] > w.riverThreshold ? irrigationMult(p) : 1;
  const density = BIOMES[b].capacity + w.fertility[i] * 14 * river * work;
  return w.cellArea * density * agriMult(p);
}

export function populationStep(s: State, geo: Geo, mem: PopMemory, y0: number): void {
  const w = s.world;
  const rng = s.rng.fork('population', y0);
  const regionLoss = new Float64Array(w.regionCount);
  const regionPop = new Float64Array(w.regionCount);
  for (const i of geo.landCells) {
    const o = s.owner[i];
    const p = o >= 0 ? s.polities[o] : null;
    const K = capacity(s, i, p) * s.yieldF[i] * (1 - 0.6 * s.devast[i]);
    s.cap[i] = K;
    const era = p ? eraOf(p) : 0;
    const r = GROWTH[era] * 10;
    let pop = s.pop[i];
    if (pop <= 0) pop = K * 0.02;
    if (pop > K) {
      const excess = pop - K;
      const lost = excess * 0.6;
      pop -= lost;
      regionLoss[w.region[i]] += lost;
    } else {
      pop += r * pop * (1 - pop / Math.max(1, K)) * 1.6;
    }
    s.pop[i] = Math.max(0, pop);
    regionPop[w.region[i]] += s.pop[i];
    s.devast[i] *= 0.5;
  }

  // famines
  for (let r = 0; r < w.regionCount; r++) {
    const total = regionPop[r] + regionLoss[r];
    if (total < 20_000) continue;
    const frac = regionLoss[r] / total;
    if (frac < 0.07 || y0 - mem.lastFamine[r] < 30) continue;
    mem.lastFamine[r] = y0;
    const cells = geo.regionCells[r];
    const label = w.regionLabelCell[r];
    const anomaly = activeAnomalyAt(s, label, y0);
    const causes: number[] = [];
    if (anomaly) causes.push(anomaly.event);
    for (const b of mem.recentBattles) if (b.year >= y0 - 10 && w.region[b.cell] === r) { causes.push(b.event); break; }
    let year = y0 + rng.int(0, 9);
    for (const c of causes) year = Math.max(year, s.events[c].year);
    if (year > y0 + 9) year = y0 + 9;
    const owner = majority(s.owner, cells, s.pop);
    const parts: [string, string][] = [[ref('reg', r), 'region']];
    if (owner >= 0) parts.push([ref('pol', owner), 'stricken']);
    if (anomaly) parts.push([ref('cli', anomaly.id), 'anomaly']);
    const deaths = Math.round(regionLoss[r]);
    const ev = event(s, 'famine', year, { cell: label, parts, causes, data: { deaths, fraction: Math.round(frac * 100) / 100 }, sig: Math.min(0.7, 0.15 + frac * 2), end: year + rng.int(1, 4) });
    if (owner >= 0) {
      const p = s.polities[owner];
      p.stability = Math.max(0, p.stability - Math.min(0.25, frac * 1.2));
      addStress(p, year, ev.id, frac * 3);
    }
    // pastoral peoples under famine may migrate
    const cul = majority(s.culture, cells, s.pop);
    if (cul >= 0 && s.cultures[cul].pastoral && frac > 0.1 && rng.chance(0.45)) migrate(s, geo, cul, r, ev.id, year, rng);
  }
  mem.recentBattles = mem.recentBattles.filter((b) => b.year >= y0 - 10);
}

function migrate(s: State, geo: Geo, culture: number, fromRegion: number, cause: number, year: number, rng: import('../core/rng.ts').Rng): void {
  const w = s.world;
  // candidate neighbouring regions with spare capacity
  const adj = new Map<number, number>();
  for (const c of geo.regionCells[fromRegion]) for (const k of w.neighbors[c]) {
    const r = w.region[k];
    if (r >= 0 && r !== fromRegion) adj.set(r, (adj.get(r) ?? 0) + 1);
  }
  let best = -1, bestScore = 0;
  for (const r of adj.keys()) {
    let cap = 0, pop = 0;
    for (const c of geo.regionCells[r]) { cap += s.cap[c]; pop += s.pop[c]; }
    const score = (cap - pop * 0.7) / Math.max(1, cap) + rng.next() * 0.2;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  if (best < 0) return;
  const target = geo.regionCells[best];
  const moving = Math.round(target.length * (0.25 + rng.next() * 0.35));
  const order = target.slice().sort((a, b) => {
    // cells adjacent to the source first
    const da = w.neighbors[a].some((k) => w.region[k] === fromRegion) ? 0 : 1;
    const db = w.neighbors[b].some((k) => w.region[k] === fromRegion) ? 0 : 1;
    return da - db || a - b;
  });
  const owner = majority(s.owner, target, s.pop);
  const parts: [string, string][] = [[ref('cul', culture), 'migrants'], [ref('reg', fromRegion), 'origin'], [ref('reg', best), 'destination']];
  if (owner >= 0) parts.push([ref('pol', owner), 'host']);
  const ev = event(s, 'migration', year, { cell: w.regionLabelCell[best], parts, causes: [cause], data: { cells: moving }, sig: 0.45, end: year + rng.int(5, 25) });
  const yLog = Math.max(year, s.lastLogYear.culture);
  let migrants = 0;
  for (const c of order.slice(0, moving)) {
    setCulture(s, c, culture, yLog, ev.id);
    const add = s.pop[c] * 0.25;
    s.pop[c] += add;
    migrants += add;
  }
  for (const c of geo.regionCells[fromRegion]) s.pop[c] *= 0.85;
  ev.data.migrants = Math.round(migrants);
  if (owner >= 0 && alivePolity(s.polities[owner], year)) {
    addStress(s.polities[owner], year, ev.id, 0.8);
    s.polities[owner].stability = Math.max(0, s.polities[owner].stability - 0.08);
  }
}

/** Plague outbreaks spread along trade routes. */
export function plagueStep(s: State, y0: number): void {
  const rng = s.rng.fork('plague', y0);
  const routes = s.activeRoutes;
  const live = s.settlements.filter((t) => t.abandoned === null && t.founded <= y0 && t.pop > 8000);
  if (live.length < 6) return;
  const lambda = 0.004 + Math.min(0.05, routes.length / 9000);
  if (!rng.chance(lambda)) return;
  const origin = rng.weighted(live, live.map((t) => t.pop));
  const year = y0 + rng.int(0, 9);
  // BFS over routes
  const adj = new Map<number, number[]>();
  for (const [a, b] of routes) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  const depth = new Map<number, number>([[origin.id, 0]]);
  let frontier = [origin.id];
  const maxDepth = rng.int(2, 6);
  for (let d = 1; d <= maxDepth; d++) {
    const next: number[] = [];
    for (const f of frontier) for (const k of adj.get(f) ?? []) if (!depth.has(k) && rng.chance(0.75)) { depth.set(k, d); next.push(k); }
    frontier = next;
  }
  const baseMort = 0.1 + rng.next() * 0.25;
  let deaths = 0;
  const polities = new Set<number>();
  for (const [sid, d] of depth) {
    const t = s.settlements[sid];
    const m = baseMort * Math.pow(0.85, d);
    const cells = [t.cell, ...s.world.neighbors[t.cell]];
    for (const c of cells) {
      if (!s.world.land[c]) continue;
      deaths += s.pop[c] * m;
      s.pop[c] *= 1 - m;
      if (s.owner[c] >= 0) polities.add(s.owner[c]);
    }
  }
  const parts: [string, string][] = [[ref('set', origin.id), 'origin']];
  for (const sid of depth.keys()) if (sid !== origin.id) parts.push([ref('set', sid), 'stricken']);
  for (const p of polities) parts.push([ref('pol', p), 'stricken']);
  const ev = event(s, 'plague', year, {
    cell: origin.cell, parts, data: { deaths: Math.round(deaths), mortality: Math.round(baseMort * 100) / 100, reach: depth.size },
    sig: Math.min(0.85, 0.25 + deaths / 3_000_000), end: year + rng.int(2, 8),
  });
  for (const pid of polities) {
    const p = s.polities[pid];
    if (!alivePolity(p, year)) continue;
    p.stability = Math.max(0, p.stability - 0.1);
    addStress(p, year, ev.id, 1.2);
  }
}
