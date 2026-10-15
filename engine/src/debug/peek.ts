// Print sample pages from a full archive build: node engine/src/debug/peek.ts <seed> <sub|kind> [n]
import { simulate } from '../sim/run.ts';
import { buildArchive } from '../archive/build.ts';
const seed = Number(process.argv[2] ?? 1);
const what = process.argv[3] ?? 'treaty';
const n = Number(process.argv[4] ?? 1);
const r = simulate(seed, 5000);
const a = buildArchive(r);
const counts = new Map<string, number>();
for (const p of a.pages.values()) counts.set(p.kind + (p.kind === 'artifact' ? ':' + p.sub : ''), (counts.get(p.kind + (p.kind === 'artifact' ? ':' + p.sub : '')) ?? 0) + 1);
console.log([...counts].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}=${v}`).join(' '));
const pool = [...a.pages.values()].filter((p) => p.sub === what || p.kind === what);
for (let i = 0; i < n; i++) {
  const p = pool[Math.floor((i + 0.5) * pool.length / n)];
  if (!p) break;
  console.log('\n==== ' + p.id + ' | ' + p.title + ' [' + p.kind + '/' + p.sub + '] ' + p.t0);
  console.log('SUMMARY: ' + p.summary);
  for (const [k, v] of p.infobox) console.log('  ' + k + ': ' + v);
  console.log(p.body);
  if (p.artifact?.interlinear) { const il = p.artifact.interlinear; console.log('TRANSLIT: ' + il.transliteration + '\nNORM: ' + il.normalized + '\nGLOSS: ' + il.tokens.map(t => t.segmented + '=' + t.gloss).join(' ')); }
  if (p.artifact?.ledger) { console.log(p.artifact.ledger.columns.join(' | ')); for (const r of p.artifact.ledger.rows.slice(0, 6)) console.log(r.join(' | ')); }
  if (p.names) console.log('NAMES: ' + p.names.map(x => `${x.year}:${x.lang}:${x.form}`).join('  '));
}
