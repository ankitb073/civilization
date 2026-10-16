// Seeded randomness and offline synthesis for the soundscape: pure functions that fill Float32Arrays.
// Nothing here touches WebAudio; bank.ts turns these into AudioBuffers once, at start().
// Every function draws from the Rng it is given, so a seed always yields the same samples.

// ---------- randomness ----------

export interface Rng {
  readonly seed: number;
  /** Uniform in [0, 1). */
  next(): number;
  range(lo: number, hi: number): number;
  /** Integer in [lo, hi], inclusive. */
  int(lo: number, hi: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Exponentially distributed wait with the given mean (a Poisson process's gaps). */
  exp(mean: number): number;
  /** An independent stream keyed by stable labels; never depends on how much the parent has drawn. */
  fork(...labels: (string | number)[]): Rng;
}

export function hash32(s: string, h0 = 0x811c9dc5): number {
  let h = h0 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32: tiny, fast, good enough for sound. */
export function makeRng(seed: number): Rng {
  const base = seed >>> 0;
  let a = base;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed: base,
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor((hi - lo + 1) * next()),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    exp: (mean) => -Math.log(1 - next()) * mean,
    fork: (...labels) => makeRng(hash32(labels.join('/'), base ^ 0x9e3779b9)),
  };
}

// ---------- small DSP kit ----------

/** RBJ biquad state, run sample by sample. 'bp' is the constant 0 dB peak band-pass. */
export interface Bq { b0: number; b1: number; b2: number; a1: number; a2: number; x1: number; x2: number; y1: number; y2: number }
export type BqType = 'lp' | 'hp' | 'bp';

export function bq(type: BqType, f: number, q: number, sr: number): Bq {
  const s: Bq = { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 };
  bqSet(s, type, f, q, sr);
  return s;
}

export function bqSet(s: Bq, type: BqType, f: number, q: number, sr: number): void {
  const w = (2 * Math.PI * Math.min(Math.max(f, 10), sr * 0.45)) / sr;
  const cw = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  let b0: number, b1: number, b2: number;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }
  s.b0 = b0 / a0; s.b1 = b1 / a0; s.b2 = b2 / a0; s.a1 = (-2 * cw) / a0; s.a2 = (1 - al) / a0;
}

export function bqRun(s: Bq, x: number): number {
  const y = s.b0 * x + s.b1 * s.x1 + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2;
  s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y;
  return y;
}

/** One-pole low-pass coefficient: y += a * (x - y). */
export const onePole = (fc: number, sr: number): number => 1 - Math.exp((-2 * Math.PI * fc) / sr);

export function peakOf(x: Float32Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > m) m = v; }
  return m;
}

export function normalizePeak(x: Float32Array, peak = 0.9): Float32Array {
  const m = peakOf(x);
  if (m > 0) { const k = peak / m; for (let i = 0; i < x.length; i++) x[i] *= k; }
  return x;
}

/** Scale to an RMS level, but never past maxPeak. */
export function normalizeRms(x: Float32Array, rms: number, maxPeak = 0.98): Float32Array {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  const cur = Math.sqrt(s / Math.max(1, x.length));
  if (cur <= 0) return x;
  const k = Math.min(rms / cur, maxPeak / Math.max(1e-9, peakOf(x)));
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

export function fadeIn(x: Float32Array, sr: number, sec: number): Float32Array {
  const n = Math.min(x.length, Math.floor(sec * sr));
  for (let i = 0; i < n; i++) x[i] *= Math.sin((Math.PI / 2) * (i / n));
  return x;
}

export function fadeOut(x: Float32Array, sr: number, sec: number): Float32Array {
  const n = Math.min(x.length, Math.floor(sec * sr));
  for (let i = 0; i < n; i++) x[x.length - 1 - i] *= Math.sin((Math.PI / 2) * (i / n));
  return x;
}

/** One-pole DC blocker (noise loops that drift would otherwise push DC through low-passes). */
export function dcBlock(x: Float32Array, sr: number, fc = 20): Float32Array {
  const R = 1 - (2 * Math.PI * fc) / sr;
  let px = 0, py = 0;
  for (let i = 0; i < x.length; i++) { const y = x[i] - px + R * py; px = x[i]; py = y; x[i] = y; }
  return x;
}

/** Make a seamless loop: the last `fade` samples are cross-faded (equal power) into the head and dropped. */
export function loopify(x: Float32Array, fade: number): Float32Array {
  const L = x.length - fade;
  const out = x.slice(0, L);
  for (let i = 0; i < fade; i++) {
    const w = (i / fade) * (Math.PI / 2);
    out[i] = x[i] * Math.sin(w) + x[L + i] * Math.cos(w);
  }
  return out;
}

/** One biquad pass over a one-shot (in place). */
export function biquadPass(x: Float32Array, sr: number, type: BqType, f: number, q = 0.7071): Float32Array {
  const s = bq(type, f, q, sr);
  for (let i = 0; i < x.length; i++) x[i] = bqRun(s, x[i]);
  return x;
}

/** One biquad pass over a seamless loop: the filter is warmed on the loop's tail first, so the seam stays seamless. */
export function filterLoop(x: Float32Array, sr: number, type: BqType, f: number, q = 0.7071): Float32Array {
  const s = bq(type, f, q, sr);
  const warm = Math.min(x.length, Math.floor(0.25 * sr));
  for (let i = x.length - warm; i < x.length; i++) bqRun(s, x[i]);
  for (let i = 0; i < x.length; i++) x[i] = bqRun(s, x[i]);
  return x;
}

export type Pass = readonly [BqType, number, number?];

// ---------- noise ----------

export function whiteNoise(r: Rng, n: number): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = r.next() * 2 - 1;
  return x;
}

