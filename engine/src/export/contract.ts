// The data contract between the engine (producer) and the atlas (consumer).
// Files live under atlas/public/data/. Pure types + tiny pure helpers only:
// this module is imported by both Node and the browser.

import { hashString } from '../core/rng.ts';

export type EntityKind =
  | 'polity' | 'person' | 'settlement' | 'region' | 'river' | 'culture' | 'language'
  | 'script' | 'movement' | 'deity' | 'currency' | 'house' | 'tech' | 'climate'
  | 'event' | 'artifact';

/** Entity ids look like "pol:12", "per:345", "evt:9001", "art:42". */
export const KIND_PREFIX: Record<EntityKind, string> = {
  polity: 'pol', person: 'per', settlement: 'set', region: 'reg', river: 'riv', culture: 'cul',
  language: 'lan', script: 'scr', movement: 'mov', deity: 'dei', currency: 'cur', house: 'hou',
  tech: 'tec', climate: 'cli', event: 'evt', artifact: 'art',
};

export function kindOf(id: string): EntityKind {
  const p = id.slice(0, id.indexOf(':'));
  for (const k of Object.keys(KIND_PREFIX) as EntityKind[]) if (KIND_PREFIX[k] === p) return k;
  throw new Error(`unknown id prefix: ${id}`);
}

export const SHARD_COUNT = 256;
export function shardOf(id: string): number {
  return hashString(id) % SHARD_COUNT;
}
export function shardFile(n: number): string {
  return `pages/${n.toString().padStart(3, '0')}.json`;
}

// ---------------------------------------------------------------- meta.json
export interface Era { id: string; name: string; start: number; end: number; blurb: string }

export interface MetaJson {
  title: string;
  subtitle: string;
  worldName: string;
  seed: number;
  engineVersion: string;
  yearStart: number;           // 0
  yearEnd: number;             // 5000
  yearLabel: string;           // "AY" (Archive Year)
  counts: Record<string, number>;
  eras: Era[];
  check: {
    passed: boolean;
    invariants: { id: string; title: string; checked: number; violations: number }[];
  };
  editorialLanguage: string;
  downloads: { label: string; href: string; bytes: number }[];
  featured: { id: string; title: string; why: string }[]; // curated entry points
}

// ---------------------------------------------------------------- world.json
export interface WorldJson {
  width: number;
  height: number;
  /** Flat [x0, y0, x1, y1, ...] Voronoi sites. Atlas rebuilds cells with
   *  d3-delaunay: Delaunay.from(pairs).voronoi([0, 0, width, height]). */
  points: number[];
  /** 0..255 per cell. Cells with elevation < seaLevel are water. */
  elevation: number[];
  seaLevel: number;
  biome: number[];
  biomes: { id: number; name: string; color: string }[];
  /** Polylines through cell sites, source → mouth; width grows downstream (1..6). */
  rivers: { id: string; name: string; cells: number[]; width: number[] }[];
  regions: { id: string; name: string; labelCell: number }[];
  /** Region index per cell, -1 for water. */
  regionOf: number[];
}

// ---------------------------------------------------------------- timeline.json
/** A per-cell categorical layer that changes over time (ownership, culture, religion). */
export interface Layer {
  legend: { idx: number; id: string; name: string; color: string; start: number; end: number }[];
  keyframeEvery: number;       // 100
  /** keyframes[k] = state at year k*keyframeEvery. base64 of little-endian Int16Array, one value
   *  per cell = legend idx or -1. */
  keyframes: string[];
  /** base64 of little-endian Int32Array triplets [year, cell, idx], sorted by year. Apply the
   *  deltas with keyframe year < year <= target to the nearest keyframe at or before target. */
  deltas: string;
}

export interface TimelineJson {
  layers: { political: Layer; culture: Layer; religion: Layer };
  polities: {
    idx: number;               // == political legend idx
    id: string;
    names: [year: number, name: string][];  // name as of year (conventional, editorial)
    capitals: [year: number, settlementIdx: number][];
  }[];
  settlements: {
    idx: number; id: string; name: string; cell: number; start: number; end: number;
    pop: [year: number, pop: number][];      // per century
  }[];
  events: {
    id: string; year: number; end: number; sub: string; title: string;
    cell: number;              // -1 if not located
    sig: number;               // 0..1 significance, for marker filtering
  }[];
  /** Global climate anomaly per decade. temp in °C vs. baseline, precip as fraction. */
  climate: { year: number; temp: number; precip: number }[];
  /** Trade routes per century: [settlementIdxA, settlementIdxB, relative volume 0..1]. */
  routes: { year: number; edges: [number, number, number][] }[];
}

// ---------------------------------------------------------------- graph.json
/** Columnar for size. Positions precomputed with ForceAtlas2 at build time. */
export interface GraphJson {
  ids: string[];
  labels: string[];
  kinds: EntityKind[];
  x: number[];
  y: number[];
  size: number[];
  t0: number[];                // existence start (year)
  t1: number[];                // existence end (year)
  /** Flat [sourceIdx, targetIdx, ...]. Undirected for display. */
  edges: number[];
}

// ---------------------------------------------------------------- search.json
/** [id, title, kind, t0, aliases joined by "|"] */
export type SearchEntry = [string, string, EntityKind, number, string];
export interface SearchJson { entries: SearchEntry[] }

// ---------------------------------------------------------------- pages/NNN.json
export interface InterlinearText {
  transliteration: string;
  normalized: string;
  tokens: { normalized: string; segmented: string; gloss: string }[];
  translation: string;
}

export interface PageJson {
  id: string;
  kind: EntityKind;
  sub: string;                 // e.g. event 'war' | 'battle' | 'treaty'..., artifact 'treaty' | 'ledger'...
  title: string;
  t0: number;
  t1: number;
  summary: string;
  infobox: [label: string, value: string][];   // values may contain [[id|text]] links
  /** Markdown. Links are written [[id|display text]]. Headings, lists, tables, blockquotes,
   *  emphasis. Lacunae appear as [...] and are plain text. */
  body: string;
  links: string[];
  backlinks: string[];
  cell: number;                // map focus cell, -1 if none
  /** Name of this entity through time and across languages. */
  names?: { year: number; lang: string; form: string; scholarly: string }[];
  /** Small multiples for sparklines (area, population, prices, adherents...). */
  series?: { label: string; unit: string; points: [number, number][] }[];
  artifact?: {
    catalog: string;           // "PAL·TR·00347"
    date: string;              // as written, in the local calendar
    language: string;          // display names (also linked in infobox)
    script: string;
    medium: string;
    authorId?: string;
    condition: string;
    provenance: string;
    translatorId?: string;
    flagship: boolean;
    interlinear?: InterlinearText;
    ledger?: { columns: string[]; rows: string[][]; notes: string[] };
    rival?: { eventId: string; side: string };
  };
  /** For events with competing accounts: ground truth vs. what each source claims. */
  accounts?: {
    truth: [field: string, value: string][];
    sources: { artifactId: string; side: string; author: string; claims: [field: string, value: string][] }[];
  };
  /** For languages. */
  language?: {
    soundChanges: { year: number; rule: string; label: string; lang: string }[];
    words: { concept: string; forms: [year: number, form: string][] }[];
    daughters: string[];
    parent: string | null;
  };
}

export interface ShardJson { pages: PageJson[] }
