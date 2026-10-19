// #/3d — the world as a relief model you can turn, with the borders of any year draped over it.
// Lazy-loaded (three.js lives only in this chunk). #/3d?cinema=1 is a chrome-less, frame-steppable
// fly-through for video (window.__cinema(t), t in 0..1).

import { useEffect, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import { isMobile, mapHref, playing, reducedMotion, route, selection, theme, year } from '../state.ts';
import { ensureMapData, ensurePoliticalYear, eraAt, firstPaint, layersVersion, mapData, meta, polityNameAt } from '../store.ts';
import { TimeSlider } from './TimeSlider.tsx';
import { buildTerrain, type TerrainMesh } from '../terrain/mesh.ts';
import { TerrainScene, type Pose, type YearInfo } from '../terrain/scene.ts';
import type { MapData } from './mapRenderer.ts';
import '../styles/terrain.css';

let meshCache: { d: MapData; mesh: TerrainMesh } | null = null;
function meshFor(d: MapData): TerrainMesh {
  if (!meshCache || meshCache.d !== d) meshCache = { d, mesh: buildTerrain(d.world, d.geo) };
  return meshCache.mesh;
}

const RELIEF = [{ k: 0.55, label: 'Low' }, { k: 1, label: 'Mid' }, { k: 1.7, label: 'High' }];

interface Card { cell: number; owner: number; name: string; id: string; color: string; region: string }

export function TerrainView() {
  const cinema = route.value.params.get('cinema') === '1';
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TerrainScene | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<YearInfo | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub: string } | null>(null);
  const [spin, setSpin] = useState(!reducedMotion);
  const [relief, setRelief] = useState(1);
  const [touched, setTouched] = useState(false);
  const d = mapData.value;
  const m = meta.value;

  useEffect(() => {
    document.title = `${m?.worldName ?? 'The world'} in 3D — ${m?.title ?? 'Palimpsest'}`;
  }, [m]);
  useEffect(() => { ensureMapData().catch(() => {}); }, []);

  // build the model and the scene once the map data is in
  useEffect(() => {
    if (!d || !canvasRef.current || !labelsRef.current) return;
    let scene: TerrainScene;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    // let the spinner paint before the (synchronous) mesh build
    const timer = window.setTimeout(() => {
      if (disposed) return;
      try {
        const t0 = performance.now();
        const mesh = meshFor(d);
        const built = performance.now() - t0;
        scene = new TerrainScene(canvasRef.current!, labelsRef.current!, d, mesh, {
          theme: cinema ? (route.peek().params.get('theme') === 'light' ? 'light' : 'dark') : theme.peek(),
          reducedMotion, mobile: isMobile.peek(), cinema,
        });
        scene.stats.build = built;
      } catch (e) {
        setFailed(String((e as Error)?.message ?? e));
        return;
      }
      sceneRef.current = scene;
      (window as unknown as { __palimpsest3d?: TerrainScene }).__palimpsest3d = scene;
      let lastInfo = 0;
      scene.onYear = (inf) => {
        const now = performance.now();
        if (cinema) return;
        if (now - lastInfo > 140 || !playing.peek()) { lastInfo = now; setInfo(inf); }
      };
      scene.resize();
      scene.setYear(year.peek());
      if (cinema) {
        cleanups.push(startCinema(scene, d));
      } else {
        const home = scene.homePose();
        const cam = parseCam(route.peek().params.get('cam'));
        if (cam) scene.setPose(cam);
        else if (reducedMotion) scene.setPose(home);
        else {
          // a short dolly in from higher up
          scene.setPose({ ...home, az: home.az - 0.45, polar: Math.max(0.2, home.polar - 0.4), dist: home.dist * 1.35 });
          scene.flyTo(home, 2200);
        }
        scene.start();
      }
      setReady(true);
      if (!firstPaint.peek()) firstPaint.value = true;
      if (!cinema) {
        // keep the camera in the URL (cam=), so a view can be shared as it is
        let camTimer = 0;
        const onEnd = () => {
          clearTimeout(camTimer);
          camTimer = window.setTimeout(() => {
            const r = route.peek();
            if (r.view !== 'terrain') return;
            r.params.set('cam', camString(scene.currentPose()));
            r.params.set('y', String(year.peek()));
            history.replaceState(null, '', `#/3d?${r.params.toString()}`);
          }, 900);
        };
        scene.controls.addEventListener('end', onEnd);
        cleanups.push(() => { clearTimeout(camTimer); scene.controls.removeEventListener('end', onEnd); });
      }
      const ro = new ResizeObserver(() => scene.resize());
      ro.observe(wrapRef.current!);
      cleanups.push(() => ro.disconnect());
      let lastVersion = layersVersion.peek();
      cleanups.push(effect(() => {
        const y = year.value;
        if (layersVersion.value !== lastVersion) { lastVersion = layersVersion.peek(); scene.year = -1; }
        if (!cinema) scene.requestYear(y);
      }));
      cleanups.push(effect(() => { if (!cinema) scene.setTheme(theme.value); }));
      cleanups.push(effect(() => {
        const sel = selection.value;
        const idx = sel?.startsWith('pol:') ? d.layers.political.layer.legend.find((l) => l.id === sel)?.idx ?? -10 : -10;
        scene.setSelected(idx);
      }));
    }, 30);
    return () => {
      disposed = true;
      clearTimeout(timer);
      cleanups.forEach((f) => f());
      sceneRef.current?.dispose();
      sceneRef.current = null;
      delete (window as unknown as { __palimpsest3d?: TerrainScene }).__palimpsest3d;
    };
  }, [d]);

  // pointer: hover names (mouse), tap/click to select
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !d || cinema) return;
    let down = { x: 0, y: 0, t: 0 };
    let hoverRaf = 0;
    let hoverAt: { x: number; y: number } | null = null;
    const local = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const nameAt = (cell: number) => {
      const s = sceneRef.current!;
      const own = d.layers.political.at(s.year)[cell];
      const reg = d.world.regions[d.world.regionOf[cell]]?.name ?? '';
      return { own, name: own >= 0 ? polityNameAt(d, own, s.year) : 'Unclaimed lands', reg };
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.buttons) { setTip(null); return; }
      hoverAt = local(e);
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        const s = sceneRef.current;
        if (!s || !hoverAt) return;
        const cell = s.pick(hoverAt.x, hoverAt.y);
        if (cell < 0 || !d.geo.land[cell]) { s.setHover(-10); setTip(null); return; }
        const { own, name, reg } = nameAt(cell);
        s.setHover(own >= 0 ? own : -10);
        setTip({ x: hoverAt.x, y: hoverAt.y, text: name, sub: reg });
      });
    };
    const onDown = (e: PointerEvent) => { const p = local(e); down = { x: p.x, y: p.y, t: performance.now() }; setTouched(true); };
    const onUp = (e: PointerEvent) => {
      const p = local(e);
      if (Math.hypot(p.x - down.x, p.y - down.y) > 6 || performance.now() - down.t > 500) return;
      const s = sceneRef.current;
      if (!s) return;
      const cell = s.pick(p.x, p.y);
      if (cell < 0 || !d.geo.land[cell]) { setCard(null); selection.value = null; return; }
      const { own, name, reg } = nameAt(cell);
      const l = own >= 0 ? d.layers.political.byIdx.get(own) : undefined;
      if (l && selection.peek() === l.id) { selection.value = null; setCard(null); return; }
      selection.value = l ? l.id : null;
      setCard({ cell, owner: own, name, id: l?.id ?? '', color: l?.color ?? 'transparent', region: reg });
    };
    const onLeave = () => { setTip(null); sceneRef.current?.setHover(-10); };
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(hoverRaf);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointerleave', onLeave);
    };
  }, [d, ready]);

  // keep the card's name in step with the year
  const y = year.value;
  const cardName = card && d && card.owner >= 0 ? polityNameAt(d, card.owner, y) : card?.name;
  const cardOwnerNow = card && d ? d.layers.political.at(y)[card.cell] : -1;

  const s = sceneRef.current;
  const toggleSpin = () => { const v = !spin; setSpin(v); s?.setSpin(v); };
  const cycleRelief = () => {
    const i = RELIEF.findIndex((r) => r.k === relief);
    const next = RELIEF[(i + 1) % RELIEF.length].k;
    setRelief(next);
    s?.setRelief(next);
  };
  const home = () => { if (s) s.flyTo(s.homePose()); };
  const focusState = (st: YearInfo['states'][number]) => {
    if (!s) return;
    selection.value = st.id;
    setCard({ cell: st.anchor, owner: st.idx, name: st.name, id: st.id, color: st.color, region: d?.world.regions[d.world.regionOf[st.anchor]]?.name ?? '' });
    s.focusCell(st.anchor, Math.max(0.32, Math.min(0.7, Math.sqrt(st.share) * 1.1)));
  };
  const era = eraAt(y);
  const world = m?.worldName ?? 'The world';

  if (cinema) {
    return (
      <div class="t3d t3d--cinema">
        <div class="t3d__stage" ref={wrapRef}>
          <canvas ref={canvasRef} class="t3d__canvas" />
          <div class="t3d__labels" ref={labelsRef} aria-hidden="true" />
          <CinemaOverlay world={world} />
          {!ready && !failed && <div class="t3d__loading"><div class="spinner" /> Raising the mountains…</div>}
        </div>
      </div>
    );
  }

  return (
    <div class="t3d">
      <h1 class="sr-only">{world} in 3D, AY {y}</h1>
      <div class={`t3d__stage${touched ? ' is-touched' : ''}`} ref={wrapRef}>
        <canvas ref={canvasRef} class="t3d__canvas" tabIndex={0} role="img"
          aria-label={`A relief model of ${world} with the borders of AY ${y}. Drag to turn, scroll or pinch to zoom.`} />
        <div class="t3d__labels" ref={labelsRef} aria-hidden="true" />
        <div class="t3d__plate">
          <div class="t3d__kicker">Relief atlas</div>
          <div class="t3d__title">{world} <em>in 3D</em></div>
          <div class="t3d__hint">{isMobile.value ? 'Drag to turn · pinch to zoom · tap a state' : 'Drag to turn · scroll to zoom · right-drag to pan · click a state'}</div>
        </div>
        <div class="mapctl t3d__ctl">
          <button class={`seg${spin ? ' is-on' : ''}`} aria-pressed={spin} aria-label="Auto-rotate when idle" onClick={toggleSpin} title={reducedMotion ? 'Auto-rotate (off for reduced motion)' : 'Turn slowly when idle'} disabled={reducedMotion}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <span class="t3d__ctl-l">Spin</span>
          </button>
          <button class="seg" onClick={cycleRelief} title="Vertical exaggeration" aria-label={`Relief: ${RELIEF.find((r) => r.k === relief)?.label}`}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M2 19l6-9 4 5 3-4 7 8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
            <span class="t3d__ctl-l">{RELIEF.find((r) => r.k === relief)?.label}</span>
          </button>
          <button class="seg" onClick={home} aria-label="Reset view" title="Reset view">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          </button>
          <a class="seg t3d__2d" href={mapHref({ y, sel: selection.value })} title="The flat map at this year">2D map</a>
        </div>
        {info && !isMobile.value && (
          <div class="t3d__states" aria-label={`Largest states in AY ${info.year}`}>
            <div class="t3d__states-h">Largest states · AY {info.year}</div>
            <ol>
              {info.states.slice(0, 5).map((st) => (
                <li>
                  <button class={selection.value === st.id ? 'is-on' : ''} onClick={() => focusState(st)}>
                    <span class="t3d__sw" style={{ background: st.color }} />
                    <span class="t3d__sn">{st.name}</span>
                    <span class="t3d__sp">{Math.round(st.share * 100)}%</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
        {card && (
          <div class="t3d__card" role="dialog" aria-label={cardName}>
            <button class="btn-icon btn-icon--sm t3d__x" aria-label="Close" onClick={() => { setCard(null); selection.value = null; }}>×</button>
            <div class="t3d__card-k">{card.region || 'Lands'} · AY {y}</div>
            <div class="t3d__card-t">
              {card.owner >= 0 && <span class="t3d__sw" style={{ background: card.color }} />}
              {cardName}
            </div>
            {card.owner >= 0 && cardOwnerNow !== card.owner && <div class="t3d__card-s">No longer holds this ground in AY {y}.</div>}
            <div class="t3d__card-a">
              {card.id && <a href={`#/p/${card.id}`}>Its history</a>}
              <a href={mapHref({ y, sel: card.id || null })}>On the 2D map</a>
              <a href={`#/year/${y}`}>AY {y}</a>
            </div>
          </div>
        )}
        {tip && !isMobile.value && !card && (
          <div class="maptip" style={{ transform: `translate(${tip.x + 14}px, ${tip.y + 14}px)` }}>
            <div class="maptip__t">{tip.text}</div>
            {tip.sub && <div class="maptip__s">{tip.sub}</div>}
          </div>
        )}
        {!ready && !failed && <div class="t3d__loading"><div class="spinner" /> Raising the mountains…</div>}
        {failed && (
          <div class="t3d__fail">
            <p>This view needs WebGL 2, which isn’t available here.</p>
            <a class="btn" href={mapHref({ y })}>Open the 2D map</a>
          </div>
        )}
        {era && <div class="sr-only" aria-live="polite">{era.name}</div>}
      </div>
      <TimeSlider compact={isMobile.value} />
    </div>
  );
}

/** cam=tx,tz,az,polar,dist (scene units and radians, 3 decimals). */
function camString(p: Pose): string {
  return [p.tx, p.tz, p.az, p.polar, p.dist].map((v) => v.toFixed(3)).join(',');
}
function parseCam(s: string | null): Pose | null {
  if (!s) return null;
  const v = s.split(',').map(Number);
  if (v.length !== 5 || v.some((x) => !Number.isFinite(x))) return null;
  return { tx: v[0], ty: 0, tz: v[1], az: v[2], polar: Math.max(0.04, Math.min(1.3, v[3])), dist: Math.max(2.2, Math.min(70, v[4])) };
}

// ---------------------------------------------------------------- cinema
const CINEMA_S = 46;
const RUN0 = 3, RUN1 = 43;
const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const sine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)));

/** Year at second s: AY 0 → 5000 between RUN0 and RUN1, slower at both ends. */
export function cinemaYear(s: number): number {
  const u = Math.max(0, Math.min(1, (s - RUN0) / (RUN1 - RUN0)));
  return Math.round(5000 * (u - (0.55 * Math.sin(2 * Math.PI * u)) / (2 * Math.PI)));
}

interface Key { v: number; x: number; z: number; az: number; polar: number; dist: number }

/** A C1 cubic through keyframes (finite-difference tangents, flat at both ends). */
function spline(keys: Key[], v: number, ch: (k: Key) => number): number {
  if (v <= keys[0].v) return ch(keys[0]);
  if (v >= keys[keys.length - 1].v) return ch(keys[keys.length - 1]);
  let i = 0;
  while (keys[i + 1].v < v) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  const tan = (j: number) => (j <= 0 || j >= keys.length - 1 ? 0 : (ch(keys[j + 1]) - ch(keys[j - 1])) / (keys[j + 1].v - keys[j - 1].v));
  const h = k1.v - k0.v, t = (v - k0.v) / h;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ch(k0) + (t3 - 2 * t2 + t) * h * tan(i) + (-2 * t3 + 3 * t2) * ch(k1) + (t3 - t2) * h * tan(i + 1);
}

function startCinema(scene: TerrainScene, d: MapData): () => void {
  const aspect = scene.camera.aspect;
  const tall = aspect < 0.8;
  const az0 = tall ? Math.PI / 2 : aspect < 1.2 ? 0.3 : 0;
  // where the camera leans in: the larger western landmass, then the eastern one
  const centroid = (pred: (x: number) => boolean) => {
    let x = 0, z = 0, n = 0;
    for (let i = 0; i < d.geo.n; i++) if (d.geo.land[i] && pred(d.geo.sx[i])) { x += d.geo.sx[i]; z += d.geo.sy[i]; n++; }
    return n ? [(x / n) * 0.01 - d.geo.width * 0.005, (z / n) * 0.01 - d.geo.height * 0.005] : [0, 0];
  };
  const W = d.geo.width;
  const west = centroid((x) => x < W * 0.6), east = centroid((x) => x >= W * 0.6);
  // whole-model shots are centred in the frame; the close ones lean over each landmass
  const margin = tall ? { x: 0.94, top: 0.74, bottom: 0.7 } : { x: 0.92, top: 0.8, bottom: 0.84 };
  const whole = (v: number, az: number, polar: number, k: number): Key => {
    const p = scene.framePose(az, polar, aspect, margin);
    return { v, x: p.tx, z: p.tz, az, polar, dist: p.dist * k };
  };
  const near = (v: number, at: number[], az: number, polar: number, k: number): Key => ({ v, x: at[0], z: at[1], az, polar, dist: scene.framePose(az, polar, aspect, margin).dist * k });
  // the orbit: wide frames sweep ~90°, tall ones keep the long axis upright
  const sweep = tall ? [-0.3, -0.22, 0, 0.25, 0.4, 0.45] : aspect < 1.2 ? [-0.45, -0.35, 0.05, 0.45, 0.62, 0.68] : [-0.5, -0.4, 0.05, 0.55, 0.75, 0.8];
  const keys: Key[] = [
    whole(0, az0 + sweep[0], 0.12, 1.04),
    whole(0.1, az0 + sweep[1], 0.3, 0.98),
    near(0.4, [west[0] * 0.9, west[1] * 0.9], az0 + sweep[2], 0.9, tall ? 0.6 : 0.52),
    near(0.7, [(west[0] + east[0]) * 0.5, (west[1] + east[1]) * 0.5], az0 + sweep[3], 0.98, tall ? 0.72 : 0.6),
    whole(0.9, az0 + sweep[4], tall ? 0.5 : 0.7, 0.97),
    whole(1, az0 + sweep[5], tall ? 0.42 : 0.62, 1.02),
  ];
  const poseAt = (s: number): Pose => {
    const v = s / CINEMA_S;
    return {
      tx: spline(keys, v, (k) => k.x), ty: 0, tz: spline(keys, v, (k) => k.z),
      az: spline(keys, v, (k) => k.az), polar: spline(keys, v, (k) => k.polar),
      dist: Math.exp(spline(keys, v, (k) => Math.log(k.dist))),
    };
  };
  let external = false;
  let lastS = -1;
  const render = (t: number) => {
    const s = Math.max(0, Math.min(1, t)) * CINEMA_S;
    const dt = lastS < 0 || s < lastS ? 1 / 30 : Math.max(1 / 240, s - lastS);
    lastS = s;
    scene.cinemaFrame(poseAt(s), cinemaYear(s), dt);
    cinemaOverlay(s);
  };
  const w = window as unknown as { __cinema?: (t: number) => void; __cinemaReady?: Promise<void>; __cinemaSeconds?: number };
  w.__cinemaSeconds = CINEMA_S;
  w.__cinema = (t: number) => { external = true; render(t); };
  // every millennium of borders, the fonts, then go
  w.__cinemaReady = Promise.all([0, 1000, 2000, 3000, 4000, 5000].map((yy) => ensurePoliticalYear(yy)))
    .then(() => document.fonts?.ready)
    .then(() => { scene.year = -1; render(0); });
  // live preview when nobody is stepping it
  let raf = 0;
  const t0 = performance.now();
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (external) return;
    render((((now - t0) / 1000) % CINEMA_S) / CINEMA_S);
  };
  void w.__cinemaReady.then(() => { if (!external) raf = requestAnimationFrame(loop); });
  return () => { cancelAnimationFrame(raf); delete w.__cinema; delete w.__cinemaReady; };
}

