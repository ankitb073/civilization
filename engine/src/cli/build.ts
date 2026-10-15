// Full data build: simulate (flushing each century to SQLite) → archive → database → audit → atlas export.
import { writeFileSync } from 'node:fs';
import { simulate } from '../sim/run.ts';
import { WorldDb } from '../db/writer.ts';
import { buildArchive } from '../archive/build.ts';
import { runChecks } from '../check/check.ts';
import { exportAtlas, worldNameOf, storyOf, featuredOf } from '../export/export.ts';
import { writeVault } from '../export/vault.ts';
import { writeReader } from '../export/book.ts';
import { writeSharePages } from '../export/share.ts';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, createReadStream, createWriteStream, rmSync, existsSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const args = process.argv.slice(2);
const seed = Number(args.find((a) => /^\d+$/.test(a)) ?? process.env.SEED ?? 5);
const out = args.find((a) => a.startsWith('--out='))?.slice(6) ?? 'atlas/public/data';
const dbPath = args.find((a) => a.startsWith('--db='))?.slice(5) ?? 'build/world.sqlite';
const t = performance.now();
const log = (m: string) => console.log(`[${((performance.now() - t) / 1000).toFixed(1)}s] ${m}`);
const db = new WorldDb(dbPath);
const r = simulate(seed, 5000, {
  onStart: (res) => db.writeWorld(res),
  onCentury: (res, year) => db.flushCentury(res, year),
});
log(`simulated seed ${seed}: ${r.state.events.length} events`);
const archive = buildArchive(r, log);
db.finalize(r);
db.writeArchive(archive);
db.close();
log(`database written: ${dbPath}`);
const check = runChecks(dbPath);
writeFileSync('build/check.json', JSON.stringify(check, null, 2));
log(`checker: ${check.passed ? 'PASSED' : 'FAILED'} (${check.invariants.reduce((a, x) => a + x.checked, 0).toLocaleString('en-US')} facts)`);
const skipDownloads = args.includes('--no-downloads');
const downloads: { label: string; href: string; bytes: number }[] = [];
const dl = 'atlas/public/downloads';
if (!skipDownloads) {
  mkdirSync(dl, { recursive: true });
  const v = writeVault(archive, 'build/vault', worldNameOf(r, archive), { story: storyOf(r, archive), featured: featuredOf(r, archive) });
  log(`vault: ${v.files.toLocaleString('en-US')} files`);
  if (existsSync(`${dl}/palimpsest-vault.zip`)) rmSync(`${dl}/palimpsest-vault.zip`);
  execFileSync('zip', ['-qr', '-9', '../atlas/public/downloads/palimpsest-vault.zip', 'vault'], { cwd: 'build' });
  await pipeline(createReadStream('build/world.sqlite'), createGzip({ level: 9 }), createWriteStream(`${dl}/world.sqlite.gz`));
  const book = writeReader(r, archive, `${dl}/palimpsest-reader.epub`, { cover: 'atlas/public/og.png', facts: check.invariants.reduce((t, x) => t + x.checked, 0) });
  log(`reader: ${book.docs} documents, ${(book.bytes / 1e6).toFixed(1)} MB`);
  downloads.push({ label: `The Reader: history, sources and lives (EPUB)`, href: 'downloads/palimpsest-reader.epub', bytes: book.bytes });
  downloads.push({ label: 'Obsidian vault (Markdown, zip)', href: 'downloads/palimpsest-vault.zip', bytes: statSync(`${dl}/palimpsest-vault.zip`).size });
  downloads.push({ label: 'World database (SQLite, gzip)', href: 'downloads/world.sqlite.gz', bytes: statSync(`${dl}/world.sqlite.gz`).size });
  log(`downloads: ${downloads.map((d) => `${d.href} ${(d.bytes / 1e6).toFixed(1)} MB`).join(', ')}`);
}
exportAtlas(r, archive, check, { outDir: out, log, downloads });
log('atlas data written');
log(`share pages: ${writeSharePages(r, archive, join(dirname(out), 's'), dirname(out))}`);
if (!check.passed) process.exit(1);
