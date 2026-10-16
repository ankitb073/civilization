// The soundscape's layers. Two kinds:
// - continuous beds (wind, crowd, fire, rain, drone, room, tramp): looping sources that exist only while the layer
//   is audible. Each activation is an "instance" with its own gain, so a layer leaving and returning cross-fades
//   rather than jumps, and a silent layer has no nodes at all.
// - event layers (drums, horns, dogs, steps, birds, lyre): no standing nodes. A look-ahead pump schedules one-shot
//   buffers at sample-accurate times, each group (a bark bout, a horn call, a drum phrase, a walk) through its own
//   short-lived panner that is disconnected when the group has rung out. A beat change simply stops scheduling;
//   what is already scheduled (at most the look-ahead) plays out.
// Why so frugal: WebAudio's cost at this scale is per connected node per 128-frame quantum (~1 µs each, even when
// silent), so static filtering is baked into the samples (bank.ts) and the graph holds ~25-40 nodes per beat.
// All smooth level changes use setTargetAtTime after cancelScheduledValues(at), so they chain from wherever the
// parameter is without reading .value (which is wrong for an OfflineAudioContext before rendering).

import type { Bank } from './bank.ts';
import type { LayerName, Mix, Motif, MotifNote } from './beats.ts';
import { vary } from './beats.ts';
import type { Rng } from './dsp.ts';

export type Bus = 'outdoor' | 'dry' | 'mid' | 'far' | 'dsend';

export interface Env {
  ctx: BaseAudioContext;
  bank: Bank;
  /** outdoor: muffled when indoors; dry: straight to the mix; mid/far: outdoor reverb sends; dsend: dry reverb send. */
  out: Record<Bus, AudioNode>;
  /** Run fn once audio time has passed `at` (cleanup; a no-op offline). */
  later(at: number, fn: () => void): void;
  pluck(midi: number): AudioBuffer;
  /** The levy's march, so the drums keep step with the feet. */
  march: { t0: number; beat: number; live: boolean };
}

export interface Layer {
  readonly name: LayerName;
  /** Move to a mix. `fresh` is true when the beat itself changed (not just its intensity). */
  set(m: Mix, at: number, fade: number, fresh: boolean): void;
  pump(from: number, until: number): void;
}

export interface LyreLayer extends Layer {
  setMotif(m: Motif | null, firstAt: number): void;
}

/** Per-layer trim: the gain at level 1, calibrated against offline renders (scripts/sound-check.ts --layers). */
export const TRIM: Record<LayerName, number> = {
  wind: 0.185, crowd: 0.24, fire: 0.3, rain: 0.175, drone: 0.15, room: 0.09, tramp: 0.36,
  birds: 0.094, drums: 0.105, horns: 0.17, dogs: 0.155, steps: 0.4, lyre: 0.3,
};

/** Where each layer sounds, and which reverb send it feeds (distant things are mostly reverb). */
const ROUTE: Record<LayerName, readonly [Bus, Bus | null]> = {
  wind: ['outdoor', null], crowd: ['outdoor', 'mid'], fire: ['outdoor', 'mid'], rain: ['outdoor', null],
  drone: ['dry', 'dsend'], room: ['dry', null], tramp: ['outdoor', 'mid'], birds: ['outdoor', 'mid'],
  drums: ['outdoor', 'far'], horns: ['outdoor', 'far'], dogs: ['outdoor', 'far'], steps: ['outdoor', 'mid'], lyre: ['dry', 'dsend'],
};

