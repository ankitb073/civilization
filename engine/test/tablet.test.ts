// The Tablet House game (atlas/src/game/tablet/engine.ts) played through every way it can go, against the exported
// scenarios and every script present: each line, ending and archaeologist's paragraph fills completely, the bent
// figures lean the king's way, the day-five cards amend the tablet as their words say, and the score stays in range.
// Skips itself when the atlas data has not been built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScenariosJson } from '../src/export/contract.ts';
import * as E from '../../atlas/src/game/tablet/engine.ts';
import { fill, genericScript, normalizeScript, scriptStrings, strayDigits, type TabletScript } from '../../atlas/src/game/tablet/script.ts';
import type { DayNo, Pick, Scenario, SlotId } from '../../atlas/src/game/tablet/types.ts';

const DATA = 'atlas/public/data/scenarios.json';
const SCRIPTS = 'scenario-scripts';
const scenarios: Scenario[] = existsSync(DATA) ? (JSON.parse(readFileSync(DATA, 'utf8')) as ScenariosJson).scenarios : [];
const scripts = new Map<string, unknown>(existsSync(SCRIPTS) ? readdirSync(SCRIPTS).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(SCRIPTS, f), 'utf8'))]) : []);
const PICKS: Pick[] = ['true', 'rounded', 'boasted'];
const open = (t: string) => /\{[A-Za-z][\w.]*\}/.test(t);

/** Play one game: five slot picks and the index of the card played on days 3, 4 and 5. */
function play(sc: TabletScript, picks: Pick[], cards: number[]): E.Game {
  let g = E.newGame();
  const at = (id: SlotId, i: number) => { g = E.pickSlot(g, sc, id, picks[i]); };
  at('muster', 0); at('ours', 1); at('theirs', 2); at('field', 3);
  for (const d of [3, 4, 5] as DayNo[]) {
    const opts = sc.days[d - 1].choice!.options;
    const k = Math.min(cards[d - 3], opts.length - 1);
    g = E.choose(g, d, k, opts[k]);
    if (d === 4) at('end', 4);
  }
  return g;
}

function checkScript(s: Scenario, sc: TabletScript, label: string) {
  const ctx = E.baseCtx(s, sc);
  const scribe = (ctx.scribe as { name: string }).name;
  assert.ok(scribe && !open(scribe), `${label}: the scribe's name fills`);
  // every reading of every line fills, and carries the figure the player picked
  const vals = E.valuesOf(s);
  for (const id of E.LINE_ORDER) for (const p of PICKS) {
    const line = E.lineOf(s, sc, ctx, id, p);
    assert.ok(!open(line), `${label}: ${id}/${p} fills: ${line}`);
    if (id === 'muster' || id === 'ours' || id === 'theirs') {
      const v = vals[id][p];
      assert.ok(v === 0 ? /\bnone\b/.test(line) : line.includes(v.toLocaleString('en-US')), `${label}: ${id}/${p} shows ${v}: ${line}`);
    }
    const parts = E.lineParts(s, sc, ctx, id);
    assert.ok(parts.rest[p].length > 0, `${label}: ${id} keeps words to press after the formula`);
  }
  // every day's prose fills (the game fills {value}, {tablet.*} and {find.*} where they belong)
  for (const d of sc.days) for (const t of [...d.scene, ...d.king, d.choice?.prompt ?? '', ...(d.choice?.options.flatMap((o) => [o.label, o.consequence]) ?? []), ...(d.tablet?.map((x) => x.prompt) ?? [])]) {
    assert.ok(!open(fillPlain(s, sc, t)), `${label}: day ${d.day} prose fills: ${t.slice(0, 80)}`);
  }
  // all 243 tablets with one path of cards, and all 27 card paths with two tablets
  const games: E.Game[] = [];
  for (let n = 0; n < 243; n++) games.push(play(sc, [0, 1, 2, 3, 4].map((i) => PICKS[Math.floor(n / 3 ** i) % 3]), [0, 0, 0]));
  for (let n = 0; n < 27; n++) for (const tab of [['true', 'true', 'true', 'true', 'true'], ['boasted', 'rounded', 'boasted', 'true', 'rounded']] as Pick[][]) games.push(play(sc, tab, [n % 3, Math.floor(n / 3) % 3, Math.floor(n / 9) % 3]));
  for (const g of games) {
    const cond = E.conditionOf(s, g, E.materialOf(s.medium));
    const lines = E.linesOf(s, sc, g, cond);
    const end = E.endingOf(sc, g);
    assert.ok(end && !open(fill(end.text, E.endCtx(s, sc, g, cond))) && !open(fill(end.title, E.endCtx(s, sc, g, cond))), `${label}: ending ${end?.id} fills`);
    const arch = E.archaeologist(s, sc, g, cond);
    assert.ok(!open(arch), `${label}: archaeologist (${E.archKey(sc, g)}) fills: ${arch}`);
    const score = E.truthScore(lines);
    assert.ok(score >= 0 && score <= 100, `${label}: score ${score}`);
    const text = E.shareText(s, g, lines, end.title, '2026-10-16');
    assert.ok(text.includes(s.city.name) && text.split('\n').length === 3, `${label}: share text`);
    // a tablet given up to the king is rewritten whole; one let stand keeps every line
    if (g.day5 && g.day5 !== 'stand') assert.deepEqual(E.toAmend(g), [], `${label}: amended tablets flatter the king`);
    for (const l of lines) assert.ok(!l.lost || (l.id !== 'ours' && l.id !== 'theirs'), `${label}: the dead the archaeologist reads never crumble`);
  }
}
function fillPlain(s: Scenario, sc: TabletScript, t: string): string {
  return fill(t, E.baseCtx(s, sc));
}

