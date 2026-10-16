/**
 * The Tablet House — procedural soundscape (WebAudio only: no audio files, no dependencies, no ScriptProcessor).
 *
 * ```ts
 * import { createSoundscape } from '../../audio/soundscape.ts';
 *
 * const sound = createSoundscape({ seed: scenario.id });   // same scenario, same sounds
 * sound.setBeat('muster');                                  // may be called before start(); applied on start
 *
 * // In a click/tap/keydown handler (browsers only allow audio to begin inside a user gesture):
 * button.onclick = () => { void sound.start(); sound.setMuted(false); };   // "Sound on"
 *
 * sound.setBeat('field', 0.8);      // cross-fades over 2–4 s; intensity 0..1 (omit for the beat's default)
 * sound.stylus();                   // each wedge pressed into the clay (pitch-varied, never the same twice running)
 * sound.seal(); sound.pageTurn(); sound.door();
 * sound.setVolume(0.6);             // 0..1, perceptual (squared) curve
 * sound.stop();                     // fade out and suspend (start() resumes)
 * sound.dispose();                  // tear down (closes the AudioContext it created)
 * ```
 *
 * Beats: 'muster' (morning, the levy marches out past the market: tramp, march drums, a signal horn, birds),
 * 'field' (a battle far off: war drums, horns, wind, a hushed anxious crowd, dread drone),
 * 'walls' (the city under siege at night: drone, wind whistling, dogs, a watchman's steps, the enemy camp far off),
 * 'fall-sack' (fire roar and crackle, falling timber, a panicked crowd, victors' horns),
 * 'fall-treaty' (a parley horn, a slow single drum, a hushed assembly), 'held' (dawn, birds, relief),
 * 'tablet' (inside the tablet house: room tone, an oil lamp, the city muffled through the walls),
 * 'ending' (quiet; the lyre's longest phrase). Every beat has its own lyre motif (Karplus-Strong plucked gut
 * strings, modal: dorian / phrygian / aeolian / mixolydian on D), played once after the cross-fade and returned to
 * rarely. Gentle rain is a seeded variation on some beats (`rain: 'auto' | 'on' | 'off'`).
 *
 * Muting: phones and tablets start muted (`opts.muted` overrides). While muted (or stopped, or the tab hidden)
 * the AudioContext is suspended, so it costs no CPU. On iOS, call setMuted(false) from the "Sound on" tap itself.
 *
 * Offline rendering (tests, previews): pass an OfflineAudioContext as `context`, `await start()`, then drive time
 * with `advance(seconds)`; beat changes and one-shots apply at the current advanced time:
 * ```ts
 * const ctx = new OfflineAudioContext(2, 48000 * 10, 48000);
 * const s = createSoundscape({ context: ctx, seed: 7 });
 * await s.start(); s.setBeat('walls'); s.advance(10);
 * const buffer = await ctx.startRendering();
 * ```
 * soundscape-demo.ts wraps this (renderOffline, a tour of every beat, WAV encoding, levels) and mounts a small
 * audition panel (mountSoundscapeDemo). atlas/scripts/sound-check.ts renders every beat headlessly in Playwright,
 * checks levels, determinism and the live engine, and measures CPU:
 *   node --disable-warning=ExperimentalWarning atlas/scripts/sound-check.ts --out=build/sound [--layers]
 *
 * How it stays cheap: WebAudio's cost at this scale is per connected node (~1 µs per 128-frame quantum, even
 * silent), so every static filter is baked into the samples, silent layers have no nodes, event sounds get a
 * short-lived panner per group, and the reverb is one ConvolverNode on a mono downmix (1.6 s generated impulse),
 * widened by a short delay. ~15–35 live nodes per beat. Every sample (~17 MB) is synthesized from the seed during
 * start(), in chunks of ≤ ~15 ms on a laptop, so the page never stalls; layers join as their buffers arrive.
 * Measured (headless Chromium, M-series Mac, % of one core): a bare running AudioContext ~0.5–1%; each beat
 * ~2–3% in total including that, rising to 4–5% when the machine is busy; 0% while muted or hidden.
 * `latencyHint: 'playback'` saves another ~0.5% at the cost of ~30 ms more stylus latency.
 *
 * Levels at volume 1: beats −26 to −18 LUFS (tablet/ending quietest, the sack loudest), one-shots stand ~6–10 dB
 * above the bed; a DynamicsCompressor limiter and a soft clipper keep every peak below −1 dBFS (measured ≤ −4.7).
 */

