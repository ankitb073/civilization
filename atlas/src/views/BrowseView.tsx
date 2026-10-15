import { useEffect, useMemo, useState } from 'preact/hooks';
import { fold } from '../data.ts';
import { KIND_LABEL, KINDS } from '../kinds.ts';
import { route } from '../state.ts';
import { ensureSearch, meta, searchIndex } from '../store.ts';

const PAGE = 120;

export function BrowseView() {
  const p = route.value.params;
  const [kind, setKind] = useState<string>(p.get('kind') ?? 'artifact');
  const [q, setQ] = useState(p.get('q') ?? '');
  const [from, setFrom] = useState<number>(Number(p.get('from') ?? 0));
  const [to, setTo] = useState<number>(Number(p.get('to') ?? 5000));
  const [sort, setSort] = useState<'date' | 'title'>((p.get('sort') as 'date' | 'title') ?? 'date');
  const [limit, setLimit] = useState(PAGE);
  const idx = searchIndex.value;
  const m = meta.value;
  useEffect(() => { ensureSearch().catch(() => {}); }, []);
  useEffect(() => { setLimit(PAGE); }, [kind, q, from, to, sort]);
  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams();
      if (kind !== 'all') sp.set('kind', kind); else sp.set('kind', 'all');
      if (q) sp.set('q', q);
      if (from > 0) sp.set('from', String(from));
      if (to < 5000) sp.set('to', String(to));
      if (sort !== 'date') sp.set('sort', sort);
      history.replaceState(null, '', `#/browse?${sp.toString()}`);
    }, 250);
    return () => clearTimeout(t);
  }, [kind, q, from, to, sort]);

  const { rows, facets, hist } = useMemo(() => {
    if (!idx) return { rows: [] as number[], facets: new Map<string, number>(), hist: [] as number[] };
    const fq = fold(q.trim());
    const words = fq.split(/\s+/).filter(Boolean);
    const facets = new Map<string, number>();
    const rows: number[] = [];
    const bins = 50;
    const hist = new Array(bins).fill(0);
    for (let i = 0; i < idx.ids.length; i++) {
      const t0 = idx.t0[i];
      if (words.length && !words.every((w) => idx.lower[i].includes(w) || idx.aliasLower[i].includes(w))) continue;
      const inRange = t0 >= from && t0 <= to;
      if (inRange) facets.set(idx.kinds[i], (facets.get(idx.kinds[i]) ?? 0) + 1);
      if (kind !== 'all' && idx.kinds[i] !== kind) continue;
      hist[Math.min(bins - 1, Math.max(0, Math.floor((t0 / 5000) * bins)))]++;
      if (!inRange) continue;
      rows.push(i);
    }
    if (sort === 'date') rows.sort((a, b) => idx.t0[a] - idx.t0[b] || (idx.titles[a] < idx.titles[b] ? -1 : 1));
    else rows.sort((a, b) => idx.lower[a].localeCompare(idx.lower[b]));
    return { rows, facets, hist };
  }, [idx, kind, q, from, to, sort]);

  const total = [...facets.values()].reduce((s, n) => s + n, 0);
  const hmax = Math.max(1, ...hist);
  return (
    <div class="browse">
      <header class="browse__head">
        <h1 class="h-page">The archive</h1>
        <p class="muted">{m ? `${Object.entries(m.counts).filter(([k]) => k !== 'links').reduce((s, [, n]) => s + n, 0).toLocaleString('en-US')} pages` : ''}{m?.counts.links ? ` · ${m.counts.links.toLocaleString('en-US')} links` : ''}. Filter by kind, period and name.</p>
      </header>
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
      <div class="chips" role="radiogroup" aria-label="Kind">
        <button role="radio" aria-checked={kind === 'all'} class={`chip${kind === 'all' ? ' is-on' : ''}`} onClick={() => setKind('all')}>All <span>{total.toLocaleString('en-US')}</span></button>
        {KINDS.filter((k) => facets.has(k)).map((k) => (
          <button role="radio" aria-checked={kind === k} class={`chip${kind === k ? ' is-on' : ''}`} onClick={() => setKind(k)}>
            <span class={`kdot k-${k}`} aria-hidden="true" />{KIND_LABEL[k][1]} <span>{(facets.get(k) ?? 0).toLocaleString('en-US')}</span>
          </button>
        ))}
      </div>
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
                  <span class="row__t">{idx.titles[i]}</span>
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
