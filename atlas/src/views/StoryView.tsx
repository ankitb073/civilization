import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { StoryJson } from '../../../engine/src/export/contract.ts';
import { fetchJson } from '../data.ts';
import { inline, render } from '../md.ts';
import { isMobile, mapHref, theme } from '../state.ts';
import { ensureMapData, ensureMeta, eraAt, mapData, meta, titleOf } from '../store.ts';
import { MapRenderer } from './mapRenderer.ts';
import { fmtYear } from '../format.ts';

/** Scroll a stop into the reading zone (below the sticky map on phones). */
function scrollToStop(key: string, smooth: boolean) {
  const el = document.querySelector<HTMLElement>(`[data-stop="${key}"]`);
  if (!el) return;
  const narrow = matchMedia('(max-width: 899px)').matches;
  const top = el.getBoundingClientRect().top + window.scrollY;
  const offset = narrow ? window.innerHeight * 0.52 : window.innerHeight * 0.36;
  window.scrollTo({ top: Math.max(0, top - offset), behavior: smooth ? 'smooth' : 'auto' });
}

let storyP: Promise<StoryJson> | null = null;
function loadStory(): Promise<StoryJson> {
  if (!storyP) { storyP = fetchJson<StoryJson>('story.json'); storyP.catch(() => { storyP = null; }); }
  return storyP;
}

interface Stop { key: string; year: number; cell: number; chapter: number }

