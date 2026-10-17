// Streets world: the houses up close. Every lot keeps the model's footprint and height; the layer measures what lies
// in front of each wall (a street, a courtyard, a neighbour a stride away) and dresses it accordingly: a door with its
// lintel and step, small high windows, the ends of the roof beams, a parapet round the roof, mud-brick stairs up some
// of them, low walls closing alleys off the street, planks over the narrow gaps between roofs and across some lanes,
// jars, benches and awnings along the street, and the clutter of a lived-on roof.

import { Vector3 } from 'three';
import { C, type Ctx, type HouseDress, type SideInfo, houseOwner, onSide, yawAlong } from './ctx.ts';
import { type House, type Rect, type Side, gapBetween, sides } from './plan.ts';
import { mix, shade, vary, type RGB } from '../../../three/city/style.ts';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- measuring

/** Clear ground (m) in front of a side at offset t along it. */
export function clearance(ctx: Ctx, s: Side, t: number, g: number, max = 12): number {
  let last = 0.35;
  for (const d of [0.7, 1.4, 2.2, 3.0, 4.0, 5.2, 6.5, 8, 10, 12]) {
    if (d > max) break;
    const [x, z] = onSide(s, t, d);
    if (ctx.water(x, z) > 0.02 || ctx.occ.blocked(x, z, 0.3, g + 0.15, g + 2.0)) return last;
    last = d;
  }
  return Math.min(max, 12);
}

function enclosed(ctx: Ctx, x: number, z: number, g: number): boolean {
  let hits = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    for (let d = 1; d <= 11; d += 1) {
      if (ctx.occ.blocked(x + Math.cos(a) * d, z + Math.sin(a) * d, 0.15, g + 0.2, g + 2)) { hits++; break; }
    }
  }
  return hits >= 7;
}

export function measureSides(ctx: Ctx) {
  ctx.sides = ctx.plan.houses.map((h) => {
    if (h.kind === 'hut') return [];
    return sides(h).map((s): SideInfo => {
      const open = Math.min(clearance(ctx, s, 0, h.ground), clearance(ctx, s, -s.half * 0.55, h.ground), clearance(ctx, s, s.half * 0.55, h.ground));
      const [cx, cz] = onSide(s, 0, Math.min(open, 2.5));
      return { ...s, open, court: open >= 2.2 && enclosed(ctx, cx, cz, h.ground) };
    });
  });
  ctx.dress = ctx.plan.houses.map((house) => ({ house, door: null, gaps: [], access: null, role: null, parapet: 0 }));
}

/** Houses near house i (centres within r metres), from a coarse grid built once. */
export function neighbourIndex(houses: House[]): (i: number, r: number) => number[] {
  const cell = 12;
  const grid = new Map<string, number[]>();
  houses.forEach((h, i) => {
    const k = `${Math.floor(h.x / cell)},${Math.floor(h.z / cell)}`;
    const l = grid.get(k);
    if (l) l.push(i); else grid.set(k, [i]);
  });
  return (i, r) => {
    const h = houses[i];
    const out: number[] = [];
    const n = Math.ceil(r / cell);
    const cx = Math.floor(h.x / cell), cz = Math.floor(h.z / cell);
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) {
      for (const j of grid.get(`${cx + a},${cz + b}`) ?? []) if (j !== i && Math.hypot(houses[j].x - h.x, houses[j].z - h.z) <= r) out.push(j);
    }
    return out;
  };
}

/** The side of a facing b (the one whose normal points most toward b). */
export function facing(sidesA: Side[], a: Rect, b: Rect): Side {
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
  let best = sidesA[0], bd = -2;
  for (const s of sidesA) { const d = (s.nx * dx + s.nz * dz) / l; if (d > bd) { bd = d; best = s; } }
  return best;
}

/** Where the projections of two facing sides overlap: the offset range along side s (its own t). */
function overlap(s: Side, o: Side): [number, number] | null {
  const proj = (x: number, z: number) => (x - s.x) * s.tx + (z - s.z) * s.tz;
  const a = proj(o.x + o.tx * o.half, o.z + o.tz * o.half), b = proj(o.x - o.tx * o.half, o.z - o.tz * o.half);
  const lo = Math.max(-s.half, Math.min(a, b)), hi = Math.min(s.half, Math.max(a, b));
  return hi - lo > 0.6 ? [lo, hi] : null;
}

// ---------------------------------------------------------------- doors, windows, beam ends

