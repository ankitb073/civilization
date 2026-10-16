// The tablet: a canvas of warm clay, lit from the upper left, with the player's sentences pressed into it as wedges.
// Each stroke of the wedge alphabet (strokes.ts) is drawn as a cuneiform wedge: a triangular head of three facets and a
// tapering V-groove, each facet shaded by the way it faces the light, so the signs read as cut into the surface.
// Later media (papyrus, parchment, paper) get a sheet and ink instead of clay and wedges.
//
// Layers: the base (clay, texture, lighting; drawn once per size), the text (every settled wedge; redrawn when the
// words change) and a live layer per frame (wedges being pressed, the stylus, previews, fire and marks). Nothing runs
// between animations, and with reduced motion every change lands at once.
import { CAP, chars, glyphOf, measure, TRACK } from './strokes.ts';
import { seeded } from './engine.ts';
import type { Material } from './engine.ts';

export interface CaseSpec {
  id: string;
  before: string;
  after: string;
  /** The longest text the slot can hold, so the tablet's layout never jumps. Empty when the case has no slot. */
  longest: string;
}
export type SlotMode = 'hidden' | 'blank' | 'ghost' | 'set';
interface CaseState { before: boolean; mode: SlotMode; text: string; lost: boolean }

interface Placed { ch: string; x: number; y: number; part: 'before' | 'slot' | 'after' }
interface CaseLayout { spec: CaseSpec; row0: number; rows: number; hollows: { x: number; y: number; w: number }[] }
interface Wedge { hx: number; hy: number; tx: number; ty: number; k: number; tone: number }
interface Anim { id: string; part: 'all' | 'slot' | 'before' | 'edge'; wedges: Wedge[]; t0: number; per: number; done: () => void; n: number }
export interface FireState { scorch: number; kiln: number; dry: number; glow: number }
export type Broken = 'none' | 'corner' | 'halves' | 'crumbled';

const LIGHT = { x: -0.6, y: -0.8 };
const DARK = [84, 52, 30], LITE = [252, 228, 190];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rgb = (c: number[], a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a: number[], b: number[], t: number) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const ease = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

