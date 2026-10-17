// The hero in three.js 0.185.1 (the atlas's own), headless: proves hero.glb survives export and plays every clip.
// Runs the atlas's Vite dev server on atlas/dev/hero.html, lights the hero with the build's sky (env_1k.hdr) and a
// warm sun, and writes to --out:
//   <shot>.png        every shot in shots.json (the same poses and cameras as the Blender renders)
//   clips.png         a contact sheet: every clip at six moments, from the front three-quarter camera
//   report.json       load time, triangles, draw calls, materials, every clip's largest joint difference from
//                     runner.glb on the same clip and time (0 = the skeleton and clips came across unchanged), frame
//                     times while running, page errors
// Lives here (not in scripts/streets/hero/) so it resolves playwright, vite and three from atlas/node_modules.
// Usage (from the repo root; build.sh runs it): node atlas/dev/hero-shoot.ts [--glb=/game/streets/hero/hero.glb]
//   [--out=build/hero/renders/three] [--size=900x1100] [--shots=all|a,b] [--sss=1] [--cornea=additive|glass]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));
const ATLAS = resolve(HERE, '..');
const REPO = resolve(ATLAS, '..');
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const GLB = arg('glb', '/game/streets/hero/hero.glb');
const OUT = resolve(arg('out', join(REPO, 'build', 'hero', 'renders', 'three')));
const [W, H] = arg('size', '900x1100').split('x').map(Number);
const ENV = join(REPO, 'build', 'hero', 'work', 'env_1k.hdr');
const SHOTS = JSON.parse(readFileSync(join(REPO, 'scripts', 'streets', 'hero', 'shots.json'), 'utf8')).shots as Record<string, [string, number, string]>;
const want = arg('shots', 'all') === 'all' ? Object.keys(SHOTS) : arg('shots', '').split(',');
mkdirSync(OUT, { recursive: true });

const server = await createServer({ root: ATLAS, configFile: join(ATLAS, 'vite.config.ts'), logLevel: 'warn', server: { port: 5193, strictPort: false, host: '127.0.0.1' } });
await server.listen();
const base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5193/';
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }).catch(() => chromium.launch());

type Hero = {
  __hero: {
    ready: boolean; clips: { name: string; duration: number }[]; stats: Record<string, unknown>; errors: string[];
    shot(clip: string | null, t: number, v: string): number; compare(n: number): Record<string, { maxJointDiff: number; finite: boolean; height: [number, number] }>;
    frameTimes(clip?: string, ms?: number): Promise<{ frames: number; median: number; p95: number }>; resize(w: number, h: number): void;
    gameCheck(): Promise<Record<string, unknown>>;
  };
};

try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  const url = `${base}dev/hero.html?play=0&glb=${encodeURIComponent(GLB)}&env=${encodeURIComponent(`/@fs${ENV}`)}` +
    `&sss=${arg('sss', '1')}&cornea=${arg('cornea', 'additive')}`;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as Hero).__hero?.ready, null, { timeout: 120000 });
  const ready = Date.now() - t0;
  const info = await page.evaluate(() => { const h = (window as unknown as Hero).__hero; return { clips: h.clips, stats: h.stats }; });

  // every shot
  let drawCalls = 0;
  for (const name of want) {
    const [clip, t, cam] = SHOTS[name];
    if (clip === 'rest') continue;
    drawCalls = await page.evaluate(({ clip, t, cam }) => (window as unknown as Hero).__hero.shot(clip === 'bind' ? null : clip, t, cam) as unknown as number, { clip, t, cam });
    await page.screenshot({ path: join(OUT, `${name}.png`) });
  }
  (info.stats as Record<string, unknown>).drawCalls = drawCalls;

  // every clip at six moments, tiled in the page
  const cols = 6, cw = 300, ch = 380;
  await page.setViewportSize({ width: cw, height: ch });
  await page.evaluate(({ cw, ch }) => (window as unknown as Hero).__hero.resize(cw, ch), { cw, ch });
  const tiles: string[] = [];
  for (const c of info.clips) {
    for (let i = 0; i < cols; i++) {
      const t = (i / (cols - 1)) * c.duration * 0.999;
      await page.evaluate(({ n, t }) => (window as unknown as Hero).__hero.shot(n, t, 'three'), { n: c.name, t });
      tiles.push((await page.screenshot()).toString('base64'));
    }
  }
  await page.setViewportSize({ width: cols * cw, height: Math.ceil(tiles.length / cols) * ch });
  await page.evaluate(({ tiles, cols, cw, ch, names }) => new Promise<void>((done) => {
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#111;display:grid;grid-template-columns:repeat(' + cols + ',' + cw + 'px)';
    let left = tiles.length;
    tiles.forEach((b64, i) => {
      const d = document.createElement('div');
      d.style.cssText = `position:relative;width:${cw}px;height:${ch}px`;
      const im = new Image();
      im.onload = () => { if (--left === 0) done(); };
      im.src = `data:image/png;base64,${b64}`;
      d.append(im);
      if (i % cols === 0) {
        const l = document.createElement('div');
        l.textContent = names[i / cols];
        l.style.cssText = 'position:absolute;left:6px;top:4px;font:600 14px system-ui;color:#fff;text-shadow:0 1px 2px #000';
        d.append(l);
      }
      document.body.append(d);
    });
  }), { tiles, cols, cw, ch, names: info.clips.map((c) => c.name) });
  await page.screenshot({ path: join(OUT, 'clips.png'), fullPage: true });

  // the clips against runner.glb's, and frame times (a fresh page, back at the shot size)
  const p2 = await ctx.newPage();
  await p2.setViewportSize({ width: W, height: H });
  p2.on('pageerror', (e) => errors.push(String(e)));
  p2.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await p2.goto(url, { waitUntil: 'load' });
  await p2.waitForFunction(() => !!(window as unknown as Hero).__hero?.ready, null, { timeout: 120000 });
  const compare = await p2.evaluate(() => (window as unknown as Hero).__hero.compare(12));
  const frames = await p2.evaluate(() => (window as unknown as Hero).__hero.frameTimes('Jog_Fwd_Loop', 3000));
  const game = await p2.evaluate(() => (window as unknown as Hero).__hero.gameCheck());
  const pageErrors = await p2.evaluate(() => (window as unknown as Hero).__hero.errors);
  const worst = Math.max(0, ...Object.values(compare).map((c) => c.maxJointDiff));
  const report = { glb: GLB, readyMs: ready, ...info.stats, clips: info.clips, compare, worstJointDiffMetres: worst, frames, game, errors: [...errors, ...pageErrors] };
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log(`hero in three.js: ready in ${ready} ms, ${info.stats.triangles} triangles, ${info.clips.length} clips; ` +
    `joints vs runner.glb within ${(worst * 1000).toFixed(3)} mm; frames median ${frames.median?.toFixed(1)} ms; ${report.errors.length} errors → ${OUT}`);
} finally {
  await browser.close();
  await server.close();
}