export function pickDoors(ctx: Ctx) {
  ctx.plan.houses.forEach((h, i) => {
    if (h.kind !== 'house') return;
    const ss = ctx.sides[i];
    const court = ctx.u(`court-door:${h.id}`) < 0.42;
    let best: SideInfo | null = null, bs = -1;
    for (const s of ss) {
      if (s.open < 1.2) continue;
      const score = (s.court ? (court ? 9 : 2) : 5) + Math.min(s.open, 8) * 0.2 + ctx.u(`door-side:${h.id}:${s.k}`) * 0.5;
      if (score > bs) { bs = score; best = s; }
    }
    if (!best) return;
    const room = Math.max(0, best.half - 1.0);
    ctx.dress[i].door = { k: best.k, t: (ctx.u(`door:${h.id}`) * 2 - 1) * room };
  });
}

export function facades(ctx: Ctx) {
  const { kit } = ctx;
  ctx.plan.houses.forEach((h, i) => {
    if (h.kind !== 'house') return;
    const owner = houseOwner(ctx, i);
    kit.owner = owner;
    const d = ctx.dress[i];
    const ss = ctx.sides[i];
    const g = h.ground;
    const wall = h.wall;
    // the door: a dark opening a little proud of the wall, a timber lintel, a worn step
    if (d.door) {
      const s = ss[d.door.k];
      const big = d.role === 'tablet-house';
      const w = big ? 1.35 : 0.95, ht = big ? 2.2 : 1.9;
      const [x, z] = onSide(s, d.door.t, 0.02);
      const yaw = yawAlong(s);
      kit.put('wood', x, g + ht / 2, z, yaw, w, ht, 0.05, C.void);
      const [lx, lz] = onSide(s, d.door.t, 0.09);
      kit.put('wood', lx, g + ht + 0.09, lz, yaw, w + 0.45, 0.18, 0.2, C.timberDark);
      // jambs of fresher plaster
      for (const sg of [-1, 1]) {
        const [jx, jz] = onSide(s, d.door.t + sg * (w / 2 + 0.09), 0.04);
        kit.put('mud', jx, g + ht / 2, jz, yaw, 0.18, ht, 0.1, shade(wall, 1.08));
      }
      const [sx, sz] = onSide(s, d.door.t, 0.28);
      kit.block('mud', sx, g, sz, yaw, w + 0.5, 0.14, 0.5, shade(wall, 0.9), false);
    }
    // windows: small and high, on the walls that face open ground
    for (const s of ss) {
      if (s.open < 2.2) continue;
      const n = s.half > 3.2 && ctx.u(`win2:${h.id}:${s.k}`) < 0.5 ? 2 : 1;
      if (ctx.u(`win:${h.id}:${s.k}`) < 0.3) continue;
      const storeys = h.top > 4.6 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        let t = n === 1 ? (ctx.u(`wint:${h.id}:${s.k}`) - 0.5) * s.half : (k ? 0.5 : -0.5) * s.half;
        if (d.door && d.door.k === s.k && Math.abs(t - d.door.t) < 1.3) t = d.door.t + (t < d.door.t ? -1.4 : 1.4);
        if (Math.abs(t) > s.half - 0.5) continue;
        const y = storeys === 2 ? g + h.top * 0.68 : g + Math.min(h.top - 0.75, 2.3);
        const [x, z] = onSide(s, t, 0.02);
        const yaw = yawAlong(s);
        kit.put('wood', x, y, z, yaw, 0.48, 0.36, 0.05, C.void);
        const [lx, lz] = onSide(s, t, 0.06);
        kit.put('wood', lx, y - 0.22, lz, yaw, 0.62, 0.07, 0.14, C.timber);
        ctx.intents.push({ k: 'window', owner, house: i, side: s.k, t, y });
      }
    }
    // the ends of the roof beams, in a row under the roof on the long walls of some houses
    if (ctx.u(`vigas:${h.id}`) < 0.55) {
      const long = h.hd >= h.hw ? [ss[0], ss[1]] : [ss[2], ss[3]];
      const along: number[] = [];
      for (const s of long) {
        if (s.open < 1.5) continue;
        along.push(s.k);
        const n = Math.floor((s.half * 2 - 0.6) / 0.62);
        const yaw = yawAlong(s);
        for (let k = 0; k < n; k++) {
          const t = -s.half + 0.3 + (k + 0.5) * ((s.half * 2 - 0.6) / n);
          const [x, z] = onSide(s, t, 0.14);
          kit.put('wood', x, g + h.top - 0.2, z, yaw, 0.15, 0.15, 0.3, vary(C.timberDark, ctx.u(`vg:${h.id}:${s.k}:${k}`), 0.12));
        }
      }
      if (along.length) ctx.intents.push({ k: 'vigas', owner, house: i, sides: along });
    }
  });
  kit.owner = -1;
}

// ---------------------------------------------------------------- stairs up to the roof

