// Look: physically based materials for the streets, in TSL (three's node shading language), so they compile to WGSL on
// WebGPU and to GLSL on the WebGL2 fallback. No mesh needs UVs: every surface is projected by its own face (walls take
// u along the wall and v up it, roofs and ground take x and z), so one scan covers a whole street without a seam,
// and the tangent frame is known exactly for normal mapping and parallax.
//
// - masonry: mud plaster over mud brick. The plaster flakes off in patches (more at the foot, where damp rises, at
//   corners and along the top), showing brick under it; edges are rounded (a shading bevel), the foot is damp and
//   splashed, rain streaks hang from the top, plaster cracks in places, and roofs are packed mud. Monuments get
//   dressed stone; whitewashed parts lime plaster.
// - props: timber, cloth, reed, terracotta, stone, bronze, grain and leaves, each from its own scan.
// - ground: packed earth with flagstones on the temple square (with parallax on desktop), worn ruts on the main
//   roads, and damp earth by the water.
// The record's colours stay: each scan is divided by its own mean colour, so the part's colour (the city model's
// instance colour or the streets layer's vertex colour, both from the record) tints it.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Vector3 } from 'three';
import { MeshStandardNodeMaterial, type Texture } from 'three/webgpu';
import * as tslAll from 'three/tsl';
// TSL's type definitions reject much valid TSL (vector/scalar mixing); shader errors surface when it compiles.
const {Fn, If, Loop, abs, attribute, normalGeometry, cameraPosition, cameraViewMatrix, clamp, cos, cross, dFdx, dFdy, dot, exp, float, floor, fract, int, length, max, min, mix, mx_fractal_noise_float, mx_noise_float, mx_worley_noise_vec2, normalWorldGeometry, normalize, positionGeometry, positionWorld, pow, select, sign, sin, smoothstep, sqrt, step, texture, uniform, uniformArray, uv, vec2, vec3, vec4,} = tslAll as any;
import { HERO_KEYS, layerOf, MATERIAL_KEYS, TILE, type MaterialKey } from './textures.ts';
import { S } from './surfaces.ts';

type N = any;

export interface LookQuality {
  /** Parallax occlusion steps on paving and exposed brick (0: none). */
  parallax: number;
  /** Fine detail (cracks, streaks, grit) and the bevel; off on the lowest tier. */
  detail: boolean;
  /** Metres beyond which micro detail fades out. */
  detailFar: number;
}

/** Uniforms every look material shares. */
export const lookUniforms = {
  sunDir: uniform(vec3(-0.6, 0.6, 0.4)),
  time: uniform(0),
  /** Overall albedo scale (exposure of the scans against the record's colours). */
  albedoK: uniform(1),
};

/** The texture slots every look material samples: one base texture node per array (the hero arrays: the five
 *  surfaces seen closest; the full arrays: every material, in MATERIAL_KEYS order, the hero layers first). They start
 *  as placeholders and the streamed sets are swapped in (`slot.value = texture`) with no shader rebuilt. */
export interface Slots { heroAlb: N; heroData: N; fullAlb: N; fullData: N; means: number[][] }
export function makeSlots(start: { albedo: Texture; data: Texture }, means: number[][]): Slots {
  return { heroAlb: texture(start.albedo), heroData: texture(start.data), fullAlb: texture(start.albedo), fullData: texture(start.data), means };
}
/** Which slots (and layer) hold a material: the hero slots for the hero keys when the material may use them. */
function where(a: Slots, key: MaterialKey, heroOk: boolean): { alb: N; data: N; layer: number; mean: N } {
  const hero = heroOk && (HERO_KEYS as readonly string[]).includes(key);
  const layer = layerOf(key);
  const m = a.means[layer];
  return { alb: hero ? a.heroAlb : a.fullAlb, data: hero ? a.heroData : a.fullData, layer, mean: vec3(m[0], m[1], m[2]) };
}

interface Sample { alb: N; nxy: N; rough: N; h: N }
function sampleAt(w: { alb: N; data: N }, layer: N, uvN: N): Sample {
  const li = typeof layer === 'number' ? int(layer) : layer;
  const a = w.alb.sample(uvN).depth(li);
  const d = w.data.sample(uvN).depth(li);
  return { alb: a.rgb, nxy: d.xy.mul(2).sub(1), rough: d.z, h: d.w };
}

