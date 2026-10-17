// Streets world: a kit of parts for the near detail (parapets, doors, ladders, stalls, jars …). Each named list is a
// unit geometry centred on the origin and a material; a part is placed by position, rotation and scale with an sRGB
// colour, and may add a collider (a box or a convex hull) to the world's solids. build() merges the parts into one
// mesh per material and 64 m cell (a few dozen draw calls, frustum-culled per cell, so the sun's small shadow camera
// draws only the cells under it), with small parts in a "near" mesh per cell that is hidden with distance.
// Nothing here draws from Math.random: callers pass hashes of the city id.
//
// Two tags ride along with every part:
// - its surface (what it is made of: masonry, wood, cloth …), from the list's `surface` option or, for lists that
//   draw several things (wood, pole, ball …), from its colour. With `build({ tags: true })` each merged mesh carries
//   per-vertex aBox = (local x, local y 0..1 from base to top, local z, yaw), aDim = (size x, y, z, surface id) and
//   aNrm (the local normal), which the realism look reads to give every part its material (docs/streets/lookdev.md).
// - its owner (a house, a stall, a wall run …: `kit.owner` while it is placed), so the hero district can take an
//   owner's parts away (collapse their vertices, no extra draw call) when the modular kit draws that owner instead.

import {
  BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry,
  LatheGeometry, type Material, Matrix3, Matrix4, Mesh, Quaternion, Vector2, Vector3,
} from 'three';
import type { RGB } from '../../../three/city/style.ts';
import type { Solid } from '../world.ts';

const LIN = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const UP = new Vector3(0, 1, 0);

// ---------------------------------------------------------------- surfaces

/** What a part is made of (aDim.w). The realism look (look/materials.ts) gives each its scanned material. */
export const SURFACE = {
  masonry: 0, roof: 1, wood: 2, cloth: 3, reed: 4, terracotta: 5, stone: 6, foliage: 7, opening: 8, metal: 9, grain: 10,
  monument: 11, fort: 12, plaster: 13,
} as const;
export type SurfaceId = (typeof SURFACE)[keyof typeof SURFACE];

function hsv(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: mx > 0 ? d / mx : 0, v: mx };
}
const near = (c: RGB, t: RGB, tol = 0.05) => Math.abs(c[0] - t[0]) < tol && Math.abs(c[1] - t[1]) < tol && Math.abs(c[2] - t[2]) < tol;
const BRONZE: RGB = [0.62, 0.45, 0.24], REED: RGB = [0.8, 0.69, 0.48], STONE: RGB = [0.72, 0.66, 0.56], LINEN: RGB = [0.9, 0.86, 0.77];

/** A part's surface from its list and its (sRGB) colour, for lists that draw more than one thing. */
export function surfaceOf(list: string, srgb: RGB): SurfaceId {
  const { h, s, v } = hsv(srgb[0], srgb[1], srgb[2]);
  const green = srgb[1] > srgb[0] * 1.02 && srgb[1] > srgb[2];
  const brown = h >= 15 && h <= 40 && s >= 0.3 && s <= 0.62 && v <= 0.64;
  switch (list) {
    case 'mud': return SURFACE.masonry;
    case 'wood':
      if (v < 0.22) return SURFACE.opening;
      if (near(srgb, BRONZE)) return SURFACE.metal;
      return SURFACE.wood;
    case 'cloth': return near(srgb, REED, 0.06) ? SURFACE.reed : SURFACE.cloth;
    case 'pole':
      if (near(srgb, BRONZE)) return SURFACE.metal;
      if (brown) return SURFACE.wood;
      if (v > 0.55 && s < 0.45 && h >= 20 && h <= 45) return SURFACE.masonry;
      if (h > 150 && h < 220 && v < 0.4) return SURFACE.metal; // water in a vat or a well
      return SURFACE.cloth;
    case 'jar': return SURFACE.terracotta;
    case 'ball':
      if (green) return SURFACE.foliage;
      if (s < 0.15) return near(srgb, LINEN, 0.08) ? SURFACE.cloth : SURFACE.stone;
      if (v > 0.6 && s < 0.45) return SURFACE.masonry;
      return SURFACE.terracotta;
    case 'cone': return s > 0.3 && v > 0.6 ? SURFACE.grain : SURFACE.metal;
    case 'frustum': return brown ? SURFACE.wood : SURFACE.cloth;
    case 'rock': return near(srgb, STONE, 0.12) || s < 0.25 ? SURFACE.stone : SURFACE.terracotta;
    default: return SURFACE.masonry;
  }
}

