// Geometry for the Histomap: every state a stream whose width is its share of the world's people,
// ordered west → east. Shared by the full vertical chart and the compact horizontal thumbnail.

import type { HistomapJson } from '../../engine/src/export/contract.ts';
import { fetchJson } from './data.ts';

export type HSeries = HistomapJson['series'][number];

export interface Stream {
  s: HSeries;
  /** sample indices a..b (inclusive) including zero-width taper points */
  idx: number[];
  /** left/right edge as a fraction of the full width, per entry in idx */
  x0: number[];
  x1: number[];
  /** per sample: widest point */
  peak: number;
}

let histP: Promise<HistomapJson> | null = null;
export function loadHistomap(): Promise<HistomapJson> {
  if (!histP) { histP = fetchJson<HistomapJson>('histomap.json').then(clean); histP.catch(() => { histP = null; }); }
  return histP;
}

/** Drop samples where no share was recorded at all (gaps in the export), keeping streams continuous. */
function clean(h: HistomapJson): HistomapJson {
  const keep: number[] = [];
  for (let i = 0; i < h.years.length; i++) {
    let sum = 0;
    for (const s of h.series) sum += s.share[i] ?? 0;
    if (sum > 0.001) keep.push(i);
  }
  if (keep.length === h.years.length) return h;
  return {
    years: keep.map((i) => h.years[i]),
    worldPop: keep.map((i) => h.worldPop[i] ?? 0),
    series: h.series.map((s) => ({ ...s, share: keep.map((i) => s.share[i] ?? 0) })),
  };
}

/** Stack the named streams west→east, centred, with "lesser states" split to both edges. */
export function buildStreams(h: HistomapJson): { streams: Stream[]; other?: HSeries; lesser: { left: number[]; right: number[] } } {
  const n = h.years.length;
  const other = h.series.find((s) => !s.id.startsWith('pol:'));
  const named = h.series.filter((s) => s !== other).sort((a, b) => a.order - b.order);
  const left = new Array<number>(n).fill(0), right = new Array<number>(n).fill(1);
  // cumulative left edge of each named series at each sample
  const pos = named.map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    const rest = other ? other.share[i] : Math.max(0, 1 - named.reduce((s, x) => s + x.share[i], 0));
    let x = rest / 2;
    left[i] = x;
    for (let k = 0; k < named.length; k++) { pos[k][i] = x; x += named[k].share[i]; }
    right[i] = x;
  }
  const streams: Stream[] = [];
  named.forEach((s, k) => {
    let a = -1, b = -1;
    for (let i = 0; i < n; i++) if (s.share[i] > 0) { if (a < 0) a = i; b = i; }
    if (a < 0) return;
    const from = Math.max(0, a - 1), to = Math.min(n - 1, b + 1);
    const idx: number[] = [], x0: number[] = [], x1: number[] = [];
    let peak = a;
    for (let i = from; i <= to; i++) {
      idx.push(i);
      x0.push(pos[k][i]);
      x1.push(pos[k][i] + s.share[i]);
      if (s.share[i] > s.share[peak]) peak = i;
    }
    streams.push({ s, idx, x0, x1, peak });
  });
  return { streams, other, lesser: { left, right } };
}

/** Smooth path through points with a Catmull-Rom spline (as cubic Béziers). */
export function smooth(pts: [number, number][], move = true): string {
  if (!pts.length) return '';
  const f = (v: number) => v.toFixed(1);
  let d = move ? `M${f(pts[0][0])},${f(pts[0][1])}` : `L${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

/** Closed outline of a stream. `vertical`: time runs down (x = share); otherwise time runs right. */
export function streamPath(st: Stream, years: number[], X: (frac: number) => number, T: (year: number) => number, vertical = true): string {
  const a: [number, number][] = [], b: [number, number][] = [];
  for (let k = 0; k < st.idx.length; k++) {
    const t = T(years[st.idx[k]]);
    if (vertical) { a.push([X(st.x0[k]), t]); b.push([X(st.x1[k]), t]); }
    else { a.push([t, X(st.x0[k])]); b.push([t, X(st.x1[k])]); }
  }
  b.reverse();
  return `${smooth(a)}${smooth(b, false)}Z`;
}

export function shareAt(s: HSeries, years: number[], year: number): number {
  let i = 0;
  while (i < years.length - 1 && years[i + 1] <= year) i++;
  return s.share[i] ?? 0;
}
