// Streets (#/streets): the movement spike for a third-person game in a city of the record. One runner, one city at
// walking scale, Rapier for collision, a fixed 60 Hz step for movement (rendered with interpolation), and probes for the
// screenshot script (window.__palimpsestStreets).

import { PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Mesh, type MeshStandardMaterial } from 'three';
import { loadCityRecord, type CityRecord } from '../../three/city/index.ts';
import { layoutOf } from '../../three/city/layout.ts';
import { ThirdPersonCamera } from './camera.ts';
import { Input, PACE, type Controls, type InputEls } from './input.ts';
import { StreetsPhysics, loadRapier, type Ledge } from './physics.ts';
import { ladderNear, type Ladder } from './affordances.ts';
import { loadRunner, type Runner } from './runner.ts';
import { LOT, buildStreets, type Solid, type StreetsCity } from './world.ts';

export interface GameOpts { mobile: boolean; touch: boolean; reducedMotion: boolean }

/** Feel: speeds in m/s, accelerations in m/s², times in seconds. The jump is committed: once the feet leave the
 *  ground the arc is ballistic (how long the button is held no longer changes it), a little heavier coming down than
 *  going up. Before it, a short push on the ground (`takeoff*`), and the push sends the body forward when the stick is
 *  held (`boost*`: a broad jump from a stand), instead of the air accelerating it afterwards. */
export const FEEL = {
  walk: 1.45,
  accel: 26,
  decel: 22,
  skidDecel: 42,
  airAccel: 2.5,
  turnSlow: 14,
  turnFast: 7.5,
  airTurn: 2.6,
  jumpV: 7.4,
  gUp: 22,
  gDown: 34,
  terminal: 42,
  coyote: 0.12,
  buffer: 0.13,
  takeoffMove: 0.05,
  takeoffStand: 0.083,
  boostRun: 3.2,
  boostWalk: 1.45,
  /** The jog between the walk and the run (m/s). */
  jog: 3.4,
};

/** Traversal: heights in metres above the feet, speeds in m/s, times in seconds. */
const MOVE = {
  /** A mantle takes an edge between these heights (waist to head); below it the controller steps up by itself. */
  mantleMin: 0.45, mantleMax: 1.8,
  /** Hands reach this far above the feet in a hang (Hang_Loop), so a jump grabs an edge this high above the feet. */
  reach: 2.05,
  /** The highest edge above the ground below that a runner scrambles up to (house walls; not the city walls). */
  climbMax: 6.3,
  /** Scrambling speed up a wall, and the ladder's up and down. */
  climbV: 3.4, ladderUp: 1.8, ladderDown: 2.3,
  /** How long a pull-up from a hang takes, and the longest a phone or a held key hangs before it. */
  pull: 0.72, hangMin: 0.12,
  /** Water: a wader slows with depth and turns back where it is deeper than this. */
  deep: 0.95,
};

type V2 = { x: number; z: number };
/** A move in which the game carries the body along a path instead of the controller. */
type Trav =
  | { kind: 'mantle'; t: number; dur: number; x0: number; y0: number; z0: number; d0: number; L: Ledge; speed: number }
  | { kind: 'climb'; L: Ledge; y: number }
  | { kind: 'hang'; t: number; L: Ledge }
  | { kind: 'pull'; t: number; L: Ledge }
  | { kind: 'ladder'; lad: Ladder; y: number; on: number; from?: { x: number; y: number; z: number }; top?: boolean }
  | { kind: 'off'; t: number; dur: number; lad: Ladder; x0: number; y0: number; z0: number; top: boolean };

/** A splash in the river, for the sound and the water to answer (the game counts them too). */
export interface Splash { x: number; y: number; z: number; strength: number; kind: 'enter' | 'step' | 'land' | 'turn' }

const smooth = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
/** The speed a pace (0..1, input.ts) asks for: a walk at 0.35, a jog at 0.75, a run from 0.9. */
function paceSpeed(p: number, run: number): number {
  if (p <= PACE.walk) return FEEL.walk * Math.max(0.35, p / PACE.walk);
  if (p <= PACE.jog) return FEEL.walk + (FEEL.jog - FEEL.walk) * ((p - PACE.walk) / (PACE.jog - PACE.walk));
  return FEEL.jog + (run - FEEL.jog) * Math.min(1, (p - PACE.jog) / 0.15);
}
const STEP = 1 / 60;

type Probe = { frame: number[]; cpu: number[]; phys: number[]; skate: number[] };

