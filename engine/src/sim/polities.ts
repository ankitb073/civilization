// Polities: formation, expansion, aggregates, stability, revolts, civil wars, collapse, government change.
import type { State, Polity, GovType, Settlement } from './state.ts';
import { event, ref, setOwner, alivePolity, addStress, topStress, rel, PALETTE } from './state.ts';
import { Rng } from '../core/rng.ts';
import { TK, has, eraOf, adminMult, milMult, MOBILIZATION, TAX_PER_CAPITA, inheritTechs, TECHS } from './tech.ts';
import { foundingRuler, successionCheck, setRuler, newPerson, newDynasty, isRepublican, headRole } from './people.ts';
import { foundSettlement, siteScore } from './settlements.ts';
import type { Geo } from './geo.ts';
import { majority, components, dist } from './geo.ts';
import { startWar } from './war.ts';

const GOV_ADMIN: Record<GovType, number> = {
  chiefdom: 14, 'city-state': 22, kingdom: 48, empire: 95, theocracy: 40, 'merchant-republic': 30, 'feudal-kingdom': 75,
  horde: 70, 'absolute-monarchy': 70, 'constitutional-monarchy': 80, republic: 75, federation: 120, 'one-party-state': 110,
  democracy: 120, colony: 40,
};

export interface PolityAgg {
  cells: Map<number, number[]>;
  borders: Map<number, Map<number, number>>;
  overext: Map<number, number>;
  foreignShare: Map<number, number>;
  heresyShare: Map<number, number>;
}

export function createPolity(
  s: State,
  year: number,
  o: {
    capital: number; culture: number; gov: GovType; cells: number[]; kind?: Polity['kind'];
    predecessor?: number | null; causes?: number[]; sub?: string; nameBasis?: Polity['nameBasis'];
    collapse?: boolean; ruler?: number | null; key: string; sig?: number; extraParts?: [string, string][];
  },
): Polity {
  const rng = s.rng.fork('polity', o.key);
  const id = s.polities.length;
  const capital = s.settlements[o.capital];
  const basis = o.nameBasis ?? (o.gov === 'city-state' || o.gov === 'chiefdom' || o.gov === 'merchant-republic' ? 'city' : rng.chance(0.5) ? 'region' : 'people');
  const nameId = basis === 'city' ? capital.nameId : basis === 'region' ? s.regionNames[s.world.region[capital.cell]] : s.cultures[o.culture].nameId;
  const parts: [string, string][] = [[ref('pol', id), 'polity'], [ref('set', o.capital), 'capital'], ...(o.extraParts ?? [])];
  if (o.predecessor != null) parts.push([ref('pol', o.predecessor), 'predecessor']);
  const ev = event(s, o.sub ?? 'founding', year, { cell: capital.cell, parts, causes: o.causes, sig: o.sig ?? 0.3 });
  const cultureRng = s.rng.fork('culture-law', o.culture);
  const law = cultureRng.weighted(['male-primogeniture', 'primogeniture', 'seniority', 'elective'] as const, [0.62, 0.12, 0.16, 0.1]);
  const p: Polity = {
    id, nameId, nameBasis: basis, culture: o.culture, born: year, died: null, foundEvent: ev.id, endEvent: null,
    capital: o.capital, capitals: [[year, o.capital]], gov: o.gov, govs: [[year, o.gov]], ruler: null, dynasty: null,
    religion: -1, currency: -1, treasury: 0, debt: 0, stability: 0.65, army: 0, techs: new Map(), overlord: null,
    tributes: [], color: pickColor(s, o.cells, id), predecessor: o.predecessor ?? null, successors: [], kind: o.kind ?? 'state',
    landmassHome: s.world.landmass[capital.cell], generals: [], cells: o.cells.length, pop: 0, urbanPop: 0,
    warWeariness: 0, lastWarEnd: -1000, crisis: 0, stress: [], successionLaw: law,
  };
  s.polities.push(p);
  for (const c of o.cells) setOwner(s, c, id, year, ev.id);
  // religion: majority of the territory
  const rel0 = majority(s.religion, o.cells, s.pop);
  p.religion = rel0 >= 0 ? rel0 : s.cultures[o.culture].pantheon;
  // technology
  const pred = o.predecessor != null ? s.polities[o.predecessor] : null;
  if (pred) {
    inheritTechs(s, p, pred, year, !!o.collapse);
    pred.successors.push(id);
    if (pred.currency >= 0) p.currency = -1; // successors mint their own later
  } else {
    p.techs.set(TK.bronze, year);
    if (s.world.flux[capital.cell] > s.world.riverThreshold) p.techs.set(TK.irrigation, year);
    // learn from the most advanced neighbour on the same landmass
    let best: Polity | null = null;
    for (const q of s.polities) {
      if (!alivePolity(q, year) || q.id === id || q.landmassHome !== p.landmassHome) continue;
      if (dist(s, s.settlements[q.capital].cell, capital.cell) > 420) continue;
      if (!best || q.techs.size > best.techs.size) best = q;
    }
    if (best) inheritTechs(s, p, best, year, true);
  }
  for (const t of [...p.techs.keys()]) if (!TECHS[t].prereqs.every((q) => p.techs.has(q))) p.techs.delete(t);
  // ruler
  if (o.ruler != null) {
    const r = s.persons[o.ruler];
    if (!isRepublican(p.gov)) {
      const d = newDynasty(s, r, id, year);
      p.dynasty = d.id;
    }
    setRuler(s, p, r, year, ev.id, isRepublican(p.gov) ? headRole(p.gov) : 'ruler');
  } else {
    foundingRuler(s, p, year, ev.id, `pol:${id}`);
  }
  let popSum = 0;
  for (const c of o.cells) popSum += s.pop[c];
  p.pop = popSum;
  p.treasury = popSum * 0.002;
  return p;
}

