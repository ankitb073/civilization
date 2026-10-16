// Streets (#/streets): the movement spike for a third-person game in a city of the record. One runner, one city at
// walking scale, Rapier for collision, a fixed 60 Hz step for movement (rendered with interpolation), and probes for the
// screenshot script (window.__palimpsestStreets).

import { PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Mesh, type MeshStandardMaterial } from 'three';
import { loadCityRecord, type CityRecord } from '../../three/city/index.ts';
import { layoutOf } from '../../three/city/layout.ts';
import { ThirdPersonCamera } from './camera.ts';
import { Input, type Controls, type InputEls } from './input.ts';
import { StreetsPhysics, loadRapier } from './physics.ts';
import { loadRunner, type Runner } from './runner.ts';
import { LOT, buildStreets, type Solid, type StreetsCity } from './world.ts';

export interface GameOpts { mobile: boolean; touch: boolean; reducedMotion: boolean }

/** Feel: speeds in m/s, accelerations in m/s², times in seconds. */
const FEEL = {
  walk: 1.45,
  accel: 26,
  decel: 22,
  skidDecel: 42,
  airAccel: 6,
  turnSlow: 14,
  turnFast: 7.5,
  airTurn: 2.6,
  jumpV: 7.4,
  gUp: 22,
  gCut: 48,
  gDown: 34,
  terminal: 42,
  coyote: 0.12,
  buffer: 0.13,
};
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
  private airT = 0;
  private peakY = 0;
  private prev = new Vector3();
  private curr = new Vector3();
  private animSpeed = 0;
  private yawRate = 0;
  private lastFacing = 0;
  private controlLock = 0;
  private pilot: Pilot | null = null;
  private runnerHidden = false;
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
    this.cam.follow = opts.touch;
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
    const alpha = this.acc / STEP;
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
    runner.update(dt, { speed: this.animSpeed, grounded: this.grounded, vy: this.vy, air: this.airT, turn: this.yawRate });
    // foot skate: how far the ground speed the feet show is from how fast the runner really goes (m/s)
    const foot = runner.footSpeed();
    if (foot !== null && this.grounded && this.animSpeed > 0.5) this.push(this.stats.skate, Math.abs(foot - this.animSpeed));

    // the camera
    const o = runner.object.position;
    const ctl = this.input.controls();
    this.cam.update(this.camera, dt, {
      x: o.x, y: o.y, z: o.z, speed: this.animSpeed, runSpeed: this.runSpeed(), grounded: this.grounded,
      phase: runner.phase, facing: this.lastFacing, moving: this.speed > 0.5 && (!!this.pilot || Math.hypot(ctl.mx, ctl.my) > 0.1),
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

    if (this.city.model.smoke.length) this.city.smoke.update(this.opts.reducedMotion ? 40 : now / 1000, this.camera);
    this.renderer.render(this.scene, this.camera);
    this.push(this.stats.cpu, performance.now() - c0);
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

    // wished direction in the world, from the camera's yaw (or the pilot's own heading)
    const [fx, fz] = this.pilot ? [Math.sin(this.pilot.yaw), Math.cos(this.pilot.yaw)] : this.cam.forward();
    const rx = -fz, rz = fx;
    let wx = fx * ctl.my + rx * ctl.mx, wz = fz * ctl.my + rz * ctl.mx;
    const wl = Math.hypot(wx, wz);
    const mag = Math.min(1, wl);
    if (wl > 1e-3) { wx /= wl; wz /= wl; }
    const run = this.runSpeed();
    let target = mag < 0.05 ? 0 : ctl.run ? run : FEEL.walk * Math.min(1, mag / 0.8);
    if (this.controlLock > 0) { this.controlLock -= dt; target = Math.min(target, 0.4); }

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

    // jump: buffered presses, a little grace after leaving an edge
    const canJump = !this.jumped && (this.grounded || this.t - this.lastGround < FEEL.coyote) && !runner.rolling;
    if (this.jumpAt >= 0 && this.t - this.jumpAt <= FEEL.buffer && canJump) {
      this.vy = FEEL.jumpV;
      this.jumped = true;
      this.jumpAt = -1;
      this.grounded = false;
      this.airT = 0;
      this.peakY = this.curr.y;
      runner.jump(this.speed);
    }
    // gravity: lighter going up while the button is held, a hard cut when let go, heavier coming down
    if (!this.grounded) {
      const g = this.vy > 0 ? (ctl.jumpHeld || !this.jumped ? FEEL.gUp : FEEL.gCut) : FEEL.gDown;
      this.vy = Math.max(-FEEL.terminal, this.vy - g * dt);
    } else this.vy = -1.5;

    const hx = Math.sin(this.heading) * this.speed, hz = Math.cos(this.heading) * this.speed;
    const r = phys.move(hx * dt, this.vy * dt, hz * dt);
    const f = phys.feet();
    this.curr.set(f.x, f.y, f.z);
    const real = Math.hypot(r.dx, r.dz) / dt;
    // pushing into a wall: the run slows to the slide along it, so the feet keep matching the ground
    if (r.hitWall && real < this.speed) this.speed = Math.max(real, this.speed - FEEL.decel * dt * 2);
    this.animSpeed += (Math.min(real, this.speed + 0.5) - this.animSpeed) * (1 - Math.exp(-dt * 14));
    if (r.hitCeiling && this.vy > 0) this.vy = 0;

    const was = this.grounded;
    const nowGround = r.grounded && this.vy <= 0.01;
    if (nowGround) {
      if (!was) {
        const drop = Math.max(0, this.peakY - f.y);
        runner.land(this.airT, drop, this.speed);
        this.cam.land(drop);
        if (runner.pose === 'land' && drop > 2.5) this.controlLock = 0.25;
      }
      this.grounded = true;
      this.lastGround = this.t;
      this.jumped = false;
      this.airT = 0;
      this.peakY = f.y;
    } else {
      if (was && this.vy <= 0) { this.vy = 0; this.peakY = f.y; }
      this.grounded = false;
      this.airT += dt;
      this.peakY = Math.max(this.peakY, f.y);
    }
  }

  // ------------------------------------------------------------------ probes for the screenshot script
  info() {
    const ri = this.renderer.info;
    const f = this.phys?.feet();
    return {
      calls: ri.render.calls, triangles: ri.render.triangles, geometries: ri.memory.geometries, textures: ri.memory.textures,
      physics: this.phys?.counts, gaits: this.runner?.gaits, pose: this.runner?.pose, speed: this.animSpeed, grounded: this.grounded,
      feet: f, cam: { ...this.cam.last, yaw: this.cam.yaw, pitch: this.cam.pitch, fov: this.camera.fov, y: this.camera.position.y }, dpr: this.dpr, size: [this.w, this.h],
      timing: this.timing, city: this.rec ? { id: this.rec.id, name: this.city?.cy.name, year: this.city?.cy.year, P: this.city?.P, solids: this.city?.solids.length } : null,
    };
  }

  /** Steer by script: a list of waypoints (metres), each walked or run, with jumps. */
  drive(points: Waypoint[], loop = true) { this.pilot = new Pilot(points, loop); this.cam.follow = true; }
  stopDriving() { this.pilot = null; this.cam.follow = this.opts.touch; }
  teleport(x: number, z: number, facing?: number) {
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
    // 3. a held jump at a run, and 4. a tapped one
    for (const held of [true, false]) {
      home();
      steps(50, run);
      const y0 = this.curr.y, x0 = this.curr.x, z0 = this.curr.z;
      inp.jumps++;
      let apex = 0, air = 0, length = -1;
      steps(120, { ...run, jumpHeld: held }, (i) => {
        apex = Math.max(apex, this.curr.y - y0);
        if (!this.grounded) air = (i + 1) * STEP;
        else if (air > 0 && length < 0) length = Math.hypot(this.curr.x - x0, this.curr.z - z0);
      });
      const k = held ? 'jump' : 'hop';
      out[`${k}ApexM`] = apex;
      out[`${k}AirS`] = air;
      out[`${k}LengthM`] = length;
    }
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

export interface Waypoint { x: number; z: number; run?: boolean; jump?: boolean }

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
    return { mx: 0, my: 1, run: !!p.run, jumpHeld: true };
  }
}

function nextFrame(): Promise<void> { return new Promise((r) => requestAnimationFrame(() => r())); }
