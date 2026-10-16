// The Streets movement spike (#/streets): plays it in a browser at desktop and phone sizes, drives the runner with real
// input (keys; touches on the stick and the jump button), screenshots walking, running, jumping and the camera against a
// wall, runs axe, then walks a scripted round for N seconds and reports frame times (median, p95), draw calls,
// triangles and physics bodies. Phones get a 4× CPU slowdown for the round.
// Usage: npm --prefix atlas run build && npm --prefix atlas run streets -- [--out=dir] [--only=desktop|phone]
//          [--seconds=20] [--city=set:151 --y=2234] [--reduced] [--url=http://127.0.0.1:5173/] (a dev server instead of dist/)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type CDPSession, type Page } from 'playwright';
import { serveDist } from './serve.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = resolve(arg('out', join(ROOT, '..', 'build', 'streets')));
const ONLY = arg('only', '');
const SECONDS = Number(arg('seconds', '20'));
const CITY = arg('city', '');
const YEAR = arg('y', '');
const REDUCED = process.argv.includes('--reduced');
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
mkdirSync(OUT, { recursive: true });

let base = arg('url', '');
const PORT = 4197;
const server = base ? null : await serveDist(resolve(arg('dist', join(ROOT, 'dist'))), PORT);
if (!base) base = `http://127.0.0.1:${PORT}/civilization/`;
const query = [CITY && `city=${CITY}`, YEAR && `y=${YEAR}`].filter(Boolean).join('&');
const href = `${base}#/streets${query ? `?${query}` : ''}`;

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }).catch(() => chromium.launch());
const sizes = [
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false, throttle: 1 },
  { name: 'phone', width: 390, height: 844, dpr: 2, mobile: true, throttle: 4 },
].filter((s) => !ONLY || s.name === ONLY);

const pct = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const r2 = (v: number) => Math.round(v * 100) / 100;

interface Info {
  calls: number; triangles: number; geometries: number; textures: number;
  physics: { bodies: number; colliders: number; boxes: number; hulls: number; groundTris: number; buildMs: number };
  gaits: Record<string, { name: string; speed: number; front: number; duration: number }>;
  pose: string; speed: number; grounded: boolean; feet: { x: number; y: number; z: number };
  cam: { wanted: number; got: number; yaw: number; pitch: number; fov: number; y: number }; dpr: number; size: number[];
  timing: Record<string, number>; city: { id: string; name: string; year: number; P: number; solids: number };
}
type W = { __palimpsestStreets: {
  ready: boolean; info(): Info; stats: { frame: number[]; cpu: number[]; phys: number[]; skate: number[] };
  drive(p: unknown[], loop?: boolean): void; stopDriving(): void; demoPath(): unknown[]; wallShot(): { ok: boolean; wanted: number; got: number };
  roofRun(): { ok: boolean; from?: { x: number; z: number; top: number }; to?: { x: number; z: number; top: number }; gap?: number };
  teleport(x: number, z: number, f?: number): void; input: { virtual: unknown }; feel(): Record<string, number>;
} };

const info = (page: Page) => page.evaluate(() => (window as unknown as W).__palimpsestStreets.info());
const summary: Record<string, unknown> = { href, seconds: SECONDS };

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: { x: number; y: number; id: number }[]) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : pts.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) });
}

