// Streets world: what things look like up close. The city's parts are flat vertex colour, made to be seen from above;
// at walking scale they read as plastic. Here, in this scene only, the walls get a procedural mud-plaster skin in world
// space: mottled plaster, patches flaked off to the mud bricks under it, rain streaks under the roof line, a splashed
// and darker foot, and packed mud with straw on the roofs. The ground gets flagstones on the temple square, grit and
// wheel-worn lanes. All of it is shader code (no texture files), faded out with distance so it does not shimmer.

import {
  CanvasTexture, DoubleSide, type Material, MeshBasicMaterial, MeshLambertMaterial, SRGBColorSpace,
  type WebGLProgramParametersWithUniforms,
} from 'three';

const NOISE = /* glsl */ `
float stH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float stN(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(stH(i), stH(i + vec2(1.0, 0.0)), u.x), mix(stH(i + vec2(0.0, 1.0)), stH(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

/** Patch a Lambert material (vertex colours, flat shading) with the mud-plaster skin. `key` keeps programs apart. */
export function mudSkin<M extends MeshLambertMaterial>(mat: M, key: string, opts: { brick?: number } = {}): M {
  const brick = (opts.brick ?? 1).toFixed(2);
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms, r) => {
    prev.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 w = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  w = instanceMatrix * w;
#endif
  vStW = (modelMatrix * w).xyz;
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vStW;\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 n = normalize(cross(dFdx(vStW), dFdy(vStW)));
  float up = abs(n.y);
  float side = 1.0 - smoothstep(0.35, 0.7, up);
  // along the face and up it (walls); across the roof (roofs)
  vec2 hp = vec2(dot(vStW.xz, normalize(vec2(-n.z, n.x) + 1e-5)), vStW.y);
  vec2 rp = vStW.xz;
  vec2 p = mix(rp, hp, side);
  float fw = length(fwidth(p));
  float near = 1.0 - smoothstep(0.03, 0.16, fw);
  float mid = 1.0 - smoothstep(0.2, 0.9, fw);
  float big = stN(p * vec2(0.28, 0.45) + 1.7);
  float m = big * 0.55 + stN(p * 1.6 + 3.1) * 0.3 + stN(p * 5.3 + 9.2) * 0.15 * mid;
  float k = 0.86 + 0.22 * m;
  // plaster flaked off in ragged patches: the mud bricks show (courses 0.22 m, bricks 0.46 m, every other course
  // offset), with a lighter lip of plaster round each patch
  float fm = stN(p * vec2(0.42, 0.66) + 11.0) * 0.72 + stN(p * vec2(2.1, 2.6) + 5.0) * 0.28;
  float flake = smoothstep(0.665, 0.69, fm) * side * near * ${brick};
  float lip = (smoothstep(0.635, 0.665, fm) - flake) * side * near * ${brick};
  float row = floor(p.y / 0.22);
  float bx = fract(p.x / 0.46 + 0.5 * mod(row, 2.0));
  float by = fract(p.y / 0.22);
  float joint = max(max(smoothstep(0.92, 0.97, bx), smoothstep(0.08, 0.03, bx)), smoothstep(0.86, 0.95, by));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.02, 0.9, 0.8) * (0.92 + 0.1 * stH(vec2(floor(p.x / 0.46 + 0.5 * mod(row, 2.0)), row))), flake);
  k *= 1.0 - flake * joint * 0.2 + lip * 0.07;
  // rain streaks and soot, hanging from above
  float streak = stN(vec2(p.x * 2.6, p.y * 0.18 + 4.0));
  k *= 1.0 - side * 0.09 * smoothstep(0.55, 0.85, streak) * mid;
  // the foot: splashed, damp and dusty, with a ragged edge
  float footH = 0.45 + 0.35 * stN(vec2(p.x * 0.9, 1.3));
  float foot = (1.0 - smoothstep(footH - 0.2, footH + 0.1, vStW.y)) * side;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 0.72, 0.66), foot * 0.75);
  // roofs: packed mud, patched and re-laid, with a fine grit
  float roof = 1.0 - side;
  k *= 1.0 + roof * ((stN(rp * 0.9 + 2.0) - 0.5) * 0.12 + (stN(rp * 6.5) - 0.5) * 0.07 * near);
  diffuseColor.rgb *= k;
}`);
  };
  mat.customProgramCacheKey = () => `${prevKey}+mud-${key}-${brick}`;
  mat.needsUpdate = true;
  return mat;
}

