// #/streets[?sc=sc-N | ?city=set:N][&y=YEAR][&sacked=1][&errand=0] — Runner of the Tablet House: a runner of the
// palace tablet house in a city of the record, in the week of its siege (lazy-loaded; three.js and Rapier live in this
// route's chunks). Defaults to Pumi, AY 332, the Sack of Himi (sc-919), on the eve of the sack (days 1–3); `sacked=1`
// shows the burnt city. The HUD: the city and the enemy, the place the runner is at, and a "Sound on" button (the
// Tablet House's soundscape; muted until tapped on phones). When the scenario has a streets script
// (streets-scripts/<id>.json) and its Tablet House script, the day's errand runs (errand/): the overseer hands the
// runner a tablet at the door of the house of tablets; `errand=0` leaves the city free.
// The look (decision 0033): with WebGPU, the realism look in a tier picked for the device (look/tiers.ts), else the
// classic look; `?look=classic|realism` and `?tier=desktop|desktop-medium|phone|phone-low` override it, and the HUD's
// Graphics menu changes it (kept in localStorage). The loading card shows each step and the shader compile's progress;
// after the first frame the textures stream in (a thin bar under the Graphics button), and a toast says when the
// game lowers its own quality because frames ran slow.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Scenario, ScenariosJson } from '../../../../engine/src/export/contract.ts';
import { fetchJson } from '../../data.ts';
import { reducedMotion, route } from '../../state.ts';
import { StreetsSound, soundAvailable } from './sound.ts';
import { placeAt, type Place } from './affordances.ts';
import { StreetsGame, type LoadProgress, type LookEvent } from './game.ts';
import { CHOICE_LABEL, CHOICE_NOTE, LOOK_CHOICES, pickLook, readChoice, saveChoice, type LookChoice, type LookPick, type TierName } from './look/tiers.ts';
import { setWorldOptions } from './world.ts';
import { normalizeScript, type TabletScript } from '../tablet/script.ts';
import { normalizeStreetsScript, type StreetsScript } from './errand/script.ts';
import { ErrandRun, type ErrandSnapshot } from './errand/run.ts';
import { ErrandView } from './errand/ErrandView.tsx';
import './streets.css';
import './world/hud.css';

