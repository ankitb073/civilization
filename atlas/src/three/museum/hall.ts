// The Museum's hall (#/museum): a rotunda with the celebrated documents on plinths around its wall, oldest first,
// each facing the centre, under the era painted on the wall above it. The visitor stands inside and turns from one
// object to the next (drag, arrows, or a tap), or steps back for an overview. Objects are built from their records
// one at a time after the room appears, nearest first, in low detail; the one in front of the visitor is rebuilt
// sharper once they stop. Renders on demand.
import {
  BoxGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, SpotLight, Group, HemisphereLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, PointLight, Raycaster, RingGeometry, Scene, SRGBColorSpace, Vector2, Vector3, BackSide,
  Box3, type Object3D, type WebGLRenderer,
} from 'three';
import type { ArmsSpec, PageJson, SigilSpec } from '../../../../engine/src/export/contract.ts';
import { buildObject, type Built } from './models.ts';
import { disposeBuilt, makeRenderer, studioEnv, type Theme } from './stage.ts';
import { imagesFor } from './load.ts';
import { canvas, ctxOf, ensureFonts, SANS, SERIF, fbm, speckle } from './paint.ts';
import type { ObjectSpec } from './record.ts';

export interface HallEntry { spec: ObjectSpec; why: string; page: PageJson; arms: Record<string, ArmsSpec>; sigil?: SigilSpec; era: string; eraIdx: number }

interface Slot {
  e: HallEntry;
  angle: number;
  big: boolean;
  plinth: Mesh;
  plinthH: number;
  plaque: Mesh;
  holder: Group;
  built: Built | null;
  detail: 'low' | 'mid' | null;
  scale: number;
  top: number;
  width: number;
}

const BIG = new Set(['stele', 'rock', 'slab']);
const THEME = {
  light: { wall: '#e4dac6', dado: '#c9bca2', floor: '#d6cbb6', floor2: '#c8bba2', plinth: '#efe9dd', ink: '#3a2e22', accent: '#8e2f1f', hemiSky: '#fff6e6', hemiGround: '#7a6a52', hemi: 0.62, lamp: 34, spot: 26, env: 0.42 },
  dark: { wall: '#252c35', dado: '#1a1f26', floor: '#1c2128', floor2: '#232a33', plinth: '#39414c', ink: '#e8dcc4', accent: '#e08a6c', hemiSky: '#c8d3e0', hemiGround: '#1d1b19', hemi: 0.42, lamp: 26, spot: 30, env: 0.36 },
};

export interface HallOpts { theme: Theme; reducedMotion: boolean; mobile: boolean }

export class Hall {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(42, 1, 0.05, 80);
  readonly slots: Slot[] = [];
  readonly stats = { frame: [] as number[], render: [] as number[] };
  readonly buildMs: number[] = [];
  built = 0;
  done = false;
  /** the object in front of the visitor (continuous while turning) */
  f = 0;
  private fTarget = 0;
  overview = false;
  private ovAngle = 0;
  private R: number;
  private step: number;
  private canvas: HTMLCanvasElement;
  private opts: HallOpts;
  private raf = 0;
  private dirty = true;
  private lastT = 0;
  private camPos = new Vector3();
  private camTgt = new Vector3();
  private settled = 0;
  private queue: number[] = [];
  private building = false;
  private mids: number[] = [];
  private disposed = false;
  private lamp: PointLight;
  private spot: SpotLight;
  private spotAt = -1;
  private plinthMat?: MeshStandardMaterial;
  private footMat?: MeshStandardMaterial;
  private hemi: HemisphereLight;
  private mats: MeshStandardMaterial[] = [];
  private textures: CanvasTexture[] = [];
  private ray = new Raycaster();
  onFocus?: (i: number) => void;
  onProgress?: (built: number, total: number) => void;
  private lastFocus = -1;

