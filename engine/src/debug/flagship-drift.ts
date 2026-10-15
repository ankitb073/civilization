// Which flagships does a change to the record leave stale? Compares two built databases of the same world
// (same fingerprint) and lists, per wave, the flagships that quote a battle or war figure that changed, or cite
// a catalogue number that vanished, now names another document, or whose text changed.
// Usage: node engine/src/debug/flagship-drift.ts <before.sqlite> <after.sqlite> [flagships dir] [--list]
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

type Row = Record<string, unknown>;
const [beforePath, afterPath, dir = 'flagships'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const list = process.argv.includes('--list');
const WAVES: [number, number][] = [[1, 190], [201, 249], [301, 549], [601, 640], [701, 807], [900, 920]];
const NUM = /(?<![\w·])(\d{1,3}(?:,\d{3})+|\d{2,})(?![\w·])/g;
const MEN = /\b(men|man|dead|soldiers|fallen|slain|warriors|killed|losses|lost|army|armies|spears|host|strong|troops|casualties)\b/i;

function open(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  const all = (sql: string) => db.prepare(sql).all() as Row[];
  const docs = new Map<string, { id: string; body: string }>();
  for (const r of all('SELECT catalog, sub, year, title, about, body FROM artifacts')) {
    docs.set(String(r.catalog), { id: `${r.sub}|${r.year}|${r.title}|${r.about}`, body: createHash('md5').update(String(r.body ?? '')).digest('hex') });
  }
  const ev = new Map<number, { sub: string; d: Record<string, number> }>();
  const battlesOf = new Map<number, number[]>();
  for (const r of all("SELECT id, sub, data FROM events WHERE sub IN ('battle','war')")) {
    const d = JSON.parse(String(r.data ?? '{}'));
    ev.set(Number(r.id), { sub: String(r.sub), d });
    if (r.sub === 'battle') battlesOf.set(d.war, [...(battlesOf.get(d.war) ?? []), Number(r.id)]);
  }
  const figures = (e: number): Set<number> => {
    const x = ev.get(e);
    if (!x) return new Set();
    if (x.sub === 'battle') return new Set(['attackerSize', 'defenderSize', 'attackerLosses', 'defenderLosses'].map((k) => Number(x.d[k] ?? 0)));
    const out = new Set([Number(x.d.lossesA ?? 0), Number(x.d.lossesD ?? 0)]);
    for (const b of battlesOf.get(e) ?? []) for (const f of figures(b)) out.add(f);
    return out;
  };
  db.close();
  return { docs, figures };
}

const A = open(beforePath), B = open(afterPath);
const keys = ['files', 'quote changed figures', 'cite a missing or different document', 'cite a document whose text changed', 'need any revision'];
const rows = new Map<string, Map<string, number>>();
const flagged: string[] = [];
for (const f of readdirSync(dir).filter((x) => /^fl-\d+\.md$/.test(x)).sort()) {
  const txt = readFileSync(`${dir}/${f}`, 'utf8');
  const n = Number(f.slice(3, -3));
  const [a, b] = WAVES.find(([lo, hi]) => lo <= n && n <= hi) ?? [n, n];
  const wave = `fl-${String(a).padStart(3, '0')}–${String(b).padStart(3, '0')}`;
  const r = rows.get(wave) ?? new Map<string, number>();
  rows.set(wave, r);
  const bump = (k: string) => r.set(k, (r.get(k) ?? 0) + 1);
  bump('files');
  const body = txt.split('\n---\n').slice(1).join('\n---\n');
  const ids = new Set([...txt.matchAll(/evt:(\d+)/g)].map((m) => Number(m[1])));
  const before = new Set<number>(), after = new Set<number>();
  for (const i of ids) { for (const x of A.figures(i)) before.add(x); for (const x of B.figures(i)) after.add(x); }
  const stale = new Set([...before].filter((x) => x >= 10 && !after.has(x)));
  const quotes = [...body.matchAll(NUM)].filter((m) => stale.has(Number(m[1].replaceAll(',', ''))) && MEN.test(body.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60)));
  const cites = new Set([...txt.matchAll(/PAL·[A-Z]{2,3}·\d+/g)].map((m) => m[0]));
  const broken = [...cites].filter((c) => !B.docs.has(c) || A.docs.get(c)?.id !== B.docs.get(c)!.id);
  const changed = [...cites].filter((c) => B.docs.has(c) && A.docs.get(c)?.id === B.docs.get(c)!.id && A.docs.get(c)!.body !== B.docs.get(c)!.body);
  if (quotes.length) bump('quote changed figures');
  if (broken.length) bump('cite a missing or different document');
  if (changed.length) bump('cite a document whose text changed');
  if (quotes.length || broken.length || changed.length) {
    bump('need any revision');
    flagged.push(`${f}: ${quotes.length} figures${broken.length ? `; re-cite ${broken.join(', ')}` : ''}${changed.length ? `; check quotes of ${changed.join(', ')}` : ''}`);
  }
}
console.log(`| Wave | ${keys.join(' | ')} |`);
console.log(`|---|${keys.map(() => '---').join('|')}|`);
const tot = new Map<string, number>();
for (const [w, r] of [...rows].sort()) {
  for (const k of keys) tot.set(k, (tot.get(k) ?? 0) + (r.get(k) ?? 0));
  console.log(`| ${w} | ${keys.map((k) => r.get(k) ?? 0).join(' | ')} |`);
}
console.log(`| **All** | ${keys.map((k) => tot.get(k) ?? 0).join(' | ')} |`);
if (list) for (const l of flagged) console.log(l);
