// The figure maker's bench: small geometry helpers and a Kit that collects painted parts and merges them into one
// mesh per finish (matte paint, metal, varnish), so a whole figure is three draw calls plus its two printed parts.
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group,
  LatheGeometry, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Shape, SphereGeometry, TorusGeometry, Vector2, Vector3,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type Finish = 'paint' | 'metal' | 'gloss';
export type Paint = string | ((p: Vector3) => string);

// ---------------------------------------------------------------- shared materials (one set for every figure)
let MATS: Record<Finish, MeshStandardMaterial> | null = null;
export function materials(): Record<Finish, MeshStandardMaterial> {
  if (!MATS) {
    MATS = {
      // hand-painted wood: matte, a little sheen
      paint: new MeshStandardMaterial({ vertexColors: true, roughness: 0.66, metalness: 0, side: DoubleSide }),
      // gilt, bronze, steel
      metal: new MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.82 }),
      // the varnished base
      gloss: new MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.05 }),
    };
  }
  return MATS;
}

const tmpC = new Color();
const UP = new Vector3(0, 1, 0);

/** A stack of transforms and three bins of painted geometry. */
export class Kit {
  private bins: Record<Finish, BufferGeometry[]> = { paint: [], metal: [], gloss: [] };
  private stack: Matrix4[] = [new Matrix4()];
  readonly extras: Object3D[] = [];
  tris = 0;

  get top(): Matrix4 { return this.stack[this.stack.length - 1]; }
  push(m: Matrix4) { this.stack.push(this.top.clone().multiply(m)); }
  pop() { if (this.stack.length > 1) this.stack.pop(); }
  /** Run `fn` with `m` applied on top of the current transform. */
  with(m: Matrix4, fn: () => void) { this.push(m); try { fn(); } finally { this.pop(); } }

  /** Add a part: transformed by the current stack (and `local`), painted one colour or per vertex. */
  add(g: BufferGeometry, paint: Paint, finish: Finish = 'paint', local?: Matrix4): void {
    const m = local ? this.top.clone().multiply(local) : this.top;
    let geo = g;
    if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
    if (geo.getAttribute('uv1')) geo.deleteAttribute('uv1');
    if (!geo.index) {
      const n = geo.getAttribute('position').count;
      const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(new BufferAttribute(idx, 1));
    }
    const pos = geo.getAttribute('position') as BufferAttribute;
    const n = pos.count;
    const col = new Float32Array(n * 3);
    if (typeof paint === 'string') {
      tmpC.set(paint);
      for (let i = 0; i < n; i++) { col[3 * i] = tmpC.r; col[3 * i + 1] = tmpC.g; col[3 * i + 2] = tmpC.b; }
    } else {
      const v = new Vector3();
      for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i); tmpC.set(paint(v)); col[3 * i] = tmpC.r; col[3 * i + 1] = tmpC.g; col[3 * i + 2] = tmpC.b; }
    }
    geo.setAttribute('color', new BufferAttribute(col, 3));
    geo = geo.applyMatrix4(m);
    this.tris += (geo.index!.count / 3) | 0;
    this.bins[finish].push(geo);
  }

  /** Add a ready-made object (a printed part) under the current transform. */
  addObject(o: Object3D) {
    o.applyMatrix4(this.top);
    this.extras.push(o);
  }

  /** Merge each bin into one mesh. */
  build(): Group {
    const g = new Group();
    const M = materials();
    for (const k of ['paint', 'metal', 'gloss'] as Finish[]) {
      const list = this.bins[k];
      if (!list.length) continue;
      // indices must all be the same width to merge
      const wide = list.some((x) => x.index!.array instanceof Uint32Array);
      if (wide) for (const x of list) if (!(x.index!.array instanceof Uint32Array)) x.setIndex(new BufferAttribute(Uint32Array.from(x.index!.array as Uint16Array), 1));
      const merged = mergeGeometries(list, false);
      for (const x of list) x.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, M[k]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = k;
      g.add(mesh);
    }
    for (const o of this.extras) g.add(o);
    return g;
  }
}

// ---------------------------------------------------------------- matrices
export const T = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);
export const RX = (a: number) => new Matrix4().makeRotationX(a);
export const RY = (a: number) => new Matrix4().makeRotationY(a);
export const RZ = (a: number) => new Matrix4().makeRotationZ(a);
export const S3 = (x: number, y = x, z = x) => new Matrix4().makeScale(x, y, z);
export const mul = (...ms: Matrix4[]) => ms.reduce((a, b) => a.multiply(b), new Matrix4());
/** Rotate about a pivot point. */
export const about = (p: Vector3, m: Matrix4) => mul(T(p.x, p.y, p.z), m, T(-p.x, -p.y, -p.z));
export const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

