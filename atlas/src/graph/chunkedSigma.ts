// Sigma with a first indexation that never blocks the main thread for long.
//
// Sigma's constructor indexes the whole graph in one synchronous call: it runs the reducers on every node and edge,
// normalises positions, fills the label grid and writes every WebGL buffer, then draws. On the graph's Everything
// level (~47k nodes, ~141k edges) that is one ~120 ms task on an M-series Mac and about half a second at 4× CPU
// slowdown (issue #3). This subclass does the same work in time slices of a few milliseconds, yielding to the event
// loop between them, then draws once. Small graphs keep sigma's own synchronous path.
//
// The sliced pass mirrors Sigma#refresh (full) and Sigma#process of sigma 3.0.3, which atlas/package.json pins
// exactly; re-check it against those two methods before upgrading sigma.

import type Graph from 'graphology';
import Sigma, { Camera } from 'sigma';
import type { Settings } from 'sigma/settings';
import type { Coordinates, Dimensions, EdgeDisplayData, Extent, NodeDisplayData } from 'sigma/types';
import { createNormalizationFunction, graphExtent, matrixFromCamera, zIndexOrdering } from 'sigma/utils';

/** Nodes plus edges above which the first indexation is sliced. */
const SLICE_ABOVE = 20000;
/** Work per slice, ms; the graph build in GraphView uses the same budget. */
const SLICE_MS = 12;
/** Check the clock every this many items (a power of two, minus one). */
const MASK = 511;

type BBox = { x: Extent; y: Extent };
type RefreshOpts = Parameters<Sigma['refresh']>[0];

/** The private parts of Sigma that its own process() touches. */
interface Internals {
  graph: Graph;
  settings: Settings;
  nodeDataCache: Record<string, NodeDisplayData>;
  edgeDataCache: Record<string, EdgeDisplayData>;
  nodePrograms: Record<string, { reallocate(capacity: number): void }>;
  edgePrograms: Record<string, { reallocate(capacity: number): void }>;
  labelGrid: { resizeAndClear(d: Dimensions, cellSize: number): void; add(key: string, size: number, pos: Coordinates): void; organize(): void };
  nodeExtent: BBox;
  customBBox: BBox | null;
  normalizationFunction: ReturnType<typeof createNormalizationFunction>;
  nodeZExtent: Extent;
  edgeZExtent: Extent;
  itemIDsIndex: Record<number, { type: 'node' | 'edge'; id: string }>;
  nodeIndices: Record<string, number>;
  edgeIndices: Record<string, number>;
  clearNodeIndices(): void;
  clearEdgeIndices(): void;
  addNode(key: string): void;
  addEdge(key: string): void;
  addNodeToProgram(node: string, fingerprint: number, position: number): void;
  addEdgeToProgram(edge: string, fingerprint: number, position: number): void;
  emit(type: string): void;
}

interface Job {
  running: boolean;
  /** something asked for a refresh while slicing: index again once done */
  dirty: boolean;
  killed: boolean;
  timer: number;
  waiters: (() => void)[];
}

// Per-instance state lives here, not in class fields: the base constructor calls refresh() before a subclass's
// fields would be initialised, and their initialisers would then wipe what refresh() set up.
const jobs = new WeakMap<ChunkedSigma, Job>();

export class ChunkedSigma extends Sigma {
  /** Calls `cb` once the first full indexation has been drawn (at once if it already has). */
  whenIndexed(cb: () => void): void {
    const j = jobs.get(this);
    if (j?.running) j.waiters.push(cb);
    else cb();
  }

  override refresh(opts?: RefreshOpts): this {
    const j = jobs.get(this);
    if (!j) {
      // the constructor's first, full indexation
      const g = this.getGraph();
      if (!opts?.partialGraph && g.order + g.size > SLICE_ABOVE) {
        const job: Job = { running: true, dirty: false, killed: false, timer: 0, waiters: [] };
        jobs.set(this, job);
        // start in a task of its own: the constructor has already spent a few ms creating contexts and programs
        const it = indexInSlices(this as unknown as Internals, this);
        job.timer = window.setTimeout(() => this.slice(job, it), 0);
        return this;
      }
      jobs.set(this, { running: false, dirty: false, killed: false, timer: 0, waiters: [] });
    } else if (j.running) {
      j.dirty = true;
      return this;
    }
    return super.refresh(opts);
  }

  override scheduleRender(): this {
    // nothing to draw until the buffers are complete
    if (jobs.get(this)?.running) return this;
    return super.scheduleRender();
  }

  override kill(): void {
    const j = jobs.get(this);
    if (j) { j.killed = true; j.running = false; clearTimeout(j.timer); }
    super.kill();
  }

