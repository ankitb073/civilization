// #/river — the River of Time: the Histomap in three dimensions. Time runs up the valley into the past; every state
// is a ridge whose width is its share of the world's people (or land) and whose height is its share of the world's
// soldiers. Lazy-loaded (three.js lives only in this chunk). window.__river drives it from scripts (screenshots).

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import { isMobile, reducedMotion, route, theme } from '../../state.ts';
import { ensureMeta, meta } from '../../store.ts';
import { fmtCompact } from '../../format.ts';
import { armsSvg } from '../../heraldry.ts';
import { buildModel, loadSources, peakOf, surveyAt, YEAR_END, type Model, type RStream, type Sources, type WidthMode } from './model.ts';
import { RiverScene, STONE_LABEL } from './scene.ts';
import './river.css';

const SPEEDS = [45, 90, 180, 360];
const fmtN = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (v: number) => (v >= 0.1 ? (v * 100).toFixed(0) : (v * 100).toFixed(1)) + '%';

interface Tip { st: RStream; year: number; x: number; y: number }

export function RiverView() {
  const params = route.value.params;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<RiverScene | null>(null);
  const [src, setSrc] = useState<Sources | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<WidthMode>(params.get('w') === 'land' ? 'land' : 'people');
  const [shown, setShown] = useState(() => clampY(Number(params.get('y') ?? 0)));
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [overview, setOverview] = useState(params.get('view') === 'all');
  const [tip, setTip] = useState<Tip | null>(null);
  const [touched, setTouched] = useState(false);
  const [ready, setReady] = useState(false);
  const m = meta.value;
  const mobile = isMobile.value;
  const shot = params.get('shot') === '1';

  useEffect(() => { ensureMeta().catch(() => {}); loadSources().then(setSrc).catch((e) => setErr(String(e?.message ?? e))); }, []);
  useEffect(() => { document.title = `The River of Time — ${m?.title ?? 'Palimpsest'}`; }, [m]);
  const model = useMemo<Model | null>(() => (src ? buildModel(src, mode) : null), [src, mode]);

  // the scene, once the data and the eras are in
  useEffect(() => {
    if (!model || !m || !canvasRef.current || !labelsRef.current) return;
    let scene: RiverScene;
    try {
      scene = new RiverScene(canvasRef.current, labelsRef.current, model, { theme: theme.peek(), reducedMotion, mobile: isMobile.peek(), eras: m.eras });
    } catch (e) {
      setErr(`This view needs WebGL 2, which isn’t available here. (${String((e as Error)?.message ?? e)})`);
      return;
    }
    sceneRef.current = scene;
    const p = route.peek().params;
    const y0 = p.has('y') ? clampY(Number(p.get('y'))) : 0;
    scene.setYear(y0, true);
    scene.setOverview(p.get('view') === 'all', true);
    let last = 0;
    scene.onFrame = (y) => {
      const now = performance.now();
      if (now - last > 120 || !scene.playing) { last = now; setShown(Math.round(y)); }
    };
    scene.onEnd = () => setPlaying(false);
    scene.avoidEls = [...wrapRef.current!.querySelectorAll<HTMLElement>('.rv__plate, .rv__key')];
    scene.resize();
    scene.renderNow();
    scene.start();
    // a fresh visit (no year in the link) sets off down the river at once
    if (!p.has('y') && !reducedMotion && p.get('shot') !== '1') { scene.playing = true; setPlaying(true); }
    setReady(true);
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(wrapRef.current!);
    const offTheme = effect(() => { scene.setTheme(theme.value); });
    (window as unknown as { __river?: RiverScene }).__river = scene;
    return () => {
      ro.disconnect();
      offTheme();
      scene.dispose();
      sceneRef.current = null;
      delete (window as unknown as { __river?: RiverScene }).__river;
    };
  }, [!!model, m]);

  // a new width measure rebuilds the ridges in place
  useEffect(() => { if (model && sceneRef.current && sceneRef.current.model !== model) sceneRef.current.setModel(model); }, [model]);

  // keep the year, measure and view in the link (without spamming history)
  useEffect(() => {
    if (playing) return;
    const t = window.setTimeout(() => {
      const r = route.peek();
      if (r.view !== 'river') return;
      const q = new URLSearchParams(r.params);
      q.set('y', String(shown));
      if (mode === 'land') q.set('w', 'land'); else q.delete('w');
      if (overview) q.set('view', 'all'); else q.delete('view');
      const next = `#/river?${q.toString()}`;
      if (location.hash !== next) history.replaceState(null, '', next);
    }, 400);
    return () => clearTimeout(t);
  }, [shown, mode, overview, playing]);

  // pointer: drag along the valley to travel in time, across it to swing round; wheel to travel; pinch to zoom
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !ready) return;
    const pts = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number; t: number; year: number; yaw: number; axis: '' | 'x' | 'y' } | null = null;
    let pinch0 = 0, zoom0 = 1;
    let hoverRaf = 0;
    let hoverAt: { x: number; y: number } | null = null;
    const local = (e: PointerEvent | WheelEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const yearsPerPx = () => { const s = sceneRef.current!; return (s.overview > 0.5 ? 9 : 2.6) * s.zoom * (isMobile.peek() ? 1.6 : 1); };
    const stopPlay = () => { const s = sceneRef.current; if (s?.playing) { s.playing = false; setPlaying(false); } };
    const onDown = (e: PointerEvent) => {
      c.setPointerCapture?.(e.pointerId);
      const p = local(e);
      pts.set(e.pointerId, p);
      setTouched(true);
      const s = sceneRef.current!;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = s.zoom; down = null;
        return;
      }
      down = { x: p.x, y: p.y, t: performance.now(), year: s.target, yaw: s.yaw, axis: '' };
    };
    const onMove = (e: PointerEvent) => {
      const s = sceneRef.current;
      if (!s) return;
      const p = local(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
      if (pts.size === 2 && pinch0 > 0) {
        const [a, b] = [...pts.values()];
        s.zoom = Math.max(0.55, Math.min(1.9, zoom0 * (pinch0 / Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)))));
        s.nudge();
        return;
      }
      if (down && pts.size === 1) {
        const dx = p.x - down.x, dy = p.y - down.y;
        if (!down.axis && Math.hypot(dx, dy) > 6) { down.axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x'; stopPlay(); setTip(null); }
        // the ground follows the finger: pull the river toward you to go forward in time
        if (down.axis === 'y') s.setYear(down.year + dy * yearsPerPx());
        if (down.axis === 'x') { s.yaw = Math.max(-0.9, Math.min(0.9, down.yaw - dx * 0.004)); s.nudge(); }
        return;
      }
      if (e.pointerType !== 'mouse' || e.buttons) return;
      hoverAt = p;
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        const sc = sceneRef.current;
        if (!sc || !hoverAt) return;
        const hit = sc.pick(hoverAt.x, hoverAt.y);
        sc.setHover(hit ? hit.st.k : -1);
        c.style.cursor = hit ? 'pointer' : '';
        setTip(hit ? { st: hit.st, year: hit.year, x: hoverAt.x, y: hoverAt.y } : null);
      });
    };
    const onUp = (e: PointerEvent) => {
      const p = local(e);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch0 = 0;
      const d0 = down;
      down = null;
      if (!d0 || d0.axis || performance.now() - d0.t > 600) return;
      const s = sceneRef.current;
      if (!s) return;
      const hit = s.pick(p.x, p.y);
      if (!hit) { setTip(null); s.setHover(-1); return; }
      if (e.pointerType === 'mouse') { location.hash = `#/p/${hit.st.id}`; return; }
      s.setHover(hit.st.k);
      setTip({ st: hit.st, year: hit.year, x: p.x, y: p.y });
    };
    const onLeave = () => { if (!down) { setTip((t) => (isMobile.peek() ? t : null)); sceneRef.current?.setHover(-1); } };
    const onWheel = (e: WheelEvent) => {
      const s = sceneRef.current;
      if (!s) return;
      e.preventDefault();
      setTouched(true);
      if (e.ctrlKey) { s.zoom = Math.max(0.55, Math.min(1.9, s.zoom * Math.exp(e.deltaY * 0.01))); s.nudge(); return; }
      stopPlay();
      const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      s.setYear(s.target + dy * 1.2);
      setTip(null);
    };
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('pointerleave', onLeave);
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(hoverRaf);
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointercancel', onUp);
      c.removeEventListener('pointerleave', onLeave);
      c.removeEventListener('wheel', onWheel);
    };
  }, [ready]);

  // labels that open pages (arms, stones)
  useEffect(() => {
    const el = labelsRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest('[data-id]');
      const id = t?.getAttribute('data-id');
      if (id) location.hash = `#/p/${id}`;
    };
    // hovering a state's arms shows its card, as hovering its ridge does
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const t = (e.target as HTMLElement).closest('.rv-lab--arms');
      const id = t?.getAttribute('data-id');
      const sc = sceneRef.current;
      const st = id ? sc?.model.streams.find((x) => x.id === id) : undefined;
      if (!st || !sc) return;
      const r = el.getBoundingClientRect();
      sc.setHover(st.k);
      setTip({ st, year: Math.min(Math.round(sc.year), st.end), x: e.clientX - r.left, y: e.clientY - r.top });
    };
    const onOut = (e: PointerEvent) => { if ((e.target as HTMLElement).closest('.rv-lab--arms')) { setTip(null); sceneRef.current?.setHover(-1); } };
    el.addEventListener('click', onClick);
    el.addEventListener('pointerover', onOver);
    el.addEventListener('pointerout', onOut);
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('pointerover', onOver); el.removeEventListener('pointerout', onOut); };
  }, []);

  const s = sceneRef.current;
  const togglePlay = () => {
    if (!s) return;
    if (s.playing) { s.playing = false; setPlaying(false); return; }
    if (s.target >= YEAR_END - 1) s.setYear(0, true);
    s.speed = SPEEDS[speedIdx];
    s.playing = true;
    setPlaying(true);
    setTip(null);
  };
  const cycleSpeed = () => { const i = (speedIdx + 1) % SPEEDS.length; setSpeedIdx(i); if (s) s.speed = SPEEDS[i]; };
  const toggleOverview = () => { const v = !overview; setOverview(v); s?.setOverview(v); setTip(null); };
  const onSlide = (e: Event) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (s?.playing) { s.playing = false; setPlaying(false); }
    s?.setYear(v);
    setShown(v);
    setTip(null);
  };
  // keyboard: arrows travel, space plays
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sc = sceneRef.current;
      if (!sc || (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')) return;
      const step = e.shiftKey ? 100 : 20;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { sc.playing = false; setPlaying(false); sc.setYear(sc.target + step); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { sc.playing = false; setPlaying(false); sc.setYear(sc.target - step); e.preventDefault(); }
      else if (e.key === ' ' && (e.target as HTMLElement)?.tagName !== 'BUTTON') { e.preventDefault(); (document.querySelector('.rv-play') as HTMLButtonElement | null)?.click(); }
      else if (e.key === 'Home') { sc.setYear(0); } else if (e.key === 'End') { sc.setYear(YEAR_END); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const era = m?.eras.find((e) => shown >= e.start && shown < e.end) ?? m?.eras[m.eras.length - 1];
  const eraGrad = useMemo(() => {
    if (!m) return '';
    const dark = theme.value === 'dark';
    const a = dark ? 'rgba(255,240,210,0.06)' : 'rgba(120,90,50,0.10)', b = dark ? 'rgba(255,240,210,0.015)' : 'rgba(120,90,50,0.03)';
    return `linear-gradient(90deg, ${m.eras.map((e, i) => `${i % 2 ? a : b} ${(e.start / YEAR_END) * 100}% ${(e.end / YEAR_END) * 100}%`).join(', ')})`;
  }, [m, theme.value]);
  // the states as a list for screen readers (built once per model, not on every frame's re-render)
  const stateList = useMemo(() => model && (
    <section class="sr-only">
      <h2>All {model.streams.length} states in the river</h2>
      <ul>
        {model.streams.slice().sort((a, b) => a.start - b.start).map((st) => {
          const pk = peakOf(model, st);
          return <li><a href={`#/p/${st.id}`}>{st.name}</a> AY {st.start}–{st.end >= YEAR_END ? 'present' : st.end}{pk ? ` · at its height ${fmtN(pk.army)} soldiers (${pct(pk.armyShare)} of the world’s), AY ${pk.year}` : ''}</li>;
        })}
      </ul>
    </section>
  ), [model]);
  const living = model ? model.alive[Math.round(Math.min(YEAR_END, shown) / 5)]?.length ?? 0 : 0;
  const world = m?.worldName ?? 'the world';

  return (
    <div class={`rv${shot ? ' rv--shot' : ''}`}>
      <h1 class="sr-only">The River of Time: the Histomap of {world} in three dimensions, AY {shown}</h1>
      <div class={`rv__stage${touched ? ' is-touched' : ''}`} ref={wrapRef}>
        <canvas ref={canvasRef} class="rv__canvas" tabIndex={0} role="img"
          aria-label={`A valley of ridges, one per state, AY 0 to AY ${shown}: width is a state's share of the world's ${mode === 'land' ? 'land' : 'people'}, height its share of the world's soldiers. Drag or scroll to travel through time.`} />
        <div class="rv__labels" ref={labelsRef} />
        <div class="rv__plate">
          <div class="rv__kicker">The River of Time</div>
          <div class="rv__year"><span class="rv__ay">AY</span> {shown.toLocaleString('en-US')}</div>
          {era && <div class="rv__era">{era.name}{!mobile && <span class="rv__n"> · {living} states</span>}</div>}
          <div class="rv__hint">{mobile ? 'Drag the river to travel · tap a ridge' : 'Drag or scroll to travel in time · drag sideways to look round · click a ridge to open it'}</div>
        </div>
        <div class="rv__key" aria-label="How to read the river">
          <div><span class="rv__key-w" aria-hidden="true" /> <b>Width</b> its share of the world’s {mode === 'land' ? 'land' : 'people'}</div>
          <div><span class="rv__key-h" aria-hidden="true" /> <b>Height</b> its share of the world’s soldiers{!mobile && <span class="rv__key-s"> · contours every 2.5%</span>}</div>
          {!mobile && <div class="rv__key-s"><span class="rv__key-st" aria-hidden="true" /><b>Stones</b> great wars (west bank); plagues, eruptions, first contact (east)</div>}
        </div>
        {tip && model && <TipCard tip={tip} model={model} mobile={mobile} onClose={() => { setTip(null); s?.setHover(-1); }} />}
        {!ready && !err && <div class="rv__loading"><div class="spinner" /> Carving the valley…</div>}
        {err && (
          <div class="rv__fail">
            <p>{err}</p>
            <a class="btn" href="#/histomap">Open the 2D Histomap</a>
          </div>
        )}
        <div class="sr-only" aria-live="polite">{era?.name}</div>
      </div>
      <div class="rv__bar">
        <button class="rv-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play: glide down five thousand years'} title={playing ? 'Pause (space)' : 'Play (space)'}>
          {playing
            ? <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>
            : <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" /></svg>}
        </button>
        <button class="rv-seg rv-speed" onClick={cycleSpeed} title="Speed (years per second)" aria-label={`Speed: ${SPEEDS[speedIdx]} years a second`}>{SPEEDS[speedIdx] / 90}×</button>
        <div class="rv-track" style={{ backgroundImage: eraGrad }}>
          <input type="range" min={0} max={YEAR_END} step={1} value={shown} onInput={onSlide} aria-label="Year" aria-valuetext={`AY ${shown}`} />
          {!mobile && m && (
            <div class="rv-track__eras" aria-hidden="true">
              {m.eras.map((e) => (e.end - e.start) / YEAR_END > 0.07 && <span style={{ left: `${(e.start / YEAR_END) * 100}%`, width: `${((e.end - e.start) / YEAR_END) * 100}%` }}>{e.name.replace(/^(The )?Age of (the )?/i, '')}</span>)}
            </div>
          )}
          {model && (
            <div class="rv-track__stones" aria-hidden="true">
              {model.stones.map((st) => <i class={`k-${st.kind}`} style={{ left: `${(st.year / YEAR_END) * 100}%` }} title={`${STONE_LABEL[st.kind]}: ${st.title}, AY ${st.year}`} />)}
            </div>
          )}
        </div>
        <div class="rv-seg rv-mode" role="group" aria-label="Width shows">
          <button class={mode === 'people' ? 'is-on' : ''} aria-pressed={mode === 'people'} onClick={() => setMode('people')}>People</button>
          <button class={mode === 'land' ? 'is-on' : ''} aria-pressed={mode === 'land'} onClick={() => setMode('land')}>Land</button>
        </div>
        <button class={`rv-seg rv-all${overview ? ' is-on' : ''}`} aria-pressed={overview} onClick={toggleOverview} title="The whole river from above">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M3 18l5-8 4 5 3-4 6 7zM3 21h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
          <span>{mobile ? 'All' : 'Whole river'}</span>
        </button>
        <a class="rv-seg rv-2d" href="#/histomap" title="The flat Histomap">2D</a>
      </div>
      {stateList}
    </div>
  );
}

function TipCard({ tip, model, mobile, onClose }: { tip: Tip; model: Model; mobile: boolean; onClose: () => void }) {
  const { st } = tip;
  const now = surveyAt(model, st, tip.year);
  const pk = peakOf(model, st);
  const arms = useMemo(() => (st.arms ? armsSvg(st.arms, { uid: `rvtip${st.id.slice(4)}`, title: false, cls: 'rv-tip__arms' }) : ''), [st.id]);
  const style = mobile ? undefined : { transform: `translate(${Math.round(tip.x + 18)}px, ${Math.round(tip.y + 14)}px)` };
  return (
    <div class={`rv-tip${mobile ? ' rv-tip--sheet' : ''}`} style={style} role={mobile ? 'dialog' : 'tooltip'} aria-label={st.name}>
      <div class="rv-tip__head">
        {arms && <span class="rv-tip__shield" dangerouslySetInnerHTML={{ __html: arms }} />}
        <div>
          <div class="rv-tip__n"><span class="rv-tip__sw" style={{ background: st.color }} />{st.name}</div>
          <div class="rv-tip__y">AY {st.start}–{st.end >= YEAR_END ? 'present' : st.end} · {st.end - st.start} years</div>
        </div>
      </div>
      <div class="rv-tip__row"><span>In AY {now.year}</span> {pct(now.pop)} of the world’s people{now.people > 0 ? ` (≈${fmtCompact(now.people)})` : ''} · {fmtN(now.cells)} districts · {fmtN(now.army)} soldiers ({pct(now.armyShare)})</div>
      {pk && <div class="rv-tip__row rv-tip__peak"><span>At its height</span> AY {pk.year}: {fmtN(pk.army)} soldiers, {pct(pk.armyShare)} of all the world’s under arms</div>}
      {mobile ? (
        <div class="actions">
          <a class="btn btn--accent" href={`#/p/${st.id}`}>Open page</a>
          <button class="btn btn--ghost" onClick={onClose}>Close</button>
        </div>
      ) : <div class="rv-tip__go">Click to open its page</div>}
    </div>
  );
}

function clampY(y: number): number {
  return Number.isFinite(y) ? Math.max(0, Math.min(YEAR_END, Math.round(y))) : 0;
}