// ---------------------------------------------------------------- shapes
/** A surface of revolution from [radius, height] points, bottom to top. */
export function lathe(profile: [number, number][], seg = 18, phiStart = 0, phiLength = Math.PI * 2): BufferGeometry {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(Math.max(0.0001, r), y)), seg, phiStart, phiLength);
}
/** A rounded rod from a to b. */
export function rod(a: Vector3, b: Vector3, r: number, seg = 8): BufferGeometry {
  const d = b.clone().sub(a);
  const len = Math.max(0.0001, d.length());
  const g = new CapsuleGeometry(r, len, 3, seg);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
/** A tapered cylinder from a to b (radius r0 at a, r1 at b). */
export function tube(a: Vector3, b: Vector3, r0: number, r1: number, seg = 10, open = false): BufferGeometry {
  const d = b.clone().sub(a);
  const len = Math.max(0.0001, d.length());
  const g = new CylinderGeometry(r1, r0, len, seg, 1, open);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
export function ball(c: Vector3, r: number, sx = 1, sy = 1, sz = 1, w = 14, h = 10): BufferGeometry {
  const g = new SphereGeometry(r, w, h);
  g.scale(sx, sy, sz);
  g.translate(c.x, c.y, c.z);
  return g;
}
/** A part of a sphere: theta from the top down (0 = pole). */
export function cap(r: number, theta0: number, theta1: number, w = 16, h = 8, phiStart = 0, phiLength = Math.PI * 2): BufferGeometry {
  return new SphereGeometry(r, w, h, phiStart, phiLength, theta0, theta1 - theta0);
}
export function box(c: Vector3, w: number, h: number, d: number, round = 0): BufferGeometry {
  const g = round > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(round, Math.min(w, h, d) / 2 - 1e-4)) : new BoxGeometry(w, h, d);
  g.translate(c.x, c.y, c.z);
  return g;
}
export function ring(R: number, tube: number, seg = 24, tseg = 6, arc = Math.PI * 2): BufferGeometry {
  // in the xz plane
  const g = new TorusGeometry(R, tube, tseg, seg, arc);
  g.rotateX(Math.PI / 2);
  return g;
}
export function cone(r: number, h: number, seg = 10, open = false): BufferGeometry {
  return new ConeGeometry(r, h, seg, 1, open);
}
export function cyl(r0: number, r1: number, h: number, seg = 14, open = false): BufferGeometry {
  return new CylinderGeometry(r1, r0, h, seg, 1, open);
}
/** A flat shape extruded along z, centred on its depth. */
export function slab(shape: Shape, depth: number, bevel = 0): BufferGeometry {
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}
export function starShape(n: number, ro: number, ri: number): Shape {
  const s = new Shape();
  for (let i = 0; i < 2 * n; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? ri : ro;
    if (i === 0) s.moveTo(r * Math.cos(a), r * Math.sin(a)); else s.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  s.closePath();
  return s;
}

// ---------------------------------------------------------------- colour
export function shade(hex: string, k: number): string {
  // k < 0 darkens toward black, k > 0 lightens toward white (in sRGB, like mixing paint)
  const c = new Color(hex);
  const t = new Color(k < 0 ? '#000000' : '#ffffff');
  return '#' + c.lerp(t, Math.abs(k)).getHexString();
}
export function mixHex(a: string, b: string, t: number): string {
  return '#' + new Color(a).lerp(new Color(b), t).getHexString();
}

/** A garment of revolution in two halves, per pale: dexter (the wearer's right, x < 0) and sinister, with a crisp
 *  seam (one colour: a single piece). `xs(y)` widens it at height y (shoulders broader than the waist), `zs` flattens
 *  it front to back. */
export function garment(kit: Kit, profile: [number, number][], seg: number, dexter: string, sinister: string,
  opts: { xs?: (y: number) => number; zs?: number; finish?: Finish; local?: Matrix4; phi?: [number, number] } = {}) {
  const shape = (g: BufferGeometry) => {
    // scale the points, and the normals by the inverse (so the lathe keeps its smooth, seamless shading)
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const zs = opts.zs ?? 1;
    const v = new Vector3();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const xs = opts.xs ? opts.xs(y) : 1;
      p.setX(i, p.getX(i) * xs);
      p.setZ(i, p.getZ(i) * zs);
      v.set(n.getX(i) / xs, n.getY(i), n.getZ(i) / zs).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
    return g;
  };
  const [a0, len] = opts.phi ?? [0, Math.PI * 2];
  if (dexter === sinister || opts.phi) {
    kit.add(shape(lathe(profile, seg, a0, len)), dexter, opts.finish ?? 'paint', opts.local);
    return;
  }
  kit.add(shape(lathe(profile, Math.ceil(seg / 2), 0, Math.PI)), sinister, opts.finish ?? 'paint', opts.local);
  kit.add(shape(lathe(profile, Math.ceil(seg / 2), Math.PI, Math.PI)), dexter, opts.finish ?? 'paint', opts.local);
}
export const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
