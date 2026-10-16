// three.js side of #/3d: renderer, lights, the relief model, rivers, cities and the label layer.
// Year changes only rewrite a per-cell palette texture (owner colour + id) and the city instances.

import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DataTexture, DirectionalLight, FloatType,
  Group, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  NearestFilter, PCFShadowMap, PerspectiveCamera, PlaneGeometry, RGBAFormat, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
  type IUniform, type WebGLProgramParametersWithUniforms,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MapData } from '../views/mapRenderer.ts';
import { KICKERS, MapRenderer } from '../views/mapRenderer.ts';
import { BASE_Y, SCALE, SEA_Y, type TerrainMesh } from './mesh.ts';

export type Theme = 'light' | 'dark';

const PAL_W = 128;

function hex(h: string): [number, number, number] {
  const m = h.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255];
}
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const mix3 = (a: number[], b: number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const THEMES = {
  light: {
    ink: '#2a1e14', inkA: 0.55, accent: '#8e2f1f', frontier: [0.02, 0.016, 0.012], frontierK: 0.42, tint: 0.56, paper: '#efe6d2', neutral: 0.62,
    sea: '#8db1c0', seaA: 0.5, side: '#e8dfcc', sideLow: '#cfc3aa', shadow: 'rgba(70,52,28,0.42)',
    sun: '#fff1da', sunI: 3.1, sky: '#f4efe6', ground: '#7d6a50', hemiI: 1.05,
    river: '#4f7f9c', tower: '#fbf7ee', capital: '#c99a2e', night: 0,
  },
  dark: {
    ink: '#efe6d2', inkA: 0.45, accent: '#f0a080', frontier: [1, 0.97, 0.9], frontierK: 0.3, tint: 0.56, paper: '#8b8678', neutral: 0.62,
    sea: '#16303f', seaA: 0.62, side: '#2b323b', sideLow: '#1c2128', shadow: 'rgba(0,0,0,0.65)',
    sun: '#ffe4c0', sunI: 2.7, sky: '#a9bccd', ground: '#2c2a2c', hemiI: 0.8,
    river: '#6aa2c4', tower: '#e8dcc2', capital: '#e6c86a', night: 0.42,
  },
  // the fly-through: the dark palette, brighter and more saturated for video
  cinema: {
    ink: '#f3ead6', inkA: 0.5, accent: '#f0a080', frontier: [1, 0.97, 0.9], frontierK: 0.32, tint: 0.6, paper: '#a8a08c', neutral: 0.6,
    sea: '#123044', seaA: 0.66, side: '#2e353e', sideLow: '#171b21', shadow: 'rgba(0,0,0,0.7)',
    sun: '#ffe6c4', sunI: 3.2, sky: '#b4c4d4', ground: '#2e2b2c', hemiI: 0.95,
    river: '#6fb0d6', tower: '#f1e6cc', capital: '#f0cd6a', night: 0.24,
  },
} as const;
type Palette = keyof typeof THEMES;

/** Albedo per render vertex (sRGB bytes) from biome, height, slope and concavity. */
export function terrainColors(m: TerrainMesh, theme: Theme, nightMix = 0.42): Uint8Array {
  const dark = theme === 'dark';
  const uc = new Float32Array(m.uCount * 3);
  const shallow = hex('#b9d2d2'), mid = hex('#8fb2bd'), deep = hex('#6d93a6');
  const sand = hex('#e6d9b2'), rock = hex('#9d907f'), rockDark = hex('#7f7466'), snow = hex('#f7f5f0');
  const night = hex('#141a22');
  for (let id = 0; id < m.uCount; id++) {
    const y = m.uPos[3 * id + 1];
    const ny = m.uNormal[3 * id + 1];
    let c: [number, number, number];
    if (y < 0 || m.uLand[id] < 0.5) {
      const d = Math.max(0, Math.min(1, -y / 0.33));
      c = d < 0.35 ? mix3(shallow, mid, d / 0.35) : mix3(mid, deep, (d - 0.35) / 0.65);
    } else {
      const t = Math.max(0, Math.min(1, y / 0.98));
      let b = [m.uBiome[3 * id], m.uBiome[3 * id + 1], m.uBiome[3 * id + 2]];
      // the 2D biome palette is pale; deepen it a touch for a lit model
      const g = (b[0] + b[1] + b[2]) / 3;
      b = [g + (b[0] - g) * 1.35, g + (b[1] - g) * 1.35, g + (b[2] - g) * 1.35].map((v) => Math.max(0, Math.min(1, v * 0.93)));
      const steep = smooth(0.93, 0.7, ny);
      c = mix3(b, mix3(rock, rockDark, steep), Math.min(0.8, smooth(0.42, 0.75, t) * 0.6 + steep * 0.45));
      c = mix3(c, snow, smooth(0.66, 0.82, t) * smooth(0.55, 0.85, ny));
      if (y < 0.03) c = mix3(c, sand, (1 - y / 0.03) * 0.55);
    }
    const ao = 1 + m.uCurv[id] * 0.2;
    c = [c[0] * ao, c[1] * ao, c[2] * ao];
    if (dark) c = mix3(c, night, y < 0 ? Math.min(0.7, nightMix + 0.15) : nightMix).map((v) => v * 0.95) as [number, number, number];
    uc[3 * id] = c[0]; uc[3 * id + 1] = c[1]; uc[3 * id + 2] = c[2];
  }
  const out = new Uint8Array(m.count * 3);
  for (let v = 0; v < m.count; v++) {
    const id = m.uniq[v];
    out[3 * v] = Math.max(0, Math.min(255, Math.round(uc[3 * id] * 255)));
    out[3 * v + 1] = Math.max(0, Math.min(255, Math.round(uc[3 * id + 1] * 255)));
    out[3 * v + 2] = Math.max(0, Math.min(255, Math.round(uc[3 * id + 2] * 255)));
  }
  return out;
}

// ---------------------------------------------------------------- labels
interface LabelSpec { key: string; kind: 'state' | 'city' | 'capital'; text: string; kicker?: string; x: number; y: number; z: number; prio: number; size?: number }
interface LabelEl { el: HTMLDivElement; spec: LabelSpec; w: number; h: number; o: number; want: number; sx: number; sy: number; sz: number; init: boolean }

class LabelLayer {
  private root: HTMLElement;
  private els = new Map<string, LabelEl>();
  constructor(root: HTMLElement) { this.root = root; }

  set(specs: LabelSpec[]) {
    const keep = new Set(specs.map((s) => s.key));
    for (const [k, l] of this.els) if (!keep.has(k)) l.want = 0;
    for (const s of specs) {
      let l = this.els.get(s.key);
      if (!l) {
        const el = document.createElement('div');
        el.className = `t3d-lab t3d-lab--${s.kind}`;
        el.style.opacity = '0';
        this.root.appendChild(el);
        l = { el, spec: s, w: 0, h: 0, o: 0, want: 1, sx: s.x, sy: s.y, sz: s.z, init: false };
        this.els.set(s.key, l);
      }
      const changed = !l.init || l.spec.text !== s.text || l.spec.kicker !== s.kicker || l.spec.size !== s.size || l.spec.kind !== s.kind;
      if (!l.init) { l.sx = s.x; l.sy = s.y; l.sz = s.z; }
      l.spec = s;
      l.want = 1;
      if (changed) {
        l.el.className = `t3d-lab t3d-lab--${s.kind}`;
        l.el.replaceChildren();
        if (s.kicker) { const k = document.createElement('span'); k.className = 't3d-lab__k'; k.textContent = s.kicker; l.el.appendChild(k); }
        const t = document.createElement('span'); t.className = 't3d-lab__t'; t.textContent = s.text; l.el.appendChild(t);
        if (s.size) l.el.style.fontSize = `${s.size.toFixed(1)}px`;
        l.w = l.el.offsetWidth; l.h = l.el.offsetHeight;
        l.init = true;
      }
    }
  }

  /** Project, declutter and fade. `dt` in seconds. */
  update(project: (x: number, y: number, z: number) => [number, number, boolean], w: number, h: number, dt: number, occl?: (l: LabelSpec, x: number, y: number, z: number) => boolean) {
    const list = [...this.els.values()].sort((a, b) => b.want - a.want || b.spec.prio - a.spec.prio);
    const placed: [number, number, number, number][] = [];
    const k = 1 - Math.exp(-dt * 7);
    for (const l of list) {
      // ease the anchor (territories shift between years)
      l.sx += (l.spec.x - l.sx) * k; l.sy += (l.spec.y - l.sy) * k; l.sz += (l.spec.z - l.sz) * k;
      const [px, py, front] = project(l.sx, l.sy, l.sz);
      let visible = front && l.want > 0 && px > -40 && py > -20 && px < w + 40 && py < h + 20;
      let bx = 0, by = 0;
      if (visible) {
        const city = l.spec.kind !== 'state';
        bx = px - l.w / 2;
        by = city ? py - l.h - 5 : py - l.h / 2;
        for (const r of placed) if (bx < r[0] + r[2] && bx + l.w > r[0] && by < r[1] + r[3] && by + l.h > r[1]) { visible = false; break; }
        if (visible && occl && occl(l.spec, l.sx, l.sy, l.sz)) visible = false;
        if (visible) placed.push([bx - 3, by - 2, l.w + 6, l.h + 4]);
      }
      const target = visible ? 1 : 0;
      l.o += (target - l.o) * Math.min(1, dt * 9);
      if (Math.abs(l.o - target) < 0.02) l.o = target;
      if (l.o <= 0.001) {
        if (l.el.style.opacity !== '0') l.el.style.opacity = '0';
        if (l.want === 0) { l.el.remove(); this.els.delete(l.spec.key); }
        continue;
      }
      l.el.style.opacity = l.o.toFixed(3);
      if (visible) l.el.style.transform = `translate3d(${bx.toFixed(1)}px,${by.toFixed(1)}px,0)`;
    }
  }

  clear() { for (const l of this.els.values()) l.el.remove(); this.els.clear(); }
}

// ---------------------------------------------------------------- scene
export interface SceneOpts { theme: Theme; reducedMotion: boolean; mobile: boolean; cinema: boolean }
export interface Pose { tx: number; ty: number; tz: number; az: number; polar: number; dist: number }

export class TerrainScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  private d: MapData;
  private m: TerrainMesh;
  private model = new Group();
  private terrain: Mesh;
  private terrainGeo: BufferGeometry;
  private terrainMat: MeshLambertMaterial;
  private sea: Mesh;
  private seaMat: MeshLambertMaterial;
  private walls: Mesh;
  private wallMat: MeshLambertMaterial;
  private waterWalls: Mesh;
  private shadowPlane: Mesh;
  private rivers: Mesh;
  private riverMat: MeshLambertMaterial;
  private towers: InstancedMesh;
  private towerMat: MeshLambertMaterial;
  private sun: DirectionalLight;
  private hemi: HemisphereLight;
  private palette: DataTexture;
  private palData: Float32Array;
  private uniforms: Record<string, IUniform>;
  private labels: LabelLayer;
  private colorCache = new Map<number, [number, number, number]>();
  private canvas: HTMLCanvasElement;
  private opts: SceneOpts;
  theme: Theme;
  year = -1;
  relief = 1;
  selected = -10;
  hover = -10;
  autoRotate: boolean;
  /** Called after a year's state is applied (largest states etc.). */
  onYear?: (info: YearInfo) => void;
  private dirty = true;
  private raf = 0;
  private lastT = 0;
  private lastInteract = 0;
  private interacting = false;
  private spin = 0;
  private flight: { from: Pose; to: Pose; t0: number; ms: number } | null = null;
  private yearPending = -1;
  private labelSpecsAt = -1;
  private labelYearT = 0;
  private frameN = 0;
  private w = 1;
  private h = 1;
  /** Timings in ms (render() CPU, frame intervals, year updates, the mesh build), for the probes. */
  readonly stats = { render: [] as number[], frame: [] as number[], update: [] as number[], build: 0 };
  info: YearInfo | null = null;

  constructor(canvas: HTMLCanvasElement, labelRoot: HTMLElement, data: MapData, mesh: TerrainMesh, opts: SceneOpts) {
    this.canvas = canvas;
    this.d = data;
    this.m = mesh;
    this.opts = opts;
    this.theme = opts.theme;
    this.autoRotate = !opts.reducedMotion && !opts.cinema;
    this.labels = new LabelLayer(labelRoot);

    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: opts.cinema });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    this.renderer = renderer;

    this.camera = new PerspectiveCamera(30, 1, 0.1, 200);
    this.scene.add(this.model);

    // ---- terrain
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(mesh.position, 3));
    g.setAttribute('normal', new BufferAttribute(mesh.normal, 3));
    g.setAttribute('color', new BufferAttribute(terrainColors(mesh, this.theme, THEMES[this.paletteName()].night), 3, true));
    g.setAttribute('aCells', new BufferAttribute(mesh.cells, 2, false));
    g.setAttribute('aEdge', new BufferAttribute(mesh.edge, 1));
    g.setIndex(new BufferAttribute(mesh.index, 1));
    g.computeBoundingSphere();
    this.terrainGeo = g;

    const rows = Math.ceil(data.geo.n / PAL_W);
    this.palData = new Float32Array(PAL_W * rows * 4);
    for (let i = 0; i < this.palData.length; i += 4) this.palData[i + 3] = -2;
    this.palette = new DataTexture(this.palData, PAL_W, rows, RGBAFormat, FloatType);
    this.palette.minFilter = NearestFilter;
    this.palette.magFilter = NearestFilter;
    this.palette.generateMipmaps = false;
    this.palette.needsUpdate = true;
    this.uniforms = {
      uPal: { value: this.palette },
      uTint: { value: 0.5 },
      uInk: { value: new Color() },
      uInkA: { value: 0.5 },
      uFrontier: { value: new Color() },
      uFrontierK: { value: 0.4 },
      uAccent: { value: new Color() },
      uPx: { value: 1 },
      uSel: { value: -10 },
      uHover: { value: -10 },
      uPaper: { value: new Color() },
      uNeutral: { value: 0.6 },
    };
    const mat = new MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec2 aCells;