function pickColor(s: State, cells: number[], id: number): string {
  const used = new Set<string>();
  const cs = new Set(cells);
  for (const c of cells) for (const k of s.world.neighbors[c]) if (!cs.has(k) && s.owner[k] >= 0) used.add(s.polities[s.owner[k]].color);
  const start = (id * 7) % PALETTE.length;
  for (let i = 0; i < PALETTE.length; i++) {
    const col = PALETTE[(start + i) % PALETTE.length];
    if (!used.has(col)) return col;
  }
  return PALETTE[start];
}

export function ownedCells(s: State, pid: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < s.world.n; c++) if (s.owner[c] === pid) out.push(c);
  return out;
}

export function endPolity(s: State, p: Polity, year: number, ev: number): void {
  if (p.died !== null) return;
  // a dead polity holds nothing: anything not already transferred falls out of state control
  for (const c of ownedCells(s, p.id)) setOwner(s, c, -1, year, ev);
  p.died = year;
  p.endEvent = ev;
  if (p.ruler !== null) {
    const r = s.persons[p.ruler];
    for (const role of r.roles) if (role.polity === p.id && role.end === null) role.end = year;
  }
  if (p.dynasty !== null && s.dynasties[p.dynasty].end === null) s.dynasties[p.dynasty].end = year;
  for (const w of s.wars) {
    if (w.ended !== null) continue;
    w.attackers = w.attackers.filter((x) => x !== p.id || w.attackers[0] === x);
    w.defenders = w.defenders.filter((x) => x !== p.id || w.defenders[0] === x);
  }
  if (p.currency >= 0 && s.currencies[p.currency].died === null) s.currencies[p.currency].died = year;
  for (const q of s.polities) if (q.overlord === p.id) q.overlord = null;
}

/** Transfer cells and end the loser if it has nothing left. */
export function transferCells(s: State, cells: number[], to: number, year: number, ev: number): void {
  for (const c of cells) setOwner(s, c, to, year, ev);
}

