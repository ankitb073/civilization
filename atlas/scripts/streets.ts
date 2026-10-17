// The Streets movement spike (#/streets): plays it in a browser at desktop and phone sizes, drives the runner with real
// input (keys; touches on the stick and the jump button), screenshots walking, running, jumping and the camera against a
// wall, runs axe, then walks a scripted round for N seconds and reports frame times (median, p95), draw calls,
// triangles and physics bodies. Phones get a 4× CPU slowdown for the round.
// Usage: npm --prefix atlas run build && npm --prefix atlas run streets -- [--out=dir] [--only=desktop|phone]
//          [--seconds=20] [--city=set:151 --y=2234] [--reduced] [--url=http://127.0.0.1:5173/] (a dev server instead of dist/)
// Desktop also films jump strips (a running jump, a standing jump, and a push forward with jump at the same moment;
// 12 frames 83 ms apart, in the game camera and from the side) and measures the feel and how deep landings sink into
// strips-desktop.json. --strip does only that; --tag=name names the files (e.g. before / after).

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
/** Only the jump frame strips (desktop), named with --tag (e.g. before / after). */
const STRIP_ONLY = process.argv.includes('--strip');
/** Only the traversal probes (mantle, wall, ladder, water strips, timings and screenshots). */
const MOVES_ONLY = process.argv.includes('--moves');
const TAG = arg('tag', '');
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
  film(on: boolean): void; home(): { facing: number }; screenBox(): { x0: number; y0: number; x1: number; y1: number };
  advance(sec: number, ctl: unknown, jump?: boolean): { t: number; y: number; x: number; z: number; grounded: boolean; pose: string; vy: number; speed: number; pelvis: number };
  sideView: { heading: number; dist: number; y: number; fov: number; ang?: number } | null;
  walls(want: 'mantle' | 'wall', n?: number): { x: number; y: number; z: number; facing: number; up: number; top: number }[];
  scale(w: unknown, back?: number, max?: number, press?: boolean): { s: number; moves: string[] } | null;
  streetLadders(n?: number): { i: number; h: number; x: number; z: number }[];
  atLadder(i: number, top?: boolean): { facing: number; base: { x: number; y: number; z: number }; top: { x: number; y: number; z: number } };
  riverEdge(): { x: number; z: number; facing: number } | null;
  cam: { yaw: number; pitch: number };
} };

/** Traversal (step 2): street-to-roof timings at every wall the probe finds (from a stand 0.9 m out, jumping at it; and
 *  from 5 m back at a run; on a phone, with no jump at all, by auto-parkour), mantles walked into, ladders up and over
 *  and back down, wading toward deep water; frame strips of the mantle, the wall climb and pull-up and the ladder
 *  (desktop), and a screenshot of each move. */
