// Causal and structural invariants of a simulated history, checked in memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../src/sim/run.ts';
import { TK } from '../src/sim/tech.ts';

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

// ---------------------------------------------------------------- simulation v2 (decision 0015)
const battles = s.events.filter((e) => e.sub === 'battle');
const side = (e: (typeof s.events)[number], role: string) => e.parts.find(([, r]) => r === role)![0];

test('the beaten side loses more men than the victor in most battles, and far more in a rout (#16)', () => {
  let more = 0, routs = 0, routs3 = 0;
  for (const e of battles) {
    const aWins = side(e, 'attacker') === `pol:${e.data.winner}`;
    const lw = Number(aWins ? e.data.attackerLosses : e.data.defenderLosses);
    const ll = Number(aWins ? e.data.defenderLosses : e.data.attackerLosses);
    if (ll > lw) more++;
    if (Number(e.data.decisive) >= 0.75) { routs++; if (ll >= 3 * lw) routs3++; }
  }
  assert.ok(more >= 0.85 * battles.length, `the loser lost more in only ${more} of ${battles.length} battles`);
  assert.ok(routs3 >= 0.7 * routs, `the loser lost 3× more in only ${routs3} of ${routs} routs`);
});

test('armies number hundreds of men or more, rebels included, and never most of the people (#1, #6)', () => {
  const sizes = battles.flatMap((e) => [Number(e.data.attackerSize), Number(e.data.defenderSize)]);
  const tiny = sizes.filter((x) => x < 100).length;
  assert.ok(tiny <= 0.01 * sizes.length, `${tiny} of ${sizes.length} battle sides under 100 men`);
  for (const e of battles) {
    for (const k of ['attacker', 'defender']) {
      const men = Number(e.data[`${k}Size`]), lost = Number(e.data[`${k}Losses`]);
      assert.ok(lost <= men, `evt:${e.id}: ${k} lost ${lost} of ${men}`);
    }
  }
  for (const row of s.polityYears) {
    const pop = row[3] as number, army = row[6] as number;
    assert.ok(army <= Math.max(500, pop * 0.06), `pol:${row[0]} in ${row[1]}: ${army} men under arms of ${pop} people`);
  }
});

test('no one signs, or is named as ruler, after death; a conversion names that year’s ruler (#8, #9)', () => {
  const reign = new Map<string, [number, number][]>();
  for (const p of s.persons) {
    for (const r of p.roles) {
      if (r.polity === null || !['ruler', 'president', 'chairman'].includes(r.role)) continue;
      const k = `${p.id}:${r.polity}`;
      if (!reign.has(k)) reign.set(k, []);
      reign.get(k)!.push([r.start, r.end ?? Infinity]);
    }
  }
  for (const e of s.events) {
    for (const [ref, role] of e.parts) {
      if (role !== 'signatory' && role !== 'ruler') continue;
      const p = s.persons[Number(ref.slice(4))];
      const deadBefore = p.died < e.year || (p.died === e.year && (p.deathEvent === null || p.deathEvent < e.id));
      assert.ok(!deadBefore, `evt:${e.id} (${e.sub}, ${e.year}) names per:${p.id}, dead in ${p.died}, as ${role}`);
      if (e.sub === 'conversion') {
        const pol = side(e, 'polity').slice(4);
        assert.ok((reign.get(`${p.id}:${pol}`) ?? []).some(([a, b]) => a <= e.year && e.year <= b), `evt:${e.id}: per:${p.id} did not rule pol:${pol} in ${e.year}`);
      }
    }
  }
});

test('states found movements, convert, persecute and issue money only while they exist (#7 and kin)', () => {
  const acting: Record<string, string> = {
    'movement-founding': 'polity', schism: 'polity', conversion: 'polity', persecution: 'persecutor',
    coinage: 'issuer', 'weight-standard': 'issuer', 'paper-money': 'issuer', 'currency-reform': 'issuer', debasement: 'issuer',
  };
  for (const e of s.events) {
    const role = acting[e.sub];
    const ref = role ? e.parts.find(([, r]) => r === role)?.[0] : undefined;
    if (!ref) continue;
    const p = s.polities[Number(ref.slice(4))];
    assert.ok(p.born <= e.year && (p.died === null || p.died > e.year), `evt:${e.id} (${e.sub}, ${e.year}) acts for pol:${p.id} (${p.born}–${p.died})`);
  }
});

test('no coin is struck before its issuer knows coinage (#15), and every state has a stats row (#17)', () => {
  for (const c of s.currencies) {
    if (c.kind !== 'coin') continue;
    const t = s.polities[c.polity].techs.get(TK.coinage);
    assert.ok(t !== undefined && t <= c.born, `cur:${c.id} struck in ${c.born}, coinage known from ${t}`);
  }
  const rows = new Set(s.polityYears.map((r) => r[0] as number));
  for (const p of s.polities) if (p.died !== null || p.born <= 1190) assert.ok(rows.has(p.id), `pol:${p.id} (${p.born}–${p.died}) has no stats row`);
});