// ------------------------------------------------------------------ formation
export function formationStep(s: State, geo: Geo, y0: number): void {
  const rng = s.rng.fork('formation', y0);
  for (const t of s.settlements) {
    if (t.abandoned !== null || t.founded > y0) continue;
    if (s.owner[t.cell] >= 0) continue;
    const thresh = 3000;
    if (t.pop < thresh) continue;
    if (!rng.chance(Math.min(0.5, 0.08 * (t.pop / thresh)))) continue;
    const culture = s.culture[t.cell];
    if (culture < 0) continue;
    const cells = [t.cell];
    for (const k of s.world.neighbors[t.cell]) {
      if (s.world.land[k] && s.owner[k] < 0 && s.culture[k] === culture) cells.push(k);
    }
    const near = new Set(cells);
    for (const c of [...cells]) for (const k of s.world.neighbors[c]) if (s.world.land[k] && s.owner[k] < 0 && !near.has(k) && rng.chance(0.4)) { near.add(k); cells.push(k); }
    const literate = s.cultures[culture].script >= 0;
    createPolity(s, y0, {
      capital: t.id, culture, gov: literate || t.pop > 12000 ? 'city-state' : 'chiefdom', cells, key: `form:${t.id}:${y0}`,
      nameBasis: 'city', sig: 0.25,
    });
  }
}

// ------------------------------------------------------------------ expansion (yearly)
export function expansionYear(s: State, agg: PolityAgg, year: number, rng: Rng, centuryEvents: Map<number, number>): void {
  const w = s.world;
  for (const p of s.polities) {
    if (!alivePolity(p, year) || p.kind === 'rebel') continue;
    const over = agg.overext.get(p.id) ?? 1;
    if (over > 1.15) continue;
    if (!rng.chance(0.3 * (1.15 - over))) continue;
    const cells = agg.cells.get(p.id);
    if (!cells || cells.length === 0) continue;
    const frontier = new Map<number, number>();
    for (const c of cells) {
      if (s.owner[c] !== p.id) continue;
      for (const k of w.neighbors[c]) {
        if (!w.land[k] || s.owner[k] >= 0) continue;
        frontier.set(k, s.cap[k] + s.pop[k] * 0.5);
      }
    }
    if (frontier.size === 0) continue;
    const take = Math.min(frontier.size, 1 + Math.floor(cells.length / 30));
    const sorted = [...frontier.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, take);
    let evId = centuryEvents.get(p.id);
    if (evId === undefined) {
      const ev = event(s, 'expansion', year, { cell: sorted[0][0], parts: [[ref('pol', p.id), 'polity']], data: { cells: 0 }, sig: 0.03 });
      evId = ev.id;
      centuryEvents.set(p.id, evId);
    }
    const ev = s.events[evId];
    for (const [c] of sorted) {
      setOwner(s, c, p.id, year, evId);
      cells.push(c);
      ev.data.cells = (ev.data.cells as number) + 1;
      ev.end = year;
      // a settlement in newly claimed land is brought into the polity
    }
  }
}

