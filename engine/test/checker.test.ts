// The database checker passes on a real build and catches a deliberately corrupted record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { simulate } from '../src/sim/run.ts';
import { WorldDb } from '../src/db/writer.ts';
import { runChecks } from '../src/check/check.ts';

test('checker passes on a fresh database and flags a corrupted cause', () => {
  const dir = mkdtempSync(join(tmpdir(), 'palimpsest-check-'));
  try {
    const path = join(dir, 'world.sqlite');
    const db = new WorldDb(path);
    const r = simulate(5, 600, {
      onStart: (res) => db.writeWorld(res),
      onCentury: (res, year) => db.flushCentury(res, year),
    });
    db.finalize(r);
    db.close();

    const ok = runChecks(path);
    const failing = ok.invariants.filter((i) => i.violations > 0).map((i) => `${i.id}: ${i.examples[0]}`);
    assert.ok(ok.passed, `checker failed on a clean build: ${failing.join(' | ')}`);
    const causes = ok.invariants.find((i) => i.id === 'causes-precede')!;
    assert.ok(causes.checked > 0, 'no cause links checked');

    // push one cause into the far future: its effect now precedes it
    const w = new DatabaseSync(path);
    w.exec('UPDATE events SET year = year + 10000 WHERE id = (SELECT cause FROM event_causes LIMIT 1)');
    w.close();
    const bad = runChecks(path);
    assert.equal(bad.passed, false);
    const v = bad.invariants.find((i) => i.id === 'causes-precede')!;
    assert.ok(v.violations > 0, 'corruption not detected');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
