// Look: the frame after the scene is drawn, in TSL (three's RenderPipeline), the same on WebGPU and WebGL2.
//
//   pre-pass (opaque: normals, velocity, depth)
//     ├─ GTAO (half resolution, temporally filtered) ──────────────┐  into the scene's indirect light only
//     └─ screen-space contact shadows toward the sun (desktop) ────┤  into the sun's light only
//   scene pass (lit, with the water's refraction and reflections) ◀┘
//     → aerial perspective and exponential height fog, coloured by the sky in each direction and warmed toward the sun
//     → sun shafts (a radial blur of the sky around the sun; desktop)
//     → TRAA (temporal anti-aliasing; or FXAA on the lowest tier)
//     → depth of field (only the far distance softens; desktop) → camera motion blur (desktop)
//     → bloom → colour grade → tone mapping (AgX or ACES) → vignette and a trace of grain
// Built once; `render()` draws a frame.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Color, type DirectionalLight, Matrix4, type PerspectiveCamera, type Scene, UnsignedByteType, Vector3 } from 'three';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import * as tslAll from 'three/tsl';
// TSL's type definitions reject much valid TSL (vector/scalar mixing); shader errors surface when it compiles.
const {Fn, builtinAOContext, builtinShadowContext, cameraPosition, cameraProjectionMatrixInverse, cameraWorldMatrix, clamp, dot, exp, float, getViewPosition, hash, length, luminance, max, mix, mrt, normalView, normalize, output, packNormalToRGB, pass, pow, renderOutput, sample, screenUV, smoothstep, step, uniform, unpackRGBToNormal, uv, vec2, vec3, vec4, velocity, abs, convertToTexture, select,} = tslAll as any;
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { sss } from 'three/addons/tsl/display/SSSNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { radialBlur } from 'three/addons/tsl/display/radialBlur.js';
import type { SkySetup } from './sky.ts';

type N = any;

export interface PostTier {
  /** GTAO resolution scale (0: no GTAO). */
  ao: number;
  /** A separate pre-pass for normals, velocity and depth (default), so AO can go into the indirect light only; false:
   *  the scene pass writes them too (half the draw calls; AO darkens the finished image). */
  prepass?: boolean;
  contactShadows: boolean;
  aa: 'traa' | 'taau' | 'fxaa' | 'none';
  /** Render scale for 'taau' (the scene drawn smaller, then reconstructed to full size over frames). */
  scale?: number;
  dof: boolean;
  motionBlur: boolean;
  bloom: boolean;
  shafts: boolean;
}

export interface Post {
  pipeline: RenderPipeline;
  render(): void;
  /** The camera cut (a teleport, a set view): drop the temporal history and the motion blur for a frame. */
  cut(): void;
  /** Call before render: the sun's place on screen (for the shafts) and the focus. */
  update(camera: PerspectiveCamera, focus: number): void;
  u: Record<string, N>;
  dispose(): void;
}

