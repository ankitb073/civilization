// Streets world: the city's public places at street level. The walls get a walk with merlons on the outer edge,
// stairs up from beside the gates and ladders between; the gates their opened leaves; the temple and the palace a
// flight of steps each; the temple square a market with stalls and a weigher's scale; a well with a sweep at a
// crossing; the house of tablets its tablets drying on the roof and a cistern in its courtyard; the dyers' street its
// vats and drying cloth by the postern the sack came through. All placed on the model's plan, from hashes of its id.

import { Vector3 } from 'three';
import type { Ladder } from '../affordances.ts';
import { C, type Ctx, houseOwner, onSide, yawAlong } from './ctx.ts';
import { sideStair, stairFootClear } from './houses.ts';
import { type House, type Rect, type Side, sides } from './plan.ts';
import { ladderAt } from './reach.ts';
import { shade, vary, type RGB } from '../../../three/city/style.ts';
import { riverDist } from '../../../three/city/layout.ts';

const TAU = Math.PI * 2;

/** A flight of steps straight out from a face (side s at offset t), from `top` down to the ground. */
export function frontStair(ctx: Ctx, s: Side, t: number, width: number, top: number, col: RGB, slope = 34, what: 'temple' | 'palace' | 'bridge' = 'bridge') {
  const { kit } = ctx;
  const [fx, fz] = onSide(s, t, 0.5);
  const g = ctx.ground(fx, fz);
  const rise = top - g;
  const run = rise / Math.tan((slope * Math.PI) / 180);
  ctx.intents.push({ k: 'front', owner: kit.owner, side: { ...s }, t, width, top, g, run, what });
  const n = Math.max(2, Math.ceil(rise / 0.24));
  const yaw = yawAlong(s);
  for (let k = 0; k < n; k++) {
    // step k counts down from the top: its front edge at d = (k+1) run/n from the face
    const h = top - g - (k * rise) / n;
    const d0 = (k * run) / n, d1 = ((k + 1) * run) / n;
    const [x, z] = onSide(s, t, (d0 + d1) / 2 + 0.01);
    kit.put('mud', x, g + h / 2, z, yaw, width, h, d1 - d0 + 0.02, vary(col, ctx.u(`fs:${s.x.toFixed(1)}:${k}`), 0.035));
  }
  // cheek walls (they stay the layer's own beside the kit's flights in the hero district)
  const owner = kit.owner;
  kit.owner = -1;
  for (const sg of [-1, 1]) {
    const a = new Vector3(...p3(s, t + sg * (width / 2 + 0.2), 0, top + 0.2));
    const b = new Vector3(...p3(s, t + sg * (width / 2 + 0.2), run, g + 0.45));
    kit.beam('mud', a, b, 0.4, 0.5, shade(col, 0.92), true);
  }
  kit.owner = owner;
  const pts: number[] = [];
  for (const sg of [-1, 1]) {
    const tt = t + sg * width / 2;
    pts.push(...p3(s, tt, -0.05, g), ...p3(s, tt, -0.05, top), ...p3(s, tt, run / n, top), ...p3(s, tt, run + 0.02, g), ...p3(s, tt, run + 0.02, g + rise / n * 0.5));
  }
  kit.solidHull(pts);
  const [ox, oz] = onSide(s, t, run / 2);
  ctx.occ.add({ x: ox, z: oz, rot: yaw, hw: width / 2 + 0.4, hd: run / 2 + 0.1 }, g, top);
  return { foot: new Vector3(...p3(s, t, run + 1.2, g)), head: new Vector3(...p3(s, t, -1.2, top)), run };
}

function p3(s: Side, t: number, d: number, y: number): [number, number, number] {
  const [x, z] = onSide(s, t, d);
  return [x, y, z];
}

export interface Civic {
  ladders: Ladder[];
  temple: { foot: Vector3 } | null;
  palace: { gate: Vector3; foot: Vector3; towers: Vector3[] } | null;
  market: { centre: Vector3; scale: Vector3; stalls: { x: number; z: number; yaw: number }[] } | null;
  well: Vector3 | null;
  walls: { stairs: Vector3[]; feet: Vector3[]; ladders: number; head: Vector3 | null };
  gates: { x: number; z: number; ang: number; inner: Vector3; towers: Vector3[] }[];
  postern: { x: number; z: number; inner: Vector3 } | null;
  tablet: { house: number; door: Vector3; cistern: Vector3 | null } | null;
  dyers: { home: number; dyer: number; centre: Vector3 } | null;
  /** Banners: where they hang (pole foot, height, facing yaw). */
  banners: { x: number; y: number; z: number; yaw: number; h: number; pole?: boolean }[];
  /** Flights of steps up to roofs, platforms and the walls: a path from the street to the top (for the probes). */
  stairs: { name: string; path: Vector3[] }[];
  /** People standing about (figurines): position, facing, colour, pose; some have a part in the errands (`role`:
   *  'overseer' at the door of the house of tablets, 'gatekeeper' inside each gate, with the gate's index). */
  people: { x: number; y: number; z: number; yaw: number; c: RGB; sex: 'f' | 'm'; pose: 'stand' | 'sit' | 'carry'; role?: string; gate?: number }[];
}

// ---------------------------------------------------------------- the walls

