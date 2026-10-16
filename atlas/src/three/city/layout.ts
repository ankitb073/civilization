// Cities in 3D: the plan of a city over its whole life, laid out once per record and deterministically (hashes of
// its id; never Math.random). Units are lots (one drawn building's plot); x east, z south, as on the map.
//
// The town grows outward from its temple square in districts four lots wide. Each district is laid out in the street
// pattern of the people who held the city's ground when the town first reached it (a grid, rings and spokes, winding
// lanes or courtyard blocks), so an old core can sit inside suburbs of another people's making. Every lot gets a
// growth key (distance, pulled along the main roads and the waterfront, plus a little noise); the city at any year
// is the first N lots by that key, so AY 2000 always contains AY 1000's core.

import { type CityRecord, buildingsFor, hash, popAt, stepAt, unit, stream } from './record.ts';
import { streetsOf, type Pattern } from './style.ts';

export interface Slot {
  x: number;
  z: number;
  r: number;
  ang: number;
  sector: number;
  rot: number;
  /** footprint (fraction of a lot) */
  w: number;
  d: number;
  h1: number;
  h2: number;
  h3: number;
  /** years this lot lags behind a change of age or people before it is rebuilt */
  lag: number;
  key: number;
  pattern: Pattern;
}

export interface RiverPlan {
  ox: number; oz: number; // a point on the axis
  fx: number; fz: number; // flow direction
  nx: number; nz: number; // normal (the side the city stands on is +)
  half: number;
  a1: number; a2: number; p1: number; p2: number; // meander
  calm: number; // meander damped within this distance of the axis point
  uMin: number; // upstream end (the source), or -Infinity
}

export interface Layout {
  slots: Slot[];
  plazaR: number;
  palace: { x: number; z: number; rot: number; w: number; d: number } | null;
  roads: number[];
  rings: number[];
  railAng: number;
  industryAng: number;
  coast: { cx: number; cz: number; s0: number; bow: number; a1: number; a2: number; p1: number; p2: number } | null;
  river: RiverPlan | null;
  /** most lots the city ever needs */
  maxN: number;
  /** radius holding the first n lots (92nd percentile), for each n in steps of 8 */
  radiusAt: (n: number) => number;
}

export const SECTORS = 64;
const TAU = Math.PI * 2;