/** Flat world normal from screen derivatives, turned to agree with the geometry normal (the sign of a derivative
 *  cross product differs between WebGPU and WebGL). */
function flatNormal(): N {
  const n = normalize(cross(dFdx(positionWorld), dFdy(positionWorld)));
  return n.mul(sign(dot(n, normalWorldGeometry)).add(0.0001)).normalize();
}

/** The face's tangent frame: walls take T along the wall (horizontal) and B straight up; tops take x and -z. The
 *  normal must be exact per face (a box's vertex normal), not a screen-derivative normal: far from the origin the
 *  derivatives' rounding turns T a little from pixel to pixel, and dot(P, T) then changes by centimetres per pixel,
 *  so the GPU picks a blurry mip. */
function faceFrame(n: N): { T: N; B: N; top: N } {
  const top = step(0.7, abs(n.y));
  const Ts = normalize(vec3(n.z, 0, n.x.negate()).add(vec3(0.00001, 0, 0)));
  const T = mix(Ts, vec3(1, 0, 0), top);
  const B = mix(vec3(0, 1, 0), vec3(0, 0, -1), top);
  return { T, B, top };
}
/** Texture coordinates for metres along T and B: the image's top toward +B (the arrays are not flipped), so the
 *  normal map's +y is +B. */
const uvOf = (u: N, v: N) => vec2(u, v.negate());

/** World-space normal from a tangent-space normal (xy from the map) in the frame (T, B, N). */
function perturb(nxy: N, T: N, B: N, Nn: N, strength: N | number): N {
  const xy = nxy.mul(strength);
  const z = sqrt(clamp(float(1).sub(dot(xy, xy)), 0.0, 1.0));
  return normalize(T.mul(xy.x).add(B.mul(xy.y)).add(Nn.mul(z)));
}
const toView = (nW: N) => normalize(cameraViewMatrix.mul(vec4(nW, 0)).xyz);

/** Parallax occlusion: march the view ray into the height field (height 1 = surface) and return the offset uv. */
function parallax(data: N, layer: number, uv0: N, T: N, B: N, Nn: N, scale: number, steps: number, fade: N): N {
  const V = normalize(cameraPosition.sub(positionWorld));
  const vt = vec3(dot(V, T), dot(V, B).negate(), max(dot(V, Nn), 0.08));
  const delta = vt.xy.div(vt.z).mul(scale).mul(fade).div(steps);
  const cur = vec2(uv0).toVar();
  const depth = float(0).toVar();
  const stepD = float(1 / steps);
  const prevH = float(1).toVar();
  const hit = float(0).toVar();
  Loop(steps, () => {
    const h = data.sample(cur).depth(int(layer)).w;
    If(hit.lessThan(0.5).and(float(1).sub(depth).greaterThan(h)), () => {
      prevH.assign(h);
      cur.subAssign(delta);
      depth.addAssign(stepD);
    }).Else(() => { hit.assign(1); });
  });
  return cur;
}

/** A rectangle on the ground (metres): centre, half sizes, turn about the vertical (as the plan's footprints). */
export interface GroundRect { x: number; z: number; hw: number; hd: number; rot: number }

/** The town's ground: packed earth, the colour of the record's painted ground pulled to the earth of a mud-brick town
 *  (dry, warm, not bright), trodden darker and smoother down the main roads with two wheel ruts, lighter dust blown in
 *  drifts, damp and dark by the river, silt under it. Flagstones only in the temple's court (a ragged-edged rectangle
 *  round the temple), with dust packed into their joints and parallax on desktop; the market and the rest of the
 *  square are earth. */
