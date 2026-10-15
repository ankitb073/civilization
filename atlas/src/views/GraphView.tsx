import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import Graph from 'graphology';
import Sigma from 'sigma';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import type { EntityKind } from '../../../engine/src/export/contract.ts';
import { searchRank } from '../data.ts';
import { KIND_LABEL, KINDS, kindColors } from '../kinds.ts';
import { isMobile, panelCollapsed, reducedMotion, route, selection, setRouteParam, sheetSnap, SHEET_PEEK, theme, year } from '../state.ts';
import { ensureMapData, ensureSearch, searchIndex } from '../store.ts';
import { DEFAULT_KINDS, budget, graphError, loadGraphData, selectSubset, type GraphData } from '../graph/store.ts';
import { TimeSlider } from './TimeSlider.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { PageCard } from '../components/PageCard.tsx';

function parseKinds(s: string | null): Set<EntityKind> {
  if (!s) return new Set(DEFAULT_KINDS);
  if (s === 'all') return new Set(KINDS);
  return new Set(s.split(',').filter((k): k is EntityKind => (KINDS as string[]).includes(k)));
}

/** Last measured build/render timings, for the perf probe. */
export const graphPerf: { loadMs?: number; buildMs?: number; nodes?: number; edges?: number; refreshMs?: number[] } = { refreshMs: [] };
(window as unknown as { __palimpsestGraph?: typeof graphPerf }).__palimpsestGraph = graphPerf;

export function GraphView() {
  const [g, setG] = useState<GraphData | null>(null);
  const focus = route.value.params.get('focus');
  const kinds = parseKinds(route.value.params.get('k'));
  const level = Math.max(0, Math.min(2, Number(route.value.params.get('d') ?? 0) || 0));
  useEffect(() => {
    loadGraphData().then((d) => { graphPerf.loadMs = d.loadMs; setG(d); }).catch(() => {});
    ensureMapData().catch(() => {});
    ensureSearch().catch(() => {});
  }, []);

  return (
    <div class={`graphview${panelCollapsed.value ? ' is-collapsed' : ''}`}
      style={isMobile.value ? { '--sheet-inset': sheetSnap.value === 'peek' ? `${SHEET_PEEK}px` : sheetSnap.value === 'half' ? '50%' : '0px' } : undefined}>
      <h1 class="sr-only">The web of history: a graph of every person, place, event and document</h1>
      <div class="graphview__stage">
        {!g && !graphError.value && <div class="center-load"><div class="spinner" /> Weaving the graph…</div>}
        {graphError.value && <div class="banner">Couldn’t load the graph: {graphError.value}</div>}
        {g && (focus && g.index.has(focus) ? <EgoGraph g={g} focus={focus} /> : <GlobalGraph g={g} kinds={kinds} level={level} />)}
        <Sheet>
          {selection.value && g?.index.has(selection.value) ? (
            <div class="sel">
              <div class="sel__head">
                <span class="sel__crumb">{focus ? 'Neighbourhood' : 'Selected'}</span>
                <button class="btn-icon btn-icon--sm" aria-label="Clear selection" onClick={() => { selection.value = null; }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
                </button>
              </div>
              <NeighbourSummary g={g} id={selection.value} />
              <PageCard id={selection.value} compact />
            </div>
          ) : (
            <GraphIntro g={g} focus={focus} />
          )}
        </Sheet>
      </div>
      <TimeSlider compact={isMobile.value} />
    </div>
  );
}

function GraphIntro({ g, focus }: { g: GraphData | null; focus: string | null }) {
  return (
    <div class="intro">
      <div class="intro__peek">
        <div class="wordmark wordmark--sm">The web of history</div>
        <div class="intro__now">{g ? `${g.n.toLocaleString('en-US')} nodes · ${g.edgeCount.toLocaleString('en-US')} links` : 'Loading…'}</div>
      </div>
      <p class="intro__lede">
        {focus
          ? 'A two-step neighbourhood, laid out live. Tap a node to walk the web; open its page to read the sources.'
          : 'Every person, place, polity, event and document, laid out by force. The most significant are shown first; only what exists by the slider’s year appears, and the dead fade.'}
      </p>
      <ol class="hints">
        <li><span>1</span>Scrub the timeline to grow the web through time.</li>
        <li><span>2</span>Tap a node to light up its connections; tap again for its neighbourhood.</li>
        <li><span>3</span>Turn on more kinds (people, documents…) or raise the detail.</li>
      </ol>
    </div>
  );
}

function NeighbourSummary({ g, id }: { g: GraphData; id: string }) {
  const i = g.index.get(id)!;
  const row = g.neighbors(i);
  const counts = new Map<string, number>();
  for (let k = 0; k < row.length; k++) { const kk = g.kindOf(row[k]); counts.set(kk, (counts.get(kk) ?? 0) + 1); }
  const parts = KINDS.filter((k) => counts.has(k)).sort((a, b) => counts.get(b)! - counts.get(a)!).map((k) => `${counts.get(k)!.toLocaleString('en-US')} ${KIND_LABEL[k][counts.get(k) === 1 ? 0 : 1].toLowerCase()}`);
  return (
    <p class="muted small nsum">
      {row.length.toLocaleString('en-US')} connections{parts.length ? ` — ${parts.slice(0, 5).join(', ')}` : ''}.{' '}
      <a href={`#/graph?focus=${encodeURIComponent(id)}&y=${year.value}`}>Show neighbourhood</a>
    </p>
  );
}

function mixHex(hex: string, a: number, bg: string): string {
  const p = (h: string) => { const m = h.replace('#', ''); return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]; };
  const [r, gg, b] = p(hex), [br, bgg, bb] = p(bg);
  const mix = (x: number, y: number) => Math.round(x * a + y * (1 - a));
  return `rgb(${mix(r, br)},${mix(gg, bgg)},${mix(b, bb)})`;
}

