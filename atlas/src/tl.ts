// Atlas-side split of timeline.json (written by scripts/prepare-data.ts) so the first map paint
// needs only a small core plus the political layer for the current millennium.

import type { Layer, TimelineJson } from '../../engine/src/export/contract.ts';

export const TL_VERSION = 2;

/** Columnar to compress well; expanded back to contract shapes in the browser. */
export interface TlCore {
  v: number;
  layerFiles: TimelineJson['layerFiles'];
  polities: { id: string[]; idx: number[]; names: [number, string][][]; capitals: [number, number][][] };
  /** populations rounded to 2 significant figures (finer than anything displayed) */
  settlements: TimelineJson['settlements'];
  climate: TimelineJson['climate'];
  political: {
    legend: { idx: number[]; id: string[]; name: string[]; color: string[]; start: number[]; end: number[] };
    keyframeEvery: number;
    chunkYears: number;
    chunks: { file: string; firstKeyframe: number; keyframes: number }[];
  };
  /** loaded after the first paint */
  events: string;
  routes: string;
}

export interface TlEvents { id: string[]; year: number[]; end: number[]; sub: string[]; cell: number[]; sig: number[]; title: string[] }

/** One millennium of the political layer: its keyframes and the changes between them. */
export interface TlChunk {
  firstKeyframe: number;
  keyframes: string[];
  deltas: string;
  deltaCount: number;
  deltaBase: number;
}

export function expandLegend(L: TlCore['political']['legend']): Layer['legend'] {
  return L.idx.map((idx, i) => ({ idx, id: L.id[i], name: L.name[i], color: L.color[i], start: L.start[i], end: L.end[i] }));
}
export function expandPolities(P: TlCore['polities']): TimelineJson['polities'] {
  return P.idx.map((idx, i) => ({ idx, id: P.id[i], names: P.names[i], capitals: P.capitals[i] }));
}
export function expandEvents(E: TlEvents): TimelineJson['events'] {
  return E.id.map((id, i) => ({ id, year: E.year[i], end: E.end[i], sub: E.sub[i], cell: E.cell[i], sig: E.sig[i], title: E.title[i] }));
}
