// Streets world: the river at street level. The city model's water is one flat disc at WATER_Y (lots) over a ground
// carved down into a river bed; seen from the bank it is a pale sheet. Here the river gets its own surface along the
// model's own meander: a ribbon at the same level, its colour deeper mid-stream and paler and siltier at the banks,
// ripples running downstream, a foam line where it meets the bank, and the sky in it at a low angle. The model's
// disc is hidden in this scene when the city has no sea. waterDepthAt() reads the ground's own height under the
// surface, so the runner wades exactly where the model's river bed is.

import {
  BufferAttribute, BufferGeometry, DoubleSide, type Material, Mesh, MeshLambertMaterial,
} from 'three';
import { type Layout, meander, riverDist, seaDepth } from '../../../three/city/layout.ts';
import { WATER_Y } from '../../../three/city/model.ts';

export interface River {
  mesh: Mesh | null;
  /** Water surface height (m). */
  level: number;
  depthAt(x: number, z: number): number;
  /** Distance (m) from the water's edge (negative in the water); Infinity when there is no river. */
  edgeDist(x: number, z: number): number;
  tick(t: number): void;
  dispose(): void;
}

export function river(L: Layout, LOT: number, P: number, ground: (x: number, z: number) => number, reduced: boolean): River {
  const level = WATER_Y * LOT;
  const uTime = { value: 0 };
  const R = L.river;
  const depthAt = (x: number, z: number) => {
    const lx = x / LOT, lz = z / LOT;
    const wet = (R && riverDist(L, lx, lz).d < 0.45) || (L.coast && seaDepth(L, lx, lz) > -0.8);
    if (!wet) return 0;
    return Math.max(0, level - ground(x, z));
  };
  const edgeDist = (x: number, z: number) => (R ? riverDist(L, x / LOT, z / LOT).d * LOT : Infinity);
  if (!R) return { mesh: null, level, depthAt, edgeDist, tick() {}, dispose() {} };

  // the ribbon: along the river's axis, a little wider than its bed (the banks hide the edge)
  const halfW = (R.half + 0.4) * LOT;
  const u0 = Number.isFinite(R.uMin) ? R.uMin * LOT : -P * 1.05;
  const u1 = P * 1.05;
  const step = 2;
  const nU = Math.ceil((u1 - u0) / step) + 1, nA = 9;
  const pos = new Float32Array(nU * nA * 3), uv = new Float32Array(nU * nA * 2);
  const idx: number[] = [];
  for (let i = 0; i < nU; i++) {
    const u = (u0 + i * step) / LOT;
    const m = meander(R, u);
    const cx = (R.ox + R.fx * u + R.nx * m) * LOT, cz = (R.oz + R.fz * u + R.nz * m) * LOT;
    // the local normal follows the meander's slope
    const m2 = meander(R, u + 0.05);
    let tx = R.fx + (R.nx * (m2 - m)) / 0.05, tz = R.fz + (R.nz * (m2 - m)) / 0.05;
    const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    for (let j = 0; j < nA; j++) {
      const a = (j / (nA - 1)) * 2 - 1;
      const k = (i * nA + j) * 3;
      pos[k] = cx + nx * a * halfW; pos[k + 1] = level; pos[k + 2] = cz + nz * a * halfW;
      uv[(i * nA + j) * 2] = a;
      uv[(i * nA + j) * 2 + 1] = u0 + i * step;
      if (i < nU - 1 && j < nA - 1) {
        const p0 = i * nA + j;
        idx.push(p0, p0 + 1, p0 + nA, p0 + 1, p0 + nA + 1, p0 + nA);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const halfBed = R.half * LOT;
  const mat = new MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, side: DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRv;\nvarying vec3 vRw;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRv = uv;\nvRw = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
varying vec2 vRv;
varying vec3 vRw;
float rvH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rvN(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rvH(i), rvH(i + vec2(1.0, 0.0)), u.x), mix(rvH(i + vec2(0.0, 1.0)), rvH(i + vec2(1.0, 1.0)), u.x), u.y);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float a = abs(vRv.x) * ${(halfW / halfBed).toFixed(3)};   // 1 at the bed's edge
  float s = vRv.y;
  float flow = rvN(vec2(s * 0.22 - uTime * 0.55, vRv.x * 2.6)) * 0.6 + rvN(vec2(s * 0.9 - uTime * 1.25, vRv.x * 7.0 + 3.0)) * 0.4;
  vec3 deep = vec3(0.16, 0.27, 0.27), shallow = vec3(0.42, 0.45, 0.36), silt = vec3(0.55, 0.5, 0.38);
  vec3 col = mix(deep, shallow, smoothstep(0.15, 0.95, a));
  col = mix(col, silt, smoothstep(0.85, 1.05, a) * 0.6);
  col *= 0.9 + 0.22 * flow;
  // the sky at a low angle
  vec3 v = normalize(cameraPosition - vRw);
  float fres = pow(1.0 - clamp(v.y, 0.0, 1.0), 4.0);
  col = mix(col, vec3(0.78, 0.82, 0.83), fres * 0.55);
  // glints and foam
  float glint = smoothstep(0.83, 0.97, rvN(vec2(s * 2.3 - uTime * 1.6, vRv.x * 18.0))) * (0.3 + 0.7 * fres);
  float foam = smoothstep(0.88, 0.98, a) * (1.0 - smoothstep(1.02, 1.12, a)) * (0.5 + 0.5 * rvN(vec2(s * 1.4 - uTime * 0.8, 1.0)));
  col = mix(col, vec3(0.92, 0.9, 0.84), clamp(glint * 0.5 + foam * 0.55, 0.0, 1.0));
  diffuseColor.rgb = col;
  diffuseColor.a = mix(0.9, 0.62, smoothstep(0.7, 1.1, a)) * (1.0 - smoothstep(1.12, 1.3, a));
}`);
  };
  mat.customProgramCacheKey = () => 'streets-river-v1';
  const mesh = new Mesh(g, mat);
  mesh.name = 'river';
  mesh.renderOrder = 2;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return {
    mesh, level, depthAt, edgeDist,
    tick(t: number) { uTime.value = reduced ? 3 : t; },
    dispose() { g.dispose(); (mat as Material).dispose(); },
  };
}
