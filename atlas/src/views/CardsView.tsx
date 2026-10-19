// Clash of the Ages (#/cards): a top-trumps duel with a deck drawn from the record (deck.json). You and the archive
// are each dealt seven cards, paired by kind; you pick a stat on your card and the higher number wins. Four wins take
// the match, and the hand is played out to the seventh card for the final score. The daily deal is the same for
// everyone on the same day. #/cards/deck shows the whole deck.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { DeckJson, Era } from '../../../engine/src/export/contract.ts';
import { fetchJson } from '../data.ts';
import { todayKey } from '../book.ts';
import { ensureMeta, meta } from '../store.ts';
import { armsSvg, sigilSvg } from '../heraldry.ts';
import '../styles/cards.css';

type Card = DeckJson['cards'][number];
type Kind = DeckJson['kinds'][number];
const ROUNDS = 7, TO_WIN = 4;
const RARITY = ['Common', 'Rare', 'Epic', 'Legendary'];
const ERA_TONE: Record<string, string> = { bronze: '#94592b', iron: '#4a5865', coin: '#86671c', parchment: '#5f7434', print: '#215a7f', engines: '#7a3029', networks: '#4a3f82' };

/** The deal: the same for everyone with the same key. */
function seeded(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

interface Pair { mine: Card; theirs: Card }
/** Seven pairs of cards of one kind each: two rulers, two generals, two states, and a city or a faith, in a dealt order.
 *  Common cards turn up more often than legendary ones. */
function deal(deck: DeckJson, key: string): Pair[] {
  const rnd = seeded(`clash:${key}`);
  const kinds: Card['kind'][] = ['ruler', 'ruler', 'general', 'general', 'state', 'state', rnd() < 0.5 ? 'city' : 'faith'];
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  const used = new Set<string>();
  const W = [1, 0.62, 0.36, 0.18];
  const draw = (kind: Card['kind']) => {
    const pool = deck.cards.filter((c) => c.kind === kind && !used.has(c.id));
    const total = pool.reduce((t, c) => t + W[c.rarity], 0);
    let x = rnd() * total;
    for (const c of pool) { x -= W[c.rarity]; if (x <= 0) { used.add(c.id); return c; } }
    used.add(pool[pool.length - 1].id);
    return pool[pool.length - 1];
  };
  return kinds.map((k) => ({ mine: draw(k), theirs: draw(k) }));
}

const compact = (v: number) => {
  if (v >= 1e9) return `${(v / 1e9).toPrecision(3)}B`;
  if (v >= 1e6) return `${(v / 1e6).toPrecision(3)}M`;
  if (v >= 1e5) return `${Math.round(v / 1e3)}k`;
  return v.toLocaleString('en-US');
};
const exact = (v: number) => v.toLocaleString('en-US');
const eraShort = (e: Era | undefined) => (e ? e.name.replace(/^Age of /, '').replace(/ and .*$/, '') : '');
const plural = (n: string) => (n.endsWith('y') ? `${n.slice(0, -1)}ies` : `${n}s`);
const plainName = (n: string) => n.replace(/\s*\((AY|founded)[^)]*\)\s*$/, '');
const yearsOf = (c: Card) => `AY ${c.years[0] < 0 ? `−${-c.years[0]}` : c.years[0]}–${c.years[1] >= 5000 ? (c.kind === 'ruler' ? 5000 : 'today') : c.years[1]}`;

// the match in progress survives a visit to a card's page and back
interface Match { key: string; i: number; picks: number[]; results: (1 | 0 | -1)[]; done: boolean }
let saved: Match | null = null;
const SEEN = 'pal-cards-seen';
function readSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN) ?? '[]') as string[]); } catch { return new Set(); }
}
function addSeen(ids: string[]) {
  try { const s = readSeen(); for (const id of ids) s.add(id); localStorage.setItem(SEEN, JSON.stringify([...s])); } catch { /* storage blocked */ }
}

function Crest({ card, n }: { card: Card; n: string }) {
  const arms = useMemo(() => armsSvg(card.arms, { uid: `${n}${card.id}` }), [card, n]);
  const sigil = useMemo(() => (card.sigil ? sigilSvg(card.sigil, { uid: `${n}s${card.id}` }) : ''), [card, n]);
  return (
    <div class={`pc__crest${sigil ? ' pc__crest--person' : ''}`}>
      {sigil && <span class="pc__sigil" dangerouslySetInnerHTML={{ __html: sigil }} />}
      <span class="pc__arms" dangerouslySetInnerHTML={{ __html: arms }} />
    </div>
  );
}

