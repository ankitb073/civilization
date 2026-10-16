// Streets: input. Desktop: WASD or the arrow keys, Shift to run, Space to jump; the mouse looks around with pointer
// lock (click the scene; Esc releases), or by dragging when the lock is refused. Phones: a floating joystick on the
// left half (its rest place is bottom left; past ~80% of its reach the runner runs), drag on the right half to look,
// and a jump button. Everything lands in one small state the game reads each frame.

export interface Controls {
  /** Move axes, -1..1: x to the right, y forward (screen up). Magnitude 0..1. */
  mx: number;
  my: number;
  run: boolean;
  jumpHeld: boolean;
}

export interface InputEls {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  joyBase: HTMLElement | null;
  joyKnob: HTMLElement | null;
  jumpBtn: HTMLElement | null;
}

const JOY_R = 52;
const RUN_AT = 0.8;
const MOUSE_K = 0.0022;
const TOUCH_K = 0.0058;

export class Input {
  /** Accumulated look (radians) since the last read. */
  lookX = 0;
  lookY = 0;
  /** Jump presses not yet consumed. */
  jumps = 0;
  /** performance.now() of the last look input, for the camera's auto-follow. */
  lastLook = -1e9;
  /** First time the player moved or looked (for the hint). */
  onUse: (() => void) | null = null;
  locked = false;
  private keys = new Set<string>();
  private joy: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private looks = new Map<number, { x: number; y: number }>();
  private els: InputEls;
  private off: (() => void)[] = [];
  private used = false;
  /** An override for scripted runs: when set, it replaces the player's controls. */
  virtual: Controls | null = null;

  constructor(els: InputEls) {
    this.els = els;
    const on = <K extends keyof WindowEventMap>(t: EventTarget, k: K | string, f: (e: never) => void, o?: AddEventListenerOptions) => {
      t.addEventListener(k, f as EventListener, o);
      this.off.push(() => t.removeEventListener(k, f as EventListener, o));
    };
    on(window, 'keydown', (e: KeyboardEvent) => this.key(e, true));
    on(window, 'keyup', (e: KeyboardEvent) => this.key(e, false));
    on(window, 'blur', () => { this.keys.clear(); this.joy = null; this.looks.clear(); this.drawJoy(); });
    on(document, 'pointerlockchange', () => { this.locked = document.pointerLockElement === els.canvas; });
    on(document, 'mousemove', (e: MouseEvent) => {
      if (!this.locked) return;
      this.look(e.movementX * MOUSE_K, e.movementY * MOUSE_K);
    });
    on(els.root, 'pointerdown', (e: PointerEvent) => this.down(e));
    on(window, 'pointermove', (e: PointerEvent) => this.move(e));
    on(window, 'pointerup', (e: PointerEvent) => this.up(e));
    on(window, 'pointercancel', (e: PointerEvent) => this.up(e));
    on(els.root, 'contextmenu', (e: Event) => e.preventDefault());
    if (els.jumpBtn) {
      on(els.jumpBtn, 'pointerdown', (e: PointerEvent) => { e.preventDefault(); e.stopPropagation(); this.jumps++; this.jumpTouch = e.pointerId; this.markUsed(); });
      on(els.jumpBtn, 'click', (e: MouseEvent) => { if (e.detail === 0) { this.jumps++; this.markUsed(); } }); // keyboard activation
    }
    this.drawJoy();
  }
  private jumpTouch = -1;

  private markUsed() {
    if (this.used) return;
    this.used = true;
    this.onUse?.();
  }

  private look(dx: number, dy: number) {
    this.lookX += dx;
    this.lookY += dy;
    this.lastLook = performance.now();
    this.markUsed();
  }

