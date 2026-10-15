import { useEffect, useMemo, useState } from 'preact/hooks';
import { fold } from '../data.ts';
import { KIND_LABEL, KINDS } from '../kinds.ts';
import { subLabel } from '../format.ts';
import { SurpriseButton } from '../components/Surprise.tsx';
import { route } from '../state.ts';
import { ensureSearch, meta, searchIndex } from '../store.ts';

const PAGE = 120;
/** Sub-type chips shown before "more types" (the rest stay one tap away). */
const SUBS = 16;

export function BrowseView() {
  const p = route.value.params;
  const [kind, setKind] = useState<string>(p.get('kind') ?? 'artifact');
  const [q, setQ] = useState(p.get('q') ?? '');
  const [from, setFrom] = useState<number>(Number(p.get('from') ?? 0));
  const [to, setTo] = useState<number>(Number(p.get('to') ?? 5000));
  const [sort, setSort] = useState<'date' | 'title'>((p.get('sort') as 'date' | 'title') ?? 'date');
  const [sub, setSub] = useState<string>(p.get('sub') ?? '');
  const [flag, setFlag] = useState(p.get('flag') === '1');
  const [limit, setLimit] = useState(PAGE);
  const [allSubs, setAllSubs] = useState(false);
  const idx = searchIndex.value;
  const m = meta.value;
  const flagSet = useMemo(() => new Set(m?.flagships ?? []), [m]);
  useEffect(() => { ensureSearch().catch(() => {}); }, []);
  useEffect(() => { setLimit(PAGE); }, [kind, q, from, to, sort, sub, flag]);
  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams();
      if (kind !== 'all') sp.set('kind', kind); else sp.set('kind', 'all');
      if (q) sp.set('q', q);
      if (from > 0) sp.set('from', String(from));
      if (to < 5000) sp.set('to', String(to));
      if (sort !== 'date') sp.set('sort', sort);
      if (sub) sp.set('sub', sub);
      if (flag) sp.set('flag', '1');
      history.replaceState(null, '', `#/browse?${sp.toString()}`);
    }, 250);
    return () => clearTimeout(t);
  }, [kind, q, from, to, sort, sub, flag]);

  const { rows, facets, hist, subFacets } = useMemo(() => {
    if (!idx) return { rows: [] as number[], facets: new Map<string, number>(), hist: [] as number[], subFacets: [] as [string, number][] };
    const subCounts = new Map<string, number>();
    const fq = fold(q.trim());
    const words = fq.split(/\s+/).filter(Boolean);
    const facets = new Map<string, number>();
    const rows: number[] = [];
    const bins = 50;
    const hist = new Array(bins).fill(0);
    for (let i = 0; i < idx.ids.length; i++) {
      if (flag && !flagSet.has(idx.ids[i])) continue;
      const t0 = idx.t0[i];
      if (words.length && !words.every((w) => idx.lower[i].includes(w) || idx.aliasLower[i].includes(w))) continue;
      const inRange = t0 >= from && t0 <= to;
      if (inRange) facets.set(idx.kinds[i], (facets.get(idx.kinds[i]) ?? 0) + 1);
      if (kind !== 'all' && idx.kinds[i] !== kind) continue;
      if (inRange && kind !== 'all') subCounts.set(idx.subs[i], (subCounts.get(idx.subs[i]) ?? 0) + 1);
      if (sub && idx.subs[i] !== sub) continue;
      hist[Math.min(bins - 1, Math.max(0, Math.floor((t0 / 5000) * bins)))]++;
      if (!inRange) continue;
      rows.push(i);
    }
    const cmpTitle = (a: number, b: number) => (idx.lower[a] < idx.lower[b] ? -1 : idx.lower[a] > idx.lower[b] ? 1 : 0);
    if (sort === 'date') rows.sort((a, b) => idx.t0[a] - idx.t0[b] || cmpTitle(a, b));
    else rows.sort(cmpTitle);
    const subFacets = [...subCounts.entries()].filter(([k]) => k).sort((a, b) => b[1] - a[1]);
    return { rows, facets, hist, subFacets };
  }, [idx, kind, q, from, to, sort, sub, flag, flagSet]);

  const total = [...facets.values()].reduce((s, n) => s + n, 0);
  const hmax = Math.max(1, ...hist);
  return (
    <div class="browse">
      <header class="browse__head">
        <h1 class="h-page">The archive</h1>
        <nav class="explore" aria-label="Explore">
          <a href="#/collections"><span>Collections</span>Queens, plagues, wars told twice…</a>
          <a href="#/dynasties"><span>Dynasties</span>The great ruling houses</a>
          <a href="#/story"><span>Story</span>Five thousand years in seven chapters</a>
          <a href="#/histomap"><span>Histomap</span>Every state as a stream</a>
          <a href="#/languages"><span>Languages</span>The Tree of Tongues</a>
          <a href="#/prices"><span>Prices</span>What things cost</a>
        </nav>
        <p class="muted">{m ? `${KINDS.reduce((s, k) => s + (m.counts[k] ?? 0), 0).toLocaleString('en-US')} pages` : ''}{m?.counts.links ? ` · ${m.counts.links.toLocaleString('en-US')} links` : ''}. Filter by kind, period and name.</p>
      </header>
      <div class="browse__dice"><SurpriseButton /></div>
      <div class="browse__filters">
        <input class="input" type="search" placeholder="Filter by name…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Filter by name" />
        <div class="range">
          <label>From <input class="input input--num" type="number" min={0} max={5000} step={50} value={from} onChange={(e) => setFrom(Math.max(0, Math.min(5000, Number((e.target as HTMLInputElement).value) || 0)))} /></label>
          <label>to <input class="input input--num" type="number" min={0} max={5000} step={50} value={to} onChange={(e) => setTo(Math.max(0, Math.min(5000, Number((e.target as HTMLInputElement).value) || 5000)))} /></label>
          <span class="muted small">AY</span>
        </div>
        <div class="sortsel" role="radiogroup" aria-label="Sort">
          <button role="radio" aria-checked={sort === 'date'} class={`seg${sort === 'date' ? ' is-on' : ''}`} onClick={() => setSort('date')}>By date</button>
          <button role="radio" aria-checked={sort === 'title'} class={`seg${sort === 'title' ? ' is-on' : ''}`} onClick={() => setSort('title')}>A–Z</button>
        </div>
      </div>
      {flagSet.size > 0 && (
        <div class="flagrow">
          <button class={`chip chip--flag${flag ? ' is-on' : ''}`} aria-pressed={flag} onClick={() => { setFlag(!flag); if (!flag) { setKind('artifact'); setSub(''); } }}>
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 1.5l1.9 4.1 4.5.5-3.4 3 1 4.4L8 11.3 4 13.5l1-4.4-3.4-3 4.5-.5z" fill="currentColor" /></svg>
            Flagship sources <span>{flagSet.size.toLocaleString('en-US')}</span>
          </button>
          <span class="muted small">Long-form sources written in full from the archive’s dossiers, checked like every other document.</span>
        </div>
      )}
      <div class="chips" role="radiogroup" aria-label="Kind">
        <button role="radio" aria-checked={kind === 'all'} class={`chip${kind === 'all' ? ' is-on' : ''}`} onClick={() => { setKind('all'); setSub(''); }}>All <span>{total.toLocaleString('en-US')}</span></button>
        {KINDS.filter((k) => facets.has(k)).map((k) => (
          <button role="radio" aria-checked={kind === k} class={`chip${kind === k ? ' is-on' : ''}`} onClick={() => { setKind(k); setSub(''); }}>
            <span class={`kdot k-${k}`} aria-hidden="true" />{KIND_LABEL[k][1]} <span>{(facets.get(k) ?? 0).toLocaleString('en-US')}</span>
          </button>
        ))}
      </div>
      {kind !== 'all' && subFacets.length > 1 && (
        <div class="chips chips--sub" role="radiogroup" aria-label="Type">
          <button role="radio" aria-checked={!sub} class={`chip chip--sub${!sub ? ' is-on' : ''}`} onClick={() => setSub('')}>Any type</button>
          {subFacets.filter(([k], i) => allSubs || i < SUBS || k === sub).map(([k, n]) => (
            <button role="radio" aria-checked={sub === k} class={`chip chip--sub${sub === k ? ' is-on' : ''}`} onClick={() => setSub(sub === k ? '' : k)}>
              {subLabel(k, kind)} <span>{n.toLocaleString('en-US')}</span>
            </button>
          ))}
        </div>
      )}
      {kind !== 'all' && subFacets.length > SUBS && <button class="linkish small chips__more" aria-expanded={allSubs} onClick={() => setAllSubs(!allSubs)}>{allSubs ? 'Fewer types' : `All ${subFacets.length} types`}</button>}
      <div class="hist" aria-hidden="true">
        {hist.map((h, i) => {
          const y0 = (i / hist.length) * 5000;
          const on = y0 + 100 >= from && y0 <= to;
          return <span class={on ? 'on' : ''} style={{ height: `${Math.max(2, (Math.sqrt(h) / Math.sqrt(hmax)) * 100)}%` }} title={`${Math.round(y0)}–${Math.round(y0 + 100)}: ${h}`} onClick={() => { setFrom(Math.round(y0)); setTo(Math.round(y0 + 100)); }} />;
        })}
      </div>
      <div class="hist__axis"><span>0</span><span>1000</span><span>2000</span><span>3000</span><span>4000</span><span>5000 AY</span></div>
      {!idx && <div class="center-load"><div class="spinner" /> Opening the catalogue…</div>}
      {idx && (
        <>
          <p class="browse__count muted small">{rows.length.toLocaleString('en-US')} {rows.length === 1 ? 'entry' : 'entries'}</p>
          <ul class="rows">
            {rows.slice(0, limit).map((i) => (
              <li>
                <a class="row" href={`#/p/${idx.ids[i]}`}>
                  <span class="row__y">{idx.t0[i]}</span>
                  <span class={`kdot k-${idx.kinds[i]}`} aria-hidden="true" />
                  <span class="row__t">{flagSet.has(idx.ids[i]) && <span class="row__flag" title="Flagship source" aria-hidden="true">✦</span>}{idx.titles[i]}{idx.subs[i] && kind === 'all' || (idx.subs[i] && !sub) ? <span class="row__sub">{subLabel(idx.subs[i], idx.kinds[i])}</span> : null}</span>
                  {idx.aliases[i] && <span class="row__a">{idx.aliases[i].split('|').slice(0, 3).join(' · ')}</span>}
                </a>
              </li>
            ))}
          </ul>
          {rows.length > limit && <div class="more"><button class="btn" onClick={() => setLimit(limit + PAGE * 2)}>Show more ({(rows.length - limit).toLocaleString('en-US')} left)</button></div>}
        </>
      )}
    </div>
  );
}
