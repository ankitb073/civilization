import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { EconomyJson } from '../../../engine/src/export/contract.ts';
import { fetchJson } from '../data.ts';
import { Sparkline } from '../components/Sparkline.tsx';
import { isMobile, navigate } from '../state.ts';
import { ensureMapData, ensureMeta, mapData, meta } from '../store.ts';
import { subLabel } from '../format.ts';

let econP: Promise<EconomyJson> | null = null;
function loadEconomy(): Promise<EconomyJson> {
  if (!econP) { econP = fetchJson<EconomyJson>('economy.json'); econP.catch(() => { econP = null; }); }
  return econP;
}

const SERIES = [
  { key: 1, name: 'Grain', unit: 'measure', color: '#b8862e' },
  { key: 2, name: 'Tin', unit: 'mina', color: '#4d6f96' },
  { key: 3, name: 'Iron', unit: 'mina', color: '#8e2f1f' },
] as const;

const LANES: { sub: string; label: string; color: string; shape: 'diamond' | 'triangle' | 'square' | 'circle' | 'cross' }[] = [
  { sub: 'debasement', label: 'Debasements', color: '#a3363a', shape: 'diamond' },
  { sub: 'default', label: 'Defaults', color: '#5a1a1a', shape: 'cross' },
  { sub: 'trade-collapse', label: 'Trade collapses', color: '#7a634a', shape: 'square' },
  { sub: 'paper-money', label: 'First banknotes', color: '#2f5d7c', shape: 'circle' },
  { sub: 'hyperinflation', label: 'Hyperinflations', color: '#d0601a', shape: 'triangle' },
];

/** Rolling median (window w) over contiguous non-null runs. */
function smooth(pts: [number, number | null][], w = 5): [number, number | null][] {
  const out: [number, number | null][] = [];
  for (let i = 0; i < pts.length; i++) {
    if (pts[i][1] === null) { out.push([pts[i][0], null]); continue; }
    const win: number[] = [];
    for (let j = Math.max(0, i - (w >> 1)); j <= Math.min(pts.length - 1, i + (w >> 1)); j++) if (pts[j][1] !== null) win.push(pts[j][1] as number);
    win.sort((a, b) => a - b);
    out.push([pts[i][0], win[win.length >> 1]]);
  }
  return out;
}