  private key(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.code;
    const game = /^(Key[WASD]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right))$/.test(k);
    if (!game) return;
    // keep Space and the arrows from scrolling or pressing a focused button
    if (k === 'Space' || k.startsWith('Arrow')) e.preventDefault();
    if (down) {
      if (k === 'Space' && !this.keys.has(k)) this.jumps++;
      this.keys.add(k);
      this.markUsed();
    } else this.keys.delete(k);
  }

  private down(e: PointerEvent) {
    const { root, canvas } = this.els;
    if (e.target instanceof HTMLElement && e.target.closest('button, a, [role="dialog"]')) return;
    const r = root.getBoundingClientRect();
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      if (!this.locked && canvas.requestPointerLock) {
        try {
          const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
          p?.catch?.(() => {});
        } catch { /* refused: fall back to dragging */ }
      }
      this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }
    e.preventDefault();
    const x = e.clientX - r.left;
    if (x < r.width * 0.5 && !this.joy) {
      this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      this.markUsed();
      this.drawJoy();
    } else this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  private move(e: PointerEvent) {
    if (this.joy && e.pointerId === this.joy.id) {
      let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
      const d = Math.hypot(dx, dy);
      if (d > JOY_R) {
        // drag the base along when the thumb runs past the rim, so the stick never "sticks" at full tilt
        const k = (d - JOY_R) / d;
        this.joy.ox += dx * k; this.joy.oy += dy * k;
        dx = e.clientX - this.joy.ox; dy = e.clientY - this.joy.oy;
      }
      this.joy.x = dx / JOY_R;
      this.joy.y = -dy / JOY_R;
      this.drawJoy();
      return;
    }
    const l = this.looks.get(e.pointerId);
    if (!l) return;
    if (e.pointerType === 'mouse' && this.locked) { this.looks.delete(e.pointerId); return; }
    const k = e.pointerType === 'mouse' ? MOUSE_K * 1.6 : TOUCH_K;
    this.look((e.clientX - l.x) * k, (e.clientY - l.y) * k);
    l.x = e.clientX; l.y = e.clientY;
  }

  private up(e: PointerEvent) {
    if (this.joy && e.pointerId === this.joy.id) { this.joy = null; this.drawJoy(); }
    if (e.pointerId === this.jumpTouch) this.jumpTouch = -1;
    this.looks.delete(e.pointerId);
  }

  private drawJoy() {
    const { joyBase, joyKnob, root } = this.els;
    if (!joyBase || !joyKnob) return;
    if (this.joy) {
      const r = root.getBoundingClientRect();
      joyBase.style.left = `${this.joy.ox - r.left}px`;
      joyBase.style.top = `${this.joy.oy - r.top}px`;
      joyBase.style.bottom = 'auto';
      joyBase.classList.add('is-on');
      const m = Math.min(1, Math.hypot(this.joy.x, this.joy.y));
      joyBase.classList.toggle('is-run', m >= RUN_AT);
      joyKnob.style.transform = `translate(${(this.joy.x * JOY_R).toFixed(1)}px, ${(-this.joy.y * JOY_R).toFixed(1)}px)`;
    } else {
      joyBase.style.left = '';
      joyBase.style.top = '';
      joyBase.style.bottom = '';
      joyBase.classList.remove('is-on', 'is-run');
      joyKnob.style.transform = '';
    }
  }

  /** The controls now (keyboard and stick merged; the scripted override wins). */
  controls(): Controls {
    if (this.virtual) return this.virtual;
    const k = this.keys;
    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let my = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let run = k.has('ShiftLeft') || k.has('ShiftRight');
    if (mx || my) { const l = Math.hypot(mx, my); mx /= l; my /= l; }
    if (this.joy) {
      const m = Math.min(1, Math.hypot(this.joy.x, this.joy.y));
      const dead = 0.12;
      if (m > dead) {
        const s = Math.min(1, (m - dead) / (1 - dead)) / m;
        mx = this.joy.x * s; my = this.joy.y * s;
        run = m >= RUN_AT;
      }
    }
    return { mx, my, run, jumpHeld: k.has('Space') || this.jumpTouch >= 0 };
  }

  takeLook(): [number, number] {
    const out: [number, number] = [this.lookX, this.lookY];
    this.lookX = 0; this.lookY = 0;
    return out;
  }

  takeJumps(): number {
    const j = this.jumps;
    this.jumps = 0;
    return j;
  }

  releaseLock() { if (this.locked) document.exitPointerLock?.(); }

  dispose() {
    this.releaseLock();
    for (const f of this.off) f();
    this.off = [];
  }
}