/** Paul Kellet's refined pink filter. */
export function pinkNoise(r: Rng, n: number): Float32Array {
  const x = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r.next() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return x;
}

export function brownNoise(r: Rng, n: number): Float32Array {
  const x = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) { last = (last + 0.02 * (r.next() * 2 - 1)) / 1.02; x[i] = last * 3.5; }
  return x;
}

/** A seamless noise loop at a fixed RMS, optionally filtered (static filters are baked here, not run live). */
export function noiseLoop(kind: 'white' | 'pink' | 'brown', r: Rng, sr: number, seconds: number, passes: readonly Pass[] = []): Float32Array {
  const fade = Math.floor(0.25 * sr);
  const n = Math.floor(seconds * sr) + fade;
  const raw = kind === 'white' ? whiteNoise(r, n) : kind === 'pink' ? pinkNoise(r, n) : brownNoise(r, n);
  if (kind !== 'white') dcBlock(raw, sr, 15);
  const x = loopify(raw, fade);
  for (const [type, f, q] of passes) filterLoop(x, sr, type, f, q);
  return normalizeRms(x, 0.25);
}

/**
 * The siege drone as one exactly periodic loop (every partial a whole number of cycles): two slightly beating
 * band-limited saws on D2 through a soft resonant low-pass, a quiet fifth and octave, and a seamless low rumble.
 */
export function droneLoop(r: Rng, sr: number, seconds: number): Float32Array {
  const n = Math.round(seconds * sr);
  const grid = 1 / seconds;
  const snap = (f: number): number => Math.max(grid, Math.round(f / grid) * grid);
  const root = snap(73.42), det = root + snap(0.25), fifth = snap(root * 1.5), oct = snap(root * 2);
  const lp = (f: number): number => { const w = f / 260; return 1 / Math.sqrt((1 - w * w) ** 2 + (w / 1.1) ** 2); };
  const H = 10;
  const wa = new Float64Array(H + 1), wb = new Float64Array(H + 1);
  for (let h = 1; h <= H; h++) { wa[h] = lp(h * root) / h; wb[h] = lp(h * det) / h; }
  const pa = r.next() * 2 * Math.PI, pb = r.next() * 2 * Math.PI, pf = r.next() * 2 * Math.PI, po = r.next() * 2 * Math.PI;
  const x = new Float32Array(n);
  const saw = (th: number, w: Float64Array): number => {
    const c2 = 2 * Math.cos(th);
    let sPrev = 0, sCur = Math.sin(th), sum = 0;
    for (let h = 1; h <= H; h++) { sum += sCur * w[h]; const sN = c2 * sCur - sPrev; sPrev = sCur; sCur = sN; }
    return sum;
  };
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    x[i] = 0.3 * saw(2 * Math.PI * root * t + pa, wa) + 0.3 * saw(2 * Math.PI * det * t + pb, wb)
      + 0.3 * Math.sin(2 * Math.PI * fifth * t + pf) + 0.12 * Math.sin(2 * Math.PI * oct * t + po);
  }
  const rum = noiseLoop('brown', r.fork('rumble'), sr, seconds, [['lp', 90, 0.6], ['hp', 35, 0.7]]);
  const m = Math.min(n, rum.length);
  for (let i = 0; i < m; i++) x[i] += rum[i] * 0.6;
  return normalizeRms(x, 0.2);
}

// ---------- reverb ----------

/** A stereo impulse: sparse early reflections, then a diffuse tail that darkens as it decays. */
export function impulseResponse(r: Rng, sr: number, seconds: number): Float32Array[] {
  const n = Math.floor(sr * seconds);
  const pre = Math.floor(0.012 * sr);
  const out: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const x = new Float32Array(n);
    const rr = r.fork('ir', c);
    let lp = 0;
    const t60 = seconds * 0.8;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.9 * t) / t60) * Math.min(1, t / 0.03);
      const a = onePole(600 + 7400 * Math.exp(-t * 2.2), sr);
      lp += a * (rr.next() * 2 - 1 - lp);
      x[i] = lp * env;
    }
    for (let k = 0; k < 8; k++) {
      const t = rr.range(0.004, 0.08);
      const i = pre + Math.floor(t * sr);
      x[i] += (rr.chance(0.5) ? 1 : -1) * rr.range(0.15, 0.45) * Math.exp(-t * 14);
    }
    fadeOut(x, sr, seconds * 0.15);
    out.push(x);
  }
  return out;
}

// ---------- the lyre: Karplus-Strong ----------

/**
 * A plucked gut string: a noise burst (shaped by pluck position and finger softness) circulating in a delay line
 * with a two-point average (the string's losses) and an all-pass for exact tuning; then a small soundbox.
 */