export class StreetsGame {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 4000);
  readonly cam: ThirdPersonCamera;
  readonly input: Input;
  readonly stats: Probe = { frame: [], cpu: [], phys: [], skate: [] };
  readonly timing: Record<string, number> = {};
  city: StreetsCity | null = null;
  phys: StreetsPhysics | null = null;
  runner: Runner | null = null;
  rec: CityRecord | null = null;
  ready = false;
  private opts: GameOpts;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private t = 0;
  // movement state
  private heading = 0;
  private speed = 0;
  private vy = 0;
  private grounded = true;
  private lastGround = 0;
  private jumpAt = -1;
  private jumped = false;
  /** Seconds of push left before the feet leave the ground (-1: no jump starting). */
  private takeoffT = -1;
  /** The take-off's vertical speed, where the feet left the ground, and the feet's height over the ground below. */
  private vy0 = 0;
  private fromY = 0;
  private clear = Infinity;
  private airT = 0;
  private peakY = 0;
  private prev = new Vector3();
  private curr = new Vector3();
  private animSpeed = 0;
  private yawRate = 0;
  private lastFacing = 0;
  private controlLock = 0;
  /** The view's yaw a held push is read against while the view swings by itself (null: the view's own). */
  private inputYaw: number | null = null;
  /** The move under way (mantle, climb, hang, pull-up, ladder), if any. */
  private trav: Trav | null = null;
  /** Water depth at the feet (m), and the stride phase last step (for splashes at footfalls). */
  private depth = 0;
  private prevDepth = 0;
  /** Turning back from deep water: for `t` seconds the runner heads (x, z), toward the shallows, whatever the stick. */
  private balk = { t: 0, x: 0, z: 0, cool: 0 };
  private lastPhase = 0;
  /** Called on every splash (sound, ripples); `stats.splashes` counts them for the probes. */
  onSplash: ((s: Splash) => void) | null = null;
  readonly counts = { splashes: 0, mantles: 0, grabs: 0, climbs: 0, pulls: 0, ladders: 0, edgeStops: 0, deepTurns: 0, autoJumps: 0 };
  private pilot: Pilot | null = null;
  private runnerHidden = false;
  /** The probes' side camera (filming): square to `heading`, `dist` metres off, at a fixed height. */
  sideView: { heading: number; dist: number; y: number; fov: number; ang?: number } | null = null;
  private w = 1;
  private h = 1;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement, els: Omit<InputEls, 'canvas'>, opts: GameOpts) {
    this.opts = opts;
    const r = new WebGLRenderer({ canvas, antialias: !opts.mobile, powerPreference: 'high-performance', alpha: false });
    r.outputColorSpace = SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    this.dpr = Math.min(window.devicePixelRatio || 1, opts.mobile ? 1.5 : 2);
    r.setPixelRatio(this.dpr);
    this.renderer = r;
    this.cam = new ThirdPersonCamera(opts.reducedMotion);
    // a touch player gets a camera that swings in behind; with reduced motion it never turns by itself
    this.cam.follow = opts.touch && !opts.reducedMotion;
    this.input = new Input({ ...els, canvas });
  }

  /** Load the city's record, Rapier and the runner together; build the world. */
  async load(cityId: string, year: number, onStep?: (what: string) => void) {
    const t0 = performance.now();
    onStep?.('Reading the city from the record…');
    const recP = loadCityRecord(cityId);
    const rapierP = loadRapier().then((R) => { this.timing.rapier = performance.now() - t0; return R; });
    const runnerP = loadRunner().then((r) => { this.timing.runner = performance.now() - t0; return r; });
    const rec = await recP;
    this.timing.record = performance.now() - t0;
    this.rec = rec;
    onStep?.('Laying out the streets…');
    await nextFrame();
    const y = Math.max(rec.start, Math.min(rec.end, year));
    const tb = performance.now();
    const city = buildStreets(this.scene, rec, y, { mobile: this.opts.mobile });
    this.timing.city = performance.now() - tb;
    this.city = city;
    this.scene.add(city.root);
    const [R, runner] = await Promise.all([rapierP, runnerP]);
    onStep?.('Raising the walls…');
    await nextFrame();
    const spawn = this.spawnPoint(city);
    const tp = performance.now();
    this.phys = new StreetsPhysics(R, city, spawn);
    this.timing.physics = performance.now() - tp;
    // settle the spawn on the ground, somewhere clear (a later city's buildings can stand on the square's edge)
    const L = layoutOf(rec);
    const a0 = L.roads[0] ?? 0;
    search: for (const rk of [0.82, 0.7, 0.95, 0.55, 1.1, 1.3]) {
      for (let k = 0; k < 24; k++) {
        const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.26;
        const x = Math.cos(a) * L.plazaR * rk * LOT, z = Math.sin(a) * L.plazaR * rk * LOT;
        const gy = this.phys.groundAt(x, z, 120);
        if (gy === null || gy > 2 || !this.phys.free(x, gy, z)) continue;
        spawn.x = x; spawn.z = z; spawn.y = gy;
        break search;
      }
    }
    // the runner starts at the door of the house of tablets when the world names one, facing the most open way
    const tab = city.affordances.places.find((p) => p.kind === 'tablet-house');
    if (tab) {
      const gy = this.phys.groundAt(tab.pos.x, tab.pos.z, tab.pos.y + 3);
      if (gy !== null && this.phys.free(tab.pos.x, gy + 0.02, tab.pos.z)) {
        let best = spawn.facing, bd = -1;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const d = this.phys.rayFlat(tab.pos.x, gy + 1.2, tab.pos.z, Math.sin(a), Math.cos(a), 40);
          if (d > bd) { bd = d; best = a; }
        }
        spawn.x = tab.pos.x; spawn.z = tab.pos.z; spawn.y = gy; spawn.facing = best;
      }
    }
    this.phys.teleport(spawn.x, spawn.y + 0.05, spawn.z);
    this.runner = runner;
    this.scene.add(runner.object);
    this.heading = spawn.facing;
    this.lastFacing = spawn.facing;
    this.cam.yaw = spawn.facing;
    const f = this.phys.feet();
    this.curr.set(f.x, f.y, f.z);
    this.prev.copy(this.curr);
    runner.object.position.copy(this.curr);
    runner.object.rotation.y = this.heading;
    this.timing.total = performance.now() - t0;
    this.ready = true;
  }

  /** On the temple square's edge, facing out along the first main road. */
  private spawnPoint(city: StreetsCity): { x: number; y: number; z: number; facing: number } {
    const L = layoutOf(city.rec);
    const a = L.roads[0] ?? 0;
    const r = L.plazaR * 0.82 * LOT;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    return { x, y: city.heightAt(x, z), z, facing: Math.atan2(Math.cos(a), Math.sin(a)) };
  }

  resize(w: number, h: number) {
    this.w = Math.max(1, w); this.h = Math.max(1, h);
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.cam.fit(this.camera.aspect);
  }

  start() {
    if (this.raf) return;
    this.last = 0;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }

  private push(a: number[], v: number) { a.push(v); if (a.length > 6000) a.shift(); }

  private frame(now: number) {
    if (!this.ready || !this.phys || !this.runner || !this.city) return;
    const c0 = performance.now();
    const dtRaw = this.last ? (now - this.last) / 1000 : STEP;
    if (this.last) this.push(this.stats.frame, now - this.last);
    this.last = now;
    const dt = Math.min(0.1, dtRaw);
    // look
    const [lx, ly] = this.input.takeLook();
    if (lx || ly) this.cam.turn(lx, ly);
    // fixed steps
    this.acc += dt;
    let steps = 0;
    const p0 = performance.now();
    while (this.acc >= STEP && steps < 5) {
      this.prev.copy(this.curr);
      this.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === 5) this.acc = 0;
    this.push(this.stats.phys, performance.now() - p0);
    this.present(dt, this.acc / STEP, now / 1000);
    this.push(this.stats.cpu, performance.now() - c0);
  }

  /** Draw a frame: the runner between the last two steps (alpha), its animation, the camera, the sun, the render. */
  private present(dt: number, alpha: number, clock: number) {
    if (!this.phys || !this.runner || !this.city) return;
    const runner = this.runner;
    runner.object.position.lerpVectors(this.prev, this.curr, alpha);
    // face where it runs
    if (this.speed > 0.2 || this.animSpeed > 0.2) {
      let d = this.heading - this.lastFacing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const k = 1 - Math.exp(-dt * (this.grounded ? 18 : 6));
      this.lastFacing += d * k;
      this.yawRate = (d * k) / Math.max(1e-3, dt);
    } else this.yawRate *= 0.8;
    runner.object.rotation.y = this.lastFacing;
    runner.update(dt, {
      speed: this.animSpeed, grounded: this.grounded, vy: this.vy, air: this.airT, turn: this.yawRate,
      arc: { vy0: this.vy0, gUp: FEEL.gUp, gDown: FEEL.gDown, clear: this.clear, below: this.fromY - this.curr.y },
    });
    // foot skate: how far the ground speed the feet show is from how fast the runner really goes (m/s)
    const foot = runner.footSpeed();
    if (foot !== null && this.grounded && this.animSpeed > 0.5) this.push(this.stats.skate, Math.abs(foot - this.animSpeed));

    // the camera
    const o = runner.object.position;
    const ctl = this.input.controls();
    this.cam.update(this.camera, dt, {
      x: o.x, y: o.y, z: o.z, speed: this.animSpeed, runSpeed: this.runSpeed(), grounded: this.grounded,
      phase: runner.phase, facing: this.lastFacing, moving: (this.speed > 0.5 || !!this.trav) && (!!this.pilot || Math.hypot(ctl.mx, ctl.my) > 0.1),
      climbing: !!this.trav && this.trav.kind !== 'mantle',
      offset: this.wallOut(),
    }, (a, b) => this.phys!.sweep(a, b), this.input.lastLook);
    const hide = this.cam.dist < 0.6;
    if (hide !== this.runnerHidden) { this.runnerHidden = hide; runner.model.visible = !hide; }

    // the sun's shadow follows the runner (snapped to its texels so it does not shimmer)
    const sun = this.city.sun;
    const R = sun.shadow.camera.right;
    const texel = (2 * R) / sun.shadow.mapSize.x;
    const sx = Math.round(o.x / texel) * texel, sz = Math.round(o.z / texel) * texel;
    sun.position.set(sx - 38, o.y + 62, sz + 26);
    sun.target.position.set(sx, o.y, sz);
    sun.target.updateMatrixWorld();

    if (this.sideView) {
      // the probes' side view: square to the run, at a fixed height, so the body is seen to rise and fall
      const s = this.sideView, h = s.heading, cam = this.camera, a = s.ang ?? 0;
      // off the runner's right, swung back by `ang` (so a wall it faces is not edge-on between them)
      const ox = -Math.cos(h) * Math.cos(a) - Math.sin(h) * Math.sin(a), oz = Math.sin(h) * Math.cos(a) - Math.cos(h) * Math.sin(a);
      cam.position.set(o.x + ox * s.dist, s.y, o.z + oz * s.dist);
      cam.lookAt(o.x, s.y, o.z);
      if (Math.abs(cam.fov - s.fov) > 0.01) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
    }

    void clock; // (the world updates its own smoke, before each render)
    this.renderer.render(this.scene, this.camera);
  }

  runSpeed(): number {
    const g = this.runner?.gaits.run.speed ?? 6;
    return Math.max(4.5, Math.min(7.5, g));
  }

  private step(dt: number) {
    const phys = this.phys!, runner = this.runner!;
    this.t += dt;
    let ctl: Controls = this.input.controls();
    if (this.pilot) ctl = this.pilot.controls(this, dt);
    const jumps = this.input.takeJumps() + (this.pilot?.takeJump() ?? 0);
    if (jumps > 0) this.jumpAt = this.t;

    // wished direction in the world, from the camera's yaw (or the pilot's own heading); while the view swings round by
    // itself (onto a ladder), a held push keeps meaning what it meant when it began, until it is let go
    if (Math.hypot(ctl.mx, ctl.my) < 0.2) this.inputYaw = null;
    const [fx, fz] = this.pilot ? [Math.sin(this.pilot.yaw), Math.cos(this.pilot.yaw)]
      : this.inputYaw !== null ? [Math.sin(this.inputYaw), Math.cos(this.inputYaw)] : this.cam.forward();
    const rx = -fz, rz = fx;
    let wx = fx * ctl.my + rx * ctl.mx, wz = fz * ctl.my + rz * ctl.mx;
    const wl = Math.hypot(wx, wz);
    let mag = Math.min(1, wl);
    if (wl > 1e-3) { wx /= wl; wz /= wl; }
    const run = this.runSpeed();
    const pace = ctl.pace ?? (ctl.run ? PACE.run : PACE.walk);
    let target = mag < 0.05 ? 0 : paceSpeed(pace, run);
    if (this.controlLock > 0) { this.controlLock -= dt; target = Math.min(target, 0.4); }
    // wading: slower the deeper it is
    const aff = this.city!.affordances;
    this.depth = this.grounded ? aff.waterDepthAt(this.curr.x, this.curr.z) : 0;
    if (this.depth > 0.12) target *= Math.max(0.35, 1 - this.depth * 0.75);
    if (this.depth > MOVE.deep + 0.05 && !this.trav) {
      // in over the waist (jumped in): wade back toward the nearest shallows, whatever the stick says
      let best = 0, bd = Infinity;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2, d = aff.waterDepthAt(this.curr.x + Math.sin(a) * 2, this.curr.z + Math.cos(a) * 2);
        if (d < bd) { bd = d; best = a; }
      }
      wx = Math.sin(best); wz = Math.cos(best); mag = 1; target = 1.1;
    }

    this.balk.cool -= dt;
    if (this.balk.t > 0) { this.balk.t -= dt; wx = this.balk.x; wz = this.balk.z; mag = 1; target = Math.min(target, 1.1); }

    // a move under way carries the body itself
    if (this.trav) { this.stepTrav(dt, ctl, wx, wz, mag, jumps > 0); return; }
    // or one starts: a ladder, a mantle, a grab or a climb
    if (this.startTrav(wx, wz, mag, target)) return;

    if (runner.rolling) {
      // the roll carries the runner on, straight
      this.speed = Math.max(this.speed, Math.min(run, 4.8));
    } else if (this.grounded) {
      if (mag > 0.05) {
        let d = Math.atan2(wx, wz) - this.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        if (Math.abs(d) > 2.5 && this.speed > 3) {
          // a reversal at speed: brake hard, then turn
          this.speed = Math.max(0, this.speed - FEEL.skidDecel * dt);
          if (this.speed < 2) this.heading += d;
        } else if (this.speed < 0.3) {
          this.heading += d; // from a standstill: set off the way the stick points (the body turns to follow)
        } else {
          const rate = FEEL.turnSlow + (FEEL.turnFast - FEEL.turnSlow) * Math.min(1, this.speed / run);
          this.heading += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
        }
      }
      const ds = target - this.speed;
      this.speed += ds > 0 ? Math.min(ds, FEEL.accel * dt) : Math.max(ds, -FEEL.decel * dt);
    } else {
      // a little steering in the air
      if (mag > 0.05) {
        let d = Math.atan2(wx, wz) - this.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.heading += Math.sign(d) * Math.min(Math.abs(d), FEEL.airTurn * dt);
      }
      const ds = target - this.speed;
      if (ds > 0) this.speed += Math.min(ds, FEEL.airAccel * dt);
      else if (mag < 0.05) this.speed += Math.max(ds, -FEEL.airAccel * 0.5 * dt);
    }

    // jump: buffered presses, a little grace after leaving an edge. On the ground it starts with a short push (the
    // runner keeps moving through it); just after an edge there is nothing to push from, so it leaves at once.
    const launch = () => {
      this.takeoffT = -1;
      this.vy = FEEL.jumpV;
      this.vy0 = FEEL.jumpV;
      this.jumped = true;
      this.grounded = false;
      this.airT = 0;
      this.peakY = this.curr.y;
      this.fromY = this.curr.y;
      // the push carries the body the way the stick points (a broad jump from a stand); the air adds little after
      if (mag > 0.3) this.speed = Math.max(this.speed, Math.min(target, ctl.run ? FEEL.boostRun : FEEL.boostWalk));
      runner.launch();
    };
    if (this.takeoffT >= 0) {
      this.takeoffT -= dt;
      if (this.takeoffT <= 1e-6 || !this.grounded) launch();
    }
    const canJump = !this.jumped && this.takeoffT < 0 && (this.grounded || this.t - this.lastGround < FEEL.coyote) && !runner.rolling;
    if (this.jumpAt >= 0 && this.t - this.jumpAt <= FEEL.buffer && canJump) {
      this.jumpAt = -1;
      const moving = this.speed > 1.2 || mag > 0.3;
      runner.takeoff(moving);
      if (this.grounded) this.takeoffT = moving ? FEEL.takeoffMove : FEEL.takeoffStand;
      else launch();
    }
    // gravity: the same arc whatever the button does, a little heavier coming down
    if (!this.grounded) {
      const g = this.vy > 0 ? FEEL.gUp : FEEL.gDown;
      this.vy = Math.max(-FEEL.terminal, this.vy - g * dt);
    } else this.vy = 0; // on the ground the controller's snap holds the feet down (a push down would drag on stairs)

    let hx = Math.sin(this.heading) * this.speed, hz = Math.cos(this.heading) * this.speed;
    if (this.grounded && this.speed > 0.05 && this.takeoffT < 0 && !runner.rolling) {
      [hx, hz] = this.guardEdges(hx, hz, target);
    }
    const r = phys.move(hx * dt, this.vy * dt, hz * dt);
    const f = phys.feet();
    this.curr.set(f.x, f.y, f.z);
    const real = Math.hypot(r.dx, r.dz) / dt;
    // pushing into a wall: the run slows to the slide along it, so the feet keep matching the ground
    if (r.hitWall && real < this.speed) this.speed = Math.max(real, this.speed - FEEL.decel * dt * 2);
    this.animSpeed += (Math.min(real, this.speed + 0.5) - this.animSpeed) * (1 - Math.exp(-dt * 14));
    if (r.hitCeiling && this.vy > 0) this.vy = 0;

    // in the air, how high the feet are over the ground straight below (for the flight's reach for the landing)
    if (!r.grounded || this.vy > 0) {
      const gy = phys.groundAt(f.x, f.z, f.y + 0.02);
      this.clear = gy === null ? Infinity : f.y - gy;
    } else this.clear = 0;

    const was = this.grounded;
    const nowGround = r.grounded && this.vy <= 0.01;
    if (nowGround) {
      if (!was) {
        const drop = Math.max(0, this.peakY - f.y);
        const dep = aff.waterDepthAt(f.x, f.z);
        if (dep > 0.08) this.splash(f.x, f.y + dep, f.z, Math.min(1, 0.3 + drop * 0.25 + dep * 0.3), 'land');
        runner.land(this.airT, drop, this.speed);
        this.cam.land(drop);
        if (runner.pose === 'land' && drop > 2.5) this.controlLock = 0.25;
      }
      if (was && this.depth > 0.12) {
        // a footfall in the water: twice a stride, and once on wading in
        const ph = runner.phase, fall = (this.lastPhase < 0.5 && ph >= 0.5) || ph < this.lastPhase;
        if (fall && this.animSpeed > 0.3) this.splash(f.x, f.y + this.depth, f.z, Math.min(1, 0.2 + this.animSpeed * 0.12 + this.depth * 0.4), 'step');
      }
      if (was && this.depth > 0.12 && this.prevDepth <= 0.12) this.splash(f.x, f.y + this.depth, f.z, 0.5, 'enter');
      this.prevDepth = this.depth;
      this.lastPhase = runner.phase;
      this.grounded = true;
      this.lastGround = this.t;
      this.jumped = false;
      this.airT = 0;
      this.peakY = f.y;
    } else {
      if (was && this.vy <= 0) { this.vy = 0; this.peakY = f.y; this.fromY = f.y; this.vy0 = 0; }
      this.grounded = false;
      this.airT += dt;
      this.peakY = Math.max(this.peakY, f.y);
    }
  }

  // ------------------------------------------------------------------ traversal
  /** Which way the runner means to go: the stick's way when pushed, else where it is heading if it is moving. */
  private intent(wx: number, wz: number, mag: number): V2 | null {
    if (mag > 0.3) return { x: wx, z: wz };
    if (this.speed > 0.6) return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
    return null;
  }

  private splash(x: number, y: number, z: number, strength: number, kind: Splash['kind']) {
    this.counts.splashes++;
    this.onSplash?.({ x, y, z, strength, kind });
  }

  /** The ground below (x, z) from just above the feet (null over nothing within 30 m). */
  private below(x: number, z: number, y: number): number | null { return this.phys!.groundAt(x, z, y + 0.5); }

  /**
   * On the ground, before moving: a walker (not a jogger or runner) stops at a roof's edge, sliding along it if it can;
   * nobody walks into water deeper than MOVE.deep (the runner turns back); and on a phone a runner reaching an edge
   * jumps it when there is somewhere to land. Returns the displacement rate to use.
   */
  private guardEdges(hx: number, hz: number, target: number): [number, number] {
    const f = this.curr, aff = this.city!.affordances, phys = this.phys!;
    const sp = Math.hypot(hx, hz), dx = hx / sp, dz = hz / sp;
    // the edge-stop is for a walker: someone asking to walk (not jog or run) and going at a walk
    const walking = target <= 2.3 && this.speed < 2.3;
    const bad = (x: number, z: number) => {
      const ahead = 0.42;
      const px = f.x + x * ahead, pz = f.z + z * ahead;
      if (walking) {
        const g = this.below(px, pz, f.y);
        if (g === null || f.y - g > 0.7) return 'edge';
      }
      const d = aff.waterDepthAt(px, pz);
      if (d > MOVE.deep && d > this.depth + 0.02) return 'deep';
      return null;
    };
    // a phone's runner jumps an edge it meets at speed, if a landing about as high is in reach (the next roof across a
    // gap, not the street below the side of a stair)
    if (this.opts.touch && this.speed > 4 && !this.jumped && this.jumpAt < 0) {
      const g = this.below(f.x + dx * 0.55, f.z + dz * 0.55, f.y);
      if (g === null || f.y - g > 0.9) {
        for (const d of [1.6, 2.4, 3.2, 3.8]) {
          const l = this.below(f.x + dx * d, f.z + dz * d, f.y + 0.7);
          if (l !== null && l > f.y - 1.2 && l < f.y + 0.9) { this.jumpAt = this.t; this.counts.autoJumps++; break; }
        }
      }
    }
    const why = bad(dx, dz);
    if (!why) return [hx, hz];
    // slide along: the nearest heading that is not over the edge or into the deep, with the speed it keeps
    for (const a of [0.45, -0.45, 0.9, -0.9]) {
      const c = Math.cos(a), s2 = Math.sin(a);
      const ex = dx * c - dz * s2, ez = dx * s2 + dz * c;
      if (!bad(ex, ez)) return [ex * sp * Math.cos(a), ez * sp * Math.cos(a)];
    }
    if (why === 'deep') {
      // turn back from the deep: once per approach, face the shallows and wade a few steps back toward them
      if (this.balk.cool <= 0) {
        let best = this.heading, bd = Infinity;
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2, d = aff.waterDepthAt(f.x + Math.sin(a) * 1.5, f.z + Math.cos(a) * 1.5);
          if (d < bd) { bd = d; best = a; }
        }
        this.balk = { t: 0.7, x: Math.sin(best), z: Math.cos(best), cool: 1.6 };
        this.counts.deepTurns++;
        this.splash(f.x, f.y + this.depth, f.z, 0.35, 'turn');
      }
    } else if (this.speed > 0.3) this.counts.edgeStops++;
    this.speed = 0;
    void phys;
    return [0, 0];
  }

  /** Start a move if the runner meets one: a ladder it walks into (from the street or the roof), a mantle over an
   *  edge waist- to head-high, a grab of an edge within the hands' reach in the air, or a scramble up a wall too high
   *  for that. Desktop mantles when running into an edge or jumping at it; phones whenever pushing into it. */
  private startTrav(wx: number, wz: number, mag: number, target: number): boolean {
    const phys = this.phys!, runner = this.runner!, f = this.curr, aff = this.city!.affordances;
    if (runner.rolling || this.takeoffT >= 0) return false;
    const want = this.intent(wx, wz, mag);
    const jumpNow = this.jumpAt >= 0 && this.t - this.jumpAt <= FEEL.buffer;
    if (this.grounded && want) {
      // a ladder: walking at its foot toward the wall, or at its top out over the edge
      const lad = ladderNear(aff, f.x, f.y, f.z, 0.9);
      if (lad && want.x * -lad.facing.x + want.z * -lad.facing.z > 0.55) { this.mountLadder(lad, false); return true; }
      for (const l of aff.ladders) {
        if (Math.abs(l.top.y - f.y) > 0.6 || Math.hypot(l.top.x - f.x, l.top.z - f.z) > 0.8) continue;
        if (want.x * l.facing.x + want.z * l.facing.z > 0.55) { this.mountLadder(l, true); return true; }
      }
      // a mantle: a moving runner meeting an edge waist- to head-high goes over it
      const L = phys.ledge(f.x, f.y, f.z, want.x, want.z, 0.85, MOVE.mantleMin, MOVE.mantleMax);
      if (L && (this.speed > 0.4 || jumpNow || this.opts.touch)) {
        this.jumpAt = -1;
        this.startMantle(L, target);
        return true;
      }
      // a phone's runner going at a wall too high to mantle jumps at it (and the air below grabs or climbs it)
      if (this.opts.touch && this.speed > 2.5 && !jumpNow && !this.jumped) {
        const H = phys.ledge(f.x, f.y, f.z, want.x, want.z, 1.2, MOVE.mantleMax, MOVE.climbMax);
        if (H) { this.jumpAt = this.t; this.counts.autoJumps++; }
      }
      return false;
    }
    if (!this.grounded && this.airT > 0.04) {
      const dir = want ?? { x: Math.sin(this.heading), z: Math.cos(this.heading) };
      const L = phys.ledge(f.x, f.y, f.z, dir.x, dir.z, 0.75, 0.3, MOVE.climbMax);
      if (!L) return false;
      const ground = this.below(f.x, f.z, f.y) ?? f.y;
      if (L.top - ground > MOVE.climbMax) return false;
      if (L.up <= 1.15 && this.vy < 4) { this.startMantle(L, Math.max(this.speed, 2)); return true; }
      if (L.up <= MOVE.reach + 0.08) { this.startHang(L); return true; }
      if (this.vy > -3) { this.trav = { kind: 'climb', L, y: f.y }; this.counts.climbs++; this.faceWall(L); runner.climb(2.6); return true; }
    }
    return false;
  }

  private faceWall(L: { nx: number; nz: number }) {
    this.heading = Math.atan2(-L.nx, -L.nz);
    this.lastFacing = this.heading;
  }

  private startMantle(L: Ledge, speed: number) {
    const f = this.curr;
    const dur = Math.max(0.45, Math.min(0.68, 0.42 + 0.14 * L.up));
    this.trav = { kind: 'mantle', t: 0, dur, x0: f.x, y0: f.y, z0: f.z, d0: Math.max(0.3, L.dist), L, speed: Math.min(speed, this.runSpeed()) };
    this.counts.mantles++;
    this.faceWall(L);
    this.runner!.mantle(dur);
  }

  private startHang(L: Ledge) {
    this.trav = { kind: 'hang', t: 0, L };
    this.counts.grabs++;
    this.faceWall(L);
    this.runner!.hang();
  }

  private mountLadder(lad: Ladder, fromTop: boolean) {
    const f = this.curr;
    this.counts.ladders++;
    // coming over the top, the view swings round to look at the wall the runner is going down (not out over the street);
    // the push that brought the runner here keeps taking it down until it is let go
    if (fromTop) { this.inputYaw = this.cam.yaw; this.cam.swingTo(Math.atan2(-lad.facing.x, -lad.facing.z) + 0.35); }
    this.heading = Math.atan2(-lad.facing.x, -lad.facing.z);
    const g = this.ladderLine(lad);
    const y = fromTop ? g.hi : g.lo;
    this.trav = { kind: 'ladder', lad, y, on: 0, from: { x: f.x, y: f.y, z: f.z }, top: fromTop };
    this.runner!.ladder(0);
  }

  /** Where the feet are on a ladder at height y: on the line of its rungs (from the foot, out from the wall, up to the
   *  top at the wall), a little out from them; the lowest and highest heights the feet climb between. */
  private ladderLine(lad: Ladder) {
    const n = lad.facing;
    const F = { x: lad.base.x - n.x * 0.45, y: lad.base.y, z: lad.base.z - n.z * 0.45 }; // the ladder's foot
    const W = { x: lad.top.x + n.x * 0.45, y: lad.top.y, z: lad.top.z + n.z * 0.45 }; // where it meets the wall's top
    const at = (y: number) => {
      const k = (y - F.y) / Math.max(0.5, W.y - F.y);
      return { x: F.x + (W.x - F.x) * k + n.x * 0.2, y, z: F.z + (W.z - F.z) * k + n.z * 0.2 };
    };
    return { at, lo: F.y + 0.12, hi: W.y - 1.0, W };
  }

  /** One step of the move under way. */
  private stepTrav(dt: number, ctl: Controls, wx: number, wz: number, mag: number, jumped: boolean) {
    const tr = this.trav!, phys = this.phys!, runner = this.runner!;
    const put = (x: number, y: number, z: number) => { phys.place(x, y, z); this.curr.set(x, y, z); };
    const done = (speed: number) => {
      this.trav = null;
      this.grounded = true; this.vy = 0; this.airT = 0; this.jumped = false; this.lastGround = this.t;
      this.speed = speed; this.animSpeed = speed;
      this.peakY = this.curr.y; this.fromY = this.curr.y;
      runner.endTraverse(speed);
    };
    this.grounded = true; this.vy = 0; this.airT = 0; this.clear = 0;
    this.animSpeed *= 0.8;
    const toward = (L: { nx: number; nz: number }) => mag > 0.3 && wx * -L.nx + wz * -L.nz > 0.3;
    const away = (L: { nx: number; nz: number }) => mag > 0.3 && wx * L.nx + wz * L.nz > 0.5;
    const wallPoint = (L: Ledge, out: number) => ({ x: L.fx + L.nx * out, z: L.fz + L.nz * out });
    switch (tr.kind) {
      case 'mantle': {
        // hands to the edge, body up and over, feet onto the top: a path keyed to Climb Up's frames
        tr.t += dt;
        const u = tr.t / tr.dur, L = tr.L;
        const lowY = Math.max(tr.y0, L.top - 0.8);
        // (the hands plant on the edge at about a fifth of the way and stay there through the tuck; the knees come onto
        // the top as the body passes over it)
        const keys = [
          { u: 0, y: tr.y0, out: tr.d0 }, { u: 0.22, y: lowY, out: 0.34 }, { u: 0.45, y: Math.max(lowY, L.top - 0.62), out: 0.12 },
          { u: 0.68, y: L.top - 0.08, out: -0.2 }, { u: 0.85, y: L.top + 0.02, out: -0.36 },
          { u: 1, y: L.sy + 0.02, out: -Math.hypot(L.sx - L.fx, L.sz - L.fz) },
        ];
        let i = 0;
        while (i < keys.length - 2 && keys[i + 1].u < u) i++;
        const a = keys[i], b = keys[i + 1], k = smooth((u - a.u) / (b.u - a.u));
        const out = a.out + (b.out - a.out) * k, y = a.y + (b.y - a.y) * k;
        // the start is wherever the runner was: blend from it to the wall's line over the first stretch
        const w = wallPoint(L, out), s0 = smooth(u / 0.22);
        put(tr.x0 + (w.x - tr.x0) * s0, y, tr.z0 + (w.z - tr.z0) * s0);
        if (u >= 1) done(mag > 0.3 ? Math.min(tr.speed, 4.5) : 0);
        break;
      }
      case 'climb': {
        // up the wall at a scramble, until the hands are at the edge
        const L = tr.L;
        if (away(L) || jumped) { this.letGo(L, 1.5); break; }
        tr.y = Math.min(L.top - MOVE.reach, tr.y + MOVE.climbV * dt);
        const w = wallPoint(L, 0.26);
        put(w.x, tr.y, w.z);
        runner.climb(MOVE.climbV / 1.15);
        if (tr.y >= L.top - MOVE.reach - 1e-3) {
          // climbing on up toward the wall: straight into the pull-up; otherwise hang there
          this.startHang(L);
          if (mag > 0.3 && wx * -L.nx + wz * -L.nz > 0.3) { this.trav = { kind: 'pull', t: 0, L }; this.counts.pulls++; runner.pull(MOVE.pull); }
        }
        break;
      }
      case 'hang': {
        tr.t += dt;
        const L = tr.L, w = wallPoint(L, 0.15);
        put(w.x, L.top - MOVE.reach, w.z);
        if (away(tr.L)) { this.letGo(L, 0.5); break; }
        // up: on a phone or with the stick toward the wall after a beat; at once on a jump
        if (jumped || (tr.t > MOVE.hangMin && (toward(L) || (this.opts.touch && mag < 0.3)))) {
          this.trav = { kind: 'pull', t: 0, L };
          this.counts.pulls++;
          runner.pull(MOVE.pull);
        }
        break;
      }
      case 'pull': {
        tr.t += dt;
        const u = tr.t / MOVE.pull, L = tr.L;
        const standOut = -Math.hypot(L.sx - L.fx, L.sz - L.fz);
        const keys = [
          { u: 0, y: L.top - MOVE.reach, out: 0.15 }, { u: 0.34, y: L.top - 1.45, out: 0.13 }, { u: 0.6, y: L.top - 0.68, out: -0.12 },
          { u: 0.8, y: L.top - 0.1, out: -0.32 }, { u: 1, y: L.sy + 0.02, out: standOut },
        ];
        let i = 0;
        while (i < keys.length - 2 && keys[i + 1].u < u) i++;
        const a = keys[i], b = keys[i + 1], k = smooth((u - a.u) / (b.u - a.u));
        const w = wallPoint(L, a.out + (b.out - a.out) * k);
        put(w.x, a.y + (b.y - a.y) * k, w.z);
        if (u >= 1) done(0);
        break;
      }
      case 'ladder': {
        const g = this.ladderLine(tr.lad), n = tr.lad.facing;
        this.heading = Math.atan2(-n.x, -n.z);
        // stepping on (from the street or over the top): ease from where the feet were onto the line
        if (tr.on < 1 && tr.from) {
          tr.on = Math.min(1, tr.on + dt / (tr.top ? 0.45 : 0.22));
          const p = g.at(tr.y), k = smooth(tr.on);
          const lift = tr.top ? Math.sin(k * Math.PI) * 0.25 : 0;
          put(tr.from.x + (p.x - tr.from.x) * k, tr.from.y + (p.y - tr.from.y) * k + lift, tr.from.z + (p.z - tr.from.z) * k);
          runner.ladder(tr.top ? -1.2 : 1.2);
          break;
        }
        // up with the stick (or W) up, down with it down, whichever way the view looks; coming over the top, the push
        // that walked the runner off the roof takes it on down until it is let go; a jump lets go
        if (jumped) { this.trav = null; this.leaveLadder(tr.lad); break; }
        const fwd = this.inputYaw !== null ? (mag > 0.2 ? (wx * -n.x + wz * -n.z) * mag : 0) : ctl.my;
        const v = fwd > 0.2 ? MOVE.ladderUp * Math.min(1, fwd / 0.8) : fwd < -0.2 ? -MOVE.ladderDown * Math.min(1, -fwd / 0.8) : 0;
        tr.y = Math.max(g.lo, Math.min(g.hi, tr.y + v * dt));
        const p = g.at(tr.y);
        put(p.x, p.y, p.z);
        runner.ladder(v / 0.75);
        if (v > 0 && tr.y >= g.hi - 1e-3) {
          const c = this.curr;
          this.trav = { kind: 'off', t: 0, dur: 0.55, lad: tr.lad, x0: c.x, y0: c.y, z0: c.z, top: true };
          runner.mantle(0.55);
        } else if (v < 0 && tr.y <= g.lo + 1e-3) {
          const c = this.curr;
          this.trav = { kind: 'off', t: 0, dur: 0.2, lad: tr.lad, x0: c.x, y0: c.y, z0: c.z, top: false };
        }
        break;
      }
      case 'off': {
        // over the top onto the roof, or a step back off the bottom rung into the street
        tr.t += dt;
        const u = Math.min(1, tr.t / tr.dur), to = tr.top ? tr.lad.top : tr.lad.base;
        const g = this.ladderLine(tr.lad);
        if (tr.top) {
          const ky = smooth(u / 0.6), kx = smooth((u - 0.3) / 0.7);
          const W = g.W;
          const mx = tr.x0 + (W.x - tr.x0) * smooth(u / 0.5), mz = tr.z0 + (W.z - tr.z0) * smooth(u / 0.5);
          put(mx + (to.x - mx) * kx, tr.y0 + (to.y + 0.02 - tr.y0) * ky, mz + (to.z - mz) * kx);
        } else {
          const k = smooth(u);
          put(tr.x0 + (to.x - tr.x0) * k, tr.y0 + (to.y + 0.02 - tr.y0) * k, tr.z0 + (to.z - tr.z0) * k);
        }
        if (u >= 1) {
          if (!tr.top) this.heading = Math.atan2(tr.lad.facing.x, tr.lad.facing.z);
          done(0);
        }
        break;
      }
    }
  }

  /** Out from the wall or ladder the runner is on (for the camera), eased in and out. */
  private wallOff = { x: 0, z: 0 };
  private wallOut(): { x: number; z: number } {
    const tr = this.trav;
    let x = 0, z = 0;
    if (tr && (tr.kind === 'climb' || tr.kind === 'hang' || tr.kind === 'pull')) { x = tr.L.nx * 0.6; z = tr.L.nz * 0.6; }
    else if (tr && (tr.kind === 'ladder' || tr.kind === 'off')) { x = tr.lad.facing.x * 0.6; z = tr.lad.facing.z * 0.6; }
    this.wallOff.x += (x - this.wallOff.x) * 0.2; this.wallOff.z += (z - this.wallOff.z) * 0.2;
    return this.wallOff;
  }

  /** Let go of a wall or an edge: drop straight down, pushed off a little. */
  private letGo(L: { nx: number; nz: number }, push: number) {
    this.trav = null;
    this.grounded = false; this.vy = 0; this.vy0 = 0; this.airT = 0.3; this.jumped = true;
    this.heading = Math.atan2(L.nx, L.nz);
    this.speed = push;
    this.fromY = this.curr.y; this.peakY = this.curr.y;
    this.runner!.endTraverse(0);
  }

  /** Jump off a ladder, back from it. */
  private leaveLadder(lad: Ladder) {
    this.grounded = false; this.vy = 3; this.vy0 = 3; this.airT = 0.05; this.jumped = true;
    this.heading = Math.atan2(lad.facing.x, lad.facing.z);
    this.speed = 1.8;
    this.fromY = this.curr.y; this.peakY = this.curr.y;
    this.runner!.endTraverse(0);
  }

  // ------------------------------------------------------------------ probes for the screenshot script
  info() {
    const ri = this.renderer.info;
    const f = this.phys?.feet();
    return {
      calls: ri.render.calls, triangles: ri.render.triangles, geometries: ri.memory.geometries, textures: ri.memory.textures,
      physics: this.phys?.counts, gaits: this.runner?.gaits, pose: this.runner?.pose, speed: this.animSpeed, grounded: this.grounded,
      trav: this.trav?.kind ?? null, depth: this.depth, moves: { ...this.counts },
      feet: f, cam: { ...this.cam.last, yaw: this.cam.yaw, pitch: this.cam.pitch, fov: this.camera.fov, y: this.camera.position.y }, dpr: this.dpr, size: [this.w, this.h],
      timing: this.timing, city: this.rec ? { id: this.rec.id, name: this.city?.name, year: this.city?.cy.year, P: this.city?.P, solids: this.city?.solids.length } : null,
    };
  }

  /** Filming for the probes: stop the loop, so frames are drawn only by `advance` (deterministic, frame-rate free). */
  film(on: boolean) {
    if (on) { this.stop(); this.acc = 0; } else { this.sideView = null; this.input.virtual = null; this.last = 0; this.start(); }
  }

  /** Run whole fixed steps for `seconds` with these controls (and a jump press first, if asked), then draw one frame. */
  advance(seconds: number, ctl: Controls | null, jump = false) {
    const n = Math.max(1, Math.round(seconds / STEP));
    this.input.virtual = ctl;
    if (jump) this.input.jumps++;
    for (let i = 0; i < n; i++) { this.prev.copy(this.curr); this.step(STEP); }
    this.acc = 0;
    this.present(n * STEP, 1, this.t);
    const f = this.phys!.feet();
    return { t: this.t, y: f.y, x: f.x, z: f.z, grounded: this.grounded, pose: this.runner!.pose, vy: this.vy, speed: this.speed, pelvis: this.runner!.pelvisHeight() };
  }

  /** Where the runner's head, pelvis and feet are on screen (CSS pixels), for cropping the probes' frames. */
  screenBox(): { x0: number; y0: number; x1: number; y1: number } {
    const r = this.runner!, c = this.camera;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    r.object.updateMatrixWorld(true);
    for (const n of ['Head', 'pelvis', 'foot_l', 'foot_r', 'ball_l', 'ball_r', 'hand_l', 'hand_r']) {
      const o = r.model.getObjectByName(n);
      if (!o) continue;
      const v = o.getWorldPosition(new Vector3()).project(c);
      const x = (v.x * 0.5 + 0.5) * this.w, y = (-v.y * 0.5 + 0.5) * this.h;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { x0, y0, x1, y1 };
  }

  /** Home for the probes: on the temple square's edge, facing out along the first main road, at a stand. */
  home() {
    const L = layoutOf(this.city!.rec);
    const a = L.roads[0] ?? 0;
    const facing = Math.atan2(Math.cos(a), Math.sin(a));
    const r0 = L.plazaR * 0.82 * LOT;
    this.stopDriving();
    this.teleport(Math.cos(a) * r0, Math.sin(a) * r0, facing);
    this.cam.yaw = facing; this.cam.pitch = 0.18;
    this.grounded = true;
    return { facing };
  }

  /** Forget any move, push, turn-back or lock (the runner is being put somewhere); whatever its body was doing (a roll,
   *  a landing) ends there. */
  private resetMoves() {
    this.trav = null; this.takeoffT = -1; this.jumped = false; this.grounded = true; this.balk.t = 0; this.inputYaw = null;
    this.controlLock = 0; this.jumpAt = -1;
    this.cam.stopSwing();
    this.runner?.endTraverse(0);
  }

  /** Steer by script: a list of waypoints (metres), each walked or run, with jumps. */
  drive(points: Waypoint[], loop = true) { this.pilot = new Pilot(points, loop); this.cam.follow = true; }
  stopDriving() { this.pilot = null; this.cam.follow = this.opts.touch && !this.opts.reducedMotion; }
  teleport(x: number, z: number, facing?: number) {
    this.resetMoves();
    const gy = this.phys!.groundAt(x, z, 80) ?? 0;
    this.phys!.teleport(x, gy + 0.05, z);
    const f = this.phys!.feet();
    this.curr.set(f.x, f.y, f.z); this.prev.copy(this.curr);
    this.speed = 0; this.vy = 0; this.animSpeed = 0;
    if (facing !== undefined) { this.heading = facing; this.lastFacing = facing; }
  }

  /** A round for the probes: a few steps walking, then out along the main road at a run with jumps, back, and round
   *  the temple square. */
  demoPath(): Waypoint[] {
    const city = this.city!, phys = this.phys!;
    const L = layoutOf(city.rec);
    const a0 = L.roads[0] ?? 0;
    const pts: Waypoint[] = [];
    const at = (a: number, rLots: number) => ({ x: Math.cos(a) * rLots * LOT, z: Math.sin(a) * rLots * LOT });
    const ring = L.rings.find((x) => x > L.plazaR + 5) ?? L.plazaR + 8;
    const out = Math.min(ring - 0.8, L.plazaR + 9);
    const r0 = L.plazaR * 0.82;
    pts.push({ ...at(a0, r0 + 0.9), run: false });
    const steps = 5;
    const along = (i: number) => r0 + 0.9 + ((out - r0 - 0.9) * i) / steps;
    for (let i = 1; i <= steps; i++) pts.push({ ...at(a0, along(i)), run: true, jump: i === 2 || i === 4 });
    for (let i = steps - 1; i >= 0; i--) pts.push({ ...at(a0, along(i)), run: true, jump: i === 3 });
    for (let k = 1; k <= 4; k++) pts.push({ ...at(a0 + (k * Math.PI) / 2, r0), run: true, jump: k === 2 });
    // nudge any point that sits in something
    for (const p of pts) {
      if (phys.free(p.x, city.heightAt(p.x, p.z), p.z)) continue;
      for (let k = 1; k < 12; k++) {
        const ang = k * 2.4, d = 0.8 * k;
        const x = p.x + Math.cos(ang) * d, z = p.z + Math.sin(ang) * d;
        if (phys.free(x, city.heightAt(x, z), z)) { p.x = x; p.z = z; break; }
      }
    }
    return pts;
  }

  /** Measure the feel by stepping the movement itself (fixed 60 Hz steps, no rendering, so it does not depend on the
   *  frame rate): time to full run, stopping, the jump at a run (held and tapped), a reversal at a run. */
  feel() {
    const city = this.city!;
    const L = layoutOf(city.rec);
    const a = L.roads[0] ?? 0;
    const facing = Math.atan2(Math.cos(a), Math.sin(a));
    const r0 = L.plazaR * 0.82 * LOT;
    const home = () => { this.stopDriving(); this.teleport(Math.cos(a) * r0, Math.sin(a) * r0, facing); this.cam.yaw = facing; this.grounded = true; };
    const inp = this.input;
    const steps = (n: number, c: Controls, each?: (i: number) => void) => { inp.virtual = c; for (let i = 0; i < n; i++) { this.step(STEP); each?.(i); } };
    const run: Controls = { mx: 0, my: 1, run: true, jumpHeld: false };
    const none: Controls = { mx: 0, my: 0, run: false, jumpHeld: false };
    const out: Record<string, number> = {};
    const v = this.runSpeed();
    // 1. standstill to full run
    home();
    let t95 = -1;
    steps(90, run, (i) => { if (t95 < 0 && this.speed >= 0.95 * v) t95 = (i + 1) * STEP; });
    out.toRunS = t95;
    // 2. let go at a run: how long and how far to a stop
    const p0 = this.curr.clone();
    let tStop = -1;
    steps(90, none, (i) => { if (tStop < 0 && this.speed < 0.05) tStop = (i + 1) * STEP; });
    out.stopS = tStop;
    out.stopM = Math.hypot(this.curr.x - p0.x, this.curr.z - p0.z);
    // 3. jumps: at a run with the button held, and tapped; from a stand; and pushing forward and pressing jump at the
    // same moment from a stand. Height of the feet over the take-off ground, time in the air, length from the press and
    // through the air, and the press-to-leaving-the-ground delay (the push).
    const jump = (key: string, pre: Controls, preN: number, c: Controls) => {
      home();
      steps(preN, pre);
      const y0 = this.curr.y, x0 = this.curr.x, z0 = this.curr.z;
      inp.jumps++;
      let apex = 0, air = 0, length = -1, leave = -1, lx = 0, lz = 0, airLen = -1;
      steps(150, c, (i) => {
        apex = Math.max(apex, this.curr.y - y0);
        if (!this.grounded) {
          if (leave < 0) { leave = (i + 1) * STEP; lx = this.curr.x; lz = this.curr.z; }
          air += STEP;
        } else if (air > 0 && length < 0) {
          length = Math.hypot(this.curr.x - x0, this.curr.z - z0);
          airLen = Math.hypot(this.curr.x - lx, this.curr.z - lz);
        }
      });
      out[`${key}ApexM`] = apex;
      out[`${key}AirS`] = air;
      out[`${key}LengthM`] = length;
      out[`${key}AirLengthM`] = airLen;
      out[`${key}PushS`] = leave;
    };
    jump('jump', run, 50, { ...run, jumpHeld: true });
    jump('hop', run, 50, { ...run, jumpHeld: false });
    jump('stand', none, 20, { ...none, jumpHeld: true });
    jump('go', none, 20, { ...run, jumpHeld: false });
    // 5. a reversal at a run: time until running flat out the other way
    home();
    steps(60, run);
    this.cam.yaw = facing + Math.PI;
    let tRev = -1;
    steps(120, run, (i) => {
      const back = Math.cos(this.heading - (facing + Math.PI));
      if (tRev < 0 && back > 0.98 && this.speed > 0.95 * v) tRev = (i + 1) * STEP;
    });
    out.reverseS = tRev;
    inp.virtual = null;
    home();
    this.speed = 0; this.animSpeed = 0;
    for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 100) / 100;
    return out;
  }

  /** Put the runner against the long wall of a house near the main road, the camera behind with its boom slanting
   *  into the wall (it must come in), for the clipping check. */
  wallShot(): { ok: boolean; wanted: number; got: number } {
    const city = this.city!, phys = this.phys!;
    const L = layoutOf(city.rec);
    const a0 = L.roads[0] ?? 0;
    const rx = Math.cos(a0) * (L.plazaR + 3) * LOT, rz = Math.sin(a0) * (L.plazaR + 3) * LOT;
    const houses = this.houses().sort((a, b) => Math.hypot(a.x - rx, a.z - rz) - Math.hypot(b.x - rx, b.z - rz));
    for (const A of houses.slice(0, 40)) {
      const yaw = 2 * Math.atan2(A.q.y, A.q.w);
      const ax: [number, number, number][] = [[Math.cos(yaw), -Math.sin(yaw), A.hx], [Math.sin(yaw), Math.cos(yaw), A.hz]];
      // the longer side first
      const sides = A.hx >= A.hz ? [1, 0] : [0, 1];
      for (const k of sides) for (const sg of [1, -1]) {
        const [nx0, nz0, h] = ax[k];
        const nx = nx0 * sg, nz = nz0 * sg;
        const tx = ax[1 - k][0], tz = ax[1 - k][1];
        const x = A.x + nx * (h + 0.62), z = A.z + nz * (h + 0.62);
        const gy = phys.groundAt(x, z, 60);
        if (gy === null || Math.abs(gy) > 0.5 || !phys.free(x, gy, z)) continue;
        const facing = Math.atan2(tx, tz);
        this.stopDriving();
        this.teleport(x, z, facing);
        const f1 = facing + 0.35, f2 = facing - 0.35;
        this.cam.yaw = Math.sin(f1) * nx + Math.cos(f1) * nz > 0 ? f1 : f2;
        this.cam.pitch = 0.12;
        return { ok: true, wanted: this.cam.want, got: this.cam.dist };
      }
    }
    return { ok: false, wanted: 0, got: 0 };
  }

  /**
   * Walls to try the moves on: the faces of boxes standing on the ground, with street ground in front of them (the feet
   * 0.9 m out, free to stand), and what the ledge probe makes of each (its height above the feet). Nearest to the temple
   * square first. `want`: 'mantle' (waist to head high) or 'wall' (higher, up to MOVE.climbMax).
   */
  walls(want: 'mantle' | 'wall', n = 30): { x: number; y: number; z: number; facing: number; up: number; top: number }[] {
    const phys = this.phys!, out: { x: number; y: number; z: number; facing: number; up: number; top: number }[] = [];
    const boxes = this.city!.solids.filter((s): s is Extract<Solid, { kind: 'box' }> => s.kind === 'box' && s.hx > 0.6 && s.hz > 0.6);
    boxes.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    for (const A of boxes) {
      if (out.length >= n) break;
      const yaw = 2 * Math.atan2(A.q.y, A.q.w);
      for (const [lx, lz, h] of [[1, 0, A.hx], [-1, 0, A.hx], [0, 1, A.hz], [0, -1, A.hz]] as const) {
        const nx = lx * Math.cos(yaw) + lz * Math.sin(yaw), nz = -lx * Math.sin(yaw) + lz * Math.cos(yaw);
        const x = A.x + nx * (h + 0.9), z = A.z + nz * (h + 0.9);
        const gy = phys.groundAt(x, z, A.y + A.hy + 1);
        // in the street: on the city's ground, by the foot of the box
        if (gy === null || Math.abs(gy - (A.y - A.hy)) > 0.4 || Math.abs(gy - this.city!.heightAt(x, z)) > 0.4 || !phys.free(x, gy + 0.02, z)) continue;
        if (this.city!.affordances.waterDepthAt(x, z) > 0.05) continue;
        const L = want === 'mantle'
          ? phys.ledge(x, gy, z, -nx, -nz, 1.3, MOVE.mantleMin, MOVE.mantleMax)
          : phys.ledge(x, gy, z, -nx, -nz, 1.3, MOVE.mantleMax + 0.2, MOVE.climbMax);
        if (!L) continue;
        out.push({ x, y: gy, z, facing: Math.atan2(-nx, -nz), up: L.up, top: L.top });
        break;
      }
    }
    return out;
  }

  /**
   * Street to roof, headless (fixed steps, no drawing): from a stand `back` metres out from a wall, facing it, push
   * forward at a run and press jump at once (or, from further back, when the feet are 1.2 m from the wall), and take
   * whatever the runner does — a mantle, a grab and pull-up, a scramble — until it stands on top. Seconds from the first
   * step to standing on the top (Infinity if not within `max`), and the moves it took.
   */
  scale(w: { x: number; y: number; z: number; facing: number; top: number }, back = 0.9, max = 4, press = true): { s: number; moves: string[] } | null {
    const phys = this.phys!, inp = this.input;
    const dx = Math.sin(w.facing), dz = Math.cos(w.facing);
    const sx = w.x - dx * (back - 0.9), sz = w.z - dz * (back - 0.9);
    // a run-up must start in the street too, with nothing between it and the wall
    const gy = phys.groundAt(sx, sz, w.y + 1.5);
    if (gy === null || Math.abs(gy - w.y) > 0.35 || !phys.free(sx, gy + 0.02, sz)) return null;
    if (back > 0.9 && phys.rayFlat(sx, gy + 0.9, sz, dx, dz, back + 0.6) < back - 0.95) return null;
    this.stopDriving();
    this.teleport(sx, sz, w.facing);
    this.cam.yaw = w.facing; this.trav = null; this.grounded = true; this.jumped = false; this.takeoffT = -1;
    const ctl: Controls = { mx: 0, my: 1, run: true, pace: PACE.run, jumpHeld: true };
    inp.virtual = ctl;
    const moves: string[] = [];
    let pressed = false;
    const t0 = this.t;
    for (let i = 0; i < Math.round(max / STEP); i++) {
      const f = phys.feet();
      const toWall = phys.rayFlat(f.x, f.y + 0.9, f.z, dx, dz, 3);
      if (press && !pressed && toWall < 1.2 + 0.3) { inp.jumps++; pressed = true; }
      this.step(STEP);
      const tr = this.trav as Trav | null, k = tr?.kind;
      if (k && moves[moves.length - 1] !== k) moves.push(k);
      if (!tr && this.grounded && this.curr.y > w.top - 0.4) { inp.virtual = null; return { s: this.t - t0, moves }; }
    }
    inp.virtual = null;
    return { s: Infinity, moves };
  }

  /** Ladders from the street, nearest the temple square first, with their heights. */
  streetLadders(n = 10): { i: number; h: number; x: number; z: number }[] {
    const a = this.city!.affordances, phys = this.phys!;
    return a.ladders.map((l, i) => ({ l, i }))
      .filter(({ l }) => { const g = phys.groundAt(l.base.x, l.base.z, l.base.y + 1); return g !== null && Math.abs(g - l.base.y) < 0.3 && a.waterDepthAt(l.base.x, l.base.z) === 0; })
      .sort((p, q) => Math.hypot(p.l.base.x, p.l.base.z) - Math.hypot(q.l.base.x, q.l.base.z))
      .slice(0, n).map(({ l, i }) => ({ i, h: l.top.y - l.base.y, x: l.base.x, z: l.base.z }));
  }

  /** On top of a wall the probes climbed, walk (or run) back out toward its edge for a few seconds: does a walker stop
   *  at the edge, and does a runner go over? The lowest the feet got, and where they started. */
  edgeTest(w: { x: number; y: number; z: number; facing: number; top: number }, pace: number): { y0: number; low: number } | null {
    const r = this.scale(w, 0.9, 4, true);
    if (!r || !Number.isFinite(r.s)) return null;
    // a few steps in from the edge, then back out toward it
    const out = w.facing + Math.PI;
    const inner = { mx: 0, my: 1, run: false, pace: PACE.walk, jumpHeld: false };
    this.cam.yaw = w.facing;
    for (let i = 0; i < 40; i++) this.step(STEP), (this.input.virtual = inner);
    this.cam.yaw = out;
    const y0 = this.curr.y;
    let low = y0;
    this.input.virtual = { mx: 0, my: 1, run: pace >= 1, pace, jumpHeld: false };
    for (let i = 0; i < 180; i++) { this.step(STEP); low = Math.min(low, this.curr.y); }
    this.input.virtual = null;
    return { y0, low };
  }

  /** Up the world's stairs at a pace, headless: the palace's, the temple's, a wall stair and two houses'. For each, its
   *  length along the path, its rise, the seconds to the top (Infinity if not within 20 s) and the speed made good. */
  stairs(pace = PACE.walk) {
    type St = { name: string; path: { x: number; y: number; z: number }[] };
    const all = ((this.city as unknown as { layer?: { civ?: { stairs?: St[] } } }).layer?.civ?.stairs ?? []);
    const pick = [all.find((s) => s.name === 'palace'), all.find((s) => s.name === 'temple'), all.find((s) => s.name.startsWith('walls')),
      ...all.filter((s) => s.name.startsWith('house')).slice(0, 2)].filter((s): s is St => !!s);
    return pick.map((st) => {
      const p = st.path, last = p[p.length - 1];
      let len = 0;
      for (let i = 1; i < p.length; i++) len += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
      this.teleport(p[0].x, p[0].z, Math.atan2(p[1].x - p[0].x, p[1].z - p[0].z));
      this.drive(p.slice(1).map((q) => ({ x: q.x, z: q.z, pace })), false);
      let s = Infinity;
      for (let i = 0; i < 1200; i++) {
        this.step(STEP);
        if (Math.hypot(this.curr.x - last.x, this.curr.z - last.z) < 1.3 && Math.abs(this.curr.y - last.y) < 0.5) { s = (i + 1) * STEP; break; }
      }
      this.stopDriving();
      return { name: st.name, len: Math.round(len * 100) / 100, rise: Math.round((last.y - p[0].y) * 100) / 100, s: Math.round(s * 100) / 100, mps: Math.round((len / s) * 100) / 100 };
    });
  }

  /** Stand 1 m out from a ladder's foot facing the wall (or, `top`, on the roof by its top facing out over the edge). */
  atLadder(i: number, top = false) {
    const l = this.city!.affordances.ladders[i], n = l.facing;
    this.stopDriving();
    this.resetMoves();
    if (top) { this.phys!.teleport(l.top.x - n.x * 0.5, l.top.y + 0.05, l.top.z - n.z * 0.5); }
    else this.phys!.teleport(l.base.x + n.x * 0.6, l.base.y + 0.05, l.base.z + n.z * 0.6);
    const f = this.phys!.feet();
    this.curr.set(f.x, f.y, f.z); this.prev.copy(this.curr);
    this.speed = 0; this.vy = 0; this.animSpeed = 0; this.grounded = true; this.jumped = false;
    const face = top ? Math.atan2(n.x, n.z) : Math.atan2(-n.x, -n.z);
    this.heading = face; this.lastFacing = face; this.cam.yaw = face; this.cam.pitch = 0.22;
    return { facing: face, base: { x: l.base.x, y: l.base.y, z: l.base.z }, top: { x: l.top.x, y: l.top.y, z: l.top.z } };
  }

  /** A place at the river's edge: dry feet within a few metres of water that deepens from wading depth to over the
   *  waist, and the way into it. */
  riverEdge(): { x: number; z: number; facing: number } | null {
    const a = this.city!.affordances, phys = this.phys!;
    for (let r = 10; r < 200; r += 3) for (let k = 0; k < 64; k++) {
      const ang = (k / 64) * Math.PI * 2, x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (a.waterDepthAt(x, z) !== 0) continue;
      for (let j = 0; j < 8; j++) {
        const b = (j / 8) * Math.PI * 2, dx = Math.sin(b), dz = Math.cos(b);
        const d1 = a.waterDepthAt(x + dx * 3, z + dz * 3), d2 = a.waterDepthAt(x + dx * 8, z + dz * 8);
        if (d1 > 0.2 && d1 < 0.7 && d2 > 1.1) {
          const g = phys.groundAt(x, z, 30);
          if (g === null || !phys.free(x, g + 0.02, z)) continue;
          let clear = true;
          for (let s = 0.5; s < 8; s += 0.5) if (phys.rayFlat(x, g + 0.9 - s * 0.1, z, dx, dz, 0.6) < 0.5) { clear = false; break; }
          if (clear) return { x, z, facing: b };
        }
      }
    }
    return null;
  }

  /** Whole houses standing on the ground (boxes 3–8 m tall and at least 5 m across), from the city's solids. */
  private houses() {
    return this.city!.solids.filter((s): s is Extract<Solid, { kind: 'box' }> =>
      s.kind === 'box' && s.hy * 2 > 3 && s.hy * 2 < 8 && s.hx > 2.4 && s.hz > 2.4 && Math.abs(s.y - s.hy) < 0.6);
  }

  /** Put the runner on a house roof near the main road and send it at a run to the next roof, jumping the gap (the
   *  rooftop hook, before there is any way up). Returns the two roofs; the probes read where it ends up. */
  roofRun(): { ok: boolean; from?: { x: number; z: number; top: number }; to?: { x: number; z: number; top: number }; gap?: number } {
    const city = this.city!, phys = this.phys!;
    const L = layoutOf(city.rec);
    const a0 = L.roads[0] ?? 0;
    const rx = Math.cos(a0) * (L.plazaR + 4) * LOT, rz = Math.sin(a0) * (L.plazaR + 4) * LOT;
    const houses = this.houses();
    houses.sort((a, b) => Math.hypot(a.x - rx, a.z - rz) - Math.hypot(b.x - rx, b.z - rz));
    const half = (h: (typeof houses)[number], dx: number, dz: number) => {
      // distance from the centre to the box's side along (dx, dz), in the box's own frame
      const yaw = 2 * Math.atan2(h.q.y, h.q.w);
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
      return Math.min(Math.abs(lx) > 1e-6 ? h.hx / Math.abs(lx) : Infinity, Math.abs(lz) > 1e-6 ? h.hz / Math.abs(lz) : Infinity);
    };
    for (const A of houses.slice(0, 40)) {
      for (const B of houses) {
        if (B === A) continue;
        const d = Math.hypot(B.x - A.x, B.z - A.z);
        if (d < 4 || d > 14) continue;
        const dx = (B.x - A.x) / d, dz = (B.z - A.z) / d;
        const gap = d - half(A, dx, dz) - half(B, -dx, -dz);
        if (gap < 0.4 || gap > 2.2) continue;
        const ta = phys.groundAt(A.x, A.z, 60), tb = phys.groundAt(B.x, B.z, 60);
        if (ta === null || tb === null || ta < 3 || tb < 3 || Math.abs(ta - tb) > 1.5) continue;
        // start back from the far side of A, so there is room to get up to speed
        const back = Math.max(0, half(A, dx, dz) - 0.8);
        const sx = A.x - dx * back, sz = A.z - dz * back;
        this.stopDriving();
        this.teleport(sx, sz, Math.atan2(dx, dz));
        this.cam.yaw = Math.atan2(dx, dz);
        this.cam.pitch = 0.3;
        const edge = half(A, dx, dz);
        this.drive([
          { x: A.x + dx * (edge - 0.1), z: A.z + dz * (edge - 0.1), run: true, jump: true },
          { x: B.x + dx * 1.5, z: B.z + dz * 1.5, run: true },
          { x: B.x + dx * 2.2, z: B.z + dz * 2.2, run: false },
        ], false);
        return { ok: true, from: { x: A.x, z: A.z, top: ta }, to: { x: B.x, z: B.z, top: tb }, gap };
      }
    }
    return { ok: false };
  }

  dispose() {
    this.stop();
    this.input.dispose();
    this.phys?.dispose();
    this.city?.dispose();
    this.runner?.object.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mat = m.material as MeshStandardMaterial;
      mat.map?.dispose();
      mat.dispose();
    });
    this.renderer.dispose();
  }
}

