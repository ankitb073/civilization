// three.js side of #/river: the valley, a ridge per state (width = share of the world's people or land, height =
// share of the world's soldiers), the cut face at the present year, standing stones for the great events, era bands,
// a gliding camera and an analytic picker. Labels (names, arms, stones, eras) are a DOM layer projected each frame.

import {
  AmbientLight, BufferAttribute, BufferGeometry, Color, DirectionalLight, Fog, Group, HemisphereLight, LineBasicMaterial,
  LineSegments, Mesh, MeshLambertMaterial, PCFShadowMap, PerspectiveCamera, Plane, Raycaster, Scene, SRGBColorSpace,
  Vector2, Vector3, WebGLRenderer, type IUniform, type WebGLProgramParametersWithUniforms,
} from 'three';
import type { Era } from '../../../../engine/src/export/contract.ts';
import { armsSvg } from '../../heraldry.ts';
import { ROW, ROWS, YEAR_END, streamAt, type Model, type RStream } from './model.ts';

export type Theme = 'light' | 'dark';

// ---------------------------------------------------------------- world scale
/** valley bed width (a share of 1), units per year, units per unit share of the world's soldiers */
export const W = 40;
export const K = 0.1;
export const HS = 15;
const BASE = 0.04;
const BANK = 9;
const WALL = 54;
const CHUNK = 50; // rows per ridge mesh (250 years), so the camera culls what it cannot see
const X = (f: number) => (f - 0.5) * W;
const Z = (year: number) => year * K;
/** cross-section of a ridge: 0 at both borders, 1 on the crest */
const profile = (u: number) => Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.72);
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** A stable hash of a string, then of numbers (no Math.random anywhere). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
function h2(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** value noise, smooth, deterministic */
function noise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function rgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return [lin(parseInt(v.slice(0, 2), 16) / 255), lin(parseInt(v.slice(2, 4), 16) / 255), lin(parseInt(v.slice(4, 6), 16) / 255)];
}

const THEMES = {
  light: {
    fog: '#ece3d0', floor: '#e4d9c2', bank: '#d9cbad', hatch: '#c9b996', wallLo: '#d6c7a6', wallHi: '#bfae8a', grid: '#4a3a28',
    accent: '#a33a24', eraTint: 0.06, sun: '#fff2dc', sunI: 2.5, sky: '#f7f0e2', ground: '#8f7a5a', hemiI: 1.15, amb: 0.12,
    face: 0.66, stone: '#9b9182', ink: '#2a1e14', gridA: 0.16,
  },
  dark: {
    fog: '#161b22', floor: '#20262e', bank: '#1c2128', hatch: '#2c333d', wallLo: '#232a32', wallHi: '#323a45', grid: '#e8dcc2',
    accent: '#ef9a78', eraTint: 0.18, sun: '#ffe7c8', sunI: 2.3, sky: '#a9bccd', ground: '#2a2826', hemiI: 0.75, amb: 0.1,
    face: 0.6, stone: '#6f6a63', ink: '#efe6d2', gridA: 0.13,
  },
} as const;

const STONE_TINT: Record<string, string> = {
  war: '#8c4a3a', plague: '#6f7a4a', eruption: '#3b3633', contact: '#c2a25a', writing: '#a8865a', trade: '#5d7590', famine: '#8a7a52',
};
export const STONE_LABEL: Record<string, string> = {
  war: 'War', plague: 'Plague', eruption: 'Eruption', contact: 'First contact', writing: 'Writing', trade: 'Collapse of trade', famine: 'Famine',
};
/** wars on the west bank; nature and discovery on the east */
const stoneSide = (kind: string) => (kind === 'war' ? -1 : 1);

// ---------------------------------------------------------------- labels (DOM)
type LabKind = 'state' | 'arms' | 'stone' | 'era' | 'tick';
interface Lab {
  key: string; kind: LabKind; el: HTMLElement; w: number; h: number; o: number; want: number; prio: number;
  x: number; y: number; z: number; dy: number; scale: number; size: number; text: string;
}

class Labels {
  private root: HTMLElement;
  private els = new Map<string, Lab>();
  onClick?: (id: string) => void;
  constructor(root: HTMLElement) { this.root = root; }

  /** Start a frame: every label is unwanted until set() again. */
  begin() { for (const l of this.els.values()) l.want = 0; }

  set(key: string, kind: LabKind, x: number, y: number, z: number, prio: number, build: (el: HTMLElement) => void, opts: { dy?: number; scale?: number; size?: number; text?: string } = {}) {
    let l = this.els.get(key);
    if (!l) {
      const el = document.createElement('div');
      el.className = `rv-lab rv-lab--${kind}`;
      el.style.opacity = '0';
      this.root.appendChild(el);
      l = { key, kind, el, w: 0, h: 0, o: 0, want: 1, prio, x, y, z, dy: 0, scale: 1, size: 0, text: '' };
      this.els.set(key, l);
      build(el);
      l.text = opts.text ?? '';
      if (opts.size) el.style.fontSize = `${opts.size.toFixed(1)}px`;
      l.size = opts.size ?? 0;
      l.w = el.offsetWidth; l.h = el.offsetHeight;
    } else if ((opts.text !== undefined && opts.text !== l.text) || (opts.size !== undefined && Math.abs(opts.size - l.size) > 0.6)) {
      if (opts.text !== undefined && opts.text !== l.text) { l.el.replaceChildren(); build(l.el); l.text = opts.text; }
      if (opts.size !== undefined) { l.el.style.fontSize = `${opts.size.toFixed(1)}px`; l.size = opts.size; }
      l.w = l.el.offsetWidth; l.h = l.el.offsetHeight;
    }
    l.want = 1; l.prio = prio; l.x = x; l.y = y; l.z = z; l.dy = opts.dy ?? 0; l.scale = opts.scale ?? 1;
  }