import { BEATS, DEFAULT_INTENSITY, FADE, LAYERS, RAIN_CHANCE, makeMotif, mixFor } from './beats.ts';
import type { Beat, LayerName, Mix, Motif } from './beats.ts';
import { emptyBank, fillBank, makePluckCache } from './bank.ts';
import type { Bank } from './bank.ts';
import { hash32, makeRng } from './dsp.ts';
import type { Rng } from './dsp.ts';
import * as L from './layers.ts';
import type { Env, Layer, LyreLayer } from './layers.ts';

export { BEATS, LAYERS };
export type { Beat, LayerName };

export interface SoundscapeOptions {
  /** Seeds every sound (a scenario id works). Default: a fixed seed. */
  seed?: number | string;
  /** Render into this context (e.g. an OfflineAudioContext). Default: a new AudioContext created by start(). */
  context?: BaseAudioContext;
  /** Start muted. Default: true on phones and tablets, false elsewhere. */
  muted?: boolean;
  /** 0..1, default 1 (levels are calibrated for it; the limiter keeps peaks under -1 dBFS). */
  volume?: number;
  /** Gentle rain: seeded per beat ('auto', default), always where it fits ('on'), or never ('off'). */
  rain?: 'auto' | 'on' | 'off';
  /** Suspend audio while the tab is hidden. Default true. */
  pauseWhenHidden?: boolean;
  /** AudioContext latency hint. Default 'balanced' (~40 ms to the speaker on a Mac: tight enough for the stylus,
   *  and cheaper than 'interactive'). */
  latencyHint?: AudioContextLatencyCategory | number;
  /** AudioContext sample rate. Default: the device's. */
  sampleRate?: number;
  /** Debug: only these layers sound (calibration, auditioning). */
  solo?: readonly LayerName[];
}

export type SoundscapeState = 'idle' | 'loading' | 'running' | 'stopped' | 'disposed' | 'unsupported';

export interface Soundscape {
  /** Create/resume the audio context and begin. Call from a user gesture. Resolves once every sound is built. */
  start(): Promise<void>;
  /** Fade out and suspend. start() resumes. */
  stop(): void;
  /** Move to a beat (cross-fade 2–4 s) or change its intensity (0..1) smoothly. */
  setBeat(beat: Beat, intensity?: number): void;
  /** One wedge of the stylus pressed into wet clay. */
  stylus(): void;
  /** A seal pressed and rolled into the clay. */
  seal(): void;
  /** A page or papyrus leaf turned. */
  pageTurn(): void;
  /** The heavy door of the tablet house. */
  door(): void;
  /** 0..1 (perceptual curve). */
  setVolume(v: number): void;
  /** Mute or unmute (suspends the context while muted). Unmute from a user gesture on iOS. */
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  readonly volume: number;
  readonly beat: Beat | null;
  readonly intensity: number;
  readonly state: SoundscapeState;
  readonly context: BaseAudioContext | null;
  /** The final node before the destination, for meters (connect an AnalyserNode). Null before start(). */
  readonly output: AudioNode | null;
  /** Bank statistics: bytes of buffers, ms of synthesis (total, slowest chunk, per chunk), and whether it is complete. */
  readonly stats: { bytes: number; ms: number; worstMs: number; done: boolean; chunks: Record<string, number> };
  /** OfflineAudioContext only: schedule everything up to this time (seconds). Beats and one-shots apply at it. */
  advance(seconds: number): void;
  /** Stop everything, remove listeners, close the context if this soundscape created it. */
  dispose(): void;
}

const LOOKAHEAD = 1.2;
const TICK_MS = 200;
const RAINY: readonly Beat[] = ['field', 'walls', 'fall-treaty', 'held', 'tablet', 'ending'];

/** True for phones and tablets: they start muted until the player taps "Sound on". */
export function prefersMutedStart(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod|Android|Mobile/i.test(ua)) return true;
  if (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1) return true; // iPadOS
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}

const isOffline = (c: BaseAudioContext): boolean => typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext;
const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

interface Graph {
  mix: GainNode; muffleDry: BiquadFilterNode; muffleSend: BiquadFilterNode; convolver: ConvolverNode;
  sfx: GainNode; sfxSend: GainNode;
  /** volume² × (on ? 1 : 0): the volume and the mute/stop gate in one node. */
  master: GainNode;
  layers: Layer[]; lyre: LyreLayer;
}

