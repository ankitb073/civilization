// Streets world: the modular kit's pieces merged into a few meshes. A district cell's pieces at one LOD become one
// mesh per material (LOD0 and LOD1, textured, from the kit's own glTF materials), or, at the far LOD, one mesh in a
// single untextured material whose vertex colours carry each material's mean albedo (alpha-tested foliage keeps its
// own textured mesh). Positions and normals are transformed per piece, uvs offset so runs of modules keep their
// texture's phase, vertex colours multiplied by each piece's tint. Plain arrays in, BufferGeometry out: the same
// meshes draw in WebGLRenderer and WebGPURenderer.

import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Mesh, MeshStandardMaterial, type Material } from 'three';
import type { KitPiece, LoadedKit } from './kitload.ts';

/** One placed piece. `m` is its matrix (column-major, three's order); the rest are optional per-piece edits. */
export interface KInst {
  piece: KitPiece;
  m: Float32Array;
  /** Linear multiplier on the vertex colours (all primitives, or only material `tintMat`). */
  tint?: [number, number, number];
  tintMat?: number;
  /** Draw material `from`'s primitives with material `to` (the lime-washed plaster); pairs, or one pair. */
  swap?: [number, number] | [number, number][];
  /** Texture phase (u, v) added to the piece's uvs, so a run of modules tiles without a step. */
  uo?: number; vo?: number;
  /** Leave out of the far LOD (small things). */
  near?: boolean;
  /** LOD3 (the farthest): `only` pieces are drawn there alone (the boxes that stand in for a house far off), `also`
   *  pieces are drawn there too at their LOD2 (trees over the roofs); everything else is left out. */
  lod3?: 'only' | 'also';
  /** No shadow from this piece (cards on the ground). */
  noShadow?: boolean;
}

export interface CellMeshes { meshes: Mesh[]; tris: number; verts: number; ms: number }

const _M = new Matrix4(), _N = new Matrix3();

/** The material a piece's primitive draws with, after its swaps. */
function swapped(it: KInst, mat: number): number {
  const s = it.swap;
  if (!s) return mat;
  if (typeof s[0] === 'number') return mat === s[0] ? (s as [number, number])[1] : mat;
  for (const [a, b] of s as [number, number][]) if (mat === a) return b;
  return mat;
}

/** The far LOD's single material: untextured, vertex colours (each kit material's mean albedo × its baked colour). */
export function farMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  m.name = 'M_KitFar';
  m.userData.kit = true;
  return m;
}

/**
 * Merge pieces at a LOD: the materials `keep` names get one textured mesh each; every other opaque material folds into
 * one mesh drawn with `farMat` (its mean albedo in the vertex colours); alpha-tested materials keep their own. At the far
 * LOD (2) the pieces marked `near` are left out. Returns the meshes (not yet added to anything).
 */
export function mergeCell(insts: KInst[], lod: number, kit: LoadedKit, keep: (mat: number) => boolean, farMat: Material, name: string, shadows: (mat: number) => boolean = () => true): CellMeshes {
  const job = mergeJob(insts, lod, kit, keep, farMat, name, shadows, { until: Infinity });
  let r = job.next();
  while (!r.done) r = job.next();
  return r.value;
}

/** The same merge as a job that pauses (yields) whenever the clock passes `ctl.until`, so a long build spreads over
 *  frames: the caller sets `until` and calls next() each frame until it is done. */