/** A small card for the hands and the recap: its crest, face down until it has been played. */
function Mini({ card, era, n, down = false, mark, now = false }: { card: Card; era: Era | undefined; n: string; down?: boolean; mark?: 1 | 0 | -1; now?: boolean }) {
  const svg = useMemo(() => (down ? '' : card.sigil ? sigilSvg(card.sigil, { uid: `${n}${card.id}`, title: false }) : armsSvg(card.arms, { uid: `${n}${card.id}`, title: false })), [card, n, down]);
  return (
    <span class={`mini${down ? ' is-down' : ''}${now ? ' is-now' : ''}${mark === 1 ? ' is-win' : mark === -1 ? ' is-loss' : mark === 0 ? ' is-tie' : ''}`} style={{ '--era': ERA_TONE[era?.id ?? ''] ?? '#6b5a44' }} title={down ? `${era?.name ?? ''}` : plainName(card.name)}>
      {!down && <span class="mini__crest" dangerouslySetInnerHTML={{ __html: svg }} />}
      {mark !== undefined && <span class="mini__mark" aria-hidden="true">{mark === 1 ? '✓' : mark === -1 ? '✕' : '='}</span>}
    </span>
  );
}

interface CardProps {
  card: Card; kind: Kind; era: Era | undefined; no: number; n: string;
  down?: boolean; picked?: number | null; verdict?: 1 | 0 | -1 | null; onPick?: (k: number) => void;
}
export function PlayingCard({ card, kind, era, no, n, down = false, picked = null, verdict = null, onPick }: CardProps) {
  const tone = ERA_TONE[era?.id ?? ''] ?? '#6b5a44';
  return (
    <article class={`pc pc--r${card.rarity}${down ? ' is-down' : ''}${verdict === 1 ? ' is-winner' : verdict === -1 ? ' is-loser' : ''}`} style={{ '--era': tone }} aria-label={down ? `A face-down ${kind.name.toLowerCase()} of the ${era?.name ?? ''}` : `${kind.name}: ${card.name}`}>
      <div class="pc__inner">
        <div class="pc__face pc__front" aria-hidden={down}>
          <header class="pc__band"><span>{kind.name}</span><span>{eraShort(era)}</span></header>
          <Crest card={card} n={n} />
          <h2 class="pc__name"><a href={`#/p/${card.id}`} tabIndex={down ? -1 : 0}>{plainName(card.name)}</a></h2>
          <p class="pc__role">{card.role}<span> · {yearsOf(card)}</span></p>
          <ol class="pc__stats">
            {kind.stats.map((s, k) => {
              const v = card.stats[k];
              const cls = `pc__stat${picked === k ? ' is-picked' : ''}${picked === k && verdict !== null ? (verdict === 1 ? ' is-win' : verdict === -1 ? ' is-lose' : ' is-tie') : ''}`;
              const inner = (
                <>
                  <span class="pc__label">{s.label}</span>
                  <span class="pc__val" title={`${exact(v)}${s.unit ? ` ${s.unit}` : ''}`}>{compact(v)}{s.unit === 'yrs' && <small>yrs</small>}</span>
                </>
              );
              return <li>{onPick && !down ? <button class={cls} onClick={() => onPick(k)} aria-label={`${s.label}: ${exact(v)}${s.unit ? ` ${s.unit}` : ''}. Play this stat (key ${k + 1})`}>{inner}</button> : <div class={cls}>{inner}</div>}</li>;
            })}
          </ol>
          <footer class="pc__foot"><span class="pc__gem" aria-label={RARITY[card.rarity]}>{'◆'.repeat(card.rarity + 1)}<b>{RARITY[card.rarity]}</b></span><span>No. {no}</span></footer>
        </div>
        <div class="pc__face pc__back" aria-hidden={!down}>
          <div class="pc__backart">
            <span class="pc__backmark">P</span>
            <span class="pc__backkind">{kind.name}</span>
            <span class="pc__backera">{era?.name ?? ''}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function useDeck(): { deck: DeckJson | null; failed: boolean } {
  const [deck, setDeck] = useState<DeckJson | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { ensureMeta().catch(() => {}); fetchJson<DeckJson>('deck.json').then(setDeck).catch(() => setFailed(true)); }, []);
  return { deck, failed };
}

export function CardsView({ sub }: { sub: string | null }) {
  const { deck, failed } = useDeck();
  const m = meta.value;
  if (failed) return <div class="clash"><p class="clash__kicker">Clash of the Ages</p><p class="clash__lede">The deck couldn’t be loaded. Try reloading the page.</p></div>;
  if (!deck || !m) return <div class="center-load"><div class="spinner" /> Shuffling the deck…</div>;
  return sub === 'deck' ? <DeckGallery deck={deck} eras={m.eras} /> : <Duel deck={deck} eras={m.eras} />;
}

const VERDICT = (w: number, l: number) =>
  w === ROUNDS ? 'Seven for seven: a clean sweep. The chroniclers will sing of it.'
  : w - l >= 4 ? 'A crushing victory. The archive yields the field.'
  : w - l >= 2 ? 'Victory. You read the record like a court archivist.'
  : w > l ? 'A narrow victory, hard won like any treaty.'
  : w === l ? 'Honours even, as so many wars ended.'
  : l - w === 1 ? 'Defeated, but only just. The record favoured the archive today.'
  : l - w <= 3 ? 'The archive holds the field. Study the record, and return.'
  : 'A rout. The archive knows its own history better, for now.';

function Duel({ deck, eras }: { deck: DeckJson; eras: Era[] }) {
  const today = todayKey();
  const [match, setMatch] = useState<Match>(() => (saved && saved.key.startsWith(today) ? saved : { key: today, i: 0, picks: [], results: [], done: false }));
  const [copied, setCopied] = useState(false);
  useEffect(() => { saved = match; }, [match]);
  useEffect(() => { document.title = 'Clash of the Ages — Palimpsest'; }, []);
  const pairs = useMemo(() => deal(deck, match.key), [deck, match.key]);
  const kindOf = useMemo(() => new Map(deck.kinds.map((k) => [k.id, k])), [deck]);
  const numberOf = useMemo(() => new Map(deck.cards.map((c, i) => [c.id, i + 1])), [deck]);
  const wins = match.results.filter((x) => x === 1).length, losses = match.results.filter((x) => x === -1).length;
  const daily = match.key === today;
  const { mine, theirs } = pairs[Math.min(match.i, pairs.length - 1)];
  const kind = kindOf.get(mine.kind)!;
  const picked = match.picks.length > match.i ? match.picks[match.i] : null;
  const revealed = picked !== null;
  const outcome = revealed ? match.results[match.i] : null;

  const pick = (k: number) => {
    if (revealed || match.done) return;
    const a = mine.stats[k], b = theirs.stats[k];
    const r: 1 | 0 | -1 = a > b ? 1 : a < b ? -1 : 0;
    addSeen([mine.id, theirs.id]);
    setMatch({ ...match, picks: [...match.picks, k], results: [...match.results, r] });
  };
  const next = () => {
    if (!revealed) return;
    setMatch(match.i + 1 >= ROUNDS ? { ...match, done: true } : { ...match, i: match.i + 1 });
  };
  const again = () => setMatch({ key: `${today}#${Math.floor(Math.random() * 1e9)}`, i: 0, picks: [], results: [], done: false });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey || match.done) return;
      if (!revealed && /^[1-4]$/.test(e.key)) { e.preventDefault(); pick(Number(e.key) - 1); }
      else if (revealed && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight')) { e.preventDefault(); next(); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const track = (
    <div class="clash__track" role="list" aria-label="Rounds">
      {pairs.map((p, k) => {
        const r = match.results[k];
        const played = r !== undefined && (k < match.i || revealed || match.done);
        const cls = `clash__slot${k === match.i && !match.done ? ' is-now' : ''}${played ? (r === 1 ? ' is-win' : r === -1 ? ' is-loss' : ' is-tie') : ''}${match.done && k >= match.results.length ? ' is-unplayed' : ''}`;
        return <span role="listitem" class={cls} style={{ '--era': ERA_TONE[eras[p.mine.era]?.id ?? ''] }} aria-label={`Round ${k + 1}: ${played ? (r === 1 ? 'won' : r === -1 ? 'lost' : 'tied') : 'to play'}`}>{played ? (r === 1 ? '✓' : r === -1 ? '✕' : '=') : k + 1}</span>;
      })}
    </div>
  );

  if (match.done) {
    const emoji = match.results.map((x) => (x === 1 ? '🟩' : x === -1 ? '🟥' : '⬜')).join('');
    const head = wins > losses ? `won ${wins}–${losses}` : wins < losses ? `lost ${wins}–${losses}` : `drew ${wins}–${losses}`;
    const text = `Palimpsest · Clash of the Ages${daily ? ` · ${match.key}` : ''}: ${head}\n${emoji}\n${VERDICT(wins, losses)}`;
    const url = new URL('s/cards.html', location.href.replace(/#.*$/, '').replace(/[?].*$/, '').replace(/[^/]*$/, '')).toString();
    const share = async () => {
      const nav = navigator as Navigator & { share?: (d: { text: string; url: string }) => Promise<void> };
      if (nav.share && matchMedia('(pointer: coarse)').matches) { try { await nav.share({ text, url }); return; } catch { /* dismissed */ } }
      try { await navigator.clipboard.writeText(`${text}\n${url}`); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* blocked */ }
    };
    const played = pairs.slice(0, match.results.length);
    return (
      <div class="clash clash--end">
        <p class="clash__kicker">Clash of the Ages{daily ? ` · ${match.key}` : ' · a new deal'}</p>
        <h1 class="clash__title">{wins > losses ? 'You won' : wins < losses ? 'The archive won' : 'A draw'} <span>{wins}–{losses}</span></h1>
        <p class="clash__lede">{VERDICT(wins, losses)}</p>
        {track}
        <div class="actions">
          <button class="btn btn--accent" onClick={share}>{copied ? 'Copied' : 'Share your result'}</button>
          <button class="btn" onClick={again}>Deal again</button>
        </div>
        <p class="clash__more"><a href="#/cards/deck">See all {deck.cards.length} cards →</a><a href="#/game">Catch the lying chronicle →</a></p>
        <h2 class="clash__h2">The cards you met</h2>
        <ol class="clash__recap">
          {played.map((p, k) => {
            const kd = kindOf.get(p.mine.kind)!;
            const r = match.results[k];
            const st = kd.stats[match.picks[k]];
            const u = (v: number) => `${exact(v)}${st.unit === 'yrs' ? ' years' : st.unit ? ` ${st.unit}` : ''}`;
            return (
              <li class={r === 1 ? 'is-win' : r === -1 ? 'is-loss' : 'is-tie'}>
                <Mini card={p.mine} era={eras[p.mine.era]} n={`rm${k}`} mark={r} />
                <span class="clash__recaptext"><a href={`#/p/${p.mine.id}`}>{plainName(p.mine.name)}</a> {r === 1 ? 'beat' : r === -1 ? 'lost to' : 'tied with'} <a href={`#/p/${p.theirs.id}`}>{plainName(p.theirs.name)}</a>
                  <small>{kd.name} · {st.label}: {u(p.mine.stats[match.picks[k]])} against {u(p.theirs.stats[match.picks[k]])}</small></span>
                <Mini card={p.theirs} era={eras[p.theirs.era]} n={`rt${k}`} />
              </li>
            );
          })}
        </ol>
        <HowCounted deck={deck} />
      </div>
    );
  }

  const stat = picked !== null ? kind.stats[picked] : null;
  const a = picked !== null ? mine.stats[picked] : 0, b = picked !== null ? theirs.stats[picked] : 0;
  // the round in which one side reached four wins
  const before = match.results.slice(0, match.i);
  const decided = revealed && (wins >= TO_WIN && before.filter((x) => x === 1).length < TO_WIN || losses >= TO_WIN && before.filter((x) => x === -1).length < TO_WIN);
  const unit = (v: number) => (stat?.unit ? `${exact(v)} ${stat.unit === 'yrs' ? (v === 1 ? 'year' : 'years') : stat.unit}` : exact(v));
  return (
    <div class="clash">
      <h1 class="clash__kicker">Clash of the Ages{daily ? ` · daily deal ${match.key}` : ' · a new deal'}</h1>
      <div class="clash__score">
        <span class="clash__side">You <b>{wins}</b></span>
        {track}
        <span class="clash__side clash__side--them"><b>{losses}</b> Archive</span>
      </div>
      <div class="clash__table" key={match.key + match.i}>
        <div class="clash__seat">
          <PlayingCard card={mine} kind={kind} era={eras[mine.era]} no={numberOf.get(mine.id) ?? 0} n={`m${match.i}`} picked={picked} verdict={outcome ?? null} onPick={pick} />
        </div>
        <span class="clash__vsbadge" aria-hidden="true">vs</span>
        <div class="clash__seat clash__seat--them">
          <PlayingCard card={theirs} kind={kind} era={eras[theirs.era]} no={numberOf.get(theirs.id) ?? 0} n={`t${match.i}`} down={!revealed} picked={picked} verdict={outcome === null || outcome === undefined ? null : (-outcome as 1 | 0 | -1)} />
        </div>
      </div>
      <div class="clash__say" role="status">
        {!revealed ? (
          <p class="clash__prompt">{match.i === 0 && match.results.length === 0 ? <><b>Pick a stat on your card.</b> The higher number wins the round; four rounds take the match. The archive holds a {kind.name.toLowerCase()} of the {eras[theirs.era]?.name ?? 'ages'}.</> : <><b>Round {match.i + 1}.</b> The archive holds a {kind.name.toLowerCase()} of the {eras[theirs.era]?.name ?? 'ages'}.</>}</p>
        ) : (
          <>
            <p class={`clash__verdict clash__verdict--${outcome === 1 ? 'win' : outcome === -1 ? 'loss' : 'tie'}`}>
              {outcome === 1 ? 'You take the round.' : outcome === -1 ? 'The archive takes the round.' : 'A dead heat: no one scores.'}
              {decided && <em class="clash__decided"> {wins >= TO_WIN ? 'The match is yours. Play out your hand.' : 'The archive has the match. Play out your hand.'}</em>}
              <span> {stat!.label}: {unit(a)} against {unit(b)}.</span>
            </p>
            <div class="actions">
              <button class="btn btn--accent" onClick={next} autoFocus>{match.i + 1 >= ROUNDS ? 'See the result' : 'Next round'}</button>
              <a class="btn btn--ghost" href={`#/p/${theirs.id}`}>{theirs.kind === 'ruler' || theirs.kind === 'general' ? `Who was ${plainName(theirs.name)}?` : `About ${plainName(theirs.name)}`}</a>
            </div>
          </>
        )}
      </div>
      <div class="clash__hands">
        <div class="clash__hand">
          <span class="clash__handlabel">Your hand</span>
          <ol>{pairs.map((p, k) => <li><Mini card={p.mine} era={eras[p.mine.era]} n={`hm${k}`} now={k === match.i} mark={k < match.i || (k === match.i && revealed) ? match.results[k] : undefined} /></li>)}</ol>
        </div>
        <div class="clash__hand">
          <span class="clash__handlabel">The archive’s hand</span>
          <ol>{pairs.map((p, k) => <li><Mini card={p.theirs} era={eras[p.theirs.era]} n={`ht${k}`} now={k === match.i} down={k > match.i || (k === match.i && !revealed)} mark={k < match.i || (k === match.i && revealed) ? (-match.results[k] as 1 | 0 | -1) : undefined} /></li>)}</ol>
        </div>
      </div>
      <HowCounted deck={deck} />
    </div>
  );
}

function HowCounted({ deck }: { deck: DeckJson }) {
  return (
    <details class="clash__how">
      <summary>How the numbers are counted</summary>
      <p>Every number on every card is read straight from the record, and each links back to its page in the archive. Nothing is rated or invented: these are counts and maxima you can check against the world database.</p>
      {deck.kinds.map((k) => (
        <dl>
          <dt>{plural(k.name)}</dt>
          {k.stats.map((s) => <dd><b>{s.label}.</b> {s.how}</dd>)}
        </dl>
      ))}
    </details>
  );
}

function DeckGallery({ deck, eras }: { deck: DeckJson; eras: Era[] }) {
  const [kind, setKind] = useState<Card['kind']>('ruler');
  const seen = useMemo(readSeen, []);
  useEffect(() => { document.title = 'The deck — Clash of the Ages — Palimpsest'; }, []);
  const kindOf = new Map(deck.kinds.map((k) => [k.id, k]));
  const cards = deck.cards.map((c, i) => ({ c, no: i + 1 })).filter(({ c }) => c.kind === kind).sort((x, y) => y.c.rarity - x.c.rarity || x.c.years[0] - y.c.years[0]);
  const met = deck.cards.filter((c) => seen.has(c.id)).length;
  return (
    <div class="clash clash--deck">
      <p class="clash__kicker"><a href="#/cards">Clash of the Ages</a> · the deck</p>
      <h1 class="clash__title">{deck.cards.length} cards from the record</h1>
      <p class="clash__lede">Rulers, generals, states, cities and faiths, each with four numbers read from the archive. {met ? `You have met ${met} of them.` : 'Play a hand to start meeting them.'}</p>
      <div class="clash__chips" role="tablist" aria-label="Kind">
        {deck.kinds.map((k) => <button role="tab" aria-selected={kind === k.id} class={`chip${kind === k.id ? ' is-on' : ''}`} onClick={() => setKind(k.id)}>{plural(k.name)} <span>{deck.cards.filter((c) => c.kind === k.id).length}</span></button>)}
      </div>
      <div class="clash__grid">
        {cards.map(({ c, no }) => (
          <div class={`clash__cell${seen.has(c.id) ? ' is-met' : ''}`}>
            <PlayingCard card={c} kind={kindOf.get(c.kind)!} era={eras[c.era]} no={no} n="g" />
          </div>
        ))}
      </div>
      <div class="actions"><a class="btn btn--accent" href="#/cards">Play today’s deal</a></div>
    </div>
  );
}
