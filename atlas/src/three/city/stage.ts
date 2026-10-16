// Cities in 3D: the stage for #/city — renderer, soft studio light, a turntable camera and the label layer.
// The model is built in lots and shown on a plinth of constant size: as the town outgrows its plinth, the model
// is eased down to fit (so a village and a megacity both fill the frame, and the camera never has to chase it).

import {
  DirectionalLight, Group, HemisphereLight, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CityModel } from './model.ts';

export type Theme = 'light' | 'dark';
export const DISPLAY_R = 10;

export interface StageOpts { theme: Theme; reducedMotion: boolean; mobile: boolean }
export interface Pose { az: number; polar: number; dist: number; tx: number; tz: number }

const LIGHT = {
  light: { sky: 0xfff6e6, ground: 0x8a7860, hemi: 1.15, sun: 0xfff0d6, sunI: 2.5 },
  dark: { sky: 0xa9bbd2, ground: 0x24211f, hemi: 0.58, sun: 0xffdcb0, sunI: 2.05 },
};

interface Lab { el: HTMLDivElement; key: string; text: string; o: number }

export class CityStage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly holder = new Group();
  model: CityModel | null = null;
  /** CPU ms per render, intervals between frames, ms per year rebuild (for the probes). */
  readonly stats = { render: [] as number[], frame: [] as number[], build: [] as number[] };
  private sun: DirectionalLight;
  private hemi: HemisphereLight;
  private opts: StageOpts;
  private raf = 0;
  private dirty = true;
  private lastT = 0;
  private scale = 1;
  private scaleTarget = 1;
  private labelsRoot: HTMLElement;
  private labs = new Map<string, Lab>();
  private w = 1;
  private h = 1;
  private t0 = performance.now();
  private lastInteract = -1e9;
  spin: boolean;
  showLabels = true;

  constructor(canvas: HTMLCanvasElement, labelsRoot: HTMLElement, opts: StageOpts) {
    this.opts = opts;
    this.labelsRoot = labelsRoot;
    this.spin = !opts.reducedMotion;
    const r = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    r.outputColorSpace = SRGBColorSpace;
    r.setClearColor(0x000000, 0);
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.mobile ? 2 : 2));
    this.renderer = r;
    this.camera = new PerspectiveCamera(30, 1, 0.5, 400);
    this.scene.add(this.holder);

    this.hemi = new HemisphereLight(0xffffff, 0x888888, 1);
    this.sun = new DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    const sm = opts.mobile ? 1536 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = -12.5; sc.right = 12.5; sc.top = 12.5; sc.bottom = -12.5; sc.near = 1; sc.far = 80;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.setSunAz(0.6);

    const c = new OrbitControls(this.camera, canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 0.9;
    c.minDistance = 5;
    c.maxDistance = 90;
    c.minPolarAngle = 0.12;
    c.maxPolarAngle = 1.36;
    c.screenSpacePanning = false;
    c.autoRotateSpeed = 0.35;
    c.addEventListener('change', () => { this.dirty = true; });
    c.addEventListener('start', () => { this.lastInteract = performance.now(); c.autoRotate = false; });
    c.addEventListener('end', () => { this.lastInteract = performance.now(); });
    this.controls = c;
    this.setTheme(opts.theme);
  }

  /** The sun sits up and to the left of where the camera first looks from. */
  setSunAz(camAz: number) {
    const az = camAz + 1.05, el = 0.92;
    this.sun.position.set(Math.sin(az) * Math.cos(el) * 40, Math.sin(el) * 40, Math.cos(az) * Math.cos(el) * 40);
    this.sun.target.position.set(0, 0, 0);
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }

  setTheme(t: Theme) {
    this.opts.theme = t;
    const L = LIGHT[t];
    this.hemi.color.set(L.sky); this.hemi.groundColor.set(L.ground); this.hemi.intensity = L.hemi;
    this.sun.color.set(L.sun); this.sun.intensity = L.sunI;
    this.model?.setTheme(t);
    this.dirty = true;
  }

  setModel(m: CityModel) {
    if (this.model) { this.holder.remove(this.model.group); this.model.dispose(); }
    this.model = m;
    this.holder.add(m.group);
    m.setTheme(this.opts.theme);
    for (const l of this.labs.values()) l.el.remove();
    this.labs.clear();
  }

  /** Rebuild the model for a year (now when `instant`, else on the next frame that has room); the plinth eases to its new size. */
  setYear(y: number, instant = false) {
    if (!instant) { this.pending = y; this.dirty = true; return; }
    this.pending = null;
    this.rebuild(y, true);
  }
  private pending: number | null = null;
  private lastBuild = 0;
  private lastBuildAt = 0;
  private rebuild(y: number, instant: boolean) {
    const m = this.model;
    if (!m) return;
    const t0 = performance.now();
    this.lastBuildAt = t0;
    if (!m.setYear(y)) return;
    this.lastBuild = performance.now() - t0;
    this.stats.build.push(this.lastBuild);
    if (this.stats.build.length > 240) this.stats.build.shift();
    this.scaleTarget = DISPLAY_R / m.P;
    if (instant || this.opts.reducedMotion) { this.scale = this.scaleTarget; this.holder.scale.setScalar(this.scale); }
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }

  homePose(): Pose {
    const m = this.model;
    const coast = m?.L.coast;
    // a port is seen from the water, its harbour in front; a river town across its river; else from the south-east
    let az = 0.55;
    if (coast) az = Math.atan2(coast.cx, coast.cz) + 0.95;
    else if (m?.L.river) az = Math.atan2(m.L.river.nx, m.L.river.nz) + 0.5;
    // fit the plinth: its depth (foreshortened) to the height, its width to the width
    // tall screens look down more steeply and may crop the plinth's rim a little, to give the town the room
    const aspect = this.w / Math.max(1, this.h);
    const t = Math.tan((this.camera.fov * Math.PI) / 360);
    const tall = aspect < 0.85;
    const dist = Math.max((DISPLAY_R * 0.86) / t, (DISPLAY_R * (tall ? 0.94 : 1.1)) / (t * aspect));
    return { az, polar: tall ? 0.8 : 0.98, dist, tx: 0, tz: 0 };
  }

  setPose(p: Pose) {
    const c = this.camera;
    const t = new Vector3(p.tx, 0.6, p.tz);
    c.position.set(t.x + Math.sin(p.az) * Math.sin(p.polar) * p.dist, t.y + Math.cos(p.polar) * p.dist, t.z + Math.cos(p.az) * Math.sin(p.polar) * p.dist);
    this.controls.target.copy(t);
    c.lookAt(t);
    this.controls.update();
    this.dirty = true;
  }

  resize() {
    const el = this.renderer.domElement;
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.applyView();
  }

  /** Shift the model left by half of `px` (room for a side panel on the right). */
  setOffset(px: number) {
    this.offset = Math.max(0, Math.round(px));
    this.applyView();
  }
  private offset = 0;
  private applyView() {
    const { w, h, offset: o } = this;
    this.camera.aspect = (w + o) / h;
    if (o > 0) this.camera.setViewOffset(w + o, h, o, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  start() {
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }

  /** Turn slowly when idle (never with reduced motion). */
  setSpin(v: boolean) { this.spin = v && !this.opts.reducedMotion; if (!this.spin) this.controls.autoRotate = false; this.dirty = true; }

  private frame(now: number) {
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 1 / 60;
    if (this.lastT) { this.stats.frame.push(now - this.lastT); if (this.stats.frame.length > 240) this.stats.frame.shift(); }
    this.lastT = now;
    const c = this.controls;
    c.autoRotate = this.spin && now - this.lastInteract > 6000;
    c.update(dt);
    if (Math.abs(this.scale - this.scaleTarget) > 1e-4) {
      this.scale += (this.scaleTarget - this.scale) * (1 - Math.exp(-dt * 5));
      if (Math.abs(this.scale - this.scaleTarget) < 1e-3) this.scale = this.scaleTarget;
      this.holder.scale.setScalar(this.scale);
      this.renderer.shadowMap.needsUpdate = true;
      this.dirty = true;
    }
    // a slow rebuild (a big city on a slow phone) gets every other frame, so turning the model stays smooth
    if (this.pending !== null && now - this.lastBuildAt > (this.lastBuild > 7 ? 30 : 0)) {
      const y = this.pending;
      this.pending = null;
      this.rebuild(y, false);
    }
    const m = this.model;
    if (m && m.smoke.length && !this.opts.reducedMotion) { m.puffsAt((now - this.t0) / 1000); this.dirty = true; }
    if (!this.dirty) return;
    this.dirty = false;
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.labels(dt);
    this.stats.render.push(performance.now() - t0);
    if (this.stats.render.length > 240) this.stats.render.shift();
  }

  /** Render now (for screenshots). */
  renderNow() { this.dirty = true; this.frame(performance.now()); }

  private labels(dt: number) {
    const m = this.model;
    const root = this.labelsRoot;
    const want = new Set<string>();
    const placed: [number, number, number, number][] = [];
    if (m && this.showLabels) {
      m.group.updateMatrixWorld();
      const v = new Vector3();
      for (const a of m.anchors) {
        const key = `${a.key}`;
        v.set(a.x, a.y, a.z).applyMatrix4(m.group.matrixWorld).project(this.camera);
        if (v.z > 1 || v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) continue;
        let l = this.labs.get(key);
        const text = `${a.kicker} · ${a.text}`;
        if (!l) {
          const el = document.createElement('div');
          el.className = `c3d-lab c3d-lab--${a.key}`;
          el.style.opacity = '0';
          root.appendChild(el);
          l = { el, key, text: '', o: 0 };
          this.labs.set(key, l);
        }
        if (l.text !== text) {
          l.el.replaceChildren();
          const k = document.createElement('span'); k.className = 'c3d-lab__k'; k.textContent = a.kicker;
          const t = document.createElement('span'); t.className = 'c3d-lab__t'; t.textContent = a.text;
          l.el.append(k, t);
          l.text = text;
        }
        const x = (v.x * 0.5 + 0.5) * this.w, y = (-v.y * 0.5 + 0.5) * this.h;
        const w = l.el.offsetWidth, h = l.el.offsetHeight;
        const bx = Math.max(4, Math.min(this.w - w - 4, x - w / 2)), by = Math.max(4, y - h - 6);
        if (placed.some((r) => bx < r[0] + r[2] && bx + w > r[0] && by < r[1] + r[3] && by + h > r[1])) continue;
        placed.push([bx - 4, by - 2, w + 8, h + 4]);
        l.el.style.transform = `translate3d(${bx.toFixed(1)}px,${by.toFixed(1)}px,0)`;
        want.add(key);
      }
    }
    for (const l of this.labs.values()) {
      const target = want.has(l.key) ? 1 : 0;
      l.o += (target - l.o) * Math.min(1, dt * 10 + (this.opts.reducedMotion ? 1 : 0));
      if (Math.abs(l.o - target) < 0.02) l.o = target;
      l.el.style.opacity = l.o.toFixed(3);
      if (l.o > 0 && l.o < 1) this.dirty = true;
    }
  }

  dispose() {
    this.stop();
    this.controls.dispose();
    if (this.model) { this.holder.remove(this.model.group); this.model.dispose(); this.model = null; }
    for (const l of this.labs.values()) l.el.remove();
    this.labs.clear();
    this.renderer.dispose();
  }
}