export function pluck(r: Rng, sr: number, freq: number, o: { t60: number; bright: number; pos: number; seconds: number }): Float32Array {
  const n = Math.floor(o.seconds * sr);
  const out = new Float32Array(n);
  const period = sr / freq;
  let L = Math.floor(period - 0.5);
  let frac = period - 0.5 - L;
  if (frac < 0.1) { L -= 1; frac += 1; }
  const C = (1 - frac) / (1 + frac);
  const dl = new Float32Array(L);
  const ex = new Float32Array(L);
  const a = onePole(700 + 4800 * o.bright, sr);
  let s = 0, s2 = 0;
  for (let i = 0; i < L; i++) { s += a * (r.next() * 2 - 1 - s); s2 += a * (s - s2); ex[i] = s2; }
  const p = Math.max(1, Math.round(o.pos * L));
  let mean = 0;
  for (let i = 0; i < L; i++) { dl[i] = ex[i] - (i >= p ? ex[i - p] : 0); mean += dl[i]; }
  mean /= L;
  let pk = 0;
  for (let i = 0; i < L; i++) { dl[i] -= mean; pk = Math.max(pk, Math.abs(dl[i])); }
  for (let i = 0; i < L; i++) dl[i] /= pk || 1;
  const h = Math.cos((Math.PI * freq) / sr);
  const rho = Math.min(0.99995, Math.pow(10, -3 / (o.t60 * freq)) / h);
  let idx = 0, prev = 0, apx = 0, apy = 0;
  for (let i = 0; i < n; i++) {
    const y = dl[idx];
    const avg = 0.5 * (y + prev);
    prev = y;
    const ap = C * avg + apx - C * apy;
    apx = avg; apy = ap;
    dl[idx] = ap * rho;
    if (++idx === L) idx = 0;
    out[i] = y;
  }
  // soundbox: a few broad wooden resonances under the dry string, then soften the top
  const b1 = bq('bp', 285, 3, sr), b2 = bq('bp', 540, 4, sr), b3 = bq('bp', 1150, 2.5, sr);
  const lpA = onePole(6500, sr);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const y = out[i];
    const v = 0.8 * y + 0.55 * bqRun(b1, y) + 0.35 * bqRun(b2, y) + 0.18 * bqRun(b3, y);
    lp += lpA * (v - lp);
    out[i] = lp;
  }
  fadeIn(out, sr, 0.0015);
  fadeOut(out, sr, Math.min(0.6, o.seconds * 0.25));
  return normalizePeak(out, 0.9);
}

// ---------- crowd: voiced babble through formants ----------

const VOWELS: readonly (readonly [number, number, number])[] = [
  [730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410],
  [300, 870, 2240], [660, 1720, 2410], [640, 1190, 2390], [490, 1350, 2500],
];

/**
 * Many people talking at once: each voice is a buzz (sawtooth with tilt + breath) through three formant
 * resonators that jump vowel per syllable, grouped in phrases with falling pitch and pauses. `panic` raises
 * pitch, shortens syllables, removes pauses and adds long shouted vowels.
 */
export const babbleFade = (sr: number): number => Math.floor(0.6 * sr);

/** Add voices [from, to) of a babble into x (length seconds*sr + babbleFade); call in chunks, then finishBabble. */
export function babbleVoices(x: Float32Array, r: Rng, sr: number, from: number, to: number, panic: number): void {
  const n = x.length;
  for (let v = from; v < to; v++) {
    const vr = r.fork('voice', v);
    const female = vr.chance(0.45);
    const f0base = (female ? vr.range(170, 240) : vr.range(95, 140)) * (1 + 0.4 * panic);
    const fs = female ? 1.14 : 1;
    const amp = Math.pow(10, -vr.range(0, 14) / 20) * (female ? 0.8 : 1);
    const r1 = bq('bp', 500, 5, sr), r2 = bq('bp', 1500, 10, sr), r3 = bq('bp', 2500, 14, sr);
    let i = Math.floor(vr.range(0, 1.2) * sr);
    let phase = vr.next(), tilt = 0;
    while (i < n) {
      const syl = vr.int(2, 7);
      const start = f0base * vr.range(1, 1.22);
      for (let k = 0; k < syl && i < n; k++) {
        const shout = vr.chance(0.1 * panic);
        const dur = shout ? vr.range(0.45, 0.9) : vr.range(0.11, 0.3) * (1 - 0.3 * panic);
        const [F1, F2, F3] = shout ? VOWELS[vr.pick([0, 0, 5, 6])] : vr.pick(VOWELS);
        bqSet(r1, 'bp', F1 * fs, (F1 * fs) / 90, sr);
        bqSet(r2, 'bp', F2 * fs, (F2 * fs) / 120, sr);
        bqSet(r3, 'bp', F3 * fs, (F3 * fs) / 170, sr);
        const fsyl = start * (1 - (0.18 * k) / syl) * (shout ? 1.3 : 1);
        const len = Math.floor(dur * sr);
        const a = shout ? amp * 1.4 : amp;
        for (let j = 0; j < len && i + j < n; j++) {
          const u = j / len;
          const env = Math.pow(Math.sin(Math.PI * u), 0.8);
          const f = fsyl * (1 + (shout ? 0.18 * Math.sin(Math.PI * u) - 0.2 * u : 0.05 * Math.sin(Math.PI * u)));
          phase += f / sr;
          if (phase >= 1) phase -= 1;
          tilt += 0.3 * (2 * phase - 1 - tilt);
          const exc = tilt + (vr.next() * 2 - 1) * 0.3;
          x[i + j] += (bqRun(r1, exc) + 0.55 * bqRun(r2, exc) + 0.25 * bqRun(r3, exc)) * env * a;
        }
        i += len + Math.floor(vr.range(0, 0.04) * sr);
      }
      i += Math.floor(vr.range(0.15, 1.5) * (1 - 0.65 * panic) * sr);
    }
  }
}

