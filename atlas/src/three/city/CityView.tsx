// #/city/set:N — a city in 3D at any year of its life, generated from the record (lazy-loaded; three.js lives in this
// chunk). The life bar under it shows the population survey, the years it was a capital and every sack; play runs the
// whole life. "Read from the record" lists what each part of the model was generated from, with links to the sources.

import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isMobile, mapHref, reducedMotion, route, theme, year as globalYear } from '../../state.ts';
import { ensureMapData, mapData, meta } from '../../store.ts';
import { fmtInt } from '../../format.ts';
import { type CityRecord, type CityYear, buildingsFor, cityAt, loadCityRecord, polityName, popAt } from './record.ts';
import { CityModel } from './model.ts';
import { CityStage } from './stage.ts';
import { TINCTURE_NAMES, ageStyle, streetsOf, tinctureOf } from './style.ts';
import './city.css';

const FORM_NAMES: Record<string, string> = {
  ziggurat: 'a stepped ziggurat', domed: 'a domed temple', spired: 'a spired temple', pagoda: 'a tiered pagoda',
  columned: 'a columned temple', stupa: 'a bell-domed stupa', hall: 'a hall of learning', shrine: 'a small shrine',
};
const PATTERN_NAMES: Record<string, string> = { grid: 'a street grid', radial: 'rings and spokes', organic: 'winding lanes', courtyard: 'courtyard blocks' };

export function CityView({ id }: { id: string | null }) {
  if (!id) return <CityIndex />;
  return <CityStageView id={id} key={id} />;
}