function pathOf(pts: [number, number | null][], X: (y: number) => number, Y: (v: number) => number): string {
  let d = '', pen = false;
  for (const [yr, v] of pts) {
    if (v === null || !(v > 0)) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${X(yr).toFixed(1)},${Y(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

function glyph(shape: string, x: number, y: number, r: number): string {
  switch (shape) {
    case 'diamond': return `M${x},${y - r}L${x + r},${y}L${x},${y + r}L${x - r},${y}Z`;
    case 'triangle': return `M${x},${y - r}L${x + r},${y + r * 0.8}L${x - r},${y + r * 0.8}Z`;
    case 'square': return `M${x - r * 0.8},${y - r * 0.8}h${r * 1.6}v${r * 1.6}h${-r * 1.6}Z`;
    case 'cross': { const k = r * 0.35; return `M${x - r},${y - r + k}L${x - r + k},${y - r}L${x},${y - k}L${x + r - k},${y - r}L${x + r},${y - r + k}L${x + k},${y}L${x + r},${y + r - k}L${x + r - k},${y + r}L${x},${y + k}L${x - r + k},${y + r}L${x - r},${y + r - k}L${x - k},${y}Z`; }
    default: return `M${x - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
}

export function PricesView() {
  const [e, setE] = useState<EconomyJson | null>(null);
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const [hoverEv, setHoverEv] = useState<{ ev: EconomyJson['events'][number]; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const m = meta.value;
  const mobile = isMobile.value;
  useEffect(() => { loadEconomy().then(setE).catch(() => {}); ensureMeta().catch(() => {}); ensureMapData().catch(() => {}); document.title = 'What things cost — Palimpsest'; }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [e]);

  const series = useMemo(() => (e ? SERIES.map((s) => ({ ...s, pts: smooth(e.prices.map((p) => [p[0], p[s.key] as number | null])) })) : []), [e]);
  const level = useMemo(() => (e ? smooth(e.priceLevel.map(([y, v]) => [y, v] as [number, number | null])) : []), [e]);

  const lede = useMemo(() => {
    if (!e || !series.length) return null;
    const stat = (k: number) => {
      const v = series[k].pts.filter((p) => p[1] !== null) as [number, number][];
      return { first: v[0], last: v[v.length - 1], min: Math.min(...v.map((p) => p[1])), max: Math.max(...v.map((p) => p[1])), maxAt: v.reduce((a, b) => (b[1] > a[1] ? b : a)) };
    };
    const g = stat(0), t = stat(1), i = stat(2);
    const n = (sub: string) => e.events.filter((x) => x.sub === sub).length;
    return { g, t, i, deb: n('debasement'), hyper: n('hyperinflation'), def: n('default') };
  }, [e, series]);

  const issuer = (id: string) => {
    const d = mapData.value;
    if (!d) return '';
    const idx = d.layers.political.layer.legend.find((l) => l.id === id);
    return idx?.name ?? '';
  };

  const debased = useMemo(() => {
    if (!e) return [];
    return e.currencies
      .filter((c) => c.history.length > 1 && c.history[0][1] > 0)
      .map((c) => ({ c, ratio: c.history[c.history.length - 1][1] / c.history[0][1] }))
      .sort((a, b) => a.ratio - b.ratio);
  }, [e]);
  const coins = debased.filter((d) => d.c.kind === 'coin').slice(0, 6);

  if (!e) return <div class="center-load"><div class="spinner" /> Opening the ledgers…</div>;

  const width = Math.max(300, w);
  const L = mobile ? 34 : 52, R = mobile ? 50 : 96, T = 26;
  const H1 = mobile ? 230 : 330, H2 = mobile ? 110 : 140, LANE = mobile ? 12 : 16, GAP = 26;
  const lanesH = LANES.length * LANE + 10;
  const total = T + H1 + GAP + lanesH + H2 + 26;
  const x0 = 0, x1 = 5000;
  const X = (y: number) => L + ((y - x0) / (x1 - x0)) * (width - L - R);
  const lo = 1, hi = 150;
  const Y1 = (v: number) => T + H1 - ((Math.log(Math.max(lo, Math.min(hi, v))) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * H1;
  const lvMax = Math.max(2.5, ...level.map((p) => p[1] ?? 0));
  const top2 = T + H1 + GAP + lanesH;
  const Y2 = (v: number) => top2 + H2 - (v / lvMax) * H2;
  const at = (y: number) => {
    const i = Math.max(0, Math.min(e.prices.length - 1, Math.round(y / 10)));
    return { prices: series.map((s) => s.pts[i]?.[1] ?? null), level: level[i]?.[1] ?? null };
  };
  const eras = m?.eras ?? [];
  const hv = hoverYear !== null ? at(hoverYear) : null;
  const evs = e.events.filter((x) => LANES.some((l) => l.sub === x.sub));

  return (
    <div class="prices">
      <header class="prices__head">
        <div class="eyebrow">Five thousand years of prices · {e.prices.reduce((s, p) => Math.max(s, p[4]), 0)} markets</div>
        <h1 class="h-page">What things cost</h1>
        {lede && (
          <p class="prices__lede">
            Medians across every market in {m?.worldName ?? 'the world'}, in grams of silver. Grain, the measure of everything, stayed between{' '}
            <strong>{lede.g.min.toFixed(0)}</strong> and <strong>{lede.g.max.toFixed(0)} g</strong> a measure for five thousand years.
            Tin, scarce and fought over, cost as much as <strong>{lede.t.max.toFixed(0)} g</strong> a mina before bronze gave way and it left the markets after AY {lede.t.last[0]}.
            Iron fell from <strong>{lede.i.first[1].toFixed(0)} g</strong> to <strong>{lede.i.last[1].toFixed(0)} g</strong> as smelting spread.
            Below, the general price level and the {lede.deb} debasements, {lede.hyper} hyperinflations and {lede.def} defaults that moved it.
          </p>
        )}
      </header>

      <div class="prices__chart" ref={ref} onPointerLeave={() => { setHoverYear(null); setHoverEv(null); }}>
        {w > 0 && (
          <svg width={width} height={total} viewBox={`0 0 ${width} ${total}`} class="pc"
            onPointerMove={(ev) => {
              const r = (ev.currentTarget as SVGSVGElement).getBoundingClientRect();
              const yr = Math.round(((ev.clientX - r.left - L) / (width - L - R)) * 5000 / 10) * 10;
              setHoverYear(yr >= 0 && yr <= 5000 ? yr : null);
            }}>
            {/* era bands */}
            {eras.map((era, i) => (
              <g>
                <rect x={X(era.start)} y={T} width={Math.max(0, X(Math.min(era.end, 5000)) - X(era.start))} height={total - T - 26} class={i % 2 ? 'pc-band' : 'pc-band pc-band--alt'} />
                {X(era.end) - X(era.start) > (mobile ? 46 : 70) && <text x={X(era.start) + 5} y={T - 9} class="pc-era">{era.name.replace(/^Age of (the )?/, '').toUpperCase()}</text>}
              </g>
            ))}
            {/* price axis (log) */}
            {[1, 2, 5, 10, 20, 50, 100].map((v) => (
              <g>
                <line x1={L} x2={width - R} y1={Y1(v)} y2={Y1(v)} class="pc-grid" />
                <text x={L - 6} y={Y1(v) + 4} text-anchor="end" class="pc-tick">{v} g</text>
              </g>
            ))}
            {series.map((s) => (
              <>
                <path d={pathOf(s.pts, X, Y1)} stroke={s.color} class="pc-line" />
                {(() => {
                  const last = [...s.pts].reverse().find((p) => p[1] !== null);
                  return last ? <text x={X(last[0]) + 6} y={Y1(last[1] as number) + 4} fill={s.color} class="pc-end">{s.name} <tspan class="pc-end__v">{(last[1] as number).toFixed(1)} g</tspan></text> : null;
                })()}
              </>
            ))}
            <text x={L} y={T + 12} class="pc-cap" dx="8">Median price, grams of silver (log scale)</text>

            {/* event lanes */}
            {LANES.map((lane, li) => {
              const y = T + H1 + GAP + li * LANE + LANE / 2;
              return (
                <g>
                  <line x1={L} x2={width - R} y1={y} y2={y} class="pc-lane" />
                  <text x={width - R + 6} y={y + 3.5} class="pc-lane__t">{mobile ? lane.label.split(' ')[0] : lane.label}</text>
                  {evs.filter((x) => x.sub === lane.sub).map((x) => (
                    <path d={glyph(lane.shape, X(x.year), y, mobile ? 3.6 : 4.6)} fill={lane.color} class="pc-ev"
                      onPointerEnter={(pe) => { const r = (pe.currentTarget as SVGPathElement).ownerSVGElement!.getBoundingClientRect(); setHoverEv({ ev: x, x: pe.clientX - r.left, y: pe.clientY - r.top }); }}
                      onClick={() => navigate(`#/p/${x.id}`)}>
                      <title>{`${x.title} — AY ${x.year}`}</title>
                    </path>
                  ))}
                </g>
              );
            })}

            {/* price level */}
            <line x1={L} x2={width - R} y1={Y2(1)} y2={Y2(1)} class="pc-grid pc-grid--one" />
            <text x={L - 6} y={Y2(1) + 4} text-anchor="end" class="pc-tick">1×</text>
            <text x={L - 6} y={Y2(2) + 4} text-anchor="end" class="pc-tick">2×</text>
            <path d={`${pathOf(level, X, Y2)}L${X(5000)},${Y2(0)}L${X(0)},${Y2(0)}Z`} class="pc-area" />
            <path d={pathOf(level, X, Y2)} class="pc-level" />
            <text x={L} y={top2 + 12} class="pc-cap" dx="8">General price level (1× = base prices)</text>

            {/* x axis */}
            {[0, 1000, 2000, 3000, 4000, 5000].map((t) => <text x={X(t)} y={total - 8} text-anchor="middle" class="pc-tick">{t === 0 ? 'AY 0' : t}</text>)}

            {/* crosshair */}
            {hoverYear !== null && (
              <g class="pc-x">
                <line x1={X(hoverYear)} x2={X(hoverYear)} y1={T} y2={total - 26} />
                {series.map((s, i) => hv?.prices[i] != null && <circle cx={X(hoverYear)} cy={Y1(hv.prices[i] as number)} r="3.5" fill={s.color} />)}
                {hv?.level != null && <circle cx={X(hoverYear)} cy={Y2(hv.level)} r="3" class="pc-x__lv" />}
              </g>
            )}
          </svg>
        )}
        {hoverYear !== null && hv && !hoverEv && (
          <div class="pc-tip" style={{ transform: `translate(${Math.min(X(hoverYear) + 12, width - 180)}px, ${T + 6}px)` }}>
            <div class="pc-tip__y">AY {hoverYear}</div>
            {series.map((s, i) => (
              <div class="pc-tip__r"><span class="swatch swatch--sm" style={{ background: s.color }} />{s.name}<span>{hv.prices[i] != null ? `${(hv.prices[i] as number).toFixed(1)} g` : '—'}</span></div>
            ))}
            <div class="pc-tip__r"><span class="swatch swatch--sm pc-tip__lv" />Price level<span>{hv.level != null ? `${hv.level.toFixed(2)}×` : '—'}</span></div>
          </div>
        )}
        {hoverEv && (
          <div class="pc-tip" style={{ transform: `translate(${Math.min(hoverEv.x + 12, width - 240)}px, ${hoverEv.y - 64}px)` }}>
            <div class="pc-tip__y">{subLabel(hoverEv.ev.sub)} · AY {hoverEv.ev.year}</div>
            <div class="pc-tip__t">{hoverEv.ev.title}</div>
          </div>
        )}
      </div>

      <details class="a11ylist">
        <summary>Prices by century, as a table</summary>
        <div class="table-wrap">
          <table class="report pricetable">
            <caption class="sr-only">Median prices in grams of silver, smoothed as in the chart, and the general price level</caption>
            <thead><tr><th>Year <span class="muted">AY</span></th>{SERIES.map((s) => <th class="r">{s.name}<br /><span class="muted">g/{s.unit}</span></th>)}<th class="r">Price<br /><span class="muted">level</span></th><th class="r">Mar&shy;kets</th></tr></thead>
            <tbody>
              {e.prices.filter((p) => p[0] % 100 === 0).map((p) => {
                const v = at(p[0]);
                return (
                  <tr>
                    <th scope="row">{p[0]}</th>
                    {v.prices.map((x) => <td class="r num">{x != null ? x.toFixed(1) : '—'}</td>)}
                    <td class="r num">{v.level != null ? `${v.level.toFixed(2)}×` : '—'}</td>
                    <td class="r num">{p[4]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <h3 class="sect">Events on the chart</h3>
        <ul>
          {LANES.map((lane) => evs.filter((x) => x.sub === lane.sub).map((x) => (
            <li><a href={`#/p/${x.id}`}>{x.title}</a> <span class="muted small">{lane.label.replace(/s$/, '').toLowerCase()}, AY {x.year}</span></li>
          )))}
        </ul>
      </details>

      <section class="prices__sect">
        <h2 class="sect">The most debased currencies</h2>
        <p class="muted small">Silver behind each unit of account, from its first issue to its last record. When rulers ran short, the coin got lighter; when paper took over, the backing could vanish entirely.</p>
        <div class="debased">
          {debased.slice(0, 12).map(({ c, ratio }) => (
            <a class="debased__c" href={`#/p/${c.id}`}>
              <div class="debased__h">
                <span class="debased__n">{c.name}</span>
                <span class="debased__k">{c.kind}</span>
                <span class="debased__r">−{Math.min(100, (1 - ratio) * 100).toFixed(ratio < 0.01 ? 1 : 0)}%</span>
              </div>
              <div class="debased__i muted small">{issuer(c.issuer) || ' '} · AY {c.history[0][0]}–{c.history[c.history.length - 1][0]}</div>
              <Sparkline series={{ label: 'Silver content', unit: 'g', points: c.history }} height={44} />
            </a>
          ))}
        </div>
        {coins.length > 0 && (
          <>
            <h2 class="sect">Clipped coins</h2>
            <p class="muted small">Before paper, debasement meant less silver in the same coin — usually to pay for a war.</p>
            <div class="debased">
              {coins.map(({ c, ratio }) => (
                <a class="debased__c" href={`#/p/${c.id}`}>
                  <div class="debased__h">
                    <span class="debased__n">{c.name}</span>
                    <span class="debased__k">coin</span>
                    <span class="debased__r">−{((1 - ratio) * 100).toFixed(0)}%</span>
                  </div>
                  <div class="debased__i muted small">{issuer(c.issuer) || ' '} · AY {c.history[0][0]}–{c.history[c.history.length - 1][0]}</div>
                  <Sparkline series={{ label: 'Silver content', unit: 'g', points: c.history }} height={44} />
                </a>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