  constructor(canvasEl: HTMLCanvasElement, entries: HallEntry[], opts: HallOpts, start = 0) {
    this.canvas = canvasEl;
    this.opts = opts;
    this.renderer = makeRenderer(canvasEl);
    this.renderer.shadowMap.autoUpdate = false;
    this.scene.environment = studioEnv(this.renderer);
    const n = entries.length;
    this.step = (Math.PI * 2) / (n + 1.5);
    this.R = Math.max(5, (1.5 * (n + 1.5)) / (Math.PI * 2));
    const P = THEME[opts.theme];
    this.scene.environmentIntensity = P.env;
    this.hemi = new HemisphereLight(P.hemiSky, P.hemiGround, P.hemi);
    this.lamp = new PointLight(0xfff1dc, P.lamp, 0, 2);
    this.lamp.position.set(0, 4.8, 0);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(opts.mobile ? 512 : 1024, opts.mobile ? 512 : 1024);
    this.lamp.shadow.bias = -0.003;
    this.lamp.shadow.radius = 3;
    this.lamp.shadow.camera.near = 0.5;
    this.lamp.shadow.camera.far = this.R * 3;
    this.scene.add(this.hemi, this.lamp);
    // a spotlight on the object in front of the visitor
    this.spot = new SpotLight(0xfff0dc, P.spot, 0, 0.42, 0.55, 1.6);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(opts.mobile ? 512 : 1024, opts.mobile ? 512 : 1024);
    this.spot.shadow.bias = -0.0015;
    this.spot.shadow.radius = 4;
    this.scene.add(this.spot, this.spot.target);
    this.room(P);
    entries.forEach((e, i) => this.slots.push(this.slot(e, i, P)));
    this.eraLabels(entries, P);
    this.f = this.fTarget = Math.max(0, Math.min(n - 1, start));
    this.snapCamera();
    this.queue = this.order(this.f);
    this.renderer.shadowMap.needsUpdate = true;
  }

