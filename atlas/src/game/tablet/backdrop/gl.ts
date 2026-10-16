// The Tablet House backdrop in 3D: the #/3d relief scene (TerrainScene, reused as is) framed low over the besieged
// city at the scenario's year, with a sky dome, haze, the city's blocks (or atlas/src/three/city's model when it
// exists), and the beat's effects. One slow cinematic camera drifts around the city; beats crossfade.

import {
  BufferAttribute, BufferGeometry, Color, CylinderGeometry, DirectionalLight, Fog, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial,
  PlaneGeometry, PointLight, SRGBColorSpace, Vector3, type IUniform, type Material, type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { WorldJson } from '../../../../../engine/src/export/contract.ts';
import { buildTerrain, SCALE, SEA_Y, type TerrainMesh } from '../../../terrain/mesh.ts';
import { TerrainScene } from '../../../terrain/scene.ts';
import { ensureEvents, ensureMapData, ensureMeta, ensurePoliticalYear } from '../../../store.ts';
import { MapRenderer, type MapData } from '../../../views/mapRenderer.ts';
import { buildBlockCity, type CityModel } from './city.ts';
import { Fx } from './fx.ts';
import { blendLook, skyAt, type Look } from './looks.ts';
import { cityRadius, eraIndex, hashStr, streamOf, type BackdropScenario } from './scenario.ts';
import { FOG_GLSL, fogUniforms, setFogUniforms, Sky, type FogUniforms } from './sky.ts';

const DEG = Math.PI / 180;
const LOOK_MS = 3200;
const CAM_MS = 6500;
/** Reduced motion: every frame is drawn at this moment (smoke columns fully risen). */
const STILL_T = 26;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (t: number) => t * t * (3 - 2 * t);

let meshCache: { world: WorldJson; mesh: TerrainMesh } | null = null;
function meshFor(d: MapData): TerrainMesh {
  if (!meshCache || meshCache.world !== d.world) meshCache = { world: d.world, mesh: buildTerrain(d.world, d.geo) };
  return meshCache.mesh;
}

export interface GlOpts { reducedMotion: boolean; mobile: boolean }
export interface GlStats { frame: number[]; render: number[]; dpr: number; build: number; city: 'model' | 'blocks' }

// ---------------------------------------------------------------- the city model from atlas/src/three/city, if any
type BuildCity = (settlement: unknown, year: number, opts?: Record<string, unknown>) => unknown;
const CITY_MODULES = import.meta.glob('../../../three/city/*.ts');

/** atlas/src/three/city's buildCity() and loadCityRecord(), when that module exports them. */
async function cityModule(): Promise<{ build: BuildCity; load: ((id: string) => Promise<unknown>) | null } | null> {
  const rank = (path: string) => { const i = ['index.ts', 'build.ts', 'model.ts', 'city.ts'].indexOf(path.split('/').pop() ?? ''); return i < 0 ? 10 : i; };
  const keys = Object.keys(CITY_MODULES).sort((a, b) => rank(a) - rank(b));
  let build: BuildCity | null = null, load: ((id: string) => Promise<unknown>) | null = null;
  for (const k of keys) {
    try {
      const mod = (await CITY_MODULES[k]()) as Record<string, unknown>;
      if (!build && typeof mod.buildCity === 'function') build = mod.buildCity as BuildCity;
      if (!load && typeof mod.loadCityRecord === 'function') load = mod.loadCityRecord as (id: string) => Promise<unknown>;
    } catch { /* a module that does not load is not ours to fix */ }
    if (build && load) break;
  }
  return build ? { build, load } : null;
}

function asObject3D(v: unknown): Object3D | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.isObject3D) return v as Object3D;
  for (const k of ['group', 'object', 'root', 'model', 'mesh']) {
    const c = o[k] as Record<string, unknown> | undefined;
    if (c && c.isObject3D) return c as unknown as Object3D;
  }
  return null;
}

interface CityModelLike { setYear(y: number): boolean | void; P?: number; smoke?: { x: number; y: number; z: number; k: number }[] }

const isFoliage = (r: number, g: number, b: number) => g > r * 1.08 && g > b * 1.02;
const treeKey = (x: number, z: number) => `${x.toFixed(2)},${z.toFixed(2)}`;

/** The city module's model of the city set into the relief: its plinth, water and puffs left out, scaled to the
 *  city's radius, every part draped onto the land (taller than its plot, as the relief is), parts that fall in the
 *  relief's sea dropped, its forest thinned toward the rim, and its painted fields and roads laid over the land. */
class ModelCity {
  readonly group: Object3D;
  private model: CityModelLike | null;
  private parts: InstancedMesh[] = [];
  private m: TerrainMesh;
  private C: Vector3;
  private k = 1;
  private ey: number;
  private townR = 1;
  private year: number;
  private ground: Mesh | null = null;
  private groundMat: MeshLambertMaterial | null = null;
  top = 0.02;

  constructor(group: Object3D, m: TerrainMesh, C: Vector3, R: number, year: number, era: number) {
    this.group = group;
    this.m = m;
    this.C = C;
    this.year = year;
    this.ey = era >= 5 ? 1.15 : era >= 3 ? 1.45 : 1.8;
    const ud = group.userData as { model?: CityModelLike } | undefined;
    this.model = ud?.model && typeof ud.model.setYear === 'function' ? ud.model : null;
    this.collect();
    // scale: the town's extent (its buildings, not its woods: foliage and the trunks under it) to the city's radius
    const trees = this.treeKeys();
    const ds: number[] = [];
    for (const im of this.parts) {
      const e = im.instanceMatrix.array as Float32Array;
      for (let i = 0; i < im.count; i++) {
        if (e[i * 16 + 13] < -0.05 || trees.has(treeKey(e[i * 16 + 12], e[i * 16 + 14]))) continue;
        ds.push(Math.hypot(e[i * 16 + 12], e[i * 16 + 14]));
      }
    }
    ds.sort((a, b) => a - b);
    this.townR = ds.length ? Math.max(1, ds[Math.floor(ds.length * 0.9)]) : 10;
    this.k = R / this.townR;
    group.scale.setScalar(this.k);
    group.position.copy(C);
    this.drape();
    if (this.groundSrc) this.layGround(this.groundSrc);
  }

