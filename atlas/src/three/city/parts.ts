// Cities in 3D: a handful of unit primitives, each drawn as one InstancedMesh, so a whole city (thousands of houses,
// walls, boats and trees) costs about a dozen draw calls. Every part is a primitive scaled, turned about the vertical
// and coloured per instance; vertex colours darken the foot of every wall (a cheap ambient occlusion).

import {
  BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, DynamicDrawUsage, Group,
  IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, type Material, SphereGeometry,
} from 'three';
import type { RGB } from './style.ts';

export const KINDS = ['box', 'gable', 'pyr', 'frustum', 'dome', 'cone', 'cyl', 'ball', 'hull', 'wedge'] as const;
export type Kind = (typeof KINDS)[number];

function ao(g: BufferGeometry, lo: number, hi: number): BufferGeometry {
  const pos = g.attributes.position;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - y0) / Math.max(1e-6, y1 - y0);
    const v = lo + (hi - lo) * Math.pow(t, 0.55);
    col[3 * i] = v; col[3 * i + 1] = v; col[3 * i + 2] = v;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

function tris(verts: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  g.computeVertexNormals();
  return g;
}

/** Triangular prism: base 1 × 1 at y 0, ridge along x at y 1. */
function gable(): BufferGeometry {
  const a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [0.5, 0, 0.5], d = [-0.5, 0, 0.5], e = [-0.5, 1, 0], f = [0.5, 1, 0];
  const v: number[] = [];
  const t = (p: number[], q: number[], r: number[]) => v.push(...p, ...q, ...r);
  t(a, e, f); t(a, f, b); // north slope
  t(d, c, f); t(d, f, e); // south slope
  t(a, d, e); t(b, f, c); // gables
  t(a, b, c); t(a, c, d); // floor
  return tris(v);
}
/** Saw-tooth: a vertical face on the north (z −0.5), sloping to the south edge. */
function wedge(): BufferGeometry {
  const a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [0.5, 0, 0.5], d = [-0.5, 0, 0.5], e = [-0.5, 1, -0.5], f = [0.5, 1, -0.5];
  const v: number[] = [];
  const t = (p: number[], q: number[], r: number[]) => v.push(...p, ...q, ...r);
  t(a, e, f); t(a, f, b); // north face
  t(d, f, e); t(d, c, f); // slope
  t(a, d, e); t(b, f, c); // ends
  t(a, c, d); t(a, b, c); // floor
  return tris(v);
}
/** A boat's hull: length 1 along x, beam 0.36, depth 1 (scaled); pointed bow (+x), rounder stern. */
function hull(): BufferGeometry {
  const deck: [number, number][] = [[0.5, 0], [0.36, 0.13], [0.12, 0.18], [-0.2, 0.18], [-0.42, 0.13], [-0.5, 0.06], [-0.5, -0.06], [-0.42, -0.13], [-0.2, -0.18], [0.12, -0.18], [0.36, -0.13]];
  const keel = deck.map(([x, z]) => [x * 0.8, z * 0.45] as [number, number]);
  const v: number[] = [];
  const n = deck.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const A = [deck[i][0], 1, deck[i][1]], B = [deck[j][0], 1, deck[j][1]], C = [keel[j][0], 0, keel[j][1]], D = [keel[i][0], 0, keel[i][1]];
    v.push(...A, ...B, ...C, ...A, ...C, ...D);
    v.push(0, 1, 0, ...B, ...A); // deck fan
    v.push(0, 0, 0, ...D, ...C); // keel fan
  }
  return tris(v);
}

