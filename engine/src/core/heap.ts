/** Binary min-heap keyed by number; ties broken by insertion order for determinism. */
export class MinHeap<T> {
  private keys: number[] = [];
  private seq: number[] = [];
  private vals: T[] = [];
  private counter = 0;

  get size(): number {
    return this.vals.length;
  }

  push(key: number, val: T): void {
    this.keys.push(key);
    this.seq.push(this.counter++);
    this.vals.push(val);
    this.up(this.vals.length - 1);
  }

  peekKey(): number {
    return this.keys[0];
  }

  pop(): T | undefined {
    if (this.vals.length === 0) return undefined;
    const top = this.vals[0];
    const lk = this.keys.pop()!;
    const ls = this.seq.pop()!;
    const lv = this.vals.pop()!;
    if (this.vals.length > 0) {
      this.keys[0] = lk;
      this.seq[0] = ls;
      this.vals[0] = lv;
      this.down(0);
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.seq[a] < this.seq[b]);
  }

  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.seq[a], this.seq[b]] = [this.seq[b], this.seq[a]];
    [this.vals[a], this.vals[b]] = [this.vals[b], this.vals[a]];
  }

  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  private down(i: number): void {
    const n = this.vals.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
  }
}
