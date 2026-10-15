import { useEffect, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import { route, layer, selection, showRoutes, theme, year, type LayerName, isMobile, panelCollapsed, PANEL_W, SHEET_PEEK, sheetSnap } from '../state.ts';
import { ensureLayer, ensureMapData, ensurePoliticalYear, eraAt, firstPaint, layersVersion, legendOf, mapData, meta } from '../store.ts';
import { MapRenderer, type Hit } from './mapRenderer.ts';
import { MapPanel } from './MapPanel.tsx';
import { TimeSlider } from './TimeSlider.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { maybeAutoTour, TourOverlay, touring } from '../components/Tour.tsx';

const LAYERS: { id: LayerName; label: string }[] = [
  { id: 'political', label: 'Political' },
  { id: 'culture', label: 'Peoples' },
  { id: 'religion', label: 'Faiths' },
  { id: 'language', label: 'Languages' },
];

export function MapView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendRef = useRef<MapRenderer | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub: string } | null>(null);
  const d = mapData.value;

  useEffect(() => { ensureMapData().catch(() => {}); }, []);

  // create renderer once data arrives
  useEffect(() => {
    if (!d || !canvasRef.current) return;
    const r = new MapRenderer(canvasRef.current, d, theme.peek());
    rendRef.current = r;
    (window as unknown as { __palimpsestMap?: MapRenderer }).__palimpsestMap = r;
    const ogMode = route.peek().params.get('og') === '1';
    const framesMode = route.peek().params.get('frames') === '1';
    if (framesMode) {
      r.wholeWorld = true;
      (window as unknown as { __palimpsestSetYear?: (y: number) => Promise<void> }).__palimpsestSetYear = (y: number) => new Promise((res) => {
        ensurePoliticalYear(y).then(() => {
          year.value = y;
          requestAnimationFrame(() => requestAnimationFrame(() => res()));
        });
      });
    }
    const insets = () => (route.peek().params.get('clean') === '1' || ogMode || framesMode ? [0, 0] : isMobile.peek() ? [0, sheetSnap.peek() === 'peek' ? SHEET_PEEK : Math.round((wrapRef.current?.clientHeight ?? 600) * 0.5)] : [panelCollapsed.peek() ? 0 : PANEL_W + 24, 0]);
    [r.insetRight, r.insetBottom] = insets();
    if (ogMode) { r.insetLeft = 390; r.wholeWorld = true; }
    r.year = year.peek();
    r.layer = layer.peek();
    r.selected = selection.peek();
    r.showRoutes = showRoutes.peek();
    r.resize();
    // focus selection on first load if it has a location
    focusSelection(r, selection.peek(), false);
    if (!selection.peek()) requestAnimationFrame(() => maybeAutoTour());
    const ro = new ResizeObserver(() => r.resize());
    ro.observe(wrapRef.current!);
    const disposeInsets = effect(() => {
      isMobile.value;
      panelCollapsed.value;
      sheetSnap.value;
      const [ir, ib] = insets();
      r.setInsets(ir, ib, ogMode ? 390 : 0);
    });
    let lastVersion = layersVersion.peek();
    r.onDraw = () => { if (!firstPaint.peek()) firstPaint.value = true; };
    // labels are measured with the display font: redraw once web fonts arrive
    document.fonts?.ready.then(() => r.clearCaches());
    const onFonts = () => r.invalidate();
    document.fonts?.addEventListener?.('loadingdone', onFonts);
    const dispose = effect(() => {
      r.year = year.value;
      if (layersVersion.value !== lastVersion) {
        lastVersion = layersVersion.peek();
        const hadEvents = r.eventCount();
        r.clearCaches();
        // a deep link to an event can only be centred once the events have arrived
        if (!hadEvents && r.eventCount() && selection.peek()?.startsWith('evt:')) focusSelection(r, selection.peek(), false);
      }
      const want = layer.value;
      if (d.layers[want]) r.layer = want;
      else ensureLayer(want).catch(() => {});
      r.selected = selection.value;
      r.showRoutes = showRoutes.value;
      r.setTheme(theme.value);
      r.invalidate();
    });
    return () => { ro.disconnect(); dispose(); disposeInsets(); document.fonts?.removeEventListener?.('loadingdone', onFonts); rendRef.current = null; };
  }, [d]);

  // pointer interactions: pan, pinch, wheel, tap
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !d) return;
    const pts = new Map<number, { x: number; y: number }>();
    let downAt = { x: 0, y: 0, t: 0, moved: false };
    let pinchDist = 0;
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      const p = local(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) downAt = { x: p.x, y: p.y, t: performance.now(), moved: false };
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        downAt.moved = true;
      }
    };
    const onMove = (e: PointerEvent) => {
      const r = rendRef.current;
      if (!r) return;
      const p = local(e);
      if (!pts.has(e.pointerId)) {
        if (e.pointerType === 'mouse') hover(r, p.x, p.y);
        return;
      }
      const prev = pts.get(e.pointerId)!;
      pts.set(e.pointerId, p);
      if (pts.size === 1) {
        if (Math.hypot(p.x - downAt.x, p.y - downAt.y) > 4) downAt.moved = true;
        if (downAt.moved) { r.pan(p.x - prev.x, p.y - prev.y); setTip(null); }
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (pinchDist > 0) r.zoomAt(mx, my, dist / pinchDist);
        r.pan((p.x - prev.x) / 2, (p.y - prev.y) / 2);
        pinchDist = dist;
      }
    };
    const onUp = (e: PointerEvent) => {
      const r = rendRef.current;
      const wasSingle = pts.size === 1;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinchDist = 0;
      if (!r || !wasSingle || downAt.moved || performance.now() - downAt.t > 600) return;
      const p = local(e);
      tap(r, r.hit(p.x, p.y));
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = rendRef.current;
      if (!r) return;
      const p = local(e);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      r.zoomAt(p.x, p.y, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
    };
    const onLeave = () => { setTip(null); const r = rendRef.current; if (r) { r.hoverCell = -1; r.invalidate(); } };
    const onDbl = (e: MouseEvent) => { const r = rendRef.current; if (!r) return; const p = local(e); r.zoomAt(p.x, p.y, 2); };
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('wheel', onWheel, { passive: false });
    c.addEventListener('pointerleave', onLeave);
    c.addEventListener('dblclick', onDbl);
    return () => {
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointercancel', onUp);
      c.removeEventListener('wheel', onWheel);
      c.removeEventListener('pointerleave', onLeave);
      c.removeEventListener('dblclick', onDbl);
    };
  }, [d]);

  function hover(r: MapRenderer, x: number, y: number) {
    const cell = r.cellAt(x, y);
    if (cell !== r.hoverCell) { r.hoverCell = cell; r.invalidate(); }
    if (cell < 0 || !d || !d.geo.land[cell]) { setTip(null); return; }
    const o = r.ownerAt(cell);
    const name = o >= 0 ? (r.layer === 'political' ? r.polityName(o) : legendOf(d, r.layer, o)?.name ?? '') : r.layer === 'political' ? 'Unclaimed lands' : '—';
    const reg = d.world.regions[d.world.regionOf[cell]]?.name ?? '';
    setTip({ x, y, text: name, sub: reg });
  }

  function tap(r: MapRenderer, h: Hit) {
    if (!d) return;
    if (h.type === 'event' || h.type === 'settlement') { selection.value = h.id; return; }
    const cell = h.cell;
    if (!d.geo.land[cell]) { selection.value = null; return; }
    const o = r.ownerAt(cell);
    const l = legendOf(d, r.layer, o);
    if (l) selection.value = selection.value === l.id ? `cell:${cell}` : l.id;
    else selection.value = `cell:${cell}`;
  }

  // when selection is set from elsewhere (search, links), focus it
  useEffect(() => {
    const r = rendRef.current;
    if (r) focusSelection(r, selection.value, true);
  }, [selection.value]);

  const zoomBy = (f: number) => { const r = rendRef.current; if (r) r.zoomAt(r.w / 2, r.h / 2, f); };
  const fit = () => { const r = rendRef.current; if (r) { r.fit(); r.invalidate(); } };

  return (
    <div class="mapview">
      <div class="mapview__stage" ref={wrapRef}>
        <canvas ref={canvasRef} class="mapview__canvas" aria-label="Map of the world at the selected year" role="img" />
        {!d && <div class="mapview__loading"><div class="spinner" /> Unrolling the map…</div>}
        {d && !d.layers[layer.value] && (layersVersion.value, true) && <div class="maptoast"><div class="spinner" /> Loading {layer.value === 'culture' ? 'peoples' : layer.value === 'language' ? 'languages' : 'faiths'}…</div>}
        <div class="mapctl mapctl--layers" role="radiogroup" aria-label="Map layer">
          {LAYERS.map((l) => (
            <button role="radio" aria-checked={layer.value === l.id} class={`seg${layer.value === l.id ? ' is-on' : ''}`} onClick={() => { layer.value = l.id; }}>
              {l.label}
            </button>
          ))}
          <button class={`seg seg--toggle${showRoutes.value ? ' is-on' : ''}`} aria-pressed={showRoutes.value} onClick={() => { showRoutes.value = !showRoutes.value; }} title="Trade routes">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 18c4-10 12 0 16-10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3" stroke-linecap="round" /></svg>
            Routes
          </button>
        </div>
        <div class="mapctl mapctl--zoom">
          <button class="btn-icon" aria-label="Zoom in" onClick={() => zoomBy(1.6)}>+</button>
          <button class="btn-icon" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.6)}>−</button>
          <button class="btn-icon" aria-label="Fit map" onClick={fit}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          </button>
        </div>
        <TourOverlay />
        {route.value.params.get('og') === '1' && <OgPlate />}
        {route.value.params.get('frames') === '1' && <FramesPlate />}
        {tip && !isMobile.value && !touring.value && (
          <div class="maptip" style={{ transform: `translate(${tip.x + 14}px, ${tip.y + 14}px)` }}>
            <div class="maptip__t">{tip.text}</div>
            {tip.sub && <div class="maptip__s">{tip.sub}</div>}
          </div>
        )}
        <div class={touring.value ? 'is-touring' : ''}>
          <Sheet>
            <MapPanel />
          </Sheet>
        </div>
      </div>
      <TimeSlider compact={isMobile.value} />
    </div>
  );
}

