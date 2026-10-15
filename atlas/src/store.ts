import { signal } from '@preact/signals';
import type { Layer, MetaJson, TimelineJson } from '../../engine/src/export/contract.ts';
import { fetchJson, loadMeta, loadTimeline, loadWorld, loadSearch, type SearchIndex } from './data.ts';
import { buildGeo } from './geo.ts';
import { LayerState } from './layers.ts';
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

export function ensureMapData(): Promise<MapData> {
  if (!mapP) {
    mapP = Promise.all([loadWorld(), loadTimeline()]).then(([world, timeline]) => {
      const geo = buildGeo(world);
      const d: MapData = {
        world, timeline, geo,
        layers: { political: new LayerState(timeline.layers.political) },
        polityByIdx: new Map(timeline.polities.map((p) => [p.idx, p])),
        settlementByIdx: new Map(timeline.settlements.map((s) => [s.idx, s])),
      };
      // inline culture/religion layers (older exports, mock data) are used directly
      if (timeline.layers.culture) d.layers.culture = new LayerState(timeline.layers.culture);
      if (timeline.layers.religion) d.layers.religion = new LayerState(timeline.layers.religion);
      mapData.value = d;
      return d;
    });
    mapP.catch((e) => { loadError.value = String(e); mapP = null; });
  }
  return mapP;
}

const layerP = new Map<LayerName, Promise<LayerState>>();
/** Fetch the culture/religion layer on first use. */
export function ensureLayer(name: LayerName): Promise<LayerState> {
  return ensureMapData().then((d) => {
    const have = d.layers[name];
    if (have) return have;
    let p = layerP.get(name);
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
