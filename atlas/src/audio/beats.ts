// What each beat of the game sounds like: a mix of layer levels (scaled by intensity) and a lyre motif.

import type { Rng } from './dsp.ts';

export type Beat = 'muster' | 'field' | 'walls' | 'fall-sack' | 'fall-treaty' | 'held' | 'tablet' | 'ending';
export const BEATS: readonly Beat[] = ['muster', 'field', 'walls', 'fall-sack', 'fall-treaty', 'held', 'tablet', 'ending'];

export type LayerName =
  | 'wind' | 'crowd' | 'fire' | 'rain' | 'drone' | 'room' | 'tramp'
  | 'birds' | 'drums' | 'horns' | 'dogs' | 'steps' | 'lyre';
export const LAYERS: readonly LayerName[] = ['wind', 'crowd', 'fire', 'rain', 'drone', 'room', 'tramp', 'birds', 'drums', 'horns', 'dogs', 'steps', 'lyre'];

/** Levels are 0..1 per layer (each layer is trimmed so 1 is "as loud as it should ever be"). */
export interface Mix {
  wind: number; gust: number;
  crowd: number; panic: number;
  fire: number; collapse: number;
  rain: number;
  drone: number;
  room: number; lamp: number;
  tramp: number;
  birds: number;
  drums: number; drumRate: number; drumStyle: 'march' | 'war' | 'slow';
  horns: number; hornRate: number; hornAtStart: boolean;
  dogs: number; dogRate: number;
  steps: number;
  lyre: number;
  /** 0 outdoors .. 1 inside the tablet house (the city heard through walls). */
  muffle: number;
}

const SILENT: Mix = {
  wind: 0, gust: 0, crowd: 0, panic: 0, fire: 0, collapse: 0, rain: 0, drone: 0, room: 0, lamp: 0, tramp: 0,
  birds: 0, drums: 0, drumRate: 0, drumStyle: 'war', horns: 0, hornRate: 0, hornAtStart: false,
  dogs: 0, dogRate: 0, steps: 0, lyre: 0.8, muffle: 0,
};

export const DEFAULT_INTENSITY: Record<Beat, number> = {
  muster: 0.5, field: 0.6, walls: 0.5, 'fall-sack': 0.7, 'fall-treaty': 0.4, held: 0.4, tablet: 0.3, ending: 0.4,
};

/** Cross-fade seconds into each beat (sudden for the sack, slow for the quiet rooms). */
export const FADE: Record<Beat, number> = {
  muster: 3, field: 3, walls: 3.5, 'fall-sack': 2, 'fall-treaty': 3, held: 3, tablet: 4, ending: 4,
};

/** Chance of gentle rain per beat when rain is 'auto' (drawn once per seed and beat). */
export const RAIN_CHANCE: Record<Beat, number> = {
  muster: 0, field: 0.2, walls: 0.4, 'fall-sack': 0, 'fall-treaty': 0.5, held: 0.25, tablet: 0.35, ending: 0.35,
};