function focusSelection(r: MapRenderer, sel: string | null, animate: boolean) {
  const d = mapData.peek();
  if (!d || !sel) return;
  let cell = -1;
  if (sel.startsWith('cell:')) return; // user clicked; don't move
  if (sel.startsWith('set:')) {
    const i = r.settlementIdx(sel);
    if (i >= 0) cell = d.settlementByIdx.get(i)?.cell ?? -1;
  } else if (sel.startsWith('evt:')) {
    const e = d.timeline.events.find((x) => x.id === sel);
    if (e) cell = e.cell;
  } else if (sel.startsWith('pol:')) {
    const idx = r.polityIdx(sel);
    if (idx >= 0) {
      const st = d.layers.political.at(r.year);
      let sx = 0, sy = 0, n = 0;
      for (let i = 0; i < d.geo.n; i++) if (st[i] === idx) { sx += d.geo.sx[i]; sy += d.geo.sy[i]; n++; }
      if (n && (!animate || !r.inView(sx / n, sy / n, 40))) r.centerOn(sx / n, sy / n);
    }
    return;
  }
  if (cell >= 0 && (!animate || !r.inView(d.geo.sx[cell], d.geo.sy[cell]))) r.centerOn(d.geo.sx[cell], d.geo.sy[cell], 1.8);
}

