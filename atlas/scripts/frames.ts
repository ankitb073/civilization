// Render the political map every 25 years (0 → 5000) and encode the borders animation.
// Usage: npm --prefix atlas run build && npm --prefix atlas run frames
// Output: docs/img/borders.mp4 (H.264, yuv420p, ~20 s) and docs/img/borders.gif (720 px, ≤ 8 MB).

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '..', 'docs', 'img');
const TMP = join(ROOT, '.frames');
const PORT = 4181;
const STEP = Number(process.argv.find((a) => a.startsWith('--step='))?.slice(7) ?? 25);
const FFMPEG = ['/opt/homebrew/bin/ffmpeg', 'ffmpeg'].find((p) => spawnSync(p, ['-version']).status === 0);
if (!FFMPEG) throw new Error('ffmpeg not found');

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 20000);
  server.stdout!.on('data', (b: Buffer) => { if (b.toString().includes(String(PORT))) { clearTimeout(t); resolve(); } });
});

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }).catch(() => chromium.launch());
let n = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/civilization/#/map?y=0&l=political&frames=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof (window as unknown as { __palimpsestSetYear?: unknown }).__palimpsestSetYear === 'function', null, { timeout: 30000 });
  await page.waitForTimeout(600);
  const t0 = Date.now();
  for (let y = 0; y <= 5000; y += STEP) {
    await page.evaluate((yy) => (window as unknown as { __palimpsestSetYear: (y: number) => Promise<void> }).__palimpsestSetYear(yy), y);
    await page.screenshot({ path: join(TMP, `f${String(n).padStart(4, '0')}.png`) });
    n++;
  }
  console.log(`${n} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await ctx.close();
} finally {
  await browser.close();
  server.kill();
}

const fps = Math.max(1, Math.round(n / 20));
const run = (args: string[]) => {
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
};
const mp4 = join(OUT, 'borders.mp4');
// hold the last frame for 2 s
run(['-framerate', String(fps), '-i', join(TMP, 'f%04d.png'), '-vf', `tpad=stop_mode=clone:stop_duration=2,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', mp4]);

const gif = join(OUT, 'borders.gif');
const pal = join(TMP, 'palette.png');
for (const [colors, gfps] of [[160, fps], [128, Math.max(6, Math.round(fps * 0.8))], [96, Math.max(5, Math.round(fps * 0.6))], [64, 5]] as const) {
  const vf = `fps=${gfps},scale=720:-1:flags=lanczos`;
  run(['-i', mp4, '-vf', `${vf},palettegen=max_colors=${colors}:stats_mode=diff`, pal]);
  run(['-i', mp4, '-i', pal, '-lavfi', `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, gif]);
  const mb = statSync(gif).size / 1e6;
  console.log(`gif: ${colors} colours @ ${gfps} fps → ${mb.toFixed(1)} MB`);
  if (mb <= 8) break;
}
console.log(`borders.mp4 ${(statSync(mp4).size / 1e6).toFixed(1)} MB (${fps} fps), borders.gif ${(statSync(gif).size / 1e6).toFixed(1)} MB`);
rmSync(TMP, { recursive: true, force: true });