// ------------------------------------------------------------------ aggregates (decadal)
export function aggregate(s: State, geo: Geo, y0: number): PolityAgg {
  const w = s.world;
  const cells = new Map<number, number[]>();
  for (const c of geo.landCells) {
    const o = s.owner[c];
    if (o < 0) continue;
    let a = cells.get(o);
    if (!a) cells.set(o, (a = []));
    a.push(c);
  }
  const borders = new Map<number, Map<number, number>>();
  for (const c of geo.landCells) {
    const a = s.owner[c];
    if (a < 0) continue;
    for (const k of w.neighbors[c]) {
      const b = s.owner[k];
      if (b < 0 || b === a) continue;
      let m = borders.get(a);
      if (!m) borders.set(a, (m = new Map()));
      m.set(b, (m.get(b) ?? 0) + 1);
    }
  }
  const overext = new Map<number, number>();
  const foreignShare = new Map<number, number>();
  const heresyShare = new Map<number, number>();
  const settlementsBy = new Map<number, Settlement[]>();
  for (const t of s.settlements) {
    if (t.abandoned !== null || t.founded > y0) continue;
    const o = s.owner[t.cell];
    if (o < 0) continue;
    let a = settlementsBy.get(o);
    if (!a) settlementsBy.set(o, (a = []));
    a.push(t);
  }
  for (const p of s.polities) {
    if (p.died !== null) continue;
    const cs = cells.get(p.id) ?? [];
    p.cells = cs.length;
    let pop = 0, foreign = 0, heresy = 0, eff = 0;
    const capCell = s.settlements[p.capital].cell;
    const cx = w.x[capCell], cy = w.y[capCell];
    const reach = 260 * Math.sqrt(adminMult(p));
    for (const c of cs) {
      const cp = s.pop[c];
      pop += cp;
      const cul = s.culture[c];
      if (cul !== p.culture && cul >= 0 && s.cultures[cul].lang !== s.cultures[p.culture].lang) foreign += cp;
      if (s.religion[c] !== p.religion) heresy += cp;
      const d = Math.hypot(w.x[c] - cx, w.y[c] - cy);
      eff += 1 + (d / reach) ** 2;
    }
    p.pop = pop;
    p.urbanPop = (settlementsBy.get(p.id) ?? []).reduce((a, t) => a + t.pop, 0);
    const cap = GOV_ADMIN[p.gov] * adminMult(p);
    overext.set(p.id, eff / cap);
    foreignShare.set(p.id, pop > 0 ? foreign / pop : 0);
    heresyShare.set(p.id, pop > 0 ? heresy / pop : 0);
  }
  return { cells, borders, overext, foreignShare, heresyShare };
}

/** Decadal economy-lite and stability update. */
export function stabilityStep(s: State, agg: PolityAgg, y0: number): void {
  for (const p of s.polities) {
    if (p.died !== null || p.born > y0 + 9) continue;
    const era = eraOf(p);
    const atWar = s.wars.some((w) => w.ended === null && (w.attackers.includes(p.id) || w.defenders.includes(p.id)));
    // treasury (silver kg over the decade)
    const revenue = p.pop * TAX_PER_CAPITA[era] * (0.5 + p.stability * 0.6) * 10;
    const soldiers = p.pop * MOBILIZATION[era];
    const upkeep = soldiers * 0.09 * (atWar ? 2.6 : 1) * 10 * (TAX_PER_CAPITA[era] / 0.004) * 0.6;
    let tribute = 0;
    for (const t of p.tributes) if (t.until >= y0) tribute += t.amount * 10;
    p.treasury = p.treasury * 0.7 + revenue - upkeep - revenue * 0.25 - tribute;
    for (const q of s.polities) for (const t of q.tributes) if (t.to === p.id && t.until >= y0) p.treasury += t.amount * 10;
    const treasuryFactor = p.treasury > 0 ? 1 : Math.max(0.55, 1 + p.treasury / Math.max(1, revenue * 3));
    p.army = Math.round(soldiers * milMult(p) * treasuryFactor);
    // stability
    const over = agg.overext.get(p.id) ?? 1;
    let st = p.stability;
    // secular cycles: polities age, and population pressing on capacity strains the state
    const age = y0 - p.born;
    let pressure = 0, n = 0;
    for (const c of agg.cells.get(p.id) ?? []) { if (s.cap[c] > 0) { pressure += s.pop[c] / s.cap[c]; n++; } }
    pressure = n ? pressure / n : 0;
    const target = 0.7 - 0.22 * Math.min(1, age / 450) - 0.35 * Math.max(0, pressure - 0.88);
    st += 0.2 * (target - st);
    st -= 0.14 * Math.max(0, over - 1);
    st -= 0.08 * (agg.foreignShare.get(p.id) ?? 0);
    st -= 0.06 * (agg.heresyShare.get(p.id) ?? 0);
    st -= Math.min(0.15, p.warWeariness * 0.05);
    if (p.treasury < 0) st -= 0.05;
    if (p.overlord !== null) st -= 0.02;
    p.stability = Math.max(0, Math.min(1, st));
    p.warWeariness *= 0.6;
    // consecutive decades of deep crisis
    p.crisis = p.stability < 0.12 ? p.crisis + 1 : 0;
  }
}

