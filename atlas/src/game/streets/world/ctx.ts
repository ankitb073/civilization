// Streets world: what every part of the streets layer works from.

import type { Kit } from './kit.ts';
import type { House, Occupancy, Plan, Side } from './plan.ts';
import type { StreetNames } from './names.ts';
import type { RGB } from '../../../three/city/style.ts';
import type { Intent } from './intents.ts';

export interface Ctx {
  cityId: string;
  plan: Plan;
  kit: Kit;
  /** Everything solid near the ground: the model's parts, then what the layer places. */
  occ: Occupancy;
  ground(x: number, z: number): number;
  /** Water depth (m) at a point (0 on land). */
  water(x: number, z: number): number;
  /** 0..1 from a label, the same for this city every time. */
  u(label: string): number;
  names: StreetNames;
  mobile: boolean;
  /** Sides of every house, measured once (index = position in plan.houses). */
  sides: SideInfo[][];
  /** Per house: what the layer has decided (doors, gaps in the parapet, …). */
  dress: HouseDress[];
  /** The walkable limit (m from the temple square), as the physics' ring of walls. */
  limit?: number;
  /** Who owns what the layer places (houses, stalls, wall runs …), for the hero district (owners.ts). */
  owners: Owners;
  /** What the layer placed, as the modular kit needs to redraw it (intents.ts). */
  intents: Intent[];
}

/** Stable ids for the things the layer dresses, each with the point that decides which district cell it falls in. */
export class Owners {
  readonly pos: { key: string; x: number; z: number }[] = [];
  private byKey = new Map<string, number>();
  id(key: string, x: number, z: number): number {
    let i = this.byKey.get(key);
    if (i === undefined) { i = this.pos.length; this.pos.push({ key, x, z }); this.byKey.set(key, i); }
    return i;
  }
  get(key: string): number { return this.byKey.get(key) ?? -1; }
}

/** The owner id of house i (registered on first use). */
export function houseOwner(ctx: Ctx, i: number): number {
  const h = ctx.plan.houses[i];
  return ctx.owners.id(`h:${i}`, h.x, h.z);
}

export interface SideInfo extends Side {
  /** Clear ground in front (m, capped at 12). */
  open: number;
  /** In front is a courtyard (enclosed on most sides). */
  court: boolean;
}

export interface HouseDress {
  house: House;
  /** The side and offset along it of the door (null: none). */
  door: { k: number; t: number } | null;
  /** Points on the roof edge kept clear of parapet (ladder tops, stair heads, plank ends): side k, offset t. */
  gaps: { k: number; t: number; w: number }[];
  /** Has a stair or a ladder from the ground. */
  access: 'ladder' | 'stair' | null;
  /** Taken by a special house (tablet house, the dyer's …). */
  role: string | null;
  parapet: number;
}

export const C = {
  void: [0.17, 0.13, 0.1] as RGB,
  timber: [0.48, 0.35, 0.24] as RGB,
  timberDark: [0.36, 0.26, 0.18] as RGB,
  reed: [0.8, 0.69, 0.48] as RGB,
  linen: [0.9, 0.86, 0.77] as RGB,
  madder: [0.66, 0.27, 0.18] as RGB,
  indigo: [0.24, 0.35, 0.49] as RGB,
  ochre: [0.79, 0.59, 0.24] as RGB,
  saffron: [0.85, 0.64, 0.25] as RGB,
  leaf: [0.44, 0.5, 0.27] as RGB,
  clay: [0.71, 0.44, 0.29] as RGB,
  buff: [0.75, 0.54, 0.37] as RGB,
  grain: [0.84, 0.7, 0.4] as RGB,
  bronze: [0.62, 0.45, 0.24] as RGB,
  stone: [0.72, 0.66, 0.56] as RGB,
  water: [0.24, 0.32, 0.31] as RGB,
  wood: [0.6, 0.47, 0.34] as RGB,
};

/** A point on a side: `t` along it (from its midpoint), `d` out from the wall, at height y. */
export function onSide(s: Side, t: number, d: number): [number, number] {
  return [s.x + s.tx * t + s.nx * d, s.z + s.tz * t + s.nz * d];
}

/** Yaw (as the city's parts) of something whose local x runs along the side. */
export function yawAlong(s: Side): number {
  return Math.atan2(-s.tz, s.tx);
}
