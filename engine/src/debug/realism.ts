// Realism audit of a built world database: battle losses, army sizes, rebel musters, world totals,
// and how often the known simulation bugs (#1, #6, #7, #8, #9, #15, #16, #17) occur.
// Usage: node engine/src/debug/realism.ts <a.sqlite> [b.sqlite ...]  (one column per database)
import { DatabaseSync } from 'node:sqlite';
import { yearEra } from '../sim/people.ts';
import { TK } from '../sim/tech.ts';

type Row = Record<string, unknown>;
const ERAS = ['Bronze (<1750)', 'Iron (<2350)', 'Classical (<3200)', 'Medieval (<4300)', 'Early modern (<4760)', 'Industrial (<4950)', 'Post-ind. (≥4950)'];

function pct(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const a = xs.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1) + 0.5)))];
}
const fmt = (x: number) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '–');
const pc = (a: number, b: number) => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : '–');

export function audit(path: string): Map<string, string> {
  const db = new DatabaseSync(path, { readOnly: true });
  const all = (sql: string) => db.prepare(sql).all() as Row[];
  const out = new Map<string, string>();
  const put = (k: string, v: string | number) => out.set(k, typeof v === 'number' ? fmt(v) : v);

  const polities = new Map<number, { born: number; died: number | null; kind: string; techs: Map<number, number> }>();
  for (const p of all('SELECT id, born, died, kind, techs FROM polities')) {
    polities.set(Number(p.id), { born: Number(p.born), died: p.died === null ? null : Number(p.died), kind: String(p.kind), techs: new Map(JSON.parse(String(p.techs)) as [number, number][]) });
  }
  const parts = new Map<number, [string, string][]>();
  for (const r of all("SELECT event, ref, role FROM event_parts WHERE event IN (SELECT id FROM events WHERE sub IN ('battle','treaty','conquest','suppression','conversion','movement-founding','schism'))")) {
    const e = Number(r.event);
    if (!parts.has(e)) parts.set(e, []);
    parts.get(e)!.push([String(r.ref), String(r.role)]);
  }
  const events = all("SELECT id, sub, year, data FROM events WHERE sub IN ('battle','war','treaty','conquest','suppression','conversion','movement-founding','schism')");
  const wars = new Map<number, Row>();
  for (const e of events) if (e.sub === 'war') wars.set(Number(e.id), JSON.parse(String(e.data)));

  // ------------------------------------------------------------ battles
  let n = 0, winnerMore = 0, rout = 0, routLoser3x = 0;
  const ratios: number[] = [];
  const byEra: number[][] = ERAS.map(() => []);
  const tiny: number[] = ERAS.map(() => 0);
  const rebels: { size: number; enemy: number; lossR: number; lossE: number; year: number; id: number }[] = [];
  for (const e of events) {
    if (e.sub !== 'battle') continue;
    const d = JSON.parse(String(e.data));
    const year = Number(e.year);
    const aWins = (parts.get(Number(e.id)) ?? []).some(([ref, r]) => r === 'attacker' && ref === `pol:${d.winner}`);
    const lw = aWins ? d.attackerLosses : d.defenderLosses;
    const ll = aWins ? d.defenderLosses : d.attackerLosses;
    n++;
    if (lw > ll) winnerMore++;
    ratios.push(lw > 0 ? ll / lw : ll > 0 ? 99 : 1);
    if (Number(d.decisive) >= 0.75) { rout++; if (ll >= 3 * lw) routLoser3x++; }
    const era = yearEra(year);
    byEra[era].push(Number(d.attackerSize), Number(d.defenderSize));
    if (Math.min(Number(d.attackerSize), Number(d.defenderSize)) < 100) tiny[era]++;
    const w = wars.get(Number(d.war));
    if (w && (w.goal === 'independence' || w.goal === 'civil')) rebels.push({ size: Number(d.attackerSize), enemy: Number(d.defenderSize), lossR: Number(d.attackerLosses), lossE: Number(d.defenderLosses), year, id: Number(e.id) });
  }
  put('Battles', n);
  put('Winner loses more men (#16)', `${pc(winnerMore, n)} (${fmt(winnerMore)})`);
  put('Median loser/winner loss ratio', pct(ratios, 0.5).toFixed(2));
  put('Routs (decisive ≥ 0.75): loser loses ≥ 3× winner', `${pc(routLoser3x, rout)} of ${fmt(rout)}`);
  ERAS.forEach((name, i) => {
    const xs = byEra[i];
    put(`Army per side, ${name}: p5 / p50 / p95`, xs.length ? `${fmt(pct(xs, 0.05))} / ${fmt(pct(xs, 0.5))} / ${fmt(pct(xs, 0.95))}` : '–');
  });
  const tinyAll = tiny.reduce((a, b) => a + b, 0);
  put('Battles with a side under 100 men (#1)', `${pc(tinyAll, n)} (${fmt(tinyAll)})`);
  rebels.sort((a, b) => a.size - b.size);
  put('Rebel/claimant battles', rebels.length);
  put('Rebel armies: p5 / p50', `${fmt(pct(rebels.map((r) => r.size), 0.05))} / ${fmt(pct(rebels.map((r) => r.size), 0.5))}`);
  put('Rebel armies under 300 men (#1)', `${pc(rebels.filter((r) => r.size < 300).length, rebels.length)} (${fmt(rebels.filter((r) => r.size < 300).length)})`);
  put('Smallest rebel armies (rebels vs crown, losses)', rebels.slice(0, 3).map((r) => `${fmt(r.size)} vs ${fmt(r.enemy)} (${fmt(r.lossR)}/${fmt(r.lossE)}, AY ${r.year})`).join('; '));

  // ------------------------------------------------------------ armies vs population (#6)
  const py = all('SELECT polity, year, pop, army, era FROM polity_years');
  const share: number[][] = ERAS.map(() => []);
  let over6 = 0;
  for (const r of py) {
    const pop = Number(r.pop), army = Number(r.army);
    if (pop <= 0) continue;
    share[Number(r.era)].push(army / pop);
    if (army / pop > 0.06) over6++;
  }
  put('Polity-decades with army > 6% of population (#6)', `${pc(over6, py.length)} (${fmt(over6)})`);
  put('Army / population, median by era', share.map((xs) => (xs.length ? `${(100 * pct(xs, 0.5)).toFixed(1)}%` : '–')).join(' · '));
  put('Largest recorded army', Math.max(...py.map((r) => Number(r.army))));

  // ------------------------------------------------------------ world totals
  put('States (polities)', polities.size);
  put('Wars', [...wars.keys()].length);
  const cnt = (sub: string) => Number((all(`SELECT count(*) AS n FROM events WHERE sub = '${sub}'`)[0] as Row).n);
  put('Collapses', cnt('collapse'));
  put('Revolts / civil wars', `${fmt(cnt('revolt'))} / ${fmt(cnt('civil-war'))}`);
  put('Conquests (annexations)', cnt('conquest'));
  put('Events (all)', Number((all('SELECT count(*) AS n FROM events')[0] as Row).n));
  const cent = new Map(all('SELECT year, population FROM centuries').map((r) => [Number(r.year), Number(r.population)]));
  put('World population AY 1000 / 2000 / 3000 / 4000 / 5000 (M)', [1000, 2000, 3000, 4000, 5000].map((y) => ((cent.get(y) ?? NaN) / 1e6).toFixed(1)).join(' / '));

  // ------------------------------------------------------------ fixed-bug recurrence
  const persons = new Map<number, { died: number; deathEvent: number | null }>();
  for (const r of all('SELECT id, died, death_event FROM persons')) persons.set(Number(r.id), { died: Number(r.died), deathEvent: r.death_event === null ? null : Number(r.death_event) });
  const roles = new Map<string, [number, number][]>(); // `${person}:${polity}` -> head-of-state spans
  for (const r of all("SELECT person, polity, start, end_year FROM roles WHERE role IN ('ruler','president','chairman')")) {
    const k = `${r.person}:${r.polity}`;
    if (!roles.has(k)) roles.set(k, []);
    roles.get(k)!.push([Number(r.start), r.end_year === null ? Infinity : Number(r.end_year)]);
  }
  let sig = 0, deadSig = 0, conv = 0, wrongRuler = 0, found = 0, deadPol = 0;
  for (const e of events) {
    const id = Number(e.id), year = Number(e.year);
    const ps = parts.get(id) ?? [];
    if (e.sub === 'treaty' || e.sub === 'conquest' || e.sub === 'suppression') {
      for (const [ref, role] of ps) {
        if (role !== 'signatory') continue;
        sig++;
        // dead before the treaty: in an earlier year, or earlier the same year (a death recorded by an older
        // event); a vanquished ruler executed under the treaty itself, or killed after it, signed it first
        const who = persons.get(Number(ref.slice(4)))!;
        if (who.died < year || (who.died === year && (who.deathEvent === null || who.deathEvent < id))) deadSig++;
      }
    } else if (e.sub === 'conversion') {
      const pol = ps.find(([, r]) => r === 'polity')?.[0].slice(4);
      const ruler = ps.find(([, r]) => r === 'ruler')?.[0].slice(4);
      if (ruler === undefined) continue;
      conv++;
      const spans = roles.get(`${ruler}:${pol}`) ?? [];
      if (!spans.some(([a, b]) => a <= year && year <= b)) wrongRuler++;
    } else if (e.sub === 'movement-founding' || e.sub === 'schism') {
      const pol = ps.find(([, r]) => r === 'polity')?.[0].slice(4);
      if (pol === undefined) continue;
      found++;
      const p = polities.get(Number(pol))!;
      if (!(p.born <= year && (p.died === null || p.died > year))) deadPol++;
    }
  }
  put('#9 treaty signatories already dead', `${fmt(deadSig)} of ${fmt(sig)}`);
  put('#8 conversions naming a ruler not in office', `${fmt(wrongRuler)} of ${fmt(conv)}`);
  put('#7 movement foundings naming an ended polity', `${fmt(deadPol)} of ${fmt(found)}`);
  let coins = 0, early = 0;
  for (const c of all("SELECT polity, born FROM currencies WHERE kind = 'coin'")) {
    coins++;
    const t = polities.get(Number(c.polity))!.techs.get(TK.coinage);
    if (t === undefined || t > Number(c.born)) early++;
  }
  put('#15 coin currencies before the coinage tech', `${fmt(early)} of ${fmt(coins)}`);
  const withRows = new Set(py.map((r) => Number(r.polity)));
  put('#17 polities without a stats row', `${fmt([...polities.keys()].filter((id) => !withRows.has(id)).length)} of ${fmt(polities.size)}`);
  // unfiled relatives of #7: decadal steps acting for a polity that ended earlier in the decade
  const ended = (pid: number, year: number) => { const p = polities.get(pid)!; return p.died !== null && p.died <= year; };
  let posthumous = 0, acts = 0;
  for (const r of all("SELECT e.year AS year, ep.ref AS ref FROM events e JOIN event_parts ep ON ep.event = e.id WHERE (e.sub = 'conversion' AND ep.role = 'polity') OR (e.sub = 'persecution' AND ep.role = 'persecutor') OR (e.sub IN ('coinage','weight-standard','paper-money','currency-reform') AND ep.role = 'issuer')")) {
    acts++;
    if (ended(Number(String(r.ref).slice(4)), Number(r.year))) posthumous++;
  }
  put('Conversions, persecutions and currencies by an ended polity', `${fmt(posthumous)} of ${fmt(acts)}`);
  db.close();
  return out;
}

if (import.meta.main) {
  const paths = process.argv.slice(2);
  const cols = paths.map((p) => audit(p));
  const keys = [...cols[0].keys()];
  const head = paths.map((p) => p.split('/').slice(-1)[0].replace(/\.sqlite$/, ''));
  console.log(`| Measure | ${head.join(' | ')} |`);
  console.log(`|---|${head.map(() => '---').join('|')}|`);
  for (const k of keys) console.log(`| ${k} | ${cols.map((c) => c.get(k) ?? '–').join(' | ')} |`);
}