function ihash(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in 0..1. */
export function vnoise(x: number, y: number, s: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = ihash(ix, iy, s), b = ihash(ix + 1, iy, s), c = ihash(ix, iy + 1, s), d = ihash(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Signed distance into the sea (positive = water) and the shore's lateral coordinate. */
export function seaDepth(L: Layout, x: number, z: number): number {
  const c = L.coast;
  if (!c) return -1e9;
  const along = x * c.cx + z * c.cz;
  const t = -x * c.cz + z * c.cx;
  return along - shoreAt(L, t);
}
export function shoreAt(L: Layout, t: number): number {
  const c = L.coast!;
  const bow = Math.max(-c.s0 * 0.55, Math.min(12, c.bow * t * t));
  return c.s0 + bow + c.a1 * Math.sin(t / 9.5 + c.p1) + c.a2 * Math.sin(t / 4.3 + c.p2);
}
/** Distance from the river's centreline minus its half-width (negative = in the river), and the along-flow coordinate. */
export function riverDist(L: Layout, x: number, z: number): { d: number; u: number } {
  const R = L.river;
  if (!R) return { d: 1e9, u: 0 };
  const px = x - R.ox, pz = z - R.oz;
  const u = px * R.fx + pz * R.fz;
  const s = px * R.nx + pz * R.nz;
  if (u < R.uMin) return { d: Math.hypot(u - R.uMin, s) + 1, u };
  return { d: Math.abs(s - meander(R, u)) - R.half, u };
}
export function meander(R: RiverPlan, u: number): number {
  const damp = Math.min(1, Math.abs(u) / R.calm);
  return (R.a1 * Math.sin(u / 8.5 + R.p1) + R.a2 * Math.sin(u / 3.4 + R.p2)) * damp * damp;
}
/** 0 land, 1 sea, 2 river. */
export function waterAt(L: Layout, x: number, z: number, margin = 0): number {
  if (seaDepth(L, x, z) > -margin) return 1;
  if (riverDist(L, x, z).d < margin) return 2;
  return 0;
}

const layouts = new WeakMap<CityRecord, Layout>();
export function layoutOf(rec: CityRecord): Layout {
  let L = layouts.get(rec);
  if (!L) { L = buildLayout(rec); layouts.set(rec, L); }
  return L;
}

function buildLayout(rec: CityRecord): Layout {
  const id = rec.id;
  const site = rec.site;

  // ---- most lots it ever needs
  let maxN = 0;
  const years: number[] = [rec.start, ...rec.pop.map((p) => p[0])].filter((y) => y >= rec.start && y <= rec.end);
  for (const y of years) maxN = Math.max(maxN, buildingsFor(popAt(rec, y).pop));
  maxN = Math.max(maxN, 12);
  // the sacred square is laid out for the city the town will become (its greatest population on record)
  const peakPop = Math.max(1000, ...rec.pop.map((p) => p[1]));
  const plazaR = Math.max(2.3, Math.min(4.1, 2.3 + 0.5 * Math.log10(peakPop / 4000))) + unit(`${id}:plaza`) * 0.3;

  // ---- the sea and the river
  let coast: Layout['coast'] = null;
  if (site.coast) {
    const r = stream(`${id}:coast`);
    const share = site.coast.share;
    coast = {
      cx: site.coast.dx, cz: site.coast.dz,
      s0: rec.port ? plazaR + 2.2 + r() * 1.2 : plazaR + 3 + (1 - share) * 5 + r() * 2,
      // a harbour bay for a port; a headland when the sea is all around
      bow: share > 0.55 ? -0.006 - share * 0.006 : rec.port ? 0.0045 + r() * 0.004 : 0.002,
      a1: 1.4 + r() * 1.6, a2: 0.4 + r() * 0.7, p1: r() * TAU, p2: r() * TAU,
    };
  }
  let river: RiverPlan | null = null;
  if (site.river) {
    const rv = site.river;
    const r = stream(`${id}:river`);
    let fx = rv.dx, fz = rv.dz;
    if (rv.mouth && coast && fx * coast.cx + fz * coast.cz < 0.25) {
      fx += coast.cx * 1.4; fz += coast.cz * 1.4;
      const l = Math.hypot(fx, fz); fx /= l; fz /= l;
    }
    const half = 0.5 + 0.2 * rv.width;
    const off = rv.through ? plazaR + half + 0.9 + r() * 0.8 : 7 + r() * 3;
    const nx = -fz * rv.side, nz = fx * rv.side;
    river = {
      ox: -nx * off, oz: -nz * off, fx, fz, nx, nz, half,
      a1: 1 + r() * 1.4, a2: 0.25 + r() * 0.45, p1: r() * TAU, p2: r() * TAU, calm: 5,
      uMin: rv.source ? -2 : -Infinity,
    };
  }
  const L0: Layout = {
    slots: [], plazaR, palace: null, roads: [], rings: [], railAng: 0, industryAng: 0, coast, river, maxN,
    radiusAt: () => 0,
  };

  // ---- main roads out of town (none into the sea), the rail line and the works
  const rr = stream(`${id}:roads`);
  const nRoads = 3 + Math.floor(rr() * 3) + (rec.capitals.length ? 1 : 0);
  const a0 = rr() * TAU;
  const roads: number[] = [];
  for (let i = 0; i < nRoads; i++) {
    const a = a0 + (i / nRoads) * TAU + (rr() - 0.5) * 0.5;
    const dx = Math.cos(a), dz = Math.sin(a);
    if (coast && dx * coast.cx + dz * coast.cz > 0.3) continue;
    roads.push(a);
  }
  if (roads.length < 2 && coast) {
    const a = Math.atan2(-coast.cz, -coast.cx);
    roads.push(a + 0.9, a - 0.9);
  }
  L0.roads = roads;
  const landAng = coast ? Math.atan2(-coast.cz, -coast.cx) : a0 + Math.PI / nRoads;
  L0.railAng = landAng + (unit(`${id}:rail`) - 0.5) * 1.4;
  L0.industryAng = L0.railAng + (unit(`${id}:works`) < 0.5 ? -0.55 : 0.55);

  // ring roads (where walls stand)
  const rings: number[] = [];
  for (let r = plazaR + 3.4; r < 160; r = r * 1.13 + 2.4) rings.push(r);
  L0.rings = rings;

  // the palace: reserved from the start in a city the record makes a capital
  if (rec.capitals.length) {
    const rp = stream(`${id}:palace`);
    const pw = 1.3 * plazaR, pd = 0.95 * plazaR, pr = plazaR + pw / 2 + 0.25;
    let best: { a: number; s: number } | null = null;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU + rp() * 0.2;
      const cx = Math.cos(a) * pr, cz = Math.sin(a) * pr;
      let s = rp() * 0.3;
      if (waterAt(L0, cx, cz, pw * 0.7)) s += 10;
      for (const ra of roads) s += Math.max(0, Math.cos(a - ra) - 0.85) * 8;
      if (!best || s < best.s) best = { a, s };
    }
    const a = best!.a;
    L0.palace = { x: Math.cos(a) * pr, z: Math.sin(a) * pr, rot: -a, w: pw, d: pd };
  }

  // ---- districts, each in its people's pattern
  const DW = 4;
  const slots: Slot[] = [];
  const density = coast ? 0.55 * (1 - 0.42 * (site.coast?.share ?? 0)) : 0.55;
  let district = 0;
  const genTo = (need: number, y: number) => {
    while (slots.length < need * 1.12 + 16 && district < 60) {
      const culture = stepAt(rec.cultures, y);
      district++;
      genDistrict(rec, L0, slots, (district - 1) * DW, district * DW, culture);
    }
  };
  for (const y of years.sort((a, b) => a - b)) {
    const need = buildingsFor(popAt(rec, y).pop);
    // districts are reached in the order the town's radius reaches them
    const rad = Math.sqrt(need / (Math.PI * density));
    while (district * DW < rad + 2 && district < 60) {
      district++;
      genDistrict(rec, L0, slots, (district - 1) * DW, district * DW, stepAt(rec.cultures, y));
    }
    genTo(need, y);
  }
  genTo(maxN, rec.end);

  // ---- growth order
  for (const s of slots) {
    let road = 0;
    for (const a of roads) {
      const along = s.x * Math.cos(a) + s.z * Math.sin(a);
      if (along <= 0) continue;
      const perp = Math.abs(-s.x * Math.sin(a) + s.z * Math.cos(a));
      road = Math.max(road, Math.exp(-((perp / 2.6) ** 2)));
    }
    let shore = 0;
    if (coast) shore = Math.exp(-(((seaDepth(L0, s.x, s.z) + 1.5) / 3.5) ** 2)) * (rec.port ? 1 : 0.4);
    if (river) shore = Math.max(shore, 0.7 * Math.exp(-(((riverDist(L0, s.x, s.z).d + 0.5) / 3) ** 2)));
    s.key = s.r * (1 - 0.16 * road - 0.12 * shore) + 1.3 * (s.h1 - 0.5);
  }
  slots.sort((a, b) => a.key - b.key);
  L0.slots = slots;
  const rs: number[] = [];
  const sorted: number[] = [];
  for (let i = 0; i < slots.length; i += 8) {
    for (let j = i; j < Math.min(slots.length, i + 8); j++) {
      const r = slots[j].r;
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < r) lo = m + 1; else hi = m; }
      sorted.splice(lo, 0, r);
    }
    rs.push(sorted[Math.floor(sorted.length * 0.92)] ?? plazaR);
  }
  L0.radiusAt = (n: number) => (n <= 0 ? plazaR : rs[Math.min(rs.length - 1, Math.floor((n - 1) / 8))] ?? plazaR);
  return L0;
}