// ---------- node helpers ----------

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function gainNode(ctx: BaseAudioContext, v: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}
/** Filters whose frequency is automated run at k-rate: per-sample coefficient updates are the costly part. */
function filter(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q: number): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  try { b.frequency.automationRate = 'k-rate'; } catch { /* older engines: a-rate */ }
  return b;
}
/** A stereo panner; engines without one (Safari before 14.1) get a plain gain with a stand-in `pan` param. */
export function panner(ctx: BaseAudioContext, p: number): StereoPannerNode {
  if (typeof ctx.createStereoPanner !== 'function') {
    const g = ctx.createGain() as unknown as StereoPannerNode & GainNode;
    Object.defineProperty(g, 'pan', { value: ctx.createGain().gain }); // automations land on an unconnected param
    return g;
  }
  const s = ctx.createStereoPanner();
  s.pan.value = p;
  return s;
}
function source(ctx: BaseAudioContext, buffer: AudioBuffer, loop: boolean, rate = 1): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buffer;
  s.loop = loop;
  s.playbackRate.value = rate;
  return s;
}
function chain(...nodes: AudioNode[]): void {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
}
function route(env: Env, name: LayerName, node: AudioNode): void {
  const [dry, send] = ROUTE[name];
  node.connect(env.out[dry]);
  if (send) node.connect(env.out[send]);
}
/** Fire-and-forget buffer playback: source → gain → dest, cleaned up when it ends. */
export function oneShot(ctx: BaseAudioContext, buffer: AudioBuffer, at: number, dest: AudioNode, amp: number, rate = 1): void {
  const s = source(ctx, buffer, false, rate);
  const g = gainNode(ctx, amp);
  s.connect(g);
  g.connect(dest);
  s.onended = () => { g.disconnect(); };
  s.start(at);
}
/** A panner for one group of events, routed like its layer and removed once the group has rung out. */
function group(env: Env, name: LayerName, pan: number, end: number): StereoPannerNode {
  const p = panner(env.ctx, pan);
  route(env, name, p);
  env.later(end + 0.5, () => p.disconnect());
  return p;
}
const target = (p: AudioParam, v: number, at: number, tc: number): void => { p.setTargetAtTime(v, at, Math.max(0.005, tc)); };
const retarget = (p: AudioParam, v: number, at: number, tc: number): void => { p.cancelScheduledValues(at); target(p, v, at, tc); };

// ---------- continuous beds ----------

interface Inst {
  gain: GainNode;
  srcs: AudioScheduledSourceNode[];
  update(m: Mix, at: number, tc: number): void;
  pump(from: number, until: number): void;
}

function continuous(env: Env, name: LayerName, level: (m: Mix) => number, ready: () => boolean, make: (at: number, m: Mix) => Inst): Layer {
  let cur: Inst | null = null;
  let pending: Mix | null = null;
  const retire = (inst: Inst, at: number, fade: number): void => {
    retarget(inst.gain.gain, 0, at, fade / 4);
    const end = at + fade * 1.6 + 0.05;
    for (const s of inst.srcs) s.stop(end);
    env.later(end + 0.1, () => inst.gain.disconnect());
  };
  const layer: Layer = {
    name,
    set(m, at, fade) {
      const lv = level(m);
      if (lv <= 0.001) {
        pending = null;
        if (cur) { retire(cur, at, fade); cur = null; }
        return;
      }
      if (!cur) {
        if (!ready()) { pending = m; return; }
        cur = make(at, m);
        cur.gain.gain.value = 0;
        cur.gain.gain.setValueAtTime(0, at);
        route(env, name, cur.gain);
      } else cur.gain.gain.cancelScheduledValues(at);
      target(cur.gain.gain, lv * TRIM[name], at, fade / 4);
      cur.update(m, at, fade / 4);
    },
    pump(from, until) {
      if (pending && ready()) { const m = pending; pending = null; layer.set(m, from, 3, false); }
      cur?.pump(from, until);
    },
  };
  return layer;
}

/** A looping source started at a seeded offset, through an optional filter, into a gain → dest. */
function loopVoice(env: Env, r: Rng, at: number, buf: AudioBuffer, dest: AudioNode, o: { rate?: number; type?: BiquadFilterType; f?: number; q?: number; gain?: number }) {
  const { ctx } = env;
  const s = source(ctx, buf, true, o.rate ?? 1);
  const a = gainNode(ctx, o.gain ?? 0);
  const fl = o.type ? filter(ctx, o.type, o.f ?? 1000, o.q ?? 0.7) : null;
  if (fl) chain(s, fl, a, dest);
  else chain(s, a, dest);
  s.start(at, r.range(0, buf.duration * 0.95));
  return { s, a, fl };
}

