// Canon guard: the flagships quote names, words and sound laws of the canonical world (seed 5) as text.
// The world fingerprint covers simulation events only, so a change to the language engine could drift
// every name without any flagship being rejected. This test pins the language engine's output. If it
// fails, the change renames the canonical world: revert it, or regenerate and rewrite the flagships
// (decision 0010).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../src/sim/run.ts';
import { CONCEPTS } from '../src/lang/concepts.ts';

const PINNED = 'c5234467';

test('the canonical languages are unchanged (names, words and sound laws of seed 5)', () => {
  const r = simulate(5, 1500);
  const L = r.state.lang;
  let h = 0x811c9dc5;
  const mix = (s: string) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; };
  for (const l of L.languages()) {
    mix(`${l.id}|${l.born}|${l.parent}`);
    for (const c of L.soundChanges(l.id)) mix(`${c.year}${c.rule}${c.label}`);
    for (const c of CONCEPTS.slice(0, 40)) mix(L.word(l.id, c.id, Math.min(l.died ?? 1500, 1500)).conventional);
  }
  for (let n = 0; n < Math.min(L.nameCount(), 400); n++) mix(L.realize(n, L.nameOrigin(n).lang, 1500).conventional);
  assert.equal(h.toString(16).padStart(8, '0'), PINNED);
});
