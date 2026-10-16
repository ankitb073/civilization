// #/streets[?city=set:N&y=YEAR | ?sc=sc-N] — the Streets movement spike: a runner of the palace tablet house in a city
// of the record, in the week of its siege (lazy-loaded; three.js and Rapier live in this route's chunks). Defaults to
// the Tablet House's model scenario, sc-18225 (Nodoruegeremo, AY 2234).

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ScenariosJson } from '../../../../engine/src/export/contract.ts';
import { fetchJson } from '../../data.ts';
import { reducedMotion, route } from '../../state.ts';
import { StreetsGame } from './game.ts';
import './streets.css';

const DEFAULT_SC = 'sc-18225';
const FALLBACK = { city: 'set:151', year: 2234 };
const HINT_KEY = 'pal-streets-hint-v1';

async function pickCity(params: URLSearchParams): Promise<{ city: string; year: number; scenario: string | null; enemy: string | null }> {
  const city = params.get('city');
  const y = Number(params.get('y'));
  if (city && /^set:\d+$/.test(city)) return { city, year: Number.isFinite(y) && params.has('y') ? y : FALLBACK.year, scenario: null, enemy: null };
  const want = params.get('sc') ?? DEFAULT_SC;
  try {
    const j = await fetchJson<ScenariosJson>('scenarios.json');
    const sc = j.scenarios.find((s) => s.id === want) ?? j.scenarios.find((s) => s.id === DEFAULT_SC) ?? j.scenarios[0];
    if (sc) return { city: sc.city.id, year: params.has('y') && Number.isFinite(y) ? y : sc.year, scenario: sc.id, enemy: sc.enemy.name };
  } catch { /* no scenarios export: the model scenario's city */ }
  return { ...FALLBACK, scenario: null, enemy: null };
}

function readHint(): boolean {
  try { return localStorage.getItem(HINT_KEY) !== '1'; } catch { return true; }
}
function saveHint() {
  try { localStorage.setItem(HINT_KEY, '1'); } catch { /* storage blocked: the hint shows again next time */ }
}