export function windLayer(env: Env, r: Rng): Layer {
  const b = env.bank;
  return continuous(env, 'wind', (m) => m.wind, () => !!(b.windBed && b.whistle && b.rumble), (at, m) => {
    const g = gainNode(env.ctx, 0);
    const bed = loopVoice(env, r, at, b.windBed!, g, { type: 'bandpass', f: 380, q: 0.7 });
    const whistle = loopVoice(env, r, at, b.whistle!, g, { type: 'bandpass', f: 900, q: 9 });
    const rumble = loopVoice(env, r, at, b.rumble!, g, {});
    let gust = m.gust;
    let next = at;
    return {
      gain: g, srcs: [bed.s, whistle.s, rumble.s],
      update(mm) { gust = mm.gust; },
      pump(from, until) {
        while (next < until) {
          const t = Math.max(next, from);
          const s = clamp01(0.3 + gust * (r.next() * 1.2 - 0.3) + 0.15 * r.next());
          const tc = r.range(0.5, 1.6) * (1.3 - 0.6 * gust);
          target(bed.a.gain, 0.45 + 1.05 * s, t, tc);
          target(bed.fl!.frequency, 220 + 520 * s, t, tc);
          target(whistle.a.gain, 0.6 * Math.max(0, s - 0.4) * (0.4 + gust), t, tc * 1.4);
          target(whistle.fl!.frequency, 560 + 900 * s, t, tc * 1.6);
          target(rumble.a.gain, 0.6 + 0.6 * s, t, tc * 2);
          next = t + r.range(0.8, 3.2);
        }
      },
    };
  });
}

export function crowdLayer(env: Env, r: Rng): Layer {
  const b = env.bank;
  return continuous(env, 'crowd', (m) => m.crowd, () => !!b.babble, (at, m) => {
    const g = gainNode(env.ctx, 0);
    const srcs: AudioScheduledSourceNode[] = [];
    let swell = 1;
    let pan = m.panic;
    const calm = loopVoice(env, r, at, b.babble!, g, { gain: 1 - 0.7 * pan });
    srcs.push(calm.s);
    let panic: ReturnType<typeof loopVoice> | null = null;
    const ensurePanic = (t: number): void => {
      if (panic || !b.panic) return;
      panic = loopVoice(env, r, t, b.panic, g, { gain: 0 });
      srcs.push(panic.s);
      target(panic.a.gain, pan * swell, t, 1);
    };
    if (pan > 0.05) ensurePanic(at);
    let next = at;
    return {
      gain: g, srcs,
      update(mm, t, tc) {
        pan = mm.panic;
        if (pan > 0.05) ensurePanic(t);
        retarget(calm.a.gain, (1 - 0.7 * pan) * swell, t, tc);
        if (panic) retarget(panic.a.gain, pan * swell, t, tc);
      },
      pump(from, until) {
        if (pan > 0.05 && !panic && b.panic) ensurePanic(from);
        while (next < until) {
          const t = Math.max(next, from);
          swell = r.range(0.7, 1);
          const tc = r.range(1, 2.5);
          target(calm.a.gain, (1 - 0.7 * pan) * swell, t, tc);
          if (panic) target(panic.a.gain, pan * swell, t, tc);
          next = t + r.range(2, 6);
        }
      },
    };
  });
}

export function fireLayer(env: Env, r: Rng): Layer {
  const b = env.bank;
  return continuous(env, 'fire', (m) => m.fire, () => !!(b.roar && b.whoosh && b.crackle), (at, m) => {
    const { ctx } = env;
    const g = gainNode(ctx, 0);
    const roar = loopVoice(env, r, at, b.roar!, g, { rate: 0.85, gain: 0.8 });
    const whoosh = loopVoice(env, r, at, b.whoosh!, g, { gain: 0.3 });
    const crack = loopVoice(env, r, at, b.crackle!, g, { gain: 0.75 });
    let collapse = m.collapse;
    let next = at, nextFall = at + r.range(6, 20);
    return {
      gain: g, srcs: [roar.s, whoosh.s, crack.s],
      update(mm) { collapse = mm.collapse; },
      pump(from, until) {
        while (next < until) {
          const t = Math.max(next, from);
          const k = r.next();
          target(roar.a.gain, 0.5 + 0.5 * k, t, r.range(0.1, 0.3));
          target(whoosh.a.gain, 0.15 + 0.4 * k * r.next(), t, r.range(0.12, 0.35));
          target(crack.a.gain, 0.55 + 0.35 * r.next(), t, r.range(0.2, 0.6));
          next = t + r.range(0.15, 0.6);
        }
        if (collapse > 0.05 && b.collapse) {
          while (nextFall < until) {
            const t = Math.max(nextFall, from);
            oneShot(ctx, b.collapse, t, g, r.range(0.35, 0.7) * collapse, r.range(0.85, 1.1));
            nextFall = t + r.exp(40 / collapse) + 8;
          }
        } else nextFall = Math.max(nextFall, until);
      },
    };
  });
}

