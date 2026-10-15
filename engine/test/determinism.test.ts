// Same seed + same code ⇒ identical history; a different seed ⇒ a different one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { simulate } from '../src/sim/run.ts';
import type { SimResult } from '../src/sim/run.ts';

function fingerprint(r: SimResult): Record<string, string> {
  const s = r.state;
  const h = (x: unknown) => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
  const events = h(s.events.map((e) => [e.sub, e.year, e.end, e.cell, e.parts, e.causes, e.data]));
  const logs = h([s.territoryLog, s.cultureLog, s.religionLog]);
  const persons = h(s.persons.map((p) => [p.born, p.died, p.nameId, p.deathCause]));
  const owner = h(Array.from(s.owner));
  return { events, logs, persons, owner };
}

test('same seed reproduces the identical history', () => {
  const a = fingerprint(simulate(5, 800));
  const b = fingerprint(simulate(5, 800));
  assert.deepEqual(a, b);
});

test('a different seed gives a different history', () => {
  const a = fingerprint(simulate(5, 500));
  const c = fingerprint(simulate(7, 500));
  assert.notEqual(a.events, c.events);
  assert.notEqual(a.owner, c.owner);
});
