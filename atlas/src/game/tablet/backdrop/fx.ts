// The backdrop's effects, animated entirely on the GPU from a time uniform (no per-frame CPU work):
// smoke and dust columns (soft puffs, alpha-blended) and points of light (windows, campfires, fires, glow; additive).

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, NormalBlending, Points, ShaderMaterial,
  SRGBColorSpace, Vector3, Vector4,
} from 'three';
import { streamOf } from './scenario.ts';
import { FOG_GLSL, type FogUniforms } from './sky.ts';

type RGB = [number, number, number];

/** Smoke groups: 0 the sack's columns, 1 the battle's dust, 2 the besiegers' camp, 3 hearths and chimneys. */
export interface SmokeSources { sack: Float32Array; dust: Float32Array; camp: Float32Array; hearth: Float32Array }
/** Light groups: 0 windows, 1 campfires, 2 fires, 3 the glow over the burning city. */
export interface LightSources { windows: Float32Array; camp: Float32Array; fires: Float32Array; glow: Float32Array }

const SMOKE_VERT = /* glsl */ `
attribute vec4 aSeed;
attribute float aGroup;
attribute float aCol;
uniform float uTime, uPx, uMaxPt, uFogNear, uFogFar;
uniform vec4 uK, uA, uH, uS, uSpeed, uWindK;
uniform vec3 uWind;
uniform vec3 uCol0[4];
uniform vec3 uCol1[4];
varying vec3 vCol, vDir;
varying float vA, vRot, vFog;
float pick(vec4 v, int g) { return g == 0 ? v.x : g == 1 ? v.y : g == 2 ? v.z : v.w; }
void main() {
  int g = int(aGroup + 0.5);
  float k = pick(uK, g) * pick(uA, g);
  if (k < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float life = fract(uTime * pick(uSpeed, g) * (0.75 + 0.5 * aSeed.y) + aSeed.x);
  // each column its own: taller or shorter, leaning more or less
  float H = pick(uH, g) * (0.55 + 0.75 * aCol);
  vec3 p = position;
  p.y += H * pow(life, 0.8);
  p += uWind * H * pick(uWindK, g) * (0.6 + 0.8 * fract(aCol * 7.31)) * pow(life, 1.7);
  float a = aSeed.w * 6.2831853;
  p.xz += vec2(cos(a), sin(a)) * H * 0.07 * life * (0.4 + aSeed.z);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vDir = (modelMatrix * vec4(p, 1.0)).xyz - cameraPosition;
  float size = pick(uS, g) * (0.35 + 2.0 * life) * (0.7 + 0.6 * aSeed.z);
  gl_PointSize = min(uMaxPt, size * uPx / max(0.05, -mv.z));
  vA = k * smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.4, 1.0, life));
  vCol = mix(uCol0[g], uCol1[g], smoothstep(0.0, g == 0 ? 0.1 : 0.45, life));
  vRot = a + life * (aSeed.y - 0.5) * 2.0;
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
}`;

const SMOKE_FRAG = /* glsl */ `
uniform sampler2D uPuff;
${FOG_GLSL}
varying vec3 vCol, vDir;
varying float vA, vRot, vFog;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float cs = cos(vRot), sn = sin(vRot);
  vec2 uv = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
  vec4 t = texture2D(uPuff, uv);
  float a = t.a * vA * (1.0 - 0.5 * vFog);
  if (a < 0.003) discard;
  vec3 col = mix(vCol * (0.8 + 0.4 * t.r), bdSky(normalize(vDir)), vFog * 0.9);
  gl_FragColor = vec4(col, a);
}`;