export function rainLayer(env: Env, r: Rng): Layer {
  const b = env.bank;
  return continuous(env, 'rain', (m) => m.rain, () => !!(b.hiss && b.rain && b.drips), (at) => {
    const { ctx } = env;
    const g = gainNode(ctx, 0);
    const hiss = loopVoice(env, r, at, b.hiss!, g, { gain: 0.55 });
    const drops = loopVoice(env, r, at, b.rain!, g, { gain: 0.6 });
    const pans = [-0.6, 0.65].map((p) => { const n = panner(ctx, p); n.connect(g); return n; });
    let next = at + 0.5, nextHiss = at;
    return {
      gain: g, srcs: [hiss.s, drops.s],
      update() { /* rain has one gentle setting */ },
      pump(from, until) {
        while (next < until) {
          const t = Math.max(next, from);
          oneShot(ctx, r.pick(b.drips!), t, r.pick(pans), r.range(0.1, 0.35), r.range(0.9, 1.15));
          next = t + r.exp(1.1) + 0.15;
        }
        while (nextHiss < until) {
          const t = Math.max(nextHiss, from);
          target(hiss.a.gain, r.range(0.45, 0.65), t, 1.5);
          nextHiss = t + r.range(3, 7);
        }
      },
    };
  });
}

export function droneLayer(env: Env, r: Rng): Layer {
  const b = env.bank;
  return continuous(env, 'drone', (m) => m.drone, () => !!b.drone, (at) => {
    const g = gainNode(env.ctx, 0);
    const v = loopVoice(env, r, at, b.drone!, g, { gain: 0.8 });
    let next = at;
    return {
      gain: g, srcs: [v.s],
      update() { /* the drone breathes on its own */ },
      pump(from, until) {
        while (next < until) {
          const t = Math.max(next, from);
          target(v.a.gain, r.range(0.55, 1), t, r.range(2, 4));
          next = t + r.range(5, 12);
        }
      },
    };
  });
}

export function roomLayer(env: Env, r: Rng): Layer {
  const b = env.bank;
  return continuous(env, 'room', (m) => m.room, () => !!(b.room && b.crackle), (at, m) => {
    const g = gainNode(env.ctx, 0);
    const tone = loopVoice(env, r, at, b.room!, g, { gain: 1 });
    const lamp = loopVoice(env, r, at, b.crackle!, g, { rate: 0.8, gain: 0.25 * m.lamp });
    return {
      gain: g, srcs: [tone.s, lamp.s],
      update(mm, t, tc) { retarget(lamp.a.gain, 0.25 * mm.lamp, t, tc); },
      pump() { /* steady */ },
    };
  });
}

export function trampLayer(env: Env): Layer {
  const b = env.bank;
  return continuous(env, 'tramp', (m) => m.tramp, () => !!b.tramp, (at) => {
    const g = gainNode(env.ctx, 0);
    const s = source(env.ctx, b.tramp!, true);
    s.connect(g);
    s.start(at);
    env.march.t0 = at;
    env.march.beat = 60 / b.trampBpm;
    env.march.live = true;
    return { gain: g, srcs: [s], update() { /* steady */ }, pump() { /* the loop keeps time */ } };
  });
}

// ---------- event layers ----------

interface EventImpl { update(m: Mix, at: number, fresh: boolean): void; pump(from: number, until: number, gain: number): void }

function eventLayer(name: LayerName, level: (m: Mix) => number, ready: () => boolean, make: () => EventImpl): Layer {
  let impl: EventImpl | null = null;
  let lv = 0;
  let last: { m: Mix; at: number; fresh: boolean } | null = null;
  return {
    name,
    set(m, at, _fade, fresh) {
      lv = level(m);
      if (impl) impl.update(m, at, fresh);
      else last = { m, at, fresh: fresh || !!last?.fresh };
    },
    pump(from, until) {
      if (!impl) {
        if (!ready()) return;
        impl = make();
        if (last) impl.update(last.m, Math.max(last.at, from), last.fresh);
        last = null;
      }
      impl.pump(from, until, lv * TRIM[name]);
    },
  };
}

interface Hit { t: number; line: number; v: number; amp: number }