/** A straight mud-brick stair along a side (t0 → t1, rising), from the ground to `top`. Returns a path for a walker:
 *  from the street in front of its foot, onto the first step, up to the head, and off it onto the top (`land` metres
 *  in past the wall). */
export function sideStair(ctx: Ctx, s: Side, t0: number, t1: number, g: number, top: number, width: number, col: RGB, out = 0.05, land = 1.4, landing = 1.0): Vector3[] {
  const { kit } = ctx;
  ctx.intents.push({ k: 'stair', owner: kit.owner, side: { ...s }, t0, t1, g, top, width, out, landing });
  const dir = Math.sign(t1 - t0);
  const tL = t1 - dir * landing;
  const run = Math.abs(tL - t0);
  const rise = top - g;
  const n = Math.max(2, Math.ceil(rise / 0.26));
  const yaw = yawAlong(s);
  const dMid = out + width / 2;
  for (let k = 0; k < n; k++) {
    const ta = t0 + dir * (k * run) / n, tb = t0 + dir * ((k + 1) * run) / n;
    const [x, z] = onSide(s, (ta + tb) / 2, dMid);
    const h = ((k + 1) * rise) / n;
    kit.put('mud', x, g + h / 2, z, yaw, run / n + 0.01, h, width, vary(col, ctx.u(`st:${s.x}:${k}`), 0.04));
  }
  // the landing at the head, level with the top
  const [lx, lz] = onSide(s, (tL + t1) / 2, dMid);
  kit.put('mud', lx, g + rise / 2, lz, yaw, landing + 0.01, rise, width, shade(col, 0.97));
  kit.solidBox(lx, g + rise / 2, lz, yaw, landing / 2, rise / 2, width / 2);
  // the collider: a wedge through the steps' front edges
  const pts: number[] = [];
  const tLast = t0 + dir * ((n - 1) * run) / n;
  for (const d of [out, out + width]) {
    const [ax, az] = onSide(s, t0 - dir * 0.02, d);
    const [bx, bz] = onSide(s, tLast, d);
    const [cx, cz] = onSide(s, tL, d);
    pts.push(ax, g, az, bx, g, bz, cx, g, cz, ax, g + rise / n, az, bx, top, bz, cx, top, cz);
  }
  kit.solidHull(pts);
  const [ox, oz] = onSide(s, (t0 + t1) / 2, dMid);
  ctx.occ.add({ x: ox, z: oz, rot: yaw, hw: Math.abs(t1 - t0) / 2 + 0.2, hd: width / 2 + 0.1 }, g, top);
  // keep the way onto the first step clear (a stair is climbed from its foot, not from the side)
  const [ax, az] = onSide(s, t0 - dir * 0.75, dMid);
  ctx.occ.add({ x: ax, z: az, rot: yaw, hw: 0.7, hd: width / 2 }, g, g + 2);
  const at = (t: number, d: number, y: number) => { const [x, z] = onSide(s, t, d); return new Vector3(x, y, z); };
  return [at(t0 - dir * 1.4, dMid, g), at(t0 + dir * 0.4, dMid, g + rise / n), at(t1 - dir * 0.1, dMid, top), at(t1 - dir * 0.5, -land, top)];
}

/** Is the ground at the foot of a stair (beyond t0, against the side) clear to walk onto it? */
export function stairFootClear(ctx: Ctx, s: Side, t0: number, dir: number, width: number, g: number, out = 0.05): boolean {
  const [ax, az] = onSide(s, t0 - dir * 0.8, out + width / 2 + 0.1);
  return ctx.occ.clear({ x: ax, z: az, rot: yawAlong(s), hw: 0.65, hd: width / 2 - 0.1 }, 0, g + 0.15, g + 2) && ctx.water(ax, az) <= 0;
}