export function wallWorks(ctx: Ctx, civ: Civic) {
  const W = ctx.plan.walls;
  if (!W) return;
  const { kit } = ctx;
  const col: RGB = W.runs[0] ? W.runs[0].part.c : [0.72, 0.58, 0.42];
  // merlons on the outer edge of every standing run (the model's crenels sat in the middle of the walk)
  const runOwner = (i: number) => { const r = W.runs[i]; return ctx.owners.id(`wr:${i}`, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2); };
  for (const [ri, r] of W.runs.entries()) {
    kit.owner = runOwner(ri);
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    const tx = (r.x1 - r.x0) / len, tz = (r.z1 - r.z0) / len;
    const mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
    let nx = -tz, nz = tx;
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; } // outward
    // the kit's wall walk (citywall_4m, which redraws it in the hero district): a breastwork 0.55 m high along the outer
    // edge, and two merlons on it to every 4 m module (at 0.55–1.45 and 2.55–3.45 m), 0.55 m higher again
    const ko = (W.T / 2) * (1.455 / 1.68), kt = 0.45 * (W.T / 3.36);
    const bx = nx * ko, bz = nz * ko;
    kit.beam('mud', new Vector3(r.x0 + bx, W.H + 0.275, r.z0 + bz), new Vector3(r.x1 + bx, W.H + 0.275, r.z1 + bz), kt, 0.55, shade(col, 1.03), true);
    const nm = Math.max(1, Math.round(len / 4)), km = len / (4 * nm);
    for (let k = 0; k < nm; k++) for (const [m0, m1] of [[0.55, 1.45], [2.55, 3.45]]) {
      const a0 = (k * 4 + m0) * km, a1 = (k * 4 + m1) * km;
      const a = new Vector3(r.x0 + tx * a0 + bx, W.H + 0.825, r.z0 + tz * a0 + bz), b = new Vector3(r.x0 + tx * a1 + bx, W.H + 0.825, r.z0 + tz * a1 + bz);
      kit.beam('mud', a, b, kt, 0.55, shade(col, 1.05), true);
    }
    // a low kerb on the inner edge
    const ia = new Vector3(r.x0 - nx * (W.T / 2 - 0.12), W.H + 0.12, r.z0 - nz * (W.T / 2 - 0.12));
    const ib = new Vector3(r.x1 - nx * (W.T / 2 - 0.12), W.H + 0.12, r.z1 - nz * (W.T / 2 - 0.12));
    kit.beam('mud', ia, ib, 0.24, 0.24, shade(col, 0.98), true);
  }
  kit.owner = -1;
  // the runs' inner faces as sides (normal toward the town)
  const faceOf = (r: (typeof W.runs)[number]): Side => {
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    const tx = (r.x1 - r.x0) / len, tz = (r.z1 - r.z0) / len;
    const mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
    let nx = -tz, nz = tx;
    if (nx * mx + nz * mz > 0) { nx = -nx; nz = -nz; } // inward
    return { x: mx + nx * W.T / 2, z: mz + nz * W.T / 2, nx, nz, tx, tz, half: len / 2, k: 0 };
  };
  // how much of a run's inner face is free of towers: [t0, t1]
  const freeSpan = (s: Side): [number, number] => {
    let lo = -s.half, hi = s.half;
    for (const tw of W.towers) {
      const tt = (tw.x - s.x) * s.tx + (tw.z - s.z) * s.tz;
      const dd = Math.abs((tw.x - s.x) * s.nx + (tw.z - s.z) * s.nz);
      if (dd > tw.half + 1) continue;
      if (tt > 0) hi = Math.min(hi, tt - tw.half - 0.25); else lo = Math.max(lo, tt + tw.half + 0.25);
    }
    return [lo, hi];
  };
  const stairRuns = new Set<number>();
  // a stair up beside each gate, on the nearest run with room for it
  for (const gt of W.gates) {
    const order = W.runs.map((r, i) => ({ i, d: Math.hypot((r.x0 + r.x1) / 2 - gt.x, (r.z0 + r.z1) / 2 - gt.z) })).sort((a, b) => a.d - b.d).slice(0, 6);
    for (const { i } of order) {
      const s = faceOf(W.runs[i]);
      const [lo, hi] = freeSpan(s);
      const g0 = ctx.ground(s.x, s.z);
      const rise = W.H - g0;
      // nothing in the way along the face
      const [cx, cz] = onSide(s, (lo + hi) / 2, 0.85);
      if (!ctx.occ.clear({ x: cx, z: cz, rot: yawAlong(s), hw: (hi - lo) / 2, hd: 0.7 }, 0, 0.2, 2)) continue;
      // rise toward the gate if its foot is clear; a tower at the foot leaves a step's room before the stair
      const tg = (gt.x - s.x) * s.tx + (gt.z - s.z) * s.tz;
      let dir = tg > 0 ? 1 : -1;
      const foot = (d: number) => (d > 0 ? lo : hi) + d * 0.1;
      if (!stairFootClear(ctx, s, foot(dir), dir, 1.6, g0, 0.02)) dir = -dir;
      let t0 = foot(dir);
      if (!stairFootClear(ctx, s, t0, dir, 1.6, g0, 0.02)) t0 += dir * 1.5;
      const t1 = (dir > 0 ? hi : lo) - dir * 0.1;
      if (Math.abs(t1 - t0) - 1.0 < rise / Math.tan((46 * Math.PI) / 180) + 0.2) continue;
      if (!stairFootClear(ctx, s, t0, dir, 1.6, g0, 0.02)) continue;
      kit.owner = runOwner(i);
      const path = sideStair(ctx, s, t0, t1, ctx.ground(s.x, s.z), W.H, 1.6, shade(col, 0.96), 0.02, W.T / 2);
      kit.owner = -1;
      stairRuns.add(i);
      civ.walls.feet.push(path[0]);
      civ.stairs.push({ name: `walls ${civ.walls.feet.length}`, path });
      civ.walls.stairs.push(path[path.length - 1]);
      break;
    }
  }
  civ.walls.head = civ.walls.stairs[0] ?? null;
  // ladders up the inner face, every few runs
  W.runs.forEach((r, i) => {
    if (stairRuns.has(i) || ctx.u(`wl:${i}`) > 0.24) return;
    const s = faceOf(r);
    const [lo, hi] = freeSpan(s);
    if (hi - lo < 2) return;
    const t = (lo + hi) / 2 + (ctx.u(`wlt:${i}`) - 0.5) * (hi - lo - 1.6);
    const [cx, cz] = onSide(s, t, 1.3);
    if (!ctx.occ.clear({ x: cx, z: cz, rot: yawAlong(s), hw: 0.45, hd: 1.1 }, 0, 0.2, 2.2) || ctx.water(cx, cz) > 0) return;
    kit.owner = runOwner(i);
    civ.ladders.push(ladderAt(ctx, s, t, ctx.ground(cx, cz), W.H, 1.4, `w${i}`));
    kit.owner = -1;
    civ.walls.ladders++;
  });
  // over each tower on the walk: a ladder up its face from either side
  for (const tw of W.towers) {
    const ang = Math.atan2(tw.z, tw.x);
    const tx = -Math.sin(ang), tz = Math.cos(ang);
    for (const sg of [-1, 1]) {
      // the walk continues on this side?
      const px = tw.x + tx * sg * (tw.half + 2), pz = tw.z + tz * sg * (tw.half + 2);
      const on = W.runs.some((r) => {
        const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
        const u = ((px - r.x0) * (r.x1 - r.x0) + (pz - r.z0) * (r.z1 - r.z0)) / (len * len);
        return u > 0 && u < 1;
      });
      if (!on) continue;
      const s: Side = { x: tw.x + tx * sg * tw.half, z: tw.z + tz * sg * tw.half, nx: tx * sg, nz: tz * sg, tx: Math.cos(ang), tz: Math.sin(ang), half: tw.half, k: 0 };
      kit.owner = ctx.owners.id(`tw:${tw.x.toFixed(1)},${tw.z.toFixed(1)}`, tw.x, tw.z);
      civ.ladders.push(ladderAt(ctx, s, -0.55, W.H, tw.top, 0.9, `t${tw.x.toFixed(0)}`));
      kit.owner = -1;
    }
  }
  // the gates: leaves swung open against the towers' inner faces, and a banner on each tower
  for (const gt of W.gates) {
    const ang = gt.ang;
    const rx = Math.cos(ang), rz = Math.sin(ang);
    const towers = W.towers.filter((tw) => Math.hypot(tw.x - gt.x, tw.z - gt.z) < 22).sort((a, b) => Math.hypot(a.x - gt.x, a.z - gt.z) - Math.hypot(b.x - gt.x, b.z - gt.z)).slice(0, 2);
    const tv: Vector3[] = [];
    for (const tw of towers) {
      // tangential direction from the tower toward the gate
      const gx = gt.x - tw.x, gz = gt.z - tw.z;
      const gl = Math.hypot(gx, gz) || 1;
      const ux = gx / gl, uz = gz / gl;
      const leafW = Math.min(3.4, gl - tw.half - 0.6);
      if (leafW > 1.2) {
        // hinged at the tower's corner on the town side, folded back against the inner face
        const hx = tw.x + ux * tw.half - rx * tw.half, hz = tw.z + uz * tw.half - rz * tw.half;
        const a = new Vector3(hx - rx * 0.2, 2.6, hz - rz * 0.2), b = new Vector3(hx - rx * 0.2 - ux * leafW, 2.6, hz - rz * 0.2 - uz * leafW);
        kit.owner = ctx.owners.id(`tw:${tw.x.toFixed(1)},${tw.z.toFixed(1)}`, tw.x, tw.z);
        kit.beam('wood', a, b, 0.22, 5.2, vary(C.timberDark, ctx.u(`gl:${tw.x}`), 0.08), true);
        for (const y of [0.9, 2.6, 4.3]) kit.beam('wood', a.clone().setY(y).addScaledVector(new Vector3(-rx, 0, -rz), 0.14), b.clone().setY(y).addScaledVector(new Vector3(-rx, 0, -rz), 0.14), 0.1, 0.2, C.bronze);
        ctx.intents.push({ k: 'gateLeaf', owner: kit.owner, a: [a.x, a.y, a.z], b: [b.x, b.y, b.z], h: 5.2 });
        kit.owner = -1;
      }
      civ.banners.push({ x: tw.x - rx * (tw.half + 0.05), y: tw.top - 0.6, z: tw.z - rz * (tw.half + 0.05), yaw: Math.atan2(rz, -rx) + Math.PI, h: 3.2 });
      tv.push(new Vector3(tw.x, tw.top, tw.z));
    }
    const ir = W.R - W.T / 2 - 6;
    civ.gates.push({ x: gt.x, z: gt.z, ang, inner: new Vector3(rx * ir, ctx.ground(rx * ir, rz * ir), rz * ir), towers: tv });
  }
}