export function drumsLayer(env: Env, r: Rng): Layer {
  const b = env.bank;
  return eventLayer('drums', (m) => m.drums, () => !!(b.drumsNear && b.drumsFar), () => {
    const { ctx } = env;
    let style: Mix['drumStyle'] = 'war';
    let rate = 0.5;
    let queue: Hit[] = [];
    let lines: StereoPannerNode[] = [];
    let nextPhrase = 0;
    let marchK = -1;
    let bar: { pan: StereoPannerNode; end: number } | null = null;
    const own = { t0: 0, beat: 60 / 96 };
    let clockRef: { t0: number; beat: number } | null = null;
    const TEMPLATES = [
      [2, 0, 0, 1, 0, 0, 1, 0, 2, 0, 0, 1, 0, 1, 0, 0],
      [2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 1, 2, 0, 0, 0],
      [2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 1, 1, 0, 0, 0],
      [2, 0, 0, 1, 2, 0, 0, 1, 2, 0, 1, 0, 1, 0, 1, 0],
    ];
    /** Build the next phrase from t0; returns when the following one may start. */
    const phrase = (t0: number): number => {
      const out: Hit[] = [];
      let end: number;
      if (style === 'slow') {
        const k = r.int(3, 7), gap = r.range(2.2, 3.2);
        for (let i = 0; i < k; i++) out.push({ t: t0 + i * gap, line: 0, v: 2, amp: r.range(0.75, 1) });
        end = t0 + k * gap;
      } else {
        const tpl = r.pick(TEMPLATES);
        const six = 60 / r.range(78, 96) / 4;
        const bars = r.int(2, 4);
        const echo = rate > 0.4 && r.chance(0.7);
        const lag = r.range(0.06, 0.16);
        for (let bb = 0; bb < bars; bb++) {
          for (let s = 0; s < 16; s++) {
            const a = tpl[s];
            if (!a) continue;
            const t = t0 + (bb * 16 + s) * six + r.range(-0.01, 0.01);
            out.push({ t, line: 0, v: a === 2 ? 0 : 1, amp: a === 2 ? r.range(0.85, 1) : r.range(0.45, 0.65) });
            if (echo && a === 2) out.push({ t: t + lag, line: 1, v: 0, amp: r.range(0.6, 0.85) });
          }
        }
        if (rate > 0.6 && r.chance(0.5)) {
          for (let q = 0; q < bars * 4; q++) out.push({ t: t0 + q * 4 * six + r.range(0.18, 0.24), line: 2, v: 2, amp: r.range(0.5, 0.7) });
        }
        end = t0 + bars * 16 * six;
      }
      out.sort((x, y) => x.t - y.t);
      queue = out;
      const side = r.chance(0.5) ? 1 : -1;
      const ring = end + 2;
      lines = [group(env, 'drums', side * r.range(0.15, 0.5), ring), group(env, 'drums', -side * r.range(0.4, 0.7), ring), group(env, 'drums', r.range(-0.2, 0.2), ring)];
      const rest = style === 'slow' ? r.range(6, 14) : r.range(1, 9) * (1.35 - rate);
      return end + Math.max(0.3, rest);
    };
    return {
      update(m, at, fresh) {
        rate = m.drumRate;
        if (m.drumStyle !== style || fresh) {
          style = m.drumStyle;
          queue = queue.filter((h) => h.t < at + 0.05);
          nextPhrase = at + r.range(0.8, 2.5);
          marchK = -1;
        }
      },
      pump(from, until, gain) {
        if (gain <= 0.0001) { queue = []; nextPhrase = Math.max(nextPhrase, until); return; }
        if (style === 'march') {
          const clock = env.march.live ? env.march : own;
          if (clock !== clockRef) { clockRef = clock; marchK = -1; if (clock === own) own.t0 = from; }
          if (marchK < 0) marchK = Math.ceil((from - clock.t0) / clock.beat);
          for (;;) {
            const t = clock.t0 + marchK * clock.beat;
            if (t >= until) break;
            if (t >= from - 0.05) {
              if (!bar || t > bar.end - 2.5) { const end = t + 8 * clock.beat + 2; bar = { pan: group(env, 'drums', r.range(-0.4, -0.1), end), end }; }
              const k = ((marchK % 8) + 8) % 8;
              const big = k % 2 === 0;
              oneShot(ctx, b.drumsNear![big ? 0 : 1], t, bar.pan, gain * (big ? (k === 0 ? 1 : 0.8) : 0.5), r.range(0.97, 1.03));
              if (k === 7 && r.chance(0.6)) oneShot(ctx, b.drumsNear![1], t + clock.beat / 2, bar.pan, gain * 0.4, r.range(0.97, 1.03));
            }
            marchK++;
          }
          return;
        }
        for (;;) {
          if (!queue.length) {
            if (nextPhrase >= until) break;
            nextPhrase = phrase(Math.max(nextPhrase, from));
          }
          while (queue.length && queue[0].t < until) {
            const h = queue.shift()!;
            if (h.t >= from - 0.05) oneShot(ctx, b.drumsFar![h.v], h.t, lines[h.line], gain * h.amp, r.range(0.97, 1.03));
          }
          if (queue.length) break;
        }
      },
    };
  });
}

