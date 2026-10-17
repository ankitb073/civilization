// Look: what each surface of the streets is made of. The city model and the streets layer draw coloured primitives;
// the realism look needs to know which are mud walls, timber, cloth, jars or stone, and each box's own size and
// local position (for worn edges, a damp foot and rain streaks hanging from its top). This module tags them:
//
// - the city's instanced parts get per-instance attributes from their geometry kind, colour and place (tagCity);
// - the streets layer's merged meshes (world/kit.ts) carry per-vertex attributes. The interface is the attributes
//   themselves: aBox, aDim and aNrm on a kit mesh's geometry (below), and `material.userData.lookKind` ('mud' or
//   'plain', world/materials.ts) for which material family it takes. The world's kit writes them when asked
//   (setWorldOptions({ surfaceTags: true }), world/kit.ts); a kit built without them (the errand's levy) keeps its
//   own painted-wood material.
// - door and window openings (for the soot decals) are read back from the tagged meshes (openingsOf).
//
// Nothing here draws from Math.random.
//
// Attributes (both kinds): aBox = (local x, local y from 0 at the base to 1 at the top, local z, yaw),
// aDim = (size x, size y, size z, surface id), aNrm = the part's own (local) normal. Local x and z run -0.5..0.5.

import { type BufferGeometry, type InstancedMesh, InstancedBufferAttribute, Matrix4, type Mesh, type Object3D, Quaternion, Vector3 } from 'three';

/** Surface ids (aDim.w). */
export const S = {
  masonry: 0, roof: 1, wood: 2, cloth: 3, reed: 4, terracotta: 5, stone: 6, foliage: 7, opening: 8, metal: 9, grain: 10,
  monument: 11, fort: 12, plaster: 13,
} as const;
export type SurfaceId = (typeof S)[keyof typeof S];

const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
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

/** Door and window openings the kit drew (dark slabs on walls): centre, the slab's own axes, width and height
 *  (metres). */
export interface Opening { x: number; y: number; z: number; ax: [number, number, number]; nz: [number, number, number]; w: number; h: number; t: number }

/** The openings in a built streets layer, read from its tagged meshes: each run of an opening's vertices is one box
 *  part (36 vertices), its centre their mean, its axes from its yaw. */
export function openingsOf(root: Object3D): Opening[] {
  const out: Opening[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    const g = m.geometry;
    if (!m.isMesh || !g?.attributes.aDim || !g.attributes.aBox) return;
    const dim = g.attributes.aDim.array as Float32Array, box = g.attributes.aBox.array as Float32Array, pos = g.attributes.position.array as Float32Array;
    const n = g.attributes.position.count;
    for (let i = 0; i + 36 <= n;) {
      if (Math.round(dim[i * 4 + 3]) !== S.opening) { i++; continue; }
      const sx = dim[i * 4], sy = dim[i * 4 + 1], sz = dim[i * 4 + 2], yaw = box[i * 4 + 3];
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 36; k++) { x += pos[(i + k) * 3]; y += pos[(i + k) * 3 + 1]; z += pos[(i + k) * 3 + 2]; }
      i += 36;
      if (!(sy > 0.3 && Math.max(sx, sz) > 0.3 && Math.min(sx, sz) < 0.12)) continue;
      const X: [number, number, number] = [Math.cos(yaw), 0, -Math.sin(yaw)], Z: [number, number, number] = [Math.sin(yaw), 0, Math.cos(yaw)];
      const wide = sx >= sz;
      out.push({ x: x / 36, y: y / 36, z: z / 36, ax: wide ? X : Z, nz: wide ? Z : X, w: Math.max(sx, sz), h: sy, t: Math.min(sx, sz) });
    }
  });
  return out;
}

