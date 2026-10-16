// #/figures — the people of the record as painted game pieces on a long shelf. By default the subjects of the Lives,
// in order of birth; ?house=dyn:N lines up a ruling house's rulers; ?ids=per:1,per:2@580 any people (@year shows a
// person at that year: a child king at his accession). ?sel=per:N picks a piece. Lazy-loaded with three.js.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { FiguresJson, PageJson } from '../../../../engine/src/export/contract.ts';
import { fetchJson, loadPage } from '../../data.ts';
import { loadDynasties } from '../../extras.ts';
import { isMobile, reducedMotion, route, theme } from '../../state.ts';
import { sigilBlazon } from '../../heraldry.ts';
import { ERA_NAMES, figureNotes, figureSpec, lifeLine, roleLine, type FigureSource, type FigureSpec } from './spec.ts';
import { Shelf, portrait, type ShelfLabel } from './stage.ts';
import { buildFigure, fingerprint } from './build.ts';
import { texturesReady } from './base.ts';
import { FigureModal } from './FigureModal.tsx';
import './figure.css';

interface Entry { spec: FigureSpec; source: FigureSource; life: string | null; year?: number }
interface Loaded { title: string; lede: string; eyebrow: string; entries: Entry[]; mode: 'lives' | 'house' | 'ids'; house?: string }

async function load(params: URLSearchParams): Promise<Loaded> {
  const ids = params.get('ids');
  const house = params.get('house');
  if (ids) {
    const want = ids.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 120).map((x) => { const [id, y] = x.split('@'); return { id, year: y !== undefined ? Number(y) : undefined }; });
    const pages = await Promise.all(want.map((w) => loadPage(w.id).catch(() => null)));
    const entries: Entry[] = [];
    want.forEach((w, i) => { const p = pages[i]; const spec = p ? figureSpec(p, { year: w.year }) : null; if (p && spec) entries.push({ spec, source: p, life: null, year: w.year }); });
    return { mode: 'ids', title: 'Figures', eyebrow: `${entries.length} ${entries.length === 1 ? 'piece' : 'pieces'}`, lede: 'People of the record as painted pieces, side by side.', entries };
  }
  if (house) {
    const d = (await loadDynasties()).dynasties.find((x) => x.id === house);
    if (!d) throw new Error(`no house ${house}`);
    const rulers = d.members.filter((m) => m.reign).sort((a, b) => a.reign![0] - b.reign![0]).slice(0, 40);
    const pages = await Promise.all(rulers.map((m) => loadPage(m.id).catch(() => null)));
    const entries: Entry[] = [];
    pages.forEach((p) => { const spec = p ? figureSpec(p) : null; if (p && spec) entries.push({ spec, source: p, life: null }); });
    return { mode: 'house', house, title: d.name, eyebrow: `A ruling house · ${entries.length} rulers · AY ${d.start}–${d.end >= 5000 ? 'present' : d.end}`, lede: 'Its rulers in the order they reigned, each in the house’s quarters and the dress of their age.', entries };
  }
  const fj = await fetchJson<FiguresJson>('figures.json');
  const entries: Entry[] = [];
  for (const pc of fj.pieces) { const spec = figureSpec(pc.page); if (spec) entries.push({ spec, source: pc.page, life: pc.life }); }
  const sel = params.get('sel');
  if (sel && !entries.some((e) => e.spec.id === sel)) {
    const p = await loadPage(sel).catch(() => null);
    const spec = p ? figureSpec(p) : null;
    if (p && spec) {
      // a piece from outside the Lives joins the shelf at its place in time
      const at = entries.findIndex((e) => e.spec.born > spec.born);
      entries.splice(at < 0 ? entries.length : at, 0, { spec, source: p, life: null });
    }
  }
  return { mode: 'lives', title: 'Figures', eyebrow: `${fj.pieces.length} pieces · the subjects of the Lives`, lede: 'The people of the record as painted game pieces, oldest first. Each is cut from its page: the dress of their age, the colours of their seal, what their roles put in their hands.', entries };
}

type Win = { __figures?: unknown };

export function FiguresView() {
  const params = route.value.params;
  const key = `${params.get('ids') ?? ''}|${params.get('house') ?? ''}`;
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setData(null); setErr(null);
    load(route.peek().params).then(setData).catch((e) => setErr(String(e?.message ?? e)));
  }, [key]);
  useEffect(() => { document.title = `${data?.title ?? 'Figures'} — Palimpsest`; }, [data]);
  if (err) return <div class="figs"><header class="figs__head"><h1 class="h-page">Figures</h1><p class="muted">Couldn’t set out the pieces ({err}).</p></header></div>;
  if (!data) return <div class="center-load"><div class="spinner" /> Setting out the pieces…</div>;
  return <ShelfView data={data} />;
}