/** Close the babble into a seamless loop, bake its band (distance) and level. */
export function finishBabble(x: Float32Array, sr: number, passes: readonly Pass[]): Float32Array {
  const y = loopify(dcBlock(x, sr, 60), babbleFade(sr));
  for (const [type, f, q] of passes) filterLoop(y, sr, type, f, q);
  return normalizeRms(y, 0.18);
}

/** A whole babble in one call (tests, small sizes). */
export function babble(r: Rng, sr: number, seconds: number, voices: number, panic: number, passes: readonly Pass[] = []): Float32Array {
  const x = new Float32Array(Math.floor(seconds * sr) + babbleFade(sr));
  babbleVoices(x, r, sr, 0, voices, panic);
  return finishBabble(x, sr, passes);
}

// ---------- war: drums and horns ----------

/** A large skin drum struck once: pitch-dropping membrane modes, a mallet thud, gentle saturation. */
export function drumHit(r: Rng, sr: number, o: { f0: number; f1: number; decay: number; noise: number }): Float32Array {
  const n = Math.floor((o.decay * 4 + 0.2) * sr);
  const x = new Float32Array(n);
  let ph = r.next() * 0.2;
  let nz = 0;
  const na = onePole(1100, sr);
  const m2 = r.range(1.55, 1.62), m3 = r.range(2.1, 2.2);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = o.f0 + (o.f1 - o.f0) * Math.exp(-t / 0.045);
    ph += (2 * Math.PI * f) / sr;
    nz += na * (r.next() * 2 - 1 - nz);
    const y = Math.sin(ph) * Math.exp(-t / o.decay)
      + 0.35 * Math.sin(ph * m2) * Math.exp(-t / (o.decay * 0.4))
      + 0.18 * Math.sin(ph * m3) * Math.exp(-t / (o.decay * 0.25))
      + o.noise * 3 * nz * Math.exp(-t / 0.014);
    x[i] = Math.tanh(1.6 * y) / Math.tanh(1.6);
  }
  fadeIn(x, sr, 0.0008);
  fadeOut(x, sr, 0.15);
  return normalizePeak(x, 0.9);
}

/**
 * A bronze or horn trumpet: additive harmonics (Chebyshev recursion, one sin/cos per sample) with a
 * lip scoop, a brass formant and brightness that follows the breath; notes are [pitch ratio, seconds].
 */
export function horn(r: Rng, sr: number, o: { f: number; notes: readonly (readonly [number, number])[]; bright: number }): Float32Array {
  const play = o.notes.reduce((s, nt) => s + nt[1], 0);
  const n = Math.floor((play + 0.6) * sr);
  const x = new Float32Array(n);
  const H = Math.max(4, Math.min(22, Math.floor((0.45 * sr) / (o.f * 1.6))));
  const amps = new Float64Array(H + 1);
  const bounds: number[] = [];
  let acc = 0;
  for (const nt of o.notes) { acc += nt[1]; bounds.push(acc); }
  const inner = bounds.slice(0, -1);
  let fcur = o.f * o.notes[0][0] * 0.88;
  let ph = 0, envS = 0, noiseLp = 0;
  const glide = onePole(9, sr);
  const breath = onePole(2500, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let k = 0;
    while (k < bounds.length - 1 && t >= bounds[k]) k++;
    const target = o.f * o.notes[k][0];
    fcur += glide * (target - fcur);
    let env = (1 - Math.exp(-t / 0.06));
    for (let b = 0; b < inner.length; b++) env *= 1 - 0.4 * Math.exp(-(((t - inner[b]) / 0.035) ** 2));
    if (t > play) env *= Math.exp(-(t - play) / 0.13);
    envS += 0.002 * (env - envS);
    const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 5.1 * t) * Math.min(1, Math.max(0, (t - 0.5) / 0.5));
    const f = fcur * vib;
    ph += (2 * Math.PI * f) / sr;
    if (ph > 2 * Math.PI) ph -= 2 * Math.PI;
    if ((i & 63) === 0) {
      const kk = 2.3 - 1.25 * o.bright * Math.min(1, envS * 1.2);
      for (let h = 1; h <= H; h++) {
        const fh = h * f;
        amps[h] = Math.exp(-kk * Math.log(h)) * (1 + 1.4 * Math.exp(-(((fh - 1250) / 550) ** 2))) * (fh < sr * 0.45 ? 1 : 0);
      }
    }
    const c2 = 2 * Math.cos(ph);
    let sPrev = 0, sCur = Math.sin(ph), sum = 0;
    for (let h = 1; h <= H; h++) { sum += sCur * amps[h]; const sN = c2 * sCur - sPrev; sPrev = sCur; sCur = sN; }
    noiseLp += breath * (r.next() * 2 - 1 - noiseLp);
    x[i] = (sum + noiseLp * 0.6) * env;
  }
  fadeOut(x, sr, 0.08);
  return normalizePeak(dcBlock(x, sr, 30), 0.9);
}

