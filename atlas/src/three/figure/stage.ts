// Where the pieces stand: a small studio (soft key light from the upper left, a cool fill, a rim from behind, a room
// reflected in the gilt) used three ways — a turntable for one piece, a shelf of many, and a portrait camera that
// renders a transparent PNG. Renders on demand: nothing draws while nothing moves.
import {
  Box3, CylinderGeometry, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  NeutralToneMapping, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Raycaster, Scene, ShadowMaterial,
  SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type Object3D, type Texture,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BASE_H, BASE_R, contactShadow, onTextureUpdate, texturesReady } from './base.ts';
import { buildFigure } from './build.ts';
import type { FigureSpec } from './spec.ts';

export type Theme = 'light' | 'dark';
const GROUND_Y = -BASE_H - 0.0006;

function studio(renderer: WebGLRenderer, scene: Scene, mobile: boolean, theme: Theme) {
  const pm = new PMREMGenerator(renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.42;
  const hemi = new HemisphereLight('#fff6e8', '#6b5a45', theme === 'dark' ? 0.5 : 0.6);
  const key = new DirectionalLight('#fff0da', 2.3);
  key.position.set(-1.7, 3.1, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 4;
  const fill = new DirectionalLight('#dbe6ff', 0.55);
  fill.position.set(2.4, 1.3, 1.6);
  const rim = new DirectionalLight('#ffffff', 1.25);
  rim.position.set(0.8, 2.2, -2.6);
  scene.add(hemi, key, key.target, fill, rim);
  const ground = new Mesh(new PlaneGeometry(60, 20), new ShadowMaterial({ opacity: theme === 'dark' ? 0.4 : 0.2 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  ground.receiveShadow = true;
  scene.add(ground);
  return { env, key, hemi, ground };
}

function makeRenderer(canvas: HTMLCanvasElement | undefined, opts: { preserve?: boolean; mobile: boolean }) {
  const r = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance' });
  r.outputColorSpace = SRGBColorSpace;
  r.toneMapping = NeutralToneMapping;
  r.toneMappingExposure = 1.0;
  r.setClearColor(0x000000, 0);
  r.shadowMap.enabled = true;
  r.shadowMap.type = PCFSoftShadowMap;
  return r;
}

/** Fit the key light's shadow camera to a box around [x0, x1]. */
function fitShadow(key: DirectionalLight, cx: number, half: number, top: number) {
  key.target.position.set(cx, 0.4, 0);
  key.position.set(cx - 1.7, 3.1, 2.5);
  const c = key.shadow.camera;
  c.left = -half; c.right = half; c.top = top; c.bottom = -1.0; c.near = 0.5; c.far = 9;
  c.updateProjectionMatrix();
  key.shadow.needsUpdate = true;
}

function disposeTree(o: Object3D) {
  o.traverse((x) => {
    const m = x as Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as MeshBasicMaterial | undefined;
    // the shared paint/metal/gloss materials stay; per-piece printed materials go
    if (mat && (x.name === 'band' || x.name === 'banner' || x.name === 'contact' || x.name === 'pick')) { mat.map?.dispose(); mat.dispose(); }
  });
}

// ---------------------------------------------------------------- one piece on a turntable
export class Turntable {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 1, 0.05, 30);
  readonly controls: OrbitControls;
  private figure: Group | null = null;
  private raf = 0;
  private dirty = true;
  private off: () => void;
  private lights: ReturnType<typeof studio>;
  private visible = true;
  private io: IntersectionObserver | null = null;
  stats = { frames: [] as number[] };
  private canvas: HTMLCanvasElement;
  private opts: { theme: Theme; reducedMotion: boolean; mobile: boolean };

  constructor(canvas: HTMLCanvasElement, opts: { theme: Theme; reducedMotion: boolean; mobile: boolean }) {
    this.canvas = canvas;
    this.opts = opts;
    this.renderer = makeRenderer(canvas, { mobile: opts.mobile });
    this.lights = studio(this.renderer, this.scene, opts.mobile, opts.theme);
    const c = new OrbitControls(this.camera, canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.enablePan = false;
    c.minDistance = 1.4;
    c.maxDistance = 5;
    c.minPolarAngle = 0.55;
    c.maxPolarAngle = 1.62;
    c.autoRotate = !opts.reducedMotion;
    c.autoRotateSpeed = 2.2;
    c.addEventListener('change', () => { this.dirty = true; });
    this.controls = c;
    this.off = onTextureUpdate(() => { this.dirty = true; });
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver((e) => { this.visible = e[0]?.isIntersecting ?? true; if (this.visible) this.dirty = true; });
      this.io.observe(canvas);
    }
  }

  setFigure(g: Group) {
    if (this.figure) { this.scene.remove(this.figure); disposeTree(this.figure); }
    this.figure = g;
    const shadow = contactShadow(this.opts.theme === 'dark' ? 0.55 : 0.35);
    if (shadow) g.add(shadow);
    this.scene.add(g);
    const h = (g.userData.height as number) ?? 1;
    fitShadow(this.lights.key, 0, 0.75, h + 0.3);
    this.controls.target.set(0, (h - BASE_H) * 0.47, 0);
    this.frame();
    this.dirty = true;
  }

  /** Fit the piece in the view (its height, or its base's width on a narrow screen). */
  frame() {
    const h = ((this.figure?.userData.height as number) ?? 1) + BASE_H + 0.12;
    const fov = (this.camera.fov * Math.PI) / 180;
    const byH = h / 2 / Math.tan(fov / 2);
    const byW = (BASE_R * 2 + 0.25) / 2 / Math.tan(fov / 2) / Math.max(0.1, this.camera.aspect);
    const d = Math.max(byH, byW) * 1.06;
    const el = 0.13;
    this.camera.position.set(Math.sin(-0.35) * d * Math.cos(el), this.controls.target.y + d * Math.sin(el), Math.cos(-0.35) * d * Math.cos(el));
    this.controls.update();
  }

  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frame();
    this.dirty = true;
  }

  start() {
    let last = performance.now();
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!this.visible || document.hidden) return;
      const moving = this.controls.update(dt);
      if (moving || this.dirty || this.controls.autoRotate) {
        const t0 = performance.now();
        this.renderer.render(this.scene, this.camera);
        this.stats.frames.push(performance.now() - t0);
        if (this.stats.frames.length > 600) this.stats.frames.shift();
        this.dirty = false;
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  setAutoRotate(on: boolean) { this.controls.autoRotate = on && !this.opts.reducedMotion; this.dirty = true; }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.off();
    this.io?.disconnect();
    this.controls.dispose();
    if (this.figure) disposeTree(this.figure);
    this.lights.env.dispose();
    this.renderer.dispose();
  }
}

// ---------------------------------------------------------------- a shelf of pieces
export interface ShelfItem { spec: FigureSpec; group: Group | null; x: number; proxy: Mesh }
export interface ShelfLabel { i: number; x: number; y: number; on: boolean }

export class Shelf {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(28, 1, 0.05, 60);
  readonly items: ShelfItem[] = [];
  readonly gap: number;
  private lights: ReturnType<typeof studio>;
  private raf = 0;
  private dirty = true;
  private off: () => void;
  private w = 1;
  private h = 1;
  private ray = new Raycaster();
  /** The camera's x (what the user scrolls) and where it is heading. */
  x = 0;
  goal = 0;
  vel = 0;
  selected = -1;
  hover = -1;
  spin = 0;
  onLabels: ((l: ShelfLabel[]) => void) | null = null;
  onSettle: ((x: number) => void) | null = null;
  stats = { frames: [] as number[], builds: [] as number[] };
  private canvas: HTMLCanvasElement;
  private opts: { theme: Theme; reducedMotion: boolean; mobile: boolean; fit?: boolean };

  constructor(canvas: HTMLCanvasElement, specs: FigureSpec[], opts: { theme: Theme; reducedMotion: boolean; mobile: boolean; fit?: boolean }) {
    this.canvas = canvas;
    this.opts = opts;
    this.renderer = makeRenderer(canvas, { mobile: opts.mobile });
    this.lights = studio(this.renderer, this.scene, opts.mobile, opts.theme);
    this.lights.key.shadow.mapSize.set(opts.mobile ? 1024 : 2048, opts.mobile ? 512 : 1024);
    this.gap = 0.86;
    const n = specs.length;
    const len = Math.max(1, n - 1) * this.gap + 1.6;
    // the pieces stand on an endless studio floor that only takes their shadows
    this.lights.ground.scale.set((len + 40) / 60, 1, 1);
    this.lights.ground.position.x = len / 2;
    const proxyGeo = new CylinderGeometry(BASE_R, BASE_R, 1.15, 10);
    proxyGeo.translate(0, 0.5, 0);
    const proxyMat = new MeshBasicMaterial({ visible: false });
    specs.forEach((spec, i) => {
      const proxy = new Mesh(proxyGeo, proxyMat);
      proxy.position.x = i * this.gap;
      proxy.userData.i = i;
      proxy.name = 'pick';
      this.scene.add(proxy);
      this.items.push({ spec, group: null, x: i * this.gap, proxy });
    });
    this.off = onTextureUpdate(() => { this.dirty = true; });
  }

  get count() { return this.items.length; }
  /** How much of the shelf the camera shows across (scene units). */
  get span() { return this.viewWidth(); }
  /** The camera's distance: close enough that a piece fills the height; for a short row, far enough to show it all. */
  private dist() {
    const t = 2 * Math.tan((this.camera.fov * Math.PI) / 360);
    // a phone shows one piece and its neighbours; a wide screen as many as fit at a legible size
    if (this.camera.aspect < 0.9) return 3.0;
    const base = 1.75 / t;
    if (!this.opts.fit) return base;
    // a short row is shown whole; a longer one (a great house) as much of it as stays legible
    return Math.max(base, Math.min(5.4, ((this.count - 1) * this.gap + 0.95) / (t * this.camera.aspect)));
  }
  /** Whether the whole row fits in one view (a house, a handful of people). */
  fits() {
    const t = 2 * Math.tan((this.camera.fov * Math.PI) / 360);
    return this.opts.fit === true && this.camera.aspect >= 0.9 && ((this.count - 1) * this.gap + 0.95) / (t * this.camera.aspect) <= 5.4;
  }
  private viewWidth() {
    const fov = (this.camera.fov * Math.PI) / 180;
    return 2 * Math.tan(fov / 2) * this.dist() * this.camera.aspect;
  }
  clampX(x: number) { return Math.max(0, Math.min((this.count - 1) * this.gap, x)); }

  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.opts.mobile ? 2 : 1.75));
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private place() {
    const d = this.dist();
    const el = 0.15;
    this.camera.position.set(this.x, 0.4 + d * Math.sin(el), d * Math.cos(el));
    this.camera.lookAt(this.x, 0.4, 0);
    fitShadow(this.lights.key, this.x, this.viewWidth() / 2 + 1.2, 1.6);
  }

  /** Build the pieces near the camera first, a few per frame, so the shelf fills without a long stall. */
  private buildSome(budgetMs: number) {
    const want = this.items.map((it, i) => ({ i, d: Math.abs(it.x - this.goal) })).filter((o) => !this.items[o.i].group && o.d < this.viewWidth() * 1.6 + 2).sort((a, b) => a.d - b.d);
    if (!want.length) return;
    const t0 = performance.now();
    for (const o of want) {
      const it = this.items[o.i];
      const t1 = performance.now();
      const g = buildFigure(it.spec);
      this.stats.builds.push(performance.now() - t1);
      g.position.x = it.x;
      const sh = contactShadow(this.opts.theme === 'dark' ? 0.5 : 0.3);
      if (sh) g.add(sh);
      it.group = g;
      this.scene.add(g);
      this.dirty = true;
      this.lights.key.shadow.needsUpdate = true;
      if (performance.now() - t0 > budgetMs) break;
    }
  }

  /** Every piece built (for screenshots and the portrait script). */
  buildAll() { for (const it of this.items) if (!it.group) { const g = buildFigure(it.spec); g.position.x = it.x; const sh = contactShadow(this.opts.theme === 'dark' ? 0.5 : 0.3); if (sh) g.add(sh); it.group = g; this.scene.add(g); } this.dirty = true; }

  go(x: number, instant = false) {
    this.goal = this.fits() ? (this.count - 1) * this.gap / 2 : this.clampX(x);
    if (instant || this.opts.reducedMotion) { this.x = this.goal; this.vel = 0; }
    this.dirty = true;
  }

  select(i: number) {
    if (this.selected >= 0) { const g = this.items[this.selected]?.group; if (g) g.rotation.y = 0; }
    this.selected = i;
    this.spin = 0;
    this.dirty = true;
    this.lights.key.shadow.needsUpdate = true;
  }

  pick(px: number, py: number): number {
    const v = new Vector2((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hit = this.ray.intersectObjects(this.items.map((it) => it.proxy), false)[0];
    return hit ? (hit.object.userData.i as number) : -1;
  }

  start() {
    let last = performance.now();
    let settled = true;
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      // glide toward the goal
      const dx = this.goal - this.x;
      if (Math.abs(dx) > 0.0005) { this.x += dx * (1 - Math.exp(-dt * 9)); this.dirty = true; settled = false; }
      else if (!settled) { this.x = this.goal; settled = true; this.dirty = true; this.onSettle?.(this.x); }
      // the chosen piece turns slowly on its base
      if (this.selected >= 0 && !this.opts.reducedMotion) {
        const g = this.items[this.selected]?.group;
        if (g) { this.spin += dt * 0.6; g.rotation.y = Math.sin(this.spin) * 0.9; this.dirty = true; }
      }
      this.buildSome(this.opts.mobile ? 10 : 14);
      if (!this.dirty) return;
      this.place();
      const t0 = performance.now();
      this.renderer.render(this.scene, this.camera);
      this.stats.frames.push(performance.now() - t0);
      if (this.stats.frames.length > 600) this.stats.frames.shift();
      this.dirty = false;
      this.emitLabels();
    };
    this.raf = requestAnimationFrame(tick);
  }

  private emitLabels() {
    if (!this.onLabels) return;
    const v = new Vector3();
    const out: ShelfLabel[] = [];
    const half = this.viewWidth() / 2 + this.gap;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (Math.abs(it.x - this.x) > half) continue;
      v.set(it.x, GROUND_Y - 0.02, BASE_R * 0.9).project(this.camera);
      out.push({ i, x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h, on: v.x > -1.1 && v.x < 1.1 });
    }
    this.onLabels(out);
  }

  invalidate() { this.dirty = true; }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.off();
    for (const it of this.items) if (it.group) disposeTree(it.group);
    this.lights.env.dispose();
    this.renderer.dispose();
  }
}