async function moveProbes(page: Page, prefix: string, phone: boolean) {
  const res: Record<string, unknown> = {};
  const shots: Record<string, string> = {};
  const pct = (a: number[], p: number) => { const q = a.slice().sort((x, y) => x - y); return q.length ? q[Math.min(q.length - 1, Math.floor((p / 100) * q.length))] : NaN; };
  // ---- timings, headless
  const t = await page.evaluate((phone) => {
    const g = (window as unknown as W).__palimpsestStreets;
    g.film(true);
    const walls = g.walls('wall', 80);
    const stand = walls.map((w) => ({ up: w.up, r: g.scale(w, 0.9, 4, true) }));
    const runup = walls.map((w) => ({ up: w.up, r: g.scale(w, 5, 4, true) })).filter((x) => x.r);
    const auto = phone ? walls.map((w) => ({ up: w.up, r: g.scale(w, 5, 4, false) })).filter((x) => x.r) : [];
    const mantles = g.walls('mantle', 30).map((w) => ({ up: w.up, r: g.scale(w, 2.2, 3, false) }));
    // the edge-stop: on a roof the runner climbed, walk back out to its edge (stays up), and run out (goes over)
    const edges = walls.slice(0, 12).map((w) => {
      const walk = (g as unknown as { edgeTest(w: unknown, p: number): { y0: number; low: number } | null }).edgeTest(w, 0.35);
      const run = (g as unknown as { edgeTest(w: unknown, p: number): { y0: number; low: number } | null }).edgeTest(w, 1);
      return { walkStayed: walk ? walk.low > walk.y0 - 0.6 : null, runLeft: run ? run.low < run.y0 - 1.5 : null };
    });
    const lad = g.streetLadders(8).map((l) => {
      g.atLadder(l.i);
      const W = { mx: 0, my: 1, run: false, pace: 0.35, jumpHeld: false };
      let up = Infinity, down = Infinity;
      for (let k = 0; k < 600; k++) { const r = g.advance(1 / 60, W); const i = g.info() as unknown as { trav: string | null }; if (k > 30 && !i.trav && r.grounded && r.y > l.h - 0.5 + 0) { up = (k + 1) / 60; break; } }
      g.atLadder(l.i, true);
      const y0 = (g.info() as unknown as { feet: { y: number } }).feet.y;
      for (let k = 0; k < 600; k++) { const r = g.advance(1 / 60, W); const i = g.info() as unknown as { trav: string | null }; if (k > 30 && !i.trav && r.grounded && r.y < y0 - l.h + 0.5) { down = (k + 1) / 60; break; } }
      return { h: l.h, up, down };
    });
    g.film(false);
    // up the world's stairs at a walk, a jog and a run (m/s made good; the flat walk is 1.45)
    const gs = g as unknown as { stairs(p: number): { name: string; s: number; mps: number }[] };
    const stairs = { walk: gs.stairs(0.35), jog: gs.stairs(0.75), run: gs.stairs(1) };
    return { stand, runup, auto, mantles, lad, edges, stairs };
  }, phone);
  const sum = (rows: { up: number; r: { s: number; moves: string[] } | null }[]) => {
    const ss = rows.map((x) => x.r!.s).filter(Number.isFinite);
    return {
      walls: rows.length, made: ss.length, within2s: rows.filter((x) => x.r!.s <= 2).length,
      heightsM: [Math.min(...rows.map((x) => x.up)), Math.max(...rows.map((x) => x.up))].map((v) => Math.round(v * 100) / 100),
      seconds: { median: r2(pct(ss, 50)), p90: r2(pct(ss, 90)), max: r2(Math.max(...ss)) },
      moves: [...new Set(rows.map((x) => x.r!.moves.join('>')))],
    };
  };
  res.streetToRoof = { fromStand: sum(t.stand), fromRunUp: sum(t.runup), ...(phone ? { autoParkour: sum(t.auto) } : {}) };
  res.mantles = { tried: t.mantles.length, mantled: t.mantles.filter((m) => m.r && m.r.moves[0] === 'mantle').length, seconds: r2(pct(t.mantles.filter((m) => m.r && Number.isFinite(m.r.s)).map((m) => m.r!.s), 50)) };
  res.ladders = t.lad.map((l) => ({ h: r2(l.h), upS: r2(l.up), downS: r2(l.down) }));
  res.stairs = Object.fromEntries(Object.entries(t.stairs).map(([k, v]) => [k, v.map((x) => `${x.name} ${x.mps} m/s`)]));
  const e = t.edges.filter((x) => x.walkStayed !== null);
  res.edgeStop = { roofs: e.length, walkerStayedOn: e.filter((x) => x.walkStayed).length, runnerWentOver: t.edges.filter((x) => x.runLeft).length };

  // ---- strips and screenshots, filmed
  type Setup = { ok: boolean; heading: number; y0: number; y1: number; lead: number };
  const film = async (kind: string, every: number, n: number, dist: number, strip: boolean, shotAt: number[]) => {
    for (const view of strip ? (['game', 'side'] as const) : (['game'] as const)) {
      // two passes: the first, headless, finds the step at which the move begins; the second films from just before it
      const st = await page.evaluate(([kind, view, dist]) => {
        const g = (window as unknown as W).__palimpsestStreets as unknown as W['__palimpsestStreets'] & Record<string, (...a: unknown[]) => unknown>;
        g.film(true); g.sideView = null;
        const JOG = { mx: 0, my: 1, run: false, pace: 0.75, jumpHeld: false }, WALK = { mx: 0, my: 1, run: false, pace: 0.35, jumpHeld: false };
        const RUN = { mx: 0, my: 1, run: true, pace: 1, jumpHeld: true };
        const info = () => g.info() as unknown as { trav: string | null; feet: { x: number; y: number; z: number } };
        let setup: () => { heading: number; y1: number } | null;
        let ctl: unknown = WALK, press = false;
        if (kind === 'mantle') {
          const ws = g.walls('mantle', 40);
          const w = ws.filter((x) => x.up > 0.85)[0] ?? ws[0];
          if (!w) return null;
          ctl = JOG;
          setup = () => { g.teleport(w.x - Math.sin(w.facing) * 1.6, w.z - Math.cos(w.facing) * 1.6, w.facing); g.cam.yaw = w.facing + 0.5; g.cam.pitch = 0.2; return { heading: w.facing, y1: w.top }; };
        } else if (kind === 'climb' || kind === 'hang') {
          const w = g.walls('wall', 30).filter((x) => x.up > 4.2 && x.up < 5)[kind === 'hang' ? 1 : 0] ?? g.walls('wall', 30)[0];
          if (!w) return null;
          ctl = RUN; press = true;
          setup = () => { g.teleport(w.x, w.z, w.facing); g.cam.yaw = w.facing + 0.6; g.cam.pitch = 0.05; return { heading: w.facing, y1: w.top }; };
        } else if (kind === 'ladder-up' || kind === 'ladder-down') {
          const l = g.streetLadders(8).filter((x) => x.h > 3.5)[0];
          if (!l) return null;
          setup = () => { const a = g.atLadder(l.i, kind === 'ladder-down'); g.cam.yaw = a.facing + 0.6; return { heading: a.facing, y1: a.top.y }; };
        } else if (kind === 'wade') {
          const e = g.riverEdge();
          if (!e) return null;
          ctl = JOG;
          setup = () => { g.teleport(e.x, e.z, e.facing); g.cam.yaw = e.facing + 0.4; g.cam.pitch = 0.25; return { heading: e.facing, y1: 0 }; };
        } else if (kind === 'jog') {
          ctl = JOG;
          setup = () => { const h = g.home(); g.cam.yaw = h.facing; return { heading: h.facing, y1: 0 }; };
        } else if (kind === 'costume') {
          ctl = { mx: 0, my: 0, run: false, pace: 0, jumpHeld: false };
          setup = () => { const h = g.home(); g.cam.yaw = h.facing + Math.PI - 0.45; g.cam.pitch = 0.08; return { heading: h.facing, y1: 0 }; };
        } else return null;
        // the view settles first (it was elsewhere); the moves are fixed-step, so a second run is the same as the first
        const STILL = { mx: 0, my: 0, run: false, pace: 0, jumpHeld: false };
        let s0 = setup()!;
        g.advance(0.5, STILL);
        let lead = 0;
        if (kind === 'mantle') {
          for (let k = 0; k < 240; k++) { g.advance(1 / 60, ctl); if (info().trav) { lead = Math.max(0, k - 4); break; } }
          s0 = setup()!;
          g.advance(0.5, STILL);
        }
        const y0 = info().feet.y;
        if (lead) g.advance(lead / 60, ctl);
        const r = g.advance(1 / 60, ctl, press);
        g.sideView = view === 'side' ? { heading: s0.heading, dist: dist as number, y: (y0 + Math.max(y0 + 1, s0.y1)) / 2 + 0.3, fov: 42, ang: kind === 'wade' ? 0.15 : kind === 'mantle' ? 0.55 : 0.75 } : null;
        // the hang: let go of the stick as the hands reach the edge (the runner hangs), push again to pull up
        const sched = kind === 'hang' ? [ctl, ctl, ctl, STILL, STILL, STILL, STILL, ctl] : null;
        (window as unknown as { __mv: unknown }).__mv = { ctl, y0, sched };
        return { ok: true, y0, r };
      }, [kind, view, dist] as const);
      if (!st) { res[kind] = 'no place found'; break; }
      const frames: Frame[] = [];
      for (let k = 0; k < n; k++) {
        const r = await page.evaluate((every) => {
          const g = (window as unknown as W).__palimpsestStreets;
          const mv = (window as unknown as { __mv: { ctl: unknown; y0: number; sched: unknown[] | null; k?: number } }).__mv;
          mv.k = (mv.k ?? -1) + 1;
          const r = g.advance(every / 60, mv.sched ? mv.sched[Math.min(mv.k, mv.sched.length - 1)] : mv.ctl);
          const i = g.info() as unknown as { trav: string | null };
          return { ...r, trav: i.trav, y0: mv.y0 };
        }, every);
        const box = await page.evaluate(() => (window as unknown as W).__palimpsestStreets.screenBox());
        const buf = await page.screenshot();
        frames.push({ png: buf.toString('base64'), box, label: `+${((k + 1) * every / 60).toFixed(2)} s  ${(r.y - r.y0).toFixed(2)} m\n${r.trav ?? r.pose}` });
        if (view === 'game' && shotAt.includes(k)) {
          const file = join(OUT, `${prefix}-move-${kind}${shotAt.length > 1 ? `-${k}` : ''}${REDUCED ? '-reduced' : ''}.png`);
          writeFileSync(file, buf);
          shots[`${kind}${shotAt.length > 1 ? `-${k}` : ''}`] = file;
        }
      }
      if (strip) {
        const file = join(OUT, `${prefix}-strip-${kind}-${view}${REDUCED ? '-reduced' : ''}.png`);
        await compose(page, frames, `${prefix} · ${kind} · ${view} camera · ${Math.round((every / 60) * 1000)} ms apart (heights are the feet over the start)`, file, phone ? 390 : 1440, phone ? 844 : 900, view === 'game');
        shots[`strip-${kind}-${view}`] = file;
      }
    }
  };
  await film('costume', 1, 1, 6, false, [0]);
  await film('jog', 20, 3, 6, false, [2]);
  await film('mantle', 4, 12, 6, !phone, [5]);
  await film('climb', 8, 12, 9, !phone, [3, 9]);
  await film('hang', 8, 12, 9, !phone, [5]);
  await film('ladder-up', 14, 12, 9, !phone, [5]);
  await film('ladder-down', 12, 12, 9, !phone, [4]);
  await film('wade', 12, 10, 7, !phone, [6]);
  // back to the temple square for whatever comes next
  await page.evaluate(() => { const g = (window as unknown as W).__palimpsestStreets; g.home(); g.film(false); });
  return { res, shots };
}