// ---------- night: dogs, footsteps ----------

export function bark(r: Rng, sr: number): Float32Array {
  const dur = r.range(0.11, 0.2);
  const n = Math.floor((dur + 0.08) * sr);
  const x = new Float32Array(n);
  const f0 = r.range(380, 700);
  const F1 = bq('bp', 500, 2.5, sr), F2 = bq('bp', 1900 * r.range(0.9, 1.1), 6, sr), F3 = bq('bp', 3200, 6, sr);
  let ph = 0, rough = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = t / dur;
    if ((i & 15) === 0) bqSet(F1, 'bp', 480 + 470 * Math.min(1, t / 0.025), 2.5, sr);
    const f = f0 * (u < 0.25 ? 0.85 + 0.6 * u : 1 - 0.32 * (u - 0.25));
    ph += f / sr;
    if (ph >= 1) { ph -= 1; rough = 0.65 + 0.7 * r.next(); }
    const src = (2 * ph - 1) * rough + (r.next() * 2 - 1) * 0.45;
    const env = Math.min(1, t / 0.006) * (u < 1 ? Math.exp(-u * 1.6) : Math.exp(-1.6 - (t - dur) / 0.012));
    const y = (bqRun(F1, src) + 0.6 * bqRun(F2, src) + 0.25 * bqRun(F3, src)) * env;
    x[i] = Math.tanh(y * 3);
  }
  fadeOut(x, sr, 0.02);
  return normalizePeak(x, 0.9);
}

/** A sandal on packed earth and stone: heel thud, grit, toe. */
export function footstep(r: Rng, sr: number): Float32Array {
  const n = Math.floor(0.22 * sr);
  const x = new Float32Array(n);
  const a1 = onePole(r.range(160, 260), sr), a2 = onePole(1800, sr);
  const toeT = r.range(0.05, 0.08);
  let l1 = 0, l1b = 0, l2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = r.next() * 2 - 1;
    l1 += a1 * (w - l1); l1b += a1 * (l1 - l1b);
    l2 += a2 * (w - l2);
    const heel = l1b * 9 * Math.min(1, t / 0.002) * Math.exp(-t / 0.022);
    const grit = (w - l2) * 0.22 * Math.exp(-t / 0.026) * (r.next() < 0.3 ? 1.6 : 0.6);
    const toe = t > toeT ? l1b * 4.5 * Math.min(1, (t - toeT) / 0.003) * Math.exp(-(t - toeT) / 0.018) : 0;
    x[i] = heel + grit + toe;
  }
  fadeOut(x, sr, 0.03);
  return normalizePeak(dcBlock(x, sr, 40), 0.9);
}

/** A levy marching out: many feet around each beat (left foot heavier), as a seamless loop of `beats` beats. */
export function trampLoop(r: Rng, sr: number, bpm: number, beats: number): Float32Array {
  const n = Math.round(((beats * 60) / bpm) * sr);
  const x = new Float32Array(n);
  const beat = 60 / bpm;
  const len = Math.floor(0.12 * sr);
  for (let b = 0; b < beats; b++) {
    for (let k = 0; k < 26; k++) {
      const t0 = b * beat + (r.next() + r.next() + r.next() - 1.5) * 0.05;
      const start = Math.floor(t0 * sr);
      const amp = r.range(0.25, 1) * (b % 2 === 0 ? 1 : 0.7);
      const a = onePole(r.range(150, 320), sr);
      const hp = onePole(2000, sr);
      let l = 0, h = 0;
      for (let j = 0; j < len; j++) {
        const t = j / sr;
        const w = r.next() * 2 - 1;
        l += a * (w - l); h += hp * (w - h);
        const y = (l * 6 * Math.exp(-t / 0.03) + (w - h) * 0.15 * Math.exp(-t / 0.02)) * Math.min(1, t / 0.002) * amp;
        const idx = (((start + j) % n) + n) % n;
        x[idx] += y;
      }
    }
  }
  // a bed of shuffling and gear
  const a = onePole(500, sr);
  let l = 0;
  for (let i = 0; i < n; i++) { l += a * (r.next() * 2 - 1 - l); x[i] += l * 0.35; }
  filterLoop(dcBlock(x, sr, 40), sr, 'lp', 1400, 0.7);
  return normalizeRms(x, 0.2);
}

// ---------- fire ----------