// ---------------------------------------------------------------- portraits
let portraitR: WebGLRenderer | null = null;
/** A transparent square portrait of a piece, three-quarter view, with a soft shadow under its base. */
export async function portrait(spec: FigureSpec, size = 512): Promise<string> {
  if (!portraitR) portraitR = makeRenderer(undefined, { preserve: true, mobile: false });
  const r = portraitR;
  r.setPixelRatio(1);
  r.setSize(size, size, false);
  const scene = new Scene();
  const L = studio(r, scene, false, 'light');
  L.ground.material = new ShadowMaterial({ opacity: 0.16 });
  const g = buildFigure(spec);
  const sh = contactShadow(0.3);
  if (sh) g.add(sh);
  g.rotation.y = -0.38;
  scene.add(g);
  const h = (g.userData.height as number) ?? 1;
  fitShadow(L.key, 0, 0.8, h + 0.3);
  await texturesReady();
  const cam = new PerspectiveCamera(26, 1, 0.05, 30);
  const box = new Box3().setFromObject(g);
  const top = box.max.y, bottom = -BASE_H;
  const midY = (top + bottom) / 2;
  const fov = (cam.fov * Math.PI) / 180;
  const d = ((top - bottom) / 2 + 0.05) / Math.tan(fov / 2) + 0.2;
  const el = 0.12;
  cam.position.set(0, midY + Math.sin(el) * d, Math.cos(el) * d);
  cam.lookAt(0, midY, 0);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  disposeTree(g);
  L.env.dispose();
  return url;
}

export type { Texture };
