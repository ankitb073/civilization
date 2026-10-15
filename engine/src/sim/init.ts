// Initial conditions at AY 0: peoples and their languages, pantheons, place names, population,
// the first towns and the first city-states.
import type { State } from './state.ts';
import { Rng } from '../core/rng.ts';
import { MinHeap } from '../core/heap.ts';
import { generateWorld } from '../world/generate.ts';
import { BIOME } from '../world/biomes.ts';
import { LanguageEngine } from '../lang/index.ts';
import { newCulture } from './culture.ts';
import { makePantheon } from './religion.ts';
import { capacity } from './population.ts';
import { foundSettlement, siteScore } from './settlements.ts';
import { createPolity } from './polities.ts';
import { buildGeo } from './geo.ts';

export function initState(seed: number): State {
  const world = generateWorld(seed);
  const lang = new LanguageEngine(seed);
  const n = world.n;
  const s: State = {
    seed, world, lang, rng: new Rng(seed).fork('sim'), year: 0,
    owner: new Int32Array(n).fill(-1), culture: new Int32Array(n).fill(-1), religion: new Int32Array(n).fill(-1),
    pop: new Float32Array(n), cap: new Float32Array(n), yieldF: new Float32Array(n).fill(1), devast: new Float32Array(n),
    settlementAt: new Int32Array(n).fill(-1),
    polities: [], persons: [], dynasties: [], settlements: [], cultures: [], scripts: [], movements: [], deities: [],
    currencies: [], houses: [], anomalies: [], events: [], wars: [], relations: new Map(), regionNames: [], riverNames: [],
    territoryLog: [], cultureLog: [], religionLog: [], lastLogYear: { territory: -10000, culture: -10000, religion: -10000 },
    climate: [], modeAmp: [], modeField: [], tempAnom: 0, fossil: 0,
    prices: [], routes: [], activeRoutes: [], silverStock: 0, polityYears: [], flushed: {},
  };
  const rng = new Rng(seed).fork('init');
  const geo = buildGeo(s);

  // ---------------- peoples: seeds weighted by habitability
  const hab = geo.landCells.map((c) => capacity(s, c, null));
  const seeds: number[] = [];
  const want = Math.round(geo.landCells.length / 135);
  for (let tries = 0; tries < want * 80 && seeds.length < want; tries++) {
    const c = rng.weighted(geo.landCells, hab.map((h) => Math.sqrt(h)));
    if (seeds.every((o) => Math.hypot(world.x[o] - world.x[c], world.y[o] - world.y[c]) > 165)) seeds.push(c);
  }
  // every sizeable landmass gets at least one people
  for (let lm = 0; lm < world.landmassSize.length; lm++) {
    if (world.landmassSize[lm] < 8) continue;
    if (seeds.some((c) => world.landmass[c] === lm)) continue;
    const cells = geo.landCells.filter((c) => world.landmass[c] === lm);
    seeds.push(cells[Math.floor(cells.length / 2)]);
  }
  // language families: farthest-point centres, one or more per landmass
  const famCount = Math.min(seeds.length, 6);
  const centres: number[] = [seeds[0]];
  while (centres.length < famCount) {
    let best = -1, bd = -1;
    for (const c of seeds) {
      const d = Math.min(...centres.map((o) => Math.hypot(world.x[o] - world.x[c], world.y[o] - world.y[c]) + (world.landmass[o] === world.landmass[c] ? 0 : 400)));
      if (d > bd) { bd = d; best = c; }
    }
    centres.push(best);
  }
  const famOf = seeds.map((c) => {
    let best = 0, bd = Infinity;
    centres.forEach((o, i) => {
      const d = Math.hypot(world.x[o] - world.x[c], world.y[o] - world.y[c]) + (world.landmass[o] === world.landmass[c] ? 0 : 600);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  });
  const protos = centres.map((_, i) => lang.createProto(-3200, `family:${i}`));
  const branches = new Map<number, number[]>();
  centres.forEach((_, f) => {
    const members = seeds.filter((_, i) => famOf[i] === f).length;
    const nb = members >= 4 ? 2 : 1;
    const bs: number[] = [];
    for (let b = 0; b < nb; b++) bs.push(nb === 1 ? protos[f] : lang.split(protos[f], -2400 + rng.int(0, 500), `branch:${f}:${b}`));
    branches.set(f, bs);
  });
  // assign territory first (so we know which seed is pastoral)
  const owner = new Int32Array(n).fill(-1);
  const dist = new Float64Array(n).fill(Infinity);
  const h = new MinHeap<number>();
  seeds.forEach((c, i) => { owner[c] = i; dist[c] = 0; h.push(0, c); });
  while (h.size) {
    const c = h.pop()!;
    for (const k of world.neighbors[c]) {
      if (!world.land[k]) continue;
      const nd = dist[c] + 1 + 5 * Math.max(0, world.elev[k] - 0.4) + (world.flux[k] > world.riverThreshold * 5 ? 1 : 0);
      if (nd < dist[k]) { dist[k] = nd; owner[k] = owner[c]; h.push(nd, k); }
    }
  }
  seeds.forEach((seedCell, i) => {
    const f = famOf[i];
    const bs = branches.get(f)!;
    const parentLang = bs[i % bs.length];
    const born = -1500 + rng.int(0, 1300);
    const l = lang.split(parentLang, born, `people:${i}`);
    const cells = geo.landCells.filter((c) => owner[c] === i);
    let dry = 0;
    for (const c of cells) {
      const b = world.biome[c];
      if (b === BIOME.steppe || b === BIOME.coldDesert || b === BIOME.hotDesert || b === BIOME.savanna) dry++;
    }
    const pastoral = cells.length > 0 && dry / cells.length > 0.55;
    const cu = newCulture(s, { lang: l, parent: null, born, homeCell: seedCell, pastoral, pantheon: -1, script: -1, key: `init:${i}`, bornEvent: null });
    const pantheon = makePantheon(s, cu.id, born, rng.fork('pantheon', i));
    cu.pantheon = pantheon.id;
    for (const c of cells) {
      s.culture[c] = cu.id;
      s.religion[c] = pantheon.id;
    }
  });
  // tiny islands nobody reached: nearest people
  for (const c of geo.landCells) {
    if (s.culture[c] >= 0) continue;
    let best = 0, bd = Infinity;
    seeds.forEach((o, i) => {
      const d = Math.hypot(world.x[o] - world.x[c], world.y[o] - world.y[c]);
      if (d < bd) { bd = d; best = i; }
    });
    s.culture[c] = best;
    s.religion[c] = s.cultures[best].pantheon;
  }
  // initial logs (year 0 snapshot is the keyframe, logs start empty)

  // ---------------- place names
  for (let r = 0; r < world.regionCount; r++) {
    const cells = geo.regionCells[r];
    const counts = new Map<number, number>();
    for (const c of cells) counts.set(s.culture[c], (counts.get(s.culture[c]) ?? 0) + 1);
    let cu = s.culture[world.regionLabelCell[r]];
    let bc = -1;
    for (const [k, v] of counts) if (v > bc || (v === bc && k < cu)) { bc = v; cu = k; }
    const l = s.cultures[cu].lang;
    const nm = lang.coinName(l, Math.max(-800, lang.info(l).born), 'region', `reg:${r}`);
    lang.localize(nm, l, Math.max(-800, lang.info(l).born));
    s.regionNames.push(nm);
  }
  world.rivers.forEach((rv, i) => {
    const mid = rv.cells[Math.floor(rv.cells.length / 2)];
    const l = s.cultures[s.culture[mid]].lang;
    const nm = lang.coinName(l, Math.max(-1200, lang.info(l).born), 'river', `riv:${i}`);
    lang.localize(nm, l, Math.max(-1200, lang.info(l).born));
    s.riverNames.push(nm);
  });

  // ---------------- population
  for (const c of geo.landCells) {
    s.cap[c] = capacity(s, c, null);
    s.pop[c] = s.cap[c] * 0.5;
  }

  // silver in circulation: calibrated so the price level starts at 1
  let totalPop = 0;
  for (const c of geo.landCells) totalPop += s.pop[c];
  s.silverStock = totalPop * 0.02;

  // ---------------- first towns
  const cands = geo.landCells.slice().sort((a, b) => s.pop[b] * siteScore(s, b) - s.pop[a] * siteScore(s, a) || a - b);
  const towns: number[] = [];
  for (const c of cands) {
    if (towns.length >= 34) break;
    if (towns.some((t) => Math.hypot(world.x[t] - world.x[c], world.y[t] - world.y[c]) < 60)) continue;
    towns.push(c);
  }
  for (const c of towns) foundSettlement(s, c, -rng.int(150, 900), s.culture[c], { sig: 0.15, key: `init:${c}` });
  for (const t of s.settlements) t.pop = Math.round(s.pop[t.cell] * 0.08);

  // ---------------- first city-states in the richest river valleys
  const riverTowns = s.settlements
    .filter((t) => world.flux[t.cell] > world.riverThreshold || world.neighbors[t.cell].some((k) => world.flux[k] > world.riverThreshold))
    .sort((a, b) => s.pop[b.cell] - s.pop[a.cell] || a.id - b.id);
  const firsts: number[] = [];
  for (const t of riverTowns) {
    if (firsts.length >= 7) break;
    if (firsts.some((f) => Math.hypot(world.x[s.settlements[f].cell] - world.x[t.cell], world.y[s.settlements[f].cell] - world.y[t.cell]) < 110)) continue;
    firsts.push(t.id);
  }
  for (const tid of firsts) {
    const t = s.settlements[tid];
    const cells = [t.cell, ...world.neighbors[t.cell].filter((k) => world.land[k])];
    createPolity(s, 0, { capital: tid, culture: s.culture[t.cell], gov: 'city-state', cells, key: `first:${tid}`, nameBasis: 'city', sig: 0.4 });
  }
  lang.advanceTo(0);
  return s;
}
