// The look of Runner of the Tablet House (#/streets, decision 0033): the integrated game in each look and tier, from
// the same views, with what each costs. For every size and look it:
//   - loads #/streets?errand=0&look=…&tier=… (the free city), waits for the first frame and for full quality (the
//     streamed textures), records the load, compile and stream times (and, with --cold, the compile with the GPU
//     driver's shader cache emptied first);
//   - shoots the market, a rooftop, the river, a lane, the palace gate, the errand's run (tablet house → river gate at a
//     run) and the hero (close, mid-run, on a ladder);
//   - measures, per view, 20 s of the game with the view panning: frame interval (median, p95), CPU per frame, GPU per
//     frame (WebGPU: submit to idle; WebGL: timer queries), draw calls, triangles, texture memory;
//   - with --net=4g, loads each look again under Lighthouse's slow 4G (1.6 Mbps, 150 ms; phones also 4× CPU): time to
//     the first frame and to full quality;
//   - composes contact sheets (classic | realism tiers, per view) and an overview per size into --out.
// Phones are 390×844 at DPR 2 with 4× CPU throttling while measuring, on this computer's GPU: their GPU figures are
// far too good for a real phone.
//
// Usage: npm --prefix atlas run build && node atlas/scripts/streets-look.ts [--dist=atlas/dist | --dev]
//   [--out=build/streets-look] [--only=desktop|phone] [--looks=classic,desktop,desktop-medium,phone,phone-low]
//   [--views=market,lane] [--seconds=20] [--no-measure] [--no-shots] [--cold] [--net=4g] [--q=extra=1] [--tag=name]

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { serveDist } from './serve.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const has = (k: string) => process.argv.includes(`--${k}`);
const pct = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const r2 = (v: number) => Math.round(v * 100) / 100;

const OUT = resolve(arg('out', join(ROOT, '..', 'build', 'streets-look')));
const ONLY = arg('only', '');
const SECONDS = Number(arg('seconds', '20'));
const VIEWS = arg('views', '').split(',').filter(Boolean);
const EXTRA = arg('q', '');
const TAG = arg('tag', '');
const NET = arg('net', '');
mkdirSync(OUT, { recursive: true });

const SIZES = [
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false, throttle: 1, looks: ['classic', 'desktop', 'desktop-medium'] },
  { name: 'phone', width: 390, height: 844, dpr: 2, mobile: true, throttle: 4, looks: ['classic', 'phone', 'phone-low'] },
].filter((s) => !ONLY || s.name === ONLY);
const LOOKS = arg('looks', '').split(',').filter(Boolean);

// ---------------------------------------------------------------- the server: a built dist (default) or Vite
let base: string;
let close: () => Promise<void> | void;
if (has('dev')) {
  const { createServer } = await import('vite');
  const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), logLevel: 'warn', server: { port: 5311, strictPort: false, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5311/';
  close = () => server.close();
} else {
  const PORT = 4211;
  const srv = await serveDist(resolve(arg('dist', join(ROOT, 'dist'))), PORT);
  base = `http://127.0.0.1:${PORT}/civilization/`;
  close = () => { srv.close(); };
}
const browser: Browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
/** The GPU driver's shader cache of this Chromium (macOS, Metal): emptied for a cold compile. */
function clearShaderCache() {
  try {
    const dir = execFileSync('getconf', ['DARWIN_USER_CACHE_DIR']).toString().trim();
    const m = join(dir, 'com.google.chrome.for.testing.helper', 'com.apple.metal');
    if (existsSync(m)) rmSync(m, { recursive: true, force: true });
  } catch { /* not macOS */ }
}

const urlOf = (look: string) => `${base}#/streets?${['errand=0', look === 'classic' ? 'look=classic' : `look=realism&tier=${look}`, EXTRA].filter(Boolean).join('&')}`;
type G = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const W = () => (window as unknown as { __palimpsestStreets: G }).__palimpsestStreets;

