// Runner of the Tablet House, the first errand (day one, the muster; decision 0032): plays it through in a browser
// from a built dist, on a desktop (1440×900) and a phone (390×844, DPR 2, 4× CPU slowdown), and checks it.
//
// Per device: the start (the controls hint, then the overseer), the choice, the pressed tablet, the run HUD on a real
// run of the street route by the game's own pilot (frame times sampled the whole way, CPU throttled on the phone),
// the arrival and the end card; then "Run it again" for the other two readings at a run (in time) and for a jog
// through the streets, which misses the horn (fast-forwarded in the game's fixed steps), each with its arrival and end
// card; the saved record in localStorage; "Back to the city". axe runs on every panel. --reduced plays the phone with reduced motion; the desktop plays with sound
// on, the phone with it off.
//
// --measure (or the default desktop pass): the route the horn is set from, by headless bot runs in fixed 60 Hz steps
// (frame-rate free): the street route at a run and at a jog, and the crow's line over the roofs with the phone's
// auto-parkour, from the door of the house of tablets into the gate's radius; compared with the script's numbers.
//
// Usage: node atlas/scripts/streets-errand.ts [--out=dir] [--dist=atlas/dist] [--only=desktop|phone] [--reduced] [--no-measure]
//        npm --prefix atlas run streets-errand -- [same]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type CDPSession, type Page } from 'playwright';
import { serveDist } from './serve.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const has = (k: string) => process.argv.includes(`--${k}`);
const pct = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const OUT = resolve(arg('out', join(ROOT, '..', 'build', 'streets-errand')));
const ONLY = arg('only', '');
const REDUCED = has('reduced');
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const SCRIPT = JSON.parse(readFileSync(join(ROOT, '..', 'streets-scripts', 'sc-919.json'), 'utf8'));
mkdirSync(OUT, { recursive: true });

const PORT = 4199;
const server = await serveDist(resolve(arg('dist', join(ROOT, 'dist'))), PORT);
const base = `http://127.0.0.1:${PORT}/civilization/`;
const href = `${base}#/streets`;
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] }).catch(() => chromium.launch());
const sizes = [
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false, throttle: 1, sound: true },
  { name: 'phone', width: 390, height: 844, dpr: 2, mobile: true, throttle: 4, sound: false },
].filter((s) => !ONLY || s.name === ONLY);
const summary: Record<string, unknown> = { href, reduced: REDUCED };
const problems: string[] = [];

type Snap = { phase: string; st: { pick: string | null; inTime: boolean | null; street: number; roof: number }; card: { time: number; route: { street: number; roof: number; metres: number }; pressed: { value: number }; record: { value: number }; headline: string } | null };