/** External stairs on some houses with a long, clear side on a street. */
export function houseStairs(ctx: Ctx, want: number, out: { name: string; path: Vector3[] }[] = []) {
  const cands: { i: number; s: SideInfo; score: number }[] = [];
  ctx.plan.houses.forEach((h, i) => {
    if (h.kind !== 'house' || !h.flat || ctx.dress[i].role) return;
    const rise = h.roof - h.ground;
    for (const s of ctx.sides[i]) {
      if (s.open < 2.6 || s.court) continue;
      if (2 * s.half - 1.4 < rise / Math.tan((42 * Math.PI) / 180)) continue;
      if (ctx.dress[i].door?.k === s.k) continue;
      cands.push({ i, s, score: ctx.u(`stair:${h.id}:${s.k}`) });
    }
  });
  cands.sort((a, b) => a.score - b.score);
  const used = new Set<number>();
  const placed: [number, number][] = [];
  for (const c of cands) {
    if (used.size >= want) break;
    if (used.has(c.i)) continue;
    const h = ctx.plan.houses[c.i];
    if (placed.some(([x, z]) => Math.hypot(x - h.x, z - h.z) < 26)) continue;
    const s = c.s;
    // rise either way along the wall, whichever has clear ground at its foot
    let dir = ctx.u(`stair-dir:${h.id}`) < 0.5 ? 1 : -1;
    if (!stairFootClear(ctx, s, -dir * (s.half - 0.15), dir, 1.0, h.ground)) dir = -dir;
    if (!stairFootClear(ctx, s, -dir * (s.half - 0.15), dir, 1.0, h.ground)) continue;
    const t0 = -dir * (s.half - 0.15), t1 = dir * (s.half - 0.25);
    // the stair's footprint must be clear (no door, nothing placed)
    const yaw = yawAlong(s);
    const [mx, mz] = onSide(s, 0, 0.6);
    if (!ctx.occ.clear({ x: mx, z: mz, rot: yaw, hw: s.half - 0.2, hd: 0.5 }, 0.05, h.ground + 0.1, h.ground + 2)) continue;
    ctx.kit.owner = houseOwner(ctx, c.i);
    out.push({ name: `house ${h.id}`, path: sideStair(ctx, s, t0, t1, h.ground, h.roof, 1.0, shade(h.wall, 0.95)) });
    ctx.kit.owner = -1;
    ctx.dress[c.i].access = 'stair';
    ctx.dress[c.i].gaps.push({ k: s.k, t: t1 - dir * 0.5, w: 1.6 });
    used.add(c.i);
    placed.push([h.x, h.z]);
  }
  return used.size;
}

// ---------------------------------------------------------------- low walls, planks

interface Pair { a: number; b: number; gap: number; sa: Side; sb: Side; ov: [number, number] }

/** Facing pairs of houses with a gap between gMin and gMax metres. */
export function pairs(ctx: Ctx, near: (i: number, r: number) => number[], gMin: number, gMax: number, flatOnly = false): Pair[] {
  const H = ctx.plan.houses;
  const out: Pair[] = [];
  H.forEach((A, a) => {
    if (A.kind !== 'house' || (flatOnly && !A.flat)) return;
    for (const b of near(a, 9 + gMax)) {
      if (b <= a || H[b].kind !== 'house' || (flatOnly && !H[b].flat)) continue;
      const B = H[b];
      const gap = gapBetween(A, B);
      if (gap < gMin || gap > gMax) continue;
      const sa = facing(ctx.sides[a], A, B), sb = facing(ctx.sides[b], B, A);
      // facing squarely
      if (sa.nx * sb.nx + sa.nz * sb.nz > -0.94) continue;
      const ov = overlap(sa, sb);
      if (!ov) continue;
      out.push({ a, b, gap, sa, sb, ov });
    }
  });
  return out;
}

/** Low walls closing some alleys between houses off the street, so courtyards are private and walls are to vault. */
export function lowWalls(ctx: Ctx, near: (i: number, r: number) => number[]) {
  const { kit } = ctx;
  let n = 0;
  for (const p of pairs(ctx, near, 0.45, 2.3)) {
    const A = ctx.plan.houses[p.a];
    if (ctx.u(`lw:${A.id}:${p.b}`) > 0.62) continue;
    // the two ends of the alley: wall off the end that opens on a street (if the other is a courtyard or closed)
    const ends = [p.ov[0], p.ov[1]].map((t) => {
      const sgn = t === p.ov[0] ? -1 : 1;
      const [ex, ez] = onSide(p.sa, t, p.gap / 2);
      const tx = p.sa.tx * sgn, tz = p.sa.tz * sgn;
      let open = 0;
      for (let d = 0.8; d <= 6; d += 0.8) {
        if (ctx.occ.blocked(ex + tx * d, ez + tz * d, 0.25, A.ground + 0.2, A.ground + 2)) break;
        open = d;
      }
      return { t, open, sgn };
    });
    const street = ends.sort((x, y) => y.open - x.open)[0];
    if (street.open < 3) continue;
    const h = 1.15 + 0.4 * ctx.u(`lwh:${A.id}:${p.b}`);
    const t = street.t - street.sgn * 0.25;
    const a3 = new Vector3(...onSide3(p.sa, t, -0.12, A.ground + h / 2));
    const b3 = new Vector3(...onSide3(p.sa, t, p.gap + 0.12, A.ground + h / 2));
    kit.owner = ctx.owners.id(`lw:${p.a}:${p.b}`, (a3.x + b3.x) / 2, (a3.z + b3.z) / 2);
    // as thick as the kit's courtyard wall (cwall_*: 0.4 m), which redraws it in the hero district
    kit.beam('mud', a3, b3, 0.4, h, shade(mix(A.wall, ctx.plan.houses[p.b].wall, 0.5), 0.97), true);
    ctx.intents.push({ k: 'lowWall', owner: kit.owner, a: [a3.x, a3.y, a3.z], b: [b3.x, b3.y, b3.z], h, th: 0.4 });
    kit.owner = -1;
    ctx.occ.add({ x: (a3.x + b3.x) / 2, z: (a3.z + b3.z) / 2, rot: Math.atan2(-(b3.z - a3.z), b3.x - a3.x), hw: a3.distanceTo(b3) / 2, hd: 0.2 }, A.ground, A.ground + h);
    n++;
  }
  return n;
}

