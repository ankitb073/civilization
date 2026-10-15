// The Word Machine: one word in all the world's languages, scrubbed through 8,200 years.
// #/words picks a word; #/words/<concept>?y=<year>&l=<language> is the shareable machine.

import { memo } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { WordJson, WordsIndexJson } from '../../../engine/src/export/contract.ts';
import { fold } from '../data.ts';
import { indexLanguages, loadLanguages, type Lang, type LangIndex } from '../languages.ts';
import { isMobile, navigate, route } from '../state.ts';
import { ensureMeta, meta } from '../store.ts';
import { bandName, layoutTongues, type TreeLayout } from '../tongueLayout.ts';
import {
  YEAR_MAX, YEAR_MIN, derivation, fy, gloss, lawHref, loadWord, loadWordsIndex, shown, stepAt, type Link, type Step,
} from '../words.ts';
import '../styles/words.css';

type ByLang = Map<string, Step[]>;
/** Years per millisecond while playing: the whole span in about 14 seconds. */
const SPEED = (YEAR_MAX - YEAR_MIN) / 14000;
const clampY = (y: number) => Math.max(YEAR_MIN, Math.min(YEAR_MAX, Math.round(y)));
const parseY = (v: string | null) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? clampY(Number(v)) : YEAR_MAX);
/** "AY 2112" or "2478 before AY 0" */
const yr = (y: number) => (y < 0 ? `${-y} before AY 0` : `AY ${y}`);
const span = (l: Lang) => `${fy(l.born)}–${l.died === null ? 'today' : fy(l.died)}`;
const endOf = (l: Lang) => Math.min(l.died ?? YEAR_MAX, YEAR_MAX);

export function wordHash(concept: string, y: number | null, l: string | null): string {
  const q = [y !== null ? `y=${y}` : '', l ? `l=${l}` : ''].filter(Boolean).join('&');
  return `#/words/${concept}${q ? `?${q}` : ''}`;
}

export function WordsView({ concept }: { concept: string | null }) {
  const [ix, setIx] = useState<LangIndex | null>(null);
  const [index, setIndex] = useState<WordsIndexJson | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const m = meta.value;
  useEffect(() => {
    ensureMeta().catch(() => {});
    loadLanguages().then((d) => setIx(indexLanguages(d))).catch((e) => setErr(String(e)));
    loadWordsIndex().then(setIndex).catch((e) => setErr(String(e)));
  }, []);
  useEffect(() => {
    const base = m?.title ?? 'Palimpsest';
    document.title = concept ? `‘${gloss(concept)}’ — The Word Machine — ${base}` : `The Word Machine — ${base}`;
  }, [concept, m]);

  if (err) return <div class="wm"><h1 class="h-page">The Word Machine</h1><p class="muted">Couldn’t load the words ({err}). Try reloading.</p></div>;
  if (!ix || !index) return <div class="center-load"><div class="spinner" /> Warming up the Word Machine…</div>;
  if (!concept) return <Picker ix={ix} index={index} />;
  if (!index.concepts.some((c) => c.id === concept)) {
    return (
      <div class="wm">
        <a class="eyebrow" href="#/words">← The Word Machine</a>
        <h1 class="h-page">No word ‘{gloss(concept)}’</h1>
        <p class="muted">The machine knows {index.concepts.length} words. <a href="#/words">Pick one</a>.</p>
      </div>
    );
  }
  return <Machine ix={ix} index={index} concept={concept} />;
}

