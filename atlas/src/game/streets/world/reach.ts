// Streets world: ladders, and which roofs a runner can reach. Roofs are nodes; a running jump links two roofs when
// the gap is at most JUMP metres and the far roof (with its parapet) is no more than UP metres higher; planks link
// both ways; stairs and ladders link the street to a roof. Ladders are added where they open the most roofs not yet
// reached, until nearly all are, then spread so no part of town is far from a way up. The jump numbers are
// conservative against step 1's measured running jump (1.18 m high, about 3.5 m long): no ledge-grabbing assumed.

import { Vector3 } from 'three';
import type { Ladder } from '../affordances.ts';
import { C, type Ctx, onSide } from './ctx.ts';
import { beamQuat } from './kit.ts';
import { type Side, gapBetween, inside, sides } from './plan.ts';
import type { PlankRec } from './houses.ts';
import { vary } from '../../../three/city/style.ts';

export const JUMP = 2.0;
export const UP = 0.95;

/** A ladder leaning on a wall at offset t along side s: foot `out` metres from the wall at height gBase, resting on
 *  the wall's top at yTop. Draws it, gives it a collider, returns the affordance. */
export function ladderAt(ctx: Ctx, s: Side, t: number, gBase: number, yTop: number, out = 0.8, label = ''): Ladder {
  const { kit } = ctx;
  const n = new Vector3(s.nx, 0, s.nz);
  const tan = new Vector3(s.tx, 0, s.tz);
  const [wx, wz] = onSide(s, t, 0);
  const [fx, fz] = onSide(s, t, out);
  const F = new Vector3(fx, gBase, fz);
  const E = new Vector3(wx, yTop, wz);
  const dir = E.clone().sub(F).normalize();
  const T = E.clone().addScaledVector(dir, 0.85);
  const col = vary(C.wood, ctx.u(`lad:${label}:${s.x.toFixed(1)}`), 0.1);
  for (const sg of [-1, 1]) {
    const o = tan.clone().multiplyScalar(0.24 * sg);
    kit.beam('wood', F.clone().add(o), T.clone().add(o), 0.07, 0.07, col, false, n);
  }
  const q = beamQuat(F, T, n);
  const len = F.distanceTo(T);
  for (let d = 0.28; d < len - 0.08; d += 0.3) {
    kit.putQ('wood', F.clone().addScaledVector(dir, d), q, new Vector3(0.5, 0.045, 0.045), col);
  }
  // the collider: a slab along the ladder, a little back from the rungs' face
  kit.solidBeam(F.clone().addScaledVector(n, -0.04), T.clone().addScaledVector(n, -0.04), 0.6, 0.1, n);
  ctx.occ.add({ x: fx, z: fz, rot: Math.atan2(-s.tz, s.tx), hw: 0.35, hd: 0.25 }, gBase, yTop);
  const [bx, bz] = onSide(s, t, out + 0.45);
  const [tx, tz] = onSide(s, t, -0.45);
  return { base: new Vector3(bx, gBase, bz), top: new Vector3(tx, yTop, tz), facing: n };
}

export interface Reach {
  ladders: Ladder[];
  /** Roofs (houses with flat roofs) and how many a runner can reach from the street. */
  roofs: number; reached: number; reachedNoLadders: number;
  /** Upper rooms reached by their own ladders. */
  uppers: number; uppersReached: number;
  /** Gap widths between neighbouring roofs (m): how many in each band. */
  gaps: Record<string, number>;
  /** Roof indices reached (into plan.houses). */
  reachedSet: Set<number>;
}

/** Find a spot for a ladder up house i from the street (or courtyard); returns the ladder or null. */
function placeLadder(ctx: Ctx, i: number, salt = ''): Ladder | null {
  const h = ctx.plan.houses[i];
  const d = ctx.dress[i];
  const opts = ctx.sides[i]
    .filter((s) => s.open >= 1.9)
    .map((s) => ({ s, score: (s.court ? 0.4 : 1) + ctx.u(`ls:${h.id}:${s.k}${salt}`) * 0.6 }))
    .sort((a, b) => b.score - a.score);
  for (const { s } of opts) {
    for (let k = 0; k < 4; k++) {
      const t = (ctx.u(`lt:${h.id}:${s.k}:${k}${salt}`) * 2 - 1) * Math.max(0, s.half - 0.75);
      if (d.door && d.door.k === s.k && Math.abs(t - d.door.t) < 1.35) continue;
      if (d.gaps.some((g) => g.k === s.k && Math.abs(g.t - t) < 1.2)) continue;
      const [cx, cz] = onSide(s, t, 0.85);
      const rect = { x: cx, z: cz, rot: Math.atan2(-s.tz, s.tx), hw: 0.42, hd: 0.75 };
      if (!ctx.occ.clear(rect, 0.05, h.ground + 0.1, h.ground + 2.2)) continue;
      if (ctx.water(cx, cz) > 0) continue;
      const lad = ladderAt(ctx, s, t, ctx.ground(cx, cz), h.roof, 0.8, `${h.id}`);
      d.gaps.push({ k: s.k, t, w: 1.2 });
      d.access ??= 'ladder';
      return lad;
    }
  }
  return null;
}

