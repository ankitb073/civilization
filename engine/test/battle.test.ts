// Battle dioramas on a short history: each battle's figures are the record's, and every claim drawn as a ghost army is
// read from a surviving document about that battle, whose text still carries the figure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simulate } from '../src/sim/run.ts';
import { buildArchive } from '../src/archive/build.ts';
import { computeEras } from '../src/export/export.ts';
import { Heraldry } from '../src/export/deck.ts';
import { BattleExport } from '../src/export/battle.ts';
import { BATTLE_KIT } from '../src/export/contract.ts';

const r = simulate(5, 1500);
const cwd = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'palimpsest-battle-'));
process.chdir(tmp);
let a: ReturnType<typeof buildArchive>;
try {
  a = buildArchive(r);
} finally {
  process.chdir(cwd);
  rmSync(tmp, { recursive: true, force: true });
}
const s = r.state;
const eras = computeEras(r, a);
const H = new Heraldry(r, a, eras);
const B = new BattleExport(a, H);
const battles = s.events.filter((e) => e.sub === 'battle' && a.pages.has(`evt:${e.id}`));
const arts = new Map(a.artifacts.map((x) => [`art:${x.id}`, x]));
const fmt = (n: number) => n.toLocaleString('en-US');

test('a battle diorama carries the record’s strengths, losses, victor and arms', () => {
  assert.ok(battles.length > 200, `only ${battles.length} battles`);
  for (const e of battles) {
    const b = B.of(e);
    assert.deepEqual(b.size, [Number(e.data.attackerSize), Number(e.data.defenderSize)]);
    assert.deepEqual(b.losses, [Number(e.data.attackerLosses), Number(e.data.defenderLosses)]);
    const A = Number(e.parts.find(([, x]) => x === 'attacker')![0].slice(4));
    assert.equal(b.won, e.data.winner === A ? 0 : 1);
    assert.equal(b.arms[0][0], `pol:${A}`);
    for (const k of b.kit) assert.ok(k >= 0 && k < 1 << BATTLE_KIT.length);
    if (b.fell >= 0) assert.equal(e.data.commanderKilled !== undefined, true);
  }
});

test('every claim is a surviving document about that battle whose text still gives the figure', () => {
  let n = 0;
  const kinds = new Set<string>();
  for (const e of battles) {
    const b = B.of(e);
    for (const c of b.claims) {
      n++;
      kinds.add(c.kind);
      const art = arts.get(c.art);
      assert.ok(art, `${c.art} is not extant`);
      assert.ok(art!.about.includes(e.id) || art!.rival?.eventId === e.data.war, `${c.art} is not about evt:${e.id}`);
      const side = c.side === 0 ? 'attacker' : 'defender';
      assert.ok(e.parts.some(([x, role]) => x === `pol:${art!.polity}` && role === side), `${c.art} is not ${side}'s`);
      for (const v of [...c.size, ...c.losses]) if (v !== null) assert.ok(art!.body.includes(fmt(v)) || art!.body.includes(String(v)), `${c.art} never says ${v}`);
      if (c.kind === 'chronicle') assert.ok(art!.body.includes(`[AY ${e.year}]`), `${c.art} has no paragraph dated AY ${e.year}`);
      // the record is what monuments and muster rolls are measured against
      if (c.kind === 'stele') assert.ok(c.losses[1 - c.side]! >= b.losses[1 - c.side], `${c.art} claims fewer dead than fell`);
      if (c.kind === 'muster') {
        assert.equal(c.size[c.side], b.size[c.side], `${c.art} total`);
        assert.equal(c.arms!.reduce((t, [, m]) => t + m, 0), b.size[c.side], `${c.art} arms do not add up`);
      }
    }
  }
  assert.ok(n > 100, `only ${n} claims`);
  for (const k of ['chronicle', 'stele', 'muster']) assert.ok(kinds.has(k), `no ${k} claims`);
});

test('the export is deterministic', () => {
  const again = new BattleExport(a, H);
  for (const e of battles.slice(0, 400)) assert.deepEqual(again.of(e), B.of(e));
});