/** The city model's primitive kinds, told apart by their geometry (three/city/parts.ts makeGeometries). */
export function cityKind(g: BufferGeometry): string {
  const p = (g as unknown as { parameters?: Record<string, number> }).parameters;
  switch (g.type) {
    case 'BoxGeometry': return 'box';
    case 'ConeGeometry': return p?.radialSegments === 4 ? 'pyr' : 'cone';
    case 'CylinderGeometry': return p?.radialSegments === 4 ? 'frustum' : 'cyl';
    case 'SphereGeometry': return 'dome';
    case 'IcosahedronGeometry': return 'ball';
    default: {
      const pos = g.attributes.position;
      if (pos.count > 100) return 'hull';
      // gable: a ridge vertex at (-0.5, 1, 0); wedge: (-0.5, 1, -0.5)
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0.99 && Math.abs(pos.getZ(i)) < 1e-3) return 'gable';
      return 'wedge';
    }
  }
}

export interface Footprint { x: number; z: number; hw: number; hd: number; rot: number }
const inRect = (r: Footprint, x: number, z: number, m: number) => {
  const c = Math.cos(r.rot), s = Math.sin(r.rot);
  const dx = x - r.x, dz = z - r.z;
  const u = dx * c - dz * s, w = dx * s + dz * c;
  return Math.abs(u) <= r.hw + m && Math.abs(w) <= r.hd + m;
};

/** Give a city instanced mesh its per-instance aBox (yaw in w) and aDim, on a private copy of its geometry (the
 *  model shares its geometries between cities and views). Returns the copy, to dispose with the look. */
export function tagCity(im: InstancedMesh, monuments: Footprint[], wallRing: { r0: number; r1: number } | null): BufferGeometry {
  const kind = cityKind(im.geometry);
  const geo = im.geometry.clone();
  const n = im.count;
  const yawA = new Float32Array(Math.max(1, n)), dim = new Float32Array(Math.max(1, n) * 4);
  const M = new Matrix4(), W = new Matrix4(), p = new Vector3(), q = new Quaternion(), s = new Vector3();
  const col = im.instanceColor?.array as Float32Array | undefined;
  for (let i = 0; i < n; i++) {
    im.getMatrixAt(i, M);
    W.multiplyMatrices(im.matrixWorld, M);
    W.decompose(p, q, s);
    const e = W.elements;
    yawA[i] = Math.atan2(-e[2], e[0]);
    const srgb = col ? [toSrgb(col[i * 3]), toSrgb(col[i * 3 + 1]), toSrgb(col[i * 3 + 2])] : [0.8, 0.7, 0.5];
    const { h, s: sat, v } = hsv(srgb[0], srgb[1], srgb[2]);
    let surf: number = S.masonry;
    const mon = monuments.some((r) => inRect(r, p.x, p.z, 1.5));
    const r = Math.hypot(p.x, p.z);
    if (kind === 'box') {
      if (v < 0.3) surf = S.opening;
      else if (mon) surf = sat < 0.12 ? S.plaster : S.monument;
      else if (wallRing && r > wallRing.r0 && r < wallRing.r1) surf = S.fort;
      else if (h > 70 && h < 170 && sat > 0.2) surf = S.foliage;
      else surf = S.masonry;
    } else if (kind === 'gable' || kind === 'pyr' || kind === 'wedge') surf = S.reed;
    else if (kind === 'cyl' || kind === 'frustum') surf = sat < 0.22 && v > 0.55 ? S.plaster : h > 15 && h < 45 && v < 0.6 ? S.wood : mon ? S.monument : S.masonry;
    else if (kind === 'cone' || kind === 'ball') surf = srgb[1] >= srgb[0] * 0.98 ? S.foliage : S.masonry;
    else if (kind === 'dome') surf = S.masonry;
    else surf = S.wood;
    dim[i * 4] = s.x; dim[i * 4 + 1] = s.y; dim[i * 4 + 2] = s.z; dim[i * 4 + 3] = surf;
  }
  geo.setAttribute('aYaw', new InstancedBufferAttribute(yawA, 1));
  geo.setAttribute('aDim', new InstancedBufferAttribute(dim, 4));
  geo.userData.lookKind = kind;
  return geo;
}