function onSide3(s: Side, t: number, d: number, y: number): [number, number, number] {
  const [x, z] = onSide(s, t, d);
  return [x, y, z];
}

export interface PlankRec { a: number; b: number; from: Vector3; to: Vector3; lane: boolean }

/** Planks over narrow gaps between roofs, and across a few lanes. */
export function planks(ctx: Ctx, near: (i: number, r: number) => number[], lanes: { x: number; z: number }[]): PlankRec[] {
  const out: PlankRec[] = [];
  const H = ctx.plan.houses;
  const lay = (p: Pair, t: number, lane: boolean) => {
    const A = H[p.a], B = H[p.b];
    const ya = A.roof + 0.05, yb = B.roof + 0.05;
    const from = new Vector3(...onSide3(p.sa, t, -0.55, ya));
    const tb = (onSide(p.sa, t, p.gap)[0] - p.sb.x) * p.sb.tx + (onSide(p.sa, t, p.gap)[1] - p.sb.z) * p.sb.tz;
    const to = new Vector3(...onSide3(p.sb, tb, -0.55, yb));
    const boards = lane ? 3 : 2;
    const w = 0.24;
    const dx = to.x - from.x, dz = to.z - from.z, l = Math.hypot(dx, dz);
    const px = -dz / l, pz = dx / l;
    for (let k = 0; k < boards; k++) {
      const o = (k - (boards - 1) / 2) * (w + 0.03);
      const a = from.clone().add(new Vector3(px * o, 0, pz * o)), b = to.clone().add(new Vector3(px * o, 0, pz * o));
      kit().beam('wood', a, b, w, 0.06, vary(C.wood, ctx.u(`pl:${A.id}:${p.b}:${k}`), 0.1));
    }
    // one collider for the boards together
    const half = (boards * (w + 0.03)) / 2;
    ctx.kit.solidBeam(from.clone().setY(from.y - 0.01), to.clone().setY(to.y - 0.01), half * 2, 0.07);
    ctx.dress[p.a].gaps.push({ k: p.sa.k, t, w: half * 2 + 0.7 });
    ctx.dress[p.b].gaps.push({ k: p.sb.k, t: tb, w: half * 2 + 0.7 });
    out.push({ a: p.a, b: p.b, from, to, lane });
  };
  const kit = () => ctx.kit;
  // over the gaps inside a block
  for (const p of pairs(ctx, near, 0.7, 2.3, true)) {
    const A = H[p.a], B = H[p.b];
    if (Math.abs(A.roof - B.roof) > 0.65) continue;
    const chance = p.gap > 1.5 ? 0.5 : 0.22;
    if (ctx.u(`plank:${A.id}:${B.id}`) > chance) continue;
    const t = p.ov[0] + (p.ov[1] - p.ov[0]) * (0.25 + 0.5 * ctx.u(`plankt:${A.id}:${B.id}`));
    lay(p, t, false);
  }
  // across lanes: few, spread out, between roofs of about the same height, preferring the places
  const across = pairs(ctx, near, 6.2, 10.5, true).filter((p) => Math.abs(H[p.a].roof - H[p.b].roof) < 0.8);
  // nothing standing in the lane under the plank's line, at roof height
  const score = (p: Pair) => {
    const A = H[p.a];
    let d = Infinity;
    for (const l of lanes) d = Math.min(d, Math.hypot(A.x - l.x, A.z - l.z));
    return d + 40 * ctx.u(`lane:${A.id}:${p.b}`);
  };
  across.sort((a, b) => score(a) - score(b));
  const want = ctx.mobile ? 16 : 20;
  const placed: [number, number][] = [];
  for (const p of across) {
    if (placed.length >= want) break;
    const A = H[p.a];
    if (placed.some(([x, z]) => Math.hypot(x - A.x, z - A.z) < 34)) continue;
    const t = (p.ov[0] + p.ov[1]) / 2;
    lay(p, t, true);
    placed.push([A.x, A.z]);
  }
  return out;
}

