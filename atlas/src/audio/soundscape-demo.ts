// Harness for the soundscape: offline renders (any beat, a tour of all of them, the one-shots), level measurement
// (sample peak, RMS, BS.1770 integrated loudness, clicks), WAV encoding, and a small audition panel for the game.
// measure() / encodeWav() / fromBase64() are DOM-free, so Node scripts can import this file too.
//
//   import { mountSoundscapeDemo } from '../../audio/soundscape-demo.ts';
//   const demo = mountSoundscapeDemo(document.body, { seed: 'sc-1234' });   // buttons: Sound on, beats, intensity, SFX
//   demo.destroy();
//
//   const { channels, sampleRate } = await renderBeat('walls', 10);        // in a browser: 10 s of the night siege
//   const wav = encodeWav(channels, sampleRate);                             // Uint8Array, 16-bit PCM

import { BEATS, createSoundscape } from './soundscape.ts';
import type { Beat, LayerName, Soundscape, SoundscapeOptions } from './soundscape.ts';

export type Sfx = 'stylus' | 'seal' | 'pageTurn' | 'door';
export interface RenderStep { at: number; beat?: Beat; intensity?: number; sfx?: Sfx }
export interface RenderOptions {
  seconds: number;
  steps: RenderStep[];
  sampleRate?: number;
  seed?: number | string;
  rain?: 'auto' | 'on' | 'off';
  solo?: readonly LayerName[];
  /** Default 1 (the loudest a player can set), so level checks are worst-case. */
  volume?: number;
}
export interface Rendered {
  channels: Float32Array[];
  sampleRate: number;
  /** Wall-clock ms to synthesize the bank, and to render the audio (render ÷ duration ≈ real-time CPU share). */
  buildMs: number;
  renderMs: number;
  stats: Soundscape['stats'];
}

/** Render a scripted run into an OfflineAudioContext (browser only). */
export async function renderOffline(o: RenderOptions): Promise<Rendered> {
  const sr = o.sampleRate ?? 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(o.seconds * sr), sr);
  const s = createSoundscape({ context: ctx, seed: o.seed, rain: o.rain, solo: o.solo, volume: o.volume ?? 1, muted: false });
  const t0 = performance.now();
  await s.start();
  const buildMs = performance.now() - t0;
  for (const st of [...o.steps].sort((a, b) => a.at - b.at)) {
    s.advance(st.at);
    if (st.beat) s.setBeat(st.beat, st.intensity);
    if (st.sfx) s[st.sfx]();
  }
  s.advance(o.seconds);
  const t1 = performance.now();
  const buf = await ctx.startRendering();
  const renderMs = performance.now() - t1;
  const stats = s.stats;
  s.dispose();
  return { channels: [buf.getChannelData(0), buf.getChannelData(1)], sampleRate: sr, buildMs, renderMs, stats };
}

export function renderBeat(beat: Beat, seconds = 10, o: Partial<RenderOptions> & { intensity?: number } = {}): Promise<Rendered> {
  return renderOffline({ ...o, seconds, steps: [{ at: 0, beat, intensity: o.intensity }] });
}

/** Every beat in game order, `each` seconds apiece, with the one-shots where the game would play them. */
export function tourSteps(each = 12): RenderStep[] {
  const steps: RenderStep[] = [];
  BEATS.forEach((b, k) => {
    const t = k * each;
    steps.push({ at: t, beat: b });
    if (k > 0) steps.push({ at: t + 0.2, sfx: 'pageTurn' });
    if (b === 'tablet') {
      steps.push({ at: t + 1, sfx: 'door' });
      for (let w = 0; w < 14; w++) steps.push({ at: t + 4 + w * 0.42 + (w % 4 === 3 ? 0.5 : 0), sfx: 'stylus' });
      steps.push({ at: t + each - 2, sfx: 'seal' });
    }
  });
  return steps;
}

/** One kind of one-shot, n times, `gap` seconds apart (for its own levels). */
export function oneSfxSteps(kind: Sfx, n: number, gap: number): RenderStep[] {
  return Array.from({ length: n }, (_, k) => ({ at: 0.2 + k * gap, sfx: kind }));
}

