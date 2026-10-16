// Clash of the Ages on a short history: every card links to its page, and its numbers match the record when they are
// counted again here, independently, from roles, events and the decadal survey. The deck, the arms and the seals are
// deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simulate } from '../src/sim/run.ts';
import { buildArchive } from '../src/archive/build.ts';
import { computeEras } from '../src/export/export.ts';
import { Heraldry, deckJson } from '../src/export/deck.ts';

const r = simulate(5, 1500);
const cwd = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'palimpsest-deck-'));
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
const deck = deckJson(r, a, eras, new Heraldry(r, a, eras));
const by = (kind: string) => deck.cards.filter((c) => c.kind === kind);
const num = (ref: string) => Number(ref.slice(4));

test('every card links to a page and carries four whole, non-negative numbers', () => {
  assert.ok(deck.cards.length > 100, `only ${deck.cards.length} cards`);
  for (const k of deck.kinds) assert.equal(k.stats.length, 4);
  for (const c of deck.cards) {
    assert.ok(a.pages.has(c.id), `${c.id} has no page`);
    assert.equal(c.name, a.pages.get(c.id)!.title);
    assert.equal(c.stats.length, 4);
    for (const v of c.stats) assert.ok(Number.isInteger(v) && v >= 0, `${c.id}: ${v}`);
    assert.ok(c.era >= 0 && c.era < eras.length);
  }
  assert.equal(new Set(deck.cards.map((c) => c.id)).size, deck.cards.length, 'a card appears twice');
});

test('rulers’ reigns and wars won, recounted from roles and war events', () => {
  for (const c of by('ruler')) {
    const p = s.persons[num(c.id)];
    const [start, end] = c.years;
    const role = p.roles.find((x) => (x.role === 'ruler' || x.role === 'president' || x.role === 'chairman') && x.start === start);
    assert.ok(role && role.polity !== null, `${c.id}: no reign from AY ${start}`);
    assert.equal(c.stats[0], end - start);
    const pol = `pol:${role!.polity}`;
    let wars = 0;
    for (const e of s.events) {
      if (e.sub !== 'war' || e.end < start || e.end > end) continue;
      const side = e.parts.find(([ref, rl]) => ref === pol && (rl === 'attacker' || rl === 'defender' || rl === 'ally'))?.[1];
      if (side && (e.data.outcome === 'attacker' ? side === 'attacker' : e.data.outcome === 'defender' ? side !== 'attacker' : false)) wars++;
    }
    assert.equal(c.stats[1], wars, `${c.id} wars won`);
    const led = s.events.filter((e) => e.sub === 'battle' && e.parts.some(([ref, rl]) => ref === c.id && rl.endsWith('commander'))).length;
    assert.equal(c.stats[3], led, `${c.id} battles led`);
  }
});

test('generals’ battles, victories, hosts and enemy losses, recounted from battle events', () => {
  for (const c of by('general')) {
    let battles = 0, won = 0, host = 0, enemy = 0;
    for (const e of s.events) {
      if (e.sub !== 'battle') continue;
      const mine = e.parts.find(([ref, rl]) => ref === c.id && rl.endsWith('commander'));
      if (!mine) continue;
      const att = mine[1] === 'attacking commander';
      const side = num(e.parts.find(([, rl]) => rl === (att ? 'attacker' : 'defender'))![0]);
      const d = e.data as { attackerSize: number; defenderSize: number; attackerLosses: number; defenderLosses: number; winner: number };
      battles++;
      if (d.winner === side) won++;
      host = Math.max(host, att ? d.attackerSize : d.defenderSize);
      enemy += att ? d.defenderLosses : d.attackerLosses;
    }
    assert.deepEqual(c.stats, [battles, won, host, enemy], c.id);
  }
});

test('states’ extents, populations and lifespans, read again from the decadal survey', () => {
  for (const c of by('state')) {
    const p = s.polities[num(c.id)];
    const rows = s.polityYears.filter((row) => row[0] === p.id);
    assert.equal(c.stats[0], Math.max(...rows.map((row) => row[2] as number)));
    assert.equal(c.stats[1], Math.max(...rows.map((row) => row[3] as number)));
    assert.equal(c.stats[2], (p.died ?? 5000) - p.born);
  }
});

test('the deck, the arms and the seals are deterministic, and name real peoples and faiths', () => {
  const again = deckJson(r, a, eras, new Heraldry(r, a, eras));
  assert.equal(JSON.stringify(again), JSON.stringify(deck));
  const H = new Heraldry(r, a, eras);
  for (const p of s.polities) {
    const spec = H.polity(p);
    assert.deepEqual(spec, new Heraldry(r, a, eras).polity(p));
    assert.ok(spec[1] >= 0 && spec[1] < s.cultures.length, `pol:${p.id} culture`);
    assert.ok(spec[2] === -1 || (spec[2] >= 0 && spec[2] < s.movements.length), `pol:${p.id} religion`);
  }
  for (const c of deck.cards.filter((x) => x.sigil)) {
    const [id, sex, roles] = c.sigil!;
    const p = s.persons[num(id)];
    assert.equal(sex, p.sex);
    for (const role of roles.split(',')) assert.ok(p.roles.some((x) => x.role === role), `${id}: ${role}`);
  }
});
