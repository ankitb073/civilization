// The studio both museum views share (renderer, soft studio light, an environment for metals), and the turntable
// that shows one object: orbit, zoom, a slow swing, and a raking light that skims the surface so carved and stamped
// text stands out. Renders on demand.
import {
  AmbientLight, Box3, CircleGeometry, Color, CylinderGeometry, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial,
  NeutralToneMapping, PCFShadowMap, PerspectiveCamera, PMREMGenerator, Scene, ShadowMaterial, SRGBColorSpace, Vector3, WebGLRenderer,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Built } from './models.ts';

export type Theme = 'light' | 'dark';

export function makeRenderer(canvas: HTMLCanvasElement, opts: { preserve?: boolean } = {}): WebGLRenderer {
  const r = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
  r.outputColorSpace = SRGBColorSpace;
  r.toneMapping = NeutralToneMapping;
  r.toneMappingExposure = 1.0;
  r.setClearColor(0x000000, 0);
  r.shadowMap.enabled = true;
  r.shadowMap.type = PCFShadowMap;
  return r;
}

const envCache = new WeakMap<WebGLRenderer, Texture>();
export function studioEnv(r: WebGLRenderer): Texture {
  let t = envCache.get(r);
  if (!t) {
    const pm = new PMREMGenerator(r);
    const room = new RoomEnvironment();
    t = pm.fromScene(room, 0.04).texture;
    room.traverse((o) => { const m = o as Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as MeshStandardMaterial).dispose(); } });
    pm.dispose();
    envCache.set(r, t);
  }
  return t;
}

export const PALETTE = {
  light: { dais: '#d5cab4', daisSide: '#c4b89f', shadow: 0.3, hemiSky: '#fff7ea', hemiGround: '#8a7a62', hemi: 0.9, key: 2.6, env: 0.75 },
  dark: { dais: '#2a3039', daisSide: '#1d2229', shadow: 0.45, hemiSky: '#d8e2ee', hemiGround: '#2a2622', hemi: 0.7, key: 2.8, env: 0.6 },
};

export interface TurntableOpts { theme: Theme; reducedMotion: boolean; mobile: boolean }

