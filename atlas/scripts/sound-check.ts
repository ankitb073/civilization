// Headless check of the soundscape in Chromium (Playwright): renders every beat through an OfflineAudioContext to
// WAV, measures levels (peak, loudness, clipping, DC, clicks), renders a tour of the whole game and the one-shots,
// then runs the live engine for real (AudioContext, a real click as the gesture) and samples Chromium's CPU.
// The audio modules are served to a blank page with their types stripped (node:module), so no dev server is needed.
//
// Usage: node --disable-warning=ExperimentalWarning atlas/scripts/sound-check.ts [--out=dir] [--seconds=10]
//          [--seed=7] [--reps=3] [--layers] (per-layer solo loudness) [--no-offline] [--no-live] [--no-spectra]
// Exits non-zero if any beat clips, peaks above -1 dBFS, is silent, or sits outside -34..-14 LUFS.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import type { Page } from 'playwright';
import { encodeWav, fromBase64, measure } from '../src/audio/soundscape-demo.ts';
import type { Levels } from '../src/audio/soundscape-demo.ts';
import { BEATS, LAYERS } from '../src/audio/beats.ts';
import type { Beat, LayerName } from '../src/audio/beats.ts';

const ATLAS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO = join(ATLAS, 'src', 'audio');
const arg = (k: string, d: string): string => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const flag = (k: string): boolean => process.argv.includes(`--${k}`);
const OUT = resolve(arg('out', join(ATLAS, '..', 'build', 'sound')));
const SECONDS = Number(arg('seconds', '10'));
const SEED = Number(arg('seed', '7'));
const REPS = Number(arg('reps', '3'));
mkdirSync(OUT, { recursive: true });

const ORIGIN = 'http://sound.test';
const DEMO = '/src/audio/soundscape-demo.ts';

async function servePage(page: Page): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>sound check</title><body></body>' });
      return;
    }
    const file = resolve(ATLAS, '.' + url.pathname);
    if (!file.startsWith(AUDIO) || !file.endsWith('.ts') || !existsSync(file)) { await route.fulfill({ status: 404, body: 'not found' }); return; }
    await route.fulfill({ contentType: 'text/javascript', body: stripTypeScriptTypes(readFileSync(file, 'utf8')) });
  });
  await page.goto(`${ORIGIN}/`);
}

type Demo = typeof import('../src/audio/soundscape-demo.ts');
interface Shipped { b64: string; sampleRate: number; buildMs: number; renderMs: number; stats: { bytes: number; ms: number; worstMs: number; done: boolean } }

type Sfx = 'stylus' | 'seal' | 'pageTurn' | 'door';
async function render(page: Page, job: { beat?: Beat; solo?: LayerName[]; tour?: boolean; sfx?: boolean; one?: Sfx; seconds: number; seed: number; rain?: 'auto' | 'on' | 'off'; intensity?: number }): Promise<Shipped> {
  return page.evaluate(async ({ job, demo }) => {
    const m = (await import(demo)) as Demo;
    const steps = job.tour ? m.tourSteps(12) : job.one ? m.oneSfxSteps(job.one, 6, 1) : job.sfx ? m.sfxSteps() : [{ at: 0, beat: job.beat, intensity: job.intensity }];
    const r = await m.renderOffline({ seconds: job.seconds, steps, seed: job.seed, solo: job.solo, rain: job.rain });
    return { b64: m.toBase64(r.channels), sampleRate: r.sampleRate, buildMs: r.buildMs, renderMs: r.renderMs, stats: r.stats };
  }, { job, demo: DEMO });
}

const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : '-inf');
const pad = (s: string, n: number): string => s.padEnd(n);

function save(name: string, r: Shipped): Levels {
  const ch = fromBase64(r.b64, 2);
  writeFileSync(join(OUT, `${name}.wav`), encodeWav(ch, r.sampleRate));
  return measure(ch, r.sampleRate);
}

function spectrum(name: string): void {
  if (flag('no-spectra')) return;
  try {
    mkdirSync(join(OUT, 'spectra'), { recursive: true });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(OUT, `${name}.wav`), '-lavfi', 'showspectrumpic=s=1000x300:legend=1:scale=log:fscale=log', join(OUT, 'spectra', `${name}.png`)]);
  } catch { /* ffmpeg optional */ }
}