export function groundMaterial(a: Slots, q: LookQuality, opts: { map: Texture | null; LOT: number; plazaR: number; roads: number[]; waterLevel: number; court: GroundRect | null }): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial();
  const P = positionWorld;
  const dist = length(P.sub(cameraPosition));
  const fade = float(1).sub(smoothstep(q.detailFar * 0.5, q.detailFar, dist));
  const earth = where(a, 'earth', true), pave = where(a, 'paving', true);
  const uvE = uvOf(P.x, P.z.negate()).div(TILE.earth);
  // break the earth's tiling with a second, rotated, larger sample, blended by a macro noise
  const uvE2 = vec2(P.x.mul(0.8).sub(P.z.mul(0.6)), P.x.mul(0.6).add(P.z.mul(0.8))).div(TILE.earth * 3.1);
  // the temple's court: inside its rectangle grown by a few metres, the edge ragged where earth has drifted over it
  let court: N = float(0);
  if (opts.court) {
    const c = opts.court, cs = Math.cos(c.rot), sn = Math.sin(c.rot);
    const dx = P.x.sub(c.x), dz = P.z.sub(c.z);
    const u = abs(dx.mul(cs).sub(dz.mul(sn))).sub(c.hw), w = abs(dx.mul(sn).add(dz.mul(cs))).sub(c.hd);
    const out = max(u, w).add(mx_noise_float(P.xz.mul(0.35)).mul(0.9)).add(mx_noise_float(P.xz.mul(1.7)).mul(0.25));
    court = float(1).sub(smoothstep(-0.15, 0.15, out));
  }
  const T = vec3(1, 0, 0), B = vec3(0, 0, -1), Nn = vec3(0, 1, 0);
  // flagstones: big irregular slabs, laid at an angle to the court so their joints do not run with the axes
  const pr = Math.PI * 0.11, pc = Math.cos(pr), ps = Math.sin(pr);
  let uvP: N = vec2(P.x.mul(pc).sub(P.z.mul(ps)), P.x.mul(ps).add(P.z.mul(pc)).negate()).div(TILE.paving);
  if (q.parallax > 0 && opts.court) uvP = parallax(pave.data, pave.layer, uvP, T, B, Nn, 0.03, q.parallax, fade.mul(court));
  const e = sampleAt(earth, earth.layer, uvE), e2 = sampleAt(earth, earth.layer, uvE2), p = sampleAt(pave, pave.layer, uvP);
  const macro = mx_fractal_noise_float(P.xz.mul(0.045), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const eMix = smoothstep(0.35, 0.65, macro);
  const eAlb = mix(e.alb.div(earth.mean), e2.alb.div(earth.mean), eMix.mul(0.6));
  const pAlb = p.alb.div(pave.mean);
  // the record's painted ground (linear), pulled to dry earth: the hue kept, the saturation and brightness of packed
  // mud (an albedo of about 0.3; the painted map is a bright diorama colour)
  const paint0 = opts.map ? texture(opts.map, uv()).rgb : vec3(0.55, 0.42, 0.26);
  const pl = dot(paint0, vec3(0.3, 0.55, 0.15));
  const earthTone = mix(vec3(0.34, 0.232, 0.132), paint0.div(max(pl, 0.05)).mul(0.25), 0.3).mul(macro.mul(0.22).add(0.89));
  // drifts of lighter, greyer dust (wind-blown, in the lee of walls and over the lanes' edges)
  const dustN = mx_fractal_noise_float(P.xz.mul(0.16).add(vec2(13.0, 7.0)), 3, 2.0, 0.55).mul(0.5).add(0.5);
  const dust = smoothstep(0.52, 0.74, dustN).mul(0.5);
  // main roads: trodden darker and smoother down the middle, with a pair of wheel ruts that dip (their normal turns)
  let lane: N = float(0), ruts: N = float(0), rutSlope: N = vec2(0, 0);
  for (const ang of opts.roads.slice(0, 8)) {
    const d = vec2(Math.cos(ang), Math.sin(ang)), nP = vec2(-Math.sin(ang), Math.cos(ang));
    const along = dot(P.xz, d);
    const side = dot(P.xz, nP);
    const perp = abs(side);
    const on = step(opts.plazaR + 3, along);
    lane = max(lane, float(1).sub(smoothstep(1.6, 3.6, perp.add(mx_noise_float(P.xz.mul(0.3)).mul(1.2)))).mul(on));
    const wob = mx_noise_float(vec2(along.mul(0.21), ang * 7.0)).mul(0.07);
    const r0 = perp.sub(0.78).add(wob);
    const rut = exp(r0.mul(r0).mul(-55)).mul(on).mul(fade);
    ruts = max(ruts, rut);
    // the rut's slope across the road: d(-depth)/d(perp), turned to world xz
    rutSlope = rutSlope.add(nP.mul(sign(side)).mul(r0.mul(110).mul(rut).mul(0.035)));
  }
  // damp earth by the water: dark and smoother within a metre of the water level; below it, the river's silt
  const damp = float(1).sub(smoothstep(opts.waterLevel + 0.15, opts.waterLevel + 1.1, P.y));
  const bed = float(1).sub(smoothstep(opts.waterLevel - 0.35, opts.waterLevel + 0.05, P.y));
  let ground: N = mix(earthTone, vec3(0.2, 0.17, 0.12), bed);
  ground = mix(ground, ground.mul(vec3(1.14, 1.08, 1.0)).add(vec3(0.012, 0.01, 0.008)), dust.mul(float(1).sub(lane.mul(0.6))).mul(float(1).sub(damp)));
  ground = ground.mul(float(1).sub(lane.mul(0.12)).sub(ruts.mul(0.22)));
  ground = ground.mul(mix(1, 0.58, damp));
  // flagstones: warm limestone, each slab its own shade (the scan's), dust packed into the joints (where it is low)
  const joint = float(1).sub(smoothstep(0.22, 0.5, p.h));
  const stoneTone = vec3(0.43, 0.35, 0.235).mul(macro.mul(0.16).add(0.92));
  // the scan's own contrast halved (worn, dusty slabs, not a crazed pavement)
  const flag = mix(mix(vec3(1, 1, 1), pAlb, 0.55).mul(stoneTone), eAlb.mul(earthTone).mul(1.05), joint.mul(0.85));
  let alb: N = mix(eAlb.mul(ground), flag.mul(mix(1, 0.6, damp)), court);
  m.colorNode = alb.mul(lookUniforms.albedoK);
  // normals: the earth's two samples, the flagstones' (flat in the joints' dust), the ruts' dip
  let nxy: N = mix(mix(e.nxy, e2.nxy, eMix.mul(0.6)), mix(p.nxy, e.nxy, joint.mul(0.7)), court);
  nxy = nxy.add(vec2(rutSlope.x, rutSlope.y.negate()).mul(float(1).sub(court)));
  m.normalNode = toView(perturb(nxy, T, B, Nn, mix(1.0, 0.55, float(1).sub(fade))));
  const roughE = mix(mix(e.rough, e2.rough, eMix.mul(0.6)).mul(1.06), 0.97, dust.mul(0.5)).sub(lane.mul(0.05)).sub(ruts.mul(0.08));
  m.roughnessNode = clamp(mix(mix(roughE, mix(p.rough, e.rough, joint), court), 0.4, max(damp.mul(0.85), bed)), 0.3, 1);
  m.metalnessNode = float(0);
  ;(m as any).lookKind = 'ground';
  return m;
}

