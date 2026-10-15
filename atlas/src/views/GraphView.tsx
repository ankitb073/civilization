import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import Graph from 'graphology';
import Sigma from 'sigma';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import type { EntityKind, GraphJson } from '../../../engine/src/export/contract.ts';
import { loadGraph, searchRank } from '../data.ts';
import { KIND_LABEL, KINDS, kindColors } from '../kinds.ts';
import { isMobile, panelCollapsed, route, selection, setRouteParam, theme, year } from '../state.ts';
import { ensureMapData, ensureSearch, searchIndex } from '../store.ts';
import { TimeSlider } from './TimeSlider.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { PageCard } from '../components/PageCard.tsx';

interface G { data: GraphJson; graph: Graph; adj: Int32Array[]; index: Map<string, number> }
let cached: Promise<G> | null = null;
function loadG(): Promise<G> {
  if (!cached) {
    cached = loadGraph().then((data) => {
      const graph = new Graph({ type: 'undirected', multi: false, allowSelfLoops: false });
      const n = data.ids.length;
      for (let i = 0; i < n; i++) {
        graph.addNode(data.ids[i], { x: data.x[i], y: data.y[i], size: data.size[i], label: data.labels[i], kind: data.kinds[i], t0: data.t0[i], t1: data.t1[i] });
      }
      const deg = new Int32Array(n);
      const e = data.edges;
      for (let k = 0; k < e.length; k += 2) {
        const a = e[k], b = e[k + 1];
        if (a === b) continue;
        const s = data.ids[a], t = data.ids[b];
        if (!graph.hasEdge(s, t)) {
          graph.addEdge(s, t, { t0: Math.max(data.t0[a], data.t0[b]), ka: data.kinds[a], kb: data.kinds[b] });
          deg[a]++; deg[b]++;
        }
      }
      const index = new Map(data.ids.map((id, i) => [id, i]));
      const adj: Int32Array[] = Array.from({ length: n }, (_, i) => new Int32Array(deg[i]));
      const fill = new Int32Array(n);
      graph.forEachEdge((_edge, _attr, s, t) => {
        const a = index.get(s)!, b = index.get(t)!;
        adj[a][fill[a]++] = b;
        adj[b][fill[b]++] = a;
      });
      return { data, graph, adj, index };
    });
    cached.catch(() => { cached = null; });
  }
  return cached;
}

function parseKinds(s: string | null): Set<EntityKind> {
  if (!s) return new Set(KINDS);
  return new Set(s.split(',').filter((k): k is EntityKind => (KINDS as string[]).includes(k)));
}

