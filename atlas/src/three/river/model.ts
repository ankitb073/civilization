// The River of Time's model: every Histomap stream resampled to fine rows (every ROW years), with its edges as a
// fraction of the valley's width (its share of the world's people, or of its land), and its height (its share of
// the world's soldiers, from the decade surveys). Pure data, no three.js: the scene and the picker both read it.

import type { ArmsSpec, RiverJson } from '../../../../engine/src/export/contract.ts';
import { fetchJson } from '../../data.ts';

export type WidthMode = 'people' | 'land';
/** Years per mesh row. */
export const ROW = 5;
export const YEAR_END = 5000;
export const ROWS = YEAR_END / ROW + 1;

export interface RStream {
  k: number;                 // index in Model.streams (west → east)
  id: string;
  name: string;
  color: string;
  start: number;
  end: number;
  arms?: ArmsSpec;
  /** first and last row (inclusive; the ends are the zero-width taper) */
  r0: number;
  r1: number;
  /** per row r0..r1: left and right edge (0..1 of the valley), height (share of the world's soldiers) */
  x0: Float32Array;
  x1: Float32Array;
  h: Float32Array;
  /** the row of the highest point so far, per row (the arms float there) */
  best: Int32Array;
  /** widest it ever got (0..1), for mesh resolution */
  maxW: number;
  /** per survey sample (index into Model.years): people share, districts, soldiers */
  pop: Float32Array;
  cells: Float32Array;
  army: Float32Array;
}

export interface Model {
  mode: WidthMode;
  years: number[];
  worldPop: number[];
  worldArmy: number[];
  land: number;
  streams: RStream[];
  /** per row: indices of the streams with any width there, west → east */
  alive: Int32Array[];
  stones: RiverJson['stones'];
  /** tallest height anywhere (share of the world's soldiers) */
  maxH: number;
}

export interface Sources { r: RiverJson }

let srcP: Promise<Sources> | null = null;
export function loadSources(): Promise<Sources> {
  if (!srcP) {
    srcP = fetchJson<RiverJson>('river.json').then((r) => ({ r }));
    srcP.catch(() => { srcP = null; });
  }
  return srcP;
}

/** Sample position of a year: index i and fraction t between years[i] and years[i+1]. */
function samplePos(years: number[], y: number): [number, number] {
  const n = years.length;
  if (y <= years[0]) return [0, 0];
  if (y >= years[n - 1]) return [n - 1, 0];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (years[m] <= y) lo = m; else hi = m; }
  return [lo, (y - years[lo]) / (years[hi] - years[lo])];
}

