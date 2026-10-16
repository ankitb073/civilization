// Cities in 3D: everything a city's model is generated from, read from the record and nothing else.
// A CityRecord is plain data (the city's survey, masters, people, faiths, sacks, harbour and site); cityAt() reads
// it at a year. Sources: timeline.json (settlements, polities, capitals), cities.json (engine/src/export/cities.ts),
// the city's page (exact population series, period names), world.json (coast, river, biome, relief) and meta (eras).

import type { CitiesJson, Era, PageJson } from '../../../../engine/src/export/contract.ts';
import { fetchJson, loadPage } from '../../data.ts';
import { ensureMapData, ensureMeta } from '../../store.ts';
import type { MapData } from '../../views/mapRenderer.ts';

/** FNV-1a with an avalanche (the same hash as atlas/src/heraldry.ts, so the city's colours agree with its arms). */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
/** A small deterministic stream (mulberry32) seeded from a label. */
export function stream(label: string): () => number {
  let a = hash(label);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 0..1 from a label. */
export const unit = (label: string) => hash(label) / 4294967296;

export interface PolityInfo {
  idx: number;
  id: string;
  color: string;
  start: number;
  end: number;
  names: [number, string][];
  capitals: [number, number][];
  /** Decadal survey, flat [year, faith, technological age, …]. */
  survey: number[];
}

export interface Site {
  /** Unit vector (x east, z south) toward the sea, and the share of the city's neighbouring districts that are water. */
  coast: { dx: number; dz: number; share: number } | null;
  river: { id: string; name: string; dx: number; dz: number; side: number; through: boolean; width: number; mouth: boolean; source: boolean } | null;
  biome: string;
  /** 0 at the sea, 1 at the highest peaks. */
  elev: number;
  /** Unit vector uphill and how steep the land around rises (0..1). */
  uphill: { dx: number; dz: number; k: number };
}

export interface CityRecord {
  id: string;
  idx: number;
  name: string;
  cell: number;
  start: number;
  /** Year of abandonment (5000 when it still stands). */
  end: number;
  pop: [number, number][];
  names: { year: number; form: string; lang: string }[];
  owners: number[];
  cultures: number[];
  sacks: number[];
  port: boolean;
  /** Spans in which it was a capital: [from, to, polity idx]. */
  capitals: [number, number, number][];
  polities: Record<number, PolityInfo>;
  faiths: CitiesJson['faiths'];
  peoples: string[];
  eras: Era[];
  site: Site;
  yearEnd: number;
}

let citiesP: Promise<CitiesJson> | null = null;
export function loadCities(): Promise<CitiesJson> {
  if (!citiesP) {
    citiesP = fetchJson<CitiesJson>('cities.json');
    citiesP.catch(() => { citiesP = null; });
  }
  return citiesP;
}

/** Assemble a city's record (fetches what is not loaded yet). Rejects for an unknown settlement. */
export async function loadCityRecord(id: string): Promise<CityRecord> {
  const [d, m, c, page] = await Promise.all([ensureMapData(), ensureMeta(), loadCities(), loadPage(id).catch(() => null)]);
  return cityRecordFrom(id, d, m.eras, c, page, m.yearEnd);
}

export function cityRecordFrom(id: string, d: MapData, eras: Era[], c: CitiesJson, page: PageJson | null, yearEnd = 5000): CityRecord {
  const t = d.timeline.settlements.find((s) => s.id === id);
  if (!t) throw new Error(`no settlement ${id}`);
  const idx = t.idx;
  const series = page?.series?.find((s) => /popul/i.test(s.label))?.points;
  const pop = (series && series.length ? series : t.pop).map(([y, v]) => [y, v] as [number, number]);
  const names = (page?.names ?? []).map((n) => ({ year: n.year, form: n.form, lang: n.lang })).sort((a, b) => a.year - b.year);
  const legend = d.layers.political.byIdx;
  const polities: Record<number, PolityInfo> = {};
  const addPolity = (pi: number) => {
    if (pi < 0 || polities[pi]) return;
    const p = d.polityByIdx.get(pi);
    const l = legend.get(pi);
    polities[pi] = {
      idx: pi, id: p?.id ?? `pol:${pi}`, color: l?.color ?? '#8a7a66', start: l?.start ?? 0, end: l?.end ?? yearEnd,
      names: p?.names ?? [[0, l?.name ?? '']], capitals: p?.capitals ?? [], survey: c.states[pi] ?? [],
    };
  };
  const owners = c.owners[idx] ?? [t.start, -1];
  for (let i = 1; i < owners.length; i += 2) addPolity(owners[i]);
  // capital spans, from every state's list of capitals
  const capitals: [number, number, number][] = [];
  for (const p of d.timeline.polities) {
    const end = legend.get(p.idx)?.end ?? yearEnd;
    p.capitals.forEach(([y, si], i) => {
      if (si !== idx) return;
      const to = Math.min(end, i + 1 < p.capitals.length ? p.capitals[i + 1][0] : end);
      if (to > y) { capitals.push([y, to, p.idx]); addPolity(p.idx); }
    });
  }
  capitals.sort((a, b) => a[0] - b[0]);
  return {
    id, idx, name: t.name, cell: t.cell, start: t.start, end: t.end, pop, names,
    owners, cultures: c.cultures[idx] ?? [t.start, -1], sacks: (c.sacks[idx] ?? []).slice().sort((a, b) => a - b),
    port: !!c.port[idx], capitals, polities, faiths: c.faiths, peoples: c.peoples, eras, site: siteOf(d, t.cell, id), yearEnd,
  };
}

function siteOf(d: MapData, cell: number, id: string): Site {
  const { geo, world } = d;
  const nb = (i: number) => Array.from(geo.nbrs.subarray(geo.nbrStart[i], geo.nbrStart[i + 1]));
  const sx = geo.sx[cell], sy = geo.sy[cell];
  const ring1 = nb(cell);
  const ring2 = new Set<number>();
  for (const k of ring1) for (const j of nb(k)) if (j !== cell && !ring1.includes(j)) ring2.add(j);
  // the sea: which way, and how much of the city's surroundings is water
  let wx = 0, wz = 0, water1 = 0;
  const addWater = (k: number, w: number) => {
    const dx = geo.sx[k] - sx, dz = geo.sy[k] - sy, l = Math.hypot(dx, dz) || 1;
    wx += (dx / l) * w; wz += (dz / l) * w;
  };
  for (const k of ring1) if (!geo.land[k]) { water1++; addWater(k, 1); }
  for (const k of ring2) if (!geo.land[k]) addWater(k, 0.45);
  const wl = Math.hypot(wx, wz);
  const coast = water1 > 0 && wl > 1e-6 ? { dx: wx / wl, dz: wz / wl, share: water1 / ring1.length } : null;
  // a river through the city's district (or past it, in the next one)
  let river: Site['river'] = null;
  let best = -1;
  world.rivers.forEach((rv, ri) => {
    for (let i = 0; i < rv.cells.length; i++) {
      const k = rv.cells[i];
      const through = k === cell;
      if (!through && !ring1.includes(k)) continue;
      const score = (through ? 10 : 0) + rv.width[i];
      if (score <= best) continue;
      best = score;
      const a = rv.cells[Math.max(0, i - 1)], b = rv.cells[Math.min(rv.cells.length - 1, i + 1)];
      let dx = geo.sx[b] - geo.sx[a], dz = geo.sy[b] - geo.sy[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      // which side of the flow the city stands on (for a river in the next district), else from the id
      let side: number;
      if (through) side = unit(`${id}:river-side`) < 0.5 ? -1 : 1;
      else {
        const px = sx - geo.sx[k], pz = sy - geo.sy[k];
        side = px * -dz + pz * dx > 0 ? -1 : 1;
      }
      const last = i === rv.cells.length - 1;
      const next = rv.cells[i + 1];
      river = {
        id: rv.id, name: rv.name, dx, dz, side, through, width: rv.width[i],
        mouth: last || (next !== undefined && !geo.land[next]) || (!!coast && i >= rv.cells.length - 2),
        source: i === 0,
      };
    }
  });
  // relief: which way the land rises, and how steeply
  const e0 = world.elevation[cell];
  let ux = 0, uz = 0, rise = 0;
  for (const k of [...ring1, ...ring2]) {
    if (!geo.land[k]) continue;
    const de = (world.elevation[k] - e0) / 127;
    const dx = geo.sx[k] - sx, dz = geo.sy[k] - sy, l = Math.hypot(dx, dz) || 1;
    ux += (dx / l) * de; uz += (dz / l) * de;
    rise = Math.max(rise, de);
  }
  const ul = Math.hypot(ux, uz);
  const biome = world.biomes[world.biome[cell]]?.name ?? 'Steppe';
  return {
    coast, river, biome,
    elev: Math.max(0, Math.min(1, (e0 - world.seaLevel) / (255 - world.seaLevel))),
    uphill: ul > 1e-6 ? { dx: ux / ul, dz: uz / ul, k: Math.max(0, Math.min(1, rise * 4)) } : { dx: 0, dz: -1, k: 0 },
  };
}

// ---------------------------------------------------------------- the city at a year

export type TempleForm = 'ziggurat' | 'domed' | 'spired' | 'pagoda' | 'columned' | 'stupa' | 'hall';
const FORMS: TempleForm[] = ['ziggurat', 'domed', 'spired', 'pagoda', 'columned', 'stupa'];

/** A faith's temple form: from the root of its family (a sect builds like its parent), the same everywhere.
 *  Philosophies and ideologies raise halls rather than temples. */
export function templeForm(rec: Pick<CityRecord, 'faiths'>, faith: number): TempleForm | null {
  if (faith < 0 || !rec.faiths[faith]) return null;
  const kind = rec.faiths[faith][1];
  if (kind === 'philosophy' || kind === 'ideology') return 'hall';
  let root = faith;
  for (let guard = 0; guard < 40; guard++) {
    const p = rec.faiths[root]?.[2];
    if (p === undefined || p < 0) break;
    root = p;
  }
  return FORMS[hash(`mov:${root}`) % FORMS.length];
}

export interface CityYear {
  year: number;
  phase: 'site' | 'living' | 'ruin';
  pop: number;
  /** The survey behind the number: the century counts on either side. */
  survey: { y0: number; y1: number };
  /** Buildings standing, and the most in the last 150 years (the difference stands empty). */
  n: number;
  nPeak: number;
  owner: number;
  culture: number;
  faith: number;
  form: TempleForm | null;
  /** Technological age of the city's master (index into eras), from its decadal survey. */
  age: number;
  capital: { polity: number; since: number } | null;
  /** Walls stand while it is a capital and for two centuries after, until the age of engines pulls them down. */
  walls: { since: number } | null;
  /** The most recent sack within 20 years. */
  sack: { year: number; ago: number } | null;
  /** Years since abandonment (ruin phase). */
  ruinAge: number;
  name: string;
  nameLang: string;
}

/** Value of a flat [year, value, …] change list at y (the first value before its first year). */
export function stepAt(flat: number[], y: number, stride = 2, col = 1): number {
  let v = flat[col] ?? -1;
  for (let i = 0; i < flat.length; i += stride) {
    if (flat[i] <= y) v = flat[i + col];
    else break;
  }
  return v;
}

/** Population at y: linear between the century surveys; from the founding, a ramp up to the first count. */
export function popAt(rec: CityRecord, y: number): { pop: number; y0: number; y1: number } {
  const P = rec.pop;
  if (!P.length) return { pop: 0, y0: y, y1: y };
  if (y <= P[0][0]) {
    const span = Math.max(1, P[0][0] - rec.start);
    const k = Math.max(0, Math.min(1, (y - rec.start) / span));
    return { pop: P[0][1] * (0.35 + 0.65 * k), y0: P[0][0], y1: P[0][0] };
  }
  for (let i = 0; i < P.length - 1; i++) {
    if (y <= P[i + 1][0]) {
      const k = (y - P[i][0]) / (P[i + 1][0] - P[i][0]);
      return { pop: P[i][1] + (P[i + 1][1] - P[i][1]) * k, y0: P[i][0], y1: P[i + 1][0] };
    }
  }
  const l = P[P.length - 1];
  return { pop: l[1], y0: l[0], y1: l[0] };
}

/** How many buildings stand for a population (sub-linear: a drawn building stands for more people in a big city). */
export function buildingsFor(pop: number): number {
  if (pop <= 0) return 0;
  return Math.max(10, Math.min(6000, Math.round(1.4 * Math.pow(pop, 0.54))));
}

export function globalAge(rec: CityRecord, y: number): number {
  let a = 0;
  rec.eras.forEach((e, i) => { if (y >= e.start) a = i; });
  return a;
}

/** The technological age of the city's master at y (its survey), else of the world. */
export function ageAt(rec: CityRecord, y: number): number {
  const o = stepAt(rec.owners, y);
  const p = rec.polities[o];
  if (p && p.survey.length) return Math.max(0, Math.min(rec.eras.length - 1, stepAt(p.survey, y, 3, 2)));
  return globalAge(rec, y);
}

export function faithAt(rec: CityRecord, y: number): number {
  const o = stepAt(rec.owners, y);
  const p = rec.polities[o];
  return p && p.survey.length ? stepAt(p.survey, y, 3, 1) : -1;
}

export function capitalAt(rec: CityRecord, y: number): { polity: number; since: number } | null {
  let out: { polity: number; since: number } | null = null;
  for (const [a, b, p] of rec.capitals) if (y >= a && y < b) out = { polity: p, since: a };
  // continuous spans under successive states count from the first
  if (out) {
    let since = out.since;
    for (let i = rec.capitals.length - 1; i >= 0; i--) {
      const [a, b] = rec.capitals[i];
      if (a < since && b >= since - 1) since = a;
    }
    out.since = since;
  }
  return out;
}

export function polityName(rec: CityRecord, idx: number, y: number): string {
  const p = rec.polities[idx];
  if (!p) return '';
  let name = p.names[0]?.[1] ?? '';
  for (const [yy, nm] of p.names) { if (yy <= y) name = nm; else break; }
  return name;
}

export function nameAt(rec: CityRecord, y: number): { form: string; lang: string } {
  let out = { form: rec.name, lang: '' };
  if (rec.names.length) out = { form: rec.names[0].form, lang: rec.names[0].lang };
  for (const n of rec.names) { if (n.year <= y) out = { form: n.form, lang: n.lang }; else break; }
  return out;
}

export const WALL_YEARS = 200;
export const SACK_YEARS = 20;

export function cityAt(rec: CityRecord, year: number): CityYear {
  const y = Math.round(year);
  const phase: CityYear['phase'] = y < rec.start ? 'site' : y > rec.end && rec.end < rec.yearEnd ? 'ruin' : 'living';
  const yy = Math.min(y, rec.end);
  const p = popAt(rec, yy);
  let n = phase === 'site' ? 0 : buildingsFor(p.pop);
  let nPeak = n;
  for (let k = 10; k <= 150; k += 10) {
    if (yy - k < rec.start) break;
    nPeak = Math.max(nPeak, buildingsFor(popAt(rec, yy - k).pop));
  }
  if (phase === 'ruin') { nPeak = Math.max(nPeak, n); n = 0; }
  const owner = phase === 'living' ? stepAt(rec.owners, yy) : -1;
  const faith = phase === 'living' ? faithAt(rec, yy) : -1;
  const age = ageAt(rec, yy);
  const capital = phase === 'living' ? capitalAt(rec, yy) : null;
  // walls: raised when it became a capital, kept two centuries after, gone in the age of engines
  let walls: CityYear['walls'] = null;
  if (age < 5) {
    if (capital) walls = { since: capital.since };
    else {
      for (const [a, b] of rec.capitals) if (b <= yy && yy - b < WALL_YEARS) walls = { since: capitalAt(rec, a)?.since ?? a };
    }
  }
  let sack: CityYear['sack'] = null;
  for (const s of rec.sacks) if (s <= yy && yy - s <= SACK_YEARS) sack = { year: s, ago: yy - s };
  const nm = nameAt(rec, yy);
  return {
    year: y, phase, pop: phase === 'living' ? p.pop : 0, survey: { y0: p.y0, y1: p.y1 }, n, nPeak,
    owner, culture: stepAt(rec.cultures, yy), faith, form: templeForm(rec, faith), age, capital, walls, sack,
    ruinAge: phase === 'ruin' ? y - rec.end : 0, name: nm.form, nameLang: nm.lang,
  };
}