attribute float aEdge;
uniform sampler2D uPal;
flat varying vec4 vOwn;
flat varying vec4 vNb;
varying float vEdge;
vec4 palAt(float c) { int ci = int(c + 0.5); return texelFetch(uPal, ivec2(ci % ${PAL_W}, ci / ${PAL_W}), 0); }`)
        .replace('#include <color_vertex>', `#include <color_vertex>
vColor.rgb = pow(vColor.rgb, vec3(2.2));
vOwn = palAt(aCells.x);
vNb = palAt(aCells.y);
vEdge = aEdge;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uTint;
uniform vec3 uInk;
uniform float uInkA;
uniform vec3 uFrontier;
uniform float uFrontierK;
uniform vec3 uAccent;
uniform float uPx;
uniform float uSel;
uniform float uHover;
uniform vec3 uPaper;
uniform float uNeutral;
flat varying vec4 vOwn;
flat varying vec4 vNb;
varying float vEdge;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  float own = vOwn.a, nb = vNb.a;
  bool isLand = own > -1.5;
  bool owned = own > -0.5;
  bool selOn = uSel > -1.5;
  bool isSel = owned && abs(own - uSel) < 0.5;
  float tint = owned ? uTint : 0.0;
  if (selOn && isLand && !isSel) {
    float g = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(g), 0.45);
    tint *= 0.55;
  }
  if (isSel) tint = min(0.85, uTint + 0.14);
  if (owned && abs(own - uHover) < 0.5) tint = min(0.9, tint + 0.12);
  if (owned) {
    // states read as flat colour over paper; the relief comes from the light
    float g = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    diffuseColor.rgb = mix(diffuseColor.rgb, uPaper * (0.55 + 0.45 * g / 0.5), uNeutral);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, vOwn.rgb, tint);
  float px = vEdge / max(fwidth(vEdge), 1e-6);
  if (isLand && nb > -1.5 && abs(own - nb) > 0.5) {
    bool internal = owned && nb > -0.5;
    vec3 oc = owned ? vOwn.rgb : vNb.rgb;
    vec3 col = internal ? uInk : mix(oc, uFrontier, uFrontierK);
    float a = internal ? uInkA : 0.9;
    float hw = (internal ? 0.55 : 0.75) * uPx;
    diffuseColor.rgb = mix(diffuseColor.rgb, col, a * clamp(hw - px + 0.5, 0.0, 1.0));
  } else if (isLand && nb < -1.5) {
    float hw = 0.45 * uPx;
    diffuseColor.rgb = mix(diffuseColor.rgb, uInk, 0.3 * clamp(hw - px + 0.5, 0.0, 1.0));
  }
  if (selOn && (isSel != (nb > -0.5 && abs(nb - uSel) < 0.5)) && (isLand || nb > -1.5)) {
    float hw = 1.25 * uPx;
    diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, clamp(hw - px + 0.5, 0.0, 1.0));
  }
}`);
    };
    mat.customProgramCacheKey = () => 'palimpsest-terrain-v1';
    this.terrainMat = mat;
    this.terrain = new Mesh(g, mat);
    this.terrain.castShadow = true;
    this.terrain.receiveShadow = true;
    this.model.add(this.terrain);

    // ---- sea, sides and the model's shadow on the table
    // matte, like tinted resin: a specular sea (Schlick Fresnel) washes out white when the camera faces the sun
    this.seaMat = new MeshLambertMaterial({ transparent: true, depthWrite: false });
    this.sea = new Mesh(new PlaneGeometry(mesh.width, mesh.depth), this.seaMat);
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = SEA_Y;
    this.sea.renderOrder = 2;
    this.sea.receiveShadow = true;
    this.model.add(this.sea);
    const [walls, waterWalls] = this.buildSides();
    this.wallMat = walls.material as MeshLambertMaterial;
    this.walls = walls;
    this.waterWalls = waterWalls;
    this.model.add(walls, waterWalls);
    this.shadowPlane = new Mesh(new PlaneGeometry(mesh.width * 1.5, mesh.depth * 1.6), new MeshBasicMaterial({ transparent: true, depthWrite: false }));
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.position.y = BASE_Y - 0.02;
    this.shadowPlane.renderOrder = -1;
    this.scene.add(this.shadowPlane);

    // ---- rivers and cities
    this.riverMat = new MeshLambertMaterial({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.rivers = new Mesh(this.buildRivers(), this.riverMat);
    this.rivers.renderOrder = 1;
    this.model.add(this.rivers);
    const tg = new CylinderGeometry(1, 1, 1, 12, 1);
    tg.translate(0, 0.5, 0);
    this.towerMat = new MeshLambertMaterial();
    this.towers = new InstancedMesh(tg, this.towerMat, data.timeline.settlements.length);
    this.towers.count = 0;
    this.towers.frustumCulled = false;
    this.model.add(this.towers);

    // ---- light
    this.hemi = new HemisphereLight(0xffffff, 0x888888, 1);
    this.scene.add(this.hemi);
    this.sun = new DirectionalLight(0xffffff, 2.5);
    this.sun.position.set(-10.5, 8.2, -6.5);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = true;
    const sm = opts.mobile ? 1536 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    // fit the shadow camera tightly around the model, seen from the sun
    const sc = this.sun.shadow.camera;
    const look = new Matrix4().lookAt(this.sun.position, new Vector3(), new Vector3(0, 1, 0)).invert();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const x of [-mesh.width / 2, mesh.width / 2]) for (const z of [-mesh.depth / 2, mesh.depth / 2]) for (const yy of [BASE_Y * 1.8, mesh.maxY * 1.8]) {
      const p = new Vector3(x, yy, z).sub(this.sun.position).applyMatrix4(look);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    sc.left = x0 - 0.2; sc.right = x1 + 0.2; sc.bottom = y0 - 0.2; sc.top = y1 + 0.2; sc.near = Math.max(0.1, -z1 - 1); sc.far = -z0 + 1;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.015;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun, this.sun.target);

    // ---- controls
    const c = new OrbitControls(this.camera, canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.075;
    c.rotateSpeed = 0.55;
    c.zoomSpeed = 0.9;
    c.panSpeed = 0.8;
    c.screenSpacePanning = false;
    c.minDistance = 2.2;
    c.maxDistance = 70;
    c.minPolarAngle = 0.04;
    c.maxPolarAngle = 1.3;
    c.autoRotateSpeed = 0.32;
    c.enabled = !opts.cinema;
    c.addEventListener('start', () => { this.interacting = true; this.flight = null; this.lastInteract = performance.now(); });
    c.addEventListener('end', () => { this.interacting = false; this.lastInteract = performance.now(); });
    c.addEventListener('change', () => { this.dirty = true; });
    this.controls = c;

    this.applyTheme();
    this.lastInteract = performance.now() - 2500;
  }

  // ---------------------------------------------------------------- build helpers
  private buildSides(): [Mesh, Mesh] {
    const rim = this.m.rim;
    const n = rim.length / 3;
    const pos: number[] = [], nor: number[] = [], col: number[] = [], wpos: number[] = [], wnor: number[] = [];
    const hw = this.m.width / 2, hd = this.m.depth / 2;
    const outward = (x: number, z: number): [number, number] => {
      const dx = hw - Math.abs(x), dz = hd - Math.abs(z);
      return dx < dz ? [Math.sign(x), 0] : [0, Math.sign(z)];
    };
    for (let k = 0; k < n; k++) {
      const a = k, b = (k + 1) % n;
      const ax = rim[3 * a], ay = rim[3 * a + 1], az = rim[3 * a + 2];
      const bx = rim[3 * b], by = rim[3 * b + 1], bz = rim[3 * b + 2];
      if (Math.hypot(bx - ax, bz - az) < 1e-6) continue;
      const [nx, nz] = outward((ax + bx) / 2, (az + bz) / 2);
      // two triangles, wound to face outward
      const quad = (P: number[], N: number[], C: number[] | null, x1: number, y1t: number, y1b: number, z1: number, x2: number, y2t: number, y2b: number, z2: number, ct: number, cb: number) => {
        const v = [[x1, y1t, z1, ct], [x1, y1b, z1, cb], [x2, y2b, z2, cb], [x2, y2t, z2, ct]];
        // decide winding from the outward normal
        const ex = x2 - x1, ez = z2 - z1;
        const cross = -ez * nx + ex * nz; // y-component sign test of (edge × down)
        const order = cross > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        for (const o of order) {
          P.push(v[o][0], v[o][1], v[o][2]);
          N.push(nx, 0, nz);
          if (C) C.push(v[o][3]);
        }
      };
      quad(pos, nor, col, ax, ay, BASE_Y, az, bx, by, BASE_Y, bz, 1, 0);
      if (ay < SEA_Y || by < SEA_Y) quad(wpos, wnor, null, ax, SEA_Y, Math.min(ay, SEA_Y), az, bx, SEA_Y, Math.min(by, SEA_Y), bz, 1, 1);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
    // a vertical gradient: 1 at the top edge, 0 at the base (expanded to colours in applyTheme)
    g.setAttribute('color', new BufferAttribute(new Float32Array(col.length * 3), 3));
    g.userData.grad = col;
    const walls = new Mesh(g, new MeshLambertMaterial({ vertexColors: true }));
    walls.receiveShadow = true;
    const wg = new BufferGeometry();
    wg.setAttribute('position', new BufferAttribute(new Float32Array(wpos), 3));
    wg.setAttribute('normal', new BufferAttribute(new Float32Array(wnor), 3));
    const ww = new Mesh(wg, this.seaMat);
    ww.renderOrder = 2;
    return [walls, ww];
  }

  private buildRivers(): BufferGeometry {
    const { geo, world } = this.d;
    const m = this.m;
    const pos: number[] = [], idx: number[] = [];
    for (const r of world.rivers) {
      const cells = r.cells;
      if (cells.length < 2) continue;
      // smoothed polyline through midpoints, as on the 2D map
      const pts: { x: number; y: number; w: number }[] = [];
      const X = (c: number) => geo.sx[c], Y = (c: number) => geo.sy[c];
      const push = (x: number, y: number, w: number) => pts.push({ x, y, w });
      push(X(cells[0]), Y(cells[0]), r.width[0] ?? 1);
      for (let k = 1; k < cells.length; k++) {
        const a = cells[k - 1], b = cells[k];
        const p0x = k === 1 ? X(a) : (X(cells[k - 2]) + X(a)) / 2, p0y = k === 1 ? Y(a) : (Y(cells[k - 2]) + Y(a)) / 2;
        const p2x = (X(a) + X(b)) / 2, p2y = (Y(a) + Y(b)) / 2;
        const len = Math.hypot(p2x - p0x, p2y - p0y) + 1e-6;
        const steps = Math.max(2, Math.ceil(len / 2.5));
        const w0 = r.width[k - 1] ?? 1, w1 = r.width[k] ?? w0;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const x = (1 - t) * (1 - t) * p0x + 2 * (1 - t) * t * X(a) + t * t * p2x;
          const y = (1 - t) * (1 - t) * p0y + 2 * (1 - t) * t * Y(a) + t * t * p2y;
          push(x, y, w0 + (w1 - w0) * t * 0.5);
        }
      }
      const last = cells[cells.length - 1];
      push(X(last), Y(last), r.width[cells.length - 1] ?? 1);
      // ribbon, stopping at the sea
      let prev = -1;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
        let tx = q.x - o.x, ty = q.y - o.y;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        const half = (0.7 + p.w * 0.55) / 2;
        const lx = p.x - ty * half, ly = p.y + tx * half, rx = p.x + ty * half, ry = p.y - tx * half;
        const sx = (x: number) => x * SCALE - m.ox, sz = (y: number) => y * SCALE - m.oz;
        const hl = m.heightAt(sx(lx), sz(ly)), hr = m.heightAt(sx(rx), sz(ry)), hc = m.heightAt(sx(p.x), sz(p.y));
        const lift = 0.004;
        const base = pos.length / 3;
        pos.push(sx(lx), Math.max(hl, hc) + lift, sz(ly), sx(rx), Math.max(hr, hc) + lift, sz(ry));
        if (prev >= 0) idx.push(prev, prev + 1, base, prev + 1, base + 1, base);
        prev = base;
        if (hc < SEA_Y && i > 1) break;
      }
    }
    // wind every triangle to face up
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ny = (pos[b + 2] - pos[a + 2]) * (pos[c] - pos[a]) - (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]);
      if (ny < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // ribbons are nearly flat: soften the normals toward up so they take the light like the land
    const nr = g.getAttribute('normal') as BufferAttribute;
    for (let i = 0; i < nr.count; i++) { nr.setXYZ(i, nr.getX(i) * 0.4, Math.max(0.4, nr.getY(i)), nr.getZ(i) * 0.4); }
    nr.needsUpdate = true;
    return g;
  }

  private shadowTexture(rgba: string): CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext('2d')!;
    // the model covers ~2/3 of the plane: a soft rectangle
    ctx.filter = 'blur(14px)';
    ctx.fillStyle = rgba;
    ctx.fillRect(256 * (1 - 1 / 1.5) / 2 + 6, 256 * (1 - 1 / 1.6) / 2 + 8, 256 / 1.5 - 12, 256 / 1.6 - 8);
    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    return t;
  }

  // ---------------------------------------------------------------- theme
  setTheme(t: Theme) {
    if (t === this.theme) return;
    this.theme = t;
    (this.terrainGeo.getAttribute('color') as BufferAttribute).array.set(terrainColors(this.m, t, THEMES[this.paletteName()].night));
    (this.terrainGeo.getAttribute('color') as BufferAttribute).needsUpdate = true;
    this.colorCache.clear();
    this.applyTheme();
    if (this.year >= 0) { const y = this.year; this.year = -1; this.setYear(y); }
  }

  private paletteName(): Palette {
    return this.opts.cinema && this.theme === 'dark' ? 'cinema' : this.theme;
  }

  private applyTheme() {
    const T = THEMES[this.paletteName()];
    const u = this.uniforms;
    (u.uInk.value as Color).set(T.ink);
    u.uInkA.value = T.inkA;
    (u.uFrontier.value as Color).setRGB(T.frontier[0], T.frontier[1], T.frontier[2]);
    u.uFrontierK.value = T.frontierK;
    (u.uAccent.value as Color).set(T.accent);
    u.uTint.value = T.tint;
    (u.uPaper.value as Color).set(T.paper);
    u.uNeutral.value = T.neutral;
    this.seaMat.color.set(T.sea);
    this.seaMat.opacity = T.seaA;
    const ca = this.walls.geometry.getAttribute('color') as BufferAttribute;
    const grad = this.walls.geometry.userData.grad as number[];
    const top = new Color(T.side), low = new Color(T.sideLow);
    for (let i = 0; i < grad.length; i++) {
      const c = low.clone().lerp(top, grad[i]);
      ca.setXYZ(i, c.r, c.g, c.b);
    }
    ca.needsUpdate = true;
    const old = (this.shadowPlane.material as MeshBasicMaterial).map;
    (this.shadowPlane.material as MeshBasicMaterial).map = this.shadowTexture(T.shadow);
    (this.shadowPlane.material as MeshBasicMaterial).needsUpdate = true;
    old?.dispose();
    this.riverMat.color.set(T.river);
    this.sun.color.set(T.sun);
    this.sun.intensity = T.sunI;
    this.hemi.color.set(T.sky);
    this.hemi.groundColor.set(T.ground);
    this.hemi.intensity = T.hemiI;
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }

  // ---------------------------------------------------------------- year
  private polColor(idx: number): [number, number, number] {
    let c = this.colorCache.get(idx);
    if (!c) {
      const h = hex(this.d.layers.political.byIdx.get(idx)?.color ?? '#888888');
      const dark = this.theme === 'dark' && !this.opts.cinema;
      const s = dark ? mix3(h, [0.9, 0.88, 0.8], 0.08) : h;
      c = [lin(s[0]), lin(s[1]), lin(s[2])];
      this.colorCache.set(idx, c);
    }
    return c;
  }

  /** Apply a year now (cheap: a palette rewrite and the city instances). */
  setYear(y: number) {
    if (y === this.year) return;
    const t0 = performance.now();
    this.year = y;
    const { geo, layers } = this.d;
    const st = layers.political.at(y);
    const pal = this.palData;
    for (let i = 0; i < geo.n; i++) {
      const k = 4 * i;
      if (!geo.land[i]) { pal[k + 3] = -2; continue; }
      const o = st[i];
      if (o < 0) { pal[k + 3] = -1; continue; }
      const c = this.polColor(o);
      pal[k] = c[0]; pal[k + 1] = c[1]; pal[k + 2] = c[2]; pal[k + 3] = o;
    }
    this.palette.needsUpdate = true;
    this.updateTowers(y);
    this.info = this.yearInfo(y, st);
    this.onYear?.(this.info);
    this.stats.update.push(performance.now() - t0);
    if (this.stats.update.length > 600) this.stats.update.shift();
    this.lastYearFrame = this.frameN;
    this.dirty = true;
  }

  /** Queue a year for the next frame (coalesces slider drags and playback). */
  requestYear(y: number) {
    this.yearPending = y;
    this.dirty = true;
  }

  private capitals(y: number): Set<number> {
    const s = new Set<number>();
    const legend = this.d.layers.political.byIdx;
    for (const p of this.d.timeline.polities) {
      const l = legend.get(p.idx);
      if (!l || l.start > y || l.end < y) continue;
      let cap = -1;
      for (const [yy, si] of p.capitals) if (yy <= y) cap = si; else break;
      if (cap >= 0) s.add(cap);
    }
    return s;
  }

  private liveCities: { name: string; cell: number; pop: number; cap: boolean; id: string; h: number }[] = [];
  private updateTowers(y: number) {
    const caps = this.capitals(y);
    const T = THEMES[this.paletteName()];
    const mtx = new Matrix4();
    const col = new Color();
    const live: typeof this.liveCities = [];
    for (const s of this.d.timeline.settlements) {
      if (s.start > y || (s.end < y && s.end < 5000)) continue;
      const pop = MapRenderer.popAt(s.pop, y);
      if (pop <= 0) continue;
      const cb = Math.cbrt(pop);
      live.push({ name: s.name, cell: s.cell, pop, cap: caps.has(s.idx), id: s.id, h: 0.02 + cb / 480 });
    }
    live.sort((a, b) => b.pop - a.pop);
    let n = 0;
    for (const c of live) {
      const r = (0.016 + Math.cbrt(c.pop) / 6500) * (c.cap ? 1.2 : 1);
      const x = this.d.geo.sx[c.cell] * SCALE - this.m.ox, z = this.d.geo.sy[c.cell] * SCALE - this.m.oz;
      const yb = this.m.siteY[c.cell] - 0.01;
      mtx.makeScale(r, c.h + 0.01, r);
      mtx.setPosition(x, yb, z);
      this.towers.setMatrixAt(n, mtx);
      this.towers.setColorAt(n, col.set(c.cap ? T.capital : T.tower));
      n++;
    }
    this.towers.count = n;
    this.towers.instanceMatrix.needsUpdate = true;
    if (this.towers.instanceColor) this.towers.instanceColor.needsUpdate = true;
    this.liveCities = live;
  }

  /** Largest states (by land cells) and their label anchors. */
  private yearInfo(y: number, st: Int16Array): YearInfo {
    const { geo } = this.d;
    const counts = new Map<number, number>();
    let landN = 0;
    for (let i = 0; i < geo.n; i++) {
      if (!geo.land[i]) continue;
      landN++;
      const o = st[i];
      if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const states: YearInfo['states'] = [];
    const seen = new Uint8Array(geo.n);
    for (const [idx, cellsN] of top) {
      // largest connected piece, then its interior-most cell near the centroid (as the 2D labels do)
      let best: number[] = [];
      for (let i = 0; i < geo.n; i++) {
        if (seen[i] || st[i] !== idx || !geo.land[i]) continue;
        const comp: number[] = [];
        const stack = [i];
        seen[i] = 1;
        while (stack.length) {
          const c = stack.pop()!;
          comp.push(c);
          for (let k = geo.nbrStart[c]; k < geo.nbrStart[c + 1]; k++) {
            const j = geo.nbrs[k];
            if (!seen[j] && st[j] === idx && geo.land[j]) { seen[j] = 1; stack.push(j); }
          }
        }
        if (comp.length > best.length) best = comp;
      }
      let cx = 0, cy = 0;
      for (const c of best) { cx += geo.sx[c]; cy += geo.sy[c]; }
      cx /= best.length || 1; cy /= best.length || 1;
      let bc = best[0] ?? -1, bd = Infinity;
      for (const c of best) {
        let interior = 0;
        for (let k = geo.nbrStart[c]; k < geo.nbrStart[c + 1]; k++) if (st[geo.nbrs[k]] === idx) interior++;
        const deg = geo.nbrStart[c + 1] - geo.nbrStart[c];
        const dd = (geo.sx[c] - cx) ** 2 + (geo.sy[c] - cy) ** 2 + (deg - interior) * 900;
        if (dd < bd) { bd = dd; bc = c; }
      }
      const l = this.d.layers.political.byIdx.get(idx);
      let name = l?.name ?? '';
      const p = this.d.polityByIdx.get(idx);
      if (p) for (const [yy, nm] of p.names) { if (yy <= y) name = nm; else break; }
      states.push({ idx, id: l?.id ?? '', name, color: l?.color ?? '#888', cells: cellsN, share: cellsN / Math.max(1, landN), anchor: bc, cx, cy });
    }
    return { year: y, states, cities: this.liveCities.slice(0, 16).map((c) => ({ name: c.name, id: c.id, pop: c.pop, cap: c.cap, cell: c.cell })), landCells: landN };
  }

  private labelSpecs(): LabelSpec[] {
    const info = this.info;
    if (!info) return [];
    const mob = this.opts.mobile;
    const cinema = this.opts.cinema;
    const nStates = cinema ? 6 : mob ? 4 : 7;
    const nCities = cinema ? 5 : mob ? 4 : 8;
    const out: LabelSpec[] = [];
    const m = this.m;
    info.states.slice(0, nStates).forEach((s, i) => {
      if (s.anchor < 0 || s.cells < 6) return;
      const match = s.name.match(KICKERS);
      const size = Math.max(10.5, Math.min(cinema ? 22 : 17, 7 + Math.sqrt(s.cells) * 0.55)) * (cinema ? 1.25 : 1);
      out.push({
        key: `s:${s.idx}`, kind: 'state', text: (match ? match[2] : s.name).toUpperCase(), kicker: match ? `${match[1]} of` : undefined,
        x: this.d.geo.sx[s.anchor] * SCALE - m.ox, y: m.siteY[s.anchor] + 0.06, z: this.d.geo.sy[s.anchor] * SCALE - m.oz,
        prio: 100 - i, size,
      });
    });
    this.liveCities.slice(0, nCities).forEach((c, i) => {
      out.push({
        key: `c:${c.id}`, kind: c.cap ? 'capital' : 'city', text: c.name,
        x: this.d.geo.sx[c.cell] * SCALE - m.ox, y: m.siteY[c.cell] + c.h + 0.01, z: this.d.geo.sy[c.cell] * SCALE - m.oz,
        prio: 50 - i,
      });
    });
    return out;
  }

  // ---------------------------------------------------------------- view
  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    if (!this.dpr) this.dpr = this.opts.cinema ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const dpr = this.dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.uniforms.uPx.value = dpr;
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  setRelief(k: number) {
    this.relief = k;
    this.model.scale.y = k;
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }

  setSelected(idx: number) {
    this.selected = idx;
    this.uniforms.uSel.value = idx;
    this.dirty = true;
  }

  setHover(idx: number) {
    if (idx === this.hover) return;
    this.hover = idx;
    this.uniforms.uHover.value = idx;
    this.dirty = true;
  }

  /** Distance at which the whole model fits the viewport from (az, polar). */
  fitDistance(az: number, polar: number, aspect = this.camera.aspect, margin = { x: 0.94, top: 0.84, bottom: 0.92 }, tgt = new Vector3()): number {
    const cam = new PerspectiveCamera(this.camera.fov, aspect, 0.1, 400);
    const hw = this.m.width / 2, hd = this.m.depth / 2;
    const ys = [BASE_Y * this.relief, 0.25 * this.relief];
    const pts: Vector3[] = [];
    for (const x of [-hw, hw]) for (const z of [-hd, hd]) for (const y of ys) pts.push(new Vector3(x, y, z));
    const fits = (D: number) => {
      this.poseCamera(cam, { tx: tgt.x, ty: tgt.y, tz: tgt.z, az, polar, dist: D });
      for (const p of pts) {
        const v = p.clone().project(cam);
        if (Math.abs(v.x) > margin.x || v.y > margin.top || v.y < -margin.bottom || v.z > 1) return false;
      }
      return true;
    };
    let lo = 1, hi = 300;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    return hi;
  }

  poseCamera(cam: PerspectiveCamera, p: Pose) {
    const sp = Math.sin(p.polar);
    cam.position.set(p.tx + p.dist * sp * Math.sin(p.az), p.ty + p.dist * Math.cos(p.polar), p.tz + p.dist * sp * Math.cos(p.az));
    cam.lookAt(p.tx, p.ty, p.tz);
    cam.updateMatrixWorld();
  }

  currentPose(): Pose {
    const t = this.controls.target, c = this.camera.position;
    const dx = c.x - t.x, dy = c.y - t.y, dz = c.z - t.z;
    const dist = Math.hypot(dx, dy, dz);
    return { tx: t.x, ty: t.y, tz: t.z, az: Math.atan2(dx, dz), polar: Math.acos(Math.max(-1, Math.min(1, dy / dist))), dist };
  }

  setPose(p: Pose) {
    this.controls.target.set(p.tx, p.ty, p.tz);
    this.poseCamera(this.camera, p);
    this.dirty = true;
  }

  /** Fit the model into a band of the screen (NDC margins), centred in it, from (az, polar). */
  framePose(az: number, polar: number, aspect: number, margin: { x: number; top: number; bottom: number }): Pose {
    const cam = new PerspectiveCamera(this.camera.fov, aspect, 0.1, 400);
    const hw = this.m.width / 2, hd = this.m.depth / 2;
    const pts: Vector3[] = [];
    for (const x of [-hw, hw]) for (const z of [-hd, hd]) for (const y of [BASE_Y * this.relief, 0.25 * this.relief]) pts.push(new Vector3(x, y, z));
    // forward on the ground, away from the camera
    const fx = -Math.sin(az), fz = -Math.cos(az);
    let shift = 0;
    let dist = 10;
    for (let it = 0; it < 6; it++) {
      const tgt = new Vector3(fx * shift, 0, fz * shift);
      dist = this.fitDistance(az, polar, aspect, margin, tgt);
      this.poseCamera(cam, { tx: tgt.x, ty: 0, tz: tgt.z, az, polar, dist });
      let lo = Infinity, hi = -Infinity;
      for (const p of pts) { const v = p.clone().project(cam); lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); }
      const err = (hi + lo) / 2 - (margin.top - margin.bottom) / 2;
      if (Math.abs(err) < 0.005) break;
      // NDC → ground units at the target, roughly
      shift += (err / 2) * 2 * dist * Math.tan((this.camera.fov * Math.PI) / 360) / Math.max(0.3, Math.cos(polar));
    }
    return { tx: fx * shift, ty: 0, tz: fz * shift, az, polar, dist };
  }

  /** The default framing: north up on wide screens, turned a quarter on tall ones. */
  homePose(): Pose {
    const aspect = this.camera.aspect;
    if (aspect < 0.8) {
      // tall: the long axis runs up the screen; leave room for the title plate
      const topPx = this.opts.mobile ? 150 : 120;
      return this.framePose(Math.PI / 2, 0.62, aspect, { x: 0.97, top: 1 - (2 * topPx) / this.h, bottom: 0.96 });
    }
    return this.framePose(0, 0.86, aspect, { x: 0.93, top: 1 - (2 * 130) / this.h, bottom: 0.95 });
  }

  flyTo(to: Pose, ms = 1100) {
    if (this.opts.reducedMotion) ms = 0;
    const from = this.currentPose();
    // take the short way round
    let daz = to.az - from.az;
    while (daz > Math.PI) daz -= 2 * Math.PI;
    while (daz < -Math.PI) daz += 2 * Math.PI;
    this.flight = { from, to: { ...to, az: from.az + daz }, t0: performance.now(), ms };
    this.lastInteract = performance.now();
    this.dirty = true;
  }

  /** Turn the idle spin on or off (on starts right away). */
  setSpin(on: boolean) {
    this.autoRotate = on && !this.opts.reducedMotion;
    if (this.autoRotate) this.lastInteract = performance.now() - 10000;
    this.dirty = true;
  }

  /** Fly to a cell (keeping the current angle). */
  focusCell(cell: number, zoom = 0.45) {
    const p = this.currentPose();
    const x = this.d.geo.sx[cell] * SCALE - this.m.ox, z = this.d.geo.sy[cell] * SCALE - this.m.oz;
    const home = this.homePose();
    this.flyTo({ tx: x, ty: 0, tz: z, az: p.az, polar: Math.min(p.polar, 0.95), dist: Math.max(4, home.dist * zoom) });
  }

  // ---------------------------------------------------------------- picking
  /** The cell under a screen point (ray-marched against the exact surface), or -1. */
  pick(px: number, py: number): number {
    const ndc = new Vector3((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1, 0.5);
    const o = this.camera.position.clone();
    const dir = ndc.unproject(this.camera).sub(o).normalize();
    const k = this.relief;
    const top = (this.m.maxY + 0.05) * k;
    if (dir.y >= 0 && o.y > top) return -1;
    // start where the ray enters the slab's top
    let t = o.y > top && dir.y < 0 ? (o.y - top) / -dir.y : 0;
    const step = 0.02;
    let prevT = t;
    for (let i = 0; i < 1500; i++) {
      const x = o.x + dir.x * t, y = o.y + dir.y * t, z = o.z + dir.z * t;
      if (y < BASE_Y * k) return -1;
      if (Math.abs(x) > this.m.width / 2 + 0.01 || Math.abs(z) > this.m.depth / 2 + 0.01) {
        if (y < SEA_Y * k) return -1;
      } else {
        const hgt = Math.max(this.m.heightAt(x, z), SEA_Y) * k;
        if (y <= hgt) {
          let a = prevT, b = t;
          for (let j = 0; j < 8; j++) {
            const mid = (a + b) / 2;
            const yy = o.y + dir.y * mid;
            if (yy <= Math.max(this.m.heightAt(o.x + dir.x * mid, o.z + dir.z * mid), SEA_Y) * k) b = mid; else a = mid;
          }
          return this.m.cellAt(o.x + dir.x * b, o.z + dir.z * b);
        }
      }
      prevT = t;
      t += step * Math.max(1, t * 0.04);
    }
    return -1;
  }

  // ---------------------------------------------------------------- frame loop
  start() {
    this.renderer.shadowMap.needsUpdate = true;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frame(now: number) {
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 1 / 60;
    if (this.lastT) { this.stats.frame.push(now - this.lastT); if (this.stats.frame.length > 600) this.stats.frame.shift(); }
    this.lastT = now;
    if (this.yearPending >= 0) {
      const y = this.yearPending;
      this.yearPending = -1;
      this.setYear(y);
    }
    // camera flight
    if (this.flight) {
      const f = this.flight;
      const u = f.ms <= 0 ? 1 : Math.min(1, (now - f.t0) / f.ms);
      const e = ease(u);
      const L = (a: number, b: number) => a + (b - a) * e;
      this.setPose({ tx: L(f.from.tx, f.to.tx), ty: L(f.from.ty, f.to.ty), tz: L(f.from.tz, f.to.tz), az: L(f.from.az, f.to.az), polar: L(f.from.polar, f.to.polar), dist: Math.exp(L(Math.log(f.from.dist), Math.log(f.to.dist))) });
      if (u >= 1) this.flight = null;
    }
    // idle auto-rotate, easing in
    const idle = !this.interacting && !this.flight && now - this.lastInteract > 4500;
    this.spin += ((this.autoRotate && idle ? 1 : 0) - this.spin) * Math.min(1, dt * 1.2);
    if (this.spin < 0.002) this.spin = 0;
    this.controls.autoRotate = this.spin > 0;
    this.controls.autoRotateSpeed = 0.32 * this.spin;
    if (!this.flight) this.controls.update(dt);
    // keep the target over the model
    const tg = this.controls.target;
    const cx = Math.max(-this.m.width / 2, Math.min(this.m.width / 2, tg.x)), cz = Math.max(-this.m.depth / 2, Math.min(this.m.depth / 2, tg.z));
    if (cx !== tg.x || cz !== tg.z || tg.y !== 0) { tg.set(cx, 0, cz); this.dirty = true; }
    if (this.spin > 0) this.dirty = true;

    const labelsMoving = this.labelsAnimating;
    if (!this.dirty && !labelsMoving) { this.renderedLast = false; return; }
    // adaptive resolution: if continuous animation runs under ~50 fps, step the pixel ratio down (never back up)
    if (this.renderedLast && !this.opts.cinema) {
      this.slow.push(dt * 1000);
      if (this.slow.length >= 90) {
        const med = this.slow.slice().sort((a, b) => a - b)[45];
        this.slow.length = 0;
        if (med > 20 && this.dpr > 1.25) { this.dpr = Math.max(1.25, this.dpr - 0.25); this.resize(); }
      }
    }
    this.renderedLast = true;
    this.renderNow(dt);
  }
  private renderedLast = false;
  private slow: number[] = [];
  private dpr = 0;

  private labelsAnimating = false;
  private occlCache = new Map<string, boolean>();

  /** Render one frame now (labels included). */
  renderNow(dt = 1 / 60) {
    this.frameN++;
    // labels: refresh the set at most ~8×/s while the year moves
    const now = performance.now();
    if (this.labelSpecsAt !== this.year && (this.opts.cinema || now - this.labelYearT > 120)) {
      this.labels.set(this.labelSpecs());
      this.labelSpecsAt = this.year;
      this.labelYearT = now;
    }
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.stats.render.push(performance.now() - t0);
    if (this.stats.render.length > 600) this.stats.render.shift();
    this.dirty = false;
    // labels after the camera settles
    const v = new Vector3();
    const mw = this.model.matrixWorld;
    const cam = this.camera;
    const W = this.w, H = this.h;
    const checkOccl = this.frameN % 5 === 0 || this.opts.cinema;
    const occl = (s: LabelSpec, x: number, y: number, z: number): boolean => {
      if (!checkOccl) return this.occlCache.get(s.key) ?? false;
      const p = new Vector3(x, y, z).applyMatrix4(mw);
      const dir = cam.position.clone().sub(p);
      const len = dir.length();
      dir.normalize();
      let hidden = false;
      for (let t = 0.12; t < Math.min(len, 8); t += 0.1) {
        const qx = p.x + dir.x * t, qy = p.y + dir.y * t, qz = p.z + dir.z * t;
        if (Math.abs(qx) > this.m.width / 2 || Math.abs(qz) > this.m.depth / 2) break;
        if (qy > (this.m.maxY + 0.05) * this.relief) break;
        if (qy < this.m.heightAt(qx, qz) * this.relief - 0.005) { hidden = true; break; }
      }
      this.occlCache.set(s.key, hidden);
      return hidden;
    };
    this.labels.update((x, y, z) => {
      v.set(x, y, z).applyMatrix4(mw).project(cam);
      return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H, v.z < 1];
    }, W, H, dt, occl);
    // keep rendering a little while label fades run
    this.labelsAnimating = this.frameN - this.lastYearFrame < 40 || this.labelSpecsAt !== this.year;
  }
  private lastYearFrame = 0;

  // ---------------------------------------------------------------- cinema
  /** Render a frame for a pose and year synchronously (frame stepping for the recorder). */
  cinemaFrame(pose: Pose, y: number, dt: number) {
    this.setPose(pose);
    if (y !== this.year) this.setYear(y);
    this.renderNow(dt);
  }

  homeFor(aspect: number): number {
    return this.fitDistance(aspect < 0.8 ? Math.PI / 2 : 0, 0.5, aspect);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.labels.clear();
    this.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as MeshBasicMaterial | MeshBasicMaterial[] | undefined;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose()); else if (mat) { mat.map?.dispose(); mat.dispose(); }
    });
    this.palette.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

export interface YearInfo {
  year: number;
  states: { idx: number; id: string; name: string; color: string; cells: number; share: number; anchor: number; cx: number; cy: number }[];
  cities: { name: string; id: string; pop: number; cap: boolean; cell: number }[];
  landCells: number;
}
