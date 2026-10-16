// The backdrop's sky: a dome around the camera with a horizon gradient, a sun glow, drifting clouds and stars.
// Colours go in and come out as sRGB numbers (no colour-space conversion). Below the horizon it keeps the horizon's
// colour; FOG_GLSL is the same sky without clouds, which the land's haze fades into (per direction, so a hill in
// front of the sunset fades into the sunset and one opposite it into the cool side of the sky).

import { BackSide, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import type { Look } from './looks.ts';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uZenith, uHorizon, uHaze, uGlow, uSun, uCloudLit, uCloudShade;
uniform float uGlowK, uDisk, uStars, uClouds, uTime, uSeed;
varying vec3 vDir;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = clamp(h, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(up, 0.55));
  float g = max(dot(d, uSun), 0.0);
  c += uGlow * uGlowK * (pow(g, 6.0) * 0.55 + pow(g, 48.0) * 0.6 + 0.35 * g * g * exp(-up * 7.0));
  c += uGlow * uDisk * smoothstep(0.99935, 0.99975, g);
  if (h > 0.0) {
    if (uClouds > 0.001) {
      vec2 uv = d.xz / (h + 0.09) * 0.9 + vec2(uTime * 0.0035 + uSeed, uTime * 0.0012);
      float n = fbm(uv) + 0.22 * fbm(uv * 3.1 + 4.0);
      float lo = 1.05 - uClouds * 0.75;
      float cov = smoothstep(lo, lo + 0.28, n);
      float fade = smoothstep(0.0, 0.16, h) * (1.0 - smoothstep(0.55, 0.95, h) * 0.5);
      float lit = clamp(0.35 + 0.9 * pow(g, 3.0) + (n - lo) * 1.2, 0.0, 1.0);
      vec3 cc = mix(uCloudShade, uCloudLit, lit);
      c = mix(c, cc, cov * fade * 0.92);
    }
    if (uStars > 0.001) {
      vec2 sp = d.xz / (h + 0.35) * 260.0;
      vec2 cell = floor(sp);
      float r = hash(cell + uSeed);
      vec2 o = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
      float star = smoothstep(0.42, 0.0, length(fract(sp) - 0.5 - o * 0.6)) * step(0.985, r);
      float tw = 0.65 + 0.35 * sin(uTime * (1.0 + r * 3.0) + r * 40.0);
      c += vec3(0.9, 0.92, 1.0) * star * tw * uStars * smoothstep(0.02, 0.25, h) * (r - 0.985) * 66.0;
    }
  }
  gl_FragColor = vec4(c, 1.0);
}`;

/** The sky's colour toward world direction d (horizon and below → the horizon), for the haze of every surface. */
export const FOG_GLSL = /* glsl */ `
uniform vec3 bdHorizon, bdZenith, bdGlow, bdSun;
uniform float bdGlowK;
vec3 bdSky(vec3 d) {
  float up = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(bdHorizon, bdZenith, pow(up, 0.55));
  float g = max(dot(d, bdSun), 0.0);
  return c + bdGlow * bdGlowK * (pow(g, 6.0) * 0.55 + pow(g, 48.0) * 0.6 + 0.35 * g * g * exp(-up * 7.0));
}`;

/** Uniforms for FOG_GLSL, shared by every material that takes the haze. */
export function fogUniforms() {
  return {
    bdHorizon: { value: new Vector3() }, bdZenith: { value: new Vector3() }, bdGlow: { value: new Vector3() },
    bdSun: { value: new Vector3(0, 0.2, -1).normalize() }, bdGlowK: { value: 0 },
  };
}
export type FogUniforms = ReturnType<typeof fogUniforms>;

export function setFogUniforms(u: FogUniforms, l: Look, sun: Vector3) {
  u.bdHorizon.value.set(...l.horizon);
  u.bdZenith.value.set(...l.zenith);
  u.bdGlow.value.set(...l.glow);
  u.bdSun.value.copy(sun);
  u.bdGlowK.value = l.glowK;
}

export class Sky {
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;
  constructor(seed: number) {
    this.mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new Vector3() }, uHorizon: { value: new Vector3() }, uHaze: { value: new Vector3() },
        uGlow: { value: new Vector3() }, uSun: { value: new Vector3(0, 0.2, -1).normalize() },
        uCloudLit: { value: new Vector3() }, uCloudShade: { value: new Vector3() },
        uGlowK: { value: 0.5 }, uDisk: { value: 0 }, uStars: { value: 0 }, uClouds: { value: 0 }, uTime: { value: 0 },
        uSeed: { value: (seed % 1000) / 37 },
      },
    });
    this.mesh = new Mesh(new SphereGeometry(100, 32, 16), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  /** `sun`: unit vector toward the sun, world space. */
  apply(l: Look, sun: Vector3, time: number) {
    const u = this.mat.uniforms;
    (u.uZenith.value as Vector3).set(...l.zenith);
    (u.uHorizon.value as Vector3).set(...l.horizon);
    (u.uHaze.value as Vector3).set(...l.haze);
    (u.uGlow.value as Vector3).set(...l.glow);
    (u.uCloudLit.value as Vector3).set(...l.cloudLit);
    (u.uCloudShade.value as Vector3).set(...l.cloudShade);
    (u.uSun.value as Vector3).copy(sun);
    u.uGlowK.value = l.glowK;
    u.uDisk.value = l.disk;
    u.uStars.value = l.stars;
    u.uClouds.value = l.clouds;
    u.uTime.value = time;
  }

  follow(p: Vector3) { this.mesh.position.copy(p); }

  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}
