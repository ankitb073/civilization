// Write flagship dossiers for the canonical world: build/dossiers/fl-NNN.json
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { simulate } from '../sim/run.ts';
import { buildArchive } from '../archive/build.ts';
import { buildDossiers, buildHistoriography, buildWave2, buildLives, buildVoices } from '../flagships/dossier.ts';
import { buildHistory } from '../flagships/history.ts';
import { worldFingerprint } from '../export/export.ts';

const seed = Number(process.argv[2] ?? 5);
const limit = Number(process.argv[3] ?? 240);
const r = simulate(seed, 5000);
const a = buildArchive(r);
const wave = process.argv.find((x) => x.startsWith('--wave='))?.slice(7) ?? '1';
let ds;
if (wave === '5') {
  ds = buildHistory(a);
} else if (wave === '4') {
  const { readdirSync, readFileSync } = await import('node:fs');
  const exclude = new Set<string>();
  for (const f of readdirSync('build/dossiers')) { const j = JSON.parse(readFileSync(`build/dossiers/${f}`, 'utf8')); exclude.add(j.subject.id); }
  ds = buildVoices(a, exclude);
} else if (wave === '3') {
  const { readdirSync, readFileSync } = await import('node:fs');
  const exclude = new Set<string>();
  for (const f of readdirSync('build/dossiers')) { const j = JSON.parse(readFileSync(`build/dossiers/${f}`, 'utf8')); exclude.add(j.subject.id); }
  ds = buildLives(a, exclude);
} else if (wave === '2') {
  const { readdirSync, readFileSync } = await import('node:fs');
  const exclude = new Set<string>();
  for (const f of readdirSync('build/dossiers')) { const j = JSON.parse(readFileSync(`build/dossiers/${f}`, 'utf8')); exclude.add(j.subject.id); }
  ds = buildWave2(a, exclude);
} else ds = [...buildDossiers(a, limit), ...buildHistoriography(a)];
mkdirSync('build/dossiers', { recursive: true });
const world = worldFingerprint(r);
for (const d of ds) { d.frontmatter += `\nworld: ${world}`; writeFileSync(`build/dossiers/${d.id}.json`, JSON.stringify(d, null, 2)); }
const forms = new Map<string, number>();
for (const d of ds) forms.set(d.form, (forms.get(d.form) ?? 0) + 1);
console.log(`${ds.length} dossiers; forms: ${[...forms].map(([k, v]) => `${k}:${v}`).join(', ')}`);
