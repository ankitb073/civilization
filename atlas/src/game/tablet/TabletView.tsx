// The Tablet House (#/tablet, #/tablet/<scenario>): you are the palace scribe of a real city in the week it falls or
// holds, and you decide what goes on the clay. Five days, one tablet, one king who wants smaller dead and bigger
// victories; at the end your tablet is set beside the record and the chronicle that really survived, and the
// archaeologist of AY 49xx decides what you were. Design: docs/lld/tablet-house.md. The daily city is the same for
// everyone on the same date; "Another city" deals a different one.
//
// Scripts (scenario-scripts/<id>.json) are bundled with the atlas, one lazy chunk each, found at build time: a
// scenario plays once its script exists and is complete, and is left out of the daily draw until then.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { DayNo, Effects, Meters, Pick, Scenario, ScenariosFile, SlotId } from './types.ts';
import { fetchJson } from '../../data.ts';
import { todayKey } from '../../book.ts';
import { navigate, reducedMotion } from '../../state.ts';
import { ensureMeta, meta } from '../../store.ts';
import * as E from './engine.ts';
import { fill, genericScript, normalizeScript, type ChoiceOption, type ScriptDay, type TabletScript } from './script.ts';
import { ClayTablet, type CaseSpec } from './clay.ts';
import { Stage, sceneBeat } from './stage.tsx';
import { Sound, soundAvailable } from './sound.ts';
import { FIXTURE_SCENARIO } from './fixture.ts';
import { renderCard } from './card.ts';
import '../../styles/tablet.css';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const DAY_NAME = ['', 'Day one', 'Day two', 'Day three', 'Day four', 'Day five'];
const up = (t: string) => t.toLocaleUpperCase('en-US');