// ---------------------------------------------------------------- along the street, on the roofs

const CLOTHS: RGB[] = [C.madder, C.indigo, C.ochre, C.linen, C.saffron, C.reed, C.reed];

/** Jars by the doors, mud benches, firewood, and awnings over some doors. */
export function streetClutter(ctx: Ctx) {
  const { kit } = ctx;
  let jars = 0, awnings = 0;
  ctx.plan.houses.forEach((h, i) => {
    if (h.kind !== 'house') return;
    const d = ctx.dress[i];
    const g = h.ground;
    for (const s of ctx.sides[i]) {
      if (s.open < 2.4) continue;
      const yaw = yawAlong(s);
      const isDoor = d.door?.k === s.k;
      const dt = isDoor ? d.door!.t : 0;
      // an awning over the door on the street
      if (isDoor && !s.court && s.open >= 3.6 && ctx.u(`awn:${h.id}`) < 0.32 && h.top > 3.2) {
        const w = 2.5, depth = 1.7;
        const [px, pz] = onSide(s, dt, depth + 0.05);
        const rect = { x: px, z: pz, rot: yaw, hw: w / 2 + 0.1, hd: 0.3 };
        if (ctx.occ.clear(rect, 0.1, g + 0.1, g + 2)) {
          const col = CLOTHS[Math.floor(ctx.u(`awnc:${h.id}`) * CLOTHS.length) % CLOTHS.length];
          const yWall = Math.min(h.top - 0.3, 2.75), yPole = yWall - 0.42;
          const a = new Vector3(...onSide3(s, dt, 0.05, yWall)), b = new Vector3(...onSide3(s, dt, depth + 0.05, yPole));
          kit.beam('cloth', a, b, w, 0.05, col, true, new Vector3(s.nx, 6, s.nz).normalize());
          for (const sg of [-1, 1]) {
            const [qx, qz] = onSide(s, dt + sg * (w / 2 - 0.1), depth);
            kit.put('pole', qx, g + yPole / 2, qz, 0, 0.09, yPole, 0.09, C.timber);
            kit.solidBox(qx, g + yPole / 2, qz, 0, 0.06, yPole / 2, 0.06);
            ctx.occ.add({ x: qx, z: qz, rot: 0, hw: 0.1, hd: 0.1 }, g, g + yPole);
          }
          awnings++;
        }
      }
      // jars beside the door (or anywhere along a street wall), on the wall side of the lane
      const nj = isDoor ? 1 + Math.floor(ctx.u(`jn:${h.id}`) * 3) : ctx.u(`jw:${h.id}:${s.k}`) < 0.25 ? 1 : 0;
      for (let k = 0; k < nj; k++) {
        const side = ctx.u(`js:${h.id}:${s.k}:${k}`) < 0.5 ? -1 : 1;
        const t = isDoor ? dt + side * (0.95 + 0.62 * k) : (ctx.u(`jt:${h.id}:${s.k}`) - 0.5) * s.half * 1.5;
        if (Math.abs(t) > s.half - 0.35) continue;
        const r = 0.28 + 0.12 * ctx.u(`jr:${h.id}:${s.k}:${k}`);
        const ht = r * (2.3 + 0.6 * ctx.u(`jh:${h.id}:${s.k}:${k}`));
        const [x, z] = onSide(s, t, r + 0.08);
        if (ctx.occ.blocked(x, z, r * 0.8, g + 0.1, g + 1.2)) continue;
        kit.owner = houseOwner(ctx, i);
        kit.put('jar', x, g + ht / 2, z, ctx.u(`jy:${h.id}:${k}`) * TAU, r * 2, ht, r * 2, vary(ctx.u(`jc:${h.id}:${k}`) < 0.5 ? C.clay : C.buff, ctx.u(`jv:${h.id}:${k}`), 0.12));
        kit.owner = -1;
        ctx.intents.push({ k: 'jar', owner: houseOwner(ctx, i), x, y: g, z, yaw: ctx.u(`jy:${h.id}:${k}`) * TAU, r, h: ht });
        kit.solidBox(x, g + ht / 2, z, 0, r * 0.75, ht / 2, r * 0.75);
        ctx.occ.add({ x, z, rot: 0, hw: r, hd: r }, g, g + ht);
        jars++;
      }
      // a mud bench along the wall (a step up for a runner)
      if (!isDoor && ctx.u(`bench:${h.id}:${s.k}`) < 0.16 && s.half > 2.2) {
        const t = (ctx.u(`bt:${h.id}:${s.k}`) - 0.5) * (s.half - 1.2);
        const [x, z] = onSide(s, t, 0.3);
        const rect = { x, z, rot: yaw, hw: 0.85, hd: 0.27 };
        if (ctx.occ.clear(rect, 0.05, g + 0.1, g + 1)) {
          kit.block('mud', x, g, z, yaw, 1.7, 0.46, 0.5, shade(h.wall, 0.93), true);
          ctx.occ.add(rect, g, g + 0.46);
        }
      }
      // firewood stacked against a wall
      if (!isDoor && ctx.u(`wood:${h.id}:${s.k}`) < 0.08) {
        const t = (ctx.u(`wt:${h.id}:${s.k}`) - 0.5) * (s.half - 1);
        const [x, z] = onSide(s, t, 0.3);
        const rect = { x, z, rot: yaw, hw: 0.6, hd: 0.25 };
        if (ctx.occ.clear(rect, 0.05, g + 0.1, g + 1)) {
          kit.owner = houseOwner(ctx, i);
          ctx.intents.push({ k: 'firewood', owner: kit.owner, x, y: g, z, yaw, nx: s.nx, nz: s.nz });
          for (let k = 0; k < 7; k++) {
            const [lx, lz] = onSide(s, t + ((k % 4) - 1.5) * 0.05, 0.12 + (k % 4) * 0.12);
            kit.put('wood', lx, g + 0.09 + Math.floor(k / 4) * 0.17, lz, yaw + 0.04 * (ctx.u(`lg:${h.id}:${k}`) - 0.5), 1.15, 0.16, 0.15, vary(C.timber, ctx.u(`lg:${h.id}:${k}`), 0.18));
          }
          kit.owner = -1;
          kit.solidBox(x, g + 0.25, z, yaw, 0.6, 0.25, 0.22);
          ctx.occ.add(rect, g, g + 0.5);
        }
      }
    }
  });
  return { jars, awnings };
}

