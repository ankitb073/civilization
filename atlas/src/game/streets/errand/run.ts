// Runner of the Tablet House: an errand, live. Binds the pure errand (engine.ts) to the game: it finds the errand's
// places in the world (by the names world/names.ts gives them), stands the levy at the gate, feeds every fixed step
// of the game to the engine (the horn counts in the game's own clock), freezes the runner while people speak, turns
// the view to whoever speaks, gives the sound its cues, and keeps the runner's record in the browser. The view
// (ErrandView.tsx) shows the phase it is in and calls back here. Probes: window.__palimpsestErrand.
import { type Scene, Vector3 } from 'three';
import type { ArmsSpec } from '../../../../../engine/src/export/contract.ts';
import type { Pick, Scenario } from '../../tablet/types.ts';
import type { TabletScript } from '../../tablet/script.ts';
import type { Place } from '../affordances.ts';
import type { StreetsGame } from '../game.ts';
import type { StreetsSound } from '../sound.ts';
import { unit } from '../../../three/city/record.ts';
import { placeName, type Errand, type StreetsScript } from './script.ts';
import * as R from './engine.ts';
import { buildLevy, type Levy } from './levy.ts';

const SAVE_KEY = 'pal-streets-errands-v1';
/** Feet more than this above the ground there (and not over water: a bridge's deck) are on a roof or a wall. */
const HIGH = 2.0;

export interface ErrandSnapshot {
  phase: R.Phase | 'free';
  st: R.RunState;
  words: R.Words;
  pressed: ReturnType<typeof R.pressedWords> | null;
  arrival: ReturnType<typeof R.arrivalWords> | null;
  card: R.EndCard | null;
  saved: R.Saved;
  /** The last thing the view should announce (a polite live region), and a counter so a repeat still speaks. */
  notice: { text: string; n: number; kind: 'warn' | 'horn' | 'info' } | null;
  replay: boolean;
  /** The best time before this run (to say when a run beats it). */
  prevBest: number | null;
}

function readSaved(scenario: string, errand: string): R.Saved {
  try {
    const all = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}') as Record<string, Record<string, R.Saved>>;
    return { ...R.EMPTY_SAVED, ...(all[scenario]?.[errand] ?? {}) };
  } catch { return { ...R.EMPTY_SAVED }; }
}
function writeSaved(scenario: string, errand: string, v: R.Saved) {
  try {
    const all = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}') as Record<string, Record<string, R.Saved>>;
    all[scenario] = { ...(all[scenario] ?? {}), [errand]: v };
    localStorage.setItem(SAVE_KEY, JSON.stringify(all));
  } catch { /* storage blocked: the record lasts this visit only */ }
}

export class ErrandRun {
  readonly errand: Errand;
  readonly from: Place;
  readonly to: Place;
  readonly levy: Levy;
  /** Who speaks: the overseer at the door of the house, the commander before the levy, the gatekeeper inside the gate. */
  readonly overseerAt: Vector3;
  readonly gatekeeperAt: Vector3;
  private snap: ErrandSnapshot;
  private subs = new Set<(s: ErrandSnapshot) => void>();
  private home: { x: number; z: number; facing: number };
  private firstLeg: Vector3;
  /** Milliseconds to stand the levy up (for the probes). */
  readonly levyMs: number;
  private hornPlayed = false;
  private noticeN = 0;
  private prevHook: Scene['onBeforeRender'];
  private lastFrame = 0;
  readonly game: StreetsGame;
  private s: Scenario;
  private th: TabletScript;
  private sound: StreetsSound | null;
  private reduced: boolean;