/** The city's painted ground, at walking scale: mottle and grit (as step 1), flagstones on the temple square, and
 *  darker, worn earth along the main roads. Wraps the ground material's own shader edit, on this model's instance. */
export function groundSkin(mat: MeshLambertMaterial, LOT: number, roads: number[]) {
  const prev = mat.onBeforeCompile;
  const key = mat.customProgramCacheKey();
  const rd = roads.slice(0, 8);
  while (rd.length < 8) rd.push(-100);
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    if (!sh.fragmentShader.includes('varying vec3 vLot;')) return;
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `${NOISE}
const float ROADS[8] = float[8](${rd.map((a) => a.toFixed(5)).join(', ')});
void main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 w = vLot.xz * ${LOT.toFixed(1)};
  float fw = fwidth(w.x) + fwidth(w.y);
  float near = 1.0 - smoothstep(0.05, 0.35, fw);
  float blot = stN(w * 0.3) * 0.65 + stN(w * 0.9 + 7.1) * 0.35;
  float grain = (stN(w * 3.1 + 3.3) - 0.5) * near;
  diffuseColor.rgb *= 0.86 + 0.26 * blot + 0.16 * grain;
  float r = length(vLot.xz);
  // the temple square: flagstones in courses, each its own shade, with dark joints
  float sq = (1.0 - smoothstep(uPlazaR - 0.12, uPlazaR + 0.02, r)) * step(-0.05, vLot.y);
  if (sq > 0.0) {
    float course = floor(w.y / 1.1);
    vec2 sp = vec2(w.x / 1.5 + stH(vec2(course, 3.0)) * 0.9, w.y / 1.1);
    vec2 cell = floor(sp);
    vec2 f = fract(sp);
    float joint = 1.0 - smoothstep(0.0, 0.05, min(min(f.x, 1.0 - f.x) * 1.5, min(f.y, 1.0 - f.y) * 1.1));
    float tint = 0.9 + 0.16 * stH(cell + 0.37);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * tint * (1.0 - 0.28 * joint * (0.4 + 0.6 * near)), sq);
  }
  // main roads: worn darker down the middle, with a pair of wheel ruts
  float lane = 0.0, ruts = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = ROADS[i];
    if (a < -50.0) continue;
    vec2 d = vec2(cos(a), sin(a));
    float along = dot(vLot.xz, d);
    if (along < uPlazaR + 0.3) continue;
    float perp = abs(dot(vLot.xz, vec2(-d.y, d.x))) * ${LOT.toFixed(1)};
    lane = max(lane, 1.0 - smoothstep(1.4, 3.2, perp + (stN(w * 0.4) - 0.5) * 1.2));
    ruts = max(ruts, (1.0 - smoothstep(0.05, 0.22, abs(perp - 0.75))) * near);
  }
  diffuseColor.rgb *= 1.0 - 0.07 * lane - 0.12 * ruts * lane;
  // pebbles and potsherds trodden into the earth (not on the flagstones)
  vec2 pc = w * 2.2;
  vec2 ci = floor(pc), cf = fract(pc);
  vec2 off = vec2(stH(ci), stH(ci + 17.3)) * 0.6 + 0.2;
  float rr = 0.07 + 0.1 * stH(ci + 3.1);
  float peb = (1.0 - smoothstep(rr * 0.7, rr, length(cf - off))) * step(0.6, stH(ci + 9.7)) * near * (1.0 - sq);
  float tone = stH(ci + 5.3) > 0.45 ? 1.13 : 0.8;
  diffuseColor.rgb *= mix(1.0, tone, peb * 0.75);
}`);
  };
  mat.customProgramCacheKey = () => `${key}+streets-ground-v3`;
  mat.needsUpdate = true;
}

/** A soft dark rectangle (for contact shadows under houses and things): white in the middle fading to the edge. */
export function softRect(): CanvasTexture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = Math.abs((x + 0.5) / S - 0.5) * 2, v = Math.abs((y + 0.5) / S - 0.5) * 2;
      const d = Math.max(u, v);
      const a = d < 0.62 ? 1 : Math.max(0, 1 - (d - 0.62) / 0.38);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * a * a);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function contactMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: 0x2a1d12, map: softRect(), transparent: true, opacity: 0.42, depthWrite: false, side: DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

/** Plain parts (timber, cloth, pottery): Lambert, vertex colours, flat. */
export function plainMaterial(): MeshLambertMaterial {
  return new MeshLambertMaterial({ vertexColors: true, flatShading: true });
}

export function disposeMaterial(m: Material) {
  const mm = m as MeshBasicMaterial;
  mm.map?.dispose();
  m.dispose();
}
