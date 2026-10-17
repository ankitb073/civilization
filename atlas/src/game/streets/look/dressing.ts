// Look: what makes the streets look lived in, drawn procedurally (no textures):
// - decals at every door and window the streets layer drew: soot from the hearths inside, blackening the wall above
//   the lintel in a widening plume; grime where hands touch the jambs; a splashed, darker foot. One instanced mesh of
//   quads with multiply blending (they darken the lit wall under them).
// - reeds along the river banks, in clumps where the ground meets the water, swaying in the wind. One instanced mesh.
// Placement is deterministic (hashes of position), as the streets layer's own.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { BufferAttribute, BufferGeometry, DoubleSide, InstancedBufferAttribute, InstancedMesh, Matrix4, MultiplyBlending, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import * as tslAll from 'three/tsl';
import type { StreetsCity } from '../world.ts';
import type { Opening } from './surfaces.ts';
import { lookUniforms } from './materials.ts';

const { abs, attribute, cos, exp, float, instanceIndex, max, mix, mx_noise_float, positionLocal, sin, smoothstep, uv, vec2, vec3 } = tslAll as any;

const h2 = (x: number, z: number, k = 0) => { const s = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };

export interface Dressing { decals: InstancedMesh | null; reeds: InstancedMesh | null; stats: Record<string, number>; dispose(): void }

export function dressing(city: StreetsCity, openings: Opening[], opts: { reeds: number }): Dressing {
  const stats: Record<string, number> = {};
  // ---------------------------------------------------------------- soot and grime round openings
  let decals: InstancedMesh | null = null;
  if (openings.length) {
    const g = new PlaneGeometry(1, 1);
    // per instance: the opening's width and height, and the decal's (all metres)
    const n = openings.length * 2;
    const dimA = new Float32Array(n * 4);
    const m = new MeshBasicNodeMaterial();
    m.transparent = true;
    m.depthWrite = false;
    m.blending = MultiplyBlending;
    m.premultipliedAlpha = true;
    m.side = DoubleSide;
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
    const dim: any = attribute('aOpen', 'vec4');
    const ow = dim.x, oh = dim.y, W = dim.z, H = dim.w;
    const p = uv().sub(0.5).mul(vec2(W, H));
    // the opening's centre sits 0.45 m below the decal's centre
    const dx = abs(p.x), dy = p.y.add(0.45);
    const above = dy.sub(oh.mul(0.5));
    const n1 = mx_noise_float(vec2(p.x.mul(2.3), p.y.mul(1.4)).add(dim.x.mul(7.0))).mul(0.5).add(0.5);
    const n2 = mx_noise_float(vec2(p.x.mul(7.0), p.y.mul(5.0)).add(3.1)).mul(0.5).add(0.5);
    // soot: a plume widening upward from the lintel
    const plumeW = ow.mul(0.5).add(0.1).add(max(above, 0).mul(0.35));
    const soot = smoothstep(-0.05, 0.08, above).mul(exp(max(above, 0).mul(-0.85))).mul(float(1).sub(smoothstep(plumeW.mul(0.55), plumeW, dx))).mul(n1.mul(0.7).add(0.45));
    // grime on the jambs, about hand height, and a darker splashed foot
    const jamb = smoothstep(ow.mul(0.5).sub(0.02), ow.mul(0.5).add(0.04), dx).mul(float(1).sub(smoothstep(ow.mul(0.5).add(0.12), ow.mul(0.5).add(0.32), dx)));
    const hand = jamb.mul(smoothstep(oh.mul(-0.5).add(0.5), oh.mul(-0.5).add(0.8), dy)).mul(float(1).sub(smoothstep(oh.mul(-0.5).add(1.4), oh.mul(-0.5).add(1.7), dy))).mul(n2.mul(0.8).add(0.2));
    const foot = float(1).sub(smoothstep(oh.mul(-0.5).add(0.05), oh.mul(-0.5).add(0.45), dy)).mul(float(1).sub(smoothstep(ow.mul(0.5).add(0.2), ow.mul(0.5).add(0.6), dx))).mul(n1);
    // nothing inside the opening itself; windows soot less
    const inside = float(1).sub(smoothstep(ow.mul(0.5).sub(0.03), ow.mul(0.5), dx)).mul(float(1).sub(smoothstep(oh.mul(0.5).sub(0.03), oh.mul(0.5), abs(dy))));
    const win = float(1).sub(smoothstep(0.6, 1.2, oh));
    const k = soot.mul(mix(0.95, 0.6, win)).add(hand.mul(0.35)).add(foot.mul(0.3)).mul(float(1).sub(inside)).min(0.9);
    m.colorNode = mix(vec3(1, 1, 1), vec3(0.16, 0.13, 0.11), k);
    decals = new InstancedMesh(g, m, n);
    const M = new Matrix4(), q = new Quaternion(), s = new Vector3(), pos = new Vector3(), X = new Vector3(), Y = new Vector3(0, 1, 0), Z = new Vector3();
    let i = 0;
    for (const o of openings) {
      const W0 = o.w + 1.0, H0 = o.h + 1.5;
      X.set(o.ax[0], o.ax[1], o.ax[2]).normalize();
      Z.set(o.nz[0], o.nz[1], o.nz[2]).normalize();
      M.makeBasis(X, Y, Z);
      q.setFromRotationMatrix(M);
      // one on each face of the slab: the one inside the wall is hidden by it
      for (const side of [1, -1]) {
        pos.set(o.x, o.y + 0.45, o.z).addScaledVector(Z, side * (o.t * 0.5 + 0.012));
        s.set(W0, H0, 1);
        M.compose(pos, q, s);
        decals.setMatrixAt(i, M);
        dimA.set([o.w, o.h, W0, H0], i * 4);
        i++;
      }
    }
    g.setAttribute('aOpen', new InstancedBufferAttribute(dimA, 4));
    decals.count = i;
    decals.frustumCulled = false;
    decals.renderOrder = 2;
    decals.name = 'look-decals';
    stats.decals = i;
  }

  // ---------------------------------------------------------------- reeds along the banks
  let reeds: InstancedMesh | null = null;
  if (opts.reeds > 0 && city.river.name !== undefined && city.layer.river.mesh) {
    const level = city.river.level;
    const spots: [number, number, number, number][] = [];
    const P = city.P;
    const step = 0.85;
    for (let x = -P; x <= P; x += step) {
      for (let z = -P; z <= P; z += step) {
        const jx = x + (h2(x, z) - 0.5) * step, jz = z + (h2(x, z, 1) - 0.5) * step;
        const e = city.river.edgeDist(jx, jz);
        if (e < -1.1 || e > 0.8) continue;
        const gy = city.heightAt(jx, jz);
        if (gy < level - 0.45 || gy > level + 0.55) continue;
        // in clumps: a coarse noise decides where reeds grow, a fine hash thins them
        const clump = Math.sin(jx * 0.31 + Math.sin(jz * 0.17) * 2.1) * Math.sin(jz * 0.27 + Math.cos(jx * 0.13) * 1.7);
        if (clump < 0.05 || h2(jx, jz, 2) > opts.reeds) continue;
        if (city.plan.bridges.some((b) => Math.hypot(b.x - jx, b.z - jz) < Math.max(b.hw, b.hd) + 1.5)) continue;
        spots.push([jx, gy, jz, h2(jx, jz, 3)]);
      }
    }
    const geo = reedClump();
    const mat = new MeshStandardNodeMaterial();
    mat.vertexColors = true;
    mat.side = DoubleSide;
    mat.roughnessNode = float(0.7);
    mat.metalnessNode = float(0);
    // wind: the blades sway with height (local y), each clump in its own phase
    const ph = instanceIndex.toFloat().mul(1.731);
    const y = positionLocal.y;
    const sway = y.mul(y).mul(0.06);
    const t = lookUniforms.time;
    mat.positionNode = positionLocal.add(vec3(sin(t.mul(1.6).add(ph)).mul(sway), 0, cos(t.mul(1.3).add(ph.mul(0.7))).mul(sway.mul(0.6))));
    mat.colorNode = vec3(1, 1, 1).mul(lookUniforms.albedoK);
    reeds = new InstancedMesh(geo, mat, Math.max(1, spots.length));
    const M = new Matrix4(), q = new Quaternion(), s = new Vector3(), pos = new Vector3();
    spots.forEach(([x, gy, z, r], i) => {
      q.setFromAxisAngle(new Vector3(0, 1, 0), r * Math.PI * 2);
      const k = 0.7 + r * 0.6;
      s.set(k, k * (0.85 + h2(x, z, 4) * 0.4), k);
      pos.set(x, Math.max(gy, level - 0.3), z);
      M.compose(pos, q, s);
      reeds!.setMatrixAt(i, M);
    });
    reeds.count = spots.length;
    reeds.castShadow = true;
    reeds.receiveShadow = true;
    reeds.name = 'look-reeds';
    stats.reedClumps = spots.length;
    stats.reedTriangles = spots.length * (geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3);
  }
  return {
    decals, reeds, stats,
    dispose() {
      if (decals) { decals.geometry.dispose(); (decals.material as any).dispose(); decals.dispose(); }
      if (reeds) { reeds.geometry.dispose(); (reeds.material as any).dispose(); reeds.dispose(); }
    },
  };
}

