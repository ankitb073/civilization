// The Tablet House: every scenario in atlas/public/data/scenarios.json is recounted here, independently, from the
// database it was built with (build/world.sqlite, after `npm run build:data`): the siege and the battle before it, the
// city, the ruler and the commander at the date with their sex and age, the gods, the coin and the price of grain, the
// hardships of the year, the treaty and its surviving text, the defender's chronicle and its verbatim words, the names.
// Period names are realized again from the database's own language engine. A short history then checks that the
// export is deterministic and well formed. Without a full build the database checks are skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LanguageEngine } from '../src/lang/index.ts';
import { deBug } from '../src/archive/context.ts';
import { shardOf, shardFile } from '../src/export/contract.ts';
import type { Scenario, ScenariosJson, MetaJson, PageJson } from '../src/export/contract.ts';
import { simulate } from '../src/sim/run.ts';
import { buildArchive } from '../src/archive/build.ts';
import { computeEras } from '../src/export/export.ts';
import { Heraldry } from '../src/export/deck.ts';
import { scenariosJson } from '../src/export/scenarios.ts';
import { validateScript } from '../src/debug/scenario-validate.ts';
import { readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url).pathname;
// an isolated build can be checked with SCENARIOS_DATA=<out dir> SCENARIOS_DB=<db>
const DATA = process.env.SCENARIOS_DATA ?? join(root, 'atlas/public/data');
const DBP = process.env.SCENARIOS_DB ?? join(root, 'build/world.sqlite');

type Row = Record<string, unknown>;
let skip: string | false = false;
let scenarios: Scenario[] = [];
let db: DatabaseSync | null = null;
if (!existsSync(DBP) || !existsSync(join(DATA, 'scenarios.json')) || !existsSync(join(DATA, 'meta.json'))) skip = 'no full build: run npm run build:data';
else {
  db = new DatabaseSync(DBP, { readOnly: true });
  const meta = JSON.parse(readFileSync(join(DATA, 'meta.json'), 'utf8')) as MetaJson;
  const arch = JSON.parse(String((db.prepare(`SELECT value FROM meta WHERE key = 'archive'`).get() as Row | undefined)?.value ?? '{}')) as { artifacts?: number; links?: number };
  if (arch.artifacts !== meta.counts.documents || arch.links !== meta.counts.links) skip = 'atlas data and build/world.sqlite come from different builds';
  else scenarios = (JSON.parse(readFileSync(join(DATA, 'scenarios.json'), 'utf8')) as ScenariosJson).scenarios;
}

// ---------------------------------------------------------------- the record, read back from SQL
const q = (sql: string, ...args: (number | string)[]): Row[] => db!.prepare(sql).all(...args) as Row[];
const one = (sql: string, ...args: (number | string)[]): Row | undefined => db!.prepare(sql).get(...args) as Row | undefined;
const N = (v: unknown) => Number(v);
const id = (ref: string) => Number(ref.slice(ref.indexOf(':') + 1));
const event = (n: number) => { const r = one('SELECT * FROM events WHERE id = ?', n)!; return { id: N(r.id), sub: String(r.sub), year: N(r.year), end: N(r.end_year), cell: N(r.cell), data: JSON.parse(String(r.data)) as Record<string, unknown> }; };
const parts = (n: number) => q('SELECT ref, role FROM event_parts WHERE event = ?', n).map((r) => [String(r.ref), String(r.role)] as [string, string]);
const partOf = (n: number, role: string) => parts(n).find(([, r]) => r === role)?.[0];
const person = (n: number) => one('SELECT * FROM persons WHERE id = ?', n)!;
const polity = (n: number) => one('SELECT * FROM polities WHERE id = ?', n)!;
const plain = (x: string) => x.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1').replace(/ \[AY -?\d+\]/g, '');
const fmt = (n: number) => n.toLocaleString('en-US');
const r2 = (x: number, k: number) => Math.round(x * 10 ** k) / 10 ** k;

