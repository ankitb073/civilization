// Streets world: the city's plan at walking scale, read from what the city model drew (its instanced parts), never
// re-derived, so the streets always stand on the same footprints as #/city/set:N at that year. Units are metres
// (x east, z south, y up). Also: a 2-D occupancy grid of everything solid near the ground, for placing detail, and a
// fast ground-height grid rasterised from the model's ground mesh.

import { type InstancedMesh, type Group, Matrix4, Vector3 } from 'three';
import type { CityModel } from '../../../three/city/model.ts';
import type { Layout } from '../../../three/city/layout.ts';
import { layoutOf, riverDist } from '../../../three/city/layout.ts';
import type { Solid } from '../world.ts';

export type RGB = [number, number, number];

/** A rectangle on the ground: centre, yaw (as the city's parts: local x → (cos, −sin), local z → (sin, cos)) and half
 *  extents along its local x and z. */
export interface Rect { x: number; z: number; rot: number; hw: number; hd: number }

export interface House extends Rect {
  /** Slot index in the layout (stable for the city). */
  id: number;
  kind: 'house' | 'hut' | 'burnt';
  /** A flat roof (a slab on the walls) a runner can walk on; other ages' houses carry gables, hips and spires. */
  flat: boolean;
  /** Wall top (m); the roof surface is `roof` (the top of the roof slab). */
  top: number;
  roof: number;
  /** The roof slab's half extents (a little over the walls). */
  rhw: number; rhd: number;
  wall: RGB; roofC: RGB;
  /** A room on the roof (a second storey), its own roof surface at `roof`. */
  upper: (Rect & { top: number; roof: number }) | null;
  /** Ground height at the centre (m). */
  ground: number;
  /** Distance from the temple square's centre (m) and bearing (radians). */
  r: number; ang: number;
  /** Hashes 0..1 of the lot (from the layout). */
  h1: number; h2: number; h3: number;
  /** A burnt house: the model's parts for it (ash, charred walls, embers), which the streets redraw. */
  burntParts?: DrawnPart[];
  /** The model's own parts for it (the body, the roof slab, the room on the roof), which the hero district redraws. */
  parts?: DrawnPart[];
}

/** A side of a rectangle: its midpoint, outward normal, the unit vector along it and half its length. */
export interface Side { x: number; z: number; nx: number; nz: number; tx: number; tz: number; half: number; k: number }

export function axes(r: Rect): { ax: number; az: number; bx: number; bz: number } {
  const c = Math.cos(r.rot), s = Math.sin(r.rot);
  return { ax: c, az: -s, bx: s, bz: c };
}

/** The four sides: k 0 +x, 1 −x, 2 +z, 3 −z (local). */
export function sides(r: Rect): Side[] {
  const { ax, az, bx, bz } = axes(r);
  return [
    { x: r.x + ax * r.hw, z: r.z + az * r.hw, nx: ax, nz: az, tx: bx, tz: bz, half: r.hd, k: 0 },
    { x: r.x - ax * r.hw, z: r.z - az * r.hw, nx: -ax, nz: -az, tx: -bx, tz: -bz, half: r.hd, k: 1 },
    { x: r.x + bx * r.hd, z: r.z + bz * r.hd, nx: bx, nz: bz, tx: -ax, tz: -az, half: r.hw, k: 2 },
    { x: r.x - bx * r.hd, z: r.z - bz * r.hd, nx: -bx, nz: -bz, tx: ax, tz: az, half: r.hw, k: 3 },
  ];
}

export function corners(r: Rect): [number, number][] {
  const { ax, az, bx, bz } = axes(r);
  const out: [number, number][] = [];
  for (const [u, v] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) out.push([r.x + ax * r.hw * u + bx * r.hd * v, r.z + az * r.hw * u + bz * r.hd * v]);
  return out;
}

/** Is (x, z) inside the rectangle grown by m? */
export function inside(r: Rect, x: number, z: number, m = 0): boolean {
  const { ax, az, bx, bz } = axes(r);
  const dx = x - r.x, dz = z - r.z;
  return Math.abs(dx * ax + dz * az) <= r.hw + m && Math.abs(dx * bx + dz * bz) <= r.hd + m;
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}