// ------------------------------------------------------------------ yearly politics
export function politicsYear(s: State, geo: Geo, agg: PolityAgg, year: number, rng: Rng): void {
  const live = new Map<number, number[]>();
  for (const c of geo.landCells) {
    const o = s.owner[c];
    if (o < 0) continue;
    let a = live.get(o);
    if (!a) live.set(o, (a = []));
    a.push(c);
  }
  for (const p of s.polities.slice()) {
    if (!alivePolity(p, year)) continue;
    successionCheck(s, p, year, rng);
    const cells = (live.get(p.id) ?? []).filter((c) => s.owner[c] === p.id);
    if (cells.length === 0) {
      const lastChange = lastTerritoryEvent(s, p.id);
      const ev = event(s, 'extinction', year, { parts: [[ref('pol', p.id), 'polity']], causes: lastChange !== null && s.events[lastChange].year <= year ? [lastChange] : [], sig: 0.15 });
      endPolity(s, p, year, ev.id);
      continue;
    }
    capitalCheck(s, p, cells, year);
    if (p.crisis >= 2 && p.stability < 0.1 && cells.length > 20 && rng.chance(0.05)) { collapse(s, geo, p, cells, year, rng); continue; }
    if (p.stability < 0.12 && cells.length > 30 && rng.chance(0.025)) { civilWar(s, p, cells, year, rng); continue; }
    if (p.stability < 0.25 && rng.chance((0.25 - p.stability) * 0.06)) revolt(s, geo, p, cells, year, rng);
  }
}

function lastTerritoryEvent(s: State, pid: number): number | null {
  const L = s.territoryLog;
  for (let i = L.length - 4; i >= 0 && i > L.length - 4000; i -= 4) {
    // the change that removed a cell from pid isn't recorded with the old owner; use the most recent event touching pid's parts
  }
  for (let i = s.events.length - 1; i >= 0 && i > s.events.length - 3000; i--) {
    const e = s.events[i];
    if ((e.sub === 'treaty' || e.sub === 'conquest' || e.sub === 'revolt' || e.sub === 'collapse') && e.parts.some(([r]) => r === `pol:${pid}`)) return e.id;
  }
  return null;
}

function capitalCheck(s: State, p: Polity, cells: number[], year: number): void {
  const cap = s.settlements[p.capital];
  if (s.owner[cap.cell] === p.id && cap.abandoned === null) return;
  const owned = new Set(cells);
  const options = s.settlements.filter((t) => t.abandoned === null && t.founded <= year && owned.has(t.cell));
  let next: Settlement;
  if (options.length > 0) next = options.sort((a, b) => b.pop - a.pop || a.id - b.id)[0];
  else {
    const best = cells.slice().sort((a, b) => siteScore(s, b) + s.pop[b] / 1e5 - (siteScore(s, a) + s.pop[a] / 1e5) || a - b)[0];
    if (s.settlementAt[best] >= 0) next = s.settlements[s.settlementAt[best]];
    else next = foundSettlement(s, best, year, s.culture[best] >= 0 ? s.culture[best] : p.culture, { polity: p.id, nameCulture: p.culture });
  }
  const lost = lastTerritoryEvent(s, p.id);
  event(s, 'capital-move', year, {
    cell: next.cell,
    parts: [[ref('pol', p.id), 'polity'], [ref('set', cap.id), 'from'], [ref('set', next.id), 'to']],
    causes: lost !== null && s.events[lost].year <= year ? [lost] : [], sig: 0.15,
  });
  p.capital = next.id;
  p.capitals.push([year, next.id]);
}

