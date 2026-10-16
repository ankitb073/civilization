// Screenshots and a frame-time probe for Cities in 3D (#/city/set:N), at desktop and phone sizes.
// Usage: npm --prefix atlas run build && node atlas/scripts/shootcity.ts [--out=dir] [--theme=light|dark] [--only=desktop|phone]
//          [--shots=set:0@300,2500,4900;set:7@…] [--url=http://127.0.0.1:5173/] (a running dev server instead of dist/)

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveDist } from './serve.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = resolve(arg('out', join(ROOT, '..', 'build', '3dm', 'city')));
const THEME = arg('theme', 'light') as 'light' | 'dark';
const ONLY = arg('only', '');
const SHOTS = arg('shots', 'set:0@300,2500,4900').split(';').map((s) => { const [id, ys] = s.split('@'); return { id, years: ys.split(',').map(Number) }; });
const PROBE = arg('probe', '1') === '1';
// the playback probe starts here (default: the first shot); e.g. --probeat=set:7@4700 for a big industrial port
mkdirSync(OUT, { recursive: true });
let base = arg('url', '');
const PORT = 4193;
const server = base ? null : await serveDist(resolve(arg('dist', join(ROOT, 'dist'))), PORT);
if (!base) base = `http://127.0.0.1:${PORT}/civilization/`;

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }).catch(() => chromium.launch());
const sizes = [
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
  { name: 'phone', width: 390, height: 844, dpr: 3, mobile: true },
].filter((s) => !ONLY || s.name === ONLY);

const pct = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const fmt = (a: number[]) => `n=${a.length} median ${pct(a, 50).toFixed(2)} · p95 ${pct(a, 95).toFixed(2)} · max ${Math.max(...a).toFixed(2)} ms`;
type St = { stats: { render: number[]; frame: number[]; build: number[] }; model: { stats: { parts: number; houses: number; build: number }; P: number } | null; renderNow(): void };

try {
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr, isMobile: s.mobile, hasTouch: s.mobile, colorScheme: THEME, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()}`); });
    for (const shot of SHOTS) {
      for (const y of shot.years) {
        await page.goto(`${base}#/city/${shot.id}?y=${y}`, { waitUntil: 'networkidle' });
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => !!(window as unknown as { __palimpsestCity?: { model?: unknown } }).__palimpsestCity?.model, null, { timeout: 40000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(900);
        const info = await page.evaluate(() => {
          const sc = (window as unknown as { __palimpsestCity: St }).__palimpsestCity;
          sc.renderNow();
          return { parts: sc.model!.stats.parts, houses: sc.model!.stats.houses, build: sc.model!.stats.build, P: sc.model!.P, title: document.querySelector('.c3d__title')?.textContent };
        });
        await page.waitForTimeout(150);
        const file = join(OUT, `${shot.id.replace(':', '')}-${y}-${s.name}${THEME === 'dark' ? '-dark' : ''}.png`);
        await page.screenshot({ path: file });
        console.log(`${s.name} ${shot.id} AY ${y}: ${info.title} · ${info.houses} houses, ${info.parts} parts, build ${info.build.toFixed(1)} ms, plinth ${info.P.toFixed(1)} lots → ${file}`);
      }
    }
    if (PROBE) {
      // phones: a 4× CPU slowdown for the playback probe
      const cdp = s.mobile ? await ctx.newCDPSession(page) : null;
      const [pid, py] = arg('probeat', `${SHOTS[0].id}@${SHOTS[0].years[0]}`).split('@');
      await page.goto(`${base}#/city/${pid}?y=${py}`, { waitUntil: 'networkidle' });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForFunction(() => !!(window as unknown as { __palimpsestCity?: { model?: unknown } }).__palimpsestCity?.model, null, { timeout: 40000 });
      await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.evaluate(() => { const sc = (window as unknown as { __palimpsestCity: St }).__palimpsestCity; sc.stats.frame.length = 0; sc.stats.render.length = 0; sc.stats.build.length = 0; });
      await page.locator('.c3d-life__play').click();
      await page.waitForTimeout(4000);
      await page.locator('.c3d-life__play').click();
      const st = await page.evaluate(() => (window as unknown as { __palimpsestCity: St }).__palimpsestCity.stats);
      console.log(`  ${s.name} playback${s.mobile ? ' (4× CPU slowdown)' : ''}: frames ${fmt(st.frame)}`);
      console.log(`  ${s.name} render CPU ${fmt(st.render)} · year rebuild ${fmt(st.build)}`);
      await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
    if (errors.length) console.log(`  errors:\n    ${errors.slice(0, 8).join('\n    ')}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server?.close();
}
