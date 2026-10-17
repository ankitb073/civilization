// Streets: physics with Rapier (rapier3d-compat, its wasm inlined, loaded in its own lazy chunk). The city is static:
// its solids and ground become fixed colliders; the runner is a kinematic capsule moved by Rapier's kinematic character
// controller, which slides along walls, climbs slopes and steps, and snaps to the ground. The camera's collision is a
// sphere cast through the same world.

import type * as RapierNS from '@dimforge/rapier3d-compat';
import type { StreetsCity } from './world.ts';

export type Rapier = typeof RapierNS;

let rapierP: Promise<Rapier> | null = null;
/** Load and initialise Rapier once (the wasm is inlined in the module as base64). */
export function loadRapier(): Promise<Rapier> {
  if (!rapierP) {
    rapierP = import('@dimforge/rapier3d-compat').then(async (m) => {
      const R = ((m as unknown as { default?: Rapier }).default ?? m) as Rapier;
      await R.init();
      return R;
    });
    rapierP.catch(() => { rapierP = null; });
  }
  return rapierP;
}

/** The runner's capsule: 1.76 m tall, 0.3 m in radius. */
export const CAPSULE = { half: 0.58, radius: 0.3 };
export const CAPSULE_CENTRE = CAPSULE.half + CAPSULE.radius;

export interface MoveResult { dx: number; dy: number; dz: number; grounded: boolean; hitWall: boolean; hitCeiling: boolean }

/** An edge in front of the runner, found by casting against the colliders: the wall's face, its top, which way it faces,
 *  and a free place to stand on top. */
export interface Ledge {
  /** Height of the edge's top (m), and how far above the feet it is. */
  top: number; up: number;
  /** Where the wall's face is, on the runner's line, and the unit horizontal normal out of the wall (toward the runner). */
  fx: number; fz: number; nx: number; nz: number;
  /** Horizontal distance from the runner's axis to the face. */
  dist: number;
  /** Where the feet will stand on top (free of the city for the runner's capsule). */
  sx: number; sy: number; sz: number;
}

export class StreetsPhysics {
  readonly R: Rapier;
  readonly world: RapierNS.World;
  readonly body: RapierNS.RigidBody;
  readonly collider: RapierNS.Collider;
  readonly kcc: RapierNS.KinematicCharacterController;
  readonly counts = { bodies: 0, colliders: 0, boxes: 0, hulls: 0, groundTris: 0, buildMs: 0 };
  private ball: RapierNS.Ball;
  private rot = { x: 0, y: 0, z: 0, w: 1 };

