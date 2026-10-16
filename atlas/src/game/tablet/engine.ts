// The Tablet House: the five-day state machine, the meters, the tablet's lines, the endings and the share text.
// Pure functions of (scenario, script, choices): no DOM, no clock, no Math.random, so a test can play every path.
// The script format and its rules are in docs/lld/tablet-house.md ("Script format").
import type { Beat, DayNo, Effects, Meters, Pick, Scenario, SlotId } from './types.ts';
import { context, fill, materialOf, rulerTitle, type ChoiceOption, type Ctx, type Ending, type Material, type ScriptSlot, type TabletScript } from './script.ts';

export { materialOf, rulerTitle as rulerTitleOf, type Material };

// ---------------------------------------------------------------- deterministic draws

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}
export function seeded(key: string): () => number {
  let h = hash(key);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Today's scenario: the same city for everyone on the same date. */
export function dailyScenario<T extends { id: string }>(list: T[], dateKey: string): T {
  return list[hash(`tablet:${dateKey}`) % list.length];
}

// ---------------------------------------------------------------- the figures a scribe can press

/** One significant figure, rounded up / down / to nearest. */
const sig1 = (x: number, mode: 'up' | 'down' | 'near') => {
  if (x <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = mode === 'up' ? Math.ceil : mode === 'down' ? Math.floor : Math.round;
  return f(x / p) * p;
};

export type NumSlot = 'muster' | 'ours' | 'theirs';
export const NUMERIC: NumSlot[] = ['muster', 'ours', 'theirs'];
/** The record's figure for each numeric slot, bent a little (rounded) or as a royal chronicle bends it (boasted):
 *  more men mustered, fewer of ours dead, more of theirs. */
export function valuesOf(s: Scenario): Record<NumSlot, Record<Pick, number>> {
  const b = s.battle;
  const mT = b.ours;
  let mR = sig1(mT * 1.05, 'up'); if (mR <= mT) mR = sig1(mT * 1.3, 'up');
  let mB = sig1(mT * 9, 'near'); if (mB <= mR) mB = sig1(mR * 6, 'near');
  const oT = b.oursLost;
  let oR = sig1(oT, 'down'); if (oR >= oT) oR = sig1(oT * 0.7, 'down'); if (oR >= oT) oR = Math.max(0, oT - 1);
  let oB = oT <= 3 ? 0 : sig1(oT / 14, 'near'); if (oB >= oR) oB = Math.max(0, Math.floor(oR / 3));
  const tT = b.theirsLost;
  let tR = sig1(tT * 1.1, 'up'); if (tR <= tT) tR = sig1(tT * 1.4, 'up');
  let tB = sig1(Math.max(tT * 13, 50), 'near'); if (tB <= tR) tB = sig1(tR * 8, 'near');
  return { muster: { true: mT, rounded: mR, boasted: mB }, ours: { true: oT, rounded: oR, boasted: oB }, theirs: { true: tT, rounded: tR, boasted: tB } };
}
const isNum = (id: SlotId): id is NumSlot => id === 'muster' || id === 'ours' || id === 'theirs';

export const LINE_ORDER: SlotId[] = ['muster', 'ours', 'theirs', 'field', 'end'];
export const DAY_SLOTS: Record<DayNo, SlotId[]> = { 1: ['muster'], 2: ['ours', 'theirs', 'field'], 3: [], 4: ['end'], 5: [] };

/** The scenario with the scribe's name, for filling prose. */
export function baseCtx(s: Scenario, sc: TabletScript): Ctx {
  const name = fill(sc.scribe.name, context(s));
  return context(s, { scribe: { name, sex: sc.scribe.sex } });
}

export function slotOf(sc: TabletScript, id: SlotId): ScriptSlot {
  for (const d of sc.days) for (const t of d.tablet ?? []) if (t.slot === id) return t;
  throw new Error(`script ${sc.scenario} has no slot ${id}`);
}

/** The words of one reading of a line, as the scribe would press them (the figure filled in). */
export function lineOf(s: Scenario, sc: TabletScript, ctx: Ctx, id: SlotId, pick: Pick): string {
  const o = slotOf(sc, id).options.find((x) => x.pick === pick)!;
  const value = isNum(id) ? valuesOf(s)[id][pick] : undefined;
  return fill(o.line, { ...ctx, value: value === 0 ? 'none' : value });
}

/** A line split for the tablet: the words all three readings share (pressed first, a formula) and the rest. */
export function lineParts(s: Scenario, sc: TabletScript, ctx: Ctx, id: SlotId): { before: string; rest: Record<Pick, string>; longest: string } {
  const picks: Pick[] = ['true', 'rounded', 'boasted'];
  const words = picks.map((p) => lineOf(s, sc, ctx, id, p).split(/\s+/));
  let n = 0;
  while (words.every((w) => n < w.length - 1 && w[n] === words[0][n])) n++;
  // never press the figure itself as part of the formula
  const before = words[0].slice(0, n).join(' ');
  const rest = Object.fromEntries(picks.map((p, i) => [p, words[i].slice(n).join(' ')])) as Record<Pick, string>;
  const longest = Object.values(rest).sort((a, b) => b.length - a.length)[0];
  return { before, rest, longest };
}

// ---------------------------------------------------------------- the game state

export interface Game {
  picks: Partial<Record<SlotId, Pick>>;
  /** Which card was played each day (index into the day's choice options). */
  choices: Partial<Record<DayNo, number>>;
  flags: string[];
  meters: Meters;
  /** Lines rewritten for the king on day 5, with what they said before. */
  was: Partial<Record<SlotId, Pick>>;
  day5: Day5 | null;
}
/** What the scribe did on day five: let the tablet stand, rewrite it for the king, rewrite it and press the truth on
 *  its edge, or rewrite it and keep the truth somewhere else (an envelope, a slip, a draft, a binding…). */
export type Day5 = 'stand' | 'amend' | 'edge' | 'hidden';

/** Meters start at 0; slot picks and cards move them by small whole numbers. */
export const START: Meters = { favour: 0, conscience: 0, household: 0 };
export function newGame(): Game {
  return { picks: {}, choices: {}, flags: [], meters: { ...START }, was: {}, day5: null };
}

function apply(m: Meters, e: Effects): Meters {
  return { favour: m.favour + (e.favour ?? 0), conscience: m.conscience + (e.conscience ?? 0), household: m.household + (e.household ?? 0) };
}

export function pickSlot(g: Game, sc: TabletScript, id: SlotId, pick: Pick): Game {
  const o = slotOf(sc, id).options.find((x) => x.pick === pick)!;
  return { ...g, picks: { ...g.picks, [id]: pick }, meters: apply(g.meters, o.effects) };
}

/** Day-five flags the scripts use whose meaning the effects alone do not tell. */
const DAY5_FLAGS: Record<string, Day5> = {
  edge: 'edge', amend: 'amend', stand: 'stand',
  spoken: 'stand', aloud: 'stand', unpointed: 'stand', docket: 'stand', hand: 'stand',
  colophon: 'amend', dictated: 'amend', unsigned: 'amend',
};
/** What a day-5 card does to the tablet: by its flag when the game knows it; otherwise a card that buys favour with
 *  conscience rewrites the tablet, one that gains both rewrites it and keeps the truth hidden, and the rest let it stand. */
export function day5Kind(o: ChoiceOption): Day5 {
  if (o.flag && DAY5_FLAGS[o.flag]) return DAY5_FLAGS[o.flag];
  const f = o.effects.favour ?? 0, c = o.effects.conscience ?? 0;
  if (f > 0 && c < 0) return 'amend';
  if (f > 0 && c > 0) return o.flag ? 'hidden' : 'amend';
  return 'stand';
}

/** The lines the king will have rewritten if the scribe gives way: every one that does not already flatter him. */
export function toAmend(g: Game): SlotId[] {
  return LINE_ORDER.filter((id) => g.picks[id] && g.picks[id] !== 'boasted');
}

export function choose(g: Game, day: DayNo, index: number, o: ChoiceOption): Game {
  let next: Game = { ...g, choices: { ...g.choices, [day]: index }, flags: o.flag ? [...g.flags, o.flag] : g.flags, meters: apply(g.meters, o.effects) };
  if (day === 5) {
    const kind = day5Kind(o);
    next = { ...next, day5: kind };
    if (kind !== 'stand') {
      const was: Partial<Record<SlotId, Pick>> = {};
      const picks = { ...next.picks };
      for (const id of toAmend(g)) { was[id] = picks[id]; picks[id] = 'boasted'; }
      next = { ...next, picks, was };
    }
  }
  return next;
}

export type Hardening = 'burned' | 'kiln' | 'sun';
/** How the finished tablet was hardened: the fire that took the archive bakes clay hard; the king fires only what pleases him. */
export function hardeningOf(s: Scenario, g: Game): Hardening {
  if (s.burnedArchives) return 'burned';
  return g.meters.favour >= 0 ? 'kiln' : 'sun';
}

// ---------------------------------------------------------------- endings

const within = (v: number, r?: [number, number]) => !r || (v >= r[0] && v <= r[1]);
/** The first ending whose conditions hold (the script's last has none). */
export function endingOf(sc: TabletScript, g: Game): Ending {
  return sc.endings.find((e) => within(g.meters.favour, e.when.favour) && within(g.meters.conscience, e.when.conscience) && within(g.meters.household, e.when.household) && (!e.when.flag || g.flags.includes(e.when.flag))) ?? sc.endings[sc.endings.length - 1];
}

/** The archaeologist's paragraph: by a flag the script writes for (the jar, the edge), else by the tablet's worst line. */
export function archKey(sc: TabletScript, g: Game): string {
  const f = g.flags.find((x) => sc.archaeologist.flags?.[x]);
  if (f) return `flags.${f}`;
  const picks = LINE_ORDER.map((id) => g.picks[id] ?? 'true');
  return picks.every((p) => p === 'true') ? 'true' : picks.includes('boasted') ? 'boasted' : 'rounded';
}

export interface Condition {
  hardening: Hardening;
  /** Lines lost to breaks, damp or fire (never the dead, which the archaeologist reads). */
  lost: SlotId[];
  /** A sentence for the caption, a phrase for {find.condition}, and a short tag. */
  text: string; phrase: string; tag: string;
  /** For the renderer: how dark the fire left it (0–1), and the breaks. */
  scorch: number;
  broken: 'none' | 'corner' | 'halves' | 'crumbled';
}
export function conditionOf(s: Scenario, g: Game, material: Material): Condition {
  const h = hardeningOf(s, g);
  const r = seeded(`cond:${s.id}:${LINE_ORDER.map((id) => g.picks[id] ?? '-').join('')}:${g.flags.join(',')}`)();
  const clay = material === 'clay';
  const thing = clay ? 'tablet' : material === 'paper' ? 'sheet' : 'roll';
  if (h === 'burned') {
    if (!clay) return { hardening: h, lost: ['muster'], scorch: 0.9, broken: 'crumbled', tag: 'Charred', phrase: 'charred at the edges', text: `The fire that destroyed the archive reached it too: what survives is a charred ${thing}, its edges gone to black flakes, readable under raking light.` };
    return r < 0.7
      ? { hardening: h, lost: [], scorch: 0.75, broken: 'none', tag: 'Fire-baked, whole', phrase: 'baked hard by the fire and blackened down one side', text: 'The fire that destroyed the archive baked it as hard as a pot. It is whole, blackened down one side where it lay against a burning shelf, and every sign is as crisp as the day it was pressed.' }
      : { hardening: h, lost: [], scorch: 0.7, broken: 'halves', tag: 'Fire-baked, in two pieces', phrase: 'baked hard by the fire and broken in two', text: 'The fire that destroyed the archive baked it hard, and the falling roof broke it in two. Both halves lay a hand’s breadth apart in the ash, and they join without a gap.' };
  }
  if (h === 'kiln') {
    if (!clay) return { hardening: h, lost: r < 0.4 ? ['end'] : [], scorch: 0, broken: r < 0.4 ? 'corner' : 'none', tag: r < 0.4 ? 'Worm-eaten' : 'Whole', phrase: r < 0.4 ? 'kept with the royal records, its last lines worm-eaten' : 'kept with the royal records and whole', text: r < 0.4 ? 'It was kept with the royal records, and so it survived, but worms have eaten through its last lines.' : 'It was kept with the royal records, in a cedar chest, and it survives whole.' };
    return r < 0.55
      ? { hardening: h, lost: [], scorch: 0, broken: 'none', tag: 'Kiln-fired, whole', phrase: 'kiln-fired and whole', text: 'It was fired in a kiln, as royal records were, and it has come down whole.' }
      : { hardening: h, lost: ['end'], scorch: 0, broken: 'corner', tag: 'Kiln-fired, a corner lost', phrase: 'kiln-fired, one corner broken away', text: 'It was fired in a kiln, as royal records were. A corner has broken away, and with it the end of the last line.' };
  }
  const lost: SlotId[] = r < 0.5 ? ['end'] : ['muster'];
  return clay
    ? { hardening: h, lost, scorch: 0, broken: 'crumbled', tag: 'Unbaked, crumbling', phrase: 'never fired and half dissolved by damp', text: 'It was never fired. Damp has softened part of it back into mud, and the signs that survive have to be read with a lamp held low.' }
    : { hardening: h, lost, scorch: 0, broken: 'crumbled', tag: 'Fragments', phrase: 'in fragments', text: `It was never copied into the royal records. What survives are fragments of a ${thing} used to stuff a cracked wall, readable in places.` };
}

export interface Line {
  id: SlotId; name: string; pick: Pick;
  written: string; truth: string; value: number | null; truthValue: number | null;
  lost: boolean; covered: boolean; was: Pick | null;
}
export function lineName(s: Scenario, id: SlotId): string {
  return id === 'muster' ? 'The muster' : id === 'ours' ? 'Our dead' : id === 'theirs' ? `${s.enemy.name}’s dead` : id === 'field' ? 'The battle' : s.outcome === 'treaty' ? 'The terms' : 'The end';
}
export function linesOf(s: Scenario, sc: TabletScript, g: Game, cond: Condition): Line[] {
  const ctx = baseCtx(s, sc);
  const vals = valuesOf(s);
  return LINE_ORDER.map((id) => {
    const pick = g.picks[id] ?? 'true';
    const lost = cond.lost.includes(id);
    const covered = (g.flags.includes('jar') && (id === 'ours' || id === 'theirs' || id === 'field')) || ((g.day5 === 'edge' || g.day5 === 'hidden') && (id === 'ours' || id === 'theirs'));
    return {
      id, name: lineName(s, id), pick,
      written: lineOf(s, sc, ctx, id, pick), truth: lineOf(s, sc, ctx, id, 'true'),
      value: isNum(id) ? vals[id][pick] : null, truthValue: isNum(id) ? vals[id].true : null,
      lost, covered, was: g.was[id] ?? null,
    };
  });
}

/** How much of the truth reached the future: twenty points a line for the record's reading, ten for a rounded one,
 *  none for the king's; a hidden copy (the jar, the edge) carries the lines it holds; a lost line counts for nothing. */
export function truthScore(lines: Line[]): number {
  return lines.reduce((t, l) => t + (l.covered ? 20 : l.lost ? 0 : l.pick === 'true' ? 20 : l.pick === 'rounded' ? 10 : 0), 0);
}

export function digYear(s: Scenario): number {
  return 4900 + (hash(`dig:${s.id}`) % 96);
}

/** What endings and the archaeologist may name: the figures the scribe pressed ({tablet.*}) and the find ({find.*}). */
export function endCtx(s: Scenario, sc: TabletScript, g: Game, cond: Condition): Ctx {
  const v = valuesOf(s);
  const tablet = Object.fromEntries(NUMERIC.map((id) => [id, v[id][g.picks[id] ?? 'true']]));
  return { ...baseCtx(s, sc), tablet, find: { year: `AY ${digYear(s)}`, condition: cond.phrase } };
}

/** The archaeologist's paragraph, filled with what the scribe pressed and how the tablet was found. */
export function archaeologist(s: Scenario, sc: TabletScript, g: Game, cond: Condition): string {
  const key = archKey(sc, g);
  const text = key.startsWith('flags.') ? sc.archaeologist.flags![key.slice(6)] : sc.archaeologist[key as Pick];
  return fill(text, endCtx(s, sc, g, cond));
}

/** What the scribe hides on the edge: the true dead of both sides. */
export function edgeText(s: Scenario): string {
  return `OURS ${fmt(s.battle.oursLost)} THEIRS ${fmt(s.battle.theirsLost)}`;
}
/** The scribe's signature under the text, as tablets carry it: "hand of …". */
export function colophonOf(s: Scenario, scribe: string): string {
  return `HAND OF ${scribe.toLocaleUpperCase('en-US')} SCRIBE OF ${s.city.name.toLocaleUpperCase('en-US')}`;
}

// ---------------------------------------------------------------- the king's word on what was written (days 1, 2, 4)

export function kingReply(s: Scenario, day: DayNo, pick: Pick): string {
  const t = rulerTitle(s), he = s.state.ruler.sex === 'f' ? 'she' : 'he', He = he[0].toUpperCase() + he.slice(1);
  const R: Record<number, Record<Pick, string>> = {
    1: {
      true: `The ${t} reads the figure over your shoulder and says nothing at all. The silence is worse.`,
      rounded: `“A round number,” the ${t} says. “Round numbers are for merchants.” But ${he} lets it stand.`,
      boasted: `The ${t} smiles for the first time this morning. “Now that,” ${he} says, “is an army.”`,
    },
    2: {
      true: `The ${t} turns the clay to the light, reads the figures twice, and hands it back without a word. The steward will not meet your eye.`,
      rounded: `“You have shaved it,” the ${t} says, “like a barber afraid of his customer. Next time, use the razor.”`,
      boasted: 'The court laughs when the line is read aloud. Out in the courtyard, the wounded are still being carried in.',
    },
    4: {
      true: `${He} reads the line once and looks away. “So that is how it will be remembered,” ${he} says.`,
      rounded: `${He} reads it twice, and lets it stand. Neither of you says what you both know.`,
      boasted: `${He} nods at the line as if it were true. Perhaps, by now, it is the only thing ${he} can bear to read.`,
    },
  };
  return R[day]?.[pick] ?? '';
}

// ---------------------------------------------------------------- the share

const SQUARE: Record<Pick, string> = { true: '🟩', rounded: '🟨', boasted: '🟥' };
export function headline(s: Scenario, lines: Line[]): string {
  const num = lines.filter((l) => l.value !== null && l.truthValue !== null && l.pick !== 'true');
  const ratio = (l: Line) => Math.abs(Math.log(Math.max(1, l.value!) / Math.max(1, l.truthValue!)));
  const worst = num.sort((a, b) => ratio(b) - ratio(a))[0];
  const intro = `I was the scribe of ${s.city.name}, AY ${s.year}.`;
  if (worst) {
    const w = worst.value === 0 ? 'no' : fmt(worst.value!), t = fmt(worst.truthValue!);
    if (worst.id === 'theirs') return `${intro} I wrote ${w} enemy dead. The record says ${t}.`;
    if (worst.id === 'ours') return `${intro} I wrote ${w} of our own dead. The record says ${t}.`;
    return `${intro} I wrote that ${w} marched. The record says ${t}.`;
  }
  const word = lines.find((l) => l.pick !== 'true');
  if (word) return `${intro} I wrote “${word.written.replace(/\.$/, '')}.” The record says otherwise.`;
  return `${intro} I wrote the truth: ${fmt(s.battle.oursLost)} of our dead, ${fmt(s.battle.theirsLost)} of theirs.`;
}

export function shareText(s: Scenario, g: Game, lines: Line[], fate: string, daily: string | null): string {
  return [
    `Palimpsest · The Tablet House${daily ? ` · ${daily}` : ''}`,
    headline(s, lines),
    `${lines.map((l) => SQUARE[l.pick]).join('')}${g.flags.includes('jar') ? ' + a jar' : g.day5 === 'edge' ? ' + the edge' : g.day5 === 'hidden' ? ' + a hidden truth' : ''} · ${fate}`,
  ].join('\n');
}

// ---------------------------------------------------------------- beats and eras

export function beatOf(s: Scenario, day: DayNo | 0 | 6): Beat {
  if (day === 0) return 'title';
  if (day === 6) return 'ending';
  if (day === 1) return 'muster';
  if (day === 2) return 'field';
  if (day === 3) return 'walls';
  if (day === 4) return s.outcome === 'sacked' ? 'sack' : s.outcome === 'treaty' || s.outcome === 'conquered' ? 'treaty' : 'held';
  return 'tablet';
}

export type Era = 'bronze' | 'iron' | 'medieval' | 'earlymodern' | 'industrial';
const ERA_BY_INDEX: Era[] = ['bronze', 'iron', 'iron', 'medieval', 'earlymodern', 'industrial', 'industrial'];
/** The painted art's era: from the defender's technology when the export gives it, else from the year. */
export function eraOf(s: Scenario): Era {
  if (typeof s.eraIndex === 'number' && ERA_BY_INDEX[s.eraIndex]) return ERA_BY_INDEX[s.eraIndex];
  return s.year < 1500 ? 'bronze' : s.year < 2600 ? 'iron' : s.year < 4300 ? 'medieval' : s.year < 4700 ? 'earlymodern' : 'industrial';
}