/** The gap between two rectangles (0 when they touch or overlap). */
export function gapBetween(a: Rect, b: Rect): number {
  const ca = corners(a), cb = corners(b);
  if (ca.some(([x, z]) => inside(b, x, z)) || cb.some(([x, z]) => inside(a, x, z))) return 0;
  let d = Infinity;
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = ca[i], [x1, z1] = ca[(i + 1) % 4];
    for (const [px, pz] of cb) d = Math.min(d, segDist(px, pz, x0, z0, x1, z1));
  }
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = cb[i], [x1, z1] = cb[(i + 1) % 4];
    for (const [px, pz] of ca) d = Math.min(d, segDist(px, pz, x0, z0, x1, z1));
  }
  return d;
}

// ---------------------------------------------------------------- reading the model's parts

export interface DrawnPart { x: number; y: number; z: number; rot: number; sx: number; sy: number; sz: number; c: RGB; mesh: InstancedMesh; i: number; orig?: Float32Array }

const gamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Every part of one kind the model drew, in lots (its own frame), with its colour back in sRGB. */
export function drawnParts(group: Group, type: string): DrawnPart[] {
  const out: DrawnPart[] = [];
  group.traverse((o) => {
    const im = o as InstancedMesh;
    if (!im.isInstancedMesh || im.geometry.type !== type || !im.visible) return;
    const e = im.instanceMatrix.array as Float32Array;
    const c = im.instanceColor?.array as Float32Array | undefined;
    for (let i = 0; i < im.count; i++) {
      const o16 = i * 16;
      const sx = Math.hypot(e[o16], e[o16 + 2]), sz = Math.hypot(e[o16 + 8], e[o16 + 10]);
      out.push({
        x: e[o16 + 12], y: e[o16 + 13], z: e[o16 + 14], rot: Math.atan2(-e[o16 + 2], e[o16]), sx, sy: e[o16 + 5], sz,
        c: c ? [gamma(c[3 * i]), gamma(c[3 * i + 1]), gamma(c[3 * i + 2])] : [1, 1, 1], mesh: im, i,
      });
    }
  });
  return out;
}

/** Hide one drawn part in this model's copy (scale it to nothing). */
export function hidePart(p: DrawnPart) {
  const e = p.mesh.instanceMatrix.array as Float32Array;
  p.orig ??= e.slice(p.i * 16, p.i * 16 + 16);
  new Matrix4().makeScale(0, 0, 0).setPosition(p.x, p.y, p.z).toArray(e, p.i * 16);
  p.mesh.instanceMatrix.needsUpdate = true;
}

/** Shrink one drawn part a little toward its own axis and base (by `m` metres a side at `lot` metres per unit), so
 *  something drawn on its faces does not fight it; or put it back as the model drew it (m = 0). */
export function shrinkPart(p: DrawnPart, m: number, lot: number) {
  const e = p.mesh.instanceMatrix.array as Float32Array;
  p.orig ??= e.slice(p.i * 16, p.i * 16 + 16);
  const o = p.orig;
  if (m <= 0) { e.set(o, p.i * 16); p.mesh.instanceMatrix.needsUpdate = true; return; }
  const k = (s: number) => Math.max(0, 1 - (2 * m) / Math.max(1e-6, s * lot));
  const kx = k(p.sx), kz = k(p.sz), ky = Math.max(0, 1 - m / Math.max(1e-6, p.sy * lot));
  const M = new Matrix4().fromArray(o).multiply(new Matrix4().makeScale(kx, ky, kz));
  M.toArray(e, p.i * 16);
  p.mesh.instanceMatrix.needsUpdate = true;
}

/** Every part the model drew, of any shape, in lots. */
export function allParts(group: Group): DrawnPart[] {
  const types = new Set<string>();
  group.traverse((o) => { const im = o as InstancedMesh; if (im.isInstancedMesh) types.add(im.geometry.type); });
  return [...types].flatMap((t) => drawnParts(group, t));
}