  constructor(R: Rapier, city: StreetsCity, spawn: { x: number; y: number; z: number }) {
    const t0 = performance.now();
    this.R = R;
    const world = new R.World({ x: 0, y: 0, z: 0 }); // gravity is the controller's own
    this.world = world;
    // the ground: one triangle mesh
    const g = city.ground;
    world.createCollider(R.ColliderDesc.trimesh(g.vertices, g.indices));
    this.counts.groundTris = g.indices.length / 3;
    // the city's solids
    for (const s of city.solids) {
      if (s.kind === 'box') {
        world.createCollider(R.ColliderDesc.cuboid(s.hx, s.hy, s.hz).setTranslation(s.x, s.y, s.z).setRotation({ x: s.q.x, y: s.q.y, z: s.q.z, w: s.q.w }));
        this.counts.boxes++;
      } else {
        const d = R.ColliderDesc.convexHull(s.points);
        if (d) { world.createCollider(d); this.counts.hulls++; }
      }
    }
    // the edge of the walkable land: a ring of tall boxes
    const n = 96, rl = city.limit;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const half = (Math.PI * rl) / n + 0.5;
      const yaw = -a;
      world.createCollider(
        R.ColliderDesc.cuboid(1, 60, half).setTranslation(Math.cos(a) * (rl + 1), 0, Math.sin(a) * (rl + 1))
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
      );
    }
    // the runner
    this.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + CAPSULE_CENTRE, spawn.z));
    this.collider = world.createCollider(R.ColliderDesc.capsule(CAPSULE.half, CAPSULE.radius), this.body);
    const k = world.createCharacterController(0.02);
    k.setUp({ x: 0, y: 1, z: 0 });
    k.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    k.setMinSlopeSlideAngle((56 * Math.PI) / 180);
    k.enableAutostep(0.42, 0.18, false);
    k.enableSnapToGround(0.35);
    k.setSlideEnabled(true);
    k.setApplyImpulsesToDynamicBodies(false);
    this.kcc = k;
    this.ball = new R.Ball(0.18);
    world.step(); // builds the broad phase so queries see every collider
    this.counts.bodies = world.bodies.len();
    this.counts.colliders = world.colliders.len();
    this.counts.buildMs = performance.now() - t0;
  }

  /** Feet position (bottom of the capsule). */
  feet(): { x: number; y: number; z: number } {
    const t = this.body.translation();
    return { x: t.x, y: t.y - CAPSULE_CENTRE, z: t.z };
  }

  teleport(x: number, y: number, z: number) {
    this.body.setTranslation({ x, y: y + CAPSULE_CENTRE, z }, true);
    this.body.setNextKinematicTranslation({ x, y: y + CAPSULE_CENTRE, z });
    this.world.step();
  }

  /** Move the capsule by a wished-for displacement; returns what it really did. */
  move(dx: number, dy: number, dz: number): MoveResult {
    const k = this.kcc;
    k.computeColliderMovement(this.collider, { x: dx, y: dy, z: dz }, this.R.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = k.computedMovement();
    const grounded = k.computedGrounded();
    let hitWall = false, hitCeiling = false;
    for (let i = 0; i < k.numComputedCollisions(); i++) {
      const c = k.computedCollision(i);
      if (!c) continue;
      const ny = c.normal1.y;
      if (ny < -0.6) hitCeiling = true;
      else if (Math.abs(ny) < 0.35) hitWall = true;
    }
    const t = this.body.translation();
    // nothing in the world moves but the runner, so there is no simulation step to run: put the capsule where the
    // controller says and carry that to its collider (a full world.step() costs ~1 ms per 6,000 static colliders)
    this.body.setTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z }, false);
    this.world.propagateModifiedBodyPositionsToColliders();
    return { dx: m.x, dy: m.y, dz: m.z, grounded, hitWall, hitCeiling };
  }

  /** How far a small sphere travels from `from` toward `to` before it touches the city (the camera's pull-in). */
  sweep(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): number {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return 0;
    const hit = this.world.castShape(from, this.rot, { x: dx / len, y: dy / len, z: dz / len }, this.ball, 0, len, true,
      undefined, undefined, this.collider, this.body);
    return hit ? hit.time_of_impact : len;
  }

  /** Is a capsule standing at these feet free of the city? */
  free(x: number, y: number, z: number): boolean {
    const shape = new this.R.Capsule(CAPSULE.half, CAPSULE.radius);
    const c = this.world.intersectionWithShape({ x, y: y + CAPSULE_CENTRE + 0.05, z }, this.rot, shape, undefined, undefined, this.collider, this.body);
    return !c;
  }

  /** Ground height under (x, z) by a ray from high above (null when nothing is there). */
  groundAt(x: number, z: number, fromY = 200): number | null {
    const ray = new this.R.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, fromY + 50, true, undefined, undefined, this.collider, this.body);
    return hit ? fromY - hit.timeOfImpact : null;
  }

  /** Put the capsule's feet here directly (scripted moves: mantles, hangs, ladders), without the controller. */
  place(x: number, y: number, z: number) {
    this.body.setTranslation({ x, y: y + CAPSULE_CENTRE, z }, false);
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  /** A horizontal ray at height y: distance and the surface's normal (null when nothing within max). */
  rayFlatHit(x: number, y: number, z: number, dx: number, dz: number, max: number): { toi: number; nx: number; ny: number; nz: number } | null {
    const ray = new this.R.Ray({ x, y, z }, { x: dx, y: 0, z: dz });
    const hit = this.world.castRayAndGetNormal(ray, max, true, undefined, undefined, this.collider, this.body);
    return hit ? { toi: hit.timeOfImpact, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z } : null;
  }

  /** The surface below (x, z) from height fromY, with its normal's up part (null when nothing within depth). */
  downHit(x: number, z: number, fromY: number, depth: number): { y: number; ny: number } | null {
    const ray = new this.R.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRayAndGetNormal(ray, depth, true, undefined, undefined, this.collider, this.body);
    return hit ? { y: fromY - hit.timeOfImpact, ny: hit.normal.y } : null;
  }

  /**
   * An edge ahead of feet (x, y, z) along the unit direction (dx, dz): a wall within `reach` of the runner's axis at
   * knee, waist, chest or head height, facing the runner, whose top is between minUp and maxUp above the feet, with
   * room to stand on top (a parapet's top counts as the edge, the roof behind it as the standing place). Null if none.
   */
  ledge(x: number, y: number, z: number, dx: number, dz: number, reach: number, minUp: number, maxUp: number): Ledge | null {
    let wall: { toi: number; nx: number; nz: number } | null = null;
    for (const h of [0.35, 0.9, 1.5, 1.95]) {
      if (h > maxUp + 0.3) break;
      const hit = this.rayFlatHit(x, y + h, z, dx, dz, reach);
      if (!hit || Math.abs(hit.ny) > 0.5) continue;
      const l = Math.hypot(hit.nx, hit.nz);
      const nx = hit.nx / l, nz = hit.nz / l;
      if (nx * dx + nz * dz > -0.45) continue; // a wall seen edge-on is not one to climb
      if (!wall || hit.toi < wall.toi) wall = { toi: hit.toi, nx, nz };
    }
    if (!wall) return null;
    const fx = x + dx * wall.toi, fz = z + dz * wall.toi;
    // the top: rays straight down just behind the face; the highest within the first 0.3 m is the edge (a parapet's top)
    let top = -Infinity;
    for (const d of [0.1, 0.2, 0.32]) {
      const hit = this.downHit(fx - wall.nx * d, fz - wall.nz * d, y + maxUp + 0.6, maxUp - minUp + 0.9);
      if (hit && hit.ny > 0.7) top = Math.max(top, hit.y);
    }
    const up = top - y;
    if (!Number.isFinite(top) || up < minUp || up > maxUp) return null;
    // something over the edge (a wall going on up, an eave) leaves no room to come over it
    if (this.rayFlatHit(fx + wall.nx * 0.2, top + 0.45, fz + wall.nz * 0.2, -wall.nx, -wall.nz, 0.7)) return null;
    // a place to stand: in from the face, on whatever is there (the roof behind a parapet), with room for the capsule
    for (const d of [0.45, 0.7, 0.95, 1.2]) {
      const sx = fx - wall.nx * d, sz = fz - wall.nz * d;
      const g = this.downHit(sx, sz, top + 0.6, 1.4);
      if (!g || g.ny < 0.7 || g.y < top - 0.75) continue;
      if (this.free(sx, g.y + 0.02, sz)) return { top, up, fx, fz, nx: wall.nx, nz: wall.nz, dist: wall.toi, sx, sy: g.y, sz };
    }
    return null;
  }

  /** Distance along a horizontal ray at height y before it hits something (Infinity when nothing within max). */
  rayFlat(x: number, y: number, z: number, dx: number, dz: number, max: number): number {
    const ray = new this.R.Ray({ x, y, z }, { x: dx, y: 0, z: dz });
    const hit = this.world.castRay(ray, max, true, undefined, undefined, this.collider, this.body);
    return hit ? hit.timeOfImpact : Infinity;
  }

  dispose() { this.world.free(); }
}
