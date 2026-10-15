import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { freshLanding, playing, reducedMotion, setYear, yearEnd } from '../state.ts';
import { eraAt, meta } from '../store.ts';

/** A short, skippable flight through all five thousand years on first landing. */
export const touring = signal(false);
/** The first-visit "What is this?" card. */
export const explaining = signal(false);
function explainedBefore(): boolean {
  try { return localStorage.getItem('pal-explained') === '1'; } catch { return false; }
}
export function dismissExplainer() {
  explaining.value = false;
  try { localStorage.setItem('pal-explained', '1'); } catch { /* storage blocked */ }
}
function explainOnce() {
  if (!explainedBefore() && !/clean=1|og=1|frames=1/.test(location.hash)) explaining.value = true;
}
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
  if (!freshLanding || /clean=1/.test(location.hash)) return;
  if (!seen() && !reducedMotion) startTour();
  else explainOnce();
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
      if (!touring.peek()) return;
      touring.value = false;
      markSeen();
      explainOnce();
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
      <button class="tour__skip" onClick={() => { touring.value = false; markSeen(); explainOnce(); }}>Skip — let me explore</button>
    </div>
  );
}

/** "What is this?": three ways in, shown once after the first-visit tour. */
export function Explainer({ docs, warId, world }: { docs: number; warId?: string; world: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!explaining.value) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismissExplainer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [explaining.value]);
  if (!explaining.value) return null;
  return (
    <div class="explainer" role="dialog" aria-modal="false" aria-labelledby="explainer-t" tabIndex={-1} ref={ref}>
      <button class="btn-icon btn-icon--sm explainer__x" aria-label="Close" onClick={dismissExplainer}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      </button>
      <h2 id="explainer-t" class="explainer__t">What is this?</h2>
      <p class="explainer__p">
        <strong>{world}</strong> never existed. It was simulated decade by decade for five thousand years — and its archive holds{' '}
        {docs.toLocaleString('en-US')} documents, every one checked against what really happened.
      </p>
      <div class="explainer__ways">
        <a class="explainer__w" href="#/story" onClick={dismissExplainer}><span>Read</span>The story, in seven ages</a>
        {warId && <a class="explainer__w" href={`#/compare/${warId}`} onClick={dismissExplainer}><span>Compare</span>A war told twice</a>}
        <button class="explainer__w" onClick={() => { dismissExplainer(); void import('../extras.ts').then((m) => m.surprise()); }}><span>Open</span>A document at random</button>
      </div>
      <button class="linkish small explainer__map" onClick={dismissExplainer}>Or explore the map</button>
    </div>
  );
}
