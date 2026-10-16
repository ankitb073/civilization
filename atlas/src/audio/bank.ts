// The sample bank: every sound the soundscape plays, synthesized once from the seed at start().
// Static filtering (distance, tone, the crowd's band, the rain's hiss, the room) is baked into the samples here,
// so the live graph stays small: per-node overhead, not DSP, dominates WebAudio CPU at this scale.
// Built in small chunks with a yield between each (a few ms each on a laptop), so start() never stalls the page;
// layers simply wait for the buffers they need.

import * as dsp from './dsp.ts';
import type { Rng } from './dsp.ts';

export interface Bank {
  /** Wind: a stereo pink bed, a whistle source, a low rumble. */
  windBed?: AudioBuffer; whistle?: AudioBuffer; rumble?: AudioBuffer;
  ir?: AudioBuffer;
  /** Crowd: stereo babble, calm (market) and panicked; band baked in. */
  babble?: AudioBuffer; panic?: AudioBuffer;
  drone?: AudioBuffer; room?: AudioBuffer; tramp?: AudioBuffer;
  roar?: AudioBuffer; whoosh?: AudioBuffer; crackle?: AudioBuffer; collapse?: AudioBuffer;
  hiss?: AudioBuffer; rain?: AudioBuffer; drips?: AudioBuffer[];
  /** Drum hits: [big, frame, deep], near (march) and far (war) versions. */
  drumsNear?: AudioBuffer[]; drumsFar?: AudioBuffer[];
  horns?: AudioBuffer[]; barks?: AudioBuffer[]; steps?: AudioBuffer[]; birds?: AudioBuffer[];
  stylus?: AudioBuffer[]; seal?: AudioBuffer[]; page?: AudioBuffer[]; door?: AudioBuffer[];
  /** Tempo of the levy's tramp loop; the march drums keep step with it. */
  trampBpm: number;
  /** Work in progress between chunks (a layer only sees its buffers once they are all there). */
  hornsWip?: AudioBuffer[]; hissWip?: Float32Array;
  /** Bytes held by the buffers (float32), for the budget report. */
  bytes: number;
  /** Milliseconds of synthesis spent, and the slowest single chunk. */
  ms: number; worstMs: number;
  /** Milliseconds per named chunk (babble chunks summed). */
  chunks: Record<string, number>;
  done: boolean;
}

export const emptyBank = (): Bank => ({ trampBpm: 100, bytes: 0, ms: 0, worstMs: 0, chunks: {}, done: false });

/** Sample rates: full rate where the highs matter, lower where the sound is distant or dark (22.05 kHz is the
 *  lowest every browser accepts for createBuffer). */
const LO = 22050, MID = 32000;
/** Reverb impulse length (mono): the convolver's cost grows with it. */
export const IR_SECONDS = 1.6;

export function toBuffer(ctx: BaseAudioContext, chans: Float32Array[], sr: number, bank?: Bank): AudioBuffer {
  const b = ctx.createBuffer(chans.length, chans[0].length, sr);
  for (let c = 0; c < chans.length; c++) b.getChannelData(c).set(chans[c]);
  if (bank) bank.bytes += chans.length * chans[0].length * 4;
  return b;
}

type Task = readonly [string, () => void];

/** Far-off calls: a two-tone signal, a long single blast, a rising triple. Pitch ratios over seconds. */
const HORNS: readonly { f: number; notes: readonly (readonly [number, number])[]; bright: number }[] = [
  { f: 220, notes: [[1, 1.1], [1.5, 0.9], [1, 0.7]], bright: 0.8 },
  { f: 146.8, notes: [[1, 2.4]], bright: 0.6 },
  { f: 196, notes: [[1, 0.45], [1, 0.45], [1.335, 1.3]], bright: 0.9 },
];