/** What stands on lived-on roofs: sleeping mats, a reed sun-shade, jars, a bread oven, drying grain. */
export function roofClutter(ctx: Ctx) {
  const { kit } = ctx;
  let n = 0;
  ctx.plan.houses.forEach((h, i) => {
    if (h.kind !== 'house' || !h.flat) return;
    const d = ctx.dress[i];
    if (d.role === 'tablet-house') return;
    const y = h.roof;
    const keep = (x: number, z: number) => !d.gaps.some((gp) => {
      const s = ctx.sides[i][gp.k];
      const [gx, gz] = onSide(s, gp.t, -0.8);
      return Math.hypot(gx - x, gz - z) < 1.6;
    }) && !(h.upper && Math.abs(x - h.upper.x) < h.upper.hw + 0.9 && Math.abs(z - h.upper.z) < h.upper.hd + 0.9);
    // local placement: u, v in −1..1 over the roof, away from the edges
    const at = (u: number, v: number): [number, number] => {
      const c = Math.cos(h.rot), s = Math.sin(h.rot);
      const lx = u * (h.hw - 1.0), lz = v * (h.hd - 1.0);
      return [h.x + c * lx + s * lz, h.z - s * lx + c * lz];
    };
    const r1 = ctx.u(`roof:${h.id}`);
    if (r1 < 0.2) {
      // a reed sun-shade on four posts
      const [x, z] = at((ctx.u(`sh:${h.id}`) - 0.5) * 0.6, (ctx.u(`sh2:${h.id}`) - 0.5) * 0.6);
      if (keep(x, z)) {
        const w = 2.2, dd = 1.8, ph = 1.95;
        const c = Math.cos(h.rot), s = Math.sin(h.rot);
        for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const px = x + c * (a * w / 2) + s * (b * dd / 2), pz = z - s * (a * w / 2) + c * (b * dd / 2);
          kit.put('pole', px, y + ph / 2, pz, 0, 0.08, ph, 0.08, C.timber);
          kit.solidBox(px, y + ph / 2, pz, 0, 0.05, ph / 2, 0.05);
        }
        kit.put('cloth', x, y + ph + 0.03, z, h.rot, w + 0.3, 0.06, dd + 0.3, vary(C.reed, ctx.u(`shc:${h.id}`), 0.08));
        n++;
      }
    } else if (r1 < 0.42) {
      // sleeping mats and a jar
      const [x, z] = at((ctx.u(`mt:${h.id}`) - 0.5) * 0.8, (ctx.u(`mt2:${h.id}`) - 0.5) * 0.8);
      if (keep(x, z)) {
        const own = houseOwner(ctx, i);
        kit.owner = own;
        const mc = vary(CLOTHS[Math.floor(ctx.u(`mc:${h.id}`) * 6)], ctx.u(`mv:${h.id}`), 0.08);
        const myaw = h.rot + 0.1 * (ctx.u(`mr:${h.id}`) - 0.5);
        kit.put('cloth', x, y + 0.03, z, myaw, 1.9, 0.04, 0.85, mc);
        ctx.intents.push({ k: 'mat', owner: own, x, y, z, yaw: myaw, c: mc });
        const [jx, jz] = at((ctx.u(`mj:${h.id}`) - 0.5) * 1.6, 0.85);
        if (keep(jx, jz)) {
          kit.put('jar', jx, y + 0.42, jz, 0, 0.6, 0.84, 0.6, C.clay);
          ctx.intents.push({ k: 'jar', owner: own, x: jx, y, z: jz, yaw: ctx.u(`mjy:${h.id}`) * TAU, r: 0.3, h: 0.84 });
          kit.solidBox(jx, y + 0.42, jz, 0, 0.24, 0.42, 0.24);
        }
        kit.owner = -1;
        n++;
      }
    } else if (r1 < 0.55) {
      // a domed bread oven
      const [x, z] = at((ctx.u(`ov:${h.id}`) - 0.5) * 1.4, (ctx.u(`ov2:${h.id}`) - 0.5) * 1.4);
      if (keep(x, z)) {
        kit.owner = houseOwner(ctx, i);
        kit.put('ball', x, y + 0.32, z, 0, 1.0, 0.8, 1.0, shade(h.wall, 0.82));
        ctx.intents.push({ k: 'oven', owner: kit.owner, x, y, z, yaw: h.rot + ctx.u(`ovy:${h.id}`) * TAU });
        kit.owner = -1;
        kit.solidBox(x, y + 0.3, z, 0, 0.42, 0.3, 0.42);
        n++;
      }
    } else if (r1 < 0.64) {
      // grain spread to dry
      const [x, z] = at((ctx.u(`gr:${h.id}`) - 0.5) * 0.7, (ctx.u(`gr2:${h.id}`) - 0.5) * 0.7);
      if (keep(x, z)) {
        kit.owner = houseOwner(ctx, i);
        kit.put('cloth', x, y + 0.025, z, h.rot, 2.4, 0.03, 1.6, vary(C.grain, ctx.u(`grc:${h.id}`), 0.06));
        ctx.intents.push({ k: 'grain', owner: kit.owner, x, y, z, yaw: h.rot, w: 2.4, d: 1.6 });
        kit.owner = -1;
        n++;
      }
    }
  });
  return n;
}