try {
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr, isMobile: s.mobile, hasTouch: s.mobile, reducedMotion: REDUCED && s.mobile ? 'reduce' : 'no-preference' });
    // a first visit: no saved errand, the controls hint not yet seen
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('pal-errand-probe')) { localStorage.removeItem('pal-streets-errands-v1'); localStorage.removeItem('pal-streets-hint-v1'); sessionStorage.setItem('pal-errand-probe', '1'); } } catch { /* blocked */ } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
    const cdp: CDPSession = await ctx.newCDPSession(page);
    const tag = `${s.name}${REDUCED && s.mobile ? '-reduced' : ''}`;
    const files: Record<string, string> = {};
    const shot = async (name: string) => { const f = join(OUT, `${tag}-${name}.png`); await page.screenshot({ path: f }); files[name] = f; };
    const axes: Record<string, unknown[]> = {};
    const axe = async (name: string) => {
      if (!(await page.evaluate(() => !!(window as any).axe))) await page.addScriptTag({ content: AXE });
      const v = await page.evaluate(async () => {
        const r = await (window as any).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
        return r.violations.map((v: any) => ({ id: v.id, impact: v.impact, n: v.nodes.length, where: v.nodes.slice(0, 3).map((n: any) => n.target.join(' ')) }));
      });
      axes[name] = v;
      if (v.length) problems.push(`${tag} axe ${name}: ${v.map((x: any) => `${x.id} (${x.n})`).join(', ')}`);
    };
    const snap = () => page.evaluate(() => { const e = (window as any).__palimpsestErrand; return e ? JSON.parse(JSON.stringify(e.state)) : null; }) as Promise<Snap | null>;
    const phase = async (want: string, timeout = 60000) => {
      await page.waitForFunction((w) => (window as any).__palimpsestErrand?.state.phase === w, want, { timeout, polling: 100 });
    };
    const click = async (name: string | RegExp) => {
      const b = page.getByRole('button', { name }).first();
      await b.waitFor({ state: 'visible', timeout: 30000 });
      for (let i = 0; i < 300 && !(await b.isEnabled()); i++) await page.waitForTimeout(100);
      await b.click();
    };

    const t0 = Date.now();
    if (s.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: s.throttle });
    await page.goto(href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__palimpsestStreets?.ready && (window as any).__palimpsestErrand, null, { timeout: 180000 })
      .catch((e) => { console.log('not ready:', errors); throw e; });
    const loadMs = Date.now() - t0;
    if (s.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);
    await shot('start-hint');
    await click('Got it');
    await phase('brief');
    await page.waitForTimeout(700);
    await shot('start');
    await axe('brief');
    if (s.sound) {
      // the sound on, from a tap (as a player would)
      await page.getByRole('button', { name: /Sound (on|off)/ }).click().catch(() => {});
      await page.waitForTimeout(300);
    }
    await click('Take the clay');
    await phase('choose');
    await page.waitForTimeout(700);
    await shot('choice');
    await axe('choice');

    // ---- run 1: the record's figure, the whole street route at a run by the game's pilot, frame times sampled
    const readings: Record<string, unknown> = {};
    const playPick = async (pick: 'true' | 'rounded' | 'boasted', label: RegExp) => {
      await click(label);
      await phase('pressed');
      const go = page.getByRole('button', { name: /^Run to/ }).first();
      await go.waitFor({ state: 'visible', timeout: 30000 });
      for (let i = 0; i < 300 && !(await go.isEnabled()); i++) await page.waitForTimeout(100);
      await page.waitForTimeout(300);
      return pick;
    };
    const labels: Record<string, RegExp> = { true: /A man for every token gone/, rounded: /Count the carriers/, boasted: /A host worthy/ };
    await playPick('true', labels.true);
    await shot('pressed');
    await axe('pressed');
    await click(/^Run to/);
    await phase('run');
    const route = await page.evaluate(() => {
      const g = (window as any).__palimpsestStreets, e = (window as any).__palimpsestErrand;
      const r = g.city.layer.route(e.from.pos, e.to.pos, 3);
      return { pts: r.pts, metres: Math.round(r.metres) };
    });
    if (s.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: s.throttle });
    await page.evaluate((pts) => { const g = (window as any).__palimpsestStreets; g.stats.frame.length = 0; g.stats.cpu.length = 0; g.stats.phys.length = 0; g.drive(pts.map((p: any) => ({ ...p, run: true })), false); }, route.pts);
    const tRun = Date.now();
    await page.waitForTimeout(6000);
    await shot('run');
    await axe('run');
    await phase('arrive', 120000);
    const wall = (Date.now() - tRun) / 1000;
    const frames = await page.evaluate(() => { const g = (window as any).__palimpsestStreets; return { frame: g.stats.frame.slice(), cpu: g.stats.cpu.slice(), info: g.info() }; });
    if (s.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.waitForTimeout(900);
    await shot('arrival');
    await axe('arrival');
    // what the levy costs to draw, from where the runner stands at the gate (one frame with it, one without)
    const levyCost = await page.evaluate(() => {
      const g = (window as any).__palimpsestStreets, e = (window as any).__palimpsestErrand;
      g.film(true);
      g.advance(1 / 60, null);
      const a = g.info();
      e.levy.group.visible = false;
      g.advance(1 / 60, null);
      const b = g.info();
      e.levy.group.visible = true;
      g.film(false);
      return { men: e.levy.men, buildMs: e.levyMs, drawCalls: a.calls - b.calls, triangles: a.triangles - b.triangles, callsAtGate: a.calls, trianglesAtGate: a.triangles };
    });
    await click('Go on');
    await phase('end');
    await page.waitForTimeout(700);
    await shot('end-true');
    await axe('end');
    readings.true = await snap().then((x) => x?.card);
    const fps = {
      n: frames.frame.length, seconds: r2(wall),
      frameMs: { median: r2(pct(frames.frame, 50)), p95: r2(pct(frames.frame, 95)), max: r2(Math.max(...frames.frame)) },
      cpuMs: { median: r2(pct(frames.cpu, 50)), p95: r2(pct(frames.cpu, 95)) },
      fpsMedian: r2(1000 / pct(frames.frame, 50)), over20ms: frames.frame.filter((f: number) => f > 20).length,
      calls: frames.info.calls, triangles: frames.info.triangles,
    };
    if (fps.frameMs.median > 17.5) problems.push(`${tag}: median frame ${fps.frameMs.median} ms on the run`);

    // ---- runs 2 and 3: the other readings, in time; run 4: a jog through the streets, which misses the horn. Each is
    // the whole route by the pilot, fast-forwarded in the game's fixed steps (film mode: no waiting, the same clock)
    const fastRun = (pace: number, stopAtHorn = false) => page.evaluate(({ pts, pace, stopAtHorn }) => {
      const g = (window as any).__palimpsestStreets, e = (window as any).__palimpsestErrand;
      g.film(true);
      if (!g.pilot && e.state.phase === 'run' && !e.state.st.horn) g.drive(pts.map((p: any) => ({ ...p, ...(pace >= 1 ? { run: true } : { pace }) })), false);
      for (let i = 0; i < 3000 && e.state.phase === 'run'; i++) {
        g.advance(0.1, null);
        if (stopAtHorn && e.state.st.horn) break;
      }
      g.film(false);
      return e.state.phase;
    }, { pts: route.pts, pace, stopAtHorn });
    for (const pick of ['rounded', 'boasted'] as const) {
      await click('Run it again');
      await phase('choose');
      await page.waitForTimeout(400);
      if (pick === 'rounded') await shot('again');
      await playPick(pick, labels[pick]);
      await click(/^Run to/);
      await phase('run');
      await fastRun(1);
      await phase('arrive', 60000);
      await page.waitForTimeout(900);
      if (pick === 'boasted') await shot('arrival-boasted');
      await click('Go on');
      await phase('end');
      await page.waitForTimeout(700);
      await shot(`end-${pick}`);
      readings[pick] = await snap().then((x) => x?.card);
    }
    await click('Run it again');
    await phase('choose');
    await playPick('boasted', labels.boasted);
    await click(/^Run to/);
    await phase('run');
    await fastRun(0.75, true);
    await page.waitForTimeout(1500);
    await shot('horn');
    await axe('horn');
    await fastRun(0.75);
    await phase('arrive', 60000);
    await page.waitForTimeout(900);
    await shot('arrival-late');
    await axe('arrival-late');
    await click('Go on');
    await phase('end');
    await page.waitForTimeout(700);
    await shot('end-late');
    await axe('end-late');
    readings.late = await snap().then((x) => x?.card);
    const levyGone = await page.evaluate(() => !(window as any).__palimpsestErrand.levy.group.visible || (window as any).__palimpsestErrand.levy.marching());
    const saved = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('pal-streets-errands-v1') ?? 'null'); } catch { return null; } });
    await click('Back to the city');
    await page.waitForTimeout(800);
    const free = await page.evaluate(() => ({ phase: (window as any).__palimpsestErrand.state.phase, frozen: (window as any).__palimpsestStreets.frozen, input: (window as any).__palimpsestStreets.input.enabled }));
    await shot('free');

    // the record's figures against the cards: every number on them from the record, bent as the Tablet House bends it
    const cards = readings as Record<string, Snap['card']>;
    const rec = cards.true?.record.value;
    if (cards.true?.pressed.value !== rec) problems.push(`${tag}: the true reading pressed ${cards.true?.pressed.value}, the record says ${rec}`);
    if (!(cards.rounded!.pressed.value > rec!) || !(cards.boasted!.pressed.value > cards.rounded!.pressed.value)) problems.push(`${tag}: the bent readings do not lean the king's way`);
    if (cards.late?.time === undefined || !/horn sounded before/i.test(cards.late!.headline)) problems.push(`${tag}: the late card does not say the horn was missed`);
    if (!levyGone) problems.push(`${tag}: the levy is still standing after the horn`);
    if (free.phase !== 'free' || free.frozen || !free.input) problems.push(`${tag}: "Back to the city" left the runner held`);
    if (!saved?.['sc-919']?.muster || saved['sc-919'].muster.lastPick !== 'boasted' || saved['sc-919'].muster.runs !== 4) problems.push(`${tag}: saved record ${JSON.stringify(saved)}`);
    if (errors.length) problems.push(`${tag}: page errors: ${errors.slice(0, 4).join(' | ')}`);

    const res = {
      size: `${s.width}×${s.height} @${s.dpr}x${s.throttle > 1 ? `, ${s.throttle}× CPU` : ''}${REDUCED && s.mobile ? ', reduced motion' : ''}, sound ${s.sound ? 'on' : 'off'}`,
      loadMs, route: { metres: route.metres }, run: fps, levy: levyCost,
      cards: Object.fromEntries(Object.entries(cards).map(([k, c]) => [k, c && { time: r2(c.time), route: c.route, pressed: c.pressed.value, record: c.record.value, headline: c.headline }])),
      saved: saved?.['sc-919']?.muster ?? null, levyGoneAfterHorn: levyGone, free, axe: axes, errors: errors.slice(0, 8), files,
    };
    summary[tag] = res;
    console.log(`\n== ${tag} ${res.size}: load ${loadMs} ms`);
    console.log(JSON.stringify(res, null, 1));

    // ---- the horn's numbers: bot runs in fixed steps (no drawing), on the desktop pass
    if (s.name === 'desktop' && !has('no-measure')) {
      const m = await measure(page);
      summary.measured = m;
      console.log('\n== measured (fixed 60 Hz steps, from the door into the gate\'s radius)');
      console.log(JSON.stringify(m, null, 1));
      const H = SCRIPT.errands[0].horn;
      const was = H.measured ?? {};
      for (const k of ['streetMetres', 'streetRunS', 'streetJogS', 'roofRunS'] as const) {
        const now = (m as Record<string, number>)[k], then = Number(was[k]);
        if (Number.isFinite(then) && Math.abs(now - then) / then > 0.12) problems.push(`measured ${k} ${now} vs the script's ${then}: re-set the horn (streets-scripts/sc-919.json)`);
      }
      if (!(m.streetRunS < H.seconds)) problems.push(`the streets at a run (${m.streetRunS} s) do not beat the horn (${H.seconds} s)`);
      if (!(m.streetJogS > H.seconds)) problems.push(`a jog through the streets (${m.streetJogS} s) beats the horn (${H.seconds} s): not tight`);
    }
    await ctx.close();
  }
  summary.problems = problems;
  writeFileSync(join(OUT, `errand${REDUCED ? '-reduced' : ''}.json`), JSON.stringify(summary, null, 2));
  console.log(`\n${problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}` : 'no problems'}`);
  console.log(`→ ${join(OUT, `errand${REDUCED ? '-reduced' : ''}.json`)}`);
  if (problems.length) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

/** Bot runs of the errand's route, headless in fixed steps: the street route (A* on the layer's 1 m grid) at a run and
 *  at a jog, and the crow's line at a run with the phone's auto-parkour (it climbs what it meets and jumps the gaps it
 *  can, dropping to the street where it cannot), from the door of the house into the gate's radius. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__palimpsestStreets, e = (window as any).__palimpsestErrand;
    const c = g.city, from = e.from, to = e.to;
    const wasTouch = g.opts.touch;
    g.film(true);
    const out: Record<string, number> = {};
    const go = (pts: any[], touch: boolean, max = 200) => {
      g.opts.touch = touch;
      g.stopDriving();
      g.teleport(from.pos.x, from.pos.z);
      g.drive(pts, false);
      let t = 0, roof = 0, street = 0, last = g.phys.feet();
      while (t < max) {
        g.advance(0.1, null);
        t += 0.1;
        const f = g.phys.feet();
        const d = Math.hypot(f.x - last.x, f.z - last.z);
        if (f.y - c.heightAt(f.x, f.z) > 2 && c.affordances.waterDepthAt(f.x, f.z) <= 0) roof += d; else street += d;
        last = f;
        if (Math.hypot(f.x - to.pos.x, f.z - to.pos.z) < to.radius && f.y - c.heightAt(f.x, f.z) < 2.5) break;
      }
      g.stopDriving();
      return { s: Math.round(t * 10) / 10, roofShare: Math.round((roof / Math.max(1, roof + street)) * 100) };
    };
    // the errand must not count these runs: take them off the clock
    const hook = g.onStep; g.onStep = null;
    const r = c.layer.route(from.pos, to.pos, 3);
    out.streetMetres = Math.round(r.metres);
    out.crowMetres = Math.round(Math.hypot(to.pos.x - from.pos.x, to.pos.z - from.pos.z));
    out.streetRunS = go(r.pts.map((p: any) => ({ ...p, run: true })), false).s;
    out.streetJogS = go(r.pts.map((p: any) => ({ ...p, pace: 0.75 })), false).s;
    out.streetWalkS = go(r.pts.map((p: any) => ({ ...p, pace: 0.35 })), false, 400).s;
    const L = out.crowMetres, n = Math.ceil(L / 4);
    const line = Array.from({ length: n }, (_, i) => ({ x: from.pos.x + (to.pos.x - from.pos.x) * (i + 1) / n, z: from.pos.z + (to.pos.z - from.pos.z) * (i + 1) / n, run: true }));
    const roof = go(line, true);
    out.roofRunS = roof.s;
    out.roofRunRoofShare = roof.roofShare;
    g.onStep = hook;
    g.opts.touch = wasTouch;
    g.film(false);
    return out;
  });
}
