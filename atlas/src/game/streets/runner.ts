// Streets: the runner. A CC0 Quaternius character (Universal Base Characters) moved by clips from Quaternius's
// Universal Animation Library (atlas/public/game/streets/LICENSES.md). Clips blend with AnimationMixer crossfades.
// Each gait's ground speed is measured from the clip itself when the model loads (how fast the planted foot slides
// back), so the game can set the playback rate from the runner's real speed and the feet do not skate.

import {
  type AnimationAction, AnimationClip, AnimationMixer, Group, LoopOnce, LoopRepeat, type Material, type Mesh,
  type Object3D, Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const RUNNER_URL = `${import.meta.env.BASE_URL}game/streets/runner.glb`;

/** A looping gait and what the clip says about it. */
export interface Gait { name: string; speed: number; front: number; duration: number }

export type Pose = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'land' | 'roll';

const CLIPS = {
  idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop',
  jumpStart: 'Jump_Start', jumpLoop: 'Jump_Loop', jumpLand: 'Jump_Land', roll: 'Roll',
} as const;
/** A running leap: a second copy of the run clip, slowed through the float of its stride (legs split). */
const LEAP = 'Leap';
/** Where the run clip's float begins and ends, as a share of its cycle (both feet off the ground). */
const FLOAT = [0.21, 0.5];

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
    const leap = need(CLIPS.run).clone();
    leap.name = LEAP;
    this.actions.set(LEAP, this.mixer.clipAction(leap));
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
    for (const n of [CLIPS.idle, CLIPS.walk, CLIPS.run, CLIPS.sprint, CLIPS.jumpLoop, LEAP]) this.actions.get(n)!.setLoop(LoopRepeat, Infinity);
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

  private leap = false;
  private leapEnd = 0;

  /** The runner left the ground by jumping: at a run, a long stride through the air; from a walk or a stand, a hop. */
  jump(speed: number) {
    this.pose = 'jump';
    this.leap = speed > 3;
    if (this.leap) {
      // the float that follows the stride the runner is in (each cycle has two, one per foot), so the legs carry on
      const g = this.gaits.run, d = g.duration, half = d / 2;
      const run = this.act(CLIPS.run);
      const cur = this.current === run ? run.time : 0;
      let start = FLOAT[0] * d + 0.01 * d, end = FLOAT[1] * d;
      for (const off of [0, half, d]) {
        const a = FLOAT[0] * d + off, b = FLOAT[1] * d + off;
        if (cur < b - 0.12 * d) { start = Math.max(cur, a + 0.01 * d); end = b; break; }
      }
      if (start >= d) { start -= d; end -= d; }
      this.leapEnd = end;
      this.fadeTo(LEAP, 0.1, { time: start, rate: 0.3 });
    } else this.fadeTo(CLIPS.jumpStart, 0.08, { time: 0.07, rate: 1.15 });
  }

  /** Touched down after `air` seconds, having fallen `drop` metres, at a horizontal speed. */
  land(air: number, drop: number, speed: number) {
    if (air < 0.28 && drop < 0.9) { this.pose = 'fall'; this.locomote(speed, true); return; }
    if (speed > 2.6 && drop > 3.2) {
      this.pose = 'roll';
      this.fadeTo(CLIPS.roll, 0.08, { time: 0.12, rate: 1.35 });
      return;
    }
    if (speed > 2.2) {
      if (this.leap && this.pose === 'jump') {
        // out of the leap's float straight into the next stride
        this.pose = 'run';
        this.fadeTo(CLIPS.run, 0.12, { syncFrom: this.gaits.run, syncTo: this.gaits.run });
        return;
      }
      this.pose = 'fall'; this.locomote(speed, true); return;
    }
    this.pose = 'land';
    this.fadeTo(CLIPS.jumpLand, 0.06, { time: 0.03, rate: drop > 2 ? 1.1 : 1.7 });
  }

  /** The ground speed the feet show right now (the gait's measured speed × its playback rate), when walking or running. */
  footSpeed(): number | null {
    if (this.pose === 'walk') return this.act(CLIPS.walk).timeScale * this.gaits.walk.speed;
    if (this.pose === 'run') return this.act(CLIPS.run).timeScale * this.gaits.run.speed;
    return null;
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
  update(dt: number, s: { speed: number; grounded: boolean; vy: number; air: number; turn: number }) {
    this.poseT += dt;
    const p = this.pose;
    if (!s.grounded) {
      if (p === 'jump' && this.leap) {
        // a leap that becomes a fall (off a roof): arms up, legs reaching
        const a = this.act(LEAP);
        if (s.air > 0.85 || a.time > this.leapEnd) { this.pose = 'fall'; this.fadeTo(CLIPS.jumpLoop, 0.35, { time: 0.4 }); }
      } else if (p === 'jump') {
        const a = this.act(CLIPS.jumpStart);
        if (a.time > 0.42 || (s.vy < -2 && a.time > 0.25)) { this.pose = 'fall'; this.fadeTo(CLIPS.jumpLoop, 0.3, { time: 0.4 }); }
      } else if (p !== 'fall' && p !== 'roll' && s.air > 0.2) {
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
    } else this.locomote(s.speed);

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
