// Runner of the Tablet House: an errand as a pure state machine (like game/tablet/engine.ts), so a test can play every
// path headless. The runtime (run.ts) feeds it the game's fixed-step clock and the runner's moves; the view shows
// whatever phase it is in. No DOM, no clock of its own, no Math.random.
//
//   brief → choose → pressed → run → arrive → end
//
// The horn counts from leaving the house in the game's fixed 60 Hz steps (frame drops and a hidden tab do not eat
// the runner's time). Distance is split into the streets and the roofs (anything over 2 m above the ground there,
// except a bridge's deck), so the end card can say which way the runner came.
import type { Pick, Scenario } from '../../tablet/types.ts';
import type { TabletScript } from '../../tablet/script.ts';
import { errandCtx, readings, recordValue, say, type Errand } from './script.ts';

export type Phase = 'brief' | 'choose' | 'pressed' | 'run' | 'arrive' | 'end';

/** What happened in a step that the view, the sound or the world should answer. */
export type Cue = 'warn' | 'horn' | 'arrive';

/** A run's state. The engine's functions return a new one; nothing is mutated. */
export interface RunState {
  phase: Phase;
  pick: Pick | null;
  /** Game clock (s) when the runner left the house, and when the horn sounds (left + horn seconds). */
  left: number | null;
  hornAt: number | null;
  warned: boolean;
  /** The horn has sounded (whether or not the runner was there). */
  horn: boolean;
  /** Game clock when the runner reached the gate, and whether it was before the horn. */
  arrived: number | null;
  inTime: boolean | null;
  /** Metres run in the streets and over the roofs since leaving. */
  street: number;
  roof: number;
}

export function newRun(skipBrief = false): RunState {
  return { phase: skipBrief ? 'choose' : 'brief', pick: null, left: null, hornAt: null, warned: false, horn: false, arrived: null, inTime: null, street: 0, roof: 0 };
}

export function toChoose(st: RunState): RunState { return st.phase === 'brief' ? { ...st, phase: 'choose' } : st; }

export function choose(st: RunState, pick: Pick): RunState {
  return st.phase === 'choose' ? { ...st, phase: 'pressed', pick } : st;
}

/** Out of the door: the horn starts counting. */
export function leave(st: RunState, e: Errand, now: number): RunState {
  if (st.phase !== 'pressed') return st;
  return { ...st, phase: 'run', left: now, hornAt: now + e.horn.seconds, street: 0, roof: 0, warned: false, horn: false };
}

export interface StepIn {
  /** Game clock (s). */
  now: number;
  /** Horizontal metres moved this step, and whether the feet were up on a roof or a wall. */
  moved: number;
  high: boolean;
  /** Within the destination's radius, on its ground (not on a roof or the wall walk above it). */
  there: boolean;
}

/** One fixed step of the run: count the metres, sound the warning and the horn, notice the arrival. */
export function step(st: RunState, e: Errand, s: StepIn): { st: RunState; cues: Cue[] } {
  if (st.phase !== 'run' || st.hornAt === null) {
    // after the run the horn can still sound (the levy marches when it sounds, whoever is there)
    if ((st.phase === 'arrive' || st.phase === 'end') && st.hornAt !== null && !st.horn && s.now >= st.hornAt) return { st: { ...st, horn: true }, cues: ['horn'] };
    return { st, cues: [] };
  }
  const cues: Cue[] = [];
  let next: RunState = st;
  if (s.moved > 0) next = s.high ? { ...next, roof: next.roof + s.moved } : { ...next, street: next.street + s.moved };
  if (!next.warned && s.now >= st.hornAt - e.horn.warn && s.now < st.hornAt) { next = { ...next, warned: true }; cues.push('warn'); }
  if (!next.horn && s.now >= st.hornAt) { next = { ...next, horn: true, warned: true }; cues.push('horn'); }
  if (s.there) {
    next = { ...next, phase: 'arrive', arrived: s.now, inTime: !next.horn };
    cues.push('arrive');
  }
  return { st: next, cues };
}

export function finish(st: RunState): RunState { return st.phase === 'arrive' ? { ...st, phase: 'end' } : st; }

/** Seconds left before the horn (≥ 0), or null before the run. */
export function hornLeft(st: RunState, now: number): number | null {
  if (st.hornAt === null) return null;
  return Math.max(0, st.hornAt - (st.arrived ?? now));
}
/** Seconds from the door to the gate (or so far). */
export function runTime(st: RunState, now: number): number | null {
  if (st.left === null) return null;
  return (st.arrived ?? now) - st.left;
}

/** Shares of the distance run in the streets and over the roofs (whole percents that add to 100). */
export function routeShares(st: RunState): { street: number; roof: number; metres: number } {
  const m = st.street + st.roof;
  if (m < 1) return { street: 100, roof: 0, metres: Math.round(m) };
  const roof = Math.round((st.roof / m) * 100);
  return { street: 100 - roof, roof, metres: Math.round(m) };
}