/** The one-shots alone: a line of wedges, a seal, two page turns, the door. */
export function sfxSteps(): RenderStep[] {
  const steps: RenderStep[] = [];
  let t = 0.3;
  for (let w = 0; w < 12; w++) { steps.push({ at: t, sfx: 'stylus' }); t += w % 4 === 3 ? 0.8 : 0.38; }
  steps.push({ at: t + 0.6, sfx: 'seal' });
  steps.push({ at: t + 2, sfx: 'pageTurn' });
  steps.push({ at: t + 3, sfx: 'pageTurn' });
  steps.push({ at: t + 4.2, sfx: 'door' });
  return steps;
}

// ---------- levels ----------

export interface Levels {
  /** Sample peak, dBFS. */
  peakDb: number;
  rmsDb: number;
  /** BS.1770-4 integrated loudness (gated), LUFS. */
  lufs: number;
  /** Loudest 400 ms and 3 s windows, LUFS. */
  maxMomentary: number;
  maxShortTerm: number;
  /** Samples at or beyond ±0.999. */
  clipped: number;
  nan: number;
  dc: number;
  /** Largest sample-to-sample jump (a click shows up here) and when. */
  maxStep: number;
  maxStepAt: number;
}

interface Coef { b0: number; b1: number; b2: number; a1: number; a2: number }
function kWeighting(fs: number): [Coef, Coef] {
  let K = Math.tan((Math.PI * 1681.974450955533) / fs);
  const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416), Q1 = 0.7071752369554196;
  let a0 = 1 + K / Q1 + K * K;
  const shelf = { b0: (Vh + (Vb * K) / Q1 + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q1 + K * K) / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q1 + K * K) / a0 };
  K = Math.tan((Math.PI * 38.13547087602444) / fs);
  const Q2 = 0.5003270373238773;
  a0 = 1 + K / Q2 + K * K;
  const hp = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q2 + K * K) / a0 };
  return [shelf, hp];
}
function filt(x: Float32Array, c: Coef): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
const toDb = (v: number): number => (v > 0 ? 20 * Math.log10(v) : -Infinity);

export function measure(channels: Float32Array[], fs: number): Levels {
  let peak = 0, sum = 0, clipped = 0, nan = 0, dcSum = 0, maxStep = 0, maxStepAt = 0;
  const n = channels[0].length;
  for (const x of channels) {
    for (let i = 0; i < n; i++) {
      const v = x[i];
      if (!Number.isFinite(v)) { nan++; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
      sum += v * v;
      dcSum += v;
      if (i > 0) { const st = Math.abs(v - x[i - 1]); if (st > maxStep) { maxStep = st; maxStepAt = i / fs; } }
    }
  }
  const [shelf, hp] = kWeighting(fs);
  const weighted = channels.map((x) => { const a = filt(x, shelf); const f = new Float32Array(a.length); for (let i = 0; i < a.length; i++) f[i] = a[i]; return filt(f, hp); });
  const blockLoudness = (win: number, hop: number): number[] => {
    const out: number[] = [];
    for (let s = 0; s + win <= n; s += hop) {
      let z = 0;
      for (const w of weighted) { let acc = 0; for (let i = s; i < s + win; i++) acc += w[i] * w[i]; z += acc / win; }
      out.push(z > 0 ? -0.691 + 10 * Math.log10(z) : -Infinity);
    }
    return out;
  };
  const mom = blockLoudness(Math.round(0.4 * fs), Math.round(0.1 * fs));
  const short = blockLoudness(Math.round(3 * fs), Math.round(0.5 * fs));
  const abs = mom.filter((l) => l > -70);
  const energy = (ls: number[]): number => ls.reduce((s, l) => s + Math.pow(10, (l + 0.691) / 10), 0) / Math.max(1, ls.length);
  const ungated = abs.length ? -0.691 + 10 * Math.log10(energy(abs)) : -Infinity;
  const rel = abs.filter((l) => l > ungated - 10);
  const lufs = rel.length ? -0.691 + 10 * Math.log10(energy(rel)) : -Infinity;
  return {
    peakDb: toDb(peak), rmsDb: toDb(Math.sqrt(sum / (n * channels.length))), lufs,
    maxMomentary: mom.length ? Math.max(...mom) : -Infinity, maxShortTerm: short.length ? Math.max(...short) : -Infinity,
    clipped, nan, dc: dcSum / (n * channels.length), maxStep, maxStepAt,
  };
}

// ---------- WAV and transfer ----------

export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const ch = channels.length, n = channels[0].length;
  const out = new Uint8Array(44 + n * ch * 2);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i] || 0));
      v.setInt16(o, Math.round(s * 32767), true);
      o += 2;
    }
  }
  return out;
}

