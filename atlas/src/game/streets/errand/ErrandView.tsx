// Runner of the Tablet House: the errand on screen. People speak in a panel (a sheet along the bottom on a phone, a
// card on a computer) while the runner stands; the figure is pressed into the Tablet House's own clay tablet
// (game/tablet/clay.ts), wedge by wedge, with the stylus's sound; the run has a compass ribbon at the top (the
// destination's bearing, an arrow at the edge when it is behind, the distance) and the horn's clock, and nothing
// else; the place labels are the world's own. Every panel is a labelled dialog whose first button takes the focus,
// and the horn's warnings are spoken by a polite live region. Reduced motion: no transitions, the tablet presses at
// once, the view never swings by itself (run.ts).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Pick, Scenario } from '../../tablet/types.ts';
import type { TabletScript } from '../../tablet/script.ts';
import { context } from '../../tablet/script.ts';
import { lineParts, materialOf } from '../../tablet/engine.ts';
import type { ClayTablet } from '../../tablet/clay.ts';
import type { StreetsSound } from '../sound.ts';
import type { ErrandRun, ErrandSnapshot } from './run.ts';
import { clock } from './engine.ts';
import './errand.css';

const up = (t: string) => t.toLocaleUpperCase('en-US');
const fmt = (n: number) => n.toLocaleString('en-US');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Props { run: ErrandRun; s: Scenario; th: TabletScript; touch: boolean; reduced: boolean; sound: StreetsSound | null }

export function ErrandView({ run, s, th, touch, reduced, sound }: Props) {
  const [snap, setSnap] = useState<ErrandSnapshot>(run.state);
  useEffect(() => run.subscribe(setSnap), [run]);
  const ph = snap.phase;
  const live = snap.notice?.text ?? '';
  return (
    <>
      {ph === 'brief' && <Brief snap={snap} run={run} />}
      {(ph === 'choose' || ph === 'pressed') && <Choose snap={snap} run={run} s={s} th={th} reduced={reduced} sound={sound} />}
      {ph === 'run' && <RunHud snap={snap} run={run} touch={touch} />}
      {ph === 'arrive' && <Arrive snap={snap} run={run} />}
      {ph === 'end' && snap.card && <EndCard snap={snap} run={run} />}
      <p class="sr-only" aria-live="polite">{live}{snap.notice && snap.notice.n % 2 ? '\u200b' : ''}</p>
    </>
  );
}

/** A panel people speak in: a heading with who speaks, and its first button focused when it opens. */
function Panel({ id, who, role, where, children, wide = false }: { id: string; who: string; role?: string; where?: string; children: preact.ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const b = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('button');
    b?.focus({ preventScroll: true });
  }, [id]);
  return (
    <div ref={ref} class={`er-panel${wide ? ' er-panel--wide' : ''}`} role="dialog" aria-labelledby={`${id}-who`} aria-describedby={`${id}-body`}>
      <header class="er-panel__head">
        {where && <p class="er-panel__where">{where}</p>}
        <h2 id={`${id}-who`} class="er-panel__who">{who}{role && <span class="er-panel__role">, {role}</span>}</h2>
      </header>
      <div id={`${id}-body`} class="er-panel__body">{children}</div>
    </div>
  );
}

function Brief({ snap, run }: { snap: ErrandSnapshot; run: ErrandRun }) {
  const w = snap.words;
  useEffect(() => { void import('../../tablet/clay.ts'); }, []);
  return (
    <Panel id="er-brief" who={w.overseer.name} role={w.overseer.role} where={`${run.errand.title} · ${run.from.name}`}>
      {w.brief.map((p, i) => <p key={i} class="er-text">{p}</p>)}
      <div class="er-actions">
        <button type="button" class="er-btn er-btn--go" onClick={() => run.toChoose()}>Take the clay</button>
      </div>
    </Panel>
  );
}