/** Heads of state of a polity, in order of accession (as the archive counts reigns). */
function reigns(pol: number) {
  const P = polity(pol);
  return q(`SELECT person, role, start, end_year FROM roles WHERE polity = ? AND role IN ('ruler', 'president', 'chairman')`, pol)
    .map((r) => { const p = person(N(r.person)); return { person: N(r.person), start: N(r.start), end: r.end_year === null ? Math.min(N(p.died), P.died === null ? 5000 : N(P.died), 5000) : N(r.end_year) }; })
    .sort((x, y) => x.start - y.start || x.end - y.end);
}
const rulerAt = (pol: number, year: number) => { let best: ReturnType<typeof reigns>[number] | null = null; for (const r of reigns(pol)) if (r.start <= year && r.end >= year) best = r; return best; };
/** The decadal survey row in force at a year (the last at or before it). */
function surveyAt(pol: number, year: number): Row {
  const rows = q('SELECT * FROM polity_years WHERE polity = ? ORDER BY year', pol);
  let best = rows[0];
  for (const r of rows) if (N(r.year) <= year) best = r;
  return best;
}
function coinAt(pol: number, year: number): number {
  const rows = q('SELECT year, currency FROM polity_years WHERE polity = ? AND year <= ? ORDER BY year DESC', pol, year);
  for (const r of rows) { const c = N(r.currency); if (c < 0 || N(one('SELECT born FROM currencies WHERE id = ?', c)!.born) <= year) return c; }
  return -1;
}
function silverAt(cur: number, year: number): number {
  const h = JSON.parse(String(one('SELECT history FROM currencies WHERE id = ?', cur)!.history)) as [number, number][];
  let v = h[0][1];
  for (const [y, x] of h) if (y <= year) v = x;
  return v;
}
let grain: number | null = null;
const GRAIN = () => (grain ??= N(one(`SELECT id FROM goods WHERE key = 'grain'`)?.id ?? 0));
const priceExact = (t: number, y: number) => { const r = one('SELECT price FROM prices WHERE settlement = ? AND good = ? AND year = ?', t, GRAIN(), y); return r ? N(r.price) : null; };
function priceNear(t: number, year: number): number | null {
  for (let y = Math.floor(year / 10) * 10; y >= year - 60; y -= 10) { const p = priceExact(t, y); if (p !== null) return p; }
  return null;
}

// ---------------------------------------------------------------- names, realized again from the database's language engine
let L: LanguageEngine | null = null;
const engine = () => (L ??= LanguageEngine.fromJSON(JSON.parse(String(one(`SELECT value FROM meta WHERE key = 'lang_engine'`)!.value))));
const letters = (v: string) => v.replace(/[^\p{L}]/gu, '').length;
function realize(nameId: number, lang: number, year: number): string {
  const E = engine();
  let v = E.realize(nameId, lang, year).conventional;
  if (letters(v) < 3) { const o = E.nameOrigin(nameId); const full = E.realize(nameId, o.lang, o.year).conventional; if (letters(full) > letters(v)) v = full; }
  return deBug(v);
}
/** A name as written in a language at a date (the archive memoizes names per quarter-century, so any year of it). */
function written(nameId: number, lang: number, year: number, name: string): boolean {
  if (realize(nameId, lang, year) === name) return true;
  const k = Math.round(year / 25);
  for (let y = 25 * k - 12; y <= 25 * k + 12; y++) if (realize(nameId, lang, y) === name) return true;
  return false;
}
const nameIdOf = (table: string, n: number) => N(one(`SELECT name_id FROM ${table} WHERE id = ?`, n)!.name_id);
const langOf = (culture: number) => N(one('SELECT lang FROM cultures WHERE id = ?', culture)!.lang);
function cultureAt(cell: number, year: number): number {
  const r = one('SELECT culture FROM culture_log WHERE cell = ? AND year <= ? ORDER BY seq DESC LIMIT 1', cell, year);
  return r ? N(r.culture) : N(one('SELECT culture FROM initial_state WHERE cell = ?', cell)!.culture);
}