/** Title plate for the social card (og=1). */
function OgPlate() {
  const m = meta.value;
  if (!m) return null;
  const facts = m.check.invariants.reduce((s, i) => s + i.checked, 0);
  const viol = m.check.invariants.reduce((s, i) => s + i.violations, 0);
  const docs = m.counts.artifact ?? m.counts.documents ?? 0;
  const era = eraAt(year.value);
  return (
    <div class="ogplate">
      <div class="wordmark ogplate__w">{m.title}</div>
      <div class="ogplate__s">A 5,000-year archive of {m.worldName}, a world that never existed</div>
      <div class="ogplate__n">
        <div><strong>5,000</strong> years, decade by decade</div>
        <div><strong>{docs.toLocaleString('en-US')}</strong> primary sources</div>
        <div><strong>{facts.toLocaleString('en-US')}</strong> facts checked · <strong>{viol}</strong> violations</div>
      </div>
      <div class="ogplate__y">The map at {year.value} {m.yearLabel}{era ? ` · ${era.name}` : ''}</div>
      <div class="ogplate__u">ankitb073.github.io/civilization</div>
    </div>
  );
}

/** Corner caption for the borders animation (frames=1). */
function FramesPlate() {
  const m = meta.value;
  const era = eraAt(year.value);
  return (
    <div class="framesplate">
      <div class="framesplate__t">{m?.title ?? 'Palimpsest'} <span>· the borders of {m?.worldName ?? ''}</span></div>
      <div class="framesplate__y"><strong>{year.value}</strong> {m?.yearLabel ?? 'AY'}</div>
      <div class="framesplate__e">{era?.name}</div>
    </div>
  );
}