export function mixFor(beat: Beat, i: number, rain: boolean): Mix {
  const wet = rain ? 1 : 0;
  switch (beat) {
    case 'muster': // morning: the levy marches out past the market
      return { ...SILENT, wind: 0.45, gust: 0.3 + 0.2 * i, crowd: 0.5 + 0.35 * i, panic: 0.05, birds: 0.4,
        tramp: 0.35 + 0.5 * i, drums: 0.45 + 0.45 * i, drumRate: 1, drumStyle: 'march',
        horns: 0.4, hornRate: 0.15 + 0.2 * i, hornAtStart: true, dogs: 0.25, dogRate: 0.15, lyre: 0.75 };
    case 'field': // on the walls, a battle far off; later the wounded come in
      return { ...SILENT, wind: 0.6, gust: 0.45 + 0.35 * i, crowd: 0.25 + 0.2 * i, panic: 0.3 + 0.2 * i,
        drums: 0.5 + 0.45 * i, drumRate: 0.45 + 0.5 * i, drumStyle: 'war', horns: 0.5 + 0.4 * i, hornRate: 0.3 + 0.4 * i,
        drone: 0.25 + 0.25 * i, dogs: 0.15, dogRate: 0.1, rain: 0.6 * wet, lyre: 0.8 };
    case 'walls': // the city under siege at night
      return { ...SILENT, wind: 0.55 + 0.2 * i, gust: 0.4 + 0.3 * i, crowd: 0.08, panic: 0.2,
        drone: 0.5 + 0.3 * i, dogs: 0.55 + 0.3 * i, dogRate: 0.35 + 0.4 * i, steps: 0.55 + 0.25 * i,
        drums: 0.25 + 0.3 * i, drumRate: 0.15 + 0.25 * i, drumStyle: 'war', horns: 0.2 + 0.25 * i, hornRate: 0.08 + 0.1 * i,
        rain: 0.6 * wet, lyre: 0.8 };
    case 'fall-sack': // the city burns
      return { ...SILENT, fire: 0.55 + 0.45 * i, collapse: i, crowd: 0.45 + 0.45 * i, panic: 0.85,
        wind: 0.55, gust: 0.6 + 0.3 * i, drums: 0.3 + 0.2 * i, drumRate: 0.35 + 0.3 * i, drumStyle: 'war',
        horns: 0.35 + 0.35 * i, hornRate: 0.25 + 0.3 * i, drone: 0.35 + 0.2 * i, dogs: 0.35, dogRate: 0.5, lyre: 0.7 };
    case 'fall-treaty': // terms read at the gate
      return { ...SILENT, wind: 0.5, gust: 0.3 + 0.2 * i, crowd: 0.2 + 0.15 * i, panic: 0.1,
        horns: 0.45, hornRate: 0.04 + 0.06 * i, hornAtStart: true, drums: 0.3 + 0.2 * i, drumRate: 0.2, drumStyle: 'slow',
        drone: 0.3 + 0.2 * i, dogs: 0.15, dogRate: 0.1, rain: 0.55 * wet, lyre: 0.8 };
    case 'held': // the walls held: dawn, and the city comes out
      return { ...SILENT, wind: 0.4, gust: 0.25, crowd: 0.35 + 0.35 * i, panic: 0, birds: 0.65,
        drums: 0.1 + 0.35 * i, drumRate: 0.25 + 0.3 * i, drumStyle: 'march', tramp: 0, horns: 0.25, hornRate: 0.08 + 0.1 * i,
        drone: 0.12, dogs: 0.2, dogRate: 0.15, rain: 0.45 * wet, lyre: 0.8 };
    case 'tablet': // inside the tablet house, composing the final entry
      return { ...SILENT, room: 0.75, lamp: 0.6, muffle: 1, wind: 0.4 + 0.2 * i, gust: 0.3, crowd: 0.18 + 0.1 * i, panic: 0.1,
        drone: 0.15 + 0.15 * i, dogs: 0.2 * i, dogRate: 0.1, rain: 0.7 * wet, lyre: 0.75 };
    case 'ending': // the tablet beside the record
      return { ...SILENT, room: 0.45, lamp: 0.3, muffle: 0.7, wind: 0.35, gust: 0.2, crowd: 0.06, drone: 0.25 + 0.1 * i,
        rain: 0.6 * wet, lyre: 0.95 };
  }
}

// ---------- the lyre motif ----------

const MODES = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
} as const;
type Mode = keyof typeof MODES;

interface MotifSpec {
  mode: Mode; root: number; lo: number; hi: number; notes: [number, number];
  /** Seconds per rhythmic unit; the last note rings for three. */
  unit: number;
  end: 'tonic' | 'fifth';
  /** Seconds between the motif's (rare) returns while the beat lasts. */
  repeat: [number, number];
  dyadEnd?: boolean;
}

const D3 = 50;
const SPECS: Record<Beat, MotifSpec> = {
  muster: { mode: 'dorian', root: D3, lo: 0, hi: 9, notes: [4, 6], unit: 0.5, end: 'fifth', repeat: [55, 85] },
  field: { mode: 'phrygian', root: D3, lo: -2, hi: 7, notes: [4, 5], unit: 0.62, end: 'tonic', repeat: [60, 95] },
  walls: { mode: 'aeolian', root: D3, lo: 0, hi: 8, notes: [3, 5], unit: 0.75, end: 'tonic', repeat: [70, 110] },
  'fall-sack': { mode: 'phrygian', root: D3, lo: -3, hi: 5, notes: [3, 4], unit: 0.85, end: 'tonic', repeat: [80, 120] },
  'fall-treaty': { mode: 'aeolian', root: D3, lo: 0, hi: 7, notes: [4, 5], unit: 0.7, end: 'fifth', repeat: [70, 100] },
  held: { mode: 'mixolydian', root: D3, lo: 2, hi: 11, notes: [5, 6], unit: 0.5, end: 'tonic', repeat: [55, 85] },
  tablet: { mode: 'dorian', root: D3, lo: 0, hi: 9, notes: [4, 6], unit: 0.6, end: 'fifth', repeat: [45, 75] },
  ending: { mode: 'aeolian', root: D3, lo: -3, hi: 9, notes: [6, 8], unit: 0.62, end: 'tonic', repeat: [40, 65], dyadEnd: true },
};

