// Runner of the Tablet House: the words of a city's errands, `streets-scripts/<scenario>.json` (format in
// docs/decisions/0032-the-first-errand.md; checked by engine/src/debug/streets-validate.ts). Like a Tablet House script,
// it never types a figure or a record name: {path} placeholders are filled from the scenario, and the game fills what
// only play knows ({value}, {tablet.line}, {place.to}, {overseer.name} …). The figure the runner presses is the Tablet
// House's own: its day-one `muster` slot (labels and lines) and its engine's bend of the record (`valuesOf`), so the
// two games press the same three readings of the same number.
//
// Pure: no DOM, no three.js (the engine's tests import it).
import type { Pick, Scenario } from '../../tablet/types.ts';
import { context, fill, type Ctx, type TabletScript } from '../../tablet/script.ts';
import { lineOf, slotOf, valuesOf } from '../../tablet/engine.ts';
import { streetNames } from '../world/names.ts';

export const PICKS: Pick[] = ['true', 'rounded', 'boasted'];

/** The places an errand may start or end at: keys of the world's names (world/names.ts) for the scenario. */
export const PLACE_KEYS = ['tabletHouse', 'riverGate', 'marketGate', 'postern', 'market', 'well'] as const;
export type PlaceKey = (typeof PLACE_KEYS)[number];

export interface Person { name: string; sex: 'f' | 'm'; role: string }
export interface Horn {
  /** Seconds from leaving the house to the horn (the game's fixed-step clock, so a slow frame does not eat them). */
  seconds: number;
  /** Seconds before the horn when the HUD warns. */
  warn: number;
  /** How the seconds were set: bot runs over the real route (metres and seconds). */
  measured?: Record<string, number | string>;
}
export interface Errand {
  id: string;
  day: number;
  beat: 'muster' | 'field' | 'walls' | 'end' | 'tablet';
  title: string;
  people: { overseer: Person; gatekeeper: Person } & Record<string, Person>;
  from: PlaceKey;
  to: PlaceKey;
  horn: Horn;
  brief: string[];
  /** The Tablet House slot whose three readings the runner chooses between. */
  slot: 'muster';
  prompt: string;
  pressed: Record<Pick, string>;
  handover: string;
  objective: string;
  arrive: {
    intime: Record<Pick, string> & { scene: string; after: string };
    late: Record<Pick, string> & { scene: string };
  };
  end: { title: string; intime: string; late: string; record: string; teaser: { title: string; text: string } };
}
export interface StreetsScript { scenario: string; title: string; errands: Errand[] }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown) => (typeof x === 'string' ? x : '');
const byPick = (x: unknown): Record<Pick, string> | null => {
  if (!isObj(x)) return null;
  const o = { true: str(x.true), rounded: str(x.rounded), boasted: str(x.boasted) };
  return o.true && o.rounded && o.boasted ? o : null;
};
const person = (x: unknown): Person | null => (isObj(x) && str(x.name) ? { name: str(x.name), sex: x.sex === 'f' ? 'f' : 'm', role: str(x.role) } : null);

/** One errand as the game plays it, or null when the file does not have what play needs (the errand is then left out;
 *  the validator says why). */
