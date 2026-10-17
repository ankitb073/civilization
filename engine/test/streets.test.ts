// Runner of the Tablet House: every streets script present passes its validator, and its errands play through every
// way they can go (each of the three readings, beating the horn and missing it) headless, with every line filled and
// every figure the Tablet House's own. Skips itself when the atlas data has not been built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Scenario as ContractScenario, ScenariosJson } from '../src/export/contract.ts';
import { validateStreetsScript } from '../src/debug/streets-validate.ts';
import { normalizeScript } from '../../atlas/src/game/tablet/script.ts';
import { valuesOf } from '../../atlas/src/game/tablet/engine.ts';
import type { Pick, Scenario } from '../../atlas/src/game/tablet/types.ts';
import { normalizeStreetsScript } from '../../atlas/src/game/streets/errand/script.ts';
import * as R from '../../atlas/src/game/streets/errand/engine.ts';

const DATA = 'atlas/public/data/scenarios.json';
const DIR = 'streets-scripts';
const scenarios: ContractScenario[] = existsSync(DATA) ? (JSON.parse(readFileSync(DATA, 'utf8')) as ScenariosJson).scenarios : [];
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /^sc-\d+\.json$/.test(f)) : [];
const PICKS: Pick[] = ['true', 'rounded', 'boasted'];
const open = (t: string) => /\{[A-Za-z][\w.]*\}/.test(t);
const fmt = (n: number) => n.toLocaleString('en-US');

test('streets scripts pass their validator and play every way', { skip: !scenarios.length && 'no atlas data (npm run build:data)' }, () => {
  assert.ok(files.length > 0, 'at least one streets script');
  for (const f of files) {
    const id = f.slice(0, -5);
    const s: Scenario | undefined = scenarios.find((x) => x.id === id);
    const cs = scenarios.find((x) => x.id === id)!;
    assert.ok(s, `${id} is a scenario of this build`);
    const raw = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    const thRaw = JSON.parse(readFileSync(join('scenario-scripts', f), 'utf8'));
    const rep = validateStreetsScript(raw, cs, thRaw);
    assert.deepEqual(rep.errors, [], `${id}: validator errors`);
    const th = normalizeScript(thRaw, s!)!;
    const sc = normalizeStreetsScript(raw, id);
    assert.ok(sc, `${id}: the script plays`);
    for (const e of sc!.errands) {
      const w = R.words(s!, th, e);
      for (const t of [w.overseer.name, w.gatekeeper.name, w.destination, ...w.brief, w.prompt, w.objective]) assert.ok(t && !open(t), `${id}/${e.id}: fills: ${t}`);
      // the readings are the Tablet House's: its bend of the record's muster
      const v: Record<Pick, number> = valuesOf(s!)[e.slot];
      assert.equal(v.true, s!.battle.ours, 'the true muster is the battle\'s own count');
      assert.ok(v.rounded > v.true && v.boasted > v.rounded, 'the bent musters lean the king\'s way');
      for (const r of w.readings) assert.ok(r.line.includes(fmt(r.value)), `${id}/${e.id}: ${r.pick} presses ${r.value}: ${r.line}`);
      for (const pick of PICKS) for (const late of [false, true]) {
        const label = `${id}/${e.id}/${pick}/${late ? 'late' : 'in time'}`;
        let st = R.newRun();
        st = R.toChoose(st);
        st = R.choose(st, pick);
        const pw = R.pressedWords(s!, th, e, pick);
        assert.ok(!open(pw.reaction) && !open(pw.handover) && pw.line.includes(fmt(v[pick])), `${label}: pressed`);
        st = R.leave(st, e, 100);
        assert.equal(st.phase, 'run');
        // run for the measured time at a run (or past the horn), half of it over roofs
        const arriveAt = late ? e.horn.seconds + 5 : e.horn.seconds - e.horn.warn + 2; // in time, but after the warning
        const cues: R.Cue[] = [];
        for (let t = 0; t <= arriveAt + 1e-9; t += 1 / 60) {
          const out = R.step(st, e, { now: 100 + t, moved: 0.1, high: t > arriveAt / 2, there: t + 1 / 60 > arriveAt });
          st = out.st; cues.push(...out.cues);
          if (st.phase !== 'run') break;
        }
        assert.equal(st.phase, 'arrive', `${label}: arrived`);
        assert.equal(st.inTime, !late, `${label}: in time is ${!late}`);
        assert.deepEqual(cues.filter((c) => c !== 'arrive'), late ? ['warn', 'horn'] : ['warn'], `${label}: cues`);
        const a = R.arrivalWords(s!, th, e, pick, !late);
        for (const t of [a.scene, a.reaction, a.after ?? '']) assert.ok(!open(t), `${label}: arrival fills: ${t}`);
        if (!late) assert.ok(a.scene.includes(pw.line), `${label}: the herald reads what was pressed`);
        st = R.finish(st);
        const card = R.endCard(s!, th, e, st);
        assert.equal(card.inTime, !late);
        assert.equal(card.pressed.value, v[pick]);
        assert.equal(card.record.value, s!.battle.ours);
        assert.ok(card.record.line.includes(fmt(s!.battle.ours)), `${label}: the record's muster: ${card.record.line}`);
        assert.equal(card.route.street + card.route.roof, 100);
        assert.ok(Math.abs(card.route.roof - 50) <= 2, `${label}: half over the roofs (${card.route.roof})`);
        for (const t of [card.title, card.headline, card.record.line, card.teaser.title, card.teaser.text]) assert.ok(t && !open(t) && !/\{|\}/.test(t), `${label}: end card fills: ${t}`);
        const saved = R.record(R.EMPTY_SAVED, card);
        assert.equal(saved.best, late ? null : Math.round(card.time * 10) / 10);
        assert.equal(saved.lastPick, pick);
        // the horn still sounds after an arrival in time (the levy marches at it)
        if (!late) assert.deepEqual(R.step(st, e, { now: 100 + e.horn.seconds + 1, moved: 0, high: false, there: false }).cues, ['horn']);
      }
    }
  }
});