try {
  for (const s of sizes) {
    const ctx = await browser.newContext({
      viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr, isMobile: s.mobile, hasTouch: s.mobile,
      reducedMotion: REDUCED ? 'reduce' : 'no-preference',
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    // what the route downloads (bytes on the wire: gzip where the server compresses, as GitHub Pages does)
    const wire: { url: string; bytes: number }[] = [];
    page.on('response', async (r) => {
      const len = Number(r.headers()['content-length'] ?? 0);
      wire.push({ url: r.url().replace(base, ''), bytes: len || (await r.body().catch(() => Buffer.alloc(0))).length });
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    const shot = async (name: string) => {
      const file = join(OUT, `${s.name}-${name}${REDUCED ? '-reduced' : ''}.png`);
      await page.screenshot({ path: file });
      return file;
    };
    // the cold load, with the same CPU slowdown as the round
    const cdp = await ctx.newCDPSession(page);
    if (s.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: s.throttle });
    const t0 = Date.now();
    await page.goto(href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as unknown as W).__palimpsestStreets?.ready, null, { timeout: 90000 });
    const loadMs = Date.now() - t0;
    if (s.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);
    const files: Record<string, string> = {};
    files.hint = await shot('hint');

    // axe over the first screen (hint showing): WCAG A/AA
    await page.addScriptTag({ content: AXE });
    const axe = await page.evaluate(async () => {
      const a = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
      const r = await a.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, where: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
    });
    await page.getByRole('button', { name: 'Got it' }).click();
    await page.waitForTimeout(300);
    const start = (await info(page)).feet;

    // ---- real input: walk, run, jump
    const moves: Record<string, unknown> = {};
    if (!s.mobile) {
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(1300);
      const walk = await info(page);
      files.walk = await shot('walk');
      await page.keyboard.down('Shift');
      await page.waitForTimeout(1300);
      const run = await info(page);
      files.run = await shot('run');
      // camera height over the feet while running: the stride bob (none with reduced motion)
      const bobs: number[] = [];
      for (let k = 0; k < 14; k++) { const i = await info(page); bobs.push(i.cam.y - i.feet.y); await page.waitForTimeout(35); }
      moves.bob = { rangeM: r2(Math.max(...bobs) - Math.min(...bobs)) };
      await page.keyboard.down('Space');
      await page.waitForTimeout(240);
      const jump = await info(page);
      files.jump = await shot('jump');
      await page.keyboard.up('Space');
      await page.waitForTimeout(900);
      await page.keyboard.up('Shift');
      await page.keyboard.up('KeyW');
      await page.waitForTimeout(700);
      const stop = await info(page);
      moves.walk = { pose: walk.pose, speed: r2(walk.speed) };
      moves.run = { pose: run.pose, speed: r2(run.speed), fov: r2(run.cam.fov) };
      moves.jump = { pose: jump.pose, grounded: jump.grounded, height: r2(jump.feet.y - run.feet.y) };
      moves.stop = { pose: stop.pose, speed: r2(stop.speed), moved: r2(Math.hypot(stop.feet.x - start.x, stop.feet.z - start.z)), fov: r2(stop.cam.fov) };
      // mouse look by dragging (pointer lock may be refused headless): a quarter turn
      const yaw0 = stop.cam.yaw;
      await page.mouse.move(s.width / 2, s.height / 2);
      await page.mouse.down();
      await page.mouse.move(s.width / 2 + 200, s.height / 2, { steps: 8 });
      await page.mouse.up();
      moves.look = { yawChange: r2((await info(page)).cam.yaw - yaw0) };
    } else {
      // the stick: a short push walks, a push to the rim runs; the jump button jumps
      const jx = 84, jy = s.height - 100;
      await touch(cdp, 'touchStart', [{ x: jx, y: jy, id: 1 }]);
      for (let k = 1; k <= 6; k++) { await touch(cdp, 'touchMove', [{ x: jx, y: jy - k * 4, id: 1 }]); await page.waitForTimeout(16); }
      await page.waitForTimeout(1300);
      const walk = await info(page);
      files.walk = await shot('walk');
      for (let k = 7; k <= 18; k++) { await touch(cdp, 'touchMove', [{ x: jx, y: jy - k * 4, id: 1 }]); await page.waitForTimeout(16); }
      await page.waitForTimeout(1300);
      const run = await info(page);
      files.run = await shot('run');
      const jb = await page.locator('.st-jump').boundingBox();
      await touch(cdp, 'touchStart', [{ x: jx, y: jy - 72, id: 1 }, { x: jb!.x + jb!.width / 2, y: jb!.y + jb!.height / 2, id: 2 }]);
      await page.waitForTimeout(60);
      await touch(cdp, 'touchMove', [{ x: jx, y: jy - 72, id: 1 }]);
      await page.waitForTimeout(170);
      const jump = await info(page);
      files.jump = await shot('jump');
      await page.waitForTimeout(900);
      await touch(cdp, 'touchEnd', []);
      await page.waitForTimeout(700);
      const stop = await info(page);
      // drag on the right half to look
      const yaw0 = stop.cam.yaw;
      await touch(cdp, 'touchStart', [{ x: s.width * 0.75, y: s.height * 0.4, id: 3 }]);
      for (let k = 1; k <= 8; k++) { await touch(cdp, 'touchMove', [{ x: s.width * 0.75 - k * 12, y: s.height * 0.4, id: 3 }]); await page.waitForTimeout(16); }
      await touch(cdp, 'touchEnd', []);
      moves.walk = { pose: walk.pose, speed: r2(walk.speed) };
      moves.run = { pose: run.pose, speed: r2(run.speed) };
      moves.jump = { pose: jump.pose, grounded: jump.grounded, height: r2(jump.feet.y - run.feet.y) };
      moves.stop = { pose: stop.pose, speed: r2(stop.speed), moved: r2(Math.hypot(stop.feet.x - start.x, stop.feet.z - start.z)) };
      moves.look = { yawChange: r2((await info(page)).cam.yaw - yaw0) };
    }

    // ---- the camera against a wall
    const wall = await page.evaluate(() => (window as unknown as W).__palimpsestStreets.wallShot());
    await page.waitForTimeout(900);
    const wi = await info(page);
    files.wall = await shot('wall');
    moves.wall = { ...wall, camWanted: r2(wi.cam.wanted), camGot: r2(wi.cam.got) };

    // ---- the rooftop hook: on a roof, run and jump the gap to the next one
    const roof = await page.evaluate(() => (window as unknown as W).__palimpsestStreets.roofRun());
    if (roof.ok) {
      await page.waitForTimeout(250);
      files.roof = await shot('roof');
      let airShot = false, minY = Infinity;
      const poses = new Set<string>();
      for (let k = 0; k < 70; k++) {
        await page.waitForTimeout(40);
        const i = await info(page);
        poses.add(i.pose);
        minY = Math.min(minY, i.feet.y);
        if (!airShot && !i.grounded && (i.pose === 'jump' || i.pose === 'fall')) { airShot = true; files.roofJump = await shot('roof-jump'); }
      }
      const end = await info(page);
      const onB = Math.hypot(end.feet.x - roof.to!.x, end.feet.z - roof.to!.z) < 4.5 && Math.abs(end.feet.y - roof.to!.top) < 1;
      moves.roof = { gap: r2(roof.gap!), fromTop: r2(roof.from!.top), toTop: r2(roof.to!.top), endY: r2(end.feet.y), lowestY: r2(minY), landedOnNextRoof: onB, poses: [...poses] };
    } else moves.roof = { ok: false };

    // ---- feel, measured by stepping the movement itself (independent of frame rate)
    const feel = await page.evaluate(() => (window as unknown as W).__palimpsestStreets.feel());

    // ---- the scripted round, timed (phones: 4× slower CPU)
    await page.evaluate(() => {
      const g = (window as unknown as W).__palimpsestStreets;
      const p = g.demoPath() as { x: number; z: number }[];
      g.teleport(p[p.length - 1].x, p[p.length - 1].z);
      g.drive(p, true);
    });
    await page.waitForTimeout(1200);
    if (s.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: s.throttle });
    await page.evaluate(() => { const st = (window as unknown as W).__palimpsestStreets.stats; st.frame.length = 0; st.cpu.length = 0; st.phys.length = 0; st.skate.length = 0; });
    const samples: Info[] = [];
    for (let k = 0; k < SECONDS; k++) {
      await page.waitForTimeout(1000);
      samples.push(await info(page));
      if (k === Math.floor(SECONDS / 2)) files.round = await shot('round');
    }
    const st = await page.evaluate(() => { const g = (window as unknown as W).__palimpsestStreets; return { frame: g.stats.frame.slice(), cpu: g.stats.cpu.slice(), phys: g.stats.phys.slice(), skate: g.stats.skate.slice() }; });
    if (s.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.evaluate(() => (window as unknown as W).__palimpsestStreets.stopDriving());
    const last = samples[samples.length - 1];
    const maxCalls = Math.max(...samples.map((x) => x.calls)), maxTris = Math.max(...samples.map((x) => x.triangles));
    const poses = [...new Set(samples.map((x) => x.pose))];
    const kb = (re: RegExp) => Math.round(wire.filter((w) => re.test(w.url)).reduce((a, w) => a + w.bytes, 0) / 1024);
    const res = {
      download: {
        jsKB: kb(/\.js(\?|$)/), cssKB: kb(/\.css(\?|$)/), dataKB: kb(/data\/.*\.json/), modelKB: kb(/\.glb$/), fontsKB: kb(/\.woff2?$/),
        chunks: wire.filter((w) => /\.(js|glb)$/.test(w.url)).map((w) => `${w.url.replace(/^.*\//, '')} ${Math.round(w.bytes / 1024)} KB`),
      },
      size: `${s.width}×${s.height} @${s.dpr}x (render dpr ${last.dpr})${s.throttle > 1 ? `, ${s.throttle}× CPU slowdown` : ''}`,
      loadMs,
      timing: Object.fromEntries(Object.entries(last.timing).map(([k, v]) => [k, Math.round(v)])),
      frames: st.frame.length,
      frameMs: { median: r2(pct(st.frame, 50)), p95: r2(pct(st.frame, 95)), max: r2(Math.max(...st.frame)) },
      fps: { median: r2(1000 / pct(st.frame, 50)), p5: r2(1000 / pct(st.frame, 95)) },
      cpuMs: { median: r2(pct(st.cpu, 50)), p95: r2(pct(st.cpu, 95)) },
      physicsMs: { median: r2(pct(st.phys, 50)), p95: r2(pct(st.phys, 95)) },
      /** |feet's ground speed − real speed| while walking or running, m/s (0 = no skating). */
      footSkate: { median: r2(pct(st.skate, 50)), p95: r2(pct(st.skate, 95)), n: st.skate.length },
      drawCalls: { last: last.calls, max: maxCalls },
      triangles: { last: last.triangles, max: maxTris },
      physics: last.physics,
      gaits: Object.fromEntries(Object.entries(last.gaits).map(([k, g]) => [k, `${g.name} ${r2(g.speed)} m/s`])),
      posesSeen: poses,
      city: last.city,
      moves,
      feel,
      axe,
      errors,
      files,
    };
    summary[s.name] = res;
    console.log(`\n== ${s.name}: ${res.size}`);
    console.log(`  cold load to first frame ${loadMs} ms${s.throttle > 1 ? ` at ${s.throttle}× CPU slowdown` : ''} (${JSON.stringify(res.timing)})`);
    console.log(`  downloaded: JS ${res.download.jsKB} KB, CSS ${res.download.cssKB} KB, data ${res.download.dataKB} KB, model ${res.download.modelKB} KB, fonts ${res.download.fontsKB} KB (on the wire)`);
    console.log(`    ${res.download.chunks.join(' · ')}`);
    console.log(`  ${SECONDS}s round: ${res.frames} frames, frame ${res.frameMs.median} ms median / ${res.frameMs.p95} ms p95 (${res.fps.median} fps median, ${res.fps.p5} fps at p95); CPU ${res.cpuMs.median}/${res.cpuMs.p95} ms; physics ${res.physicsMs.median}/${res.physicsMs.p95} ms`);
    console.log(`  draw calls ${res.drawCalls.last} (max ${res.drawCalls.max}), triangles ${res.triangles.last} (max ${res.triangles.max}); physics ${JSON.stringify(res.physics)}`);
    console.log(`  gaits ${JSON.stringify(res.gaits)}; poses seen ${poses.join(', ')}; foot skate ${res.footSkate.median} m/s median, ${res.footSkate.p95} p95`);
    console.log(`  moves ${JSON.stringify(moves)}`);
    console.log(`  feel ${JSON.stringify(feel)}`);
    console.log(`  axe: ${axe.length ? axe.map((v) => `${v.impact} ${v.id} ×${v.n} (${v.where.join(' | ')})`).join('; ') : 'no violations'}`);
    if (errors.length) console.log(`  errors:\n    ${errors.slice(0, 8).join('\n    ')}`);
    console.log(`  screenshots: ${Object.values(files).join(', ')}`);
    await ctx.close();
  }
  writeFileSync(join(OUT, `stats${REDUCED ? '-reduced' : ''}.json`), JSON.stringify(summary, null, 2));
  console.log(`\nstats → ${join(OUT, `stats${REDUCED ? '-reduced' : ''}.json`)}`);
} finally {
  await browser.close();
  server?.close();
}
