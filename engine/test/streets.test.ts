// Runner of the Tablet House: every streets script present passes its validator, and its errands play through every
// way they can go (each of the three readings, beating the horn and missing it) headless, with every line filled and
// every figure the Tablet House's own. Skips itself when the atlas data has not been built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Scenario as ContractScenario, ScenariosJson } from '../src/export/contract.ts';
import { parseWeek, reckon, validateStreetsScript, weekPaths, weekTexts, type WeekScript } from '../src/debug/streets-validate.ts';
import { normalizeScript } from '../../atlas/src/game/tablet/script.ts';
import { valuesOf } from '../../atlas/src/game/tablet/engine.ts';
import { fill, context } from '../../atlas/src/game/tablet/script.ts';
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

// Days two to five (docs/streets/lld-errands.md): every line of every errand fills for every choice and clock, every way
// the week can go reaches a reckoning whose texts fill, every ending and every verdict is someone's, the record lines
// never move with play, and the day-one runtime still plays day one alone. The validator's week checks are exercised
// on broken copies so a script cannot pass by accident.
test('the week plays every way to a reckoning', { skip: !scenarios.length && 'no atlas data (npm run build:data)' }, () => {
  for (const f of files) {
    const id = f.slice(0, -5);
    const raw = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    if (!raw.errands.some((e: { kind?: string }) => e.kind)) continue;
    const s = scenarios.find((x) => x.id === id)! as unknown as Scenario;
    const thRaw = JSON.parse(readFileSync(join('scenario-scripts', f), 'utf8'));
    const th = normalizeScript(thRaw, s)!;
    const S = raw as WeekScript;
    const W = parseWeek(S);
    assert.ok(W, `${id}: the week has its five errands`);
    // the day-one runtime plays the muster alone; the week's errands are not mistaken for it
    assert.deepEqual(normalizeStreetsScript(raw, id)!.errands.map((e) => e.id), [W!.muster.id], `${id}: the runtime's errands`);
    for (const e of [W!.field, W!.ours, W!.archive, W!.end]) {
      for (const t of weekTexts(s, th, S, e)) assert.ok(t && !open(t) && !t.includes('undefined'), `${id}/${e.id}: fills: ${t}`);
      // the record beside the play is the record's, whatever was chosen
      assert.equal(fill(e.end.record, context(s, { place: {} })).includes('{'), /\{place\./.test(e.end.record), `${id}/${e.id}: the record line fills from the record`);
    }
    const paths = weekPaths(W!);
    const endings = new Map<string, number>(), bands = new Set<string>();
    const v = valuesOf(s);
    for (const p of paths) {
      const r = reckon(s, th, S, p);
      const label = `${id}: ${JSON.stringify(p)}`;
      for (const t of [r.texts.title, r.texts.intro, ...r.texts.finds, r.texts.verdict, r.texts.ending, r.texts.share]) assert.ok(t && !open(t) && !t.includes('undefined'), `${label}: fills: ${t}`);
      assert.equal(r.lines.length, 5);
      assert.ok(r.score >= 0 && r.score <= 100 && r.score % 10 === 0, `${label}: score ${r.score}`);
      assert.equal(r.tablet.muster, v.muster[p.muster.pick], `${label}: the muster is the Tablet House's figure`);
      if (p.muster.pick === 'true' && p.field.pick === 'true') assert.ok(r.texts.finds[0].includes(fmt(s.battle.ours)), `${label}: the record's muster beside the tablet`);
      endings.set(r.ending.id, (endings.get(r.ending.id) ?? 0) + 1);
      bands.add(r.band);
    }
    for (const e of S.reckoning.endings) assert.ok(endings.has(e.id), `${id}: ending "${e.id}" is reached`);
    assert.deepEqual([...bands].sort(), ['boasted', 'rounded', 'true'], `${id}: every verdict is someone's`);
    // an honest week and a king's week, end to end
    const honest = reckon(s, th, S, { muster: { pick: 'true', late: false }, field: { pick: 'true', late: false }, ours: { option: W!.ours.options.find((o) => o.pick === 'true')!.id, late: false }, archive: { option: W!.archive.options.find((o) => o.carry)?.id ?? W!.archive.options[0].id, late: false, load: 'delivered' }, end: { option: W!.end.options.find((o) => o.pick === 'true')!.id, late: false } });
    assert.equal(honest.score, 100, `${id}: an honest week keeps all of it`);
    assert.equal(honest.band, 'true');
    const kings = reckon(s, th, S, { muster: { pick: 'boasted', late: false }, field: { pick: 'boasted', late: false }, ours: { option: W!.ours.options.find((o) => o.pick === 'boasted')!.id, late: false }, archive: { option: W!.archive.options.find((o) => o.pick === 'boasted')!.id, late: false, load: null }, end: { option: W!.end.options.find((o) => o.pick === 'boasted')!.id, late: false } });
    assert.equal(kings.score, 0, `${id}: the king's week keeps none of it`);
    assert.ok(!!s.chronicle?.quote && kings.texts.verdict.includes(s.chronicle.quote), `${id}: the king's week meets the chronicle`);

    // the validator's week checks bite
    const cs = scenarios.find((x) => x.id === id)!;
    const broken = (fn: (x: any) => void, want: RegExp) => {
      const copy = JSON.parse(JSON.stringify(raw));
      fn(copy);
      const rep = validateStreetsScript(copy, cs, thRaw);
      assert.ok(rep.errors.some((m) => want.test(m)), `${id}: expected an error ${want} (got ${rep.errors.slice(0, 3).join(' | ') || 'none'})`);
    };
    const day = (x: any, d: number) => x.errands.find((e: any) => e.day === d);
    broken((x) => { day(x, 3).brief[0] += ' It cost 9 weights.'; }, /digits outside placeholders/);
    broken((x) => { day(x, 4).outcome = 'held'; }, /record's ending/);
    broken((x) => { day(x, 2).people.runner.shared = true; }, /no character of the Tablet House/);
    broken((x) => { delete day(x, 3).people.dyer.shared; }, /character of the Tablet House script/);
    broken((x) => { day(x, 5).people.mother.name = '{names.f.9}'; }, /elsewhere this week/);
    broken((x) => { day(x, 2).clock.seconds = 60; }, /the roofs do not pay/);
    broken((x) => { day(x, 3).clock.seconds = 45; }, /nobody beats it/);
    broken((x) => { day(x, 5).brief[2] += ' {place.harbour}'; }, /names no place/);
    broken((x) => { day(x, 2).brief[0] = day(x, 2).brief[0].replace('{runner.name}', '{tablet.line}') + ' {tablet.line}'; }, /only known once the choice is made/);
    broken((x) => { x.reckoning.endings[0].when = { flag: 'nobody' }; }, /set by no choice/);
    broken((x) => { x.reckoning.endings.splice(1, 0, { id: 'never', title: 'Never', when: { favour: [20, 20] }, text: 'Nobody ever comes here, because the meters cannot reach the top of their range in one week of choices like these, so it is never seen.' }); }, /"never" is reached by no way/);
    broken((x) => { delete x.reckoning.finds.archive.cracked; }, /finds\.archive\.cracked: missing/);
    broken((x) => { day(x, 4).note = undefined; }, /content note/);
  }
});
