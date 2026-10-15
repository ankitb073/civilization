import { effect, signal } from '@preact/signals';
import type { Layer, MetaJson, TimelineJson } from '../../engine/src/export/contract.ts';
import { year } from './state.ts';
import { fetchJson, loadMeta, loadTimeline, loadWorld, loadSearch, type SearchIndex } from './data.ts';
import { buildGeo } from './geo.ts';
import { ChunkedLayerState, LayerState, type LayerLike } from './layers.ts';
import { TL_VERSION, expandEvents, expandLegend, expandPolities, type TlChunk, type TlCore, type TlEvents } from './tl.ts';
import { buildLanguageLayer, loadLanguages } from './languages.ts';
import type { MapData } from './views/mapRenderer.ts';
import type { LayerName } from './state.ts';
import { yearEnd } from './state.ts';

export const meta = signal<MetaJson | null>(null);
export const mapData = signal<MapData | null>(null);
export const searchIndex = signal<SearchIndex | null>(null);
export const loadError = signal<string | null>(null);
/** Bumped whenever a lazily-loaded layer (culture, religion) arrives. */
export const layersVersion = signal(0);

let mapP: Promise<MapData> | null = null;
export function ensureMeta(): Promise<MetaJson> {
  return loadMeta().then((m) => {
    meta.value = m;
    yearEnd.value = m.yearEnd;
    return m;
  }).catch((e) => { loadError.value = String(e); throw e; });
}

/** Set once the map has drawn for the first time; secondary fetches wait for it. */
export const firstPaint = signal(false);

function whenIdle(fn: () => void, timeout = 1500) {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout }); else setTimeout(fn, 200);
}

/** After the first paint: the rest of the political layer, event titles and routes. */
let eventsP: Promise<void> | null = null;
let eventsLoader: (() => Promise<void>) | null = null;
/** Resolve when the timeline's events (markers and titles) are loaded. */
export function ensureEvents(): Promise<void> {
  return ensureMapData().then(() => {
    if (!eventsLoader) return;
    if (!eventsP) eventsP = eventsLoader();
    return eventsP;
  });
}

function loadDeferred(d: MapData, core: TlCore, political: ChunkedLayerState) {
  // events (markers, titles) come first and quickly; the rest when the browser is idle
  eventsLoader = () => fetchJson<TlEvents>(`tl/${core.events}`).then((E) => {
    d.timeline.events = expandEvents(E);
    layersVersion.value++;
  }).catch(() => { eventsP = null; });
  const events = () => { if (!eventsP) eventsP = eventsLoader!(); return eventsP; };
  const go = () => whenIdle(() => {
    void political.prefetch(year.peek());
    fetchJson<TimelineJson['routes']>(`tl/${core.routes}`).then((routes) => {
      d.timeline.routes = routes;
      layersVersion.value++;
    }).catch(() => {});
  });
  const start = () => { void events().then(go); };
  if (firstPaint.peek()) start();
  else { const stop = effect(() => { if (firstPaint.value) { stop(); start(); } }); }
}

