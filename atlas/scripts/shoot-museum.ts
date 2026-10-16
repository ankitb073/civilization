// Screenshots and frame timings for the Museum: the turntable viewer on artifact pages (#/p/art:N?3d=1, normal and
// raking light) and the hall (#/museum), at desktop and phone sizes.
// Usage: npm --prefix atlas run build && node atlas/scripts/shoot-museum.ts [--out=dir] [--ids=art:1,art:20] [--only=desktop|phone]
//        [--theme=light|dark] [--hall=0] [--viewer=0]

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { serveDist } from './serve.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = resolve(arg('out', join(ROOT, '..', 'build', 'museum')));
const DIST = resolve(arg('dist', join(ROOT, 'dist')));
const THEME = arg('theme', 'light') as 'light' | 'dark';
const ONLY = arg('only', '');
mkdirSync(OUT, { recursive: true });
const museum = JSON.parse(readFileSync(join(DIST, 'data', 'museum.json'), 'utf8')) as { items: { id: string; page: { title: string; artifact: { medium: string } } }[] };
const IDS = arg('ids', '') ? arg('ids', '').split(',') : museum.items.map((x) => x.id);
const PORT = 4191;
const server = await serveDist(DIST, PORT);
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }).catch(() => chromium.launch());
const sizes = [
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
  { name: 'phone', width: 390, height: 844, dpr: 3, mobile: true },
].filter((s) => !ONLY || s.name === ONLY);
const pct = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const slug = (id: string) => id.replace(':', '');

type Probe = { stats: { frame: number[]; render: number[] }; object: unknown; buildMs?: number; renderer: { getContext(): WebGL2RenderingContext; info: { render: { triangles: number; calls: number }; memory: { textures: number } } }; renderNow(): void; setRaking(on: boolean): void };

async function gpuFrame(page: Page, key: string): Promise<number[]> {
  return page.evaluate((k) => {
    const sc = (window as unknown as Record<string, Probe>)[k];
    const g = sc.renderer.getContext();
    const px = new Uint8Array(4);
    const out: number[] = [];
    for (let i = 0; i < 40; i++) { const t0 = performance.now(); sc.renderNow(); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); out.push(performance.now() - t0); }
    return out.slice(5);
  }, key);
}

try {
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr, isMobile: s.mobile, hasTouch: s.mobile, colorScheme: THEME, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    const cdp = s.mobile ? await ctx.newCDPSession(page) : null;
    if (arg('viewer', '1') !== '0') {
      for (const id of IDS) {
        await page.goto('about:blank');
        await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        const t0 = Date.now();
        await page.goto(`http://127.0.0.1:${PORT}/civilization/#/p/${id}?3d=1`, { waitUntil: 'networkidle' });
        const ok = await page.waitForFunction(() => !!(window as unknown as { __museumViewer?: { object: unknown } }).__museumViewer?.object, null, { timeout: 60000 }).then(() => true).catch(() => false);
        const wall = Date.now() - t0;
        await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await page.waitForTimeout(400);
        const title = await page.locator('.mv__title').textContent().catch(() => id);
        if (!ok) { console.log(`${s.name} ${id}: NOT READY`); await page.screenshot({ path: join(OUT, `${s.name}-${slug(id)}-fail.png`) }); continue; }
        await page.screenshot({ path: join(OUT, `${s.name}-${slug(id)}.png`) });
        const info = await page.evaluate(() => { const v = (window as unknown as { __museumViewer: Probe }).__museumViewer; return { build: v.buildMs ?? 0, tris: v.renderer.info.render.triangles, calls: v.renderer.info.render.calls, tex: v.renderer.info.memory.textures }; });
        const gpu = await gpuFrame(page, '__museumViewer');
        await page.locator('.mv__tool', { hasText: 'Raking light' }).click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(OUT, `${s.name}-${slug(id)}-raking.png`) });
        console.log(`${s.name} ${id} "${title?.trim().slice(0, 60)}": page + model in ${wall} ms${s.mobile ? ' (CPU 4×)' : ''}, build ${info.build.toFixed(0)} ms, ${info.tris} tris, ${info.calls} calls, ${info.tex} textures, frame incl. GPU median ${pct(gpu, 50).toFixed(1)} ms p95 ${pct(gpu, 95).toFixed(1)} ms`);
      }
    }
    if (arg('hall', '1') !== '0') {
      await page.goto('about:blank');
      await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const t0 = Date.now();
      await page.goto(`http://127.0.0.1:${PORT}/civilization/#/museum`, { waitUntil: 'networkidle' });
      const ok = await page.waitForFunction(() => (window as unknown as { __museumHall?: { done: boolean } }).__museumHall?.done, null, { timeout: 120000 }).then(() => true).catch(() => false);
      const wall = Date.now() - t0;
      await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(OUT, `${s.name}-hall.png`) });
      if (ok) {
        const st = await page.evaluate(() => { const h = (window as unknown as { __museumHall: Probe & { built: number; buildMs: number[] } }).__museumHall; return { tris: h.renderer.info.render.triangles, calls: h.renderer.info.render.calls, tex: h.renderer.info.memory.textures, buildMs: h.buildMs }; });
        const gpu = await gpuFrame(page, '__museumHall');
        console.log(`${s.name} hall: all objects in ${wall} ms${s.mobile ? ' (CPU 4×)' : ''} (per object median ${pct(st.buildMs, 50).toFixed(0)} ms, max ${Math.max(...st.buildMs).toFixed(0)} ms), ${st.tris} tris, ${st.calls} calls, ${st.tex} textures, frame incl. GPU median ${pct(gpu, 50).toFixed(1)} ms p95 ${pct(gpu, 95).toFixed(1)} ms`);
        for (const [i, name] of [[3, 'walk'], [16, 'walk2']] as const) {
          await page.evaluate((k) => (window as unknown as { __museumGo?: (i: number) => void }).__museumGo?.(k), i);
          await page.waitForTimeout(900);
          await page.screenshot({ path: join(OUT, `${s.name}-hall-${name}.png`) });
        }
        await page.locator('.mu__btn', { hasText: 'Overview' }).click().catch(() => {});
        await page.waitForTimeout(900);
        await page.screenshot({ path: join(OUT, `${s.name}-hall-overview.png`) });
      } else console.log(`${s.name} hall: NOT READY after ${wall} ms`);
    }
    if (errors.length) console.log(`  ${s.name} console:\n  ${[...new Set(errors)].slice(0, 10).join('\n  ')}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