/** Parapets round the flat roofs, open where a ladder, stair or plank arrives. */
export function parapets(ctx: Ctx) {
  const { kit } = ctx;
  let n = 0;
  ctx.plan.houses.forEach((h, i) => {
    if (h.kind !== 'house' || !h.flat) return;
    const d = ctx.dress[i];
    if (ctx.u(`par:${h.id}`) > (d.role ? 1 : 0.78)) return;
    const ph = 0.26 + 0.14 * ctx.u(`parh:${h.id}`);
    d.parapet = ph;
    // as thick as the kit's parapet pieces (0.26 m), which redraw it in the hero district, its face on the slab's edge
    const th = 0.26;
    kit.owner = houseOwner(ctx, i);
    const col = shade(h.wall, 1.02);
    // the roof slab's edge, inset by half the parapet's thickness
    const slab: Rect = { x: h.x, z: h.z, rot: h.rot, hw: h.rhw - th / 2, hd: h.rhd - th / 2 };
    for (const s of sides(slab)) {
      // runs between gaps along this side
      const gs = d.gaps.filter((g) => g.k === s.k).map((g) => [g.t - g.w / 2, g.t + g.w / 2] as [number, number]).sort((a, b) => a[0] - b[0]);
      let t = -s.half - th / 2;
      const end = s.half + th / 2;
      const runs: [number, number][] = [];
      for (const [a, b] of gs) { if (a > t) runs.push([t, Math.min(a, end)]); t = Math.max(t, b); }
      if (t < end) runs.push([t, end]);
      for (const [a, b] of runs) {
        if (b - a < 0.25) continue;
        const pa = new Vector3(...onSide3(s, a, 0, h.roof + ph / 2)), pb = new Vector3(...onSide3(s, b, 0, h.roof + ph / 2));
        kit.beam('mud', pa, pb, th, ph, col, true);
        ctx.intents.push({ k: 'parapet', owner: kit.owner, house: i, side: { ...s }, a, b, h: ph, th, roof: h.roof });
        n++;
      }
    }
    kit.owner = -1;
  });
  return n;
}
