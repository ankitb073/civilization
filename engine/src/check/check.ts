// The consistency checker. It reads only the world database (no simulation code), so it is an
// independent audit of the archive against the causal record.
import { DatabaseSync } from 'node:sqlite';

export interface InvariantResult {
  id: string;
  title: string;
  checked: number;
  violations: number;
  examples: string[];
}

export interface CheckReport {
  passed: boolean;
  invariants: InvariantResult[];
  ms: number;
}

type Row = Record<string, unknown>;

export function runChecks(dbPath: string): CheckReport {
  const t0 = performance.now();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const all = (sql: string, ...p: (number | string)[]) => db.prepare(sql).all(...p) as Row[];
  const out: InvariantResult[] = [];
  const inv = (id: string, title: string) => {
    const r: InvariantResult = { id, title, checked: 0, violations: 0, examples: [] };
    out.push(r);
    return {
      ok: () => { r.checked++; },
      bad: (msg: string) => { r.checked++; r.violations++; if (r.examples.length < 8) r.examples.push(msg); },
    };
  };

  // ---------------------------------------------------------------- events
  const events = new Map<number, { year: number; end: number; sub: string; data: string }>();
  for (const e of all('SELECT id, year, end_year, sub, data FROM events')) events.set(Number(e.id), { year: Number(e.year), end: Number(e.end_year), sub: String(e.sub), data: String(e.data) });
  {
    const c = inv('causes-precede', 'Every cause is dated no later than its effect');
    for (const r of all('SELECT event, cause FROM event_causes')) {
      const e = events.get(Number(r.event)), k = events.get(Number(r.cause));
      if (!e || !k) { c.bad(`missing event in cause link ${r.event}←${r.cause}`); continue; }
      if (k.year > e.year) c.bad(`evt:${r.event} (${e.year}) caused by evt:${r.cause} (${k.year})`);
      else c.ok();
    }
  }
  {
    const c = inv('causes-acyclic', 'The cause graph is acyclic (causes are recorded before effects)');
    for (const r of all('SELECT event, cause FROM event_causes')) {
      if (Number(r.cause) >= Number(r.event)) c.bad(`evt:${r.event} cites later-recorded evt:${r.cause}`);
      else c.ok();
    }
  }
  {
    const c = inv('event-spans', 'Every event ends no earlier than it begins');
    for (const [id, e] of events) {
      if (e.end < e.year) c.bad(`evt:${id} ends ${e.end} before ${e.year}`);
      else c.ok();
    }
  }

  // ---------------------------------------------------------------- polities & territory
  const polities = new Map<number, { born: number; died: number | null }>();
  for (const p of all('SELECT id, born, died FROM polities')) polities.set(Number(p.id), { born: Number(p.born), died: p.died === null ? null : Number(p.died) });
  {
    const c = inv('territory-ordered', 'Territorial changes are logged in chronological order, never before their causing event');
    const c2 = inv('territory-owner-alive', 'Territory is only ever held by a polity that exists at that date');
    let last = -1e9;
    for (const r of all('SELECT seq, year, cell, owner, event FROM territory_log ORDER BY seq')) {
      const y = Number(r.year);
      const ev = Number(r.event);
      let ok = y >= last;
      if (ev >= 0) {
        const e = events.get(ev);
        if (!e || e.year > y) ok = false;
      }
      if (ok) c.ok(); else c.bad(`seq ${r.seq}: cell ${r.cell} → ${r.owner} at ${y} (event ${ev})`);
      last = Math.max(last, y);
      const o = Number(r.owner);
      if (o >= 0) {
        const p = polities.get(o);
        if (!p || p.born > y || (p.died !== null && p.died < y)) c2.bad(`cell ${r.cell} given to pol:${o} at ${y} outside its life`);
        else c2.ok();
      }
    }
  }
  {
    const c = inv('territory-replay', 'Replaying the territory, culture and religion logs reproduces the final map exactly');
    const n = Number((all('SELECT COUNT(*) AS n FROM cells')[0]).n);
    const owner = new Int32Array(n).fill(-1);
    const culture = new Int32Array(n);
    const religion = new Int32Array(n);
    for (const r of all('SELECT cell, culture, religion FROM initial_state')) { culture[Number(r.cell)] = Number(r.culture); religion[Number(r.cell)] = Number(r.religion); }
    for (const r of all('SELECT cell, owner FROM territory_log ORDER BY seq')) owner[Number(r.cell)] = Number(r.owner);
    for (const r of all('SELECT cell, culture FROM culture_log ORDER BY seq')) culture[Number(r.cell)] = Number(r.culture);
    for (const r of all('SELECT cell, movement FROM religion_log ORDER BY seq')) religion[Number(r.cell)] = Number(r.movement);
    for (const r of all('SELECT cell, owner, culture, religion FROM final_state')) {
      const i = Number(r.cell);
      if (owner[i] !== Number(r.owner) || culture[i] !== Number(r.culture) || religion[i] !== Number(r.religion)) c.bad(`cell ${i}: replay (${owner[i]},${culture[i]},${religion[i]}) ≠ final (${r.owner},${r.culture},${r.religion})`);
      else c.ok();
    }
  }
  {
    const c = inv('treaty-cessions', 'Every district a treaty cedes changes hands at the treaty date, and no other');
    const byEvent = new Map<number, Map<number, number>>();
    for (const r of all('SELECT cell, owner, event, year FROM territory_log WHERE event >= 0')) {
      const ev = Number(r.event);
      let m = byEvent.get(ev);
      if (!m) byEvent.set(ev, (m = new Map()));
      m.set(Number(r.cell), Number(r.owner));
    }
    for (const [id, e] of events) {
      if (e.sub !== 'treaty' && e.sub !== 'conquest' && e.sub !== 'suppression') continue;
      const data = JSON.parse(e.data) as { terms?: { kind: string; to?: number; cells?: number[] }[] };
      for (const t of data.terms ?? []) {
        if (t.kind !== 'cede') continue;
        const logged = byEvent.get(id) ?? new Map();
        for (const cell of t.cells ?? []) {
          if (logged.get(cell) === t.to) c.ok();
          else c.bad(`evt:${id} cedes cell ${cell} to pol:${t.to} but the log has ${logged.get(cell)}`);
        }
      }
    }
  }

  // ---------------------------------------------------------------- people
  const persons = new Map<number, { born: number; died: number }>();
  for (const p of all('SELECT id, born, died FROM persons')) persons.set(Number(p.id), { born: Number(p.born), died: Number(p.died) });
  {
    const c = inv('lifespans', 'Every person dies after being born and holds offices only while alive');
    for (const [id, p] of persons) { if (p.died < p.born) c.bad(`per:${id} dies ${p.died} before birth ${p.born}`); else c.ok(); }
    for (const r of all('SELECT person, role, start, end_year FROM roles')) {
      const p = persons.get(Number(r.person));
      const s = Number(r.start);
      if (!p || s < p.born || s > p.died) c.bad(`per:${r.person} ${r.role} from ${s} outside life ${p?.born}–${p?.died}`);
      else c.ok();
    }
  }
  {
    const c = inv('reigns-disjoint', 'No polity ever has two heads of state at once');
    const byPol = new Map<number, [number, number, number][]>();
    for (const r of all("SELECT person, polity, start, end_year FROM roles WHERE role IN ('ruler','president','chairman') AND polity IS NOT NULL")) {
      const pid = Number(r.polity);
      if (!byPol.has(pid)) byPol.set(pid, []);
      const end = r.end_year === null ? 1e9 : Number(r.end_year);
      byPol.get(pid)!.push([Number(r.start), end, Number(r.person)]);
    }
    for (const [pid, rs] of byPol) {
      rs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      // the same person re-titled is not an overlap
      for (let i = 1; i < rs.length; i++) {
        if (rs[i][0] < rs[i - 1][1] && rs[i][2] !== rs[i - 1][2]) c.bad(`pol:${pid}: per:${rs[i - 1][2]} (${rs[i - 1][0]}–${rs[i - 1][1]}) overlaps per:${rs[i][2]} from ${rs[i][0]}`);
        else c.ok();
      }
    }
  }

  // ---------------------------------------------------------------- documents
  const start = new Map<string, number>();
  const setStart = (prefix: string, sql: string) => { for (const r of all(sql)) start.set(`${prefix}:${r.id}`, Number(r.s)); };
  setStart('pol', 'SELECT id, born AS s FROM polities');
  setStart('per', 'SELECT id, born AS s FROM persons');
  setStart('set', 'SELECT id, founded AS s FROM settlements');
  setStart('mov', 'SELECT id, born AS s FROM movements');
  setStart('dei', 'SELECT id, born AS s FROM deities');
  setStart('cur', 'SELECT id, born AS s FROM currencies');
  setStart('hou', 'SELECT id, born AS s FROM houses');
  setStart('scr', 'SELECT id, born AS s FROM scripts');
  setStart('lan', 'SELECT id, born AS s FROM languages');
  setStart('cul', 'SELECT id, born AS s FROM cultures');
  for (const [id, e] of events) start.set(`evt:${id}`, e.year);
  const scripts = new Map<number, number>();
  for (const r of all('SELECT id, born FROM scripts')) scripts.set(Number(r.id), Number(r.born));
  const langs = new Map<number, number>();
  for (const r of all('SELECT id, born FROM languages')) langs.set(Number(r.id), Number(r.born));
  const arts = all('SELECT id, year, author, lang, script, body, data, sub FROM artifacts');
  {
    const c = inv('no-anachronism', 'No document mentions a person, place, state, faith, coin or event that did not yet exist');
    const LINK = /\[\[([a-z]{3}:\d+)\|/g;
    for (const a of arts) {
      const year = Number(a.year);
      const text = String(a.body).split('\n---\n')[0];
      for (const m of text.matchAll(LINK)) {
        const ref = m[1];
        const s = start.get(ref);
        if (s === undefined) continue; // regions, rivers, techs: timeless
        if (s > year) c.bad(`art:${a.id} (AY ${year}) mentions ${ref} (from AY ${s})`);
        else c.ok();
      }
    }
  }
  {
    const c = inv('authors-alive', 'Every document was written by a person alive and of age at its date');
    for (const a of arts) {
      if (a.author === null) continue;
      const p = persons.get(Number(a.author));
      const y = Number(a.year);
      if (!p || y < p.born + 12 || y > p.died) c.bad(`art:${a.id} (AY ${y}) by per:${a.author} (${p?.born}–${p?.died})`);
      else c.ok();
    }
  }
  {
    const c = inv('script-language-exist', 'Every document is in a language and script that existed at its date');
    for (const a of arts) {
      const y = Number(a.year);
      const lb = langs.get(Number(a.lang));
      const sc = Number(a.script);
      const sb = sc >= 0 ? scripts.get(sc) : undefined;
      if (lb === undefined || lb > y || (sc >= 0 && (sb === undefined || sb > y))) c.bad(`art:${a.id} (AY ${y}) lang ${a.lang} (${lb}) script ${sc} (${sb})`);
      else c.ok();
    }
  }
  {
    const c = inv('ledger-prices', 'Every ledger price is within 20% of the simulated market price for that place, good and decade');
    const prices = new Map<string, number>();
    for (const r of all('SELECT year, settlement, good, price FROM prices')) prices.set(`${r.settlement}:${r.good}:${r.year}`, Number(r.price));
    for (const a of arts) {
      if (a.sub !== 'ledger') continue;
      const data = JSON.parse(String(a.data)) as { entries?: { market: number; good: number; unit: number; grams: number }[] };
      for (const e of data.entries ?? []) {
        let ref: number | undefined;
        for (let y = Math.floor(Number(a.year) / 10) * 10; y >= Number(a.year) - 60 && ref === undefined; y -= 10) ref = prices.get(`${e.market}:${e.good}:${y}`);
        if (ref === undefined) { c.bad(`art:${a.id}: no market price for ${e.market}/${e.good}`); continue; }
        const silver = e.unit * e.grams;
        if (Math.abs(silver / ref - 1) > 0.2) c.bad(`art:${a.id}: ${silver.toFixed(2)} g vs market ${ref.toFixed(2)} g`);
        else c.ok();
      }
    }
  }
  {
    const c = inv('links-resolve', 'Every link resolves to a page, and every page lists the pages that link to it');
    const pagesSet = new Set<string>(all('SELECT DISTINCT source AS s FROM links').map((r) => String(r.s)));
    for (const r of all('SELECT id FROM pages')) pagesSet.add(String(r.id));
    const back = new Map<string, number>();
    for (const r of all('SELECT target, COUNT(*) AS n FROM links GROUP BY target')) back.set(String(r.target), Number(r.n));
    for (const r of all('SELECT source, target FROM links')) {
      if (!pagesSet.has(String(r.target))) c.bad(`${r.source} → missing ${r.target}`);
      else c.ok();
    }
    for (const r of all('SELECT id, backlinks FROM pages')) {
      const n = back.get(String(r.id)) ?? 0;
      if (Number(r.backlinks) !== n) c.bad(`${r.id}: lists ${r.backlinks} backlinks, links table has ${n}`);
      else c.ok();
    }
  }
  db.close();
  return { passed: out.every((r) => r.violations === 0), invariants: out, ms: Math.round(performance.now() - t0) };
}
