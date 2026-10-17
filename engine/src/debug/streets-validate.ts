// The streets script validator (Runner of the Tablet House, decision 0032): checks streets-scripts/<id>.json, the
// words of a city's errands, against its scenario, the Tablet House script it borrows from and the world's places.
// It shares the Tablet House's rules for prose (scenario-validate.ts, whose own checks are unchanged): every
// {placeholder} resolves against the scenario or is one the game fills at play time, where play allows it; no digits
// outside placeholders; record names and figures come from placeholders. And its own:
// - every place an errand starts or ends at is one the world names for the scenario (atlas/src/game/streets/world/
//   names.ts), and no prose names a gate or a street the world does not have;
// - the errand's people are names of the scenario's people, not the Tablet House's own characters;
// - the slot the runner presses is the Tablet House script's, with its three readings;
// - the horn is set from measured runs: the streets at a run beat it, a jog through the streets does not.
// Days two to five (errands with a `kind`, docs/streets/lld-errands.md) are checked the same way, plus:
// - places are the world's (world/layer.ts names them), {place.<key>} only for places this city's world has;
// - people shared with the Tablet House script are marked `shared` and are its characters; the same name is the same
//   person, under the same key, all week;
// - each clock is set from measured runs, with its model stated (a crowd, a load, a search allowance) and checked;
// - the night tells the record's ending (the outcome and the burned archive), and no record line depends on play;
// - the reckoning has a find for every way each day can go, and every ending is reachable (`weekPaths`, `reckon`,
//   the reference the runtime ports and engine/test/streets.test.ts plays).
//   node engine/src/debug/streets-validate.ts <id>|--all [--scenarios=atlas/public/data/scenarios.json] [--dir=streets-scripts]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Scenario, ScenariosJson } from '../export/contract.ts';
import { resolve, type Report } from './scenario-validate.ts';
import { context, fill, normalizeScript, type TabletScript } from '../../../atlas/src/game/tablet/script.ts';
import { digYear, lineOf, slotOf, valuesOf } from '../../../atlas/src/game/tablet/engine.ts';
import type { Meters, Pick, Scenario as TabletScenario } from '../../../atlas/src/game/tablet/types.ts';
import { PLACE_KEYS, inSentence, placeName, type PlaceKey } from '../../../atlas/src/game/streets/errand/script.ts';
import { compassGate, streetNames } from '../../../atlas/src/game/streets/world/names.ts';

const PH = /\{([A-Za-z][\w.]*)\}/g;
const PICKS = ['true', 'rounded', 'boasted'] as const;
const BEATS = ['muster', 'field', 'walls', 'end', 'tablet'] as const;
const words = (x: string) => x.replace(PH, 'X').split(/\s+/).filter(Boolean).length;
/** Where in an errand a line is said: before the figure is chosen, or after (when {value} and {tablet.line} exist). */
type When = 'before' | 'after';

/** Every name the world may give a place in this scenario, lower case ("the river gate", "the street of the potters"). */
export function worldPlaceNames(scenarioId: string): string[] {
  const n = streetNames(scenarioId);
  const out = [n.riverGate, n.marketGate, n.postern, n.quarter, n.tabletHouse, n.market, n.well, ...n.streets, 'The palace gate', 'The walls'];
  for (let k = 0; k < 8; k++) out.push(compassGate((k * Math.PI) / 4));
  return out.filter((x): x is string => !!x).map((x) => x.toLowerCase());
}