/** Planar float32 channels → base64 (to hand a render from a page to Node). */
export function toBase64(channels: Float32Array[]): string {
  const n = channels[0].length;
  const all = new Float32Array(n * channels.length);
  channels.forEach((c, k) => all.set(c, k * n));
  const bytes = new Uint8Array(all.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string, channels: number): Float32Array[] {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const all = new Float32Array(bytes.buffer);
  const n = all.length / channels;
  return Array.from({ length: channels }, (_, k) => all.slice(k * n, (k + 1) * n));
}

// ---------- audition panel ----------

/**
 * A plain-DOM panel: Sound on/off, one button per beat, intensity, the one-shots, volume and a level meter.
 * Buttons carry data-sound / data-beat / data-sfx attributes; the panel's data-level holds the meter in dBFS.
 */
export function mountSoundscapeDemo(host: HTMLElement, opts: SoundscapeOptions = {}): { soundscape: Soundscape; root: HTMLElement; destroy(): void } {
  const s = createSoundscape(opts);
  const root = document.createElement('div');
  root.className = 'sound-demo';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Soundscape audition');
  root.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px;font:14px system-ui,sans-serif';
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    e.textContent = text;
    root.appendChild(e);
    return e;
  };
  let meterTimer: ReturnType<typeof setInterval> | null = null;
  let analyser: AnalyserNode | null = null;
  const status = el('output');
  const refresh = (): void => {
    toggle.textContent = s.muted || s.state === 'idle' ? 'Sound on' : 'Sound off';
    toggle.setAttribute('aria-pressed', String(!(s.muted || s.state === 'idle')));
    status.textContent = `${s.state}${s.muted ? ' · muted' : ''}${s.beat ? ` · ${s.beat} ${s.intensity.toFixed(2)}` : ''}`;
    for (const b of beatButtons) b.setAttribute('aria-pressed', String(b.dataset.beat === s.beat));
  };
  const toggle = el('button');
  toggle.dataset.sound = 'toggle';
  toggle.onclick = () => {
    if (s.state === 'idle' || s.state === 'stopped' || s.muted) {
      void s.start().then(refresh);
      s.setMuted(false);
      if (!analyser && s.context && s.output) {
        analyser = s.context.createAnalyser();
        analyser.fftSize = 2048;
        s.output.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        meterTimer = setInterval(() => {
          analyser!.getFloatTimeDomainData(buf);
          let acc = 0;
          for (let i = 0; i < buf.length; i++) acc += buf[i] * buf[i];
          const db = 10 * Math.log10(acc / buf.length + 1e-12);
          meter.value = Math.max(0, 60 + db);
          root.dataset.level = db.toFixed(1);
        }, 150);
      }
    } else s.setMuted(true);
    refresh();
  };
  const intensity = document.createElement('input');
  intensity.type = 'range'; intensity.min = '0'; intensity.max = '1'; intensity.step = '0.05'; intensity.value = '0.5';
  intensity.setAttribute('aria-label', 'Intensity');
  const beatButtons = BEATS.map((b) => {
    const btn = el('button', b);
    btn.dataset.beat = b;
    btn.onclick = () => { s.setBeat(b, Number(intensity.value)); refresh(); };
    return btn;
  });
  root.appendChild(intensity);
  intensity.oninput = () => { if (s.beat) s.setBeat(s.beat, Number(intensity.value)); refresh(); };
  for (const k of ['stylus', 'seal', 'pageTurn', 'door'] as const) {
    const btn = el('button', k);
    btn.dataset.sfx = k;
    btn.onclick = () => s[k]();
  }
  const vol = document.createElement('input');
  vol.type = 'range'; vol.min = '0'; vol.max = '1'; vol.step = '0.05'; vol.value = String(s.volume);
  vol.setAttribute('aria-label', 'Volume');
  vol.oninput = () => s.setVolume(Number(vol.value));
  root.appendChild(vol);
  const meter = el('meter');
  meter.min = 0; meter.max = 60; meter.setAttribute('aria-label', 'Level');
  host.appendChild(root);
  refresh();
  return {
    soundscape: s,
    root,
    destroy() {
      if (meterTimer) clearInterval(meterTimer);
      s.dispose();
      root.remove();
    },
  };
}