const LEVELS = ['Overview', 'More', 'Everything'];

function GlobalGraph({ g, kinds, level }: { g: GraphData; kinds: Set<EntityKind>; level: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const [physics, setPhysics] = useState(false);
  const layoutRef = useRef<FA2Layout | null>(null);
  const [q, setQ] = useState('');
  const [showKinds, setShowKinds] = useState(false);
  const [progress, setProgress] = useState<number | null>(0);
  const [stats, setStats] = useState<{ shown: number; eligible: number; edges: number; dropped: number } | null>(null);
  const kindsKey = [...kinds].sort().join(',');
  const mobile = isMobile.value;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < g.n; i++) { const k = g.kindOf(i); m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  }, [g]);

  useEffect(() => {
    const el = ref.current!;
    let cancelled = false;
    const t0 = performance.now();
    setProgress(0);
    const dark = theme.peek() === 'dark';
    const bg = dark ? '#11151b' : '#f4efe4';
    const colors = kindColors(theme.peek());
    const sub = selectSubset(g, kinds, budget(level, mobile), selection.peek() ? g.index.get(selection.peek()!) : undefined);
    setStats({ shown: sub.nodes.length, eligible: sub.totalEligible, edges: sub.edges.length / 2, dropped: sub.edgesDropped });
    const graph = new Graph({ type: 'undirected', multi: false, allowSelfLoops: false });
    // shrink nodes as the visible set grows so the web stays legible
    const sizeScale = Math.max(0.45, Math.min(1, el.clientWidth / 1100)) * Math.max(0.28, Math.min(1, Math.sqrt(2200 / Math.max(1, sub.nodes.length))));
    const N = sub.nodes.length, M = sub.edges.length / 2;
    let ni = 0, ei = 0;
    let renderer: Sigma | null = null;
    let disposeEffect: (() => void) | null = null;
    let refreshTimer = 0;

    const step = () => {
      if (cancelled) return;
      const sliceEnd = performance.now() + 12;
      while (ni < N && performance.now() < sliceEnd) {
        const lim = Math.min(N, ni + 2000);
        for (; ni < lim; ni++) {
          const i = sub.nodes[ni];
          const kind = g.kindOf(i);
          const c = colors[kind] ?? '#888888';
          graph.addNode(g.ids[i], {
            x: g.x[i], y: g.y[i], size: g.size[i] * sizeScale, baseSize: g.size[i] * sizeScale, label: g.labels[i], kind, t0: g.t0[i], t1: g.t1[i],
            color: c, c, dim: mixHex(c, 0.35, bg), faint: mixHex(c, 0.12, bg), moment: kind === 'event' || kind === 'artifact' ? 1 : 0,
          });
        }
      }
      while (ni >= N && ei < M && performance.now() < sliceEnd) {
        const lim = Math.min(M, ei + 8000);
        for (; ei < lim; ei++) {
          const a = sub.edges[2 * ei], b = sub.edges[2 * ei + 1];
          graph.addEdge(g.ids[a], g.ids[b], { t0: Math.max(g.t0[a], g.t0[b]), ka: g.kindOf(a), kb: g.kindOf(b) });
        }
      }
      if (ni < N || ei < M) {
        setProgress((ni + ei) / (N + M));
        setTimeout(step, 0);
        return;
      }
      graphPerf.buildMs = performance.now() - t0;
      graphPerf.nodes = N;
      graphPerf.edges = M;
      setProgress(null);
      mount();
    };

    const mount = () => {
      // sigma blends premultiplied colours: scale rgb by alpha or faint edges turn into a white haze
      const pm = (r: number, g2: number, b: number, a: number) => `rgba(${Math.round(r * a)},${Math.round(g2 * a)},${Math.round(b * a)},${a})`;
      const ea = M > 60000 ? 0.05 : 0.09;
      const edgeColor = dark ? pm(236, 227, 207, ea * 0.8) : pm(60, 40, 20, ea);
      const edgeHi = dark ? pm(240, 176, 143, 0.75) : pm(142, 47, 31, 0.7);
      let hiSet: Set<string> | null = null;
      let hover: string | null = null;
      const computeHi = () => {
        const s = selection.peek();
        const f = hover ?? (s && graph.hasNode(s) ? s : null);
        hiSet = f ? new Set([f, ...graph.neighbors(f)]) : null;
      };
      computeHi();
      renderer = new Sigma(graph, el, {
        renderEdgeLabels: false,
        hideEdgesOnMove: true,
        hideLabelsOnMove: true,
        defaultEdgeColor: edgeColor,
        labelFont: "'Inter Variable', Inter, system-ui, sans-serif",
        labelSize: 12,
        labelWeight: '500',
        labelColor: { color: dark ? '#ece3cf' : '#1f1a14' },
        labelDensity: mobile ? 0.4 : 0.7,
        labelGridCellSize: mobile ? 110 : 80,
        labelRenderedSizeThreshold: Math.max(2.5, (mobile ? 6 : 4.5) * sizeScale),
        zIndex: true,
        allowInvalidContainer: true,
        minCameraRatio: 0.01,
        maxCameraRatio: 3,
        defaultDrawNodeHover: (ctx, data, settings) => {
          const size = settings.labelSize;
          ctx.font = `600 ${size}px ${settings.labelFont}`;
          const label = data.label ?? '';
          const w = ctx.measureText(label).width + 12;
          const x = data.x + data.size + 4, y = data.y - size / 2 - 5;
          ctx.fillStyle = dark ? 'rgba(27,33,41,0.96)' : 'rgba(251,248,241,0.97)';
          ctx.strokeStyle = dark ? '#2d3540' : '#d9cfbc';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(x, y, w, size + 10, 5);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(data.x, data.y, data.size + 2, 0, Math.PI * 2);
          ctx.fillStyle = dark ? '#ece3cf' : '#1f1a14';
          ctx.fill();
          ctx.fillText(label, x + 6, y + size + 2);
        },
        nodeReducer: (node, data) => {
          const a = data as unknown as { t0: number; t1: number; baseSize: number; c: string; dim: string; faint: string; moment: number };
          const y = year.peek();
          if (a.t0 > y) return { ...data, hidden: true };
          // events and documents are moments: lit for a century after they happen, then fade back
          const dead = a.moment ? y - a.t1 > 100 : a.t1 < y;
          if (!hiSet) return dead ? { ...data, color: a.moment ? a.faint : a.dim, label: '', zIndex: 0 } : { ...data, zIndex: 1 };
          if (!hiSet.has(node)) return { ...data, color: a.faint, label: '', zIndex: 0 };
          const on = node === selection.peek() || node === hover;
          return { ...data, color: a.c, zIndex: 2, forceLabel: true, highlighted: on, size: on ? a.baseSize * 1.6 : a.baseSize };
        },
        edgeReducer: (edge, data) => {
          const e = data as unknown as { t0: number };
          if (e.t0 > year.peek()) return { ...data, hidden: true };
          if (!hiSet) return data;
          const [s, t] = graph.extremities(edge);
          const f = hover ?? selection.peek();
          if (s === f || t === f) return { ...data, color: edgeHi, size: 1.2, zIndex: 1 };
          return { ...data, hidden: true };
        },
      });
      sigmaRef.current = renderer;
      graphRef.current = graph;
      const r = renderer;
      r.on('clickNode', ({ node }) => {
        if (selection.peek() === node) setRouteParam('focus', node);
        else selection.value = node;
      });
      r.on('clickStage', () => { selection.value = null; });
      r.on('enterNode', ({ node }) => { if (!isMobile.peek()) { hover = node; computeHi(); r.refresh({ skipIndexation: true }); el.style.cursor = 'pointer'; } });
      r.on('leaveNode', () => { hover = null; computeHi(); r.refresh({ skipIndexation: true }); el.style.cursor = ''; });
      // year/selection changes: throttle full refreshes so scrubbing stays smooth on big graphs
      let last = 0;
      const doRefresh = () => {
        if (cancelled) return;
        const s = performance.now();
        computeHi();
        r.refresh({ skipIndexation: true });
        const ms = performance.now() - s;
        graphPerf.refreshMs!.push(ms);
        if (graphPerf.refreshMs!.length > 200) graphPerf.refreshMs!.shift();
        last = performance.now();
      };
      const gap = N > 20000 ? 160 : N > 6000 ? 90 : 40;
      disposeEffect = effect(() => {
        year.value;
        selection.value;
        clearTimeout(refreshTimer);
        const wait = gap - (performance.now() - last);
        if (wait <= 0) doRefresh();
        else refreshTimer = window.setTimeout(doRefresh, wait);
      });
      const s0 = selection.peek();
      if (s0 && graph.hasNode(s0)) {
        requestAnimationFrame(() => {
          if (cancelled) return;
          const d = r.getNodeDisplayData(s0);
          if (d) r.getCamera().animate({ x: d.x, y: d.y, ratio: 0.3 }, { duration: reducedMotion ? 0 : 500 });
        });
      }
    };

    setTimeout(step, 0);
    return () => {
      cancelled = true;
      clearTimeout(refreshTimer);
      disposeEffect?.();
      layoutRef.current?.kill();
      layoutRef.current = null;
      renderer?.kill();
      sigmaRef.current = null;
      graphRef.current = null;
      setPhysics(false);
    };
  }, [g, kindsKey, level, theme.value, mobile]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!physics || !graph) { layoutRef.current?.stop(); return; }
    if (!layoutRef.current) {
      layoutRef.current = new FA2Layout(graph, { settings: { barnesHutOptimize: graph.order > 2000, gravity: 1, scalingRatio: 8, slowDown: 6 } });
    }
    layoutRef.current.start();
    return () => layoutRef.current?.stop();
  }, [physics, progress]);

  const idx = searchIndex.value;
  const results = useMemo(() => (idx && q.trim() ? searchRank(idx, q, 8).filter((i) => g.index.has(idx.ids[i])) : []), [idx, q, g]);
  const focusNode = (id: string) => {
    setQ('');
    const r = sigmaRef.current;
    const graph = graphRef.current;
    if (!r || !graph || !graph.hasNode(id)) { setRouteParam('focus', id); return; }
    selection.value = id;
    const d = r.getNodeDisplayData(id);
    if (d) r.getCamera().animate({ x: d.x, y: d.y, ratio: 0.15 }, { duration: reducedMotion ? 0 : 600 });
  };
  const toggleKind = (k: EntityKind) => {
    const next = new Set(kinds);
    if (next.has(k)) next.delete(k); else next.add(k);
    const key = [...next].sort().join(',');
    setRouteParam('k', key === [...DEFAULT_KINDS].sort().join(',') ? null : next.size === KINDS.length ? 'all' : key);
  };
  const zoom = (f: number) => { const c = sigmaRef.current?.getCamera(); if (c) c.animatedZoom({ duration: reducedMotion ? 0 : 250, factor: f }); };

  return (
    <>
      <div class="graph-canvas" ref={ref} tabIndex={0} aria-label="Graph canvas. Arrow keys pan, plus and minus zoom. Use Find a node to select." role="application"
        onKeyDown={(e) => {
          const r = sigmaRef.current;
          if (!r) return;
          const cam = r.getCamera(), st = cam.getState(), step = 0.08 * st.ratio;
          const k = e.key;
          if (k === 'ArrowLeft') cam.setState({ x: st.x - step });
          else if (k === 'ArrowRight') cam.setState({ x: st.x + step });
          else if (k === 'ArrowUp') cam.setState({ y: st.y + step });
          else if (k === 'ArrowDown') cam.setState({ y: st.y - step });
          else if (k === '+' || k === '=') cam.setState({ ratio: st.ratio / 1.4 });
          else if (k === '-' || k === '_') cam.setState({ ratio: st.ratio * 1.4 });
          else return;
          e.preventDefault();
          e.stopPropagation();
        }} />
      {progress !== null && (
        <div class="graphprog" role="status">
          <div class="spinner" />
          <span>Weaving {stats ? stats.shown.toLocaleString('en-US') : ''} nodes… {Math.round((progress ?? 0) * 100)}%</span>
          <span class="graphprog__bar"><span style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></span>
        </div>
      )}
      <div class="graphbar">
        <div class="graphbar__search">
          <input class="input" type="search" placeholder="Find a node…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Find a node in the graph" />
          {results.length > 0 && idx && (
            <ul class="search__results">
              {results.map((i) => (
                <li><button class="search__item" onClick={() => focusNode(idx.ids[i])}>
                  <span class={`kdot k-${idx.kinds[i]}`} /><span class="search__t">{idx.titles[i]}</span><span class="search__m">{idx.t0[i]}</span>
                </button></li>
              ))}
            </ul>
          )}
        </div>
        <button class={`seg${showKinds ? ' is-on' : ''}`} onClick={() => setShowKinds(!showKinds)} aria-expanded={showKinds}>Kinds</button>
        {!mobile && (
          <button class={`seg${physics ? ' is-on' : ''}`} onClick={() => setPhysics(!physics)} aria-pressed={physics} title="Run ForceAtlas2 live on the visible nodes" disabled={(stats?.shown ?? 0) > 30000}>
            {physics ? 'Physics on' : 'Live physics'}
          </button>
        )}
      </div>
      {showKinds && (
        <div class="graphkinds" role="group" aria-label="Show kinds">
          <div class="graphkinds__levels" role="radiogroup" aria-label="Detail">
            {LEVELS.map((l, i) => (
              <button role="radio" aria-checked={level === i} class={`seg${level === i ? ' is-on' : ''}`} onClick={() => setRouteParam('d', i === 0 ? null : String(i))}>{l}</button>
            ))}
          </div>
          <div class="graphkinds__chips">
            {KINDS.filter((k) => counts.has(k)).map((k) => (
              <button class={`chip chip--sm${kinds.has(k) ? ' is-on' : ''}`} aria-pressed={kinds.has(k)} onClick={() => toggleKind(k)}>
                <span class={`kdot k-${k}`} />{KIND_LABEL[k][1]} <span>{counts.get(k)!.toLocaleString('en-US')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {stats && progress === null && (
        <div class="graphstat muted small">
          Showing the {stats.shown.toLocaleString('en-US')} most significant of {stats.eligible.toLocaleString('en-US')} nodes · {stats.edges.toLocaleString('en-US')} links
          {stats.dropped > 0 ? ` (${stats.dropped.toLocaleString('en-US')} more hidden)` : ''}
        </div>
      )}
      <div class="mapctl mapctl--zoom">
        <button class="btn-icon" aria-label="Zoom in" onClick={() => zoom(1.6)}>+</button>
        <button class="btn-icon" aria-label="Zoom out" onClick={() => zoom(1 / 1.6)}>−</button>
        <button class="btn-icon" aria-label="Reset view" onClick={() => sigmaRef.current?.getCamera().animatedReset({ duration: reducedMotion ? 0 : 400 })}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        </button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ ego graph (2 hops, live d3-force)
interface ENode extends SimulationNodeDatum { i: number; id: string; label: string; kind: string; hop: number; r: number }

function EgoGraph({ g, focus }: { g: GraphData; focus: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [, setTick] = useState(0);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const y = year.value;
  const mobile = isMobile.value;
  const { nodes, links } = useMemo(() => {
    const fi = g.index.get(focus)!;
    const deg = (i: number) => g.degree(i);
    const first = Array.from(g.neighbors(fi));
    // prefer significant neighbours (by size), keep the list short enough to read
    const hop1 = first.sort((a, b) => g.size[b] - g.size[a] || deg(b) - deg(a)).slice(0, mobile ? 28 : 44);
    const set = new Map<number, number>([[fi, 0]]);
    for (const i of hop1) set.set(i, 1);
    const score = new Map<number, number>();
    for (const i of hop1) {
      const row = g.neighbors(i);
      const lim = Math.min(row.length, 400);
      for (let k = 0; k < lim; k++) { const j = row[k]; if (!set.has(j)) score.set(j, (score.get(j) ?? 0) + 1); }
    }
    const hop2 = [...score.entries()].sort((a, b) => b[1] - a[1] || g.size[b[0]] - g.size[a[0]]).slice(0, Math.max(0, (mobile ? 60 : 100) - hop1.length)).map(([j]) => j);
    for (const j of hop2) set.set(j, 2);
    let k = 0;
    const nodes: ENode[] = [...set.entries()].map(([i, hop]) => ({
      i, id: g.ids[i], label: g.labels[i], kind: g.kindOf(i), hop,
      r: hop === 0 ? 13 : hop === 1 ? 5.5 + Math.min(5, Math.sqrt(deg(i)) * 0.4) : 3.2 + Math.min(3, Math.sqrt(deg(i)) * 0.2),
      // deterministic starting spiral (no Math.random anywhere in the project)
      x: Math.cos(k * 2.399963) * (hop * 60 + 4) * (1 + (k % 7) / 20),
      y: Math.sin((k++) * 2.399963) * (hop * 60 + 4) * (1 + (k % 5) / 20),
    }));
    nodes[0].fx = 0; nodes[0].fy = 0;
    const pos = new Map(nodes.map((n, kk) => [n.i, kk]));
    const links: SimulationLinkDatum<ENode>[] = [];
    for (const n of nodes) {
      if (n.hop === 2) continue;
      const row = g.neighbors(n.i);
      for (let kk = 0; kk < row.length; kk++) {
        const j = row[kk];
        const pj = pos.get(j);
        if (pj === undefined) continue;
        const other = nodes[pj];
        if (other.hop < n.hop || (other.hop === n.hop && j < n.i)) continue;
        links.push({ source: n, target: other });
      }
    }
    return { nodes, links };
  }, [g, focus, mobile]);

  useEffect(() => {
    const el = svgRef.current!.parentElement!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const sim = forceSimulation(nodes)
      .force('link', forceLink(links).distance((l) => ((l.source as ENode).hop === 0 || (l.target as ENode).hop === 0 ? 120 : 40)).strength((l) => ((l.source as ENode).hop === 0 || (l.target as ENode).hop === 0 ? 0.7 : 0.25)))
      .force('charge', forceManyBody().strength((n) => ((n as ENode).hop === 2 ? -30 : (n as ENode).hop === 1 ? -280 : -600)))
      .force('collide', forceCollide<ENode>((n) => n.r + 4))
      .force('center', forceCenter(0, 0).strength(0.05))
      .alphaDecay(0.035);
    let raf = 0;
    if (reducedMotion) {
      sim.stop();
      sim.tick(300);
      setTick((t) => t + 1);
      return () => { sim.stop(); };
    }
    sim.on('tick', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setTick((t) => t + 1)); });
    return () => { sim.stop(); cancelAnimationFrame(raf); };
  }, [nodes, links]);

  useEffect(() => { selection.value = focus; }, [focus]);

  let minX = -120, maxX = 120, minY = -120, maxY = 120;
  for (const n of nodes) { minX = Math.min(minX, n.x! - n.r - 40); maxX = Math.max(maxX, n.x! + n.r + 80); minY = Math.min(minY, n.y! - n.r - 16); maxY = Math.max(maxY, n.y! + n.r + 16); }
  const pad = 16;
  const vw = maxX - minX + pad * 2, vh = maxY - minY + pad * 2;
  const ar = size.w / Math.max(1, size.h);
  let bw = vw, bh = vh;
  if (bw / bh < ar) bw = bh * ar; else bh = bw / ar;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const colors = kindColors(theme.value);
  const fi = nodes[0];
  const sel = selection.value;
  const focusLabel = g.labels[g.index.get(focus)!];
  const labelled = new Set<string>();
  {
    const boxes: [number, number, number, number][] = [];
    const order = nodes.slice().sort((a, b) => a.hop - b.hop || g.size[b.i] - g.size[a.i]);
    const unit = bw / Math.max(1, size.w);
    for (const n of order) {
      if (n.hop === 2 && n.id !== sel) continue;
      const fs = (n.hop === 0 ? 15 : 10.5) * Math.max(1, unit * 0.9);
      const text = n.label.length > 34 ? n.label.slice(0, 32) + '…' : n.label;
      const w = text.length * fs * 0.55, h = fs * 1.2;
      const x = n.x! + n.r + 3, yy = n.y! - h / 2;
      if (boxes.some((b) => x < b[0] + b[2] && x + w > b[0] && yy < b[1] + b[3] && yy + h > b[1])) continue;
      boxes.push([x, yy, w, h]);
      labelled.add(n.id);
    }
  }
  return (
    <div class="ego">
      <div class="ego__bar">
        <button class="btn btn--ghost" onClick={() => setRouteParam('focus', null)}>← Whole graph</button>
        <span class="ego__t">Around <strong>{focusLabel}</strong></span>
        <a class="btn" href={`#/p/${focus}`}>Open page</a>
      </div>
      <svg ref={svgRef} class="ego__svg" viewBox={`${cx - bw / 2} ${cy - bh / 2} ${bw} ${bh}`} role="img" aria-label={`Connections of ${focusLabel}`}>
        <g class="ego__links">
          {links.map((l) => {
            const s = l.source as ENode, t = l.target as ENode;
            const hot = s.id === sel || t.id === sel;
            return <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} class={hot ? 'hot' : s.hop + t.hop <= 1 ? 'near' : ''} />;
          })}
        </g>
        <g>
          {nodes.map((n) => {
            const dead = g.t1[n.i] < y;
            const future = g.t0[n.i] > y;
            return (
              <g class={`ego__n${n.id === sel ? ' is-sel' : ''}${future ? ' is-future' : ''}${dead ? ' is-dead' : ''}`} transform={`translate(${n.x},${n.y})`}
                onClick={() => { if (n.id === focus) selection.value = n.id; else if (n.id === sel) setRouteParam('focus', n.id); else selection.value = n.id; }}
                onDblClick={() => setRouteParam('focus', n.id)}
                tabIndex={0} role="button" aria-label={n.label}
                onKeyDown={(e) => { if (e.key === 'Enter') setRouteParam('focus', n.id); }}>
                <circle r={n.r} fill={colors[n.kind]} />
                {(labelled.has(n.id) || n.id === sel) && <text x={n.r + 4} y={4} class={n.hop === 0 ? 'big' : ''}>{n.label.length > 34 ? n.label.slice(0, 32) + '…' : n.label}</text>}
                <title>{n.label}</title>
              </g>
            );
          })}
        </g>
        {fi && <circle cx={fi.x} cy={fi.y} r={fi.r + 5} class="ego__ring" />}
      </svg>
      <p class="ego__hint muted small">Tap to inspect · tap again (or double-click) to recentre · {g.degree(g.index.get(focus)!).toLocaleString('en-US')} connections in all</p>
    </div>
  );
}
