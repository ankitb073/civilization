// Settlements: founding at good sites, growth from catchment population, sacks, abandonment.
import type { State, Settlement } from './state.ts';
import { event, ref, topStress } from './state.ts';
import { URBAN_SHARE, eraOf } from './tech.ts';
import type { Geo } from './geo.ts';

export function siteScore(s: State, c: number): number {
  const w = s.world;
  let sc = 0.4 + w.fertility[c];
  if (w.flux[c] > w.riverThreshold) sc += 0.6;
  if (w.coastal[c]) sc += 0.5;
  // confluence: two river inflows
  let inflow = 0;
  for (const k of w.neighbors[c]) if (w.downhill[k] === c && w.flux[k] > w.riverThreshold) inflow++;
  if (inflow >= 2) sc += 0.5;
  if (w.elev[c] > 0.5) sc -= 0.4;
  return sc;
}

export function foundSettlement(s: State, cell: number, year: number, culture: number, opts: { polity?: number; causes?: number[]; nameCulture?: number; sig?: number; key?: string } = {}): Settlement {
  const nameCulture = opts.nameCulture ?? culture;
  const lang = s.cultures[nameCulture].lang;
  const id = s.settlements.length;
  const nameId = s.lang.coinName(lang, Math.max(year, s.lang.info(lang).born), 'settlement', `set:${opts.key ?? id}`);
  const parts: [string, string][] = [[ref('set', id), 'settlement']];
  if (opts.polity !== undefined && opts.polity >= 0) parts.push([ref('pol', opts.polity), 'founder']);
  const ev = event(s, 'founding-city', year, { cell, parts, causes: opts.causes, sig: opts.sig ?? 0.12 });
  const t: Settlement = {
    id, nameId, names: [[year, nameId]], cell, founded: year, abandoned: null, foundEvent: ev.id, endEvent: null,
    culture: nameCulture, pop: 2000, peakPop: 2000, popHistory: [], sacks: [], port: s.world.coastal[cell] === 1,
  };
  s.settlements.push(t);
  s.settlementAt[cell] = id;
  s.lang.localize(nameId, lang, Math.max(year, s.lang.info(lang).born));
  return t;
}

export function settlementStep(s: State, geo: Geo, y0: number): void {
  const w = s.world;
  const rng = s.rng.fork('settlements', y0);
  // grow / shrink
  const capitals = new Set<number>();
  for (const p of s.polities) if (p.died === null) capitals.add(p.capital);
  for (const t of s.settlements) {
    if (t.abandoned !== null || t.founded > y0 + 9) continue;
    const o = s.owner[t.cell];
    const era = o >= 0 ? eraOf(s.polities[o]) : 0;
    let catchment = s.pop[t.cell];
    for (const k of w.neighbors[t.cell]) if (w.land[k]) catchment += s.pop[k] * 0.5;
    let pop = URBAN_SHARE[era] * catchment * (capitals.has(t.id) ? 2.4 : 1) * (t.port ? 1.25 : 1) * (o < 0 ? 0.5 : 1);
    pop = Math.max(300, pop);
    t.pop = Math.round(pop);
    if (t.pop > t.peakPop) t.peakPop = t.pop;
    // abandonment after collapse of the hinterland
    if (t.pop < 900 && t.peakPop > 6000 && !capitals.has(t.id) && rng.chance(0.25)) {
      const year = y0 + rng.int(0, 9);
      const causes: number[] = [];
      if (t.sacks.length) causes.push(t.sacks[t.sacks.length - 1]);
      if (o >= 0) causes.push(...topStress(s.polities[o], year, 50, 2));
      const fixed = causes.filter((c) => s.events[c].year <= year);
      const ev = event(s, 'abandonment', year, { cell: t.cell, parts: [[ref('set', t.id), 'settlement'], ...(o >= 0 ? [[ref('pol', o), 'polity'] as [string, string]] : [])], causes: fixed, sig: 0.25 });
      t.abandoned = year;
      t.endEvent = ev.id;
      s.settlementAt[t.cell] = -1;
    }
  }
  // founding
  const era0 = 0;
  for (const c of geo.landCells) {
    if (s.settlementAt[c] >= 0) continue;
    const o = s.owner[c];
    const era = o >= 0 ? eraOf(s.polities[o]) : era0;
    const threshold = [26_000, 30_000, 36_000, 40_000, 55_000, 90_000, 120_000][era];
    if (s.pop[c] < threshold) continue;
    let near = false;
    for (const k of w.neighbors[c]) {
      if (s.settlementAt[k] >= 0) { near = true; break; }
      for (const k2 of w.neighbors[k]) if (s.settlementAt[k2] >= 0) { near = true; break; }
      if (near) break;
    }
    if (near) continue;
    if (!rng.chance(0.05 * siteScore(s, c))) continue;
    const culture = s.culture[c];
    if (culture < 0) continue;
    const year = y0 + rng.int(0, 9);
    const nameCulture = o >= 0 && s.polities[o].culture !== culture && rng.chance(0.5) ? s.polities[o].culture : culture;
    foundSettlement(s, c, year, culture, { polity: o >= 0 ? o : undefined, nameCulture });
  }
}

/** Record population per century. */
export function recordSettlementPop(s: State, year: number): void {
  for (const t of s.settlements) if (t.founded <= year && t.abandoned === null) t.popHistory.push([year, t.pop]);
}