function revolt(s: State, geo: Geo, p: Polity, cells: number[], year: number, rng: Rng): void {
  const w = s.world;
  const capRegion = w.region[s.settlements[p.capital].cell];
  // region with the most foreign or heretical population
  const byRegion = new Map<number, number[]>();
  for (const c of cells) {
    const r = w.region[c];
    if (r === capRegion) continue;
    let a = byRegion.get(r);
    if (!a) byRegion.set(r, (a = []));
    a.push(c);
  }
  let best = -1, bestScore = 0;
  for (const [r, cs] of byRegion) {
    if (cs.length < 4) continue;
    let sc = 0;
    for (const c of cs) {
      if (s.culture[c] !== p.culture) sc += 1;
      if (s.religion[c] !== p.religion) sc += 0.6;
    }
    sc = sc / cs.length + rng.next() * 0.3;
    if (sc > bestScore) { bestScore = sc; best = r; }
  }
  if (best < 0) return;
  const rc = byRegion.get(best)!;
  const comp = components(s, rc)[0];
  if (comp.length < 4) return;
  const culture = majority(s.culture, comp, s.pop);
  if (culture < 0) return;
  let seat = s.settlements.filter((t) => t.abandoned === null && t.founded <= year && comp.includes(t.cell)).sort((a, b) => b.pop - a.pop)[0];
  if (!seat) {
    const c = comp.slice().sort((a, b) => s.pop[b] - s.pop[a] || a - b)[0];
    if (s.settlementAt[c] >= 0) return;
    seat = foundSettlement(s, c, year, culture, { polity: p.id });
  }
  const causes = topStress(p, year, 60, 3);
  const leader = newPerson(s, { sex: 'm', born: year - rng.int(25, 50), culture, polity: null, key: `rebel:${p.id}:${year}`, adult: true, minDeath: year + 1 });
  leader.roles.push({ role: 'rebel', polity: p.id, start: year, end: null, event: null });
  const rebel = createPolity(s, year, {
    capital: seat.id, culture, gov: 'kingdom', cells: comp, kind: 'rebel', sub: 'revolt', causes,
    key: `revolt:${p.id}:${year}`, ruler: leader.id, nameBasis: rng.chance(0.5) ? 'region' : 'people', sig: 0.35,
    extraParts: [[ref('pol', p.id), 'against'], [ref('per', leader.id), 'leader']],
  });
  rebel.stability = 0.55;
  addStress(p, year, rebel.foundEvent, 1);
  startWar(s, year, [rebel.id], [p.id], 'independence', best, [rebel.foundEvent], rng);
}

function civilWar(s: State, p: Polity, cells: number[], year: number, rng: Rng): void {
  const w = s.world;
  const capCell = s.settlements[p.capital].cell;
  const sorted = cells.slice().sort((a, b) => dist(s, b, capCell) - dist(s, a, capCell) || a - b);
  const half = components(s, sorted.slice(0, Math.floor(sorted.length * 0.45)))[0];
  if (!half || half.length < 6) return;
  let seat = s.settlements.filter((t) => t.abandoned === null && t.founded <= year && half.includes(t.cell)).sort((a, b) => b.pop - a.pop)[0];
  if (!seat) return;
  const ruler = p.ruler !== null ? s.persons[p.ruler] : null;
  let claimant = ruler && ruler.father !== null
    ? s.persons[ruler.father].children.map((c) => s.persons[c]).find((x) => x.id !== ruler.id && x.born <= year - 18 && x.died > year)
    : undefined;
  if (!claimant) claimant = newPerson(s, { sex: 'm', born: year - rng.int(30, 55), culture: p.culture, polity: p.id, key: `claimant:${p.id}:${year}`, adult: true, minDeath: year + 1 });
  const causes = topStress(p, year, 60, 4);
  const rebel = createPolity(s, year, {
    capital: seat.id, culture: p.culture, gov: p.gov, cells: half, kind: 'rebel', sub: 'civil-war', causes,
    key: `civil:${p.id}:${year}`, ruler: claimant.id, nameBasis: 'city', predecessor: null, sig: 0.5,
    extraParts: [[ref('pol', p.id), 'against'], [ref('per', claimant.id), 'claimant']],
  });
  rebel.techs = new Map(p.techs);
  rebel.religion = p.religion;
  rebel.stability = 0.5;
  addStress(p, year, rebel.foundEvent, 1.5);
  startWar(s, year, [rebel.id], [p.id], 'civil', w.region[seat.cell], [rebel.foundEvent], rng);
}

