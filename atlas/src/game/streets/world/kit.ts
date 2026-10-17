// Streets world: a kit of parts for the near detail (parapets, doors, ladders, stalls, jars …). Each named list is a
// unit geometry centred on the origin and a material; a part is placed by position, rotation and scale with an sRGB
// colour, and may add a collider (a box or a convex hull) to the world's solids. build() merges the parts into one
// mesh per material and 64 m cell (a few dozen draw calls, frustum-culled per cell, so the sun's small shadow camera
// draws only the cells under it), with small parts in a "near" mesh per cell that is hidden with distance.
// Nothing here draws from Math.random: callers pass hashes of the city id.

import {
  BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry,
  LatheGeometry, type Material, Matrix3, Matrix4, Mesh, Quaternion, Vector2, Vector3,
} from 'three';
import type { RGB } from '../../../three/city/style.ts';
import type { Solid } from '../world.ts';

const LIN = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const UP = new Vector3(0, 1, 0);

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

interface List { geo: BufferGeometry; mat: Material; m: number[]; c: number[]; cast: boolean; receive: boolean; order: number }

const _m = new Matrix4(), _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _a = new Vector3(), _b = new Vector3();

export class Kit {
  readonly solids: Solid[] = [];
  private lists = new Map<string, List>();
  private geos = kitGeometries();

  /** A list draws `shape` with `mat`; `cast` and `receive` set its shadows. */
  define(name: string, shape: KitShape | BufferGeometry, mat: Material, opts: { cast?: boolean; receive?: boolean; order?: number } = {}) {
    const geo = typeof shape === 'string' ? this.geos[shape] : shape;
    this.lists.set(name, { geo, mat, m: [], c: [], cast: opts.cast ?? false, receive: opts.receive ?? true, order: opts.order ?? 0 });
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
   *  go in a separate "near" mesh per cell, which `near()` hides beyond a distance and which casts no shadow. */
  build(opts: { cell?: number; small?: number } = {}): Group {
    const cell = opts.cell ?? 64, small = opts.small ?? 0.75;
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
    const M = new Matrix4(), N = new Matrix3(), v = new Vector3();
    this.cells = [];
    for (const b of buckets.values()) {
      const pos = new Float32Array(b.verts * 3), nor = new Float32Array(b.verts * 3), col = new Float32Array(b.verts * 3);
      let k = 0;
      for (const [l, i] of b.items) {
        const geo = flatOf(l.geo);
        const P = geo.attributes.position, Nn = geo.attributes.normal, Cc = geo.attributes.color;
        M.fromArray(l.m, i * 16);
        N.getNormalMatrix(M);
        const r = l.c[i * 3], gg = l.c[i * 3 + 1], bb = l.c[i * 3 + 2];
        for (let j = 0; j < P.count; j++, k++) {
          v.fromBufferAttribute(P, j).applyMatrix4(M);
          pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
          v.fromBufferAttribute(Nn, j).applyMatrix3(N).normalize();
          nor[k * 3] = v.x; nor[k * 3 + 1] = v.y; nor[k * 3 + 2] = v.z;
          const ao = Cc ? Cc.getX(j) : 1;
          col[k * 3] = r * ao; col[k * 3 + 1] = gg * ao; col[k * 3 + 2] = bb * ao;
        }
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('normal', new BufferAttribute(nor, 3));
      geo.setAttribute('color', new BufferAttribute(col, 3));
      geo.computeBoundingSphere();
      const mesh = new Mesh(geo, b.mat);
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

  /** Show the near parts only within `dist` metres of (x, z) (call a few times a second). */
  near(x: number, z: number, dist: number) {
    for (const c of this.cells) if (c.near) c.mesh.visible = Math.hypot(c.x - x, c.z - z) < dist + c.r;
  }

  /** The built cells (for the probes), and the triangles in them. */
  cells: { mesh: Mesh; near: boolean; x: number; z: number; r: number }[] = [];
  triangles = 0;

  disposeBuilt() { for (const c of this.cells) c.mesh.geometry.dispose(); this.cells = []; }

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