// ---------------------------------------------------------------- unit shapes

/** Darken the foot of a unit geometry (a cheap ambient occlusion in its vertex colours), as the city's parts do. */
function ao(g: BufferGeometry, lo: number, hi = 1): BufferGeometry {
  const pos = g.attributes.position;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - y0) / Math.max(1e-6, y1 - y0);
    const v = lo + (hi - lo) * Math.pow(t, 0.6);
    col[3 * i] = v; col[3 * i + 1] = v; col[3 * i + 2] = v;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

/** A storage jar (pithos): unit height, widest 1 across, centred on the origin. */
function jar(): BufferGeometry {
  const prof: [number, number][] = [[0, -0.5], [0.24, -0.5], [0.44, -0.24], [0.5, 0.02], [0.4, 0.3], [0.2, 0.42], [0.24, 0.5], [0.12, 0.47]];
  return new LatheGeometry(prof.map(([r, y]) => new Vector2(r, y)), 7);
}

/** Unit geometries, centred on the origin (a box spans −0.5..0.5 on each axis). */
export function kitGeometries() {
  return {
    box: ao(new BoxGeometry(1, 1, 1), 0.72),
    cyl: ao(new CylinderGeometry(0.5, 0.5, 1, 8, 1), 0.7),
    cone: ao(new ConeGeometry(0.5, 1, 8, 1), 0.82),
    ball: ao(new IcosahedronGeometry(0.5, 1), 0.8),
    /** rubble, stones: 20 faces */
    rock: ao(new IcosahedronGeometry(0.5, 0), 0.75),
    /** a truncated cone (a gown, a stool, a pot): top radius 0.32, bottom 0.5 */
    frustum: ao(new CylinderGeometry(0.32, 0.5, 1, 8, 1), 0.78),
    jar: ao(jar(), 0.62),
  };
}
export type KitShape = keyof ReturnType<typeof kitGeometries>;

type SurfaceRule = SurfaceId | ((srgb: RGB) => SurfaceId);
interface List {
  name: string; geo: BufferGeometry; mat: Material; m: number[]; c: number[]; s: number[]; o: number[];
  cast: boolean; receive: boolean; order: number; surface: SurfaceRule | null;
}

const _m = new Matrix4(), _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _a = new Vector3(), _b = new Vector3();

/** Where an owner's parts went in the built meshes: a mesh and a range of its vertices. */
interface Range { mesh: Mesh; start: number; count: number }

export class Kit {
  readonly solids: Solid[] = [];
  /** Who owns the parts placed from now on (a house, a stall, a wall run …; -1: nobody the district replaces). */
  owner = -1;
  /** The surface of the next parts, overriding the list's rule (null: the list's own). */
  surface: SurfaceId | null = null;
  private lists = new Map<string, List>();
  private geos = kitGeometries();
  private ranges = new Map<number, Range[]>();

  /** A list draws `shape` with `mat`; `cast` and `receive` set its shadows; `surface` says what its parts are made of
   *  (an id, or a rule from each part's sRGB colour; by default the rule `surfaceOf` keeps for the list's name). */
  define(name: string, shape: KitShape | BufferGeometry, mat: Material, opts: { cast?: boolean; receive?: boolean; order?: number; surface?: SurfaceRule } = {}) {
    const geo = typeof shape === 'string' ? this.geos[shape] : shape;
    this.lists.set(name, { name, geo, mat, m: [], c: [], s: [], o: [], cast: opts.cast ?? false, receive: opts.receive ?? true, order: opts.order ?? 0, surface: opts.surface ?? null });
  }

  count(name?: string): number {
    if (name) return (this.lists.get(name)?.m.length ?? 0) / 16;
    let n = 0;
    for (const l of this.lists.values()) n += l.m.length / 16;
    return n;
  }