  private slice(job: Job, it: Generator<void, void>): void {
    if (job.killed) return;
    const end = performance.now() + SLICE_MS;
    let done = false, failed = false;
    try {
      while (performance.now() < end) {
        if (!it.next().done) continue;
        if (!job.dirty) { done = true; break; }
        // the graph or the view changed under us: index again, still in slices
        job.dirty = false;
        it = indexInSlices(this as unknown as Internals, this);
      }
    } catch (e) {
      // e.g. the graph lost an item mid-pass
      console.warn('graph: sliced indexation failed, indexing in one go', e);
      failed = true;
    }
    if (!done && !failed) {
      job.timer = window.setTimeout(() => this.slice(job, it), 0);
      return;
    }
    job.running = false;
    // done: draw without reprocessing (a partial refresh of nothing renders at once);
    // failed: let sigma index synchronously, as it would have without this class
    if (done) super.refresh({ partialGraph: {}, skipIndexation: true });
    else super.refresh();
    for (const cb of job.waiters.splice(0)) cb();
  }
}

/** Sigma#refresh (full) followed by Sigma#process, yielding every MASK+1 items and between phases. */
function* indexInSlices(s: Internals, r: Sigma): Generator<void, void> {
  const graph = s.graph, settings = s.settings;

  // refresh: reduce every node and edge into the display caches
  s.clearEdgeIndices();
  s.clearNodeIndices();
  let nodes = graph.nodes();
  for (let i = 0; i < nodes.length; i++) { s.addNode(nodes[i]); if ((i & MASK) === MASK) yield; }
  yield;
  let edges = graph.edges();
  yield;
  for (let i = 0; i < edges.length; i++) { s.addEdge(edges[i]); if ((i & MASK) === MASK) yield; }
  yield;

  // process: extent, normalisation, label grid, then the program buffers
  s.emit('beforeProcess');
  // Sigma#render resizes before it processes; the container may have changed size since the constructor
  r.resize();
  const dimensions = r.getDimensions();
  s.nodeExtent = graphExtent(graph);
  if (!settings.autoRescale) {
    const { width, height } = dimensions, { x, y } = s.nodeExtent;
    s.nodeExtent = {
      x: [(x[0] + x[1]) / 2 - width / 2, (x[0] + x[1]) / 2 + width / 2],
      y: [(y[0] + y[1]) / 2 - height / 2, (y[0] + y[1]) / 2 + height / 2],
    };
  }
  s.normalizationFunction = createNormalizationFunction(s.customBBox || s.nodeExtent);
  const nullCameraMatrix = matrixFromCamera(new Camera().getState(), dimensions, r.getGraphDimensions(), r.getStagePadding());
  s.labelGrid.resizeAndClear(dimensions, settings.labelGridCellSize);
  const nodesPerPrograms: Record<string, number> = {};
  const nodeIndices: Record<string, number> = {};
  const edgeIndices: Record<string, number> = {};
  const itemIDsIndex: Record<number, { type: 'node' | 'edge'; id: string }> = {};
  let incrID = 1;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const data = s.nodeDataCache[node];
    const attrs = graph.getNodeAttributes(node);
    data.x = attrs.x;
    data.y = attrs.y;
    s.normalizationFunction.applyTo(data);
    if (typeof data.label === 'string' && !data.hidden) s.labelGrid.add(node, data.size, r.framedGraphToViewport(data, { matrix: nullCameraMatrix }));
    nodesPerPrograms[data.type] = (nodesPerPrograms[data.type] || 0) + 1;
    if ((i & MASK) === MASK) yield;
  }
  s.labelGrid.organize();
  yield;
  for (const type in s.nodePrograms) {
    s.nodePrograms[type].reallocate(nodesPerPrograms[type] || 0);
    nodesPerPrograms[type] = 0;
  }
  if (settings.zIndex && s.nodeZExtent[0] !== s.nodeZExtent[1]) nodes = zIndexOrdering(s.nodeZExtent, (n: string) => s.nodeDataCache[n].zIndex, nodes);
  yield;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    nodeIndices[node] = incrID;
    itemIDsIndex[incrID] = { type: 'node', id: node };
    incrID++;
    s.addNodeToProgram(node, nodeIndices[node], nodesPerPrograms[s.nodeDataCache[node].type]++);
    if ((i & MASK) === MASK) yield;
  }
  yield;
  const edgesPerPrograms: Record<string, number> = {};
  for (let i = 0; i < edges.length; i++) {
    const type = s.edgeDataCache[edges[i]].type;
    edgesPerPrograms[type] = (edgesPerPrograms[type] || 0) + 1;
    if ((i & MASK) === MASK) yield;
  }
  if (settings.zIndex && s.edgeZExtent[0] !== s.edgeZExtent[1]) edges = zIndexOrdering(s.edgeZExtent, (e: string) => s.edgeDataCache[e].zIndex, edges);
  for (const type in s.edgePrograms) {
    s.edgePrograms[type].reallocate(edgesPerPrograms[type] || 0);
    edgesPerPrograms[type] = 0;
  }
  yield;
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    edgeIndices[edge] = incrID;
    itemIDsIndex[incrID] = { type: 'edge', id: edge };
    incrID++;
    s.addEdgeToProgram(edge, edgeIndices[edge], edgesPerPrograms[s.edgeDataCache[edge].type]++);
    if ((i & MASK) === MASK) yield;
  }
  s.itemIDsIndex = itemIDsIndex;
  s.nodeIndices = nodeIndices;
  s.edgeIndices = edgeIndices;
  s.emit('afterProcess');
}
