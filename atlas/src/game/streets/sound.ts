// Streets: the game's side of the procedural soundscape (atlas/src/audio/soundscape.ts), as the Tablet House's
// sound.ts does it (off until the player asks; the module is fetched ahead so "Sound on" can start inside the tap),
// plus what an errand needs: a beat's intensity (the run grows urgent as the horn nears) and the horn itself, a
// bronze horn call synthesised by the soundscape's own DSP (audio/dsp.ts `horn`) on the soundscape's context. With
// sound off every call is a silent no-op, and the game plays the same.
import type { Beat } from '../../audio/beats.ts';

interface Soundscape {
  start(): Promise<void> | void;
  stop(): void;
  dispose(): void;
  setMuted(m: boolean): void;
  setBeat(beat: Beat, intensity?: number): void;
  stylus?(): void; seal?(): void; door?(): void;
  readonly context: BaseAudioContext | null;
}
type Create = (o: { seed: string | number; muted?: boolean; context?: BaseAudioContext }) => Soundscape;
type HornFn = (r: { next(): number }, sr: number, o: { f: number; notes: readonly (readonly [number, number])[]; bright: number }) => Float32Array;
const mods = import.meta.glob<{ createSoundscape?: Create }>('../../audio/soundscape.ts');
const dsp = import.meta.glob<{ horn?: HornFn; makeRng?: (seed: number) => { next(): number }; hash32?: (s: string) => number }>('../../audio/dsp.ts');
const load = Object.values(mods)[0];
const loadDsp = Object.values(dsp)[0];
let createP: Promise<Create | null> | null = null;
let create: Create | null = null;
let hornFn: HornFn | null = null;
let rng: (() => { next(): number }) | null = null;
export const soundAvailable = () => !!load;
export function preloadSound(): Promise<Create | null> {
  if (!createP) {
    createP = load ? load().then((m) => (create = m.createSoundscape ?? null)).catch(() => null) : Promise.resolve(null);
    if (loadDsp) void loadDsp().then((m) => { hornFn = m.horn ?? null; if (m.makeRng && m.hash32) { const mk = m.makeRng, h = m.hash32; rng = () => mk(h('streets-horn')); } }).catch(() => {});
  }
  return createP;
}

export class StreetsSound {
  private sc: Soundscape | null = null;
  on = false;
  private beat: Beat = 'muster';
  private intensity: number | undefined;
  private seed: string;
  private want = false;
  private ctx: AudioContext | null = null;
  private hornBuf: AudioBuffer | null = null;
  constructor(seed: string) { this.seed = seed; void preloadSound(); }

  /** Call from the tap itself (iOS starts audio only inside the gesture). */
  async enable(beat?: Beat, intensity?: number): Promise<boolean> {
    if (beat) { this.beat = beat; this.intensity = intensity; }
    this.want = true;
    this.on = true;
    try { this.ctx ??= new AudioContext({ latencyHint: 'balanced' }); void this.ctx.resume(); } catch { /* no WebAudio */ }
    if (!create) await preloadSound();
    if (!create || !this.want) { this.on = false; return false; }
    try {
      if (!this.sc) this.sc = create({ seed: this.seed, muted: false, ...(this.ctx ? { context: this.ctx } : {}) });
      this.sc.setBeat(this.beat, this.intensity);
      const p = this.sc.start();
      this.sc.setMuted(false);
      await p;
      if (!this.want) this.sc.stop();
    } catch { this.on = false; }
    return this.on;
  }
  disable() {
    this.want = false;
    this.on = false;
    try { this.sc?.stop(); } catch { /* already stopped */ }
  }
  dispose() {
    this.want = false;
    this.on = false;
    try { this.sc?.dispose(); } catch { /* gone */ }
    try { void this.ctx?.close(); } catch { /* gone */ }
    this.sc = null;
    this.ctx = null;
  }
  /** The beat and its intensity (0..1); small changes in intensity cross-fade smoothly. */
  setBeat(beat: Beat, intensity?: number) {
    if (beat === this.beat && (intensity === undefined || Math.abs((this.intensity ?? -1) - intensity) < 0.04)) return;
    this.beat = beat;
    this.intensity = intensity;
    try { this.sc?.setBeat(beat, intensity); } catch { /* ignore */ }
  }
  cue(name: 'stylus' | 'seal' | 'door') {
    if (!this.on || !this.sc) return;
    try {
      if (name === 'stylus') this.sc.stylus?.();
      else if (name === 'seal') this.sc.seal?.();
      else this.sc.door?.();
    } catch { /* ignore */ }
  }
  /** The levy's horn: a long call and a rising answer, from the gate (a little to one side, far off when `far`). */
  horn(far = false) {
    const c = this.ctx;
    if (!this.on || !c || !hornFn || !rng) return;
    try {
      if (!this.hornBuf) {
        const sr = c.sampleRate;
        const x = hornFn(rng(), sr, { f: 146.8, notes: [[1, 1.4], [1.5, 0.5], [1.335, 0.35], [1.5, 1.6]], bright: 0.75 });
        const b = c.createBuffer(1, x.length, sr);
        b.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
        this.hornBuf = b;
      }
      const src = c.createBufferSource();
      src.buffer = this.hornBuf;
      const g = c.createGain();
      // near: its loudest 400 ms about −15.5 dBFS RMS (peaks −7.8), some 6 dB over the muster's bed, as the
      // soundscape's own one-shots stand; far off: quieter and duller
      g.gain.value = far ? 0.2 : 0.45;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = far ? 1600 : 5200;
      const pan = c.createStereoPanner();
      pan.pan.value = -0.25;
      src.connect(lp).connect(g).connect(pan).connect(c.destination);
      src.start(c.currentTime + 0.05);
    } catch { /* ignore */ }
  }
}
