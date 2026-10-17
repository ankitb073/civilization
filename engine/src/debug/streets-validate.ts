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
//   node engine/src/debug/streets-validate.ts <id>|--all [--scenarios=atlas/public/data/scenarios.json] [--dir=streets-scripts]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Scenario, ScenariosJson } from '../export/contract.ts';
import { resolve, type Report } from './scenario-validate.ts';
import { normalizeScript } from '../../../atlas/src/game/tablet/script.ts';
import type { Scenario as TabletScenario } from '../../../atlas/src/game/tablet/types.ts';
import { PLACE_KEYS, placeName, type PlaceKey } from '../../../atlas/src/game/streets/errand/script.ts';
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
  const prose = (where: string, x: unknown, when: When, min = 1, max = Infinity): string => {
    if (typeof x !== 'string' || !x.trim()) { err(`${where}: missing text`); return ''; }
    for (const m of x.matchAll(PH)) {
      const path = m[1];
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
  for (const k of Object.keys(S)) if (!['scenario', 'title', 'errands'].includes(k)) err(`unknown top-level key "${k}"`);
  const errands = Array.isArray(S.errands) ? S.errands : [];
  if (!errands.length) err('errands: none');
  const ids = new Set<string>();
  errands.forEach((e0, i) => {
    const w = `errands[${i}]`;
    if (!isObj(e0)) { err(`${w}: not an object`); return; }
    const E = e0;
    if (typeof E.id !== 'string' || !/^[a-z][a-z-]*$/.test(E.id)) err(`${w}.id must be a short lowercase word`);
    else if (ids.has(E.id)) err(`${w}.id "${E.id}" twice`); else ids.add(E.id);
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
  return { errors, warnings };
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