/** Every fact of one scenario, recounted; returns what disagrees. */
function recount(sc: Scenario): string[] {
  const bad: string[] = [];
  const eq = (what: string, got: unknown, want: unknown) => { if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${sc.id} ${what}: ${JSON.stringify(got)} ≠ record ${JSON.stringify(want)}`); };
  const ok = (what: string, cond: boolean) => { if (!cond) bad.push(`${sc.id} ${what}`); };
  const Y = sc.year;
  // the siege or sack
  const e = event(sc.event);
  eq('id', sc.id, `sc-${e.id}`);
  ok(`is a siege or sack (${e.sub})`, e.sub === 'siege' || e.sub === 'sack');
  eq('sub', sc.sub, e.sub);
  eq('year', Y, e.year);
  eq('burnedArchives', sc.burnedArchives, !!e.data.burnedArchives);
  eq('city', sc.city.id, partOf(e.id, 'settlement'));
  eq('state (besieged)', sc.state.id, partOf(e.id, 'besieged'));
  eq('enemy (besieger)', sc.enemy.id, partOf(e.id, 'besieger'));
  const D = id(sc.state.id), A = id(sc.enemy.id), city = id(sc.city.id);
  // the war: ours is its defender
  const war = event(N(e.data.war));
  eq('war', sc.war.id, `evt:${war.id}`);
  eq('war defender', partOf(war.id, 'defender'), sc.state.id);
  eq('war attacker', partOf(war.id, 'attacker'), sc.enemy.id);
  eq('war span', [sc.war.start, sc.war.end], [war.year, war.end]);
  eq('war goal', sc.war.goal, String(war.data.goal ?? ''));
  const battles = q(`SELECT id FROM events WHERE sub = 'battle' AND json_extract(data, '$.war') = ?`, war.id).map((r) => event(N(r.id)));
  eq('war battles', sc.war.battles, battles.length);
  eq('war battles won', sc.war.won, battles.filter((b) => b.data.winner === D).length);
  eq('war losses', [sc.war.oursLost, sc.war.theirsLost], [battles.reduce((m, b) => m + N(b.data.defenderLosses), 0), battles.reduce((m, b) => m + N(b.data.attackerLosses), 0)]);
  if (war.data.lossesD !== undefined) eq('war losses (the war’s own totals)', [sc.war.oursLost, sc.war.theirsLost], [N(war.data.lossesD), N(war.data.lossesA)]);
  const wo = String(war.data.outcome ?? 'dissolved');
  eq('war outcome', sc.war.outcome, wo === 'attacker' ? 'lost' : wo === 'defender' ? 'won' : wo === 'stalemate' ? 'stalemate' : 'dissolved');
  // the battle that brought the enemy to the walls
  const b = event(id(sc.battle.id));
  ok('battle caused the siege', q('SELECT cause FROM event_causes WHERE event = ?', e.id).some((r) => N(r.cause) === b.id));
  ok('battle of the same war, shortly before', b.sub === 'battle' && b.data.war === war.id && b.year <= Y && b.year >= Y - 1);
  eq('battle year', sc.battle.year, b.year);
  eq('battle sides', [partOf(b.id, 'defender'), partOf(b.id, 'attacker')], [sc.state.id, sc.enemy.id]);
  eq('battle sizes', [sc.battle.ours, sc.battle.theirs], [N(b.data.defenderSize), N(b.data.attackerSize)]);
  eq('battle losses', [sc.battle.oursLost, sc.battle.theirsLost], [N(b.data.defenderLosses), N(b.data.attackerLosses)]);
  eq('battle won', sc.battle.won, b.data.winner === D);
  eq('battle place', sc.battle.placeId, partOf(b.id, 'near') ?? `reg:${b.data.region}`);
  eq('battle decisive', sc.battle.decisive, N(b.data.decisive ?? 0));
  const cmd = person(id(sc.battle.commander.id));
  eq('commander', sc.battle.commander.id, partOf(b.id, 'defending commander'));
  eq('commander sex', sc.battle.commander.sex, cmd.sex);
  eq('commander age', sc.battle.commander.age, b.year - N(cmd.born));
  eq('commander killed', sc.battle.commander.killed, b.data.commanderKilled === N(cmd.id));
  eq('commander is the sovereign', sc.battle.commander.isKing, rulerAt(D, b.year)?.person === N(cmd.id));
  if (sc.battle.enemyCommander) {
    eq('enemy commander', sc.battle.enemyCommander.id, partOf(b.id, 'attacking commander'));
    eq('enemy commander sex', sc.battle.enemyCommander.sex, person(id(sc.battle.enemyCommander.id)).sex);
  }
  // the city
  const t = one('SELECT * FROM settlements WHERE id = ?', city)!;
  eq('city cell', sc.city.cell, N(t.cell));
  eq('city port', sc.city.port, N(t.port) === 1);
  eq('city founded', sc.city.founded, N(t.founded));
  const pops = q('SELECT year, pop FROM settlement_pop WHERE settlement = ? ORDER BY year', city);
  eq('city population (last census at or before)', sc.city.pop, Math.round(N((pops.filter((r) => N(r.year) <= Y).pop() ?? pops[0]).pop)));
  eq('earlier sacks', sc.city.sacked, (JSON.parse(String(t.sacks)) as number[]).filter((x) => event(x).year < Y).length);
  const caps = JSON.parse(String(polity(D).capitals)) as [number, number][];
  eq('the city is the capital', caps.reduce((c, [y, v]) => (y <= Y ? v : c), caps[0][1]), city);
  // the sovereign in the palace, and the enemy's
  const reign = rulerAt(D, Y)!;
  eq('ruler', sc.state.ruler.id, `per:${reign?.person}`);
  const king = person(reign.person);
  eq('ruler sex', sc.state.ruler.sex, king.sex);
  eq('ruler age', sc.state.ruler.age, Y - N(king.born));
  eq('ruler since', sc.state.ruler.since, reign.start);
  eq('ruler death', [sc.state.ruler.died, sc.state.ruler.deathCause], [N(king.died), king.death_cause]);
  ok('ruler alive at the siege, not killed in the battle', N(king.born) <= Y && N(king.died) >= Y && N(king.death_event ?? -1) !== b.id);
  const enemyReign = rulerAt(A, Y)!;
  eq('enemy ruler', sc.enemy.ruler.id, `per:${enemyReign?.person}`);
  eq('enemy ruler sex', sc.enemy.ruler.sex, person(enemyReign.person).sex);
  eq('enemy ruler age', sc.enemy.ruler.age, Y - N(person(enemyReign.person).born));
  // faith and gods, coin and grain, medium and script
  const sv = surveyAt(D, Y);
  eq('government', sc.state.gov, String(sv.gov));
  const rel = N(sv.religion);
  const stateFaith = rel >= 0 && N(one('SELECT born FROM movements WHERE id = ?', rel)!.born) <= Y ? rel : -1;
  if (stateFaith >= 0) eq('faith', sc.state.faithId, `mov:${stateFaith}`);
  else ok(`faith ${sc.state.faithId} is the pantheon of the state's people`, q('SELECT id FROM cultures WHERE pantheon = ? AND lang = ?', id(sc.state.faithId), sc.state.langId).length > 0);
  eq('faith kind', sc.state.faithKind, one('SELECT kind FROM movements WHERE id = ?', id(sc.state.faithId))!.kind);
  eq('gods', sc.state.gods.map((g) => g.id), q('SELECT id FROM deities WHERE movement = ? AND born <= ? ORDER BY id LIMIT 6', id(sc.state.faithId), Y).map((g) => `dei:${g.id}`));
  for (const g of sc.state.gods) { const r = one('SELECT * FROM deities WHERE id = ?', id(g.id))!; eq(`god ${g.id} sex and role`, [g.sex, g.role], [r.sex, r.domain]); }
  const cur = coinAt(D, Y);
  const coin = cur >= 0 && N(one('SELECT born FROM currencies WHERE id = ?', cur)!.born) <= Y ? cur : -1;
  eq('coin', sc.state.coinId, coin >= 0 ? `cur:${coin}` : null);
  if (coin >= 0) eq('coin silver', sc.state.coinSilver, r2(silverAt(coin, Y), 4));
  const grain = priceNear(city, Y);
  eq('grain price', sc.state.grain, grain === null ? null : r2(grain, 3));
  if (grain !== null && sc.state.coinSilver) eq('grain price in coin', sc.state.grainCoin, r2(grain / sc.state.coinSilver, 2));
  const era = N(sv.era);
  eq('era', sc.eraIndex, era);
  const techs = new Map(JSON.parse(String(polity(D).techs)) as [number, number][]);
  const paper = N(one(`SELECT id FROM techs WHERE key = 'paper'`)!.id);
  const hasPaper = techs.has(paper) && techs.get(paper)! <= Y;
  eq('medium', sc.medium, era >= 5 ? 'typescript' : era === 4 || hasPaper ? 'paper' : era === 3 ? 'parchment' : era === 2 ? 'papyrus' : 'clay tablet');
  // writing at the date: the script a people of the state's language had in use (the archive's chancery rule)
  const scriptFor = (c: number): number => {
    let x = N(one('SELECT script FROM cultures WHERE id = ?', c)!.script);
    while (x >= 0) { const r = one('SELECT born, parent FROM scripts WHERE id = ?', x)!; if (N(r.born) <= Y) break; x = r.parent === null ? -1 : N(r.parent); }
    if (x < 0) for (const r of q('SELECT id FROM scripts WHERE culture = ? AND born <= ? ORDER BY id', c, Y)) x = N(r.id);
    return x;
  };
  const scripts = q('SELECT id FROM cultures WHERE lang = ?', sc.state.langId).map((c) => scriptFor(N(c.id))).filter((x) => x >= 0).map((x) => one('SELECT * FROM scripts WHERE id = ?', x)!);
  ok(`the defender had writing: ${sc.script} (${sc.scriptKind})`, scripts.some((x) => x.kind === sc.scriptKind && written(N(x.name_id), sc.state.langId, Y, sc.script)));
  // the language the names are written in is the state's people's at the date: its people now, or one it left by
  // acculturation, or an ancestor of either (a people splits, and the state follows the daughter people)
  const peopleOf = new Set<number>([N(polity(D).culture)]);
  for (const r of q(`SELECT p2.ref FROM event_parts p1 JOIN events e ON e.id = p1.event AND e.sub = 'acculturation' JOIN event_parts p2 ON p2.event = e.id AND p2.role IN ('from', 'to') WHERE p1.ref = ? AND p1.role = 'polity'`, sc.state.id)) peopleOf.add(id(String(r.ref)));
  for (const c of [...peopleOf]) for (let x: unknown = one('SELECT parent FROM cultures WHERE id = ?', c)!.parent; x !== null; x = one('SELECT parent FROM cultures WHERE id = ?', N(x))!.parent) peopleOf.add(N(x));
  ok(`language ${sc.state.langId} is the state's people's`, [...peopleOf].some((c) => langOf(c) === sc.state.langId));
  // the end of the war
  const tid = war.data.treaty as number | undefined;
  const tEv = tid !== undefined && event(tid).year - Y <= 2 ? event(tid) : null;
  const terms = (tEv?.data.terms as { kind: string; from?: number; cells?: number[]; amount?: number; years?: number }[] | undefined) ?? [];
  const annexed = !!tEv && tEv.sub === 'conquest' && terms.some((x) => x.kind === 'annexation' && x.from === D);
  eq('outcome', sc.outcome, e.sub === 'sack' ? 'sacked' : annexed ? 'conquered' : tEv && tEv.sub === 'treaty' ? 'treaty' : 'held');
  if (sc.outcome === 'held' || !tEv) eq('no treaty', sc.treaty, null);
  else {
    const tr = sc.treaty!;
    eq('treaty', tr.id, `evt:${tEv.id}`);
    eq('treaty kind and year', [tr.kind, tr.year], [tEv.sub === 'treaty' ? 'treaty' : 'conquest', tEv.year]);
    eq('treaty terms', tr.terms, terms.map((x) => x.kind));
    eq('districts ceded', tr.ceded, terms.filter((x) => (x.kind === 'cede' || x.kind === 'annexation') && x.from === D).reduce((m, x) => m + (x.cells?.length ?? 0), 0));
    const trib = terms.find((x) => x.kind === 'tribute' && x.from === D), ind = terms.find((x) => x.kind === 'indemnity' && x.from === D);
    eq('tribute', [tr.tributeKg, tr.tributeYears], [trib?.amount ?? null, trib?.years ?? null]);
    ok('tribute wording', (tr.tribute === null) === !trib && (!trib || tr.tribute!.endsWith(`a year for ${trib.years} years`)));
    eq('indemnity', tr.indemnityKg, ind?.amount ?? null);
    eq('truce', tr.truce, terms.find((x) => x.kind === 'truce')?.years ?? null);
    const doc = one(`SELECT * FROM artifacts WHERE sub = 'treaty' AND json_extract(about, '$[0]') = ? ORDER BY id LIMIT 1`, tEv.id);
    eq('treaty document', [tr.catalog, tr.doc], doc ? [doc.catalog, `art:${doc.id}`] : [null, null]);
    eq('treaty text (verbatim)', tr.text, doc ? plain(String(doc.body).split('\n---\n')[0]).trim() : null);
    eq('treaty signed at', !!tr.signedAt, !!partOf(tEv.id, 'signed at'));
  }
  // hardship of the year
  const region = N(one('SELECT region FROM cells WHERE id = ?', sc.city.cell)!.region);
  const spans = (x: { year: number; end: number }) => x.year <= Y && Y <= Math.max(x.year, x.end);
  const famine = q(`SELECT id FROM events WHERE sub = 'famine' ORDER BY id`).map((r) => event(N(r.id))).find((x) => spans(x) && parts(x.id).some(([r, role]) => (role === 'region' && r === `reg:${region}`) || (role === 'stricken' && r === sc.state.id)));
  const plague = q(`SELECT id FROM events WHERE sub = 'plague' ORDER BY id`).map((r) => event(N(r.id))).find((x) => spans(x) && parts(x.id).some(([r, role]) => r === sc.city.id || (role === 'stricken' && r === sc.state.id)));
  const drought = q(`SELECT id, cells FROM anomalies WHERE kind = 'drought' AND start <= ? AND end_year >= ? ORDER BY id`, Y, Y).find((r) => (JSON.parse(String(r.cells)) as number[]).includes(sc.city.cell));
  eq('famine', [sc.hardship.famine, sc.hardship.famineId], [!!famine, famine ? `evt:${famine.id}` : null]);
  eq('plague', [sc.hardship.plague !== null, sc.hardship.plagueId], [!!plague, plague ? `evt:${plague.id}` : null]);
  eq('drought', [sc.hardship.drought, sc.hardship.droughtId], [!!drought, drought ? `cli:${drought.id}` : null]);
  const before = priceNear(city, Y - 10), after = priceExact(city, Math.floor(Y / 10) * 10 + 10);
  eq('grain before and after', [sc.hardship.grainBefore, sc.hardship.grainAfter], [before === null ? null : r2(before, 3), after === null ? null : r2(after, 3)]);
  // the defender's surviving chronicle of the war
  const chron = one(`SELECT * FROM artifacts WHERE sub = 'chronicle' AND flagship = 0 AND polity = ? AND json_extract(about, '$[0]') = ? ORDER BY id LIMIT 1`, D, war.id);
  if (!sc.chronicle) eq('no defender chronicle survives', chron?.catalog ?? null, null);
  else {
    const c = sc.chronicle;
    eq('chronicle', [c.id, c.catalog, c.year, c.title, c.medium, c.condition], chron ? [`art:${chron.id}`, chron.catalog, N(chron.year), chron.title, chron.medium, chron.condition] : null);
    if (chron) {
      eq('chronicle author', c.authorId, chron.author === null ? null : `per:${chron.author}`);
      if (chron.author !== null) ok(`chronicle author's name ${c.author}`, written(N(person(N(chron.author)).name_id), N(chron.lang), N(chron.year), c.author));
      const text = plain(String(chron.body).split('\n---\n')[0]);
      if (c.quote !== null) ok(`chronicle quote is verbatim: ${c.quote}`, text.includes(c.quote) && !c.quote.includes('[...]'));
      if (c.outcomeWords !== null) ok(`chronicle closing words are verbatim: ${c.outcomeWords}`, text.includes(c.outcomeWords));
      eq('chronicle tells the battle', c.tellsBattle, c.oursLost !== null);
      if (c.oursLost !== null && c.theirsLost !== null) {
        const para = String(chron.body).split('\n---\n')[0].split(/\n\s*\n/).find((p) => p.includes(`[AY ${b.year}]`) && p.includes(fmt(c.oursLost!)) && p.includes(fmt(c.theirsLost!)));
        ok(`chronicle gives ${c.oursLost} and ${c.theirsLost} for the battle of AY ${b.year}`, !!para);
      }
      // its claims for the whole war, as the war page's comparison table carries them
      const shard = join(DATA, shardFile(shardOf(sc.war.id)));
      if (existsSync(shard)) {
        const pg = (JSON.parse(readFileSync(shard, 'utf8')) as { pages: PageJson[] }).pages.find((p) => p.id === sc.war.id);
        const src = pg?.accounts?.sources.find((x) => x.artifactId === c.id);
        if (src) {
          const losses = src.claims.filter(([k]) => k.startsWith('Losses of ')).map(([, v]) => Number(v.replace(/[^\d.]/g, '')));
          eq('chronicle war claims', [c.warTheirsLost, c.warOursLost], [losses[0] ?? null, losses[1] ?? null]);
          eq('chronicle outcome claim', c.outcomeClaim, src.claims.find(([k]) => k === 'Outcome')?.[1] ?? null);
        }
      }
    }
  }
  // period names, as the defender's scribes wrote them at the date
  const lang = sc.state.langId;
  const names = JSON.parse(String(t.names)) as [number, number][];
  ok(`city name ${sc.city.name}`, written(names.reduce((n, [y, v]) => (y <= Y ? v : n), names[0][1]), lang, Y, sc.city.name));
  ok(`state name ${sc.state.name}`, written(nameIdOf('polities', D), lang, Y, sc.state.name));
  ok(`enemy name ${sc.enemy.name}`, written(nameIdOf('polities', A), lang, Y, sc.enemy.name));
  ok(`ruler name ${sc.state.ruler.name}`, written(nameIdOf('persons', id(sc.state.ruler.id)), lang, Y, sc.state.ruler.name));
  ok(`enemy ruler name ${sc.enemy.ruler.name}`, written(nameIdOf('persons', id(sc.enemy.ruler.id)), lang, Y, sc.enemy.ruler.name));
  ok(`commander name ${sc.battle.commander.name}`, written(nameIdOf('persons', id(sc.battle.commander.id)), lang, Y, sc.battle.commander.name));
  ok(`faith name ${sc.state.faith}`, written(nameIdOf('movements', id(sc.state.faithId)), lang, Y, sc.state.faith));
  for (const g of sc.state.gods) ok(`god name ${g.name}`, written(nameIdOf('deities', id(g.id)), lang, Y, g.name));
  if (sc.state.coinId) ok(`coin name ${sc.state.coin}`, written(nameIdOf('currencies', id(sc.state.coinId)), lang, Y, sc.state.coin!));
  ok(`region name ${sc.city.region}`, written(N(one('SELECT name_id FROM regions WHERE id = ?', region)!.name_id), lang, Y, sc.city.region));
  ok(`language name ${sc.state.language}`, written(N(one('SELECT endonym FROM languages WHERE id = ?', lang)!.endonym), lang, Y, sc.state.language));
  ok(`people name ${sc.city.people}`, written(nameIdOf('cultures', id(sc.city.peopleId)), lang, Y, sc.city.people));
  // names in use among the city's people: each belongs to someone of that people and sex, of the time
  const pl = langOf(id(sc.city.peopleId));
  for (const sex of ['f', 'm'] as const) {
    const list = sc.names[sex];
    ok(`at most ten distinct ${sex} names`, list.length <= 10 && new Set(list).size === list.length);
    const folk = q(`SELECT p.name_id FROM persons p JOIN names n ON n.id = p.name_id WHERE p.culture = ? AND p.sex = ? AND p.born <= ? AND p.born >= ? AND n.kind = ?`, id(sc.city.peopleId), sex, Y + 20, Y - 200, sex === 'f' ? 'person-f' : 'person-m');
    for (const nm of list) ok(`${sex} name ${nm} is in use`, folk.some((r) => realize(N(r.name_id), pl, Y) === nm) || folk.some((r) => written(N(r.name_id), pl, Y, nm)));
  }
  // the 3D framing looks at the city
  const cell = one('SELECT x, y FROM cells WHERE id = ?', sc.city.cell)!;
  const world = JSON.parse(String(one(`SELECT value FROM meta WHERE key = 'world'`)!.value)) as { width: number; height: number };
  eq('camera target', sc.camera?.target, [r2(N(cell.x) * 0.01 - world.width * 0.005, 3), 0, r2(N(cell.y) * 0.01 - world.height * 0.005, 3)]);
  return bad;
}

test('about thirty scenarios across the five millennia, with every kind of ending', { skip }, () => {
  assert.ok(scenarios.length >= 25 && scenarios.length <= 35, `${scenarios.length} scenarios`);
  assert.equal(new Set(scenarios.map((x) => x.id)).size, scenarios.length, 'ids are unique');
  assert.equal(new Set(scenarios.map((x) => x.city.id)).size, scenarios.length, 'no city twice');
  assert.equal(new Set(scenarios.map((x) => x.war.id)).size, scenarios.length, 'no war twice');
  for (const o of ['sacked', 'conquered', 'treaty', 'held'] as const) assert.ok(scenarios.some((x) => x.outcome === o), `no ${o} scenario`);
  for (let m = 0; m < 5; m++) assert.ok(scenarios.filter((x) => x.year >= m * 1000 && x.year < (m + 1) * 1000).length >= 4, `millennium ${m + 1} is thin`);
  assert.ok(scenarios.filter((x) => x.chronicle).length >= scenarios.length / 2, 'most scenarios carry the defender’s chronicle');
  for (let i = 1; i < scenarios.length; i++) assert.ok(scenarios[i - 1].year <= scenarios[i].year, 'oldest first');
});

test('every scenario fact recounts from world.sqlite', { skip }, () => {
  const bad = scenarios.flatMap(recount);
  assert.deepEqual(bad, []);
});

test('every scenario script in scenario-scripts/ validates against its scenario', { skip }, () => {
  const dir = join(root, 'scenario-scripts');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^sc-\d+\.json$/.test(f)) : [];
  const byId = new Map(scenarios.map((x) => [x.id, x]));
  const bad: string[] = [];
  for (const f of files) {
    const sc = byId.get(f.slice(0, -5));
    if (!sc) { bad.push(`${f}: not a scenario of this build`); continue; }
    for (const m of validateScript(JSON.parse(readFileSync(join(dir, f), 'utf8')), sc).errors) bad.push(`${f}: ${m}`);
  }
  assert.deepEqual(bad, []);
});

