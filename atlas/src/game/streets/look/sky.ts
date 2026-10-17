// Look: the sky, the sun and the light from the sky. One CC0 Poly Haven HDRI (qwantani_late_afternoon_puresky, a clear
// late-afternoon sky, the sun 19° up over a warm, hazy horizon; decision 0033) does three jobs:
// - image-based lighting: the HDR at 512 (computers) or 256 (phones), its sun clamped (the directional light carries
//   the sun), as scene.environment (three prefilters it, PMREM);
// - the visible sky: the upper hemisphere as a GPU-compressed KTX2 (4K on computers, 2K on phones), streamed in after
//   the first frame over a 2 KB preview, with an analytic sun disc and glow on top, a warm grade and haze toward the
//   horizon that the post fog matches;
// - the sun's direction, read from the HDR (the brightest texel), so light, shadows, sky and reflections agree.
// The sky texture is turned about the vertical so its sun sits where the game wants it (environmentRotation turns the
// lighting the same way). Its level of detail is set from the view's angular size per pixel, not from screen
// derivatives of the texture coordinate, which jump at the panorama's seam and would draw a line there.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Color, Euler, Vector3, type Texture } from 'three';
import * as tslAll from 'three/tsl';
// TSL's type definitions reject much valid TSL (vector/scalar mixing); shader errors surface when it compiles.
const { Fn, normalWorldGeometry, abs, atan, asin, clamp, dot, dFdx, dFdy, exp, float, length, log2, max, mix, normalize, pow, smoothstep, texture, uniform, vec2, vec3 } = tslAll as any;

type N = any;

export interface SkySetup {
  /** Toward the sun (world). */
  sunDir: Vector3;
  /** Euler for scene.environmentRotation and the angle (radians) the backdrop is turned by. */
  envRotation: Euler;
  turn: number;
  /** The sky colour near the horizon in a direction (for the fog), as a TSL function of a world direction. */
  horizon: (dir: N) => N;
  /** The scene's background node. */
  background: N;
  /** Sky radiance (linear) in a world direction (for reflections). */
  radiance: (dir: N) => N;
  /** Swap in a sharper backdrop (same panorama, exposure and span; `width` in texels). */
  setBackdrop(t: Texture, width: number): void;
  /** Uniforms to tune. */
  u: { skyK: N; sunK: N; haze: N; hazeColor: N; tint: N; sunDir: N; sunColor: N };
}

/** Sun direction from the HDR's sun texel (three's equirect mapping: u = atan(z, x) / 2π + 0.5, v = asin(y) / π + 0.5),
 *  turned by `turn` radians about the vertical. */
export function sunFrom(sunU: number, elevationDeg: number, turn: number): Vector3 {
  const phi = (sunU - 0.5) * Math.PI * 2 + turn;
  const el = (elevationDeg * Math.PI) / 180;
  return new Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el)).normalize();
}

export function makeSky(opts: { backdrop: Texture; exposure: number; vSpan: number; sunU: number; elevationDeg: number; turn: number; width: number }): SkySetup {
  const sunDir = sunFrom(opts.sunU, opts.elevationDeg, opts.turn);
  const uSun = uniform(sunDir.clone());
  const sunColor = uniform(new Color(1.0, 0.86, 0.66));
  const skyK = uniform(1);
  const sunK = uniform(1);
  const haze = uniform(0.3);
  const hazeColor = uniform(new Color(1.0, 0.82, 0.6));
  // a warm grade on the photographed sky: the painted plates' golden late afternoon, not a cool blue noon
  const tint = uniform(new Color(1.1, 0.98, 0.82));
  const width = uniform(opts.width);
  const turn = opts.turn;
  const lin = 1 / opts.exposure;
  const vSpan = opts.vSpan;
  const tex = texture(opts.backdrop);
  /** Sky radiance (linear, the HDR's units) in a direction; `lod` the mip level (null: the base level). */
  const skyAt = (dir: N, lod: N = null) => {
    const d = normalize(dir);
    const y = clamp(d.y, -0.2, 1);
    // undo the turn: the texture's own azimuth
    const az = atan(d.z, d.x).sub(turn);
    const u = az.mul(1 / (Math.PI * 2)).add(0.5);
    const vFromTop = float(0.5).sub(asin(max(y, 0.004)).mul(1 / Math.PI));
    const v = float(1).sub(vFromTop.div(vSpan));
    const s = tex.sample(vec2(u, v));
    return (lod ? s.level(lod) : s.level(0)).rgb.mul(lin).mul(tint);
  };
  const horizon = (dir: N) => skyAt(vec3(dir.x, 0.03, dir.z)).mul(skyK);
  const background = Fn(() => {
    // the background sphere is drawn round the camera with an identity world matrix: its normal is the direction
    const d = normalize(normalWorldGeometry);
    // the mip level: texels of the panorama per pixel of the view (its width spans 2π)
    const px = max(length(dFdx(d)), length(dFdy(d)));
    const lod = max(log2(px.mul(width).mul(1 / (Math.PI * 2))), 0);
    let c: N = skyAt(d, lod).mul(skyK);
    // the sun: a disc and a tight glow (the 8-bit sky clips near it)
    const cosA = dot(d, uSun);
    const disc = smoothstep(0.99995, 0.99998, cosA).mul(60);
    const glow = pow(max(cosA, 0), 900).mul(6).add(pow(max(cosA, 0), 64).mul(0.6));
    c = c.add(vec3(sunColor).mul(disc.add(glow)).mul(sunK));
    // haze toward the horizon (the land's own aerial perspective takes over below it)
    const h = exp(abs(d.y).mul(-7)).mul(haze);
    c = mix(c, horizon(d).mul(hazeColor).mul(1.2), h);
    return c;
  })();
  const envRotation = new Euler(0, -turn, 0);
  const radiance = (dir: N) => skyAt(dir).mul(skyK);
  return {
    sunDir, envRotation, turn, horizon, background, radiance,
    setBackdrop(t, w) { tex.value = t; width.value = w; },
    u: { skyK, sunK, haze, hazeColor, tint, sunDir: uSun, sunColor },
  };
}
