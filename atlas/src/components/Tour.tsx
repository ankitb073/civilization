import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { freshLanding, playing, reducedMotion, setYear, yearEnd } from '../state.ts';
import { eraAt, meta } from '../store.ts';

/** A short, skippable flight through all five thousand years on first landing. */
export const touring = signal(false);
const DURATION = 9000;
const END_YEAR = 4990;

function seen(): boolean {
  try { return localStorage.getItem('pal-toured') === '1'; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem('pal-toured', '1'); } catch { /* storage blocked */ }
}

export function startTour() {
  if (reducedMotion) return;
  playing.value = false;
  touring.value = true;
}

/** Call once the map has drawn: starts the tour for first-time visitors. */
export function maybeAutoTour() {
  if (freshLanding && !seen() && !reducedMotion && !/clean=1/.test(location.hash)) startTour();
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function TourOverlay() {
  const [eraName, setEraName] = useState('');
  const [fade, setFade] = useState(0);
  const raf = useRef(0);
  const on = touring.value;
  const m = meta.value;

  useEffect(() => {
    if (!on) return;
    const t0 = performance.now();
    const end = Math.min(END_YEAR, yearEnd.peek());
    let lastEra = '';
    const stop = () => {
      cancelAnimationFrame(raf.current);
      touring.value = false;
      markSeen();
    };
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / DURATION);
      const y = Math.round(ease(t) * end);
      setYear(y);
      const e = eraAt(y);
      if (e && e.name !== lastEra) { lastEra = e.name; setEraName(e.name); setFade((f) => f + 1); }
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else setTimeout(stop, 900);
    };
    raf.current = requestAnimationFrame(tick);
    const interrupt = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key === 'Tab') return;
      stop();
    };
    window.addEventListener('pointerdown', interrupt, { capture: true });
    window.addEventListener('wheel', interrupt, { capture: true, passive: true });
    window.addEventListener('keydown', interrupt, { capture: true });
    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener('pointerdown', interrupt, { capture: true });
      window.removeEventListener('wheel', interrupt, { capture: true });
      window.removeEventListener('keydown', interrupt, { capture: true });
    };
  }, [on]);

  if (!on) return null;
  return (
    <div class="tour" aria-live="polite">
      <div class="tour__k">{m ? `Five thousand years of ${m.worldName}` : 'Five thousand years'}</div>
      <div class="tour__era" key={fade}>{eraName}</div>
      <button class="tour__skip" onClick={() => { touring.value = false; markSeen(); }}>Skip — let me explore</button>
    </div>
  );
}