async function open(ctx: BrowserContext, look: string, cdp?: CDPSession) {
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') logs.push(`console: ${m.text().slice(0, 300)}`); });
  void cdp;
  const t0 = Date.now();
  await page.goto(urlOf(look), { waitUntil: 'domcontentloaded' });
  for (let k = 0; ; k++) {
    try { await page.waitForFunction(() => (window as any).__palimpsestStreets?.ready || document.querySelector('.st-load--err'), null, { timeout: 240000, polling: 50 }); break; } // eslint-disable-line @typescript-eslint/no-explicit-any
    catch (e) { if (k > 3 || !/destroyed|navigation/i.test(String(e))) throw e; await page.waitForLoadState('domcontentloaded'); }
  }
  const firstFrameMs = Date.now() - t0;
  const failed = await page.evaluate(() => document.querySelector('.st-load--err')?.textContent ?? null);
  if (failed) throw new Error(`${look}: ${failed} ${logs.join(' | ')}`);
  let fullQualityMs: number | null = null;
  if (look !== 'classic') {
    await page.waitForFunction(() => (window as any).__palimpsestStreets.lookTiming.fullQualityAt, null, { timeout: 600000, polling: 100 }).catch(() => null); // eslint-disable-line @typescript-eslint/no-explicit-any
    fullQualityMs = Date.now() - t0;
  }
  return { page, logs, firstFrameMs, fullQualityMs };
}

async function dismiss(page: Page) {
  const ok = page.getByRole('button', { name: 'Got it' });
  if (await ok.count()) await ok.click();
  await page.mouse.move(5, 5);
}

/** The views: the world's own framings (market, rooftop, river, palace gate), a lane found by the collision rays, and
 *  the errand's way (tablet house → river gate). */
async function views(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__palimpsestStreets; // eslint-disable-line @typescript-eslint/no-explicit-any
    const out: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const v of g.city.views()) if (['market', 'rooftop', 'river', 'palace'].includes(v.name)) out.push({ ...v, name: v.name === 'palace' ? 'palace-gate' : v.name });
    const pl = g.city.affordances.places;
    const tab = pl.find((p: any) => p.kind === 'tablet-house')?.pos; // eslint-disable-line @typescript-eslint/no-explicit-any
    // a lane: walls close on both sides for 10 m, a long way open ahead, near the house of tablets
    if (tab) {
      let best: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
      const ray = (x: number, y: number, z: number, dx: number, dz: number, far: number) => g.phys.rayFlat(x, y, z, dx, dz, far);
      for (let r = 6; r < 80; r += 3) {
        const n = Math.max(8, Math.round(r * 1.2));
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2, x = tab.x + Math.cos(a) * r, z = tab.z + Math.sin(a) * r;
          const gy = g.phys.groundAt(x, z, 60);
          if (gy === null || g.city.affordances.waterDepthAt(x, z) > 0 || !g.phys.free(x, gy + 0.05, z)) continue;
          for (let d = 0; d < 8; d++) {
            const yaw = (d / 8) * Math.PI * 2, fx = Math.sin(yaw), fz = Math.cos(yaw);
            const y = gy + 1.5;
            if (ray(x, y, z, fx, fz, 30) < 14) continue;
            let ok = 0, sum = 0;
            for (const s of [0, 3, 6, 9]) {
              const qx = x + fx * s, qz = z + fz * s;
              const L = ray(qx, y, qz, -fz, fx, 7), R = ray(qx, y, qz, fz, -fx, 7);
              if (L + R < 1.8) { ok = -9; break; }
              if (L < 6 && R < 6) ok++;
              sum += L + R;
            }
            if (ok < 3 || ray(x, y, z, -fx, -fz, 5) < 4) continue;
            const score = ray(x, y, z, fx, fz, 30) * 0.5 - sum * 0.6 - r * 0.05;
            if (!best || score > best.score) best = { name: 'lane', x, z, yaw, pitch: 0.06, want: 3.4, score };
          }
        }
      }
      if (best) out.push(best);
    }
    const gate = pl.find((p: any) => p.kind === 'gate' && /river gate/i.test(p.name)); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (tab && gate) {
      const way = g.city.layer.route(tab, gate.pos, 3);
      if (way?.pts?.length) out.push({ name: 'errand-run', x: tab.x, z: tab.z, yaw: 0, pitch: 0.18, route: way.pts.map((p: any) => ({ x: p.x, z: p.z })) }); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    return out;
  });
}

async function goView(page: Page, v: any, settle = 1300) { // eslint-disable-line @typescript-eslint/no-explicit-any
  await page.evaluate((v) => {
    const g = (window as any).__palimpsestStreets; // eslint-disable-line @typescript-eslint/no-explicit-any
    g.stopDriving();
    g.teleport(v.x, v.z, v.yaw);
    g.cam.yaw = v.yaw; g.cam.pitch = v.pitch;
    g.cam.want = v.want ?? 3.9;
    if (v.route) g.drive(v.route.map((p: any) => ({ ...p, run: true })), false); // eslint-disable-line @typescript-eslint/no-explicit-any
  }, v);
  await page.waitForTimeout(v.route ? 6500 : settle);
}

/** Texture memory: the look's streamed sets and sky, plus every image texture the scene's materials hold (RGBA8 with
 *  mips, or a compressed texture's own data). */