// ---------------------------------------------------------------- picker
function Picker({ ix, index }: { ix: LangIndex; index: WordsIndexJson }) {
  const [q, setQ] = useState('');
  const m = meta.value;
  const ed = ix.byId.get(index.sampleLanguage)?.name;
  const f = fold(q.trim());
  const hits = index.concepts.filter((c) => !f || fold(gloss(c.id)).includes(f) || fold(c.modern).includes(f));
  const groups: [g: 'core' | 'culture', title: string, blurb: string][] = [
    ['core', 'Core vocabulary', 'Sun, water, mother, two: the old words every language keeps and wears down.'],
    ['culture', 'Culture words', 'Kings, gods, silver, war, books and machines: the words that travel, and get borrowed.'],
  ];
  return (
    <div class="wm wm--pick">
      <header class="wm__head">
        <div class="eyebrow">{index.concepts.length} words · {ix.data.languages.length} languages · 8,200 years</div>
        <h1 class="h-page wm__title">The Word Machine</h1>
        <p class="wm__lede">
          Pick a word and watch it change in every language of {m?.worldName ?? 'the world'}: from six proto-forms before the archive
          to the tongues spoken today, every sound law dated and every borrowing marked.
        </p>
        <input class="input wm__q" type="search" value={q} placeholder="Find a word: water, king, mbingash…" aria-label="Find a word"
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && hits.length) navigate(`#/words/${hits[0].id}`); }} />
      </header>
      {groups.map(([g, title, blurb]) => {
        const list = hits.filter((c) => c.group === g);
        if (!list.length) return null;
        return (
          <section class="wm__group" aria-labelledby={`wg-${g}`}>
            <h2 class="sect" id={`wg-${g}`}>{title} <span class="wm__count">{list.length}</span></h2>
            <p class="muted small wm__blurb">{blurb}</p>
            <ul class="wgrid">
              {list.map((c) => (
                <li><a class="wcard" href={`#/words/${c.id}`}><span class="wcard__g">{gloss(c.id)}</span><i class="wcard__m">{c.modern}</i></a></li>
              ))}
            </ul>
          </section>
        );
      })}
      {!hits.length && <p class="muted">No word matches “{q}”.</p>}
      <p class="muted small wm__foot">
        Today’s forms are {ed ?? 'the editorial language'}, the archive’s editorial language. Every family tree is in <a href="#/languages">the Tree of Tongues</a>.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- the machine
