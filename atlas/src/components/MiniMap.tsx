import { useEffect, useRef, useState } from 'preact/hooks';
import { addCellToPath, type Geo } from '../geo.ts';
import { ensureMapData, ensurePoliticalYear, layersVersion, mapData } from '../store.ts';
import { theme } from '../state.ts';
import type { MapData } from '../views/mapRenderer.ts';

const landCache = new WeakMap<Geo, Path2D>();
function landPath(geo: Geo): Path2D {
  let p = landCache.get(geo);
  if (!p) {
    p = new Path2D();
    for (let i = 0; i < geo.n; i++) if (geo.land[i]) addCellToPath(geo, p, i);
    landCache.set(geo, p);
  }
  return p;
}

function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '');
  return `rgba(${parseInt(m.slice(0, 2), 16)},${parseInt(m.slice(2, 4), 16)},${parseInt(m.slice(4, 6), 16)},${a})`;
}

/** Bounding box (world units) of a polity's cells at a year, padded; null if it held none. */
export function polityBox(d: MapData, idx: number, year: number): [number, number, number, number] | null {
  const st = d.layers.political.at(year);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < d.geo.n; i++) if (st[i] === idx) {
    x0 = Math.min(x0, d.geo.sx[i]); y0 = Math.min(y0, d.geo.sy[i]); x1 = Math.max(x1, d.geo.sx[i]); y1 = Math.max(y1, d.geo.sy[i]);
  }
  if (x0 === Infinity) return null;
  const w = Math.max(220, x1 - x0), h = Math.max(150, y1 - y0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return [cx - w * 0.75, cy - h * 0.75, cx + w * 0.75, cy + h * 0.75];
}

/**
 * A small static map of the political layer at `year`. With `highlight`, only that polity is coloured
 * (neighbours faintly shaded); `box` frames a region in world units.
 */
export function MiniMap({ year, highlight, box, height = 220, label }: {
  year: number; highlight?: string | null; box?: [number, number, number, number] | null; height?: number; label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(0);
  const [ready, setReady] = useState(false);
  const d = mapData.value;
  const lv = layersVersion.value;
  useEffect(() => { ensureMapData().catch(() => {}); }, []);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    setReady(false);
    ensurePoliticalYear(year).then(() => { if (live) setReady(true); }).catch(() => {});
    return () => { live = false; };
  }, [year, d]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !d || !w || !ready) return;
    const dark = theme.value === 'dark';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(height * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${height}px`;
    const ctx = c.getContext('2d')!;
    const geo = d.geo;
    const [bx0, by0, bx1, by1] = box ?? [0, 0, geo.width, geo.height];
    const s = Math.min(w / (bx1 - bx0), height / (by1 - by0));
    const tx = (w - (bx1 - bx0) * s) / 2 - bx0 * s, ty = (height - (by1 - by0) * s) / 2 - by0 * s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = dark ? '#16202a' : '#b9cad0';
    ctx.fillRect(0, 0, w, height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);
    const land = landPath(geo);
    ctx.fillStyle = dark ? '#2a2f36' : '#e4dccb';
    ctx.fill(land);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 0.8 / s;
    ctx.stroke(land);
    const st = d.layers.political.at(year);
    const hiIdx = highlight ? d.layers.political.layer.legend.find((l) => l.id === highlight)?.idx ?? -1 : -1;
    const groups = new Map<number, Path2D>();
    for (let i = 0; i < geo.n; i++) {
      const o = st[i];
      if (o < 0 || !geo.land[i]) continue;
      const key = highlight ? (o === hiIdx ? 1 : 0) : o;
      let p = groups.get(key);
      if (!p) { p = new Path2D(); groups.set(key, p); }
      addCellToPath(geo, p, i);
    }
    for (const [key, p] of groups) {
      let color: string;
      if (highlight) color = key === 1 ? hexA(d.layers.political.byIdx.get(hiIdx)?.color ?? '#8e2f1f', 0.85) : (dark ? 'rgba(236,227,207,0.07)' : 'rgba(60,40,20,0.08)');
      else color = hexA(d.layers.political.byIdx.get(key)?.color ?? '#888888', dark ? 0.62 : 0.55);
      ctx.fillStyle = color;
      ctx.fill(p);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.6 / s;
      ctx.stroke(p);
    }
    if (highlight && hiIdx >= 0) {
      // outline the polity
      const out = new Path2D();
      for (let e = 0; e < geo.edgeCount; e++) {
        const a = geo.edgeA[e], b = geo.edgeB[e];
        if ((st[a] === hiIdx) !== (st[b] === hiIdx)) { out.moveTo(geo.edgeXY[4 * e], geo.edgeXY[4 * e + 1]); out.lineTo(geo.edgeXY[4 * e + 2], geo.edgeXY[4 * e + 3]); }
      }
      ctx.strokeStyle = dark ? 'rgba(240,176,143,0.95)' : 'rgba(90,28,16,0.9)';
      ctx.lineWidth = 1.4 / s;
      ctx.stroke(out);
    }
  }, [d, w, ready, year, highlight, box?.join(','), theme.value, lv, height]);

  return (
    <div class="minimap">
      <canvas ref={ref} role="img" aria-label={label} />
      {(!d || !ready) && <div class="minimap__wait"><div class="spinner" /></div>}
    </div>
  );
}