export function collapse(s: State, geo: Geo, p: Polity, cells: number[], year: number, rng: Rng): void {
  const causes = topStress(p, year, 70, 5);
  const ev = event(s, 'collapse', year, { cell: s.settlements[p.capital].cell, parts: [[ref('pol', p.id), 'collapsed']], causes, sig: Math.min(0.95, 0.4 + cells.length / 300) });
  // successor seats: the largest cities, spread apart
  const owned = new Set(cells);
  const towns = s.settlements
    .filter((t) => t.abandoned === null && t.founded <= year && owned.has(t.cell))
    .sort((a, b) => b.pop - a.pop || a.id - b.id);
  const k = Math.max(2, Math.min(6, Math.round(cells.length / 45)));
  const seats: Settlement[] = [];
  for (const t of towns) {
    if (seats.length >= k) break;
    if (seats.some((o) => dist(s, o.cell, t.cell) < 90)) continue;
    seats.push(t);
  }
  // assign every cell to the nearest seat through the old territory (multi-source BFS)
  const assign = new Map<number, number>();
  let frontier: number[] = [];
  seats.forEach((t, i) => { assign.set(t.cell, i); frontier.push(t.cell); });
  while (frontier.length) {
    const next: number[] = [];
    for (const f of frontier) for (const nb of s.world.neighbors[f]) {
      if (!owned.has(nb) || assign.has(nb)) continue;
      assign.set(nb, assign.get(f)!);
      next.push(nb);
    }
    frontier = next;
  }
  const groups: number[][] = seats.map(() => []);
  for (const c of cells) {
    const g = assign.get(c);
    if (g !== undefined) groups[g].push(c);
  }
  // cells that could not be reached fall out of state control (endPolity releases them)
  for (const c of cells) if (!assign.has(c)) setOwner(s, c, -1, year, ev.id);
  // detach successor territory before ending the old state, then create successors
  for (const c of cells) if (assign.has(c)) setOwner(s, c, -1, year, ev.id);
  endPolity(s, p, year, ev.id);
  seats.forEach((seat, i) => {
    const comp = groups[i];
    if (comp.length < 3) return;
    const culture = majority(s.culture, comp, s.pop);
    const q = createPolity(s, year, {
      capital: seat.id, culture: culture >= 0 ? culture : p.culture, gov: comp.length > 20 ? 'kingdom' : 'city-state',
      cells: comp, predecessor: p.id, causes: [ev.id], sub: 'successor-state', collapse: true, key: `succ:${p.id}:${i}`,
      nameBasis: rng.chance(0.4) ? 'city' : 'region', sig: 0.25,
    });
    q.religion = p.religion;
    q.stability = 0.55;
    ev.parts.push([ref('pol', q.id), 'successor']);
  });
}