export function makeGeometries(): Record<Kind, BufferGeometry> {
  const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const pyr = new ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  const frustum = new CylinderGeometry(Math.SQRT1_2 * 0.55, Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  const dome = new SphereGeometry(0.5, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1);
  const cone = new ConeGeometry(0.5, 1, 10, 1).translate(0, 0.5, 0);
  const cyl = new CylinderGeometry(0.5, 0.5, 1, 10, 1).translate(0, 0.5, 0);
  const ball = new IcosahedronGeometry(0.5, 1).translate(0, 0.5, 0);
  return {
    box: ao(box, 0.6, 1), gable: ao(gable(), 0.88, 1), pyr: ao(pyr, 0.88, 1), frustum: ao(frustum, 0.8, 1),
    dome: ao(dome, 0.85, 1.04), cone: ao(cone, 0.8, 1), cyl: ao(cyl, 0.62, 1), ball: ao(ball, 0.82, 1.03),
    hull: ao(hull(), 0.7, 1), wedge: ao(wedge(), 0.85, 1),
  };
}

const LIN = new Float32Array(1025);
for (let i = 0; i <= 1024; i++) { const c = i / 1024; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
/** sRGB → linear through a table (thousands of parts per year). */
const lin = (c: number) => LIN[c <= 0 ? 0 : c >= 1 ? 1024 : (c * 1024 + 0.5) | 0];

/** One instanced mesh per primitive; fill with add() between reset() and commit(). */
export class Parts {
  readonly group = new Group();
  private meshes = new Map<Kind, InstancedMesh>();
  private n = new Map<Kind, number>();
  private geos: Record<Kind, BufferGeometry>;
  private mat: Material;
  private shadows: boolean;

  constructor(geos: Record<Kind, BufferGeometry>, mat: Material, shadows = true) {
    this.geos = geos;
    this.mat = mat;
    this.shadows = shadows;
  }

  reset() { for (const k of KINDS) this.n.set(k, 0); }

  private mesh(k: Kind, need: number): InstancedMesh {
    let m = this.meshes.get(k);
    if (m && m.instanceMatrix.count >= need) return m;
    const cap = Math.max(need, m ? m.instanceMatrix.count * 2 : k === 'box' ? 4096 : 512);
    const next = new InstancedMesh(this.geos[k], this.mat, cap);
    next.instanceMatrix.setUsage(DynamicDrawUsage);
    next.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    next.instanceColor.setUsage(DynamicDrawUsage);
    next.frustumCulled = false;
    next.castShadow = this.shadows;
    next.receiveShadow = this.shadows;
    if (m) {
      (next.instanceMatrix.array as Float32Array).set(m.instanceMatrix.array as Float32Array);
      (next.instanceColor.array as Float32Array).set(m.instanceColor!.array as Float32Array);
      this.group.remove(m);
      m.dispose();
    }
    next.count = 0;
    this.group.add(next);
    this.meshes.set(k, next);
    return next;
  }

  /** A primitive at (x, y, z), turned `rot` radians about the vertical, scaled (sx, sy, sz), in an sRGB colour. */
  add(k: Kind, x: number, y: number, z: number, rot: number, sx: number, sy: number, sz: number, c: RGB) {
    const i = this.n.get(k) ?? 0;
    const m = this.mesh(k, i + 1);
    const e = m.instanceMatrix.array as Float32Array;
    const o = i * 16;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    e[o] = cs * sx; e[o + 1] = 0; e[o + 2] = -sn * sx; e[o + 3] = 0;
    e[o + 4] = 0; e[o + 5] = sy; e[o + 6] = 0; e[o + 7] = 0;
    e[o + 8] = sn * sz; e[o + 9] = 0; e[o + 10] = cs * sz; e[o + 11] = 0;
    e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
    const ca = m.instanceColor!.array as Float32Array;
    ca[i * 3] = lin(c[0]); ca[i * 3 + 1] = lin(c[1]); ca[i * 3 + 2] = lin(c[2]);
    this.n.set(k, i + 1);
  }

  /** A part along a segment (x0,z0)→(x1,z1): length on its local x axis. */
  span(k: Kind, x0: number, z0: number, x1: number, z1: number, y: number, h: number, w: number, c: RGB, extra = 0) {
    const len = Math.hypot(x1 - x0, z1 - z0) + extra;
    this.add(k, (x0 + x1) / 2, y, (z0 + z1) / 2, -Math.atan2(z1 - z0, x1 - x0), len, h, w, c);
  }

  commit() {
    for (const [k, m] of this.meshes) {
      m.count = this.n.get(k) ?? 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.visible = m.count > 0;
    }
  }

  count(): number {
    let s = 0;
    for (const v of this.n.values()) s += v;
    return s;
  }

  dispose() {
    for (const m of this.meshes.values()) { this.group.remove(m); m.dispose(); }
    this.meshes.clear();
  }
}
