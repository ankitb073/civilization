// Streets world: houses burnt in a sack, at street level. The city model draws each as an ash slab and two black
// boxes, which reads well from above and as black boxes up close. Here (in this scene only) each becomes a shell:
// its own four walls broken to jagged heights, the mud bricks baked red by the fire and blackened toward the top,
// a gap where the door was, an ash floor heaped with fallen brick, roof beams burnt through (some fallen, some still
// leaning on the walls), and embers in the ash while the fire is fresh. Walls, rubble and beams all collide.

import { Vector3 } from 'three';
import { C, type Ctx, onSide } from './ctx.ts';
import { sides } from './plan.ts';
import { mix, vary, type RGB } from '../../../three/city/style.ts';

const MUD: RGB = [0.78, 0.64, 0.47];
const BAKED: RGB = [0.62, 0.37, 0.25];
const CHAR: RGB = [0.16, 0.14, 0.13];
const ASH: RGB = [0.33, 0.31, 0.29];

export function burntHouses(ctx: Ctx, fresh: boolean): number {
  const { kit } = ctx;
  let n = 0;
  ctx.plan.houses.forEach((h) => {
    if (h.kind !== 'burnt') return;
    n++;
    const g = h.ground;
    const T = 0.42;
    const top = Math.max(2.6, h.top);
    const mud = vary(MUD, h.h3, 0.08);
    const ss = sides({ ...h, hw: h.hw - T / 2, hd: h.hd - T / 2 });
    // the doorway: on the side facing the most open ground
    let doorK = 0, best = -1;
    for (const s of ss) {
      let open = 0;
      for (let d = 1; d <= 8; d += 1) { const [x, z] = onSide(s, 0, d + T / 2); if (ctx.occ.blocked(x, z, 0.3, g + 0.2, g + 2)) break; open = d; }
      if (open > best) { best = open; doorK = s.k; }
    }
    for (const s of ss) {
      const len = s.half * 2 + T;
      const segs = Math.max(4, Math.round(len / 0.9));
      const sl = len / segs;
      let prev = 0.7;
      // colliders: one per two pieces of wall (the taller), so a burnt quarter does not double the physics
      let pend: { t: number; hh: number } | null = null;
      const flush = (t1: number, h1: number) => {
        if (!pend) return;
        const tm = (pend.t + t1) / 2, hh = Math.max(pend.hh, h1);
        const [cx, cz] = onSide(s, tm, 0);
        const len = Math.abs(t1 - pend.t) + sl;
        kit.solidBox(cx, g + hh / 2, cz, Math.atan2(-s.tz, s.tx), len / 2, hh / 2, T / 2);
        ctx.occ.add({ x: cx, z: cz, rot: Math.atan2(-s.tz, s.tx), hw: len / 2, hd: T / 2 }, g, g + hh);
        pend = null;
      };
      for (let j = 0; j < segs; j++) {
        const t = -len / 2 + (j + 0.5) * sl;
        const r = ctx.u(`bw:${h.id}:${s.k}:${j}`);
        const door = s.k === doorK && Math.abs(t) < 0.75;
        // jagged: each piece near its neighbour's height, some fallen to a stub
        let k = door ? 0.06 : r < 0.18 ? 0.08 + 0.12 * r : Math.min(0.82, Math.max(0.26, prev + (r - 0.5) * 0.5));
        if (!door && r >= 0.16) prev = k;
        const hh = top * k;
        const [x, z] = onSide(s, t, 0);
        const yaw = Math.atan2(-s.tz, s.tx);
        if (hh < 0.15) { if (pend) flush(pend.t, pend.hh); continue; }
        // baked below, charred above (and blackest at the broken top)
        // the fire blackened some stretches far down, others hardly at all
        const r2 = ctx.u(`bl:${h.id}:${s.k}:${j}`);
        const low = hh * (r2 < 0.3 ? 0.92 : r2 < 0.7 ? 0.6 + 0.2 * r2 : 0.25 + 0.2 * r2);
        kit.put('mud', x, g + low / 2, z, yaw, sl + 0.02, low, T, mix(mud, BAKED, 0.3 + 0.35 * r));
        kit.put('mud', x, g + low + (hh - low) / 2, z, yaw, sl + 0.02, hh - low, T, mix(mix(mud, BAKED, 0.45), CHAR, 0.26 + 0.24 * r));
        kit.put('mud', x, g + hh + 0.03, z, yaw, sl * (0.5 + 0.5 * r), 0.06, T + 0.03, mix(CHAR, ASH, 0.3));
        if (pend) flush(t, hh); else pend = { t, hh };
      }
      if (pend) { const p0 = pend as { t: number; hh: number }; flush(p0.t, p0.hh); }
    }
    // the floor: ash, heaped brick, burnt beams
    kit.put('cloth', h.x, g + 0.04, h.z, h.rot, h.hw * 2 - T * 2, 0.08, h.hd * 2 - T * 2, ASH);
    const c = Math.cos(h.rot), s = Math.sin(h.rot);
    const L = (u: number, v: number): [number, number] => [h.x + c * u + s * v, h.z - s * u + c * v];
    for (let k = 0; k < 3; k++) {
      const [x, z] = L((ctx.u(`rb:${h.id}:${k}`) - 0.5) * (h.hw - 1.2) * 1.6, (ctx.u(`rb2:${h.id}:${k}`) - 0.5) * (h.hd - 1.2) * 1.6);
      const w = 1.4 + ctx.u(`rbs:${h.id}:${k}`) * 1.4, ht = 0.45 + ctx.u(`rbh:${h.id}:${k}`) * 0.5;
      kit.put('rock', x, g + ht * 0.35, z, k * 1.7, w, ht, w * 0.8, mix(mud, ASH, 0.35 + 0.15 * k));
      kit.solidBox(x, g + ht * 0.3, z, k * 1.7, w * 0.3, ht * 0.3, w * 0.25);
    }
    const nb = 3 + Math.floor(ctx.u(`bb:${h.id}`) * 3);
    for (let k = 0; k < nb; k++) {
      const r = ctx.u(`bm:${h.id}:${k}`);
      const v0 = (ctx.u(`bv:${h.id}:${k}`) - 0.5) * (h.hd - 0.8) * 1.6;
      if (r < 0.45) {
        // still resting on one wall, its other end down in the ash
        const sg = r < 0.22 ? 1 : -1;
        const [ax, az] = L(sg * (h.hw - T), v0);
        const [bx, bz] = L(-sg * (h.hw * 0.25), v0 + (r - 0.22) * 2);
        const a = new Vector3(ax, g + top * (0.45 + 0.3 * r), az), b = new Vector3(bx, g + 0.15, bz);
        kit.beam('wood', a, b, 0.2, 0.2, vary(CHAR, r, 0.2), true);
      } else {
        // fallen flat, across the floor
        const [ax, az] = L(-(h.hw - 0.8), v0), [bx, bz] = L(h.hw - 0.8, v0 + (r - 0.7) * 2.5);
        kit.beam('wood', new Vector3(ax, g + 0.2 + 0.1 * k, az), new Vector3(bx, g + 0.14, bz), 0.2, 0.2, vary(CHAR, r, 0.2), true);
      }
    }
    if (fresh) {
      for (let k = 0; k < 4; k++) {
        const [x, z] = L((ctx.u(`em:${h.id}:${k}`) - 0.5) * (h.hw - 1), (ctx.u(`em2:${h.id}:${k}`) - 0.5) * (h.hd - 1));
        kit.put('rock', x, g + 0.1, z, k, 0.35, 0.12, 0.3, k % 2 ? C.saffron : [0.93, 0.42, 0.12]);
      }
    }
  });
  return n;
}