export async function fillBank(ctx: BaseAudioContext, r: Rng, bank: Bank, alive: () => boolean, pause: () => Promise<void>): Promise<void> {
  const HI = ctx.sampleRate;
  const one = (x: Float32Array, sr: number): AudioBuffer => toBuffer(ctx, [x], sr, bank);
  const two = (l: Float32Array, rr: Float32Array, sr: number): AudioBuffer => {
    const n = Math.min(l.length, rr.length);
    return toBuffer(ctx, [l.subarray(0, n), rr.subarray(0, n)], sr, bank);
  };
  const many = (k: number, label: string, f: (rr: Rng) => Float32Array, sr: number): AudioBuffer[] =>
    Array.from({ length: k }, (_, i) => one(f(r.fork(label, i)), sr));

  // babble is the costliest synthesis: build it two voices per chunk
  const babbleTasks = (label: string, seconds: number, voices: number, panic: number, passes: readonly dsp.Pass[], done: (b: AudioBuffer) => void): Task[] => {
    const chans = [0, 1].map(() => new Float32Array(Math.floor(seconds * LO) + dsp.babbleFade(LO)));
    const tasks: Task[] = [];
    for (let c = 0; c < 2; c++) {
      for (let v = 0; v < voices; v += 2) {
        tasks.push([label, () => dsp.babbleVoices(chans[c], r.fork(label, c), LO, v, Math.min(voices, v + 2), panic)]);
      }
    }
    tasks.push([label, () => done(two(dsp.finishBabble(chans[0], LO, passes), dsp.finishBabble(chans[1], LO, passes), LO))]);
    return tasks;
  };

  const drumSpecs = (d: Rng) => [
    { f0: d.range(50, 58), f1: 108, decay: 0.42, noise: 0.35 },
    { f0: d.range(86, 100), f1: 150, decay: 0.22, noise: 0.5 },
    { f0: d.range(42, 48), f1: 92, decay: 0.6, noise: 0.25 },
  ];
  const shaped = (x: Float32Array, sr: number, type: dsp.BqType, f: number): Float32Array => dsp.normalizePeak(dsp.biquadPass(x, sr, type, f, 0.6), 0.9);

  const tasks: Task[] = [
    ['wind', () => {
      bank.windBed = two(dsp.noiseLoop('pink', r.fork('wind', 0), LO, 6), dsp.noiseLoop('pink', r.fork('wind', 1), LO, 6), LO);
      bank.whistle = one(dsp.noiseLoop('white', r.fork('whistle'), LO, 3), LO);
      bank.rumble = one(dsp.noiseLoop('brown', r.fork('rumble'), LO, 6, [['lp', 140, 0.6], ['hp', 40, 0.7]]), LO);
    }],
    ['ir', () => { bank.ir = toBuffer(ctx, dsp.impulseResponse(r.fork('ir'), HI, IR_SECONDS).slice(0, 1), HI, bank); }],
    ['stylus', () => { bank.stylus = many(8, 'stylus', (rr) => dsp.stylusPress(rr, HI), HI); }],
    ['drone', () => { bank.drone = one(dsp.droneLoop(r.fork('drone'), LO, 6), LO); }],
    ...babbleTasks('babble', 10, 12, 0, [['hp', 140, 0.7], ['lp', 1500, 0.7]], (b) => { bank.babble = b; }),
    ['tramp', () => {
      const bpm = Math.round(r.fork('tramp-bpm').range(94, 108));
      bank.trampBpm = bpm;
      bank.tramp = one(dsp.trampLoop(r.fork('tramp'), LO, bpm, 8), LO);
    }],
    ['drums', () => {
      const hits = drumSpecs(r.fork('drum-kit')).map((o, i) => dsp.drumHit(r.fork('drum', i), LO, o));
      bank.drumsNear = hits.map((h) => one(shaped(h.slice(), LO, 'lp', 1800), LO));
      bank.drumsFar = hits.map((h) => one(shaped(dsp.biquadPass(h.slice(), LO, 'lp', 900, 0.6), LO, 'lp', 900), LO));
    }],
    ...HORNS.map((spec, i): Task => ['horns', () => {
      const h = r.fork('horn-kit', i);
      const x = dsp.horn(h, LO, { f: spec.f * h.range(0.985, 1.015), notes: spec.notes, bright: spec.bright });
      (bank.hornsWip ??= []).push(one(shaped(x, LO, 'lp', 1700), LO));
      if (i === HORNS.length - 1) bank.horns = bank.hornsWip;
    }]),
    ['birds', () => { bank.birds = many(5, 'bird', (rr) => shaped(dsp.birdCall(rr, MID), MID, 'hp', 1200), MID); }],
    ['barks', () => { bank.barks = many(4, 'bark', (rr) => shaped(dsp.bark(rr, LO), LO, 'lp', 2600), LO); }],
    ['steps', () => { bank.steps = many(4, 'step', (rr) => shaped(dsp.footstep(rr, MID), MID, 'lp', 3500), MID); }],
    ['fire', () => {
      bank.roar = one(dsp.noiseLoop('brown', r.fork('roar'), LO, 6, [['lp', 320, 0.8], ['hp', 40, 0.7]]), LO);
      bank.whoosh = one(dsp.noiseLoop('pink', r.fork('whoosh'), LO, 5, [['bp', 750, 0.9]]), LO);
    }],
    ['crackle', () => { bank.crackle = two(dsp.crackleTexture(r.fork('crackle', 0), MID, 5, 22), dsp.crackleTexture(r.fork('crackle', 1), MID, 5, 22), MID); }],
    ['rain', () => { bank.hissWip = dsp.noiseLoop('pink', r.fork('hiss'), MID, 5, [['hp', 900, 0.7], ['lp', 6500, 0.7]]); }],
    ['rain', () => {
      const [l, rr] = dsp.rainTexture(r.fork('rain'), MID, 5, 260);
      bank.drips = many(4, 'drip', (x) => dsp.drip(x, MID), MID);
      bank.rain = two(l, rr, MID);
      bank.hiss = one(bank.hissWip!, MID);
      bank.hissWip = undefined;
    }],
    ['room', () => {
      const tone = dsp.noiseLoop('brown', r.fork('room'), LO, 6, [['lp', 220, 0.6], ['hp', 40, 0.7]]);
      const air = dsp.noiseLoop('pink', r.fork('room-air'), LO, 6, [['bp', 450, 0.5]]);
      for (let i = 0; i < tone.length; i++) tone[i] += 0.15 * air[i];
      bank.room = one(tone, LO);
    }],
    ['seal', () => { bank.seal = many(2, 'seal', (rr) => dsp.sealPress(rr, MID), MID); }],
    ['page', () => { bank.page = many(3, 'page', (rr) => dsp.pageTurn(rr, MID), MID); }],
    ['door', () => { bank.door = many(2, 'door', (rr) => dsp.doorSound(rr, MID), MID); }],
    ['collapse', () => { bank.collapse = one(dsp.collapse(r.fork('collapse'), LO), LO); }],
    ...babbleTasks('panic', 8, 12, 0.85, [['hp', 140, 0.7], ['lp', 2600, 0.7]], (b) => { bank.panic = b; }),
  ];
  for (const [name, run] of tasks) {
    if (!alive()) return;
    const t0 = performance.now();
    run();
    const dt = performance.now() - t0;
    bank.ms += dt;
    bank.worstMs = Math.max(bank.worstMs, dt);
    bank.chunks[name] = (bank.chunks[name] ?? 0) + dt;
    await pause();
  }
  bank.done = true;
}

/** Lyre strings are synthesized on demand at their exact pitch and cached (a motif uses five or six). */
export function makePluckCache(ctx: BaseAudioContext, r: Rng, bank: Bank, limit = 12): (midi: number) => AudioBuffer {
  const cache = new Map<number, AudioBuffer>();
  return (midi: number): AudioBuffer => {
    const hit = cache.get(midi);
    if (hit) { cache.delete(midi); cache.set(midi, hit); return hit; }
    const rr = r.fork('string', midi);
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const t60 = Math.min(4.6, Math.max(2, 4.6 - (midi - 45) * 0.085));
    const x = dsp.pluck(rr, MID, freq, { t60, bright: rr.range(0.4, 0.6), pos: rr.range(0.12, 0.2), seconds: Math.min(3.4, t60 * 0.8 + 0.3) });
    const b = toBuffer(ctx, [x], MID, bank);
    cache.set(midi, b);
    if (cache.size > limit) {
      const oldest = cache.keys().next().value as number;
      const old = cache.get(oldest);
      if (old) bank.bytes -= old.length * 4;
      cache.delete(oldest);
    }
    return b;
  };
}