/** A small door through the wall toward the sack's direction (the script's postern on the dyers' side). */
export function postern(ctx: Ctx, civ: Civic, dir: number) {
  const W = ctx.plan.walls;
  if (!W || !W.runs.length) return;
  let best = W.runs[0], bd = Infinity;
  for (const r of W.runs) {
    const a = Math.atan2((r.z0 + r.z1) / 2, (r.x0 + r.x1) / 2);
    const d = Math.abs(Math.atan2(Math.sin(a - dir), Math.cos(a - dir)));
    // not over water, not beside a gate
    const mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
    if (ctx.water(mx, mz) > 0 || W.gates.some((g) => Math.hypot(g.x - mx, g.z - mz) < 20)) continue;
    if (d < bd) { bd = d; best = r; }
  }
  const len = Math.hypot(best.x1 - best.x0, best.z1 - best.z0);
  const tx = (best.x1 - best.x0) / len, tz = (best.z1 - best.z0) / len;
  const mx = (best.x0 + best.x1) / 2, mz = (best.z0 + best.z1) / 2;
  let nx = -tz, nz = tx;
  if (nx * mx + nz * mz > 0) { nx = -nx; nz = -nz; }
  const yaw = Math.atan2(-tz, tx);
  for (const sg of [1, -1]) {
    const fx = mx + nx * sg * (W.T / 2 + 0.02), fz = mz + nz * sg * (W.T / 2 + 0.02);
    const g = ctx.ground(fx, fz);
    ctx.kit.put('wood', fx, g + 1.05, fz, yaw, 1.1, 2.1, 0.06, C.void);
    ctx.kit.put('wood', fx + nx * sg * 0.06, g + 2.2, fz + nz * sg * 0.06, yaw, 1.6, 0.2, 0.2, C.timberDark);
    ctx.kit.put('wood', fx + nx * sg * 0.05, g + 1.0, fz + nz * sg * 0.05, yaw, 0.95, 1.95, 0.08, vary(C.timberDark, 0.3, 0.1));
  }
  const ix = mx + nx * (W.T / 2 + 2.2), iz = mz + nz * (W.T / 2 + 2.2);
  civ.postern = { x: mx, z: mz, inner: new Vector3(ix, ctx.ground(ix, iz), iz) };
}

// ---------------------------------------------------------------- temple and palace

export function templeSteps(ctx: Ctx, civ: Civic, away: { x: number; z: number } | null) {
  const T = ctx.plan.temple;
  if (!T || T.top < 0.6) return;
  // the short ends (gable ends) face the entrances; take the one away from the palace
  const ends = sides(T).filter((s) => s.half <= Math.min(T.hw, T.hd) + 1e-3);
  const pick = (ends.length ? ends : sides(T)).map((s) => ({ s, d: away ? -Math.hypot(s.x - away.x, s.z - away.z) : 0 })).sort((a, b) => a.d - b.d)[0].s;
  ctx.kit.owner = ctx.owners.id('temple', T.x, T.z);
  const st = frontStair(ctx, pick, 0, Math.min(pick.half * 2 - 2, 8), T.top, [0.82, 0.74, 0.6], 34, 'temple');
  ctx.kit.owner = -1;
  civ.temple = { foot: st.foot };
  civ.stairs.push({ name: 'temple', path: [st.foot, st.head] });
  // banners either side of the steps
  for (const sg of [-1, 1]) {
    const [x, z] = onSide(pick, sg * (Math.min(pick.half * 2 - 2, 8) / 2 + 1.0), 0.6);
    civ.banners.push({ x, y: T.top, z, yaw: Math.atan2(pick.nx, pick.nz), h: 3.6, pole: true });
  }
}