// ---------------------------------------------------------------- scripts: bundled, one lazy chunk each
const SCRIPT_FILES = import.meta.glob<unknown>('../../../../scenario-scripts/*.json', { import: 'default' });
const scriptLoader = new Map(Object.entries(SCRIPT_FILES).map(([path, load]) => [path.replace(/^.*\//, '').replace(/\.json$/, ''), load]));
export const scriptedIds = () => new Set(scriptLoader.keys());

async function loadScript(s: Scenario): Promise<TabletScript | null> {
  if (s === FIXTURE_SCENARIO) return genericScript(s);
  const load = scriptLoader.get(s.id);
  if (!load) return null;
  try { return normalizeScript(await load(), s); } catch { return null; }
}

let fileP: Promise<ScenariosFile | null> | null = null;
function loadScenarios() {
  if (!fileP) fileP = fetchJson<ScenariosFile>('scenarios.json').then((j) => (j?.scenarios?.length ? j : null)).catch(() => null);
  return fileP;
}

type Step =
  | { k: 'intro' }
  | { k: 'title'; day: DayNo }
  | { k: 'scene'; day: DayNo }
  | { k: 'write'; day: DayNo; i: number }
  | { k: 'written'; day: DayNo }
  | { k: 'choose'; day: DayNo }
  | { k: 'chosen'; day: DayNo }
  | { k: 'fire' }
  | { k: 'end' };

function nextStep(st: Step): Step {
  switch (st.k) {
    case 'intro': return { k: 'title', day: 1 };
    case 'title': return { k: 'scene', day: st.day };
    case 'scene': return st.day >= 3 ? { k: 'choose', day: st.day } : { k: 'write', day: st.day, i: 0 };
    case 'write': return st.i + 1 < E.DAY_SLOTS[st.day].length ? { ...st, i: st.i + 1 } : { k: 'written', day: st.day };
    case 'written': return { k: 'title', day: (st.day + 1) as DayNo };
    case 'choose': return { k: 'chosen', day: st.day };
    case 'chosen': return st.day === 4 ? { k: 'write', day: 4, i: 0 } : st.day === 5 ? { k: 'fire' } : { k: 'title', day: (st.day + 1) as DayNo };
    case 'fire': return { k: 'end' };
    default: return st;
  }
}
const stepKey = (st: Step) => `${st.k}:${'day' in st ? st.day : ''}:${'i' in st ? st.i : ''}`;

function dayTitle(s: Scenario, day: DayNo, clay: boolean): string {
  if (day === 1) return 'The muster';
  if (day === 2) return 'The field';
  if (day === 3) return 'The walls';
  if (day === 4) return s.outcome === 'sacked' ? 'The fall' : s.outcome === 'conquered' ? 'The surrender' : s.outcome === 'treaty' ? 'The terms' : 'The siege';
  return clay ? 'The tablet' : 'The fair copy';
}

// ---------------------------------------------------------------- the route

export function TabletView({ sub }: { sub: string | null }) {
  const [file, setFile] = useState<ScenariosFile | null | undefined>(undefined);
  const [script, setScript] = useState<{ id: string; sc: TabletScript | null } | null>(null);
  useEffect(() => { ensureMeta().catch(() => {}); loadScenarios().then(setFile); }, []);
  const today = todayKey();
  // the cities that can be played: those with a script (or the fixture, without data)
  const playable = useMemo(() => {
    if (file === undefined) return null;
    const ids = scriptedIds();
    const list = file ? file.scenarios.filter((x) => ids.has(x.id)) : [];
    return list.length ? list : [FIXTURE_SCENARIO];
  }, [file]);
  const scenario = useMemo(() => {
    if (!playable) return null;
    if (sub) return playable.find((x) => x.id === sub) ?? file?.scenarios.find((x) => x.id === sub) ?? null;
    return E.dailyScenario(playable, today);
  }, [playable, sub, today]);
  useEffect(() => {
    if (!scenario) return;
    let alive = true;
    loadScript(scenario).then((sc) => { if (alive) setScript({ id: scenario.id, sc }); });
    return () => { alive = false; };
  }, [scenario?.id]);
  useEffect(() => { document.title = scenario ? `The Tablet House: ${scenario.city.name}, AY ${scenario.year} — Palimpsest` : 'The Tablet House — Palimpsest'; }, [scenario?.id]);

  const unplayable = playable && sub && (!scenario || (script && script.id === scenario.id && !script.sc));
  if (unplayable) {
    return (
      <div class="tb tb--intro">
        <div class="tb-stage tb-stage--title" aria-hidden="true"><div class="tb-stage__sky" /><div class="tb-stage__veil" /></div>
        <section class="tb-col tb-intro">
          <p class="tb-kicker">The Tablet House</p>
          <h1 class="tb-h1">{scenario ? `${scenario.city.name}, AY ${scenario.year}` : 'No such city'}</h1>
          <p class="tb-lede">{scenario ? 'The scribe of this city has not finished the tablet yet. Come back soon, or take up the stylus somewhere else.' : 'The tablet you asked for is not on any shelf.'}</p>
          <div class="tb-actions"><a class="tb-btn tb-btn--gold" href="#/tablet">Play today’s city</a></div>
        </section>
      </div>
    );
  }
  if (!scenario || !script || script.id !== scenario.id || !script.sc || !playable) {
    return (
      <div class="tb tb--loading">
        <div class="tb-stage tb-stage--title" aria-hidden="true"><div class="tb-stage__sky" /><div class="tb-stage__veil" /></div>
        <div class="center-load tb-load"><div class="spinner" /> Wetting the clay…</div>
      </div>
    );
  }
  return <Play key={scenario.id} s={scenario} sc={script.sc} daily={sub ? null : today} list={playable} />;
}

// ---------------------------------------------------------------- the game

interface Saved { step: Step; game: E.Game; begun: SlotId[]; extra: { colophon: boolean; edge: string } }
const saved = new Map<string, Saved>();
const RESULTS = 'pal-tablet-v1';
interface Result { fate: string; truth: number; date: string }
function readResults(): Record<string, Result> {
  try { return JSON.parse(localStorage.getItem(RESULTS) ?? '{}') as Record<string, Result>; } catch { return {}; }
}
function saveResult(id: string, r: Result) {
  try { const all = readResults(); all[id] = r; localStorage.setItem(RESULTS, JSON.stringify(all)); } catch { /* storage blocked */ }
}

function Play({ s, sc, daily, list }: { s: Scenario; sc: TabletScript; daily: string | null; list: Scenario[] }) {
  const reduced = reducedMotion;
  const ctx = useMemo(() => E.baseCtx(s, sc), [s, sc]);
  const f = (t: string) => fill(t, ctx);
  const scribe = String((ctx.scribe as { name: string }).name);
  const material = E.materialOf(s.medium);
  const clay = material === 'clay';
  const title = E.rulerTitleOf(s);
  const vals = useMemo(() => E.valuesOf(s), [s]);
  const parts = useMemo(() => Object.fromEntries(E.LINE_ORDER.map((id) => [id, E.lineParts(s, sc, ctx, id)])) as Record<SlotId, ReturnType<typeof E.lineParts>>, [s, sc]);
  const key = `${s.id}|${daily ?? ''}`;
  const init = saved.get(key);
  const [step, setStepRaw] = useState<Step>(init?.step ?? { k: 'intro' });
  const [game, setGame] = useState<E.Game>(init?.game ?? E.newGame());
  const [begun, setBegun] = useState<SlotId[]>(init?.begun ?? []);
  const [extra, setExtra] = useState(init?.extra ?? { colophon: false, edge: '' });
  const [busy, setBusy] = useState(false);
  const [delta, setDelta] = useState<{ e: Effects; n: number } | null>(null);
  const [chosen, setChosen] = useState<ChoiceOption | null>(null);
  const [tb, setTb] = useState<ClayTablet | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [fired, setFired] = useState(false);
  const sound = useRef(new Sound(s.id));
  const prior = useMemo(() => readResults()[s.id] ?? null, [s.id]);
  useEffect(() => { saved.set(key, { step, game, begun, extra }); }, [step, game, begun, extra]);
  useEffect(() => () => sound.current.dispose(), []);
  useEffect(() => { if (step.k === 'title') sound.current.cue('page'); }, [stepKey(step)]);

  const setStep = (st: Step) => {
    setStepRaw(st);
    if (st.k !== 'chosen') setChosen(null);
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  };
  const advance = () => { if (!busy) setStep(nextStep(step)); };

  const day: DayNo | 0 | 6 = step.k === 'intro' ? 0 : step.k === 'fire' ? 5 : step.k === 'end' ? 6 : step.day;
  const beat = step.k === 'fire' ? 'tablet' : E.beatOf(s, day);
  useEffect(() => { sound.current.setBeat(sceneBeat(beat)); }, [beat]);
  const establishing = step.k === 'intro' || step.k === 'end';
  const dayScript: ScriptDay | null = day >= 1 && day <= 5 ? sc.days[(day as number) - 1] : null;
  const meter = (e: Effects) => setDelta({ e, n: Date.now() });

  // the title cards run on by themselves, unless motion is reduced
  useEffect(() => {
    if (step.k !== 'title' || reduced) return;
    const t = setTimeout(() => setStep({ k: 'scene', day: step.day }), 4400);
    return () => clearTimeout(t);
  }, [stepKey(step)]);

  // ---------------------------------------------------------------- the tablet's moments
  const writeId = step.k === 'write' ? E.DAY_SLOTS[step.day][step.i] : null;
  useEffect(() => {
    if (!tb || !writeId) return;
    let alive = true;
    (async () => {
      if (!begun.includes(writeId)) {
        setBusy(true);
        if (parts[writeId].before) await tb.press(writeId, 'before', 1500);
        if (!alive) return;
        setBegun((b) => (b.includes(writeId) ? b : [...b, writeId]));
        setBusy(false);
      }
      tb.set(writeId, { mode: 'blank', text: '' });
    })();
    return () => { alive = false; };
  }, [tb, writeId]);
  // on the fifth day the king's finger finds every line that does not flatter him
  useEffect(() => { tb?.setMarks(step.k === 'choose' && step.day === 5 ? E.toAmend(game) : []); }, [tb, stepKey(step)]);

  const press = async (pick: Pick) => {
    if (busy || !writeId || !tb) return;
    setBusy(true);
    const o = E.slotOf(sc, writeId).options.find((x) => x.pick === pick)!;
    setGame(E.pickSlot(game, sc, writeId, pick));
    meter(o.effects);
    const text = up(parts[writeId].rest[pick]);
    tb.set(writeId, { text, mode: 'blank' });
    await tb.press(writeId, 'slot', 900 + text.length * 40);
    await wait(reduced ? 0 : 450);
    setBusy(false);
    setStep(nextStep(step));
  };
  const preview = (pick: Pick | null) => {
    if (!tb || !writeId || busy) return;
    const cur = tb.get(writeId);
    if (!cur || cur.mode === 'set') return;
    tb.set(writeId, pick ? { text: up(parts[writeId].rest[pick]), mode: 'ghost' } : { mode: 'blank', text: '' });
  };

  const choose = async (index: number) => {
    if (busy || step.k !== 'choose' || !dayScript?.choice) return;
    const d = step.day;
    const o = dayScript.choice.options[index];
    if (!o) return;
    const amend = d === 5 ? E.toAmend(game) : [];
    const g2 = E.choose(game, d, index, o);
    setGame(g2);
    meter(o.effects);
    setChosen(o);
    setStepRaw({ k: 'chosen', day: d });
    if (d !== 5 || !tb) return;
    setBusy(true);
    tb.setMarks([]);
    // bring the tablet into view for the rewriting
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    await wait(reduced ? 0 : 500);
    if (g2.day5 !== 'stand') {
      for (const id of amend) {
        await tb.smooth(id, 900);
        tb.set(id, { text: up(parts[id].rest.boasted), mode: 'blank' });
        await wait(reduced ? 0 : 150);
        await tb.press(id, 'slot', 1000);
      }
    }
    let edge = '';
    if (g2.day5 === 'edge') {
      edge = E.edgeText(s);
      await wait(reduced ? 0 : 300);
      await tb.pressEdge(edge);
    }
    // the scribe signs, unless the card was to leave the name off
    const signs = o.flag !== 'unsigned';
    if (signs) {
      await wait(reduced ? 0 : 300);
      sound.current.cue('seal');
      await tb.press('colophon', 'before', 1500);
    }
    setExtra({ colophon: signs, edge });
    setBusy(false);
  };

  // the firing: the archive's fire, the kiln, or the sun
  const hardening = E.hardeningOf(s, game);
  useEffect(() => {
    if (step.k !== 'fire' || !tb) return;
    setFired(false);
    tb.fire(hardening === 'burned' ? { scorch: 0.8 } : hardening === 'kiln' ? { kiln: 1 } : { dry: 1 }, hardening === 'sun' ? 2200 : 3400).then(() => setFired(true));
  }, [tb, step.k]);
  const toEnd = () => {
    const cond = E.conditionOf(s, game, material);
    const lines = E.linesOf(s, sc, game, cond);
    saveResult(s.id, { fate: fill(E.endingOf(sc, game).title, E.endCtx(s, sc, game, cond)), truth: E.truthScore(lines), date: todayKey() });
    setStep({ k: 'end' });
  };

  const choiceOptions = dayScript?.choice?.options ?? [];
  const soundWanted = useRef(false);
  const toggleSound = async () => {
    soundWanted.current = !soundWanted.current;
    setSoundOn(soundWanted.current);
    if (!soundWanted.current) { sound.current.disable(); return; }
    const ok = await sound.current.enable(sceneBeat(beat));
    if (!ok && soundWanted.current) { soundWanted.current = false; setSoundOn(false); }
  };
  // keyboard: Enter or Space moves on, 1–3 pick, M toggles the sound
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if ((e.key === 'm' || e.key === 'M') && soundAvailable()) { e.preventDefault(); void toggleSound(); return; }
      if (/^[1-3]$/.test(e.key)) {
        const n = Number(e.key) - 1;
        if (step.k === 'write') { e.preventDefault(); void press((['true', 'rounded', 'boasted'] as Pick[])[n]); }
        else if (step.k === 'choose' && choiceOptions[n]) { e.preventDefault(); void choose(n); }
        return;
      }
      const onButton = t && (t.tagName === 'BUTTON' || t.tagName === 'A');
      if ((e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') && !onButton) {
        if (step.k === 'title' || step.k === 'scene' || step.k === 'written' || (step.k === 'chosen' && !busy)) { e.preventDefault(); advance(); }
        else if (step.k === 'fire' && fired) { e.preventDefault(); toEnd(); }
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const another = () => {
    const others = list.filter((x) => x.id !== s.id);
    if (!others.length) return;
    const r = new Uint32Array(1);
    crypto.getRandomValues(r);
    saved.delete(key);
    navigate(`#/tablet/${others[r[0] % others.length].id}`);
  };
  const restart = () => {
    saved.delete(key);
    setGame(E.newGame()); setBegun([]); setExtra({ colophon: false, edge: '' }); setFired(false); setTb(null);
    setStep({ k: 'intro' });
  };

  // ---------------------------------------------------------------- the tablet's layout and its state at mount
  const specs: CaseSpec[] = useMemo(() => [
    ...E.LINE_ORDER.map((id) => ({ id, before: up(parts[id].before), after: '', longest: up(parts[id].longest) })),
    { id: 'colophon', before: E.colophonOf(s, scribe), after: '', longest: '' },
  ], [s.id]);
  const showTablet = step.k === 'write' || step.k === 'written' || ((step.k === 'choose' || step.k === 'chosen') && step.day === 5) || step.k === 'fire' || step.k === 'end';
  const tabletLabel = `The ${clay ? 'tablet' : 'sheet'} so far: ${E.LINE_ORDER.filter((id) => game.picks[id]).map((id) => E.lineOf(s, sc, ctx, id, game.picks[id]!)).join(' ') || 'nothing written yet.'}`;
  const cond = step.k === 'end' ? E.conditionOf(s, game, material) : null;
  const tablet = showTablet ? (
    <TabletCanvas
      key={`${s.id}-${step.k === 'end' ? 'end' : 'play'}`}
      s={s} material={material} specs={specs} reduced={reduced} label={tabletLabel}
      onReady={setTb} onPress={() => sound.current.cue('stylus')}
      initial={() => {
        const st: Record<string, { before: boolean; mode: 'hidden' | 'blank' | 'set'; text: string; lost: boolean }> = {};
        for (const id of E.LINE_ORDER) {
          const pick = game.picks[id];
          st[id] = { before: begun.includes(id) || !!pick, mode: pick ? 'set' : begun.includes(id) ? 'blank' : 'hidden', text: pick ? up(parts[id].rest[pick]) : '', lost: !!cond?.lost.includes(id) };
        }
        st.colophon = { before: extra.colophon, mode: 'hidden', text: '', lost: false };
        return st;
      }}
      edge={extra.edge}
      focus={step.k === 'write' ? writeId : step.k === 'choose' && step.day === 5 ? (E.toAmend(game)[0] ?? 'muster') : null}
      finish={step.k === 'end' && cond ? { fire: cond.hardening === 'burned' ? { scorch: cond.scorch } : cond.hardening === 'kiln' ? { kiln: 1 } : { dry: 1 }, broken: cond.broken } : undefined}
    />
  ) : null;

  // the options in the order they are offered: the record's, then a rounded one, then the king's
  const order: Pick[] = ['true', 'rounded', 'boasted'];

  // ---------------------------------------------------------------- frames
  const hud = step.k !== 'intro' && step.k !== 'title' && step.k !== 'end' && (
    <header class="tb-hud">
      <div class="tb-hud__where">
        <span class="tb-hud__city">{s.city.name} <span>AY {s.year}</span></span>
        <ol class="tb-days" aria-label={`Day ${Math.min(5, Number(day))} of 5`}>
          {[1, 2, 3, 4, 5].map((d) => <li class={d < Number(day) ? 'is-past' : d === Number(day) ? 'is-now' : ''} aria-hidden="true" />)}
        </ol>
      </div>
      <MetersBar m={game.meters} delta={delta} />
      {soundAvailable() && <SoundButton on={soundOn} toggle={toggleSound} />}
    </header>
  );
  const king = (lines: string[]) => (lines.length ? <KingSays s={s} lines={lines.map(f)} /> : null);

  let body: preact.ComponentChildren = null;
  if (step.k === 'intro') {
    body = (
      <section class="tb-col tb-intro" aria-labelledby="tb-title">
        <p class="tb-kicker tb-rise" style="--d:0">The Tablet House{daily ? ` · the city of the day, ${daily}` : ' · another city'}</p>
        <h1 id="tb-title" class="tb-h1 tb-rise" style="--d:1">{s.city.name}, <span class="tb-nowrap">AY {s.year}</span></h1>
        {sc.title && <p class="tb-intro__title tb-rise" style="--d:2">{f(sc.title)}</p>}
        <p class="tb-intro__you tb-rise" style="--d:2">You are <b>{scribe}</b>, palace scribe to {s.state.ruler.name}, {title} of {s.state.name}.</p>
        <p class="tb-lede tb-rise" style="--d:3">Five days. One {clay ? 'tablet' : 'sheet'}. One {title} who wants smaller dead and bigger victories. What you {clay ? 'press into the clay' : 'write'} will outlast everyone in the city, and in five thousand years someone will check it against the record.</p>
        <div class="tb-actions tb-rise" style="--d:4">
          <button class="tb-btn tb-btn--gold" onClick={advance} autoFocus>Take up the {clay ? 'stylus' : 'pen'}</button>
          {soundAvailable() && <SoundButton on={soundOn} toggle={toggleSound} big />}
          {list.length > 1 && <button class="tb-btn tb-btn--ghost" onClick={another}>Another city</button>}
        </div>
        {prior && <p class="tb-prior tb-rise" style="--d:5">You were the scribe here once before: <i>{prior.fate}</i>. {prior.truth}% of the truth reached the future.</p>}
        <p class="tb-note tb-rise" style="--d:5">Every name and figure comes from the record of {meta.value?.worldName ?? 'the archive'}: the armies, the dead, the {s.outcome === 'treaty' ? 'treaty' : s.outcome === 'held' ? 'siege' : 'fall of the city'}, the chronicle that survived. Only your life and your choices are your own.</p>
      </section>
    );
  } else if (step.k === 'title') {
    const name = dayTitle(s, step.day, clay);
    body = (
      <section class="tb-titlecard" onClick={advance} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance(); } }} role="button" tabIndex={0} aria-label={`${DAY_NAME[step.day]}: ${name}. Continue.`}>
        <p class="tb-titlecard__day">{DAY_NAME[step.day]}</p>
        <h1 class="tb-titlecard__name">{name}</h1>
        <span class="tb-titlecard__rule" aria-hidden="true" />
        <p class="tb-titlecard__where">{s.city.name} · AY {s.year}</p>
        <p class="tb-titlecard__tap" aria-hidden="true">{reduced ? 'Press Enter or tap to go on' : ''}</p>
      </section>
    );
  } else if (step.k === 'scene' && dayScript) {
    const paras = dayScript.scene.map(f);
    body = (
      <section class="tb-col tb-scene" key={stepKey(step)}>
        <p class="tb-kicker">{DAY_NAME[step.day]} · {dayTitle(s, step.day, clay)}</p>
        <div class="tb-prose">{paras.map((p, k) => <p class="tb-fade" style={`--d:${k}`}>{p}</p>)}</div>
        {dayScript.king.length > 0 && <div class="tb-fade" style={`--d:${paras.length}`}>{king(dayScript.king)}</div>}
        <div class="tb-actions tb-fade" style={`--d:${paras.length + (dayScript.king.length ? 1 : 0)}`}>
          <button class="tb-btn tb-btn--gold" onClick={advance} autoFocus>{step.day === 5 ? `Answer the ${title}` : step.day >= 3 ? 'Decide' : clay ? 'Take up the stylus' : 'Take up the pen'}</button>
        </div>
      </section>
    );
  } else if (step.k === 'write' && writeId && dayScript) {
    const slot = E.slotOf(sc, writeId);
    const pressure = writeId === 'muster' ? 1 : writeId === 'field' || writeId === 'end' ? 3 : 2;
    const says = dayScript.king.length ? f(dayScript.king[(step.i + 1) % dayScript.king.length]) : '';
    body = (
      <section class="tb-desk tb-write" aria-labelledby="tb-ask">
        <div class="tb-desk__head">
          <p class="tb-kicker">{DAY_NAME[step.day]} · {E.lineName(s, writeId)}</p>
          <h2 id="tb-ask" class="tb-ask">{f(slot.prompt)}</h2>
          <p class="tb-know">{known(s, writeId)}</p>
        </div>
        <div class="tb-desk__tablet">{tablet}</div>
        <div class="tb-desk__ctl">
          <div class="tb-pressure">
            <Crown />
            <span class="tb-pressure__who">{s.state.ruler.name} {pressure >= 3 ? 'leans over your shoulder' : pressure === 2 ? 'is watching the clay' : 'is watching'}</span>
            <span class="tb-pressure__dots" role="img" aria-label={`Pressure: ${pressure} of 3`}>{[1, 2, 3].map((k) => <i class={k <= pressure ? 'is-on' : ''} />)}</span>
            {says && <span class="tb-pressure__says">{/^[“"]/.test(says) ? says : `“${says}”`}</span>}
          </div>
          <div class="tb-opts" role="group" aria-label={clay ? 'What will you press into the clay?' : 'What will you write?'}>
            {order.map((pick, k) => {
              const o = slot.options.find((x) => x.pick === pick)!;
              const v = writeId === 'muster' || writeId === 'ours' || writeId === 'theirs' ? vals[writeId][pick] : null;
              const line = E.lineOf(s, sc, ctx, writeId, pick);
              return (
                <button
                  class={`tb-opt tb-opt--${pick}${v === null ? ' tb-opt--words' : ''}`} disabled={busy}
                  onClick={() => void press(pick)} onMouseEnter={() => preview(pick)} onMouseLeave={() => preview(null)} onFocus={() => preview(pick)} onBlur={() => preview(null)}
                  aria-keyshortcuts={String(k + 1)} aria-label={`${PICK_NAME[pick]}: ${line} (${f(o.label)})`}
                >
                  <span class="tb-opt__key" aria-hidden="true">{k + 1}</span>
                  <span class={`tb-opt__pick is-${pick}`}>{PICK_NAME[pick]}</span>
                  <span class="tb-opt__val">{v !== null ? (v === 0 ? 'None' : fmt(v)) : line}</span>
                  <span class="tb-opt__label">{f(o.label)}</span>
                  <Fx e={o.effects} />
                  {pick === 'boasted' && <span class="tb-opt__seal" title={`The ${title}’s wish`}><Crown /></span>}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    );
  } else if (step.k === 'written') {
    const which: SlotId = step.day === 1 ? 'muster' : step.day === 2 ? 'field' : 'end';
    const reply = E.kingReply(s, step.day, game.picks[which] ?? 'true');
    body = (
      <section class="tb-desk tb-written">
        <div class="tb-desk__head"><p class="tb-kicker">{DAY_NAME[step.day]} · {dayTitle(s, step.day, clay)}</p></div>
        <div class="tb-desk__tablet">{tablet}</div>
        <div class="tb-desk__ctl">
          {reply && <p class="tb-reply tb-fade" style="--d:0">{reply}</p>}
          <div class="tb-actions tb-fade" style="--d:1">
            <button class="tb-btn tb-btn--gold" onClick={advance} autoFocus>{step.day === 4 ? 'The fifth day' : 'Night falls'}</button>
          </div>
        </div>
      </section>
    );
  } else if ((step.k === 'choose' || step.k === 'chosen') && dayScript?.choice) {
    const d = step.day;
    const ch = dayScript.choice;
    const head = (
      <>
        <p class="tb-kicker">{DAY_NAME[d]} · {dayTitle(s, d, clay)}</p>
        {step.k === 'choose' && d === 5 && E.toAmend(game).length > 0 && <p class="tb-know tb-know--marks"><Crown /> The {title}’s finger rests under {E.toAmend(game).length === 1 ? 'one line' : `${E.toAmend(game).length} lines`}.</p>}
        {step.k === 'choose' && <h2 class="tb-ask">{f(ch.prompt)}</h2>}
      </>
    );
    const ctl = (
      <>
        {step.k === 'choose' && (
          <div class={`tb-cards tb-cards--${ch.options.length}`} role="group" aria-label="Your choice">
            {ch.options.map((c, k) => (
              <button class="tb-card" onClick={() => void choose(k)} disabled={busy} style={`--d:${k}`} aria-keyshortcuts={String(k + 1)}>
                <span class="tb-card__key" aria-hidden="true">{k + 1}</span>
                <span class="tb-card__title">{f(c.label)}</span>
                <Fx e={c.effects} />
              </button>
            ))}
          </div>
        )}
        {step.k === 'chosen' && chosen && (
          <div class="tb-chosen">
            <p class="tb-chosen__what"><span>You chose</span> {f(chosen.label)}</p>
            <p class="tb-reply tb-fade" style="--d:0">{f(chosen.consequence)}</p>
            <div class="tb-actions tb-fade" style="--d:1">
              <button class="tb-btn tb-btn--gold" onClick={advance} disabled={busy} autoFocus>
                {d === 4 ? `Take up the ${clay ? 'stylus' : 'pen'}` : d === 5 ? (busy ? (clay ? 'Pressing…' : 'Writing…') : hardening === 'burned' ? 'That night' : clay ? 'To the kiln' : 'To the archive') : 'Morning'}
              </button>
            </div>
          </div>
        )}
      </>
    );
    body = d === 5 ? (
      <section class="tb-desk tb-choose tb-choose--tablet" key="choose5">
        <div class="tb-desk__head">{head}</div>
        <div class="tb-desk__tablet">{tablet}</div>
        <div class="tb-desk__ctl">{ctl}</div>
      </section>
    ) : (
      <section class="tb-col tb-choose" key={`choose${d}`}>{head}{ctl}</section>
    );
  } else if (step.k === 'fire') {
    body = (
      <section class="tb-desk tb-fire">
        <div class="tb-desk__head"><p class="tb-kicker">{hardening === 'burned' ? 'The fire' : hardening === 'kiln' ? (clay ? 'The kiln' : 'The royal chest') : 'The archive'}</p></div>
        <div class="tb-desk__tablet">{tablet}</div>
        <div class="tb-desk__ctl">
          <p class="tb-reply tb-fade" style="--d:1">{firing(s, hardening, material)}</p>
          <div class="tb-actions tb-fade" style="--d:2">
            <button class="tb-btn tb-btn--gold" onClick={toEnd} disabled={!fired && !reduced}>Five thousand years later</button>
          </div>
        </div>
      </section>
    );
  } else if (step.k === 'end' && cond) {
    body = <Ending s={s} sc={sc} game={game} cond={cond} material={material} scribe={scribe} tablet={tablet} tb={tb} daily={daily} onAnother={list.length > 1 ? another : null} onAgain={restart} />;
  }

  return (
    <div class={`tb tb--${step.k}${busy ? ' is-busy' : ''}`}>
      <Stage scenario={s} beat={beat} establishing={establishing} reduced={reduced} />
      {hud}
      <div class="tb-main">{body}</div>
    </div>
  );
}

const PICK_NAME: Record<Pick, string> = { true: 'True', rounded: 'Rounded', boasted: 'Boasted' };
const wait = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

/** What the scribe knows to be true, under the question. */
function known(s: Scenario, id: SlotId): string {
  const b = s.battle;
  switch (id) {
    case 'muster': return `The captains’ roll: ${fmt(b.ours)} men.`;
    case 'ours': return `The tally-men counted ${fmt(b.oursLost)} of ours.`;
    case 'theirs': return `The riders counted ${fmt(b.theirsLost)} of theirs.`;
    case 'field': return b.won ? 'The field was won, at a price.' : 'The field was lost.';
    default: return s.outcome === 'sacked' ? `${s.enemy.name} took the city${s.burnedArchives ? ' and burned it' : ''}.` : s.outcome === 'conquered' ? `The city passed to ${s.enemy.name}.` : s.outcome === 'treaty' ? `The peace cost ${s.treaty && s.treaty.ceded ? `${fmt(s.treaty.ceded)} ${s.treaty.ceded === 1 ? 'district' : 'districts'}` : 'land'}.` : 'The walls held.';
  }
}

function firing(s: Scenario, h: E.Hardening, m: E.Material): string {
  const t = E.rulerTitleOf(s);
  if (m === 'clay') {
    if (h === 'burned') return 'Then the fire reaches the archive. It burns for three days, and in it your tablet, on its shelf with all the others, bakes as hard as a pot.';
    if (h === 'kiln') return `The ${t} orders the tablet fired in the potters’ kiln, like every tablet meant to last. It comes out ringing when you tap it.`;
    return 'Nobody orders it fired. The tablet is left to dry on the archive sill with the day-books and the receipts, and in time it is shelved, unbaked, among them.';
  }
  const sheet = m === 'paper' ? 'sheet' : 'roll';
  if (h === 'burned') return `Then the fire reaches the archive. It burns for three days, and your ${sheet} burns with it, or most of it.`;
  if (h === 'kiln') return `The ${t} orders it copied into the royal annals, and the ${sheet} itself is laid in a cedar chest with the treaties.`;
  return `Nobody orders it kept. It is tied up with the day-books and the receipts and put on a high shelf, where the damp gets at it.`;
}

// ---------------------------------------------------------------- pieces

function Crown() {
  return <svg class="tb-crown" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 18.5h18l-1.4-10-4.6 4.2L12 5l-3 7.7-4.6-4.2z" fill="currentColor" /></svg>;
}

function KingSays({ s, lines }: { s: Scenario; lines: string[] }) {
  return (
    <blockquote class="tb-king">
      <cite class="tb-king__who"><Crown /> {s.state.ruler.name}, {E.rulerTitleOf(s)} of {s.state.name}</cite>
      {lines.map((l) => <p>{/^[“"]/.test(l) ? l : `“${l}”`}</p>)}
    </blockquote>
  );
}

const ICON: Record<keyof Meters, string> = {
  favour: 'M3 18.5h18l-1.4-10-4.6 4.2L12 5l-3 7.7-4.6-4.2z',
  conscience: 'M12 4v16M6 20h12M4.5 8h15M4.5 8 2 14a2.6 2.6 0 0 0 5 0zM19.5 8 17 14a2.6 2.6 0 0 0 5 0zM12 4l-1 1.2h2z',
  household: 'M3.5 11.5 12 4.5l8.5 7M6 10v9.5h12V10M10 19.5v-5h4v5',
};
const LABEL: Record<keyof Meters, string> = { favour: 'Favour', conscience: 'Conscience', household: 'Household' };
const SPAN = 12;

/** The three meters as balances: they start level, and lean one way or the other. */
function MetersBar({ m, delta }: { m: Meters; delta: { e: Effects; n: number } | null }) {
  return (
    <ul class="tb-meters" aria-label="Your standing">
      {(Object.keys(LABEL) as (keyof Meters)[]).map((k) => {
        const d = delta?.e[k] ?? 0;
        const v = Math.max(-SPAN, Math.min(SPAN, m[k]));
        const w = (Math.abs(v) / SPAN) * 50;
        return (
          <li class={`tb-meter tb-meter--${k}`} aria-label={`${LABEL[k]}: ${m[k] > 0 ? '+' : ''}${m[k]}`} title={`${LABEL[k]} ${m[k] > 0 ? '+' : ''}${m[k]}`}>
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d={ICON[k]} fill={k === 'favour' ? 'currentColor' : 'none'} stroke="currentColor" stroke-width={k === 'favour' ? 0 : 1.7} stroke-linejoin="round" stroke-linecap="round" /></svg>
            <span class="tb-meter__name">{LABEL[k]}</span>
            <span class="tb-meter__bar" aria-hidden="true"><i class={v < 0 ? 'is-neg' : ''} style={`left:${v < 0 ? 50 - w : 50}%;width:${w}%`} /></span>
            {d !== 0 && <span key={`${delta!.n}${k}`} class={`tb-meter__d ${d > 0 ? 'is-up' : 'is-down'}`} aria-hidden="true">{d > 0 ? '▲' : '▼'}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Fx({ e }: { e: Effects }) {
  const items = (Object.keys(LABEL) as (keyof Meters)[]).filter((k) => (e[k] ?? 0) !== 0);
  if (!items.length) return null;
  return (
    <span class="tb-fx" aria-label={items.map((k) => `${LABEL[k]} ${(e[k] ?? 0) > 0 ? 'up' : 'down'}`).join(', ')}>
      {items.map((k) => (
        <span class={`tb-fx__i tb-fx__i--${k} ${(e[k] ?? 0) > 0 ? 'is-up' : 'is-down'}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="12" height="12"><path d={ICON[k]} fill={k === 'favour' ? 'currentColor' : 'none'} stroke="currentColor" stroke-width={k === 'favour' ? 0 : 2} stroke-linejoin="round" stroke-linecap="round" /></svg>
          <b>{(e[k] ?? 0) > 0 ? '▲' : '▼'}</b><span>{LABEL[k]}</span>
        </span>
      ))}
    </span>
  );
}

function SoundButton({ on, toggle, big = false }: { on: boolean; toggle: () => void; big?: boolean }) {
  return (
    <button class={`tb-sound${big ? ' tb-btn tb-btn--ghost' : ''}${on ? ' is-on' : ''}`} onClick={toggle} aria-pressed={on} aria-label={on ? 'Sound off (M)' : 'Sound on (M)'}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />{on ? <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /> : <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />}</svg>
      {big && <span>{on ? 'Sound off' : 'Sound on'}</span>}
    </button>
  );
}

interface TabletProps {
  s: Scenario; material: E.Material; specs: CaseSpec[]; reduced: boolean; label: string;
  /** On a narrow screen, the line being written: the tablet shows through a window scrolled to it. */
  focus?: SlotId | null;
  onReady: (t: ClayTablet | null) => void; onPress: () => void;
  initial: () => Record<string, { before: boolean; mode: 'hidden' | 'blank' | 'set'; text: string; lost: boolean }>;
  edge: string;
  /** The tablet as it was found (the ending). */
  finish?: { fire: { scorch?: number; kiln?: number; dry?: number }; broken: E.Condition['broken'] };
}
function TabletCanvas({ s, material, specs, reduced, label, onReady, onPress, initial, edge, finish, focus = null }: TabletProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fig = useRef<HTMLElement>(null);
  const inst = useRef<ClayTablet | null>(null);
  const [laidOut, setLaidOut] = useState(0);
  const press = useRef(onPress);
  press.current = onPress;
  const narrow = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 999px)').matches;
  const windowed = narrow && !!focus;
  useEffect(() => {
    const el = fig.current, t = inst.current;
    if (!windowed || !el || !t || !focus) return;
    const box = t.caseBox(focus);
    if (!box) return;
    el.scrollTo({ top: Math.max(0, (box.top + box.bottom) / 2 - el.clientHeight * 0.45), behavior: reduced ? 'auto' : 'smooth' });
  }, [focus, laidOut, windowed]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const t = new ClayTablet(c, { seed: s.id, material, reduced, onPress: () => press.current(), onResize: () => setLaidOut((n) => n + 1) });
    inst.current = t;
    t.setCases(specs);
    for (const [id, v] of Object.entries(initial())) t.set(id, v);
    if (edge) t.setEdge(edge, true);
    if (finish) { t.setFire(finish.fire); t.setBroken(finish.broken); }
    onReady(t);
    setLaidOut((n) => n + 1);
    return () => { t.dispose(); inst.current = null; onReady(null); };
  }, []);
  return (
    <figure class={`tb-tablet tb-tablet--${material}${windowed ? ' is-window' : ''}`} ref={fig} tabIndex={windowed ? 0 : undefined} aria-label={windowed ? 'The tablet: scroll to read every line' : undefined}>
      <canvas ref={ref} role="img" aria-label={label} />
    </figure>
  );
}

// ---------------------------------------------------------------- the ending

interface EndingProps {
  s: Scenario; sc: TabletScript; game: E.Game; cond: E.Condition; material: E.Material; scribe: string;
  tablet: preact.ComponentChildren; tb: ClayTablet | null; daily: string | null; onAnother: (() => void) | null; onAgain: () => void;
}
function Ending({ s, sc, game, cond, material, scribe, tablet, tb, daily, onAnother, onAgain }: EndingProps) {
  const ctx = E.endCtx(s, sc, game, cond);
  const lines = E.linesOf(s, sc, game, cond);
  const ending = E.endingOf(sc, game);
  const fateTitle = fill(ending.title, ctx);
  const score = E.truthScore(lines);
  const dig = E.digYear(s);
  const arch = E.archaeologist(s, sc, game, cond);
  const text = E.shareText(s, game, lines, fateTitle, daily);
  const url = new URL(`s/tablet.html?c=${encodeURIComponent(s.id)}`, location.href.replace(/#.*$/, '').replace(/[?].*$/, '').replace(/[^/]*$/, '')).toString();
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const ch = s.chronicle;
  const clay = material === 'clay';
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { text: string; url: string }) => Promise<void> };
    if (nav.share && coarse) { try { await nav.share({ text, url }); return; } catch { /* dismissed */ } }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* blocked */ }
  };
  const saveCard = async () => {
    setSaving(true);
    const squares = text.split('\n')[2]?.split(' · ')[0] ?? '';
    const blob = await renderCard(tb?.snapshot() ?? null, { kicker: `The Tablet House · ${s.city.name}, AY ${s.year}`, headline: E.headline(s, lines).replace(/^I was the scribe of [^.]+\. /, ''), fate: fateTitle, squares, foot: `Palimpsest · ${url.replace(/^https?:\/\//, '').replace(/\?.*$/, '')}` });
    setSaving(false);
    if (!blob) return;
    const file = new File([blob], `tablet-house-${s.id}.png`, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean; share?: (d: { files: File[]; text?: string; url?: string }) => Promise<void> };
    if (coarse && nav.canShare?.({ files: [file] }) && nav.share) { try { await nav.share({ files: [file], text, url }); return; } catch { /* dismissed */ } }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const chronicleSays = (id: SlotId): string | null => {
    if (!ch) return null;
    if (id === 'ours') return ch.oursLost === null ? 'Passes over it in silence' : fmt(ch.oursLost);
    if (id === 'theirs') return ch.theirsLost === null ? 'Passes over it in silence' : fmt(ch.theirsLost);
    if (id === 'end') return ch.outcomeWords ? `“${ch.outcomeWords}”` : null;
    return null;
  };
  return (
    <div class="tb-end">
      <section class="tb-col tb-end__found" aria-labelledby="tb-found">
        <p class="tb-kicker">AY {dig} · {cond.tag}</p>
        <h1 id="tb-found" class="tb-h1">Your {clay ? 'tablet' : material === 'paper' ? 'sheet' : 'roll'}, as it was found</h1>
        {tablet}
        <p class="tb-caption">{cond.text} {s.city.name}, AY {s.year}: {s.medium}{s.script ? `, in the ${s.script} script` : ''}, by the hand of {scribe}.</p>
      </section>

      <section class="tb-col tb-end__record" aria-labelledby="tb-rec">
        <h2 id="tb-rec" class="tb-h2">What you wrote, what the record says, and what the chronicle claimed</h2>
        <ol class="tb-ledger">
          {lines.map((l) => {
            const cs = chronicleSays(l.id);
            return (
              <li class={`tb-ledger__row is-${l.pick}`}>
                <span class="tb-ledger__name">{l.name}</span>
                <span class={`tb-ledger__mark is-${l.pick}`}>{PICK_NAME[l.pick]}</span>
                <span class="tb-ledger__you"><small>You wrote{l.was ? ` (amended for the ${E.rulerTitleOf(s)})` : ''}</small>{l.lost ? <s title="Lost">{l.written}</s> : l.written}</span>
                <span class="tb-ledger__truth"><small>The record</small>{l.truth}</span>
                {cs && <span class="tb-ledger__chron"><small>The chronicle</small>{cs}</span>}
              </li>
            );
          })}
        </ol>
        {ch ? (
          <figure class="tb-chron">
            {ch.quote && <blockquote>{ch.quote}</blockquote>}
            <figcaption>{ch.title ?? `The chronicle of ${s.state.name}`}, by {ch.author}, AY {ch.year} · {ch.id ? <a href={`#/p/${ch.id}`}>{ch.catalog}</a> : ch.catalog}. The account that survived {verdictOnChronicle(s)}.</figcaption>
          </figure>
        ) : <p class="tb-caption">No account of this war by {s.state.name}’s own scribes survives. Yours would have been the only one.</p>}
      </section>

      <section class="tb-col tb-end__dig" aria-labelledby="tb-dig">
        <h2 id="tb-dig" class="tb-h2">How history remembers you</h2>
        <p class="tb-arch">{arch}</p>
      </section>

      <section class="tb-col tb-end__score" aria-labelledby="tb-fate">
        <p class="tb-kicker">The Tablet House{daily ? ` · ${daily}` : ''}</p>
        <h2 id="tb-fate" class="tb-fate">{fateTitle}</h2>
        <p class="tb-fate__text">{fill(ending.text, ctx)}</p>
        <div class="tb-score">
          <div class="tb-score__big"><b>{score}%</b><span>of the truth reached AY {dig}</span></div>
          <ol class="tb-squares" aria-label={`Your lines: ${lines.map((l) => PICK_NAME[l.pick]).join(', ')}`}>{lines.map((l) => <li class={`is-${l.pick}`} title={`${l.name}: ${PICK_NAME[l.pick]}`} />)}{game.flags.includes('jar') && <li class="is-jar" title="The jar" />}</ol>
          <MetersBar m={game.meters} delta={null} />
        </div>
        <pre class="tb-sharetext">{text}</pre>
        <div class="tb-actions">
          <button class="tb-btn tb-btn--gold" onClick={share}>{copied ? 'Copied' : 'Share'}</button>
          <button class="tb-btn tb-btn--ghost" onClick={saveCard} disabled={saving}>{saving ? 'Drawing…' : 'Save the card'}</button>
          {onAnother && <button class="tb-btn tb-btn--ghost" onClick={onAnother}>Another city</button>}
          <button class="tb-btn tb-btn--ghost" onClick={onAgain}>Write it again</button>
        </div>
        <p class="tb-more">
          {s !== FIXTURE_SCENARIO && <a href={`#/p/evt:${s.event}`}>The {s.outcome === 'sacked' ? 'sack' : 'siege'} of {s.city.name} in the record →</a>}
          {s !== FIXTURE_SCENARIO && <a href={`#/p/${s.battle.id}`}>The battle at {s.battle.place} →</a>}
          <a href="#/game">Catch the lying chronicle →</a>
        </p>
      </section>
    </div>
  );
}

function verdictOnChronicle(s: Scenario): string {
  const ch = s.chronicle;
  if (!ch || ch.oursLost === null || ch.theirsLost === null) return 'chose its own words for the battle';
  const shrank = ch.oursLost < s.battle.oursLost, swelled = ch.theirsLost > s.battle.theirsLost;
  if (shrank && swelled) return 'did what kings ask: fewer of ours, more of theirs';
  if (shrank) return 'shrank our dead';
  if (swelled) return 'swelled the enemy’s dead';
  return 'wrote the battle nearly as it was';
}