export interface WallPlan {
  /** Ring radius (m), height of the walk (m), thickness (m). */
  R: number; H: number; T: number;
  /** Straight runs of wall between posts (chords), standing (not breached, not over water, not a gate). */
  runs: { x0: number; z0: number; x1: number; z1: number; part: DrawnPart }[];
  towers: { x: number; z: number; half: number; top: number; part: DrawnPart }[];
  /** Openings where a main road passes: the angle and the two posts' points. */
  gates: { ang: number; x: number; z: number; road: number }[];
  crenels: DrawnPart[];
}

export interface Plan {
  LOT: number;
  L: Layout;
  houses: House[];
  walls: WallPlan | null;
  /** The temple's podium (m), its top, and the palace's platform and gate. */
  temple: (Rect & { top: number; form: string }) | null;
  palace: (Rect & { top: number; gate: { x: number; z: number; nx: number; nz: number }; hall: Rect & { top: number } }) | null;
  /** Main roads: angle; the plaza radius (m). */
  roads: number[];
  plazaR: number;
  /** Ring roads (m). */
  rings: number[];
  /** Bridge decks over the river: their rectangles (long axis local x) and top surface (m). */
  bridges: (Rect & { top: number })[];
}

/** Read the plan from the model at its year (the model's group in lots; LOT metres each). */
export function readPlan(model: CityModel, LOT: number, heightAt: (x: number, z: number) => number): Plan {
  const L = layoutOf(model.rec);
  const cy = model.cy!;
  const boxes = drawnParts(model.group, 'BoxGeometry');
  const domes = drawnParts(model.group, 'SphereGeometry');
  // index box parts by their position (lots, 1e-3)
  const key = (x: number, z: number) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
  const at = new Map<string, DrawnPart[]>();
  for (const b of boxes) {
    const k = key(b.x, b.z);
    const l = at.get(k);
    if (l) l.push(b); else at.set(k, [b]);
  }
  const domeAt = new Set(domes.map((d) => key(d.x, d.z)));
  const houses: House[] = [];
  const n = cy.phase === 'living' ? cy.n : 0;
  for (let i = 0; i < n && i < L.slots.length; i++) {
    const s = L.slots[i];
    if (s.r > model.P - 0.9) continue;
    const here = at.get(key(s.x, s.z)) ?? [];
    const body = here.filter((p) => Math.abs(p.y) < 1e-4).sort((a, b) => b.sy - a.sy)[0];
    const base = { id: i, x: s.x * LOT, z: s.z * LOT, rot: s.rot, r: s.r * LOT, ang: s.ang, h1: s.h1, h2: s.h2, h3: s.h3 };
    if (domeAt.has(key(s.x, s.z))) {
      const d = domes.find((p) => key(p.x, p.z) === key(s.x, s.z))!;
      houses.push({ ...base, kind: 'hut', flat: false, hw: (d.sx * LOT) / 2, hd: (d.sz * LOT) / 2, top: d.sy * LOT, roof: d.sy * LOT, rhw: 0, rhd: 0, wall: d.c, roofC: d.c, upper: null, ground: heightAt(base.x, base.z) });
      continue;
    }
    if (!body) continue;
    if (body.sy < 0.1) {
      // a burnt shell: the ash slab gives the footprint; the charred walls stand beside it (the taller is the
      // model's hb = h × (0.4 + 0.45 h1), which gives back the house's height)
      const parts = boxes.filter((p) => p.y < 0.1 && Math.hypot(p.x - s.x, p.z - s.z) < Math.max(body.sx, body.sz) * 0.62);
      const wall = parts.filter((p) => p.sy > 0.1).sort((a, b) => b.sy - a.sy)[0];
      const top = wall ? (wall.sy / (0.4 + 0.45 * s.h1)) * LOT : 4;
      houses.push({ ...base, kind: 'burnt', flat: false, hw: (body.sx * LOT) / 2, hd: (body.sz * LOT) / 2, top, roof: 0, rhw: 0, rhd: 0, wall: body.c, roofC: body.c, upper: null, ground: heightAt(base.x, base.z), burntParts: parts });
      continue;
    }
    const h = body.sy;
    const slab = (at.get(key(s.x, s.z)) ?? []).find((p) => Math.abs(p.y - h) < 1e-4 && p.sy < 0.1);
    const upperP = (at.get(key(s.x - 0.08, s.z - 0.06)) ?? []).find((p) => Math.abs(p.y - h) < 1e-4 && p.sy > 0.1);
    const roof = slab ? (h + slab.sy) * LOT : h * LOT;
    houses.push({
      ...base, kind: 'house', flat: !!slab, hw: (body.sx * LOT) / 2, hd: (body.sz * LOT) / 2, top: h * LOT, roof,
      parts: [body, ...(slab ? [slab] : []), ...(upperP ? [upperP] : [])],
      rhw: slab ? (slab.sx * LOT) / 2 : (body.sx * LOT) / 2, rhd: slab ? (slab.sz * LOT) / 2 : (body.sz * LOT) / 2,
      wall: body.c, roofC: slab?.c ?? body.c,
      upper: upperP ? {
        x: upperP.x * LOT, z: upperP.z * LOT, rot: upperP.rot, hw: (upperP.sx * LOT) / 2, hd: (upperP.sz * LOT) / 2,
        top: (h + upperP.sy) * LOT, roof: (h + upperP.sy) * LOT,
      } : null,
      ground: heightAt(base.x, base.z),
    });
  }

  // ---- walls: the ring from the walls anchor; runs, towers and crenels read from the parts on it
  let walls: WallPlan | null = null;
  const wa = model.anchors.find((a) => a.key === 'walls');
  if (wa && cy.walls) {
    const R = Math.hypot(wa.x, wa.z);
    const H = wa.y - 0.6;
    const onRing = boxes.filter((b) => Math.abs(Math.hypot(b.x, b.z) - R * Math.cos(Math.PI / Math.max(16, Math.ceil((2 * Math.PI * R) / 1.5)))) < 0.6 || Math.abs(Math.hypot(b.x, b.z) - R) < 0.6);
    const runs: WallPlan['runs'] = [], towers: WallPlan['towers'] = [], crenels: DrawnPart[] = [];
    let T = 0.42;
    for (const b of onRing) {
      if (b.y > H - 1e-3 && b.sy < 0.2 && b.sx < 0.25) { crenels.push(b); continue; }
      if (b.y > 1e-3) continue;
      if (b.sx > 1.0 && b.sy > H * 0.9 && b.sz < 0.8) {
        // a run of wall (a span: length along its local x)
        T = b.sz;
        const c = Math.cos(b.rot), s = -Math.sin(b.rot);
        runs.push({ x0: (b.x - (c * b.sx) / 2) * LOT, z0: (b.z - (s * b.sx) / 2) * LOT, x1: (b.x + (c * b.sx) / 2) * LOT, z1: (b.z + (s * b.sx) / 2) * LOT, part: b });
      } else if (Math.abs(b.sx - b.sz) < 1e-3 && b.sx > 0.5 && b.sy > H) {
        towers.push({ x: b.x * LOT, z: b.z * LOT, half: (b.sx * LOT) / 2, top: b.sy * LOT, part: b });
      }
    }
    const gates: WallPlan['gates'] = [];
    for (let ri = 0; ri < L.roads.length; ri++) {
      const a = L.roads[ri];
      const x = Math.cos(a) * R * LOT, z = Math.sin(a) * R * LOT;
      // a gate where no run of wall crosses the road
      const blocked = runs.some((w) => segDist(x, z, w.x0, w.z0, w.x1, w.z1) < 2);
      if (!blocked) gates.push({ ang: a, x, z, road: ri });
    }
    walls = { R: R * LOT, H: H * LOT, T: T * LOT, runs, towers, gates, crenels };
  }

  // ---- the temple's podium: the widest box at the square's centre on the ground
  let temple: Plan['temple'] = null;
  const pod = boxes.filter((b) => Math.abs(b.y) < 1e-4 && Math.hypot(b.x, b.z) < L.plazaR * 0.6).sort((a, b) => b.sx * b.sz - a.sx * a.sz)[0];
  if (pod) temple = { x: pod.x * LOT, z: pod.z * LOT, rot: pod.rot, hw: (pod.sx * LOT) / 2, hd: (pod.sz * LOT) / 2, top: pod.sy * LOT, form: cy.form ?? 'shrine' };

  // ---- the palace: its platform (the widest box at the site), its hall and the gate between the front towers
  let palace: Plan['palace'] = null;
  const P = L.palace;
  if (P && cy.capital) {
    const near = boxes.filter((b) => Math.hypot(b.x - P.x, b.z - P.z) < P.w * 0.75);
    const plat = near.filter((b) => Math.abs(b.y) < 1e-4).sort((a, b) => b.sx * b.sz - a.sx * a.sz)[0];
    if (plat) {
      const top = plat.sy * LOT;
      const hall = near.filter((b) => Math.abs(b.y - plat.sy) < 1e-3 && b.sx > plat.sx * 0.4).sort((a, b) => b.sy - a.sy)[0];
      // the front faces the square (the palace's long axis runs out along the radius)
      const len = Math.hypot(P.x, P.z) || 1;
      const fx = -P.x / len, fz = -P.z / len;
      palace = {
        x: plat.x * LOT, z: plat.z * LOT, rot: plat.rot, hw: (plat.sx * LOT) / 2, hd: (plat.sz * LOT) / 2, top,
        gate: { x: plat.x * LOT + fx * (plat.sx * LOT) * 0.42, z: plat.z * LOT + fz * (plat.sx * LOT) * 0.42, nx: fx, nz: fz },
        hall: hall ? { x: hall.x * LOT, z: hall.z * LOT, rot: hall.rot, hw: (hall.sx * LOT) / 2, hd: (hall.sz * LOT) / 2, top: (hall.y + hall.sy) * LOT } : { x: plat.x * LOT, z: plat.z * LOT, rot: plat.rot, hw: 1, hd: 1, top },
      };
    }
  }
  // ---- bridges: long, low decks whose middle stands over the river
  const bridges: Plan['bridges'] = L.river ? boxes
    .filter((b) => b.sx > 2 && b.sy < 0.45 && b.y > -0.2 && b.y < 0.3 && riverDist(L, b.x, b.z).d < 0)
    .map((b) => ({ x: b.x * LOT, z: b.z * LOT, rot: b.rot, hw: (b.sx * LOT) / 2, hd: (b.sz * LOT) / 2, top: (b.y + b.sy) * LOT })) : [];
  return { LOT, L, houses, walls, temple, palace, roads: L.roads, plazaR: L.plazaR * LOT, rings: L.rings.map((r) => r * LOT), bridges };
}