type Frame = { png: string; box: { x0: number; y0: number; x1: number; y1: number }; label: string };

/** Lay frames side by side, all cropped to one box (the union of where the runner was on screen, padded), labelled. */
async function compose(page: Page, frames: Frame[], title: string, file: string, W0 = 1440, H0 = 900, track = false) {
  let x0 = Math.min(...frames.map((f) => f.box.x0)), x1 = Math.max(...frames.map((f) => f.box.x1));
  let y0 = Math.min(...frames.map((f) => f.box.y0)), y1 = Math.max(...frames.map((f) => f.box.y1));
  const padX = Math.max(60, (x1 - x0) * 0.35), padY = Math.max(50, (y1 - y0) * 0.18);
  x0 = Math.max(0, x0 - padX); x1 = Math.min(W0, x1 + padX); y0 = Math.max(0, y0 - padY * 1.6); y1 = Math.min(H0, y1 + padY);
  const crop = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
  // tracking: each frame its own window, the same size, centred on where the runner is in it (the view moved a lot)
  const crops = frames.map((f) => {
    if (!track) return crop;
    const w = Math.min(W0, Math.max(...frames.map((g) => g.box.x1 - g.box.x0)) * 1.8 + 120);
    const h = Math.min(H0, Math.max(...frames.map((g) => g.box.y1 - g.box.y0)) * 1.4 + 120);
    const cx = Number.isFinite(f.box.x0) ? (f.box.x0 + f.box.x1) / 2 : W0 / 2, cy = Number.isFinite(f.box.y0) ? (f.box.y0 + f.box.y1) / 2 : H0 / 2;
    return { x: Math.round(Math.max(0, Math.min(W0 - w, cx - w / 2))), y: Math.round(Math.max(0, Math.min(H0 - h, cy - h / 2))), w: Math.round(w), h: Math.round(h) };
  });
  const blank = await page.context().newPage();
  const data = await blank.evaluate(async ({ frames, crops, title }) => {
    const crop = crops[0];
    const th = 300, tw = Math.round((crop.w / crop.h) * th), cols = frames.length;
    const cv = document.createElement('canvas');
    cv.width = tw * cols; cv.height = th + 22;
    const x = cv.getContext('2d')!;
    x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height);
    x.fillStyle = '#222'; x.font = '13px -apple-system, sans-serif'; x.fillText(title, 6, 15);
    for (let i = 0; i < frames.length; i++) {
      const im = new Image();
      im.src = `data:image/png;base64,${frames[i].png}`;
      await im.decode();
      const c = crops[i];
      x.drawImage(im, c.x, c.y, c.w, c.h, i * tw, 22, tw, th);
      x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.moveTo(i * tw, 22); x.lineTo(i * tw, th + 22); x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.82)'; x.fillRect(i * tw, 22, tw, 34);
      x.fillStyle = '#111'; x.font = '11px -apple-system, sans-serif';
      frames[i].label.split('\n').forEach((l, j) => x.fillText(l, i * tw + 4, 36 + j * 13));
    }
    return cv.toDataURL('image/png').split(',')[1];
  }, { frames, crops, title });
  await blank.close();
  writeFileSync(file, Buffer.from(data, 'base64'));
}