export function hornsLayer(env: Env, r: Rng): Layer {
  const b = env.bank;
  return eventLayer('horns', (m) => m.horns, () => !!b.horns, () => {
    const { ctx } = env;
    let rate = 0.2;
    let next = Infinity;
    let atStart: number | null = null;
    const blow = (t: number, gain: number): number => {
      const v = r.int(0, b.horns!.length - 1);
      const buf = b.horns![v];
      const side = r.chance(0.5) ? 1 : -1;
      const amp = r.range(0.6, 1);
      oneShot(ctx, buf, t, group(env, 'horns', side * r.range(0.2, 0.8), t + buf.duration + 2), gain * amp, r.range(0.97, 1.03));
      let end = t + buf.duration;
      if (r.chance(0.45)) {
        const t2 = t + buf.duration * 0.6 + r.range(1, 3);
        const buf2 = b.horns![(v + 1 + r.int(0, 1)) % b.horns!.length];
        oneShot(ctx, buf2, t2, group(env, 'horns', -side * r.range(0.4, 0.9), t2 + buf2.duration + 2), gain * amp * 0.55, r.range(0.95, 1.02));
        end = t2 + buf2.duration;
      }
      return end;
    };
    return {
      update(m, at, fresh) {
        rate = m.hornRate;
        if (fresh) {
          atStart = m.hornAtStart ? at + r.range(1.2, 2.2) : null;
          next = at + (m.hornAtStart ? 12 : r.range(3, 9)) + (rate > 0.2 ? 0 : r.exp(18 / (0.05 + rate)));
        }
      },
      pump(from, until, gain) {
        if (gain <= 0.0001) { atStart = null; next = Math.max(next, until); return; }
        if (atStart !== null && atStart < until) {
          const end = blow(Math.max(atStart, from), gain);
          atStart = null;
          next = Math.max(next, end + 4);
        }
        while (next < until) {
          const end = blow(Math.max(next, from), gain);
          next = end + 4 + r.exp(18 / (0.05 + rate));
        }
      },
    };
  });
}

export function dogsLayer(env: Env, r: Rng): Layer {
  const b = env.bank;
  return eventLayer('dogs', (m) => m.dogs, () => !!b.barks, () => {
    const { ctx } = env;
    let rate = 0.3;
    let next = 0;
    const bout = (t: number, pan: number, amp: number): number => {
      const v = r.int(0, b.barks!.length - 1);
      const k = r.int(2, 5), dt = r.range(0.26, 0.5);
      const pn = group(env, 'dogs', pan, t + k * dt + 1.5);
      for (let j = 0; j < k; j++) oneShot(ctx, b.barks![v], t + j * dt * r.range(0.9, 1.1), pn, amp * (j === 0 ? 1 : r.range(0.75, 0.95)), r.range(0.95, 1.05));
      return t + k * dt;
    };
    return {
      update(m, at, fresh) { rate = m.dogRate; if (fresh) next = at + r.range(2, 8); },
      pump(from, until, gain) {
        if (gain <= 0.0001) { next = Math.max(next, until); return; }
        while (next < until) {
          const t = Math.max(next, from);
          const pan = r.range(-0.85, 0.85);
          let end = bout(t, pan, gain * r.range(0.7, 1));
          if (r.chance(0.45)) end = bout(end + r.range(0.6, 2.2), -Math.sign(pan || 1) * r.range(0.2, 0.9), gain * r.range(0.35, 0.55));
          next = end + r.exp(18 / (0.15 + rate)) + 2;
        }
      },
    };
  });
}