  /** A part at its centre (x, y, z), turned `yaw` about the vertical (as the city's parts: local x → (cos, −sin)). */
  put(name: string, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, c: RGB) {
    _q.setFromAxisAngle(UP, yaw);
    this.putQ(name, _p.set(x, y, z), _q, _s.set(sx, sy, sz), c);
  }

  putQ(name: string, p: Vector3, q: Quaternion, s: Vector3, c: RGB) {
    const l = this.lists.get(name);
    if (!l) throw new Error(`kit: no list ${name}`);
    _m.compose(p, q, s);
    for (let i = 0; i < 16; i++) l.m.push(_m.elements[i]);
    l.c.push(LIN(c[0]), LIN(c[1]), LIN(c[2]));
    const rule = this.surface ?? l.surface;
    l.s.push(rule === null ? surfaceOf(name, c) : typeof rule === 'function' ? rule(c) : rule);
    l.o.push(this.owner);
  }

  /** A box standing on y0 (its base), turned `yaw`; with `solid`, it also collides. */
  block(name: string, x: number, y0: number, z: number, yaw: number, w: number, h: number, d: number, c: RGB, solid = false) {
    this.put(name, x, y0 + h / 2, z, yaw, w, h, d, c);
    if (solid) this.solidBox(x, y0 + h / 2, z, yaw, w / 2, h / 2, d / 2);
  }

  /** A beam from a to b (its length along the segment), `w` across and `h` thick, its thickness about `up`. */
  beam(name: string, a: Vector3, b: Vector3, w: number, h: number, c: RGB, solid = false, up: Vector3 = UP) {
    const len = a.distanceTo(b);
    if (len < 1e-4) return;
    const q = beamQuat(a, b, up);
    _p.addVectors(a, b).multiplyScalar(0.5);
    this.putQ(name, _p, q, _s.set(w, h, len), c);
    if (solid) this.solids.push({ kind: 'box', x: _p.x, y: _p.y, z: _p.z, hx: w / 2, hy: h / 2, hz: len / 2, q: q.clone() });
  }

  /** A collider only: a box from a to b, `w` across and `h` thick. */
  solidBeam(a: Vector3, b: Vector3, w: number, h: number, up: Vector3 = UP) {
    const len = a.distanceTo(b);
    if (len < 1e-4) return;
    const q = beamQuat(a, b, up);
    _p.addVectors(a, b).multiplyScalar(0.5);
    this.solids.push({ kind: 'box', x: _p.x, y: _p.y, z: _p.z, hx: w / 2, hy: h / 2, hz: len / 2, q: q.clone() });
  }

  solidBox(x: number, y: number, z: number, yaw: number, hx: number, hy: number, hz: number) {
    this.solids.push({ kind: 'box', x, y, z, hx, hy, hz, q: new Quaternion().setFromAxisAngle(UP, yaw) });
  }

  solidHull(points: number[]) { this.solids.push({ kind: 'hull', points: new Float32Array(points) }); }

