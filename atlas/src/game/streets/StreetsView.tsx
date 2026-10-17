// #/streets[?sc=sc-N | ?city=set:N][&y=YEAR][&sacked=1] — Runner of the Tablet House: a runner of the palace tablet
// house in a city of the record, in the week of its siege (lazy-loaded; three.js and Rapier live in this route's
// chunks). Defaults to Pumi, AY 332, the Sack of Himi (sc-919), on the eve of the sack (days 1–3); `sacked=1` shows the
// burnt city. The HUD: the city and the enemy, the place the runner is at, and a "Sound on" button (the Tablet House's
// soundscape, beat `muster`; muted until tapped on phones).

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Scenario, ScenariosJson } from '../../../../engine/src/export/contract.ts';
import { fetchJson } from '../../data.ts';
import { reducedMotion, route } from '../../state.ts';
import { Sound, soundAvailable } from '../tablet/sound.ts';
import { placeAt, type Place } from './affordances.ts';
import { StreetsGame } from './game.ts';
import { setWorldOptions } from './world.ts';
import './streets.css';
import './world/hud.css';

const DEFAULT_SC = 'sc-919';
const FALLBACK = { city: 'set:17', year: 332 };
const HINT_KEY = 'pal-streets-hint-v1';

interface Pick { city: string; year: number; scenario: Scenario | null }

async function pickCity(params: URLSearchParams): Promise<Pick> {
  const city = params.get('city');
  const y = Number(params.get('y'));
  const hasY = params.has('y') && Number.isFinite(y);
  let list: Scenario[] = [];
  try { list = (await fetchJson<ScenariosJson>('scenarios.json')).scenarios; } catch { /* no scenarios export */ }
  if (city && /^set:\d+$/.test(city)) {
    // a city by id: its scenario's names and arms when it has one at that year
    const year = hasY ? y : city === FALLBACK.city ? FALLBACK.year : list.find((s) => s.city.id === city)?.year ?? FALLBACK.year;
    return { city, year, scenario: list.find((s) => s.city.id === city && s.year === year) ?? null };
  }
  const want = params.get('sc') ?? DEFAULT_SC;
  const sc = list.find((s) => s.id === want) ?? list.find((s) => s.id === DEFAULT_SC) ?? list[0];
  if (sc) return { city: sc.city.id, year: hasY ? y : sc.year, scenario: sc };
  return { ...FALLBACK, scenario: null };
}