function CityStageView({ id }: { id: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<CityStage | null>(null);
  const [rec, setRec] = useState<CityRecord | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [y, setY] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [spin, setSpin] = useState(!reducedMotion);
  const [why, setWhy] = useState(!isMobile.peek());
  const [labels, setLabels] = useState(true);
  const m = meta.value;

  useEffect(() => {
    let dead = false;
    loadCityRecord(id).then((r) => { if (!dead) setRec(r); }).catch((e) => { if (!dead) setFailed(String((e as Error)?.message ?? e)); });
    return () => { dead = true; };
  }, [id]);

  const lifeStart = rec ? Math.max(0, rec.start) : 0;
  const yearEnd = rec?.yearEnd ?? 5000;
  // the starting year: the link's, else the atlas's, within the city's life
  useEffect(() => {
    if (!rec) return;
    const q = Number(route.peek().params.get('y'));
    const want = Number.isFinite(q) && route.peek().params.has('y') ? q : globalYear.peek();
    setY(Math.max(lifeStart, Math.min(yearEnd, Math.round(want))));
  }, [rec]);

  // the stage
  useEffect(() => {
    if (!rec || y === null || !canvasRef.current || !labelsRef.current) return;
    let stage: CityStage;
    try {
      stage = new CityStage(canvasRef.current, labelsRef.current, { theme: theme.peek(), reducedMotion, mobile: isMobile.peek() });
      stage.setModel(new CityModel(rec, { textureSize: isMobile.peek() ? 1024 : 2048, theme: theme.peek() }));
    } catch (e) {
      setFailed(String((e as Error)?.message ?? e));
      return;
    }
    stageRef.current = stage;
    (window as unknown as { __palimpsestCity?: CityStage }).__palimpsestCity = stage;
    stage.resize();
    stage.setYear(y, true);
    const home = stage.homePose();
    stage.setSunAz(home.az);
    if (reducedMotion) stage.setPose(home);
    else { stage.setPose({ ...home, polar: home.polar - 0.35, dist: home.dist * 1.3, az: home.az - 0.5 }); fly(stage, home, 1800); }
    stage.start();
    setReady(true);
    const ro = new ResizeObserver(() => stage.resize());
    ro.observe(wrapRef.current!);
    return () => {
      ro.disconnect();
      stage.dispose();
      stageRef.current = null;
      delete (window as unknown as { __palimpsestCity?: CityStage }).__palimpsestCity;
    };
  }, [rec, y === null]);

  useEffect(() => { if (y !== null) stageRef.current?.setYear(y); }, [y]);
  useEffect(() => { stageRef.current?.setTheme(theme.value); }, [theme.value]);
  useEffect(() => { if (stageRef.current) stageRef.current.showLabels = labels; }, [labels]);
  useEffect(() => { stageRef.current?.setOffset(why && !isMobile.value ? 300 : 0); }, [why, ready, isMobile.value]);

  // keep the year in the link
  useEffect(() => {
    if (y === null) return;
    const t = window.setTimeout(() => {
      const r = route.peek();
      if (r.view !== 'city') return;
      const p = new URLSearchParams(r.params);
      p.set('y', String(y));
      const next = `#/city/${id}?${p.toString()}`;
      if (location.hash !== next) history.replaceState(null, '', next);
    }, 250);
    return () => clearTimeout(t);
  }, [y]);

  // play: the whole life in about forty seconds
  useEffect(() => {
    if (!playing || !rec) return;
    let raf = 0, last = 0, acc = y ?? lifeStart;
    if (acc >= yearEnd - 1) acc = lifeStart;
    const speed = Math.max(40, (yearEnd - lifeStart) / 40);
    let lastUi = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      acc += dt * speed;
      const done = acc >= yearEnd;
      if (done) acc = yearEnd;
      // the model follows every frame; the plate, the facts and the bar ten times a second
      stageRef.current?.setYear(Math.round(acc));
      if (done || now - lastUi > 100) { lastUi = now; setY(Math.round(acc)); }
      if (done) setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    if (!rec) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 100 : 10);
        setY((v) => Math.max(lifeStart, Math.min(yearEnd, (v ?? lifeStart) + d)));
        e.preventDefault();
      } else if (e.key === ' ' && (e.target as HTMLElement)?.tagName !== 'BUTTON') {
        setPlaying((p) => !p);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rec]);

  const cy = useMemo(() => (rec && y !== null ? cityAt(rec, y) : null), [rec, y]);
  useEffect(() => {
    if (!cy || !rec) return;
    document.title = `${cy.name} in AY ${cy.year}, in 3D — ${m?.title ?? 'Palimpsest'}`;
  }, [cy?.name, cy?.year, m]);

  if (failed) {
    return (
      <div class="c3d c3d--msg">
        <p>{/settlement/.test(failed) ? 'There is no such city in the record.' : /WebGL|context/i.test(failed) ? 'This view needs WebGL 2, which isn’t available here.' : `Couldn’t build the city (${failed}).`}</p>
        <a class="btn" href={`#/p/${id}`}>Read its page</a>
      </div>
    );
  }

  const ownerName = rec && cy && cy.owner >= 0 ? polityName(rec, cy.owner, cy.year) : '';
  const ownerColor = rec && cy && cy.owner >= 0 ? rec.polities[cy.owner]?.color : undefined;
  const s = stageRef.current;
  return (
    <div class="c3d">
      <h1 class="sr-only">{cy ? `${cy.name} in AY ${cy.year}, in 3D` : 'A city in 3D'}</h1>
      <div class="c3d__stage" ref={wrapRef}>
        <canvas ref={canvasRef} class="c3d__canvas" tabIndex={0} role="img"
          aria-label={cy && rec ? describe(rec, cy, ownerName) : 'Loading a city in 3D'} />
        <div class="c3d__labels" ref={labelsRef} aria-hidden="true" />
        {rec && cy && (
          <div class="c3d__plate">
            <div class="c3d__kicker">City in 3D · AY {cy.year}</div>
            <div class="c3d__title">
              {cy.name}
              {cy.name !== rec.name && <span class="c3d__alt"> (later {rec.name})</span>}
            </div>
            <div class="c3d__sub">
              {cy.phase === 'ruin' ? <>Ruins · abandoned AY {rec.end}</>
                : cy.phase === 'site' ? <>Not yet founded</>
                : <>
                  {ownerName ? <><span class="c3d__sw" style={{ background: ownerColor }} />{ownerName}</> : 'No state'}
                  <span class="c3d__dot"> · </span>
                  <span class="c3d__pop">≈ {fmtInt(Math.round(cy.pop / (cy.pop > 10000 ? 100 : 10)) * (cy.pop > 10000 ? 100 : 10))} people</span>
                </>}
            </div>
            <div class="c3d__tags">
              {cy.capital && <span class="c3d__tag c3d__tag--cap">Capital</span>}
              {rec.port && cy.phase === 'living' && <span class="c3d__tag">Port</span>}
              {rec.site.river && <span class="c3d__tag">On the {rec.site.river.name}</span>}
              {cy.sack && <span class="c3d__tag c3d__tag--sack">Sacked AY {cy.sack.year}</span>}
              <span class="c3d__tag c3d__tag--age">{rec.eras[cy.age]?.name ?? ''}</span>
            </div>
          </div>
        )}
        <div class="mapctl c3d__ctl">
          <button class={`seg${spin ? ' is-on' : ''}`} aria-pressed={spin} disabled={reducedMotion}
            title={reducedMotion ? 'Turning is off for reduced motion' : 'Turn slowly when idle'}
            onClick={() => { const v = !spin; setSpin(v); s?.setSpin(v); }}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <span class="c3d__ctl-l">Spin</span>
          </button>
          <button class={`seg${labels ? ' is-on' : ''}`} aria-pressed={labels} aria-label="Labels on the model" title="Labels on the model" onClick={() => setLabels(!labels)}>
            <span>Aa</span>
          </button>
          <button class="seg" aria-label="Reset view" title="Reset view" onClick={() => { if (s) fly(s, s.homePose(), reducedMotion ? 0 : 900); }}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          </button>
          <a class="seg c3d__a" href={`#/p/${id}`} title="The city's page">Page</a>
          {y !== null && <a class="seg c3d__a c3d__map" href={mapHref({ y, sel: null })} title="The map at this year">Map</a>}
        </div>
        {rec && cy && (
          <aside class={`c3d__why${why ? ' is-open' : ''}`} aria-label="Read from the record">
            <button class="c3d__why-h" aria-expanded={why} onClick={() => setWhy(!why)}>
              <span>{isMobile.value ? 'The record' : 'Read from the record'}</span>
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d={why ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
            </button>
            {why && <Facts rec={rec} cy={cy} ownerName={ownerName} />}
          </aside>
        )}
        {!ready && !failed && <div class="c3d__loading"><div class="spinner" /> Laying out the streets…</div>}
      </div>
      {rec && y !== null && (
        <LifeBar rec={rec} y={y} setY={(v) => { setPlaying(false); setY(v); }} playing={playing} onPlay={() => setPlaying(!playing)} />
      )}
    </div>
  );
}

function describe(rec: CityRecord, cy: CityYear, owner: string): string {
  if (cy.phase === 'ruin') return `The ruins of ${cy.name} in AY ${cy.year}, ${cy.ruinAge} years after it was abandoned.`;
  return `A model of ${cy.name} in AY ${cy.year}${owner ? `, under ${owner}` : ''}: about ${fmtInt(Math.round(cy.pop))} people${cy.capital ? ', a capital with a palace and walls' : ''}${rec.port ? ', with a harbour' : ''}. Drag to turn, scroll or pinch to zoom.`;
}

function Facts({ rec, cy, ownerName }: { rec: CityRecord; cy: CityYear; ownerName: string }) {
  const st = ageStyle(cy.age);
  const pop = popAt(rec, Math.min(cy.year, rec.end));
  const people = rec.peoples[cy.culture] ?? '';
  const streets = streetsOf(cy.culture);
  const faith = cy.faith >= 0 ? rec.faiths[cy.faith] : null;
  const n = buildingsFor(cy.pop);
  const items: { k: string; v: ComponentChildren; then: string }[] = [];
  if (cy.phase === 'ruin') {
    items.push({ k: 'Abandoned', v: <>AY {rec.end}</>, then: `ruins, ${cy.ruinAge} years on: fewer walls standing and greener each century` });
  } else if (cy.phase === 'living') {
    items.push({ k: 'People', v: <>≈ {fmtInt(Math.round(cy.pop))} <span class="c3d__src">(surveys AY {pop.y0}{pop.y1 !== pop.y0 ? `–${pop.y1}` : ''})</span></>, then: `${fmtInt(n)} buildings${cy.nPeak > cy.n ? `, ${fmtInt(cy.nPeak - cy.n)} empty since a larger past` : ''}` });
    items.push({ k: 'Master', v: cy.owner >= 0 ? <a href={`#/p/${rec.polities[cy.owner]?.id}`}>{ownerName}</a> : 'no state', then: `its survey puts it in the ${rec.eras[cy.age]?.name ?? ''}: ${st.name}` });
  }
  if (cy.culture >= 0 && cy.phase !== 'ruin') items.push({ k: 'People of the ground', v: <a href={`#/p/cul:${cy.culture}`}>{people}</a>, then: `${TINCTURE_NAMES[tinctureOf(cy.culture)]} roofs (their arms' colour); new districts in ${PATTERN_NAMES[streets.pattern]}` });
  if (cy.phase === 'living') {
    items.push({ k: 'State faith', v: faith ? <a href={`#/p/mov:${cy.faith}`}>{faith[0]}</a> : 'none on record', then: FORM_NAMES[cy.form ?? 'shrine'] + (faith ? ` (every ${faith[1] === 'sect' || faith[1] === 'reform' ? 'branch of this family' : faith[1]} builds alike)` : '') });
    if (cy.capital) items.push({ k: 'Capital', v: <>of <a href={`#/p/${rec.polities[cy.capital.polity]?.id}`}>{polityName(rec, cy.capital.polity, cy.year)}</a> since AY {cy.capital.since}</>, then: `a palace${cy.walls ? ' and walls' : ''}` });
    else if (cy.walls) items.push({ k: 'Walls', v: <>raised AY {cy.walls.since}</>, then: 'they stand two centuries after it stops being a capital' });
    if (rec.port) items.push({ k: 'Port', v: 'yes', then: 'quays, piers and boats of the age' });
    if (rec.site.river) items.push({ k: 'River', v: <a href={`#/p/${rec.site.river.id}`}>{rec.site.river.name}</a>, then: 'bridges where the roads cross' });
    if (cy.sack) items.push({ k: 'Sacked', v: <>AY {cy.sack.year} ({cy.sack.ago ? `${cy.sack.ago} year${cy.sack.ago === 1 ? '' : 's'} before` : 'this year'})</>, then: 'burnt quarters and breached walls, rebuilt over 20 years' });
  }
  return (
    <>
      <dl class="c3d__facts">
        {items.map((it) => (
          <div class="c3d__fact">
            <dt>{it.k}</dt>
            <dd><span class="c3d__fv">{it.v}</span><span class="c3d__then">{it.then}</span></dd>
          </div>
        ))}
      </dl>
      <p class="c3d__note">Everything here is generated from the record. Layout and variety come from hashes of the city's id: the same city at the same year looks the same everywhere.</p>
    </>
  );
}

/** The life bar: population (log scale), capital years (gold), sacks (red ticks), ruins (hatched); drag to scrub. */
function LifeBar({ rec, y, setY, playing, onPlay }: { rec: CityRecord; y: number; setY: (y: number) => void; playing: boolean; onPlay: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const y0 = Math.max(0, rec.start), y1 = rec.yearEnd;
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const H = 44;
  const X = (yy: number) => ((yy - y0) / Math.max(1, y1 - y0)) * w;
  const path = useMemo(() => {
    if (!w) return '';
    const maxP = Math.max(...rec.pop.map((p) => p[1]), 1000);
    const lo = Math.log10(500), hi = Math.log10(maxP);
    const Y = (p: number) => H - 4 - ((Math.log10(Math.max(500, p)) - lo) / Math.max(0.1, hi - lo)) * (H - 10);
    let d = `M${X(y0).toFixed(1)} ${H}`;
    const end = Math.min(rec.end, y1);
    for (let yy = y0; yy <= end; yy += Math.max(5, Math.round((y1 - y0) / 220))) d += `L${X(yy).toFixed(1)} ${Y(popAt(rec, yy).pop).toFixed(1)}`;
    d += `L${X(end).toFixed(1)} ${Y(popAt(rec, end).pop).toFixed(1)}L${X(end).toFixed(1)} ${H}Z`;
    return d;
  }, [rec, w]);
  const drag = (e: PointerEvent) => {
    const el = trackRef.current!;
    const r = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setY(Math.round(y0 + f * (y1 - y0)));
  };
  const ticks: number[] = [];
  for (let t = Math.ceil(y0 / 1000) * 1000; t <= y1; t += 1000) if (X(t) < w - 34) ticks.push(t);
  return (
    <div class="c3d-life">
      <button class="c3d-life__play" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play the city’s life'}>
        {playing
          ? <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" /></svg>
          : <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor" /></svg>}
      </button>
      <div class="c3d-life__year"><small>AY</small>{y}</div>
      <div class="c3d-life__track" ref={trackRef} role="slider" tabIndex={0} aria-label="Year" aria-valuemin={y0} aria-valuemax={y1} aria-valuenow={y}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag(e); }}
        onPointerMove={(e) => { if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) drag(e); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { setY(Math.min(y1, y + (e.shiftKey ? 100 : 10))); e.preventDefault(); e.stopPropagation(); }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { setY(Math.max(y0, y - (e.shiftKey ? 100 : 10))); e.preventDefault(); e.stopPropagation(); }
        }}>
        {w > 0 && (
          <svg width={w} height={H} class="c3d-life__svg" aria-hidden="true">
            <defs>
              <pattern id="c3d-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0v6" stroke="currentColor" stroke-width="1.4" opacity="0.35" /></pattern>
            </defs>
            {rec.capitals.map(([a, b]) => <rect class="c3d-life__cap" x={X(Math.max(a, y0))} y={0} width={Math.max(1.5, X(Math.min(b, y1)) - X(Math.max(a, y0)))} height={H} />)}
            <path d={path} class="c3d-life__pop" />
            {rec.end < y1 && <rect x={X(rec.end)} y={0} width={X(y1) - X(rec.end)} height={H} fill="url(#c3d-hatch)" class="c3d-life__ruin" />}
            {rec.sacks.filter((t) => t >= y0).map((t) => <path class="c3d-life__sack" d={`M${X(t).toFixed(1)} 2v${H - 4}`} />)}
            {ticks.map((t) => <text class="c3d-life__tick" x={X(t) + 3} y={H - 4}>{t}</text>)}
            <line class="c3d-life__now" x1={X(y)} x2={X(y)} y1={0} y2={H} />
          </svg>
        )}
        <div class="c3d-life__thumb" style={{ left: `${w ? X(y) : 0}px` }} />
      </div>
      <div class="c3d-life__key" aria-hidden="true">
        <span><i class="c3d-k c3d-k--pop" />people</span>
        <span><i class="c3d-k c3d-k--cap" />capital</span>
        <span><i class="c3d-k c3d-k--sack" />sacked</span>
      </div>
    </div>
  );
}