async function texMem(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = (window as any).__palimpsestStreets; // eslint-disable-line @typescript-eslint/no-explicit-any
    const seen = new Set<unknown>();
    let bytes = g.look ? g.look.stats().gpuTextureBytes ?? 0 : 0;
    g.scene.traverse((o: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      for (const m of [].concat(o.material ?? [])) {
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap', 'specularIntensityMap', 'anisotropyMap']) {
          const t = (m as any)[k]; // eslint-disable-line @typescript-eslint/no-explicit-any
          if (!t || seen.has(t)) continue;
          seen.add(t);
          if (t.isCompressedTexture) { for (const mm of t.mipmaps ?? []) bytes += mm.data?.byteLength ?? 0; continue; }
          const img = t.image;
          if (img?.width && img.height) bytes += img.width * img.height * 4 * (t.generateMipmaps !== false ? 4 / 3 : 1);
        }
      }
    });
    return Math.round(bytes);
  });
}

async function measure(page: Page, cdp: CDPSession, throttle: number, seconds: number) {
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.evaluate(() => { const g = (window as any).__palimpsestStreets; g.stats.frame.length = 0; g.stats.cpu.length = 0; g.gpuStats = []; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  // the view pans slowly back and forth (60° each way), so the frame draws different parts of the town
  await page.evaluate((sec) => {
    const g = (window as any).__palimpsestStreets; // eslint-disable-line @typescript-eslint/no-explicit-any
    const y0 = g.cam.yaw, t0 = performance.now();
    const tick = () => { const t = (performance.now() - t0) / 1000; if (t > sec) return; g.cam.yaw = y0 + Math.sin(t * 0.5) * 1.05; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }, seconds);
  const samples: { calls: number; triangles: number }[] = [];
  for (let k = 0; k < seconds; k++) { await page.waitForTimeout(1000); samples.push(await page.evaluate(() => { const i = (window as any).__palimpsestStreets.info(); return { calls: i.calls, triangles: i.triangles }; })); } // eslint-disable-line @typescript-eslint/no-explicit-any
  const st = await page.evaluate(() => { const g = (window as any).__palimpsestStreets; const r = { frame: g.stats.frame.slice(), cpu: g.stats.cpu.slice(), gpu: (g.gpuStats ?? []).slice() }; g.gpuStats = null; return r; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return {
    n: st.frame.length,
    frameMs: { median: r2(pct(st.frame, 50)), p95: r2(pct(st.frame, 95)) },
    cpuMs: { median: r2(pct(st.cpu, 50)), p95: r2(pct(st.cpu, 95)) },
    gpuMs: st.gpu.length ? { median: r2(pct(st.gpu, 50)), p95: r2(pct(st.gpu, 95)), n: st.gpu.length } : null,
    drawCalls: { median: pct(samples.map((s) => s.calls), 50), max: Math.max(...samples.map((s) => s.calls)) },
    triangles: { median: pct(samples.map((s) => s.triangles), 50), max: Math.max(...samples.map((s) => s.triangles)) },
  };
}

/** The hero: close (the face, from the front), mid-run, and on a ladder (posed by fixed steps). */
async function heroShots(page: Page, prefix: string, files: Record<string, string>) {
  const shot = async (n: string) => { const f = join(OUT, `${prefix}-${n}.png`); await page.screenshot({ path: f }); files[n] = f; };
  await page.evaluate(() => {
    const g = (window as any).__palimpsestStreets; // eslint-disable-line @typescript-eslint/no-explicit-any
    const v = g.city.views().find((x: any) => x.name === 'market'); // eslint-disable-line @typescript-eslint/no-explicit-any
    g.stopDriving(); g.teleport(v.x, v.z, v.yaw);
    g.cam.yaw = v.yaw + Math.PI - 0.5; g.cam.pitch = 0.04; g.cam.want = 1.9;
  });
  await page.waitForTimeout(1500);
  await shot('hero-close');
  const ok = await page.evaluate(() => {
    const g = (window as any).__palimpsestStreets; // eslint-disable-line @typescript-eslint/no-explicit-any
    const l = g.streetLadders(8).filter((x: any) => x.h > 3.5)[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!l) return false;
    g.film(true);
    const a = g.atLadder(l.i, false);
    g.cam.yaw = a.facing + 0.7; g.cam.pitch = 0.1; g.cam.want = 3.4;
    g.advance(0.4, { mx: 0, my: 0, run: false, pace: 0, jumpHeld: false });
    g.advance(1.1, { mx: 0, my: 1, run: false, pace: 0.35, jumpHeld: false });
    return true;
  });
  if (ok) { await page.waitForTimeout(400); await shot('hero-climb'); await page.evaluate(() => (window as any).__palimpsestStreets.film(false)); } // eslint-disable-line @typescript-eslint/no-explicit-any
}

const summary: Record<string, any> = { date: new Date().toISOString(), base, runs: {} }; // eslint-disable-line @typescript-eslint/no-explicit-any
try {
  for (const s of SIZES) {
    for (const look of s.looks.filter((l) => !LOOKS.length || LOOKS.includes(l))) {
      const key = `${s.name}-${look}${TAG ? `-${TAG}` : ''}`;
      const ctxOpts = { viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr, isMobile: s.mobile, hasTouch: s.mobile };
      // the machine's load when this look was measured (other work on it slows frames down)
      const run: Record<string, any> = { url: urlOf(look), shots: {}, loadAvg: loadavg().map((v) => Math.round(v * 10) / 10) }; // eslint-disable-line @typescript-eslint/no-explicit-any
      // ---- cold: the GPU driver's shader cache emptied (the first visit of a new player)
      if (has('cold') && look !== 'classic') {
        clearShaderCache();
        const ctx = await browser.newContext(ctxOpts);
        const o = await open(ctx, look);
        run.cold = { firstFrameMs: o.firstFrameMs, timing: await o.page.evaluate(() => (window as any).__palimpsestStreets.lookTiming) }; // eslint-disable-line @typescript-eslint/no-explicit-any
        await ctx.close();
      }
      const ctx = await browser.newContext(ctxOpts);
      const cdp0 = await ctx.newCDPSession(await ctx.newPage());
      void cdp0;
      const o = await open(ctx, look);
      const page = o.page;
      const cdp = await ctx.newCDPSession(page);
      run.firstFrameMs = o.firstFrameMs; run.fullQualityMs = o.fullQualityMs;
      run.info = await page.evaluate(() => { const g = (window as any).__palimpsestStreets; const i = g.info(); return { look: i.look, timing: g.timing, dpr: i.dpr, size: i.size }; }); // eslint-disable-line @typescript-eslint/no-explicit-any
      await dismiss(page);
      await page.waitForTimeout(800);
      run.textureBytes = await texMem(page);
      const vs = (await views(page)).filter((v) => !VIEWS.length || VIEWS.includes(v.name));
      run.views = {};
      for (const v of vs) {
        await goView(page, v);
        if (!has('no-shots')) { const f = join(OUT, `${s.name}-${v.name}-${look}${TAG ? `-${TAG}` : ''}.png`); await page.screenshot({ path: f }); run.shots[v.name] = f; }
        if (!has('no-measure')) {
          if (v.route) await goView(page, { ...v }, 0); // the run again from the door, measured on the way
          run.views[v.name] = await measure(page, cdp, s.throttle, v.route ? Math.min(SECONDS, 24) : SECONDS);
          console.log(key, v.name, JSON.stringify(run.views[v.name]));
        }
      }
      if (!has('no-shots')) await heroShots(page, `${s.name}-hero-${look}${TAG ? `-${TAG}` : ''}`, run.shots);
      run.textureBytesAfter = await texMem(page);
      run.logs = o.logs.slice(0, 20);
      await ctx.close();
      // ---- slow 4G (phones also 4× CPU): time to the first frame and to full quality
      if (NET === '4g') {
        const c2 = await browser.newContext(ctxOpts);
        const p2 = await c2.newPage();
        const cd = await c2.newCDPSession(p2);
        await cd.send('Network.enable');
        await cd.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
        if (s.throttle > 1) await cd.send('Emulation.setCPUThrottlingRate', { rate: s.throttle });
        const bytes: { url: string; n: number }[] = [];
        p2.on('response', async (r) => { const n = Number(r.headers()['content-length'] ?? 0) || (await r.body().catch(() => Buffer.alloc(0))).length; bytes.push({ url: r.url(), n }); });
        const t0 = Date.now();
        await p2.goto(urlOf(look), { waitUntil: 'domcontentloaded' });
        await p2.waitForFunction(() => (window as any).__palimpsestStreets?.ready || document.querySelector('.st-load--err'), null, { timeout: 600000, polling: 100 }); // eslint-disable-line @typescript-eslint/no-explicit-any
        const ttff = Date.now() - t0;
        const kbFirst = Math.round(bytes.reduce((a, b) => a + b.n, 0) / 1024);
        let ttfq: number | null = null;
        if (look !== 'classic') {
          await p2.waitForFunction(() => (window as any).__palimpsestStreets.lookTiming.fullQualityAt, null, { timeout: 900000, polling: 250 }).catch(() => null); // eslint-disable-line @typescript-eslint/no-explicit-any
          ttfq = Date.now() - t0;
        }
        run.slow4g = { firstFrameMs: ttff, fullQualityMs: ttfq, kbBeforeFirstFrame: kbFirst, kbTotal: Math.round(bytes.reduce((a, b) => a + b.n, 0) / 1024) };
        console.log(key, 'slow 4G', JSON.stringify(run.slow4g));
        await c2.close();
      }
      summary.runs[key] = run;
      console.log(`== ${key}: first frame ${run.firstFrameMs} ms, full quality ${run.fullQualityMs} ms, textures ${Math.round(run.textureBytes / 1048576)} MB`, JSON.stringify(run.info.look.timing));
      writeFileSync(join(OUT, `look${TAG ? `-${TAG}` : ''}${ONLY ? `-${ONLY}` : ''}.json`), JSON.stringify(summary, null, 1));
    }
  }
  if (!has('no-shots')) await sheets(browser);
} finally {
  await browser.close();
  await close();
}

/** A sheet per size and view (the looks side by side, captioned), and an overview per size (every view, small). */
async function sheets(b: Browser) {
  const dir = join(OUT, 'sheets');
  mkdirSync(dir, { recursive: true });
  const label: Record<string, string> = { classic: 'Classic (WebGL)', desktop: 'Realism · Ultra (desktop)', 'desktop-medium': 'Realism · High (desktop-medium)', phone: 'Realism · Medium (phone, 30 fps)', 'phone-low': 'Realism · Low (phone-low)' };
  for (const s of SIZES) {
    const looks = s.looks;
    const names = ['market', 'rooftop', 'river', 'lane', 'palace-gate', 'errand-run', 'hero-close', 'hero-climb'];
    const fileOf = (v: string, l: string) => (v.startsWith('hero-') ? join(OUT, `${s.name}-hero-${l}${TAG ? `-${TAG}` : ''}-${v}.png`) : join(OUT, `${s.name}-${v}-${l}${TAG ? `-${TAG}` : ''}.png`));
    const scale = s.name === 'desktop' ? 0.5 : 0.62;
    const cw = Math.round(s.width * scale * (s.name === 'desktop' ? 1 : 1)), ch = Math.round(s.height * scale);
    const rows: string[] = [];
    for (const v of names) {
      const imgs = looks.map((l) => ({ l, f: fileOf(v, l) })).filter((x) => existsSync(x.f));
      if (imgs.length < 2) continue;
      const fig = (x: { l: string; f: string }, w: number, h: number) => `<figure style="margin:0"><img src="data:image/png;base64,${readFileSync(x.f).toString('base64')}" style="width:${w}px;height:${h}px;display:block;border-radius:4px"><figcaption style="padding:5px 2px 0">${label[x.l] ?? x.l} · ${v}</figcaption></figure>`;
      const html = `<html><body style="margin:0;background:#141210;font:600 14px/1.2 system-ui,sans-serif;color:#efe6d6"><div style="display:flex;gap:10px;padding:10px">${imgs.map((x) => fig(x, cw, ch)).join('')}</div></body></html>`;
      const ctx = await b.newContext({ viewport: { width: imgs.length * (cw + 10) + 10, height: ch + 40 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.setContent(html);
      await page.waitForTimeout(100);
      const f = join(dir, `sheet-${s.name}-${v}${TAG ? `-${TAG}` : ''}.jpg`);
      await page.screenshot({ path: f, type: 'jpeg', quality: 86 });
      await ctx.close();
      rows.push(`<div style="display:flex;gap:6px;padding:3px 6px">${imgs.map((x) => `<img src="data:image/png;base64,${readFileSync(x.f).toString('base64')}" style="width:${Math.round(cw * 0.6)}px;height:${Math.round(ch * 0.6)}px;display:block">`).join('')}<span style="writing-mode:vertical-rl">${v}</span></div>`);
    }
    if (rows.length) {
      const html = `<html><body style="margin:0;background:#141210;font:600 12px system-ui;color:#efe6d6"><div style="padding:6px">${looks.map((l) => label[l] ?? l).join(' | ')}</div>${rows.join('')}</body></html>`;
      const ctx = await b.newContext({ viewport: { width: looks.length * (Math.round(cw * 0.6) + 6) + 40, height: 400 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.setContent(html);
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(dir, `overview-${s.name}${TAG ? `-${TAG}` : ''}.jpg`), type: 'jpeg', quality: 80, fullPage: true });
      await ctx.close();
    }
    console.log('sheets →', dir);
  }
}
