// Checks the packed kit in a real browser, as the game will load it: serves viewer.html with three (atlas's copy) and
// the kit folder, opens it in headless Chromium (atlas's Playwright), and saves screenshots plus draw calls, triangles,
// textures, load and frame times for each tier and view.
//   node scripts/streets/kit/verify.ts [--out=build/kit/renders/web] [--tiers=hi,lo] [--views=street,roof,grid]
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = resolve(ROOT, arg('out', 'build/kit/renders/web'));
const tiers = arg('tiers', 'hi,lo').split(',');
const views = arg('views', 'street,roof,grid').split(',');
mkdirSync(OUT, { recursive: true });

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2' };
const roots: [string, string][] = [['/three/', join(ROOT, 'atlas', 'node_modules', 'three')], ['/kit/', join(ROOT, 'atlas', 'public', 'game', 'streets', 'kit')]];
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = '';
  if (url === '/' || url === '/index.html') file = join(ROOT, 'scripts', 'streets', 'kit', 'viewer.html');
  for (const [p, dir] of roots) if (url.startsWith(p)) file = join(dir, normalize(url.slice(p.length)).replace(/^(\.\.[/\\])+/, ''));
  if (!file || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as { port: number }).port;

const req = createRequire(join(ROOT, 'atlas', 'package.json'));
const { chromium } = req('playwright');
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const results: unknown[] = [];
for (const tier of tiers) for (const view of views) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('console', (m: { type(): string; text(): string }) => { if (m.type() === 'error') console.log('  console:', m.text()); });
  page.on('pageerror', (e: Error) => console.log('  pageerror:', e.message));
  await page.goto(`http://127.0.0.1:${port}/?tier=${tier}&view=${view}`);
  await page.waitForFunction('window.__kitDone === true', null, { timeout: 180000 });
  const r = await page.evaluate('window.__kitResult');
  await page.screenshot({ path: join(OUT, `web_${tier}_${view}.png`) });
  console.log(JSON.stringify(r));
  results.push(r);
  await page.close();
}
writeFileSync(join(OUT, 'web_results.json'), JSON.stringify(results, null, 1));
await browser.close();
server.close();