/** What the HUD says about where the runner is: a place, else a named quarter, else the river. */
interface Where { name: string; note: string | null; kind: string }
const KIND: Record<string, string> = {
  'tablet-house': 'Tablet house', palace: 'Palace', temple: 'Temple', market: 'Market', gate: 'Gate', walls: 'Walls', well: 'Well', house: 'House',
};

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
  const [where, setWhere] = useState<Where | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const sound = useRef<Sound | null>(null);
  const soundWanted = useRef(false);
  const soundTouched = useRef(false);
  const [hint, setHint] = useState(readHint);
  const [locked, setLocked] = useState(false);
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const mobile = touch || (typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767px)').matches);
  const showStats = route.peek().params.get('stats') === '1';
  const sackedView = route.peek().params.get('sacked') === '1';
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
    let whereT = 0;
    (async () => {
      const params = route.peek().params;
      const pick = await pickCity(params);
      const sc = pick.scenario;
      setWorldOptions({
        scenario: sc ? { id: sc.id, year: sc.year, outcome: sc.outcome, arms: sc.state.arms ?? null, cityName: sc.city.name } : null,
        sacked: params.get('sacked') === '1',
        reducedMotion,
      });
      sound.current = new Sound(sc?.id ?? pick.city);
      await game.load(pick.city, pick.year, (s) => { if (!dead) setStep(s); });
      if (dead) return;
      const c = game.city!;
      setTitle({ name: c.name, year: c.cy.year, enemy: sc?.enemy.name ?? null });
      document.title = `Runner of the Tablet House: ${c.name}, AY ${c.cy.year} — Palimpsest`;
      game.start();
      setReady(true);
      // where the runner is, a few times a second
      let last = '';
      whereT = window.setInterval(() => {
        const o = game.runner?.object.position;
        if (!o || !game.city) return;
        const w = whereOf(game.city.affordances.places, game.city.quarters, game.city.river, o.x, o.y, o.z);
        const k = w ? `${w.kind}|${w.name}|${w.note}` : '';
        if (k !== last) { last = k; setWhere(w); }
      }, 250);
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
      clearInterval(whereT);
      sound.current?.dispose();
      ro.disconnect();
      document.removeEventListener('pointerlockchange', onLock);
      game.dispose();
      const w = window as unknown as { __palimpsestStreets?: StreetsGame };
      if (w.__palimpsestStreets === game) delete w.__palimpsestStreets;
    };
  }, []);

  const dismiss = () => { setHint(false); saveHint(); };

  // sound: off until asked on phones; on a computer it starts with the first key or click, unless switched off
  const toggleSound = async () => {
    soundTouched.current = true;
    soundWanted.current = !soundWanted.current;
    setSoundOn(soundWanted.current);
    const s = sound.current;
    if (!s) return;
    if (!soundWanted.current) { s.disable(); return; }
    const ok = await s.enable('muster');
    if (!ok && soundWanted.current) { soundWanted.current = false; setSoundOn(false); }
  };
  useEffect(() => {
    if (!ready || touch || !soundAvailable()) return;
    const first = () => {
      window.removeEventListener('keydown', first, true);
      window.removeEventListener('pointerdown', first, true);
      if (!soundTouched.current && !soundWanted.current) void toggleSound();
    };
    const keyM = (e: KeyboardEvent) => { if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey) { e.preventDefault(); void toggleSound(); } };
    window.addEventListener('keydown', first, true);
    window.addEventListener('pointerdown', first, true);
    window.addEventListener('keydown', keyM);
    return () => {
      window.removeEventListener('keydown', first, true);
      window.removeEventListener('pointerdown', first, true);
      window.removeEventListener('keydown', keyM);
    };
  }, [ready]);

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
            <span class="st-hud__when">AY {title.year}{title.enemy ? (sackedView ? ` · after ${title.enemy} came` : ` · ${title.enemy} is coming`) : ''}</span>
          </p>
        )}
      </header>
      {ready && soundAvailable() && (
        <button
          type="button" class={`st-sound${soundOn ? ' is-on' : ''}`} onClick={() => void toggleSound()} aria-pressed={soundOn}
          aria-label={soundOn ? 'Sound off (M)' : 'Sound on (M)'}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />{soundOn ? <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /> : <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />}</svg>
          {touch && !soundOn && <span>Sound on</span>}
        </button>
      )}
      {ready && (
        <p class={`st-where${where ? ' is-on' : ''}`} aria-live="polite">
          {where && <><span class="st-where__kind">{where.kind}</span><span class="st-where__name">{where.name}</span>{where.note && <span class="st-where__note">{where.note}</span>}</>}
        </p>
      )}
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

function whereOf(places: Place[], quarters: { name: string; x: number; z: number; r: number }[], river: { name: string | null; edgeDist(x: number, z: number): number }, x: number, y: number, z: number): Where | null {
  const p = placeAt({ places, ladders: [], waterDepthAt: () => 0 }, x, z);
  if (p && Math.abs(p.pos.y - y) < 4.5) return { name: p.name, note: p.note ?? null, kind: KIND[p.kind] ?? '' };
  const q = quarters.find((qq) => Math.hypot(qq.x - x, qq.z - z) < qq.r);
  if (q) return { name: q.name, note: null, kind: 'Quarter' };
  if (river.name && river.edgeDist(x, z) < 7) return { name: `The ${river.name}`, note: null, kind: 'River' };
  return null;
}