/** A tablet's outline: a rounded rectangle whose sides bulge a little, like a pillow of clay. */
function pillow(x: number, y: number, w: number, h: number, r: number, b: number): Path2D {
  const p = new Path2D();
  p.moveTo(x + r, y);
  p.quadraticCurveTo(x + w / 2, y - b, x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.quadraticCurveTo(x + w + b, y + h / 2, x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.quadraticCurveTo(x + w / 2, y + h + b, x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.quadraticCurveTo(x - b, y + h / 2, x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  p.closePath();
  return p;
}
/** A sheet's outline: nearly straight edges with small irregularities. */
function sheet(x: number, y: number, w: number, h: number, rnd: () => number, rough: number): Path2D {
  const p = new Path2D();
  const n = 14;
  const j = () => (rnd() - 0.5) * rough;
  p.moveTo(x + j(), y + j());
  for (let i = 1; i <= n; i++) p.lineTo(x + (w * i) / n + j(), y + j());
  for (let i = 1; i <= n; i++) p.lineTo(x + w + j(), y + (h * i) / n + j());
  for (let i = n - 1; i >= 0; i--) p.lineTo(x + (w * i) / n + j(), y + h + j());
  for (let i = n - 1; i >= 1; i--) p.lineTo(x + j(), y + (h * i) / n + j());
  p.closePath();
  return p;
}

/** Smooth value noise on a grid, deterministic per seed. */
function noiseField(rnd: () => number, gw: number, gh: number): (x: number, y: number) => number {
  const g = new Float32Array((gw + 2) * (gh + 2)).map(() => rnd());
  const at = (i: number, j: number) => g[Math.min(gh + 1, Math.max(0, j)) * (gw + 2) + Math.min(gw + 1, Math.max(0, i))];
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(at(i, j), at(i + 1, j), sx), lerp(at(i, j + 1), at(i + 1, j + 1), sx), sy);
  };
}

export interface TabletOptions {
  seed: string;
  material: Material;
  reduced: boolean;
  /** Called for each wedge pressed (for the stylus sound). */
  onPress?: () => void;
  /** Called when the tablet's height changes. */
  onResize?: (cssHeight: number) => void;
}

export class ClayTablet {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: TabletOptions;
  private specs: CaseSpec[] = [];
  private state = new Map<string, CaseState>();
  private layouts: CaseLayout[] = [];
  private edge = { text: '', shown: false };
  private fireState: FireState = { scorch: 0, kiln: 0, dry: 0, glow: 0 };
  private brokenState: Broken = 'none';
  private marks: string[] = [];
  private anims: Anim[] = [];
  private smoothing: { id: string; t0: number; dur: number; done: () => void } | null = null;
  private fireAnim: { from: FireState; to: FireState; t0: number; dur: number; done: () => void } | null = null;
  private stylus = { x: 0, y: 0, on: 0, lastT: 0 };
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private dpr = 1;
  // geometry (CSS px)
  private W = 0; private H = 0; private cap = 12; private rowH = 24; private face = { x: 0, y: 0, w: 0, h: 0 }; private thick = 10;
  private padX = 20; private padTop = 20;
  private base: HTMLCanvasElement | null = null;
  private text: HTMLCanvasElement | null = null;
  private facePath = new Path2D();
  private bodyPath = new Path2D();
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: TabletOptions) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.opts = opts;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      let last = -1;
      this.ro = new ResizeObserver(() => {
        const w = Math.round(canvas.parentElement!.clientWidth);
        if (w !== last && w > 0) { last = w; this.layout(); }
      });
      this.ro.observe(canvas.parentElement);
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    for (const a of this.anims) a.done();
    this.anims = [];
  }

  // ------------------------------------------------------------------ public state

  setCases(specs: CaseSpec[]) {
    this.specs = specs;
    for (const s of specs) if (!this.state.has(s.id)) this.state.set(s.id, { before: false, mode: 'hidden', text: '', lost: false });
    this.layout();
  }
  /** Show or hide a case's fixed words, and set its slot (immediately, without pressing). */
  set(id: string, patch: Partial<CaseState>) {
    const s = this.state.get(id);
    if (!s) return;
    Object.assign(s, patch);
    this.drawText();
    this.render();
  }
  get(id: string): CaseState | undefined { return this.state.get(id); }
  /** The lines the king objects to: a warm underlay, and his fingernail under the first. */
  setMarks(ids: string[]) { this.marks = ids; this.render(); }
  setEdge(text: string, shown: boolean) { this.edge = { text, shown }; this.drawText(); this.render(); }
  setFire(f: Partial<FireState>) { this.fireState = { ...this.fireState, ...f }; this.render(); }
  setBroken(b: Broken) { this.brokenState = b; this.render(); }

  /** Press a case's words (its fixed words and slot, or only the slot) with the stylus. Resolves when the last wedge is in. */
  press(id: string, part: 'all' | 'slot' | 'before', totalMs = 1600): Promise<void> {
    const s = this.state.get(id);
    if (!s) return Promise.resolve();
    if (part !== 'slot') s.before = true;
    if (part !== 'before') s.mode = 'set';
    if (this.opts.reduced || this.disposed || !this.W) { this.drawText(); this.render(); return Promise.resolve(); }
    const wedges = this.wedgesOf(id, part === 'all' ? ['before', 'slot', 'after'] : part === 'before' ? ['before', 'after'] : ['slot']);
    if (!wedges.length) { this.drawText(); this.render(); return Promise.resolve(); }
    return new Promise((done) => {
      const per = Math.max(22, Math.min(70, totalMs / wedges.length));
      this.anims.push({ id, part, wedges, t0: performance.now(), per, done, n: -1 });
      this.drawText();
      this.kick();
    });
  }
  pressEdge(text: string): Promise<void> {
    this.edge = { text, shown: true };
    if (this.opts.reduced || !this.W) { this.drawText(); this.render(); return Promise.resolve(); }
    const wedges = this.edgeWedges();
    return new Promise((done) => {
      this.anims.push({ id: '__edge', part: 'edge', wedges, t0: performance.now(), per: Math.max(18, Math.min(50, 1500 / Math.max(1, wedges.length))), done, n: -1 });
      this.drawText();
      this.kick();
    });
  }
  /** Smooth a line away with the thumb. */
  smooth(id: string, dur = 1100): Promise<void> {
    if (this.opts.reduced || !this.W) { const s = this.state.get(id); if (s) s.mode = 'blank'; this.drawText(); this.render(); return Promise.resolve(); }
    return new Promise((done) => {
      this.smoothing = { id, t0: performance.now(), dur, done: () => { const s = this.state.get(id); if (s) s.mode = 'blank'; this.drawText(); done(); } };
      this.kick();
    });
  }
  /** Fire the tablet: animate toward a hardened look. */
  fire(to: Partial<FireState>, dur = 2600): Promise<void> {
    const target = { ...this.fireState, ...to };
    if (this.opts.reduced || !this.W) { this.fireState = { ...target, glow: 0 }; this.render(); return Promise.resolve(); }
    return new Promise((done) => {
      this.fireAnim = { from: { ...this.fireState }, to: target, t0: performance.now(), dur, done };
      this.kick();
    });
  }

  /** The tablet drawn on its own (for the share card). */
  snapshot(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.canvas.width; c.height = this.canvas.height;
    c.getContext('2d')!.drawImage(this.canvas, 0, 0);
    return c;
  }
  get cssHeight() { return this.H; }
  /** Where a case sits on the canvas (CSS px), for scrolling a small window onto it. */
  caseBox(id: string): { top: number; bottom: number } | null {
    const L = this.layouts.find((l) => l.spec.id === id);
    if (!L) return null;
    const top = this.face.y + this.padTop + L.row0 * this.rowH;
    return { top, bottom: top + L.rows * this.rowH };
  }

  // ------------------------------------------------------------------ layout

  private layout() {
    const parent = this.canvas.parentElement;
    if (!parent || this.disposed) return;
    const W = Math.max(240, Math.round(parent.clientWidth));
    const clay = this.opts.material === 'clay';
    const mx = Math.round(W * 0.035), top = Math.round(W * 0.025);
    const fw = W - 2 * mx;
    const padX = Math.max(16, fw * 0.06);
    const padY = Math.max(14, fw * 0.055);
    // as large as the letters can be while the tablet stays a tablet (and, on a wide screen, fits the window)
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    const maxH = W >= 520 ? Math.min(fw * 1.12, Math.max(320, vh - 210)) : fw * 1.4;
    let cap = Math.max(9, Math.min(21, fw / 25));
    let rows = 0;
    for (let tries = 0; tries < 14; tries++) {
      rows = this.wrapAll(cap, fw - 2 * padX, true);
      if (rows * cap * 2 + 2 * padY <= maxH || cap <= 9) break;
      cap = Math.max(9, cap * 0.95);
    }
    this.cap = cap;
    this.rowH = cap * 2;
    this.padX = padX;
    this.padTop = padY;
    const fh = Math.round(rows * this.rowH + 2 * this.padTop);
    this.thick = clay ? Math.max(11, Math.round(fw * 0.034)) : 0;
    this.face = { x: mx, y: top, w: fw, h: fh };
    this.W = W;
    this.H = Math.round(top + fh + this.thick + W * 0.07);
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${this.H}px`;
    this.wrapAll(cap, fw - 2 * padX, false);
    const r = Math.min(fw, fh) * 0.1;
    if (clay) {
      this.facePath = pillow(this.face.x, this.face.y, fw, fh, r, Math.min(fw, fh) * 0.012);
      this.bodyPath = pillow(this.face.x, this.face.y + this.thick, fw, fh, r, Math.min(fw, fh) * 0.012);
    } else {
      const rnd = seeded(`sheet:${this.opts.seed}`);
      this.facePath = sheet(this.face.x, this.face.y, fw, fh, rnd, this.opts.material === 'papyrus' ? 3 : 1.6);
      this.bodyPath = this.facePath;
    }
    this.drawBase();
    this.drawText();
    this.render();
    this.opts.onResize?.(this.H);
  }

  /** Wrap all cases (rows only when `count`), placing rows from the top of the face. */
  private wrapAll(cap: number, maxW: number, count: boolean): number {
    let row = 0;
    const layouts: CaseLayout[] = [];
    for (const spec of this.specs) {
      const longestRows = this.wrapCase(spec, spec.longest, cap, maxW).rows;
      if (!count) {
        const ws = this.wrapCase(spec, spec.longest, cap, maxW);
        layouts.push({ spec, row0: row, rows: longestRows, hollows: ws.slotBoxes.map((b) => ({ ...b })) });
      }
      row += longestRows;
    }
    if (!count) this.layouts = layouts;
    return row;
  }

  /** Greedy wrap of one case with a given slot text; positions in units relative to the case's first row. */
  private wrapCase(spec: CaseSpec, slot: string, cap: number, maxW: number) {
    const u = cap / CAP;
    const words: { w: string; part: Placed['part'] }[] = [
      ...spec.before.split(/\s+/).filter(Boolean).map((w) => ({ w, part: 'before' as const })),
      ...slot.split(/\s+/).filter(Boolean).map((w) => ({ w, part: 'slot' as const })),
      ...spec.after.split(/\s+/).filter(Boolean).map((w) => ({ w, part: 'after' as const })),
    ];
    const space = 3.4;
    const maxU = maxW / u;
    let x = 0, r = 0;
    const placed: Placed[] = [];
    const slotBoxes: { x: number; y: number; w: number }[] = [];
    for (const wd of words) {
      const ww = measure(wd.w);
      if (x > 0 && x + space + ww > maxU) { r++; x = 0; } else if (x > 0) x += space;
      const x0 = x;
      for (const ch of chars(wd.w)) {
        placed.push({ ch, x: x * u, y: r, part: wd.part });
        x += glyphOf(ch).w + TRACK;
      }
      x -= TRACK;
      if (wd.part === 'slot') {
        const last = slotBoxes[slotBoxes.length - 1];
        if (last && last.y === r) last.w = x * u - last.x;
        else slotBoxes.push({ x: x0 * u, y: r, w: (x - x0) * u });
      }
    }
    return { rows: words.length ? r + 1 : 1, placed, slotBoxes };
  }

  /** Wedges for the given parts of a case, in reading order, in CSS px. */
  private wedgesOf(id: string, parts: Placed['part'][]): Wedge[] {
    const L = this.layouts.find((l) => l.spec.id === id);
    const s = this.state.get(id);
    if (!L || !s) return [];
    const { placed } = this.wrapCase(L.spec, s.text, this.cap, this.face.w - 2 * this.padX);
    const x0 = this.face.x + this.padX, y0 = this.face.y + this.padTop;
    const out: Wedge[] = [];
    placed.forEach((p, i) => {
      if (!parts.includes(p.part)) return;
      const top = y0 + (L.row0 + p.y) * this.rowH + (this.rowH - this.cap) / 2 - this.cap * 0.05;
      out.push(...this.glyphWedges(p.ch, x0 + p.x, top, this.cap, `${id}:${i}`));
    });
    return out;
  }
  private edgeWedges(): Wedge[] {
    if (!this.edge.text || !this.thick) return [];
    const cap = Math.max(4.2, this.thick * 0.42);
    const u = cap / CAP;
    const total = measure(this.edge.text) * u;
    let x = this.face.x + Math.max(this.face.w * 0.12, (this.face.w - total) / 2);
    const top = this.face.y + this.face.h + (this.thick - cap) / 2 + this.thick * 0.12;
    const out: Wedge[] = [];
    chars(this.edge.text).forEach((ch, i) => {
      out.push(...this.glyphWedges(ch, x, top, cap, `edge:${i}`));
      x += (glyphOf(ch).w + TRACK) * u;
    });
    return out;
  }

  private glyphWedges(ch: string, x: number, top: number, cap: number, key: string): Wedge[] {
    const g = glyphOf(ch);
    const u = cap / CAP;
    const rnd = seeded(`${this.opts.seed}:${key}`);
    const out: Wedge[] = [];
    for (let i = 0; i < g.s.length; i += 4) {
      let [x1, y1, x2, y2] = [g.s[i], g.s[i + 1], g.s[i + 2], g.s[i + 3]];
      // the head goes at the top, or at the left of a stroke that is nearly horizontal
      const horiz = Math.abs(y2 - y1) < 0.35 * Math.abs(x2 - x1);
      if ((horiz && x2 < x1) || (!horiz && y2 < y1)) [x1, y1, x2, y2] = [x2, y2, x1, y1];
      const j = () => (rnd() - 0.5);
      out.push({ hx: x + x1 * u + j() * u * 0.25, hy: top + y1 * u + j() * u * 0.25, tx: x + x2 * u + j() * u * 0.35, ty: top + y2 * u + j() * u * 0.35, k: u * (0.92 + rnd() * 0.18), tone: j() * 0.12 });
    }
    return out;
  }

  // ------------------------------------------------------------------ drawing: base

  private drawBase() {
    const { W, H, dpr } = this;
    const c = this.base ?? document.createElement('canvas');
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (this.opts.material === 'clay') this.clayBase(g); else this.sheetBase(g);
    this.base = c;
  }

  private clayBase(g: CanvasRenderingContext2D) {
    const { x, y, w, h } = this.face;
    const rnd = seeded(`clay:${this.opts.seed}`);
    // the shadow on the table, and the tablet's lower side
    g.save();
    g.shadowColor = 'rgba(12,6,2,0.6)'; g.shadowBlur = w * 0.05; g.shadowOffsetY = w * 0.028;
    g.fillStyle = '#6c4a2f';
    g.fill(this.bodyPath);
    g.restore();
    g.save();
    g.shadowColor = 'rgba(12,6,2,0.55)'; g.shadowBlur = 5; g.shadowOffsetY = 2;
    const side = g.createLinearGradient(0, y + h - 10, 0, y + h + this.thick);
    side.addColorStop(0, '#8d6440'); side.addColorStop(1, '#5c3e26');
    g.fillStyle = side;
    g.fill(this.bodyPath);
    g.restore();
    // the face
    const grd = g.createLinearGradient(x, y, x + w * 0.4, y + h);
    grd.addColorStop(0, '#dbb488'); grd.addColorStop(0.5, '#cba077'); grd.addColorStop(1, '#b88a5f');
    g.fillStyle = grd;
    g.fill(this.facePath);
    // texture: mottling and grain, clipped to the face
    const tw = Math.max(1, Math.round(w * this.dpr)), th = Math.max(1, Math.round(h * this.dpr));
    const tex = document.createElement('canvas');
    tex.width = tw; tex.height = th;
    const tg = tex.getContext('2d')!;
    const img = tg.createImageData(tw, th);
    const n1 = noiseField(rnd, Math.ceil(tw / 90) + 1, Math.ceil(th / 90) + 1);
    const n2 = noiseField(rnd, Math.ceil(tw / 9) + 1, Math.ceil(th / 9) + 1);
    const d = img.data;
    let seed = 1234567;
    for (let j = 0; j < th; j++) {
      for (let i = 0; i < tw; i++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        const grain = ((seed >>> 16) & 255) / 255;
        const v = 0.34 * n1(i / 90, j / 90) + 0.38 * n2(i / 9, j / 9) + 0.28 * grain;
        const k = (j * tw + i) * 4;
        const c = Math.round(255 * Math.max(0, Math.min(1, (v - 0.5) * 1.25 + 0.5)));
        d[k] = c; d[k + 1] = c; d[k + 2] = c; d[k + 3] = 255;
      }
    }
    tg.putImageData(img, 0, 0);
    g.save();
    g.clip(this.facePath);
    g.globalCompositeOperation = 'soft-light';
    g.globalAlpha = 0.34;
    g.drawImage(tex, x, y, w, h);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    // the pillow: a soft light on the upper left, falling off toward the edges
    const hl = g.createRadialGradient(x + w * 0.34, y + h * 0.26, 0, x + w * 0.4, y + h * 0.36, Math.max(w, h) * 0.78);
    hl.addColorStop(0, 'rgba(255,238,210,0.26)'); hl.addColorStop(0.55, 'rgba(255,238,210,0.04)'); hl.addColorStop(1, 'rgba(40,20,6,0.24)');
    g.fillStyle = hl;
    g.fillRect(x - 10, y - 10, w + 20, h + 20);
    // the rounded rim: light on the upper-left slope, shadow on the lower-right
    const bev = g.createLinearGradient(x, y, x + w * 0.35, y + h);
    bev.addColorStop(0, 'rgba(255,240,215,1)'); bev.addColorStop(0.45, 'rgba(255,240,215,0)'); bev.addColorStop(0.55, 'rgba(45,22,8,0)'); bev.addColorStop(1, 'rgba(45,22,8,1)');
    g.strokeStyle = bev;
    const r = Math.min(w, h) * 0.1;
    for (let i = 0; i < 9; i++) {
      const inset = i * Math.max(1.2, w * 0.0035);
      g.globalAlpha = 0.16 * (1 - i / 9);
      g.lineWidth = Math.max(2, w * 0.006);
      g.stroke(pillow(x + inset, y + inset, w - 2 * inset, h - 2 * inset, Math.max(2, r - inset), Math.min(w, h) * 0.012));
    }
    g.globalAlpha = 1;
    // grit and sand
    for (let i = 0; i < Math.round(w * h / 900); i++) {
      const px = x + rnd() * w, py = y + rnd() * h, s = 0.4 + rnd() * 1.1;
      const dark = rnd() < 0.6;
      g.fillStyle = dark ? `rgba(70,42,24,${0.18 + rnd() * 0.25})` : `rgba(255,236,200,${0.2 + rnd() * 0.3})`;
      g.beginPath(); g.arc(px, py, s, 0, Math.PI * 2); g.fill();
      if (dark && rnd() < 0.3) { g.fillStyle = 'rgba(255,236,205,0.25)'; g.beginPath(); g.arc(px + 0.6, py + 0.6, s * 0.8, 0, Math.PI * 2); g.fill(); }
    }
    // a thumbprint near the lower left, where the scribe held it
    const fx = x + w * (0.05 + rnd() * 0.05), fy = y + h * (0.72 + rnd() * 0.12), fr = Math.min(w, h) * 0.07;
    for (let i = 1; i < 11; i++) {
      g.beginPath();
      g.ellipse(fx, fy, fr * i / 10 * 1.25, fr * i / 10, -0.5, Math.PI * (0.05 + rnd() * 0.1), Math.PI * (1.4 + rnd() * 0.3));
      g.strokeStyle = 'rgba(70,40,20,0.07)'; g.lineWidth = 0.9; g.stroke();
      g.save(); g.translate(0.7, 0.7); g.strokeStyle = 'rgba(255,235,205,0.07)'; g.stroke(); g.restore();
    }
    // hairline cracks from the rim
    for (let k = 0; k < 3; k++) {
      const side = Math.floor(rnd() * 4);
      let cx = side === 0 ? x + rnd() * w : side === 1 ? x + w - 2 : side === 2 ? x + rnd() * w : x + 2;
      let cy = side === 0 ? y + 2 : side === 1 ? y + rnd() * h : side === 2 ? y + h - 2 : y + rnd() * h;
      const ang = side === 0 ? Math.PI / 2 : side === 1 ? Math.PI : side === 2 ? -Math.PI / 2 : 0;
      let a = ang;
      g.beginPath(); g.moveTo(cx, cy);
      const len = 6 + rnd() * 10;
      for (let s = 0; s < len; s++) { a += (rnd() - 0.5) * 0.9; cx += Math.cos(a) * 2.2; cy += Math.sin(a) * 2.2; g.lineTo(cx, cy); }
      g.strokeStyle = 'rgba(60,34,18,0.35)'; g.lineWidth = 0.7; g.stroke();
      g.save(); g.translate(0.6, 0.6); g.strokeStyle = 'rgba(255,236,206,0.22)'; g.stroke(); g.restore();
    }
    // the rulings: shallow lines between the rows, pressed with the edge of the stylus
    const x0 = x + this.padX * 0.55, x1 = x + w - this.padX * 0.55;
    let row = 0;
    for (const L of this.layouts) {
      for (let i = 0; i < L.rows; i++) {
        row++;
        const ly = y + this.padTop + row * this.rowH - this.rowH * 0.06;
        const strong = i === L.rows - 1;
        if (row === this.layouts.reduce((t, l) => t + l.rows, 0)) break;
        g.beginPath();
        g.moveTo(x0, ly + Math.sin(row * 1.7) * 0.6);
        g.quadraticCurveTo((x0 + x1) / 2, ly + Math.sin(row * 2.3) * 1.2, x1, ly + Math.cos(row) * 0.6);
        g.strokeStyle = `rgba(66,38,20,${strong ? 0.28 : 0.13})`; g.lineWidth = strong ? 1.1 : 0.8; g.stroke();
        g.save(); g.translate(0.5, 0.9); g.strokeStyle = `rgba(255,236,206,${strong ? 0.26 : 0.14})`; g.stroke(); g.restore();
      }
    }
    g.restore();
  }

  private sheetBase(g: CanvasRenderingContext2D) {
    const { x, y, w, h } = this.face;
    const m = this.opts.material;
    const rnd = seeded(`sheet:${this.opts.seed}`);
    g.save();
    g.shadowColor = 'rgba(10,5,0,0.55)'; g.shadowBlur = w * 0.04; g.shadowOffsetY = w * 0.02;
    const tone = m === 'papyrus' ? ['#e4cf9c', '#cfb47c'] : m === 'parchment' ? ['#efe0bf', '#d9c39a'] : ['#f2ead7', '#e2d6bb'];
    const grd = g.createLinearGradient(x, y, x + w, y + h);
    grd.addColorStop(0, tone[0]); grd.addColorStop(1, tone[1]);
    g.fillStyle = grd;
    g.fill(this.facePath);
    g.restore();
    g.save();
    g.clip(this.facePath);
    if (m === 'papyrus') {
      for (let i = 0; i < h; i += 1.6 + rnd() * 1.6) { g.fillStyle = `rgba(${rnd() < 0.5 ? '120,90,40' : '255,245,210'},${0.05 + rnd() * 0.08})`; g.fillRect(x, y + i, w, 0.6 + rnd()); }
      for (let i = 0; i < w; i += 3 + rnd() * 4) { g.fillStyle = `rgba(110,80,35,${0.03 + rnd() * 0.04})`; g.fillRect(x + i, y, 0.8 + rnd(), h); }
    } else {
      for (let i = 0; i < 26; i++) {
        const r = 14 + rnd() * w * 0.14, cx = x + rnd() * w, cy = y + rnd() * h;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, `rgba(150,110,60,${0.03 + rnd() * 0.04})`); gr.addColorStop(1, 'rgba(150,110,60,0)');
        g.fillStyle = gr; g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      }
      // fibres
      for (let i = 0; i < w * h / 700; i++) {
        const fx = x + rnd() * w, fy = y + rnd() * h, a = rnd() * Math.PI, l = 3 + rnd() * 9;
        g.strokeStyle = `rgba(120,95,60,${0.05 + rnd() * 0.06})`; g.lineWidth = 0.5;
        g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx + Math.cos(a) * l, fy + Math.sin(a) * l); g.stroke();
      }
      if (m === 'paper') for (let i = 0; i < h; i += 3) { g.fillStyle = 'rgba(120,100,70,0.035)'; g.fillRect(x, y + i, w, 0.6); }
    }
    const vg = g.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.3, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(90,60,25,0.22)');
    g.fillStyle = vg; g.fillRect(x, y, w, h);
    g.restore();
  }

  // ------------------------------------------------------------------ drawing: text

  private animating(id: string, part: Placed['part']) {
    return this.anims.some((a) => a.id === id && (a.part === 'all' || (a.part === 'slot' && part === 'slot') || (a.part === 'before' && part !== 'slot')));
  }

  private drawText() {
    if (!this.W) return;
    const c = this.text ?? document.createElement('canvas');
    c.width = this.canvas.width; c.height = this.canvas.height;
    const g = c.getContext('2d')!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    for (const L of this.layouts) {
      const s = this.state.get(L.spec.id)!;
      const parts: Placed['part'][] = [];
      const smoothing = this.smoothing?.id === L.spec.id;
      if (s.before && !this.animating(L.spec.id, 'before')) parts.push('before', 'after');
      if (s.mode === 'set' && !this.animating(L.spec.id, 'slot') && !smoothing) parts.push('slot');
      if (s.mode === 'blank' || s.mode === 'ghost') this.drawHollows(g, L);
      for (const w of this.wedgesOf(L.spec.id, parts)) this.wedge(g, w, 1, 1);
      if (s.lost) { g.save(); g.clip(this.facePath); this.erode(g, L); g.restore(); }
    }
    if (this.edge.shown && !this.anims.some((a) => a.part === 'edge')) for (const w of this.edgeWedges()) this.wedge(g, w, 1, 0.95);
    this.text = c;
  }

  /** A blank slot: a smoothed hollow waiting for the stylus. */
  private drawHollows(g: CanvasRenderingContext2D, L: CaseLayout) {
    const x0 = this.face.x + this.padX, y0 = this.face.y + this.padTop;
    for (const b of L.hollows) {
      const top = y0 + (L.row0 + b.y) * this.rowH + this.rowH * 0.1;
      const hh = this.rowH * 0.74, x = x0 + b.x - this.cap * 0.35, w = b.w + this.cap * 0.7;
      if (this.opts.material !== 'clay') {
        g.fillStyle = 'rgba(120,90,40,0.08)';
        g.fillRect(x, top + hh - 2, w, 1.2);
        continue;
      }
      // a patch smoothed with a wet thumb: a little darker and glossier than the clay around it
      const gr = g.createLinearGradient(0, top, 0, top + hh);
      gr.addColorStop(0, 'rgba(90,52,26,0.1)'); gr.addColorStop(0.5, 'rgba(120,74,40,0.04)'); gr.addColorStop(1, 'rgba(255,238,210,0.12)');
      g.fillStyle = gr;
      g.beginPath(); g.roundRect(x, top, w, hh, hh / 2); g.fill();
      const sh = g.createLinearGradient(x, 0, x + w, 0);
      sh.addColorStop(0, 'rgba(255,245,225,0)'); sh.addColorStop(0.3, 'rgba(255,245,225,0.12)'); sh.addColorStop(0.7, 'rgba(255,245,225,0.04)'); sh.addColorStop(1, 'rgba(255,245,225,0)');
      g.fillStyle = sh;
      g.beginPath(); g.roundRect(x + hh * 0.3, top + hh * 0.18, w - hh * 0.6, hh * 0.22, hh * 0.11); g.fill();
    }
  }

  /** Damp and breakage: a line softened back into mud. */
  private erode(g: CanvasRenderingContext2D, L: CaseLayout) {
    const rnd = seeded(`erode:${this.opts.seed}:${L.spec.id}`);
    const y = this.face.y + this.padTop + L.row0 * this.rowH, h = L.rows * this.rowH;
    const clay = this.opts.material === 'clay';
    for (let i = 0; i < 26 * L.rows; i++) {
      const cx = this.face.x + this.padX * 0.5 + rnd() * (this.face.w - this.padX), cy = y + rnd() * h, r = this.rowH * (0.5 + rnd() * 0.9);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      const col = clay ? '196,150,106' : '214,196,160';
      gr.addColorStop(0, `rgba(${col},0.95)`); gr.addColorStop(0.7, `rgba(${col},0.75)`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    }
  }

  /** One wedge: three facets in the head, two along the shaft, lit from the upper left. `p` is the press progress. */
  private wedge(g: CanvasRenderingContext2D, w: Wedge, p: number, alpha: number) {
    const dx = w.tx - w.hx, dy = w.ty - w.hy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const k = w.k;
    const short = Math.min(1, len / (2.2 * k));
    const ph = ease(p / 0.4), ps = ease((p - 0.2) / 0.8);
    const hw = 0.84 * k * Math.max(0.55, short) * (0.55 + 0.45 * ph);
    const hl = 1.55 * k * Math.max(0.5, short) * (0.55 + 0.45 * ph);
    const back = 0.2 * k;
    const ax = w.hx - ux * back + nx * hw, ay = w.hy - uy * back + ny * hw;
    const bx = w.hx - ux * back - nx * hw, by = w.hy - uy * back - ny * hw;
    const cx = w.hx + ux * hl, cy = w.hy + uy * hl;
    const ddx = w.hx + ux * hl * 0.28, ddy = w.hy + uy * hl * 0.28;
    const s0x = w.hx + ux * hl * 0.75, s0y = w.hy + uy * hl * 0.75;
    const shaftLen = Math.max(0, len - hl * 0.75) * ps;
    const tx = s0x + ux * shaftLen, ty = s0y + uy * shaftLen;
    const sw0 = 0.36 * k, sw1 = 0.08 * k;
    g.globalAlpha = alpha;
    if (this.opts.material !== 'clay') {
      // ink: a pen stroke, a little heavier where the pen came down, with a soft bleed into the fibres
      const w0 = 0.5 * k * (0.7 + 0.3 * ph), w1 = 0.34 * k;
      const ex = w.hx + ux * Math.max(0, len) * ps, ey = w.hy + uy * Math.max(0, len) * ps;
      g.fillStyle = `rgba(${30 + w.tone * 50},${20 + w.tone * 30},${14},0.88)`;
      g.shadowColor = 'rgba(30,20,10,0.35)'; g.shadowBlur = Math.max(0.6, k * 0.25);
      g.beginPath();
      g.moveTo(w.hx + nx * w0 / 2, w.hy + ny * w0 / 2);
      g.lineTo(ex + nx * w1 / 2, ey + ny * w1 / 2);
      g.arc(ex, ey, w1 / 2, Math.atan2(ny, nx), Math.atan2(ny, nx) - Math.PI, true);
      g.lineTo(w.hx - nx * w0 / 2, w.hy - ny * w0 / 2);
      g.arc(w.hx, w.hy, w0 / 2, Math.atan2(-ny, -nx), Math.atan2(-ny, -nx) - Math.PI, true);
      g.closePath();
      g.fill();
      g.shadowBlur = 0; g.shadowColor = 'transparent';
      g.globalAlpha = 1;
      return;
    }
    const outline = () => {
      g.beginPath();
      g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx, cy);
      if (shaftLen > 0.5) { g.lineTo(s0x - nx * sw0, s0y - ny * sw0); g.lineTo(tx - nx * sw1, ty - ny * sw1); g.lineTo(tx + nx * sw1, ty + ny * sw1); g.lineTo(s0x + nx * sw0, s0y + ny * sw0); g.lineTo(cx, cy); }
      g.closePath();
    };
    // the lip: a bright rim on the side toward the light, a soft shadow on the far side
    const lip = Math.max(0.7, k * 0.32);
    g.save(); g.translate(LIGHT.x * lip, LIGHT.y * lip); outline(); g.fillStyle = 'rgba(255,242,218,0.5)'; g.fill(); g.restore();
    g.save(); g.translate(-LIGHT.x * lip * 0.8, -LIGHT.y * lip * 0.8); outline(); g.fillStyle = 'rgba(80,46,22,0.26)'; g.fill(); g.restore();
    const facet = (pts: number[], dirx: number, diry: number, depth: number) => {
      const dl = Math.hypot(dirx, diry) || 1;
      const b = 0.5 + 0.5 * ((dirx / dl) * LIGHT.x + (diry / dl) * LIGHT.y) * 0.95 + w.tone;
      g.fillStyle = rgb(mixc(DARK, LITE, Math.max(0, Math.min(1, b * depth))));
      g.beginPath(); g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.closePath(); g.fill();
    };
    // the head: three walls falling to the deepest point
    facet([ax, ay, bx, by, ddx, ddy], ddx - (ax + bx) / 2, ddy - (ay + by) / 2, 0.92);
    facet([bx, by, cx, cy, ddx, ddy], ddx - (bx + cx) / 2, ddy - (by + cy) / 2, 0.96);
    facet([cx, cy, ax, ay, ddx, ddy], ddx - (cx + ax) / 2, ddy - (cy + ay) / 2, 0.96);
    // the shaft: a V-groove, one wall facing each side
    if (shaftLen > 0.5) {
      facet([s0x + nx * sw0, s0y + ny * sw0, tx + nx * sw1, ty + ny * sw1, tx, ty, s0x, s0y], -nx, -ny, 0.95);
      facet([s0x - nx * sw0, s0y - ny * sw0, tx - nx * sw1, ty - ny * sw1, tx, ty, s0x, s0y], nx, ny, 0.95);
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ drawing: the frame

  private kick() {
    if (this.raf || this.disposed) return;
    const step = () => {
      this.raf = 0;
      if (this.disposed) return;
      const busy = this.render();
      if (busy) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Draw one frame; returns true while something is still moving. */
  private render(): boolean {
    const g = this.ctx;
    if (!this.W || !this.base) return false;
    const now = performance.now();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    g.drawImage(this.base, 0, 0, this.W, this.H);
    // the king's fingernail under the line he wants changed
    this.marks.forEach((id, i) => this.drawMark(g, id, i === 0));
    if (this.text) g.drawImage(this.text, 0, 0, this.W, this.H);
    let busy = false;
    // ghost previews
    for (const L of this.layouts) {
      const s = this.state.get(L.spec.id)!;
      if (s.mode === 'ghost' && s.text) for (const w of this.wedgesOf(L.spec.id, ['slot'])) this.ghost(g, w);
    }
    // a line being smoothed away
    if (this.smoothing) {
      const sm = this.smoothing;
      const t = (now - sm.t0) / sm.dur;
      const L = this.layouts.find((l) => l.spec.id === sm.id);
      if (L) this.drawSmoothing(g, L, Math.min(1, t));
      if (t >= 1) { this.smoothing = null; sm.done(); } else busy = true;
    }
    // wedges being pressed
    let pen: { x: number; y: number } | null = null;
    for (const a of [...this.anims]) {
      const el = now - a.t0;
      let finished = true;
      for (let i = 0; i < a.wedges.length; i++) {
        const w = a.wedges[i];
        const p = (el - i * a.per) / (a.per * 2.2);
        if (p <= 0) { finished = false; continue; }
        if (p < 1) { finished = false; if (!pen) pen = { x: w.hx, y: w.hy }; }
        this.wedge(g, w, Math.min(1, p), 1);
      }
      const pressed = Math.min(a.wedges.length, Math.floor(el / a.per));
      if (pressed > a.n) {
        if (Math.floor(pressed / 2) > Math.floor(Math.max(0, a.n) / 2) || a.n < 0) this.opts.onPress?.();
        a.n = pressed;
      }
      if (finished) {
        this.anims = this.anims.filter((x) => x !== a);
        this.drawText();
        a.done();
      } else busy = true;
    }
    // the stylus follows the pressing
    const st = this.stylus;
    const dt = Math.min(64, now - (st.lastT || now));
    st.lastT = now;
    const target = pen as { x: number; y: number } | null;
    if (target) {
      if (st.on < 0.05) { st.x = target.x; st.y = target.y; }
      st.x += (target.x - st.x) * Math.min(1, dt / 40);
      st.y += (target.y - st.y) * Math.min(1, dt / 40);
      st.on = Math.min(1, st.on + dt / 120);
    } else st.on = Math.max(0, st.on - dt / 260);
    if (st.on > 0.01 && this.opts.material === 'clay') { this.drawStylus(g, st.x, st.y, st.on); busy = busy || st.on > 0; }
    else if (st.on > 0.01) { this.drawPen(g, st.x, st.y, st.on); busy = busy || st.on > 0; }
    // fire
    if (this.fireAnim) {
      const fa = this.fireAnim;
      const t = Math.min(1, (now - fa.t0) / fa.dur);
      const e = ease(t);
      this.fireState = {
        scorch: lerp(fa.from.scorch, fa.to.scorch, e), kiln: lerp(fa.from.kiln, fa.to.kiln, e), dry: lerp(fa.from.dry, fa.to.dry, e),
        glow: Math.sin(Math.PI * t) * (fa.to.scorch > 0.1 || fa.to.kiln > 0.1 ? 1 : 0.2) * (0.85 + 0.15 * Math.sin(now / 70)),
      };
      if (t >= 1) { this.fireAnim = null; this.fireState.glow = 0; fa.done(); } else busy = true;
    }
    this.drawFire(g, now);
    this.drawBroken(g);
    return busy;
  }

  private ghost(g: CanvasRenderingContext2D, w: Wedge) {
    const dx = w.tx - w.hx, dy = w.ty - w.hy, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, k = w.k;
    g.beginPath();
    g.moveTo(w.hx + nx * 0.5 * k, w.hy + ny * 0.5 * k);
    g.lineTo(w.hx - nx * 0.5 * k, w.hy - ny * 0.5 * k);
    g.lineTo(w.hx + ux * k, w.hy + uy * k);
    g.closePath();
    g.moveTo(w.hx + ux * k, w.hy + uy * k);
    g.lineTo(w.tx, w.ty);
    const clay = this.opts.material === 'clay';
    g.strokeStyle = clay ? 'rgba(84,48,24,0.42)' : 'rgba(40,26,12,0.32)';
    g.lineWidth = Math.max(0.7, k * 0.16);
    g.stroke();
  }

  /** The slot's words as rectangles (CSS px), for the current text. */
  private slotRects(L: CaseLayout, text: string): { x: number; y: number; w: number; h: number }[] {
    const { slotBoxes } = this.wrapCase(L.spec, text, this.cap, this.face.w - 2 * this.padX);
    const x0 = this.face.x + this.padX, y0 = this.face.y + this.padTop;
    return slotBoxes.map((b) => ({ x: x0 + b.x - this.cap * 0.6, y: y0 + (L.row0 + b.y) * this.rowH + this.rowH * 0.04, w: b.w + this.cap * 1.2, h: this.rowH * 0.9 }));
  }

  private drawSmoothing(g: CanvasRenderingContext2D, L: CaseLayout, t: number) {
    const s = this.state.get(L.spec.id)!;
    const rects = this.slotRects(L, s.text);
    if (!rects.length) return;
    const x0 = Math.min(...rects.map((r) => r.x)), x1 = Math.max(...rects.map((r) => r.x + r.w));
    const sweep = lerp(x0, x1, ease(t));
    g.save();
    const clip = new Path2D();
    for (const r of rects) clip.roundRect(r.x, r.y, r.w, r.h, r.h * 0.4);
    g.clip(clip);
    // the words still ahead of the thumb
    g.save();
    g.beginPath(); g.rect(sweep, 0, this.W, this.H); g.clip();
    for (const w of this.wedgesOf(L.spec.id, ['slot'])) this.wedge(g, w, 1, 1);
    g.restore();
    // behind it, wet smooth clay with a sheen
    const clay = this.opts.material === 'clay';
    const gr = g.createLinearGradient(x0, 0, Math.max(x0 + 1, sweep), 0);
    gr.addColorStop(0, clay ? 'rgba(200,154,108,0.92)' : 'rgba(226,206,166,0.95)');
    gr.addColorStop(1, clay ? 'rgba(236,198,154,0.96)' : 'rgba(240,226,196,0.95)');
    g.fillStyle = gr;
    for (const r of rects) g.fillRect(r.x, r.y, Math.max(0, Math.min(r.w, sweep - r.x)), r.h);
    if (t < 1) {
      g.fillStyle = 'rgba(255,240,215,0.45)';
      for (const r of rects) if (sweep >= r.x && sweep <= r.x + r.w) { g.beginPath(); g.ellipse(sweep, r.y + r.h / 2, this.cap * 0.9, r.h * 0.55, 0, 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
  }

  private drawMark(g: CanvasRenderingContext2D, id: string, nail: boolean) {
    const L = this.layouts.find((l) => l.spec.id === id);
    if (!L) return;
    const y = this.face.y + this.padTop + L.row0 * this.rowH, h = L.rows * this.rowH;
    const x = this.face.x + this.padX * 0.45, w = this.face.w - this.padX * 0.9;
    const gr = g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, 'rgba(255,170,90,0.0)'); gr.addColorStop(0.12, 'rgba(255,170,90,0.3)'); gr.addColorStop(0.88, 'rgba(255,170,90,0.3)'); gr.addColorStop(1, 'rgba(255,170,90,0)');
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = gr;
    g.beginPath(); g.roundRect(x, y + 2, w, h - 2, 6); g.fill();
    g.restore();
    g.strokeStyle = 'rgba(150,46,24,0.55)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(x + w * 0.06, y + h - 1.5); g.lineTo(x + w * 0.94, y + h - 1.5); g.stroke();
    // the fingernail: a crescent pressed under the line's start
    const cx = this.face.x + this.padX * 0.28, cy = y + h / 2, r = this.cap * 0.55;
    if (this.opts.material === 'clay' && nail) {
      g.beginPath(); g.arc(cx, cy, r, -Math.PI * 0.55, Math.PI * 0.55); g.strokeStyle = 'rgba(70,40,20,0.65)'; g.lineWidth = Math.max(1.2, this.cap * 0.14); g.stroke();
      g.beginPath(); g.arc(cx + 0.8, cy + 0.8, r, -Math.PI * 0.5, Math.PI * 0.5); g.strokeStyle = 'rgba(255,238,210,0.45)'; g.lineWidth = 0.9; g.stroke();
    }
  }

  private drawStylus(g: CanvasRenderingContext2D, x: number, y: number, on: number) {
    const L = this.cap * 9, a = -2.25; // the reed comes in from the lower right
    const lift = (1 - on) * this.cap * 2;
    g.save();
    g.globalAlpha = Math.min(1, on * 1.4);
    // its shadow on the clay
    g.save();
    g.translate(x + this.cap * 0.9 + lift, y + this.cap * 1.4 + lift);
    g.rotate(a + Math.PI);
    g.fillStyle = 'rgba(30,15,5,0.25)';
    g.beginPath(); g.roundRect(0, -this.cap * 0.32, L, this.cap * 0.64, this.cap * 0.3); g.fill();
    g.restore();
    g.translate(x + lift * 0.4, y - lift);
    g.rotate(a + Math.PI);
    const t = this.cap * 0.34;
    const gr = g.createLinearGradient(0, -t, 0, t);
    gr.addColorStop(0, '#e9cf96'); gr.addColorStop(0.45, '#c79c5c'); gr.addColorStop(1, '#7d5a2c');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(this.cap * 1.1, -t); g.lineTo(L, -t); g.lineTo(L, t); g.lineTo(this.cap * 1.1, t); g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(60,36,12,0.55)'; g.lineWidth = 0.8;
    for (const f of [0.38, 0.72]) { g.beginPath(); g.moveTo(L * f, -t); g.lineTo(L * f, t); g.stroke(); }
    g.fillStyle = 'rgba(255,245,220,0.35)';
    g.fillRect(this.cap * 1.2, -t * 0.7, L - this.cap * 1.3, t * 0.35);
    g.restore();
  }
  private drawPen(g: CanvasRenderingContext2D, x: number, y: number, on: number) {
    const L = this.cap * 8, a = -2.3;
    g.save();
    g.globalAlpha = Math.min(1, on * 1.4);
    g.translate(x, y);
    g.rotate(a + Math.PI);
    g.fillStyle = '#3a2a1a';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(this.cap, -this.cap * 0.18); g.lineTo(L, -this.cap * 0.22); g.lineTo(L, this.cap * 0.22); g.lineTo(this.cap, this.cap * 0.18); g.closePath(); g.fill();
    g.restore();
  }

  private drawFire(g: CanvasRenderingContext2D, now: number) {
    const f = this.fireState;
    if (f.scorch <= 0.001 && f.kiln <= 0.001 && f.dry <= 0.001 && f.glow <= 0.001) return;
    const { x, y, w, h } = this.face;
    const rnd = seeded(`fire:${this.opts.seed}`);
    g.save();
    const body = new Path2D(); body.addPath(this.bodyPath); body.addPath(this.facePath);
    g.clip(body);
    if (f.kiln > 0) {
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = `rgba(236,150,104,${0.32 * f.kiln})`; g.fillRect(x - 4, y - 4, w + 8, h + this.thick + 8);
      g.globalCompositeOperation = 'source-over';
    }
    if (f.dry > 0) {
      g.globalCompositeOperation = 'screen';
      g.fillStyle = `rgba(200,180,150,${0.22 * f.dry})`; g.fillRect(x - 4, y - 4, w + 8, h + this.thick + 8);
      g.globalCompositeOperation = 'source-over';
    }
    if (f.scorch > 0 && this.opts.material !== 'clay') {
      // a sheet in a fire: toasted brown all over, the edges charred black and eaten away in bites
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = `rgba(206,160,110,${0.5 * f.scorch})`; g.fillRect(x - 4, y - 4, w + 8, h + 8);
      const m = Math.min(w, h) * 0.16;
      for (const [x0, y0, x1, y1] of [[x, 0, x + m, 0], [x + w, 0, x + w - m, 0], [0, y, 0, y + m], [0, y + h, 0, y + h - m]] as const) {
        const gr = x0 ? g.createLinearGradient(x0, 0, x1, 0) : g.createLinearGradient(0, y0, 0, y1);
        gr.addColorStop(0, `rgba(40,24,14,${0.9 * f.scorch})`); gr.addColorStop(1, 'rgba(40,24,14,0)');
        g.fillStyle = gr; g.fillRect(x - 4, y - 4, w + 8, h + 8);
      }
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 7; i++) {
        const side = Math.floor(rnd() * 4), t = rnd(), r = Math.min(w, h) * (0.04 + rnd() * 0.08) * f.scorch;
        const cx = side === 0 ? x + t * w : side === 1 ? x + w : side === 2 ? x + t * w : x;
        const cy = side === 0 ? y : side === 1 ? y + t * h : side === 2 ? y + h : y + t * h;
        g.beginPath();
        for (let a = 0; a < Math.PI * 2; a += 0.5) { const rr = r * (0.7 + rnd() * 0.5); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
        g.closePath(); g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    } else if (f.scorch > 0) {
      // fired clay: redder and deeper all over, blackened down one side where it lay against the burning shelf,
      // with a few smoky clouds where the flames touched it
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = `rgba(214,128,92,${0.42 * f.scorch})`; g.fillRect(x - 4, y - 4, w + 8, h + this.thick + 8);
      const side = g.createLinearGradient(x, y, x + w * 0.62, y + h * 0.25);
      side.addColorStop(0, `rgba(28,20,18,${0.92 * f.scorch})`); side.addColorStop(0.45, `rgba(60,40,34,${0.45 * f.scorch})`); side.addColorStop(1, 'rgba(60,40,34,0)');
      g.fillStyle = side; g.fillRect(x - 4, y - 4, w * 0.7, h + this.thick + 8);
      for (let i = 0; i < 5; i++) {
        const cx = x + w * (0.35 + rnd() * 0.6), cy = y + rnd() * (h + this.thick), r = Math.min(w, h) * (0.07 + rnd() * 0.12);
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, `rgba(40,28,24,${0.55 * f.scorch})`); gr.addColorStop(0.6, `rgba(70,48,40,${0.25 * f.scorch})`); gr.addColorStop(1, 'rgba(70,48,40,0)');
        g.fillStyle = gr; g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      }
      g.globalCompositeOperation = 'source-over';
      // grey ash caught in the wedges and the grain
      for (let i = 0; i < 90; i++) {
        g.fillStyle = `rgba(215,205,196,${0.16 * f.scorch * rnd()})`;
        g.beginPath(); g.arc(x + rnd() * w, y + rnd() * h, 0.4 + rnd() * 1.4, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
    if (f.glow > 0.01) {
      g.save();
      g.globalCompositeOperation = 'screen';
      const flick = 0.85 + 0.15 * Math.sin(now / 53) * Math.sin(now / 131);
      const gr = g.createRadialGradient(x + w / 2, y + h * 1.15, 0, x + w / 2, y + h * 1.15, Math.max(w, h) * 1.1);
      gr.addColorStop(0, `rgba(255,150,60,${0.75 * f.glow * flick})`); gr.addColorStop(0.5, `rgba(255,96,30,${0.32 * f.glow * flick})`); gr.addColorStop(1, 'rgba(255,80,20,0)');
      g.fillStyle = gr; g.fillRect(0, 0, this.W, this.H);
      g.restore();
    }
  }

  private drawBroken(g: CanvasRenderingContext2D) {
    if (this.brokenState === 'none' || this.brokenState === 'crumbled') return;
    const { x, y, w, h } = this.face;
    const rnd = seeded(`break:${this.opts.seed}`);
    if (this.brokenState === 'halves') {
      // a crack from top to bottom, a little left of the middle
      const pts: number[] = [];
      let cx = x + w * (0.42 + rnd() * 0.12);
      for (let cy = y - 4; cy <= y + h + this.thick + 4; cy += 7) { cx += (rnd() - 0.5) * 9; pts.push(cx, cy); }
      g.save();
      g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.strokeStyle = 'rgba(20,10,4,0.75)'; g.lineWidth = 2.2; g.stroke();
      g.translate(1.2, 0.8); g.strokeStyle = 'rgba(255,230,200,0.3)'; g.lineWidth = 0.9; g.stroke();
      g.restore();
    } else if (this.brokenState === 'corner') {
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      const sx = x + w * (0.62 + rnd() * 0.1), ey = y + h * (0.58 + rnd() * 0.1);
      g.moveTo(sx, y + h + this.thick + 30);
      let px = sx, py = y + h + this.thick;
      const steps = 9;
      for (let i = 1; i <= steps; i++) { px = lerp(sx, x + w + 30, i / steps) + (rnd() - 0.5) * 10; py = lerp(y + h + this.thick, ey, i / steps) + (rnd() - 0.5) * 10; g.lineTo(px, py); }
      g.lineTo(x + w + 40, y + h + this.thick + 40);
      g.closePath();
      g.fill();
      g.restore();
    }
  }
}