/** A clump of reeds: nine tapered, bending blades (four segments each), green at the foot, straw at the tips. */
function reedClump(): BufferGeometry {
  const pos: number[] = [], col: number[] = [], nor: number[] = [], idx: number[] = [];
  const blades = 9, segs = 4;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + h2(b, 1) * 0.8;
    const r0 = 0.04 + h2(b, 2) * 0.12;
    const bx = Math.cos(a) * r0, bz = Math.sin(a) * r0;
    const H = 1.1 + h2(b, 3) * 0.9;
    const lean = 0.12 + h2(b, 4) * 0.3;
    const lx = Math.cos(a + 0.4), lz = Math.sin(a + 0.4);
    const w0 = 0.028 + h2(b, 5) * 0.015;
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const y = H * t;
      const off = lean * t * t;
      const cx = bx + lx * off, cz = bz + lz * off;
      const w = w0 * (1 - t * 0.92);
      // the blade's flat side faces sideways to its lean
      const px = -lz * w, pz = lx * w;
      pos.push(cx - px, y, cz - pz, cx + px, y, cz + pz);
      const g = [0.22 + 0.5 * t * t, 0.27 + 0.36 * t * t, 0.11 + 0.18 * t * t];
      col.push(...g, ...g);
      nor.push(lx * 0.3, 1, lz * 0.3, lx * 0.3, 1, lz * 0.3);
    }
    for (let i = 0; i < segs; i++) {
      const a0 = base + i * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  g.normalizeNormals();
  return g;
}