/** Overlay elements, driven directly (no re-render) so each stepped frame is complete. */
const ov: { year?: HTMLElement; era?: HTMLElement; era2?: HTMLElement; title?: HTMLElement; end?: HTMLElement; veil?: HTMLElement; black?: HTMLElement; chrome?: HTMLElement; labels?: HTMLElement; eraName?: string; eraFade?: number; lastS?: number } = {};

function cinemaOverlay(s: number) {
  if (!ov.year) return;
  const y = cinemaYear(s);
  ov.year.textContent = String(y);
  const era = eraAt(y);
  const name = era?.name ?? '';
  const dt = ov.lastS === undefined || s < ov.lastS ? 0 : s - ov.lastS;
  ov.lastS = s;
  if (name !== ov.eraName) {
    // crossfade: the old name moves to the second slot and fades out
    if (ov.era2 && ov.era) { ov.era2.textContent = ov.era.textContent; ov.era2.style.opacity = ov.era.style.opacity || '1'; }
    ov.era!.textContent = name;
    ov.eraName = name;
    ov.eraFade = dt === 0 ? 1 : 0;
  }
  ov.eraFade = Math.min(1, (ov.eraFade ?? 1) + dt / 0.8);
  ov.era!.style.opacity = String(ov.eraFade);
  ov.era!.style.transform = `translateY(${((1 - ov.eraFade) * 0.6).toFixed(3)}em)`;
  if (ov.era2) ov.era2.style.opacity = String(Math.max(0, 1 - ov.eraFade * 1.6));
  // title over black, the world fading up behind it; the end card over a darkening veil
  const titleO = 1 - smoothstep(2.2, 3.0, s);
  const endO = smoothstep(43.1, 44.0, s);
  ov.title!.style.opacity = titleO.toFixed(3);
  ov.title!.style.transform = `translateY(${(-(1 - titleO) * 8).toFixed(2)}px)`;
  ov.end!.style.opacity = endO.toFixed(3);
  ov.end!.style.transform = `translateY(${((1 - endO) * 8).toFixed(2)}px)`;
  ov.veil!.style.opacity = Math.max(titleO * 0.85, endO).toFixed(3);
  ov.black!.style.opacity = Math.max(1 - smoothstep(0.3, 2.0, s), smoothstep(45.2, 46, s) * 0.35).toFixed(3);
  ov.chrome!.style.opacity = Math.min(smoothstep(2.4, 3.2, s), 1 - endO).toFixed(3);
  // the map's labels stay out from under the title and end cards
  ov.labels ??= document.querySelector<HTMLElement>('.t3d--cinema .t3d__labels') ?? undefined;
  if (ov.labels) ov.labels.style.opacity = Math.min(smoothstep(2.2, 3.2, s), 1 - smoothstep(42.6, 43.4, s)).toFixed(3);
}