export function makePost(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, sun: DirectionalLight, sky: SkySetup, tier: PostTier): Post {
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const u = {
    exposure: uniform(1),
    fogDensity: uniform(0.0011),
    fogFalloff: uniform(0.018),
    fogSun: uniform(0.9),
    fogSunPow: uniform(7),
    fogTint: uniform(new Color(1.05, 0.95, 0.82)),
    sunColor: uniform(new Color(1.0, 0.86, 0.66)),
    shaftK: uniform(0.35),
    sunUV: uniform(vec2(0.5, 0.5) as N),
    sunFacing: uniform(0),
    sunDir: uniform(sky.sunDir.clone()),
    warmth: uniform(new Color(1.035, 1.0, 0.95)),
    saturation: uniform(1.06),
    contrast: uniform(1.05),
    vignette: uniform(0.22),
    grain: uniform(0.012),
    focus: uniform(5),
    focalLength: uniform(260),
    bokeh: uniform(1.6),
    blur: uniform(0.45),
    bloomStrength: uniform(0.12),
  };

  // ---- pre-pass: normals, velocity and depth of the opaque scene (or, without one, the scene pass writes them too)
  const scenePass = pass(scene, camera);
  scenePass.name = 'look-scene';
  let pre: N = null, preNormal: N, preDepth: N, preVel: N;
  if (tier.prepass !== false) {
    pre = pass(scene, camera);
    pre.name = 'look-prepass';
    pre.transparent = false;
    pre.setMRT(mrt({ output: packNormalToRGB(normalView), velocity }));
    pre.getTexture('output').type = UnsignedByteType;
    preNormal = sample((uvN: N) => unpackRGBToNormal(pre.getTextureNode('output').sample(uvN)));
    preDepth = pre.getTextureNode('depth');
    preVel = pre.getTextureNode('velocity');
  } else {
    // one geometry pass (phones: the draw calls are the CPU's cost): AO is then applied after, to all the light
    scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView), velocity }));
    scenePass.getTexture('normal').type = UnsignedByteType;
    preNormal = sample((uvN: N) => unpackRGBToNormal(scenePass.getTextureNode('normal').sample(uvN)));
    preDepth = scenePass.getTextureNode('depth');
    preVel = scenePass.getTextureNode('velocity');
  }

  // ---- GTAO and contact shadows, fed into the scene pass's lighting
  let ctx: N = null;
  let aoPass: N = null, sssPass: N = null;
  if (tier.ao > 0) {
    aoPass = ao(preDepth, preNormal, camera);
    aoPass.resolutionScale = tier.ao;
    aoPass.useTemporalFiltering = tier.aa === 'traa';
    aoPass.radius.value = 1.4;
    aoPass.thickness.value = 1.6;
    aoPass.distanceExponent.value = 1.4;
    aoPass.scale.value = 1.15;
    aoPass.samples.value = 16;
    if (pre) ctx = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
  }
  if (tier.contactShadows) {
    sssPass = sss(preDepth, camera, sun);
    sssPass.maxDistance.value = 0.35;
    sssPass.thickness.value = 0.02;
    sssPass.useTemporalFiltering = tier.aa === 'traa';
    const s = sssPass.getTextureNode().sample(screenUV).r;
    ctx = ctx ? builtinAOContext(aoPass.getTextureNode().sample(screenUV).r, builtinShadowContext(s, sun)) : builtinShadowContext(s, sun);
  }
  if (ctx) scenePass.contextNode = ctx;
  if (tier.aa === 'taau') { const k = tier.scale ?? 0.7; pre?.setResolutionScale(k); scenePass.setResolutionScale(k); }
  const taauNode: N = tier.aa === 'taau' ? taau(scenePass.getTextureNode('output'), preDepth, preVel, camera) : null;
  // with TAAU the fog and the rest work on the reconstructed, full-size image
  const color0 = taauNode ? taauNode.getTextureNode() : scenePass.getTextureNode('output');
  // without a pre-pass, the AO darkens the reconstructed image (three quarters of it: the sun's share is spared a little)
  const color: N = !pre && aoPass ? { sample: (uvN: N) => { const c = color0.sample(uvN); return vec4(c.rgb.mul(mix(float(1), aoPass.getTextureNode().sample(uvN).r, 0.75)), c.a); } } : color0;
  const depth = scenePass.getTextureNode('depth');

  // ---- aerial perspective and height fog. (A full-screen pass draws with its own camera: the scene camera's
  // matrices come in as uniforms, set each frame in update().)
  const camProjInv = uniform(new Matrix4()), camWorld = uniform(new Matrix4()), camPos = uniform(new Vector3());
  const fogged = Fn(() => {
    const c = color.sample(uv());
    const d = depth.sample(uv()).r;
    const viewPos = getViewPosition(uv(), d, camProjInv);
    const world = camWorld.mul(vec4(viewPos, 1)).xyz;
    const ray = world.sub(camPos);
    const dist = length(ray);
    const dir = normalize(ray);
    const isSky = step(0.99999, d);
    const y0 = camPos.y, y1 = world.y;
    const dy = y1.sub(y0);
    const b = u.fogFalloff;
    const e0 = exp(y0.mul(b).negate());
    const integ = select(abs(dy).greaterThan(0.01), e0.sub(exp(y1.mul(b).negate())).div(b.mul(dy)), e0);
    const optical = u.fogDensity.mul(dist).mul(integ);
    const f = float(1).sub(exp(optical.negate())).mul(float(1).sub(isSky));
    const sunAmt = pow(max(dot(dir, u.sunDir), 0), u.fogSunPow).mul(u.fogSun);
    const scatter = sky.horizon(dir).mul(u.fogTint).add(vec3(u.sunColor).mul(sunAmt).mul(sky.u.skyK).mul(2.2));
    return vec4(mix(c.rgb, scatter, f), 1);
  })();
  let img: N = fogged;

  // ---- sun shafts: the bright sky around the sun, blurred toward it
  if (tier.shafts) {
    const occl = Fn(() => {
      const d = depth.sample(uv()).r;
      const isSky = step(0.99999, d);
      const toSun = uv().sub(u.sunUV).mul(vec2(1.6, 1));
      const near = float(1).sub(smoothstep(0.0, 0.55, length(toSun)));
      const c = color.sample(uv()).rgb;
      return vec4(vec3(luminance(c)).mul(isSky).mul(near).mul(0.15), 1);
    })();
    const shafts: N = radialBlur(occl, { center: u.sunUV, weight: float(0.9), decay: float(0.955), count: 40 as N, exposure: float(1.0) } as N);
    img = vec4(img.rgb.add(shafts.rgb.mul(vec3(u.sunColor)).mul(u.shaftK).mul(u.sunFacing)), 1);
  }

  // ---- anti-aliasing
  let traaNode: N = null;
  if (tier.aa === 'traa') { traaNode = traa(img, preDepth, preVel, camera); img = traaNode; }
  // ---- depth of field: only the far distance softens (the focus is the runner)
  if (tier.dof) img = dof(img, pre.getViewZNode(), u.focus, u.focalLength, u.bokeh);
  // ---- camera motion blur
  if (tier.motionBlur) img = motionBlur(convertToTexture(img), preVel.mul(u.blur));
  // ---- bloom
  if (tier.bloom) {
    const b: N = bloom(img, 1, 0.55, 1.6);
    b.strength = u.bloomStrength;
    img = vec4(img.rgb.add(b.rgb), 1);
  }
  // ---- grade (linear), tone map, then vignette and grain (display)
  const graded = Fn(() => {
    let c: N = img.rgb.mul(u.exposure).mul(vec3(u.warmth));
    const l = luminance(c);
    c = mix(vec3(l), c, u.saturation);
    c = pow(max(c.div(0.18), 0.0), vec3(u.contrast)).mul(0.18);
    return vec4(c, 1);
  })();
  let out: N = renderOutput(graded);
  if (tier.aa === 'fxaa') out = fxaa(out);
  const final = Fn(() => {
    const c = out.rgb;
    const vd = length(screenUV.sub(0.5).mul(vec2(1.0, 0.8)));
    const vig = float(1).sub(smoothstep(0.35, 0.95, vd).mul(u.vignette));
    const g = hash(screenUV.mul(vec2(1973.1, 2861.7)).add(u.focus)).sub(0.5).mul(u.grain);
    return vec4(clamp(c.mul(vig).add(g), 0, 1), 1);
  })();
  pipeline.outputNode = final;

  const v = new Vector3();
  let cutting = false, blurK = 0.45;
  return {
    pipeline,
    render() {
      pipeline.render();
      if (cutting) { u.blur.value = blurK; cutting = false; }
    },
    cut() {
      // TRAA restarts its history when its size changes (TRAANode.updateBefore): make it think so
      traaNode?._historyRenderTarget?.setSize(1, 1);
      if (!cutting) blurK = u.blur.value;
      u.blur.value = 0;
      cutting = true;
    },
    update(cam, focus) {
      u.focus.value = focus;
      camProjInv.value.copy(cam.projectionMatrixInverse);
      camWorld.value.copy(cam.matrixWorld);
      camPos.value.copy(cam.position);
      // the sun on screen (for the shafts), and how much the view faces it
      v.copy(cam.position).addScaledVector(sky.sunDir, 1000).project(cam);
      (u.sunUV.value as N).set(v.x * 0.5 + 0.5, 1 - (v.y * 0.5 + 0.5));
      const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      u.sunFacing.value = v.z < 1 ? Math.max(0, Math.min(1, (fwd.dot(sky.sunDir) - 0.25) / 0.5)) : 0;
    },
    u,
    dispose() {
      pipeline.dispose();
      for (const n of [aoPass, sssPass, traaNode, taauNode, pre, scenePass] as N[]) n?.dispose?.();
    },
  };
}