export function GraphView() {
  const [g, setG] = useState<G | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const focus = route.value.params.get('focus');
  const kinds = parseKinds(route.value.params.get('k'));
  useEffect(() => {
    loadG().then(setG).catch((e) => setErr(String(e)));
    ensureMapData().catch(() => {});
    ensureSearch().catch(() => {});
  }, []);

  return (
    <div class={`graphview${panelCollapsed.value ? ' is-collapsed' : ''}`}>
      <div class="graphview__stage">
        {!g && !err && <div class="center-load"><div class="spinner" /> Weaving the graph…</div>}
        {err && <div class="banner">Couldn’t load the graph: {err}</div>}
        {g && (focus && g.index.has(focus) ? <EgoGraph g={g} focus={focus} /> : <GlobalGraph g={g} kinds={kinds} />)}
        <Sheet>
          {selection.value && g?.index.has(selection.value) ? (
            <div class="sel">
              <div class="sel__head">
                <span class="sel__crumb">{focus ? 'Neighbourhood' : 'Selected'}</span>
                <button class="btn-icon btn-icon--sm" aria-label="Clear selection" onClick={() => { selection.value = null; }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
                </button>
              </div>
              {g && <NeighbourSummary g={g} id={selection.value} />}
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

function GraphIntro({ g, focus }: { g: G | null; focus: string | null }) {
  return (
    <div class="intro">
      <div class="intro__peek">
        <div class="wordmark wordmark--sm">The web of history</div>
        <div class="intro__now">{g ? `${g.data.ids.length.toLocaleString('en-US')} nodes · ${(g.data.edges.length / 2).toLocaleString('en-US')} links` : 'Loading…'}</div>
      </div>
      <p class="intro__lede">
        {focus
          ? 'A two-step neighbourhood, laid out live. Tap a node to walk the web; open its page to read the sources.'
          : 'Every person, place, polity, event and document, laid out by force. Only what exists by the slider’s year is shown; the dead fade.'}
      </p>
      <ol class="hints">
        <li><span>1</span>Scrub the timeline to grow the web through time.</li>
        <li><span>2</span>Tap a node to light up its connections.</li>
        <li><span>3</span>Use “Graph” on any page to see its neighbourhood.</li>
      </ol>
    </div>
  );
}

function NeighbourSummary({ g, id }: { g: G; id: string }) {
  const i = g.index.get(id)!;
  const counts = new Map<string, number>();
  for (const j of g.adj[i]) counts.set(g.data.kinds[j], (counts.get(g.data.kinds[j]) ?? 0) + 1);
  const parts = KINDS.filter((k) => counts.has(k)).map((k) => `${counts.get(k)} ${KIND_LABEL[k][counts.get(k) === 1 ? 0 : 1].toLowerCase()}`);
  return <p class="muted small nsum">{g.adj[i].length} connections{parts.length ? ` — ${parts.slice(0, 5).join(', ')}` : ''}</p>;
}

function hexA(hex: string, a: number, bg: string): string {
  const p = (h: string) => { const m = h.replace('#', ''); return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]; };
  const [r, gg, b] = p(hex), [br, bgg, bb] = p(bg);
  const mix = (x: number, y: number) => Math.round(x * a + y * (1 - a));
  return `rgb(${mix(r, br)},${mix(gg, bgg)},${mix(b, bb)})`;
}

function GlobalGraph({ g, kinds }: { g: G; kinds: Set<EntityKind> }) {
  const ref = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const [physics, setPhysics] = useState(false);
  const layoutRef = useRef<FA2Layout | null>(null);
  const [q, setQ] = useState('');
  const [showKinds, setShowKinds] = useState(!isMobile.value);
  const kindsKey = [...kinds].sort().join(',');
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of g.data.kinds) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  }, [g]);

  useEffect(() => {
    const el = ref.current!;
    const dark = theme.peek() === 'dark';
    const bg = dark ? '#11151b' : '#f4efe4';
    const colors = kindColors(theme.peek());
    const nodeColor = new Map<string, { c: string; dim: string; faint: string }>();
    g.graph.forEachNode((n, a) => {
      const c = colors[a.kind as string] ?? '#888888';
      nodeColor.set(n, { c, dim: hexA(c, 0.35, bg), faint: hexA(c, 0.12, bg) });
    });
    const edgeColor = dark ? 'rgba(236,227,207,0.07)' : 'rgba(60,40,20,0.08)';
    const edgeHi = dark ? 'rgba(240,176,143,0.65)' : 'rgba(142,47,31,0.55)';
    let hiSet: Set<string> | null = null;
    let hover: string | null = null;
    const sizeScale = Math.max(0.4, Math.min(1, el.clientWidth / 1100));

    const computeHi = () => {
      const s = selection.peek();
      const focusNode = hover ?? (s && g.graph.hasNode(s) ? s : null);
      if (!focusNode) { hiSet = null; return; }
      hiSet = new Set([focusNode, ...g.graph.neighbors(focusNode)]);
    };
    computeHi();
    const renderer = new Sigma(g.graph, el, {
      renderEdgeLabels: false,
      defaultEdgeColor: edgeColor,
      labelFont: 'Inter, system-ui, sans-serif',
      labelSize: 12,
      labelWeight: '500',
      labelColor: { color: dark ? '#ece3cf' : '#1f1a14' },
      labelDensity: 0.6,
      labelGridCellSize: 90,
      labelRenderedSizeThreshold: isMobile.peek() ? 9 : 7,
      zIndex: true,
      minCameraRatio: 0.02,
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
        ctx.fillStyle = dark ? '#ece3cf' : '#1f1a14';
        ctx.fillText(label, x + 6, y + size + 2);
      },
      nodeReducer: (node, data) => {
        const y = year.peek();
        const a = data as unknown as { t0: number; t1: number; kind: EntityKind; size: number; label: string };
        const col = nodeColor.get(node)!;
        const res: Record<string, unknown> = { ...data };
        if (!kinds.has(a.kind) || a.t0 > y) { res.hidden = true; return res as typeof data; }
        const dead = a.t1 < y;
        res.size = a.size * sizeScale;
        res.color = dead ? col.dim : col.c;
        if (hiSet) {
          if (!hiSet.has(node)) { res.color = col.faint; res.label = ''; res.zIndex = 0; }
          else { res.zIndex = 2; res.forceLabel = true; res.color = col.c; }
          if (node === selection.peek() || node === hover) { res.highlighted = true; res.size = a.size * sizeScale * 1.6; }
        } else if (dead) { res.label = ''; }
        return res as typeof data;
      },
      edgeReducer: (edge, data) => {
        const e = data as unknown as { t0: number; ka: EntityKind; kb: EntityKind };
        if (e.t0 > year.peek() || !kinds.has(e.ka) || !kinds.has(e.kb)) return { ...data, hidden: true };
        if (!hiSet) return data;
        const [s, t] = g.graph.extremities(edge);
        const f = hover ?? selection.peek();
        if (hiSet.has(s) && hiSet.has(t) && (s === f || t === f)) return { ...data, color: edgeHi, size: 1.2, zIndex: 1 };
        return { ...data, hidden: true };
      },
    });
    sigmaRef.current = renderer;
    renderer.on('clickNode', ({ node }) => { selection.value = node; });
    renderer.on('clickStage', () => { selection.value = null; });
    renderer.on('enterNode', ({ node }) => { if (!isMobile.peek()) { hover = node; computeHi(); renderer.refresh({ skipIndexation: true }); el.style.cursor = 'pointer'; } });
    renderer.on('leaveNode', () => { hover = null; computeHi(); renderer.refresh({ skipIndexation: true }); el.style.cursor = ''; });
    renderer.on('doubleClickNode', ({ node, preventSigmaDefault }) => { preventSigmaDefault(); setRouteParam('focus', node); });

    let raf = 0;
    const dispose = effect(() => {
      year.value;
      selection.value;
      computeHi();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => renderer.refresh({ skipIndexation: true }));
    });
    // center on selection at mount
    const s = selection.peek();
    if (s && g.graph.hasNode(s)) {
      requestAnimationFrame(() => {
        const d = renderer.getNodeDisplayData(s);
        if (d) renderer.getCamera().animate({ x: d.x, y: d.y, ratio: 0.3 }, { duration: 500 });
      });
    }
    return () => { dispose(); cancelAnimationFrame(raf); layoutRef.current?.kill(); layoutRef.current = null; renderer.kill(); sigmaRef.current = null; };
  }, [g, kindsKey, theme.value]);

  useEffect(() => {
    if (!physics) { layoutRef.current?.stop(); return; }
    if (!layoutRef.current) {
      layoutRef.current = new FA2Layout(g.graph, { settings: { barnesHutOptimize: g.graph.order > 2000, gravity: 1, scalingRatio: 8, slowDown: 6 } });
    }
    layoutRef.current.start();
    return () => layoutRef.current?.stop();
  }, [physics, g]);

  const idx = searchIndex.value;
  const results = useMemo(() => (idx && q.trim() ? searchRank(idx, q, 8).filter((i) => g.index.has(idx.ids[i])) : []), [idx, q, g]);
  const focusNode = (id: string) => {
    selection.value = id;
    setQ('');
    const r = sigmaRef.current;
    if (!r) return;
    const d = r.getNodeDisplayData(id);
    if (d) r.getCamera().animate({ x: d.x, y: d.y, ratio: 0.18 }, { duration: 600 });
  };
  const toggleKind = (k: EntityKind) => {
    const next = new Set(kinds);
    if (next.has(k)) next.delete(k); else next.add(k);
    setRouteParam('k', next.size === KINDS.length ? null : [...next].join(','));
  };
  const zoom = (f: number) => { const c = sigmaRef.current?.getCamera(); if (c) c.animatedZoom({ duration: 250, factor: f }); };

  return (
    <>
      <div class="graph-canvas" ref={ref} />
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
        <button class={`seg${physics ? ' is-on' : ''}`} onClick={() => setPhysics(!physics)} aria-pressed={physics} title="Run ForceAtlas2 live">
          {physics ? 'Physics on' : 'Live physics'}
        </button>
      </div>
      {showKinds && (
        <div class="graphkinds" role="group" aria-label="Show kinds">
          {KINDS.filter((k) => counts.has(k)).map((k) => (
            <button class={`chip chip--sm${kinds.has(k) ? ' is-on' : ''}`} aria-pressed={kinds.has(k)} onClick={() => toggleKind(k)}>
              <span class={`kdot k-${k}`} />{KIND_LABEL[k][1]} <span>{counts.get(k)}</span>
            </button>
          ))}
        </div>
      )}
      <div class="mapctl mapctl--zoom">
        <button class="btn-icon" aria-label="Zoom in" onClick={() => zoom(1.6)}>+</button>
        <button class="btn-icon" aria-label="Zoom out" onClick={() => zoom(1 / 1.6)}>−</button>
        <button class="btn-icon" aria-label="Reset view" onClick={() => sigmaRef.current?.getCamera().animatedReset({ duration: 400 })}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        </button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ ego graph (2 hops, live d3-force)
interface ENode extends SimulationNodeDatum { i: number; id: string; label: string; kind: string; hop: number; r: number; alive: boolean }

function EgoGraph({ g, focus }: { g: G; focus: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [, setTick] = useState(0);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const y = year.value;
  const { nodes, links } = useMemo(() => {
    const fi = g.index.get(focus)!;
    const deg = (i: number) => g.adj[i].length;
    const hop1 = [...g.adj[fi]].sort((a, b) => deg(b) - deg(a)).slice(0, 48);
    const set = new Map<number, number>([[fi, 0]]);
    for (const i of hop1) set.set(i, 1);
    const cand: number[] = [];
    for (const i of hop1) for (const j of g.adj[i]) if (!set.has(j)) cand.push(j);
    const score = new Map<number, number>();
    for (const j of cand) score.set(j, (score.get(j) ?? 0) + 1);
    const hop2 = [...score.entries()].sort((a, b) => b[1] - a[1] || deg(b[0]) - deg(a[0])).slice(0, Math.max(0, 110 - hop1.length)).map(([j]) => j);
    for (const j of hop2) set.set(j, 2);
    let k = 0;
    const nodes: ENode[] = [...set.entries()].map(([i, hop]) => ({
      i, id: g.data.ids[i], label: g.data.labels[i], kind: g.data.kinds[i], hop,
      r: hop === 0 ? 13 : hop === 1 ? 5.5 + Math.min(5, Math.sqrt(deg(i)) * 0.6) : 3.2 + Math.min(3, Math.sqrt(deg(i)) * 0.3),
      alive: true,
      // deterministic starting spiral (no Math.random anywhere in the project)
      x: Math.cos(k * 2.399963) * (hop * 60 + 4) * (1 + (k % 7) / 20),
      y: Math.sin((k++) * 2.399963) * (hop * 60 + 4) * (1 + (k % 5) / 20),
    }));
    nodes[0].fx = 0; nodes[0].fy = 0;
    const pos = new Map(nodes.map((n, k) => [n.i, k]));
    const links: SimulationLinkDatum<ENode>[] = [];
    for (const n of nodes) for (const j of g.adj[n.i]) if (pos.has(j) && n.i < j) {
      const other = nodes[pos.get(j)!];
      if (n.hop === 2 && other.hop === 2) continue;
      links.push({ source: n, target: other });
    }
    return { nodes, links };
  }, [g, focus]);

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
      .alphaDecay(0.03);
    let raf = 0;
    sim.on('tick', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setTick((t) => t + 1)); });
    return () => { sim.stop(); cancelAnimationFrame(raf); };
  }, [nodes, links]);

  useEffect(() => { selection.value = focus; }, [focus]);

  // fit
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
  // greedy label placement: focus first, then hop-1 by degree; skip overlaps
  const labelled = new Set<string>();
  {
    const boxes: [number, number, number, number][] = [];
    const order = nodes.slice().sort((a, b) => a.hop - b.hop || g.adj[b.i].length - g.adj[a.i].length);
    const unit = bw / Math.max(1, size.w);
    for (const n of order) {
      if (n.hop === 2 && n.id !== selection.peek()) continue;
      const fs = (n.hop === 0 ? 15 : 10.5) * Math.max(1, unit * 0.9);
      const text = n.label.length > 34 ? n.label.slice(0, 32) + '…' : n.label;
      const w = text.length * fs * 0.55, h = fs * 1.2;
      const x = n.x! + n.r + 3, y = n.y! - h / 2;
      if (boxes.some((b) => x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1])) continue;
      boxes.push([x, y, w, h]);
      labelled.add(n.id);
    }
  }
  const sel = selection.value;
  const focusLabel = g.data.labels[g.index.get(focus)!];
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
            const dead = g.data.t1[n.i] < y;
            const future = g.data.t0[n.i] > y;
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
      <p class="ego__hint muted small">Tap to inspect · tap again (or double-click) to recentre</p>
    </div>
  );
}