/** Frame strips of a jump: the game stepped by hand (fixed steps, so the frames are evenly spaced whatever the machine),
 *  12 frames 5 steps (83 ms) apart from just before the press, in the game's own camera and from the side at a fixed
 *  height. Cases: a running jump, a standing jump, and pushing forward and jumping at the same moment from a stand. */
async function jumpStrips(page: Page, prefix: string) {
  const out: Record<string, unknown> = {};
  const files: string[] = [];
  const RUN = { mx: 0, my: 1, run: true, jumpHeld: true }, NONE = { mx: 0, my: 0, run: false, jumpHeld: false };
  const cases = [
    { name: 'run', pre: RUN, ctl: RUN, preS: 1.4 },
    { name: 'stand', pre: NONE, ctl: { ...NONE, jumpHeld: true }, preS: 0.6 },
    { name: 'go', pre: NONE, ctl: RUN, preS: 0.6 },
  ];
  for (const c of cases) for (const view of ['game', 'side'] as const) {
    const frames: { png: string; box: { x0: number; y0: number; x1: number; y1: number }; label: string }[] = [];
    const arc: unknown[] = [];
    const home = await page.evaluate(() => { const g = (window as unknown as W).__palimpsestStreets; g.film(true); return g.home(); });
    const r0 = await page.evaluate(([pre, s, side, h]) => {
      const g = (window as unknown as W).__palimpsestStreets;
      g.sideView = null;
      g.advance(s as number, pre);
      const r = g.advance(1 / 60, pre);
      // the side camera: off the runner's right, level with its chest at the start
      g.sideView = side ? { heading: h as number, dist: 6.5, y: r.y + 1.0, fov: 40 } : null;
      return r;
    }, [c.pre, c.preS, view === 'side', home.facing] as const);
    for (let k = 0; k < 12; k++) {
      const r = await page.evaluate(([ctl, k]) => {
        const g = (window as unknown as W).__palimpsestStreets;
        return k === 0 ? g.advance(1 / 60, ctl) : g.advance(5 / 60, ctl, k === 1);
      }, [c.ctl, k] as const);
      const box = await page.evaluate(() => (window as unknown as W).__palimpsestStreets.screenBox());
      const png = (await page.screenshot()).toString('base64');
      const t = (k * 5) / 60; // frame 0 is the moment of the press; the press acts on the next step
      frames.push({ png, box, label: `${t >= 0 ? '+' : ''}${t.toFixed(2)} s  ${(r.y - r0.y).toFixed(2)} m\n${r.pose}${r.grounded ? ' · ground' : ''}` });
      arc.push({ t: Math.round(t * 1000) / 1000, h: Math.round((r.y - r0.y) * 100) / 100, d: Math.round(Math.hypot(r.x - r0.x, r.z - r0.z) * 100) / 100, pose: r.pose, ground: r.grounded, pelvis: Math.round(r.pelvis * 100) / 100 });
    }
    const file = join(OUT, `${prefix}-strip-${c.name}-${view}${REDUCED ? '-reduced' : ''}.png`);
    await compose(page, frames, `${prefix} · ${c.name} jump · ${view} camera · 83 ms apart from the press (heights are the feet over the take-off ground)`, file);
    files.push(file);
    out[`${c.name}-${view}`] = arc;
  }
  // how deep a landing sinks: the pelvis over the feet, every step, from a stand (against standing) and at a run
  // (against the lowest point of the run's own stride)
  const dips: Record<string, number> = {};
  for (const c of cases.filter((x) => x.name !== 'go')) {
    const d = await page.evaluate(([pre, ctl, preS]) => {
      const g = (window as unknown as W).__palimpsestStreets;
      g.sideView = null;
      g.home();
      g.advance(preS as number, pre);
      let base = Infinity;
      for (let i = 0; i < 60; i++) base = Math.min(base, g.advance(1 / 60, pre).pelvis);
      let landed = -1, low = Infinity;
      for (let i = 0; i < 120; i++) {
        const r = g.advance(1 / 60, ctl, i === 0);
        if (r.grounded && i > 6 && landed < 0) landed = i;
        if (landed >= 0 && i - landed < 40) low = Math.min(low, r.pelvis);
      }
      return { base, low };
    }, [c.pre, c.ctl, c.preS] as const);
    dips[`${c.name}LandingSinkM`] = Math.round((d.base - d.low) * 100) / 100;
  }
  await page.evaluate(() => (window as unknown as W).__palimpsestStreets.film(false));
  return { arcs: out, files, dips };
}

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
    page.on('console', (m) => { if (m.type() === 'error' || /context lost/i.test(m.text())) errors.push(`console: ${m.text()}`); });
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
    let traversal: { res: Record<string, unknown>; shots: Record<string, string> } | null = null;
    if (MOVES_ONLY || (!STRIP_ONLY)) {
      traversal = await moveProbes(page, `${s.name}${TAG ? `-${TAG}` : ''}`, s.mobile);
      writeFileSync(join(OUT, `moves-${s.name}${TAG ? `-${TAG}` : ''}${REDUCED ? '-reduced' : ''}.json`), JSON.stringify(traversal, null, 1));
      console.log(`  traversal ${JSON.stringify(traversal.res)}`);
      console.log(`  traversal shots: ${Object.values(traversal.shots).join(', ')}`);
      if (MOVES_ONLY) { await ctx.close(); continue; }
    }
    if (STRIP_ONLY || !s.mobile) {
      const st = await jumpStrips(page, `${s.name}${TAG ? `-${TAG}` : ''}`);
      const feel = await page.evaluate(() => (window as unknown as W).__palimpsestStreets.feel());
      writeFileSync(join(OUT, `strips-${s.name}${TAG ? `-${TAG}` : ''}${REDUCED ? '-reduced' : ''}.json`), JSON.stringify({ feel, dips: st.dips, arcs: st.arcs }, null, 1));
      console.log(`  strips: ${st.files.join(', ')}`);
      console.log(`  feel ${JSON.stringify(feel)}`);
      console.log(`  landings ${JSON.stringify(st.dips)}`);
      if (STRIP_ONLY) { await ctx.close(); continue; }
    }

    // ---- real input: walk, run, jump (from the temple square, where the traversal probes left the runner)
    const start = (await info(page)).feet;
    const moves: Record<string, unknown> = {};
    if (!s.mobile) {
      // W alone jogs; with Alt it walks, with Shift it runs
      await page.keyboard.down('AltLeft');
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(1300);
      const walk = await info(page);
      files.walk = await shot('walk');
      await page.keyboard.up('AltLeft');
      await page.waitForTimeout(1300);
      const jog = await info(page);
      files.jog = await shot('jog');
      moves.jog = { pose: jog.pose, speed: r2(jog.speed) };
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
    moves.wall = { ...wall, camWanted: r2(wi.cam.wanted), camGot: r2(wi.cam.got), pose: wi.pose, feet: [wi.feet.x, wi.feet.y, wi.feet.z].map(r2), yaw: r2(wi.cam.yaw), pitch: r2(wi.cam.pitch) };

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
      traversal: traversal?.res,
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
  if (!STRIP_ONLY && !MOVES_ONLY) {
    writeFileSync(join(OUT, `stats${REDUCED ? '-reduced' : ''}.json`), JSON.stringify(summary, null, 2));
    console.log(`\nstats → ${join(OUT, `stats${REDUCED ? '-reduced' : ''}.json`)}`);
  }
} finally {
  await browser.close();
  server?.close();
}
