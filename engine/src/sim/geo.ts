// Spatial helpers over the cell graph.
import type { State } from './state.ts';

export interface Geo {
  regionCells: number[][];
  landCells: number[];
}

export function buildGeo(s: State): Geo {
  const w = s.world;
  const regionCells: number[][] = Array.from({ length: w.regionCount }, () => []);
  const landCells: number[] = [];
  for (let i = 0; i < w.n; i++) {
    if (!w.land[i]) continue;
    landCells.push(i);
    if (w.region[i] >= 0) regionCells[w.region[i]].push(i);
  }
  return { regionCells, landCells };
}

/** Cells per polity (fresh scan). */
export function polityCells(s: State): Map<number, number[]> {
  const m = new Map<number, number[]>();
  const w = s.world;
  for (let i = 0; i < w.n; i++) {
    const o = s.owner[i];
    if (o < 0) continue;
    let a = m.get(o);
    if (!a) m.set(o, (a = []));
    a.push(i);
  }
  return m;
}

/** Map polity -> set of polities sharing a land border. */
export function borders(s: State): Map<number, Map<number, number>> {
  const m = new Map<number, Map<number, number>>();
  const w = s.world;
  for (let i = 0; i < w.n; i++) {
    const a = s.owner[i];
    if (a < 0) continue;
    for (const k of w.neighbors[i]) {
      const b = s.owner[k];
      if (b < 0 || b === a) continue;
      let ma = m.get(a);
      if (!ma) m.set(a, (ma = new Map()));
      ma.set(b, (ma.get(b) ?? 0) + 1);
    }
  }
  return m;
}

/** Hop distance from a source cell over land (or all cells if `allowSea`), up to maxHops. */
export function hopDistances(s: State, src: number, maxHops: number, filter?: (c: number) => boolean): Map<number, number> {
  const d = new Map<number, number>([[src, 0]]);
  let frontier = [src];
  for (let h = 1; h <= maxHops && frontier.length; h++) {
    const next: number[] = [];
    for (const f of frontier) {
      for (const k of s.world.neighbors[f]) {
        if (d.has(k)) continue;
        if (filter && !filter(k)) continue;
        d.set(k, h);
        next.push(k);
      }
    }
    frontier = next;
  }
  return d;
}

export function dist(s: State, a: number, b: number): number {
  return Math.hypot(s.world.x[a] - s.world.x[b], s.world.y[a] - s.world.y[b]);
}

/** Connected components of a cell set (by adjacency). Largest first. */
export function components(s: State, cells: number[]): number[][] {
  const set = new Set(cells);
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const c of cells) {
    if (seen.has(c)) continue;
    const comp: number[] = [];
    const stack = [c];
    seen.add(c);
    while (stack.length) {
      const x = stack.pop()!;
      comp.push(x);
      for (const k of s.world.neighbors[x]) if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
    }
    out.push(comp);
  }
  return out.sort((a, b) => b.length - a.length || a[0] - b[0]);
}

export function majority(values: Int32Array, cells: number[], weights?: Float32Array): number {
  const m = new Map<number, number>();
  for (const c of cells) {
    const v = values[c];
    if (v < 0) continue;
    m.set(v, (m.get(v) ?? 0) + (weights ? weights[c] : 1));
  }
  let best = -1, bw = -1;
  for (const [v, w] of m) if (w > bw || (w === bw && v < best)) { best = v; bw = w; }
  return best;
}
