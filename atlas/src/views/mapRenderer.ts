import type { TimelineJson, WorldJson } from '../../../engine/src/export/contract.ts';
import { addCellToPath, type Geo } from '../geo.ts';
import type { LayerState } from '../layers.ts';
import type { LayerName } from '../state.ts';

export interface MapData {
  world: WorldJson;
  timeline: TimelineJson;
  geo: Geo;
  layers: Record<LayerName, LayerState>;
}

interface Label { text: string; kicker: string; x: number; y: number; cells: number; idx: number }
interface YearGeom {
  fills: { idx: number; color: string; path: Path2D }[];
  borders: Path2D;
  frontiers: { idx: number; color: string; path: Path2D }[];
  labels: Label[];
  state: Int16Array;
}

export type Hit =
  | { type: 'event'; id: string; cell: number }
  | { type: 'settlement'; id: string; idx: number; cell: number }
  | { type: 'cell'; cell: number };

const EVENT_STYLE: Record<string, { shape: 'diamond' | 'circle' | 'triangle' | 'square' | 'cross' | 'star'; color: string }> = {
  war: { shape: 'diamond', color: '#a3363a' },
  battle: { shape: 'diamond', color: '#a3363a' },
  conquest: { shape: 'cross', color: '#7d1f22' },
  collapse: { shape: 'cross', color: '#5a1a1a' },
  revolt: { shape: 'diamond', color: '#c0562a' },
  treaty: { shape: 'square', color: '#2f5d7c' },
  founding: { shape: 'circle', color: '#4f7a3d' },
  eruption: { shape: 'triangle', color: '#d0601a' },
  drought: { shape: 'triangle', color: '#c08a2b' },
  famine: { shape: 'triangle', color: '#9a7a2a' },
  plague: { shape: 'triangle', color: '#6a4a7a' },
  invention: { shape: 'star', color: '#3a7a8a' },
};
const DEFAULT_EVENT = { shape: 'circle' as const, color: '#7a634a' };

