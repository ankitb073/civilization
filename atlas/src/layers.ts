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
function i32(b64: string): Int32Array {
  const u = decodeB64(b64);
  return new Int32Array(u.buffer, u.byteOffset, u.byteLength >> 2);
}

/** Reconstructs a categorical per-cell layer at any year from keyframes + deltas. */
export class LayerState {
  readonly layer: Layer;
  private keys: (Int16Array | null)[];
  private dYear: Int32Array;
  private dCell: Int32Array;
  private dIdx: Int32Array;
  private last: { year: number; kf: number; di: number; arr: Int16Array } | null = null;
  private memo = new Map<number, Int16Array>();
  version = 0;

  constructor(layer: Layer) {
    this.layer = layer;
    this.keys = layer.keyframes.map(() => null);
    const d = layer.deltas ? i32(layer.deltas) : new Int32Array(0);
    const m = d.length / 3;
    this.dYear = new Int32Array(m);
    this.dCell = new Int32Array(m);
    this.dIdx = new Int32Array(m);
    for (let i = 0; i < m; i++) { this.dYear[i] = d[3 * i]; this.dCell[i] = d[3 * i + 1]; this.dIdx[i] = d[3 * i + 2]; }
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
    const kf = Math.max(0, Math.min(this.keys.length - 1, Math.floor(year / every)));
    const kfYear = kf * every;
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