// the scripts an errand plays from: the city's streets script and its Tablet House script (one lazy chunk each)
const STREETS_SCRIPTS = import.meta.glob<unknown>('../../../../streets-scripts/*.json', { import: 'default' });
const TABLET_SCRIPTS = import.meta.glob<unknown>('../../../../scenario-scripts/*.json', { import: 'default' });
const byId = (m: Record<string, () => Promise<unknown>>) => new Map(Object.entries(m).map(([p, f]) => [p.replace(/^.*\//, '').replace(/\.json$/, ''), f]));
const streetsLoader = byId(STREETS_SCRIPTS), tabletLoader = byId(TABLET_SCRIPTS);
async function loadErrandScripts(sc: Scenario): Promise<{ th: TabletScript; script: StreetsScript } | null> {
  const ls = streetsLoader.get(sc.id), lt = tabletLoader.get(sc.id);
  if (!ls || !lt) return null;
  try {
    const [rs, rt] = await Promise.all([ls(), lt()]);
    const th = normalizeScript(rt, sc), script = normalizeStreetsScript(rs, sc.id);
    return th && script ? { th, script } : null;
  } catch { return null; }
}

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
  const [progress, setProgress] = useState<number | null>(null);
  /** The look in use (classic, or realism in a tier), the player's choice, and the WebGPU start failing (a fresh
   *  canvas, classic). */
  const [look, setLook] = useState<{ look: 'classic' | 'realism'; tier: TierName | null; why: string } | null>(null);
  const [choice, setChoice] = useState<LookChoice>(readChoice);
  const [classicOnly, setClassicOnly] = useState(false);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [relight, setRelight] = useState<string | null>(null);
  const [stream, setStream] = useState<number | null>(null);
  const gameRef = useRef<StreetsGame | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState<{ name: string; year: number; enemy: string | null } | null>(null);
  const [where, setWhere] = useState<Where | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const sound = useRef<StreetsSound | null>(null);
  const [errand, setErrand] = useState<{ run: ErrandRun; s: Scenario; th: TabletScript } | null>(null);
  const [errandPhase, setErrandPhase] = useState<ErrandSnapshot['phase'] | null>(null);
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
    gameRef.current = game;
    (window as unknown as { __palimpsestStreets?: StreetsGame }).__palimpsestStreets = game;
    // the look: picked while the city loads (the GPU probe takes a moment); after a failed WebGPU start, classic
    const lookP: Promise<LookPick> = classicOnly
      ? Promise.resolve({ look: 'classic', tier: null, why: 'webgpu-failed', choice: readChoice(), gpu: null })
      : pickLook(route.peek().params, mobile);
    void lookP.then((p) => { if (!dead) setLook({ look: p.look, tier: p.tier, why: p.why }); });
    let toastT = 0;
    game.onLook = (e: LookEvent) => {
      if (dead) return;
      if (e.kind === 'relight') setRelight(e.reason === 'slow' ? `Lightening the graphics for this device…` : 'Relighting the streets…');
      else if (e.kind === 'ready' || e.kind === 'stepped') {
        setRelight(null);
        setLook((l) => (l ? { ...l, tier: e.tier } : l));
        if (e.kind === 'stepped' && e.tier) {
          setToast(`Graphics lowered to ${CHOICE_LABEL[e.tier]}: frames were running slow. Change it under Graphics.`);
          clearTimeout(toastT);
          toastT = window.setTimeout(() => setToast(null), 6000);
        }
      } else if (e.kind === 'stream') setStream(e.frac ?? 0);
      else if (e.kind === 'streamed') setStream(null);
    };
    const ro = new ResizeObserver(() => game.resize(wrap.clientWidth, wrap.clientHeight));
    ro.observe(wrap);
    game.resize(wrap.clientWidth, wrap.clientHeight);
    game.input.onUse = () => { if (!dead) { setHint(false); saveHint(); } };
    const onLock = () => setLocked(document.pointerLockElement === canvas);
    document.addEventListener('pointerlockchange', onLock);
    let whereT = 0;
    let run: ErrandRun | null = null;
    (async () => {
      const params = route.peek().params;
      const pick = await pickCity(params);
      const sc = pick.scenario;
      // the day's errand: the scenario's own city and year, before the sack, unless asked to leave the city free
      const errandP = sc && params.get('errand') !== '0' && params.get('sacked') !== '1' && pick.year === sc.year && pick.city === sc.city.id ? loadErrandScripts(sc) : Promise.resolve(null);
      // the realism look reads each kit part's surface from attributes the world writes when asked (world/kit.ts)
      const lk = await lookP;
      setWorldOptions({
        scenario: sc ? { id: sc.id, year: sc.year, outcome: sc.outcome, arms: sc.state.arms ?? null, cityName: sc.city.name } : null,
        sacked: params.get('sacked') === '1',
        reducedMotion,
        surfaceTags: lk.look === 'realism',
      });
      sound.current = new StreetsSound(sc?.id ?? pick.city);
      await game.load(pick.city, pick.year, undefined, lookP, (p: LoadProgress) => { if (!dead) { setStep(p.step); setProgress(p.frac); } });
      if (dead) return;
      const c = game.city!;
      setTitle({ name: c.name, year: c.cy.year, enemy: sc?.enemy.name ?? null });
      document.title = `Runner of the Tablet House: ${c.name}, AY ${c.cy.year} — Palimpsest`;
      const scripts = await errandP;
      if (dead) return;
      if (sc && scripts) {
        try {
          run = new ErrandRun(game, sc, scripts.th, scripts.script, { sound: sound.current, reduced: reducedMotion, arms: sc.state.arms ?? null });
          run.subscribe((x) => { if (!dead) setErrandPhase(x.phase); });
          // the levy (built just now) takes the realism look's materials
          game.dressLate();
          run.begin();
          setErrand({ run, s: sc, th: scripts.th });
        } catch (e) {
          // a script naming a place this world does not have: say so, and leave the city free
          console.warn(String((e as Error)?.message ?? e));
          run = null;
        }
      }
      game.start();
      setReady(true);
      // the tier's textures and sky, after the first frame
      void game.streamLook().catch((e) => { console.warn('look: streaming failed', e); setStream(null); });
      // where the runner is, a few times a second
      let last = '';
      whereT = window.setInterval(() => {
        const o = game.runner?.object.position;
        if (!o || !game.city) return;
        const w = whereOf(game.city.affordances.places, game.city.quarters, game.city.river, o.x, o.y, o.z);
        const k = w ? `${w.kind}|${w.name}|${w.note}` : '';
        if (k !== last) { last = k; setWhere(w); }
      }, 250);
    })().catch((e) => {
      if (dead) return;
      const msg = String((e as Error)?.message ?? e);
      // WebGPU would not start (or fell back to WebGL2): start again on a fresh canvas with the classic look
      if (msg.startsWith('webgpu-unavailable')) { console.warn(msg); setClassicOnly(true); return; }
      setFailed(msg);
    });
    let statsT = 0;
    if (showStats) {
      statsT = window.setInterval(() => {
        const f = game.stats.frame.slice(-60);
        if (!f.length) return;
        const avg = f.reduce((a, b) => a + b, 0) / f.length;
        const i = game.info();
        setFps(`${(1000 / avg).toFixed(0)} fps · ${i.calls} draws · ${(i.triangles / 1000).toFixed(0)}k tris · ${i.look.tier ?? 'classic'} · ${i.pose} ${i.speed.toFixed(1)} m/s`);
      }, 500);
    }
    return () => {
      dead = true;
      clearTimeout(toastT);
      gameRef.current = null;
      clearInterval(statsT);
      clearInterval(whereT);
      run?.dispose();
      sound.current?.dispose();
      ro.disconnect();
      document.removeEventListener('pointerlockchange', onLock);
      game.dispose();
      const w = window as unknown as { __palimpsestStreets?: StreetsGame };
      if (w.__palimpsestStreets === game) delete w.__palimpsestStreets;
    };
  }, [classicOnly]);

  const dismiss = () => { setHint(false); saveHint(); };

  // the Graphics menu: a tier changes at once (the look is rebuilt); the classic look, or leaving it, reloads the city
  const choose = async (c: LookChoice) => {
    setMenu(false);
    const prev = choice;
    setChoice(c);
    saveChoice(c);
    const g = gameRef.current;
    const params = route.peek().params;
    if (params.has('look') || params.has('tier')) {
      // the route pins the look: drop the pin, and let the saved choice apply
      const q = new URLSearchParams(params);
      q.delete('look'); q.delete('tier');
      location.hash = `#/streets${q.toString() ? `?${q}` : ''}`;
      location.reload();
      return;
    }
    if (!g || !look) return;
    if (c === 'classic' || look.look === 'classic') { if (c !== prev) location.reload(); return; }
    if (c === 'auto') {
      const p = await pickLook(new URLSearchParams(), mobile);
      if (p.look === 'realism' && p.tier) await g.setTier(p.tier, 'auto');
      return;
    }
    await g.setTier(c, 'menu');
  };
  useEffect(() => {
    if (!menu) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(false); } };
    const away = (e: PointerEvent) => { if (!(e.target instanceof Element && e.target.closest('.st-gfx'))) setMenu(false); };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', away, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', away, true); };
  }, [menu]);

  // sound: off until asked on phones; on a computer it starts with the first key or click, unless switched off
  const toggleSound = async () => {
    soundTouched.current = true;
    soundWanted.current = !soundWanted.current;
    setSoundOn(soundWanted.current);
    const s = sound.current;
    if (!s) return;
    if (!soundWanted.current) { s.disable(); return; }
    const ok = await s.enable();
    if (!ok && soundWanted.current) { soundWanted.current = false; setSoundOn(false); }
  };
  useEffect(() => {
    if (!ready || touch || !soundAvailable()) return;
    const first = (e: Event) => {
      // the sound button's own click decides (starting it here too would have that click switch it straight off)
      if (e.target instanceof Element && e.target.closest('.st-sound')) return;
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
        <canvas key={classicOnly ? 'classic' : 'auto'} ref={canvasRef} class="st__canvas" />
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
      {ready && (
        <div class="st-tools">
          {soundAvailable() && (
            <button
              type="button" class={`st-sound${soundOn ? ' is-on' : ''}`} onClick={() => void toggleSound()} aria-pressed={soundOn}
              aria-label={soundOn ? 'Sound off (M)' : 'Sound on (M)'}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />{soundOn ? <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /> : <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />}</svg>
              {touch && !soundOn && <span>Sound on</span>}
            </button>
          )}
          {!(touch && errandPhase === 'run') && <div class="st-gfx">
            <button
              type="button" class={`st-gfx__btn${menu ? ' is-open' : ''}`} aria-expanded={menu} aria-controls="st-gfx-menu"
              aria-label={`Graphics: ${look?.look === 'realism' && look.tier ? CHOICE_LABEL[look.tier] : 'Classic'}`} onClick={() => setMenu((m) => !m)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
              {stream !== null && <span class="st-gfx__bar" aria-hidden="true"><span style={{ width: `${Math.round(stream * 100)}%` }} /></span>}
            </button>
            {menu && (
              <div id="st-gfx-menu" class="st-gfx__menu" role="group" aria-labelledby="st-gfx-t">
                <p id="st-gfx-t" class="st-gfx__t">Graphics</p>
                <p class="st-gfx__now">
                  {look?.look === 'realism' && look.tier ? `Now: ${CHOICE_LABEL[look.tier]}${choice === 'auto' ? ' (automatic)' : ''}` : look?.why === 'no-webgpu' || look?.why === 'no-adapter' || look?.why === 'webgpu-failed' ? 'Now: Classic (this browser has no WebGPU)' : 'Now: Classic'}
                  {stream !== null && ` · textures ${Math.round(stream * 100)}%`}
                </p>
                {LOOK_CHOICES.filter((c) => c === 'classic' || c === 'auto' || look?.look === 'realism' || look?.why === 'choice' || look?.why === 'url').map((c) => (
                  <button key={c} type="button" class="st-gfx__opt" aria-pressed={choice === c} onClick={() => void choose(c)}>
                    <span class="st-gfx__label">{CHOICE_LABEL[c]}</span>
                    <span class="st-gfx__note">{CHOICE_NOTE[c]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>}
        </div>
      )}
      {toast && <p class="st-toast" role="status">{toast}</p>}
      {relight && <div class="st-load st-load--relight" role="status"><div class="spinner" /> {relight}</div>}
      {ready && (
        <p class={`st-where${where ? ' is-on' : ''}`} aria-live="polite">
          {where && <><span class="st-where__kind">{where.kind}</span><span class="st-where__name">{where.name}</span>{where.note && <span class="st-where__note">{where.note}</span>}</>}
        </p>
      )}
      {showStats && fps && <p class="st-stats" aria-live="off">{fps}</p>}

      <p id="st-controls" class="sr-only">
        {touch
          ? 'Drag on the left half to move: a little to walk, further to jog, to the edge to run. Run into a wall to climb it, or walk into a ladder. Drag on the right half to look around. The jump button jumps.'
          : 'W, A, S and D or the arrow keys jog; hold Shift to run or Alt to walk; Space jumps, and jumping at a wall climbs it. Walk into a ladder to climb it. Click the scene to look around with the mouse; Escape releases it.'}
      </p>

      {ready && hint && (
        <div class="st-hint" role="dialog" aria-labelledby="st-hint-t">
          <p id="st-hint-t" class="st-hint__t">You carry the palace’s tablets</p>
          {touch ? (
            <ul class="st-hint__keys">
              <li><b>Left thumb</b> move · the edge runs</li>
              <li><b>Run at a wall</b> to climb it · walk into a ladder</li>
              <li><b>Right thumb</b> drag to look</li>
              <li><b>Jump</b> button, bottom right</li>
            </ul>
          ) : (
            <ul class="st-hint__keys">
              <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> jog · <kbd>Shift</kbd> run · <kbd>Alt</kbd> walk</li>
              <li><kbd>Space</kbd> jump · jump at a wall to climb it</li>
              <li>Click to look with the mouse · <kbd>Esc</kbd> lets go</li>
            </ul>
          )}
          <button type="button" class="st-hint__ok" onClick={dismiss}>Got it</button>
        </div>
      )}
      {!touch && ready && !hint && !locked && (!errandPhase || errandPhase === 'run' || errandPhase === 'free') && <p class="st-tip">Click to look around</p>}
      {ready && errand && !hint && (
        <ErrandView run={errand.run} s={errand.s} th={errand.th} touch={touch} reduced={reducedMotion} sound={sound.current} />
      )}

      {!ready && !failed && (
        <div class="st-load" role="status">
          <div class="st-load__card">
            <p class="st-load__t">Runner of the Tablet House</p>
            <p class="st-load__step"><span class="spinner" /> {step}</p>
            <div class="st-load__bar" role="progressbar" aria-label={step} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}>
              <span class={progress === null ? 'is-wait' : ''} style={progress === null ? undefined : { width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        </div>
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