function ShelfView({ data }: { data: Loaded }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shelfRef = useRef<Shelf | null>(null);
  const [labels, setLabels] = useState<ShelfLabel[]>([]);
  const [sel, setSel] = useState(() => Math.max(0, data.entries.findIndex((e) => e.spec.id === route.peek().params.get('sel'))));
  const [hasSel, setHasSel] = useState(() => data.entries.some((e) => e.spec.id === route.peek().params.get('sel')));
  const [modal, setModal] = useState<Entry | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const entries = data.entries;
  const eras = useMemo(() => { const m = new Map<number, number>(); entries.forEach((e, i) => { if (!m.has(e.spec.era)) m.set(e.spec.era, i); }); return [...m].sort((a, b) => a[0] - b[0]); }, [data]);

  useEffect(() => {
    if (!canvasRef.current) return;
    let shelf: Shelf;
    try {
      shelf = new Shelf(canvasRef.current, entries.map((e) => e.spec), { theme: theme.peek(), reducedMotion, mobile: isMobile.peek(), fit: data.mode !== 'lives' });
    } catch (e) { setFailed(String((e as Error)?.message ?? e)); return; }
    shelfRef.current = shelf;
    shelf.resize();
    const first = hasSel ? sel : 0;
    const centre = (entries.length - 1) * shelf.gap / 2;
    if (shelf.fits()) { shelf.go(centre, true); if (hasSel) shelf.select(first); }
    else if (hasSel) { shelf.go(first * shelf.gap, true); shelf.select(first); }
    else shelf.go(Math.min(centre, Math.max(0, shelf.span / 2 - shelf.gap * 0.7)), true);
    let last = '';
    shelf.onLabels = (l) => { const k = l.map((x) => `${x.i}:${x.x | 0}:${x.y | 0}`).join(','); if (k !== last) { last = k; setLabels(l); } };
    shelf.start();
    const ro = new ResizeObserver(() => shelf.resize());
    ro.observe(wrapRef.current!);
    (window as Win).__figures = {
      shelf, specs: entries.map((e) => e.spec),
      buildAll: () => shelf.buildAll(),
      ready: () => texturesReady(),
      portrait: (id: string, size = 512) => { const e = entries.find((x) => x.spec.id === id); return e ? portrait(e.spec, size) : Promise.resolve(null); },
      fingerprint: (id: string) => { const e = entries.find((x) => x.spec.id === id); return e ? fingerprint(buildFigure(e.spec)) : null; },
      select: (i: number) => choose(i),
    };
    return () => { ro.disconnect(); shelf.dispose(); shelfRef.current = null; delete (window as Win).__figures; };
  }, [data]);

  const choose = (i: number) => {
    const shelf = shelfRef.current;
    if (!shelf || i < 0 || i >= entries.length) return;
    shelf.select(i);
    if (!shelf.fits()) shelf.go(i * shelf.gap);
    setSel(i); setHasSel(true);
    const r = route.peek();
    const p = new URLSearchParams(r.params);
    p.set('sel', entries[i].spec.id);
    history.replaceState(null, '', `#/figures?${p.toString()}`);
  };

  // drag to slide the shelf; a tap picks a piece
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let down: { x: number; y: number; goal: number; t: number; id: number } | null = null;
    let moved = false;
    const perPx = () => { const s = shelfRef.current!; return s.span / Math.max(1, c.clientWidth); };
    const pd = (e: PointerEvent) => { if (!shelfRef.current) return; down = { x: e.clientX, y: e.clientY, goal: shelfRef.current.goal, t: performance.now(), id: e.pointerId }; moved = false; c.setPointerCapture(e.pointerId); };
    const pm = (e: PointerEvent) => {
      const s = shelfRef.current;
      if (!s) return;
      if (down) {
        const dx = e.clientX - down.x;
        if (Math.abs(dx) > 6) moved = true;
        if (moved) s.go(down.goal - dx * perPx(), true);
      } else if (e.pointerType === 'mouse') {
        const r = c.getBoundingClientRect();
        const i = s.pick(e.clientX - r.left, e.clientY - r.top);
        c.style.cursor = i >= 0 ? 'pointer' : 'grab';
      }
    };
    const pu = (e: PointerEvent) => {
      const s = shelfRef.current;
      if (!s || !down) return;
      if (!moved) {
        const r = c.getBoundingClientRect();
        const i = s.pick(e.clientX - r.left, e.clientY - r.top);
        if (i >= 0) { if (i === s.selected) setModal(entries[i]); else choose(i); }
      } else {
        // a little momentum, then settle on the nearest piece
        const dt = Math.max(16, performance.now() - down.t);
        const v = ((e.clientX - down.x) / dt) * perPx() * (reducedMotion ? 0 : 140);
        s.go(s.goal - v);
      }
      down = null;
    };
    const wheel = (e: WheelEvent) => {
      const s = shelfRef.current;
      if (!s || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      s.go(s.goal + e.deltaX * 0.004);
    };
    c.addEventListener('pointerdown', pd);
    c.addEventListener('pointermove', pm);
    c.addEventListener('pointerup', pu);
    c.addEventListener('pointercancel', () => { down = null; });
    c.addEventListener('wheel', wheel, { passive: false });
    return () => { c.removeEventListener('pointerdown', pd); c.removeEventListener('pointermove', pm); c.removeEventListener('pointerup', pu); c.removeEventListener('wheel', wheel); };
  }, [data]);

  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); choose(Math.min(entries.length - 1, (hasSel ? sel : -1) + 1)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); choose(Math.max(0, (hasSel ? sel : 1) - 1)); }
    if (e.key === 'Enter' && hasSel) setModal(entries[sel]);
  };
  const cur = hasSel ? entries[sel] : null;
  const mobile = isMobile.value;
  return (
    <div class="figs">
      <header class="figs__head">
        <div class="eyebrow">{data.eyebrow}</div>
        <h1 class="h-page">{data.title}</h1>
        <p class="figs__lede">{data.lede}</p>
        {data.mode === 'lives' && eras.length > 1 && (
          <nav class="figs__eras" aria-label="Jump to an age">
            {eras.map(([era, i]) => <button type="button" class={`chip${cur && cur.spec.era === era ? ' is-on' : ''}`} onClick={() => choose(i)}>{ERA_NAMES[era].replace(/^Age of /, '')}</button>)}
          </nav>
        )}
        {data.mode !== 'lives' && <p class="figs__back"><a href="#/figures">All the Lives as figures</a>{data.house && <> · <a href={`#/dynasty/${data.house}`}>The house’s tree</a></>}</p>}
      </header>
      <div class="figs__stage" ref={wrapRef} tabIndex={0} onKeyDown={key} aria-label="The shelf of figures: drag or use the arrow keys to move along it; tap a piece to choose it">
        {failed ? <p class="figm__fail">This browser could not draw the pieces ({failed}).</p> : <canvas ref={canvasRef} class="figs__canvas" />}
        <div class="figs__labels" aria-hidden="true">
          {labels.filter((l) => l.on).map((l) => {
            const e = entries[l.i];
            return (
              <button type="button" tabIndex={-1} class={`figs__lab${l.i === sel && hasSel ? ' is-on' : ''}`} style={{ left: `${l.x}px`, top: `${l.y}px` }} onClick={() => choose(l.i)}>
                <span class="figs__lab-n">{e.spec.name}</span>
                {!mobile && <span class="figs__lab-r">{roleLine(e.spec).replace(/, [\d–]+$/, '')}</span>}
              </button>
            );
          })}
        </div>
        <button type="button" class="btn-icon figs__nav figs__nav--l" aria-label="Previous piece" onClick={() => choose(Math.max(0, (hasSel ? sel : 1) - 1))}>‹</button>
        <button type="button" class="btn-icon figs__nav figs__nav--r" aria-label="Next piece" onClick={() => choose(Math.min(entries.length - 1, (hasSel ? sel : -1) + 1))}>›</button>
      </div>
      <section class="figs__card" aria-live="polite">
        {cur ? (
          <>
            <div class="eyebrow">{ERA_NAMES[cur.spec.era]}{cur.year !== undefined ? ` · shown in AY ${cur.spec.year}` : ''}</div>
            <h2 class="figs__name"><a href={`#/p/${cur.spec.id}`}>{cur.spec.name}</a></h2>
            <div class="figm__role">{roleLine(cur.spec)}</div>
            <div class="figm__life">{lifeLine(cur.spec)}{cur.spec.death && cur.spec.death !== 'natural' ? ` · ${cur.spec.death === 'battle' ? 'fell in battle' : cur.spec.death}` : ''}</div>
            <ul class="figm__notes">{figureNotes(cur.spec, sigilBlazon(cur.spec.sigil)).map((n) => <li>{n}</li>)}</ul>
            <div class="actions">
              <button class="btn" type="button" onClick={() => setModal(cur)}>Turn it</button>
              {cur.life && <a class="btn btn--accent" href={`#/p/${cur.life}`}>Read the Life</a>}
              <a class="btn btn--ghost" href={`#/p/${cur.spec.id}`}>Open the page</a>
            </div>
          </>
        ) : <p class="muted figs__tip">{mobile ? 'Swipe along the shelf; tap a piece to see why it looks as it does.' : 'Drag along the shelf (or use ← →); click a piece to see why it looks as it does.'}</p>}
      </section>
      {modal && <FigureModal source={modal.source} year={modal.year} onClose={() => setModal(null)} />}
    </div>
  );
}

export type { PageJson };