export function palaceSteps(ctx: Ctx, civ: Civic) {
  const P = ctx.plan.palace;
  if (!P) return;
  // the platform's side facing the square
  const front = sides(P).sort((a, b) => (b.nx * P.gate.nx + b.nz * P.gate.nz) - (a.nx * P.gate.nx + a.nz * P.gate.nz))[0];
  ctx.kit.owner = ctx.owners.id('palace', P.x, P.z);
  const st = frontStair(ctx, front, 0, 6, P.top, [0.8, 0.72, 0.58], 33, 'palace');
  // a great doorway in the hall's front
  const hf = sides(P.hall).sort((a, b) => (b.nx * P.gate.nx + b.nz * P.gate.nz) - (a.nx * P.gate.nx + a.nz * P.gate.nz))[0];
  const yaw = yawAlong(hf);
  const [dx, dz] = onSide(hf, 0, 0.03);
  ctx.kit.put('wood', dx, P.top + 1.8, dz, yaw, 2.4, 3.6, 0.06, C.void);
  const [lx, lz] = onSide(hf, 0, 0.12);
  ctx.kit.put('wood', lx, P.top + 3.75, lz, yaw, 3.4, 0.3, 0.3, C.timberDark);
  const columns: [number, number, number][] = [];
  for (const sg of [-1, 1]) {
    const [cx, cz] = onSide(hf, sg * 1.7, 0.35);
    ctx.kit.put('pole', cx, P.top + 1.8, cz, 0, 0.5, 3.6, 0.5, [0.55, 0.32, 0.22]);
    ctx.kit.solidBox(cx, P.top + 1.8, cz, 0, 0.25, 1.8, 0.25);
    columns.push([cx, P.top, cz]);
  }
  ctx.intents.push({ k: 'palaceDoor', owner: ctx.kit.owner, side: { ...hf }, y: P.top, columns });
  ctx.kit.owner = -1;
  const towers: Vector3[] = [];
  for (const sg of [-1, 1]) {
    const [x, z] = onSide(front, sg * 4.2, -1.6);
    civ.banners.push({ x, y: P.top, z, yaw: Math.atan2(front.nx, front.nz), h: 4.2, pole: true });
    towers.push(new Vector3(x, P.top, z));
  }
  const gate = new Vector3(P.gate.x, P.top, P.gate.z);
  civ.palace = { gate, foot: st.foot, towers };
  civ.stairs.push({ name: 'palace', path: [st.foot, st.head] });
}

// ---------------------------------------------------------------- the market, the scale, the well

const GOODS: RGB[] = [C.grain, C.clay, C.buff, [0.55, 0.62, 0.3], [0.62, 0.22, 0.2], [0.82, 0.78, 0.66], C.saffron];

export function market(ctx: Ctx, civ: Civic, avoid: { x: number; z: number } | null) {
  const { plan } = ctx;
  const R = plan.plazaR;
  // the side of the square away from the palace
  const base = avoid ? Math.atan2(-avoid.z, -avoid.x) : ctx.u('mkt') * TAU;
  const rs = R - 5.6;
  const stalls: { x: number; z: number; yaw: number }[] = [];
  const roadNear = (x: number, z: number, w: number) => plan.roads.some((a) => {
    const al = x * Math.cos(a) + z * Math.sin(a);
    return al > 0 && Math.abs(-x * Math.sin(a) + z * Math.cos(a)) < w;
  });
  const step = 3.6 / rs;
  for (let k = -9; k <= 9; k++) {
    const a = base + k * step;
    const x = Math.cos(a) * rs, z = Math.sin(a) * rs;
    if (roadNear(x, z, 5.2)) continue;
    const yaw = Math.atan2(Math.sin(a), -Math.cos(a)) + Math.PI / 2; // local x along the arc, facing in
    const rect: Rect = { x, z, rot: -a - Math.PI / 2, hw: 1.5, hd: 1.0 };
    if (!ctx.occ.clear(rect, 0.4, 0.1, 2.4)) continue;
    ctx.kit.owner = ctx.owners.id(`stall:${k}`, x, z);
    stall(ctx, x, z, a, k);
    ctx.kit.owner = -1;
    stalls.push({ x, z, yaw });
    ctx.occ.add(rect, 0, 2.5);
    if (stalls.length >= (ctx.mobile ? 12 : 16)) break;
  }
  // the weigher's scale: in the open between the stalls and the temple, at the middle of the market
  const sr = rs - 4.2;
  let sx = Math.cos(base) * sr, sz = Math.sin(base) * sr;
  for (let k = 0; k < 8 && (ctx.occ.blocked(sx, sz, 1.6, 0.1, 2.5) || roadNear(sx, sz, 4.5)); k++) {
    const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.12;
    sx = Math.cos(a) * sr; sz = Math.sin(a) * sr;
  }
  ctx.kit.owner = ctx.owners.id('scale', sx, sz);
  scale(ctx, sx, sz, base);
  ctx.intents.push({ k: 'scale', owner: ctx.kit.owner, x: sx, z: sz, a: base });
  ctx.kit.owner = -1;
  civ.market = { centre: new Vector3(Math.cos(base) * (rs - 2), 0, Math.sin(base) * (rs - 2)), scale: new Vector3(sx, ctx.ground(sx, sz), sz), stalls };
}

