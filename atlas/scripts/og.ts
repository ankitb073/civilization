// Share-card images: one 1200×630 card per quarter-millennium (public/og/ch01.jpg … ch20.jpg), showing
// the political map at mid-period under the period's dates. The engine's share pages (s/art-N.html)
// use the card for the document's period.
// Usage: npm --prefix atlas run build && node atlas/scripts/og.ts

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'og');
const PORT = 4183;
const DIST = process.argv.find((a) => a.startsWith('--dist='))?.slice(7); // preview another build directory
mkdirSync(OUT, { recursive: true });

const meta = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'meta.json'), 'utf8')) as { worldName?: string; eras?: { name: string; start: number; end: number }[] };
const world = meta.worldName ?? 'Yüvinzhi';
const ageAt = (y: number) => meta.eras?.find((e) => e.start <= y && y < e.end)?.name ?? '';

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', ...(DIST ? ['--outDir', DIST] : [])], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 20000);
  server.stdout!.on('data', (b: Buffer) => { if (b.toString().includes(String(PORT))) { clearTimeout(t); resolve(); } });
});

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }).catch(() => chromium.launch());
try {
  const ctx = await browser.newContext({ viewport: { width: 720, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/civilization/#/map?y=120&l=political&frames=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof (window as unknown as { __palimpsestSetYear?: unknown }).__palimpsestSetYear === 'function', null, { timeout: 30000 });
  await page.waitForTimeout(600);
  // the map fills the right 720 px (the page loads at that size so the map fits it); the text panel takes the left 480
  await page.addStyleTag({ content: '.framesplate { display: none !important; }' });
  const maps: string[] = [];
  for (let k = 0; k < 20; k++) {
    await page.evaluate((yy) => (window as unknown as { __palimpsestSetYear: (y: number) => Promise<void> }).__palimpsestSetYear(yy), k * 250 + 120);
    maps.push((await page.screenshot({ type: 'png' })).toString('base64'));
  }
  await page.setViewportSize({ width: 1200, height: 630 });
  // compose each card in the atlas's own fonts
  for (let k = 0; k < 20; k++) {
    const y0 = k * 250, y1 = y0 + 250;
    await page.evaluate(({ img, y0, y1, world, age }) => {
      document.body.innerHTML = `<div style="position:fixed;inset:0;width:1200px;height:630px;background:#f4efe4;font-family:'EB Garamond Variable','EB Garamond',Georgia,serif;color:#1d1a16;overflow:hidden">
        <img src="data:image/png;base64,${img}" style="position:absolute;left:480px;top:0;width:720px;height:630px">
        <div style="position:absolute;left:480px;top:0;width:40px;height:630px;background:linear-gradient(90deg,rgba(29,26,22,.18),rgba(29,26,22,0))"></div>
        <div style="position:absolute;left:56px;top:56px;bottom:56px;width:392px;display:flex;flex-direction:column;justify-content:space-between">
          <div style="font:600 18px/1 'Inter Variable',Inter,system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#8a3b1e">Palimpsest</div>
          <div>
            <div style="font-size:28px;font-style:italic;margin-bottom:10px;color:#4a4238">${age}</div>
            <div style="font-size:70px;line-height:1;letter-spacing:-.01em;white-space:nowrap">AY ${y0}–${y1}</div>
            <div style="font-size:27px;margin-top:22px;line-height:1.25">From the archive of ${world}, a world that never existed</div>
          </div>
          <div style="font:500 16px/1.35 'Inter Variable',Inter,system-ui,sans-serif;color:#5b5348">Five thousand years, simulated.<br>Every document checked against the record.</div>
        </div>
      </div>`;
    }, { img: maps[k], y0, y1, world, age: ageAt(y0 + 120) });
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(OUT, `ch${String(k + 1).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 82 });
  }
  console.log(`20 cards → ${OUT}`);
  await ctx.close();
} finally {
  await browser.close();
  server.kill();
}
