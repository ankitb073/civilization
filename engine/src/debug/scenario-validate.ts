// The Tablet House script validator: checks scenario-scripts/<id>.json against the script rules of
// docs/lld/tablet-house.md ("Script format"): the five days and what each must carry, every {placeholder} resolving
// against the scenario (or one the game fills at play time, where it is allowed), no digits in prose outside
// placeholders, choice effects whole numbers within bounds, endings by meter thresholds with a fallback, the
// archaeologist's paragraphs. Warnings (record names typed by hand, figures in words, a king for a queen) do not fail.
//   node engine/src/debug/scenario-validate.ts <id>|--all [--scenarios=atlas/public/data/scenarios.json] [--dir=scenario-scripts]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Scenario, ScenariosJson } from '../export/contract.ts';

export const BEATS = ['muster', 'field', 'walls', 'end', 'tablet'] as const;
export const SLOTS = ['muster', 'ours', 'theirs', 'field', 'end'] as const;
export const PICKS = ['true', 'rounded', 'boasted'] as const;
export const METERS = ['favour', 'conscience', 'household'] as const;
/** Slots each day must carry, and whether it must offer a choice card. */
const REQUIRED: Record<number, { slots: string[]; choice: boolean }> = {
  1: { slots: ['muster'], choice: false },
  2: { slots: ['ours', 'theirs', 'field'], choice: false },
  3: { slots: [], choice: true },
  4: { slots: ['end'], choice: true },
  5: { slots: [], choice: true },
};
const NUMERIC = new Set(['muster', 'ours', 'theirs']);
export const EFFECT_MAX = 3;      // a choice moves a meter by at most this much
export const THRESHOLD_MAX = 20;  // endings' meter bounds lie within ±this (meters start at 0)
/** Placeholders the game fills at play time, and where a script may use them. */
const RUNTIME: Record<string, 'line' | 'end' | 'any'> = {
  value: 'line',                                   // the figure the player picked, in a tablet slot's line
  'tablet.muster': 'end', 'tablet.ours': 'end', 'tablet.theirs': 'end', // the figures the player pressed
  'find.year': 'end', 'find.condition': 'end',     // the archaeologist's find
  'scribe.name': 'any',                            // the player, from the script's own scribe.name
};

type Where = 'prose' | 'line' | 'end';
export interface Report { errors: string[]; warnings: string[] }

const PH = /\{([A-Za-z][\w.]*)\}/g;
/** Placeholders that hold a year of the record. */
const YEAR_PATH = /^(year|city\.founded|state\.ruler\.(since|died)|battle\.year|treaty\.year|chronicle\.year|war\.(start|end))$/;
const words = (x: string) => x.replace(PH, 'X').split(/\s+/).filter(Boolean).length;