test('the bent figures lean the king’s way in every scenario', { skip: !scenarios.length && 'no scenarios.json' }, () => {
  for (const s of scenarios) {
    const v = E.valuesOf(s);
    assert.ok(v.muster.true < v.muster.rounded && v.muster.rounded < v.muster.boasted, `${s.id} muster ${JSON.stringify(v.muster)}`);
    assert.ok(v.theirs.true < v.theirs.rounded && v.theirs.rounded < v.theirs.boasted, `${s.id} theirs ${JSON.stringify(v.theirs)}`);
    assert.ok(v.ours.boasted < v.ours.rounded && v.ours.rounded < v.ours.true, `${s.id} ours ${JSON.stringify(v.ours)}`);
    assert.equal(v.muster.true, s.battle.ours);
    assert.equal(v.ours.true, s.battle.oursLost);
    assert.equal(v.theirs.true, s.battle.theirsLost);
  }
});

test('every script present plays through every path', { skip: !scenarios.length && 'no scenarios.json' }, () => {
  let n = 0;
  for (const [id, raw] of scripts) {
    const s = scenarios.find((x) => x.id === id);
    if (!s) continue;
    const sc = normalizeScript(raw, s);
    if (!sc) continue; // an unfinished script: the game leaves the city out until it is whole (the validator reports why)
    checkScript(s, sc, id);
    n++;
  }
  assert.ok(n > 0 || !scripts.size, 'at least one script plays');
});

test('the fallback script fits every scenario and every ending', { skip: !scenarios.length && 'no scenarios.json' }, () => {
  for (const s of scenarios) {
    const sc = genericScript(s);
    assert.ok(normalizeScript(sc, s), `${s.id}: the generic script is a whole script`);
    for (const t of scriptStrings(sc)) assert.ok(!strayDigits(t), `${s.id}: no typed figures: ${t}`);
    checkScript(s, sc, `${s.id} (generic)`);
  }
});

test('the day-five cards are read by what they do', () => {
  assert.equal(E.day5Kind({ label: 'Let it stand as written', effects: { conscience: 2, favour: -2 }, consequence: '' }), 'stand');
  assert.equal(E.day5Kind({ label: 'Smooth it and write what he wants', effects: { favour: 3, conscience: -2 }, consequence: '' }), 'amend');
  assert.equal(E.day5Kind({ label: 'Agree, then press the truth along the edge', effects: { conscience: 1, favour: 1 }, flag: 'edge', consequence: '' }), 'edge');
  assert.equal(E.day5Kind({ label: 'Bow and say nothing', effects: { favour: 2, conscience: -1 }, consequence: '' }), 'amend');
  assert.equal(E.day5Kind({ label: 'Seal yours in an envelope, and press his war outside', effects: { favour: 1, conscience: 1, household: -1 }, flag: 'envelope', consequence: '' }), 'hidden');
  assert.equal(E.day5Kind({ label: 'Read them a kinder war than the clay holds', effects: { favour: 2, conscience: 1 }, flag: 'spoken', consequence: '' }), 'stand');
  assert.equal(E.day5Kind({ label: 'Press his words, and leave your name off the foot', effects: { favour: 2, conscience: -1 }, flag: 'unsigned', consequence: '' }), 'amend');
});

test('the city of the day is the same for everyone on the same date', { skip: !scenarios.length && 'no scenarios.json' }, () => {
  assert.equal(E.dailyScenario(scenarios, '2026-10-16').id, E.dailyScenario(scenarios, '2026-10-16').id);
  const seen = new Set(Array.from({ length: 60 }, (_, i) => E.dailyScenario(scenarios, `2026-11-${String(i).padStart(2, '0')}`).id));
  assert.ok(seen.size > Math.min(10, scenarios.length / 2), 'the daily city varies');
});