/** Edge distances of a box face and the outward direction of the nearest edge (a shading bevel). */
function boxEdges(loc: N, dim: N, yaw: N, nf: N) {
  const Xl = vec3(cos(yaw), 0, sin(yaw).negate());
  const Zl = vec3(sin(yaw), 0, cos(yaw));
  const lx = loc.x, ly = loc.y, lz = loc.z;
  const top = step(0.7, abs(nf.y));
  const xFace = step(abs(lz), abs(lx));
  // on a side face: the vertical edges along the face, and the top edge
  const inPlane = mix(lx, lz, xFace);
  const inSize = mix(dim.x, dim.z, xFace);
  const eSide = float(0.5).sub(abs(inPlane)).mul(inSize);
  const outSide = mix(Xl, Zl, xFace).mul(sign(inPlane));
  const eTop = float(1).sub(ly).mul(dim.y);
  // on a top face: the four edges around it
  const ex = float(0.5).sub(abs(lx)).mul(dim.x), ez = float(0.5).sub(abs(lz)).mul(dim.z);
  const eT = min(ex, ez);
  const outT = select(ex.lessThan(ez), Xl.mul(sign(lx)), Zl.mul(sign(lz)));
  const e = mix(min(eSide, eTop), eT, top);
  const out = mix(select(eSide.lessThan(eTop), outSide, vec3(0, 1, 0)), outT, top);
  return { e, out, eSide, eTop, foot: ly.mul(dim.y), top };
}