function stall(ctx: Ctx, x: number, z: number, a: number, k: number) {
  const { kit } = ctx;
  const g = ctx.ground(x, z);
  // local frame: u along the arc, v toward the centre (the counter's front)
  const ux = -Math.sin(a), uz = Math.cos(a), vx = -Math.cos(a), vz = -Math.sin(a);
  const P = (u: number, v: number): [number, number] => [x + ux * u + vx * v, z + uz * u + vz * v];
  const yaw = Math.atan2(-uz, ux);
  const cloth = [C.madder, C.indigo, C.linen, C.ochre, C.reed, C.saffron][Math.floor(ctx.u(`stc:${k}`) * 6) % 6];
  // posts and a sloping canopy
  for (const [u, v] of [[-1.35, 0.85], [1.35, 0.85], [-1.35, -0.85], [1.35, -0.85]]) {
    const [px, pz] = P(u, v);
    const h = v > 0 ? 2.35 : 2.65;
    kit.put('pole', px, g + h / 2, pz, 0, 0.1, h, 0.1, C.timber);
    kit.solidBox(px, g + h / 2, pz, 0, 0.06, h / 2, 0.06);
  }
  const [b0x, b0z] = P(0, -1.0), [b1x, b1z] = P(0, 1.05);
  kit.beam('cloth', new Vector3(b0x, g + 2.68, b0z), new Vector3(b1x, g + 2.36, b1z), 3.0, 0.05, cloth, true, new Vector3(vx, 5, vz).normalize());
  // the counter, and goods on it
  const [cx, cz] = P(0, 0.55);
  kit.block('wood', cx, g, cz, yaw, 2.5, 0.82, 0.7, vary(C.timber, ctx.u(`stw:${k}`), 0.1), true);
  const n = 3 + Math.floor(ctx.u(`stn:${k}`) * 3);
  const goods: { u: number; v: number; kind: number; c: RGB }[] = [];
  for (let j = 0; j < n; j++) {
    const gu = -0.95 + (1.9 * (j + 0.5)) / n, gv = 0.55 + (ctx.u(`sgv:${k}:${j}`) - 0.5) * 0.25;
    const [gx, gz] = P(gu, gv);
    const c = GOODS[Math.floor(ctx.u(`sgc:${k}:${j}`) * GOODS.length) % GOODS.length];
    const kind = ctx.u(`sgk:${k}:${j}`);
    goods.push({ u: gu, v: gv, kind, c });
    if (kind < 0.3) kit.put('cone', gx, g + 0.82 + 0.13, gz, 0, 0.42, 0.26, 0.42, c); // a heap of grain or spice
    else if (kind < 0.6) kit.put('jar', gx, g + 0.82 + 0.17, gz, kind * 9, 0.26, 0.34, 0.26, vary(C.clay, kind, 0.15));
    else if (kind < 0.8) kit.put('ball', gx, g + 0.82 + 0.08, gz, kind * 5, 0.3, 0.17, 0.3, c); // a basket's worth
    else kit.put('cloth', gx, g + 0.82 + 0.06, gz, yaw, 0.38, 0.12, 0.32, [C.madder, C.indigo, C.saffron][j % 3]); // a bolt of cloth
  }
  // a sack or two and a big jar on the ground beside it
  const [jx, jz] = P(1.75, 0.2);
  const jar = !ctx.occ.blocked(jx, jz, 0.35, g + 0.1, g + 1);
  if (jar) {
    kit.put('jar', jx, g + 0.42, jz, k, 0.62, 0.84, 0.62, vary(C.buff, ctx.u(`sj:${k}`), 0.1));
    kit.solidBox(jx, g + 0.42, jz, 0, 0.25, 0.42, 0.25);
  }
  ctx.intents.push({ k: 'stall', owner: kit.owner, x, z, a, i: k, cloth, goods, jar });
  const [sx, sz] = P(-1.75, 0.3);
  kit.put('frustum', sx, g + 0.33, sz, k * 1.3, 0.56, 0.66, 0.5, vary(C.linen, ctx.u(`ss:${k}`), 0.1));
  kit.put('ball', sx, g + 0.7, sz, k * 1.3, 0.3, 0.12, 0.28, vary(C.linen, ctx.u(`ss:${k}`), 0.1));
}

/** The weigher's scale: a post, a beam and two pans, with weights and a grain heap. */
function scale(ctx: Ctx, x: number, z: number, a: number) {
  const { kit } = ctx;
  const g = ctx.ground(x, z);
  const ux = -Math.sin(a), uz = Math.cos(a);
  kit.put('pole', x, g + 1.15, z, 0, 0.18, 2.3, 0.18, C.timberDark);
  kit.solidBox(x, g + 1.15, z, 0, 0.1, 1.15, 0.1);
  kit.beam('wood', new Vector3(x - ux * 0.95, g + 2.2, z - uz * 0.95), new Vector3(x + ux * 0.95, g + 2.2, z + uz * 0.95), 0.08, 0.1, C.timberDark);
  for (const sg of [-1, 1]) {
    const px = x + ux * sg * 0.9, pz = z + uz * sg * 0.9;
    kit.beam('wood', new Vector3(px, g + 2.18, pz), new Vector3(px, g + 1.18, pz), 0.02, 0.02, [0.3, 0.25, 0.2]);
    kit.put('pole', px, g + 1.15, pz, 0, 0.62, 0.06, 0.62, C.bronze);
  }
  for (let k = 0; k < 4; k++) kit.put('wood', x + ux * (0.4 + k * 0.17) + uz * 0.5, g + 0.08, z + uz * (0.4 + k * 0.17) - ux * 0.5, k, 0.12, 0.12 + k * 0.03, 0.12, [0.42, 0.4, 0.36]);
  kit.put('cone', x - uz * 0.9, g + 0.3, z + ux * 0.9, 0, 1.2, 0.6, 1.2, C.grain);
  kit.solidBox(x - uz * 0.9, g + 0.25, z + ux * 0.9, 0, 0.45, 0.25, 0.45);
  ctx.occ.add({ x, z, rot: 0, hw: 1.2, hd: 1.2 }, g, g + 2.3);
}

/** A public well with a sweep (shaduf), at a crossing of a main road and the first ring road. */
export function well(ctx: Ctx, civ: Civic, toward: { x: number; z: number } | null) {
  const { plan } = ctx;
  const ring = plan.rings.find((r) => r > plan.plazaR + 12) ?? plan.plazaR + 20;
  const ta = toward ? Math.atan2(toward.z, toward.x) : 0;
  const roads = plan.roads.slice().sort((a, b) => Math.abs(Math.atan2(Math.sin(a - ta), Math.cos(a - ta))) - Math.abs(Math.atan2(Math.sin(b - ta), Math.cos(b - ta))));
  for (const a of roads) {
    for (const off of [4.6, -4.6, 6, -6]) {
      const x = Math.cos(a) * ring - Math.sin(a) * off, z = Math.sin(a) * ring + Math.cos(a) * off;
      if (ctx.occ.blocked(x, z, 2.2, 0.1, 2.5) || ctx.water(x, z) > 0 || riverDist(plan.L, x / plan.LOT, z / plan.LOT).d < 0.8) continue;
      ctx.kit.owner = ctx.owners.id('well', x, z);
      wellAt(ctx, x, z, a);
      ctx.intents.push({ k: 'well', owner: ctx.kit.owner, x, z, a });
      ctx.kit.owner = -1;
      civ.well = new Vector3(x, ctx.ground(x, z), z);
      return;
    }
  }
}