export function laddersAndReach(ctx: Ctx, planks: PlankRec[], near: (i: number, r: number) => number[], must: number[]): Reach {
  const H = ctx.plan.houses;
  const flat = H.map((h) => h.kind === 'house' && h.flat);
  // edges between roofs
  const out: number[][] = H.map(() => []);
  const gaps: Record<string, number> = { '<0.5': 0, '0.5–1': 0, '1–1.5': 0, '1.5–2': 0, '2–3': 0, '3–8': 0, '8–12': 0 };
  const seen = new Set<string>();
  H.forEach((A, a) => {
    if (!flat[a]) return;
    for (const b of near(a, 16)) {
      if (!flat[b]) continue;
      const B = H[b];
      const gap = gapBetween(A, B);
      const k = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!seen.has(k) && gap < 12) {
        seen.add(k);
        const band = gap < 0.5 ? '<0.5' : gap < 1 ? '0.5–1' : gap < 1.5 ? '1–1.5' : gap < 2 ? '1.5–2' : gap < 3 ? '2–3' : gap < 8 ? '3–8' : '8–12';
        // only nearest neighbours count for the bands (a roof across a block is not a gap)
        if (gap < 3 || facingPair(ctx, a, b)) gaps[band]++;
      }
      if (gap > JUMP) continue;
      const up = B.roof + (ctx.dress[b].parapet || 0.3) - A.roof;
      if (up <= UP) out[a].push(b);
    }
  });
  for (const p of planks) { out[p.a].push(p.b); out[p.b].push(p.a); }
  const bfs = (starts: Iterable<number>): Set<number> => {
    const r = new Set<number>();
    const q: number[] = [];
    for (const s of starts) if (flat[s] && !r.has(s)) { r.add(s); q.push(s); }
    while (q.length) { const a = q.pop()!; for (const b of out[a]) if (!r.has(b)) { r.add(b); q.push(b); } }
    return r;
  };
  const access = new Set<number>();
  H.forEach((_, i) => { if (ctx.dress[i].access) access.add(i); });
  const reachedNoLadders = bfs(access).size;
  const ladders: Ladder[] = [];
  const add = (i: number, salt = '') => {
    const l = placeLadder(ctx, i, salt);
    if (l) { ladders.push(l); access.add(i); }
    return !!l;
  };
  // the places that must have a way up
  for (const i of must) if (flat[i] && !ctx.dress[i].access) add(i);
  let reached = bfs(access);
  const roofs = flat.filter(Boolean).length;
  const failed = new Set<number>();
  // greedy: the ladder that opens the most roofs not yet reached
  for (let guard = 0; guard < 400 && reached.size < roofs * 0.985; guard++) {
    let best = -1, gain = 0;
    H.forEach((_, i) => {
      if (!flat[i] || reached.has(i) || failed.has(i)) return;
      let g = 0;
      for (const j of bfs([i])) if (!reached.has(j)) g++;
      g += ctx.u(`lg:${i}`) * 0.5;
      if (g > gain) { gain = g; best = i; }
    });
    if (best < 0) break;
    if (!add(best)) { failed.add(best); continue; }
    reached = bfs(access);
  }
  // spread: no roof more than ~38 m from a way up
  const pts = () => [...access].map((i) => H[i]);
  const order = H.map((_, i) => i).filter((i) => flat[i]).sort((a, b) => ctx.u(`sp:${a}`) - ctx.u(`sp:${b}`));
  let ways = pts();
  for (const i of order) {
    const h = H[i];
    if (ways.some((w) => Math.hypot(w.x - h.x, w.z - h.z) < 38)) continue;
    if (add(i, ':s')) ways = pts();
  }
  reached = bfs(access);
  // upper rooms: a short ladder from the roof on some of them
  let uppers = 0, uppersReached = 0;
  H.forEach((h, i) => {
    if (!flat[i] || !h.upper) return;
    uppers++;
    if (!reached.has(i) || ctx.u(`up:${h.id}`) > 0.55) return;
    const U = h.upper;
    for (const s of sides(U)) {
      const [x, z] = onSide(s, 0, 1.2);
      if (!inside(h, x, z, -0.5)) continue;
      ladders.push(ladderAt(ctx, s, (ctx.u(`upt:${h.id}`) - 0.5) * Math.max(0, s.half - 0.6), h.roof, U.roof, 0.6, `u${h.id}`));
      uppersReached++;
      break;
    }
  });
  return { ladders, roofs, reached: reached.size, reachedNoLadders, uppers, uppersReached, gaps, reachedSet: reached };
}

function facingPair(ctx: Ctx, a: number, b: number): boolean {
  const A = ctx.plan.houses[a], B = ctx.plan.houses[b];
  const dx = B.x - A.x, dz = B.z - A.z, l = Math.hypot(dx, dz) || 1;
  // a lane between them: their centres line up with one of A's axes
  const c = Math.cos(A.rot), s = Math.sin(A.rot);
  const ax = Math.abs((dx * c - dz * s) / l), az = Math.abs((dx * s + dz * c) / l);
  return Math.max(ax, az) > 0.97;
}