/** The value a {path} names in the scenario, or undefined. */
export function resolve(sc: Scenario, path: string): string | number | boolean | undefined {
  let v: unknown = sc;
  for (const k of path.split('.')) {
    if (v === null || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : undefined;
}

/** Check one script against its scenario. */
export function validateScript(script: unknown, sc: Scenario): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (m: string) => errors.push(m);
  const warn = (m: string) => warnings.push(m);
  const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  if (!isObj(script)) return { errors: ['the script is not a JSON object'], warnings };
  const S = script;
  const used = new Set<string>();
  // record names a writer should take from placeholders rather than type
  const names = new Map<string, string>();
  const nameAt = (path: string) => { const v = resolve(sc, path); if (typeof v === 'string' && v.replace(/[^\p{L}]/gu, '').length >= 4) names.set(v, path); };
  for (const p of ['city.name', 'state.name', 'enemy.name', 'state.ruler.name', 'enemy.ruler.name', 'battle.commander.name', 'battle.place', 'state.faith', 'state.coin', 'city.people', 'city.region', 'treaty.signedAt']) nameAt(p);
  sc.state.gods.forEach((_, i) => nameAt(`state.gods.${i}.name`));
  /** Check one string of prose: placeholders resolve, no digits outside them, no stray braces. */
  const prose = (where: string, x: unknown, kind: Where = 'prose', min = 0, max = Infinity): string => {
    if (typeof x !== 'string' || !x.trim()) { err(`${where}: missing text`); return ''; }
    for (const m of x.matchAll(PH)) {
      const path = m[1];
      used.add(path);
      const rt = RUNTIME[path];
      if (rt) {
        if (rt !== 'any' && rt !== kind) err(`${where}: {${path}} is filled at play time only in ${rt === 'line' ? 'tablet lines' : 'endings and the archaeologist'}`);
        continue;
      }
      const v = resolve(sc, path);
      if (v === undefined) err(`${where}: {${path}} does not resolve against ${sc.id}${/^(chronicle|treaty)\./.test(path) && !sc[path.split('.')[0] as 'chronicle' | 'treaty'] ? ` (it has no ${path.split('.')[0]})` : ''}`);
    }
    const bare = x.replace(PH, '');
    if (/[{}]/.test(bare)) err(`${where}: a brace outside a valid {placeholder}`);
    if (/\d/.test(bare)) err(`${where}: digits outside placeholders ("${bare.match(/[^\s]*\d[^\s]*/)![0]}"): figures come from the record`);
    if (/\b(hundred|thousand|million|myriad)s?\b/i.test(bare)) warn(`${where}: a figure in words? ("${bare.match(/\b(hundred|thousand|million|myriad)s?\b/i)![0]}"): use a placeholder`);
    for (const [nm, path] of names) if (new RegExp(`(^|[^\\p{L}])${nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(bare)) warn(`${where}: "${nm}" typed by hand: use {${path}}`);
    // a year from the record reads as the archive dates it: "AY 1730", never a bare "in 1730"
    for (const m of x.matchAll(PH)) if (YEAR_PATH.test(m[1]) && !/AY $/.test(x.slice(Math.max(0, m.index! - 3), m.index))) warn(`${where}: {${m[1]}} is a year: write "AY {${m[1]}}"`);
    const female = sc.state.ruler.sex === 'f';
    if (female && /\b(our|the) king\b/i.test(bare) && !/king/.test(sc.state.ruler.title)) warn(`${where}: "king", but ${sc.state.ruler.name} is a woman (${sc.state.ruler.title})`);
    if (!female && /\b(our|the) queen\b/i.test(bare)) warn(`${where}: "queen", but ${sc.state.ruler.name} is a man (${sc.state.ruler.title})`);
    const n = words(x);
    if (n < min || n > max) err(`${where}: ${n} words (${min}–${max === Infinity ? '…' : max})`);
    return x;
  };
  const effects = (where: string, x: unknown) => {
    if (!isObj(x)) { err(`${where}: effects must be an object {favour, conscience, household}`); return; }
    let moved = false, bad = false;
    for (const [k, v] of Object.entries(x)) {
      if (!(METERS as readonly string[]).includes(k)) { err(`${where}: unknown meter "${k}" (${METERS.join(', ')})`); bad = true; continue; }
      if (typeof v !== 'number' || !Number.isInteger(v) || Math.abs(v) > EFFECT_MAX) { err(`${where}: ${k} must be a whole number from -${EFFECT_MAX} to ${EFFECT_MAX} (got ${JSON.stringify(v)})`); bad = true; }
      else if (v !== 0) moved = true;
    }
    if (!moved && !bad) err(`${where}: the choice moves no meter`);
  };
  const flags = new Set<string>();
  // ---------------------------------------------------------------- head
  if (S.scenario !== sc.id) err(`scenario: "${String(S.scenario)}" is not ${sc.id}`);
  prose('title', S.title, 'prose', 1, 12);
  if (!isObj(S.scribe)) err('scribe: missing { name, sex }');
  else {
    const sex = S.scribe.sex;
    if (sex !== 'f' && sex !== 'm') err('scribe.sex must be "f" or "m"');
    const m = typeof S.scribe.name === 'string' ? S.scribe.name.match(/^\{names\.(f|m)\.(\d+)\}$/) : null;
    if (!m) err('scribe.name must be one name from the scenario\'s list, as a placeholder: "{names.f.0}"');
    else if (m[1] !== sex) err(`scribe.name ${S.scribe.name} is a ${m[1] === 'f' ? 'woman' : 'man'}'s name, but scribe.sex is "${String(sex)}"`);
    else if (resolve(sc, `names.${m[1]}.${m[2]}`) === undefined) err(`scribe.name ${S.scribe.name} does not resolve (${sc.names[m[1] as 'f' | 'm'].length} names)`);
  }
  // ---------------------------------------------------------------- the five days
  const days = Array.isArray(S.days) ? S.days : [];
  if (days.length !== 5) err(`days: ${days.length} days, need 5`);
  days.forEach((d0, i) => {
    const w = `day ${i + 1}`;
    if (!isObj(d0)) { err(`${w}: not an object`); return; }
    if (d0.day !== i + 1) err(`${w}: "day" is ${JSON.stringify(d0.day)}, expected ${i + 1}`);
    if (d0.beat !== BEATS[i]) err(`${w}: "beat" is ${JSON.stringify(d0.beat)}, expected "${BEATS[i]}"`);
    const scene = Array.isArray(d0.scene) ? d0.scene : [];
    if (scene.length < 1 || scene.length > 3) err(`${w}.scene: ${scene.length} paragraphs (1–3)`);
    scene.forEach((p, k) => prose(`${w}.scene[${k}]`, p, 'prose', 40, 120));
    const king = Array.isArray(d0.king) ? d0.king : [];
    if (king.length < 1 || king.length > 4) err(`${w}.king: ${king.length} lines (1–4)`);
    king.forEach((p, k) => prose(`${w}.king[${k}]`, p, 'prose', 1, 40));
    const need = REQUIRED[i + 1];
    const tablet = d0.tablet === undefined ? [] : Array.isArray(d0.tablet) ? d0.tablet : (err(`${w}.tablet must be a list of slots`), []);
    const slots = new Set<string>();
    tablet.forEach((t0, k) => {
      const tw = `${w}.tablet[${k}]`;
      if (!isObj(t0)) { err(`${tw}: not an object`); return; }
      const slot = String(t0.slot);
      if (!(SLOTS as readonly string[]).includes(slot)) err(`${tw}: unknown slot "${slot}" (${SLOTS.join(', ')})`);
      if (slots.has(slot)) err(`${tw}: slot "${slot}" twice`);
      slots.add(slot);
      prose(`${tw}.prompt`, t0.prompt, 'prose', 1, 40);
      const opts = Array.isArray(t0.options) ? t0.options : [];
      const picks = opts.map((o) => (isObj(o) ? String(o.pick) : ''));
      if (opts.length !== 3 || PICKS.some((p) => !picks.includes(p))) err(`${tw}.options: need exactly three, picks ${PICKS.join(', ')} (got ${JSON.stringify(picks)})`);
      opts.forEach((o, j) => {
        const ow = `${tw}.options[${j}]`;
        if (!isObj(o)) { err(`${ow}: not an object`); return; }
        prose(`${ow}.label`, o.label, 'prose', 1, 12);
        const line = prose(`${ow}.line`, o.line, 'line', 1, 40);
        const n = (line.match(/\{value\}/g) ?? []).length;
        if (NUMERIC.has(slot) && n !== 1) err(`${ow}.line: a "${slot}" line presses the figure exactly once as {value} (found ${n})`);
        if (!NUMERIC.has(slot) && n) err(`${ow}.line: a "${slot}" line has no {value}; write the words themselves`);
        effects(`${ow}.effects`, o.effects);
      });
    });
    for (const s0 of need.slots) if (!slots.has(s0)) err(`${w}: missing tablet slot "${s0}"`);
    for (const s0 of slots) if (!need.slots.includes(s0)) err(`${w}: slot "${s0}" belongs to another day`);
    if (d0.choice === undefined) { if (need.choice) err(`${w}: missing the choice card`); return; }
    const c = d0.choice;
    if (!isObj(c)) { err(`${w}.choice: not an object`); return; }
    prose(`${w}.choice.prompt`, c.prompt, 'prose', 1, 40);
    const opts = Array.isArray(c.options) ? c.options : [];
    if (opts.length < 2 || opts.length > 3) err(`${w}.choice.options: ${opts.length} options (2–3)`);
    opts.forEach((o, j) => {
      const ow = `${w}.choice.options[${j}]`;
      if (!isObj(o)) { err(`${ow}: not an object`); return; }
      prose(`${ow}.label`, o.label, 'prose', 1, 12);
      prose(`${ow}.consequence`, o.consequence, 'prose', 10, 80);
      effects(`${ow}.effects`, o.effects);
      if (o.flag !== undefined) { if (typeof o.flag !== 'string' || !/^[a-z][a-z-]*$/.test(o.flag)) err(`${ow}.flag must be a short lowercase word`); else flags.add(o.flag); }
    });
  });
  // ---------------------------------------------------------------- endings
  const endings = Array.isArray(S.endings) ? S.endings : [];
  if (endings.length < 3) err(`endings: ${endings.length} (at least 3)`);
  const ids = new Set<string>();
  endings.forEach((e0, k) => {
    const w = `endings[${k}]`;
    if (!isObj(e0)) { err(`${w}: not an object`); return; }
    if (typeof e0.id !== 'string' || !/^[a-z][a-z-]*$/.test(e0.id)) err(`${w}.id must be a short lowercase word`);
    else if (ids.has(e0.id)) err(`${w}.id "${e0.id}" twice`);
    else ids.add(e0.id);
    prose(`${w}.title`, e0.title, 'prose', 1, 12);
    prose(`${w}.text`, e0.text, 'end', 30, 150);
    const when = e0.when;
    if (!isObj(when)) { err(`${w}.when must be an object (empty for the fallback)`); return; }
    for (const [k2, v] of Object.entries(when)) {
      if (k2 === 'flag') { if (typeof v !== 'string' || !flags.has(v)) err(`${w}.when.flag "${String(v)}" is set by no choice`); continue; }
      if (!(METERS as readonly string[]).includes(k2)) { err(`${w}.when: unknown meter "${k2}"`); continue; }
      const ok = Array.isArray(v) && v.length === 2 && v.every((x) => Number.isInteger(x) && Math.abs(x) <= THRESHOLD_MAX) && v[0] <= v[1];
      if (!ok) err(`${w}.when.${k2} must be [min, max], whole numbers from -${THRESHOLD_MAX} to ${THRESHOLD_MAX}, min ≤ max (got ${JSON.stringify(v)})`);
    }
    if (k === endings.length - 1 && Object.keys(when).length) err(`${w}: the last ending is the fallback and must have an empty "when"`);
    if (k < endings.length - 1 && !Object.keys(when).length) err(`${w}: an ending with an empty "when" hides every ending after it`);
  });
  // ---------------------------------------------------------------- the archaeologist
  const arch = S.archaeologist;
  if (!isObj(arch)) err('archaeologist: missing { true, rounded, boasted }');
  else {
    for (const p of PICKS) prose(`archaeologist.${p}`, arch[p], 'end', 40, 140);
    for (const k of Object.keys(arch)) if (!(PICKS as readonly string[]).includes(k) && k !== 'flags') err(`archaeologist: unknown key "${k}"`);
    if (arch.flags !== undefined) {
      if (!isObj(arch.flags)) err('archaeologist.flags must map a flag to a paragraph');
      else for (const [f, x] of Object.entries(arch.flags)) { if (!flags.has(f)) err(`archaeologist.flags.${f}: set by no choice`); prose(`archaeologist.flags.${f}`, x, 'end', 40, 140); }
    }
  }
  // ---------------------------------------------------------------- the record, told
  if ((sc.outcome === 'treaty' || sc.outcome === 'conquered') && ![...used].some((p) => p.startsWith('treaty.'))) err(`the ending is "${sc.outcome}" but the script names nothing of the treaty ({treaty.…})`);
  if (sc.chronicle && ![...used].some((p) => p.startsWith('chronicle.'))) warn('the defender\'s real chronicle survives but the script never quotes it ({chronicle.quote}, {chronicle.outcomeWords})');
  for (const p of ['battle.oursLost', 'battle.theirsLost']) if (!used.has(p)) warn(`the script never sets the record's {${p}} beside the tablet`);
  for (const k of Object.keys(S)) if (!['scenario', 'title', 'scribe', 'days', 'endings', 'archaeologist'].includes(k)) err(`unknown top-level key "${k}"`);
  return { errors, warnings };
}

/** Load the scenarios: scenarios.json, or a writer's fact sheet. */
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
  const dir = opt('dir', 'scenario-scripts');
  const all = loadScenarios(opt('scenarios', 'atlas/public/data/scenarios.json'), opt('sheets', 'build/scenarios'));
  const target = args.find((x) => !x.startsWith('--')) ?? (args.includes('--all') ? null : '');
  if (target === '') { console.error('usage: node engine/src/debug/scenario-validate.ts <id>|--all [--scenarios=…] [--dir=scenario-scripts]'); process.exit(2); }
  if (!all.size) { console.error('no scenarios: run npm run build:data (atlas/public/data/scenarios.json) or node engine/src/cli/scenario-sheets.ts'); process.exit(2); }
  const ids = target ? [target.replace(/\.json$/, '').replace(/^.*\//, '')] : existsSync(dir) ? readdirSync(dir).filter((x) => /^sc-\d+\.json$/.test(x)).map((x) => x.slice(0, -5)) : [];
  let failed = 0;
  for (const id of ids) {
    const file = join(dir, `${id}.json`);
    const sc = all.get(id);
    let rep: Report;
    if (!sc) rep = { errors: [`${id} is not a scenario of this build (${all.size} scenarios)`], warnings: [] };
    else if (!existsSync(file)) rep = { errors: [`no script at ${file}`], warnings: [] };
    else {
      let script: unknown;
      try { script = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { script = (e as Error).message; }
      rep = typeof script === 'string' ? { errors: [`${file}: not valid JSON (${script})`], warnings: [] } : validateScript(script, sc);
    }
    if (rep.errors.length) failed++;
    console.log(`${rep.errors.length ? '✖' : '✔'} ${id}${sc ? ` (${sc.city.name}, AY ${sc.year}, ${sc.outcome})` : ''}: ${rep.errors.length} errors, ${rep.warnings.length} warnings`);
    for (const m of rep.errors) console.log(`  error: ${m}`);
    for (const m of rep.warnings) console.log(`  warning: ${m}`);
  }
  if (!target) {
    const missing = [...all.keys()].filter((id) => !ids.includes(id));
    console.log(`${ids.length} scripts checked, ${failed} failed; ${missing.length} scenarios still without a script${missing.length ? `: ${missing.join(', ')}` : ''}`);
  }
  process.exit(failed ? 1 : 0);
}
