import { signal } from '@preact/signals';
import type { EntityKind } from '../../../engine/src/export/contract.ts';
import { KINDS } from '../kinds.ts';
import type { GraphPacked } from './worker.ts';

export interface GraphData extends GraphPacked {
  index: Map<string, number>;
  kindOf: (i: number) => EntityKind;
  neighbors: (i: number) => Int32Array;
  degree: (i: number) => number;
  loadMs: number;
}

export const graphStatus = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
export const graphError = signal<string | null>(null);
let p: Promise<GraphData> | null = null;

export function loadGraphData(): Promise<GraphData> {
  if (p) return p;
  graphStatus.value = 'loading';
  const started = performance.now();
  p = new Promise<GraphData>((resolve, reject) => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ ok: boolean; packed?: GraphPacked; error?: string }>) => {
      w.terminate();
      if (!e.data.ok || !e.data.packed) { reject(new Error(e.data.error ?? 'graph worker failed')); return; }
      const g = e.data.packed;
      const index = new Map<string, number>();
      for (let i = 0; i < g.n; i++) index.set(g.ids[i], i);
      resolve({
        ...g, index,
        kindOf: (i) => KINDS[g.kind[i]],
        neighbors: (i) => g.nbr.subarray(g.off[i], g.off[i + 1]),
        degree: (i) => g.off[i + 1] - g.off[i],
        loadMs: performance.now() - started,
      });
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'graph worker error')); };
    w.postMessage({ url: new URL(`${import.meta.env.BASE_URL}data/graph.json`, location.href).href });
  });
  p.then(() => { graphStatus.value = 'ready'; }, (e) => { graphStatus.value = 'error'; graphError.value = String(e); p = null; });
  return p;
}

export const DEFAULT_KINDS: EntityKind[] = ['polity', 'event', 'movement', 'settlement', 'culture', 'language'];

/** Detail levels: how many of the most significant nodes to show, and an edge budget. */
export function budget(level: number, mobile: boolean): { nodes: number; edges: number } {
  if (mobile) return [{ nodes: 2500, edges: 7000 }, { nodes: 6000, edges: 18000 }, { nodes: 15000, edges: 40000 }][level] ?? { nodes: 2500, edges: 7000 };
  return [{ nodes: 7000, edges: 30000 }, { nodes: 25000, edges: 110000 }, { nodes: Infinity, edges: 260000 }][level] ?? { nodes: 7000, edges: 30000 };
}

export interface Subset {
  nodes: Int32Array;     // node indices, most significant first
  edges: Int32Array;     // flat pairs
  totalEligible: number;
  edgesDropped: number;
}

/** The most significant nodes of the enabled kinds, plus the edges among them (strongest-first). */
export function selectSubset(g: GraphData, kinds: Set<EntityKind>, b: { nodes: number; edges: number }, must?: number): Subset {
  const enabled = new Uint8Array(KINDS.length);
  KINDS.forEach((k, i) => { if (kinds.has(k)) enabled[i] = 1; });
  const pick: number[] = [];
  let eligible = 0;
  for (let r = 0; r < g.n; r++) {
    const i = g.rank[r];
    if (!enabled[g.kind[i]]) continue;
    eligible++;
    if (pick.length < b.nodes) pick.push(i);
  }
  if (must !== undefined && must >= 0 && !pick.includes(must)) pick.push(must);
  const inSet = new Int32Array(g.n).fill(-1);
  pick.forEach((i, k) => { inSet[i] = k; });
  // edges among selected nodes; visit nodes in significance order so the budget keeps the strong ones
  const edges: number[] = [];
  let dropped = 0;
  for (const i of pick) {
    const row = g.neighbors(i);
    for (let k = 0; k < row.length; k++) {
      const j = row[k];
      if (inSet[j] < 0 || inSet[j] < inSet[i]) continue; // each pair once, owned by the more significant end
      if (edges.length / 2 < b.edges) edges.push(i, j);
      else dropped++;
    }
  }
  return { nodes: Int32Array.from(pick), edges: Int32Array.from(edges), totalEligible: eligible, edgesDropped: dropped };
}
