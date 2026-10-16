import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { HistomapJson } from '../../../engine/src/export/contract.ts';
import { buildStreams, loadHistomap, shareAt, streamPath, type Stream } from '../histomap.ts';
import { isMobile, mapHref, navigate, route, theme } from '../state.ts';
import { ensureMeta, meta } from '../store.ts';
import { fmtCompact } from '../format.ts';

interface Label { x: number; y: number; size: number; text: string; id: string }
interface Hover { s: Stream; year: number; x: number; y: number }

const ROMANS = (n: number) => n.toLocaleString('en-US');
function popAt(h: HistomapJson, year: number): number {
  let i = 0;
  while (i < h.years.length - 1 && h.years[i + 1] <= year) i++;
  return h.worldPop[i] ?? 0;
}

export function HistomapView() {
  const [h, setH] = useState<HistomapJson | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);
  const exportMode = route.value.params.get('export') === '1';
  const m = meta.value;
  const mobile = isMobile.value && !exportMode;
  useEffect(() => { loadHistomap().then(setH).catch((e) => setErr(String(e))); ensureMeta().catch(() => {}); }, []);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [h]);
  useEffect(() => { document.title = `${m?.title ?? 'Palimpsest'} — Histomap`; }, [m]);

  const geo = useMemo(() => (h ? buildStreams(h) : null), [h]);
  const L = mobile ? 40 : 92, R = mobile ? 8 : 210, TOP = 18;
  const width = Math.max(300, w);
  const cw = width - L - R;
  const yearEnd = h ? h.years[h.years.length - 1] + 25 : 5000;
  const pxPerYear = exportMode ? 0.92 : mobile ? 0.64 : 0.86;
  const height = TOP + yearEnd * pxPerYear + 24;
  const X = (f: number) => L + f * cw;
  const T = (y: number) => TOP + y * pxPerYear;

  const paths = useMemo(() => {
    if (!h || !geo || cw <= 0) return [];
    return geo.streams.map((st) => ({ st, d: streamPath(st, h.years, X, T, true) }));
  }, [h, geo, cw, pxPerYear]);

  const lesserPath = useMemo(() => {
    if (!h || !geo || cw <= 0) return '';
    return `M${L},${T(0)}H${L + cw}V${T(yearEnd)}H${L}Z`;
  }, [h, geo, cw]);

  const labels = useMemo(() => {
    if (!h || !geo || cw <= 0) return [] as Label[];
    const out: Label[] = [];
    const minSize = mobile ? 7.5 : 9;
    for (const st of geo.streams) {
      const name = st.s.name.toUpperCase();
      const placed: number[] = [];
      // the widest point first, then the widest point of each ~900-year stretch
      const cands: number[] = [st.idx.indexOf(st.peak)];
      const step = h.years.length > 1 ? h.years[1] - h.years[0] : 25;
      const span = Math.max(4, Math.round(900 / step));
      for (let k = 0; k < st.idx.length; k += span) {
        let best = k;
        for (let j = k; j < Math.min(st.idx.length, k + span); j++) if (st.x1[j] - st.x0[j] > st.x1[best] - st.x0[best]) best = j;
        cands.push(best);
      }
      for (const k of cands) {
        if (k < 0) continue;
        const wpx = (st.x1[k] - st.x0[k]) * cw;
        const size = Math.min(mobile ? 15 : 24, wpx / (name.length * 0.72 + 1.2));
        if (size < minSize) continue;
        const y = T(h.years[st.idx[k]]);
        if (placed.some((py) => Math.abs(py - y) < Math.max(160, size * 12))) continue;
        placed.push(y);
        out.push({ x: X((st.x0[k] + st.x1[k]) / 2), y, size, text: name, id: st.s.id });
        if (placed.length >= 4) break;
      }
    }
    return out;
  }, [h, geo, cw, mobile, pxPerYear]);

  const onMove = (e: PointerEvent) => {
    if (!h || !geo) return;
    const t = e.target as SVGElement;
    const id = t.getAttribute?.('data-id');
    const st = id ? geo.streams.find((s) => s.s.id === id) : undefined;
    if (!st) { if (e.pointerType === 'mouse') setHover(null); return; }
    const svg = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const year = Math.max(0, Math.min(yearEnd, Math.round((e.clientY - svg.top - TOP) / pxPerYear)));
    setHover({ s: st, year, x: e.clientX - svg.left, y: e.clientY - svg.top });
  };

  if (err) return <div class="banner">Couldn’t load the Histomap: {err}</div>;
  const dark = theme.value === 'dark';
  return (
    <div class={`histomap${exportMode ? ' histomap--export' : ''}`}>
      <header class="histomap__head">
        <div class="eyebrow">After John B. Sparks, 1931</div>
        <h1 class="h-page histomap__title">The Histomap of {m?.worldName ?? 'the world'}</h1>
        <p class="histomap__lede">
          Five thousand years of relative power. Every state is a stream, flowing down through time; its width is its share of
          all the people in the world. Streams run west to east by capital, so neighbours flow side by side. The muted margins are
          lesser states and stateless peoples.
        </p>
        {!exportMode && <p class="muted small">{mobile ? 'Tap' : 'Hover'} a stream for its story; {mobile ? 'tap again' : 'click'} to open its page. <a href="#/river">Walk it in 3D: the River of Time →</a></p>}
      </header>
      <div class="histomap__chart" ref={wrapRef} onPointerLeave={() => { if (!mobile) setHover(null); }}>
        {h && geo && w > 0 && (
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} class={`hm${hover ? ' has-hover' : ''}`} role="img"
            aria-label={`Histomap: ${geo.streams.length} states over ${yearEnd} years`}
            onPointerMove={onMove}
            onPointerDown={(e) => { if (e.pointerType !== 'mouse') onMove(e); }}
            onClick={(e) => {
              const id = (e.target as SVGElement).getAttribute?.('data-id');
              if (!id) { setHover(null); return; }
              if (mobile) return; // phones: the card has the links
              navigate(`#/p/${id}`);
            }}>
            <defs>
              <pattern id="hm-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
                <rect width="6" height="6" fill={dark ? '#1a2029' : '#ebe4d4'} />
                <line x1="0" y1="0" x2="0" y2="6" stroke={dark ? '#252c36' : '#ddd3bf'} stroke-width="2.2" />
              </pattern>
            </defs>
            {/* lesser states and stateless peoples */}
            <path d={lesserPath} fill="url(#hm-hatch)" />
            {/* era bands */}
            {m?.eras.map((e, i) => (
              <g class="hm-era">
                {i > 0 && <line x1={L - (mobile ? 0 : 8)} x2={L + cw + (mobile ? 0 : 12)} y1={T(e.start)} y2={T(e.start)} class="hm-era__line" />}
                {!mobile && (() => {
                  const span = (Math.min(e.end, yearEnd) - e.start) * pxPerYear;
                  return (
                    <foreignObject x={L + cw + 22} y={T(e.start) + 6} width={R - 30} height={Math.max(44, span - 10)}>
                      <div class="hm-era__box">
                        <div class="hm-era__name">{e.name}</div>
                        <div class="hm-era__years">{e.start}–{e.end} AY</div>
                        {span > 150 && <p class="hm-era__blurb">{e.blurb}</p>}
                      </div>
                    </foreignObject>
                  );
                })()}
              </g>
            ))}
            {/* streams */}
            <g class="hm-streams">
              {paths.map(({ st, d }) => (
                <path d={d} class="hm-s" data-id={st.s.id} fill={st.s.color} />
              ))}
            </g>
            {hover && <path d={paths.find((p) => p.st === hover.s)?.d} class="hm-s-hl" />}
            {/* century ticks */}
            <g class="hm-axis">
              {Array.from({ length: Math.floor(yearEnd / 100) + 1 }, (_, k) => k * 100).map((y) => (
                <>
                  <line x1={L - (y % 500 === 0 ? 12 : 6)} x2={L} y1={T(y)} y2={T(y)} class={y % 500 === 0 ? 'major' : ''} />
                  {y % 500 === 0 && <text x={L - (mobile ? 13 : 15)} y={T(y) + 4} text-anchor="end" class={mobile ? 'sm' : ''}>{mobile ? y : `${y} AY`}</text>}
                  {y % 500 === 0 && y > 0 && <line x1={L} x2={L + cw} y1={T(y)} y2={T(y)} class="hm-grid" />}
                </>
              ))}
            </g>
            {/* labels */}
            <g class="hm-labels" aria-hidden="true">
              {labels.map((l) => (
                <text x={l.x} y={l.y} font-size={l.size.toFixed(1)} text-anchor="middle" dominant-baseline="middle" letter-spacing={(l.size * 0.12).toFixed(1)}>{l.text}</text>
              ))}
            </g>
            {mobile && m?.eras.map((e) => (
              <text x={L + 6} y={T(e.start) + 14} class="hm-era__tag">{e.name.toUpperCase()}</text>
            ))}
          </svg>
        )}
        {hover && h && (
          <div class={`hm-tip${mobile ? ' hm-tip--sheet' : ''}`} style={mobile ? undefined : { transform: `translate(${Math.min(hover.x + 16, width - 280)}px, ${hover.y + 16}px)` }}>
            <div class="hm-tip__n">{hover.s.s.name}</div>
            <div class="hm-tip__y">{hover.s.s.start}–{hover.s.s.end >= 5000 ? 'present' : hover.s.s.end} AY</div>
            <div class="hm-tip__s">
              <strong>{(shareAt(hover.s.s, h.years, hover.year) * 100).toFixed(1)}%</strong> of the world’s people in {hover.year} AY
              {h.worldPop.length ? <> (≈{fmtCompact(shareAt(hover.s.s, h.years, hover.year) * popAt(h, hover.year))} people)</> : null}
            </div>
            {mobile && (
              <div class="actions">
                <a class="btn btn--accent" href={`#/p/${hover.s.s.id}`}>Open page</a>
                <a class="btn" href={mapHref({ y: hover.year, sel: hover.s.s.id, l: 'political' })}>On the map</a>
                <button class="btn btn--ghost" onClick={() => setHover(null)}>Close</button>
              </div>
            )}
          </div>
        )}
        {!h && <div class="center-load"><div class="spinner" /> Drawing the streams…</div>}
      </div>
      {!exportMode && geo && (
        <details class="a11ylist">
          <summary>All {geo.streams.length} states in the chart, as a list</summary>
          <ul>
            {geo.streams.slice().sort((a, b) => a.s.start - b.s.start).map((st) => (
              <li><a href={`#/p/${st.s.id}`}>{st.s.name}</a> <span class="muted small">AY {st.s.start}–{st.s.end >= 5000 ? 'present' : st.s.end} · at most {(Math.max(...st.s.share) * 100).toFixed(0)}% of the world’s people</span></li>
            ))}
          </ul>
        </details>
      )}
      {exportMode && m && (
        <footer class="histomap__foot">
          {m.title} · {ROMANS(m.counts.artifact ?? 0)} primary sources · {ROMANS(m.check.invariants.reduce((s, i) => s + i.checked, 0))} facts checked · ankitb073.github.io/civilization
        </footer>
      )}
    </div>
  );
}