function Machine({ ix, index, concept }: { ix: LangIndex; index: WordsIndexJson; concept: string }) {
  const params = route.value.params;
  const pkey = `${route.value.id}?${params.toString()}`;
  const validLang = (v: string | null) => (v && ix.byId.has(v) ? v : null);
  const [y, setYState] = useState(() => parseY(params.get('y')));
  const [sel, setSel] = useState<string | null>(() => validLang(params.get('l')));
  const [hover, setHover] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [word, setWord] = useState<WordJson | null>(null);
  const [wordErr, setWordErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const yRef = useRef(y);
  yRef.current = y;
  const setY = (v: number) => setYState(clampY(v));
  const mobile = isMobile.value;
  const m = meta.value;

  // a shared link, back/forward: take the year and language from the URL
  useEffect(() => {
    const p = route.peek().params;
    setYState(parseY(p.get('y')));
    setSel(validLang(p.get('l')));
  }, [pkey]);
  // and write them back without adding history entries
  useEffect(() => {
    const t = setTimeout(() => {
      const next = wordHash(concept, y === YEAR_MAX ? null : y, sel);
      if (location.hash !== next) history.replaceState(null, '', next);
    }, 220);
    return () => clearTimeout(t);
  }, [concept, y, sel]);

  useEffect(() => {
    let live = true;
    setWordErr(null);
    loadWord(concept).then((w) => { if (live) setWord(w); }).catch((e) => { if (live) setWordErr(String(e)); });
    return () => { live = false; };
  }, [concept]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    let cur = yRef.current >= YEAR_MAX ? YEAR_MIN : yRef.current;
    setYState(cur);
    const tick = (now: number) => {
      cur = Math.min(YEAR_MAX, cur + Math.min(64, now - last) * SPEED);
      last = now;
      setYState(Math.round(cur));
      if (cur >= YEAR_MAX) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const byLang: ByLang | null = useMemo(() => (word ? new Map(word.langs.map((l) => [l.id, l.steps])) : null), [word]);
  const lay = useMemo(() => layoutTongues(ix), [ix]);
  const focus = hover ?? sel;
  const lit = useMemo(() => {
    if (!focus) return null;
    const s = new Set<string>();
    for (let l = ix.byId.get(focus); l; l = l.parent ? ix.byId.get(l.parent) : undefined) s.add(l.id);
    return s;
  }, [ix, focus]);
  const chain = useMemo(() => (byLang && sel ? derivation(byLang, ix, sel) : null), [byLang, ix, sel]);
  const roots = useMemo(() => ix.families.map((f) => {
    const s = byLang?.get(f.id)?.[0];
    return { id: f.id, name: f.name, color: f.color, form: s ? shown(s) : '…' };
  }), [ix, byLang]);
  const hist = useMemo(() => {
    const bins = new Array<number>(Math.ceil((YEAR_MAX - YEAR_MIN) / 100)).fill(0);
    let laws = 0, reps = 0;
    for (const steps of byLang?.values() ?? []) for (let i = 1; i < steps.length; i++) {
      bins[Math.min(bins.length - 1, Math.floor((steps[i][0] - YEAR_MIN) / 100))]++;
      if (steps[i][3] === 'replaced') reps++; else laws++;
    }
    return { bins, max: Math.max(1, ...bins), laws, reps };
  }, [byLang]);

  const pick = (id: string | null) => { setSel(id); setHover(null); };
  const stop = () => setPlaying(false);
  const copy = async () => {
    const url = location.href.replace(/#.*$/, '') + wordHash(concept, y, sel);
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { try { await navigator.share?.({ title: `‘${gloss(concept)}’ in the Word Machine`, url }); } catch { /* cancelled */ } }
  };
  const c = index.concepts.find((x) => x.id === concept)!;
  const ed = ix.byId.get(index.sampleLanguage);
  const era = y < 0 ? 'before the archive' : (m?.eras.find((e) => y >= e.start && y < e.end) ?? m?.eras[m.eras.length - 1])?.name ?? '';
  const loading = !byLang || word?.concept !== concept;
  const pct = ((y - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100;

  return (
    <div class={`wm${sel ? ' has-sel' : ''}`}>
      <header class="wm__head">
        <a class="eyebrow" href="#/words">← The Word Machine · {index.concepts.length} words</a>
        <h1 class="h-page wm__title">‘{gloss(concept)}’</h1>
        <p class="wm__lede">
          {ed && <>Today, in {ed.name}: <i>{c.modern}</i>. </>}
          {hist.laws.toLocaleString('en-US')} sound changes{hist.reps ? ` and ${hist.reps} borrowing${hist.reps === 1 ? '' : 's'}` : ''} across {ix.data.languages.length} languages.
          {' '}{mobile ? 'Tap' : 'Click'} a language to trace its word back to the root.
        </p>
        <div class="wm__tools">
        <div class="wm__roots" role="group" aria-label="The six family roots">
          {roots.map((r) => (
            <button class={`wm__root${sel === r.id ? ' is-on' : ''}`} style={{ '--c': r.color }} aria-pressed={sel === r.id} onClick={() => pick(sel === r.id ? null : r.id)}>
              <span class="wm__dot" aria-hidden="true" />{r.name} <i>{r.form}</i>
            </button>
          ))}
        </div>
        <label class="wm__pickw">
          <span>Word</span>
          <select class="input" value={concept} onChange={(e) => navigate(wordHash((e.target as HTMLSelectElement).value, y === YEAR_MAX ? null : y, sel))}>
            {(['core', 'culture'] as const).map((g) => (
              <optgroup label={g === 'core' ? 'Core vocabulary' : 'Culture words'}>
                {index.concepts.filter((x) => x.group === g).map((x) => <option value={x.id}>{gloss(x.id)} · {x.modern}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        </div>
      </header>

      <div class="wm-bar">
        <button class="btn-icon wm-play" aria-label={playing ? 'Pause' : 'Play through 8,200 years'} aria-pressed={playing} onClick={() => setPlaying(!playing)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /> : <path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor" />}
          </svg>
        </button>
        <div class="wm-year">
          <b>{y < 0 ? fy(y) : `AY ${y}`}</b>
          <span>{y < 0 ? 'years before AY 0' : era}</span>
        </div>
        <div class="wm-scrub">
          <svg class="wm-hist" viewBox={`0 0 ${hist.bins.length} 1`} preserveAspectRatio="none" aria-hidden="true">
            <rect class="wm-hist__pre" x="0" y="0" width={-YEAR_MIN / 100} height="1" />
            {hist.bins.map((n, i) => n > 0 && <rect x={i + 0.1} width="0.8" y={1 - n / hist.max} height={n / hist.max} />)}
            {chain?.filter((k) => k.kind === 'law' || k.kind === 'replaced' || k.kind === 'swapped').map((k) => (
              <line class="wm-hist__sel" x1={(k.y - YEAR_MIN) / 100} x2={(k.y - YEAR_MIN) / 100} y1="0" y2="1" />
            ))}
          </svg>
          <input class="wm-range" type="range" min={YEAR_MIN} max={YEAR_MAX} step={1} value={y} style={{ '--p': `${pct}%` }}
            aria-label="Year" aria-valuetext={yr(y)}
            onInput={(e) => { stop(); setY(Number((e.target as HTMLInputElement).value)); }}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
              if (d) { e.preventDefault(); stop(); setY(yRef.current + d * (e.shiftKey ? 100 : 10)); }
            }} />
        </div>
        <button class="btn btn--ghost wm-copy" onClick={copy}>{copied ? 'Link copied' : 'Copy link'}</button>
      </div>

      <div class="wm__body">
        <div class="wm__main">
          {wordErr && <p class="banner">Couldn’t load ‘{gloss(concept)}’ ({wordErr}).</p>}
          {!byLang ? <div class="center-load"><div class="spinner" /> Looking up ‘{gloss(concept)}’…</div> : mobile ? (
            <WordList ix={ix} byLang={byLang} y={y} sel={sel} onPick={pick} roots={roots} />
          ) : (
            <>
              <Tree ix={ix} lay={lay} byLang={byLang} y={y} sel={sel} lit={lit} roots={roots} loading={loading}
                onPick={pick} onHover={setHover} onYear={(v) => { stop(); setY(v); }} />
              <details class="a11ylist wm__list" onToggle={(e) => setListOpen((e.currentTarget as HTMLDetailsElement).open)}>
                <summary>All {ix.data.languages.length} languages and their word for ‘{gloss(concept)}’, as a list</summary>
                {listOpen && <WordList ix={ix} byLang={byLang} y={y} sel={sel} onPick={pick} roots={roots} />}
              </details>
            </>
          )}
        </div>
        <aside class="wm__panel" aria-label="Derivation">
          {sel && chain ? (
            <Derivation ix={ix} chain={chain} sel={sel} y={y} concept={concept} onClose={() => pick(null)} />
          ) : (
            <Intro concept={concept} roots={roots} ix={ix} byLang={byLang} onPick={pick} />
          )}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tree (desktop)
interface Geom { width: number; height: number; L: number; R: number; TOP: number; BOT: number; rowH: number; X: (y: number) => number; Y: (r: number) => number }
function geom(width: number, lay: TreeLayout): Geom {
  const L = 14, R = 196, TOP = 54, BOT = 26, rowH = 13;
  const cw = width - L - R;
  return {
    width, L, R, TOP, BOT, rowH,
    height: TOP + (lay.total + 1) * rowH + BOT,
    X: (y: number) => L + ((y - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * cw,
    Y: (r: number) => TOP + (r + 0.5) * rowH,
  };
}

interface Root { id: string; name: string; color: string; form: string }

function Tree({ ix, lay, byLang, y, sel, lit, roots, loading, onPick, onHover, onYear }: {
  ix: LangIndex; lay: TreeLayout; byLang: ByLang; y: number; sel: string | null; lit: Set<string> | null; roots: Root[]; loading: boolean;
  onPick: (id: string | null) => void; onHover: (id: string | null) => void; onYear: (y: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const g = useMemo(() => geom(Math.max(640, w), lay), [w, lay]);
  // the set of dead languages only grows with the year, so its size identifies it
  const deadN = lay.rows.reduce((n, r) => n + (r.lang.died !== null && r.lang.died < y ? 1 : 0), 0);
  const dead = useMemo(() => new Set(lay.rows.filter((r) => r.lang.died !== null && r.lang.died < y).map((r) => r.lang.id)), [deadN, lay]);
  const order = useMemo(() => lay.rows.slice().sort((a, b) => a.row - b.row), [lay]);
  const meta_ = meta.value;

  const idOf = (e: Event) => (e.target as Element).getAttribute?.('data-id');
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = order.findIndex((r) => r.lang.id === sel);
      const j = i < 0 ? 0 : Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      onPick(order[j].lang.id);
      const top = (wrapRef.current?.getBoundingClientRect().top ?? 0) + g.Y(order[j].row);
      if (top < 180 || top > innerHeight - 60) window.scrollBy({ top: top - innerHeight / 2 });
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      onYear(y + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 100 : 10));
    } else if (e.key === 'Escape') onPick(null);
  };
  const selRow = sel ? lay.rows.find((r) => r.lang.id === sel) : undefined;
  const cx = g.X(y);
  const label = y < 0 ? fy(y) : `AY ${y}`;
  const lw = label.length * 6.6 + 14;

  return (
    <div class={`wt-wrap${loading ? ' is-loading' : ''}`} ref={wrapRef} tabIndex={0} role="group"
      aria-label="Word tree. Up and down arrows choose a language; left and right arrows move through time."
      onKeyDown={onKey} onPointerLeave={() => onHover(null)}>
      {w > 0 && (
        <svg width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`} class={`wt${lit ? ' has-lit' : ''}`} role="img"
          aria-label={`The word in ${ix.data.languages.length} languages at ${yr(y)}`}
          onPointerMove={(e) => { if (e.pointerType === 'mouse') onHover(idOf(e) ?? null); }}
          onClick={(e) => { const id = idOf(e); if (id) onPick(id === sel ? null : id); }}>
          <defs><clipPath id="wt-past"><rect x="0" y="0" width={Math.max(0, cx)} height={g.height} /></clipPath></defs>
          <Frame g={g} lay={lay} roots={roots} eras={meta_?.eras ?? null} />
          {selRow && <rect class="wt-selband" x={0} y={g.Y(selRow.row) - g.rowH / 2} width={g.width} height={g.rowH} rx="3" />}
          <Rows g={g} ix={ix} lay={lay} byLang={byLang} lit={lit} dead={null} faint />
          <g clip-path="url(#wt-past)">
            <Rows g={g} ix={ix} lay={lay} byLang={byLang} lit={lit} dead={dead} faint={false} />
          </g>
          <g class="wt-cur" aria-hidden="true">
            <line x1={cx} x2={cx} y1={g.TOP - 8} y2={g.height - g.BOT + 4} />
            <rect x={Math.max(2, Math.min(g.width - lw - 2, cx - lw / 2))} y="6" width={lw} height="19" rx="9.5" />
            <text x={Math.max(2 + lw / 2, Math.min(g.width - lw / 2 - 2, cx))} y="19.5" text-anchor="middle">{label}</text>
          </g>
          <Hits g={g} lay={lay} />
          <Labels g={g} ix={ix} lay={lay} byLang={byLang} y={y} sel={sel} lit={lit} />
        </svg>
      )}
    </div>
  );
}

/** Axis, eras, the pre-archive band and the family names with their roots (static per word and width). */
const Frame = memo(function Frame({ g, lay, roots, eras }: { g: Geom; lay: TreeLayout; roots: Root[]; eras: { name: string; start: number; end: number }[] | null }) {
  const { X, Y, TOP, BOT, height, rowH } = g;
  return (
    <g>
      <rect x={X(YEAR_MIN)} y={TOP - 4} width={X(0) - X(YEAR_MIN)} height={height - TOP - BOT + 8} class="tt-pre" />
      <text x={X(YEAR_MIN) + 6} y={TOP - 10} class="tt-band">BEFORE THE ARCHIVE · PROTO-LANGUAGES</text>
      {(eras ?? []).map((e, i) => (
        <g>
          <line x1={X(e.start)} x2={X(e.start)} y1={TOP - 4} y2={height - BOT + 4} class={i === 0 ? 'tt-zero' : 'tt-era'} />
          {X(e.end) - X(e.start) > bandName(e.name).length * 6.4 + 8 && <text x={X(e.start) + 5} y={TOP - 10} class="tt-band">{bandName(e.name)}</text>}
        </g>
      ))}
      {[-3000, -2000, -1000, 0, 1000, 2000, 3000, 4000, 5000].map((t) => (
        <text x={X(t)} y={height - 8} class="tt-tick" text-anchor="middle">{t === 0 ? 'AY 0' : fy(t)}</text>
      ))}
      {lay.blocks.map((b) => {
        const r = roots.find((x) => x.id === b.id);
        return (
          <text x={X(YEAR_MIN) + 6} y={Y(b.top) - rowH * 0.95} class="tt-fam" fill={b.color}>
            {b.name} <tspan class="tt-fam__n">{b.size}</tspan>{r && <tspan class="wt-root" dx="8">{r.form}</tspan>}
          </text>
        );
      })}
    </g>
  );
});

/** Every language's life line, its branch and a tick for each change of the word (a ring for a borrowing). */
const Rows = memo(function Rows({ g, ix, lay, byLang, lit, dead, faint }: {
  g: Geom; ix: LangIndex; lay: TreeLayout; byLang: ByLang; lit: Set<string> | null; dead: Set<string> | null; faint: boolean;
}) {
  const { X, Y } = g;
  return (
    <g class={faint ? 'wt-rows wt-rows--faint' : 'wt-rows'}>
      {lay.rows.map((r) => {
        const l = r.lang, c = ix.color.get(l.id)!, y = Y(r.row);
        const x0 = X(l.born), x1 = X(endOf(l));
        const on = lit?.has(l.id);
        const cls = `${on ? 'is-lit' : lit ? 'is-off' : ''}${dead?.has(l.id) ? ' is-dead' : ''}`;
        const steps = byLang.get(l.id) ?? [];
        let conn = null;
        if (r.parentRow >= 0) {
          const y0 = Y(r.parentRow), rr = Math.min(5, Math.abs(y - y0) / 2, (x1 - x0) / 2), dir = y > y0 ? 1 : -1;
          conn = <path class="wt-conn" d={`M${x0},${y0}V${y - dir * rr}Q${x0},${y} ${x0 + rr},${y}`} stroke={c} />;
        }
        return (
          <g class={cls}>
            {conn}
            <line class="wt-life" x1={x0} x2={x1} y1={y} y2={y} stroke={c} />
            {l.died !== null && <line x1={x1} x2={x1} y1={y - 3} y2={y + 3} stroke={c} stroke-width="1.2" />}
            {!l.parent && <circle cx={x0} cy={y} r="3.4" fill={c} />}
            {steps.map((s, i) => (i === 0 ? null : s[3] === 'replaced'
              ? <circle class="wt-rep" cx={X(s[0])} cy={y} r="2.7" />
              : <line class="wt-tick" x1={X(s[0])} x2={X(s[0])} y1={y - 3.6} y2={y + 3.6} stroke={c} />))}
          </g>
        );
      })}
    </g>
  );
});

/** Transparent hit targets along each line (the labels above them are clickable too). */
const Hits = memo(function Hits({ g, lay }: { g: Geom; lay: TreeLayout }) {
  return (
    <g>
      {lay.rows.map((r) => <line x1={g.X(r.lang.born)} x2={g.X(endOf(r.lang))} y1={g.Y(r.row)} y2={g.Y(r.row)} class="tt-hit" data-id={r.lang.id} />)}
    </g>
  );
});

/** The word in each language at the year: beside the cursor while the language lives, at its end once it has died. */
function Labels({ g, ix, lay, byLang, y, sel, lit }: { g: Geom; ix: LangIndex; lay: TreeLayout; byLang: ByLang; y: number; sel: string | null; lit: Set<string> | null }) {
  return (
    <g class="wt-lab">
      {lay.rows.map((r) => {
        const l = r.lang;
        if (y < l.born) return null;
        const end = endOf(l), at = Math.min(y, end);
        const s = stepAt(byLang.get(l.id) ?? [], at);
        if (!s) return null;
        const cls = `${end < y ? 'is-dead' : ''}${l.id === sel ? ' is-sel' : lit && !lit.has(l.id) ? ' is-off' : ''}`;
        return (
          <text x={g.X(at) + 5} y={g.Y(r.row) + 4} class={cls} data-id={l.id}>
            <tspan class="wt-f" data-id={l.id}>{shown(s)}</tspan>
            <tspan class="wt-n" dx="5" data-id={l.id}>{l.name}</tspan>
          </text>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------- list (phone, and the accessible alternative)
function WordList({ ix, byLang, y, sel, onPick, roots }: { ix: LangIndex; byLang: ByLang; y: number; sel: string | null; onPick: (id: string | null) => void; roots: Root[] }) {
  const kids = useMemo(() => {
    const k = new Map<string, Lang[]>();
    for (const l of ix.data.languages) if (l.parent) { if (!k.has(l.parent)) k.set(l.parent, []); k.get(l.parent)!.push(l); }
    for (const v of k.values()) v.sort((a, b) => a.born - b.born || a.id.localeCompare(b.id));
    return k;
  }, [ix]);
  const item = (l: Lang) => {
    const end = endOf(l);
    const s = y < l.born ? null : stepAt(byLang.get(l.id) ?? [], Math.min(y, end));
    const state = y < l.born ? 'unborn' : end < y ? 'dead' : 'alive';
    const ks = kids.get(l.id);
    return (
      <li class={`wl__i is-${state}`}>
        <button class={`wl__b${sel === l.id ? ' is-sel' : ''}`} aria-pressed={sel === l.id} style={{ '--c': ix.color.get(l.id) }} onClick={() => onPick(sel === l.id ? null : l.id)}>
          <span class="wl__n">{l.name}</span>
          <i class="wl__f">{s ? shown(s) : '—'}</i>
          <span class="wl__y">{state === 'unborn' ? `from ${fy(l.born)}` : span(l)}</span>
        </button>
        {ks && <ul>{ks.map(item)}</ul>}
      </li>
    );
  };
  return (
    <div class="wl">
      {ix.families.map((f) => {
        const root = ix.byId.get(f.id);
        const r = roots.find((x) => x.id === f.id);
        return root ? (
          <section class="wl__fam" style={{ '--c': f.color }} aria-label={`${f.name} family`}>
            <h2 class="wl__h"><span class="wm__dot" aria-hidden="true" />{f.name} family <span class="muted small">{f.size}</span> <i>{r?.form}</i></h2>
            <ul class="wl__root">{item(root)}</ul>
          </section>
        ) : null;
      })}
    </div>
  );
}

// ---------------------------------------------------------------- derivation panel
function Derivation({ ix, chain, sel, y, concept, onClose }: { ix: LangIndex; chain: Link[]; sel: string; y: number; concept: string; onClose: () => void }) {
  const l = ix.byId.get(sel)!;
  const fam = ix.familyOf.get(sel);
  const parent = l.parent ? ix.byId.get(l.parent) : undefined;
  const end = endOf(l);
  const at = Math.min(y, end);
  let now = -1;
  chain.forEach((k, i) => { if (k.y <= at) now = i; });
  const cur = now >= 0 ? chain[now] : null;
  const stages: { lang: string; links: Link[] }[] = [];
  for (const k of chain) {
    const st = stages[stages.length - 1];
    if (st && st.lang === k.lang) st.links.push(k); else stages.push({ lang: k.lang, links: [k] });
  }
  const laws = chain.filter((k) => k.kind === 'law').length;
  const reps = chain.filter((k) => k.kind === 'replaced' || k.kind === 'swapped').length;
  const visible = chain.filter((k) => k.kind !== 'split');
  const curV = visible.filter((k) => k.y <= at).pop();
  const name = (id: string) => ix.byId.get(id)?.name ?? id;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.closest('.wm__panel')?.scrollTo({ top: 0 }); }, [sel, concept]);
  return (
    <section class="dv" ref={ref} aria-labelledby="dv-t">
      <div class="dv__top">
        <div>
          <div class="eyebrow">‘{gloss(concept)}’ in</div>
          <h2 class="dv__t" id="dv-t"><span class="wm__dot" style={{ '--c': ix.color.get(sel) }} aria-hidden="true" />{l.name}</h2>
        </div>
        <button class="btn-icon btn-icon--sm dv__x" aria-label="Close the derivation" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        </button>
      </div>
      <div class="dv__m">{fam?.name} family · {parent ? <>daughter of {parent.name}</> : 'proto-language'} · {span(l)}</div>
      <p class="dv__now">
        {y < l.born ? <>Not yet spoken in {yr(y)}{cur && <>; {name(cur.lang)} said <i>{cur.form}</i></>}.</>
          : end < y ? <>Extinct since AY {l.died}; its last form was <i>{cur?.form}</i>.</>
          : <>In {yr(y)}: <i>{cur?.form}</i> <span class="dv__ipa">{cur?.ipa}</span></>}
      </p>
      <p class="dv__chain" aria-label="The derivation in one line">
        {visible.map((k, i) => (
          <>
            {i > 0 && <span class="dv__arr" aria-hidden="true"> → </span>}
            <span class={`dv__cf${k.y > at ? ' is-later' : ''}${k === curV ? ' is-now' : ''}${k.kind === 'replaced' || k.kind === 'swapped' ? ' is-rep' : ''}`}
              title={`${fy(k.y)} · ${name(k.lang)}${k.change ? ` · ${k.change}` : ''}`}><i>{k.form}</i></span>
          </>
        ))}
      </p>
      <p class="dv__n">
        {laws} sound law{laws === 1 ? '' : 's'}{reps ? `, ${reps} borrowing${reps === 1 ? '' : 's'}` : ''} between {fy(chain[0].y)} and {fy(chain[chain.length - 1].y)}
        {stages.length > 1 ? `, through ${stages.length} languages` : ''}.
      </p>
      <ol class="dv__stages">
        {stages.map((st) => {
          const sl = ix.byId.get(st.lang)!;
          return (
            <li class="dv__stage" style={{ '--c': ix.color.get(st.lang) }}>
              <div class="dv__sh">
                <a href={`#/p/${st.lang}`}>{sl.name}</a>
                <span>{sl.parent ? `splits from ${name(sl.parent)}, ${yr(sl.born)}` : 'proto-language, before the archive'}</span>
              </div>
              <ol class="dv__steps">
                {st.links.map((k) => (
                  <li class={`dv__s dv__s--${k.kind}${k.y > at ? ' is-later' : ''}${k === cur ? ' is-now' : ''}`}>
                    <span class="dv__y">{fy(k.y)}</span>
                    <span class="dv__f"><i>{k.form}</i> <span class="dv__ipa">{k.ipa}</span></span>
                    <span class="dv__c">
                      {k.kind === 'law' ? <a href={lawHref(k.lang, k.y, k.change!)} title={`${k.change}: the dated law on the ${sl.name} page`}>{k.change}</a>
                        : k.kind === 'replaced' ? <span class="dv__rep">replaced by a borrowing</span>
                        : k.kind === 'swapped' ? <span class="dv__rep">a different word at the split</span>
                        : k.kind === 'respelled' ? 'respelled at the split'
                        : k.kind === 'proto' ? 'proto-form' : 'inherited'}
                    </span>
                  </li>
                ))}
              </ol>
            </li>
          );
        })}
      </ol>
      <div class="actions">
        <a class="btn" href={`#/p/${sel}`}>{l.name}: dated sound laws</a>
        <a class="btn btn--ghost" href="#/languages">Tree of Tongues</a>
      </div>
    </section>
  );
}

/** The side panel before a language is chosen: how to read the chart, the six roots, the most-changed tongues. */
function Intro({ concept, roots, ix, byLang, onPick }: { concept: string; roots: Root[]; ix: LangIndex; byLang: ByLang | null; onPick: (id: string) => void }) {
  const most = useMemo(() => {
    if (!byLang) return [];
    return ix.data.languages
      .map((l) => ({ l, n: derivation(byLang, ix, l.id).filter((k) => k.kind === 'law' || k.kind === 'replaced' || k.kind === 'swapped').length }))
      .filter((x) => x.l.died === null)
      .sort((a, b) => b.n - a.n || a.l.name.localeCompare(b.l.name))
      .slice(0, 5);
  }, [ix, byLang]);
  return (
    <div class="dv dv--intro">
      <h2 class="sect">How to read it</h2>
      <p>
        Each line is a language, branching where a daughter split from its mother. The word beside the cursor is
        ‘{gloss(concept)}’ as that language said it in the year on the slider; a tick marks each sound law that changed it,
        a ring each time it was <span class="dv__rep">replaced by a borrowing</span>. Unborn and extinct languages are dimmed.
      </p>
      <h2 class="sect">Six families, six roots</h2>
      <ul class="dv__roots">
        {roots.map((r) => (
          <li><button class="linkish" onClick={() => onPick(r.id)}><span class="wm__dot" style={{ '--c': r.color }} aria-hidden="true" />{r.name}</button> <i>{r.form}</i></li>
        ))}
      </ul>
      {most.length > 0 && (
        <>
          <h2 class="sect">Worn down the most</h2>
          <ul class="dv__roots">
            {most.map(({ l, n }) => {
              const s = stepAt(byLang!.get(l.id) ?? [], YEAR_MAX);
              return <li><button class="linkish" onClick={() => onPick(l.id)}>{l.name}</button> <i>{s ? shown(s) : ''}</i> <span class="muted small">{n} changes</span></li>;
            })}
          </ul>
        </>
      )}
    </div>
  );
}