const GLOW_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uPx, uMaxPt, uFogNear, uFogFar, uFlicker;
uniform vec4 uK, uS, uMin;
uniform vec3 uCol[4];
varying vec3 vCol;
varying float vA, vHard;
float pick(vec4 v, int g) { return g == 0 ? v.x : g == 1 ? v.y : g == 2 ? v.z : v.w; }
void main() {
  int g = int(aSeed.w + 0.5);
  float k = pick(uK, g);
  if (k < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float t = uTime * (0.6 + aSeed.y);
  float fl = g == 0 ? 0.92 + 0.08 * sin(t * 0.7 + aSeed.x * 40.0)
    : 0.62 + 0.38 * (0.5 + 0.5 * sin(t * 9.0 + aSeed.x * 31.0)) * (0.55 + 0.45 * sin(t * 3.7 + aSeed.x * 17.0));
  fl = mix(1.0, fl, uFlicker);
  float size = pick(uS, g) * (0.55 + 0.9 * aSeed.z) * (g >= 2 ? 0.85 + 0.3 * fl : 1.0);
  float px = size * uPx / max(0.05, -mv.z);
  float mn = pick(uMin, g);
  gl_PointSize = clamp(px, mn, uMaxPt);
  // a light smaller than its minimum size gets dimmer instead of smaller
  float fog = smoothstep(uFogNear, uFogFar, -mv.z);
  vA = k * fl * min(1.0, px / mn + 0.35) * (1.0 - 0.7 * fog);
  vCol = uCol[g];
  vHard = g == 3 ? 0.0 : 1.0;
}`;

const GLOW_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA, vHard;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  float a = mix(exp(-r2 * 2.2) * (1.0 - r2), exp(-r2 * 9.0) + 0.22 * exp(-r2 * 2.0) * (1.0 - r2), vHard) * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol * a, a);
}`;

function puffTexture(): CanvasTexture {
  // a soft, lumpy puff: many faint blobs, then a smooth round falloff (no visible rim)
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  const rnd = streamOf('backdrop:puff');
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.7) * S * 0.26;
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
    const rad = S * (0.07 + rnd() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const v = Math.round(170 + rnd() * 85);
    g.addColorStop(0, `rgba(${v},${v},${v},0.2)`);
    g.addColorStop(0.6, `rgba(${v},${v},${v},0.08)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  ctx.globalCompositeOperation = 'destination-in';
  const e = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.5);
  for (let k = 0; k <= 8; k++) { const u = k / 8; e.addColorStop(u, `rgba(0,0,0,${Math.exp(-u * u * 4.5) * (1 - u)})`); }
  ctx.fillStyle = e;
  ctx.fillRect(0, 0, S, S);
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const v3 = (c: RGB) => new Vector3(c[0], c[1], c[2]);
// these shaders write sRGB numbers straight out (no colour-space chunk), like the sky, so colours stay in sRGB
const lin = (c: RGB): RGB => c;

export interface FxLevels {
  smoke: number; dust: number; campSmoke: number; chimney: number;
  windows: number; camp: number; fire: number; glow: number;
  /** 0 day … 1 night: smoke darkens and catches the fire from below. */
  night: number;
  fogNear: number; fogFar: number;
  /** Colour the daylight smoke takes (the sky's haze), sRGB. */
  haze: RGB;
}

export class Fx {
  readonly smoke: Points;
  readonly glow: Points;
  private sm: ShaderMaterial;
  private gm: ShaderMaterial;
  private puff: CanvasTexture;

  /** `scale.dist`: the camera's distance to the city, which the columns are sized to (they should fill the sky over it). */
  constructor(src: SmokeSources, lights: LightSources, scale: { R: number; dustH: number; dist: number }, wind: Vector3, mobile: boolean, fog: FogUniforms) {
    const rnd = streamOf('backdrop:fx');
    // ---- smoke
    const pos: number[] = [], seed: number[] = [], grp: number[] = [], col: number[] = [];
    const column = (arr: Float32Array, group: number, per: number, scatter: number) => {
      for (let i = 0; i + 2 < arr.length; i += 3) {
        const cv = rnd();
        for (let k = 0; k < per; k++) {
          col.push(cv);
          const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * scatter;
          pos.push(arr[i] + Math.cos(a) * r, arr[i + 1], arr[i + 2] + Math.sin(a) * r);
          seed.push((k + rnd() * 0.8) / per, rnd(), rnd(), rnd());
          grp.push(group);
        }
      }
    };
    const m = mobile ? 0.65 : 1;
    const D = scale.dist;
    column(src.sack, 0, Math.round(150 * m), scale.R * 0.1);
    column(src.dust, 1, Math.round(150 * m), scale.dustH * 0.22);
    column(src.camp, 2, Math.round(44 * m), D * 0.004);
    column(src.hearth, 3, Math.round(40 * m), D * 0.002);
    const sg = new BufferGeometry();
    sg.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    sg.setAttribute('aSeed', new BufferAttribute(new Float32Array(seed), 4));
    sg.setAttribute('aGroup', new BufferAttribute(new Float32Array(grp), 1));
    sg.setAttribute('aCol', new BufferAttribute(new Float32Array(col), 1));
    this.puff = puffTexture();
    const R = scale.R;
    this.sm = new ShaderMaterial({
      vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG, transparent: true, depthWrite: false, blending: NormalBlending,
      uniforms: {
        uTime: { value: 0 }, uPx: { value: 500 }, uMaxPt: { value: 256 }, uFogNear: { value: 1 }, uFogFar: { value: 10 },
        uK: { value: new Vector4() },
        uA: { value: new Vector4(0.7, 0.4, 0.16, 0.15) },
        // column heights, puff sizes (scene units), rise speeds (cycles/s), wind lean
        uH: { value: new Vector4(D * 0.95, scale.dustH, D * 0.32, D * 0.2) },
        uS: { value: new Vector4(R * 0.3 + D * 0.075, scale.dustH * 0.4, D * 0.075, D * 0.05) },
        uSpeed: { value: new Vector4(0.03, 0.022, 0.028, 0.032) },
        uWindK: { value: new Vector4(0.55, 0.45, 0.85, 0.7) },
        uWind: { value: wind.clone() },
        uCol0: { value: [new Vector3(), new Vector3(), new Vector3(), new Vector3()] },
        uCol1: { value: [new Vector3(), new Vector3(), new Vector3(), new Vector3()] },
        uPuff: { value: this.puff }, ...fog,
      },
    });
    this.smoke = new Points(sg, this.sm);
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 5;

    // ---- lights
    const lp: number[] = [], ls: number[] = [];
    const add = (arr: Float32Array, group: number) => {
      for (let i = 0; i + 2 < arr.length; i += 3) { lp.push(arr[i], arr[i + 1], arr[i + 2]); ls.push(rnd(), rnd(), rnd(), group); }
    };
    add(lights.windows, 0); add(lights.camp, 1); add(lights.fires, 2); add(lights.glow, 3);
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(new Float32Array(lp), 3));
    lg.setAttribute('aSeed', new BufferAttribute(new Float32Array(ls), 4));
    this.gm = new ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uPx: { value: 500 }, uMaxPt: { value: 256 }, uFogNear: { value: 1 }, uFogFar: { value: 10 },
        uFlicker: { value: 1 },
        uK: { value: new Vector4() },
        uS: { value: new Vector4(0.0016, 0.006, 0.012 + R * 0.05, R * 1.6) },
        uMin: { value: new Vector4(1.6, 2.2, 3.0, 8.0) },
        uCol: { value: [v3(lin([1, 0.72, 0.38])), v3(lin([1, 0.55, 0.22])), v3(lin([1, 0.5, 0.16])), v3(lin([1, 0.36, 0.1]))] },
      },
    });
    this.glow = new Points(lg, this.gm);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 6;
  }

  /** Per frame: time, the projection scale (px per unit at distance 1) and the beat's levels. */
  update(time: number, pxScale: number, maxPt: number, l: FxLevels, flicker: number) {
    const su = this.sm.uniforms, gu = this.gm.uniforms;
    su.uTime.value = time; gu.uTime.value = time;
    su.uPx.value = pxScale; gu.uPx.value = pxScale;
    su.uMaxPt.value = maxPt; gu.uMaxPt.value = maxPt;
    su.uFogNear.value = l.fogNear; su.uFogFar.value = l.fogFar;
    gu.uFogNear.value = l.fogNear; gu.uFogFar.value = l.fogFar;
    gu.uFlicker.value = flicker;
    (su.uK.value as Vector4).set(l.smoke, l.dust, l.campSmoke, l.chimney);
    (gu.uK.value as Vector4).set(l.windows, l.camp, l.fire, l.glow);
    // the dome over the city: the fire's orange, or the amber of lamps on an ordinary night
    const f = l.glow > 0 ? Math.min(1, l.fire / l.glow) : 1;
    (gu.uCol.value as Vector3[])[3].set(1, 0.36 + (1 - f) * 0.22, 0.1 + (1 - f) * 0.1);
    const n = l.night;
    const haze = lin(l.haze);
    const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const c0 = su.uCol0.value as Vector3[], c1 = su.uCol1.value as Vector3[];
    // the sack: fire-lit at the base, black-brown above (grey-brown by day)
    const sackBase = mixc(lin([0.3, 0.27, 0.25]), lin([0.85, 0.36, 0.12]), n);
    const sackTop = mixc(lin([0.36, 0.34, 0.33]), lin([0.15, 0.11, 0.1]), n);
    c0[0].set(...sackBase); c1[0].set(...sackTop);
    // dust: ochre into the haze
    c0[1].set(...lin([0.72, 0.6, 0.45])); c1[1].set(...mixc(lin([0.8, 0.72, 0.6]), haze, 0.35));
    // camp and hearth smoke: pale by day, dark by night
    const pale = mixc(lin([0.82, 0.8, 0.78]), haze, 0.3), dark = lin([0.16, 0.14, 0.15]);
    c0[2].set(...mixc(pale, mixc(dark, lin([0.6, 0.3, 0.14]), 0.5), n)); c1[2].set(...mixc(pale, dark, n));
    c0[3].set(...mixc(pale, dark, n)); c1[3].set(...mixc(pale, dark, n));
  }

  dispose() {
    this.smoke.geometry.dispose(); this.glow.geometry.dispose();
    this.sm.dispose(); this.gm.dispose(); this.puff.dispose();
  }
}