/** Embers and burning wood: a heavy-tailed Poisson stream of ticks, pops and clusters, as a seamless loop. */
export function crackleTexture(r: Rng, sr: number, seconds: number, rate: number): Float32Array {
  const fade = Math.floor(0.2 * sr);
  const n = Math.floor(seconds * sr) + fade;
  const x = new Float32Array(n);
  const addTick = (i0: number, amp: number, ms: number): void => {
    const L = Math.floor((ms / 1000) * sr);
    let prev = 0;
    for (let j = 0; j < L && i0 + j < n; j++) {
      const w = r.next() * 2 - 1;
      x[i0 + j] += (w - prev) * amp * Math.exp((-j / L) * 4);
      prev = w;
    }
  };
  const addPop = (i0: number, amp: number): void => {
    const f = r.range(900, 4200), tau = r.range(0.002, 0.008);
    const L = Math.floor(tau * 6 * sr);
    const res = bq('bp', f, r.range(2, 6), sr);
    for (let j = 0; j < L && i0 + j < n; j++) {
      const w = j < 6 ? r.next() * 2 - 1 : 0;
      x[i0 + j] += bqRun(res, w) * amp * 5 + (j < 3 ? w * amp * 0.5 : 0);
    }
  };
  let t = 0;
  while (t < n / sr) {
    t += r.exp(1 / rate);
    const i0 = Math.floor(t * sr);
    const amp = Math.min(1, 0.04 * Math.pow(1 - r.next(), -1 / 1.5));
    const u = r.next();
    if (u < 0.65) addTick(i0, amp, r.range(0.4, 3));
    else if (u < 0.92) addPop(i0, amp);
    else {
      addPop(i0, amp * 1.4);
      const k = r.int(3, 10);
      for (let c = 0; c < k; c++) addTick(i0 + Math.floor(r.range(0.002, 0.07) * sr), amp * r.range(0.2, 0.7), r.range(0.3, 1.5));
    }
  }
  const hp = onePole(3000, sr);
  let l = 0;
  for (let i = 0; i < n; i++) { const w = r.next() * 2 - 1; l += hp * (w - l); x[i] += (w - l) * 0.006; }
  return normalizePeak(loopify(x, fade), 0.9);
}

/** A roof or wall giving way: a deep boom, then debris and a rumbling tail. */
export function collapse(r: Rng, sr: number): Float32Array {
  const n = Math.floor(3 * sr);
  const x = new Float32Array(n);
  const a = onePole(120, sr), b = onePole(400, sr);
  let l = 0, l2 = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = r.next() * 2 - 1;
    l += a * (w - l); l2 += b * (w - l2);
    ph += (2 * Math.PI * (55 - 10 * Math.min(1, t))) / sr;
    const boom = (l * 10 * Math.exp(-t / 0.5) + Math.sin(ph) * 0.45 * Math.exp(-t / 0.3)) * Math.min(1, t / 0.015);
    const tail = l2 * 1.6 * Math.exp(-t / 1.1) * Math.min(1, t / 0.2);
    x[i] = boom + tail;
  }
  let t = 0.05;
  while (t < 2.6) {
    t += r.exp(1 / 70);
    const i0 = Math.floor(t * sr);
    const amp = 0.35 * Math.exp(-t / 0.7) * Math.min(1, 0.2 * Math.pow(1 - r.next(), -0.6));
    const L = Math.floor(r.range(0.001, 0.006) * sr);
    let prev = 0;
    for (let j = 0; j < L && i0 + j < n; j++) { const w = r.next() * 2 - 1; x[i0 + j] += (w - prev) * amp; prev = w; }
  }
  fadeOut(x, sr, 0.4);
  return normalizePeak(dcBlock(x, sr, 30), 0.9);
}

// ---------- rain ----------

/** Gentle rain on roofs and puddles: dense soft ticks and the occasional bubble, one channel per side. */
export function rainTexture(r: Rng, sr: number, seconds: number, rate: number): Float32Array[] {
  const fade = Math.floor(0.2 * sr);
  const n = Math.floor(seconds * sr) + fade;
  const out: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const rr = r.fork('rain', c);
    const x = new Float32Array(n);
    let t = 0;
    while (t < n / sr) {
      t += rr.exp(1 / rate);
      const i0 = Math.floor(t * sr);
      const amp = 0.03 + 0.25 * Math.pow(rr.next(), 4);
      if (rr.chance(0.85)) {
        const L = Math.floor(rr.range(0.0003, 0.0012) * sr);
        let prev = 0;
        for (let j = 0; j < L && i0 + j < n; j++) { const w = rr.next() * 2 - 1; x[i0 + j] += (w - prev) * amp * (1 - j / L); prev = w; }
      } else {
        const f0 = rr.range(1500, 4500), tau = rr.range(0.003, 0.01);
        const L = Math.floor(tau * 5 * sr);
        let ph = 0;
        for (let j = 0; j < L && i0 + j < n; j++) {
          const tt = j / sr;
          ph += (2 * Math.PI * f0 * (1 + (0.8 * tt) / tau / 5)) / sr;
          x[i0 + j] += Math.sin(ph) * amp * 0.6 * Math.exp(-tt / tau) * Math.min(1, j / 8);
        }
      }
    }
    out.push(loopify(x, fade));
  }
  const pk = Math.max(peakOf(out[0]), peakOf(out[1]));
  for (const x of out) for (let i = 0; i < x.length; i++) x[i] *= 0.8 / (pk || 1);
  return out;
}

/** A drop from the eaves into a puddle (a rising bubble resonance). */
export function drip(r: Rng, sr: number): Float32Array {
  const n = Math.floor(0.18 * sr);
  const x = new Float32Array(n);
  const f0 = r.range(650, 1500), rise = r.range(0.25, 0.6), tau = r.range(0.018, 0.035);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * f0 * (1 + rise * Math.min(1, t / 0.04))) / sr;
    x[i] = Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, t / 0.0008) + (i < 12 ? (r.next() * 2 - 1) * 0.3 : 0);
  }
  fadeOut(x, sr, 0.02);
  return normalizePeak(x, 0.9);
}

// ---------- birds (dawn) ----------