export function StreetsView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const jumpRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState('Opening the city gate…');
  const [failed, setFailed] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState<{ name: string; year: number; enemy: string | null } | null>(null);
  const [hint, setHint] = useState(readHint);
  const [locked, setLocked] = useState(false);
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const mobile = touch || (typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767px)').matches);
  const showStats = route.peek().params.get('stats') === '1';
  const [fps, setFps] = useState('');

  useEffect(() => {
    const wrap = wrapRef.current!, canvas = canvasRef.current!;
    let dead = false;
    let game: StreetsGame;
    try {
      game = new StreetsGame(canvas, { root: wrap, joyBase: baseRef.current, joyKnob: knobRef.current, jumpBtn: jumpRef.current }, { mobile, touch, reducedMotion });
    } catch (e) {
      setFailed(`This needs WebGL, which this browser could not start (${String((e as Error)?.message ?? e)}).`);
      return;
    }
    (window as unknown as { __palimpsestStreets?: StreetsGame }).__palimpsestStreets = game;
    const ro = new ResizeObserver(() => game.resize(wrap.clientWidth, wrap.clientHeight));
    ro.observe(wrap);
    game.resize(wrap.clientWidth, wrap.clientHeight);
    game.input.onUse = () => { if (!dead) { setHint(false); saveHint(); } };
    const onLock = () => setLocked(document.pointerLockElement === canvas);
    document.addEventListener('pointerlockchange', onLock);
    (async () => {
      const pick = await pickCity(route.peek().params);
      await game.load(pick.city, pick.year, (s) => { if (!dead) setStep(s); });
      if (dead) return;
      const cy = game.city!.cy;
      setTitle({ name: cy.name, year: cy.year, enemy: pick.enemy });
      document.title = `Streets of ${cy.name}, AY ${cy.year} — Palimpsest`;
      game.start();
      setReady(true);
    })().catch((e) => { if (!dead) setFailed(String((e as Error)?.message ?? e)); });
    let statsT = 0;
    if (showStats) {
      statsT = window.setInterval(() => {
        const f = game.stats.frame.slice(-60);
        if (!f.length) return;
        const avg = f.reduce((a, b) => a + b, 0) / f.length;
        const i = game.info();
        setFps(`${(1000 / avg).toFixed(0)} fps · ${i.calls} draws · ${(i.triangles / 1000).toFixed(0)}k tris · ${i.pose} ${i.speed.toFixed(1)} m/s`);
      }, 500);
    }
    return () => {
      dead = true;
      clearInterval(statsT);
      ro.disconnect();
      document.removeEventListener('pointerlockchange', onLock);
      game.dispose();
      const w = window as unknown as { __palimpsestStreets?: StreetsGame };
      if (w.__palimpsestStreets === game) delete w.__palimpsestStreets;
    };
  }, []);

  const dismiss = () => { setHint(false); saveHint(); };

  return (
    <section class={`st${touch ? ' st--touch' : ''}${ready ? ' is-ready' : ''}`} aria-labelledby="st-title">
      <h1 id="st-title" class="sr-only">{title ? `Streets of ${title.name}, AY ${title.year}` : 'Streets'}</h1>
      <div
        ref={wrapRef}
        class="st__stage"
        role="application"
        aria-label={title ? `The streets of ${title.name} in AY ${title.year}, seen over the runner's shoulder` : 'The streets of a city of the record'}
        aria-describedby="st-controls"
      >
        <canvas ref={canvasRef} class="st__canvas" />
        <div ref={baseRef} class="st-joy" aria-hidden="true"><div ref={knobRef} class="st-joy__knob" /></div>
        <button ref={jumpRef} type="button" class="st-jump" aria-label="Jump">
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 19V6M6.5 11 12 5.5 17.5 11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </div>

      <header class="st-hud">
        <a class="st-hud__back" href="#/tablet" aria-label="Back to the Tablet House">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </a>
        {title && (
          <p class="st-hud__where">
            <span class="st-hud__city">{title.name}</span>
            <span class="st-hud__when">AY {title.year}{title.enemy ? ` · ${title.enemy} at the walls` : ''}</span>
          </p>
        )}
      </header>
      {showStats && fps && <p class="st-stats" aria-live="off">{fps}</p>}

      <p id="st-controls" class="sr-only">
        {touch
          ? 'Drag on the left half to move; push the stick to its edge to run. Drag on the right half to look around. The jump button jumps.'
          : 'W, A, S and D or the arrow keys move; hold Shift to run; Space jumps. Click the scene to look around with the mouse; Escape releases it.'}
      </p>

      {ready && hint && (
        <div class="st-hint" role="dialog" aria-labelledby="st-hint-t">
          <p id="st-hint-t" class="st-hint__t">You carry the palace’s tablets</p>
          {touch ? (
            <ul class="st-hint__keys">
              <li><b>Left thumb</b> move — push to the edge to run</li>
              <li><b>Right thumb</b> drag to look</li>
              <li><b>Jump</b> button, bottom right</li>
            </ul>
          ) : (
            <ul class="st-hint__keys">
              <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</li>
              <li><kbd>Shift</kbd> run · <kbd>Space</kbd> jump</li>
              <li>Click to look with the mouse · <kbd>Esc</kbd> lets go</li>
            </ul>
          )}
          <button type="button" class="st-hint__ok" onClick={dismiss}>Got it</button>
        </div>
      )}
      {!touch && ready && !hint && !locked && <p class="st-tip">Click to look around</p>}

      {!ready && !failed && (
        <div class="st-load" role="status"><div class="spinner" /> {step}</div>
      )}
      {failed && (
        <div class="st-load st-load--err" role="alert">
          Couldn’t open the streets: {failed} <a href="#/tablet">Back to the Tablet House</a>
        </div>
      )}
    </section>
  );
}
