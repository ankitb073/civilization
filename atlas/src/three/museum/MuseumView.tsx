// #/museum — the hall of celebrated documents (engine/src/export/museum.ts picks them by rules over the record),
// each built in 3D from its record. #/museum/art:N opens the hall in front of that object.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MuseumJson } from '../../../../engine/src/export/contract.ts';
import { fetchJson } from '../../data.ts';
import { isMobile, reducedMotion, theme } from '../../state.ts';
import { ensureMeta, meta } from '../../store.ts';
import { Hall, type HallEntry } from './hall.ts';
import { specOf, sizeLabel } from './record.ts';
import { ensureFonts } from './paint.ts';
import { Viewer } from './Viewer.tsx';
import './museum.css';

type Item = MuseumJson['items'][number];

export function MuseumView({ id }: { id: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hallRef = useRef<Hall | null>(null);
  const [data, setData] = useState<MuseumJson | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [progress, setProgress] = useState(0);
  const [overview, setOverview] = useState(false);
  const [inspect, setInspect] = useState<Item | null>(null);
  const [hover, setHover] = useState(false);
  const m = meta.value;

  useEffect(() => { ensureMeta().catch(() => {}); fetchJson<MuseumJson>('museum.json').then(setData).catch((e) => setErr(String(e))); }, []);
  useEffect(() => { document.title = `The Museum — ${m?.title ?? 'Palimpsest'}`; }, [m]);

  const entries = useMemo<HallEntry[] | null>(() => {
    if (!data || !m) return null;
    const starts = m.eras.map((e) => e.start);
    return data.items.map((it) => {
      let k = 0;
      starts.forEach((s, i) => { if (it.page.t0 >= s) k = i; });
      return { spec: specOf(it.page, { arms: it.arms, sigil: it.sigil ?? null, eraStarts: starts }), why: it.why, page: it.page, arms: it.arms, sigil: it.sigil, era: m.eras[k]?.name ?? '', eraIdx: k };
    });
  }, [data, m]);

  // the hall
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => { ensureFonts().then(() => setFontsReady(true)); }, []);
  useEffect(() => {
    if (!entries || !fontsReady || !canvasRef.current) return;
    const start = Math.max(0, id ? entries.findIndex((e) => e.page.id === id) : 0);
    let hall: Hall;
    try {
      hall = new Hall(canvasRef.current, entries, { theme: theme.peek(), reducedMotion, mobile: isMobile.peek() }, start);
    } catch (e) {
      setErr(`This browser could not draw the hall (${String((e as Error)?.message ?? e)}).`);
      return;
    }
    hallRef.current = hall;
    const w = window as unknown as { __museumHall?: Hall; __museumGo?: (i: number) => void };
    w.__museumHall = hall;
    w.__museumGo = (i: number) => hall.go(i);
    hall.onFocus = (i) => {
      setFocus(i);
      const pid = entries[i]?.page.id;
      if (pid) history.replaceState(null, '', `#/museum/${pid}`);
    };
    hall.onProgress = (b) => setProgress(b);
    setFocus(start);
    hall.resize();
    hall.start();
    const ro = new ResizeObserver(() => hall.resize());
    ro.observe(canvasRef.current.parentElement!);
    // pointer: drag to turn, tap to choose (tap the chosen one to inspect it)
    const el = canvasRef.current;
    let down: { x: number; y: number; id: number; moved: boolean } | null = null;
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false }; el.setPointerCapture(e.pointerId); };
    const pm = (e: PointerEvent) => {
      if (down && e.pointerId === down.id) {
        const dx = e.clientX - down.x;
        if (!down.moved && Math.abs(dx) + Math.abs(e.clientY - down.y) > 6) down.moved = true;
        if (down.moved) { hall.drag(dx); down.x = e.clientX; down.y = e.clientY; }
      } else if (e.pointerType === 'mouse') setHover(hall.pick(e.clientX, e.clientY) >= 0);
    };
    const pu = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      const wasMoved = down.moved;
      down = null;
      if (wasMoved) { hall.release(); return; }
      const i = hall.pick(e.clientX, e.clientY);
      if (i < 0) return;
      if (!hall.overview && i === hall.focus) setInspect(data!.items[i]);
      else { hall.go(i); setOverview(false); }
    };
    const wheel = (() => {
      let acc = 0, last = 0;
      return (e: WheelEvent) => {
        e.preventDefault();
        acc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const now = performance.now();
        if (Math.abs(acc) > 60 && now - last > 280) { if (acc > 0) hall.next(); else hall.prev(); acc = 0; last = now; setOverview(false); }
      };
    })();
    el.addEventListener('pointerdown', pd);
    el.addEventListener('pointermove', pm);
    el.addEventListener('pointerup', pu);
    el.addEventListener('pointercancel', pu);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('pointerdown', pd);
      el.removeEventListener('pointermove', pm);
      el.removeEventListener('pointerup', pu);
      el.removeEventListener('pointercancel', pu);
      el.removeEventListener('wheel', wheel);
      hall.dispose();
      hallRef.current = null;
    };
  }, [entries, fontsReady, theme.value]);

  // keyboard
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (inspect || !hallRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea|select/i.test(t.tagName)) return;
      if (e.key === 'ArrowRight') { hallRef.current.next(); setOverview(false); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { hallRef.current.prev(); setOverview(false); e.preventDefault(); }
      else if (e.key === 'Enter' && data) { setInspect(data.items[hallRef.current.focus]); e.preventDefault(); }
      else if (e.key === 'o') { const on = !hallRef.current.overview; hallRef.current.setOverview(on); setOverview(on); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [inspect, data]);

  if (err) return <div class="mu"><div class="mu__msg">{/HTTP 404/.test(err) ? 'The museum’s catalogue is not in this build of the archive yet.' : err}</div></div>;
  const n = entries?.length ?? 0;
  const e = entries?.[focus];
  const item = data?.items[focus];
  const scale = e && hallRef.current?.slots[focus]?.scale;
  return (
    <div class="mu">
      <canvas ref={canvasRef} class={`mu__canvas${hover ? ' is-hover' : ''}`} tabIndex={0} aria-label="The museum hall: drag or use the arrow keys to turn from one object to the next; tap an object to look at it closely" />
      <div class="mu__intro">
        <h1>The Museum</h1>
        <p>{n ? `${n} documents of ${m?.worldName ?? 'the archive'}, each built in three dimensions from its own record: the stone, the clay, the metal and the words are the record’s.` : 'Opening the doors…'}</p>
        {n > 0 && progress < n && <div class="mu__progress">Placing the objects… {progress} of {n}</div>}
      </div>
      {!entries && !err && <div class="mu__msg"><div class="spinner" /></div>}
      {e && item && !overview && (
        <div class="mu__card" aria-live="polite">
          <div class="mu__count">{focus + 1} of {n} · {e.era}</div>
          <h2 class="mu__t"><a href={`#/p/${e.page.id}`}>{e.page.title}</a></h2>
          <div class="mu__meta">{e.spec.date || `AY ${e.page.t0}`} · {e.spec.medium} · {sizeLabel(e.spec)}{scale && scale > 1.05 ? ` · shown ×${scale >= 3 ? Math.round(scale) : scale.toFixed(1)}` : ''}</div>
          <p class="mu__why">{e.why}</p>
          <div class="mu__row">
            <button class="btn btn--accent" onClick={() => setInspect(item)}>Look closely</button>
            <a class="btn btn--ghost" href={`#/p/${e.page.id}`}>Read the record</a>
          </div>
        </div>
      )}
      {n > 0 && (
        <div class="mu__nav">
          <button class="mu__btn" aria-label="Previous object" disabled={focus <= 0 && !overview} onClick={() => { hallRef.current?.prev(); setOverview(false); }}>‹</button>
          <button class={`mu__btn${overview ? ' is-on' : ''}`} aria-pressed={overview} onClick={() => { const on = !overview; hallRef.current?.setOverview(on); setOverview(on); }}>Overview</button>
          <button class="mu__btn" aria-label="Next object" disabled={focus >= n - 1 && !overview} onClick={() => { hallRef.current?.next(); setOverview(false); }}>›</button>
        </div>
      )}
      {inspect && <Viewer page={inspect.page} extras={{ arms: inspect.arms, sigil: inspect.sigil ?? null }} why={inspect.why} onClose={() => setInspect(null)} />}
    </div>
  );
}