/** Decadal: government evolution, vassal annexation, horde formation. */
export function governmentStep(s: State, agg: PolityAgg, y0: number): void {
  const rng = s.rng.fork('gov', y0);
  for (const p of s.polities) {
    if (!alivePolity(p, y0) || p.kind === 'rebel') continue;
    const era = eraOf(p);
    const cells = p.cells;
    const capPop = s.settlements[p.capital].pop;
    let next: GovType | null = null;
    let sub = 'reform';
    const foreign = agg.foreignShare.get(p.id) ?? 0;
    switch (p.gov) {
      case 'chiefdom':
        if (has(p, 'writing') && capPop > 6000) next = 'city-state';
        else if (cells > 22) next = 'kingdom';
        break;
      case 'city-state':
        if (cells > 18) next = 'kingdom';
        else if (era >= 2 && capPop > 25000 && s.settlements[p.capital].port && rng.chance(0.08)) next = 'merchant-republic';
        break;
      case 'kingdom':
        if (cells > 90 && foreign > 0.2) next = 'empire';
        else if (era === 3 && cells > 50 && rng.chance(0.15)) next = 'feudal-kingdom';
        else if (era >= 4 && has(p, 'gunpowder') && rng.chance(0.12)) next = 'absolute-monarchy';
        break;
      case 'feudal-kingdom':
        if (era >= 4 && has(p, 'gunpowder') && rng.chance(0.15)) next = 'absolute-monarchy';
        else if (cells > 120 && foreign > 0.3) next = 'empire';
        break;
      case 'empire':
        if (cells < 45) next = 'kingdom';
        break;
      case 'horde':
        if (cells > 30 && has(p, 'writing') && rng.chance(0.2)) next = 'empire';
        else if (rng.chance(0.06)) next = 'kingdom';
        break;
      case 'absolute-monarchy':
        if (era >= 5 && p.stability < 0.45 && rng.chance(0.25)) { next = rng.chance(0.55) ? 'republic' : 'constitutional-monarchy'; sub = 'revolution'; }
        else if (era >= 4 && has(p, 'printing') && p.stability < 0.3 && rng.chance(0.08)) { next = 'republic'; sub = 'revolution'; }
        break;
      case 'constitutional-monarchy':
        if (era >= 6 && rng.chance(0.05)) next = 'democracy';
        break;
      case 'republic':
        if (era >= 5 && p.stability < 0.25 && rng.chance(0.2)) { next = 'one-party-state'; sub = 'revolution'; }
        else if (era >= 6 && rng.chance(0.1)) next = 'democracy';
        else if (cells > 150 && rng.chance(0.08)) next = 'federation';
        break;
      case 'one-party-state':
        if (era >= 6 && rng.chance(0.08)) { next = 'democracy'; sub = 'revolution'; }
        break;
      case 'merchant-republic':
        if (cells > 40) next = 'kingdom';
        else if (era >= 5 && rng.chance(0.1)) next = 'republic';
        break;
      case 'theocracy':
        if (rng.chance(0.05)) next = 'kingdom';
        break;
      default:
        break;
    }
    if (era >= 5 && !isRepublican(p.gov) && p.gov !== 'constitutional-monarchy' && next === null && p.stability < 0.35 && rng.chance(0.12)) {
      next = rng.chance(0.5) ? 'republic' : 'constitutional-monarchy';
      sub = 'revolution';
    }
    if (next && next !== p.gov) changeGov(s, p, next, y0 + rng.int(0, 9), sub, rng);
  }
}

export function changeGov(s: State, p: Polity, gov: GovType, year: number, sub: string, rng: Rng): void {
  const causes = sub === 'revolution' ? topStress(p, year, 50, 3) : [];
  const fixed = causes.filter((c) => s.events[c].year <= year);
  const ev = event(s, sub, year, { cell: s.settlements[p.capital].cell, parts: [[ref('pol', p.id), 'polity']], causes: fixed, data: { from: p.gov, to: gov }, sig: sub === 'revolution' ? 0.55 : 0.2 });
  const wasRep = isRepublican(p.gov);
  p.gov = gov;
  p.govs.push([year, gov]);
  if (sub === 'revolution') p.stability = Math.max(p.stability, 0.45);
  if (isRepublican(gov) && !wasRep) {
    if (p.dynasty !== null) s.dynasties[p.dynasty].end = year;
    p.dynasty = null;
    const head = newPerson(s, { sex: 'm', born: year - rng.int(35, 60), culture: p.culture, polity: p.id, key: `rev:${p.id}:${year}`, adult: true, minDeath: year + 1 });
    ev.parts.push([ref('per', head.id), 'leader']);
    if (p.ruler !== null) ev.parts.push([ref('per', p.ruler), 'deposed']);
    setRuler(s, p, head, year, ev.id, headRole(gov));
  } else if (!isRepublican(gov) && wasRep) {
    const king = newPerson(s, { sex: 'm', born: year - rng.int(30, 50), culture: p.culture, polity: p.id, key: `king:${p.id}:${year}`, adult: true, minDeath: year + 1 });
    const d = newDynasty(s, king, p.id, year);
    p.dynasty = d.id;
    setRuler(s, p, king, year, ev.id, 'ruler');
  } else if (isRepublican(gov) && p.ruler !== null) {
    // keep the head of state but retitle the role
    const r = s.persons[p.ruler];
    setRuler(s, p, r, year, ev.id, headRole(gov));
  }
}

export function relationOf(s: State, a: number, b: number) {
  return rel(s, a, b);
}