// ---- process CPU (the whole Chromium tree), from cumulative CPU time in ps ----
function cpuSeconds(rootPid: number): number {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,time='], { encoding: 'utf8' }).trim().split('\n')
    .map((l) => l.trim().split(/\s+/)).map(([pid, ppid, time]) => ({ pid: Number(pid), ppid: Number(ppid), time }));
  const kids = new Map<number, number[]>();
  for (const r of rows) kids.set(r.ppid, [...(kids.get(r.ppid) ?? []), r.pid]);
  const tree = new Set<number>([rootPid]);
  const stack = [rootPid];
  while (stack.length) for (const k of kids.get(stack.pop()!) ?? []) if (!tree.has(k)) { tree.add(k); stack.push(k); }
  const parse = (t: string): number => {
    const [d, rest] = t.includes('-') ? t.split('-') : ['0', t];
    return Number(d) * 86400 + rest.split(':').reduce((s, p) => s * 60 + Number(p), 0);
  };
  return rows.filter((r) => tree.has(r.pid)).reduce((s, r) => s + parse(r.time), 0);
}
async function cpuOver(pid: number, ms: number): Promise<number> {
  const c0 = cpuSeconds(pid), t0 = performance.now();
  await new Promise((r) => setTimeout(r, ms));
  return (100 * (cpuSeconds(pid) - c0)) / ((performance.now() - t0) / 1000);
}

const server = await chromium.launchServer({ headless: true, args: ['--autoplay-policy=user-gesture-required'] });
const pid = server.process().pid!;
const browser = await chromium.connect(server.wsEndpoint());
const failures: string[] = [];
const report: Record<string, unknown> = { seed: SEED, seconds: SECONDS, out: OUT };