/** Check one streets script against its scenario and the Tablet House script for it (raw JSON, or null if none). */
export function validateStreetsScript(script: unknown, sc: Scenario, tablet: unknown): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (m: string) => errors.push(m);
  const warn = (m: string) => warnings.push(m);
  const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  if (!isObj(script)) return { errors: ['the script is not a JSON object'], warnings };
  const S = script;
  const places = worldPlaceNames(sc.id);
  const recordNames = new Map<string, string>();
  const nameAt = (path: string) => { const v = resolve(sc, path); if (typeof v === 'string' && v.replace(/[^\p{L}]/gu, '').length >= 4) recordNames.set(v, path); };
  for (const p of ['city.name', 'state.name', 'enemy.name', 'state.ruler.name', 'enemy.ruler.name', 'battle.commander.name', 'battle.place', 'state.faith', 'state.coin', 'city.people', 'city.region']) nameAt(p);
  sc.state.gods.forEach((_, i) => nameAt(`state.gods.${i}.name`));
  sc.names.f.forEach((_, i) => nameAt(`names.f.${i}`));
  sc.names.m.forEach((_, i) => nameAt(`names.m.${i}`));
  // the Tablet House script for the scenario: its slots, and the names its own characters carry
  const th = tablet ? normalizeScript(tablet, sc as unknown as TabletScenario) : null;
  const thText = tablet ? JSON.stringify(tablet) : '';
  if (!th) err(`no playable Tablet House script for ${sc.id} (scenario-scripts/${sc.id}.json): an errand presses its slots`);

  let people: string[] = [];
  /** A placeholder the game fills at play time in the week's errands: true (fine), an error, or null (the usual rules). */
  type Rt = (path: string) => true | string | null;
  const prose = (where: string, x: unknown, when: When, min = 1, max = Infinity, rt?: Rt): string => {
    if (typeof x !== 'string' || !x.trim()) { err(`${where}: missing text`); return ''; }
    for (const m of x.matchAll(PH)) {
      const path = m[1];
      const r = rt?.(path) ?? null;
      if (r === true) continue;
      if (typeof r === 'string') { err(`${where}: {${path}} ${r}`); continue; }
      if (path === 'value' || path.startsWith('tablet.')) {
        if (path !== 'value' && path !== 'tablet.line') err(`${where}: {${path}} is not filled by the game (only {value} and {tablet.line})`);
        else if (when === 'before') err(`${where}: {${path}} is only known once the figure is pressed`);
        continue;
      }
      if (path === 'place.to' || path === 'place.from') continue;
      const pm = path.match(/^([a-z]+)\.(name|role)$/);
      if (pm && people.includes(pm[1])) continue;
      if (resolve(sc, path) === undefined) err(`${where}: {${path}} does not resolve against ${sc.id}`);
    }
    const bare = x.replace(PH, '');
    if (/[{}]/.test(bare)) err(`${where}: a brace outside a valid {placeholder}`);
    if (/\d/.test(bare)) err(`${where}: digits outside placeholders ("${bare.match(/[^\s]*\d[^\s]*/)![0]}"): figures come from the record`);
    if (/\b(hundred|thousand|million|myriad)s?\b/i.test(bare)) warn(`${where}: a figure in words? use a placeholder`);
    for (const [nm, path] of recordNames) if (new RegExp(`(^|[^\\p{L}])${nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(bare)) warn(`${where}: "${nm}" typed by hand: use {${path}}`);
    // places: a gate or a street the prose names must be one the world has; the world's own names come by placeholder
    const low = bare.toLowerCase();
    for (const m of low.matchAll(/\b([\p{L}’'-]+)\s+gate\b/gu)) {
      const w = m[1];
      if (/^(the|a|my|his|her|our|your|their|that|this|each|every|to|at|by|through|from|of|in|on)$/.test(w)) continue;
      if (!places.some((p) => p.endsWith(`${w} gate`))) err(`${where}: "${w} gate" is not a gate of this city's world (${places.filter((p) => p.endsWith('gate')).join(', ')})`);
    }
    for (const m of low.matchAll(/\bstreet of the ([\p{L}’'-]+)/gu)) if (!places.some((p) => p.includes(`street of the ${m[1]}`))) err(`${where}: "street of the ${m[1]}" is not a street of this city's world`);
    for (const p of places) if (p.split(' ').length > 2 && low.includes(p.replace(/^the /, ''))) warn(`${where}: "${p}" typed by hand: use {place.to} or {place.from}`);
    // the commander is called by the sovereign's title only when he or she is the sovereign
    if (/\{battle\.commander\.name\},? the \{state\.ruler\.title\}/.test(x) && !sc.battle.commander.isKing) err(`${where}: {battle.commander.name} is not the sovereign in ${sc.id}`);
    const female = sc.state.ruler.sex === 'f';
    if (female && /\b(our|the) king\b/i.test(bare)) warn(`${where}: "king", but ${sc.state.ruler.name} is a woman (${sc.state.ruler.title})`);
    if (!female && /\b(our|the) queen\b/i.test(bare)) warn(`${where}: "queen", but ${sc.state.ruler.name} is a man (${sc.state.ruler.title})`);
    const n = words(x);
    if (n < min || n > max) err(`${where}: ${n} words (${min}–${max === Infinity ? '…' : max})`);
    return x;
  };
  const byPick = (where: string, x: unknown, min: number, max: number) => {
    if (!isObj(x)) { err(`${where}: needs a line for each of ${PICKS.join(', ')}`); return; }
    for (const p of PICKS) prose(`${where}.${p}`, x[p], 'after', min, max);
  };

  if (S.scenario !== sc.id) err(`scenario: "${String(S.scenario)}" is not ${sc.id}`);
  prose('title', S.title, 'before', 1, 12);
  for (const k of Object.keys(S)) if (!['scenario', 'title', 'errands', 'reckoning'].includes(k)) err(`unknown top-level key "${k}"`);
  const errands = Array.isArray(S.errands) ? S.errands : [];
  if (!errands.length) err('errands: none');
  const ids = new Set<string>();
  errands.forEach((e0, i) => {
    const w = `errands[${i}]`;
    if (!isObj(e0)) { err(`${w}: not an object`); return; }
    const E = e0;
    if (typeof E.id !== 'string' || !/^[a-z][a-z-]*$/.test(E.id)) err(`${w}.id must be a short lowercase word`);
    else if (ids.has(E.id)) err(`${w}.id "${E.id}" twice`); else ids.add(E.id);
    if (E.kind !== undefined) { weekErrand(w, E); return; }
    const day = Number(E.day);
    if (!Number.isInteger(day) || day < 1 || day > 5) err(`${w}.day must be 1–5`);
    else if (E.beat !== BEATS[day - 1]) err(`${w}.beat is ${JSON.stringify(E.beat)}; day ${day} is "${BEATS[day - 1]}"`);
    prose(`${w}.title`, E.title, 'before', 1, 8);
    // ---- people: names of the scenario's people, not the Tablet House's characters
    people = [];
    if (!isObj(E.people) || !isObj(E.people.overseer) || !isObj(E.people.gatekeeper)) err(`${w}.people: needs an overseer and a gatekeeper`);
    else {
      const seen = new Set<string>();
      for (const [k, p] of Object.entries(E.people)) {
        if (!/^[a-z]+$/.test(k)) { err(`${w}.people.${k}: a person's key is one lowercase word`); continue; }
        if (!isObj(p)) { err(`${w}.people.${k}: not an object`); continue; }
        people.push(k);
        const name = typeof p.name === 'string' ? p.name : '';
        const m = name.match(/^\{names\.(f|m)\.(\d+)\}$/);
        if (!m) { err(`${w}.people.${k}.name must be one of the scenario's names, as a placeholder ("{names.m.0}")`); continue; }
        if (p.sex !== m[1]) err(`${w}.people.${k}: ${p.name} is a ${m[1] === 'f' ? 'woman' : 'man'}'s name, but sex is "${String(p.sex)}"`);
        if (resolve(sc, `names.${m[1]}.${m[2]}`) === undefined) err(`${w}.people.${k}.name ${p.name} does not resolve (${sc.names[m[1] as 'f' | 'm'].length} names)`);
        if (seen.has(name)) err(`${w}.people.${k}: ${name} is already someone else here`);
        seen.add(name);
        if (thText.includes(name)) err(`${w}.people.${k}: ${p.name} is a character of the Tablet House script for ${sc.id}; give the errand's people names of their own`);
        prose(`${w}.people.${k}.role`, p.role, 'before', 1, 8);
      }
    }
    // ---- places
    for (const k of ['from', 'to'] as const) {
      const key = E[k];
      if (typeof key !== 'string' || !(PLACE_KEYS as readonly string[]).includes(key)) { err(`${w}.${k}: "${String(key)}" is not a place key (${PLACE_KEYS.join(', ')})`); continue; }
      if (!placeName(sc.id, key as PlaceKey)) err(`${w}.${k}: the world names no "${key}" in ${sc.id} (world/names.ts)`);
    }
    if (E.from === E.to) err(`${w}: starts and ends at the same place`);
    if (E.beat === 'muster' && !/Gate$|^postern$/.test(String(E.to))) err(`${w}.to: the levy musters at a gate (riverGate, marketGate, postern)`);
    // ---- the horn, from measured runs
    const H = isObj(E.horn) ? E.horn : null;
    if (!H) err(`${w}.horn: missing { seconds, warn, measured }`);
    else {
      const s = Number(H.seconds), wn = Number(H.warn);
      if (!(s >= 20 && s <= 300)) err(`${w}.horn.seconds must be 20–300 (got ${String(H.seconds)})`);
      if (!(wn >= 5 && wn <= s / 2)) err(`${w}.horn.warn must be 5 to half the horn's seconds (got ${String(H.warn)})`);
      const M = isObj(H.measured) ? H.measured : null;
      if (!M) warn(`${w}.horn.measured: no measured runs; set the horn from a run of the route (atlas/scripts/streets-errand.ts --measure)`);
      else {
        const run = Number(M.streetRunS), jog = Number(M.streetJogS), roof = Number(M.roofRunS);
        if (!(run > 0) || !(jog > 0)) err(`${w}.horn.measured: needs streetRunS and streetJogS (seconds)`);
        else {
          if (s <= run) err(`${w}.horn.seconds ${s}: the streets at a run take ${run} s, so nobody beats the horn`);
          if (s >= jog) warn(`${w}.horn.seconds ${s}: a jog through the streets (${jog} s) beats it; the horn is not tight`);
          if (roof > 0 && s <= roof) warn(`${w}.horn.seconds ${s}: the roofs (${roof} s) cannot beat it`);
        }
      }
    }
    // ---- the words
    const brief = Array.isArray(E.brief) ? E.brief : [];
    if (brief.length < 1 || brief.length > 3) err(`${w}.brief: ${brief.length} paragraphs (1–3)`);
    brief.forEach((p, k) => prose(`${w}.brief[${k}]`, p, 'before', 20, 90));
    if (E.slot !== 'muster') err(`${w}.slot: "${String(E.slot)}" (an errand presses the Tablet House's "muster" slot)`);
    else if (th) {
      const t = th.days.flatMap((d) => d.tablet ?? []).find((x) => x.slot === E.slot);
      if (!t || PICKS.some((p) => !t.options.some((o) => o.pick === p && o.line.includes('{value}')))) err(`${w}.slot: the Tablet House script has no "${E.slot}" slot with three readings that press {value}`);
    }
    prose(`${w}.prompt`, E.prompt, 'before', 1, 40);
    byPick(`${w}.pressed`, E.pressed, 8, 60);
    prose(`${w}.handover`, E.handover, 'after', 5, 40);
    const obj = prose(`${w}.objective`, E.objective, 'before', 3, 14);
    if (obj && !obj.includes('{place.to}')) err(`${w}.objective must name the destination as {place.to}`);
    const A = isObj(E.arrive) ? E.arrive : null;
    if (!A || !isObj(A.intime) || !isObj(A.late)) err(`${w}.arrive: needs "intime" and "late"`);
    else {
      const sc1 = prose(`${w}.arrive.intime.scene`, A.intime.scene, 'after', 20, 90);
      if (sc1 && !sc1.includes('{tablet.line}')) err(`${w}.arrive.intime.scene: the tablet is read at the gate: include {tablet.line}`);
      byPick(`${w}.arrive.intime`, A.intime, 10, 60);
      prose(`${w}.arrive.intime.after`, A.intime.after, 'after', 5, 40);
      prose(`${w}.arrive.late.scene`, A.late.scene, 'after', 20, 90);
      byPick(`${w}.arrive.late`, A.late, 10, 60);
    }
    const End = isObj(E.end) ? E.end : null;
    if (!End) err(`${w}.end: missing`);
    else {
      prose(`${w}.end.title`, End.title, 'after', 1, 8);
      prose(`${w}.end.intime`, End.intime, 'after', 3, 16);
      prose(`${w}.end.late`, End.late, 'after', 3, 16);
      const rec = prose(`${w}.end.record`, End.record, 'after', 3, 30);
      if (rec && !rec.includes('{battle.ours}')) err(`${w}.end.record: set the record's muster beside the tablet with {battle.ours}`);
      const T = isObj(End.teaser) ? End.teaser : null;
      if (!T) err(`${w}.end.teaser: missing { title, text }`);
      else { prose(`${w}.end.teaser.title`, T.title, 'after', 1, 8); prose(`${w}.end.teaser.text`, T.text, 'after', 5, 40); }
    }
    for (const k of Object.keys(E)) if (!['id', 'day', 'beat', 'title', 'people', 'from', 'to', 'horn', 'brief', 'slot', 'prompt', 'pressed', 'handover', 'objective', 'arrive', 'end'].includes(k)) err(`${w}: unknown key "${k}"`);
  });
  week();
  return { errors, warnings };

  // ================================================================ days two to five (docs/streets/lld-errands.md)

  /** The week as a whole: one errand a day in order, the same people all week, and the reckoning. */
  function week() {
    const all = errands.filter(isObj);
    const days = all.map((e) => Number(e.day));
    if (all.some((e) => e.kind !== undefined)) {
      for (let d = 1; d <= 5; d++) if (days.filter((x) => x === d).length !== 1) err(`errands: day ${d} needs exactly one errand (the week plays one a day)`);
      if (days.some((d, i) => i > 0 && d < days[i - 1])) err('errands: in day order');
    }
    // the same name is the same person, under one key, all week
    const byName = new Map<string, string>(), byKey = new Map<string, string>();
    for (const e of all) if (isObj(e.people)) for (const [k, p] of Object.entries(e.people)) {
      if (!isObj(p) || typeof p.name !== 'string') continue;
      if (byName.has(p.name) && byName.get(p.name) !== k) err(`${String(e.id)}.people.${k}: ${p.name} is "${byName.get(p.name)}" elsewhere this week`);
      if (byKey.has(k) && byKey.get(k) !== p.name) err(`${String(e.id)}.people.${k}: "${k}" is ${byKey.get(k)} elsewhere this week`);
      byName.set(p.name, k); byKey.set(k, p.name);
    }
    if (S.reckoning !== undefined) reckoningCheck([...byKey.keys()]);
    else if (all.some((e) => e.kind !== undefined)) err('reckoning: the week needs one (finds, verdict, endings)');
  }

  function rtFor(personKeys: string[], o: { line?: boolean; value?: boolean; find?: boolean; tablet?: string[] }): Rt {
    return (path) => {
      if (path === 'place.to' || path === 'place.from') return true;
      const pl = path.match(/^place\.([a-zA-Z]+)$/);
      if (pl) return weekPlaceName(sc.id, pl[1]) ? true : `names no place of this city's world (${[...WEEK_PLACES, ...AREAS].filter((k) => weekPlaceName(sc.id, k)).join(', ')})`;
      const pm = path.match(/^([a-z]+)\.(name|role)$/);
      if (pm && personKeys.includes(pm[1])) return true;
      if (path === 'tablet.line') return o.line ? true : 'is only known once the choice is made';
      if (path === 'value') return o.value ? true : 'is only filled in the end card’s "heard" line';
      if (path === 'find.year') return o.find ? true : 'is only filled in the reckoning and the last teaser';
      if (path.startsWith('tablet.')) return o.tablet?.includes(path.slice(7)) ? true : 'is not filled here';
      return null;
    };
  }

  function effectsOk(where: string, x: unknown, required: boolean) {
    if (x === undefined && !required) return;
    if (!isObj(x)) { err(`${where}: effects { favour, conscience, household }`); return; }
    let any = false;
    for (const [k, v] of Object.entries(x)) {
      if (!['favour', 'conscience', 'household'].includes(k)) err(`${where}.${k}: not a meter`);
      else if (!Number.isInteger(v) || Math.abs(v as number) > 3) err(`${where}.${k}: a whole number −3…3`);
      else if (v !== 0) any = true;
    }
    if (!any) err(`${where}: moves no meter`);
  }

  /** A clock (the rumour, moonrise, the fire, the reading) set from measured runs, under the model it states. */
  function clockCheck(w: string, C: Record<string, unknown>, timed: boolean) {
    const s = Number(C.seconds), wn = Number(C.warn);
    prose(`${w}.name`, C.name, 'before', 1, 5);
    if (!(s >= 20 && s <= 300)) err(`${w}.seconds must be 20–300 (got ${String(C.seconds)})`);
    if (!(wn >= 5 && wn <= s / 2)) err(`${w}.warn must be 5 to half the seconds (got ${String(C.warn)})`);
    effectsOk(`${w}.lateEffects`, C.lateEffects, false);
    if (!timed) err(`${w}: the clock times no run`);
    const M = isObj(C.measured) ? C.measured : null;
    if (!M) { err(`${w}.measured: set the clock from measured runs of the route`); return; }
    const run = Number(M.streetRunS), jog = Number(M.streetJogS), roof0 = Number(M.roofRunS);
    if (!(run > 0) || !(jog > run)) { err(`${w}.measured: needs streetRunS and a slower streetJogS (seconds)`); return; }
    const load = C.load === undefined ? 1 : Number(C.load), extra = C.extra === undefined ? 0 : Number(C.extra);
    if (!(load >= 0.5 && load <= 1)) err(`${w}.load: a speed factor 0.5–1 (carrying)`);
    if (!(extra >= 0 && extra <= 60)) err(`${w}.extra: 0–60 seconds (a search's allowance)`);
    let factor = 1;
    if (C.crowd !== undefined) {
      const K = isObj(C.crowd) ? C.crowd : {};
      const share = Number(K.share), pace = Number(K.pace);
      if (!(share > 0 && share <= 1) || !(pace >= 0.2 && pace < 1)) err(`${w}.crowd: { share 0–1 of the street route, pace 0.2–1 }`);
      else factor = 1 - share + share / pace;
    }
    const streets = (run / load) * factor + extra, jogged = (jog / load) * factor + extra, roof = roof0 > 0 ? roof0 / load + extra : NaN;
    const r1 = (x: number) => Math.round(x * 10) / 10;
    const soft = typeof C.provisional === 'string' && C.provisional.length > 10;
    if (soft) warn(`${w}: provisional: ${C.provisional}`);
    if (C.roofsPay === true) {
      if (C.crowd === undefined) err(`${w}.roofsPay: only a crowd in the streets makes the roofs pay; give one`);
      if (s >= streets) err(`${w}.seconds ${s}: the crowded streets at a run (${r1(streets)} s) beat it, so the roofs do not pay`);
      if (!(roof > 0)) (soft ? warn : err)(`${w}: no measured roof run beats it yet`);
      else if (s <= roof) (soft ? warn : err)(`${w}.seconds ${s}: the roofs (${r1(roof)} s) cannot beat it`);
    } else {
      if (s <= streets) err(`${w}.seconds ${s}: the streets at a run take ${r1(streets)} s under the clock's model, so nobody beats it`);
      if (s >= jogged) warn(`${w}.seconds ${s}: a jog through the streets (${r1(jogged)} s) beats it; the clock is not tight`);
      if (roof > 0 && s <= roof) warn(`${w}.seconds ${s}: the roofs (${r1(roof)} s) cannot beat it`);
    }
  }

  function arrivalCheck(w: string, A: unknown, keys: string[], rt: Rt, rtBefore: Rt) {
    if (!isObj(A)) { err(`${w}: missing`); return; }
    prose(`${w}.scene`, A.scene, 'after', 12, 60, rtBefore);
    for (const k of keys) prose(`${w}.${k}`, A[k], 'after', 8, 60, rt);
    for (const k of Object.keys(A)) if (k !== 'scene' && !keys.includes(k)) err(`${w}: unknown key "${k}"`);
  }

  /** One errand of days two to five: `reading` (say one of a Tablet House slot's readings on arriving) or
   *  `destination` (choose where to carry it). */
  function weekErrand(w: string, E: Record<string, unknown>) {
    const day = Number(E.day);
    if (!Number.isInteger(day) || day < 2 || day > 5) err(`${w}.day: errands with a kind are days 2–5`);
    else if (E.beat !== BEATS[day - 1]) err(`${w}.beat is ${JSON.stringify(E.beat)}; day ${day} is "${BEATS[day - 1]}"`);
    if (!['reading', 'destination'].includes(String(E.kind))) err(`${w}.kind: "reading" or "destination"`);
    const verbs = Array.isArray(E.verb) ? E.verb : [];
    if (!verbs.length || verbs.some((v) => !(VERBS as readonly unknown[]).includes(v))) err(`${w}.verb: one or more of ${VERBS.join(', ')}`);
    // ---- people
    people = [];
    if (!isObj(E.people) || !Object.keys(E.people).length) err(`${w}.people: none`);
    else {
      const seen = new Set<string>();
      for (const [k, p] of Object.entries(E.people)) {
        if (!/^[a-z]+$/.test(k)) { err(`${w}.people.${k}: a person's key is one lowercase word`); continue; }
        if (!isObj(p)) { err(`${w}.people.${k}: not an object`); continue; }
        people.push(k);
        const name = typeof p.name === 'string' ? p.name : '';
        const m = name.match(/^\{names\.(f|m)\.(\d+)\}$/);
        if (!m) { err(`${w}.people.${k}.name must be one of the scenario's names, as a placeholder`); continue; }
        if (p.sex !== m[1]) err(`${w}.people.${k}: ${name} is a ${m[1] === 'f' ? 'woman' : 'man'}'s name, but sex is "${String(p.sex)}"`);
        if (resolve(sc, `names.${m[1]}.${m[2]}`) === undefined) err(`${w}.people.${k}.name ${name} does not resolve`);
        if (seen.has(name)) err(`${w}.people.${k}: ${name} is already someone else here`);
        seen.add(name);
        const inTh = thText.includes(name);
        if (p.shared === true && !inTh) err(`${w}.people.${k}: marked shared, but ${name} is no character of the Tablet House script`);
        if (p.shared !== true && inTh) err(`${w}.people.${k}: ${name} is a character of the Tablet House script; mark it "shared" (the same person) or use another name`);
        prose(`${w}.people.${k}.role`, p.role, 'before', 1, 8);
        for (const x of Object.keys(p)) if (!['name', 'sex', 'role', 'shared'].includes(x)) err(`${w}.people.${k}: unknown key "${x}"`);
      }
    }
    const before = rtFor(people, {}), after = rtFor(people, { line: true });
    // ---- places
    const placeOk = (where: string, key: unknown) => {
      if (typeof key !== 'string' || !WEEK_PLACES.includes(key)) { err(`${where}: "${String(key)}" is not a place key (${WEEK_PLACES.join(', ')})`); return false; }
      if (!weekPlaceName(sc.id, key)) { err(`${where}: the world names no "${key}" in ${sc.id}`); return false; }
      return true;
    };
    placeOk(`${w}.from`, E.from);
    if (E.to !== undefined) placeOk(`${w}.to`, E.to);
    // ---- the clock
    const C = isObj(E.clock) ? E.clock : null;
    if (!C) err(`${w}.clock: missing (set from measured runs)`);
    // ---- the words
    if (E.note !== undefined) {
      const N = isObj(E.note) ? E.note : {};
      prose(`${w}.note.text`, N.text, 'before', 20, 60, before); prose(`${w}.note.play`, N.play, 'before', 1, 4); prose(`${w}.note.skip`, N.skip, 'before', 1, 4);
    }
    const M = isObj(E.mechanics) ? E.mechanics : {};
    for (const k of Object.keys(M)) if (!(MECHANICS as readonly string[]).includes(k)) err(`${w}.mechanics.${k}: not a mechanic of the LLD (${MECHANICS.join(', ')})`);
    if ((M.pursuers || M.fire) && !E.note) err(`${w}.note: a night with soldiers and fire needs the content note and the skip`);
    if (E.outcome !== undefined && E.outcome !== sc.outcome) err(`${w}.outcome: "${String(E.outcome)}", but the record's ending is "${sc.outcome}"`);
    if (E.archive !== undefined && (E.archive === 'burned') !== sc.burnedArchives) err(`${w}.archive: "${String(E.archive)}", but the record says the archive ${sc.burnedArchives ? 'burned' : 'did not burn'}`);
    if (day === 4 && E.outcome === undefined) err(`${w}.outcome: day four tells the record's ending ("${sc.outcome}")`);
    const brief = Array.isArray(E.brief) ? E.brief : [];
    if (brief.length < 1 || brief.length > 3) err(`${w}.brief: ${brief.length} panels (1–3)`);
    brief.forEach((p, k) => prose(`${w}.brief[${k}]`, p, 'before', 15, 60, before));
    prose(`${w}.prompt`, E.prompt, 'before', 3, 40, before);
    for (const [k, b] of (Array.isArray(E.barks) ? E.barks : []).entries()) {
      if (!isObj(b) || !(typeof b.on === 'string' && ([...WEEK_PLACES, ...AREAS, ...BARK_EVENTS] as string[]).includes(b.on))) { err(`${w}.barks[${k}].on: a place, an area or an event (${BARK_EVENTS.join(', ')})`); continue; }
      if (!BARK_EVENTS.includes(b.on as never) && !weekPlaceName(sc.id, b.on)) err(`${w}.barks[${k}].on: the world names no "${b.on}"`);
      if (b.who !== undefined && !people.includes(String(b.who))) err(`${w}.barks[${k}].who: not one of the errand's people`);
      prose(`${w}.barks[${k}].text`, b.text, 'before', 6, 35, before);
    }
    const End = isObj(E.end) ? E.end : null;
    let timed = false;
    if (E.kind === 'reading') {
      if (!placeOk(`${w}.to`, E.to)) { /* reported */ }
      timed = true;
      const obj = prose(`${w}.objective`, E.objective, 'before', 3, 14, before);
      if (obj && !obj.includes('{place.to}')) err(`${w}.objective must name the destination as {place.to}`);
      const slot = String(E.slot);
      const t = th?.days.flatMap((d) => d.tablet ?? []).find((x) => x.slot === slot);
      if (!t || PICKS.some((p) => !t.options.some((o) => o.pick === p && o.line && o.label))) err(`${w}.slot: the Tablet House script has no "${slot}" slot with three readings`);
      const A = isObj(E.arrive) ? E.arrive : {};
      arrivalCheck(`${w}.arrive.intime`, A.intime, [...PICKS], after, before);
      arrivalCheck(`${w}.arrive.late`, A.late, [...PICKS], after, before);
      for (const k of ['intime', 'late']) for (const p of PICKS) {
        const x = isObj(A[k]) ? (A[k] as Record<string, unknown>)[p] : '';
        if (typeof x === 'string' && !x.includes('{tablet.line}')) err(`${w}.arrive.${k}.${p}: say what was said: include {tablet.line}`);
      }
      prose(`${w}.arrive.after`, A.after, 'after', 10, 60, after);
      for (const k of Object.keys(A)) if (!['intime', 'late', 'after'].includes(k)) err(`${w}.arrive: unknown key "${k}"`);
      if (End) { prose(`${w}.end.intime`, End.intime, 'after', 3, 16, before); prose(`${w}.end.late`, End.late, 'after', 3, 16, before); }
    } else if (E.kind === 'destination') {
      const rec = String(E.record);
      if (!['ours', 'archive', 'end'].includes(rec)) err(`${w}.record: the reckoning's line this errand fills ("ours", "archive" or "end")`);
      if (rec === 'ours' && th) { try { slotOf(th, 'ours'); } catch { err(`${w}.record: the Tablet House script has no "ours" slot`); } }
      if (rec === 'end') {
        const L = isObj(E.lines) ? E.lines : null;
        if (!L) err(`${w}.lines: the three readings of the night ({true, rounded, boasted})`);
        else for (const p of PICKS) prose(`${w}.lines.${p}`, L[p], 'after', 5, 30, before);
      } else if (E.lines !== undefined) err(`${w}.lines: only for the record line "end"`);
      const opts = Array.isArray(E.options) ? E.options.filter(isObj) : [];
      if (opts.length < 2 || opts.length > 4) err(`${w}.options: ${opts.length} (2–4)`);
      const picks = new Set(opts.map((o) => o.pick));
      if (!picks.has('true') || !picks.has('boasted')) err(`${w}.options: the choice must hold the record's reading ("true") and the king's ("boasted")`);
      const applies = C && Array.isArray(C.applies) ? C.applies.map(String) : null;
      const oids = new Set<string>();
      let shared = false, carries = false;
      opts.forEach((o, k) => {
        const ow = `${w}.options[${k}]`;
        if (typeof o.id !== 'string' || !/^[a-z][a-z-]*$/.test(o.id) || oids.has(o.id)) err(`${ow}.id: a short lowercase word, once`); else oids.add(o.id);
        prose(`${ow}.label`, o.label, 'before', 2, 12, before);
        if (!(PICKS as readonly unknown[]).includes(o.pick)) err(`${ow}.pick: how the record line reads after it (${PICKS.join(', ')})`);
        effectsOk(`${ow}.effects`, o.effects, true);
        if (o.flag !== undefined && (typeof o.flag !== 'string' || !/^[a-z][a-z-]*$/.test(o.flag))) err(`${ow}.flag: a short lowercase word`);
        prose(`${ow}.outcome`, o.outcome, 'after', 3, 16, before);
        if (o.at !== undefined && !(SPOTS as readonly unknown[]).includes(o.at)) err(`${ow}.at: a spot at the start (${SPOTS.join(', ')})`);
        if (o.at !== undefined || o.carry === true) prose(`${ow}.done`, o.done, 'after', 15, 60, before);
        if (o.carry !== undefined && o.carry !== true) err(`${ow}.carry: true or absent`);
        if (o.carry === true) carries = true;
        const dest = o.to ?? E.to;
        if (o.to !== undefined) placeOk(`${ow}.to`, o.to);
        else if (E.to === undefined) err(`${ow}: goes nowhere: give it a "to" or the errand one`);
        const runs = dest !== E.from;
        const isTimed = runs && (!applies || applies.includes(String(o.id)));
        if (isTimed) timed = true;
        if (applies && !runs && applies.includes(String(o.id))) err(`${ow}: the clock cannot time an option that does not run`);
        const ort = rtFor(people, { line: true });
        if (o.to === undefined) { shared = true; if (o.arrive !== undefined) err(`${ow}.arrive: it arrives at the errand's "to"; its words are the errand's arrive`); }
        else {
          if (runs) {
            const ob = prose(`${ow}.objective`, o.objective, 'before', 3, 14, before);
            if (ob && !o.find && !ob.includes('{place.to}')) err(`${ow}.objective must name the destination as {place.to}`);
          } else if (o.objective !== undefined) err(`${ow}.objective: it does not run`);
          const OA = isObj(o.arrive) ? o.arrive : {};
          arrivalCheck(`${ow}.arrive.intime`, OA.intime, ['text'], ort, before);
          if (isTimed) arrivalCheck(`${ow}.arrive.late`, OA.late, ['text'], ort, before);
          else if (OA.late !== undefined) err(`${ow}.arrive.late: the clock does not time it`);
          for (const x of Object.keys(OA)) if (!['intime', 'late'].includes(x)) err(`${ow}.arrive: unknown key "${x}"`);
        }
        if (o.find !== undefined) {
          const F = isObj(o.find) ? o.find : {};
          if (F.on !== 'walls') err(`${ow}.find.on: "walls" (the wall walk) is the only search ground so far`);
          placeOk(`${ow}.find.near`, F.near);
          const clues = Array.isArray(F.clues) ? F.clues.filter(isObj) : [];
          if (clues.length < 2) err(`${ow}.find.clues: at least two`);
          clues.forEach((c, i) => {
            if (!([...WEEK_PLACES, ...AREAS] as unknown[]).includes(c.on) || !weekPlaceName(sc.id, String(c.on))) err(`${ow}.find.clues[${i}].on: a place of the world`);
            if (!people.includes(String(c.who))) err(`${ow}.find.clues[${i}].who: one of the errand's people`);
            prose(`${ow}.find.clues[${i}].text`, c.text, 'before', 8, 40, before);
          });
        }
        for (const x of Object.keys(o)) if (!['id', 'label', 'pick', 'to', 'at', 'carry', 'effects', 'flag', 'outcome', 'done', 'objective', 'find', 'arrive'].includes(x)) err(`${ow}: unknown key "${x}"`);
      });
      if (shared) {
        const ob = prose(`${w}.objective`, E.objective, 'before', 3, 14, before);
        if (ob && !ob.includes('{place.to}')) err(`${w}.objective must name the destination as {place.to}`);
      } else if (E.objective !== undefined) err(`${w}.objective: each option has its own`);
      const A = isObj(E.arrive) ? E.arrive : {};
      if (shared) {
        const keys = carries ? ['carried', 'empty'] : ['empty'];
        arrivalCheck(`${w}.arrive.intime`, A.intime, keys, after, before);
        if (C) arrivalCheck(`${w}.arrive.late`, A.late, keys, after, before);
      } else if (A.intime !== undefined || A.late !== undefined) err(`${w}.arrive: the options carry their own arrivals; keep only "after" here`);
      prose(`${w}.arrive.after`, A.after, 'after', 10, 60, before);
      for (const k of Object.keys(A)) if (!['intime', 'late', 'after'].includes(k)) err(`${w}.arrive: unknown key "${k}"`);
      if (End) {
        if (End.intime !== undefined) prose(`${w}.end.intime`, End.intime, 'after', 3, 16, before);
        if (C) prose(`${w}.end.late`, End.late, 'after', 3, 16, before);
        if (End.heard !== undefined) {
          const h = prose(`${w}.end.heard`, End.heard, 'after', 3, 16, rtFor(people, { value: true }));
          if (rec !== 'ours') err(`${w}.end.heard: only for the dead ("ours"), whose {value} the choice sets`);
          else if (h && !h.includes('{value}')) err(`${w}.end.heard: include {value}`);
        }
      }
    }
    if (C) clockCheck(`${w}.clock`, C, timed);
    if (!End) err(`${w}.end: missing`);
    else {
      prose(`${w}.end.title`, End.title, 'after', 1, 8);
      // the record does not move with play: no runtime placeholder, and at least one fact of the record
      const places: Rt = (path) => (/^place\.[a-zA-Z]+$/.test(path) ? rtFor([], {})(path) : null);
      const r = prose(`${w}.end.record`, End.record, 'after', 5, 40, places);
      if (r && ![...r.matchAll(PH)].some((m) => resolve(sc, m[1]) !== undefined)) err(`${w}.end.record: set the record beside the play with its placeholders`);
      const T = isObj(End.teaser) ? End.teaser : null;
      if (!T) err(`${w}.end.teaser: missing { title, text }`);
      else { prose(`${w}.end.teaser.title`, T.title, 'after', 1, 8); prose(`${w}.end.teaser.text`, T.text, 'after', 5, 40, rtFor(people, { find: day === 5 })); }
      for (const k of Object.keys(End)) if (!['title', 'intime', 'late', 'heard', 'record', 'teaser'].includes(k)) err(`${w}.end: unknown key "${k}"`);
    }
    for (const k of Object.keys(E)) if (!['id', 'day', 'beat', 'kind', 'verb', 'title', 'people', 'from', 'to', 'outcome', 'archive', 'note', 'clock', 'mechanics', 'brief', 'objective', 'barks', 'slot', 'prompt', 'record', 'lines', 'options', 'arrive', 'end'].includes(k)) err(`${w}: unknown key "${k}"`);
  }

  /** The reckoning: a find for every way each day can go, the verdict by how much truth survived, and the endings. */
  function reckoningCheck(personKeys: string[]) {
    const R = isObj(S.reckoning) ? S.reckoning : null;
    if (!R) { err('reckoning: not an object'); return; }
    const rt = rtFor(personKeys, { find: true, tablet: ['muster', 'ours', 'field', 'end'] });
    prose('reckoning.title', R.title, 'after', 1, 6);
    prose('reckoning.intro', R.intro, 'after', 10, 60, rt);
    const W = parseWeek(S);
    if (!W) { err('reckoning: the week needs its five errands (muster; a field reading; then the dead, the archive and the night by destination)'); return; }
    const F = isObj(R.finds) ? R.finds : {};
    const need: Record<string, string[]> = {
      muster: [...PICKS, 'late'], field: [...PICKS], ours: W.ours.options.map((o) => o.id),
      archive: [...W.archive.options.filter((o) => !o.carry).map((o) => o.id), ...(W.archive.options.some((o) => o.carry) ? ['delivered', 'cracked', 'lost'] : [])],
      end: W.end.options.map((o) => o.id),
    };
    for (const [line, keys] of Object.entries(need)) {
      const G = isObj(F[line]) ? F[line] : {};
      for (const k of keys) prose(`reckoning.finds.${line}.${k}`, G[k], 'after', 10, 60, rt);
      for (const k of Object.keys(G)) if (!keys.includes(k)) err(`reckoning.finds.${line}.${k}: no way of the week leads here`);
    }
    for (const k of Object.keys(F)) if (!need[k]) err(`reckoning.finds.${k}: not a line of the week (${Object.keys(need).join(', ')})`);
    const B = isObj(R.bands) ? R.bands : {};
    if (!(Number(B.true) > Number(B.rounded) && Number(B.rounded) > 0 && Number(B.true) <= 100)) err('reckoning.bands: { true, rounded } scores, 100 ≥ true > rounded > 0');
    const V = isObj(R.verdict) ? R.verdict : {};
    for (const p of PICKS) prose(`reckoning.verdict.${p}`, V[p], 'after', 15, 60, rt);
    const flags = new Set<string>(['delivered', ...[W.ours, W.archive, W.end].flatMap((e) => e.options.map((o) => o.flag ?? '').filter(Boolean))]);
    const ends = Array.isArray(R.endings) ? R.endings.filter(isObj) : [];
    if (ends.length < 3) err('reckoning.endings: at least three');
    const eids = new Set<string>();
    ends.forEach((x, i) => {
      const ew = `reckoning.endings[${i}]`;
      if (typeof x.id !== 'string' || !/^[a-z][a-z-]*$/.test(x.id) || eids.has(x.id)) err(`${ew}.id: a short lowercase word, once`); else eids.add(x.id);
      prose(`${ew}.title`, x.title, 'after', 1, 8, rt);
      prose(`${ew}.text`, x.text, 'after', 20, 80, rt);
      const wh = isObj(x.when) ? x.when : null;
      if (!wh) { err(`${ew}.when: missing ({} for the fallback)`); return; }
      for (const [k, v] of Object.entries(wh)) {
        if (k === 'flag') { if (!flags.has(String(v))) err(`${ew}.when.flag: "${String(v)}" is set by no choice (${[...flags].join(', ')})`); }
        else if (!['favour', 'conscience', 'household'].includes(k)) err(`${ew}.when.${k}: not a meter or a flag`);
        else if (!Array.isArray(v) || v.length !== 2 || !(Number(v[0]) <= Number(v[1])) || Math.abs(Number(v[0])) > 20 || Math.abs(Number(v[1])) > 20) err(`${ew}.when.${k}: [low, high] within ±20`);
      }
      if (i === ends.length - 1 && Object.keys(wh).length) err(`${ew}.when: the last ending is the fallback ({})`);
    });
    const Sh = isObj(R.share) ? R.share : {};
    prose('reckoning.share.intro', Sh.intro, 'after', 4, 20, rt);
    for (const k of Object.keys(R)) if (!['title', 'intro', 'finds', 'bands', 'verdict', 'endings', 'share'].includes(k)) err(`reckoning: unknown key "${k}"`);
    if (errors.length || !th) return;
    // every ending is someone's: play every way the week can go
    const reached = new Set<string>();
    for (const path of weekPaths(W)) reached.add(reckon(sc as unknown as TabletScenario, th, S as unknown as WeekScript, path).ending.id);
    for (const x of ends) if (!reached.has(String(x.id))) err(`reckoning.endings: "${String(x.id)}" is reached by no way the week can go`);
  }
}

// ================================================================ the week: shared with the test (and, ported, the runtime)

const VERBS = ['deliver', 'carry news', 'find a person', 'rescue', 'escape', 'hide a copy'] as const;
const MECHANICS = ['crowd', 'rumour', 'runnersRoad', 'search', 'wallWalk', 'fire', 'smoke', 'pursuers', 'load', 'stealth', 'climb'] as const;
const BARK_EVENTS = ['rumour', 'crowd', 'smoke', 'crack', 'caught', 'caughtLoad'] as const;
const SPOTS = ['stair', 'cistern'] as const;
/** Places of the world an errand of the week may start or end at (atlas/src/game/streets/world/layer.ts makes them; the
 *  day-one runtime's PLACE_KEYS is the first six), and the areas prose may name ({place.quarter}). */
export const WEEK_PLACES = [...PLACE_KEYS, 'palaceGate', 'temple', 'walls', 'dyer', 'home'] as string[];
export const AREAS = ['quarter', 'potters', 'weavers'];

/** The name the world gives a place or an area of the week ("The palace gate"), or null when this city has none. */
export function weekPlaceName(scenarioId: string, key: string): string | null {
  if ((PLACE_KEYS as readonly string[]).includes(key)) return placeName(scenarioId, key as PlaceKey);
  const n = streetNames(scenarioId);
  switch (key) {
    case 'palaceGate': return 'The palace gate';
    case 'temple': return 'The temple';
    case 'walls': return 'The walls';
    // the dyers' street (world/civic.ts dyersStreet): the dyer's house and the runner's beside it, inside the postern
    case 'dyer': return n.postern && n.quarter ? 'The dyer’s house' : null;
    case 'home': return n.postern && n.quarter ? 'Your house' : null;
    case 'quarter': return n.quarter;
    case 'potters': return n.streets[0] ?? null;
    case 'weavers': return n.streets[1] ?? null;
  }
  return null;
}

type Effects = Partial<Meters>;
export interface WeekOption { id: string; label: string; pick: Pick; to?: string; at?: string; carry?: boolean; effects: Effects; flag?: string; outcome: string; done?: string; objective?: string; arrive?: { intime: { scene: string; text: string }; late?: { scene: string; text: string } } }
export interface WeekErrand {
  id: string; day: number; kind?: 'reading' | 'destination'; title: string; from: string; to?: string;
  people: Record<string, { name: string; sex: 'f' | 'm'; role: string }>;
  clock?: { seconds: number; applies?: string[]; lateEffects?: Effects };
  brief: string[]; prompt: string; objective?: string; slot?: string; record?: 'ours' | 'archive' | 'end';
  lines?: Record<Pick, string>; options: WeekOption[]; barks?: { on: string; who?: string; text: string }[];
  arrive: Record<string, unknown> & { after?: string };
  end: { title: string; intime?: string; late?: string; heard?: string; record: string; teaser: { title: string; text: string } };
}
export interface Ending { id: string; title: string; text: string; when: { favour?: [number, number]; conscience?: [number, number]; household?: [number, number]; flag?: string } }
export interface WeekScript {
  scenario: string; errands: WeekErrand[];
  reckoning: {
    title: string; intro: string; finds: Record<'muster' | 'field' | 'ours' | 'archive' | 'end', Record<string, string>>;
    bands: { true: number; rounded: number }; verdict: Record<Pick, string>; endings: Ending[]; share: { intro: string };
  };
}
/** The week's five errands by role, or null when the script does not have them. */
export function parseWeek(raw: unknown): { muster: WeekErrand; field: WeekErrand; ours: WeekErrand; archive: WeekErrand; end: WeekErrand } | null {
  const S = raw as WeekScript;
  if (!S || !Array.isArray(S.errands)) return null;
  const d = (n: number) => S.errands.find((e) => e && e.day === n);
  const muster = d(1), field = d(2);
  const by = (r: string) => S.errands.find((e) => e && e.kind === 'destination' && e.record === r && Array.isArray(e.options));
  const ours = by('ours'), archive = by('archive'), end = by('end');
  if (!muster || !field || field.kind !== 'reading' || !ours || !archive || !end) return null;
  return { muster, field, ours, archive, end };
}

/** One way the week went: the day-one reading and whether the horn beat the runner, then each day's choice and clock;
 *  day four's load (when the runner carried it) arrives whole, cracked or not at all. */
export interface WeekPath {
  muster: { pick: Pick; late: boolean };
  field: { pick: Pick; late: boolean };
  ours: { option: string; late: boolean };
  archive: { option: string; late: boolean; load: 'delivered' | 'cracked' | 'lost' | null };
  end: { option: string; late: boolean };
}
const timedOf = (e: WeekErrand, o: WeekOption) => !!e.clock && (o.to ?? e.to) !== e.from && (!e.clock.applies || e.clock.applies.includes(o.id));
/** Every way the week can go. */
export function weekPaths(W: NonNullable<ReturnType<typeof parseWeek>>): WeekPath[] {
  const picks: Pick[] = ['true', 'rounded', 'boasted'];
  const tf = [false, true];
  const opt = (e: WeekErrand) => e.options.flatMap((o) => (timedOf(e, o) ? tf : [false]).flatMap((late) =>
    (o.carry ? (['delivered', 'cracked', 'lost'] as const) : [null]).map((load) => ({ option: o.id, late, load }))));
  const out: WeekPath[] = [];
  for (const m of picks) for (const ml of tf) for (const f of picks) for (const fl of tf)
    for (const o of opt(W.ours)) for (const a of opt(W.archive)) for (const e of opt(W.end))
      out.push({ muster: { pick: m, late: ml }, field: { pick: f, late: fl }, ours: { option: o.option, late: o.late }, archive: a, end: { option: e.option, late: e.late } });
  return out;
}

/** The fill context of the week: the scenario, the people, every place of the world by key ({place.quarter}), and what
 *  play knows. */
export function weekCtx(s: TabletScenario, people: WeekErrand['people'], extra: Record<string, unknown> = {}): Record<string, unknown> {
  const base = context(s);
  const place: Record<string, string> = {};
  for (const k of [...WEEK_PLACES, ...AREAS]) { const n = weekPlaceName(s.id, k); if (n) place[k] = inSentence(n); }
  const ppl = Object.fromEntries(Object.entries(people).map(([k, p]) => [k, { name: fill(p.name, base), sex: p.sex, role: p.role }]));
  const x = extra as { place?: Record<string, string> };
  return context(s, { ...ppl, ...extra, place: { ...place, ...(x.place ?? {}) } });
}
/** Every person of the week by key. */
export function weekPeople(S: WeekScript): WeekErrand['people'] {
  return Object.assign({}, ...S.errands.map((e) => e.people));
}

export interface Reckoning {
  meters: Meters; flags: string[];
  lines: { id: 'muster' | 'field' | 'ours' | 'archive' | 'end'; pick: Pick; score: number }[];
  score: number; band: Pick; ending: Ending;
  texts: { intro: string; finds: string[]; verdict: string; ending: string; title: string; share: string };
  tablet: { muster: number; ours: number; field: string; end: string };
}
/** The reckoning of one way the week went: meters (day one and two move them as the Tablet House picks do), the five
 *  lines and what survived of each (twenty points for the record's reading, ten for a rounded or broken one, none for
 *  the king's or a lost one), the verdict by score, the first ending whose conditions hold, and every text filled. */
export function reckon(s: TabletScenario, th: TabletScript, S: WeekScript, p: WeekPath): Reckoning {
  const W = parseWeek(S)!;
  const m: Meters = { favour: 0, conscience: 0, household: 0 };
  const add = (e?: Effects) => { for (const k of ['favour', 'conscience', 'household'] as const) m[k] += e?.[k] ?? 0; };
  const flags: string[] = [];
  const thEffects = (slot: 'muster' | 'field', pick: Pick) => slotOf(th, slot).options.find((o) => o.pick === pick)?.effects;
  add(thEffects('muster', p.muster.pick));
  add(thEffects('field', p.field.pick));
  if (p.field.late) add(W.field.clock?.lateEffects);
  const choose = (e: WeekErrand, c: { option: string; late: boolean }) => {
    const o = e.options.find((x) => x.id === c.option)!;
    add(o.effects);
    if (o.flag) flags.push(o.flag);
    if (c.late) add(e.clock?.lateEffects);
    return o;
  };
  const ours = choose(W.ours, p.ours), arch = choose(W.archive, p.archive), end = choose(W.end, p.end);
  if (p.archive.load === 'delivered' || p.archive.load === 'cracked') flags.push('delivered');
  const pts = (x: Pick) => (x === 'true' ? 20 : x === 'rounded' ? 10 : 0);
  const archPick: Pick = arch.carry ? (p.archive.load === 'delivered' ? 'true' : p.archive.load === 'cracked' ? 'rounded' : 'boasted') : arch.pick;
  const lines: Reckoning['lines'] = [
    { id: 'muster', pick: p.muster.pick, score: pts(p.muster.pick) }, { id: 'field', pick: p.field.pick, score: pts(p.field.pick) },
    { id: 'ours', pick: ours.pick, score: pts(ours.pick) }, { id: 'archive', pick: archPick, score: pts(archPick) },
    { id: 'end', pick: end.pick, score: pts(end.pick) },
  ];
  const score = lines.reduce((t, l) => t + l.score, 0);
  const R = S.reckoning;
  const band: Pick = score >= R.bands.true ? 'true' : score >= R.bands.rounded ? 'rounded' : 'boasted';
  const within = (v: number, r?: [number, number]) => !r || (v >= r[0] && v <= r[1]);
  const ending = R.endings.find((e) => within(m.favour, e.when.favour) && within(m.conscience, e.when.conscience) && within(m.household, e.when.household) && (!e.when.flag || flags.includes(e.when.flag))) ?? R.endings[R.endings.length - 1];
  const v = valuesOf(s);
  const base = context(s);
  const tablet = {
    muster: v.muster[p.muster.pick], ours: v.ours[ours.pick],
    field: lineOf(s, th, base, 'field', p.field.pick), end: fill(W.end.lines![end.pick], weekCtx(s, weekPeople(S))),
  };
  const ctx = weekCtx(s, weekPeople(S), { tablet, find: { year: `AY ${digYear(s)}` } });
  const f = (t: string) => fill(t, ctx);
  const archKey = arch.carry ? (p.archive.load ?? 'lost') : arch.id;
  return {
    meters: m, flags, lines, score, band, ending, tablet,
    texts: {
      title: f(R.title), intro: f(R.intro), verdict: f(R.verdict[band]), ending: f(ending.text),
      finds: [p.muster.late ? R.finds.muster.late : R.finds.muster[p.muster.pick], R.finds.field[p.field.pick], R.finds.ours[ours.id], R.finds.archive[archKey], R.finds.end[end.id]].map(f),
      share: f(R.share.intro),
    },
  };
}

/** Every line an errand of days two to five can say, filled, for every choice and both clocks (for the test). */
export function weekTexts(s: TabletScenario, th: TabletScript, S: WeekScript, e: WeekErrand): string[] {
  const out: string[] = [];
  const people = weekPeople(S);
  const placeOf = (k: string | undefined) => (k ? inSentence(weekPlaceName(s.id, k) ?? '') : '');
  const say = (t: string | undefined, extra: Record<string, unknown>) => { if (t !== undefined) out.push(fill(t, weekCtx(s, people, extra))); };
  const at = (to?: string) => ({ place: { from: placeOf(e.from), to: placeOf(to ?? e.to) } });
  for (const t of [e.title, ...e.brief, e.prompt, e.objective, e.end.title, e.end.intime, e.end.late, e.end.record, e.end.teaser.title, e.end.teaser.text, e.arrive.after]) say(t, { ...at(), find: { year: `AY ${digYear(s)}` } });
  for (const b of e.barks ?? []) say(b.text, at());
  const n = (e as unknown as { note?: { text: string } }).note;
  if (n) say(n.text, at());
  if (e.kind === 'reading') {
    for (const pick of PICKS) {
      const x = { ...at(), tablet: { line: lineOf(s, th, context(s), e.slot as 'field', pick) } };
      for (const k of ['intime', 'late'] as const) { const A = e.arrive[k] as Record<string, string>; say(A.scene, x); say(A[pick], x); }
    }
  } else {
    const v = valuesOf(s);
    for (const o of e.options) {
      const line = e.record === 'end' ? fill(e.lines![o.pick], weekCtx(s, people)) : e.record === 'ours' ? lineOf(s, th, context(s), 'ours', o.pick) : '';
      const x = { ...at(o.to), tablet: { line }, value: e.record === 'ours' ? v.ours[o.pick] : undefined };
      for (const t of [o.label, o.outcome, o.done, o.objective, o.arrive?.intime.scene, o.arrive?.intime.text, o.arrive?.late?.scene, o.arrive?.late?.text]) say(t, x);
      for (const c of (o as unknown as { find?: { clues: { text: string }[] } }).find?.clues ?? []) say(c.text, x);
      if (e.end.heard) say(e.end.heard, x);
    }
    for (const k of ['intime', 'late']) { const A = e.arrive[k] as Record<string, string> | undefined; if (A) for (const t of Object.values(A)) say(t, at()); }
  }
  return out;
}

function loadScenarios(path: string, dir: string): Map<string, Scenario> {
  const out = new Map<string, Scenario>();
  if (existsSync(path)) for (const sc of (JSON.parse(readFileSync(path, 'utf8')) as ScenariosJson).scenarios ?? []) out.set(sc.id, sc);
  if (existsSync(dir)) for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { scenario?: Scenario };
    if (j.scenario && !out.has(j.scenario.id)) out.set(j.scenario.id, j.scenario);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (k: string, d: string) => args.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
  const dir = opt('dir', 'streets-scripts');
  const thDir = opt('tablet', 'scenario-scripts');
  const all = loadScenarios(opt('scenarios', 'atlas/public/data/scenarios.json'), opt('sheets', 'build/scenarios'));
  const target = args.find((x) => !x.startsWith('--')) ?? (args.includes('--all') ? null : '');
  if (target === '') { console.error('usage: node engine/src/debug/streets-validate.ts <id>|--all [--scenarios=…] [--dir=streets-scripts]'); process.exit(2); }
  if (!all.size) { console.error('no scenarios: run npm run build:data (atlas/public/data/scenarios.json) or node engine/src/cli/scenario-sheets.ts'); process.exit(2); }
  const ids = target ? [target.replace(/\.json$/, '').replace(/^.*\//, '')] : existsSync(dir) ? readdirSync(dir).filter((x) => /^sc-\d+\.json$/.test(x)).map((x) => x.slice(0, -5)) : [];
  let failed = 0;
  for (const id of ids) {
    const file = join(dir, `${id}.json`);
    const sc = all.get(id);
    let rep: Report;
    if (!sc) rep = { errors: [`${id} is not a scenario of this build`], warnings: [] };
    else if (!existsSync(file)) rep = { errors: [`no script at ${file}`], warnings: [] };
    else {
      const thFile = join(thDir, `${id}.json`);
      try {
        rep = validateStreetsScript(JSON.parse(readFileSync(file, 'utf8')), sc, existsSync(thFile) ? JSON.parse(readFileSync(thFile, 'utf8')) : null);
      } catch (e) { rep = { errors: [`${file}: ${(e as Error).message}`], warnings: [] }; }
    }
    if (rep.errors.length) failed++;
    console.log(`${rep.errors.length ? '✖' : '✔'} ${id}${sc ? ` (${sc.city.name}, AY ${sc.year})` : ''}: ${rep.errors.length} errors, ${rep.warnings.length} warnings`);
    for (const m of rep.errors) console.log(`  error: ${m}`);
    for (const m of rep.warnings) console.log(`  warning: ${m}`);
  }
  if (!target) console.log(`${ids.length} streets scripts checked, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