export function ensureMapData(): Promise<MapData> {
  if (!mapP) {
    const split = fetchJson<TlCore>('tl/core.json').then((c) => (c.v === TL_VERSION ? c : Promise.reject(new Error('tl version'))));
    mapP = Promise.all([loadWorld(), split.catch(() => null)]).then(async ([world, core]) => {
      const geo = buildGeo(world);
      if (!core) {
        // a plain export without the atlas-side split: use timeline.json as is
        const timeline = await loadTimeline();
        const d: MapData = {
          world, timeline, geo,
          layers: { political: new LayerState(timeline.layers.political) },
          polityByIdx: new Map(timeline.polities.map((p) => [p.idx, p])),
          settlementByIdx: new Map(timeline.settlements.map((s) => [s.idx, s])),
        };
        // inline culture/religion layers (older exports, mock data) are used directly
        if (timeline.layers.culture) d.layers.culture = new LayerState(timeline.layers.culture);
        if (timeline.layers.religion) d.layers.religion = new LayerState(timeline.layers.religion);
        firstPaint.value = true;
        mapData.value = d;
        return d;
      }
      const P = core.political;
      const legend = expandLegend(P.legend);
      const timeline: TimelineJson = {
        layers: { political: { legend, keyframeEvery: P.keyframeEvery, keyframes: [], deltas: '', deltaCount: 0, deltaBase: 0 } },
        layerFiles: core.layerFiles,
        polities: expandPolities(core.polities),
        settlements: core.settlements,
        events: [],
        climate: core.climate,
        routes: [],
      };
      const political = new ChunkedLayerState({
        legend, keyframeEvery: P.keyframeEvery, chunkYears: P.chunkYears, chunkCount: P.chunks.length, cells: geo.n,
        fetchChunk: (i) => fetchJson<TlChunk>(`tl/${P.chunks[i].file}`).then((c) => ({ ...c, legend, keyframeEvery: P.keyframeEvery })),
        onLoad: () => { layersVersion.value++; },
      });
      const d: MapData = {
        world, timeline, geo,
        layers: { political },
        polityByIdx: new Map(timeline.polities.map((p) => [p.idx, p])),
        settlementByIdx: new Map(timeline.settlements.map((s) => [s.idx, s])),
      };
      await political.ensure(year.peek());
      mapData.value = d;
      loadDeferred(d, core, political);
      return d;
    });
    mapP.catch((e) => { loadError.value = String(e); mapP = null; });
  }
  return mapP;
}

/** Resolve when the political layer for `y` is loaded (for frame capture and tours). */
export function ensurePoliticalYear(y: number): Promise<void> {
  return ensureMapData().then((d) => {
    const p = d.layers.political as LayerLike & { ensure?: (y: number) => Promise<void> };
    return p.ensure ? p.ensure(y) : undefined;
  });
}

const layerP = new Map<LayerName, Promise<LayerLike>>();
/** Fetch the culture/religion/language layer on first use. */
export function ensureLayer(name: LayerName): Promise<LayerLike> {
  return ensureMapData().then((d) => {
    const have = d.layers[name];
    if (have) return have;
    let p = layerP.get(name);
    if (!p && name === 'language') {
      p = Promise.all([ensureLayer('culture'), loadLanguages()]).then(([culture, langs]) => {
        const st = buildLanguageLayer(culture, langs);
        d.layers.language = st;
        layersVersion.value++;
        return st;
      });
      p.catch(() => layerP.delete(name));
      layerP.set(name, p);
    }
    if (!p) {
      const file = d.timeline.layerFiles?.[name as 'culture' | 'religion'];
      if (!file) return Promise.reject(new Error(`no file for layer ${name}`));
      p = fetchJson<Layer>(file).then((layer) => {
        const st = new LayerState(layer);
        d.layers[name] = st;
        layersVersion.value++;
        return st;
      });
      p.catch(() => layerP.delete(name));
      layerP.set(name, p);
    }
    return p;
  });
}

export function ensureSearch(): Promise<SearchIndex> {
  return loadSearch().then((s) => { searchIndex.value = s; return s; });
}

/** Title for an id from the search index (if loaded). */
export function titleOf(id: string): string | undefined {
  const s = searchIndex.value;
  if (!s) return undefined;
  const i = s.byId.get(id);
  return i === undefined ? undefined : s.titles[i];
}

export function eraAt(y: number) {
  const m = meta.value;
  if (!m) return null;
  return m.eras.find((e) => y >= e.start && y < e.end) ?? m.eras[m.eras.length - 1] ?? null;
}

/** Legend entry for a layer value. */
export function legendOf(d: MapData, layer: LayerName, idx: number) {
  return idx < 0 ? undefined : d.layers[layer]?.byIdx.get(idx);
}

/** A polity's editorial name as of `year`. */
export function polityNameAt(d: MapData, idx: number, year: number): string {
  const p = d.polityByIdx.get(idx);
  let name = d.layers.political.byIdx.get(idx)?.name ?? '';
  if (p) for (const [y, nm] of p.names) { if (y <= year) name = nm; else break; }
  return name;
}

export function capitalAt(d: MapData, idx: number, year: number): number {
  const p = d.polityByIdx.get(idx);
  let cap = -1;
  if (p) for (const [y, si] of p.capitals) { if (y <= year) cap = si; else break; }
  return cap;
}

export type { TimelineJson };