try {
  const page = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await servePage(page);

  // ---- every beat, offline ----
  if (!flag('no-offline')) {
  console.log(`\nBeats: ${SECONDS} s each, seed ${SEED}, 48 kHz stereo, volume 1 (worst case), WAVs in ${OUT}`);
  console.log(`${pad('beat', 13)}${pad('LUFS', 8)}${pad('maxM', 8)}${pad('peak', 8)}${pad('RMS', 8)}${pad('clip', 6)}${pad('DC', 10)}${pad('step', 7)}${pad('render', 10)}build`);
  const beats: Record<string, Levels & { renderMs: number; buildMs: number; cpuPct: number }> = {};
  let stats: Shipped['stats'] | null = null;
  for (const beat of BEATS) {
    const r = await render(page, { beat, seconds: SECONDS, seed: SEED });
    const lv = save(beat, r);
    spectrum(beat);
    stats = r.stats;
    const cpuPct = (100 * r.renderMs) / (SECONDS * 1000);
    beats[beat] = { ...lv, renderMs: r.renderMs, buildMs: r.buildMs, cpuPct };
    console.log(`${pad(beat, 13)}${pad(f1(lv.lufs), 8)}${pad(f1(lv.maxMomentary), 8)}${pad(f1(lv.peakDb), 8)}${pad(f1(lv.rmsDb), 8)}${pad(String(lv.clipped), 6)}${pad(lv.dc.toExponential(1), 10)}${pad(lv.maxStep.toFixed(3), 7)}${pad(`${r.renderMs.toFixed(0)} ms`, 10)}${r.buildMs.toFixed(0)} ms`);
    if (lv.clipped > 0 || lv.nan > 0) failures.push(`${beat}: ${lv.clipped} clipped / ${lv.nan} NaN samples`);
    if (lv.peakDb > -1) failures.push(`${beat}: peak ${f1(lv.peakDb)} dBFS > -1`);
    if (!(lv.lufs > -34 && lv.lufs < -14)) failures.push(`${beat}: loudness ${f1(lv.lufs)} LUFS outside -34..-14`);
    if (Math.abs(lv.dc) > 2e-3) failures.push(`${beat}: DC offset ${lv.dc}`);
  }
  report.beats = beats;
  report.bank = stats;
  console.log(`bank: ${(stats!.bytes / 1048576).toFixed(1)} MB of buffers, ${stats!.ms.toFixed(0)} ms synthesis, slowest chunk ${stats!.worstMs.toFixed(0)} ms`);

  // ---- determinism: the same seed renders identical audio; another seed does not ----
  {
    const a = await render(page, { beat: 'walls', seconds: 4, seed: SEED });
    const b = await render(page, { beat: 'walls', seconds: 4, seed: SEED });
    const c = await render(page, { beat: 'walls', seconds: 4, seed: SEED + 1 });
    // Chrome may sum a mixing junction in a different order run to run (nodes made on the fly), which moves the
    // last bit of a float32 (≤ 1.2e-7, -138 dBFS); anything above 1e-6 would be a real difference
    const maxDiff = (x: Shipped, y: Shipped): number => {
      const p = fromBase64(x.b64, 2), q = fromBase64(y.b64, 2);
      let m = 0;
      for (let ch = 0; ch < 2; ch++) for (let i = 0; i < p[ch].length; i++) m = Math.max(m, Math.abs(p[ch][i] - q[ch][i]));
      return m;
    };
    const dSame = maxDiff(a, b), dOther = maxDiff(a, c);
    const same = dSame < 1e-6, differs = dOther > 1e-2;
    report.determinism = { sameSeedMaxDiff: dSame, otherSeedMaxDiff: dOther };
    console.log(`determinism: seed ${SEED} twice ${same ? 'identical' : 'DIFFERENT'} (max |diff| ${dSame.toExponential(1)}); seed ${SEED + 1} ${differs ? 'differs' : 'TOO CLOSE'} (max |diff| ${dOther.toFixed(2)})`);
    if (!same || !differs) failures.push('determinism');
  }

  // ---- rain variation (forced on) for the night beat ----
  {
    const r = await render(page, { beat: 'walls', seconds: SECONDS, seed: SEED, rain: 'on' });
    const lv = save('walls-rain', r);
    spectrum('walls-rain');
    report.wallsRain = lv;
    console.log(`walls + rain: ${f1(lv.lufs)} LUFS, peak ${f1(lv.peakDb)} dBFS`);
    if (lv.clipped > 0 || lv.peakDb > -1) failures.push('walls-rain: clipping');
  }

  // ---- a tour through every beat, with page turns, the door, stylus and seal ----
  {
    const r = await render(page, { tour: true, seconds: BEATS.length * 12, seed: SEED });
    const lv = save('tour', r);
    spectrum('tour');
    report.tour = { ...lv, renderMs: r.renderMs };
    console.log(`tour (${BEATS.length * 12} s, all beats + cross-fades + one-shots): ${f1(lv.lufs)} LUFS, peak ${f1(lv.peakDb)} dBFS, clipped ${lv.clipped}, render ${r.renderMs.toFixed(0)} ms (${((100 * r.renderMs) / (BEATS.length * 12000)).toFixed(2)}% of real time)`);
    if (lv.clipped > 0 || lv.peakDb > -1) failures.push('tour: clipping');
  }

  // ---- the one-shots alone ----
  {
    const r = await render(page, { sfx: true, seconds: 12, seed: SEED });
    const lv = save('sfx', r);
    spectrum('sfx');
    report.sfx = lv;
    console.log(`one-shots (stylus x12, seal, page x2, door): max momentary ${f1(lv.maxMomentary)} LUFS, peak ${f1(lv.peakDb)} dBFS`);
    if (lv.clipped > 0 || lv.peakDb > -1) failures.push('sfx: clipping');
    const each: Record<string, { maxMomentary: number; peakDb: number }> = {};
    for (const one of ['stylus', 'seal', 'pageTurn', 'door'] as Sfx[]) {
      const ro = await render(page, { one, seconds: 7.5, seed: SEED });
      const lo = measure(fromBase64(ro.b64, 2), ro.sampleRate);
      each[one] = { maxMomentary: lo.maxMomentary, peakDb: lo.peakDb };
    }
    report.sfxEach = each;
    console.log(`  each (x6, 1 s apart): ${Object.entries(each).map(([k, v]) => `${k} ${f1(v.maxMomentary)} LUFS max M / ${f1(v.peakDb)} dBFS`).join(' · ')}`);
  }

  // ---- per-layer solo loudness (calibration) ----
  if (flag('layers')) {
    const home: Record<LayerName, Beat> = {
      wind: 'walls', crowd: 'muster', fire: 'fall-sack', rain: 'walls', drone: 'walls', room: 'tablet', tramp: 'muster',
      birds: 'held', drums: 'field', horns: 'field', dogs: 'walls', steps: 'walls', lyre: 'ending',
    };
    const layers: Record<string, { beat: Beat; lufs: number; maxM: number; peak: number }> = {};
    console.log('\nLayers solo (in their home beat, default intensity):');
    for (const name of LAYERS) {
      const seconds = name === 'lyre' || name === 'horns' || name === 'steps' || name === 'dogs' ? 20 : SECONDS;
      const r = await render(page, { beat: home[name], solo: [name], seconds, seed: SEED, rain: name === 'rain' ? 'on' : 'auto' });
      const ch = fromBase64(r.b64, 2);
      const lv = measure(ch, r.sampleRate);
      layers[name] = { beat: home[name], lufs: lv.lufs, maxM: lv.maxMomentary, peak: lv.peakDb };
      console.log(`  ${pad(name, 8)}${pad(home[name], 13)}${pad(`${f1(lv.lufs)} LUFS`, 13)}max M ${pad(f1(lv.maxMomentary), 8)}peak ${f1(lv.peakDb)}`);
    }
    report.layers = layers;
  }

  }
  if (errors.length) failures.push(`page errors: ${errors.join(' | ')}`);

  // ---- live engine: real AudioContext, real click, CPU of the Chromium process tree ----
  if (!flag('no-live')) {
    const ctx = await browser.newContext();
    const lp = await ctx.newPage();
    const lerr: string[] = [];
    lp.on('pageerror', (e) => lerr.push(String(e)));
    lp.on('console', (m) => { if (m.type() === 'error') lerr.push(m.text()); });
    await servePage(lp);
    await lp.evaluate(async (demo) => {
      const m = (await import(demo)) as Demo;
      (window as unknown as { __demo: ReturnType<Demo['mountSoundscapeDemo']> }).__demo = m.mountSoundscapeDemo(document.body, { seed: 7, muted: false });
    }, DEMO);
    type W = { __demo: ReturnType<Demo['mountSoundscapeDemo']> };
    const probe = () => lp.evaluate(() => {
      const s = (window as unknown as W).__demo.soundscape;
      const c = s.context as AudioContext | null;
      return { state: s.state, ctx: c?.state ?? null, t: c?.currentTime ?? 0, level: Number(document.querySelector<HTMLElement>('.sound-demo')?.dataset.level ?? -999), done: s.stats.done, rate: c?.sampleRate ?? 0, base: c?.baseLatency ?? 0 };
    });
    const stat = (xs: number[]): { min: number; median: number; runs: number[] } => {
      const ys = [...xs].sort((x, y) => x - y);
      return { min: ys[0], median: ys.length % 2 ? ys[(ys.length - 1) / 2] : (ys[ys.length / 2 - 1] + ys[ys.length / 2]) / 2, runs: xs };
    };
    const fmt = (x: { min: number; median: number }): string => `min ${x.min.toFixed(1)}% · median ${x.median.toFixed(1)}%`;
    const live: Record<string, unknown> = {};

    // CPU: a bare page (no panel, no meter), the engine started by a real click; first a bare AudioContext,
    // the fixed cost any WebAudio page pays
    {
      const cp = await ctx.newPage();
      await servePage(cp);
      const idle = await cpuOver(pid, 6000);
      await cp.evaluate(async () => { const c = new AudioContext({ latencyHint: 'balanced' }); await c.resume(); (window as unknown as { c: AudioContext }).c = c; });
      const bareRuns: number[] = [];
      for (let k = 0; k < REPS; k++) bareRuns.push((await cpuOver(pid, 6000)) - idle);
      await cp.evaluate(async (demo) => {
        await (window as unknown as { c: AudioContext }).c.close();
        const m = (await import(demo.replace('soundscape-demo', 'soundscape'))) as typeof import('../src/audio/soundscape.ts');
        const s = m.createSoundscape({ seed: 7, muted: false });
        (window as unknown as { s: typeof s }).s = s;
        const b = document.createElement('button');
        b.textContent = 'Sound on';
        b.onclick = () => { void s.start(); };
        document.body.appendChild(b);
      }, DEMO);
      await cp.click('button');
      await cp.waitForFunction(() => (window as unknown as { s: { stats: { done: boolean } } }).s.stats.done, null, { timeout: 30000 });
      live.idleCpuPct = idle;
      live.bareContext = stat(bareRuns);
      console.log(`\nLive CPU (headless Chromium, real AudioContext, ${REPS} x 8 s per beat after its cross-fade; % of one core, whole browser tree, idle page subtracted)`);
      console.log(`  bare AudioContext  ${fmt(stat(bareRuns))}`);
      for (const beat of ['walls', 'fall-sack', 'muster', 'tablet', 'ending'] as Beat[]) {
        await cp.evaluate((b) => (window as unknown as { s: { setBeat(b: string): void } }).s.setBeat(b), beat);
        await cp.waitForTimeout(7000);
        const runs: number[] = [];
        for (let k = 0; k < REPS; k++) runs.push((await cpuOver(pid, 8000)) - idle);
        const st = stat(runs);
        live[beat] = st;
        console.log(`  ${pad(beat, 18)}${fmt(st)}`);
      }
      await cp.close();
    }

    // Function: the audition panel, driven by real clicks (meter, beats, one-shots, mute → suspend)
    await lp.click('[data-sound=toggle]');
    await lp.waitForFunction(() => (window as unknown as W).__demo.soundscape.stats.done, null, { timeout: 30000 });
    for (const beat of ['walls', 'fall-sack', 'muster', 'tablet'] as Beat[]) {
      await lp.click(`[data-beat="${beat}"]`);
      await lp.waitForTimeout(4500);
      const a = await probe();
      const wall0 = performance.now();
      await lp.waitForTimeout(3000);
      const b = await probe();
      const clockRatio = (b.t - a.t) / ((performance.now() - wall0) / 1000);
      live[`${beat}Panel`] = { levelDb: b.level, ctx: b.ctx, clockRatio };
      console.log(`  panel ${pad(beat, 12)}meter ${f1(b.level)} dBFS RMS · context ${b.ctx} · audio clock ${clockRatio.toFixed(2)}x real time`);
      if (b.ctx !== 'running') failures.push(`live ${beat}: context ${b.ctx}`);
      if (!(b.level > -70)) failures.push(`live ${beat}: silent (${b.level} dB)`);
    }
    for (let k = 0; k < 6; k++) { await lp.click('[data-sfx=stylus]'); await lp.waitForTimeout(120); }
    await lp.click('[data-sound=toggle]'); // mute → suspends
    await lp.waitForTimeout(1500);
    const m = await probe();
    const idle0 = Number(live.idleCpuPct);
    const mutedCpu = await cpuOver(pid, 6000);
    live.muted = { ctx: m.ctx, cpuPct: mutedCpu - idle0 };
    live.sampleRate = m.rate; live.baseLatency = m.base;
    console.log(`  muted             ${(mutedCpu - idle0).toFixed(1)}% · context ${m.ctx}`);
    if (m.ctx !== 'suspended') failures.push(`muted: context should be suspended, is ${m.ctx}`);
    if (lerr.length) failures.push(`live page errors: ${lerr.join(' | ')}`);
    report.live = live;
    await ctx.close();

    // ---- phones start muted; desktops don't ----
    const checkMuted = async (opts: Parameters<typeof browser.newContext>[0]): Promise<boolean> => {
      const c = await browser.newContext(opts);
      const p = await c.newPage();
      await servePage(p);
      const v = await p.evaluate(async () => {
        const m = (await import('/src/audio/soundscape.ts' as string)) as typeof import('../src/audio/soundscape.ts');
        return m.createSoundscape().muted;
      });
      await c.close();
      return v;
    };
    const phone = await checkMuted({ ...devices['iPhone 13'], defaultBrowserType: undefined } as Parameters<typeof browser.newContext>[0]);
    const android = await checkMuted({ ...devices['Pixel 7'] });
    const desktop = await checkMuted({});
    report.mutedStart = { iPhone: phone, pixel: android, desktop };
    console.log(`muted at start: iPhone ${phone}, Pixel ${android}, desktop ${desktop}`);
    if (!phone || !android || desktop) failures.push('muted-start defaults wrong');
  }
} finally {
  await browser.close();
  await server.close();
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify({ ...report, failures }, null, 2));
if (failures.length) {
  console.error(`\nFAIL\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nOK — report in ${join(OUT, 'report.json')}`);