/** Compact horizontal version (time runs left → right) for the About page and the map panel. */
export function HistomapThumb({ height = 120 }: { height?: number }) {
  const [h, setH] = useState<HistomapJson | null>(null);
  const ref = useRef<HTMLAnchorElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => { loadHistomap().then(setH).catch(() => {}); }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const m = meta.value;
  const geo = useMemo(() => (h ? buildStreams(h) : null), [h]);
  const end = h ? h.years[h.years.length - 1] + 25 : 5000;
  const paths = useMemo(() => {
    if (!h || !geo || !w) return [];
    const X = (f: number) => 2 + f * (height - 4);
    const T = (y: number) => (y / end) * w;
    return geo.streams.map((st) => ({ id: st.s.id, color: st.s.color, d: streamPath(st, h.years, X, T, false) }));
  }, [h, geo, w, height]);
  return (
    <a class="hmthumb" href="#/histomap" ref={ref} aria-label="Open the Histomap">
      {w > 0 && (
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label="Histomap thumbnail: states as streams over five thousand years">
          <rect x="0" y="0" width={w} height={height} class="hmthumb__bg" />
          {paths.map((p) => <path d={p.d} fill={p.color} stroke={p.color} stroke-width="0.4" />)}
          {m?.eras.slice(1).map((e) => <line x1={(e.start / end) * w} x2={(e.start / end) * w} y1={0} y2={height} class="hmthumb__era" />)}
        </svg>
      )}
      <span class="hmthumb__cap">The Histomap — five thousand years of relative power →</span>
    </a>
  );
}
