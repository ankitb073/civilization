// Revision packets: what a change to the record means for each flagship. Compares two built databases of the same
// world (same fingerprint) and writes, per flagship, the figures, participants, armies and documents it relies on
// that changed, plus leads: numbers in its text (digits or words) that match an old figure and no new one, and
// phrases about relative losses that may have flipped. A reviser agent works from the packet (decision 0015).
// Usage: node engine/src/debug/flagship-packets.ts <before.sqlite> <after.sqlite> [--out=dir] [--flagships=dir]
//          [--dossiers-before=dir --dossiers-after=dir] [fl-NNN …]
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

type Row = Record<string, unknown>;
const args = process.argv.slice(2);
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const [beforePath, afterPath, ...only] = args.filter((a) => !a.startsWith('--'));
const OUT = opt('out', 'build/packets'), DIR = opt('flagships', 'flagships');
const DOSS_B = opt('dossiers-before', ''), DOSS_A = opt('dossiers-after', '');
if (!beforePath || !afterPath) { console.error('usage: flagship-packets.ts <before.sqlite> <after.sqlite> [--out=dir] [fl-NNN …]'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const FIG = ['attackerSize', 'defenderSize', 'attackerLosses', 'defenderLosses', 'lossesA', 'lossesD'];
type Ev = { sub: string; year: number; d: Record<string, unknown> };
function load(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  const all = (sql: string) => db.prepare(sql).all() as Row[];
  const ev = new Map<number, Ev>();
  for (const r of all('SELECT id, sub, year, data FROM events')) ev.set(Number(r.id), { sub: String(r.sub), year: Number(r.year), d: JSON.parse(String(r.data ?? '{}')) });
  const parts = new Map<number, Set<string>>();
  for (const r of all('SELECT event, ref, role FROM event_parts')) {
    const k = Number(r.event);
    if (!parts.has(k)) parts.set(k, new Set());
    parts.get(k)!.add(`${r.role}\t${r.ref}`);
  }
  const army = new Map<string, number>(), pop = new Map<string, number>();
  for (const r of all('SELECT polity, year, army, pop FROM polity_years')) { army.set(`${r.polity}:${r.year}`, Number(r.army)); pop.set(`${r.polity}:${r.year}`, Number(r.pop)); }
  const docs = new Map<string, { id: number; sub: string; year: number; title: string; about: string; body: string }>();
  for (const r of all('SELECT id, catalog, sub, year, title, about, body FROM artifacts')) docs.set(String(r.catalog), { id: Number(r.id), sub: String(r.sub), year: Number(r.year), title: String(r.title), about: String(r.about), body: String(r.body ?? '') });
  const title = new Map<string, string>();
  for (const r of all('SELECT id, title FROM pages')) title.set(String(r.id), String(r.title));
  const linksTo = new Map<string, string[]>();
  for (const r of all("SELECT source, target FROM links WHERE source LIKE 'art:%' AND target LIKE 'evt:%'")) {
    const t = String(r.target);
    if (!linksTo.has(t)) linksTo.set(t, []);
    linksTo.get(t)!.push(String(r.source));
  }
  db.close();
  return { ev, parts, army, pop, docs, title, linksTo };
}
const B = load(beforePath), A = load(afterPath);
const T = (ref: string) => A.title.get(ref) ?? B.title.get(ref) ?? ref;
const figs = (W: typeof A, i: number): Record<string, number> => {
  const e = W.ev.get(i);
  const o: Record<string, number> = {};
  if (e) for (const k of FIG) if (e.d[k] !== undefined) o[k] = Number(e.d[k]);
  return o;
};
const battlesOf = new Map<number, number[]>(), byPol = new Map<number, number[]>();
for (const [i, e] of A.ev) {
  if (e.sub === 'battle' && e.d.war !== undefined) { const w = Number(e.d.war); battlesOf.set(w, [...(battlesOf.get(w) ?? []), i]); }
  if (e.sub !== 'battle' && e.sub !== 'war') continue;
  for (const p of A.parts.get(i) ?? []) {
    const [role, ref] = p.split('\t');
    if ((role === 'attacker' || role === 'defender') && ref.startsWith('pol:')) { const k = Number(ref.slice(4)); byPol.set(k, [...(byPol.get(k) ?? []), i]); }
  }
}
const evByTitle = new Map<string, number>();
for (const [ref, t] of A.title) if (ref.startsWith('evt:') && !evByTitle.has(t)) evByTitle.set(t, Number(ref.slice(4)));

// numbers in text, digits or words
const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = 'twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
const W = '(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|half|score)';
const WORDS = new RegExp(`\\b${W}(?:[\\s-]+(?:and[\\s-]+)?${W})*\\b`, 'gi');
const DIGITS = /(?<![\w·])(\d+(?:[.,]\d+)*)\s*(million|thousand|m\b|k\b)?/gi;
function wordValue(s: string): number | null {
  const toks = s.toLowerCase().split(/[\s-]+/).filter((w) => w && w !== 'and').map((w) => (/^(hundreds|thousands|millions)$/.test(w) ? w.slice(0, -1) : w));
  if (!toks.some((w) => ONES.includes(w) || TENS.includes(w) || ['hundred', 'thousand', 'million', 'score'].includes(w))) return null;
  let total = 0, cur = 0;
  for (const w of toks) {
    if (w === 'a' || w === 'an') cur = cur || 1;
    else if (w === 'half') cur = cur === 0 ? 0.5 : cur + 0.5;
    else if (ONES.includes(w)) cur += ONES.indexOf(w);
    else if (TENS.includes(w)) cur += 10 * (TENS.indexOf(w) + 2);
    else if (w === 'hundred') cur = (cur || 1) * 100;
    else if (w === 'score') cur = (cur || 1) * 20;
    else { total += (cur || 1) * (w === 'thousand' ? 1e3 : 1e6); cur = 0; }
  }
  const v = total + cur;
  return v >= 10 ? v : null;
}
function numbers(text: string): { at: number; end: number; v: number; s: string }[] {
  const out: { at: number; end: number; v: number; s: string }[] = [];
  for (const m of text.matchAll(DIGITS)) {
    const sc = (m[2] ?? '').toLowerCase();
    if (/^\d{4}$/.test(m[1]) && !sc) continue; // a year
    let v = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(v)) continue;
    v *= sc === 'million' || sc === 'm' ? 1e6 : sc === 'thousand' || sc === 'k' ? 1e3 : 1;
    if (v >= 10) out.push({ at: m.index!, end: m.index! + m[0].length, v, s: m[0] });
  }
  for (const m of text.matchAll(WORDS)) { const v = wordValue(m[0]); if (v) out.push({ at: m.index!, end: m.index! + m[0].length, v, s: m[0] }); }
  return out;
}
const MEN = /\b(men|man|dead|soldiers|fallen|slain|warriors|killed|losses|lost|army|armies|spears|host|strong|troops|casualties|under arms|levy|levies|muster|mustered|killing|kill)\b/i;
const near = (v: number, f: number, tol: number) => f > 0 && Math.abs(v - f) / f <= tol;
const PHRASES = /(a handful of (men|rebels|soldiers|spears)|few dozen|dozen (men|rebels|spears)|score of (men|spears)|lost more (men )?than|more of (ours|us|our) (fell|died|than)|more (men|dead) than (the enemy|they|we)|costl(y|iest) victor|pyrrhic|paid more in blood|bled .{0,20}white|victors? (lost|paid) more|won .{0,30}(at|for) (a|great) (high |terrible |heavy )?(cost|price)|outnumbered (ten|twenty|a hundred|fifty|a thousand)|(hundred|thousand) to one)/gi;

function sentDiff(a: string, b: string, limit = 40): string[] {
  const sa = a.split(/(?<=[.!?])\s+|\n+/), sb = b.split(/(?<=[.!?])\s+|\n+/);
  const inB = new Set(sb), inA = new Set(sa);
  const out = [...sa.filter((x) => !inB.has(x)).map((x) => `    - ${x.slice(0, 700)}`), ...sb.filter((x) => !inA.has(x)).map((x) => `    + ${x.slice(0, 700)}`)];
  return out.length > limit ? [...out.slice(0, limit), '    … (more changes)'] : out;
}
function dossiers(dir: string) {
  const m = new Map<string, { facts: string[] }>();
  if (!dir || !existsSync(dir)) return m;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    m.set(`${j.subject.id}|${j.form}`, { facts: [...j.subject.facts, ...(Array.isArray(j.context) ? j.context : [])].map(String) });
  }
  return m;
}
const DB_ = dossiers(DOSS_B), DA_ = dossiers(DOSS_A);