export function* mergeJob(insts: KInst[], lod: number, kit: LoadedKit, keep: (mat: number) => boolean, farMat: Material, name: string, shadows: (mat: number) => boolean, ctl: { until: number }, geo?: number): Generator<void, CellMeshes> {
  let busy = 0;
  const t0 = performance.now();
  const alpha = kit.matNames.map((n) => kit.json.materials[n]?.alpha ?? false);
  const FAR = -1;
  // a material keeps its own textured mesh, or folds into the one untextured mesh (alpha-tested ones always keep theirs)
  const bucketOf = (mat: number) => (alpha[mat] || keep(mat) ? mat : FAR);
  const far = lod >= 2;
  const use = (it: KInst) => (lod >= 3 ? !!it.lod3 : it.lod3 !== 'only' && !(far && it.near));
  const L = Math.min(geo ?? lod, 2); // the geometry's LOD (phones draw their near cells with LOD2's, textured)
  // pass 1: sizes per bucket
  const size = new Map<number, { v: number; i: number }>();
  for (const it of insts) {
    if (!use(it)) continue;
    for (const p of it.piece.lods[L] ?? []) {
      const mat = swapped(it, p.mat);
      const b = bucketOf(mat);
      let s = size.get(b);
      if (!s) { s = { v: 0, i: 0 }; size.set(b, s); }
      s.v += p.verts; s.i += p.idx.length;
    }
  }
  const out: Mesh[] = [];
  let tris = 0, verts = 0;
  for (const [b, s] of size) {
    if (!s.v) continue;
    const pos = new Float32Array(s.v * 3), nor = new Float32Array(s.v * 3), col = new Uint8Array(s.v * 4);
    const uv = b === FAR ? null : new Float32Array(s.v * 2);
    const idx = new Uint32Array(s.i);
    let v0 = 0, i0 = 0, cast = false;
    for (const it of insts) {
      if (!use(it)) continue;
      if (performance.now() > ctl.until) { const p0 = performance.now(); yield; busy -= performance.now() - p0; }
      const e = it.m;
      _M.fromArray(e);
      _N.getNormalMatrix(_M);
      const n = _N.elements;
      for (const p of it.piece.lods[L] ?? []) {
        const mat = swapped(it, p.mat);
        if (bucketOf(mat) !== b) continue;
        if (!it.noShadow) cast = true;
        const P = p.pos, Nn = p.nor, U = p.uv, C = p.col, I = p.idx;
        const tint = it.tint && (it.tintMat === undefined || it.tintMat === p.mat) ? it.tint : null;
        const mean = b === FAR ? kit.means[mat] : null;
        const tr = (tint ? tint[0] : 1) * (mean ? mean[0] : 1), tg = (tint ? tint[1] : 1) * (mean ? mean[1] : 1), tb = (tint ? tint[2] : 1) * (mean ? mean[2] : 1);
        const uo = it.uo ?? 0, vo = it.vo ?? 0;
        for (let k = 0; k < p.verts; k++) {
          const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
          const o = (v0 + k) * 3;
          pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
          pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          const nx = Nn[k * 3], ny = Nn[k * 3 + 1], nz = Nn[k * 3 + 2];
          let ax = n[0] * nx + n[3] * ny + n[6] * nz, ay = n[1] * nx + n[4] * ny + n[7] * nz, az = n[2] * nx + n[5] * ny + n[8] * nz;
          const l = Math.hypot(ax, ay, az) || 1;
          ax /= l; ay /= l; az /= l;
          nor[o] = ax; nor[o + 1] = ay; nor[o + 2] = az;
          if (uv) { uv[(v0 + k) * 2] = U[k * 2] + uo; uv[(v0 + k) * 2 + 1] = U[k * 2 + 1] + vo; }
          const c = (v0 + k) * 4;
          col[c] = Math.min(255, C[k * 4] * tr);
          col[c + 1] = Math.min(255, C[k * 4 + 1] * tg);
          col[c + 2] = Math.min(255, C[k * 4 + 2] * tb);
          col[c + 3] = C[k * 4 + 3];
        }
        for (let k = 0; k < I.length; k++) idx[i0 + k] = I[k] + v0;
        // a mirrored piece (negative scale) turns its triangles inside out: flip their winding back
        if (_M.determinant() < 0) for (let k = 0; k < I.length; k += 3) { const t = idx[i0 + k + 1]; idx[i0 + k + 1] = idx[i0 + k + 2]; idx[i0 + k + 2] = t; }
        v0 += p.verts; i0 += I.length;
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(nor, 3));
    if (uv) g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setAttribute('color', new BufferAttribute(col, 4, true));
    g.setIndex(new BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const m = new Mesh(g, b === FAR ? farMat : kit.materials[b]);
    m.name = `${name}-${b === FAR ? 'far' : kit.matNames[b]}`;
    m.castShadow = shadows(b) && cast; // (b is -1 for the plain mesh)
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.userData.kit = true;
    out.push(m);
    tris += s.i / 3; verts += s.v;
  }
  return { meshes: out, tris, verts, ms: performance.now() - t0 + busy };
}