  /** Where the trees stand (foliage-coloured parts), keyed by position. */
  private treeKeys(): Set<string> {
    const out = new Set<string>();
    for (const im of this.parts) {
      const e = im.instanceMatrix.array as Float32Array, c = im.instanceColor?.array as Float32Array | undefined;
      if (!c) continue;
      for (let i = 0; i < im.count; i++) if (isFoliage(c[3 * i], c[3 * i + 1], c[3 * i + 2])) out.add(treeKey(e[i * 16 + 12], e[i * 16 + 14]));
    }
    return out;
  }

  /** The buildings: instanced parts that cast shadows; the module's ground, water, plinth and puffs stay hidden. */
  private collect() {
    this.parts = [];
    let groundSrc: Mesh | null = null;
    for (const c of this.group.children) {
      const ims = c.children.filter((x) => (x as InstancedMesh).isInstancedMesh) as InstancedMesh[];
      if (ims.length && ims.some((x) => x.castShadow)) { this.parts.push(...ims); continue; }
      if (c === this.ground) continue;
      const mm = c as Mesh;
      const map = (mm.material as MeshLambertMaterial | undefined)?.map;
      if (mm.isMesh && map && mm.geometry?.getAttribute('uv')) groundSrc = mm;
      c.visible = false;
    }
    if (groundSrc) this.groundSrc = groundSrc;
  }
  private groundSrc: Mesh | null = null;
  /** A great city runs off the model's edge (its houses reach the plinth). */
  get runsOff(): boolean { return this.townR > (this.model?.P ?? Infinity) * 0.8; }
  /** One plot (lot) in scene units. */
  get lot(): number { return this.k; }

  /** Before the fall (`after` false) the city stands as it was the year before; after, as the record has it. */
  setPhase(after: boolean) {
    if (!this.model) return;
    const changed = this.model.setYear(after ? this.year : this.year - 1);
    if (changed !== false) { this.collect(); this.drape(); }
  }

  private drape() {
    const { m, C, k, ey } = this;
    const P = this.model?.P ?? this.townR * 1.4;
    let top = 0;
    const ragged = this.runsOff;
    const gone = new Set<string>();
    const keyOf = treeKey;
    const hide = (e: Float32Array, o: number) => { for (let j = 0; j < 12; j++) e[o + j] = 0; };
    // the woods: thin out beyond the town so they do not stop at a circle
    for (const im of this.parts) {
      const e = im.instanceMatrix.array as Float32Array, c = im.instanceColor?.array as Float32Array | undefined;
      if (!c) continue;
      for (let i = 0; i < im.count; i++) {
        const o = i * 16;
        if (!isFoliage(c[3 * i], c[3 * i + 1], c[3 * i + 2])) continue;
        const x = e[o + 12], z = e[o + 14], r = Math.hypot(x, z);
        if (r < this.townR * 1.05) continue;
        const keep = 0.5 * (1 - Math.min(1, Math.max(0, (r - this.townR) / Math.max(1, P - this.townR))));
        const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
        if (h > keep) { hide(e, o); gone.add(keyOf(x, z)); }
      }
    }
    for (const im of this.parts) {
      const e = im.instanceMatrix.array as Float32Array;
      for (let i = 0; i < im.count; i++) {
        const o = i * 16;
        const lx = e[o + 12], ly = e[o + 13], lz = e[o + 14];
        if (gone.has(keyOf(lx, lz))) { hide(e, o); continue; }
        if (ragged && ly > -0.05) {
          // a great city's edge frays into its suburbs instead of stopping at the model's circle
          const r = Math.hypot(lx, lz) / this.townR, a = Math.atan2(lz, lx);
          const edge = 0.8 + 0.08 * Math.sin(3 * a + 1.7) + 0.06 * Math.sin(5 * a + 0.4);
          const h = Math.abs(Math.sin(lx * 91.7 + lz * 47.3) * 43758.5453) % 1;
          if (r > edge && h < Math.min(1, (r - edge) / 0.2)) { hide(e, o); continue; }
        }
        if (e[o + 5] === 0 && e[o] === 0) continue;
        const wx = C.x + lx * k, wz = C.z + lz * k;
        const hw = m.heightAt(wx, wz);
        const water = ly < -0.05; // boats and quays sit at the model's water line
        if (water ? hw > SEA_Y + 0.004 : hw < SEA_Y + 0.0015) { hide(e, o); continue; }
        e[o + 13] = water ? ly + (SEA_Y - C.y) / k + 0.14 : ly * ey + (hw - C.y) / k;
        if (!water) { e[o + 4] *= ey; e[o + 5] *= ey; e[o + 6] *= ey; }
        top = Math.max(top, (e[o + 13] + e[o + 5]) * k);
      }
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
    }
    this.top = Math.max(0.01, Math.min(top, 0.2));
  }