function hexToRgb(h: string): [number, number, number] {
  const m = h.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
const rgb = (r: number, g: number, b: number) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function shade(c: [number, number, number], f: number): [number, number, number] {
  return f >= 0 ? mix(c, [255, 252, 240], f) : mix(c, [20, 16, 12], -f);
}
function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

const KICKERS = /^(City|City-state|Kingdom|Empire|Realm|Republic|Federation|Confederacy|Confederation|Principality|Duchy|Sultanate|Khanate|League|Union|Commonwealth|Dominion|Theocracy|Free City|Chiefdom|Tribes|Lands|Queendom|Hegemony|Despotate|Protectorate|Emirate|Grand Duchy|People's Republic|Kingdoms|United Provinces|Satrapy|State)\s+of\s+(?:the\s+)?(.+)$/i;

export class MapRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private d: MapData;
  private dpr = 1;
  w = 0;
  h = 0;
  scale = 1;
  tx = 0;
  ty = 0;
  fitScale = 1;
  year = 0;
  layer: LayerName = 'political';
  theme: 'light' | 'dark' = 'light';
  selected: string | null = null;
  showRoutes = false;
  hoverCell = -1;
  private terrain: { color: string; path: Path2D }[] = [];
  private coast = new Path2D();
  private rivers: { width: number; path: Path2D }[] = [];
  private yearCache = new Map<string, YearGeom>();
  private raf = 0;
  private polityIdxById = new Map<string, number>();
  private settlementById = new Map<string, number>();
  private eventsSorted: TimelineJson['events'];
  private eventYearIdx: Int32Array;
  private capitalsCache = new Map<number, Set<number>>();
  private markerHits: { x: number; y: number; r: number; hit: Hit }[] = [];
  onDraw?: () => void;

  /** Screen-space insets covered by UI (side panel, bottom sheet). */
  insetRight = 0;
  insetBottom = 0;
  private landCx = 0;
  private landCy = 0;
  private deepWater = '#92acb8';

  constructor(canvas: HTMLCanvasElement, data: MapData, theme: 'light' | 'dark' = 'light') {
    this.canvas = canvas;
    this.theme = theme;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.d = data;
    data.timeline.layers.political.legend.forEach((l) => this.polityIdxById.set(l.id, l.idx));
    data.timeline.settlements.forEach((s) => this.settlementById.set(s.id, s.idx));
    this.eventsSorted = data.timeline.events.slice().sort((a, b) => a.year - b.year);
    this.eventYearIdx = Int32Array.from(this.eventsSorted.map((e) => e.year));
    let lx = 0, ly = 0, ln = 0;
    for (let i = 0; i < data.geo.n; i++) if (data.geo.land[i]) { lx += data.geo.sx[i]; ly += data.geo.sy[i]; ln++; }
    this.landCx = ln ? lx / ln : data.geo.width / 2;
    this.landCy = ln ? ly / ln : data.geo.height / 2;
    this.buildStatic();
  }

  // ---------------------------------------------------------------- static geometry
  private buildStatic() {
    const { geo, world } = this.d;
    const dark = this.theme === 'dark';
    const biomeRgb = world.biomes.map((b) => hexToRgb(b.color));
    const groups = new Map<string, Path2D>();
    const sea = world.seaLevel;
    const lightDir = [-0.7071, -0.7071];
    const waterShallow: [number, number, number] = dark ? [30, 46, 58] : [184, 203, 207];
    const waterDeep: [number, number, number] = dark ? [16, 26, 36] : [146, 172, 184];
    const night: [number, number, number] = [22, 28, 36];
    this.deepWater = rgb(waterDeep[0], waterDeep[1], waterDeep[2]);
    // bathymetry by distance from the coast (in cells), so open ocean is uniform and
    // matches the background beyond the world's edge
    const coastDist = new Int16Array(geo.n).fill(-1);
    const q: number[] = [];
    for (let i = 0; i < geo.n; i++) if (geo.land[i]) { coastDist[i] = 0; q.push(i); }
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      if (coastDist[c] >= 6) continue;
      for (let k = geo.nbrStart[c]; k < geo.nbrStart[c + 1]; k++) {
        const j = geo.nbrs[k];
        if (coastDist[j] < 0) { coastDist[j] = coastDist[c] + 1; q.push(j); }
      }
    }
    for (let i = 0; i < geo.n; i++) {
      const e = world.elevation[i];
      let c: [number, number, number];
      if (!geo.land[i]) {
        const d = coastDist[i] < 0 ? 6 : coastDist[i];
        const t = Math.min(1, (d - 1) / 5);
        c = mix(waterShallow, waterDeep, Math.round(t * 5) / 5);
      } else {
        let gx = 0, gy = 0;
        for (let k = geo.nbrStart[i]; k < geo.nbrStart[i + 1]; k++) {
          const j = geo.nbrs[k];
          const dx = geo.sx[j] - geo.sx[i], dy = geo.sy[j] - geo.sy[i];
          const len = Math.hypot(dx, dy) || 1;
          const de = Math.max(sea, world.elevation[j]) - e;
          gx += (dx / len) * de;
          gy += (dy / len) * de;
        }
        const lum = -(gx * lightDir[0] + gy * lightDir[1]) / 40;
        const s = Math.max(-2, Math.min(2, Math.round(lum * 2.2)));
        const t = (e - sea) / (255 - sea);
        void sea;
        const band = Math.min(3, Math.floor(t * 4));
        let base = biomeRgb[world.biome[i]] ?? [200, 190, 160];
        base = shade(base, band * 0.05 + s * 0.07);
        if (dark) base = mix(base, night, 0.62);
        c = base;
      }
      const key = rgb(c[0], c[1], c[2]);
      let p = groups.get(key);
      if (!p) { p = new Path2D(); groups.set(key, p); }
      addCellToPath(geo, p, i);
    }
    this.terrain = [...groups.entries()].map(([color, path]) => ({ color, path }));

    const coast = new Path2D();
    for (let e = 0; e < geo.edgeCount; e++) {
      if (geo.land[geo.edgeA[e]] !== geo.land[geo.edgeB[e]]) {
        coast.moveTo(geo.edgeXY[4 * e], geo.edgeXY[4 * e + 1]);
        coast.lineTo(geo.edgeXY[4 * e + 2], geo.edgeXY[4 * e + 3]);
      }
    }
    this.coast = coast;

    const byWidth = new Map<number, Path2D>();
    for (const r of world.rivers) {
      const cells = r.cells;
      if (cells.length < 2) continue;
      // split into runs of constant width, drawn as smoothed curves through midpoints
      let k = 0;
      while (k < cells.length - 1) {
        const w = r.width[k] ?? 1;
        let end = k + 1;
        while (end < cells.length - 1 && (r.width[end] ?? 1) === w) end++;
        let p = byWidth.get(w);
        if (!p) { p = new Path2D(); byWidth.set(w, p); }
        const X = (c: number) => geo.sx[c], Y = (c: number) => geo.sy[c];
        const a = cells[k];
        const startX = k === 0 ? X(a) : (X(cells[k - 1]) + X(a)) / 2;
        const startY = k === 0 ? Y(a) : (Y(cells[k - 1]) + Y(a)) / 2;
        p.moveTo(startX, startY);
        for (let m = k; m < end; m++) {
          const c0 = cells[m], c1 = cells[m + 1];
          const mx = (X(c0) + X(c1)) / 2, my = (Y(c0) + Y(c1)) / 2;
          p.quadraticCurveTo(X(c0), Y(c0), mx, my);
        }
        if (end === cells.length - 1) p.lineTo(X(cells[end]), Y(cells[end]));
        else {
          const c0 = cells[end], c1 = cells[end + 1];
          p.quadraticCurveTo(X(c0), Y(c0), (X(c0) + X(c1)) / 2, (Y(c0) + Y(c1)) / 2);
        }
        k = end;
      }
    }
    this.rivers = [...byWidth.entries()].sort((a, b) => a[0] - b[0]).map(([width, path]) => ({ width, path }));
  }

  setTheme(t: 'light' | 'dark') {
    if (t === this.theme) return;
    this.theme = t;
    this.yearCache.clear();
    this.buildStatic();
    this.invalidate();
  }

  // ---------------------------------------------------------------- view
  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const first = this.w === 0;
    const oldW = this.w, oldH = this.h;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.updateFitScale();
    if (first) this.fit();
    else {
      // keep the centre fixed
      const cx = (oldW / 2 - this.tx) / this.scale, cy = (oldH / 2 - this.ty) / this.scale;
      this.scale = Math.max(this.scale, this.fitScale * 0.9);
      this.tx = this.w / 2 - cx * this.scale;
      this.ty = this.h / 2 - cy * this.scale;
      this.clampPan();
    }
    this.invalidate();
  }

  private get availW() { return Math.max(120, this.w - this.insetRight); }
  private get availH() { return Math.max(120, this.h - this.insetBottom); }

  private updateFitScale() {
    const { width, height } = this.d.geo;
    this.fitScale = Math.min(this.availW / width, this.availH / height) * 0.98;
  }

  setInsets(right: number, bottom: number) {
    if (right === this.insetRight && bottom === this.insetBottom) return;
    const cx = (this.availW / 2 - this.tx) / this.scale, cy = (this.availH / 2 - this.ty) / this.scale;
    this.insetRight = right;
    this.insetBottom = bottom;
    if (this.w === 0) return;
    this.updateFitScale();
    this.tx = this.availW / 2 - cx * this.scale;
    this.ty = this.availH / 2 - cy * this.scale;
    this.clampPan();
    this.invalidate();
  }

  fit() {
    const { width, height } = this.d.geo;
    this.updateFitScale();
    const aw = this.availW, ah = this.availH;
    // On portrait screens, zoom in so the land fills the height and crop the sides.
    const portrait = ah / height > (aw / width) * 1.25;
    const k = portrait ? Math.min(3, Math.max(1, ((ah / height) / (aw / width)) * 0.94)) : 1;
    this.scale = this.fitScale * k;
    const cx = portrait ? this.landCx : width / 2, cy = portrait ? this.landCy : height / 2;
    this.tx = aw / 2 - cx * this.scale;
    this.ty = ah / 2 - cy * this.scale;
    this.clampPan();
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const ns = Math.max(this.fitScale * 0.85, Math.min(this.fitScale * 18, this.scale * factor));
    const f = ns / this.scale;
    this.tx = sx - (sx - this.tx) * f;
    this.ty = sy - (sy - this.ty) * f;
    this.scale = ns;
    this.clampPan();
    this.invalidate();
  }

  pan(dx: number, dy: number) {
    this.tx += dx;
    this.ty += dy;
    this.clampPan();
    this.invalidate();
  }

  private clampPan() {
    const { width, height } = this.d.geo;
    const ww = width * this.scale, wh = height * this.scale;
    const aw = this.availW, ah = this.availH;
    const m = 48;
    if (ww <= aw) this.tx = Math.min(aw - ww + m, Math.max(-m, this.tx));
    else this.tx = Math.min(m, Math.max(aw - ww - m, this.tx));
    if (wh <= ah) this.ty = Math.min(ah - wh + m, Math.max(-m, this.ty));
    else this.ty = Math.min(m, Math.max(ah - wh - m, this.ty));
  }

  centerOn(wx: number, wy: number, zoom?: number) {
    if (zoom) this.scale = Math.max(this.scale, this.fitScale * zoom);
    this.tx = this.availW / 2 - wx * this.scale;
    this.ty = this.availH / 2 - wy * this.scale;
    this.clampPan();
    this.invalidate();
  }

  /** Is a world point comfortably inside the unobstructed area? */
  inView(wx: number, wy: number, margin = 60): boolean {
    const [x, y] = this.toScreen(wx, wy);
    return x > margin && y > margin && x < this.availW - margin && y < this.availH - margin;
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.tx) / this.scale, (sy - this.ty) / this.scale];
  }
  toScreen(wx: number, wy: number): [number, number] {
    return [wx * this.scale + this.tx, wy * this.scale + this.ty];
  }

  invalidate() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  // ---------------------------------------------------------------- time-dependent geometry
  layerState(): LayerState {
    return this.d.layers[this.layer];
  }

  ownerAt(cell: number, layer: LayerName = this.layer): number {
    return this.d.layers[layer].at(this.year)[cell];
  }

  polityName(idx: number, year = this.year): string {
    const p = this.d.timeline.polities[idx];
    const legend = this.d.timeline.layers.political.legend[idx];
    if (!p || !p.names.length) return legend?.name ?? '';
    let name = p.names[0][1];
    for (const [y, nm] of p.names) if (y <= year) name = nm; else break;
    return name;
  }

  private geomFor(): YearGeom {
    const key = `${this.layer}:${this.year}`;
    let g = this.yearCache.get(key);
    if (g) return g;
    const { geo } = this.d;
    const layer = this.layerState();
    const legend = layer.layer.legend;
    const state = layer.at(this.year);
    const dark = this.theme === 'dark';
    const fillAlpha = this.layer === 'political' ? (dark ? 0.5 : 0.46) : dark ? 0.55 : 0.5;

    const paths = new Map<number, Path2D>();
    const counts = new Map<number, number>();
    for (let i = 0; i < geo.n; i++) {
      const o = state[i];
      if (o < 0 || !geo.land[i]) continue;
      let p = paths.get(o);
      if (!p) { p = new Path2D(); paths.set(o, p); }
      addCellToPath(geo, p, i);
      counts.set(o, (counts.get(o) ?? 0) + 1);
    }
    const fills = [...paths.entries()].map(([idx, path]) => ({ idx, color: alpha(legend[idx]?.color ?? '#888888', fillAlpha), path }));

    const borders = new Path2D();
    const frontierPaths = new Map<number, Path2D>();
    for (let e = 0; e < geo.edgeCount; e++) {
      const a = geo.edgeA[e], b = geo.edgeB[e];
      if (!geo.land[a] || !geo.land[b]) continue;
      const oa = state[a], ob = state[b];
      if (oa === ob) continue;
      const x1 = geo.edgeXY[4 * e], y1 = geo.edgeXY[4 * e + 1], x2 = geo.edgeXY[4 * e + 2], y2 = geo.edgeXY[4 * e + 3];
      if (oa >= 0 && ob >= 0) {
        borders.moveTo(x1, y1);
        borders.lineTo(x2, y2);
      } else {
        const o = oa >= 0 ? oa : ob;
        let p = frontierPaths.get(o);
        if (!p) { p = new Path2D(); frontierPaths.set(o, p); }
        p.moveTo(x1, y1);
        p.lineTo(x2, y2);
      }
    }
    const frontiers = [...frontierPaths.entries()].map(([idx, path]) => {
      const c = hexToRgb(legend[idx]?.color ?? '#888888');
      const d = dark ? shade(c, 0.25) : shade(c, -0.35);
      return { idx, color: `rgba(${d[0] | 0},${d[1] | 0},${d[2] | 0},0.85)`, path };
    });

    // labels: largest connected component per category
    const labels: Label[] = [];
    const seen = new Uint8Array(geo.n);
    const best = new Map<number, { cells: number[] }>();
    for (let i = 0; i < geo.n; i++) {
      const o = state[i];
      if (o < 0 || seen[i] || !geo.land[i]) continue;
      const comp: number[] = [];
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        comp.push(c);
        for (let k = geo.nbrStart[c]; k < geo.nbrStart[c + 1]; k++) {
          const j = geo.nbrs[k];
          if (!seen[j] && state[j] === o && geo.land[j]) { seen[j] = 1; stack.push(j); }
        }
      }
      const cur = best.get(o);
      if (!cur || cur.cells.length < comp.length) best.set(o, { cells: comp });
    }
    for (const [idx, { cells }] of best) {
      if (cells.length < 4) continue;
      let cx = 0, cy = 0;
      for (const c of cells) { cx += geo.sx[c]; cy += geo.sy[c]; }
      cx /= cells.length; cy /= cells.length;
      // pick the interior-most cell near the centroid (prefer cells whose neighbours share the owner)
      let bc = cells[0], bd = Infinity;
      for (const c of cells) {
        let interior = 0;
        for (let k = geo.nbrStart[c]; k < geo.nbrStart[c + 1]; k++) if (state[geo.nbrs[k]] === idx) interior++;
        const deg = geo.nbrStart[c + 1] - geo.nbrStart[c];
        const d = (geo.sx[c] - cx) ** 2 + (geo.sy[c] - cy) ** 2 + (deg - interior) * 900;
        if (d < bd) { bd = d; bc = c; }
      }
      const name = this.layer === 'political' ? this.polityName(idx) : legend[idx]?.name ?? '';
      const m = name.match(KICKERS);
      labels.push({ text: (m ? m[2] : name), kicker: m ? m[1] + ' of' : '', x: geo.sx[bc], y: geo.sy[bc], cells: cells.length, idx });
    }
    labels.sort((a, b) => b.cells - a.cells);
    void counts;
    g = { fills, borders, frontiers, labels, state };
    this.yearCache.set(key, g);
    if (this.yearCache.size > 40) this.yearCache.delete(this.yearCache.keys().next().value as string);
    return g;
  }

  private capitalsAt(year: number): Set<number> {
    const k = year;
    let s = this.capitalsCache.get(k);
    if (s) return s;
    s = new Set();
    const legend = this.d.timeline.layers.political.legend;
    for (const p of this.d.timeline.polities) {
      const l = legend[p.idx];
      if (!l || l.start > year || l.end < year) continue;
      let cap = -1;
      for (const [y, si] of p.capitals) if (y <= year) cap = si; else break;
      if (cap >= 0) s.add(cap);
    }
    this.capitalsCache.set(k, s);
    if (this.capitalsCache.size > 64) this.capitalsCache.delete(this.capitalsCache.keys().next().value as number);
    return s;
  }

  static popAt(pop: [number, number][], year: number): number {
    if (!pop.length) return 0;
    if (year <= pop[0][0]) return pop[0][1];
    for (let i = 1; i < pop.length; i++) {
      if (pop[i][0] >= year) {
        const [y0, p0] = pop[i - 1], [y1, p1] = pop[i];
        return p0 + ((p1 - p0) * (year - y0)) / Math.max(1, y1 - y0);
      }
    }
    return pop[pop.length - 1][1];
  }

  /** Events visible as markers at the current year. */
  visibleEvents(): TimelineJson['events'] {
    const zoom = this.scale / this.fitScale;
    const minSig = zoom > 5 ? 0 : zoom > 2.5 ? 0.2 : zoom > 1.4 ? 0.32 : 0.45;
    const win = 60;
    // binary search for first event with year >= Y - window
    let lo = 0, hi = this.eventYearIdx.length;
    const from = this.year - win;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.eventYearIdx[m] < from) lo = m + 1; else hi = m; }
    const out: TimelineJson['events'] = [];
    for (let i = lo; i < this.eventsSorted.length && this.eventsSorted[i].year <= this.year; i++) {
      const e = this.eventsSorted[i];
      if (e.cell < 0) continue;
      if (e.sig < minSig && e.id !== this.selected) continue;
      out.push(e);
    }
    // ongoing long events (wars) that began earlier
    for (let i = lo - 1; i >= 0 && i > lo - 400; i--) {
      const e = this.eventsSorted[i];
      if (e.end >= this.year && e.cell >= 0 && e.sig >= minSig) out.push(e);
    }
    return out;
  }

  // ---------------------------------------------------------------- draw
  /** Duration of recent draws in ms (for the perf probe in scripts/shoot.ts). */
  drawTimes: number[] = [];

  private draw() {
    const t0 = performance.now();
    this.drawInner();
    this.drawTimes.push(performance.now() - t0);
    if (this.drawTimes.length > 240) this.drawTimes.shift();
  }

  private drawInner() {
    const { ctx, dpr } = this;
    const { geo, timeline } = this.d;
    const dark = this.theme === 'dark';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = dark ? '#0c1015' : '#e6ddca';
    ctx.fillRect(0, 0, this.w, this.h);
    {
      // the map sheet's shadow on the table
      const [x0, y0] = this.toScreen(0, 0), [x1, y1] = this.toScreen(geo.width, geo.height);
      ctx.save();
      ctx.shadowColor = dark ? 'rgba(0,0,0,0.6)' : 'rgba(80,60,30,0.25)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = this.deepWater;
      ctx.fillRect(x0 - 9, y0 - 9, x1 - x0 + 18, y1 - y0 + 18);
      ctx.restore();
      ctx.fillStyle = dark ? '#1a2029' : '#f6f0e2';
      ctx.fillRect(x0 - 9, y0 - 9, x1 - x0 + 18, y1 - y0 + 18);
    }

    // world-space layers
    ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.tx, dpr * this.ty);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, geo.width, geo.height);
    ctx.clip();
    const px = 1 / this.scale;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const t of this.terrain) {
      ctx.fillStyle = t.color;
      ctx.fill(t.path);
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 0.6 * px;
      ctx.stroke(t.path);
    }

    const g = this.geomFor();
    for (const f of g.fills) {
      ctx.fillStyle = f.color;
      ctx.fill(f.path);
    }

    // rivers
    const zoom = this.scale / this.fitScale;
    ctx.strokeStyle = dark ? 'rgba(92,140,170,0.9)' : 'rgba(84,128,152,0.85)';
    for (const r of this.rivers) {
      ctx.lineWidth = (0.35 + r.width * 0.32) * Math.min(2.2, Math.sqrt(zoom)) * px;
      ctx.stroke(r.path);
    }

    // coast
    ctx.strokeStyle = dark ? 'rgba(200,190,160,0.32)' : 'rgba(70,58,42,0.55)';
    ctx.lineWidth = 0.9 * px;
    ctx.stroke(this.coast);

    // borders
    ctx.strokeStyle = dark ? 'rgba(236,227,207,0.38)' : 'rgba(40,30,20,0.42)';
    ctx.lineWidth = 0.9 * px;
    ctx.setLineDash([]);
    ctx.stroke(g.borders);
    for (const f of g.frontiers) {
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 1.2 * px;
      ctx.stroke(f.path);
    }

    // selection outline
    const sel = this.selected;
    if (sel) {
      const accent = dark ? '#f0b08f' : '#7a1f12';
      if (sel.startsWith('pol:') || sel.startsWith('cul:') || sel.startsWith('mov:')) {
        const layerName: LayerName = sel.startsWith('pol:') ? 'political' : sel.startsWith('cul:') ? 'culture' : 'religion';
        const legend = timeline.layers[layerName].legend;
        const idx = legend.find((l) => l.id === sel)?.idx ?? -1;
        if (idx >= 0) {
          const st = this.d.layers[layerName].at(this.year);
          const p = new Path2D();
          for (let e = 0; e < geo.edgeCount; e++) {
            const a = geo.edgeA[e], b = geo.edgeB[e];
            if ((st[a] === idx) !== (st[b] === idx) && (geo.land[a] || geo.land[b])) {
              p.moveTo(geo.edgeXY[4 * e], geo.edgeXY[4 * e + 1]);
              p.lineTo(geo.edgeXY[4 * e + 2], geo.edgeXY[4 * e + 3]);
            }
          }
          ctx.strokeStyle = dark ? 'rgba(17,21,27,0.8)' : 'rgba(251,248,241,0.9)';
          ctx.lineWidth = 4.5 * px;
          ctx.stroke(p);
          ctx.strokeStyle = accent;
          ctx.lineWidth = 2.2 * px;
          ctx.stroke(p);
        }
      } else if (sel.startsWith('cell:')) {
        const c = Number(sel.slice(5));
        if (c >= 0 && c < geo.n) {
          const p = new Path2D();
          addCellToPath(geo, p, c);
          ctx.strokeStyle = accent;
          ctx.lineWidth = 2 * px;
          ctx.stroke(p);
        }
      }
    }
    if (this.hoverCell >= 0 && geo.land[this.hoverCell]) {
      const p = new Path2D();
      addCellToPath(geo, p, this.hoverCell);
      ctx.fillStyle = dark ? 'rgba(255,240,210,0.12)' : 'rgba(255,255,255,0.28)';
      ctx.fill(p);
    }

    // trade routes
    if (this.showRoutes) {
      const century = Math.floor(this.year / 100) * 100;
      const rs = timeline.routes.find((r) => r.year === century) ?? timeline.routes.filter((r) => r.year <= this.year).pop();
      if (rs) {
        ctx.setLineDash([5 * px, 4 * px]);
        for (const [a, b, v] of rs.edges) {
          const sa = timeline.settlements[a], sb = timeline.settlements[b];
          if (!sa || !sb) continue;
          ctx.strokeStyle = dark ? `rgba(232,190,120,${0.35 + v * 0.5})` : `rgba(122,74,28,${0.35 + v * 0.5})`;
          ctx.lineWidth = (0.6 + v * 2.2) * px;
          const x1 = geo.sx[sa.cell], y1 = geo.sy[sa.cell], x2 = geo.sx[sb.cell], y2 = geo.sy[sb.cell];
          const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12, my = (y1 + y2) / 2 - (x2 - x1) * 0.12;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(mx, my, x2, y2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    ctx.restore();

    // ---------------- screen-space overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    {
      // neatline: a double rule around the map sheet
      const [x0, y0] = this.toScreen(0, 0), [x1, y1] = this.toScreen(geo.width, geo.height);
      ctx.strokeStyle = dark ? 'rgba(236,227,207,0.45)' : 'rgba(40,30,20,0.6)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0));
      ctx.lineWidth = 1.6;
      ctx.strokeRect(Math.round(x0) - 5, Math.round(y0) - 5, Math.round(x1 - x0) + 10, Math.round(y1 - y0) + 10);
    }
    this.markerHits = [];
    const occupied: [number, number, number, number][] = [];
    const collides = (x: number, y: number, w: number, h: number) => {
      for (const o of occupied) if (x < o[0] + o[2] && x + w > o[0] && y < o[1] + o[3] && y + h > o[1]) return true;
      return false;
    };
    const onScreen = (x: number, y: number, m = 40) => x > -m && y > -m && x < this.w + m && y < this.h + m;

    // settlements
    const caps = this.capitalsAt(this.year);
    const live: { idx: number; x: number; y: number; pop: number; cap: boolean }[] = [];
    for (const s of timeline.settlements) {
      if (s.start > this.year || (s.end < this.year && s.end < 5000)) continue;
      const [x, y] = this.toScreen(geo.sx[s.cell], geo.sy[s.cell]);
      if (!onScreen(x, y)) continue;
      live.push({ idx: s.idx, x, y, pop: MapRenderer.popAt(s.pop, this.year), cap: caps.has(s.idx) });
    }
    live.sort((a, b) => Number(b.cap) - Number(a.cap) || b.pop - a.pop);
    const ink = dark ? '#ece3cf' : '#1f1a14';
    const paper = dark ? '#11151b' : '#fbf8f1';
    const dotScale = Math.min(1.8, 0.75 + zoom * 0.2);
    for (const s of live) {
      const r = Math.max(1.6, Math.min(5.5, 1.2 + Math.sqrt(s.pop) / 90)) * dotScale;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + (s.cap ? 1.6 : 0.9), 0, Math.PI * 2);
      ctx.fillStyle = paper;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = ink;
      ctx.fill();
      if (s.cap) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
      const id = timeline.settlements[s.idx].id;
      if (id === sel) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 7, 0, Math.PI * 2);
        ctx.strokeStyle = dark ? '#f0b08f' : '#7a1f12';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      this.markerHits.push({ x: s.x, y: s.y, r: Math.max(9, r + 4), hit: { type: 'settlement', id, idx: s.idx, cell: timeline.settlements[s.idx].cell } });
    }

    // polity / layer labels
    const css = getComputedStyle(document.documentElement);
    const display = css.getPropertyValue('--font-display') || 'serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cellArea = (this.d.geo.width * this.d.geo.height) / this.d.geo.n;
    for (const l of g.labels) {
      const [x, y] = this.toScreen(l.x, l.y);
      if (!onScreen(x, y, 0)) continue;
      const areaPx = l.cells * cellArea * this.scale * this.scale;
      const size = Math.max(9.5, Math.min(26, Math.sqrt(areaPx) / 7.5));
      const text = l.text.toUpperCase();
      ctx.font = `600 ${size.toFixed(1)}px ${display}`;
      const spacing = size * 0.14;
      const tw = ctx.measureText(text).width + spacing * text.length;
      if (tw > Math.sqrt(areaPx) * 2.4 && size <= 9.5) continue;
      const kickSize = Math.max(8.5, size * 0.52);
      const h = size + (l.kicker ? kickSize + 2 : 0);
      const bx = x - tw / 2 - 2, by = y - h / 2 - 2;
      if (collides(bx, by, tw + 4, h + 4)) continue;
      occupied.push([bx, by, tw + 4, h + 4]);
      const ty = l.kicker ? y + (kickSize + 2) / 2 : y;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = dark ? 'rgba(17,21,27,0.75)' : 'rgba(251,248,241,0.78)';
      ctx.fillStyle = dark ? 'rgba(244,234,214,0.95)' : 'rgba(38,28,18,0.92)';
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${spacing.toFixed(1)}px`;
      ctx.strokeText(text, x, ty);
      ctx.fillText(text, x, ty);
      if (l.kicker) {
        ctx.font = `italic 500 ${kickSize.toFixed(1)}px ${display}`;
        (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
        ctx.strokeText(l.kicker, x, ty - size / 2 - kickSize / 2 - 1);
        ctx.fillText(l.kicker, x, ty - size / 2 - kickSize / 2 - 1);
      }
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
    }

    // settlement labels
    const maxSettLabels = zoom > 4 ? 60 : zoom > 2 ? 28 : 10;
    let shown = 0;
    ctx.textAlign = 'left';
    for (const s of live) {
      if (shown >= maxSettLabels) break;
      const name = timeline.settlements[s.idx].name;
      const fs = s.cap ? 13 : 11.5;
      ctx.font = `${s.cap ? 600 : 500} ${fs}px ${display}`;
      const tw = ctx.measureText(name).width;
      const lx = s.x + 6, ly = s.y - 1;
      if (collides(lx - 1, ly - fs / 2 - 1, tw + 2, fs + 2)) continue;
      occupied.push([lx - 1, ly - fs / 2 - 1, tw + 2, fs + 2]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = dark ? 'rgba(17,21,27,0.85)' : 'rgba(251,248,241,0.85)';
      ctx.fillStyle = ink;
      ctx.strokeText(name, lx, ly);
      ctx.fillText(name, lx, ly);
      shown++;
    }

    // event markers
    for (const e of this.visibleEvents()) {
      const [x, y] = this.toScreen(geo.sx[e.cell], geo.sy[e.cell]);
      if (!onScreen(x, y)) continue;
      const st = EVENT_STYLE[e.sub] ?? DEFAULT_EVENT;
      const age = Math.max(0, this.year - Math.max(e.year, Math.min(e.end, this.year)));
      const a = Math.max(0.25, 1 - age / 70);
      const r = 3.6 + e.sig * 3.2;
      ctx.globalAlpha = a;
      this.glyph(st.shape, x, y, r, st.color, paper);
      ctx.globalAlpha = 1;
      if (e.id === sel) {
        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = dark ? '#f0b08f' : '#7a1f12';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      this.markerHits.push({ x, y, r: Math.max(10, r + 4), hit: { type: 'event', id: e.id, cell: e.cell } });
    }
    this.onDraw?.();
  }

  private glyph(shape: string, x: number, y: number, r: number, color: string, halo: string) {
    const ctx = this.ctx;
    ctx.beginPath();
    switch (shape) {
      case 'diamond':
        ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
        break;
      case 'square':
        ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
        break;
      case 'triangle':
        ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.95, y + r * 0.75); ctx.lineTo(x - r * 0.95, y + r * 0.75); ctx.closePath();
        break;
      case 'cross': {
        const k = r * 0.38;
        ctx.moveTo(x - r, y - r + k); ctx.lineTo(x - r + k, y - r); ctx.lineTo(x, y - k); ctx.lineTo(x + r - k, y - r); ctx.lineTo(x + r, y - r + k);
        ctx.lineTo(x + k, y); ctx.lineTo(x + r, y + r - k); ctx.lineTo(x + r - k, y + r); ctx.lineTo(x, y + k); ctx.lineTo(x - r + k, y + r);
        ctx.lineTo(x - r, y + r - k); ctx.lineTo(x - k, y); ctx.closePath();
        break;
      }
      case 'star':
        for (let i = 0; i < 10; i++) {
          const rr = i % 2 ? r * 0.45 : r;
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          if (i === 0) ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); else ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
        }
        ctx.closePath();
        break;
      default:
        ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
    }
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = halo;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // ---------------------------------------------------------------- hit testing
  hit(sx: number, sy: number): Hit {
    let best: Hit | null = null;
    let bd = Infinity;
    for (const m of this.markerHits) {
      const d = Math.hypot(m.x - sx, m.y - sy);
      if (d <= m.r && d < bd) {
        // prefer events over settlements at equal distance
        bd = d - (m.hit.type === 'event' ? 2 : 0);
        best = m.hit;
      }
    }
    if (best) return best;
    const [wx, wy] = this.toWorld(sx, sy);
    return { type: 'cell', cell: this.d.geo.delaunay.find(wx, wy) };
  }

  cellAt(sx: number, sy: number): number {
    const [wx, wy] = this.toWorld(sx, sy);
    if (wx < 0 || wy < 0 || wx > this.d.geo.width || wy > this.d.geo.height) return -1;
    return this.d.geo.delaunay.find(wx, wy);
  }

  polityIdx(id: string): number {
    return this.polityIdxById.get(id) ?? -1;
  }
  settlementIdx(id: string): number {
    return this.settlementById.get(id) ?? -1;
  }
}