/** `up` is the next note of the mode above, for grace notes. */
export interface MotifNote { at: number; midi: number; vel: number; up: number }
export interface Motif { notes: MotifNote[]; length: number; repeat: [number, number] }

const midiOf = (spec: MotifSpec, deg: number): number => {
  const m = MODES[spec.mode];
  const oct = Math.floor(deg / 7);
  return spec.root + 12 * oct + m[((deg % 7) + 7) % 7];
};

/**
 * One short phrase per beat, fixed by the seed: mostly stepwise in the beat's mode, a leap or two, ending on
 * the tonic or the fifth and left to ring. The first note may be a dyad with the fifth below, as lyres were played.
 */
export function makeMotif(beat: Beat, r: Rng): Motif {
  const spec = SPECS[beat];
  const n = r.int(spec.notes[0], spec.notes[1]);
  const degs: number[] = [r.pick([0, 2, 4, 4, 7].filter((d) => d >= spec.lo && d <= spec.hi))];
  for (let k = 1; k < n - 1; k++) {
    let d = degs[k - 1];
    for (let tries = 0; tries < 6 && d === degs[k - 1]; tries++) {
      const step = r.chance(0.7) ? r.pick([-1, 1]) : r.pick([-3, -2, 2, 3, 4, -4]);
      d = Math.max(spec.lo, Math.min(spec.hi, degs[k - 1] + step));
    }
    degs.push(d);
  }
  const target = spec.end === 'tonic' ? 0 : 4;
  const prev = degs[degs.length - 1];
  const options = [target - 7, target, target + 7].filter((d) => d >= spec.lo - 3 && d <= spec.hi);
  degs.push(options.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a)));

  const notes: MotifNote[] = [];
  let t = 0;
  for (let k = 0; k < degs.length; k++) {
    const last = k === degs.length - 1;
    const vel = last ? 0.62 : 0.6 + 0.25 * Math.sin((Math.PI * (k + 0.5)) / degs.length) + r.range(-0.05, 0.05);
    notes.push({ at: t, midi: midiOf(spec, degs[k]), vel, up: midiOf(spec, degs[k] + 1) });
    if (k === 0 && r.chance(0.5)) notes.push({ at: t - 0.035, midi: midiOf(spec, degs[k] - 4), vel: vel * 0.55, up: midiOf(spec, degs[k] - 3) });
    if (last && spec.dyadEnd) notes.push({ at: t + 0.04, midi: midiOf(spec, degs[k] + 4), vel: vel * 0.6, up: midiOf(spec, degs[k] + 5) });
    t += last ? spec.unit * 3 : spec.unit * r.pick([1, 1, 1.5, 2, 0.5]);
  }
  const first = Math.min(...notes.map((x) => x.at));
  for (const x of notes) x.at -= first;
  notes.sort((a, b) => a.at - b.at);
  return { notes, length: t - first, repeat: spec.repeat };
}

/** A return of the motif: the same notes, a little rubato and touch, sometimes a grace note. */
export function vary(m: Motif, r: Rng, plain: boolean): MotifNote[] {
  if (plain) return m.notes.map((x) => ({ ...x }));
  const out: MotifNote[] = [];
  const stretch = r.range(0.95, 1.08);
  for (let k = 0; k < m.notes.length; k++) {
    const x = m.notes[k];
    const at = x.at * stretch + (k > 0 ? r.range(-0.03, 0.03) : 0);
    const vel = Math.max(0.2, x.vel * r.range(0.85, 1.08));
    if (k > 0 && k < m.notes.length - 1 && r.chance(0.2)) out.push({ at: Math.max(0, at - 0.075), midi: x.up, vel: vel * 0.45, up: x.up });
    out.push({ at: Math.max(0, at), midi: x.midi, vel, up: x.up });
  }
  return out.sort((a, b) => a.at - b.at);
}
