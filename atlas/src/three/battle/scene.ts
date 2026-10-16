// three.js side of #/battle/evt:N: a tabletop diorama on a plinth, two armies of instanced figures, banners and
// standards, the documents' ghost armies, and one clock (0 → 1) that drives the replay. Rendering is on demand:
// a frame is drawn only while the replay runs, the camera moves or a texture arrives.

import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight, DoubleSide, Group,
  HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PCFShadowMap,
  PerspectiveCamera, PlaneGeometry, Quaternion, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Material,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ArmsSpec, BattleJson, SigilSpec } from '../../../../engine/src/export/contract.ts';
import { BOARD_D, BOARD_W, FIELD, type Board } from './board.ts';
import { bannerTexture, plaqueTexture, standardTexture, tincturesOf, type Tinctures } from './banner.ts';
import { paletteFor, propGeometry, troopGeometry, bake, put, box, cyl, type Palette } from './figures.ts';
import { buildTown } from './town.ts';
import { FIG, PHASE, SPACING, fleeAt, frontAt, tally, unit, type BattlePlan, type Fig, type GhostPlan, type Style, type Troop } from './plan.ts';

export type Theme = 'light' | 'dark';
export interface SideInfo { name: string; arms: ArmsSpec; seal: SigilSpec | null; commander: string }
export interface SceneInfo {
  title: string;
  year: number;
  sides: [SideInfo, SideInfo];
  town: { name: string; pop: number } | null;
}
export interface SceneOpts { theme: Theme; mobile: boolean; reducedMotion: boolean }

const THEME = {
  light: { sky: '#fff7ea', ground: '#8a7454', hemi: 1.15, sun: '#fff1dc', sunI: 2.5, rim: '#cfe0ff', rimI: 0.55, wood: '#6b4529', woodTop: '#7d5634', earth: ['#7a5a3c', '#9a7a55', '#6a4c33', '#8d6c49'], sea: '#7da4b6', seaA: 0.82, ghost: '#3a62ad', ghostA: 0.36, dim: 1 },
  dark: { sky: '#b3c4d6', ground: '#2a2724', hemi: 0.95, sun: '#ffe2bc', sunI: 2.5, rim: '#9fb8ff', rimI: 0.7, wood: '#4a3020', woodTop: '#5a3b26', earth: ['#5b4330', '#76593e', '#4a3526', '#684d36'], sea: '#2c5366', seaA: 0.85, ghost: '#d7e6ff', ghostA: 0.3, dim: 0.86 },
} as const;

const tmpM = new Matrix4(), tmpQ = new Quaternion(), tmpQ2 = new Quaternion(), tmpV = new Vector3(), tmpS = new Vector3(1, 1, 1);
const UP = new Vector3(0, 1, 0), XAX = new Vector3(1, 0, 0), ZAX = new Vector3(0, 0, 1);
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

interface ArmyMesh { troop: Troop; mesh: InstancedMesh; figs: number[] }
interface Bearer { fig: number; group: Group }
interface LabelEl { el: HTMLDivElement; pos: Vector3; html: string; on: boolean; cls: string; below?: boolean }