function Choose({ snap, run, s, th, reduced, sound }: { snap: ErrandSnapshot; run: ErrandRun; s: Scenario; th: TabletScript; reduced: boolean; sound: StreetsSound | null }) {
  const w = snap.words;
  const pressedPick = snap.phase === 'pressed' ? snap.st.pick : null;
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const tb = useRef<ClayTablet | null>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const parts = useMemo(() => lineParts(s, th, context(s), run.errand.slot), [s, th]);
  // the tablet (the Tablet House's own clay, fetched while the runner reads): its words' place blank
  useEffect(() => {
    let t: ClayTablet | null = null, dead = false;
    void import('../../tablet/clay.ts').then(({ ClayTablet }) => {
      const c = cv.current;
      if (dead || !c) return;
      t = new ClayTablet(c, { seed: `${s.id}:errand`, material: materialOf(s.medium), reduced, onPress: () => sound?.cue('stylus') });
      t.setCases([{ id: 'line', before: up(parts.before), after: '', longest: up(parts.longest) }]);
      // (a figure chosen before the clay arrived is there already)
      const picked = chosen.current;
      t.set('line', picked ? { before: !!parts.before, mode: 'set', text: up(parts.rest[picked]) } : { before: !!parts.before, mode: 'blank', text: '' });
      tb.current = t;
    });
    return () => { dead = true; t?.dispose(); tb.current = null; };
  }, []);
  const locked = useRef(false);
  const chosen = useRef<Pick | null>(null);
  const preview = (pick: Pick | null) => {
    const t = tb.current;
    // (a pressed line stays: the button's blur fires as it leaves the page, after the press began)
    if (!t || locked.current || t.get('line')?.mode === 'set') return;
    t.set('line', pick ? { text: up(parts.rest[pick]), mode: 'ghost' } : { mode: 'blank', text: '' });
  };
  const press = async (pick: Pick) => {
    if (locked.current) return;
    locked.current = true;
    chosen.current = pick;
    setBusy(true);
    run.choose(pick);
    const t = tb.current;
    if (t) {
      const text = up(parts.rest[pick]);
      t.set('line', { text, mode: 'blank' });
      await t.press('line', 'slot', 700 + text.length * 30);
    }
    await wait(reduced ? 0 : 250);
    run.sealed();
    setBusy(false);
    setDone(true);
  };
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (done) go.current?.focus({ preventScroll: true }); }, [done]);
  const r = snap.pressed;
  const label = w.readings.find((x) => x.pick === snap.saved.lastPick)?.label;
  return (
    <Panel id={pressedPick ? 'er-pressed' : 'er-choose'} who={w.overseer.name} role={w.overseer.role} where={snap.replay && !pressedPick ? 'Again, at the door of the house' : run.from.name}>
      {!pressedPick && <p class="er-text er-text--prompt">{w.prompt}</p>}
      <figure class={`er-tablet${pressedPick ? '' : ' is-blank'}`} aria-hidden={pressedPick ? 'false' : 'true'}>
        <canvas ref={cv} role="img" aria-label={pressedPick ? `The tablet: ${r?.line ?? ''}` : 'The tablet, its figure not yet pressed'} />
      </figure>
      {!pressedPick ? (
        <>
          <ul class="er-picks" role="list">
            {w.readings.map((o, i) => (
              <li key={o.pick}>
                <button
                  type="button" class={`er-pick er-pick--${o.pick}`} data-autofocus={i === 0 ? '' : undefined} disabled={busy}
                  onClick={() => void press(o.pick)} onMouseEnter={() => preview(o.pick)} onMouseLeave={() => preview(null)} onFocus={() => preview(o.pick)} onBlur={() => preview(null)}
                >
                  <span class="er-pick__label">{o.label}</span>
                  <span class="er-pick__line">{o.line}</span>
                </button>
              </li>
            ))}
          </ul>
          {label && snap.saved.runs > 0 && <p class="er-note">Last time you pressed: {label.toLocaleLowerCase('en-US')}.</p>}
        </>
      ) : (
        <>
          <p class={`er-text${done ? '' : ' is-hidden'}`}>{r?.reaction}</p>
          <p class={`er-text${done ? '' : ' is-hidden'}`}>{r?.handover}</p>
          <div class="er-actions">
            <button type="button" class="er-btn er-btn--go" disabled={!done} onClick={() => run.leave()} ref={go}>
              Run to {w.destination.replace(/^The /, 'the ')}
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}

/** The run: a compass ribbon at the top (bearing, edge arrow, distance) and the horn's clock. Updated every frame
 *  from the game itself (no re-render). */
function RunHud({ snap, run, touch }: { snap: ErrandSnapshot; run: ErrandRun; touch: boolean }) {
  const mark = useRef<HTMLSpanElement>(null);
  const dist = useRef<HTMLSpanElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const seconds = run.errand.horn.seconds, warnAt = run.errand.horn.warn;
  const dest = snap.words.destination;
  const [horn, setHorn] = useState(false);
  useEffect(() => { if (snap.notice?.kind === 'horn') setHorn(true); }, [snap.notice?.n]);
  useEffect(() => {
    let raf = 0;
    let last = { x: NaN, d: NaN, t: '', w: NaN, cls: '' };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const g = run.game;
      const o = g.runner?.object.position;
      const el = box.current, m = mark.current;
      if (!o || !el || !m) return;
      const tx = run.to.pos.x - o.x, tz = run.to.pos.z - o.z;
      let d = Math.atan2(tx, tz) - g.cam.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // > 0: to the left
      const span = (100 * Math.PI) / 180;
      const W = el.clientWidth / 2 - 14;
      const k = Math.max(-1, Math.min(1, -d / span));
      const x = Math.round(k * W);
      const cls = Math.abs(d) > span ? (d > 0 ? 'is-left' : 'is-right') : Math.abs(d) < 0.2 ? 'is-ahead' : '';
      if (x !== last.x) { m.style.transform = `translateX(${x}px)`; last.x = x; }
      if (cls !== last.cls) { el.dataset.side = cls; last.cls = cls; }
      const metres = Math.hypot(tx, tz);
      const md = metres >= 100 ? Math.round(metres / 5) * 5 : Math.round(metres);
      if (md !== last.d && dist.current) { dist.current.textContent = `${md} m`; last.d = md; }
      const left = run.hornLeft() ?? seconds;
      const t = left > 0 ? clock(left) : '0:00';
      if (t !== last.t && time.current) { time.current.textContent = t; last.t = t; }
      const wv = Math.round((left / seconds) * 200) / 200;
      if (wv !== last.w && bar.current) { bar.current.style.transform = `scaleX(${wv})`; last.w = wv; }
      el.classList.toggle('is-warn', left > 0 && left <= warnAt);
      el.classList.toggle('is-late', left <= 0);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [run]);
  return (
    <div class={`er-hud${touch ? ' er-hud--touch' : ''}`} ref={box} role="group" aria-label={`${snap.words.objective} The compass shows its bearing and distance, and the horn's clock how long is left.`}>
      <div class="er-rib" aria-hidden="true">
        <span class="er-rib__tick" />
        <span class="er-rib__mark" ref={mark}><span class="er-rib__pin" /></span>
      </div>
      <div class="er-hud__row">
        <span class="er-hud__dest"><span class="er-hud__name">{dest}</span> <span class="er-hud__dist" ref={dist} /></span>
        <span class="er-hud__horn"><span class="er-hud__k">{horn ? 'The horn' : 'Horn'}</span> <span class="er-hud__time" ref={time}>{clock(seconds)}</span></span>
      </div>
      <span class="er-hud__bar" aria-hidden="true"><span ref={bar} /></span>
      {horn && <p class="er-hud__said">The levy is marching. Go on to the gate.</p>}
    </div>
  );
}

function Arrive({ snap, run }: { snap: ErrandSnapshot; run: ErrandRun }) {
  const a = snap.arrival;
  if (!a) return null;
  const w = snap.words;
  const who = a.who === 'commander' ? w.commander : w.gatekeeper;
  return (
    <Panel id="er-arrive" who={who.name} role={who.role} where={w.destination}>
      <p class="er-text">{a.scene}</p>
      <p class="er-text">{a.reaction}</p>
      {a.after && <p class="er-text er-text--after">{a.after}</p>}
      <div class="er-actions">
        <button type="button" class="er-btn er-btn--go" onClick={() => run.finish()}>Go on</button>
      </div>
    </Panel>
  );
}

function EndCard({ snap, run }: { snap: ErrandSnapshot; run: ErrandRun }) {
  const c = snap.card!;
  const best = snap.saved.best;
  // a new best only when it beats one there was before
  const isBest = c.inTime && snap.prevBest !== null && Math.round(c.time * 10) / 10 < snap.prevBest;
  return (
    <Panel id="er-end" who={c.title} where="The errand" wide>
      <p class={`er-end__head${c.inTime ? '' : ' is-late'}`}>{c.headline}</p>
      <dl class="er-stats">
        <div><dt>Your time</dt><dd>{clock(c.time, true)}</dd></div>
        <div><dt>The horn</dt><dd>{clock(c.horn, true)}</dd></div>
        <div><dt>{isBest ? 'Best, new' : 'Best'}</dt><dd>{best === null ? '—' : clock(best, true)}</dd></div>
      </dl>
      <div class="er-route">
        <p class="er-route__k">The way you came, {fmt(c.route.metres)} m</p>
        <div class="er-route__bar" role="img" aria-label={`${c.route.street}% through the streets, ${c.route.roof}% over the roofs`}>
          {c.route.street > 0 && <span class="er-route__street" style={{ width: `${c.route.street}%` }} />}
          {c.route.roof > 0 && <span class="er-route__roof" style={{ width: `${c.route.roof}%` }} />}
        </div>
        <p class="er-route__legend"><span class="er-key er-key--street" />Streets {c.route.street}% <span class="er-key er-key--roof" />Roofs {c.route.roof}%</p>
      </div>
      <div class="er-clay">
        <div class={`er-fig er-fig--${c.pressed.pick}`}>
          <p class="er-fig__k">You pressed</p>
          <p class="er-fig__n">{fmt(c.pressed.value)}</p>
          <p class="er-fig__t">“{c.pressed.line}”</p>
        </div>
        <div class="er-fig er-fig--record">
          <p class="er-fig__k">The record</p>
          <p class="er-fig__n">{fmt(c.record.value)}</p>
          <p class="er-fig__t">{c.record.line}</p>
        </div>
      </div>
      <div class="er-next">
        <p class="er-next__k">Next · {c.teaser.title}</p>
        <p class="er-next__t">{c.teaser.text} <span class="er-next__soon">Coming in a later step.</span></p>
      </div>
      <div class="er-actions">
        <button type="button" class="er-btn er-btn--go" onClick={() => run.again()}>Run it again</button>
        <button type="button" class="er-btn" onClick={() => run.release()}>Back to the city</button>
      </div>
    </Panel>
  );
}
