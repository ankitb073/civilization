// Look: the river. The streets layer's ribbon (world/water.ts) keeps its shape and level; here it gets a water
// material: waves from a tileable normal map (made here from sums of sines with whole-number frequencies, so it
// tiles; no download), scrolled two ways along the flow; the riverbed seen through it (screen-space refraction,
// absorbed and clouded with silt by the water's depth), foam where it is shallow; reflections of the sky and, on
// desktop, of the town (a planar mirror at the water level); and the sun's glitter, shadowed by the town.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { DataTexture, FloatType, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, type Texture } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import * as tslAll from 'three/tsl';
// TSL's type definitions reject much valid TSL (vector/scalar mixing); shader errors surface when it compiles.
const {pow, reflect, cameraFar, cameraNear, clamp, dot, exp, float, length, max, mix, mx_noise_float, normalize, perspectiveDepthToViewZ, positionView, positionWorld, reflector, screenUV, smoothstep, texture, uniform, uv, vec2, vec3, viewportDepthTexture, viewportSharedTexture, cameraPosition, cameraViewMatrix, vec4, select,} = tslAll as any;
import type { Object3D } from 'three';

type N = any;

/** A tileable wave-slope map: RG = slope x and z (scaled to 0..1), from sums of sines with whole-number frequencies. */
function waveTexture(size = 256): DataTexture {
  const data = new Float32Array(size * size * 4);
  const waves: [number, number, number, number][] = [];
  // deterministic set of waves (frequency x, frequency z, amplitude, phase), mostly across the flow (z = along)
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 28; i++) {
    const f = 1 + Math.floor(rnd() * (i < 8 ? 4 : i < 18 ? 9 : 17));
    const ang = (rnd() - 0.5) * Math.PI * 0.9;
    const fx = Math.round(Math.sin(ang) * f), fz = Math.round(Math.cos(ang) * f) || 1;
    waves.push([fx, fz, 1 / Math.pow(Math.hypot(fx, fz), 1.15), rnd() * Math.PI * 2]);
  }
  let mx = 0;
  const sx = new Float32Array(size * size), sz = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0, dz = 0;
      for (const [fx, fz, a, ph] of waves) {
        const t = ((fx * x + fz * y) / size) * Math.PI * 2 + ph;
        // a sharpened sine (crests narrower than troughs)
        const c = Math.cos(t), s = Math.sin(t);
        const k = a * (1 + 0.6 * s);
        dx += k * c * fx; dz += k * c * fz;
      }
      sx[y * size + x] = dx; sz[y * size + x] = dz;
      mx = Math.max(mx, Math.abs(dx), Math.abs(dz));
    }
  }
  for (let i = 0; i < size * size; i++) { data[i * 4] = sx[i] / mx; data[i * 4 + 1] = sz[i] / mx; data[i * 4 + 2] = 0; data[i * 4 + 3] = 1; }
  const t = new DataTexture(data, size, size, RGBAFormat, FloatType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export interface WaterLook { material: MeshBasicNodeMaterial; mirror: Object3D | null; dispose(): void; u: { time: N; flow: N; sunK: N } }

/** The water, shaded here (not by three's lights): what is under it, absorbed and silted by its depth, mixed by
 *  Fresnel with what it reflects (the town in a planar mirror on desktop, the sky everywhere), and the sun's glint.
 *  `sky(dir)` gives the sky's radiance in a world direction; `sunDir`/`sunColor` the sun. */
export function waterMaterial(opts: { level: number; mirror: boolean; mirrorScale: number; sky: (dir: N) => N; sunDir: N; sunColor: N }): WaterLook {
  const waves = waveTexture(256);
  const uTime = uniform(0);
  const uFlow = uniform(0.55);
  const uSunK = uniform(7.5);
  const m = new MeshBasicNodeMaterial();
  m.transparent = true;
  m.depthWrite = true;
  const P = positionWorld;
  // the ribbon's uv: x across (-1..1), y along (metres); flow runs along +y
  const along = uv().y, across = uv().x;
  const dist = length(P.sub(cameraPosition));
  const far = smoothstep(25, 120, dist);
  const t = uTime.mul(uFlow);
  const w1 = texture(waves, vec2(across.mul(1.6).add(0.13), along.sub(t.mul(1.0)).mul(1 / 5.5))).xy;
  const w2 = texture(waves, vec2(across.mul(2.3).sub(0.41), along.sub(t.mul(1.4)).mul(1 / 2.3)).add(0.37)).xy;
  const w3 = texture(waves, vec2(P.x, P.z).mul(1 / 1.1).add(vec2(t.mul(0.21), t.mul(-0.17)))).xy;
  const slope = w1.mul(0.55).add(w2.mul(0.35)).add(w3.mul(0.18)).mul(mix(float(0.22), float(0.07), far));
  // the ribbon's along-axis follows the meander; slopes are close enough in world x/z for a river this calm
  const nW = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));
  const V = normalize(cameraPosition.sub(P));
  const cosT = clamp(dot(nW, V), 0, 1);
  const fres = float(0.02).add(float(0.98).mul(pow(float(1).sub(cosT), 5)));
  const R = reflect(V.negate(), nW);
  m.colorNode = vec3(0.0);

  // refraction: the bed through the water, displaced by the waves (unless that would sample something in front)
  const waterZ = positionView.z.negate();
  const sceneZ = (uvN: N) => perspectiveDepthToViewZ(viewportDepthTexture(uvN), cameraNear, cameraFar).negate();
  const thick0 = max(sceneZ(screenUV).sub(waterZ), 0);
  const refrUV = screenUV.add(slope.mul(0.06).mul(clamp(thick0.mul(0.8), 0, 1)));
  const thickR = sceneZ(refrUV).sub(waterZ);
  const uvR = select(thickR.lessThan(0), screenUV, refrUV);
  const thick = max(select(thickR.lessThan(0), thick0, thickR), 0);
  const bed = viewportSharedTexture(uvR).rgb;
  // silty river: blue and green go first; the depth along the view, made roughly vertical
  const depthV = thick.mul(0.55);
  const absorb = exp(vec3(0.55, 0.42, 0.42).mul(depthV).negate().mul(1.8));
  const silt = vec3(0.105, 0.11, 0.075);
  let back: N = bed.mul(absorb).add(silt.mul(float(1).sub(absorb)));
  // foam where it is shallow, broken by noise and moving with the water
  const foamN = mx_noise_float(vec3(P.x.mul(2.2), P.z.mul(2.2), t.mul(0.6))).mul(0.5).add(0.5);
  const foam = float(1).sub(smoothstep(0.02, 0.22, depthV)).mul(smoothstep(0.35, 0.75, foamN)).mul(float(1).sub(far));
  back = mix(back, vec3(0.62, 0.6, 0.55).mul(1.4), foam.mul(0.8));
  // what it reflects: the sky everywhere; the town in a planar mirror where it has one (desktop)
  let refl: N = opts.sky(vec3(R.x, max(R.y, 0.02), R.z));
  let mirror: Object3D | null = null;
  if (opts.mirror) {
    const rn: N = reflector({ resolutionScale: opts.mirrorScale, generateMipmaps: false, depth: false } as any);
    rn.target.rotateX(-Math.PI / 2);
    rn.target.position.y = opts.level;
    rn.uvNode = rn.uvNode.add(slope.mul(0.05));
    mirror = rn.target;
    // the mirror holds the town and the sky behind it, already lit and tone-free (linear)
    refl = rn.rgb;
  }
  // the sun's glint (a sharp lobe; bloom spreads it)
  const glint = pow(max(dot(R, opts.sunDir), 0), 900).mul(uSunK).mul(40).mul(float(1).sub(foam));
  const col = mix(back, refl, fres.mul(float(1).sub(foam.mul(0.7)))).add(vec3(opts.sunColor).mul(glint));
  m.backdropNode = col;
  return {
    material: m, mirror, u: { time: uTime, flow: uFlow, sunK: uSunK },
    dispose() { waves.dispose(); m.dispose(); },
  };
}