  /** Build the parts as merged meshes, one per material and cell (cells `cell` metres square), frustum-culled, so
   *  the camera and the sun's shadow camera draw only the cells they see. Small parts (under `small` metres across)
   *  go in a separate "near" mesh per cell, which `near()` hides beyond a distance and which casts no shadow. With
   *  `tags`, every mesh also carries the surface attributes (aBox, aDim, aNrm) for the realism look. */
  build(opts: { cell?: number; small?: number; tags?: boolean } = {}): Group {
    const cell = opts.cell ?? 64, small = opts.small ?? 0.75, tags = opts.tags ?? false;
    const g = new Group();
    g.name = 'streets-detail';
    interface Bucket { mat: Material; near: boolean; cast: boolean; receive: boolean; order: number; items: [List, number][]; verts: number; ix: number; iz: number }
    const buckets = new Map<string, Bucket>();
    const flat = new Map<BufferGeometry, BufferGeometry>();
    const flatOf = (geo: BufferGeometry) => { let f = flat.get(geo); if (!f) { f = geo.index ? geo.toNonIndexed() : geo; flat.set(geo, f); } return f; };
    for (const l of this.lists.values()) {
      const n = l.m.length / 16;
      const vc = flatOf(l.geo).attributes.position.count;
      for (let i = 0; i < n; i++) {
        const o = i * 16;
        const sx = Math.hypot(l.m[o], l.m[o + 1], l.m[o + 2]), sy = Math.hypot(l.m[o + 4], l.m[o + 5], l.m[o + 6]), sz = Math.hypot(l.m[o + 8], l.m[o + 9], l.m[o + 10]);
        const near = Math.max(sx, sy, sz) < small;
        const ix = Math.floor(l.m[o + 12] / cell), iz = Math.floor(l.m[o + 14] / cell);
        const key = `${l.mat.uuid}|${near ? 1 : 0}|${l.cast ? 1 : 0}|${ix},${iz}`;
        let b = buckets.get(key);
        if (!b) { b = { mat: l.mat, near, cast: l.cast && !near, receive: l.receive, order: l.order, items: [], verts: 0, ix, iz }; buckets.set(key, b); }
        b.items.push([l, i]);
        b.verts += vc;
      }
    }
    // each unit shape's own frame, for the tags: local y from 0 at its base to 1 at its top
    const local = new Map<BufferGeometry, { p: Float32Array; n: Float32Array }>();
    const localOf = (geo: BufferGeometry) => {
      let f = local.get(geo);
      if (!f) {
        const P = geo.attributes.position, Nn = geo.attributes.normal;
        let y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < P.count; i++) { y0 = Math.min(y0, P.getY(i)); y1 = Math.max(y1, P.getY(i)); }
        const pp = new Float32Array(P.count * 3), np = new Float32Array(P.count * 3);
        for (let i = 0; i < P.count; i++) {
          pp[i * 3] = P.getX(i); pp[i * 3 + 1] = (P.getY(i) - y0) / Math.max(1e-6, y1 - y0); pp[i * 3 + 2] = P.getZ(i);
          np[i * 3] = Nn.getX(i); np[i * 3 + 1] = Nn.getY(i); np[i * 3 + 2] = Nn.getZ(i);
        }
        f = { p: pp, n: np };
        local.set(geo, f);
      }
      return f;
    };
    const M = new Matrix4(), N = new Matrix3(), v = new Vector3();
    this.cells = [];
    this.ranges.clear();
    for (const b of buckets.values()) {
      const pos = new Float32Array(b.verts * 3), nor = new Float32Array(b.verts * 3), col = new Float32Array(b.verts * 3);
      const box = tags ? new Float32Array(b.verts * 4) : null, dim = tags ? new Float32Array(b.verts * 4) : null, lnr = tags ? new Float32Array(b.verts * 3) : null;
      const mesh = new Mesh(undefined, b.mat);
      let k = 0;
      for (const [l, i] of b.items) {
        const geo = flatOf(l.geo);
        const P = geo.attributes.position, Nn = geo.attributes.normal, Cc = geo.attributes.color;
        M.fromArray(l.m, i * 16);
        N.getNormalMatrix(M);
        const r = l.c[i * 3], gg = l.c[i * 3 + 1], bb = l.c[i * 3 + 2];
        const start = k;
        for (let j = 0; j < P.count; j++, k++) {
          v.fromBufferAttribute(P, j).applyMatrix4(M);
          pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
          v.fromBufferAttribute(Nn, j).applyMatrix3(N).normalize();
          nor[k * 3] = v.x; nor[k * 3 + 1] = v.y; nor[k * 3 + 2] = v.z;
          const ao = Cc ? Cc.getX(j) : 1;
          col[k * 3] = r * ao; col[k * 3 + 1] = gg * ao; col[k * 3 + 2] = bb * ao;
        }
        if (box && dim && lnr) {
          const e = l.m, o = i * 16;
          const sx = Math.hypot(e[o], e[o + 1], e[o + 2]), sy = Math.hypot(e[o + 4], e[o + 5], e[o + 6]), sz = Math.hypot(e[o + 8], e[o + 9], e[o + 10]);
          const yaw = Math.atan2(-e[o + 2], e[o]);
          const surf = l.s[i];
          const { p: lp, n: ln } = localOf(geo);
          for (let j = 0, q = start; j < P.count; j++, q++) {
            box[q * 4] = lp[j * 3]; box[q * 4 + 1] = lp[j * 3 + 1]; box[q * 4 + 2] = lp[j * 3 + 2]; box[q * 4 + 3] = yaw;
            lnr[q * 3] = ln[j * 3]; lnr[q * 3 + 1] = ln[j * 3 + 1]; lnr[q * 3 + 2] = ln[j * 3 + 2];
            dim[q * 4] = sx; dim[q * 4 + 1] = sy; dim[q * 4 + 2] = sz; dim[q * 4 + 3] = surf;
          }
        }
        // the owner's vertices in this mesh (runs of one owner's parts merge into one range)
        const ow = l.o[i];
        if (ow >= 0) {
          let rs = this.ranges.get(ow);
          if (!rs) { rs = []; this.ranges.set(ow, rs); }
          const last = rs[rs.length - 1];
          if (last && last.mesh === mesh && last.start + last.count === start) last.count += k - start;
          else rs.push({ mesh, start, count: k - start });
        }
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('normal', new BufferAttribute(nor, 3));
      geo.setAttribute('color', new BufferAttribute(col, 3));
      if (box && dim && lnr) {
        geo.setAttribute('aBox', new BufferAttribute(box, 4));
        geo.setAttribute('aDim', new BufferAttribute(dim, 4));
        geo.setAttribute('aNrm', new BufferAttribute(lnr, 3));
        mesh.userData.lookTagged = true;
      }
      geo.computeBoundingSphere();
      mesh.geometry = geo;
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      mesh.renderOrder = b.order;
      mesh.name = `detail-${b.near ? 'near' : 'far'}-${b.ix},${b.iz}`;
      mesh.matrixAutoUpdate = false;
      g.add(mesh);
      this.cells.push({ mesh, near: b.near, x: (b.ix + 0.5) * cell, z: (b.iz + 0.5) * cell, r: cell * 0.71 });
      this.triangles += b.verts / 3;
    }
    for (const f of flat.values()) if (![...this.lists.values()].some((l) => l.geo === f)) f.dispose();
    return g;
  }

