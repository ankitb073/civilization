// Look: adaptive quality (decision 0033). Watches the frames; when they run slow for several seconds, and the frame's
// own work (CPU, or a GPU sample) shows the device is the cause, it asks for the next tier down. It does not count:
// a hidden tab, stalls longer than a quarter second (a tab switch, a dialog), the seconds after a tier change or a
// texture swap (`quiet`), or a display or power setting that caps the frame rate (slow intervals while the frame's
// own work is light: lowering the quality would not help). Pure logic, no three.js.

export interface GovernorOpts {
  /** The rate the tier aims for (60, or 30 on the phone tier). */
  fps: number;
  /** Seconds of slow frames before a step down. */
  slowSeconds?: number;
}

export class FrameGovernor {
  private fps: number;
  private need: number;
  private bucket: number[] = [];
  private work: number[] = [];
  private gpu: number[] = [];
  private bucketStart = 0;
  private slow = 0;
  private quietUntil = 0;
  /** The last second's figures, for the probes. */
  last = { medianMs: 0, workMs: 0, gpuMs: 0, slow: 0 };

  constructor(o: GovernorOpts) {
    this.fps = o.fps;
    this.need = o.slowSeconds ?? 4;
  }

  /** Ignore the next `seconds` (after a tier change, a texture swap, the first frames). */
  quiet(now: number, seconds: number) {
    this.quietUntil = Math.max(this.quietUntil, now + seconds * 1000);
    this.slow = 0;
    this.bucket.length = 0; this.work.length = 0; this.gpu.length = 0;
  }

  /** A GPU sample: the time from a frame's submit to the queue going idle (ms). */
  gpuSample(ms: number) { this.gpu.push(ms); }

  /** Feed every drawn frame: its interval and the frame's own CPU work (ms). True: step down a tier now. */
  push(now: number, intervalMs: number, workMs: number): boolean {
    if (typeof document !== 'undefined' && document.hidden) { this.bucketStart = now; this.bucket.length = 0; return false; }
    if (now < this.quietUntil || intervalMs > 250) { this.bucketStart = now; this.bucket.length = 0; this.work.length = 0; return false; }
    if (!this.bucketStart) this.bucketStart = now;
    this.bucket.push(intervalMs);
    this.work.push(workMs);
    if (now - this.bucketStart < 1000) return false;
    const med = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    const m = med(this.bucket), w = med(this.work), g = this.gpu.length ? med(this.gpu) : 0;
    this.bucket.length = 0; this.work.length = 0; this.gpu.length = 0;
    this.bucketStart = now;
    const budget = 1000 / this.fps;
    // slow: the median frame is a third over the budget, and the frame's own work fills most of it
    const late = m > budget * 1.33;
    const busy = Math.max(w, g) > budget * 0.8;
    if (late && busy) this.slow++;
    else this.slow = Math.max(0, this.slow - 1);
    this.last = { medianMs: Math.round(m * 10) / 10, workMs: Math.round(w * 10) / 10, gpuMs: Math.round(g * 10) / 10, slow: this.slow };
    if (this.slow >= this.need) { this.slow = 0; return true; }
    return false;
  }
}