export function stepsLayer(env: Env, r: Rng): Layer {
  const b = env.bank;
  return eventLayer('steps', (m) => m.steps, () => !!b.steps, () => {
    const { ctx } = env;
    let next = 0;
    const walk = (t: number, gain: number): number => {
      const n = r.int(6, 12), dt = r.range(0.5, 0.62);
      const side = r.chance(0.5) ? 1 : -1;
      const p0 = side * r.range(0.3, 0.9), p1 = -p0 * r.range(0.5, 0.9);
      const end = t + n * dt;
      const pn = group(env, 'steps', p0, end + 0.5);
      pn.pan.setValueAtTime(p0, t);
      pn.pan.linearRampToValueAtTime(p1, end);
      const start = r.int(0, b.steps!.length - 1);
      for (let j = 0; j < n; j++) {
        const u = j / (n - 1);
        const amp = (0.25 + 0.75 * Math.sin(Math.PI * u)) * r.range(0.8, 1);
        oneShot(ctx, b.steps![(start + j) % b.steps!.length], t + j * dt + r.range(-0.02, 0.02), pn, gain * amp, r.range(0.94, 1.06));
      }
      return end;
    };
    return {
      update(_m, at, fresh) { if (fresh) next = at + r.range(3, 10); },
      pump(from, until, gain) {
        if (gain <= 0.0001) { next = Math.max(next, until); return; }
        while (next < until) next = walk(Math.max(next, from), gain) + r.range(10, 28);
      },
    };
  });
}

export function birdsLayer(env: Env, r: Rng): Layer {
  const b = env.bank;
  return eventLayer('birds', (m) => m.birds, () => !!b.birds, () => {
    const { ctx } = env;
    let next = 0;
    let level = 0.5;
    return {
      update(m, at, fresh) { level = m.birds; if (fresh) next = at + r.range(1, 4); },
      pump(from, until, gain) {
        if (gain <= 0.0001) { next = Math.max(next, until); return; }
        while (next < until) {
          const t = Math.max(next, from);
          const v = r.int(0, b.birds!.length - 1);
          const buf = b.birds![v];
          const pan = r.range(-0.85, 0.85);
          oneShot(ctx, buf, t, group(env, 'birds', pan, t + buf.duration), gain * r.range(0.4, 1), r.range(0.9, 1.1));
          if (r.chance(0.4)) {
            const t2 = t + r.range(0.8, 2);
            oneShot(ctx, buf, t2, group(env, 'birds', -pan, t2 + buf.duration), gain * r.range(0.3, 0.6), r.range(0.95, 1.08));
          }
          next = t + r.exp(5 / Math.max(0.2, level)) + 1;
        }
      },
    };
  });
}

/** The lyre: one motif per beat, played after the cross-fade and returned to rarely. Strings pan low → high. */
export function lyreLayer(env: Env, r: Rng): LyreLayer {
  const { ctx } = env;
  let lv = 0;
  let motif: Motif | null = null;
  let queue: { t: number; n: MotifNote }[] = [];
  let pans: StereoPannerNode[] = [];
  let nextPlay = Infinity;
  let plays = 0;
  return {
    name: 'lyre',
    set(m) { lv = m.lyre; },
    setMotif(m, firstAt) {
      motif = m;
      queue = queue.filter((q) => q.t < firstAt - 0.5);
      nextPlay = m ? firstAt : Infinity;
      plays = 0;
    },
    pump(from, until) {
      const gain = lv * TRIM.lyre;
      if (!motif || gain <= 0.0001) return;
      for (;;) {
        if (!queue.length) {
          if (nextPlay >= until) break;
          const t0 = Math.max(nextPlay, from);
          const notes = vary(motif, r, plays === 0);
          queue = notes.map((n) => ({ t: t0 + n.at, n }));
          const end = t0 + motif.length + 4;
          pans = [-0.22, 0.05, 0.3].map((p) => group(env, 'lyre', p, end));
          plays++;
          nextPlay = t0 + motif.length + r.range(motif.repeat[0], motif.repeat[1]);
        }
        while (queue.length && queue[0].t < until) {
          const q = queue.shift()!;
          if (q.t >= from - 0.05) oneShot(ctx, env.pluck(q.n.midi), q.t, pans[q.n.midi < 52 ? 0 : q.n.midi < 60 ? 1 : 2], gain * q.n.vel);
        }
        if (queue.length) break;
      }
    },
  };
}
