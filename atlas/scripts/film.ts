// Renders the 3D fly-through (#/3d?cinema=1) to video: steps window.__cinema(t) frame by frame in Playwright,
// screenshots each frame and encodes with ffmpeg. Deterministic: the same build gives the same frames.
// Usage: npm --prefix atlas run build && node atlas/scripts/film.ts --out=dir [--formats=wide,square,vertical] [--fps=30] [--every=1]
//   --every=N renders every Nth frame only (a quick preview); --sheet writes a contact sheet of every 60th frame.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveDist } from './serve.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = resolve(arg('out', join(ROOT, '..', 'build', 'film')));
const FPS = Number(arg('fps', '30'));
const EVERY = Math.max(1, Number(arg('every', '1')));
const SHEET = process.argv.includes('--sheet');
const KEEP = process.argv.includes('--keep-frames');
const FFMPEG = arg('ffmpeg', existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');
const CRF = arg('crf', '20');
const FORMATS = arg('formats', 'wide,square,vertical').split(',');
const SIZES: Record<string, { w: number; h: number; file: string }> = {
  wide: { w: 1920, h: 1080, file: 'yuvinzhi-3d.mp4' },
  square: { w: 1080, h: 1080, file: 'yuvinzhi-3d-square.mp4' },
  vertical: { w: 1080, h: 1920, file: 'yuvinzhi-3d-vertical.mp4' },
};
mkdirSync(OUT, { recursive: true });
const PORT = 4189;
const server = await serveDist(resolve(arg('dist', join(ROOT, 'dist'))), PORT);
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }).catch(() => chromium.launch());

try {
  for (const f of FORMATS) {
    const size = SIZES[f];
    if (!size) throw new Error(`unknown format ${f}`);
    const frames = join(OUT, `frames-${f}`);
    rmSync(frames, { recursive: true, force: true });
    mkdirSync(frames, { recursive: true });
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, reducedMotion: 'no-preference', colorScheme: 'dark' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('pageerror', String(e)));
    await page.goto(`http://127.0.0.1:${PORT}/civilization/#/3d?cinema=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!(window as unknown as { __cinemaReady?: Promise<void> }).__cinemaReady, null, { timeout: 60000 });
    await page.evaluate(() => (window as unknown as { __cinemaReady: Promise<void> }).__cinemaReady);
    const seconds = await page.evaluate(() => (window as unknown as { __cinemaSeconds: number }).__cinemaSeconds);
    const total = Math.round(seconds * FPS);
    const t0 = Date.now();
    let n = 0;
    for (let i = 0; i < total; i += EVERY) {
      await page.evaluate((t) => (window as unknown as { __cinema: (t: number) => void }).__cinema(t), i / (total - 1));
      await page.screenshot({ path: join(frames, `f${String(n).padStart(5, '0')}.png`) });
      n++;
      if (n % 100 === 0) console.log(`${f}: ${n}/${Math.ceil(total / EVERY)} frames (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    await ctx.close();
    const mp4 = join(OUT, EVERY > 1 ? size.file.replace('.mp4', `-preview${EVERY}.mp4`) : size.file);
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS / EVERY), '-i', join(frames, 'f%05d.png'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(FPS), mp4]);
    console.log(`${f}: ${mp4} · ${(statSync(mp4).size / 1048576).toFixed(1)} MB · ${seconds} s · ${size.w}×${size.h}`);
    if (SHEET) {
      const sheet = join(OUT, `sheet-${f}.jpg`);
      const step = Math.max(1, Math.round(60 / EVERY));
      const cols = 6;
      const count = Math.ceil(n / step);
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', join(frames, 'f%05d.png'), '-vf', `select='not(mod(n\\,${step}))',scale=${f === 'vertical' ? 240 : 320}:-1,tile=${cols}x${Math.ceil(count / cols)}:padding=4:color=black`, '-frames:v', '1', '-q:v', '3', sheet]);
      console.log(`${f}: contact sheet ${sheet}`);
    }
    if (!KEEP) rmSync(frames, { recursive: true, force: true });
  }
} finally {
  await browser.close();
  server.close();
}