function curb(ctx: Ctx, x: number, z: number, g: number, r: number, h: number, col: RGB, waterC: RGB) {
  const { kit } = ctx;
  for (let k = 0; k < 10; k++) {
    const a0 = (k / 10) * TAU, a1 = ((k + 1) / 10) * TAU;
    kit.beam('mud', new Vector3(x + Math.cos(a0) * r, g + h / 2, z + Math.sin(a0) * r), new Vector3(x + Math.cos(a1) * r, g + h / 2, z + Math.sin(a1) * r), 0.3, h, vary(col, ctx.u(`cb:${x.toFixed(0)}:${k}`), 0.05));
  }
  kit.put('pole', x, g + h - 0.22, z, 0, r * 2 - 0.2, 0.06, r * 2 - 0.2, waterC);
  const pts: number[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    pts.push(x + Math.cos(a) * (r + 0.15), g, z + Math.sin(a) * (r + 0.15), x + Math.cos(a) * (r + 0.15), g + h, z + Math.sin(a) * (r + 0.15));
  }
  kit.solidHull(pts);
  ctx.occ.add({ x, z, rot: 0, hw: r + 0.2, hd: r + 0.2 }, g, g + h);
}

function wellAt(ctx: Ctx, x: number, z: number, a: number) {
  const { kit } = ctx;
  const g = ctx.ground(x, z);
  curb(ctx, x, z, g, 0.85, 0.8, [0.7, 0.62, 0.5], C.water);
  // the sweep: an upright, a long pole pivoting on it, a counterweight and a bucket (the upright where the kit's
  // well_head has its forked post, 2.3 m out, so its collider stands under the kit's post)
  const ux = Math.cos(a), uz = Math.sin(a);
  const px = x + ux * 2.3, pz = z + uz * 2.3;
  kit.put('pole', px, g + 1.2, pz, 0, 0.2, 2.4, 0.2, C.timberDark);
  kit.solidBox(px, g + 1.2, pz, 0, 0.12, 1.2, 0.12);
  ctx.occ.add({ x: px, z: pz, rot: 0, hw: 0.15, hd: 0.15 }, g, g + 2.4);
  const top = new Vector3(px, g + 2.31, pz);
  const tip = new Vector3(x - ux * 0.2, g + 3.6, z - uz * 0.2);
  const tail = top.clone().multiplyScalar(2).sub(tip).add(new Vector3(0, -0.1, 0));
  kit.beam('wood', tail, tip, 0.1, 0.1, C.timber);
  kit.put('ball', tail.x, tail.y - 0.2, tail.z, 0, 0.5, 0.45, 0.5, [0.5, 0.45, 0.4]);
  kit.beam('wood', tip, new Vector3(tip.x, g + 1.5, tip.z), 0.025, 0.025, [0.35, 0.3, 0.25]);
  kit.put('jar', tip.x, g + 1.3, tip.z, 0, 0.36, 0.42, 0.36, C.clay);
  // jars waiting by it
  for (let k = 0; k < 3; k++) {
    const b = a + 2.2 + k * 0.5;
    const jx = x + Math.cos(b) * 1.55, jz = z + Math.sin(b) * 1.55;
    kit.put('jar', jx, g + 0.36, jz, k, 0.5, 0.72, 0.5, vary(C.buff, ctx.u(`wj:${k}`), 0.12));
    ctx.intents.push({ k: 'jar', owner: kit.owner, x: jx, y: g, z: jz, yaw: k, r: 0.25, h: 0.72 });
    kit.solidBox(jx, g + 0.36, jz, 0, 0.2, 0.36, 0.2);
  }
}

// ---------------------------------------------------------------- the house of tablets, the dyers' street

/** The house nearest the palace's flank, away from the square: the house of tablets ("under the archive"). */
export function pickTabletHouse(ctx: Ctx): number {
  const P = ctx.plan.palace;
  const H = ctx.plan.houses;
  let best = -1, bd = Infinity;
  H.forEach((h, i) => {
    if (h.kind !== 'house') return;
    if (!ctx.sides[i].some((s) => s.open >= 2.4)) return;
    const d = P ? Math.hypot(h.x - P.x, h.z - P.z) : h.r;
    if (d < bd && h.r > ctx.plan.plazaR + 2) { bd = d; best = i; }
  });
  return best;
}

