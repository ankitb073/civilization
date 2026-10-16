// Streets: the third-person camera. Over the right shoulder, a few metres back; it follows a smoothed pivot at head
// height, never passes through the city (a sphere is swept from the head out to where the camera wants to be, and the
// camera comes in at once to the first thing it meets, then eases back out), and with reduced motion it neither bobs
// with the stride nor widens with speed.

import type { PerspectiveCamera } from 'three';

export interface CamFrame {
  /** Feet of the runner (interpolated). */
  x: number; y: number; z: number;
  /** Horizontal speed (m/s), the run speed for scale, and grounded. */
  speed: number; runSpeed: number; grounded: boolean;
  /** 0..1 through the stride, for the bob. */
  phase: number;
  /** Runner's facing (radians, +z at 0) and whether it is moving under the player's control. */
  facing: number; moving: boolean;
}

export type Sweep = (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) => number;

const HEAD = 1.55;
const MIN_PITCH = -0.55, MAX_PITCH = 1.15;

export class ThirdPersonCamera {
  yaw = 0;
  pitch = 0.18;
  /** Wanted distance behind the pivot and how far it really is (after the sweep). */
  want = 3.9;
  dist = 3.9;
  shoulder = 0.42;
  /** Auto-follow: swing round behind the runner when the player has not looked for a while (touch, scripted runs). */
  follow = false;
  reduced: boolean;
  private px = 0; private py = 0; private pz = 0;
  private init = false;
  private dip = 0; private dipV = 0;
  private fovNow = 0;
  baseFov = 60;
  /** Which shoulder (1 right, -1 left), and the offset easing toward it. */
  private side = 1;
  private offNow = 0.42;
  private swapAt = -1e9;
  /** The last sweep's result, for the probes. */
  readonly last = { wanted: 0, got: 0 };

  constructor(reduced: boolean) { this.reduced = reduced; }

  /** Portrait phones see less across: a wider lens, a little further back, the shoulder nearer the middle. */
  fit(aspect: number) {
    const portrait = aspect < 0.9;
    this.baseFov = portrait ? 70 : 58;
    this.want = portrait ? 4.6 : 3.9;
    this.shoulder = portrait ? 0.28 : 0.45;
  }

  turn(dx: number, dy: number) {
    this.yaw -= dx;
    this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch + dy));
  }

  /** A landing: the view sinks a little and springs back (not with reduced motion). */
  land(drop: number) {
    if (this.reduced) return;
    this.dipV -= Math.min(2.2, 0.55 + drop * 0.35);
  }

  /** Forward on the ground for the move axes (the direction the camera looks, flattened). */
  forward(): [number, number] { return [Math.sin(this.yaw), Math.cos(this.yaw)]; }

  update(cam: PerspectiveCamera, dt: number, f: CamFrame, sweep: Sweep, lastLook: number) {
    // pivot: quick across, slower up and down (steps and jumps do not jolt the view)
    const tx = f.x, ty = f.y + HEAD, tz = f.z;
    if (!this.init) { this.px = tx; this.py = ty; this.pz = tz; this.init = true; }
    const kxz = 1 - Math.exp(-dt * 16), ky = 1 - Math.exp(-dt * (f.grounded ? 9 : 5));
    this.px += (tx - this.px) * kxz; this.pz += (tz - this.pz) * kxz; this.py += (ty - this.py) * ky;

    // swing behind the runner when nobody is steering the view
    if (this.follow && f.moving && performance.now() - lastLook > 1400) {
      let d = f.facing - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const rate = 0.9 * Math.min(1, f.speed / Math.max(1, f.runSpeed)) + 0.25;
      this.yaw += d * (1 - Math.exp(-dt * rate));
      this.pitch += (0.16 - this.pitch) * (1 - Math.exp(-dt * 0.8));
    }

    // spring for the landing dip
    this.dipV += (-this.dip * 90 - this.dipV * 14) * dt;
    this.dip += this.dipV * dt;
    let bob = 0;
    if (!this.reduced && f.grounded && f.speed > 0.3) {
      const amp = 0.008 + 0.018 * Math.min(1, f.speed / Math.max(1, f.runSpeed));
      bob = Math.sin(f.phase * Math.PI * 4) * amp;
    }

    const cy = Math.cos(this.pitch), sy = Math.sin(this.pitch);
    const fx = Math.sin(this.yaw) * cy, fy = -sy, fz = Math.cos(this.yaw) * cy;
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    const head = { x: this.px, y: this.py + (this.reduced ? 0 : this.dip * 0.25) + bob, z: this.pz };
    const want = this.want * (this.reduced ? 1 : 1 + 0.08 * Math.min(1, f.speed / Math.max(1, f.runSpeed)));
    // out to the shoulder, then back along the view; how far each shoulder's boom gets
    const boom = (off: number) => {
      const sh = { x: head.x + rx * off, y: head.y, z: head.z + rz * off };
      const s1 = Math.abs(off) > 1e-3 ? Math.max(0, sweep(head, sh) - 0.05) : 0;
      const k1 = Math.abs(off) > 1e-3 ? Math.min(1, s1 / Math.abs(off)) : 1;
      const piv = { x: head.x + rx * off * k1, y: head.y, z: head.z + rz * off * k1 };
      const end = { x: piv.x - fx * want, y: piv.y - fy * want, z: piv.z - fz * want };
      return { piv, got: Math.max(0.25, sweep(piv, end) - 0.1) };
    };
    // in a tight spot, swap shoulders when the other side leaves the camera much more room (as third-person games do)
    let b = boom(this.offNow);
    if (b.got < want * 0.6 && performance.now() - this.swapAt > 600) {
      const other = boom(-this.side * this.shoulder);
      if (other.got > b.got + 0.6) { this.side = -this.side; this.swapAt = performance.now(); }
    } else if (this.side < 0 && performance.now() - this.swapAt > 2500) {
      // drift back to the right shoulder once there is room there again
      const right = boom(this.shoulder);
      if (right.got > want * 0.9) { this.side = 1; this.swapAt = performance.now(); }
    }
    this.offNow += (this.side * this.shoulder - this.offNow) * (1 - Math.exp(-dt * 6));
    b = boom(this.offNow);
    const piv = b.piv, got = b.got;
    // in at once, out gently
    if (got < this.dist) this.dist = got;
    else this.dist += (got - this.dist) * (1 - Math.exp(-dt * 3.5));
    this.dist = Math.min(this.dist, want);
    this.last.wanted = want; this.last.got = this.dist;
    cam.position.set(piv.x - fx * this.dist, piv.y - fy * this.dist, piv.z - fz * this.dist);
    cam.lookAt(piv.x, piv.y, piv.z);

    const fov = this.baseFov + (this.reduced ? 0 : 7 * Math.min(1, Math.max(0, (f.speed - 2) / Math.max(1, f.runSpeed - 2))));
    if (!this.fovNow) this.fovNow = fov;
    this.fovNow += (fov - this.fovNow) * (1 - Math.exp(-dt * 4));
    if (Math.abs(cam.fov - this.fovNow) > 0.01) { cam.fov = this.fovNow; cam.updateProjectionMatrix(); }
  }
}
