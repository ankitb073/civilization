// Screenshots and a frame-time probe for the 3D relief view (#/3d), at desktop and phone sizes.
// Usage: npm --prefix atlas run build && node atlas/scripts/shoot3d.ts [--out=dir] [--year=1200] [--theme=light|dark] [--only=desktop|phone]

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveDist } from './serve.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = resolve(arg('out', join(ROOT, '..', 'build', 'shots-3d')));
const YEAR = Number(arg('year', '1200'));
const THEME = arg('theme', 'light') as 'light' | 'dark';
const ONLY = arg('only', '');
const EXTRA = arg('hash', '');
mkdirSync(OUT, { recursive: true });
const PORT = 4187;
const server = await serveDist(resolve(arg('dist', join(ROOT, 'dist'))), PORT);

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }).catch(() => chromium.launch());
const sizes = [
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
  { name: 'phone', width: 390, height: 844, dpr: 3, mobile: true },
].filter((s) => !ONLY || s.name === ONLY);

type Stats = { render: number[]; frame: number[]; update: number[]; build?: number };

const pct = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const fmt = (a: number[]) => `n=${a.length} median ${pct(a, 50).toFixed(2)} ms · p95 ${pct(a, 95).toFixed(2)} ms · max ${Math.max(...a).toFixed(2)} ms`;

try {
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr, isMobile: s.mobile, hasTouch: s.mobile, colorScheme: THEME, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    // phones: a 4× CPU slowdown from the start (mesh build, year updates)
    const cdp = s.mobile ? await ctx.newCDPSession(page) : null;
    await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(`http://127.0.0.1:${PORT}/civilization/#/3d?y=${YEAR}${EXTRA ? `&${EXTRA}` : ''}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!(window as unknown as { __palimpsest3d?: unknown }).__palimpsest3d, null, { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    const gl = await page.evaluate(() => {
      const c = document.createElement('canvas').getContext('webgl2');
      const ext = c?.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(c!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    await page.screenshot({ path: join(OUT, `3d-${s.name}-${THEME}-${YEAR}.png`) });
    type Sc = { stats: Stats; info: { states: { anchor: number; name: string }[] } | null; camera: unknown; renderer: { getContext(): WebGL2RenderingContext }; renderNow(dt?: number): void; requestYear(y: number): void; year: number; anchorScreen?: (c: number) => [number, number] };
    console.log(`${s.name} (${s.width}×${s.height} @${s.dpr}x, GPU: ${gl})`);

    // interaction: click (tap) the largest state, expect its card and the outline
    const at = await page.evaluate(() => {
      const sc = (window as unknown as { __palimpsest3d: Sc & { pick(x: number, y: number): number } }).__palimpsest3d;
      const st = sc.info!.states[0];
      // scan the canvas for a pixel over that state's anchor cell
      const c = document.querySelector('.t3d__canvas')!.getBoundingClientRect();
      for (let y = c.height * 0.2; y < c.height * 0.9; y += 6) for (let x = c.width * 0.1; x < c.width * 0.9; x += 6) {
        if (sc.pick(x, y) === st.anchor) return { x: c.left + x, y: c.top + y, name: st.name };
      }
      return null;
    });
    if (at) {
      if (s.mobile) await page.touchscreen.tap(at.x, at.y); else await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(500);
      const card = await page.locator('.t3d__card-t').textContent().catch(() => null);
      console.log(`  click ${at.name}: card ${card ? `shows "${card.trim()}"` : 'MISSING'} · url ${(await page.evaluate(() => location.hash)).slice(0, 60)}`);
      await page.screenshot({ path: join(OUT, `3d-${s.name}-${THEME}-selected.png`) });
      await page.locator('.t3d__x').click().catch(() => {});
    } else console.log('  click: no screen point over the largest state found');

    // playback: the real play button for ~3 s
    await page.evaluate(() => { const sc = (window as unknown as { __palimpsest3d: Sc }).__palimpsest3d; sc.stats.frame.length = 0; sc.stats.render.length = 0; sc.stats.update.length = 0; });
    await page.locator('.slider__play').click();
    await page.waitForTimeout(3000);
    await page.locator('.slider__play').click();
    const res = await page.evaluate(() => {
      const sc = (window as unknown as { __palimpsest3d: Sc }).__palimpsest3d;
      return { frames: sc.stats.frame.slice(1), update: sc.stats.update.slice(), build: sc.stats.build ?? 0, year: sc.year };
    });
    // GPU-inclusive cost: render back to back, forcing completion with a 1-pixel read each time
    const full = await page.evaluate(() => {
      const sc = (window as unknown as { __palimpsest3d: Sc }).__palimpsest3d;
      const g = sc.renderer.getContext();
      const px = new Uint8Array(4);
      const out: number[] = [];
      for (let i = 0; i < 60; i++) {
        const t0 = performance.now();
        sc.requestYear(1000 + i * 37);
        sc.renderNow();
        g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px);
        out.push(performance.now() - t0);
      }
      return out.slice(5);
    });
    console.log(`  mesh build ${res.build.toFixed(0)} ms${s.mobile ? ' (CPU 4×)' : ''}, cached after the first visit`);
    console.log(`  playing (50 yr/s, ${s.mobile ? 'CPU throttled 4×' : 'no throttle'}): rAF interval ${fmt(res.frames)} · reached AY ${res.year}`);
    console.log(`  year update CPU (palette, towers, state ranking): ${fmt(res.update)}`);
    console.log(`  full frame incl. GPU (render + 1px readback): ${fmt(full)}`);
    await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `3d-${s.name}-${THEME}-after.png`) });
    if (errors.length) console.log('  console:', errors.slice(0, 8).join('\n  '));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