/** Scrollytelling through the eras: text on the left, the map following along on the right. */
export function StoryView() {
  const [story, setStory] = useState<StoryJson | null>(null);
  const [active, setActive] = useState('c0');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const beaconRef = useRef<HTMLDivElement>(null);
  const rendRef = useRef<MapRenderer | null>(null);
  const yearRef = useRef(0);
  const [mapYear, setMapYear] = useState(0);
  const d = mapData.value;
  const m = meta.value;
  const mobile = isMobile.value;

  useEffect(() => {
    loadStory().then(setStory).catch(() => {});
    ensureMapData().catch(() => {});
    ensureMeta().catch(() => {});
    document.title = 'The story of five thousand years — Palimpsest';
  }, []);

  const stops = useMemo(() => {
    const out = new Map<string, Stop>();
    story?.chapters.forEach((c, ci) => {
      out.set(`c${ci}`, { key: `c${ci}`, year: c.start, cell: -1, chapter: ci });
      c.beats.forEach((b, bi) => out.set(`c${ci}b${bi}`, { key: `c${ci}b${bi}`, year: b.year, cell: b.cell, chapter: ci }));
    });
    return out;
  }, [story]);

  // the map
  useEffect(() => {
    if (!d || !canvasRef.current) return;
    const r = new MapRenderer(canvasRef.current, d, theme.peek());
    rendRef.current = r;
    r.year = yearRef.current;
    r.resize();
    r.onDraw = () => placeBeacon();
    const ro = new ResizeObserver(() => r.resize());
    ro.observe(stageRef.current!);
    return () => { ro.disconnect(); rendRef.current = null; };
  }, [d]);
  useEffect(() => { rendRef.current?.setTheme(theme.value); }, [theme.value]);

  const beaconCell = useRef(-1);
  const placeBeacon = () => {
    const r = rendRef.current, b = beaconRef.current, dd = mapData.peek();
    if (!r || !b || !dd) return;
    const c = beaconCell.current;
    if (c < 0) { b.style.opacity = '0'; return; }
    const [x, y] = r.toScreen(dd.geo.sx[c], dd.geo.sy[c]);
    b.style.opacity = '1';
    b.style.transform = `translate(${x}px, ${y}px)`;
  };

  // follow the active stop: tween the year, fly the camera, mark the place
  useEffect(() => {
    const r = rendRef.current;
    const st = stops.get(active);
    if (!r || !st || !d) return;
    beaconCell.current = st.cell;
    r.selected = st.cell >= 0 ? `cell:${st.cell}` : null;
    if (st.cell >= 0) r.flyTo(d.geo.sx[st.cell], d.geo.sy[st.cell], mobile ? 2.4 : 2.1, 1100);
    else r.flyTo(-1, -1, 1, 1100);
    const from = yearRef.current, to = st.year, t0 = performance.now(), ms = Math.min(1600, 500 + Math.abs(to - from) * 0.6);
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const y = Math.round(from + (to - from) * e);
      yearRef.current = y;
      r.year = y;
      r.invalidate();
      setMapYear(y);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    try { history.replaceState(null, '', `#/story?at=${active}`); } catch { /* ignore */ }
    return () => cancelAnimationFrame(raf);
  }, [active, stops, d]);

  // which section is in the middle of the reading area?
  useEffect(() => {
    if (!story) return;
    const els = [...document.querySelectorAll<HTMLElement>('[data-stop]')];
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting);
      if (vis.length) setActive(vis[vis.length - 1].target.getAttribute('data-stop')!);
    }, { rootMargin: mobile ? '-55% 0px -35% 0px' : '-42% 0px -48% 0px' });
    els.forEach((el) => io.observe(el));
    // deep link
    const at = new URLSearchParams(location.hash.split('?')[1] ?? '').get('at');
    if (at) scrollToStop(at, false);
    return () => io.disconnect();
  }, [story, mobile]);

  const activeStop = stops.get(active);
  const era = eraAt(mapYear);
  return (
    <div class="story">
      <div class="story__map">
        <div class="story__stage" ref={stageRef}>
          <canvas ref={canvasRef} class="story__canvas" aria-label="Map following the story" role="img" />
          <div class="story__beacon" ref={beaconRef} aria-hidden="true"><span /></div>
          <div class="story__year">
            <span class="story__y">{mapYear}</span><span class="story__u">AY</span>
            <span class="story__era">{era?.name}</span>
          </div>
          {!d && <div class="mapview__loading"><div class="spinner" /> Unrolling the map…</div>}
        </div>
      </div>
      <div class="story__text">
        <header class="story__head" data-stop="c0-head">
          <div class="eyebrow">The story</div>
          <h1 class="h-page story__title">Five thousand years of {m?.worldName ?? 'a world'}</h1>
          <p class="story__lede">Seven ages, told through the moments that shaped them — and the documents that remember them. Scroll; the map follows.</p>
          {story && (
            <nav class="story__toc" aria-label="Chapters">
              {story.chapters.map((c, ci) => (
                <button class={`story__chip${activeStop?.chapter === ci ? ' is-on' : ''}`} onClick={() => scrollToStop(`c${ci}`, true)}>
                  {c.title.replace(/^Age of /, '')}
                </button>
              ))}
            </nav>
          )}
        </header>
        {!story && <div class="center-load"><div class="spinner" /> Gathering the chronicles…</div>}
        {story?.chapters.map((c, ci) => (
          <section class="story__chapter" aria-labelledby={`ch-${ci}`}>
            <div class={`story__intro${active === `c${ci}` ? ' is-active' : ''}`} data-stop={`c${ci}`}>
              <div class="story__num">Chapter {ci + 1} · {c.start}–{c.end} AY</div>
              <h2 id={`ch-${ci}`} class="story__ctitle">{c.title}</h2>
              <div class="prose story__intro-text" dangerouslySetInnerHTML={{ __html: render(c.intro, titleOf) }} />
            </div>
            {c.beats.map((b, bi) => {
              const key = `c${ci}b${bi}`;
              return (
                <article class={`story__beat${active === key ? ' is-active' : ''}`} data-stop={key}>
                  <div class="story__by">{fmtYear(b.year)}</div>
                  <h3 class="story__bt"><a href={`#/p/${b.eventId}`}>{b.title}</a></h3>
                  <p class="story__bx" dangerouslySetInnerHTML={{ __html: inline(b.text, titleOf) }} />
                  {b.docs.length > 0 && (
                    <div class="story__docs">
                      <span class="story__read">Read</span>
                      <ul>
                        {b.docs.map((doc) => (
                          <li>
                            <a href={`#/p/${doc.id}`} class={doc.flagship ? 'is-flag' : ''}>
                              {doc.flagship && <span class="story__star" title="Flagship source">★</span>}{doc.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <a class="story__onmap" href={mapHref({ y: b.year, sel: b.eventId, l: 'political' })}>See it on the atlas →</a>
                </article>
              );
            })}
          </section>
        ))}
        {story && (
          <footer class="story__end">
            <p>That is the story the archive tells. There are {m ? (m.counts.artifact ?? 0).toLocaleString('en-US') : 'thousands of'} documents behind it.</p>
            <div class="actions"><a class="btn btn--accent" href="#/browse?kind=artifact&flag=1">Read the flagship sources</a><a class="btn" href={mapHref({ y: 2500 })}>Explore the atlas</a></div>
          </footer>
        )}
      </div>
    </div>
  );
}