export function tabletHouse(ctx: Ctx, civ: Civic, i: number) {
  const { kit } = ctx;
  const h = ctx.plan.houses[i];
  const d = ctx.dress[i];
  d.role = 'tablet-house';
  const ss = ctx.sides[i];
  // the door on its most open street side (the house faces the palace's people)
  const front = ss.filter((s) => !s.court).sort((a, b) => b.open - a.open)[0] ?? ss.sort((a, b) => b.open - a.open)[0];
  d.door = { k: front.k, t: 0 };
  const g = h.ground;
  const own = houseOwner(ctx, i);
  kit.owner = own;
  // baskets of clay and a water jar by the door
  for (const [t, kind] of [[-1.2, 0], [-1.75, 0], [1.3, 1]] as [number, number][]) {
    const [x, z] = onSide(front, t, 0.45);
    if (kind === 0) {
      kit.put('pole', x, g + 0.22, z, 0, 0.55, 0.44, 0.55, [0.62, 0.5, 0.33]);
      kit.put('ball', x, g + 0.44, z, t, 0.48, 0.16, 0.48, [0.55, 0.53, 0.5]); // grey clay heaped in it
      kit.solidBox(x, g + 0.25, z, 0, 0.26, 0.25, 0.26);
      ctx.intents.push({ k: 'basket', owner: own, x, y: g, z, yaw: t });
    } else {
      kit.put('jar', x, g + 0.5, z, 0, 0.7, 1.0, 0.7, C.clay);
      kit.solidBox(x, g + 0.5, z, 0, 0.28, 0.5, 0.28);
      ctx.intents.push({ k: 'jar', owner: own, x, y: g, z, yaw: 0.7, r: 0.35, h: 1.0 });
    }
  }
  kit.owner = -1;
  // on the roof: a reed shade over racks of tablets drying in the sun
  const y = h.roof;
  if (h.flat) {
  const c = Math.cos(h.rot), s = Math.sin(h.rot);
  const L = (u: number, v: number): [number, number] => [h.x + c * u + s * v, h.z - s * u + c * v];
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const [px, pz] = L(a * (h.hw - 1.3), b * (h.hd - 1.6));
    kit.put('pole', px, y + 1.05, pz, 0, 0.1, 2.1, 0.1, C.timber);
    kit.solidBox(px, y + 1.05, pz, 0, 0.06, 1.05, 0.06);
  }
  const [mx, mz] = L(0, 0);
  kit.put('cloth', mx, y + 2.12, mz, h.rot, (h.hw - 1.3) * 2 + 0.5, 0.06, (h.hd - 1.6) * 2 + 0.5, C.reed);
  kit.owner = own;
  const racks: { x: number; z: number; yaw: number; len: number }[] = [];
  for (let r = 0; r < 3; r++) {
    const [rx, rz] = L(-0.8 + r * 0.8, 0);
    racks.push({ x: rx, z: rz, yaw: h.rot + Math.PI / 2, len: (h.hd - 2.0) * 2 });
    kit.block('wood', rx, y, rz, h.rot + Math.PI / 2, (h.hd - 2.0) * 2, 0.42, 0.5, C.timber, true);
    const n = Math.floor(((h.hd - 2.0) * 2) / 0.22);
    for (let k = 0; k < n; k++) {
      const [tx, tz] = L(-0.8 + r * 0.8 + (k % 2 ? 0.1 : -0.1), -(h.hd - 2.0) + 0.11 + k * 0.22);
      kit.put('wood', tx, y + 0.5, tz, h.rot + 0.05 * (ctx.u(`tb:${r}:${k}`) - 0.5), 0.17, 0.16, 0.04, vary([0.72, 0.62, 0.48], ctx.u(`tbc:${r}:${k}`), 0.12));
    }
  }
  ctx.intents.push({ k: 'tablets', owner: own, house: i, racks, y });
  kit.owner = -1;
  }
  // the cistern in its courtyard
  let cistern: Vector3 | null = null;
  const court = ss.filter((q) => q.court).sort((a, b) => b.open - a.open)[0];
  if (court) {
    const [x, z] = onSide(court, 0, Math.min(court.open, 8) / 2 + 0.3);
    if (!ctx.occ.blocked(x, z, 1.4, g + 0.1, g + 1)) {
      kit.owner = own;
      curb(ctx, x, z, ctx.ground(x, z), 1.05, 0.72, shade(h.wall, 0.95), [0.28, 0.36, 0.34]);
      ctx.intents.push({ k: 'cistern', owner: own, x, z, r: 1.05 });
      kit.owner = -1;
      cistern = new Vector3(x, ctx.ground(x, z), z);
    }
  }
  const [dx, dz] = onSide(front, 0, 1.8);
  civ.tablet = { house: i, door: new Vector3(dx, ctx.ground(dx, dz), dz), cistern };
}

/** The dyers' street: houses inside the postern, with vats and cloth drying; the runner's home and the dyer's. */
export function dyersStreet(ctx: Ctx, civ: Civic) {
  if (!civ.postern) return;
  const { kit } = ctx;
  const p = civ.postern.inner;
  const H = ctx.plan.houses;
  const near = H.map((h, i) => ({ h, i, d: Math.hypot(h.x - p.x, h.z - p.z) }))
    .filter((o) => o.h.kind === 'house' && o.d < 46 && !ctx.dress[o.i].role)
    .sort((a, b) => a.d - b.d);
  const dyes: RGB[] = [C.indigo, C.madder, C.saffron, [0.35, 0.42, 0.3]];
  let vats = 0;
  let dyer = -1, home = -1;
  for (const { h, i } of near) {
    const s = ctx.sides[i].filter((q) => q.open >= 3 && !q.court).sort((a, b) => b.open - a.open)[0];
    if (!s) continue;
    if (dyer < 0) { dyer = i; ctx.dress[i].role = 'dyer'; }
    else if (home < 0 && Math.hypot(h.x - H[dyer].x, h.z - H[dyer].z) < 12) { home = i; ctx.dress[i].role = 'home'; }
    const g = h.ground;
    // two or three vats along the wall
    const nv = 2 + Math.floor(ctx.u(`vat:${h.id}`) * 2);
    for (let k = 0; k < nv; k++) {
      const t = (k - (nv - 1) / 2) * 1.5;
      if (Math.abs(t) > s.half - 0.7) continue;
      const [x, z] = onSide(s, t, 0.85);
      if (ctx.occ.blocked(x, z, 0.65, g + 0.1, g + 1)) continue;
      kit.put('pole', x, g + 0.4, z, 0, 1.15, 0.8, 1.15, shade(h.wall, 0.86));
      kit.put('pole', x, g + 0.79, z, 0, 0.95, 0.04, 0.95, dyes[(k + h.id) % dyes.length]);
      kit.solidBox(x, g + 0.4, z, 0, 0.55, 0.4, 0.55);
      ctx.occ.add({ x, z, rot: 0, hw: 0.6, hd: 0.6 }, g, g + 0.8);
      vats++;
    }
    // cloth drying on a line between two poles, out in the street
    const [ax, az] = onSide(s, -s.half + 0.4, 2.3), [bx, bz] = onSide(s, s.half - 0.4, 2.3);
    if (!ctx.occ.blocked(ax, az, 0.3, g + 0.1, g + 2) && !ctx.occ.blocked(bx, bz, 0.3, g + 0.1, g + 2)) {
      for (const [x, z] of [[ax, az], [bx, bz]]) {
        kit.put('pole', x, g + 1.25, z, 0, 0.08, 2.5, 0.08, C.timber);
        kit.solidBox(x, g + 1.25, z, 0, 0.05, 1.25, 0.05);
      }
      kit.beam('wood', new Vector3(ax, g + 2.42, az), new Vector3(bx, g + 2.42, bz), 0.02, 0.02, [0.4, 0.34, 0.26]);
      const nc = 3;
      for (let k = 0; k < nc; k++) {
        const f = (k + 0.5) / nc;
        const x = ax + (bx - ax) * f, z = az + (bz - az) * f;
        kit.put('cloth', x, g + 1.75, z, yawAlong(s), 1.3, 1.3, 0.03, dyes[(k + h.id + 1) % dyes.length]);
      }
    }
    if (vats > 10) break;
  }
  if (dyer >= 0) {
    const D = H[dyer];
    civ.dyers = { home, dyer, centre: new Vector3(D.x, D.ground, D.z) };
  }
}

