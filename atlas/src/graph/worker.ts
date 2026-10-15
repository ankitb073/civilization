/// <reference lib="webworker" />
// Fetches and indexes graph.json off the main thread: typed columns, a deduplicated
// CSR adjacency and a significance ranking, all transferred back without copying.

import type { GraphJson } from '../../../engine/src/export/contract.ts';
import { KINDS } from '../kinds.ts';

export interface GraphPacked {
  n: number;
  ids: string[];
  labels: string[];
  kind: Uint8Array;      // index into KINDS
  x: Float32Array;
  y: Float32Array;
  size: Float32Array;
  t0: Int16Array;
  t1: Int16Array;
  off: Int32Array;       // CSR offsets, length n+1
  nbr: Int32Array;       // CSR neighbours
  rank: Int32Array;      // node indices by size, descending
  edgeCount: number;     // unique undirected edges
  ms: { fetch: number; parse: number; index: number };
  bytes: number;
}

self.onmessage = async (e: MessageEvent<{ url: string }>) => {
  try {
    const t0 = performance.now();
    const res = await fetch(e.data.url);
    if (!res.ok) throw new Error(`graph.json: HTTP ${res.status}`);
    const text = await res.text();
    const t1 = performance.now();
    const g = JSON.parse(text) as GraphJson;
    const t2 = performance.now();
    const n = g.ids.length;
    const kindIndex = new Map<string, number>(KINDS.map((k, i) => [k, i]));
    const kind = new Uint8Array(n), x = new Float32Array(n), y = new Float32Array(n), size = new Float32Array(n);
    const ta = new Int16Array(n), tb = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      kind[i] = kindIndex.get(g.kinds[i]) ?? 0;
      x[i] = g.x[i]; y[i] = g.y[i]; size[i] = g.size[i];
      ta[i] = Math.max(-32768, Math.min(32767, g.t0[i]));
      tb[i] = Math.max(-32768, Math.min(32767, g.t1[i]));
    }
    // CSR adjacency (both directions), then sort + dedupe each row
    const E = g.edges;
    const deg = new Int32Array(n + 1);
    for (let k = 0; k < E.length; k += 2) { const a = E[k], b = E[k + 1]; if (a !== b) { deg[a + 1]++; deg[b + 1]++; } }
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    const fill = deg.slice(0, n);
    const raw = new Int32Array(deg[n]);
    for (let k = 0; k < E.length; k += 2) { const a = E[k], b = E[k + 1]; if (a !== b) { raw[fill[a]++] = b; raw[fill[b]++] = a; } }
    const off = new Int32Array(n + 1);
    const out: number[] = [];
    let w = 0;
    const nbrTmp = new Int32Array(raw.length);
    for (let i = 0; i < n; i++) {
      off[i] = w;
      const row = raw.subarray(deg[i], deg[i + 1]).sort();
      let prev = -1;
      for (const v of row) if (v !== prev) { nbrTmp[w++] = v; prev = v; }
    }
    off[n] = w;
    void out;
    const nbr = nbrTmp.slice(0, w);
    const rank = new Int32Array(n);
    for (let i = 0; i < n; i++) rank[i] = i;
    rank.sort((a, b) => size[b] - size[a] || a - b);
    const t3 = performance.now();
    const packed: GraphPacked = {
      n, ids: g.ids, labels: g.labels, kind, x, y, size, t0: ta, t1: tb, off, nbr, rank,
      edgeCount: w / 2, ms: { fetch: t1 - t0, parse: t2 - t1, index: t3 - t2 }, bytes: text.length,
    };
    (self as unknown as Worker).postMessage({ ok: true, packed }, [kind.buffer, x.buffer, y.buffer, size.buffer, ta.buffer, tb.buffer, off.buffer, nbr.buffer, rank.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};