export function birdCall(r: Rng, sr: number): Float32Array {
  const kind = r.int(0, 2);
  const notes = kind === 2 ? r.int(6, 12) : r.int(2, 5);
  const noteLen = kind === 2 ? 0.04 : r.range(0.06, 0.12);
  const dur = notes * (noteLen + 0.09) + 0.15;
  const n = Math.floor(dur * sr);
  const x = new Float32Array(n);
  const base = r.range(2400, 4200);
  let t0 = 0.02;
  for (let k = 0; k < notes; k++) {
    const len = kind === 2 ? 0.04 : noteLen * r.range(0.8, 1.2);
    const f1 = base * r.range(0.9, 1.12);
    const f2 = f1 * (kind === 0 ? r.range(0.55, 0.8) : kind === 1 ? r.range(1.15, 1.45) : r.range(0.85, 1.05));
    const fm = kind === 1 ? r.range(35, 70) : 0;
    const i0 = Math.floor(t0 * sr), L = Math.floor(len * sr);
    let ph = 0, mph = 0;
    for (let i = 0; i < L && i0 + i < n; i++) {
      const u = i / L;
      ph += (2 * Math.PI * (f1 + (f2 - f1) * u)) / sr;
      mph += (2 * Math.PI * fm) / sr;
      x[i0 + i] += Math.sin(ph + 1.1 * Math.sin(mph)) * Math.sin(Math.PI * u) ** 2 * (k === notes - 1 ? 0.7 : 1);
    }
    t0 += len + (kind === 2 ? 0.014 : r.range(0.03, 0.09));
  }
  return normalizePeak(x, 0.9);
}

// ---------- the scribe's room ----------

/**
 * A reed stylus pressed into wet clay: a faint tip tick, a damp squish (band-passed noise sliding down),
 * the mass of the reed meeting the clay, and the little suction release as it lifts.
 */
export function stylusPress(r: Rng, sr: number): Float32Array {
  const n = Math.floor(0.16 * sr);
  const x = new Float32Array(n);
  const fc = r.range(650, 1150), sweep = r.range(1.4, 1.9), q = r.range(1.1, 1.8);
  const bpS = bq('bp', fc * sweep, q, sr);
  const atk = r.range(0.004, 0.009), dec = r.range(0.025, 0.045);
  const thumpF = r.range(170, 260);
  const tRel = r.range(0.05, 0.085);
  const bpR = bq('bp', r.range(1800, 2900), 3, sr);
  const popF = r.range(380, 620);
  const tickA = r.range(0.15, 0.3);
  let thPh = 0, popPh = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 7) === 0) bqSet(bpS, 'bp', fc * (0.75 + (sweep - 0.75) * Math.exp(-t / 0.018)), q, sr);
    const w = r.next() * 2 - 1;
    const env = t < atk ? Math.sin((Math.PI / 2) * (t / atk)) : Math.exp(-(t - atk) / dec);
    let y = bqRun(bpS, w) * env * 2.2;
    if (t < 0.002) y += (r.next() * 2 - 1) * tickA * Math.exp(-t / 0.0004);
    if (t > 0.002) {
      const tt = t - 0.002;
      thPh += (2 * Math.PI * thumpF * (1 - 0.3 * Math.min(1, tt / 0.03))) / sr;
      y += Math.sin(thPh) * 0.13 * Math.exp(-tt / 0.018) * Math.min(1, tt / 0.002);
    }
    const rw = bqRun(bpR, w);
    if (t > tRel) {
      const tr = t - tRel;
      y += rw * 0.9 * Math.exp(-tr / 0.007) * Math.min(1, tr / 0.0015);
      popPh += (2 * Math.PI * popF * (1 + 2 * tr)) / sr;
      y += Math.sin(popPh) * 0.07 * Math.exp(-tr / 0.012) * Math.min(1, tr / 0.001);
    }
    x[i] = y;
  }
  fadeOut(x, sr, 0.012);
  return normalizePeak(x, 0.9);
}

/** A seal pressed and rolled across the clay, then set down on the table. */
export function sealPress(r: Rng, sr: number): Float32Array {
  const n = Math.floor(0.75 * sr);
  const x = new Float32Array(n);
  const roll = bq('bp', r.range(560, 760), 1.3, sr);
  const lpA = onePole(300, sr);
  const am = r.range(24, 34);
  const tk = r.range(0.5, 0.56);
  const k1 = r.range(1800, 2100), k2 = r.range(2600, 2900);
  let l = 0, ph = 0, amPh = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = r.next() * 2 - 1;
    l += lpA * (w - l);
    ph += (2 * Math.PI * (120 - 30 * Math.min(1, t / 0.06))) / sr;
    let y = (Math.sin(ph) * 0.5 + l * 4) * Math.exp(-t / 0.045) * Math.min(1, t / 0.003);
    if (t > 0.03 && t < 0.45) {
      const u = (t - 0.03) / 0.42;
      amPh += (2 * Math.PI * am * (1 + 0.15 * Math.sin(7 * t))) / sr;
      const env = Math.pow(Math.sin(Math.PI * u), 0.7);
      y += bqRun(roll, w) * 1.4 * env * Math.pow(Math.abs(Math.sin(amPh)), 1.5) + l * 2.2 * env;
    }
    if (t > tk) {
      const tt = t - tk;
      y += (Math.sin(2 * Math.PI * k1 * tt) * 0.22 + Math.sin(2 * Math.PI * k2 * tt) * 0.14) * Math.exp(-tt / 0.012);
      y += Math.sin(2 * Math.PI * 150 * tt) * 0.35 * Math.exp(-tt / 0.03) * Math.min(1, tt / 0.001);
    }
    x[i] = y;
  }
  fadeOut(x, sr, 0.05);
  return normalizePeak(dcBlock(x, sr, 30), 0.9);
}