  // ---------------------------------------------------------------- the room
  private tex(cv: HTMLCanvasElement, srgb = true): CanvasTexture {
    const t = new CanvasTexture(cv);
    if (srgb) t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    this.textures.push(t);
    return t;
  }
  private mat(o: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial {
    const m = new MeshStandardMaterial(o);
    this.mats.push(m);
    return m;
  }

  private room(P: (typeof THEME)['light']) {
    const R = this.R, RW = R + 2.0;
    // the floor: stone slabs in rings, an inlaid star at the centre
    const N = this.opts.mobile ? 1024 : 2048;
    const cv = canvas(N, N), c = ctxOf(cv);
    c.fillStyle = P.floor; c.fillRect(0, 0, N, N);
    fbm(c, 'floor', N / 6, 4, 0.08, 'overlay');
    const k = N / 2 / RW;
    const cx = N / 2;
    c.strokeStyle = 'rgba(0,0,0,0.08)'; c.lineWidth = Math.max(1, N / 1200);
    for (let r = 1.2; r < RW; r += 1.2) { c.beginPath(); c.arc(cx, cx, r * k, 0, Math.PI * 2); c.stroke(); }
    for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; c.beginPath(); c.moveTo(cx + Math.cos(a) * 1.2 * k, cx + Math.sin(a) * 1.2 * k); c.lineTo(cx + Math.cos(a) * RW * k, cx + Math.sin(a) * RW * k); c.stroke(); }
    // the plinths' path: a darker band
    c.strokeStyle = P.floor2; c.lineWidth = 1.5 * k; c.beginPath(); c.arc(cx, cx, R * k, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = Math.max(1, N / 900);
    for (const rr of [R - 0.75, R + 0.75]) { c.beginPath(); c.arc(cx, cx, rr * k, 0, Math.PI * 2); c.stroke(); }
    // an eight-pointed star of brass at the centre
    c.save(); c.translate(cx, cx);
    c.fillStyle = this.opts.theme === 'dark' ? 'rgba(200,170,100,0.35)' : 'rgba(150,110,40,0.28)';
    c.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, rr = (i % 2 ? 0.35 : 1.0) * 1.0 * k; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    c.closePath(); c.fill();
    c.strokeStyle = c.fillStyle; c.lineWidth = Math.max(1, N / 800);
    c.beginPath(); c.arc(0, 0, 1.15 * k, 0, Math.PI * 2); c.stroke();
    c.restore();
    speckle(c, 'floor', 2400, N / 900, '#000', 0.05);
    const floor = new Mesh(new CircleGeometry(RW, 96), this.mat({ map: this.tex(cv), roughness: 0.82, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // the wall, a dado and a cornice
    const wall = new Mesh(new CylinderGeometry(RW, RW, 4.6, 96, 1, true), this.mat({ color: new Color(P.wall), roughness: 0.95, side: BackSide }));
    wall.position.y = 2.3;
    wall.receiveShadow = true;
    const dado = new Mesh(new CylinderGeometry(RW - 0.02, RW - 0.02, 0.32, 96, 1, true), this.mat({ color: new Color(P.dado), roughness: 0.9, side: BackSide }));
    dado.position.y = 0.16;
    const cornice = new Mesh(new CylinderGeometry(RW - 0.05, RW - 0.05, 0.14, 96, 1, true), this.mat({ color: new Color(P.dado), roughness: 0.9, side: BackSide }));
    cornice.position.y = 4.1;
    this.scene.add(wall, dado, cornice);
    // a ring in the floor under the lamp, where the visitor stands
    const ring = new Mesh(new RingGeometry(1.15, 1.2, 64), this.mat({ color: new Color(P.dado), roughness: 0.6 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    this.scene.add(ring);
  }

  private angleOf(i: number): number {
    // the entrance gap is behind the first visitor's back; the chronology runs clockwise from the left of it
    return Math.PI / 2 + this.step * 0.75 + i * this.step;
  }

  private slot(e: HallEntry, i: number, P: (typeof THEME)['light']): Slot {
    const angle = this.angleOf(i);
    const big = BIG.has(e.spec.family) || (e.spec.family === 'plaster' && /statue|column/.test(e.spec.medium));
    const plinthH = big ? 0.12 : 0.92;
    const pw = big ? Math.max(0.5, Math.min(1.9, e.spec.dims[0] * 1.15)) : 0.66;
    const pd = big ? Math.max(0.5, e.spec.dims[2] * 2.4) : 0.66;
    const pmat = this.plinthMat ??= this.mat({ color: new Color(P.plinth), roughness: 0.8 });
    const fmat = this.footMat ??= this.mat({ color: new Color(P.dado), roughness: 0.85 });
    const plinth = new Mesh(new BoxGeometry(pw, plinthH - 0.06, pd), pmat);
    const cx = Math.cos(angle) * this.R, cz = Math.sin(angle) * this.R;
    const rotY = Math.atan2(-Math.cos(angle), -Math.sin(angle));
    plinth.position.set(cx, 0.06 + (plinthH - 0.06) / 2, cz);
    plinth.rotation.y = rotY;
    plinth.castShadow = plinth.receiveShadow = true;
    plinth.userData.slot = i;
    const foot = new Mesh(new BoxGeometry(pw - 0.04, 0.06, pd - 0.04), fmat);
    foot.position.set(cx, 0.03, cz);
    foot.rotation.y = rotY;
    foot.receiveShadow = true;
    const cap = new Mesh(new BoxGeometry(pw + 0.03, 0.025, pd + 0.03), pmat);
    cap.position.set(cx, plinthH - 0.0125, cz);
    cap.rotation.y = rotY;
    cap.castShadow = cap.receiveShadow = true;
    cap.userData.slot = i;
    this.scene.add(plinth, foot, cap);
    // a label on the plinth's face (for a low plinth, a small stand in front of it)
    const plaque = this.plaque(e, P);
    const g = new Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = rotY;
    if (big) {
      const post = new Mesh(new BoxGeometry(0.03, 0.62, 0.03), this.mat({ color: new Color(P.dado), roughness: 0.7 }));
      post.position.set(pw / 2 + 0.22, 0.31, pd / 2 + 0.25);
      plaque.position.set(pw / 2 + 0.22, 0.66, pd / 2 + 0.27);
      plaque.rotation.x = -0.75;
      post.userData.slot = i;
      g.add(post);
    } else {
      plaque.position.set(0, plinthH * 0.72, pd / 2 + 0.003);
    }
    plaque.userData.slot = i;
    g.add(plaque);
    this.scene.add(g);
    const holder = new Group();
    holder.position.set(cx, plinthH, cz);
    holder.rotation.y = rotY;
    this.scene.add(holder);
    return { e, angle, big, plinth, plinthH, plaque, holder, built: null, detail: null, scale: 1, top: plinthH + (big ? e.spec.dims[1] : 0.5), width: big ? e.spec.dims[0] : 0.66 };
  }

  private plaque(e: HallEntry, P: (typeof THEME)['light']): Mesh {
    const W = 512, H = 200;
    const cv = canvas(W, H), c = ctxOf(cv);
    c.fillStyle = this.opts.theme === 'dark' ? '#2b323c' : '#fbf8f1'; c.fillRect(0, 0, W, H);
    c.fillStyle = P.accent;
    c.font = `700 22px ${SANS}`;
    c.fillText(e.era.toUpperCase(), 24, 40);
    c.fillStyle = P.ink;
    c.font = `500 56px ${SERIF}`;
    c.fillText(e.page.t0 < 0 ? `${-e.page.t0} BAY` : `AY ${e.page.t0}`, 22, 102);
    c.font = `500 26px ${SERIF}`;
    const words = e.page.title.split(' ');
    let line = '', y = 140;
    for (const w of words) {
      if (c.measureText(line + w).width > W - 44) { c.fillText(line.trim(), 24, y); y += 30; line = ''; if (y > 180) break; }
      line += w + ' ';
    }
    if (y <= 180) c.fillText(line.trim(), 24, y);
    const m = new Mesh(new PlaneGeometry(0.34, 0.133), this.mat({ map: this.tex(cv), roughness: 0.7 }));
    return m;
  }

  private eraLabels(entries: HallEntry[], P: (typeof THEME)['light']) {
    const RW = this.R + 2.0;
    let i = 0;
    while (i < entries.length) {
      let j = i;
      while (j + 1 < entries.length && entries[j + 1].eraIdx === entries[i].eraIdx) j++;
      const mid = (this.angleOf(i) + this.angleOf(j)) / 2;
      const span = Math.max(1, j - i + 1) * this.step * RW;
      const w = Math.min(span * 0.92, 5.2);
      const cv = canvas(1024, 100), c = ctxOf(cv);
      c.fillStyle = P.ink;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `500 64px ${SERIF}`;
      const name = entries[i].era;
      const sz = Math.min(64, (1000 / Math.max(1, c.measureText(name).width)) * 64);
      c.font = `500 ${sz}px ${SERIF}`;
      c.fillText(name, 512, 52);
      const m = new Mesh(new PlaneGeometry(w, w * (100 / 1024)), this.mat({ map: this.tex(cv), transparent: true, roughness: 1, depthWrite: false, opacity: 0.86 }));
      // a flat label against a curved wall: stand it off by the wall's sagitta over its width
      const r = RW - (w * w) / (8 * RW) - 0.06;
      m.position.set(Math.cos(mid) * r, 2.6, Math.sin(mid) * r);
      m.rotation.y = Math.atan2(-Math.cos(mid), -Math.sin(mid));
      this.scene.add(m);
      i = j + 1;
    }
  }

  // ---------------------------------------------------------------- building the objects
  private order(f: number): number[] {
    const n = this.slots.length;
    const c = Math.round(f);
    return this.slots.map((_, i) => i).filter((i) => !this.slots[i].built).sort((a, b) => Math.min(Math.abs(a - c), n - Math.abs(a - c)) - Math.min(Math.abs(b - c), n - Math.abs(b - c)));
  }

  /** Build the next object in the queue; returns false when there is nothing left. */
  private async buildNext(): Promise<boolean> {
    if (this.building || this.disposed) return true;
    const i = this.queue.shift();
    if (i === undefined) return false;
    this.building = true;
    try {
      await this.place(i, 'low');
    } finally {
      this.building = false;
    }
    return true;
  }

  private async place(i: number, detail: 'low' | 'mid') {
    const sl = this.slots[i];
    await ensureFonts();
    const imgs = await imagesFor(sl.e.spec);
    if (this.disposed) return;
    const t0 = performance.now();
    const b = buildObject(sl.e.spec, imgs, { detail, scale: detail === 'mid' ? 0.5 : this.opts.mobile ? 0.19 : 0.25 });
    if (detail === 'low') this.buildMs.push(performance.now() - t0);
    if (this.disposed) { disposeBuilt(b); return; }
    if (sl.built) { sl.holder.remove(sl.built.group); disposeBuilt(sl.built); } else { this.built++; this.onProgress?.(this.built, this.slots.length); }
    sl.built = b;
    sl.detail = detail;
    const box = new Box3().setFromObject(b.group);
    const size = box.getSize(new Vector3());
    const scale = sl.big ? 1 : Math.max(1, Math.min(30, 0.56 / Math.max(size.x, size.y, size.z * 0.7)));
    sl.scale = scale;
    b.group.scale.setScalar(scale);
    b.group.position.set(-(box.min.x + box.max.x) / 2 * scale, 0, -(box.min.z + box.max.z) / 2 * scale);
    sl.top = sl.plinthH + size.y * scale;
    sl.width = Math.max(size.x * scale, sl.big ? 0.5 : 0.66);
    b.group.traverse((o: Object3D) => { o.userData.slot = i; });
    for (const m of b.mats) m.envMapIntensity = Math.min(m.envMapIntensity, 1);
    sl.holder.add(b.group);
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
    if (this.built === this.slots.length && !this.queue.length) this.done = true;
  }

  /** Sharper textures for the object in front of the visitor (at most three at a time). */
  private async sharpen(i: number) {
    const sl = this.slots[i];
    if (!sl.built || sl.detail === 'mid' || this.building) return;
    this.building = true;
    try {
      await this.place(i, 'mid');
      this.mids = this.mids.filter((x) => x !== i);
      this.mids.push(i);
      while (this.mids.length > 3) { const old = this.mids.shift()!; if (old !== i) await this.place(old, 'low'); }
    } finally { this.building = false; }
  }

  // ---------------------------------------------------------------- camera
  private pose(f: number, out: { pos: Vector3; tgt: Vector3 }) {
    const n = this.slots.length;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(f))), i1 = Math.min(n - 1, i0 + 1), t = Math.max(0, Math.min(1, f - i0));
    const a = this.angleOf(i0) + (this.angleOf(i1) - this.angleOf(i0)) * t;
    const s0 = this.slots[i0], s1 = this.slots[i1];
    const top = s0.top + (s1.top - s0.top) * t, width = s0.width + (s1.width - s0.width) * t;
    const fov = (this.camera.fov * Math.PI) / 180, tan = Math.tan(fov / 2), asp = this.camera.aspect;
    const pl = s0.plinthH + (s1.plinthH - s0.plinthH) * t;
    // the object and the upper part of its plinth; on a wide screen its neighbours at the sides
    const lo = Math.max(0, pl - 0.45), hi = top + 0.22;
    const dH = ((hi - lo) / 2) / tan * 1.05;
    const wide = asp > 1 ? Math.max(width * 1.5, this.step * this.R * 2.05) : Math.max(width * 1.25, 0.9);
    const dW = wide / 2 / (tan * asp);
    const D = Math.min(this.R * 0.92, Math.max(1.3, dH, dW));
    const tgtY = (lo + hi) / 2;
    const eye = tgtY + Math.min(0.5, D * 0.12);
    out.pos.set(Math.cos(a) * (this.R - D), eye, Math.sin(a) * (this.R - D));
    out.tgt.set(Math.cos(a) * this.R, tgtY, Math.sin(a) * this.R);
  }
  private overviewPose(out: { pos: Vector3; tgt: Vector3 }) {
    const a = this.ovAngle;
    const R = this.R;
    const narrow = this.camera.aspect < 0.8;
    const back = narrow ? 2.2 : 1.75;
    out.pos.set(-Math.cos(a) * R * back, R * (narrow ? 2.1 : 1.0), -Math.sin(a) * R * back);
    out.tgt.set(Math.cos(a) * R * (narrow ? 0.05 : 0.12), narrow ? -0.6 : 0.6, Math.sin(a) * R * (narrow ? 0.05 : 0.12));
  }
  private desired = { pos: new Vector3(), tgt: new Vector3() };
  private snapCamera() {
    this.desiredPose();
    this.camPos.copy(this.desired.pos);
    this.camTgt.copy(this.desired.tgt);
    this.applyCamera();
  }
  private desiredPose() {
    if (this.overview) this.overviewPose(this.desired); else this.pose(this.f, this.desired);
  }
  private applyCamera() {
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTgt);
    this.dirty = true;
  }

  get focus(): number { return Math.round(this.fTarget); }

  private aimSpot(i: number) {
    const sl = this.slots[i];
    if (!sl) return;
    this.spotAt = i;
    const a = sl.angle;
    const y = (sl.plinthH + sl.top) / 2;
    const r = this.R - 1.5, side = 0.45;
    this.spot.position.set(Math.cos(a) * r - Math.sin(a) * side, Math.max(3.0, sl.top + 1.6), Math.sin(a) * r + Math.cos(a) * side);
    this.spot.target.position.set(Math.cos(a) * this.R, y, Math.sin(a) * this.R);
    this.spot.target.updateMatrixWorld();
    this.spot.angle = Math.min(0.6, Math.max(0.22, Math.atan((Math.max(sl.width, sl.top - sl.plinthH) * 0.75) / 3)));
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }

  go(i: number) {
    const n = this.slots.length;
    this.fTarget = Math.max(0, Math.min(n - 1, i));
    this.overview = false;
    this.queue = this.order(this.fTarget);
    this.settled = 0;
    if (this.opts.reducedMotion) { this.f = this.fTarget; this.snapCamera(); }
    this.dirty = true;
  }
  next() { this.go(this.focus + 1); }
  prev() { this.go(this.focus - 1); }
  setOverview(on: boolean) {
    this.overview = on;
    this.ovAngle = this.angleOf(this.focus);
    if (this.opts.reducedMotion) this.snapCamera();
    this.dirty = true;
  }

  /** Drag: turn along the ring (or the overview round its centre). */
  drag(dx: number) {
    if (this.overview) { this.ovAngle -= dx * 0.006; this.dirty = true; return; }
    const n = this.slots.length;
    const k = 1 / Math.max(160, this.canvas.clientWidth * 0.45);
    this.fTarget = Math.max(0, Math.min(n - 1, this.fTarget - dx * k));
    this.f = this.fTarget;
    this.settled = 0;
    this.dirty = true;
  }
  release() {
    if (this.overview) return;
    this.fTarget = Math.round(this.fTarget);
    this.queue = this.order(this.fTarget);
  }

  pick(x: number, y: number): number {
    const r = this.canvas.getBoundingClientRect();
    const v = new Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hits = this.ray.intersectObjects(this.scene.children, true);
    for (const h of hits) { const s = h.object.userData.slot; if (typeof s === 'number') return s; }
    return -1;
  }

  // ---------------------------------------------------------------- frame loop
  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.opts.mobile ? 2 : 1.75));
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 52 : 42;
    this.camera.updateProjectionMatrix();
    this.snapCamera();
  }

  start() {
    const loop = (now: number) => { this.raf = requestAnimationFrame(loop); this.tick(now); };
    this.raf = requestAnimationFrame(loop);
  }

  private tick(now: number) {
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 1 / 60;
    this.lastT = now;
    // glide toward the chosen object
    if (Math.abs(this.f - this.fTarget) > 1e-4) {
      this.f += (this.fTarget - this.f) * Math.min(1, dt * 5);
      if (Math.abs(this.f - this.fTarget) < 0.002) this.f = this.fTarget;
      this.dirty = true;
    }
    this.desiredPose();
    const k = this.opts.reducedMotion ? 1 : Math.min(1, dt * 4.5);
    if (this.camPos.distanceToSquared(this.desired.pos) > 1e-7 || this.camTgt.distanceToSquared(this.desired.tgt) > 1e-7) {
      this.camPos.lerp(this.desired.pos, k);
      this.camTgt.lerp(this.desired.tgt, k);
      this.applyCamera();
    }
    const fi = Math.round(this.f);
    if (fi !== this.lastFocus && !this.overview) { this.lastFocus = fi; this.onFocus?.(fi); }
    const sf = Math.round(this.fTarget);
    if (sf !== this.spotAt && Math.abs(this.f - this.fTarget) < 0.35) this.aimSpot(sf);
    // once the visitor stops, sharpen what they are looking at; otherwise keep building
    this.settled += dt;
    if (!this.building) {
      if (this.queue.length) void this.buildNext();
      else if (!this.overview && this.settled > 0.6 && Math.abs(this.f - this.fTarget) < 0.01) void this.sharpen(Math.round(this.fTarget));
    }
    if (!this.dirty) return;
    this.dirty = false;
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.stats.render.push(performance.now() - t0);
    this.stats.frame.push(dt * 1000);
    if (this.stats.render.length > 600) { this.stats.render.shift(); this.stats.frame.shift(); }
  }

  renderNow() { this.renderer.render(this.scene, this.camera); }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const s of this.slots) if (s.built) disposeBuilt(s.built);
    this.scene.traverse((o) => { const m = o as Mesh; if (m.isMesh) m.geometry.dispose(); });
    for (const m of this.mats) m.dispose();
    for (const t of this.textures) t.dispose();
    this.renderer.dispose();
  }
}