export class BattleScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly stats = { frame: [] as number[], build: 0, triangles: 0, calls: 0 };
  onTime: ((t: number) => void) | null = null;
  onEnd: (() => void) | null = null;
  t = 0;
  playing = false;

  private canvas: HTMLCanvasElement;
  private labelRoot: HTMLElement;
  private plan: BattlePlan;
  private b: BattleJson;
  private board: Board;
  private info: SceneInfo;
  private opts: SceneOpts;
  private theme: Theme;
  private hemi: HemisphereLight;
  private sun: DirectionalLight;
  private rim: DirectionalLight;
  private materials: Material[] = [];
  private geometries: BufferGeometry[] = [];
  private textures: CanvasTexture[] = [];
  private armies: ArmyMesh[][] = [[], []];
  private tFall: Float32Array[] = [];
  private bearers: Bearer[][] = [[], []];
  private standards: Group[] = [];
  private ghostGroup = new Group();
  private ghostDead: { side: 0 | 1; mesh: InstancedMesh; n: number }[] = [];
  private ghostIdx = -1;
  private ghostRects: { x0: number; x1: number; z0: number; z1: number }[] = [];
  private ghostHosts: { side: 0 | 1; group: Group }[] = [];
  private ghostMat: MeshLambertMaterial;
  private terrainMat: MeshLambertMaterial;
  private terrainColors: Float32Array;
  private terrainGeo: BufferGeometry;
  private seaMat: MeshLambertMaterial | null = null;
  private woodMats: MeshLambertMaterial[] = [];
  private labels = new Map<string, LabelEl>();
  private raf = 0;
  private lastT = 0;
  private dirty = true;
  private shadowDirty = true;
  private w = 1;
  private h = 1;
  private speed = 1 / 14; // the whole battle in fourteen seconds
  private fieldY: number;
  private tinctures: [Tinctures, Tinctures];
  private dpr = 1;
  /** The opening view's vertical lens shift (NDC), kept across resizes. */
  private viewShift = 0;
  private frameNo = 0;

  constructor(canvas: HTMLCanvasElement, labelRoot: HTMLElement, plan: BattlePlan, b: BattleJson, board: Board, info: SceneInfo, opts: SceneOpts) {
    const t0 = performance.now();
    this.canvas = canvas;
    this.labelRoot = labelRoot;
    this.plan = plan;
    this.b = b;
    this.board = board;
    this.info = info;
    this.opts = opts;
    this.theme = opts.theme;
    const T = THEME[this.theme];
    this.fieldY = board.heightAt(0, 0);

    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    this.renderer = renderer;
    this.camera = new PerspectiveCamera(30, 1, 0.1, 120);

    // ---- light: a soft studio key from the upper left, a cool rim from behind
    this.hemi = new HemisphereLight(T.sky, T.ground, T.hemi);
    this.sun = new DirectionalLight(T.sun, T.sunI);
    this.sun.position.set(-6.5, 11, 7.5);
    this.sun.castShadow = true;
    const sm = opts.mobile ? 1024 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = -9; sc.right = 9; sc.top = 8; sc.bottom = -8; sc.near = 2; sc.far = 32;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.rim = new DirectionalLight(T.rim, T.rimI);
    this.rim.position.set(5, 4, -9);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.rim);

    // ---- the board
    const { geo: tg, colors } = this.terrainGeometry();
    this.terrainGeo = tg;
    this.terrainColors = colors;
    this.terrainMat = this.mat(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    const terrain = new Mesh(tg, this.terrainMat);
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    this.scene.add(terrain);
    this.buildPlinth();
    this.buildWater();
    this.buildRivers();
    this.buildProps();
    this.buildTown();

    // ---- armies
    this.tinctures = [tincturesOf(b.arms[0]), tincturesOf(b.arms[1])];
    const clash = this.tinctures[0].colour === this.tinctures[1].colour;
    for (const s of [0, 1] as const) {
      const tin = this.tinctures[s];
      // when both states wear the same colour, the defender's men wear its metal
      const pal = paletteFor(plan.armies[s].style, clash && s === 1 ? tin.metal : tin.colour, clash && s === 1 ? tin.colour : tin.metal);
      this.buildArmy(s, pal);
      this.buildStandard(s, pal);
    }
    this.ghostMat = this.mat(new MeshLambertMaterial({ color: T.ghost, transparent: true, opacity: T.ghostA, depthWrite: false, emissive: new Color(T.ghost), emissiveIntensity: this.theme === 'dark' ? 0.35 : 0.15 }));
    this.scene.add(this.ghostGroup);

    // ---- controls
    const c = new OrbitControls(this.camera, canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 0.9;
    c.minDistance = 3;
    c.maxDistance = 40;
    c.maxPolarAngle = 1.36;
    c.minPolarAngle = 0.15;
    c.screenSpacePanning = false;
    c.addEventListener('change', () => { this.dirty = true; });
    this.controls = c;

    this.buildLabels();
    this.stats.build = performance.now() - t0;
    this.setTime(0);
  }

  private mat<M extends Material>(m: M): M { this.materials.push(m); return m; }
  private geom<G extends BufferGeometry>(g: G): G { this.geometries.push(g); return g; }

  // ---------------------------------------------------------------- board
  private terrainGeometry(): { geo: BufferGeometry; colors: Float32Array } {
    const B = this.board;
    const n = B.gx * B.gz;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const c = new Color();
    const dim = THEME[this.theme].dim;
    for (let j = 0; j < B.gz; j++) for (let i = 0; i < B.gx; i++) {
      const v = j * B.gx + i;
      pos[3 * v] = (i / (B.gx - 1) - 0.5) * BOARD_W;
      pos[3 * v + 1] = B.y[v];
      pos[3 * v + 2] = (j / (B.gz - 1) - 0.5) * BOARD_D;
      c.setRGB(B.rgb[3 * v] * dim, B.rgb[3 * v + 1] * dim, B.rgb[3 * v + 2] * dim, SRGBColorSpace);
      col[3 * v] = c.r; col[3 * v + 1] = c.g; col[3 * v + 2] = c.b;
    }
    const idx: number[] = [];
    for (let j = 0; j < B.gz - 1; j++) for (let i = 0; i < B.gx - 1; i++) {
      const a = j * B.gx + i, b2 = a + 1, d = a + B.gx, e = d + 1;
      if ((i + j) % 2) idx.push(a, d, b2, b2, d, e); else idx.push(a, d, e, a, e, b2);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return { geo: this.geom(g), colors: col };
  }

  private baseY(): number { return Math.min(this.board.minY, this.board.seaY - 0.2) - 0.32; }

  private buildPlinth() {
    const B = this.board, T = THEME[this.theme];
    const baseY = this.baseY();
    // the cut edge of the ground: strata from the surface down to the base
    const pos: number[] = [], col: number[] = [];
    const c = new Color();
    const strata = T.earth.map((h) => new Color(h));
    const water = new Color(T.sea);
    const edge = (pts: [number, number, number][]) => {
      for (let k = 0; k < pts.length - 1; k++) {
        const [x0, y0, z0] = pts[k], [x1, y1, z1] = pts[k + 1];
        const rows = 7;
        for (let r = 0; r < rows; r++) {
          const f0 = r / rows, f1 = (r + 1) / rows;
          const ya0 = y0 + (baseY - y0) * f0, ya1 = y0 + (baseY - y0) * f1, yb0 = y1 + (baseY - y1) * f0, yb1 = y1 + (baseY - y1) * f1;
          c.copy(strata[r === 0 ? 0 : 1 + ((r + Math.floor(r / 3)) % 3)]);
          if (r === 0) c.multiplyScalar(0.85);
          pos.push(x0, ya0, z0, x0, ya1, z0, x1, yb0, z1, x1, yb0, z1, x0, ya1, z0, x1, yb1, z1);
          for (let q = 0; q < 6; q++) col.push(c.r, c.g, c.b);
        }
        // water standing above sunken ground at the edge
        if (y0 < B.seaY || y1 < B.seaY) {
          const s0 = Math.max(y0, B.seaY), s1 = Math.max(y1, B.seaY);
          pos.push(x0, s0, z0, x0, y0, z0, x1, s1, z1, x1, s1, z1, x0, y0, z0, x1, y1, z1);
          for (let q = 0; q < 6; q++) col.push(water.r, water.g, water.b);
        }
      }
    };
    const X = (i: number) => (i / (B.gx - 1) - 0.5) * BOARD_W, Z = (j: number) => (j / (B.gz - 1) - 0.5) * BOARD_D;
    const front: [number, number, number][] = [], back: [number, number, number][] = [], left: [number, number, number][] = [], right: [number, number, number][] = [];
    for (let i = 0; i < B.gx; i++) { front.push([X(i), B.y[(B.gz - 1) * B.gx + i], BOARD_D / 2]); back.push([X(B.gx - 1 - i), B.y[B.gx - 1 - i], -BOARD_D / 2]); }
    for (let j = 0; j < B.gz; j++) { right.push([BOARD_W / 2, B.y[(B.gz - 1 - j) * B.gx + B.gx - 1], Z(B.gz - 1 - j)]); left.push([-BOARD_W / 2, B.y[j * B.gx], Z(j)]); }
    edge(front); edge(right); edge(back); edge(left);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    g.computeVertexNormals();
    const skirt = new Mesh(this.geom(g), this.mat(new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })));
    skirt.castShadow = true;
    this.scene.add(skirt);
    // the wooden base, a moulded lip, and a brass plaque on the front
    const wood = this.mat(new MeshLambertMaterial({ color: T.wood }));
    const woodTop = this.mat(new MeshLambertMaterial({ color: T.woodTop }));
    this.woodMats = [wood, woodTop];
    const slab = new Mesh(this.geom(new BoxGeometry(BOARD_W + 0.7, 0.42, BOARD_D + 0.7)), wood);
    slab.position.set(0, baseY - 0.21, 0);
    slab.castShadow = true; slab.receiveShadow = true;
    const lip = new Mesh(this.geom(new BoxGeometry(BOARD_W + 0.36, 0.08, BOARD_D + 0.36)), woodTop);
    lip.position.set(0, baseY + 0.02, 0);
    lip.receiveShadow = true;
    this.scene.add(slab, lip);
    const plaque = plaqueTexture(this.info.title, this.plaqueSub(), this.theme === 'dark');
    this.textures.push(plaque);
    const pm = new Mesh(this.geom(new PlaneGeometry(3.6, 0.5625)), this.mat(new MeshLambertMaterial({ map: plaque })));
    pm.position.set(0, baseY - 0.21, BOARD_D / 2 + 0.351);
    this.scene.add(pm);
    // a small brass compass: north on the board
    const disc = new Mesh(this.geom(new CylinderGeometry(0.2, 0.2, 0.025, 24)), this.mat(new MeshLambertMaterial({ color: '#c9a454' })));
    disc.position.set(BOARD_W / 2 + 0.02, baseY + 0.07, BOARD_D / 2 + 0.02);
    const nx = Math.sin(B.north), nz = -Math.cos(B.north);
    const needle = new Mesh(this.geom(bake([{ g: put(new BoxGeometry(0.035, 0.012, 0.3), 0, 0, 0.0), c: '#3a2810' }, { g: put(new BoxGeometry(0.07, 0.013, 0.07), 0, 0, -0.13, 0, Math.PI / 4, 0), c: '#8e2f1f' }], {} as never)), this.mat(new MeshLambertMaterial({ vertexColors: true })));
    needle.position.set(disc.position.x, baseY + 0.09, disc.position.z);
    needle.rotation.y = Math.atan2(-nx, -nz);
    this.scene.add(disc, needle);
  }

  private plaqueSub(): string {
    const [a, d] = this.info.sides;
    return `${a.name} against ${d.name} · AY ${this.info.year}${this.info.town ? ` · near ${this.info.town.name}` : ''}`;
  }

  private buildWater() {
    if (!this.board.wet.some((x) => x)) return;
    const T = THEME[this.theme];
    this.seaMat = this.mat(new MeshLambertMaterial({ color: T.sea, transparent: true, opacity: T.seaA }));
    const m = new Mesh(this.geom(new PlaneGeometry(BOARD_W, BOARD_D)), this.seaMat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = this.board.seaY;
    m.receiveShadow = true;
    this.scene.add(m);
  }

  private buildRivers() {
    const T = THEME[this.theme];
    for (const rv of this.board.rivers) {
      const pos: number[] = [];
      const p = rv.pts;
      const inside = (x: number, z: number) => Math.abs(x) <= BOARD_W / 2 && Math.abs(z) <= BOARD_D / 2;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const x0 = p[i], z0 = p[i + 1], x1 = p[i + 2], z1 = p[i + 3];
        if (!inside(x0, z0) || !inside(x1, z1)) continue;
        const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1;
        const nx = (-dz / L) * rv.width / 2, nz = (dx / L) * rv.width / 2;
        const y0 = Math.max(this.board.heightAt(x0, z0), this.board.seaY) + 0.012, y1 = Math.max(this.board.heightAt(x1, z1), this.board.seaY) + 0.012;
        pos.push(x0 - nx, y0, z0 - nz, x0 + nx, y0, z0 + nz, x1 - nx, y1, z1 - nz, x1 - nx, y1, z1 - nz, x0 + nx, y0, z0 + nz, x1 + nx, y1, z1 + nz);
      }
      if (!pos.length) continue;
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      g.computeVertexNormals();
      const m = new Mesh(this.geom(g), this.mat(new MeshLambertMaterial({ color: this.theme === 'dark' ? '#3f7894' : '#5d93ad', side: DoubleSide, emissive: new Color(T.sea), emissiveIntensity: 0.12 })));
      m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  private buildProps() {
    const kinds = ['conifer', 'broadleaf', 'bush', 'rock', 'reed'] as const;
    const mat = this.mat(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    for (const k of kinds) {
      const list = this.board.props.filter((p) => p.kind === k);
      if (!list.length) continue;
      const mesh = new InstancedMesh(this.geom(propGeometry(k, this.theme === 'dark')), mat, list.length);
      list.forEach((p, i) => {
        tmpQ.setFromAxisAngle(UP, p.r);
        tmpS.setScalar(p.s * (k === 'conifer' || k === 'broadleaf' ? 1.25 : 1));
        tmpM.compose(tmpV.set(p.x, this.board.heightAt(p.x, p.z) - 0.005, p.z), tmpQ, tmpS);
        mesh.setMatrixAt(i, tmpM);
      });
      tmpS.set(1, 1, 1);
      mesh.castShadow = k === 'conifer' || k === 'broadleaf';
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  private buildTown() {
    const t = this.board.town;
    if (!t || !this.info.town) return;
    const style = this.plan.armies[0].style === this.plan.armies[1].style ? this.plan.armies[0].style : this.plan.armies[1].style;
    const town = buildTown(this.plan.id, style, this.info.town.pop, this.board.heightAt, t.x, t.z);
    const m = new Mesh(this.geom(town.geo), this.mat(new MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    m.castShadow = true;
    m.receiveShadow = true;
    this.scene.add(m);
    this.townTop = town.top;
  }
  private townTop = 0;

  // ---------------------------------------------------------------- armies
  private sideDir(s: 0 | 1) { return s === 0 ? 1 : -1; }

  private buildArmy(s: 0 | 1, pal: Palette) {
    const A = this.plan.armies[s];
    const by = new Map<Troop, number[]>();
    A.figs.forEach((f, i) => { let l = by.get(f.troop); if (!l) by.set(f.troop, (l = [])); l.push(i); });
    const mat = this.mat(new MeshLambertMaterial({ vertexColors: true }));
    for (const [troop, figs] of by) {
      const geo = this.geom(troopGeometry(troop, A.style, pal));
      const mesh = new InstancedMesh(geo, mat, figs.length);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      for (let j = 0; j < figs.length; j++) mesh.setColorAt(j, new Color(1, 1, 1));
      this.scene.add(mesh);
      this.armies[s].push({ troop, mesh, figs });
    }
    // when each figure falls, as a time on the replay's clock
    const tf = new Float32Array(A.figs.length).fill(2);
    A.figs.forEach((f, i) => {
      if (!Number.isFinite(f.fall)) return;
      let lo = 0, hi = 1;
      for (let k = 0; k < 22; k++) { const mid = (lo + hi) / 2; if (tally(this.plan, s, mid) >= f.fall) hi = mid; else lo = mid; }
      tf[i] = hi;
    });
    this.tFall[s] = tf;
    // standard-bearers carry the state's banner
    const tex = bannerTexture(this.b.arms[s], this.tinctures[s], () => { this.dirty = true; });
    this.textures.push(tex);
    const cloth = this.mat(new MeshLambertMaterial({ map: tex, side: DoubleSide }));
    const pole = this.mat(new MeshLambertMaterial({ color: pal.wood }));
    const clothGeo = this.geom(this.wavyCloth(0.085, 0.106, 0.004));
    const poleGeo = this.geom(new CylinderGeometry(0.0022, 0.0022, 0.25, 4));
    A.figs.forEach((f, i) => {
      if (!f.banner) return;
      const g = new Group();
      const p = new Mesh(poleGeo, pole);
      p.position.set(0.02, 0.125, 0.004);
      const c = new Mesh(clothGeo, cloth);
      // the cloth hangs from the pole, across the line of march
      c.position.set(0.02, 0.19, 0.004);
      c.rotation.y = -Math.PI / 2 * this.sideDir(s) * 0 + (s === 0 ? -Math.PI / 2 : Math.PI / 2);
      c.castShadow = true;
      g.add(p, c);
      g.matrixAutoUpdate = false;
      this.scene.add(g);
      this.bearers[s].push({ fig: i, group: g });
    });
  }

  /** A banner cloth: a plane with a gentle wave, hanging from its left edge. */
  private wavyCloth(w: number, h: number, amp: number): BufferGeometry {
    const g = new PlaneGeometry(w, h, 6, 1);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + w / 2;
      p.setX(i, x);
      p.setZ(i, Math.sin((x / w) * Math.PI * 1.6) * amp * (x / w));
    }
    g.computeVertexNormals();
    return g;
  }

  private buildStandard(s: 0 | 1, pal: Palette) {
    const tex = standardTexture(this.b.seals[s], this.b.arms[s], this.tinctures[s], () => { this.dirty = true; });
    this.textures.push(tex);
    const g = new Group();
    const wood = this.mat(new MeshLambertMaterial({ color: '#5a3d26' }));
    const gilt = this.mat(new MeshLambertMaterial({ color: '#d4a640', emissive: new Color('#5a4010'), emissiveIntensity: 0.25 }));
    const pole = new Mesh(this.geom(new CylinderGeometry(0.0045, 0.0055, 0.52, 6)), wood);
    pole.position.set(0, 0.26, 0);
    const bar = new Mesh(this.geom(new CylinderGeometry(0.003, 0.003, 0.2, 5)), wood);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 0.5, 0);
    const finial = new Mesh(this.geom(new CylinderGeometry(0, 0.012, 0.035, 6)), gilt);
    finial.position.set(0, 0.54, 0);
    // a swallow-tailed cloth hanging from the crossbar, facing the viewer's side
    const cg = new PlaneGeometry(0.19, 0.13, 8, 4);
    const p = cg.getAttribute('position'), uv = cg.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      const tail = u > 0.62 ? (u - 0.62) / 0.38 : 0;
      const notch = Math.abs(v - 0.5) < tail * 0.5 ? (tail * 0.5 - Math.abs(v - 0.5)) : 0;
      p.setX(i, p.getX(i) - notch * 0.12);
      p.setZ(i, Math.sin(u * Math.PI * 1.4) * 0.008);
    }
    cg.computeVertexNormals();
    const cloth = new Mesh(this.geom(cg), this.mat(new MeshLambertMaterial({ map: tex, side: DoubleSide })));
    cloth.rotation.z = -Math.PI / 2;
    cloth.position.set(0, 0.4, 0.003);
    cloth.castShadow = true;
    // the commander, mounted, in gilt and the state's colour
    const rider = new Mesh(this.geom(troopGeometry('knight', this.plan.armies[s].style, { ...pal, trim: '#d4a640' })), this.mat(new MeshLambertMaterial({ vertexColors: true })));
    rider.position.set(0.07, 0, 0.05);
    rider.scale.setScalar(1.2);
    rider.castShadow = true;
    g.add(pole, bar, finial, cloth, rider);
    g.traverse((o) => { o.castShadow = true; });
    g.scale.setScalar(FIG);
    this.scene.add(g);
    this.standards[s] = g;
  }

  // ---------------------------------------------------------------- ghosts
  /** Show one document's claims as ghost armies (index into plan.ghosts), or none (-1). */
  setGhost(i: number) {
    if (i === this.ghostIdx) return;
    this.ghostIdx = i;
    for (const o of [...this.ghostGroup.children]) {
      this.ghostGroup.remove(o);
      o.traverse((c) => {
        const m = c as Mesh;
        if (!m.isMesh) return;
        m.geometry?.dispose();
        if (m.material !== this.ghostMat) (m.material as Material).dispose();
      });
    }
    this.ghostDead = [];
    this.ghostHosts = [];
    this.ghostRects = [];
    const g = i >= 0 ? this.plan.ghosts[i] : null;
    if (g) {
      for (const s of [0, 1] as const) {
        if (g.host[s] !== null) this.buildGhostHost(s, g.host[s]!);
        if (g.dead[s] !== null) this.buildGhostDead(s, g.dead[s]!);
      }
    }
    this.applyTime();
  }

  private mainFoot(s: 0 | 1): Troop {
    const foot = this.plan.armies[s].troops.filter(([t]) => !['horse', 'knight', 'chariot', 'cannon', 'gun', 'tank'].includes(t)).sort((a, b) => b[1] - a[1]);
    return foot[0]?.[0] ?? 'spear';
  }

  /** The host a document claims: its footprint drawn on the ground at the army's starting line, and pale figures in
   *  every rank and file beyond the real army's. */
  private buildGhostHost(s: 0 | 1, n: number) {
    const A = this.plan.armies[s];
    const d = this.sideDir(s);
    const [sx, sz] = SPACING.foot;
    const files = Math.max(6, Math.ceil(Math.sqrt((n * 3.1 * sz) / sx)));
    const rows = Math.ceil(n / files);
    const x0 = -d * this.plan.gap;
    const slots: [number, number][] = [];
    for (let k = 0; k < n; k++) {
      const row = Math.floor(k / files), col = k % files;
      const inRow = Math.min(files, n - row * files);
      const lat = (col - (inRow - 1) / 2) * sx;
      const back = row * sz;
      if (Math.abs(lat) <= A.width / 2 + sx * 0.3 && back <= A.depth + sz * 0.3) continue;
      slots.push([back, lat]);
    }
    // the claimed host marches with the real one (but never runs)
    const host = new Group();
    this.ghostGroup.add(host);
    this.ghostHosts.push({ side: s, group: host });
    if (slots.length) {
      const geo = troopGeometry(this.mainFoot(s), A.style, paletteFor(A.style, '#ffffff', '#ffffff'));
      const mesh = new InstancedMesh(geo, this.ghostMat, slots.length);
      slots.forEach(([back, lat], j) => {
        const x = x0 - d * back, z = lat;
        tmpQ.setFromAxisAngle(UP, d > 0 ? Math.PI / 2 : -Math.PI / 2);
        tmpM.compose(tmpV.set(x, this.board.heightAt(x, z), z), tmpQ, tmpS.setScalar(FIG));
        mesh.setMatrixAt(j, tmpM);
      });
      mesh.renderOrder = 2;
      host.add(mesh);
    }
    this.ghostOutline(x0, x0 - d * rows * sz, -files * sx / 2, files * sx / 2, false, host);
  }

  /** The dead a document claims: pale bodies laid where the side's line met the enemy, rank behind rank. */
  private buildGhostDead(s: 0 | 1, n: number) {
    const A = this.plan.armies[s];
    const d = this.sideDir(s);
    const [sx] = SPACING.foot;
    const sz = 0.115 * FIG;
    const files = Math.max(6, Math.round(A.width / sx));
    const xMeet = -d * this.plan.gap + d * frontAt(this.plan, s, PHASE.melee[1]);
    const geo = troopGeometry(this.mainFoot(s), A.style, paletteFor(A.style, '#ffffff', '#ffffff'));
    // the record's own dead lie in the first places; the ghosts are only the dead the document adds
    const real = Math.min(n, A.fallen);
    const mesh = new InstancedMesh(geo, this.ghostMat, Math.max(1, n - real));
    const rows = Math.ceil(n / files);
    for (let k = real; k < n; k++) {
      const row = Math.floor(k / files), col = k % files;
      const lat = (col - (files - 1) / 2) * sx + (unit(`${this.plan.id}:gd:x:${s}:${k}`) - 0.5) * 0.03;
      const back = row * sz + (unit(`${this.plan.id}:gd:z:${s}:${k}`) - 0.5) * 0.04 + 0.02;
      const x = xMeet - d * back, z = lat;
      tmpQ.setFromAxisAngle(UP, (d > 0 ? Math.PI / 2 : -Math.PI / 2) + (unit(`${this.plan.id}:gd:r:${s}:${k}`) - 0.5) * 1.2);
      tmpQ2.setFromAxisAngle(XAX, -Math.PI / 2 + 0.1);
      tmpQ.multiply(tmpQ2);
      tmpM.compose(tmpV.set(x, this.board.heightAt(x, z) + 0.012, z), tmpQ, tmpS.setScalar(FIG));
      mesh.setMatrixAt(k - real, tmpM);
    }
    mesh.count = 0;
    mesh.renderOrder = 2;
    this.ghostGroup.add(mesh);
    this.ghostDead.push({ side: s, mesh, n: n - real });
    this.ghostOutline(xMeet, xMeet - d * (rows * sz + 0.06), -files * sx / 2 - 0.03, files * sx / 2 + 0.03, true);
  }

  /** A dashed rectangle on the ground (x0..x1 across the field, z0..z1 along the line). */
  private ghostOutline(xa: number, xb: number, za: number, zb: number, dead = false, parent: Group = this.ghostGroup) {
    const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), z0 = Math.min(za, zb), z1 = Math.max(za, zb);
    this.ghostRects.push({ x0, x1, z0, z1 });
    const pos: number[] = [];
    const wdt = 0.018;
    const seg = (ax: number, az: number, bx: number, bz: number) => {
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.floor(L / 0.09));
      for (let i = 0; i < n; i += 1) {
        if (i % 2) continue; // dashes
        const t0 = i / n, t1 = Math.min(1, (i + 1) / n);
        const px0 = ax + (bx - ax) * t0, pz0 = az + (bz - az) * t0, px1 = ax + (bx - ax) * t1, pz1 = az + (bz - az) * t1;
        const nx = (-(pz1 - pz0) / (L / n)) * wdt, nz = ((px1 - px0) / (L / n)) * wdt;
        const y0 = this.board.heightAt(px0, pz0) + 0.012, y1 = this.board.heightAt(px1, pz1) + 0.012;
        pos.push(px0 - nx, y0, pz0 - nz, px0 + nx, y0, pz0 + nz, px1 - nx, y1, pz1 - nz, px1 - nx, y1, pz1 - nz, px0 + nx, y0, pz0 + nz, px1 + nx, y1, pz1 + nz);
      }
    };
    seg(x0, z0, x1, z0); seg(x1, z0, x1, z1); seg(x1, z1, x0, z1); seg(x0, z1, x0, z0);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    const m = new Mesh(g, new MeshBasicMaterial({ color: THEME[this.theme].ghost, transparent: true, opacity: dead ? 0.75 : 0.9, depthWrite: false, side: DoubleSide }));
    m.renderOrder = 3;
    parent.add(m);
  }

  // ---------------------------------------------------------------- labels
  private label(key: string, cls: string): LabelEl {
    let l = this.labels.get(key);
    if (!l) {
      const el = document.createElement('div');
      el.className = `bt-lab ${cls}`;
      this.labelRoot.appendChild(el);
      l = { el, pos: new Vector3(), html: '', on: true, cls };
      this.labels.set(key, l);
    }
    return l;
  }
  private setLabel(key: string, html: string, on = true) {
    const l = this.labels.get(key);
    if (!l) return;
    if (l.html !== html) { l.html = html; l.el.innerHTML = html; }
    l.on = on;
  }

  private buildLabels() {
    for (const s of [0, 1] as const) this.label(`army${s}`, `bt-lab--army bt-lab--s${s}`);
    if (this.board.town && this.info.town) {
      const l = this.label('town', 'bt-lab--town');
      l.pos.set(this.board.town.x, this.townTop + 0.12, this.board.town.z);
      this.setLabel('town', `${esc(this.info.town.name)}${this.board.town.far ? ' <i>(further off)</i>' : ''}<span>${this.info.town.pop.toLocaleString('en-US')} people</span>`);
    }
  }

  private placeLabels() {
    const v = new Vector3();
    for (const l of this.labels.values()) {
      if (!l.on || !l.html) { l.el.style.opacity = '0'; continue; }
      v.copy(l.pos).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * this.w, y = (-v.y * 0.5 + 0.5) * this.h;
      const vis = v.z < 1 && x > -40 && x < this.w + 40 && y > -20 && y < this.h + 20;
      l.el.style.opacity = vis ? '1' : '0';
      // keep the label inside the stage
      const w = l.el.offsetWidth;
      const cx = Math.max(6 + w / 2, Math.min(this.w - 6 - w / 2, x));
      l.el.style.transform = `translate(${cx.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, ${l.below ? '10px' : '-100%'})`;
    }
  }

  // ---------------------------------------------------------------- time
  setTime(t: number) {
    this.t = Math.max(0, Math.min(1, t));
    this.applyTime();
  }

  private applyTime() {
    const t = this.t;
    const P = this.plan;
    for (const s of [0, 1] as const) {
      const A = P.armies[s];
      const d = this.sideDir(s);
      const x0 = -d * P.gap;
      const face = d > 0 ? Math.PI / 2 : -Math.PI / 2;
      const tf = this.tFall[s];
      const white = new Color(1, 1, 1), dead = new Color(0.5, 0.45, 0.42);
      const c = new Color();
      const mats = new Map<number, Matrix4>();
      for (const am of this.armies[s]) {
        let colorDirty = false;
        for (let j = 0; j < am.figs.length; j++) {
          const i = am.figs[j];
          const f = A.figs[i];
          const m = this.figMatrix(s, f, i, tf[i], t, x0, d, face);
          am.mesh.setMatrixAt(j, m.matrix);
          if (f.banner) mats.set(i, m.matrix.clone());
          const fallP = m.fall;
          c.copy(white).lerp(dead, fallP);
          am.mesh.getColorAt(j, white2);
          if (Math.abs(white2.r - c.r) > 1e-3) { am.mesh.setColorAt(j, c); colorDirty = true; }
        }
        am.mesh.instanceMatrix.needsUpdate = true;
        if (colorDirty && am.mesh.instanceColor) am.mesh.instanceColor.needsUpdate = true;
      }
      for (const bb of this.bearers[s]) { const mm = mats.get(bb.fig); if (mm) bb.group.matrix.copy(mm); }
      // the commander's standard: behind the centre; falls if the record says the commander was killed
      const st = this.standards[s];
      if (st) {
        const fr = frontAt(P, s, t);
        const fake: Fig = { troop: 'knight', back: A.standard.back, lat: 0, row: 0, fall: Infinity, flee: 0.45, drift: 0, banner: false, yaw: 0 };
        const tFell = P.fell === s ? PHASE.melee[0] + (PHASE.melee[1] - PHASE.melee[0]) * 0.7 : 2;
        const tt = Math.min(t, tFell);
        const [fb, fl] = fleeAt(P, s, fake, tt);
        const x = x0 + d * frontAt(P, s, tt) - d * (A.standard.back + fb);
        const z = A.standard.lat + fl + 0.0;
        void fr;
        st.position.set(x, this.board.heightAt(x, z), z);
        const fallP = smooth(tFell, tFell + 0.03, t);
        st.rotation.set(0, face + (fb > 0.05 ? Math.PI * smooth(0.05, 0.25, fb) : 0), 0);
        st.rotateOnAxis(ZAX, -fallP * 1.35 * d);
      }
      // the army's label rides above its standard
      const l = this.labels.get(`army${s}`);
      if (l && st) {
        l.pos.set(st.position.x, st.position.y + 0.72, st.position.z);
        const lost = Math.round(A.lost * tally(P, s, t));
        const info = this.info.sides[s];
        this.setLabel(`army${s}`, `<b>${esc(info.name)}</b><span class="bt-lab__n">${(A.men - lost).toLocaleString('en-US')} men${lost ? ` <em>−${lost.toLocaleString('en-US')}</em>` : ''}</span>`);
      }
    }
    // the ghosts' dead are counted with the record's
    for (const gd of this.ghostDead) gd.mesh.count = Math.round(gd.n * tally(P, gd.side, t));
    for (const gh of this.ghostHosts) gh.group.position.x = this.sideDir(gh.side) * frontAt(P, gh.side, Math.min(t, PHASE.melee[1]));
    this.dirty = true;
    this.shadowDirty = true;
    this.onTime?.(t);
  }

  private figObj = { matrix: new Matrix4(), fall: 0 };
  /** One figure's matrix at time t (and how far it has fallen, 0..1). */
  private figMatrix(s: 0 | 1, f: Fig, i: number, tFall: number, t: number, x0: number, d: number, face: number) {
    const P = this.plan;
    const tt = Math.min(t, tFall);
    const fr = frontAt(P, s, tt);
    const [fb, fl] = fleeAt(P, s, f, tt);
    const x = x0 + d * fr - d * (f.back + fb);
    const z = f.lat + fl;
    const fall = t >= tFall ? smooth(tFall, tFall + 0.022, t) : 0;
    // a little stir in the ranks while they march and fight
    const march = t > PHASE.advance[0] && t < PHASE.melee[1] && fall === 0 ? Math.abs(Math.sin((t * 90 + i * 0.7))) * 0.006 : 0;
    const turn = fb > 0.04 ? Math.PI * smooth(0.04, 0.22, fb) : 0;
    tmpQ.setFromAxisAngle(UP, face + f.yaw + turn);
    if (fall > 0) {
      const machine = f.troop === 'cannon' || f.troop === 'gun' || f.troop === 'tank' || f.troop === 'chariot';
      tmpQ2.setFromAxisAngle(machine ? ZAX : XAX, machine ? fall * 0.32 * (unit(`${P.id}:${s}:wreck:${i}`) > 0.5 ? 1 : -1) : -fall * (Math.PI / 2 - 0.08));
      tmpQ.multiply(tmpQ2);
    }
    const y = this.board.heightAt(x, z) + march + (fall > 0 && !(f.troop === 'tank') ? fall * 0.01 : 0);
    this.figObj.matrix.compose(tmpV.set(x, y, z), tmpQ, tmpS.setScalar(FIG));
    this.figObj.fall = fall;
    return this.figObj;
  }

  // ---------------------------------------------------------------- play
  play() {
    if (this.t >= 0.999) this.t = 0;
    this.playing = true;
    this.lastT = 0;
    this.dirty = true;
  }
  pause() { this.playing = false; }

  /** The camera's opening pose: from the near side, a little toward the attacker, looking across to the town. */
  home() {
    const aspect = this.w / this.h;
    const portrait = aspect < 1.05;
    // frame both armies (where they start and where they end), the town and the claims; the plinth runs out of
    // frame on a phone (zoom out to see it whole)
    const P = this.plan;
    const pts: Vector3[] = [];
    const rect = (xa: number, xb: number, za: number, zb: number, h = 0.3) => {
      for (const x of [xa, xb]) for (const z of [za, zb]) for (const y of [0, h]) pts.push(new Vector3(Math.max(-BOARD_W / 2, Math.min(BOARD_W / 2, x)), this.board.heightAt(x, z) + y, Math.max(-BOARD_D / 2, Math.min(BOARD_D / 2, z))));
    };
    for (const s of [0, 1] as const) {
      const d = this.sideDir(s), A = P.armies[s];
      const reach = A.standard.back + (P.won === s ? 0 : 0.55 + 1.7 * P.decisive) * 0.85;
      rect(-d * P.gap - d * reach, -d * P.gap + d * frontAt(P, s, 1) + d * P.lead[s], -A.width / 2 - 0.1, A.width / 2 + 0.1, 0.75);
    }
    for (const r of this.ghostRects) rect(r.x0, r.x1, r.z0, r.z1);
    if (this.board.town) rect(this.board.town.x - 0.5, this.board.town.x + 0.5, this.board.town.z - 0.5, this.board.town.z + 0.5, 0.6);
    // the replay bar covers the bottom of the stage: keep the field above it
    const bottom = portrait ? -0.62 : -0.6, top = 0.86, side = portrait ? 0.97 : 0.9;
    const v = new Vector3();
    const place = (polar: number, az: number, tz: number, dist: number) => {
      const target = new Vector3(0, this.fieldY, tz);
      this.camera.position.set(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az)).multiplyScalar(dist).add(target);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      return target;
    };
    const span = () => {
      let a = Infinity, b = -Infinity, ok = true;
      for (const p of pts) {
        v.copy(p).project(this.camera);
        if (v.x < -side || v.x > side || v.z > 1) ok = false;
        a = Math.min(a, v.y); b = Math.max(b, v.y);
      }
      return { ok: ok && b - a <= top - bottom, a, b };
    };
    // the nearest distance at which the frame fits (fitting is monotone in distance)
    const fit = (polar: number, az: number, tz: number) => {
      let lo = 2, hi = 60;
      for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; place(polar, az, tz, mid); if (span().ok) hi = mid; else lo = mid; }
      return hi;
    };
    this.camera.clearViewOffset();
    // the nearest view over a range of tilts, turns and aims, with a gentle preference for the diorama's
    // three-quarter view; on a tall screen the line is turned across the diagonal to use the height
    const prefPolar = portrait ? 0.72 : 0.86, prefAz = portrait ? -0.62 : -0.28;
    let best = { score: Infinity, dist: 10, polar: prefPolar, az: prefAz, tz: 0 };
    const azs = portrait ? [-1.05, -0.85, -0.65, -0.45, -0.28] : [-0.42, -0.28, -0.16];
    for (const az of azs) for (let polar = portrait ? 0.5 : 0.72; polar <= 0.97; polar += 0.06) for (let tz = -2.4; tz <= 1.6; tz += 0.25) {
      const dist = fit(polar, az, tz);
      const score = dist * (1 + Math.abs(polar - prefPolar) * 0.4 + Math.abs(az - prefAz) * 0.25);
      if (score < best.score) best = { score, dist, polar, az, tz };
    }
    const target = place(best.polar, best.az, best.tz, best.dist);
    const { a, b } = span();
    this.viewShift = (a + b) / 2 - (top + bottom) / 2;
    this.camera.setViewOffset(this.w, this.h, 0, Math.round(-this.viewShift * this.h / 2), this.w, this.h);
    this.controls.target.copy(target);
    this.controls.update();
    this.dirty = true;
  }

  start() {
    this.shadowDirty = true;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frame(now: number) {
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 0;
    this.lastT = now;
    const t0 = performance.now();
    if (this.playing) {
      const t = Math.min(1, this.t + dt * this.speed);
      this.setTime(t);
      if (t >= 1) { this.playing = false; this.onEnd?.(); }
    }
    const moved = this.controls.update();
    if (!this.dirty && !moved) return;
    // while the replay runs the shadows follow every other frame (the figures move a hair's breadth a frame)
    if (this.shadowDirty && (!this.playing || (this.frameNo++ & 1) === 0)) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false; }
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    this.dirty = false;
    this.stats.frame.push(performance.now() - t0);
    if (this.stats.frame.length > 600) this.stats.frame.shift();
    this.stats.triangles = this.renderer.info.render.triangles;
    this.stats.calls = this.renderer.info.render.calls;
  }

  /** Draw one frame now (for screenshots and tests). */
  renderNow() {
    this.renderer.shadowMap.needsUpdate = true;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  }

  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    const first = this.w === 1;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, this.opts.mobile ? 2 : 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.camera.aspect = this.w / this.h;
    if (this.camera.view) this.camera.setViewOffset(this.w, this.h, 0, Math.round(-this.viewShift * this.h / 2), this.w, this.h);
    this.camera.updateProjectionMatrix();
    if (first) this.home();
    this.dirty = true;
  }

  setTheme(theme: Theme) {
    if (theme === this.theme) return;
    this.theme = theme;
    const T = THEME[theme];
    this.hemi.color.set(T.sky); this.hemi.groundColor.set(T.ground); this.hemi.intensity = T.hemi;
    this.sun.color.set(T.sun); this.sun.intensity = T.sunI;
    this.rim.color.set(T.rim); this.rim.intensity = T.rimI;
    this.woodMats[0]?.color.set(T.wood); this.woodMats[1]?.color.set(T.woodTop);
    this.seaMat?.color.set(T.sea);
    this.ghostMat.color.set(T.ghost); this.ghostMat.emissive.set(T.ghost); this.ghostMat.opacity = T.ghostA;
    const { colors } = this.terrainGeometry();
    (this.terrainGeo.getAttribute('color') as BufferAttribute).copyArray(colors);
    this.terrainGeo.getAttribute('color').needsUpdate = true;
    const g = this.ghostIdx;
    this.ghostIdx = -2;
    this.setGhost(g);
    this.dirty = true;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.scene.traverse((o: Object3D) => {
      const m = o as Mesh;
      if (m.isMesh) m.geometry?.dispose();
    });
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    for (const l of this.labels.values()) l.el.remove();
    this.renderer.dispose();
  }
}

const white2 = new Color();
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export type { Style };