type SfxKind = 'stylus' | 'seal' | 'page' | 'door';
const SFX: Record<SfxKind, { rate: [number, number]; gain: [number, number]; pan: number }> = {
  stylus: { rate: [0.88, 1.14], gain: [0.32, 0.45], pan: 0.18 },
  seal: { rate: [0.94, 1.05], gain: [0.26, 0.31], pan: 0.08 },
  page: { rate: [0.92, 1.08], gain: [0.22, 0.3], pan: 0.3 },
  door: { rate: [0.95, 1.04], gain: [0.33, 0.4], pan: 0.35 },
};

export function createSoundscape(opts: SoundscapeOptions = {}): Soundscape {
  const seed = typeof opts.seed === 'string' ? hash32(opts.seed) : ((opts.seed ?? 0x7ab1e7) >>> 0);
  const root: Rng = makeRng(seed);
  const solo = opts.solo ? new Set<LayerName>(opts.solo) : null;
  const rainMode = opts.rain ?? 'auto';
  let ctx: BaseAudioContext | null = opts.context ?? null;
  const owned = !opts.context;
  const offline = !!ctx && isOffline(ctx);
  let muted = opts.muted ?? (offline ? false : prefersMutedStart());
  let volume = clamp01(opts.volume ?? 1);
  let state: SoundscapeState = 'idle';
  let beat: Beat | null = null;
  let intensity = 0.5;
  let applied = false;
  let stopped = false;
  let graph: Graph | null = null;
  let bank: Bank = emptyBank();
  let building: Promise<void> | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let suspendTimer: ReturnType<typeof setTimeout> | null = null;
  let vnow = 0;
  const motifs = new Map<Beat, Motif>();
  const lastSfx: Partial<Record<SfxKind, number>> = {};
  const sfxRng: Record<SfxKind, Rng> = { stylus: root.fork('sfx', 'stylus'), seal: root.fork('sfx', 'seal'), page: root.fork('sfx', 'page'), door: root.fork('sfx', 'door') };

  /** Audio time to schedule at: the advanced clock offline, a little ahead of the playhead live. */
  const now = (): number => (offline ? vnow : (ctx ? ctx.currentTime + 0.03 : 0));
  const live = (): AudioContext | null => (ctx && !offline ? (ctx as AudioContext) : null);

  const later = (at: number, fn: () => void): void => {
    if (offline || !ctx) return;
    const c = ctx;
    const check = (): void => {
      if (state === 'disposed') return;
      if (c.currentTime >= at) fn();
      else setTimeout(check, Math.max(50, (at - c.currentTime) * 1000));
    };
    setTimeout(check, Math.max(50, (at - c.currentTime) * 1000));
  };

  const rainFor = (b: Beat): boolean => {
    if (rainMode === 'off' || !RAINY.includes(b)) return false;
    if (rainMode === 'on') return true;
    return root.fork('weather', b).chance(RAIN_CHANCE[b]);
  };

  const motifFor = (b: Beat): Motif => {
    let m = motifs.get(b);
    if (!m) { m = makeMotif(b, root.fork('motif', b)); motifs.set(b, m); }
    return m;
  };

  function buildGraph(c: BaseAudioContext): Graph {
    const g = (v: number): GainNode => { const n = c.createGain(); n.gain.value = v; return n; };
    /** Process as mono (a downmix). Engines that refuse just process stereo. */
    const mono = (n: AudioNode): void => { try { n.channelCount = 1; n.channelCountMode = 'explicit'; } catch { /* stereo */ } };
    const lowpass = (): BiquadFilterNode => {
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 18000; f.Q.value = 0.5;
      try { f.frequency.automationRate = 'k-rate'; } catch { /* a-rate */ }
      return f;
    };
    const mix = g(1);
    // the walls: outdoor sounds (and their reverb) are low-passed when the scene is indoors
    const outdoor = g(1), muffleDry = lowpass(), muffleSend = lowpass();
    mono(muffleSend); // it only feeds the mono reverb
    outdoor.connect(muffleDry); muffleDry.connect(mix);
    const mid = g(0.3), far = g(0.85), dsend = g(0.35), sfx = g(1), sfxSend = g(0.15);
    mid.connect(muffleSend); far.connect(muffleSend);
    // reverb: a mono impulse fed a mono downmix (half the convolution work), widened by a short delay + all-pass
    const convolver = c.createConvolver();
    convolver.normalize = true;
    mono(convolver);
    muffleSend.connect(convolver); dsend.connect(convolver); sfxSend.connect(convolver);
    const widen = c.createDelay(0.05);
    widen.delayTime.value = 0.013;
    const ap = c.createBiquadFilter();
    ap.type = 'allpass'; ap.frequency.value = 700; ap.Q.value = 0.6;
    const wet = c.createChannelMerger(2);
    convolver.connect(wet, 0, 0);
    convolver.connect(widen); widen.connect(ap); ap.connect(wet, 0, 1);
    wet.connect(mix);
    sfx.connect(mix);
    // limiter: fast, high ratio; then a soft clipper so nothing can ever reach full scale
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 6; limiter.ratio.value = 16;
    limiter.attack.value = 0.002; limiter.release.value = 0.25;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      const a = Math.abs(x);
      curve[i] = Math.sign(x) * (a < 0.75 ? a : 0.75 + 0.2 * Math.tanh((a - 0.75) / 0.2));
    }
    shaper.curve = curve;
    shaper.oversample = 'none';
    const master = g(0);
    mix.connect(limiter); limiter.connect(shaper); shaper.connect(master); master.connect(c.destination);

    const env: Env = {
      ctx: c, bank, out: { outdoor, dry: mix, mid, far, dsend }, later,
      pluck: makePluckCache(c, root.fork('lyre'), bank),
      march: { t0: 0, beat: 0.6, live: false },
    };
    const lr = (name: LayerName): Rng => root.fork('layer', name);
    const lyre = L.lyreLayer(env, lr('lyre'));
    const layers: Layer[] = [
      L.windLayer(env, lr('wind')), L.crowdLayer(env, lr('crowd')), L.fireLayer(env, lr('fire')), L.rainLayer(env, lr('rain')),
      L.droneLayer(env, lr('drone')), L.roomLayer(env, lr('room')), L.trampLayer(env),
      L.birdsLayer(env, lr('birds')), L.drumsLayer(env, lr('drums')), L.hornsLayer(env, lr('horns')),
      L.dogsLayer(env, lr('dogs')), L.stepsLayer(env, lr('steps')), lyre,
    ];
    return { mix, muffleDry, muffleSend, convolver, sfx, sfxSend, master, layers, lyre };
  }

  function pump(): void {
    if (!graph || state === 'disposed') return;
    if (bank.ir && !graph.convolver.buffer) graph.convolver.buffer = bank.ir;
    const from = now();
    const until = from + LOOKAHEAD;
    for (const l of graph.layers) l.pump(from, until);
  }

  function soloed(m: Mix): Mix {
    if (!solo) return m;
    const out: Mix = { ...m };
    for (const name of LAYERS) if (!solo.has(name)) out[name] = 0;
    return out;
  }

  function applyBeat(fresh: boolean, fade: number): void {
    if (!graph || !beat) return;
    const at = now();
    const m = soloed(mixFor(beat, intensity, rainFor(beat)));
    for (const l of graph.layers) l.set(m, at, fade, fresh);
    const f = 18000 * Math.pow(650 / 18000, m.muffle);
    for (const fl of [graph.muffleDry, graph.muffleSend]) {
      fl.frequency.cancelScheduledValues(at);
      fl.frequency.setTargetAtTime(f, at, fade / 4);
    }
    if (fresh) graph.lyre.setMotif(motifFor(beat), at + (applied ? fade * 0.8 + 0.8 : 2.5));
    applied = true;
    pump();
  }

  function applyGate(): void {
    if (!graph) return;
    const on = !muted && !stopped;
    const t = now();
    graph.master.gain.cancelScheduledValues(t);
    graph.master.gain.setTargetAtTime(on ? volume * volume : 0, t, on ? 0.35 : 0.08);
    const ac = live();
    if (!ac) return;
    if (suspendTimer) { clearTimeout(suspendTimer); suspendTimer = null; }
    if (on) {
      if (!(opts.pauseWhenHidden !== false && typeof document !== 'undefined' && document.hidden)) void ac.resume().catch(() => {});
    } else {
      suspendTimer = setTimeout(() => { if ((muted || stopped) && ac.state === 'running') void ac.suspend().catch(() => {}); }, 700);
    }
  }

  const onVisibility = (): void => {
    const ac = live();
    if (!ac || state === 'disposed') return;
    if (document.hidden) { if (ac.state === 'running') void ac.suspend().catch(() => {}); }
    else if (!muted && !stopped) void ac.resume().catch(() => {});
  };

  function sfx(kind: SfxKind): void {
    if (!graph || !ctx || stopped || state === 'disposed') return;
    const list = bank[kind];
    if (!list?.length) return;
    const r = sfxRng[kind];
    const spec = SFX[kind];
    let v = r.int(0, list.length - 1);
    if (v === lastSfx[kind] && list.length > 1) v = (v + 1 + r.int(0, list.length - 2)) % list.length;
    lastSfx[kind] = v;
    const c = ctx;
    const s = c.createBufferSource();
    s.buffer = list[v];
    s.playbackRate.value = r.range(spec.rate[0], spec.rate[1]);
    const g = c.createGain();
    g.gain.value = r.range(spec.gain[0], spec.gain[1]);
    const p = L.panner(c, r.range(-spec.pan, spec.pan));
    s.connect(g); g.connect(p); p.connect(graph.sfx); p.connect(graph.sfxSend);
    s.onended = () => { p.disconnect(); };
    s.start(offline ? vnow : 0);
  }

  const api: Soundscape = {
    start() {
      if (state === 'disposed' || state === 'unsupported') return Promise.resolve();
      if (!ctx) {
        const w = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
        const Ctor = w.AudioContext ?? w.webkitAudioContext;
        if (!Ctor) { state = 'unsupported'; return Promise.resolve(); }
        try { ctx = new Ctor({ latencyHint: opts.latencyHint ?? 'balanced', ...(opts.sampleRate ? { sampleRate: opts.sampleRate } : {}) }); }
        catch { state = 'unsupported'; return Promise.resolve(); }
      }
      const ac = live();
      if (ac) {
        // inside the gesture: resume and play one silent sample (unlocks iOS), before any await
        void ac.resume().catch(() => {});
        try {
          const b = ac.createBuffer(1, 1, ac.sampleRate);
          const s = ac.createBufferSource();
          s.buffer = b; s.connect(ac.destination); s.start(0);
        } catch { /* best effort */ }
      }
      stopped = false;
      if (!graph) graph = buildGraph(ctx);
      if (state === 'idle' || state === 'stopped') state = bank.done ? 'running' : 'loading';
      applyGate();
      if (ac && !ticker) ticker = setInterval(pump, TICK_MS);
      if (ac && opts.pauseWhenHidden !== false && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
      if (beat && !applied) applyBeat(true, 2.5);
      if (!building) {
        const c = ctx;
        building = fillBank(c, root.fork('bank'), bank, () => state !== 'disposed', () => new Promise<void>((res) => setTimeout(res, 0)))
          .then(() => {
            if (state === 'loading') state = stopped ? 'stopped' : 'running';
            pump();
          });
      }
      pump();
      return building;
    },
    stop() {
      if (!graph || state === 'disposed') return;
      stopped = true;
      state = 'stopped';
      applyGate();
    },
    setBeat(b, i) {
      if (!BEATS.includes(b)) return;
      const ni = clamp01(i ?? DEFAULT_INTENSITY[b]);
      const fresh = b !== beat;
      if (!fresh && Math.abs(ni - intensity) < 1e-3) return;
      beat = b;
      intensity = ni;
      if (graph) applyBeat(fresh || !applied, fresh || !applied ? FADE[b] : 1.5);
    },
    stylus: () => sfx('stylus'),
    seal: () => sfx('seal'),
    pageTurn: () => sfx('page'),
    door: () => sfx('door'),
    setVolume(v) {
      volume = clamp01(v);
      if (!graph) return;
      if (muted || stopped) return;
      const t = now();
      graph.master.gain.cancelScheduledValues(t);
      graph.master.gain.setTargetAtTime(volume * volume, t, 0.08);
    },
    setMuted(m) {
      if (muted === m) return;
      muted = m;
      applyGate();
    },
    get muted() { return muted; },
    get volume() { return volume; },
    get beat() { return beat; },
    get intensity() { return intensity; },
    get state() { return state; },
    get context() { return ctx; },
    get output() { return graph ? graph.master : null; },
    get stats() { return { bytes: bank.bytes, ms: bank.ms, worstMs: bank.worstMs, done: bank.done, chunks: { ...bank.chunks } }; },
    advance(seconds) {
      if (!offline) throw new Error('advance() drives an OfflineAudioContext; live contexts keep their own time');
      while (vnow < seconds - 1e-9) {
        vnow = Math.min(seconds, vnow + TICK_MS / 1000);
        pump();
      }
    },
    dispose() {
      if (state === 'disposed') return;
      state = 'disposed';
      if (ticker) clearInterval(ticker);
      if (suspendTimer) clearTimeout(suspendTimer);
      ticker = null;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      try { graph?.master.disconnect(); } catch { /* already gone */ }
      const ac = live();
      if (ac && owned && ac.state !== 'closed') void ac.close().catch(() => {});
      graph = null;
      bank = emptyBank();
    },
  };
  return api;
}
