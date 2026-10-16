// The game's side of the procedural soundscape (atlas/src/audio/soundscape.ts): off until the player taps "Sound on",
// then the day's beat sets the mix and each wedge pressed gives a stylus click. The module is loaded ahead of the tap
// (browsers, iOS above all, only let audio start inside the gesture itself), and the game works the same without it.
import type { SceneBeat } from './stage.tsx';

interface Soundscape {
  start(): Promise<void> | void;
  stop(): void;
  dispose(): void;
  setMuted(m: boolean): void;
  setBeat(beat: SceneBeat, intensity?: number): void;
  stylus?(): void; seal?(): void; pageTurn?(): void; door?(): void;
}
type Create = (o: { seed: string | number; muted?: boolean; context?: BaseAudioContext }) => Soundscape;
const mods = import.meta.glob<{ createSoundscape?: Create }>('../../audio/soundscape.ts');
const load = Object.values(mods)[0];
let createP: Promise<Create | null> | null = null;
let create: Create | null = null;
export const soundAvailable = () => !!load;
/** Fetch the soundscape's code early, so "Sound on" can start it synchronously inside the tap. */
export function preloadSound(): Promise<Create | null> {
  if (!createP) createP = load ? load().then((m) => (create = m.createSoundscape ?? null)).catch(() => null) : Promise.resolve(null);
  return createP;
}

/** Turns the soundscape on and off and passes the game's moments to it. Every call is safe without audio. */
export class Sound {
  private sc: Soundscape | null = null;
  on = false;
  private beat: SceneBeat = 'muster';
  private seed: string;
  constructor(seed: string) { this.seed = seed; void preloadSound(); }

  private want = false;
  /** A context unlocked inside the tap itself, when the soundscape's code was still loading (iOS needs the gesture). */
  private ctx: AudioContext | null = null;
  /** Call from the click itself. One-shots before the sounds are built are silent no-ops, so `on` is set at once. */
  async enable(beat: SceneBeat): Promise<boolean> {
    this.beat = beat;
    this.want = true;
    this.on = true;
    if (!create) {
      try { this.ctx ??= new AudioContext({ latencyHint: 'balanced' }); void this.ctx.resume(); } catch { /* no WebAudio */ }
      await preloadSound();
    }
    if (!create || !this.want) { this.on = false; return false; }
    try {
      if (!this.sc) this.sc = create({ seed: this.seed, muted: false, ...(this.ctx ? { context: this.ctx } : {}) });
      this.sc.setBeat(beat);
      const p = this.sc.start();
      this.sc.setMuted(false);
      await p;
      // switched off again while it was starting
      if (!this.want) this.sc.stop();
    } catch { this.on = false; }
    return this.on;
  }
  disable() {
    this.want = false;
    this.on = false;
    try { this.sc?.stop(); } catch { /* already stopped */ }
  }
  dispose() {
    this.want = false;
    this.on = false;
    try { this.sc?.dispose(); } catch { /* gone */ }
    try { void this.ctx?.close(); } catch { /* gone */ }
    this.sc = null;
    this.ctx = null;
  }
  setBeat(beat: SceneBeat) {
    if (beat === this.beat) return;
    this.beat = beat;
    try { this.sc?.setBeat(beat); } catch { /* ignore */ }
  }
  cue(name: 'stylus' | 'seal' | 'page' | 'door' | 'fire') {
    if (!this.on || !this.sc) return;
    try {
      if (name === 'stylus') this.sc.stylus?.();
      else if (name === 'seal') this.sc.seal?.();
      else if (name === 'page') this.sc.pageTurn?.();
      else if (name === 'door') this.sc.door?.();
    } catch { /* ignore */ }
  }
}
