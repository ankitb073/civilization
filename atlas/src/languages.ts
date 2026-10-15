// The language family data shared by the Tree of Tongues and the map's Languages layer.

import type { LanguagesJson, Layer } from '../../engine/src/export/contract.ts';
import { hashString } from '../../engine/src/core/rng.ts';
import { fetchJson } from './data.ts';
import { MappedLayerState, type LayerLike } from './layers.ts';

export type Lang = LanguagesJson['languages'][number];

let p: Promise<LanguagesJson> | null = null;
export function loadLanguages(): Promise<LanguagesJson> {
  if (!p) { p = fetchJson<LanguagesJson>('languages.json'); p.catch(() => { p = null; }); }
  return p;
}

// Strong, map-friendly hues; the largest families get the first ones.
const FAMILY_HUES = ['#b5523b', '#3d6c9e', '#5f8a3a', '#8a5aa8', '#c08a2b', '#2f8a83', '#a3466e', '#6b6f2a'];

function hexToHsl(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16) / 255, g = parseInt(m.slice(2, 4), 16) / 255, b = parseInt(m.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const x = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${x(f(0))}${x(f(8))}${x(f(4))}`;
}

export interface FamilyInfo { id: string; name: string; color: string; size: number; idx: number }

export interface LangIndex {
  data: LanguagesJson;
  byId: Map<string, Lang>;
  families: FamilyInfo[];
  familyOf: Map<string, FamilyInfo>;
  color: Map<string, string>;
  depth: Map<string, number>;
}

let indexCache: LangIndex | null = null;
export function indexLanguages(data: LanguagesJson): LangIndex {
  if (indexCache && indexCache.data === data) return indexCache;
  const byId = new Map(data.languages.map((l) => [l.id, l]));
  const sizes = new Map<string, number>();
  for (const l of data.languages) sizes.set(l.family, (sizes.get(l.family) ?? 0) + 1);
  const famIds = [...sizes.keys()].sort((a, b) => sizes.get(b)! - sizes.get(a)! || a.localeCompare(b));
  const families: FamilyInfo[] = famIds.map((id, i) => ({ id, name: byId.get(id)?.name ?? id, color: FAMILY_HUES[i % FAMILY_HUES.length], size: sizes.get(id)!, idx: i }));
  const familyOf = new Map<string, FamilyInfo>();
  const fam = new Map(families.map((f) => [f.id, f]));
  const depth = new Map<string, number>();
  const dep = (l: Lang): number => {
    if (depth.has(l.id)) return depth.get(l.id)!;
    const d = l.parent && byId.has(l.parent) ? dep(byId.get(l.parent)!) + 1 : 0;
    depth.set(l.id, d);
    return d;
  };
  const color = new Map<string, string>();
  for (const l of data.languages) {
    const f = fam.get(l.family)!;
    familyOf.set(l.id, f);
    const [h, s, li] = hexToHsl(f.color);
    const j = (hashString(l.id) % 9) - 4;               // -4..4
    const d = dep(l);
    color.set(l.id, hslToHex((h + j * 2.2 + 360) % 360, Math.max(0.18, s - d * 0.025), Math.max(0.24, Math.min(0.72, li + j * 0.035 + d * 0.012))));
  }
  indexCache = { data, byId, families, familyOf, color, depth };
  return indexCache;
}

/** The map's Languages layer: culture cells relabelled by the language their people speak. */
export function buildLanguageLayer(culture: LayerLike, data: LanguagesJson): MappedLayerState {
  const ix = indexLanguages(data);
  const langIdx = new Map(data.languages.map((l, i) => [l.id, i]));
  let maxC = 0;
  for (const l of culture.layer.legend) maxC = Math.max(maxC, l.idx);
  for (const k of Object.keys(data.cultureLanguage)) maxC = Math.max(maxC, Number(k));
  const map = new Int16Array(maxC + 1).fill(-1);
  for (const [c, lid] of Object.entries(data.cultureLanguage)) map[Number(c)] = langIdx.get(lid) ?? -1;
  const legend: Layer['legend'] = data.languages.map((l, i) => ({
    idx: i, id: l.id, name: l.name, color: ix.color.get(l.id)!, start: l.born, end: l.died ?? 5000,
  }));
  return new MappedLayerState(culture, map, legend);
}