/** Mud plaster over mud brick (city boxes and the streets layer's mud parts); stone and lime plaster on monuments. */
export function masonryMaterial(a: Slots, q: LookQuality, src: 'city' | 'kit'): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial();
  if (src === 'kit') m.vertexColors = true;
  const P = positionWorld;
  const dim: N = attribute('aDim', 'vec4');
  const box: N = src === 'city' ? vec4(positionGeometry, attribute('aYaw', 'float')) : attribute('aBox', 'vec4');
  const surf = dim.w;
  const isMon = step(abs(surf.sub(S.monument)), 0.5);
  const isLime = step(abs(surf.sub(S.plaster)), 0.5);
  const isFort = step(abs(surf.sub(S.fort)), 0.5);
  const isOpen = step(abs(surf.sub(S.opening)), 0.5);
  const isLeaf = step(abs(surf.sub(S.foliage)), 0.5);
  const nf = normalize(normalWorldGeometry);
  const { T, B, top } = faceFrame(nf);
  const uvW = uvOf(dot(P, T), dot(P, B));
  const dist = length(P.sub(cameraPosition));
  const fade = float(1).sub(smoothstep(q.detailFar * 0.5, q.detailFar, dist));
  const edges = boxEdges(box.xyz, dim.xyz, box.w, nf);

  const pl = where(a, 'plaster', true), br = where(a, 'brick', true), ea = where(a, 'earth', true), st = where(a, 'stone', true);
  // plaster coverage: big patches, eaten away at the foot (rising damp), along the top and at the corners
  const cover = mx_fractal_noise_float(P.mul(vec3(0.42, 0.55, 0.42)).add(vec3(3.1, 0, 7.7)), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const footWear = float(1).sub(smoothstep(0.15, 1.3, edges.foot)).mul(0.32);
  const topWear = float(1).sub(smoothstep(0.05, 0.6, edges.eTop)).mul(0.16).mul(smoothstep(0.45, 0.75, mx_noise_float(P.mul(0.7).add(4.2)).mul(0.5).add(0.5)));
  const cornerWear = float(1).sub(smoothstep(0.02, 0.45, edges.eSide)).mul(0.22).mul(float(1).sub(smoothstep(1.2, 2.4, edges.foot)).mul(0.6).add(0.4));
  const thresh = mix(float(0.24), float(0.5), isFort);
  let uvB: N = uvW.div(TILE.brick);
  const uvP = uvW.div(TILE.plaster);
  const pS = sampleAt(pl, pl.layer, uvP);
  const ragged = mx_noise_float(P.mul(4.1).add(1.3)).mul(0.035).add(mx_noise_float(P.mul(11.0)).mul(0.015));
  const coverH = cover.sub(footWear).sub(topWear).sub(cornerWear).add(pS.h.sub(0.5).mul(0.12)).add(ragged);
  const plasterMask0 = smoothstep(thresh.sub(0.012), thresh.add(0.012), coverH);
  if (q.parallax > 0) uvB = parallax(br.data, br.layer, uvB, T, B, nf, 0.02, Math.max(6, q.parallax - 4), fade.mul(float(1).sub(plasterMask0)).mul(float(1).sub(top)));
  const bS = sampleAt(br, br.layer, uvB);
  const plasterMask = mix(plasterMask0, float(1), top); // roofs: no brick
  // the plaster's lip around a flaked patch: a thin raised rim, darker in its shadow side
  const lip = smoothstep(0.0, 0.03, coverH.sub(thresh)).sub(smoothstep(0.03, 0.07, coverH.sub(thresh)));

  // walls
  const plasterAlb = pS.alb.div(pl.mean);
  const brickAlb = bS.alb.div(br.mean).mul(vec3(0.97, 0.83, 0.68));
  let wallAlb: N = mix(brickAlb, plasterAlb, plasterMask);
  // roofs: packed mud
  const eS = sampleAt(ea, ea.layer, uvOf(P.x, P.z.negate()).div(TILE.earth * 0.8));
  const roofAlb = eS.alb.div(ea.mean).mul(0.92);
  // monuments: dressed stone; lime: whitewashed plaster
  const sS = sampleAt(st, st.layer, uvW.div(TILE.stone));
  const stoneAlb = sS.alb.div(st.mean);
  const limeAlb = mix(vec3(0.84, 0.8, 0.72), plasterAlb, 0.6);

  let alb: N = mix(wallAlb, roofAlb, top);
  alb = mix(alb, stoneAlb, isMon);
  alb = mix(alb, limeAlb, isLime);
  let nxy: N = mix(mix(bS.nxy, pS.nxy, plasterMask), eS.nxy, top);
  nxy = mix(nxy, sS.nxy, isMon);
  let rough: N = mix(mix(bS.rough, pS.rough, plasterMask), eS.rough, top);
  rough = mix(rough, sS.rough, isMon);
  rough = mix(rough, max(rough, 0.82), isLime);

  if (q.detail) {
    // damp, splashed foot: darker, with a ragged edge
    const footH = float(0.45).add(mx_noise_float(vec2(uvW.x.mul(0.9), 1.3)).mul(0.3));
    const footK = float(1).sub(smoothstep(footH.sub(0.25), footH.add(0.1), edges.foot)).mul(float(1).sub(top));
    alb = alb.mul(mix(1, 0.72, footK.mul(0.8)));
    rough = rough.sub(footK.mul(0.12));
    // rain streaks hanging from the top of the wall
    const streak = mx_noise_float(vec2(uvW.x.mul(3.2), edges.eTop.mul(0.22).add(uvW.x.mul(0.07)))).mul(0.5).add(0.5);
    const streakK = smoothstep(0.55, 0.85, streak).mul(exp(edges.eTop.mul(-0.7))).mul(float(1).sub(top)).mul(fade);
    alb = alb.mul(float(1).sub(streakK.mul(0.22)));
    // tone: re-plastered patches of another mix, sun-bleached high up, dirtier low down
    const patchN = mx_noise_float(uvW.mul(0.23).add(vec2(17.0, 3.0))).mul(0.5).add(0.5);
    const repl = smoothstep(0.62, 0.64, patchN).mul(plasterMask);
    alb = alb.mul(mix(vec3(1, 1, 1), vec3(1.07, 1.03, 0.95), repl));
    alb = alb.mul(mix(float(0.86), float(1.05), smoothstep(0.2, 3.2, edges.foot)));
    alb = alb.mul(mx_fractal_noise_float(P.mul(0.11), 2, 2.0, 0.5).mul(0.1).add(1.0));
    // hairline cracks in the plaster: short, branching, in a few places (warped Voronoi edges, masked)
    const warp = vec2(mx_noise_float(uvW.mul(3.0)), mx_noise_float(uvW.mul(3.0).add(5.2))).mul(0.12);
    const w = mx_worley_noise_vec2(uvW.mul(5.5).add(warp), 1.0);
    const crackMask = smoothstep(0.66, 0.78, mx_noise_float(uvW.mul(0.6).add(9.0)).mul(0.5).add(0.5));
    const crack = float(1).sub(smoothstep(0.0, 0.03, w.y.sub(w.x))).mul(crackMask);
    const crackK = crack.mul(plasterMask).mul(float(1).sub(top)).mul(fade).mul(float(1).sub(isMon)).mul(float(1).sub(smoothstep(4, 14, dist)));
    alb = alb.mul(float(1).sub(crackK.mul(0.5)));
    // a cavity darkening at the plaster's lip
    alb = alb.mul(float(1).sub(lip.mul(0.18).mul(float(1).sub(top))));
    // worn, sun-bleached edges
    alb = alb.mul(float(1).add(float(1).sub(smoothstep(0.0, 0.06, edges.e)).mul(0.07)));
  }
  // dark openings (doors and windows drawn as dark slabs)
  alb = mix(alb, vec3(0.06, 0.05, 0.045), isOpen);
  alb = mix(alb, vec3(0.75, 0.95, 0.6).mul(alb), isLeaf);
  m.colorNode = alb.mul(lookUniforms.albedoK);
  m.roughnessNode = clamp(rough.mul(1.08), 0.3, 1.0);
  m.metalnessNode = float(0);
  let nW: N = perturb(nxy, T, B, nf, mix(1.25, 0.6, float(1).sub(fade)));
  if (q.detail) {
    // the bevel: within 4 cm of an edge the normal turns toward it, as on a hand-plastered wall
    const bend = float(1).sub(smoothstep(0.0, 0.045, edges.e)).mul(0.75).mul(float(1).sub(isOpen));
    nW = normalize(mix(nW, normalize(nW.add(edges.out)), bend));
  }
  m.normalNode = toView(nW);
  ;(m as any).lookKind = `masonry-${src}`;
  return m;
}