function genDistrict(rec: CityRecord, L: Layout, out: Slot[], r0: number, r1: number, culture: number) {
  const { pattern, angle } = streetsOf(culture);
  const id = rec.id;
  const seed = hash(`${id}:lots`) & 0xffff;
  const push = (x: number, z: number, rot: number, w: number, d: number) => {
    const r = Math.hypot(x, z);
    if (r < r0 || r >= r1) return;
    if (!lotFree(L, x, z, rec.port)) return;
    const qx = Math.round(x * 8), qz = Math.round(z * 8);
    const h1 = ihash(qx, qz, seed), h2 = ihash(qx, qz, seed + 1), h3 = ihash(qx, qz, seed + 2);
    let ang = Math.atan2(z, x);
    if (ang < 0) ang += TAU;
    const lag = 8 + 90 * h3 * h3 + 140 * Math.exp(-r / 5) * h2;
    out.push({ x, z, r, ang, sector: Math.floor((ang / TAU) * SECTORS) % SECTORS, rot, w, d, h1, h2, h3, lag, key: 0, pattern });
  };
  const ext = Math.ceil(r1) + 2;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const fromUV = (u: number, v: number): [number, number] => [u * ca - v * sa, u * sa + v * ca];
  if (pattern === 'grid' || pattern === 'courtyard') {
    const bx = pattern === 'courtyard' ? 3 : 2 + (hash(`cul:${culture}:bx`) % 2);
    const by = pattern === 'courtyard' ? 3 : 3 + (hash(`cul:${culture}:by`) % 2);
    for (let i = -ext; i <= ext; i++) {
      const mi = ((i % (bx + 1)) + bx + 1) % (bx + 1);
      if (mi === bx) continue;
      for (let j = -ext; j <= ext; j++) {
        const mj = ((j % (by + 1)) + by + 1) % (by + 1);
        if (mj === by) continue;
        if (pattern === 'courtyard' && mi === 1 && mj === 1) continue;
        const u = i + 0.5, v = j + 0.5;
        if (Math.abs(u) < 1.0 || Math.abs(v) < 1.0) continue; // the two main axes
        const [x, z] = fromUV(u, v);
        push(x, z, -angle, 0.84, 0.86);
      }
    }
  } else if (pattern === 'radial') {
    const spokes = 6 + (hash(`cul:${culture}:spokes`) % 5);
    for (let m = 0; ; m++) {
      if (m % 3 === 2) continue;
      const r = L.plazaR + 0.75 + m * 1.04;
      if (r > r1 + 1) break;
      if (r < r0 - 1) continue;
      const count = Math.max(6, Math.floor((TAU * r) / 1.02));
      const off = ihash(m, 7, seed) * TAU;
      for (let k = 0; k < count; k++) {
        const a = off + (k / count) * TAU;
        let near = false;
        for (let s = 0; s < spokes; s++) {
          const sa2 = angle + (s / spokes) * TAU;
          let da = Math.abs(((a - sa2) % TAU + TAU) % TAU);
          da = Math.min(da, TAU - da);
          if (da * r < 0.62) { near = true; break; }
        }
        if (near) continue;
        push(Math.cos(a) * r, Math.sin(a) * r, -a + Math.PI / 2, 0.82, 0.8);
      }
    }
  } else {
    // organic: a jittered lattice, cut by winding lanes (iso-lines of two noise fields)
    const step = 1.06;
    for (let j = -Math.ceil(ext / (step * 0.866)); j <= Math.ceil(ext / (step * 0.866)); j++) {
      for (let i = -Math.ceil(ext / step); i <= Math.ceil(ext / step); i++) {
        const jx = ihash(i, j, seed + 5) - 0.5, jz = ihash(i, j, seed + 6) - 0.5;
        const x = (i + (j & 1 ? 0.5 : 0)) * step + jx * 0.3, z = j * step * 0.866 + jz * 0.3;
        const n1 = vnoise(x / 4.6, z / 4.6, seed + 11), n2 = vnoise(x / 7.5 + 3, z / 7.5, seed + 12);
        if (Math.abs(n1 - 0.5) < 0.055 || Math.abs(n2 - 0.5) < 0.04) continue;
        if (ihash(i, j, seed + 7) < 0.1) continue;
        const gx = vnoise((x + 0.3) / 4.6, z / 4.6, seed + 11) - n1, gz = vnoise(x / 4.6, (z + 0.3) / 4.6, seed + 11) - n1;
        push(x, z, -Math.atan2(gz, gx), 0.78, 0.8);
      }
    }
  }
}

function lotFree(L: Layout, x: number, z: number, port: boolean): boolean {
  const r = Math.hypot(x, z);
  if (r < L.plazaR + 0.45) return false;
  const P = L.palace;
  if (P) {
    const dx = x - P.x, dz = z - P.z;
    const c = Math.cos(P.rot), s = Math.sin(P.rot);
    const u = dx * c - dz * s, v = dx * s + dz * c;
    if (Math.abs(u) < P.w / 2 + 0.6 && Math.abs(v) < P.d / 2 + 0.6) return false;
  }
  if (L.coast && seaDepth(L, x, z) > (port ? -1.5 : -0.75)) return false;
  if (L.river && riverDist(L, x, z).d < 0.75) return false;
  for (const a of L.roads) {
    const along = x * Math.cos(a) + z * Math.sin(a);
    if (along < 0) continue;
    if (Math.abs(-x * Math.sin(a) + z * Math.cos(a)) < 0.72) return false;
  }
  for (const R of L.rings) if (Math.abs(r - R) < 0.62) return false;
  return true;
}
