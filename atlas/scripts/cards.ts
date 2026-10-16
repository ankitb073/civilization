// Social cards for the flagships' reading pages: one 1200×630 JPEG per document (s/card/fl-NNN.jpg), with the
// document's kind and date, its title, its opening words and the map of its age. The engine writes the manifest
// (s/cards.json) and points the reading pages at these files when built with PAL_CARDS=1; the deploy then runs this.
// Usage: npm --prefix atlas run build && node atlas/scripts/cards.ts [--dist=atlas/dist] [--only=fl-905,fl-004]

import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(process.argv.find((a) => a.startsWith('--dist='))?.slice(7) ?? join(ROOT, 'dist'));
const ONLY = new Set((process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? '').split(',').filter(Boolean));
const PORT = 4184;
const manifest = JSON.parse(readFileSync(join(DIST, 's', 'cards.json'), 'utf8')) as { world: string; cards: { id: string; kicker: string; title: string; quote: string; map: string }[] };
const cards = manifest.cards.filter((c) => !ONLY.size || ONLY.has(c.id));
const OUT = join(DIST, 's', 'card');
mkdirSync(OUT, { recursive: true });

// a static server in this process (a spawned `vite preview` outlived its npx parent in CI and held the job open)
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/civilization\/?/, '/');
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise<void>((ok) => server.listen(PORT, '127.0.0.1', ok));

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const browser = await chromium.launch({ channel: 'chromium' }).catch(() => chromium.launch());
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' });
  const page = await ctx.newPage();
  // the about view loads the atlas's fonts without starting the map
  await page.goto(`http://127.0.0.1:${PORT}/civilization/#/about`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  let n = 0;
  for (const c of cards) {
    const map = existsSync(join(DIST, c.map)) ? `/civilization/${c.map}` : '';
    await page.evaluate(({ c, map, world }) => {
      document.body.innerHTML = `<div style="position:fixed;inset:0;width:1200px;height:630px;background:#f4efe4;color:#1d1a16;overflow:hidden;font-family:'EB Garamond Variable','EB Garamond',Georgia,serif">
        ${map ? `<img src="${map}" alt="" style="position:absolute;right:0;top:0;width:420px;height:630px;object-fit:cover;object-position:right center">
        <div style="position:absolute;right:380px;top:0;width:60px;height:630px;background:linear-gradient(90deg,#f4efe4,rgba(244,239,228,0))"></div>` : ''}
        <div style="position:absolute;left:64px;top:58px;bottom:54px;width:${map ? 680 : 1072}px;display:flex;flex-direction:column">
          <div style="font:600 17px/1 'Inter Variable',Inter,system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#8a3b1e">Palimpsest</div>
          <div style="margin-top:30px;font:500 19px/1.35 'Inter Variable',Inter,system-ui,sans-serif;color:#5b5348;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${c.kicker}</div>
          <div style="margin-top:12px;font-size:50px;line-height:1.06;letter-spacing:-.005em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${c.title}</div>
          <div style="margin-top:22px;font-size:26px;line-height:1.38;font-style:italic;color:#3b342c;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden">${c.quote}</div>
          <div style="margin-top:auto;padding-top:14px;font:500 16px/1.3 'Inter Variable',Inter,system-ui,sans-serif;color:#5b5348">From the archive of ${world}, a world that never existed</div>
        </div>
      </div>`;
    }, { c: { kicker: esc(c.kicker), title: esc(c.title), quote: esc(c.quote) }, map, world: esc(manifest.world) });
    if (map) await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    await page.screenshot({ path: join(OUT, `${c.id}.jpg`), type: 'jpeg', quality: 80 });
    n++;
  }
  console.log(`${n} cards → ${OUT}`);
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}