test('the export is deterministic and well formed on a short history', () => {
  const r = simulate(5, 1500);
  const cwd = process.cwd();
  const tmp = mkdtempSync(join(tmpdir(), 'palimpsest-scenarios-'));
  process.chdir(tmp);
  let a: ReturnType<typeof buildArchive>;
  try {
    a = buildArchive(r);
  } finally {
    process.chdir(cwd);
    rmSync(tmp, { recursive: true, force: true });
  }
  const H = new Heraldry(r, a, computeEras(r, a));
  const j = scenariosJson(a, H);
  assert.ok(j.scenarios.length >= 6, `only ${j.scenarios.length} scenarios before AY 1500`);
  assert.deepEqual(scenariosJson(a, H), j);
  const s = r.state;
  for (const sc of j.scenarios) {
    const e = s.events[sc.event];
    assert.ok(e.sub === 'siege' || e.sub === 'sack');
    assert.equal(sc.battle.oursLost, Number(s.events[Number(sc.battle.id.slice(4))].data.defenderLosses));
    assert.ok(sc.state.ruler.age >= 0 && sc.battle.commander.age >= 0, `${sc.id} ages`);
    for (const g of sc.state.gods) assert.ok(g.sex === 'm' || g.sex === 'f');
    assert.ok(sc.names.f.length + sc.names.m.length > 0 || sc.city.people !== '', `${sc.id} has no names`);
    if (sc.chronicle?.quote) assert.ok(!sc.chronicle.quote.includes('[...]'));
    assert.ok(['sacked', 'conquered', 'treaty', 'held'].includes(sc.outcome));
  }
});