function CinemaOverlay({ world }: { world: string }) {
  return (
    <div class="t3c" aria-hidden="true">
      <div class="t3c__black" ref={(el) => { ov.black = el ?? undefined; }} />
      <div class="t3c__veil" ref={(el) => { ov.veil = el ?? undefined; }} />
      <div class="t3c__chrome" ref={(el) => { ov.chrome = el ?? undefined; }}>
        <div class="t3c__brand"><span class="wordmark">Palimpsest</span><span class="t3c__world">The world of {world}</span></div>
        <div class="t3c__when">
          <div class="t3c__year"><span ref={(el) => { ov.year = el ?? undefined; }}>0</span><small>AY</small></div>
          <div class="t3c__eras">
            <div class="t3c__era" ref={(el) => { ov.era = el ?? undefined; }} />
            <div class="t3c__era t3c__era--old" ref={(el) => { ov.era2 = el ?? undefined; }} />
          </div>
        </div>
      </div>
      <div class="t3c__card" ref={(el) => { ov.title = el ?? undefined; }}>
        <div class="wordmark t3c__big">Palimpsest</div>
        <div class="t3c__rule" />
        <div class="t3c__sub">5,000 years of {world}</div>
        <div class="t3c__meta">{world} · AY 0 – 5000</div>
      </div>
      <div class="t3c__card t3c__card--end" ref={(el) => { ov.end = el ?? undefined; }}>
        <div class="wordmark t3c__big">Palimpsest</div>
        <div class="t3c__rule" />
        <div class="t3c__sub">Every border, city and war — and the archive they left behind</div>
        <div class="t3c__url">ankitb073.github.io/civilization</div>
      </div>
    </div>
  );
}