/** One object on a dais, in soft studio light. */
export class Turntable {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 0.005, 100);
  readonly controls: OrbitControls;
  readonly stats = { frame: [] as number[], render: [] as number[] };
  private key = new DirectionalLight(0xfff3e2, 2.6);
  private rim = new DirectionalLight(0xdde8ff, 0.8);
  private hemi = new HemisphereLight(0xfff7ea, 0x8a7a62, 0.9);
  private amb = new AmbientLight(0xffffff, 0.0);
  private dais: Mesh;
  private daisMat: MeshStandardMaterial;
  private catcher: Mesh;
  private obj: Built | null = null;
  private canvas: HTMLCanvasElement;
  private opts: TurntableOpts;
  private raf = 0;
  private dirty = true;
  private lastT = 0;
  private lastInteract = -1e9;
  private swingT = 0;
  private baseAz = 0;
  private rake = 0;
  private rakeTarget = 0;
  private radius = 1;
  private daisR = 1;
  spin: boolean;
  onChange?: () => void;

  constructor(canvas: HTMLCanvasElement, opts: TurntableOpts) {
    this.canvas = canvas;
    this.opts = opts;
    this.spin = !opts.reducedMotion;
    this.renderer = makeRenderer(canvas);
    this.scene.environment = studioEnv(this.renderer);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(opts.mobile ? 1024 : 2048, opts.mobile ? 1024 : 2048);
    this.key.shadow.radius = 4;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.002;
    this.scene.add(this.key, this.key.target, this.rim, this.hemi, this.amb);
    this.daisMat = new MeshStandardMaterial({ roughness: 0.9 });
    this.dais = new Mesh(new CylinderGeometry(1, 1.02, 1, 96), [this.daisMat, this.daisMat, this.daisMat]);
    this.dais.receiveShadow = true;
    this.scene.add(this.dais);
    this.catcher = new Mesh(new CircleGeometry(1, 64), new ShadowMaterial({ opacity: 0.2 }));
    this.catcher.rotation.x = -Math.PI / 2;
    this.catcher.receiveShadow = true;
    this.scene.add(this.catcher);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.addEventListener('start', () => { this.lastInteract = performance.now(); this.interacting = true; });
    this.controls.addEventListener('end', () => { this.lastInteract = performance.now(); this.interacting = false; this.baseAz = this.controls.getAzimuthalAngle(); this.swingT = 0; });
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.setTheme(opts.theme);
  }
  private interacting = false;

  setTheme(t: Theme) {
    const p = PALETTE[t];
    this.daisMat.color = new Color(p.dais);
    (this.catcher.material as ShadowMaterial).opacity = p.shadow;
    this.hemi.color = new Color(p.hemiSky);
    this.hemi.groundColor = new Color(p.hemiGround);
    this.applyLight();
    this.dirty = true;
  }

  /** Show a built object: frame it, fit the shadow to it. */
  setObject(b: Built) {
    if (this.obj) { this.scene.remove(this.obj.group); disposeBuilt(this.obj); }
    this.obj = b;
    const box = new Box3().setFromObject(b.group);
    const size = box.getSize(new Vector3()), centre = box.getCenter(new Vector3());
    b.group.position.x -= centre.x;
    b.group.position.z -= centre.z;
    const r = Math.hypot(size.x, size.z) * 0.5 * 1.08;
    this.daisR = r;
    const dh = Math.max(0.0015, Math.min(0.05, Math.max(size.x, size.y, size.z) * 0.035));
    this.dais.scale.set(r, dh, r);
    this.dais.position.y = -dh / 2;
    this.catcher.scale.setScalar(r * 6);
    this.catcher.position.y = 0.0005;
    this.scene.add(b.group);
    this.radius = Math.max(size.x, size.y, size.z);
    const R = this.radius;
    const cam = this.key.shadow.camera;
    cam.left = cam.bottom = -R * 1.6; cam.right = cam.top = R * 1.6; cam.near = R * 0.05; cam.far = R * 12;
    cam.updateProjectionMatrix();
    this.key.target.position.set(0, size.y * 0.4, 0);
    this.controls.target.set(0, size.y * 0.44, 0);
    this.controls.minDistance = R * 0.35;
    this.controls.maxDistance = R * 6;
    this.applyLight();
    this.frame(size);
    this.dirty = true;
  }

  get object(): Built | null { return this.obj; }

  /** Put the camera in front, a little above, at a distance that fits the object. */
  frame(size = this.obj ? new Box3().setFromObject(this.obj.group).getSize(new Vector3()) : new Vector3(1, 1, 1)) {
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect || 1;
    const fitH = (size.y + this.daisR * 0.45) / (2 * Math.tan(fov / 2));
    const fitW = Math.max(size.x, size.z * 0.7, this.daisR * 1.6) / (2 * Math.tan(fov / 2) * aspect);
    const d = Math.max(fitH, fitW) * 1.22 + size.z * 0.5;
    const el = 0.2, az = -0.22;
    const t = this.controls.target;
    this.camera.position.set(t.x + Math.sin(az) * Math.cos(el) * d, t.y + Math.sin(el) * d, t.z + Math.cos(az) * Math.cos(el) * d);
    this.camera.near = d / 100; this.camera.far = d * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.baseAz = az;
    this.swingT = 0;
    this.dirty = true;
  }

  setRaking(on: boolean) {
    this.rakeTarget = on ? 1 : 0;
    if (this.opts.reducedMotion) { this.rake = this.rakeTarget; this.applyLight(); }
    this.dirty = true;
  }
  get raking() { return this.rakeTarget > 0.5; }

  private applyLight() {
    const t = this.rake;
    const p = PALETTE[this.opts.theme];
    const R = this.radius;
    const ease = t * t * (3 - 2 * t);
    // normal: high on the left in front; raking: low from the left, skimming every face (they all face +z)
    const n = new Vector3(-1.1, 2.0, 2.1).normalize(), k = new Vector3(-1, 0.13, 0.16).normalize();
    const dir = n.lerp(k, ease).normalize();
    this.key.position.copy(dir.multiplyScalar(R * 4)).add(this.key.target.position);
    this.key.intensity = p.key * (1 + ease * 0.7);
    this.hemi.intensity = p.hemi * (1 - ease * 0.82);
    this.rim.intensity = 0.8 * (1 - ease);
    this.rim.position.set(R * 2.5, R * 2, -R * 3);
    this.scene.environmentIntensity = p.env * (1 - ease * 0.75);
    if (this.obj) for (const m of this.obj.mats) {
      if (!m.normalMap) continue;
      const base = (m.userData.normal as number) ?? 1;
      m.normalScale.set(base * (1 + ease * 0.9), base * (1 + ease * 0.9));
    }
  }

  setSpin(on: boolean) { this.spin = on; this.baseAz = this.controls.getAzimuthalAngle(); this.swingT = 0; this.dirty = true; }

  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  start() {
    const loop = (now: number) => { this.raf = requestAnimationFrame(loop); this.tick(now); };
    this.raf = requestAnimationFrame(loop);
  }

  private tick(now: number) {
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 1 / 60;
    this.lastT = now;
    if (Math.abs(this.rake - this.rakeTarget) > 0.001) {
      this.rake += (this.rakeTarget - this.rake) * Math.min(1, dt * 4);
      if (Math.abs(this.rake - this.rakeTarget) < 0.002) this.rake = this.rakeTarget;
      this.applyLight();
      this.dirty = true;
    }
    // the swing: a slow ±30° turn about the front, once the visitor lets go
    if (this.spin && !this.interacting && now - this.lastInteract > 2500 && this.obj) {
      this.swingT += dt;
      const az = this.baseAz + Math.sin(this.swingT * 0.32) * 0.5;
      const cur = this.controls.getAzimuthalAngle();
      const off = this.camera.position.clone().sub(this.controls.target);
      const rot = az - cur;
      off.applyAxisAngle(new Vector3(0, 1, 0), rot);
      this.camera.position.copy(this.controls.target).add(off);
      this.dirty = true;
    }
    this.controls.update();
    if (!this.dirty) return;
    this.dirty = false;
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.stats.render.push(performance.now() - t0);
    if (this.stats.render.length > 600) this.stats.render.shift();
    this.stats.frame.push(dt * 1000);
    if (this.stats.frame.length > 600) this.stats.frame.shift();
  }

  renderNow() { this.renderer.render(this.scene, this.camera); }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    if (this.obj) disposeBuilt(this.obj);
    this.dais.geometry.dispose();
    this.daisMat.dispose();
    this.catcher.geometry.dispose();
    (this.catcher.material as ShadowMaterial).dispose();
    this.renderer.dispose();
  }
}

export function disposeBuilt(b: Built) {
  b.group.traverse((o) => { const m = o as Mesh; if (m.isMesh) m.geometry.dispose(); });
  for (const m of b.mats) m.dispose();
  for (const t of b.textures) t.dispose();
}
