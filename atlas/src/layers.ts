import type { Layer } from '../../engine/src/export/contract.ts';

function decodeB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function i16(b64: string): Int16Array {
  const u = decodeB64(b64);
  return new Int16Array(u.buffer, u.byteOffset, u.byteLength >> 1);
}

/** Reconstructs a categorical per-cell layer at any year from keyframes + column-wise deltas. */
export class LayerState {
  readonly layer: Layer;
  private keys: (Int16Array | null)[];
  private dYear: Int32Array;
  private dCell: Uint16Array;
  private dIdx: Int16Array;
  private last: { year: number; kf: number; di: number; arr: Int16Array } | null = null;
  private memo = new Map<number, Int16Array>();
  /** legend entry by idx (idx need not equal array position). */
  readonly byIdx: Map<number, Layer['legend'][number]>;

  /** Index of keyframes[0] in the full series (chunks of a split layer start mid-way). */
  private kfOffset: number;

  constructor(layer: Layer, kfOffset = 0) {
    this.layer = layer;
    this.kfOffset = kfOffset;
    this.keys = layer.keyframes.map(() => null);
    this.byIdx = new Map(layer.legend.map((l) => [l.idx, l]));
    const n = layer.deltaCount ?? 0;
    this.dYear = new Int32Array(n);
    if (n > 0 && layer.deltas) {
      const u = decodeB64(layer.deltas);
      // three columns back to back: Uint16 year steps, Uint16 cells, Int16 idx
      const buf = u.buffer.slice(u.byteOffset, u.byteOffset + n * 6);
      const steps = new Uint16Array(buf, 0, n);
      this.dCell = new Uint16Array(buf, n * 2, n);
      this.dIdx = new Int16Array(buf, n * 4, n);
      let y = layer.deltaBase ?? 0;
      for (let i = 0; i < n; i++) { y += steps[i]; this.dYear[i] = y; }
    } else {
      this.dCell = new Uint16Array(0);
      this.dIdx = new Int16Array(0);
    }
  }

  private key(k: number): Int16Array {
    let a = this.keys[k];
    if (!a) { a = i16(this.layer.keyframes[k]); this.keys[k] = a; }
    return a;
  }

  /** First delta index with year > y. */
  private upper(y: number): number {
    let lo = 0, hi = this.dYear.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.dYear[mid] <= y) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /** State at `year`. The returned array is shared; do not mutate. */
  at(year: number): Int16Array {
    const memo = this.memo.get(year);
    if (memo) return memo;
    const every = this.layer.keyframeEvery;
    const kf = Math.max(0, Math.min(this.keys.length - 1, Math.floor(year / every) - this.kfOffset));
    const kfYear = (kf + this.kfOffset) * every;
    let arr: Int16Array;
    let from: number;
    if (this.last && this.last.kf === kf && this.last.year <= year) {
      arr = this.last.arr.slice();
      from = this.last.di;
    } else {
      arr = this.key(kf).slice();
      from = this.upper(kfYear);
    }
    const to = this.upper(year);
    for (let i = from; i < to; i++) arr[this.dCell[i]] = this.dIdx[i];
    this.last = { year, kf, di: Math.max(from, to), arr };
    this.memo.set(year, arr);
    if (this.memo.size > 48) this.memo.delete(this.memo.keys().next().value as number);
    return arr;
  }
}

/** Anything the map can draw as a categorical layer. */
export interface LayerLike {
  readonly layer: { legend: Layer['legend'] };
  readonly byIdx: Map<number, Layer['legend'][number]>;
  at(year: number): Int16Array;
}

/** A layer derived from another by relabelling its values (e.g. culture → language). */
export class MappedLayerState implements LayerLike {
  readonly layer: { legend: Layer['legend'] };
  readonly byIdx: Map<number, Layer['legend'][number]>;
  private src: LayerLike;
  private map: Int16Array;
  private memo = new Map<number, Int16Array>();

  constructor(src: LayerLike, map: Int16Array, legend: Layer['legend']) {
    this.src = src;
    this.map = map;
    this.layer = { legend };
    this.byIdx = new Map(legend.map((l) => [l.idx, l]));
  }

  at(year: number): Int16Array {
    const m = this.memo.get(year);
    if (m) return m;
    const a = this.src.at(year);
    const out = new Int16Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = a[i] >= 0 && a[i] < this.map.length ? this.map[a[i]] : -1;
    this.memo.set(year, out);
    if (this.memo.size > 48) this.memo.delete(this.memo.keys().next().value as number);
    return out;
  }
}

/** The political layer split into millennium chunks that load on demand (see scripts/prepare-data.ts). */
export class ChunkedLayerState implements LayerLike {
  readonly layer: { legend: Layer['legend'] };
  readonly byIdx: Map<number, Layer['legend'][number]>;
  private every: number;
  private chunkYears: number;
  private chunks: (LayerState | null)[];
  private pending = new Map<number, Promise<void>>();
  private fetchChunk: (i: number) => Promise<Layer & { firstKeyframe: number }>;
  private onLoad: () => void;
  private empty: Int16Array;

  constructor(opts: {
    legend: Layer['legend']; keyframeEvery: number; chunkYears: number; chunkCount: number; cells: number;
    fetchChunk: (i: number) => Promise<Layer & { firstKeyframe: number }>; onLoad: () => void;
  }) {
    this.layer = { legend: opts.legend };
    this.byIdx = new Map(opts.legend.map((l) => [l.idx, l]));
    this.every = opts.keyframeEvery;
    this.chunkYears = opts.chunkYears;
    this.chunks = new Array(opts.chunkCount).fill(null);
    this.fetchChunk = opts.fetchChunk;
    this.onLoad = opts.onLoad;
    this.empty = new Int16Array(opts.cells).fill(-1);
  }

  chunkOf(year: number): number {
    return Math.max(0, Math.min(this.chunks.length - 1, Math.floor(year / this.chunkYears)));
  }

  isLoaded(year: number): boolean {
    return !!this.chunks[this.chunkOf(year)];
  }

  /** Load the chunk containing `year` (and resolve when it is ready). */
  ensure(year: number): Promise<void> {
    const c = this.chunkOf(year);
    if (this.chunks[c]) return Promise.resolve();
    let p = this.pending.get(c);
    if (!p) {
      p = this.fetchChunk(c).then((data) => {
        this.chunks[c] = new LayerState({ ...data, legend: this.layer.legend, keyframeEvery: this.every }, data.firstKeyframe);
        this.pending.delete(c);
        this.onLoad();
      });
      p.catch(() => this.pending.delete(c));
      this.pending.set(c, p);
    }
    return p;
  }

  /** Fetch every remaining chunk, nearest to `year` first, one at a time. */
  async prefetch(year: number): Promise<void> {
    const order = this.chunks.map((_, i) => i).sort((a, b) => Math.abs(a - this.chunkOf(year)) - Math.abs(b - this.chunkOf(year)));
    for (const c of order) if (!this.chunks[c]) await this.ensure(c * this.chunkYears).catch(() => {});
  }

  at(year: number): Int16Array {
    const c = this.chunkOf(year);
    const ch = this.chunks[c];
    if (ch) return ch.at(year);
    void this.ensure(year);
    // until it arrives, show the nearest loaded moment
    for (let d = 1; d < this.chunks.length; d++) {
      const lo = this.chunks[c - d], hi = this.chunks[c + d];
      if (lo) return lo.at((c - d + 1) * this.chunkYears - 1);
      if (hi) return hi.at((c + d) * this.chunkYears);
    }
    return this.empty;
  }
}