// ---------------------------------------------------------------- occupancy: what stands near the ground

interface Occ { x: number; z: number; rot: number; hw: number; hd: number; y0: number; y1: number; tag: number }

/** A uniform grid of oriented rectangles (with a height range), for "is anything here?" while placing detail. */
export class Occupancy {
  private cell: number;
  private grid = new Map<number, Occ[]>();
  constructor(cell = 8) { this.cell = cell; }
  private k(ix: number, iz: number) { return (ix + 4096) * 8192 + (iz + 4096); }
  add(r: Rect, y0: number, y1: number, tag = 0) {
    const o: Occ = { ...r, x: r.x, z: r.z, y0, y1, tag };
    const R = Math.hypot(r.hw, r.hd);
    const c = this.cell;
    for (let ix = Math.floor((r.x - R) / c); ix <= Math.floor((r.x + R) / c); ix++) {
      for (let iz = Math.floor((r.z - R) / c); iz <= Math.floor((r.z + R) / c); iz++) {
        const k = this.k(ix, iz);
        const l = this.grid.get(k);
        if (l) l.push(o); else this.grid.set(k, [o]);
      }
    }
  }
  /** Add every solid (boxes as their rectangles; hulls as their bounding boxes). */
  addSolids(solids: Solid[], tag = 0) {
    for (const s of solids) {
      if (s.kind === 'box') {
        // only turns about the vertical are read here (the city's parts); tilted boxes take their bounding square
        const yaw = 2 * Math.atan2(s.q.y, s.q.w);
        const tilted = Math.abs(s.q.x) > 1e-3 || Math.abs(s.q.z) > 1e-3;
        if (tilted) { const m = Math.max(s.hx, s.hy, s.hz); this.add({ x: s.x, z: s.z, rot: 0, hw: m, hd: m }, s.y - m, s.y + m, tag); }
        else this.add({ x: s.x, z: s.z, rot: yaw, hw: s.hx, hd: s.hz }, s.y - s.hy, s.y + s.hy, tag);
      } else {
        const p = s.points;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < p.length; i += 3) {
          x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); z0 = Math.min(z0, p[i + 2]); z1 = Math.max(z1, p[i + 2]);
        }
        this.add({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, rot: 0, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2 }, y0, y1, tag);
      }
    }
  }
  /** Is anything within m of (x, z) between heights y0 and y1? */
  blocked(x: number, z: number, m: number, y0 = -1, y1 = 2.2): boolean {
    const c = this.cell;
    for (let ix = Math.floor((x - m) / c); ix <= Math.floor((x + m) / c); ix++) {
      for (let iz = Math.floor((z - m) / c); iz <= Math.floor((z + m) / c); iz++) {
        const cl = this.grid.get(this.k(ix, iz));
        if (!cl) continue;
        for (const o of cl) if (o.y1 > y0 && o.y0 < y1 && inside(o, x, z, m)) return true;
      }
    }
    return false;
  }
  /** Is a rectangle (grown by m) clear? Checks its centre, corners and edge midpoints. */
  clear(r: Rect, m = 0, y0 = -1, y1 = 2.2): boolean {
    if (this.blocked(r.x, r.z, m, y0, y1)) return false;
    for (const [x, z] of corners(r)) if (this.blocked(x, z, m, y0, y1)) return false;
    for (const s of sides(r)) if (this.blocked(s.x, s.z, m, y0, y1)) return false;
    // and a finer row inside, for long thin things
    const { ax, az, bx, bz } = axes(r);
    const nu = Math.ceil(r.hw / 1.2), nv = Math.ceil(r.hd / 1.2);
    for (let i = -nu; i <= nu; i++) for (let j = -nv; j <= nv; j++) {
      const u = (i / Math.max(1, nu)) * r.hw, v = (j / Math.max(1, nv)) * r.hd;
      if (this.blocked(r.x + ax * u + bx * v, r.z + az * u + bz * v, m, y0, y1)) return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------- the ground's height, fast

/** The ground mesh rasterised to a grid (metres), for height lookups in O(1). */
export class HeightGrid {
  readonly res: number;
  readonly half: number;
  private n: number;
  private h: Float32Array;
  constructor(V: Float32Array, I: Uint32Array, P: number, res = 1) {
    this.res = res;
    this.half = P;
    this.n = Math.ceil((2 * P) / res) + 1;
    const n = this.n;
    this.h = new Float32Array(n * n).fill(NaN);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const x0 = V[a], z0 = V[a + 2], x1 = V[b], z1 = V[b + 2], x2 = V[c], z2 = V[c + 2];
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (Math.abs(d) < 1e-9) continue;
      const i0 = Math.max(0, Math.floor((Math.min(x0, x1, x2) + P) / res)), i1 = Math.min(n - 1, Math.ceil((Math.max(x0, x1, x2) + P) / res));
      const j0 = Math.max(0, Math.floor((Math.min(z0, z1, z2) + P) / res)), j1 = Math.min(n - 1, Math.ceil((Math.max(z0, z1, z2) + P) / res));
      for (let i = i0; i <= i1; i++) {
        const x = i * res - P;
        for (let j = j0; j <= j1; j++) {
          const z = j * res - P;
          const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
          const l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
          const l2 = 1 - l0 - l1;
          if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
          this.h[i * n + j] = l0 * V[a + 1] + l1 * V[b + 1] + l2 * V[c + 1];
        }
      }
    }
    for (let k = 0; k < this.h.length; k++) if (Number.isNaN(this.h[k])) this.h[k] = 0;
  }
  at(x: number, z: number): number {
    const n = this.n, res = this.res;
    const fx = (x + this.half) / res, fz = (z + this.half) / res;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return 0;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const h = this.h;
    return (h[i * n + j] * (1 - u) + h[(i + 1) * n + j] * u) * (1 - v) + (h[i * n + j + 1] * (1 - u) + h[(i + 1) * n + j + 1] * u) * v;
  }
}

export const _v = new Vector3();