  update(project: (x: number, y: number, z: number) => [number, number, number], w: number, h: number, dt: number, fade: (d: number) => number, avoid: [number, number, number, number][] = []) {
    const list = [...this.els.values()].sort((a, b) => b.want - a.want || b.prio - a.prio);
    const placed: [number, number, number, number][] = avoid.slice();
    for (const l of list) {
      const [px, py, dist] = project(l.x, l.y, l.z);
      let visible = l.want > 0 && dist > 0 && px > -60 && py > -40 && px < w + 60 && py < h + 40;
      const sw = l.w * l.scale, sh = l.h * l.scale;
      const bx = px - sw / 2, by = py - sh + l.dy;
      const fo = visible ? fade(dist) : 0;
      if (fo < 0.04) visible = false;
      // whole labels only: nothing cut by the frame
      if (bx < 4 || by < 4 || bx + sw > w - 4 || by + sh > h - 4) visible = false;
      if (visible) {
        for (const r of placed) if (bx < r[0] + r[2] && bx + sw > r[0] && by < r[1] + r[3] && by + sh > r[1]) { visible = false; break; }
        if (visible) placed.push([bx - 2, by - 2, sw + 4, sh + 4]);
      }
      const target = visible ? fo : 0;
      l.o += (target - l.o) * Math.min(1, dt * 10);
      if (Math.abs(l.o - target) < 0.02) l.o = target;
      if (l.o <= 0.01) {
        if (l.el.style.opacity !== '0') { l.el.style.opacity = '0'; l.el.style.visibility = 'hidden'; }
        if (l.want === 0) { l.el.remove(); this.els.delete(l.key); }
        continue;
      }
      l.el.style.visibility = '';
      l.el.style.opacity = l.o.toFixed(3);
      if (visible) l.el.style.transform = `translate3d(${bx.toFixed(1)}px,${by.toFixed(1)}px,0)${l.scale !== 1 ? ` scale(${l.scale.toFixed(3)})` : ''}`;
    }
  }

  clear() { for (const l of this.els.values()) l.el.remove(); this.els.clear(); }
}

// ---------------------------------------------------------------- the scene
export interface RiverOpts { theme: Theme; reducedMotion: boolean; mobile: boolean; eras: Era[] }
export interface Pick { st: RStream; year: number; face: boolean }
export interface Pose { az: number; el: number; dist: number; ahead: number; lift: number }