  /** The module's painted ground (fields, roads) draped over the relief around the town, fading out at its rim
   *  and wherever the relief has sea; inside the town the relief's own ground shows. */
  private layGround(src: Mesh) {
    const { m, C, k } = this;
    const g0 = src.geometry;
    const pos = g0.getAttribute('position'), uv = g0.getAttribute('uv');
    const n = pos.count;
    const P = this.model?.P ?? Math.sqrt(pos.getX(n - 1) ** 2 + pos.getZ(n - 1) ** 2);
    const p = new Float32Array(n * 3), col = new Float32Array(n * 4);
    const lift = 0.0007 / k;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const wx = C.x + x * k, wz = C.z + z * k;
      const hw = m.heightAt(wx, wz);
      p[3 * i] = x; p[3 * i + 1] = (Math.max(hw, SEA_Y) - C.y) / k + lift; p[3 * i + 2] = z;
      const r = Math.hypot(x, z);
      const rim = 1 - Math.min(1, Math.max(0, (r / P - 0.55) / 0.43));
      const town = Math.min(1, Math.max(0, (r - this.townR * 0.8) / (this.townR * 0.3)));
      const wet = hw < SEA_Y + 0.0015 ? 0 : 1;
      col[4 * i] = 1; col[4 * i + 1] = 1; col[4 * i + 2] = 1; col[4 * i + 3] = rim * rim * (3 - 2 * rim) * town * wet;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(p, 3));
    g.setAttribute('uv', uv.clone());
    g.setAttribute('color', new BufferAttribute(col, 4));
    if (g0.index) g.setIndex(g0.index.clone());
    g.computeVertexNormals();
    const tex = (src.material as MeshLambertMaterial).map;
    // the painting's bare land (a corner, outside its disc) is the relief's job: keep only fields, roads and paving
    let base = [0.5, 0.5, 0.5];
    try {
      const cv = tex?.image as HTMLCanvasElement | undefined;
      const px = cv?.getContext?.('2d')?.getImageData(2, 2, 1, 1).data;
      if (px) base = [px[0] / 255, px[1] / 255, px[2] / 255].map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    } catch { /* keep the grey */ }
    this.groundMat = new MeshLambertMaterial({
      map: tex, vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    // the model's own water (painted bluish) is not the relief's: leave it out
    this.groundMat.onBeforeCompile = (sh) => {
      sh.uniforms.uBase = { value: new Vector3(base[0], base[1], base[2]) };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uBase;')
        .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
  diffuseColor.a *= 1.0 - smoothstep(0.015, 0.06, sampledDiffuseColor.b - max(sampledDiffuseColor.r, sampledDiffuseColor.g * 0.96));
  diffuseColor.a *= smoothstep(0.025, 0.09, distance(sampledDiffuseColor.rgb, uBase));
#endif`);
    };
    this.groundMat.customProgramCacheKey = () => 'bd-ground-v2';
    this.ground = new Mesh(g, this.groundMat);
    this.ground.receiveShadow = true;
    this.ground.renderOrder = 1;
    this.group.add(this.ground);
  }

  /** Roof tops (for night lights and fires) and chimneys, in scene units. */
  anchors(): { roofs: Float32Array; hearths: Float32Array } {
    const { C, k } = this;
    const roofs: number[] = [];
    const trees = this.treeKeys();
    let best: InstancedMesh | null = null;
    for (const im of this.parts) if (!best || im.count > best.count) best = im;
    if (best) {
      const e = best.instanceMatrix.array as Float32Array, c = best.instanceColor?.array as Float32Array | undefined;
      for (let i = 0; i < best.count; i++) {
        const o = i * 16;
        if (e[o + 5] === 0 || (c && isFoliage(c[3 * i], c[3 * i + 1], c[3 * i + 2]))) continue;
        if (Math.hypot(e[o + 12], e[o + 14]) > this.townR * 1.1 || trees.has(treeKey(e[o + 12], e[o + 14]))) continue;
        roofs.push(C.x + e[o + 12] * k, C.y + (e[o + 13] + e[o + 5]) * k + 0.0006, C.z + e[o + 14] * k);
      }
    }
    const hearths: number[] = [];
    for (const s of this.model?.smoke ?? []) {
      const wx = C.x + s.x * k, wz = C.z + s.z * k;
      hearths.push(wx, Math.max(SEA_Y, this.m.heightAt(wx, wz)) + s.y * k * this.ey, wz);
    }
    return { roofs: new Float32Array(roofs), hearths: new Float32Array(hearths) };
  }

  /** Free our ground, then let the city module free its model (its geometries are shared across its cities). */
  dispose() {
    this.ground?.geometry.dispose();
    this.groundMat?.dispose();
    if (this.ground) this.group.remove(this.ground);
    this.group.removeFromParent();
    (this.model as { dispose?: () => void } | null)?.dispose?.();
  }
}

async function modelCity(sc: BackdropScenario, d: MapData, m: TerrainMesh, C: Vector3, R: number, era: number, mobile: boolean): Promise<ModelCity | null> {
  const mod = await cityModule();
  if (!mod) return null;
  const args: unknown[] = [];
  if (mod.load) { try { args.push(await mod.load(sc.city.id)); } catch (e) { console.warn('backdrop: loadCityRecord failed', e); } }
  args.push(d.timeline.settlements.find((s) => s.id === sc.city.id), sc.city);
  for (const a of args) {
    if (!a) continue;
    try {
      let out = mod.build(a, sc.year - 1, { plinth: false, textureSize: mobile ? 256 : 512, theme: 'light' });
      if (out && typeof (out as Promise<unknown>).then === 'function') out = await out;
      const obj = asObject3D(out);
      if (obj) return new ModelCity(obj, m, C, R, sc.year, era);
    } catch (e) { console.warn('backdrop: buildCity failed, using blocks', e); }
  }
  return null;
}

// ---------------------------------------------------------------- haze
const FOG_FRAG = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, bdSky( normalize( transpose( mat3( viewMatrix ) ) * ( - vViewPosition ) ) ), fogFactor );
#endif`;

/** Make a Lambert material's fog fade toward the sky in its own direction (keeps the material's own shader hooks).
 *  `grab` receives the compiled shader's uniforms (the relief's tint and paper live there). */
