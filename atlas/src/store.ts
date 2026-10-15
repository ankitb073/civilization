import { signal } from '@preact/signals';
import type { MetaJson } from '../../engine/src/export/contract.ts';
import { loadMeta, loadTimeline, loadWorld, loadSearch, type SearchIndex } from './data.ts';
import { buildGeo } from './geo.ts';
import { LayerState } from './layers.ts';
import type { MapData } from './views/mapRenderer.ts';
import { yearEnd } from './state.ts';

export const meta = signal<MetaJson | null>(null);
export const mapData = signal<MapData | null>(null);
export const searchIndex = signal<SearchIndex | null>(null);
export const loadError = signal<string | null>(null);

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
        layers: {
          political: new LayerState(timeline.layers.political),
          culture: new LayerState(timeline.layers.culture),
          religion: new LayerState(timeline.layers.religion),
        },
      };
      mapData.value = d;
      return d;
    });
    mapP.catch((e) => { loadError.value = String(e); mapP = null; });
  }
  return mapP;
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