/** Ease the camera to a pose. */
function fly(stage: CityStage, to: ReturnType<CityStage['homePose']>, ms: number) {
  const c = stage.camera, t = stage.controls.target;
  const dx = c.position.x - t.x, dy = c.position.y - t.y, dz = c.position.z - t.z;
  const dist = Math.hypot(dx, dy, dz);
  const from = { az: Math.atan2(dx, dz), polar: Math.acos(Math.max(-1, Math.min(1, dy / dist))), dist, tx: t.x, tz: t.z };
  if (ms <= 0) { stage.setPose(to); return; }
  let da = to.az - from.az;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  const t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    stage.setPose({ az: from.az + da * e, polar: from.polar + (to.polar - from.polar) * e, dist: from.dist * Math.pow(to.dist / from.dist, e), tx: from.tx + (to.tx - from.tx) * e, tz: from.tz + (to.tz - from.tz) * e });
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** #/city without a city: the greatest cities of the record, to pick from. */
function CityIndex() {
  const d = mapData.value;
  useEffect(() => { ensureMapData().catch(() => {}); document.title = `Cities in 3D — ${meta.value?.title ?? 'Palimpsest'}`; }, []);
  const list = useMemo(() => {
    if (!d) return [];
    return d.timeline.settlements
      .map((s) => ({ s, peak: Math.max(0, ...s.pop.map((p) => p[1])) }))
      .sort((a, b) => b.peak - a.peak)
      .slice(0, 36);
  }, [d]);
  return (
    <div class="c3d-index">
      <h1 class="h-page">Cities in 3D</h1>
      <p class="c3d-index__lede">Any city of the record, at any year of its life, generated from what the record says: its population, its masters' age, its people, its faith, its harbour, its sacks.</p>
      {!d && <div class="center-load"><div class="spinner" /> Gathering the cities…</div>}
      <ol class="c3d-index__list">
        {list.map(({ s, peak }) => (
          <li><a href={`#/city/${s.id}`}><span class="c3d-index__n">{s.name}</span><span class="c3d-index__p">{fmtInt(peak)} at its peak · {s.start < 0 ? `${-s.start} before AY 0` : `AY ${s.start}`}{s.end < 5000 ? `–${s.end}` : ''}</span></a></li>
        ))}
      </ol>
    </div>
  );
}
