// Streets world: what the streets layer placed, as the modular kit needs to redraw it. The layer draws its own
// primitives (and their colliders) for the whole town at load; inside the hero district the kit (district.ts,
// assemble.ts) later draws the same things from Blender-built pieces, at the same places and sizes, so the colliders
// the layer made stay true. Each intent names its owner (ctx.owners): the district swaps an owner's primitives for
// its kit pieces all at once.

import type { Side } from './plan.ts';
import type { RGB } from '../../../three/city/style.ts';

type V3 = [number, number, number];

export type Intent =
  /** A window in a house wall: side k of house i, centred t along it, its middle at height y. */
  | { k: 'window'; owner: number; house: number; side: number; t: number; y: number }
  /** Roof beam ends along these sides of house i. */
  | { k: 'vigas'; owner: number; house: number; sides: number[] }
  /** A run of parapet along a side of the roof slab (inset by half the parapet's thickness): t from a to b. */
  | { k: 'parapet'; owner: number; house: number; side: Side; a: number; b: number; h: number; th: number; roof: number }
  /** A straight stair along a side (t0 → t1 rising) from g to top, `width` out from the wall (after `out`). */
  | { k: 'stair'; owner: number; side: Side; t0: number; t1: number; g: number; top: number; width: number; out: number; landing: number }
  /** A flight of steps straight out from a face (temple, palace, bridge ends). */
  | { k: 'front'; owner: number; side: Side; t: number; width: number; top: number; g: number; run: number; what: 'temple' | 'palace' | 'bridge' }
  /** A ladder from its foot F to its top T (past the wall top), leaning on a wall whose outward normal is n. */
  | { k: 'ladder'; owner: number; F: V3; T: V3; n: [number, number] }
  /** A low wall closing an alley: from a to b (its centre line at mid height), h tall, th thick. */
  | { k: 'lowWall'; owner: number; a: V3; b: V3; h: number; th: number }
  /** A jar standing at (x, y, z) on its base: r its radius, h its height. */
  | { k: 'jar'; owner: number; x: number; y: number; z: number; yaw: number; r: number; h: number }
  /** Firewood stacked against a wall at (x, y, z), its length along yaw (the side's), its back to the wall. */
  | { k: 'firewood'; owner: number; x: number; y: number; z: number; yaw: number; nx: number; nz: number }
  /** On a roof: a sleeping mat, a bread oven, grain spread to dry. */
  | { k: 'mat'; owner: number; x: number; y: number; z: number; yaw: number; c: RGB }
  | { k: 'oven'; owner: number; x: number; y: number; z: number; yaw: number }
  | { k: 'grain'; owner: number; x: number; y: number; z: number; yaw: number; w: number; d: number }
  /** A market stall at (x, z), at angle a round the square (its counter toward the centre), its awning's colour. */
  | { k: 'stall'; owner: number; x: number; z: number; a: number; i: number; cloth: RGB; goods: { u: number; v: number; kind: number; c: RGB }[]; jar: boolean }
  /** The weigher's scale, the well with its sweep, the cistern of the house of tablets. */
  | { k: 'scale'; owner: number; x: number; z: number; a: number }
  | { k: 'well'; owner: number; x: number; z: number; a: number }
  | { k: 'cistern'; owner: number; x: number; z: number; r: number }
  /** Clay tablets drying on the roof of the house of tablets: racks along its local z, at roof height. */
  | { k: 'tablets'; owner: number; house: number; racks: { x: number; z: number; yaw: number; len: number }[]; y: number }
  /** Baskets of clay by a door. */
  | { k: 'basket'; owner: number; x: number; y: number; z: number; yaw: number }
  /** A gate leaf swung open: hinge at a, its far edge at b (both at mid height), h tall. */
  | { k: 'gateLeaf'; owner: number; a: V3; b: V3; h: number }
  /** A tree in a courtyard: trunk foot at (x, y, z), its size factor. */
  | { k: 'tree'; owner: number; x: number; y: number; z: number; sz: number }
  /** The great doorway of the palace hall, and the columns beside it. */
  | { k: 'palaceDoor'; owner: number; side: Side; y: number; columns: V3[] };

export type IntentKind = Intent['k'];