export function normalizeErrand(x: unknown): Errand | null {
  if (!isObj(x) || !isObj(x.people) || !isObj(x.horn) || !isObj(x.arrive) || !isObj(x.end)) return null;
  const overseer = person(x.people.overseer), gatekeeper = person(x.people.gatekeeper);
  const from = str(x.from) as PlaceKey, to = str(x.to) as PlaceKey;
  if (!overseer || !gatekeeper || !PLACE_KEYS.includes(from) || !PLACE_KEYS.includes(to)) return null;
  const seconds = Number(x.horn.seconds), warn = Number(x.horn.warn ?? 15);
  if (!(seconds > 0) || !(warn >= 0)) return null;
  const pressed = byPick(x.pressed);
  const a = x.arrive, ai = isObj(a.intime) ? a.intime : null, al = isObj(a.late) ? a.late : null;
  const intime = byPick(ai), late = byPick(al);
  const e = x.end, teaser = isObj(e.teaser) ? e.teaser : null;
  const brief = Array.isArray(x.brief) ? x.brief.filter((p): p is string => typeof p === 'string' && !!p) : [];
  if (!pressed || !ai || !al || !intime || !late || !teaser || !brief.length || x.slot !== 'muster') return null;
  return {
    id: str(x.id), day: Number(x.day) || 1, beat: (str(x.beat) || 'muster') as Errand['beat'], title: str(x.title),
    people: { ...(Object.fromEntries(Object.entries(x.people).map(([k, v]) => [k, person(v)]).filter(([, v]) => v)) as Record<string, Person>), overseer, gatekeeper },
    from, to, horn: { seconds, warn, measured: isObj(x.horn.measured) ? x.horn.measured as Record<string, number | string> : undefined },
    brief, slot: 'muster', prompt: str(x.prompt), pressed, handover: str(x.handover), objective: str(x.objective),
    arrive: { intime: { ...intime, scene: str(ai.scene), after: str(ai.after) }, late: { ...late, scene: str(al.scene) } },
    end: { title: str(e.title), intime: str(e.intime), late: str(e.late), record: str(e.record), teaser: { title: str(teaser.title), text: str(teaser.text) } },
  };
}

export function normalizeStreetsScript(raw: unknown, scenarioId: string): StreetsScript | null {
  if (!isObj(raw) || !Array.isArray(raw.errands)) return null;
  const errands = raw.errands.map(normalizeErrand).filter((e): e is Errand => !!e);
  if (!errands.length) return null;
  return { scenario: scenarioId, title: str(raw.title), errands };
}

// ---------------------------------------------------------------- places and people

/** The name the world gives a place key in this scenario ("The river gate"), or null when the world has none. */
export function placeName(scenarioId: string, key: PlaceKey): string | null {
  const n = streetNames(scenarioId);
  return (n as unknown as Record<string, string | null>)[key] ?? null;
}
/** A place's name inside a sentence: "the river gate" (a leading article in lower case). */
export function inSentence(name: string): string { return name.replace(/^The /, 'the '); }

// ---------------------------------------------------------------- filling

/** The scenario plus what play fills: people, places, and once a figure is chosen, {value} and {tablet.line}. */
export function errandCtx(s: Scenario, th: TabletScript, e: Errand, pick: Pick | null): Ctx {
  const base = context(s);
  const people = Object.fromEntries(Object.entries(e.people).map(([k, p]) => [k, { name: fill(p.name, base), sex: p.sex, role: p.role }]));
  const place = { from: inSentence(placeName(s.id, e.from) ?? ''), to: inSentence(placeName(s.id, e.to) ?? '') };
  const extra: Record<string, unknown> = { ...people, place };
  if (pick) {
    const v = valuesOf(s)[e.slot][pick];
    extra.value = v === 0 ? 'none' : v;
    extra.tablet = { line: lineOf(s, th, context(s), e.slot, pick) };
  }
  return context(s, extra);
}

/** Fill a line of the script and start its sentences with capitals (a sentence may open with a place). */
export function say(text: string, ctx: Ctx): string {
  return fill(text, ctx).replace(/(^|[.!?]\s+|[“‘]\s*)([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
}

/** The three readings of the slot as the choice shows them: the Tablet House's labels, and its lines filled with the
 *  figure each reading presses. */
export function readings(s: Scenario, th: TabletScript, e: Errand): { pick: Pick; label: string; line: string; value: number }[] {
  const slot = slotOf(th, e.slot);
  const ctx = context(s);
  const vals = valuesOf(s)[e.slot];
  return PICKS.map((pick) => {
    const o = slot.options.find((x) => x.pick === pick)!;
    return { pick, label: fill(o.label, ctx), line: lineOf(s, th, ctx, e.slot, pick), value: vals[pick] };
  });
}

/** The record's figure for the slot (the muster: the battle's own count of our side). */
export function recordValue(s: Scenario, e: Errand): number { return valuesOf(s)[e.slot].true; }