/** Catmull-Rom through a sampled series (clamped at the ends). */
function cr(a: ArrayLike<number>, i: number, t: number): number {
  const n = a.length;
  const p1 = a[i], p2 = a[Math.min(n - 1, i + 1)];
  if (t === 0) return p1;
  const p0 = a[Math.max(0, i - 1)], p3 = a[Math.min(n - 1, i + 2)];
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function buildModel(src: Sources, mode: WidthMode): Model {
  const { r } = src;
  const years = r.years;
  const n = years.length;
  const full = (vals: number[], i0: number) => { const a = new Float32Array(n); for (let j = 0; j < vals.length; j++) a[i0 + j] = vals[j]; return a; };
  const named = r.series.filter((s) => s.id.startsWith('pol:')).sort((a, b) => a.order - b.order);
  const other = r.series.find((s) => !s.id.startsWith('pol:'));
  const otherShare = other ? full(other.share, other.i0) : null;
  const N = named.length;
  const worldArmy = r.army;
  const raw = named.map((s) => ({ s, pop: full(s.share, s.i0), cells: full(s.cells, s.i0), army: full(s.army, s.i0) }));
  // widths per sample
  const share = raw.map((x) => (mode === 'people' ? x.pop : x.cells.map((c) => c / r.land)));
  // left edges of every stream (and the right edge of the last), centred: lesser states split to both margins
  const B: Float32Array[] = Array.from({ length: N + 1 }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < N; k++) sum += share[k][i];
    const rest = mode === 'people' && otherShare ? otherShare[i] : Math.max(0, 1 - sum);
    let x = Math.max(0, (1 - sum - rest) / 2) + rest / 2;
    for (let k = 0; k < N; k++) { B[k][i] = x; x += share[k][i]; }
    B[N][i] = x;
  }
  const H = raw.map((x) => x.army.map((a, i) => (worldArmy[i] > 0 ? a / worldArmy[i] : 0)));

  // resample to rows: boundaries by Catmull-Rom (kept in order), heights likewise (never negative)
  const rowB: Float32Array[] = Array.from({ length: N + 1 }, () => new Float32Array(ROWS));
  const rowH: Float32Array[] = Array.from({ length: N }, () => new Float32Array(ROWS));
  for (let ri = 0; ri < ROWS; ri++) {
    const [i, t] = samplePos(years, ri * ROW);
    let prev = 0;
    for (let k = 0; k <= N; k++) {
      const v = Math.max(prev, cr(B[k], i, t));
      rowB[k][ri] = v;
      prev = v;
    }
    for (let k = 0; k < N; k++) {
      const w = rowB[k + 1][ri] - rowB[k][ri];
      // a stream with no recorded share at either neighbouring sample has no width
      const live = share[k][i] > 0 || share[k][Math.min(n - 1, i + 1)] > 0;
      rowH[k][ri] = live && w > 1e-6 ? Math.max(0, cr(H[k], i, t)) : 0;
      if (!live) rowB[k + 1][ri] = rowB[k][ri];
    }
    // re-close: a dead stream collapsed its right edge onto its left; shift the rest so edges stay shared
    for (let k = 0; k < N; k++) if (rowB[k + 1][ri] < rowB[k][ri]) rowB[k + 1][ri] = rowB[k][ri];
  }

  const streams: RStream[] = [];
  const alive: number[][] = Array.from({ length: ROWS }, () => []);
  let maxH = 0;
  for (let k = 0; k < N; k++) {
    let a = -1, b = -1;
    for (let ri = 0; ri < ROWS; ri++) if (rowB[k + 1][ri] - rowB[k][ri] > 1e-5) { if (a < 0) a = ri; b = ri; }
    if (a < 0) continue;
    const r0 = Math.max(0, a - 1), r1 = Math.min(ROWS - 1, b + 1);
    const len = r1 - r0 + 1;
    const x0 = new Float32Array(len), x1 = new Float32Array(len), hh = new Float32Array(len), best = new Int32Array(len);
    let maxW = 0, bi = 0;
    for (let j = 0; j < len; j++) {
      const ri = r0 + j;
      x0[j] = rowB[k][ri];
      x1[j] = rowB[k + 1][ri];
      const w = x1[j] - x0[j];
      // no height without width: births and deaths taper to the floor
      hh[j] = w > 1e-5 ? rowH[k][ri] : 0;
      maxW = Math.max(maxW, w);
      if (hh[j] > hh[bi]) bi = j;
      best[j] = r0 + bi;
      maxH = Math.max(maxH, hh[j]);
    }
    const st: RStream = {
      k: streams.length, id: raw[k].s.id, name: raw[k].s.name, color: raw[k].s.color, start: raw[k].s.start, end: raw[k].s.end,
      arms: raw[k].s.arms, r0, r1, x0, x1, h: hh, best, maxW, pop: raw[k].pop, cells: raw[k].cells, army: raw[k].army,
    };
    for (let ri = a; ri <= b; ri++) if (rowB[k + 1][ri] - rowB[k][ri] > 1e-5) alive[ri].push(st.k);
    streams.push(st);
  }
  return {
    mode, years, worldPop: r.pop, worldArmy, land: r.land, streams,
    alive: alive.map((l) => Int32Array.from(l)), stones: r.stones, maxH,
  };
}

/** A stream's edges and height at a (fractional) row, linearly between rows; null outside its life. */
export function streamAt(st: RStream, row: number): { x0: number; x1: number; h: number } | null {
  if (row < st.r0 || row > st.r1) return null;
  const j = Math.min(st.r1 - st.r0, Math.floor(row - st.r0));
  const t = Math.min(1, row - st.r0 - j);
  const j2 = Math.min(st.r1 - st.r0, j + 1);
  return {
    x0: st.x0[j] + (st.x0[j2] - st.x0[j]) * t,
    x1: st.x1[j] + (st.x1[j2] - st.x1[j]) * t,
    h: st.h[j] + (st.h[j2] - st.h[j]) * t,
  };
}

/** Survey values at a year (the decade survey at or before it). */
export function surveyAt(m: Model, st: RStream, year: number) {
  const [i] = samplePos(m.years, year);
  return {
    year: m.years[i], pop: st.pop[i], people: st.pop[i] * (m.worldPop[i] ?? 0), cells: st.cells[i], army: st.army[i],
    armyShare: m.worldArmy[i] > 0 ? st.army[i] / m.worldArmy[i] : 0,
  };
}

/** The survey where the stream stood tallest (its largest share of the world's soldiers). */
export function peakOf(m: Model, st: RStream) {
  let bi = -1, bv = -1;
  for (let i = 0; i < m.years.length; i++) {
    const v = m.worldArmy[i] > 0 ? st.army[i] / m.worldArmy[i] : 0;
    if (st.army[i] > 0 && v > bv) { bv = v; bi = i; }
  }
  if (bi < 0) return null;
  return { year: m.years[bi], army: st.army[bi], armyShare: bv, pop: st.pop[bi], cells: st.cells[bi] };
}