// ---------------------------------------------------------------- the words of each phase

export interface Words {
  overseer: { name: string; role: string };
  gatekeeper: { name: string; role: string };
  /** The levy's commander as the record names him or her ("Panshelon", "the king" when the sovereign leads it). */
  commander: { name: string; role: string };
  destination: string;
  brief: string[];
  prompt: string;
  readings: { pick: Pick; label: string; line: string; value: number }[];
  objective: string;
}
/** Everything the view says before the run (the pick fills in later). */
export function words(s: Scenario, th: TabletScript, e: Errand): Words {
  const ctx = errandCtx(s, th, e, null);
  const p = (k: 'overseer' | 'gatekeeper') => ({ name: say(e.people[k].name, ctx), role: say(e.people[k].role, ctx).replace(/^./, (c) => c.toLowerCase()) });
  const place = (ctx.place as { to: string }).to;
  const c = s.battle.commander;
  const title = (s.state.ruler.title || (s.state.ruler.sex === 'f' ? 'queen' : 'king')).toLocaleLowerCase('en-US');
  return {
    overseer: p('overseer'), gatekeeper: p('gatekeeper'),
    commander: { name: c.name, role: c.isKing ? `the ${title}` : 'commander of the levy' },
    destination: place.replace(/^the /, 'The '),
    brief: e.brief.map((b) => say(b, ctx)),
    prompt: say(e.prompt, ctx),
    readings: readings(s, th, e),
    objective: say(e.objective, ctx),
  };
}

/** The overseer's word on the figure pressed, and the hand-over. */
export function pressedWords(s: Scenario, th: TabletScript, e: Errand, pick: Pick): { reaction: string; handover: string; line: string } {
  const ctx = errandCtx(s, th, e, pick);
  return { reaction: say(e.pressed[pick], ctx), handover: say(e.handover, ctx), line: String((ctx.tablet as { line: string }).line) };
}

/** What is said at the gate: in time (the commander and the levy) or late (the gatekeeper). */
export function arrivalWords(s: Scenario, th: TabletScript, e: Errand, pick: Pick, inTime: boolean): { who: 'commander' | 'gatekeeper'; scene: string; reaction: string; after: string | null } {
  const ctx = errandCtx(s, th, e, pick);
  const a = inTime ? e.arrive.intime : e.arrive.late;
  return { who: inTime ? 'commander' : 'gatekeeper', scene: say(a.scene, ctx), reaction: say(a[pick], ctx), after: inTime ? say(e.arrive.intime.after, ctx) : null };
}

export interface EndCard {
  title: string;
  headline: string;
  inTime: boolean;
  /** Seconds from the door, and the horn's seconds. */
  time: number;
  horn: number;
  route: { street: number; roof: number; metres: number };
  pressed: { pick: Pick; label: string; value: number; line: string };
  record: { value: number; line: string };
  teaser: { title: string; text: string };
}
export function endCard(s: Scenario, th: TabletScript, e: Errand, st: RunState): EndCard {
  const pick = st.pick ?? 'true';
  const ctx = errandCtx(s, th, e, pick);
  const r = readings(s, th, e).find((x) => x.pick === pick)!;
  const inTime = !!st.inTime;
  return {
    title: say(e.end.title, ctx),
    headline: say(inTime ? e.end.intime : e.end.late, ctx),
    inTime,
    time: Math.max(0, (st.arrived ?? st.left ?? 0) - (st.left ?? 0)),
    horn: e.horn.seconds,
    route: routeShares(st),
    pressed: { pick, label: r.label, value: r.value, line: r.line },
    record: { value: recordValue(s, e), line: say(e.end.record, ctx) },
    teaser: { title: say(e.end.teaser.title, ctx), text: say(e.end.teaser.text, ctx) },
  };
}

// ---------------------------------------------------------------- the runner's record (saved in the browser)

export interface Saved { best: number | null; lastPick: Pick | null; runs: number; lastTime: number | null; lastInTime: boolean | null }
export const EMPTY_SAVED: Saved = { best: null, lastPick: null, runs: 0, lastTime: null, lastInTime: null };

/** The record after a finished run: the best time counts only runs that beat the horn. */
export function record(prev: Saved, card: EndCard): Saved {
  const t = Math.round(card.time * 10) / 10;
  return {
    best: card.inTime ? (prev.best === null ? t : Math.min(prev.best, t)) : prev.best,
    lastPick: card.pressed.pick, runs: prev.runs + 1, lastTime: t, lastInTime: card.inTime,
  };
}

/** "0:42" (minutes and seconds), or "42.3 s" under a minute with tenths. */
export function clock(sec: number, tenths = false): string {
  const s = Math.max(0, sec);
  if (tenths) return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  const c = Math.ceil(s);
  return `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`;
}
