// Static portraits of the figurines: one 512×512 transparent PNG per subject of the Lives (s/fig/per-N.png), the
// same piece as on #/figures and the person's page, for cards and the reading pages. Also checks that a piece is the
// same everywhere: every figure is built twice, in two separate page loads (two different routes), and its
// fingerprint (every vertex and colour) must match. Writes s/fig/index.json (id, name, file, fingerprint).
// Usage: npm --prefix atlas run build && node atlas/scripts/figures.ts [--dist=atlas/dist] [--only=per:8,per:476] [--size=512]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { FiguresJson } from '../../engine/src/export/contract.ts';
import { serveDist } from './serve.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const DIST = resolve(arg('dist', join(ROOT, 'dist')));
const SIZE = Number(arg('size', '512'));
const ONLY = new Set(arg('only', '').split(',').filter(Boolean));
const OUT = join(DIST, 's', 'fig');
mkdirSync(OUT, { recursive: true });
const fj = JSON.parse(readFileSync(join(DIST, 'data', 'figures.json'), 'utf8')) as FiguresJson;
const ids = fj.pieces.map((p) => p.page.id).filter((id) => !ONLY.size || ONLY.has(id));
const PORT = 4189;
const server = await serveDist(DIST, PORT);
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }).catch(() => chromium.launch());

type Api = { portrait(id: string, size: number): Promise<string | null>; fingerprint(id: string): string | null; ready(): Promise<void> };
async function open(hash: string) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/civilization/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!(window as unknown as { __figures?: unknown }).__figures, null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page, errors };
}

try {
  const t0 = performance.now();
  // the Lives shelf: portraits and the first fingerprints
  const a = await open('#/figures');
  const prints = new Map<string, string>();
  const index: { id: string; name: string; file: string; fingerprint: string }[] = [];
  for (const id of ids) {
    const r = await a.page.evaluate(async ({ id, size }) => {
      const api = (window as unknown as { __figures: Api }).__figures;
      const url = await api.portrait(id, size);
      return { url, print: api.fingerprint(id) };
    }, { id, size: SIZE });
    if (!r.url || !r.print) { console.warn(`  ${id}: no piece`); continue; }
    const file = `${id.replace(':', '-')}.png`;
    writeFileSync(join(OUT, file), Buffer.from(r.url.slice(r.url.indexOf(',') + 1), 'base64'));
    prints.set(id, r.print);
    const name = fj.pieces.find((p) => p.page.id === id)!.page.title.replace(/\s*\([^)]*\)\s*$/, '');
    index.push({ id, name, file: `s/fig/${file}`, fingerprint: r.print });
  }
  await a.ctx.close();
  // the same people, read from their own pages (shards) on another route: the pieces must be identical
  const b = await open(`#/figures?ids=${ids.join(',')}`);
  let same = 0;
  const diff: string[] = [];
  for (const id of ids) {
    const p = await b.page.evaluate((id) => (window as unknown as { __figures: Api }).__figures.fingerprint(id), id);
    if (p && p === prints.get(id)) same++; else diff.push(id);
  }
  await b.ctx.close();
  writeFileSync(join(OUT, 'index.json'), JSON.stringify({ size: SIZE, pieces: index }, null, 1));
  console.log(`${index.length} portraits (${SIZE}×${SIZE}) → ${OUT} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`identical pieces from figures.json and from the pages: ${same}/${ids.length}${diff.length ? ` · DIFFER: ${diff.join(', ')}` : ''}`);
  if (a.errors.length || b.errors.length) console.log(`page errors: ${[...a.errors, ...b.errors].slice(0, 5).join(' | ')}`);
  if (diff.length) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