export class RiverScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  model: Model;
  /** the year shown (eases toward target) and the year asked for */
  year = 0;
  target = 0;
  playing = false;
  speed = 90; // years per second
  overview = 0; // 0 = in the valley, 1 = the whole river from above (eased)
  overviewTarget = 0;
  /** user's swing around the valley (radians) and zoom (multiplier) */
  yaw = 0;
  zoom = 1;
  hoverK = -1;
  /** vertical exaggeration: 1 in the valley, more from above so the relief still reads */
  vex = 1;
  onFrame?: (year: number) => void;
  onEnd?: () => void;
  readonly stats = { frame: [] as number[], render: [] as number[], build: 0, tris: 0 };

  private canvas: HTMLCanvasElement;
  private opts: RiverOpts;
  private theme: Theme;
  private ridges = new Group();
  private ridgeMat: MeshLambertMaterial;
  private faceMesh: Mesh;
  private faceGeo: BufferGeometry;
  private faceMat: MeshLambertMaterial;
  private skyline: LineSegments;
  private skyMat: LineBasicMaterial;
  private floor: Mesh;
  private floorMat: MeshLambertMaterial;
  private walls: Mesh;
  private wallMat: MeshLambertMaterial;
  private stones: Mesh;
  private stoneMat: MeshLambertMaterial;
  private stoneTops: { x: number; y: number; z: number }[] = [];
  private sun: DirectionalLight;
  private hemi: HemisphereLight;
  private amb: AmbientLight;
  private fog: Fog;
  private clip = new Plane(new Vector3(0, 0, -1), 0);
  private uniforms: Record<string, IUniform>;
  private labels: Labels;
  private raf = 0;
  private lastT = 0;
  private dirty = true;
  private faceYear = -1;
  private w = 1;
  private h = 1;
  private v = new Vector3();
  private ray = new Raycaster();
  private ndc = new Vector2();
  private endFired = false;
  /** HUD elements the scene's labels keep clear of */
  avoidEls: HTMLElement[] = [];
  private avoidRects: [number, number, number, number][] = [];
  private avoidN = 0;

  constructor(canvas: HTMLCanvasElement, labelRoot: HTMLElement, model: Model, opts: RiverOpts) {
    this.canvas = canvas;
    this.model = model;
    this.opts = opts;
    this.theme = opts.theme;
    const t0 = performance.now();
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.localClippingEnabled = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    this.renderer = renderer;
    this.camera = new PerspectiveCamera(opts.mobile ? 46 : 38, 1, 0.5, 900);
    const T = THEMES[this.theme];
    this.fog = new Fog(new Color(T.fog), 60, 200);
    this.scene.fog = this.fog;
    this.labels = new Labels(labelRoot);

    this.uniforms = {
      uK: { value: K },
      uHS: { value: HS },
      uBase: { value: BASE },
      uNow: { value: 0 },
      uHover: { value: -1 },
      uBedHalf: { value: W / 2 },
      uBankHalf: { value: W / 2 + BANK },
      uEra: { value: Array.from({ length: 8 }, (_, i) => opts.eras[i]?.start ?? 99999) },
      uEraN: { value: Math.min(8, opts.eras.length) },
      uEraTint: { value: T.eraTint },
      uHatch: { value: new Color(T.hatch) },
      uGrid: { value: new Color(T.grid) },
      uGridA: { value: T.gridA },
      uAccent: { value: new Color(T.accent) },
      uFaceK: { value: T.face },
    };

    // ---- lights
    this.hemi = new HemisphereLight(new Color(T.sky), new Color(T.ground), T.hemiI);
    this.amb = new AmbientLight(0xffffff, T.amb);
    this.sun = new DirectionalLight(new Color(T.sun), T.sunI);
    this.sun.castShadow = true;
    const sm = opts.mobile ? 1024 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = -52; sc.right = 52; sc.top = 52; sc.bottom = -52; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.hemi, this.amb, this.sun, this.sun.target);

    // ---- ridges
    this.ridgeMat = new MeshLambertMaterial({ vertexColors: true, clippingPlanes: [this.clip], clipShadows: true });
    this.ridgeMat.onBeforeCompile = (sh) => this.patchRidge(sh, false);
    this.scene.add(this.ridges);

    // ---- the cut face at the present year
    this.faceGeo = new BufferGeometry();
    this.faceMat = new MeshLambertMaterial({ vertexColors: true });
    this.faceMat.onBeforeCompile = (sh) => this.patchRidge(sh, true);
    this.faceMesh = new Mesh(this.faceGeo, this.faceMat);
    this.faceMesh.frustumCulled = false;
    this.faceMesh.receiveShadow = true;
    this.skyMat = new LineBasicMaterial({ color: new Color(T.ink), transparent: true, opacity: this.theme === 'dark' ? 0.55 : 0.45 });
    this.skyline = new LineSegments(new BufferGeometry(), this.skyMat);
    this.skyline.frustumCulled = false;
    this.scene.add(this.faceMesh, this.skyline);

    // ---- the valley floor, banks and hills
    this.floorMat = new MeshLambertMaterial({ vertexColors: true });
    this.floorMat.onBeforeCompile = (sh) => this.patchFloor(sh);
    this.floor = new Mesh(new BufferGeometry(), this.floorMat);
    this.floor.receiveShadow = true;
    this.wallMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.walls = new Mesh(new BufferGeometry(), this.wallMat);
    this.walls.receiveShadow = true;
    this.walls.castShadow = true;
    this.scene.add(this.floor, this.walls);
    this.buildGround();

    // ---- standing stones
    this.stoneMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true, clippingPlanes: [this.clip], clipShadows: true });
    this.stones = new Mesh(new BufferGeometry(), this.stoneMat);
    this.stones.castShadow = true;
    this.stones.receiveShadow = true;
    this.scene.add(this.stones);
    this.buildStones();

    this.buildRidges();
    this.stats.build = performance.now() - t0;
  }

  // ---------------------------------------------------------------- shaders
  private patchRidge(sh: WebGLProgramParametersWithUniforms, face: boolean) {
    Object.assign(sh.uniforms, this.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aStream;
varying float vStream;
varying vec3 vWp;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vStream = aStream;
vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uK, uHS, uBase, uNow, uHover, uGridA, uFaceK;
uniform vec3 uGrid, uAccent;
varying float vStream;
varying vec3 vWp;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float yr = vWp.z / uK;
  ${face ? 'diffuseColor.rgb *= uFaceK;' : `
  // centuries across the ridges, every fifth stronger; fades out where they would crowd
  float py = fwidth(yr);
  float fadeG = clamp(1.0 - py / 14.0, 0.0, 1.0);
  float c1 = abs(fract(yr / 100.0 + 0.5) - 0.5) * 100.0;
  float c5 = abs(fract(yr / 500.0 + 0.5) - 0.5) * 500.0;
  float g1 = 1.0 - smoothstep(0.0, py * 1.1 + 0.15, c1);
  float g5 = 1.0 - smoothstep(0.0, py * 1.6 + 0.3, c5);
  diffuseColor.rgb = mix(diffuseColor.rgb, uGrid, (g1 * 0.5 + g5 * 0.9) * uGridA * fadeG);
  // the newest decades glow faintly: the present is being laid down
  float fresh = 1.0 - smoothstep(0.0, 60.0, uNow - yr);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.12 + 0.02, fresh * 0.6);`}
  // contours: every 2.5% of the world's soldiers
  float hy = (vWp.y - uBase) / uHS / 0.025;
  float cw = fwidth(hy);
  float cd = abs(fract(hy + 0.5) - 0.5);
  float cl = (1.0 - smoothstep(0.0, cw * 1.1, cd)) * step(0.5, hy) * clamp(1.0 - cw * 1.6, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62, cl * 0.75);
  if (abs(vStream - uHover) < 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.97, 0.9), 0.22);
}`);
  }

  private patchFloor(sh: WebGLProgramParametersWithUniforms) {
    Object.assign(sh.uniforms, this.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vWp;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uK, uNow, uBedHalf, uBankHalf, uEraTint, uGridA;
uniform float uEra[8];
uniform int uEraN;
uniform vec3 uHatch, uGrid, uAccent;
varying vec3 vWp;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float yr = vWp.z / uK;
  float ax = abs(vWp.x);
  float py = fwidth(yr);
  bool past = yr <= uNow && yr >= 0.0;
  // era bands: alternate tints, a ruled line where each begins
  float idx = 0.0;
  float edge = 1e5;
  for (int i = 0; i < 8; i++) {
    if (i >= uEraN) break;
    if (yr >= uEra[i]) idx = float(i);
    if (i > 0) edge = min(edge, abs(yr - uEra[i]));
  }
  float inBank = 1.0 - smoothstep(uBankHalf - 0.5, uBankHalf + 2.0, ax);
  if (past) {
    diffuseColor.rgb *= 1.0 - mod(idx, 2.0) * uEraTint * inBank;
    float el = (1.0 - smoothstep(0.0, py * 1.5 + 0.4, edge)) * inBank;
    diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, el * 0.55);
  }
  // the bed's margins: lesser states and stateless peoples, hatched as on the paper Histomap
  if (ax < uBedHalf && yr >= 0.0 && yr <= uNow) {
    float hs = fract((vWp.x + vWp.z) * 1.15);
    float hw = fwidth((vWp.x + vWp.z) * 1.15);
    float hatch = smoothstep(0.55 - hw, 0.55 + hw, hs) * (1.0 - smoothstep(0.85 - hw, 0.85 + hw, hs));
    diffuseColor.rgb = mix(diffuseColor.rgb, uHatch, hatch * clamp(1.0 - hw * 2.2, 0.0, 1.0) * 0.8);
  }
  // centuries and half-millennia, ruled across the bed and banks
  if (past) {
    float c1 = abs(fract(yr / 100.0 + 0.5) - 0.5) * 100.0;
    float c5 = abs(fract(yr / 500.0 + 0.5) - 0.5) * 500.0;
    float fadeG = clamp(1.0 - py / 14.0, 0.0, 1.0);
    float g = (1.0 - smoothstep(0.0, py * 1.1 + 0.15, c1)) * 0.45 + (1.0 - smoothstep(0.0, py * 1.6 + 0.3, c5));
    diffuseColor.rgb = mix(diffuseColor.rgb, uGrid, g * uGridA * fadeG * inBank);
  }
  // the present: a bright rule across the valley
  float dn = abs(yr - uNow);
  float nl = 1.0 - smoothstep(0.0, py * 1.5 + 1.2, dn);
  diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, nl * 0.85 * inBank);
  // the future is unwritten: paler
  if (yr > uNow + 1.0) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.33))), 0.6) * 1.03;
}`);
  }

  // ---------------------------------------------------------------- geometry
  /** Every ridge, split into chunks of CHUNK rows; normals are computed on the whole strip so chunks join smoothly. */
  buildRidges() {
    for (const c of [...this.ridges.children]) { (c as Mesh).geometry.dispose(); this.ridges.remove(c); }
    const m = this.model;
    const nChunks = Math.ceil((ROWS - 1) / CHUNK);
    const parts: { pos: number[]; nor: number[]; col: number[]; sid: number[]; idx: number[] }[] = Array.from({ length: nChunks }, () => ({ pos: [], nor: [], col: [], sid: [], idx: [] }));
    let tris = 0;
    for (const st of m.streams) {
      const cols = clamp(2 * Math.round((5 + st.maxW * 90) / 2) + 1, 5, 19);
      const len = st.r1 - st.r0 + 1;
      const P = new Float32Array(len * cols * 3);
      const us = Array.from({ length: cols }, (_, c) => c / (cols - 1));
      const pr = us.map(profile);
      for (let j = 0; j < len; j++) {
        const x0 = st.x0[j], x1 = st.x1[j], hh = st.h[j];
        const z = Z((st.r0 + j) * ROW);
        for (let c = 0; c < cols; c++) {
          const o = (j * cols + c) * 3;
          P[o] = X(x0 + (x1 - x0) * us[c]);
          P[o + 1] = BASE + hh * HS * pr[c];
          P[o + 2] = z;
        }
      }
      const N = new Float32Array(len * cols * 3);
      const a = new Vector3(), b = new Vector3(), n = new Vector3();
      for (let j = 0; j < len; j++) {
        const ja = Math.max(0, j - 1), jb = Math.min(len - 1, j + 1);
        for (let c = 0; c < cols; c++) {
          const ca = Math.max(0, c - 1), cb = Math.min(cols - 1, c + 1);
          const oa = (j * cols + ca) * 3, ob = (j * cols + cb) * 3, ra = (ja * cols + c) * 3, rb = (jb * cols + c) * 3;
          a.set(P[ob] - P[oa], P[ob + 1] - P[oa + 1], P[ob + 2] - P[oa + 2]);
          b.set(P[rb] - P[ra], P[rb + 1] - P[ra + 1], P[rb + 2] - P[ra + 2]);
          n.crossVectors(b, a);
          if (n.lengthSq() < 1e-12) n.set(0, 1, 0);
          n.normalize();
          if (n.y < 0) n.negate();
          const o = (j * cols + c) * 3;
          N[o] = n.x; N[o + 1] = n.y; N[o + 2] = n.z;
        }
      }
      const [cr, cg, cb] = rgb(st.color);
      const ao = pr.map((p) => 0.74 + 0.26 * Math.sqrt(p));
      for (let q = 0; q < nChunks; q++) {
        const ra = Math.max(st.r0, q * CHUNK), rb = Math.min(st.r1, (q + 1) * CHUNK);
        if (rb - ra < 1) continue;
        const part = parts[q];
        const base = part.pos.length / 3;
        for (let r = ra; r <= rb; r++) {
          const j = r - st.r0;
          for (let c = 0; c < cols; c++) {
            const o = (j * cols + c) * 3;
            part.pos.push(P[o], P[o + 1], P[o + 2]);
            part.nor.push(N[o], N[o + 1], N[o + 2]);
            part.col.push(cr * ao[c], cg * ao[c], cb * ao[c]);
            part.sid.push(st.k);
          }
        }
        for (let r = 0; r < rb - ra; r++) {
          for (let c = 0; c < cols - 1; c++) {
            const i0 = base + r * cols + c, i1 = i0 + 1, i2 = i0 + cols, i3 = i2 + 1;
            part.idx.push(i0, i2, i1, i1, i2, i3);
            tris += 2;
          }
        }
      }
    }
    for (const part of parts) {
      if (!part.idx.length) continue;
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(part.pos), 3));
      g.setAttribute('normal', new BufferAttribute(new Float32Array(part.nor), 3));
      g.setAttribute('color', new BufferAttribute(new Float32Array(part.col), 3));
      g.setAttribute('aStream', new BufferAttribute(new Float32Array(part.sid), 1));
      g.setIndex(part.pos.length / 3 > 65535 ? new BufferAttribute(new Uint32Array(part.idx), 1) : new BufferAttribute(new Uint16Array(part.idx), 1));
      g.computeBoundingSphere();
      const mesh = new Mesh(g, this.ridgeMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.ridges.add(mesh);
    }
    this.stats.tris = tris;
    this.faceYear = -1;
    this.dirty = true;
  }

  setModel(m: Model) {
    this.model = m;
    this.buildRidges();
  }

  /** The cut face at the present year: every living state's cross-section, and its skyline. */
  private buildFace(year: number) {
    const m = this.model;
    const f = clamp(year / ROW, 0, ROWS - 1);
    const z = Z(year);
    const seen = new Set<number>();
    const pos: number[] = [], nor: number[] = [], col: number[] = [], sid: number[] = [], idx: number[] = [], sky: number[] = [];
    const lists = [m.alive[Math.floor(f)], m.alive[Math.min(ROWS - 1, Math.ceil(f))]];
    for (const list of lists) for (const k of list) {
      if (seen.has(k)) continue;
      seen.add(k);
      const st = m.streams[k];
      const s = streamAt(st, f);
      if (!s || s.x1 - s.x0 < 1e-5) continue;
      const cols = clamp(2 * Math.round((5 + st.maxW * 90) / 2) + 1, 5, 19);
      const [cr, cg, cb] = rgb(st.color);
      const base = pos.length / 3;
      for (let c = 0; c < cols; c++) {
        const u = c / (cols - 1);
        const x = X(s.x0 + (s.x1 - s.x0) * u);
        const y = BASE + s.h * HS * profile(u);
        pos.push(x, y, z, x, 0, z);
        nor.push(0, 0.25, 1, 0, 0.25, 1);
        col.push(cr, cg, cb, cr * 0.8, cg * 0.8, cb * 0.8);
        sid.push(k, k);
        if (c > 0) {
          const i = base + c * 2;
          idx.push(i - 2, i - 1, i, i, i - 1, i + 1);
          sky.push(pos[(i - 2) * 3], pos[(i - 2) * 3 + 1] + 0.02, z + 0.02, x, y + 0.02, z + 0.02);
        }
      }
    }
    const g = this.faceGeo;
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    g.setAttribute('aStream', new BufferAttribute(new Float32Array(sid), 1));
    g.setIndex(idx);
    const sg = this.skyline.geometry;
    sg.setAttribute('position', new BufferAttribute(new Float32Array(sky), 3));
    this.faceYear = year;
  }

  /** Floor (bed + banks, flat, shaded by era) and the hills that wall the valley, closing it before AY 0. */
  private buildGround() {
    const T = THEMES[this.theme];
    const zA = -160, zB = Z(YEAR_END) + 160;
    const XW = W / 2 + BANK;
    // floor: a flat sheet with rows every 25 years so fog and lighting interpolate smoothly
    {
      const xs = [-XW - 1.5, -W / 2, W / 2, XW + 1.5];
      const zs: number[] = [];
      for (let z = zA; z <= zB; z += 2.5) zs.push(z);
      const pos: number[] = [], col: number[] = [], idx: number[] = [];
      const fl = rgb(T.floor), bk = rgb(T.bank);
      for (const z of zs) for (let i = 0; i < xs.length; i++) {
        pos.push(xs[i], 0, z);
        const c = i === 0 || i === xs.length - 1 ? bk : fl;
        col.push(...c);
      }
      const nx = xs.length;
      for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const g = this.floor.geometry;
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
    }
    // hills: low-poly, deterministic noise; they rise across the valley's head before AY 0
    {
      const lo = rgb(T.wallLo), hi = rgb(T.wallHi), bk = rgb(T.bank);
      const nxs = 15;
      const pos: number[] = [], col: number[] = [], idx: number[] = [];
      const step = 3.2;
      const zs: number[] = [];
      for (let z = zA; z <= zB; z += step) zs.push(z);
      const height = (x: number, z: number) => {
        const ax = Math.abs(x);
        const out = Math.max(0, ax - XW);
        const head = smooth(-12, -120, z); // the valley closes, gently, beyond its source
        const rise = smooth(0, WALL * 0.75, out) * (5 + 6 * noise(x * 0.05 + 11, z * 0.035)) + smooth(WALL * 0.45, WALL, out) * 7 * noise(x * 0.03 - 4, z * 0.02 + 3);
        const bump = noise(x * 0.18, z * 0.12) * 1.4 * smooth(0, 6, out);
        const headH = head * (2.5 + 6 * noise(x * 0.06 + 2, z * 0.05));
        return Math.max(rise + bump, headH * (ax < XW ? 1 : 0) + (ax < XW ? 0 : rise + bump)) - 0.05;
      };
      // columns: from the bank's edge outwards, both sides, plus the head across the bed
      const xsL: number[] = [], xsR: number[] = [];
      for (let i = 0; i <= nxs; i++) { const t = i / nxs; const x = XW + Math.pow(t, 1.35) * WALL; xsR.push(x); xsL.unshift(-x); }
      const xsMid: number[] = [];
      for (let i = 1; i < 12; i++) xsMid.push(-XW + (2 * XW * i) / 12);
      const xs = [...xsL, ...xsMid, ...xsR];
      const nx = xs.length;
      for (const z of zs) for (let i = 0; i < nx; i++) {
        const jx = i > 0 && i < nx - 1 ? (h2(i * 7, Math.round(z * 10)) - 0.5) * 1.2 : 0;
        const x = xs[i] + (Math.abs(xs[i]) > XW + 0.5 ? jx : 0);
        const y = height(x, z);
        pos.push(x, Math.abs(x) < XW + 0.01 && z > -3 ? -0.3 : y, z);
        const t = clamp(y / 18, 0, 1);
        const c = y < 0.4 ? bk : [lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, lo[2] + (hi[2] - lo[2]) * t];
        const sh = 0.94 + 0.12 * h2(i * 13, Math.round(z * 3));
        col.push(c[0] * sh, c[1] * sh, c[2] * sh);
      }
      for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        // the bed itself stays open (the floor is there) except at the head
        const xm = (xs[i] + xs[i + 1]) / 2;
        if (Math.abs(xm) < XW && zs[j] > -4) continue;
        idx.push(a, c, b, b, c, d);
      }
      const g = this.walls.geometry;
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
    }
  }

  /** Menhirs: an irregular tapering prism per great event, its height by the event's magnitude. */
  private buildStones() {
    const T = THEMES[this.theme];
    const pos: number[] = [], col: number[] = [];
    this.stoneTops = [];
    const base = rgb(T.stone);
    for (const s of this.model.stones) {
      const hv = hash(s.id);
      const r = (n: number) => ((hv >>> (n * 3)) & 1023) / 1023;
      const side = stoneSide(s.kind);
      const x = side * (W / 2 + 2.6 + r(1) * 2.2);
      const z = Z(s.year);
      const hgt = 1.8 + 3 * s.mag;
      const rad = 0.55 + 0.25 * r(2);
      const n = 5 + (hv % 3);
      const tilt = (r(3) - 0.5) * 0.18, rot = r(4) * Math.PI;
      const tint = rgb(STONE_TINT[s.kind] ?? T.stone);
      const c = [base[0] * 0.55 + tint[0] * 0.45, base[1] * 0.55 + tint[1] * 0.45, base[2] * 0.55 + tint[2] * 0.45];
      const ring = (y: number, k: number) => Array.from({ length: n }, (_, i) => {
        const a = rot + (i / n) * Math.PI * 2;
        const rr = rad * k * (0.8 + 0.4 * h2(hv & 0xffff, i * 31 + Math.round(y * 10)));
        return [x + Math.cos(a) * rr + tilt * y, y, z + Math.sin(a) * rr * 0.8];
      });
      const b0 = ring(-0.2, 1.05), b1 = ring(hgt * 0.62, 0.82), top = [x + tilt * hgt, hgt + 0.2 * r(5), z];
      const b2 = ring(hgt * 0.9, 0.5);
      const tri = (p: number[], q: number[], w: number[], shade: number) => {
        pos.push(...p, ...q, ...w);
        for (let i = 0; i < 3; i++) col.push(c[0] * shade, c[1] * shade, c[2] * shade);
      };
      for (let i = 0; i < n; i++) {
        const i2 = (i + 1) % n;
        const sh = 0.9 + 0.2 * h2(hv & 0xfff, i);
        tri(b0[i], b0[i2], b1[i], sh); tri(b1[i], b0[i2], b1[i2], sh);
        tri(b1[i], b1[i2], b2[i], sh * 0.97); tri(b2[i], b1[i2], b2[i2], sh * 0.97);
        tri(b2[i], b2[i2], top, sh * 1.04);
      }
      // a low plinth of turf-free paving
      this.stoneTops.push({ x: top[0], y: top[1], z });
    }
    const g = this.stones.geometry;
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
  }

  // ---------------------------------------------------------------- camera
  /** The camera for a year: behind the cut face, looking back up the valley into the past. */
  private poseFor(year: number): { pos: Vector3; look: Vector3 } {
    const mobile = this.opts.mobile;
    const aspect = this.camera.aspect;
    const zN = Z(year);
    const sway = this.opts.reducedMotion ? 0 : 0.12 * Math.sin((year / 1500) * Math.PI * 2) + 0.04 * Math.sin((year / 410) * Math.PI * 2);
    const az = 0.1 + sway + this.yaw;
    const tall = aspect < 0.9;
    // stand in front of the cut face, above the valley, looking back up it: the face low in the frame, the past
    // receding to the top. Portrait screens stand further back and higher (more of the past fits above).
    const fovH = 2 * Math.atan(Math.tan((this.camera.fov * Math.PI) / 360) * aspect);
    const halfW = Math.tan(fovH / 2);
    const want = tall ? 12.5 : 21; // half the width that should fit at the face
    const k = clamp(want / halfW / (tall ? 64 : 36), 0.85, 1.9) * this.zoom;
    const hc = (tall ? 38 : 19) * k, d = (tall ? 52 : 27) * k, back = (tall ? 47 : 22) * k;
    const pos = new Vector3(Math.sin(az) * d, hc, zN + Math.cos(az) * d);
    const look = new Vector3(-Math.sin(az) * back * 0.35, 0, zN - back);
    // the whole river, from high on the west bank (time runs left to right, as on the paper Histomap's thumbnail):
    // framed so AY 0 and the present both fit, clear of the HUD
    const o = this.overview;
    if (o > 0) {
      const zEnd = Z(Math.max(300, year));
      const oaz = -(tall ? 0.26 : clamp(0.42 + aspect * 0.36, 0.9, 1.36)) + this.yaw;
      const oel = tall ? 0.78 : 0.5;
      const dir = new Vector3(Math.sin(oaz) * Math.cos(oel), Math.sin(oel), Math.cos(oaz) * Math.cos(oel));
      const fit = this.fitOverview(dir, zEnd, tall);
      const e = o * o * (3 - 2 * o);
      pos.lerp(fit.pos, e);
      look.lerp(fit.look, e);
    }
    return { pos, look };
  }

  private fitCache: { key: string; pos: Vector3; look: Vector3 } | null = null;
  /** The nearest camera along `dir` that sees the whole valley from AY 0 to the present inside the frame's margins. */
  private fitOverview(dir: Vector3, zEnd: number, tall: boolean): { pos: Vector3; look: Vector3 } {
    const key = `${dir.x.toFixed(3)},${dir.y.toFixed(3)},${dir.z.toFixed(3)},${zEnd.toFixed(1)},${this.camera.aspect.toFixed(3)},${this.zoom.toFixed(3)}`;
    if (this.fitCache?.key === key) return this.fitCache;
    const cam = this.camera.clone();
    const xw = W / 2 + 4;
    const pts = [[-xw, 0, -2], [xw, 0, -2], [-xw, 0, zEnd + 2], [xw, 0, zEnd + 2], [-xw, 4, zEnd], [xw, 4, zEnd], [0, 5, zEnd * 0.5]].map((p) => new Vector3(p[0], p[1], p[2]));
    // frame margins in NDC: the plate sits top-left and the key top-right (bottom-left on phones)
    const m = tall ? { l: -0.92, r: 0.92, b: -0.74, t: 0.56 } : { l: -0.93, r: 0.9, b: -0.86, t: 0.62 };
    let look = new Vector3(0, 0, zEnd * 0.5);
    const v = new Vector3();
    let best = { pos: look.clone().addScaledVector(dir, 600), look: look.clone() };
    for (let pass = 0; pass < 3; pass++) {
      let lo = 20, hi = 2400;
      let box = [0, 0, 0, 0];
      for (let it = 0; it < 22; it++) {
        const dist = (lo + hi) / 2;
        cam.position.copy(look).addScaledVector(dir, dist);
        cam.lookAt(look);
        cam.updateMatrixWorld();
        let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
        for (const p of pts) { v.copy(p).project(cam); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
        const fits = x1 - x0 <= m.r - m.l && y1 - y0 <= m.t - m.b;
        if (fits) { hi = dist; box = [x0, x1, y0, y1]; } else lo = dist;
      }
      const dist = hi * this.zoom;
      cam.position.copy(look).addScaledVector(dir, dist);
      cam.lookAt(look);
      cam.updateMatrixWorld();
      best = { pos: cam.position.clone(), look: look.clone() };
      // re-centre: shift the look point so the box's centre lands on the margins' centre
      const [x0, x1, y0, y1] = box;
      const dx = (m.l + m.r) / 2 - (x0 + x1) / 2, dy = (m.b + m.t) / 2 - (y0 + y1) / 2;
      const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      const halfH = Math.tan((cam.fov * Math.PI) / 360) * dist, halfW = halfH * cam.aspect;
      look = look.clone().addScaledVector(right, -dx * halfW).addScaledVector(up, -dy * halfH);
    }
    this.fitCache = { key, ...best };
    return best;
  }

  // ---------------------------------------------------------------- loop
  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    const dpr = Math.min(window.devicePixelRatio || 1, this.opts.mobile ? 2 : 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.avoidN = 0;
    this.dirty = true;
  }

  start() {
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = this.lastT ? Math.min(0.1, (t - this.lastT) / 1000) : 1 / 60;
      if (this.lastT) this.stats.frame.push(t - this.lastT);
      if (this.stats.frame.length > 600) this.stats.frame.splice(0, 300);
      this.lastT = t;
      this.tick(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { cancelAnimationFrame(this.raf); this.raf = 0; this.lastT = 0; }

  /** Advance time and the camera by dt seconds; render when anything moved. */
  tick(dt: number) {
    if (this.playing) {
      this.target = Math.min(YEAR_END, this.target + this.speed * dt);
      if (this.target >= YEAR_END) { this.playing = false; if (!this.endFired) { this.endFired = true; this.onEnd?.(); } }
    }
    const before = this.year;
    if (this.playing) this.year = this.target;
    else {
      const k = this.opts.reducedMotion ? 1 : 1 - Math.exp(-dt * 5.5);
      this.year += (this.target - this.year) * k;
      if (Math.abs(this.target - this.year) < 0.05) this.year = this.target;
    }
    const ob = this.overview;
    if (this.overview !== this.overviewTarget) {
      const k = this.opts.reducedMotion ? 1 : Math.min(1, dt / 1.4);
      this.overview += Math.sign(this.overviewTarget - this.overview) * k;
      if (Math.abs(this.overview - this.overviewTarget) < 0.01) this.overview = this.overviewTarget;
    }
    if (this.year !== before || this.overview !== ob) this.dirty = true;
    if (!this.dirty) { this.labelsOnly(dt); return; }
    this.renderNow(dt);
  }

  private labelFrames = 0;
  private labelsOnly(dt: number) {
    // labels still fade in and out after the scene stops moving
    if (this.labelFrames > 0) { this.labelFrames--; this.updateLabels(dt); }
  }

  renderNow(dt = 1 / 60) {
    const t0 = performance.now();
    const year = this.year;
    if (Math.abs(year - this.faceYear) > 0.01) this.buildFace(year);
    const zN = Z(year);
    this.clip.constant = zN + 0.001;
    this.uniforms.uNow.value = year;
    const oe = this.overview * this.overview * (3 - 2 * this.overview);
    this.vex = 1 + 1.8 * oe;
    this.ridges.scale.y = this.vex;
    this.faceMesh.scale.y = this.vex;
    this.skyline.scale.y = this.vex;
    this.uniforms.uHS.value = HS * this.vex;
    const { pos, look } = this.poseFor(year);
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    // fog: the valley fades a millennium and more behind the present; the overview sees everything
    const o = this.overview;
    const near = 55, far = this.opts.mobile ? 175 : 190;
    this.fog.near = near + o * 600;
    this.fog.far = far + o * 900;
    // the sun follows the present, low from the south-west, so the ridges cast long shadows up the valley
    const sc = new Vector3(0, 0, zN - 32 + o * (Z(year) * 0.5 - zN + 32));
    this.sun.target.position.copy(sc);
    this.sun.position.set(sc.x - 60, sc.y + 85, sc.z + 55);
    const ext = 58 + o * 230;
    const cam = this.sun.shadow.camera;
    if (cam.right !== ext) { cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext; cam.far = 260 + o * 300; cam.updateProjectionMatrix(); }
    // nothing past the fog is drawn (whole chunks of ridges drop out)
    const farC = this.fog.far * 1.15 + 40;
    if (Math.abs(this.camera.far - farC) > 1) { this.camera.far = farC; this.camera.updateProjectionMatrix(); }
    this.renderer.render(this.scene, this.camera);
    this.updateLabels(dt);
    this.stats.render.push(performance.now() - t0);
    if (this.stats.render.length > 600) this.stats.render.splice(0, 300);
    this.labelFrames = 40;
    this.dirty = false;
    this.onFrame?.(year);
  }

  // ---------------------------------------------------------------- labels
  private project = (x: number, y: number, z: number): [number, number, number] => {
    const v = this.v.set(x, y, z);
    const dist = v.distanceTo(this.camera.position);
    v.project(this.camera);
    if (v.z > 1) return [0, 0, -1];
    return [(v.x * 0.5 + 0.5) * this.w, (-v.y * 0.5 + 0.5) * this.h, dist];
  };

  private updateLabels(dt: number) {
    const m = this.model;
    const L = this.labels;
    const year = this.year;
    const zN = Z(year);
    const f = clamp(year / ROW, 0, ROWS - 1);
    const mobile = this.opts.mobile;
    const o = this.overview;
    L.begin();
    const camZ = this.camera.position.z;
    const ref = mobile ? 30 : 36;
    // living states: their names over the cut face, by width on screen
    const living: { st: RStream; s: { x0: number; x1: number; h: number } }[] = [];
    for (const k of m.alive[Math.round(f)] ?? []) {
      const st = m.streams[k];
      const s = streamAt(st, f);
      if (s && s.x1 - s.x0 > 1e-4) living.push({ st, s });
    }
    if (o < 0.5) {
      for (const { st, s } of living) {
        const xm = X((s.x0 + s.x1) / 2);
        const [ax] = this.project(X(s.x0), 0, zN);
        const [bx] = this.project(X(s.x1), 0, zN);
        const px = Math.abs(bx - ax);
        const name = st.name;
        const size = clamp(px / (name.length * 0.72 + 1.5), mobile ? 8.5 : 9.5, mobile ? 15 : 19);
        if (px < (mobile ? 26 : 34)) continue;
        L.set(`s${st.id}`, 'state', xm, BASE + s.h * HS * this.vex + 0.15, zN, 1000 + px, (el) => { el.textContent = name.toUpperCase(); }, { size, text: name, dy: -4 });
      }
    }
    // arms over each state's highest point so far; dead states keep theirs where they stood tallest.
    // Only the greatest few near the present (or, from above, of all time), so they never crowd the ridges.
    const born = Math.round(f);
    const cands: { st: RStream; x: number; y: number; z: number; w: number; alive: boolean }[] = [];
    for (const st of m.streams) {
      if (!st.arms || st.r0 > born) continue;
      const j = Math.min(st.r1, born) - st.r0;
      const br = st.best[Math.max(0, j)];
      const s = streamAt(st, br);
      if (!s || s.h <= 0.004) continue;
      const z = Z(br * ROW);
      if (o < 0.5 && (z < zN - (mobile ? 70 : 85) || z > zN + 0.5)) continue;
      const alive = st.r1 >= born;
      cands.push({ st, x: X((s.x0 + s.x1) / 2), y: BASE + s.h * HS * this.vex + 0.35, z, w: s.h * (0.5 + (s.x1 - s.x0) * 4) * (alive ? 1.6 : 1), alive });
    }
    cands.sort((p, q) => q.w - p.w);
    const cap = o > 0.5 ? (mobile ? 10 : 22) : mobile ? 6 : 13;
    for (const c of cands.slice(0, cap)) {
      const dist = this.v.set(c.x, c.y, c.z).distanceTo(this.camera.position);
      const scale = o > 0.5 ? (mobile ? 0.55 : 0.62) : clamp(ref / dist, mobile ? 0.42 : 0.4, mobile ? 0.8 : 0.9);
      const st = c.st, spec = st.arms!, label = st.name;
      L.set(`a${st.id}`, 'arms', c.x, c.y, c.z, 600 + c.w * 1000, (el) => {
        el.innerHTML = armsSvg(spec, { uid: `rv${st.id.slice(4)}`, title: false, cls: 'rv-arms' });
        el.setAttribute('data-id', st.id);
        el.title = label;
      }, { scale, dy: -2 });
    }
    // standing stones, once their year has come
    m.stones.forEach((s, i) => {
      if (s.year > year + 0.5) return;
      const top = this.stoneTops[i];
      if (!top || top.z < camZ - 380) return;
      L.set(`t${s.id}`, 'stone', top.x, top.y + 0.5, top.z, 500 + s.mag * 100, (el) => {
        el.setAttribute('data-id', s.id);
        el.innerHTML = `<span class="rv-st__k rv-st__k--${s.kind}">${STONE_LABEL[s.kind] ?? s.kind} · AY ${s.year}</span><span class="rv-st__t">${esc(s.title)}</span><span class="rv-st__f">${esc(s.figure)}</span>`;
      }, { dy: -4, scale: o > 0.5 ? 0.8 : 1 });
    });
    // era names on the west bank, where each age begins
    this.opts.eras.forEach((e) => {
      if (e.start > year) return;
      L.set(`e${e.id}`, 'era', -(W / 2 + BANK * 0.5), 0.2, Z(e.start) - 1.5, 200, (el) => {
        el.innerHTML = `<span class="rv-era__n">${esc(e.name)}</span><span class="rv-era__y">AY ${e.start}–${e.end}</span>`;
      }, { dy: 0 });
    });
    // half-millennia on the east bank
    for (let y = 0; y <= year; y += 500) {
      L.set(`y${y}`, 'tick', W / 2 + BANK * 0.62, 0.1, Z(y), 100, (el) => { el.textContent = `AY ${y}`; });
    }
    const near = this.fog.near, far = this.fog.far;
    if (this.avoidN-- <= 0) {
      this.avoidN = 30;
      const cr = this.canvas.getBoundingClientRect();
      this.avoidRects = this.avoidEls.filter((e) => e.isConnected && e.offsetWidth).map((e) => { const r = e.getBoundingClientRect(); return [r.left - cr.left - 4, r.top - cr.top - 4, r.width + 8, r.height + 8] as [number, number, number, number]; });
    }
    L.update(this.project, this.w, this.h, dt, (d) => 1 - smooth(near + (far - near) * 0.25, far * 0.92, d), this.avoidRects);
  }

  // ---------------------------------------------------------------- picking
  private heightAt(x: number, row: number): { st: RStream; y: number } | null {
    const m = this.model;
    const r = clamp(Math.round(row), 0, ROWS - 1);
    const list = m.alive[r];
    const fx = x / W + 0.5;
    for (let i = 0; i < list.length; i++) {
      const st = m.streams[list[i]];
      const s = streamAt(st, row);
      if (!s || fx < s.x0 || fx > s.x1) continue;
      const u = (fx - s.x0) / Math.max(1e-6, s.x1 - s.x0);
      return { st, y: (BASE + s.h * HS * profile(u)) * this.vex };
    }
    return null;
  }

  /** The state under a screen point: on the cut face, or on its ridge further back. */
  pick(px: number, py: number): Pick | null {
    this.ndc.set((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    const zN = Z(this.year);
    const fNow = clamp(this.year / ROW, 0, ROWS - 1);
    let t = 0;
    if (o.z > zN) {
      if (d.z >= 0) return null;
      t = (zN - o.z) / d.z;
      const x = o.x + d.x * t, y = o.y + d.y * t;
      const hit = this.heightAt(x, fNow);
      if (hit && y >= -0.01 && y <= hit.y) return { st: hit.st, year: Math.round(this.year), face: true };
    }
    const step = 0.3;
    let prev = t;
    for (let i = 0; i < 2400; i++) {
      t += step * (1 + i / 600);
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (z > zN + 0.01) { prev = t; continue; }
      if (y < 0 || z < 0) {
        // into the floor: still a state if it lies within one (thin ribbons)
        const row = (Math.max(0, Math.min(zN, z)) / K) / ROW;
        const hit = this.heightAt(x, row);
        return hit ? { st: hit.st, year: Math.round(row * ROW), face: false } : null;
      }
      const row = z / K / ROW;
      const hit = this.heightAt(x, row);
      if (hit && y <= hit.y) {
        // refine between prev and t
        let a = prev, b = t;
        for (let k = 0; k < 12; k++) {
          const mid = (a + b) / 2;
          const mx = o.x + d.x * mid, my = o.y + d.y * mid, mz = o.z + d.z * mid;
          const hh = this.heightAt(mx, mz / K / ROW);
          if (hh && my <= hh.y) b = mid; else a = mid;
        }
        const zz = o.z + d.z * b, xx = o.x + d.x * b;
        const h2r = this.heightAt(xx, zz / K / ROW) ?? hit;
        return { st: h2r.st, year: clamp(Math.round(zz / K), 0, YEAR_END), face: false };
      }
      prev = t;
      if (t > 900) break;
    }
    return null;
  }

  setHover(k: number) {
    if (this.hoverK === k) return;
    this.hoverK = k;
    this.uniforms.uHover.value = k;
    this.dirty = true;
  }

  setYear(y: number, immediate = false) {
    this.target = clamp(y, 0, YEAR_END);
    if (immediate) this.year = this.target;
    if (this.target < YEAR_END) this.endFired = false;
    this.dirty = true;
  }

  setOverview(on: boolean, immediate = false) {
    this.overviewTarget = on ? 1 : 0;
    if (immediate) this.overview = this.overviewTarget;
    this.dirty = true;
  }

  nudge() { this.dirty = true; }

  setTheme(t: Theme) {
    if (t === this.theme) return;
    this.theme = t;
    const T = THEMES[t];
    this.fog.color.set(T.fog);
    this.hemi.color.set(T.sky); this.hemi.groundColor.set(T.ground); this.hemi.intensity = T.hemiI;
    this.sun.color.set(T.sun); this.sun.intensity = T.sunI;
    this.amb.intensity = T.amb;
    (this.uniforms.uHatch.value as Color).set(T.hatch);
    (this.uniforms.uGrid.value as Color).set(T.grid);
    (this.uniforms.uAccent.value as Color).set(T.accent);
    this.uniforms.uGridA.value = T.gridA;
    this.uniforms.uEraTint.value = T.eraTint;
    this.uniforms.uFaceK.value = T.face;
    this.skyMat.color.set(T.ink);
    this.skyMat.opacity = t === 'dark' ? 0.55 : 0.45;
    this.buildGround();
    this.buildStones();
    this.dirty = true;
  }

  dispose() {
    this.stop();
    this.labels.clear();
    this.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    for (const m of [this.ridgeMat, this.faceMat, this.skyMat, this.floorMat, this.wallMat, this.stoneMat]) m.dispose();
    this.renderer.dispose();
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