export interface Waypoint { x: number; z: number; run?: boolean; jump?: boolean; pace?: number }

/** A scripted runner: heads for each waypoint in turn, walking or running, and jumps where told. */
class Pilot {
  yaw = 0;
  private i = 0;
  private jump = 0;
  private stuckT = 0;
  private lastD = Infinity;
  private pts: Waypoint[];
  private loop: boolean;
  constructor(pts: Waypoint[], loop: boolean) { this.pts = pts; this.loop = loop; }
  takeJump() { const j = this.jump; this.jump = 0; return j; }
  controls(g: StreetsGame, dt: number): Controls {
    const f = g.phys!.feet();
    let p = this.pts[this.i];
    if (!p) return { mx: 0, my: 0, run: false, jumpHeld: false };
    let d = Math.hypot(p.x - f.x, p.z - f.z);
    // progress check: skip a point the runner cannot reach
    if (d < this.lastD - 0.02) { this.stuckT = 0; this.lastD = d; } else this.stuckT += dt;
    if (d < 1.2 || this.stuckT > 1.5) {
      if (p.jump && d < 1.2) this.jump++;
      this.i++;
      if (this.i >= this.pts.length) { if (this.loop) this.i = 0; else return { mx: 0, my: 0, run: false, jumpHeld: false }; }
      p = this.pts[this.i];
      d = Math.hypot(p.x - f.x, p.z - f.z);
      this.lastD = d; this.stuckT = 0;
    }
    this.yaw = Math.atan2(p.x - f.x, p.z - f.z);
    return { mx: 0, my: 1, run: !!p.run, pace: p.run ? PACE.run : (p.pace ?? PACE.walk), jumpHeld: true };
  }
}

function nextFrame(): Promise<void> { return new Promise((r) => requestAnimationFrame(() => r())); }