  /** Owners with parts in the built meshes. */
  owners(): number[] { return [...this.ranges.keys()]; }

  /** Take an owner's parts out of the built meshes (their vertices collapse; the draw calls stay as they were). */
  hideOwner(owner: number) {
    const rs = this.ranges.get(owner);
    if (!rs) return;
    for (const r of rs) {
      const a = r.mesh.geometry.attributes.position as BufferAttribute;
      const arr = a.array as Float32Array;
      // collapse onto the range's first vertex: degenerate triangles, nothing drawn, the bounds unchanged
      const x = arr[r.start * 3], y = arr[r.start * 3 + 1], z = arr[r.start * 3 + 2];
      for (let k = r.start; k < r.start + r.count; k++) { arr[k * 3] = x; arr[k * 3 + 1] = y; arr[k * 3 + 2] = z; }
      a.addUpdateRange(r.start * 3, r.count * 3);
      a.needsUpdate = true;
    }
    this.ranges.delete(owner);
  }

  /** Show the near parts only within `dist` metres of (x, z) (call a few times a second). */
  near(x: number, z: number, dist: number) {
    for (const c of this.cells) if (c.near) c.mesh.visible = Math.hypot(c.x - x, c.z - z) < dist + c.r;
  }

  /** The built cells (for the probes), and the triangles in them. */
  cells: { mesh: Mesh; near: boolean; x: number; z: number; r: number }[] = [];
  triangles = 0;

  disposeBuilt() { for (const c of this.cells) c.mesh.geometry.dispose(); this.cells = []; this.ranges.clear(); }

  dispose() { for (const g of Object.values(this.geos)) g.dispose(); }
}

/** The rotation that takes a unit box's z axis along a→b, its y axis as near `up` as it can. */
export function beamQuat(a: Vector3, b: Vector3, up: Vector3 = UP): Quaternion {
  const z = _a.subVectors(b, a).normalize();
  let x = _b.crossVectors(up, z);
  if (x.lengthSq() < 1e-8) x = _b.set(1, 0, 0);
  x.normalize();
  const y = new Vector3().crossVectors(z, x).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}