/** Timber, cloth, reed, terracotta, stone, bronze, grain and leaves: one scan per surface (city and kit parts). */
export function propsMaterial(a: Slots, q: LookQuality, src: 'city' | 'kit', fixed: number | null = null): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial();
  if (src === 'kit') m.vertexColors = true;
  const P = positionWorld;
  const dim: N = attribute('aDim', 'vec4');
  const surf: N = fixed === null ? dim.w : float(fixed);
  const is = (s: number) => step(abs(surf.sub(s)), 0.5);
  const full = { alb: a.fullAlb, data: a.fullData };
  const L = (k: MaterialKey) => layerOf(k);
  // layer per surface (the full array has every material)
  const layer = int(select(is(S.wood), L('wood'), select(is(S.cloth), L('cloth'), select(is(S.reed), L('reed'), select(is(S.stone).add(is(S.monument)).greaterThan(0.5), L('stone'), select(is(S.grain), L('earth'), L('plaster')))))).add(0.5)).toVar();
  const tile = select(is(S.wood), TILE.wood, select(is(S.cloth), TILE.cloth, select(is(S.reed), TILE.reed, select(is(S.stone), TILE.stone * 0.5, select(is(S.grain), 0.6, select(is(S.terracotta), 1.1, TILE.plaster))))));
  // box mapping in the part's own frame (metres from its own origin, small numbers) by the dominant axis of its own
  // normal, with u along the face's longer side (so timber grain runs along beams, rails and door planks); jars,
  // poles and cones keep their texture still on them and sharp. The normal map's frame is taken from the world
  // normal (exact per face), close enough for timber and cloth.
  const loc: N = src === 'city' ? positionGeometry : attribute('aBox', 'vec4').xyz;
  const nL: N = normalize(src === 'city' ? normalGeometry : attribute('aNrm', 'vec3'));
  const Lm = loc.mul(dim.xyz);
  const ax = abs(nL);
  const onX = step(max(ax.y, ax.z), ax.x), onY = float(1).sub(onX).mul(step(ax.z, ax.y));
  const onZ = float(1).sub(onX).sub(onY);
  // the face's two in-plane axes and their sizes
  const pA = Lm.z.mul(onX).add(Lm.x.mul(onY)).add(Lm.x.mul(onZ));
  const qA = Lm.y.mul(onX).add(Lm.z.mul(onY)).add(Lm.y.mul(onZ));
  const sP = dim.z.mul(onX).add(dim.x.mul(onY)).add(dim.x.mul(onZ));
  const sQ = dim.y.mul(onX).add(dim.z.mul(onY)).add(dim.y.mul(onZ));
  const pLong = step(sQ, sP);
  const uL = mix(qA, pA, pLong), vL = mix(pA, qA, pLong);
  const nW = normalize(normalWorldGeometry);
  const { T, B } = faceFrame(nW);
  const off = vec2(fract(dim.x.mul(3.1).add(dim.z.mul(13.7))), fract(dim.z.mul(7.3).add(dim.y.mul(1.7))));
  const uvW = uvOf(uL, vL).div(tile).add(off);
  const nf = nW;
  const s = sampleAt(full, layer, uvW);
  const means = uniformArray(a.means.map((v) => new Vector3(v[0], v[1], v[2])), 'vec3');
  let alb: N = s.alb.div(means.element(layer));
  // grain heaps: fine, pale; leaves: noise over the colour; bronze: metal
  const leafN = mx_fractal_noise_float(P.mul(3.5), 2, 2.0, 0.5).mul(0.5).add(0.5);
  alb = mix(alb, vec3(leafN.mul(0.5).add(0.6)), is(S.foliage));
  alb = mix(alb, vec3(1, 1, 1), is(S.metal));
  alb = mix(alb, vec3(0.06, 0.05, 0.045), is(S.opening));
  alb = mix(alb, mix(vec3(0.7, 0.66, 0.58), alb, 0.7), is(S.plaster));
  // columns and posts: darker and dirtier toward the foot, rain-streaked
  const footK = float(1).sub(smoothstep(0.0, 1.6, Lm.y)).mul(is(S.plaster).add(is(S.stone)).add(is(S.masonry)).min(1));
  alb = alb.mul(float(1).sub(footK.mul(0.28)));
  const streakP = mx_noise_float(vec2(uL.mul(5.0), vL.mul(0.25))).mul(0.5).add(0.5);
  alb = alb.mul(float(1).sub(smoothstep(0.6, 0.9, streakP).mul(0.12).mul(is(S.plaster))));
  m.colorNode = alb.mul(lookUniforms.albedoK);
  let rough: N = s.rough;
  rough = mix(rough, float(0.42), is(S.metal));
  rough = mix(rough, rough.mul(0.85), is(S.terracotta));
  rough = mix(rough, float(0.75), is(S.foliage));
  rough = mix(rough, max(rough, 0.85), is(S.plaster));
  m.roughnessNode = clamp(rough, 0.25, 1.0);
  m.metalnessNode = is(S.metal).mul(0.9);
  const strength = select(is(S.cloth), 0.7, select(is(S.foliage), 0.0, select(is(S.metal), 0.2, 1.0)));
  m.normalNode = toView(perturb(s.nxy, T, B, nf, strength));
  ;(m as any).lookKind = `props-${src}`;
  return m;
}

