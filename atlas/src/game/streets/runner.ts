// Streets: the runner. A CC0 Quaternius character (Universal Base Characters) moved by clips from Quaternius's
// Universal Animation Library (atlas/public/game/streets/LICENSES.md). Clips blend with AnimationMixer crossfades.
// Each gait's ground speed is measured from the clip itself when the model loads (how fast the planted foot slides
// back), so the game can set the playback rate from the runner's real speed and the feet do not skate.
// Jumps: a push-off on the ground first (the foot that is down, or a crouch from a stand), then a flight clip whose
// time is set from the arc itself (rising: by vertical speed; falling: by the time left before the feet meet the ground
// below), so the knees drive, tuck at the top and reach for the landing exactly as the body rises and falls. Landings
// add a share of Jump_Land's knee bend on top of whatever comes next (an additive layer): a little into a run, more
// into a stand, all of it after a long drop.

import {
  type AnimationAction, AnimationClip, AnimationMixer, AnimationUtils, Group, LoopOnce, LoopRepeat, type Material,
  type Mesh, type Object3D, Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const RUNNER_URL = `${import.meta.env.BASE_URL}game/streets/runner.glb`;

/** A looping gait and what the clip says about it. */
export interface Gait { name: string; speed: number; front: number; duration: number }

export type Pose = 'idle' | 'walk' | 'run' | 'takeoff' | 'jump' | 'fall' | 'land' | 'roll';

const CLIPS = {
  idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop',
  jumpStart: 'Jump_Start', jumpLoop: 'Jump_Loop', jumpLand: 'Jump_Land', roll: 'Roll',
  // authored in scripts/streets/runner-asset.ts: a phase from take-off (0) to touch-down (1) over one second
  leapL: 'Run_Jump_L', leapR: 'Run_Jump_R', hopAir: 'Jump_Air',
} as const;
/** The landing absorb: Jump_Land made relative to its last (standing) frame, played on top of the next clip. */
const ABSORB = 'Land_Absorb';
/** The run clip's foot contacts (seconds into Jog_Fwd_Loop), as runner-asset.ts reads them: each foot's toe-off and
 *  touch-down. */
const TOE_OFF = { l: 0.175, r: 0.642 } as const;
const TOUCH = { l: 0.03, r: 0.497 } as const;
/** Where the flight clips put the top of the arc (their phase). */
const APEX = { leap: 0.47, hop: 0.48 } as const;
/** What the game tells the runner about the arc while it is in the air. */
export interface Arc {
  /** Vertical speed at take-off (m/s; 0 after walking off an edge), and gravity rising and falling (m/s²). */
  vy0: number; gUp: number; gDown: number;
  /** Height of the feet above the ground straight below (m; Infinity when there is none within reach). */
  clear: number;
  /** How far the feet are below where they left the ground (m; negative above it). */
  below: number;
}

export async function loadRunner(url = RUNNER_URL): Promise<Runner> {
  // the model is meshopt-compressed (EXT_meshopt_compression) and quantized (KHR_mesh_quantization)
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  return new Runner(gltf.scene, gltf.animations);
}

export class Runner {
  /** At the runner's feet; turned to face where it runs (+z is forward at yaw 0). */
  readonly object = new Group();
  /** The model inside, which leans. */
  readonly model: Object3D;
  readonly mixer: AnimationMixer;
  readonly gaits: { walk: Gait; run: Gait; sprint: Gait };
  readonly height: number;
  pose: Pose = 'idle';
  /** 0..1 through the current gait's cycle (for the camera's step bob). */
  phase = 0;
  private actions = new Map<string, AnimationAction>();
  private current: AnimationAction;
  private lean = 0;
  private poseT = 0;

  constructor(scene: Object3D, clips: AnimationClip[]) {
    this.model = scene;
    scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = false;
      m.frustumCulled = false; // skinned bounds do not follow the pose
      const mat = m.material as Material & { color?: { set(c: string): void } };
      // the brows borrow the hair texture, which is fair: darken them to the runner's own
      if (mat.name === 'MI_Hair_1') mat.color?.set('#4a3426');
    });
    this.object.add(scene);
    this.object.name = 'runner';
    this.mixer = new AnimationMixer(scene);
    const byName = new Map(clips.map((c) => [c.name, c]));
    for (const c of clips) this.actions.set(c.name, this.mixer.clipAction(c));
    const need = (n: string) => { const c = byName.get(n); if (!c) throw new Error(`runner: no clip ${n}`); return c; };
    // the landing absorb, relative to Jump_Land's standing end (30 fps reference frame)
    const land = need(CLIPS.jumpLand);
    const absorb = AnimationUtils.makeClipAdditive(land.clone(), Math.round(land.duration * 30), undefined, 30);
    absorb.name = ABSORB;
    const ab = this.mixer.clipAction(absorb);
    ab.setLoop(LoopOnce, 1);
    ab.clampWhenFinished = false;
    this.actions.set(ABSORB, ab);
    for (const n of [CLIPS.leapL, CLIPS.leapR, CLIPS.hopAir]) need(n);
    this.gaits = {
      walk: measureGait(scene, need(CLIPS.walk)),
      run: measureGait(scene, need(CLIPS.run)),
      sprint: measureGait(scene, need(CLIPS.sprint)),
    };
    this.height = 1.8;
    for (const n of [CLIPS.jumpStart, CLIPS.jumpLand, CLIPS.roll]) {
      const a = this.actions.get(n)!;
      a.setLoop(LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    for (const n of [CLIPS.idle, CLIPS.walk, CLIPS.run, CLIPS.sprint, CLIPS.jumpLoop]) this.actions.get(n)!.setLoop(LoopRepeat, Infinity);
    // the flight clips are posed by hand (their time is the arc's phase), so they neither play on nor wrap
    for (const n of [CLIPS.leapL, CLIPS.leapR, CLIPS.hopAir]) {
      const a = this.actions.get(n)!;
      a.setLoop(LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    this.current = this.actions.get(CLIPS.idle)!;
    this.current.play();
  }

  private act(n: string) { return this.actions.get(n)!; }

  /** Crossfade to a clip (AnimationMixer crossfade), optionally starting part-way and at a rate. */
  private fadeTo(name: string, fade: number, opts: { time?: number; rate?: number; syncFrom?: Gait; syncTo?: Gait } = {}) {
    const next = this.act(name);
    if (next === this.current) return;
    next.reset();
    next.timeScale = opts.rate ?? 1;
    if (opts.syncFrom && opts.syncTo) {
      // keep the feet in step: the same point of the stride in the new clip
      const p = this.current.time / opts.syncFrom.duration - opts.syncFrom.front;
      next.time = (((p + opts.syncTo.front) % 1) + 1) % 1 * opts.syncTo.duration;
    } else next.time = opts.time ?? 0;
    next.play();
    this.current.crossFadeTo(next, fade, false);
    this.current = next;
    this.poseT = 0;
  }

  private gaitOf(p: Pose): Gait | null {
    return p === 'walk' ? this.gaits.walk : p === 'run' ? this.gaits.run : null;
  }

  /** The jump under way: a leap (carried forward, off foot `side`) or a hop (from a stand), and its phase. */
  private leap = false;
  private side: 'l' | 'r' = 'l';
  private u = 0;

  private flightClip(): string {
    return this.leap ? (this.side === 'l' ? CLIPS.leapL : CLIPS.leapR) : CLIPS.hopAir;
  }

  /** The push before the feet leave the ground. Carried forward (`moving`: a running, walking or broad jump), the
   *  runner pushes off the foot that is down or about to come down, the free knee driving; from a stand, a quick
   *  crouch and spring (Jump_Start). The game launches it a few steps later. */
  takeoff(moving: boolean) {
    const run = this.act(CLIPS.run);
    let side: 'l' | 'r' = this.side === 'l' ? 'r' : 'l';
    if (this.pose === 'run') {
      // the foot whose toe-off comes next in the run's stride
      const t = ((run.time % run.getClip().duration) + run.getClip().duration) % run.getClip().duration;
      side = t > TOE_OFF.l && t <= TOE_OFF.r ? 'r' : 'l';
    }
    this.leap = moving;
    this.side = side;
    this.u = 0;
    this.pose = 'takeoff';
    if (moving) this.fadeTo(this.flightClip(), 0.07, { time: 0, rate: 0 });
    else this.fadeTo(CLIPS.jumpStart, 0.04, { time: 0, rate: 0.55 }); // its crouch, slowly, so the dip is seen
  }

  /** The feet left the ground (after the push, or at once when the jump came just after running off an edge). */
  launch() {
    if (this.pose !== 'takeoff') this.takeoff(this.leap);
    this.pose = 'jump';
    this.u = 0;
    if (!this.leap) this.fadeTo(CLIPS.hopAir, 0.07, { time: 0, rate: 0 });
  }

  /** Touched down after `air` seconds, having fallen `drop` metres, at a horizontal speed. */
  land(air: number, drop: number, speed: number) {
    const wasJump = this.pose === 'jump';
    if (air < 0.28 && drop < 0.9 && !wasJump) { this.pose = 'fall'; this.locomote(speed, true); return; }
    if (speed > 2.6 && drop > 3.2) {
      this.pose = 'roll';
      this.fadeTo(CLIPS.roll, 0.08, { time: 0.12, rate: 1.35 });
      return;
    }
    if (speed > 2.2) {
      // into the run at the point of its stride where the leading foot lands, so the legs carry straight on; the knees
      // give a little, more after a drop
      const lead = wasJump && this.leap ? (this.side === 'l' ? 'r' : 'l') : 'l';
      this.pose = 'run';
      this.fadeTo(CLIPS.run, 0.1, { time: TOUCH[lead] });
      this.absorb(Math.min(0.4, 0.06 + 0.05 * drop), 2.3);
      return;
    }
    if (drop > 2.2) {
      // a long drop: the whole crouch of Jump_Land
      this.pose = 'land';
      this.fadeTo(CLIPS.jumpLand, 0.06, { time: 0.03, rate: 1.1 });
      return;
    }
    // an ordinary landing from a stand or a walk: knees bend about a fifth of a metre and spring back
    this.pose = 'fall';
    this.locomote(speed, true);
    this.absorb(Math.min(0.6, 0.36 + 0.06 * drop), 1.5);
  }

  /** Play a share (`w`) of the landing's knee bend on top of the pose, at a rate. */
  private absorb(w: number, rate: number) {
    const a = this.act(ABSORB);
    a.stop();
    a.reset();
    a.time = 0.04;
    a.timeScale = rate;
    a.setEffectiveWeight(w);
    a.play();
  }

  /** The flight's phase from the arc: rising, by how much of the take-off speed is spent (0 → the top); falling, by
   *  the time left before the feet meet the ground below, against the time the fall from the top to the take-off
   *  height takes (the top → 1, touch-down). Falling, it never runs ahead faster than 5/s nor back faster than 1.5/s,
   *  so a change of ground below (out over a gap, onto the next roof) bends the legs without a snap. */
  private airPhase(arc: Arc, vy: number, dt: number): number {
    const top = this.leap ? APEX.leap : APEX.hop;
    if (vy > 0 && arc.vy0 > 0) {
      this.u = top * Math.max(0, Math.min(1, 1 - vy / arc.vy0));
      return this.u;
    }
    const down = Math.max(0, -vy), g = arc.gDown;
    const left = Number.isFinite(arc.clear) ? (-down + Math.sqrt(down * down + 2 * g * Math.max(0, arc.clear))) / g : Infinity;
    const fall = arc.vy0 > 0 ? (arc.vy0 / arc.gUp) * Math.sqrt(arc.gUp / g) : 0.28;
    const want = top + (1 - top) * Math.max(0, Math.min(1, 1 - left / fall));
    this.u += Math.max(-1.5 * dt, Math.min(5 * dt, want - this.u));
    this.u = Math.max(top, Math.min(1, this.u));
    return this.u;
  }

  /** Seconds before the feet meet the ground below, falling (Infinity rising or with nothing below). */
  private impactIn(arc: Arc, vy: number): number {
    if (vy > 0 || !Number.isFinite(arc.clear)) return Infinity;
    const down = -vy, g = arc.gDown;
    return (-down + Math.sqrt(down * down + 2 * g * Math.max(0, arc.clear))) / g;
  }

  /** The ground speed the feet show right now (the gait's measured speed × its playback rate), when walking or running. */
  footSpeed(): number | null {
    if (this.pose === 'walk') return this.act(CLIPS.walk).timeScale * this.gaits.walk.speed;
    if (this.pose === 'run') return this.act(CLIPS.run).timeScale * this.gaits.run.speed;
    return null;
  }

  /** The pelvis's height above the runner's feet (metres), for the probes: how deep a landing sinks. */
  pelvisHeight(): number {
    const p = this.model.getObjectByName('pelvis');
    if (!p) return 0;
    this.object.updateMatrixWorld(true);
    return p.getWorldPosition(new Vector3()).y - this.object.position.y;
  }

  /** Whether the roll still holds the runner (the game keeps it moving straight). */
  get rolling() { return this.pose === 'roll'; }

  private locomote(speed: number, force = false) {
    const prev = this.pose;
    let want: Pose;
    if (speed < 0.12) want = 'idle';
    else if (prev === 'run') want = speed < 2.4 ? 'walk' : 'run';
    else want = speed > 3.1 ? 'run' : 'walk';
    if (want === prev && !force) return;
    const from = this.gaitOf(prev);
    const to = this.gaitOf(want);
    const fade = prev === 'idle' || want === 'idle' ? 0.25 : force ? 0.14 : 0.2;
    const name = want === 'idle' ? CLIPS.idle : want === 'walk' ? CLIPS.walk : CLIPS.run;
    this.pose = want;
    this.fadeTo(name, fade, from && to ? { syncFrom: from, syncTo: to } : {});
  }

  /**
   * Advance the animation. speed: horizontal m/s; grounded; vy: vertical m/s; air: seconds off the ground;
   * turn: yaw rate (rad/s), for the lean.
   */
  update(dt: number, s: { speed: number; grounded: boolean; vy: number; air: number; turn: number; arc: Arc }) {
    this.poseT += dt;
    const p = this.pose;
    if (!s.grounded) {
      const arc = s.arc;
      if (p === 'jump') {
        const a = this.act(this.flightClip());
        if (this.current === a) a.time = this.airPhase(arc, s.vy, dt);
        // fallen well below where it left from, with the ground still far below (off a roof): arms up for the drop
        if (arc.below > 0.9 && this.impactIn(arc, s.vy) > 0.3) { this.pose = 'fall'; this.fadeTo(CLIPS.jumpLoop, 0.3, { time: 0.4 }); }
      } else if (p === 'takeoff') {
        // left the ground before the push was done: the game launches on its next step
      } else if (p === 'fall') {
        // the ground comes up: reach for it with the flight's last frames
        if (s.air > 0.3 && this.impactIn(arc, s.vy) < 0.2) {
          this.leap = s.speed > 2.2;
          this.pose = 'jump';
          this.u = 0.85;
          this.fadeTo(this.flightClip(), 0.12, { time: 0.85, rate: 0 });
        }
      } else if (p !== 'roll' && s.air > 0.2) {
        this.pose = 'fall';
        this.fadeTo(CLIPS.jumpLoop, 0.25, { time: 0.3 });
      }
    } else if (p === 'roll') {
      if (this.act(CLIPS.roll).time > 1.05) { this.pose = 'fall'; this.locomote(s.speed, true); }
    } else if (p === 'land') {
      const a = this.act(CLIPS.jumpLand);
      if (a.time > 0.78 || (s.speed > 0.6 && a.time > 0.22)) { this.pose = 'fall'; this.locomote(s.speed, true); }
    } else if (p === 'jump' || p === 'fall') {
      if (s.air <= 0) this.locomote(s.speed, true);
    } else if (p !== 'takeoff') this.locomote(s.speed);

    // playback rate from the real speed: feet planted
    const w = this.act(CLIPS.walk), r = this.act(CLIPS.run);
    w.timeScale = Math.max(0.5, Math.min(2.2, s.speed / this.gaits.walk.speed));
    r.timeScale = Math.max(0.7, Math.min(1.4, s.speed / this.gaits.run.speed));
    const g = this.gaitOf(this.pose);
    if (g) {
      const a = this.pose === 'walk' ? w : r;
      this.phase = ((a.time / g.duration - g.front) % 1 + 1) % 1;
    }
    this.mixer.update(dt);

    // lean into turns, more at speed
    const target = Math.max(-0.2, Math.min(0.2, -s.turn * s.speed * 0.022)) * (s.grounded ? 1 : 0.4);
    this.lean += (target - this.lean) * (1 - Math.exp(-dt * 8));
    this.model.rotation.z = this.lean;
  }
}

/** Ground speed of a looping gait: the median backward speed of whichever foot is planted, and the phase at which the
 *  left foot is furthest forward (for keeping the feet in step across a crossfade). */
function measureGait(root: Object3D, clip: AnimationClip): Gait {
  const mixer = new AnimationMixer(root);
  const a = mixer.clipAction(clip);
  a.play();
  const feet = ['foot_l', 'foot_r'].map((n) => root.getObjectByName(n));
  const balls = ['ball_l', 'ball_r'].map((n) => root.getObjectByName(n));
  if (feet.some((f) => !f) || balls.some((b) => !b)) { mixer.stopAllAction(); return { name: clip.name, speed: 1, front: 0, duration: clip.duration }; }
  const N = 120;
  const S: { f: Vector3[]; b: Vector3[] }[] = [];
  for (let i = 0; i <= N; i++) {
    mixer.setTime((i / N) * clip.duration);
    root.updateMatrixWorld(true);
    S.push({ f: feet.map((f) => f!.getWorldPosition(new Vector3())), b: balls.map((b) => b!.getWorldPosition(new Vector3())) });
  }
  const speeds: number[] = [];
  let front = 0, frontZ = -Infinity;
  const dt = clip.duration / N;
  for (const side of [0, 1]) {
    const low = (s: (typeof S)[number]) => Math.min(s.f[side].y, s.b[side].y);
    let minY = Infinity;
    for (const s of S) minY = Math.min(minY, low(s));
    for (let i = 0; i < N; i++) {
      const s0 = S[i], s1 = S[i + 1];
      if (low(s0) > minY + 0.015 || low(s1) > minY + 0.015) continue;
      const k = s0.f[side].y < s0.b[side].y ? 'f' : 'b';
      speeds.push(-(s1[k][side].z - s0[k][side].z) / dt);
    }
  }
  for (let i = 0; i < N; i++) if (S[i].b[0].z > frontZ) { frontZ = S[i].b[0].z; front = i / N; }
  speeds.sort((x, y) => x - y);
  mixer.stopAllAction();
  mixer.uncacheRoot(root);

  return { name: clip.name, speed: Math.max(0.3, speeds[Math.floor(speeds.length / 2)] ?? 1), front, duration: clip.duration };
}
