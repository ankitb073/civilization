import type { EntityKind } from '../../engine/src/export/contract.ts';

export const KINDS: EntityKind[] = [
  'polity', 'person', 'settlement', 'region', 'river', 'culture', 'language', 'script',
  'movement', 'deity', 'currency', 'house', 'tech', 'climate', 'event', 'artifact',
];

export const KIND_LABEL: Record<EntityKind, [string, string]> = {
  polity: ['Polity', 'Polities'],
  person: ['Person', 'People'],
  settlement: ['Settlement', 'Settlements'],
  region: ['Region', 'Regions'],
  river: ['River', 'Rivers'],
  culture: ['Culture', 'Cultures'],
  language: ['Language', 'Languages'],
  script: ['Script', 'Scripts'],
  movement: ['Movement', 'Movements'],
  deity: ['Deity', 'Deities'],
  currency: ['Currency', 'Currencies'],
  house: ['Merchant house', 'Merchant houses'],
  tech: ['Technology', 'Technologies'],
  climate: ['Climate anomaly', 'Climate anomalies'],
  event: ['Event', 'Events'],
  artifact: ['Document', 'Documents'],
};

export function kindColor(k: string): string {
  return `var(--k-${k})`;
}

let cached: { theme: string; map: Record<string, string> } | null = null;
/** Resolved hex colours for canvas/WebGL use. */
export function kindColors(theme: string): Record<string, string> {
  if (cached && cached.theme === theme) return cached.map;
  const cs = getComputedStyle(document.documentElement);
  const map: Record<string, string> = {};
  for (const k of KINDS) map[k] = cs.getPropertyValue(`--k-${k}`).trim() || '#888';
  cached = { theme, map };
  return map;
}

export function kindFromId(id: string): EntityKind | null {
  const p = id.slice(0, id.indexOf(':'));
  const m: Record<string, EntityKind> = {
    pol: 'polity', per: 'person', set: 'settlement', reg: 'region', riv: 'river', cul: 'culture',
    lan: 'language', scr: 'script', mov: 'movement', dei: 'deity', cur: 'currency', hou: 'house',
    tec: 'tech', cli: 'climate', evt: 'event', art: 'artifact',
  };
  return m[p] ?? null;
}
