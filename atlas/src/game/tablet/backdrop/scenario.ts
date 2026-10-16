// What the backdrop reads from a Tablet House scenario: a structural subset of the game's Scenario (scenarios.json,
// docs/lld/tablet-house.md), so the full record type is assignable to it.

import type { Outcome } from './looks.ts';

export interface BackdropScenario {
  id: string;
  year: number;
  city: { id: string; name: string; pop: number; cell: number; port: boolean };
  state: { id: string; name: string };
  enemy: { id: string; name: string };
  /** placeId: the settlement (or region) the battle is named for; cell: where it was fought, when known. */
  battle?: { id: string; place?: string; placeId?: string; theirs?: number; ours?: number; cell?: number } | null;
  outcome: Outcome;
  burnedArchives?: boolean;
  /** Optional framing hint (relief-scene units). The backdrop frames every beat itself (heading clear of hills, distance
   *  from the city's size), so it reads only a deliberate one: `camera.fixed` true keeps this heading and distance. */
  camera?: { x: number; y: number; z: number; target: [number, number, number]; fixed?: boolean } | null;
}

/** FNV-1a with an avalanche: a stable 32-bit hash of a label. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

/** A small deterministic stream (mulberry32) from a label: never Math.random. */
export function streamOf(label: string): () => number {
  let a = hashStr(label);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The city's radius in relief-scene units (a district is ~0.18 across). */
export function cityRadius(pop: number): number {
  return Math.max(0.045, Math.min(0.17, 0.04 + Math.sqrt(Math.max(0, pop)) * 0.000078));
}

/** Rough technological age from the year when the eras are not at hand (0 bronze … 6 networks). */
export const ERA_STARTS = [0, 1866, 2439, 3154, 4593, 4741, 4947];
export function eraIndex(year: number, starts: number[] = ERA_STARTS): number {
  let a = 0;
  starts.forEach((s, i) => { if (year >= s) a = i; });
  return a;
}