const files = readdirSync(DIR).filter((x) => /^fl-\d+\.md$/.test(x)).map((x) => x.slice(0, -3)).filter((x) => !only.length || only.includes(x)).sort();
const flagged: string[] = [];
for (const fid of files) {
  const raw = readFileSync(join(DIR, `${fid}.md`), 'utf8');
  const [fm, ...rest] = raw.replace(/^---\n/, '').split('\n---\n');
  const body = rest.join('\n---\n');
  const year = Number(fm.match(/^year: (-?\d+)/m)?.[1] ?? 0);
  const subject = fm.match(/^subject: (.*)$/m)?.[1] ?? '', form = fm.match(/^form: (.*)$/m)?.[1] ?? '';
  const linked = new Set([...body.matchAll(/\[\[evt:(\d+)\|/g)].map((m) => Number(m[1])));
  const pols = new Set([...body.matchAll(/\[\[pol:(\d+)\|/g)].map((m) => Number(m[1])));
  const fp = fm.match(/^polity: pol:(\d+)/m); if (fp) pols.add(Number(fp[1]));
  const db = DB_.get(`${subject}|${form}`), da = DA_.get(`${subject}|${form}`);
  const named = new Set<number>();
  for (const line of db?.facts ?? []) { const m = line.match(/^(.*? \(AY -?\d+\))(?: \(AY -?\d+\))?:/); if (m && evByTitle.has(m[1])) named.add(evByTitle.get(m[1])!); }
  const evs = new Set([...linked, ...named]);
  for (const i of [...evs]) if (A.ev.get(i)?.sub === 'war') for (const b of battlesOf.get(i) ?? []) evs.add(b);
  const yrs = [...linked].map((i) => A.ev.get(i)?.year).filter((y): y is number => y !== undefined);
  const lo = yrs.length ? Math.min(...yrs) - 30 : year - 60, hi = yrs.length ? (year < 4800 ? Math.min(year, Math.max(...yrs) + 10) : Math.max(...yrs) + 10) : year;
  const wide = new Set(evs);
  for (const p of pols) for (const i of byPol.get(p) ?? []) { const y = A.ev.get(i)!.year; if (lo <= y && y <= hi) wide.add(i); }
  const reasons = new Set<string>(), out: string[] = [];

  // events: figures and participants
  const evLines: string[] = [];
  for (const i of [...evs].sort((x, y) => (A.ev.get(x)?.year ?? 0) - (A.ev.get(y)?.year ?? 0) || x - y)) {
    const fb = figs(B, i), fa = figs(A, i);
    const ch = FIG.filter((k) => fb[k] !== fa[k]).map((k) => `${k} ${fb[k] ?? '-'} → ${fa[k] ?? '-'}`);
    const pb = B.parts.get(i) ?? new Set(), pa = A.parts.get(i) ?? new Set();
    const gone = [...pb].filter((x) => !pa.has(x)).map((x) => { const [r, ref] = x.split('\t'); return `${r}: ${T(ref)} [${ref}]`; });
    const added = [...pa].filter((x) => !pb.has(x)).map((x) => { const [r, ref] = x.split('\t'); return `${r}: ${T(ref)} [${ref}]`; });
    if (!ch.length && !gone.length && !added.length) continue;
    const e = A.ev.get(i)!;
    const role = new Map([...pa].map((x) => x.split('\t') as [string, string]));
    const sides = e.sub === 'battle' ? ` (attacker ${T(role.get('attacker') ?? '?')}, led by ${T(role.get('attacking commander') ?? '?')}; defender ${T(role.get('defender') ?? '?')}, led by ${T(role.get('defending commander') ?? '?')}; won by ${T(role.get('victor') ?? '?')})` : '';
    evLines.push(`  evt:${i} ${T(`evt:${i}`)} [${e.sub}, AY ${e.year}] (${linked.has(i) ? 'LINKED' : named.has(i) ? 'named in dossier' : 'battle of a linked war'})${sides}`);
    if (ch.length) evLines.push(`     figures: ${ch.join('; ')}`);
    if (gone.length) { evLines.push(`     participant REMOVED: ${gone.join('; ')}`); reasons.add('participants'); }
    if (added.length) { evLines.push(`     participant ADDED: ${added.join('; ')}`); reasons.add('participants'); }
  }
  // armies of linked polities around its events
  const armyLines: string[] = [];
  const armyPairs: [number, number][] = [];
  for (const p of [...pols].sort((a, b) => a - b)) {
    const rows: string[] = [];
    for (let y = Math.floor((lo - 10) / 10) * 10; y <= hi; y += 10) {
      const b = B.army.get(`${p}:${y}`), a = A.army.get(`${p}:${y}`);
      if (b === undefined || a === undefined || a === b) continue;
      armyPairs.push([b, a]);
      if (rows.length < 30) rows.push(`${y}s ${b.toLocaleString('en-US')} → ${a.toLocaleString('en-US')} (pop ${(A.pop.get(`${p}:${y}`) ?? 0).toLocaleString('en-US')})`);
    }
    if (rows.length) armyLines.push(`  ${T(`pol:${p}`)} [pol:${p}]: ${rows.join('; ')}`);
  }
  // numbers matching an old value whose own new value differs, and no new value of the same event or row
  const pairs: { old: number; news: number[] }[] = armyPairs.map(([b, a]) => ({ old: b, news: [a] }));
  for (const i of wide) {
    const fb = figs(B, i), fa = figs(A, i), news = Object.values(fa).filter(Boolean);
    for (const [k, v] of Object.entries(fb)) if (v && fa[k] !== v) pairs.push({ old: v, news });
  }
  const masked = body.replace(/\[\[[^\]|]+\|/g, (m) => '[[' + ' '.repeat(m.length - 2)).replace(/PAL·[A-Z]{2,3}·\d+/g, (m) => ' '.repeat(m.length));
  const leads: string[] = [];
  for (const n of numbers(masked)) {
    const ctx = masked.slice(Math.max(0, n.at - 90), n.end + 90);
    if (n.v < 20 || !MEN.test(ctx)) continue;
    // ordinals, ages and durations are not figures
    if (/^(st|nd|rd|th)\b|^[\s-]*(years?|summers?|winters?|harvests?|months?|days?|seasons?)\b/i.test(masked.slice(n.end, n.end + 12))) continue;
    const tol = evs.size && pairs.length < 400 ? 0.12 : 0.06;
    if (pairs.some((p) => near(n.v, p.old, tol) && !p.news.some((x) => near(n.v, x, tol)))) leads.push(`  "${n.s}" ≈ ${Math.round(n.v).toLocaleString('en-US')}: …${ctx.replace(/\s+/g, ' ')}…`);
  }
  for (const m of body.matchAll(PHRASES)) leads.push(`  phrase "${m[0]}": …${body.slice(Math.max(0, m.index! - 100), m.index! + m[0].length + 80).replace(/\s+/g, ' ')}…`);
  if (leads.length) reasons.add('leads');
  // documents it cites
  const docLines: string[] = [];
  const cites = [...new Set([...body.matchAll(/PAL·[A-Z]{2,3}·\d+/g)].map((m) => m[0]))].sort();
  for (const c of cites) {
    const b = B.docs.get(c), a = A.docs.get(c);
    if (!b) continue;
    if (!a || a.sub !== b.sub || a.year !== b.year || a.title !== b.title || a.about !== b.about) {
      reasons.add('re-cite');
      docLines.push(`  CITED ${c} NO LONGER NAMES THIS DOCUMENT. Was: ${b.sub}, AY ${b.year}, "${b.title}". ${a ? `Now: ${a.sub}, AY ${a.year}, "${a.title}".` : 'Now: no document has this number.'}`);
      const cand = [...A.docs].filter(([, x]) => x.sub === b.sub && (x.title === b.title || (x.about === b.about && Math.abs(x.year - b.year) <= 2))).slice(0, 5);
      for (const [k, x] of cand) docLines.push(`    candidate: ${k} ${x.sub} AY ${x.year} "${x.title}"`);
      if (!cand.length) docLines.push('    no candidate with the same title or subject: cite something else or drop the citation');
      docLines.push(`    old text: ${b.body.replace(/\s+/g, ' ').slice(0, 900)}`);
    } else if (a.body !== b.body) {
      reasons.add('cited text changed');
      docLines.push(`  CITED ${c} (${a.sub}, AY ${a.year}, "${a.title}"): text changed:`, ...sentDiff(b.body, a.body));
    }
  }
  // other documents about its events, written by its date, whose text changed
  const relLines: string[] = [];
  const seen = new Set(cites.map((c) => A.docs.get(c)?.id));
  const byArt = new Map([...A.docs].map(([k, x]) => [`art:${x.id}`, { k, x }]));
  for (const i of [...linked].sort((a, b) => a - b)) {
    for (const src of A.linksTo.get(`evt:${i}`) ?? []) {
      const hit = byArt.get(src);
      if (!hit || seen.has(hit.x.id) || hit.x.year > year) continue;
      seen.add(hit.x.id);
      const b = B.docs.get(hit.k);
      if (b && b.body !== hit.x.body && b.title === hit.x.title) relLines.push(`  ${hit.k} (${hit.x.sub}, AY ${hit.x.year}, "${hit.x.title}"), about evt:${i}: text changed:`, ...sentDiff(b.body, hit.x.body, 12));
    }
  }
  // its fact sheet, regenerated
  const ddLines: string[] = [];
  if (db && da) {
    const inA = new Set(da.facts), inB = new Set(db.facts);
    for (const l of db.facts) if (!inA.has(l)) ddLines.push(`  -${l.slice(0, 900)}`);
    for (const l of da.facts) if (!inB.has(l)) ddLines.push(`  +${l.slice(0, 900)}`);
  }
  if (!reasons.size && !ddLines.length) continue;
  flagged.push(`${fid}: ${[...reasons].join(', ') || 'fact sheet changed'}`);
  out.push(`# ${fid}: ${fm.match(/^title: (.*)$/m)?.[1] ?? ''} (AY ${year})`, '');
  if (leads.length) out.push('## Leads: numbers matching an old figure and no new one, and phrases on relative losses (leads, not verdicts)', ...leads, '');
  if (ddLines.length) out.push('## Its fact sheet (dossier), regenerated: lines that changed (- before, + after)', ...ddLines.slice(0, 120), '');
  if (evLines.length) out.push('## Events it links or its dossier names: what changed (before → after)', ...evLines, '');
  if (armyLines.length) out.push('## Armies of polities it links, by decade row (row 1650 = the state at the end of 1659): before → after', ...armyLines, '');
  if (docLines.length) out.push('## Documents it cites by catalogue number', ...docLines, '');
  if (relLines.length) out.push('## Other documents about events it links, written by its date, whose text changed', ...relLines, '');
  writeFileSync(join(OUT, `${fid}.txt`), out.join('\n') + '\n');
}
console.log(`${files.length} flagships; ${flagged.length} need a look (packets in ${OUT}/)`);
for (const l of flagged) console.log(l);
