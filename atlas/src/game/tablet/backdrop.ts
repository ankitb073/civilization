// The Tablet House backdrop: the besieged city at the scenario's year, low over the 3D relief with that year's state
// colours, its time of day and weather set by the game's beat. A painted version shows at once (and stays when WebGL
// is not available); the 3D scene (three.js, lazily loaded) fades in over it.
//
//   const bd = await mountBackdrop(el, scenario, 'muster');
//   bd.setBeat('field');   // … 'walls', 'fall-sack' | 'fall-treaty' | 'held', 'tablet', 'ending'
//   bd.dispose();
//
// `el` should be sized (the backdrop fills it, absolutely positioned). Reduced motion gives still frames.

import { BEATS, css, hex, lookFor, type Beat, type Look, type RGB } from './backdrop/looks.ts';
import { Painted } from './backdrop/painted.ts';
import type { BackdropScenario } from './backdrop/scenario.ts';
import type { GlBackdrop, GlStats } from './backdrop/gl.ts';
import type { Scenario as ContractScenario } from '../../../../engine/src/export/contract.ts';
import { ensureMapData } from '../../store.ts';
import '../../styles/backdrop.css';

export { BEATS };
export type { Beat, BackdropScenario };

// scenarios.json entries go in as they are
const _fits = (s: ContractScenario): BackdropScenario => s;
void _fits;

export interface BackdropOptions {
  /** Defaults to the user's prefers-reduced-motion. */
  reducedMotion?: boolean;
  /** Phone budget (smaller shadow map, fewer blocks and particles, lower pixel ratio). Defaults to a ≤ 767 px viewport. */
  mobile?: boolean;
  /** false: the painted backdrop only. */
  webgl?: boolean;
  /** Abort the 3D load (the promise still resolves, with the painted backdrop). */
  signal?: AbortSignal;
}

export interface Backdrop {
  setBeat(beat: Beat, opts?: { instant?: boolean }): void;
  dispose(): void;
  /** 'webgl' once the 3D scene is up, 'painted' otherwise. */
  readonly mode: 'webgl' | 'painted';
  readonly beat: Beat;
  /** Frame timings and the pixel ratio, for probes (null without WebGL). */
  readonly stats: GlStats | null;
  /** Draw one frame now at scene time `t` seconds (captures and tests). */
  renderAt(t: number): void;
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const ok = !!gl;
    (gl?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    return ok;
  } catch { return false; }
}

export async function mountBackdrop(el: HTMLElement, scenario: BackdropScenario, beat: Beat, options: BackdropOptions = {}): Promise<Backdrop> {
  const reducedMotion = options.reducedMotion ?? (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const mobile = options.mobile ?? (typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767px)').matches);
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

  const root = document.createElement('div');
  root.className = `bd${reducedMotion ? ' bd--still' : ''}`;
  root.setAttribute('aria-hidden', 'true');
  el.appendChild(root);
  const painted = new Painted(root, scenario);
  const glLayer = document.createElement('div');
  glLayer.className = 'bd__gl';
  root.appendChild(glLayer);
  const over = (cls: string) => { const d = document.createElement('div'); d.className = cls; root.appendChild(d); return d; };
  const tint = over('bd__tint');
  const lamp = over('bd__lamp');
  const vig = over('bd__vig');

  let cur: Beat = beat;
  let lastOutdoor: Beat | null = beat === 'tablet' || beat === 'ending' ? null : beat;
  let gl: GlBackdrop | null = null;
  let disposed = false;
  let mode: 'webgl' | 'painted' = 'painted';

  const grade = (l: Look, instant: boolean) => {
    root.classList.toggle('bd--instant', instant || reducedMotion);
    const f: string[] = [];
    if (l.blur > 0.05) f.push(`blur(${l.blur.toFixed(1)}px)`);
    if (Math.abs(l.bright - 1) > 0.01) f.push(`brightness(${l.bright.toFixed(2)})`);
    if (Math.abs(l.sat - 1) > 0.01) f.push(`saturate(${l.sat.toFixed(2)})`);
    const filter = f.length ? f.join(' ') : 'none';
    for (const layer of [glLayer, root.querySelector<HTMLElement>('.bd__paint')!]) {
      layer.style.filter = filter;
      layer.style.transform = l.blur > 0.05 ? 'scale(1.04)' : '';
    }
    tint.style.background = css(l.tint);
    tint.style.opacity = l.tintK.toFixed(3);
    lamp.style.opacity = l.lamp.toFixed(3);
    vig.style.color = css(l.vignetteColor);
    vig.style.opacity = l.vignette.toFixed(3);
    root.dataset.beat = cur;
  };

  // before the fall the city stands as it was the year before; from the fall on, as the record has it that year
  const after = (b: Beat) => b !== 'muster' && b !== 'field' && b !== 'walls';
  const apply = (b: Beat, instant: boolean) => {
    const l = lookFor(b, scenario.outcome, lastOutdoor);
    painted.setLook(l, instant || reducedMotion);
    grade(l, instant);
    gl?.setLook(l, instant, after(b));
  };

  const handle: Backdrop = {
    setBeat(b: Beat, opts?: { instant?: boolean }) {
      if (disposed || !BEATS.includes(b)) return;
      if (b === cur && !opts?.instant) return;
      cur = b;
      apply(b, !!opts?.instant);
      if (b !== 'tablet' && b !== 'ending') lastOutdoor = b;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gl?.dispose();
      painted.dispose();
      root.remove();
    },
    get mode() { return mode; },
    get beat() { return cur; },
    get stats() { return gl?.stats ?? null; },
    renderAt(t: number) { gl?.renderFrame(performance.now(), t); },
  };

  apply(beat, true);
  // the state colours of the year for the painting, once the map is in
  void ensureMapData().then((d) => {
    if (disposed) return;
    const own = d.layers.political;
    const col = (id: string): RGB | null => {
      const idx = d.timeline.polities.find((p) => p.id === id)?.idx;
      const c = idx === undefined ? undefined : own.byIdx.get(idx)?.color;
      return c ? hex(c) : null;
    };
    painted.setColors({ ours: col(scenario.state.id), theirs: col(scenario.enemy.id) });
  }).catch(() => {});

  if (options.webgl !== false && webglAvailable()) {
    try {
      const { GlBackdrop } = await import('./backdrop/gl.ts');
      if (!disposed && !options.signal?.aborted) {
        const g = await GlBackdrop.create(glLayer, scenario, lookFor(cur, scenario.outcome, lastOutdoor), { reducedMotion, mobile });
        if (disposed || options.signal?.aborted) g.dispose();
        else {
          gl = g;
          gl.setLook(lookFor(cur, scenario.outcome, lastOutdoor), true, after(cur));
          mode = 'webgl';
          // fade the 3D in over the painting
          if (!reducedMotion) root.classList.remove('bd--instant');
          requestAnimationFrame(() => root.classList.add('bd--3d'));
        }
      }
    } catch (e) {
      console.warn('backdrop: 3D unavailable, keeping the painted backdrop', e);
    }
  }
  return handle;
}
