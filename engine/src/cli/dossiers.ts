// Write flagship dossiers for the canonical world: build/dossiers/fl-NNN.json
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { simulate } from '../sim/run.ts';
import { buildArchive } from '../archive/build.ts';
import { buildDossiers } from '../flagships/dossier.ts';
import { worldFingerprint } from '../export/export.ts';

const seed = Number(process.argv[2] ?? 5);
const limit = Number(process.argv[3] ?? 240);
const r = simulate(seed, 5000);
const a = buildArchive(r);
const ds = buildDossiers(a, limit);
if (existsSync('build/dossiers')) rmSync('build/dossiers', { recursive: true });
mkdirSync('build/dossiers', { recursive: true });
const world = worldFingerprint(r);
for (const d of ds) { d.frontmatter += `\nworld: ${world}`; writeFileSync(`build/dossiers/${d.id}.json`, JSON.stringify(d, null, 2)); }
const forms = new Map<string, number>();
for (const d of ds) forms.set(d.form, (forms.get(d.form) ?? 0) + 1);
console.log(`${ds.length} dossiers; forms: ${[...forms].map(([k, v]) => `${k}:${v}`).join(', ')}`);
