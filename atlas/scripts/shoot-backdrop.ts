// Screenshots of the Tablet House backdrop, every beat × the harness scenarios, desktop 1440×900 and phone 390×844,
// plus a frame-time probe per scenario and a contact sheet per size. Runs the Vite dev server on atlas/dev/backdrop.html.
// Usage: node atlas/scripts/shoot-backdrop.ts [--out=dir] [--only=desktop|phone] [--sc=0,1,2] [--beats=muster,walls] [--rm]
//        [--painted] (the no-WebGL fallback) [--t=14] [--no-probe]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = resolve(arg('out', join(ROOT, '..', 'build', 'shots-backdrop')));
const ONLY = arg('only', '');
// --sc=all: the three fixtures and every scenario in scenarios.json (the harness appends them)
const SC_ARG = arg('sc', '0,1,2');
const BEATS = arg('beats', 'muster,field,walls,fall-sack,fall-treaty,held,tablet,ending').split(',');
const RM = process.argv.includes('--rm');
const PAINTED = process.argv.includes('--painted');
const TAG = PAINTED ? '-painted' : RM ? '-still' : '';
const T = Number(arg('t', '14'));
const PROBE = !process.argv.includes('--no-probe');
mkdirSync(OUT, { recursive: true });

const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), logLevel: 'warn', server: { port: 5191, strictPort: false, host: '127.0.0.1' } });
await server.listen();
const base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5191/';

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }).catch(() => chromium.launch());
const sizes = [
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
  { name: 'phone', width: 390, height: 844, dpr: 3, mobile: true },
].filter((s) => !ONLY || s.name === ONLY);

const pct = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const fmt = (a: number[]) => `median ${pct(a, 50).toFixed(2)} ms · p95 ${pct(a, 95).toFixed(2)} ms (n=${a.length})`;

type Bd = { __bd: { ready: Promise<unknown>; handle: { setBeat(b: string, o?: { instant?: boolean }): void; renderAt(t: number): void; mode: string; stats: { frame: number[]; render: number[]; dpr: number; build: number; city: string } | null }; scenario: { id: string; city: { name: string }; year: number } } };

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

const report: string[] = [];
const shots: Record<string, string[]> = {};
try {
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr, isMobile: s.mobile, hasTouch: s.mobile, reducedMotion: RM ? 'reduce' : 'no-preference' });
    shots[s.name] = [];
    let SCS = SC_ARG === 'all' ? [] : SC_ARG.split(',').map(Number);
    if (SC_ARG === 'all') {
      const p = await ctx.newPage();
      await p.goto(`${base}dev/backdrop.html?sc=0&ui=0&webgl=0`);
      await p.waitForFunction(() => !!(window as unknown as { __bd?: { scenarios: unknown[] } }).__bd?.scenarios, null, { timeout: 60000 });
      const n = await p.evaluate(() => (window as unknown as { __bd: { scenarios: unknown[] } }).__bd.scenarios.length);
      SCS = Array.from({ length: n }, (_, i) => i);
      await p.close();
    }
    for (const sci of SCS) {
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
      const t0 = Date.now();
      await page.goto(`${base}dev/backdrop.html?sc=${sci}&beat=${BEATS[0]}&ui=0${RM ? '&rm=1' : ''}${PAINTED ? '&webgl=0' : ''}`, { waitUntil: 'load' });
      await page.waitForFunction(() => !!(window as unknown as Bd).__bd?.handle, null, { timeout: 90000 });
      const info = await page.evaluate(() => { const b = (window as unknown as Bd).__bd; return { id: b.scenario.id, name: b.scenario.city.name, year: b.scenario.year, mode: b.handle.mode, build: b.handle.stats?.build ?? 0, city: b.handle.stats?.city }; });
      report.push(`${s.name} ${info.id} ${info.name} AY ${info.year}: ${info.mode}, ready in ${Date.now() - t0} ms (relief build ${info.build.toFixed(0)} ms, city ${info.city})`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1800);
      for (const beat of BEATS) {
        await page.evaluate(({ beat, t }) => { const h = (window as unknown as Bd).__bd.handle; h.setBeat(beat, { instant: true }); h.renderAt(t); }, { beat, t: T });
        await settle(page);
        await page.evaluate((t) => (window as unknown as Bd).__bd.handle.renderAt(t), T);
        if (PAINTED) await page.waitForTimeout(300);
        const file = `${info.id}-${beat}-${s.name}${TAG}.png`;
        await page.screenshot({ path: join(OUT, file) });
        shots[s.name].push(file);
      }
      if (PROBE && info.mode === 'webgl') {
        // live frames for ~3 s on the busiest beat (the sack), then GPU-inclusive render cost
        const cdp = s.mobile ? await ctx.newCDPSession(page) : null;
        await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await page.evaluate(() => { const h = (window as unknown as Bd).__bd.handle; h.setBeat('fall-sack', { instant: true }); h.stats!.frame.length = 0; h.stats!.render.length = 0; });
        await page.waitForTimeout(3500);
        const live = await page.evaluate(() => { const st = (window as unknown as Bd).__bd.handle.stats!; return { frame: st.frame.slice(2), render: st.render.slice(2), dpr: st.dpr }; });
        const full = await page.evaluate(() => {
          const h = (window as unknown as Bd).__bd.handle;
          const c = document.querySelector('.bd__canvas') as HTMLCanvasElement;
          const g = c.getContext('webgl2')!;
          const px = new Uint8Array(4);
          const out: number[] = [];
          for (let i = 0; i < 40; i++) { const t0 = performance.now(); h.renderAt(10 + i * 0.05); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); out.push(performance.now() - t0); }
          return out.slice(4);
        });
        await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        report.push(`  frames (sack, live${s.mobile ? ', CPU 4×' : ''}): rAF ${fmt(live.frame)} · render CPU ${fmt(live.render)} · dpr now ${live.dpr}`);
        report.push(`  full frame incl. GPU (render + 1px readback): ${fmt(full)}`);
      }
      if (errors.length) report.push(`  console: ${errors.slice(0, 6).join(' | ')}`);
      await page.close();
    }
    await ctx.close();
  }
  // contact sheets
  for (const [size, files] of Object.entries(shots)) {
    if (!files.length) continue;
    const cols = BEATS.length;
    const w = size === 'desktop' ? 360 : 140;
    const html = `<!doctype html><body style="margin:0;background:#111;color:#ddd;font:11px system-ui"><div style="display:grid;grid-template-columns:repeat(${cols},${w}px);gap:4px;padding:4px">${files.map((f) => `<figure style="margin:0"><img src="file://${join(OUT, f)}" style="width:${w}px;display:block"><figcaption>${f.replace('.png', '')}</figcaption></figure>`).join('')}</div></body>`;
    const sheet = join(OUT, `sheet-${size}${TAG}.html`);
    writeFileSync(sheet, html);
    const ctx = await browser.newContext({ viewport: { width: cols * (w + 4) + 4, height: 400 } });
    const page = await ctx.newPage();
    await page.goto(`file://${sheet}`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `sheet-${size}${TAG}.png`), fullPage: true });
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(join(OUT, `report${TAG}.txt`), report.join('\n') + '\n');
console.log(report.join('\n'));
console.log(`shots in ${OUT}`);