function hookFog(mat: Material, U: FogUniforms, grab?: (u: Record<string, IUniform>) => void) {
  if (mat.userData.bdFog || !(mat as MeshLambertMaterial).isMeshLambertMaterial) return;
  const prev = mat.onBeforeCompile;
  const key = mat.customProgramCacheKey();
  mat.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms, r) => {
    prev.call(mat, sh, r);
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${FOG_GLSL}`)
      .replace('#include <fog_fragment>', FOG_FRAG);
    grab?.(sh.uniforms);
  };
  mat.customProgramCacheKey = () => `${key}|bd-fog`;
  mat.userData.bdFog = true;
  mat.needsUpdate = true;
}

// ---------------------------------------------------------------- the scene
export class GlBackdrop {
  readonly canvas: HTMLCanvasElement;
  readonly stats: GlStats = { frame: [], render: [], dpr: 1, build: 0, city: 'blocks' };
  private ts: TerrainScene;
  private m: TerrainMesh;
  private d: MapData;
  private opts: GlOpts;
  private wrap: HTMLElement;
  private sun!: DirectionalLight;
  private hemi!: HemisphereLight;
  private fire: PointLight;
  private sky: Sky;
  private fx: Fx;
  private fog: Fog;
  private fogU = fogUniforms();
  private relief: Record<string, IUniform> | null = null;
  private city: CityModel | null = null;
  private model: ModelCity | null = null;
  private after = false;
  private outerSea: Mesh[] = [];
  /** City centre (scene), radius, top of its roofs; unit vector toward the battle and its distance. */
  private C = new Vector3();
  private R: number;
  private top = 0.02;
  private B = new Vector3(0, 0, -1);
  private Db = 1;
  private baseAz = 0;
  private baseDist = 1;
  private from: Look;
  private to: Look;
  private cur: Look;
  private t0 = 0;
  private born = performance.now();
  private raf = 0;
  private running = false;
  private visible = true;
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;
  private lastT = 0;
  private w = 1;
  private h = 1;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private maxPt = 256;
  private lightKey = '';
  private slow: number[] = [];
  private needs = true;
  private disposed = false;

  private constructor(wrap: HTMLElement, canvas: HTMLCanvasElement, d: MapData, m: TerrainMesh, ts: TerrainScene, sc: BackdropScenario, look: Look, opts: GlOpts) {
    this.wrap = wrap;
    this.canvas = canvas;
    this.d = d;
    this.m = m;
    this.ts = ts;
    this.opts = opts;
    this.from = look; this.to = look; this.cur = look;
    this.R = cityRadius(sc.city.pop);
    if (opts.mobile) this.dpr = Math.min(this.dpr, 1.5);
    const scene = ts.scene;
    scene.traverse((o) => {
      if ((o as DirectionalLight).isDirectionalLight) this.sun = o as DirectionalLight;
      else if ((o as HemisphereLight).isHemisphereLight) this.hemi = o as HemisphereLight;
      // the atlas's settlement markers: the backdrop draws its own city and towns
      else if ((o as InstancedMesh).isInstancedMesh && (o as InstancedMesh).geometry instanceof CylinderGeometry) o.visible = false;
    });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.003;
    this.sun.shadow.radius = 2;
    this.fog = new Fog(0xffffff, 1, 10);
    scene.fog = this.fog;
    this.sky = new Sky(hashStr(sc.city.id));
    scene.add(this.sky.mesh);
    this.fire = new PointLight(0xff6a2a, 0, 0, 1.2);
    scene.add(this.fire);
    // placeholders until build() fills them
    this.fx = null as unknown as Fx;
  }

  static async create(parent: HTMLElement, sc: BackdropScenario, look: Look, opts: GlOpts): Promise<GlBackdrop> {
    const [d] = await Promise.all([ensureMapData(), ensurePoliticalYear(sc.year)]);
    const [meta] = await Promise.all([ensureMeta().catch(() => null), withTimeout(ensureEvents(), 2500)]);
    // let the painted backdrop paint before the (synchronous) relief build
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    const m = meshFor(d);
    const built = performance.now() - t0;
    const wrap = document.createElement('div');
    wrap.className = 'bd__glwrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'bd__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    wrap.appendChild(canvas);
    parent.appendChild(wrap);
    const ts = new TerrainScene(canvas, document.createElement('div'), d, m, { theme: 'light', reducedMotion: opts.reducedMotion, mobile: opts.mobile, cinema: false });
    ts.controls.enabled = false;
    ts.setSpin(false);
    ts.setYear(sc.year);
    const g = new GlBackdrop(wrap, canvas, d, m, ts, sc, look, opts);
    if (import.meta.env.DEV) (window as unknown as { __bdgl?: GlBackdrop }).__bdgl = g;
    g.stats.build = built;
    await g.build(sc, meta?.eras.map((e) => e.start));
    g.resize();
    g.setLook(look, true);
    g.start();
    return g;
  }

  // ---------------------------------------------------------------- set-up
  private async build(sc: BackdropScenario, eraStarts?: number[]) {
    const { d, m } = this;
    const rect = this.wrap.getBoundingClientRect();
    this.w = Math.max(1, rect.width); this.h = Math.max(1, rect.height);
    const geo = d.geo;
    let cell = sc.city.cell;
    if (!(cell >= 0 && cell < geo.n)) cell = d.timeline.settlements.find((s) => s.id === sc.city.id)?.cell ?? 0;
    const cx = geo.sx[cell] * SCALE - m.ox, cz = geo.sy[cell] * SCALE - m.oz;
    this.C.set(cx, Math.max(SEA_Y, m.heightAt(cx, cz)), cz);
    const R = this.R;

    // ---- toward the battle: its event's cell, else the enemy's nearest ground
    const owners = d.layers.political.at(sc.year);
    const idxOf = (id: string) => d.timeline.polities.find((p) => p.id === id)?.idx ?? -1;
    const enemy = idxOf(sc.enemy.id);
    let bcell = sc.battle?.cell ?? -1;
    if (bcell < 0 && sc.battle?.id) {
      const id = sc.battle.id.startsWith('evt:') ? sc.battle.id : `evt:${sc.battle.id}`;
      bcell = d.timeline.events.find((e) => e.id === id)?.cell ?? -1;
    }
    // else the town the battle is named for
    if (bcell < 0 && sc.battle?.placeId?.startsWith('set:')) bcell = d.timeline.settlements.find((s) => s.id === sc.battle!.placeId)?.cell ?? -1;
    const nearestOf = (pred: (i: number) => boolean) => {
      let best = -1, bd = Infinity;
      for (let i = 0; i < geo.n; i++) {
        if (!pred(i)) continue;
        const dd = (geo.sx[i] - geo.sx[cell]) ** 2 + (geo.sy[i] - geo.sy[cell]) ** 2;
        if (dd < bd && dd > 1) { bd = dd; best = i; }
      }
      return best;
    };
    const enemyCell = enemy >= 0 ? nearestOf((i) => owners[i] === enemy) : -1;
    const toward = (c: number) => {
      const v = new Vector3(geo.sx[c] * SCALE - m.ox - cx, 0, geo.sy[c] * SCALE - m.oz - cz);
      return { v, len: v.length() };
    };
    let dir = bcell >= 0 ? toward(bcell) : null;
    if (!dir || dir.len < R * 2.5) {
      const e = enemyCell >= 0 ? toward(enemyCell) : null;
      if (e && e.len > R * 2.5) dir = { v: e.v, len: Math.max(dir?.len ?? 0, e.len) };
    }
    if (!dir || dir.len < 1e-4) {
      // inland from the coast, or a direction drawn from the city's id
      const a = (hashStr(sc.city.id) / 4294967296) * Math.PI * 2;
      dir = { v: new Vector3(Math.cos(a), 0, Math.sin(a)), len: 1.2 };
    }
    this.B.copy(dir.v).normalize();
    this.Db = clamp(dir.len, R * 3, 3.4);

    // ---- the city: the city module's model when there is one, else blocks
    const era = eraIndex(sc.year, eraStarts);
    const isLand = (x: number, z: number) => { const c = m.cellAt(x, z); return c >= 0 && geo.land[c] === 1; };
    const neighbours: { x: number; z: number; pop: number; id: string }[] = [];
    for (const s of d.timeline.settlements) {
      if (s.id === sc.city.id || s.start > sc.year || (s.end < sc.year && s.end < 5000)) continue;
      const x = geo.sx[s.cell] * SCALE - m.ox, z = geo.sy[s.cell] * SCALE - m.oz;
      const dd = Math.hypot(x - cx, z - cz);
      if (dd < R * 2.2 || dd > 3.2) continue;
      const pop = MapRenderer.popAt(s.pop, sc.year);
      if (pop > 0) neighbours.push({ x, z, pop, id: s.id });
    }
    neighbours.sort((a, b) => b.pop - a.pop);
    const model = await modelCity(sc, d, m, this.C, R, era, this.opts.mobile).catch((e) => { console.warn('backdrop: city model', e); return null; });
    // blocks: the whole city when there is no model; else only the towns around it (on the model's plots)
    const city = buildBlockCity(m, isLand, sc, era, cx, cz, R, neighbours.slice(0, this.opts.mobile ? 8 : 16), this.opts.mobile,
      model ? { main: 'none', plot: model.lot } : { main: 'full' });
    this.city = city;
    this.ts.scene.add(city.group);
    this.top = Math.max(0.01, city.top);
    let windows = city.windows, fires = city.fires, hearths = city.hearths;
    if (model) {
      // the city module's model stands in for the blocks
      this.model = model;
      this.ts.scene.add(model.group);
      this.stats.city = 'model';
      this.top = model.top;
      const a = model.anchors();
      const pickEvery = (arr: Float32Array, share: number, seed: string) => {
        const r = streamOf(seed), out: number[] = [];
        for (let i = 0; i + 2 < arr.length; i += 3) if (r() < share) out.push(arr[i], arr[i + 1], arr[i + 2]);
        return new Float32Array(out);
      };
      const n = a.roofs.length / 3;
      windows = pickEvery(a.roofs, Math.min(0.7, (this.opts.mobile ? 900 : 1600) / Math.max(1, n)), `${sc.city.id}:win`);
      fires = pickEvery(a.roofs, Math.min(0.18, 260 / Math.max(1, n)), `${sc.city.id}:fire`);
      // chimneys of the town itself (a works far out on the plinth would smoke in front of the camera)
      const near: number[] = [];
      for (let i = 0; i + 2 < a.hearths.length; i += 3) {
        if (Math.hypot(a.hearths[i] - cx, a.hearths[i + 2] - cz) < R * 1.3) near.push(a.hearths[i], a.hearths[i + 1], a.hearths[i + 2]);
      }
      if (near.length) hearths = new Float32Array(near);
    }

    // ---- the besiegers' camp: clusters of fires in a ring, thickest toward the enemy's road
    const rnd = streamOf(`backdrop:${sc.city.id}:${sc.year}:camp`);
    const nCamp = Math.round(clamp(Math.sqrt(Math.max(400, sc.battle?.theirs ?? 2000)) * 3, 80, this.opts.mobile ? 260 : 440));
    const camp: number[] = [];
    const ba = Math.atan2(this.B.z, this.B.x);
    for (let tries = 0; camp.length / 3 < nCamp && tries < 400; tries++) {
      const toward = rnd() < 0.62;
      const a = toward ? ba + (rnd() - 0.5) * 2 * 1.7 : rnd() * Math.PI * 2;
      const r = R * (1.7 + Math.pow(rnd(), 1.4) * (toward ? 2.2 : 1.1));
      const x0 = cx + Math.cos(a) * r, z0 = cz + Math.sin(a) * r;
      if (!isLand(x0, z0) || m.heightAt(x0, z0) <= SEA_Y + 0.004) continue;
      const k = 4 + Math.floor(rnd() * 12), cr = R * (0.08 + rnd() * 0.12);
      for (let j = 0; j < k; j++) {
        const aa = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * cr;
        const x = x0 + Math.cos(aa) * rr, z = z0 + Math.sin(aa) * rr;
        const y = m.heightAt(x, z);
        if (y <= SEA_Y + 0.003) continue;
        camp.push(x, y + 0.002, z);
      }
    }
    const campArr = new Float32Array(camp);
    // fire centres over the city: spread out (farthest-point picks from the burning houses)
    const pick = (arr: Float32Array, k: number) => {
      const n = arr.length / 3;
      const out: number[] = [];
      if (!n) return new Float32Array(0);
      let idx = 0;
      const dmin = new Float32Array(n).fill(Infinity);
      for (let j = 0; j < Math.min(k, n); j++) {
        out.push(arr[3 * idx], arr[3 * idx + 1], arr[3 * idx + 2]);
        let best = 0, bd = -1;
        for (let q = 0; q < n; q++) {
          const dd = (arr[3 * q] - arr[3 * idx]) ** 2 + (arr[3 * q + 2] - arr[3 * idx + 2]) ** 2;
          if (dd < dmin[q]) dmin[q] = dd;
          if (dmin[q] > bd) { bd = dmin[q]; best = q; }
        }
        idx = best;
      }
      return new Float32Array(out);
    };
    if (!fires.length) fires = new Float32Array([cx, this.C.y + 0.01, cz]);
    const sackSrc = pick(fires, this.opts.mobile ? 4 : 5);
    const glow = new Float32Array(sackSrc.length);
    for (let i = 0; i < sackSrc.length; i += 3) { glow[i] = sackSrc[i]; glow[i + 1] = sackSrc[i + 1] + R * 0.12; glow[i + 2] = sackSrc[i + 2]; }
    const campSmoke = pick(campArr, 7);
    // the battle's dust, far off toward the field
    const dd = clamp(this.Db, R * 4, 3.2);
    const dx = cx + this.B.x * dd, dz = cz + this.B.z * dd;
    const dust = new Float32Array([dx, Math.max(SEA_Y, m.heightAt(dx, dz)), dz]);
    const dustH = clamp(0.25 + dd * 0.12, 0.3, 0.62);
    // the wind blows across the view
    const side = hashStr(`${sc.city.id}:wind`) % 2 ? 1 : -1;
    const wind = new Vector3(-this.B.z * side, 0, this.B.x * side).multiplyScalar(0.9).addScaledVector(this.B, 0.25);
    this.baseDist = this.distFor();
    this.fx = new Fx(
      { sack: sackSrc, dust, camp: campSmoke, hearth: hearths.slice(0, 3 * (this.opts.mobile ? 8 : 14)) },
      { windows, camp: campArr, fires, glow },
      { R, dustH, dist: this.baseDist }, wind, this.opts.mobile, this.fogU,
    );
    this.ts.scene.add(this.fx.smoke, this.fx.glow);
    this.fire.position.set(cx, this.C.y + R * 0.7, cz);
    this.fire.distance = R * 6;

    // ---- an endless sea around the model, so the horizon never shows the table's edge: the relief's own (tinted,
    // see-through) sea over a deep floor of the colour its deep water has
    let reliefSea: Mesh | null = null;
    this.ts.scene.traverse((o) => {
      const mm = o as Mesh;
      if (mm.isMesh && mm.geometry instanceof PlaneGeometry && Math.abs(mm.position.y - SEA_Y) < 1e-6 && (mm.material as MeshLambertMaterial).transparent) reliefSea = mm;
    });
    const floorMat = new MeshLambertMaterial({ color: new Color().setRGB(0.427, 0.576, 0.651, SRGBColorSpace) });
    const hw = m.width / 2, hd = m.depth / 2, F = 80;
    for (const [w, dpt, x, z] of [[F * 2, F - hd, 0, -(hd + (F - hd) / 2)], [F * 2, F - hd, 0, hd + (F - hd) / 2], [F - hw, hd * 2, -(hw + (F - hw) / 2), 0], [F - hw, hd * 2, hw + (F - hw) / 2, 0]]) {
      for (const [mat, y] of [[floorMat, -0.33], [(reliefSea as Mesh | null)?.material as MeshLambertMaterial | undefined, SEA_Y]] as const) {
        if (!mat) continue;
        const p = new Mesh(new PlaneGeometry(w, dpt), mat);
        p.rotation.x = -Math.PI / 2;
        p.position.set(x, y, z);
        p.renderOrder = mat === floorMat ? 0 : 2;
        this.outerSea.push(p);
        this.ts.scene.add(p);
      }
    }

    // ---- the base heading: behind the city, looking toward the battle, turned to keep the city in sight
    this.baseDist = this.distFor();
    const az0 = Math.atan2(-this.B.x, -this.B.z);
    let best = az0, bestScore = Infinity;
    for (let k = -8; k <= 8; k++) {
      const az = az0 + k * 0.15;
      const el = this.safeElev(az, this.baseDist, 14);
      const camX = cx + Math.sin(az) * this.baseDist, camZ = cz + Math.cos(az) * this.baseDist;
      const off = Math.abs(camX) > hw || Math.abs(camZ) > hd ? 2 : 0;
      // a strip of sky over the land, rather than a hillside filling the frame
      const sky = this.skyShare(az, el);
      const score = (el - 14) * 0.09 + Math.abs(k * 0.15) * 0.3 + off + Math.max(0, 0.16 - sky) * 6;
      if (score < bestScore) { bestScore = score; best = az; }
    }
    this.baseAz = best;
    // every surface hazes toward the sky behind it; the relief reads its state colours more lightly over the land
    this.ts.scene.traverse((o) => {
      const mats = (o as Mesh).material;
      for (const mm of Array.isArray(mats) ? mats : mats ? [mats] : []) {
        hookFog(mm, this.fogU, (o as Mesh).geometry?.getAttribute('aCells') ? (u) => { this.relief = u; this.tuneRelief(); } : undefined);
      }
    });
    if (sc.camera?.fixed) {
      const c = sc.camera, t = c.target;
      const dx2 = c.x - t[0], dz2 = c.z - t[2];
      this.baseAz = Math.atan2(dx2, dz2);
      const dist = Math.hypot(dx2, c.y - t[1], dz2);
      if (dist > 0.05) this.baseDist = dist;
    }
  }

  /** The relief's state colours as a wash over the land (the atlas paints them over paper). */
  private tuneRelief() {
    const u = this.relief;
    if (!u) return;
    u.uNeutral.value = 0.3;
    u.uTint.value = 0.42;
    u.uInkA.value = 0.32;
    u.uFrontierK.value = 0.55;
  }

  /** Camera distance: the city across ~36% of a wide frame, ~58% of a tall one. */
  private distFor(): number {
    const aspect = this.w / this.h;
    const fov = this.fovFor(aspect);
    const th = Math.tan((fov * DEG) / 2) * aspect;
    const f = aspect >= 1 ? 0.36 : 0.58;
    return Math.max(0.3, this.R / (f * th));
  }
  private fovFor(aspect: number) { return aspect >= 1 ? 36 : clamp(36 + (1 - aspect) * 36, 36, 56); }

  /** The camera's heading for a look: between the scene's chosen one and the one facing the battle. */
  private headingOf(l: Look): number {
    const toBattle = Math.atan2(-this.B.x, -this.B.z);
    let d = toBattle - this.baseAz;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return this.baseAz + d * l.face + l.azOff;
  }

  /** Roughly how much of the frame's height is sky, looking at the city from heading `az` at elevation `el`. */
  private skyShare(az: number, el: number): number {
    const aspect = this.w / this.h;
    const fov = this.fovFor(aspect) * DEG;
    const cityY = aspect >= 1 ? -0.2 : 0.1;
    const t = Math.tan(fov / 2);
    const top = Math.atan((1 - cityY) * t) - el * DEG; // the frame's top edge above the horizontal
    const dist = this.baseDist;
    const cx = this.C.x + Math.sin(az) * Math.cos(el * DEG) * dist, cz = this.C.z + Math.cos(az) * Math.cos(el * DEG) * dist;
    const cy = this.C.y + this.top * 0.35 + Math.sin(el * DEG) * dist;
    const fx = -Math.sin(az), fz = -Math.cos(az);
    let ridge = -Infinity;
    for (let d = 0.2; d < 7; d *= 1.12) {
      const x = cx + fx * d, z = cz + fz * d;
      if (Math.abs(x) > this.m.width / 2 || Math.abs(z) > this.m.depth / 2) break;
      ridge = Math.max(ridge, Math.atan((Math.max(SEA_Y, this.m.heightAt(x, z)) - cy) / d));
    }
    return Math.max(0, Math.min(1, (top - Math.max(ridge, -0.02)) / (2 * Math.atan(t))));
  }

  /** The lowest elevation (degrees, from `want` up) at which the city stays in sight across the drift. */
  private safeElev(az: number, dist: number, want: number): number {
    const m = this.m;
    const tx = this.C.x, ty = this.C.y + this.top * 0.5, tz = this.C.z;
    for (let el = want; el < 50; el += 1.5) {
      let clear = true;
      for (const da of [-0.11, 0, 0.11]) {
        const a = az + da;
        const ce = Math.cos(el * DEG), se = Math.sin(el * DEG);
        const px = tx + Math.sin(a) * ce * dist, py = ty + se * dist, pz = tz + Math.cos(a) * ce * dist;
        for (let i = 1; i <= 28 && clear; i++) {
          const u = i / 29;
          const x = px + (tx - px) * u, y = py + (ty - py) * u, z = pz + (tz - pz) * u;
          if (Math.max(SEA_Y, m.heightAt(x, z)) > y - 0.004 - (1 - u) * 0.01) clear = false;
        }
        if (!clear) break;
      }
      if (clear) return el;
    }
    return 50;
  }

  // ---------------------------------------------------------------- beats
  /** Crossfade to a look (instantly for reduced motion or `instant`). */
  setLook(look: Look, instant = false, after = false) {
    if (after !== this.after) { this.after = after; this.model?.setPhase(after); this.lightKey = ''; }
    const target = { ...look };
    // a great city is seen from a little higher, so its streets do not fold into one skyline
    const lift = clamp((this.R - 0.07) * 70, 0, 7);
    // if hills hide the city, look for a nearby heading or a closer stand before climbing toward a map's-eye view
    const want = look.elev + lift;
    let best = { el: 90, daz: 0, dk: 1, cost: Infinity };
    for (const dk of [1, 0.82, 0.68]) {
      for (const daz of [0, -0.2, 0.2, -0.4, 0.4, -0.6, 0.6]) {
        const el = this.safeElev(this.headingOf(look) + daz, this.baseDist * look.distK * dk, want);
        const cost = (el - want) + Math.abs(daz) * 9 + (1 - dk) * 12;
        if (cost < best.cost) best = { el, daz, dk, cost };
        if (el <= want) break;
      }
      if (best.el <= want) break;
    }
    target.elev = best.el;
    target.azOff += best.daz;
    target.distK *= best.dk;
    const now = performance.now();
    if (instant || this.opts.reducedMotion) {
      this.from = target; this.to = target; this.cur = target; this.t0 = now - CAM_MS;
    } else {
      this.from = this.cur; this.to = target; this.t0 = now;
    }
    this.needs = true;
    if (!this.running) this.renderFrame(now);
  }

  // ---------------------------------------------------------------- frame
  private start() {
    this.running = true;
    this.io = new IntersectionObserver((es) => {
      this.visible = es.some((e) => e.isIntersecting);
      if (this.visible && !this.raf && !this.disposed) this.raf = requestAnimationFrame(this.loop);
    });
    this.io.observe(this.wrap);
    this.ro = new ResizeObserver(() => { this.resize(); this.needs = true; if (this.opts.reducedMotion) this.renderFrame(performance.now()); });
    this.ro.observe(this.wrap);
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (now: number) => {
    this.raf = 0;
    if (this.disposed || !this.visible) return;
    this.raf = requestAnimationFrame(this.loop);
    const settling = now - this.t0 < CAM_MS + 50;
    // reduced motion: still frames, drawn only when something changed
    if (this.opts.reducedMotion && !this.needs && !settling) { this.lastT = 0; return; }
    if (this.lastT) {
      const dt = now - this.lastT;
      this.stats.frame.push(dt);
      if (this.stats.frame.length > 600) this.stats.frame.shift();
      // dynamic resolution: below ~50 fps for a second and a half, step the pixel ratio down
      this.slow.push(dt);
      if (this.slow.length >= 90) {
        const med = this.slow.slice().sort((a, b) => a - b)[45];
        this.slow.length = 0;
        const floor = this.opts.mobile ? 0.85 : 1;
        if (med > 19.5 && this.dpr > floor) { this.dpr = Math.max(floor, this.dpr - 0.25); this.applySize(); }
      }
    }
    this.lastT = now;
    this.renderFrame(now);
  };

  /** Draw one frame for wall-clock `now` (or a fixed scene time `tFixed`, for captures). */
  renderFrame(now: number, tFixed?: number) {
    if (this.disposed) return;
    this.needs = false;
    const rm = this.opts.reducedMotion;
    const t = tFixed ?? (rm ? STILL_T : (now - this.born) / 1000 + 12);
    const ul = smooth(clamp((now - this.t0) / LOOK_MS, 0, 1));
    const uc = ease(clamp((now - this.t0) / CAM_MS, 0, 1));
    const L = blendLook(this.from, this.to, ul, uc);
    this.cur = L;
    const heading = this.headingOf(L);

    // ---- camera: a slow arc and breathing dolly, with a little sideways sway for parallax
    const dr = rm ? 0 : L.drift;
    const TAU = Math.PI * 2;
    const az = heading + dr * (0.075 * Math.sin((TAU * t) / 74) + 0.022 * Math.sin((TAU * t) / 31 + 1.1));
    const el = (L.elev + dr * 0.6 * Math.sin((TAU * t) / 63 + 2.0)) * DEG;
    const dist = this.baseDist * L.distK * (1 + dr * 0.035 * Math.sin((TAU * t) / 53 + 0.4));
    const lead = Math.min(this.Db, 1.6) * L.lead;
    const sway = dr * dist * 0.035 * Math.sin((TAU * t) / 89 + 0.7);
    const rx = Math.cos(az), rz = -Math.sin(az);
    const tx = this.C.x + this.B.x * lead + rx * sway, tz = this.C.z + this.B.z * lead + rz * sway;
    const ty = this.C.y + this.top * 0.35;
    const cam = this.ts.camera;
    const ce = Math.cos(el);
    let px = tx + Math.sin(az) * ce * dist, py = ty + Math.sin(el) * dist, pz = tz + Math.cos(az) * ce * dist;
    const ground = Math.max(SEA_Y, this.m.heightAt(px, pz)) + 0.025;
    if (py < ground) py = ground;
    cam.position.set(px, py, pz);
    cam.lookAt(tx, ty, tz);
    cam.updateMatrixWorld();
    px = cam.position.x; pz = cam.position.z;

    // ---- light: from the beat's heading (not the drift), so shadows are redrawn only while a beat changes
    const fwd = heading + Math.PI;
    const dirOf = (elD: number, azD: number) => {
      const a = fwd + azD * DEG, e = elD * DEG;
      return new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
    };
    const ld = dirOf(Math.max(5, L.lightEl), L.lightAz);
    const key = `${ld.x.toFixed(2)},${ld.y.toFixed(2)},${ld.z.toFixed(2)}`;
    if (key !== this.lightKey) { this.lightKey = key; this.fitShadow(ld); }
    this.sun.color.setRGB(L.light[0], L.light[1], L.light[2], SRGBColorSpace);
    this.sun.intensity = L.lightI;
    this.hemi.color.setRGB(L.hemiSky[0], L.hemiSky[1], L.hemiSky[2], SRGBColorSpace);
    this.hemi.groundColor.setRGB(L.hemiGround[0], L.hemiGround[1], L.hemiGround[2], SRGBColorSpace);
    this.hemi.intensity = L.hemiI;
    const fl = rm ? 1 : 0.78 + 0.13 * Math.sin(t * 7.3) * Math.sin(t * 2.9 + 1) + 0.09 * Math.sin(t * 17.1);
    this.fire.intensity = L.fire * 0.03 * fl;

    // ---- sky and haze: the land fades into the horizon's colour straight ahead
    const sunDir = dirOf(L.sunEl, L.sunAz);
    this.sky.apply(L, sunDir, t);
    this.sky.follow(cam.position);
    setFogUniforms(this.fogU, L, sunDir);
    const fx = -Math.sin(az), fz = -Math.cos(az);
    const hz = skyAt(L, 0, fx * sunDir.x + fz * sunDir.z);
    this.fog.color.setRGB(hz[0], hz[1], hz[2], SRGBColorSpace);
    const camDist = Math.hypot(px - tx, py - ty, pz - tz);
    this.fog.near = camDist * L.fogNear;
    this.fog.far = camDist * L.fogFar;
    const zl = 0.2126 * L.zenith[0] + 0.7152 * L.zenith[1] + 0.0722 * L.zenith[2];
    const night = 1 - smooth(clamp((zl - 0.05) / 0.3, 0, 1));
    const pxScale = (this.h * this.dpr) / (2 * Math.tan((cam.fov * DEG) / 2));
    this.fx.update(t, pxScale, this.maxPt, {
      smoke: L.smoke, dust: L.dust, campSmoke: L.campSmoke, chimney: L.chimney,
      windows: L.windows, camp: L.camp, fire: L.fire, glow: Math.max(L.fire, L.windows * 0.3),
      night, fogNear: this.fog.near, fogFar: this.fog.far, haze: L.haze,
    }, rm ? 0 : 1);

    const r0 = performance.now();
    this.ts.renderer.render(this.ts.scene, cam);
    this.stats.render.push(performance.now() - r0);
    if (this.stats.render.length > 600) this.stats.render.shift();
  }

  /** Fit the sun's shadow camera around the city's surroundings, seen from direction `dir`. */
  private fitShadow(dir: Vector3) {
    const sun = this.sun, C = this.C;
    sun.position.copy(C).addScaledVector(dir, 14);
    sun.target.position.copy(C);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    const sc = sun.shadow.camera;
    const look = new Matrix4().lookAt(sun.position, C, new Vector3(0, 1, 0)).invert();
    const Rs = clamp(this.baseDist * 1.7, 0.7, 4.5);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity;
    for (const x of [C.x - Rs, C.x + Rs]) for (const z of [C.z - Rs, C.z + Rs]) for (const y of [SEA_Y - 0.05, C.y + 0.6]) {
      const p = new Vector3(x, y, z).sub(sun.position).applyMatrix4(look);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z);
    }
    sc.left = x0; sc.right = x1; sc.bottom = y0; sc.top = y1; sc.near = 0.1; sc.far = -z0 + 0.5;
    sc.updateProjectionMatrix();
    this.ts.renderer.shadowMap.needsUpdate = true;
  }

  // ---------------------------------------------------------------- size
  resize() {
    const r = this.wrap.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    // the relief's own sizing first (it scales its border lines to the pixel ratio), then ours
    this.ts.resize();
    this.baseDist = this.distFor();
    this.applySize();
    // re-check the framing for the new aspect
    this.to = { ...this.to, elev: this.safeElev(this.headingOf(this.to), this.baseDist * this.to.distK, Math.max(this.to.elev, 0)) };
    this.lightKey = '';
  }

  private applySize() {
    const ts = this.ts;
    ts.renderer.setPixelRatio(this.dpr);
    ts.renderer.setSize(this.w, this.h, false);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.stats.dpr = this.dpr;
    const aspect = this.w / this.h;
    const cam = ts.camera;
    cam.fov = this.fovFor(aspect);
    cam.near = 0.02;
    cam.far = 160;
    cam.aspect = aspect;
    // lens shift: the city sits below centre on wide screens, above it on tall ones (cards cover a phone's lower half)
    const cityY = aspect >= 1 ? -0.2 : 0.1;
    cam.setViewOffset(this.w, this.h, 0, (cityY * this.h) / 2, this.w, this.h);
    cam.updateProjectionMatrix();
    const gl = ts.renderer.getContext();
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
    this.maxPt = Math.min(256, range ? range[1] : 64);
    this.needs = true;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.io?.disconnect();
    this.ro?.disconnect();
    this.fx?.dispose();
    this.sky.dispose();
    this.model?.dispose();
    this.city?.dispose();
    for (const p of this.outerSea) p.geometry.dispose();
    this.ts.dispose();
    this.wrap.remove();
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p.catch(() => undefined), new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);
}