/** A leaf of papyrus or a page turned: a swoosh, crinkle grains, and the soft flap as it lands. */
export function pageTurn(r: Rng, sr: number): Float32Array {
  const dur = r.range(0.42, 0.6);
  const n = Math.floor((dur + 0.1) * sr);
  const x = new Float32Array(n);
  const sw = bq('bp', 500, 0.9, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = Math.min(1, t / dur);
    if ((i & 15) === 0) bqSet(sw, 'bp', 500 + 1500 * u, 0.9, sr);
    x[i] = bqRun(sw, r.next() * 2 - 1) * 0.5 * Math.pow(Math.sin(Math.PI * u), 1.4);
  }
  let t = 0.03;
  while (t < dur - 0.06) {
    t += r.exp(1 / 140);
    const u = t / dur;
    const env = Math.pow(Math.sin(Math.PI * u), 0.8);
    const i0 = Math.floor(t * sr);
    const L = Math.floor(r.range(0.001, 0.004) * sr);
    const g = bq('bp', r.range(2500, 6000), 1.5, sr);
    const amp = Math.min(1, 0.15 * Math.pow(1 - r.next(), -0.7)) * env;
    for (let j = 0; j < L && i0 + j < n; j++) x[i0 + j] += bqRun(g, r.next() * 2 - 1) * amp * 1.5 * (1 - j / L);
  }
  const tf = dur - 0.04;
  const lpA = onePole(600, sr);
  let l = 0;
  for (let i = Math.floor(tf * sr); i < n; i++) {
    const tt = i / sr - tf;
    l += lpA * (r.next() * 2 - 1 - l);
    x[i] += (Math.sin(2 * Math.PI * 110 * tt) * 0.25 + l * 1.5) * Math.exp(-tt / 0.02) * Math.min(1, tt / 0.002);
  }
  fadeIn(x, sr, 0.01);
  fadeOut(x, sr, 0.03);
  return normalizePeak(x, 0.9);
}

/** A heavy cedar door on bronze pivots: the bar lifted, a long stick-slip creak, the thud of closing. */
export function doorSound(r: Rng, sr: number): Float32Array {
  const n = Math.floor(2.1 * sr);
  const x = new Float32Array(n);
  // the bar: a wooden knock and a scrape
  for (let i = 0; i < Math.floor(0.3 * sr); i++) {
    const t = i / sr;
    x[i] += (Math.sin(2 * Math.PI * 420 * t) * 0.5 + Math.sin(2 * Math.PI * 980 * t) * 0.3) * Math.exp(-t / 0.03);
  }
  const scr = bq('bp', 1200, 2, sr);
  for (let i = Math.floor(0.05 * sr); i < Math.floor(0.28 * sr); i++) {
    const t = i / sr;
    const u = (t - 0.05) / 0.23;
    x[i] += bqRun(scr, r.next() * 2 - 1) * 0.8 * Math.sin(Math.PI * u) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 60 * t));
  }
  // the creak: stick-slip impulses into a bank of wooden resonances
  const bank = [[380, 18, 1], [860, 22, 0.8], [1640, 15, 0.5], [2900, 10, 0.3]].map(([f, q, g]) => ({ s: bq('bp', f * r.range(0.95, 1.05), q, sr), g }));
  const c0 = 0.35, c1 = 1.25;
  let next = c0, prev = 0;
  for (let i = Math.floor(c0 * sr); i < Math.floor((c1 + 0.15) * sr); i++) {
    const t = i / sr;
    const u = Math.min(1, (t - c0) / (c1 - c0));
    let imp = 0;
    if (t >= next && t < c1) { imp = r.range(0.6, 1); next = t + 1 / (35 + 95 * Math.pow(Math.sin(Math.PI * u), 1.5) + r.range(-8, 8)); }
    let y = 0;
    for (const b of bank) y += bqRun(b.s, imp - prev) * b.g;
    prev = imp;
    x[i] += y * 3 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 0.5);
  }
  // closing: a deep thump and a rattle
  const tc = 1.42;
  const lpA = onePole(200, sr);
  let l = 0;
  for (let i = Math.floor(tc * sr); i < n; i++) {
    const tt = i / sr - tc;
    l += lpA * (r.next() * 2 - 1 - l);
    x[i] += (Math.sin(2 * Math.PI * (70 - 20 * Math.min(1, tt / 0.2)) * tt) * 0.9 * Math.exp(-tt / 0.18) + l * 6 * Math.exp(-tt / 0.05)) * Math.min(1, tt / 0.002);
  }
  for (let k = 0; k < 4; k++) {
    const i0 = Math.floor((tc + r.range(0.02, 0.12)) * sr);
    for (let j = 0; j < 40 && i0 + j < n; j++) x[i0 + j] += (r.next() * 2 - 1) * 0.15 * (1 - j / 40);
  }
  fadeOut(x, sr, 0.2);
  return normalizePeak(dcBlock(x, sr, 30), 0.9);
}
