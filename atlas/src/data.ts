import type {
  GraphJson, MetaJson, PageJson, SearchJson, ShardJson, TimelineJson, WorldJson,
} from '../../engine/src/export/contract.ts';
import { shardFile, shardOf } from '../../engine/src/export/contract.ts';

const BASE = `${import.meta.env.BASE_URL}data/`;
const cache = new Map<string, Promise<unknown>>();

export function fetchJson<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(BASE + path).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json() as Promise<T>;
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

export const loadMeta = () => fetchJson<MetaJson>('meta.json');
export const loadWorld = () => fetchJson<WorldJson>('world.json');
export const loadTimeline = () => fetchJson<TimelineJson>('timeline.json');
export const loadGraph = () => fetchJson<GraphJson>('graph.json');

const shardIndex = new Map<number, Promise<Map<string, PageJson>>>();
export function loadPage(id: string): Promise<PageJson | null> {
  const s = shardOf(id);
  let p = shardIndex.get(s);
  if (!p) {
    p = fetchJson<ShardJson>(shardFile(s)).then((sh) => new Map(sh.pages.map((pg) => [pg.id, pg])));
    p.catch(() => shardIndex.delete(s));
    shardIndex.set(s, p);
  }
  return p.then((m) => m.get(id) ?? null);
}

export interface SearchIndex {
  ids: string[];
  titles: string[];
  kinds: string[];
  t0: number[];
  aliases: string[];
  subs: string[];
  lower: string[];
  aliasLower: string[];
  byId: Map<string, number>;
}
let searchP: Promise<SearchIndex> | null = null;
export function loadSearch(): Promise<SearchIndex> {
  if (!searchP) {
    searchP = fetchJson<SearchJson>('search.json').then((s) => {
      const idx: SearchIndex = { ids: [], titles: [], kinds: [], t0: [], aliases: [], subs: [], lower: [], aliasLower: [], byId: new Map() };
      s.entries.forEach(([id, title, kind, t0, aliases, sub], i) => {
        idx.ids.push(id);
        idx.titles.push(title);
        idx.kinds.push(kind);
        idx.t0.push(t0);
        idx.aliases.push(aliases);
        idx.subs.push(sub ?? '');
        idx.lower.push(fold(title));
        idx.aliasLower.push(fold(aliases));
        idx.byId.set(id, i);
      });
      return idx;
    });
    searchP.catch(() => { searchP = null; });
  }
  return searchP;
}

/** Lowercase and strip diacritics so "Kaṭuram" matches "katuram". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[šŝ]/g, 's').replace(/[čĉ]/g, 'c').replace(/ž/g, 'z').replace(/ŋ/g, 'ng').replace(/þ/g, 'th').replace(/ʃ/g, 'sh');
}

export function searchRank(idx: SearchIndex, query: string, limit = 12, kinds?: Set<string>): number[] {
  const q = fold(query.trim());
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const scored: [number, number][] = [];
  for (let i = 0; i < idx.ids.length; i++) {
    if (kinds && !kinds.has(idx.kinds[i])) continue;
    const t = idx.lower[i];
    let s = 0;
    if (t === q) s = 100;
    else if (t.startsWith(q)) s = 80;
    else {
      let all = true;
      let wordStart = 0;
      for (const w of words) {
        const at = t.indexOf(w);
        if (at < 0) { all = false; break; }
        if (at === 0 || t[at - 1] === ' ' || t[at - 1] === '(' || t[at - 1] === '-') wordStart++;
      }
      if (all) s = 40 + wordStart * 8;
      else if (idx.aliasLower[i] && words.every((w) => idx.aliasLower[i].includes(w))) s = 30;
    }
    if (s > 0) {
      s -= Math.min(10, t.length / 12);
      const k = idx.kinds[i];
      if (k === 'polity' || k === 'settlement' || k === 'language') s += 3;
      scored.push([i, s]);
    }
  }
  scored.sort((a, b) => b[1] - a[1] || idx.t0[a[0]] - idx.t0[b[0]]);
  return scored.slice(0, limit).map((x) => x[0]);
}