  constructor(game: StreetsGame, s: Scenario, th: TabletScript, script: StreetsScript, o: { sound: StreetsSound | null; reduced: boolean; arms: ArmsSpec | null }) {
    this.game = game; this.s = s; this.th = th; this.sound = o.sound; this.reduced = o.reduced;
    const e = script.errands[0];
    this.errand = e;
    const city = game.city!;
    const places = city.affordances.places;
    const find = (key: Errand['from']) => {
      const name = placeName(s.id, key);
      const p = name ? places.find((x) => x.name === name) : null;
      if (!p) throw new Error(`the errand "${e.id}" goes to ${name ?? key}, which this world does not have`);
      return p;
    };
    this.from = find(e.from);
    this.to = find(e.to);
    // the gate's axis: the world's gate nearest the place
    const gates = city.layer.civ.gates;
    const g = gates.slice().sort((a, b) => Math.hypot(a.inner.x - this.to.pos.x, a.inner.z - this.to.pos.z) - Math.hypot(b.inner.x - this.to.pos.x, b.inner.z - this.to.pos.z))[0];
    const phys = game.phys!;
    const ground = (x: number, z: number) => phys.groundAt(x, z, city.heightAt(x, z) + 2.5) ?? city.heightAt(x, z);
    const owner = city.cy.owner ?? -1;
    const t0 = performance.now();
    this.levy = buildLevy({
      inner: { x: this.to.pos.x, z: this.to.pos.z }, ang: g ? g.ang : Math.atan2(this.to.pos.z, this.to.pos.x),
      ground,
      free: (x, z) => { const gy = ground(x, z); return Math.abs(gy - city.heightAt(x, z)) < 0.6 && phys.free(x, gy + 0.02, z); },
      water: city.affordances.waterDepthAt,
      arms: o.arms,
      fallbackColour: city.rec.polities[owner]?.color ?? '#8e2f1f',
      u: (label) => unit(`${city.rec.id}:errand:${e.id}:${label}`),
      mobile: game.touch,
    });
    city.root.add(this.levy.group);
    this.levyMs = Math.round((performance.now() - t0) * 10) / 10;
    const role = (r: string, near: Place) => {
      const p = city.layer.civ.people.filter((x) => x.role === r).sort((a, b) => Math.hypot(a.x - near.pos.x, a.z - near.pos.z) - Math.hypot(b.x - near.pos.x, b.z - near.pos.z))[0];
      return p ? new Vector3(p.x, p.y, p.z) : near.pos.clone();
    };
    this.overseerAt = role('overseer', this.from);
    this.gatekeeperAt = role('gatekeeper', this.to);
    const f = game.phys!.feet();
    this.home = { x: f.x, z: f.z, facing: game.cam.yaw };
    // the first stretch of the way out of the door (the gate starts behind the runner): the view turns to it on leaving
    const way = city.layer.route(this.from.pos, this.to.pos, 3);
    const p = way?.pts[Math.min(3, (way?.pts.length ?? 1) - 1)];
    this.firstLeg = p ? new Vector3(p.x, 0, p.z) : this.to.pos.clone();
    const saved = readSaved(s.id, e.id);
    this.snap = {
      phase: 'brief', st: R.newRun(), words: R.words(s, th, e), pressed: null, arrival: null, card: null, saved, notice: null, replay: false, prevBest: saved.best,
    };
    game.onStep = (x) => this.onStep(x);
    // the levy marches in the frame loop (before each render)
    const scene = game.scene;
    this.prevHook = scene.onBeforeRender;
    const levy = this.levy;
    const self = this;
    scene.onBeforeRender = function (...args) {
      self.prevHook.apply(this, args);
      const now = performance.now();
      const dt = self.lastFrame ? Math.min(0.1, (now - self.lastFrame) / 1000) : 0;
      self.lastFrame = now;
      levy.tick(dt);
    };
    (window as unknown as { __palimpsestErrand?: ErrandRun }).__palimpsestErrand = this;
  }

  // ------------------------------------------------------------------ state for the view
  get state(): ErrandSnapshot { return this.snap; }
  subscribe(fn: (s: ErrandSnapshot) => void): () => void { this.subs.add(fn); fn(this.snap); return () => this.subs.delete(fn); }
  private set(p: Partial<ErrandSnapshot>) {
    this.snap = { ...this.snap, ...p };
    if (p.st && this.snap.phase !== 'free') this.snap.phase = p.st.phase;
    for (const f of this.subs) f(this.snap);
  }
  private notice(text: string, kind: 'warn' | 'horn' | 'info') { this.set({ notice: { text, kind, n: ++this.noticeN } }); }

  /** Seconds left before the horn and seconds since the door (live, for the HUD). */
  hornLeft(): number | null { return R.hornLeft(this.snap.st, this.game.time); }
  runTime(): number | null { return R.runTime(this.snap.st, this.game.time); }

  // ------------------------------------------------------------------ the phases
  /** At the door of the house: the overseer speaks; the runner stands. */
  begin() {
    this.hold(true);
    this.game.face(this.overseerAt.x, this.overseerAt.z, 0.2);
    this.sound?.setBeat('tablet');
    this.set({ st: R.newRun(), phase: 'brief' });
  }
  toChoose() { this.set({ st: R.toChoose(this.snap.st) }); }
  choose(pick: Pick) {
    const st = R.choose(this.snap.st, pick);
    if (st === this.snap.st) return;
    this.set({ st, pressed: R.pressedWords(this.s, this.th, this.errand, pick) });
  }
  /** The seal rolled along the edge (the view calls it when the figure is pressed). */
  sealed() { this.sound?.cue('seal'); }
  /** Out of the door: the horn starts counting, the runner is free. */
  leave() {
    const st = R.leave(this.snap.st, this.errand, this.game.time);
    if (st === this.snap.st) return;
    this.hornPlayed = false;
    this.sound?.cue('door');
    this.sound?.setBeat('muster', 0.45);
    this.hold(false);
    this.game.face(this.firstLeg.x, this.firstLeg.z, 0.18);
    this.set({ st });
    this.notice(this.snap.words.objective, 'info');
  }
  /** After the arrival: the end card. In time, the horn sounds now and the levy goes out through the gate. */
  finish() {
    const st = R.finish(this.snap.st);
    if (st === this.snap.st) return;
    if (st.inTime) this.sounded(false);
    const card = R.endCard(this.s, this.th, this.errand, st);
    const prevBest = this.snap.saved.best;
    const saved = R.record(this.snap.saved, card);
    writeSaved(this.s.id, this.errand.id, saved);
    this.sound?.setBeat('ending');
    this.set({ st, card, saved, prevBest });
  }
  /** "Run it again": the levy back in its ranks, the runner back at the door, a fresh tablet. */
  again() {
    this.levy.reset();
    this.hornPlayed = false;
    this.game.teleport(this.home.x, this.home.z, this.home.facing);
    this.game.cam.yaw = this.home.facing;
    this.hold(true);
    this.game.face(this.overseerAt.x, this.overseerAt.z, 0.2);
    this.sound?.setBeat('tablet');
    this.set({ st: R.newRun(true), phase: 'choose', pressed: null, arrival: null, card: null, replay: true, notice: null });
  }
  /** "Back to the city": the errand is done; the runner is free to go anywhere. */
  release() {
    this.hold(false);
    this.sound?.setBeat('muster');
    this.set({ phase: 'free' });
  }