/** City trees (cones and balls of leaves) and other foliage: a leafy noise, soft, with a little light through it. */
export function foliageMaterial(): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial();
  const P = positionWorld;
  const n1 = mx_fractal_noise_float(P.mul(2.2), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const n2 = mx_noise_float(P.mul(9.0)).mul(0.5).add(0.5);
  m.colorNode = vec3(0.62, 0.8, 0.5).mul(n1.mul(0.7).add(0.45)).mul(n2.mul(0.3).add(0.8)).mul(lookUniforms.albedoK);
  m.roughnessNode = float(0.8);
  m.metalnessNode = float(0);
  // leaves catch the light from behind: a little emission where the sun is behind the crown
  const nf = flatNormal();
  const back = clamp(dot(nf, lookUniforms.sunDir).negate(), 0, 1);
  m.emissiveNode = vec3(0.12, 0.16, 0.04).mul(back).mul(n1);
  const bump = vec3(mx_noise_float(P.mul(6.0)), mx_noise_float(P.mul(6.0).add(11.0)), mx_noise_float(P.mul(6.0).add(23.0))).mul(0.6);
  m.normalNode = toView(normalize(nf.add(bump)));
  ;(m as any).lookKind = 'foliage';
  return m;
}

/** The land beyond the city's ground (vertex-coloured hills): earth, broken by large noise, coloured by the model. */
export function landMaterial(a: Slots): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial();
  m.vertexColors = true;
  const P = positionWorld;
  const ea = where(a, 'earth', false);
  const s = sampleAt(ea, ea.layer, P.xz.div(TILE.earth * 4));
  const macro = mx_fractal_noise_float(P.xz.mul(0.012), 4, 2.0, 0.5).mul(0.5).add(0.5);
  m.colorNode = s.alb.div(ea.mean).mul(macro.mul(0.35).add(0.8)).mul(lookUniforms.albedoK);
  m.roughnessNode = float(0.95);
  m.metalnessNode = float(0);
  ;(m as any).lookKind = 'land';
  return m;
}

