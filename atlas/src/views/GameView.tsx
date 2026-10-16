import { useEffect, useMemo, useState } from 'preact/hooks';
import type { GameJson } from '../../../engine/src/export/contract.ts';
import { fetchJson } from '../data.ts';
import { todayKey } from '../book.ts';

type Round = GameJson['rounds'][number];
const ROUNDS = 5;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** A small deterministic generator, so everyone gets the same five wars on the same day. */
function seeded(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function pick(rounds: Round[], key: string): { r: Round; ask: 0 | 1 }[] {
  const rnd = seeded(key);
  const pool = rounds.slice();
  const out: { r: Round; ask: 0 | 1 }[] = [];
  while (out.length < ROUNDS && pool.length) out.push({ r: pool.splice(Math.floor(rnd() * pool.length), 1)[0], ask: rnd() < 0.5 ? 0 : 1 });
  return out;
}

/** 10 points for the exact figure, none when off by a factor of four or more. */
const scoreOf = (guess: number, truth: number) => Math.max(0, Math.round(10 * (1 - Math.abs(Math.log(guess / truth)) / Math.log(4))));

const verdict = (s: number) => (s >= 45 ? 'You read chronicles like a court archivist.' : s >= 35 ? 'A sharp eye for a palace scribe.' : s >= 20 ? 'The scribes fooled you now and then.' : 'The scribes would have liked you.');

export function GameView() {
  const [data, setData] = useState<GameJson | null>(null);
  const [key, setKey] = useState(todayKey());
  const [i, setI] = useState(0);
  const [guess, setGuess] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [scores, setScores] = useState<number[]>([]);
  const [copied, setCopied] = useState(false);
  useEffect(() => { document.title = 'Catch the lying chronicle — Palimpsest'; fetchJson<GameJson>('game.json').then(setData).catch(() => {}); }, []);
  const set = useMemo(() => (data ? pick(data.rounds, key) : []), [data, key]);
  if (!data) return <div class="center-load"><div class="spinner" /> Unrolling the chronicles…</div>;
  const daily = key === todayKey();

  if (i >= set.length) {
    const total = scores.reduce((a, b) => a + b, 0);
    const text = `Palimpsest · Catch the lying chronicle${daily ? ` · ${key}` : ''}: ${total}/${ROUNDS * 10}\n${scores.map((x) => (x >= 8 ? '🟩' : x >= 4 ? '🟨' : '🟥')).join('')}\n${verdict(total)}`;
    const url = new URL('s/game.html', location.href.replace(/#.*$/, '').replace(/[?].*$/, '').replace(/[^/]*$/, '')).toString();
    const share = async () => {
      const nav = navigator as Navigator & { share?: (d: { text: string; url: string }) => Promise<void> };
      if (nav.share && matchMedia('(pointer: coarse)').matches) { try { await nav.share({ text, url }); return; } catch { /* dismissed */ } }
      try { await navigator.clipboard.writeText(`${text}\n${url}`); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* blocked */ }
    };
    return (
      <div class="game">
        <p class="game__kicker">Catch the lying chronicle{daily ? ` · ${key}` : ''}</p>
        <h1 class="game__title">{total} <span class="muted">/ {ROUNDS * 10}</span></h1>
        <p class="game__lede">{verdict(total)}</p>
        <p class="game__dots" aria-label={`Round scores: ${scores.join(', ')}`}>{scores.map((x) => <span class={`game__dot game__dot--${x >= 8 ? 'good' : x >= 4 ? 'mid' : 'bad'}`}>{x}</span>)}</p>
        <div class="actions">
          <button class="btn btn--accent" onClick={share}>{copied ? 'Copied' : 'Share your score'}</button>
          <button class="btn" onClick={() => { setKey(`${todayKey()}#${Math.floor(Math.random() * 1e9)}`); setI(0); setScores([]); setGuess(null); setLocked(false); }}>Play five more</button>
          <a class="btn btn--ghost" href="#/collections/spin">The most partisan chronicles</a>
          <a class="btn btn--ghost" href="#/cards">Play Clash of the Ages</a>
        </div>
        <p class="game__note">Every war here was simulated, and both chronicles were generated from the record by scribes who lie in their own favour: they shrink their own dead, inflate the enemy's, and blame the other side. {data.rounds.length.toLocaleString('en-US')} wars in the archive are told by both sides.</p>
      </div>
    );
  }

  const { r, ask } = set[i];
  const side = r.sides[ask];
  const truth = ask === 0 ? r.truth.lossesA : r.truth.lossesD;
  const claims = r.accounts.map((x) => (ask === 0 ? x.lossesA : x.lossesD));
  const lo = Math.max(10, Math.min(...claims) / 3), hi = Math.max(...claims) * 3;
  const toVal = (t: number) => Math.round(Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * t));
  const toT = (v: number) => (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
  const g = guess ?? toVal(0.5);
  const sc = scoreOf(g, truth);
  const own = (x: Round['accounts'][number]) => (x.side === 'attacker' ? r.sides[0] : r.sides[1]);
  const bend = (x: Round['accounts'][number]) => {
    const mine = x.side === 'attacker' ? [x.lossesA, r.truth.lossesA] : [x.lossesD, r.truth.lossesD];
    const theirs = x.side === 'attacker' ? [x.lossesD, r.truth.lossesD] : [x.lossesA, r.truth.lossesA];
    const pct = (a: number, b: number) => (a < b ? `cut to ${Math.round((a / b) * 100)}%` : `×${(a / b).toFixed(1)}`);
    return `its own dead ${pct(mine[0], mine[1])}, the enemy's ${pct(theirs[0], theirs[1])}`;
  };
  return (
    <div class="game">
      <p class="game__kicker">Catch the lying chronicle · round {i + 1} of {ROUNDS}{daily ? ` · ${key}` : ''}</p>
      <h1 class="game__title">{r.title} <span class="muted">AY {r.years[0]}–{r.years[1]}</span></h1>
      {i === 0 && !locked && <p class="game__lede">Two palace scribes wrote this war down, one for each side. Both survive. Neither tells the truth. How many did <b>{side}</b> really lose?</p>}
      <div class="game__accounts">
        {r.accounts.map((x) => (
          <figure class="game__acc">
            <figcaption>{own(x)}'s chronicle{x.author ? <span class="muted"> · {x.author}</span> : null}</figcaption>
            <p>{r.sides[0]} lost <b>{fmt(x.lossesA)}</b>. {r.sides[1]} lost <b>{fmt(x.lossesD)}</b>.</p>
            <p class="muted">{x.began ? `${x.began} began it. ` : ''}{x.outcome ? `Outcome: ${x.outcome}.` : ''}</p>
            {locked && <p class="game__bend">{bend(x)}</p>}
          </figure>
        ))}
      </div>
      <div class="game__ask">
        <label for="guess">How many of <b>{side}</b>'s soldiers died in this war?</label>
        <output for="guess" class="game__guess">{fmt(g)}</output>
        <input id="guess" type="range" min="0" max="1000" step="1" value={Math.round(toT(g) * 1000)} disabled={locked} onInput={(e) => setGuess(toVal(Number((e.currentTarget as HTMLInputElement).value) / 1000))} />
        <div class="game__scale"><span>{fmt(lo)}</span><span>{fmt(hi)}</span></div>
      </div>
      {!locked ? (
        <div class="actions"><button class="btn btn--accent" onClick={() => { setLocked(true); setScores([...scores, sc]); }}>Lock in {fmt(g)}</button></div>
      ) : (
        <div class="game__reveal" role="status">
          <p>The record: <b>{r.sides[0]}</b> lost <b>{fmt(r.truth.lossesA)}</b>, <b>{r.sides[1]}</b> lost <b>{fmt(r.truth.lossesD)}</b>. {r.truth.began} began it. Outcome: {r.truth.outcome}.</p>
          <p class="game__score">{sc} / 10 <span class="muted">· you were off by ×{(Math.max(g, truth) / Math.min(g, truth)).toFixed(2)}</span></p>
          {i === 0 && <p class="muted">Each scribe shrinks their own side's dead and inflates the enemy's, so the truth usually lies between the two figures.</p>}
          <div class="actions">
            <button class="btn btn--accent" onClick={() => { setI(i + 1); setGuess(null); setLocked(false); }}>{i + 1 < set.length ? 'Next war' : 'See your score'}</button>
            <a class="btn btn--ghost" href={`#/compare/${r.war}`}>Compare the accounts</a>
          </div>
        </div>
      )}
    </div>
  );
}