  /** Probes only: bring the horn to `left` seconds from now (to play the case of missing it without waiting). */
  debugHorn(left: number) {
    const st = this.snap.st;
    if (st.phase !== 'run' || st.hornAt === null) return;
    const hornAt = this.game.time + left;
    this.snap = { ...this.snap, st: { ...st, hornAt, left: hornAt - this.errand.horn.seconds, warned: left <= this.errand.horn.warn } };
  }

  private hold(on: boolean) {
    this.game.frozen = on;
    this.game.input.enabled = !on;
    if (!on) this.game.cam.fit(this.game.camera.aspect);
  }

  /** The horn: its sound (near or far off) and the levy marching out at it (seen only from near: from far off, or
   *  with reduced motion, it is simply gone by the time the runner gets there). */
  private sounded(farOff: boolean) {
    if (this.hornPlayed) return;
    this.hornPlayed = true;
    this.sound?.horn(farOff);
    this.levy.march(this.reduced || farOff);
  }

  private onStep(x: { now: number; moved: number; feet: { x: number; y: number; z: number }; grounded: boolean }) {
    const st0 = this.snap.st;
    if (st0.phase !== 'run' && !((st0.phase === 'arrive' || st0.phase === 'end') && !st0.horn)) return;
    const city = this.game.city!;
    const f = x.feet;
    const lift = f.y - city.heightAt(f.x, f.z);
    const high = lift > HIGH && city.affordances.waterDepthAt(f.x, f.z) <= 0;
    const there = Math.hypot(f.x - this.to.pos.x, f.z - this.to.pos.z) < this.to.radius && lift < 2.5;
    const { st, cues } = R.step(st0, this.errand, { now: x.now, moved: x.moved, high, there });
    if (st === st0) return;
    // the run grows urgent as the horn nears (the beat's intensity)
    if (st.phase === 'run' && st.hornAt !== null) {
      const left = st.hornAt - x.now;
      this.sound?.setBeat('muster', st.horn ? 0.9 : 0.45 + 0.5 * Math.max(0, Math.min(1, 1 - left / this.errand.horn.seconds)));
    }
    // quietly (the view reads the clock and the route itself each frame); phases and cues are announced
    this.snap = { ...this.snap, st, phase: this.snap.phase === 'free' ? 'free' : st.phase };
    for (const c of cues) {
      if (c === 'warn') this.notice(`The horn soon: ${Math.round(this.errand.horn.warn)} seconds.`, 'warn');
      else if (c === 'horn') {
        if (st.phase === 'run') { this.sounded(Math.hypot(f.x - this.to.pos.x, f.z - this.to.pos.z) > 45); this.notice(`The horn. The levy is marching out of ${this.snap.words.destination.replace(/^The /, 'the ')}.`, 'horn'); }
        else this.sounded(false); // after an arrival: in time, the levy goes out at the horn; late, it already has
      } else if (c === 'arrive') {
        this.game.stopDriving(); // a scripted run ends at the gate too
        this.hold(true);
        const who = st.inTime ? this.levy.commander : this.gatekeeperAt;
        // the speaker above the panel: the view looks down a little more, from a little further back
        if (!st.inTime) this.levy.march(true); // the square is empty: the levy is out of sight on the road
        this.game.cam.want = this.game.touch ? 6.8 : 6;
        this.game.face(who.x, who.z, this.game.touch ? 0.46 : 0.3);
        this.sound?.setBeat('muster', 0.3);
        this.set({ st, arrival: R.arrivalWords(this.s, this.th, this.errand, st.pick ?? 'true', !!st.inTime) });
      }
    }
  }

  dispose() {
    if (this.game.onStep) this.game.onStep = null;
    this.game.scene.onBeforeRender = this.prevHook;
    this.game.city?.root.remove(this.levy.group);
    this.levy.dispose();
    this.hold(false);
    const w = window as unknown as { __palimpsestErrand?: ErrandRun };
    if (w.__palimpsestErrand === this) delete w.__palimpsestErrand;
  }
}
