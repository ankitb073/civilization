// Streets: the affordances contract between the world (world.ts and world/*) and the runner (runner.ts, physics.ts,
// game.ts). The world says where the ladders, places and water are; the runner decides how to climb, label and wade.
// Everything is in world metres (x east, z south, y up), the same frame as the physics and the scene.

import type { Vector3 } from 'three';

/** A ladder leaning on a wall. The climber stands at `base` (just in front of the ladder's foot), faces the wall
 *  (-facing) and climbs to `top`, which is on the roof, a little in from the edge. Most ladders stand in the street;
 *  some stand on a roof (up to a room on it) or on the wall walk (over a tower). The ladder has a collider: a slab
 *  0.6 m wide and 0.1 m thick along it, so a runner bumps into it and can stand beside it. */
export interface Ladder {
  /** Where the climber's feet stand to start (metres): 0.45 m out from the ladder's foot, at the foot's height. */
  base: Vector3;
  /** Where the climber's feet stand on arriving at the top: on the roof, about 0.4 m in from the edge (metres). */
  top: Vector3;
  /** Unit horizontal vector from the wall toward the climber (y = 0). */
  facing: Vector3;
}

export type PlaceKind = 'tablet-house' | 'palace' | 'temple' | 'market' | 'gate' | 'walls' | 'well' | 'house';

/** A named place of the city. `pos` is a point on the ground in front of it (where a runner arrives); `radius` is
 *  how near (metres, horizontal) counts as being there. */
export interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  pos: Vector3;
  radius: number;
  /** A second line for the HUD ("Palace of Duvekopuvinga", "standing since AY 234"). */
  note?: string;
  /** The record's page for it, when it has one (pol:26, mov:2 …), for links. */
  ref?: string;
}

export interface Affordances {
  ladders: Ladder[];
  places: Place[];
  /** Water depth (metres, ≥ 0) at a point: 0 on dry land, the depth below the water surface in the river. */
  waterDepthAt(x: number, z: number): number;
}

/** The nearest place within its radius of (x, z), or null (for the HUD label and errands). */
export function placeAt(a: Affordances, x: number, z: number, slack = 0): Place | null {
  let best: Place | null = null;
  let bd = Infinity;
  for (const p of a.places) {
    const d = Math.hypot(p.pos.x - x, p.pos.z - z);
    if (d <= p.radius + slack && d - p.radius < bd) { bd = d - p.radius; best = p; }
  }
  return best;
}

/** The nearest ladder base within `max` metres of (x, y, z), or null. */
export function ladderNear(a: Affordances, x: number, y: number, z: number, max = 1.2): Ladder | null {
  let best: Ladder | null = null;
  let bd = max;
  for (const l of a.ladders) {
    if (Math.abs(l.base.y - y) > 1) continue;
    const d = Math.hypot(l.base.x - x, l.base.z - z);
    if (d < bd) { bd = d; best = l; }
  }
  return best;
}
