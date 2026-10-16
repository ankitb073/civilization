// Screenshots and a frame-time probe for the River of Time (#/river), desktop 1440×900 and phone 390×844.
// Usage: npm --prefix atlas run build && node atlas/scripts/shoot-river.ts [--out=dir] [--years=500,2500,4800]
//        [--theme=light|dark] [--only=desktop|phone] [--url=http://localhost:5173/] (a dev server instead of dist)

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveDist } from './serve.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = resolve(arg('out', join(ROOT, '..', 'build', 'shots-river')));
const YEARS = arg('years', '500,2500,4800').split(',').map(Number);
const THEME = arg('theme', 'light') as 'light' | 'dark';
const ONLY = arg('only', '');
const EXTRA = arg('hash', '');
const PERF = !process.argv.includes('--no-perf');
const OVERVIEW = !process.argv.includes('--no-overview');
mkdirSync(OUT, { recursive: true });
const PORT = Number(arg('port', '4377'));
let base = arg('url', '');
const server = base ? null : await serveDist(resolve(arg('dist', join(ROOT, 'dist'))), PORT);
if (!base) base = `http://127.0.0.1:${PORT}/civilization/`;

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }).catch(() => chromium.launch());
const sizes = [
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
  { name: 'phone', width: 390, height: 844, dpr: 3, mobile: true },
].filter((s) => !ONLY || s.name === ONLY);

type Sc = {
  stats: { frame: number[]; render: number[]; build: number; tris: number };
  setYear(y: number, immediate?: boolean): void; setOverview(on: boolean, immediate?: boolean): void;
  renderNow(dt?: number): void; playing: boolean; speed: number; year: number;
  pick(x: number, y: number): { st: { name: string; id: string }; year: number } | null;
};
const pct = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const fmt = (a: number[]) => `n=${a.length} median ${pct(a, 50).toFixed(2)} ms · p95 ${pct(a, 95).toFixed(2)} ms · max ${Math.max(...a).toFixed(2)} ms`;

try {
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr, isMobile: s.mobile, hasTouch: s.mobile, colorScheme: THEME, reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    const t0 = Date.now();
    await page.goto(`${base}#/river?y=${YEARS[0]}&shot=1${EXTRA ? `&${EXTRA}` : ''}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!(window as unknown as { __river?: unknown }).__river, null, { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    const loadMs = Date.now() - t0;
    const gl = await page.evaluate(() => {
      const c = document.createElement('canvas').getContext('webgl2');
      const ext = c?.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(c!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    const info = await page.evaluate(() => { const sc = (window as unknown as { __river: Sc }).__river; return { build: sc.stats.build, tris: sc.stats.tris }; });
    console.log(`${s.name} (${s.width}×${s.height} @${s.dpr}x, GPU: ${gl}) loaded in ${loadMs} ms · scene build ${info.build.toFixed(0)} ms · ${info.tris.toLocaleString('en-US')} ridge triangles`);
    for (const y of YEARS) {
      await page.evaluate((yy) => { const sc = (window as unknown as { __river: Sc }).__river; sc.playing = false; sc.setOverview(false, true); sc.setYear(yy, true); }, y);
      await page.waitForTimeout(1300);
      await page.screenshot({ path: join(OUT, `river-${s.name}-${THEME}-${y}.png`) });
    }
    if (OVERVIEW) {
      await page.evaluate(() => { const sc = (window as unknown as { __river: Sc }).__river; sc.setYear(5000, true); sc.setOverview(true, true); });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(OUT, `river-${s.name}-${THEME}-overview.png`) });
      if (!s.mobile) {
        // the long shot: an ultra-wide frame of all five thousand years
        await page.setViewportSize({ width: 2560, height: 1000 });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: join(OUT, `river-long-${THEME}-overview.png`) });
        await page.setViewportSize({ width: s.width, height: s.height });
        await page.waitForTimeout(600);
      }
      await page.evaluate(() => { const sc = (window as unknown as { __river: Sc }).__river; sc.setOverview(false, true); });
    }
    // hover/tap: find a ridge at the middle of the frame and show its card
    await page.evaluate((yy) => { const sc = (window as unknown as { __river: Sc }).__river; sc.setYear(yy, true); }, YEARS[1] ?? YEARS[0]);
    await page.waitForTimeout(900);
    const at = await page.evaluate(() => {
      const sc = (window as unknown as { __river: Sc }).__river;
      const c = document.querySelector('.rv__canvas')!.getBoundingClientRect();
      for (let y = c.height * 0.62; y > c.height * 0.3; y -= 8) for (let x = c.width * 0.42; x < c.width * 0.6; x += 8) {
        const hit = sc.pick(x, y);
        if (hit && document.elementFromPoint(c.left + x, c.top + y)?.classList.contains('rv__canvas')) return { x: c.left + x, y: c.top + y, name: hit.st.name };
      }
      return null;
    });
    if (at) {
      if (s.mobile) await page.touchscreen.tap(at.x, at.y); else await page.mouse.move(at.x, at.y);
      await page.waitForTimeout(500);
      const card = await page.locator('.rv-tip__n').textContent().catch(() => null);
      console.log(`  ${s.mobile ? 'tap' : 'hover'} ${at.name}: card ${card ? `shows "${card.trim()}"` : 'MISSING'}`);
      await page.screenshot({ path: join(OUT, `river-${s.name}-${THEME}-card.png`) });
      if (s.mobile) await page.locator('.rv-tip .btn--ghost').click().catch(() => {});
      else await page.mouse.move(5, 5);
    } else console.log('  pick: no ridge found under the probe');
    if (PERF) {
      const cdp = s.mobile ? await ctx.newCDPSession(page) : null;
      await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.evaluate(() => { const sc = (window as unknown as { __river: Sc }).__river; sc.setOverview(false, true); sc.setYear(1500, true); sc.stats.frame.length = 0; sc.stats.render.length = 0; });
      await page.locator('.rv-play').click();
      await page.waitForTimeout(4000);
      await page.locator('.rv-play').click();
      const st = await page.evaluate(() => { const sc = (window as unknown as { __river: Sc }).__river; return { frame: sc.stats.frame.slice(), render: sc.stats.render.slice(), year: sc.year }; });
      console.log(`  playing 4 s${s.mobile ? ' (CPU 4× slower)' : ''} → AY ${Math.round(st.year)}: frames ${fmt(st.frame)}; render() CPU ${fmt(st.render)}`);
      await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
    if (errors.length) console.log(`  console: ${errors.slice(0, 6).join(' | ')}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server?.close();
}
