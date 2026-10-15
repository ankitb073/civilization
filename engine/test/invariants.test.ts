// Causal and structural invariants of a simulated history, checked in memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../src/sim/run.ts';

const r = simulate(5, 1200);
const s = r.state;

test('causes are dated no later than, and recorded before, their effects', () => {
  for (const e of s.events) {
    for (const c of e.causes) {
      assert.ok(c < e.id, `evt:${e.id} cites later-recorded evt:${c}`);
      assert.ok(s.events[c].year <= e.year, `evt:${e.id} (${e.year}) caused by evt:${c} (${s.events[c].year})`);
    }
  }
});

test('territory, culture and religion logs are in chronological order', () => {
  for (const log of [s.territoryLog, s.cultureLog, s.religionLog]) {
    for (let i = 4; i < log.length; i += 4) assert.ok(log[i] >= log[i - 4], `log out of order at ${i / 4}: ${log[i - 4]} → ${log[i]}`);
  }
});

test('replaying the logs from the initial state reproduces the final map', () => {
  const replay = (initial: Int32Array, log: number[]) => {
    const a = initial.slice();
    for (let i = 0; i < log.length; i += 4) a[log[i + 1]] = log[i + 2];
    return a;
  };
  assert.deepEqual(replay(r.initial.owner, s.territoryLog), s.owner);
  assert.deepEqual(replay(r.initial.culture, s.cultureLog), s.culture);
  assert.deepEqual(replay(r.initial.religion, s.religionLog), s.religion);
});

test('territory is never held by a polity outside its lifetime', () => {
  const L = s.territoryLog;
  for (let i = 0; i < L.length; i += 4) {
    const o = L[i + 2];
    if (o < 0) continue;
    const p = s.polities[o];
    assert.ok(p.born <= L[i] && (p.died === null || p.died >= L[i]), `cell ${L[i + 1]} → pol:${o} at ${L[i]} (life ${p.born}–${p.died})`);
  }
});

test('every office starts within its holder’s life', () => {
  for (const p of s.persons) {
    assert.ok(p.died >= p.born, `per:${p.id} dies before birth`);
    for (const role of p.roles) assert.ok(role.start >= p.born && role.start <= p.died, `per:${p.id} ${role.role} from ${role.start}, life ${p.born}–${p.died}`);
  }
});

test('no polity has two heads of state at once', () => {
  const byPol = new Map<number, [number, number, number][]>();
  for (const p of s.persons) {
    for (const role of p.roles) {
      if (role.polity === null || !['ruler', 'president', 'chairman'].includes(role.role)) continue;
      if (!byPol.has(role.polity)) byPol.set(role.polity, []);
      byPol.get(role.polity)!.push([role.start, role.end ?? Infinity, p.id]);
    }
  }
  for (const [pid, rs] of byPol) {
    rs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let i = 1; i < rs.length; i++) {
      if (rs[i][2] === rs[i - 1][2]) continue;
      assert.ok(rs[i][0] >= rs[i - 1][1], `pol:${pid}: per:${rs[i - 1][2]} (${rs[i - 1][0]}–${rs[i - 1][1]}) overlaps per:${rs[i][2]} from ${rs[i][0]}`);
    }
  }
});

test('settlements are abandoned only after they are founded', () => {
  for (const t of s.settlements) if (t.abandoned !== null) assert.ok(t.abandoned >= t.founded, `set:${t.id}`);
});