/** People standing about, as figurines: at the stalls, at the scale, at the well, at the gates. */
export function people(ctx: Ctx, civ: Civic) {
  const clothes: RGB[] = [C.linen, C.linen, [0.82, 0.76, 0.62], C.madder, C.indigo, C.ochre, [0.55, 0.47, 0.36]];
  const put = (x: number, z: number, yaw: number, key: string, pose: 'stand' | 'sit' | 'carry' = 'stand', role?: { role: string; gate?: number; sex?: 'f' | 'm' }) => {
    if (ctx.occ.blocked(x, z, 0.32, 0.1, 1.8)) return;
    const g = ctx.ground(x, z);
    const c = clothes[Math.floor(ctx.u(`pc:${key}`) * clothes.length) % clothes.length];
    civ.people.push({ x, y: g, z, yaw, c, sex: role?.sex ?? (ctx.u(`ps:${key}`) < 0.5 ? 'f' : 'm'), pose, ...(role ? { role: role.role, gate: role.gate } : {}) });
    ctx.kit.solidBox(x, g + 0.85, z, 0, 0.22, 0.85, 0.22);
    ctx.occ.add({ x, z, rot: 0, hw: 0.3, hd: 0.3 }, g, g + 1.7);
  };
  if (civ.market) {
    civ.market.stalls.forEach((s, k) => {
      const a = Math.atan2(s.z, s.x);
      const bx = Math.cos(a), bz = Math.sin(a);
      // the seller behind the counter, a buyer or two in front
      put(s.x + bx * 0.2, s.z + bz * 0.2, Math.atan2(-bx, -bz), `sell:${k}`);
      if (ctx.u(`buy:${k}`) < 0.7) put(s.x - bx * 1.9 + (ctx.u(`bx:${k}`) - 0.5), s.z - bz * 1.9 + (ctx.u(`bz:${k}`) - 0.5), Math.atan2(bx, bz), `buy:${k}`, ctx.u(`bp:${k}`) < 0.3 ? 'carry' : 'stand');
    });
    const sc = civ.market.scale;
    const a = Math.atan2(sc.z, sc.x);
    put(sc.x + Math.cos(a + 1.6) * 1.2, sc.z + Math.sin(a + 1.6) * 1.2, a, 'weigher');
    put(sc.x + Math.cos(a - 1.4) * 1.6, sc.z + Math.sin(a - 1.4) * 1.6, a + Math.PI, 'weigh-buyer', 'carry');
  }
  if (civ.well) {
    const w = civ.well;
    put(w.x + 1.4, w.z - 0.6, -1.2, 'well-a', 'carry');
    put(w.x - 1.2, w.z + 1.0, 2.2, 'well-b');
  }
  for (const [k, gt] of civ.gates.entries()) {
    const ix = gt.inner.x, iz = gt.inner.z;
    const tx = -Math.sin(gt.ang), tz = Math.cos(gt.ang);
    put(ix + tx * 4.6, iz + tz * 4.6, gt.ang + Math.PI, `gate:${k}:a`, 'stand', { role: 'gatekeeper', gate: k, sex: 'm' });
    put(ix - tx * 4.8 + Math.cos(gt.ang) * 1.2, iz - tz * 4.8 + Math.sin(gt.ang) * 1.2, gt.ang + Math.PI * 0.8, `gate:${k}:b`);
  }
  if (civ.palace) {
    const f = civ.palace.gate;
    const P = ctx.plan.palace!;
    for (const sg of [-1, 1]) put(f.x + P.gate.nz * sg * 2.4 + P.gate.nx * 0.6, f.z - P.gate.nx * sg * 2.4 + P.gate.nz * 0.6, Math.atan2(P.gate.nx, P.gate.nz), `guard:${sg}`);
  }
  if (civ.tablet) {
    const d = civ.tablet.door;
    put(d.x + 0.8, d.z + 0.8, 0.6, 'scribe', 'sit', { role: 'overseer', sex: 'm' });
  }
}

/** Bridges: steps up onto each end of the deck, and a timber rail along both sides. */
export function bridgeWorks(ctx: Ctx) {
  const { kit } = ctx;
  for (const b of ctx.plan.bridges) {
    const ss = sides(b);
    // the ends: the short sides (local ±x)
    for (const s of [ss[0], ss[1]]) {
      const [ex, ez] = onSide(s, 0, 1.0);
      if (b.top - ctx.ground(ex, ez) < 0.2) continue;
      frontStair(ctx, s, 0, b.hd * 2 - 0.3, b.top, [0.55, 0.45, 0.35], 26);
    }
    // rails on the long sides
    for (const s of [ss[2], ss[3]]) {
      const n = Math.max(2, Math.round((s.half * 2) / 2.4));
      for (let k = 0; k <= n; k++) {
        const t = -s.half + (k * s.half * 2) / n;
        const [x, z] = onSide(s, t, -0.12);
        kit.put('wood', x, b.top + 0.5, z, 0, 0.14, 1.0, 0.14, C.timberDark);
      }
      const a = new Vector3(...p3(s, -s.half, -0.12, b.top + 0.98)), e = new Vector3(...p3(s, s.half, -0.12, b.top + 0.98));
      kit.beam('wood', a, e, 0.1, 0.1, C.timber);
      kit.solidBeam(a.clone().setY(b.top + 0.5), e.clone().setY(b.top + 0.5), 0.14, 1.0);
    }
  }
}

export function emptyCivic(): Civic {
  return { ladders: [], temple: null, palace: null, market: null, well: null, walls: { stairs: [], feet: [], ladders: 0, head: null }, gates: [], postern: null, tablet: null, dyers: null, banners: [], people: [], stairs: [] };
}

export function houseNear(ctx: Ctx, x: number, z: number): House | null {
  let best: House | null = null, bd = Infinity;
  for (const h of ctx.plan.houses) { const d = Math.hypot(h.x - x, h.z - z); if (d < bd) { bd = d; best = h; } }
  return best;
}

