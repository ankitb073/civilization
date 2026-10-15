import { useEffect, useMemo, useState } from 'preact/hooks';
import type { EconomyJson } from '../../../engine/src/export/contract.ts';
import { fetchJson } from '../data.ts';
import { loadDynasties, type Dynasty } from '../extras.ts';
import { MiniMap } from '../components/MiniMap.tsx';
import { capitalAt, ensureEvents, ensureMapData, ensureMeta, ensurePoliticalYear, ensureSearch, eraAt, layersVersion, mapData, meta, polityNameAt, searchIndex } from '../store.ts';
import { mapHref, navigate } from '../state.ts';
import { subLabel } from '../format.ts';
import { KIND_LABEL } from '../kinds.ts';

const clampY = (y: number) => Math.max(0, Math.min(5000, Math.round(y)));

export function YearView({ y: raw }: { y: string }) {
  const y = clampY(Number(raw) || 0);
  const d = mapData.value;
  const m = meta.value;
  const lv = layersVersion.value;
  const [ready, setReady] = useState(false);
  const [econ, setEcon] = useState<EconomyJson | null>(null);
  const [dyn, setDyn] = useState<Dynasty[]>([]);
  const idx = searchIndex.value;
  useEffect(() => {
    ensureMeta().catch(() => {});
    ensureMapData().then(() => ensureEvents()).catch(() => {});
    fetchJson<EconomyJson>('economy.json').then(setEcon).catch(() => {});
    loadDynasties().then((x) => setDyn(x.dynasties)).catch(() => {});
    ensureSearch().catch(() => {});
  }, []);
  useEffect(() => {
    let live = true;
    setReady(false);
    ensurePoliticalYear(y).then(() => { if (live) setReady(true); }).catch(() => {});
    document.title = `AY ${y} — ${m?.worldName ?? 'Palimpsest'}`;
    window.scrollTo(0, 0);
    return () => { live = false; };
  }, [y, d, m]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowLeft') { navigate(`#/year/${clampY(y - (e.shiftKey ? 100 : 10))}`); e.preventDefault(); }
      if (e.key === 'ArrowRight') { navigate(`#/year/${clampY(y + (e.shiftKey ? 100 : 10))}`); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [y]);

  const powers = useMemo(() => {
    if (!d || !ready) return null;
    const st = d.layers.political.at(y);
    const counts = new Map<number, number>();
    let land = 0;
    for (let i = 0; i < d.geo.n; i++) if (d.geo.land[i]) { land++; if (st[i] >= 0) counts.set(st[i], (counts.get(st[i]) ?? 0) + 1); }
    const list = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([i, n]) => {
      const l = d.layers.political.byIdx.get(i)!;
      const cap = capitalAt(d, i, y);
      const house = dyn.find((x) => x.polity === l.id && x.start <= y && x.end >= y) ?? dyn.find((x) => x.polity === l.id);
      const ruler = house?.members.find((mm) => mm.reign && mm.reign[0] <= y && mm.reign[1] >= y);
      return { id: l.id, color: l.color, name: polityNameAt(d, i, y), n, share: n / land, cap: cap >= 0 ? d.settlementByIdx.get(cap) : undefined, ruler, house };
    });
    return { list, total: counts.size, claimed: [...counts.values()].reduce((s, x) => s + x, 0) / land };
  }, [d, ready, y, dyn, lv]);

  const events = useMemo(() => (d ? d.timeline.events.filter((e) => e.year >= y - 5 && e.year <= y + 5).sort((a, b) => b.sig - a.sig) : []), [d, y, lv]);
  const docs = useMemo(() => {
    if (!idx) return null;
    const out: number[] = [];
    for (let i = 0; i < idx.ids.length; i++) if (idx.kinds[i] === 'artifact' && Math.abs(idx.t0[i] - y) <= 2) out.push(i);
    const flags = new Set(m?.flagships ?? []);
    return out.sort((a, b) => Number(flags.has(idx.ids[b])) - Number(flags.has(idx.ids[a])) || idx.t0[a] - idx.t0[b]);
  }, [idx, y, m]);
  const flags = useMemo(() => new Set(m?.flagships ?? []), [m]);

  const decade = Math.floor(y / 10);
  const price = econ?.prices[Math.min(econ.prices.length - 1, decade)];
  const level = econ?.priceLevel[Math.min(econ.priceLevel.length - 1, decade)];
  const clim = d?.timeline.climate[Math.min(d.timeline.climate.length - 1, decade)];
  const era = eraAt(y);
  const top = powers?.list[0];
  const step = (dy: number) => `#/year/${clampY(y + dy)}`;

  return (
    <div class="yearview">
      <nav class="yearview__nav" aria-label="Move through time">
        <a class="btn btn--ghost" href={step(-100)} aria-label={`Back a century, to AY ${clampY(y - 100)}`}>«</a>
        <a class="btn btn--ghost" href={step(-10)} aria-label={`Back a decade, to AY ${clampY(y - 10)}`}>‹ {clampY(y - 10)}</a>
        <span class="yearview__here" aria-current="page">AY {y}</span>
        <a class="btn btn--ghost" href={step(10)} aria-label={`Forward a decade, to AY ${clampY(y + 10)}`}>{clampY(y + 10)} ›</a>
        <a class="btn btn--ghost" href={step(100)} aria-label={`Forward a century, to AY ${clampY(y + 100)}`}>»</a>
      </nav>
      <header class="yearview__head">
        <div class="eyebrow">{era?.name ?? ''} · decade of {decade * 10}s</div>
        <h1 class="h-page">{m?.worldName ?? 'The world'} in AY {y}</h1>
        {powers && (
          <p class="yearview__lede">
            {powers.total} states held {(powers.claimed * 100).toFixed(0)}% of the land{top ? <>; the greatest was <a href={`#/p/${top.id}`}>{top.name}</a>, with {top.n} districts{top.ruler ? <>, ruled by <a href={`#/p/${top.ruler.id}`}>{top.ruler.name}{top.ruler.epithet ? ` ${top.ruler.epithet}` : ''}</a></> : null}</> : null}.
            {price && price[1] != null ? <> Grain cost {price[1].toFixed(1)} g of silver a measure{level ? <> (prices at {level[1].toFixed(2)}× their base)</> : null}.</> : null}
            {clim ? <> The decade ran {Math.abs(clim.temp) < 0.05 ? 'at the usual temperature' : `${Math.abs(clim.temp).toFixed(1)} °C ${clim.temp < 0 ? 'colder' : 'warmer'} than usual`}{Math.abs(clim.precip) >= 0.05 ? `, ${clim.precip < 0 ? 'drier' : 'wetter'} by ${Math.abs(clim.precip * 100).toFixed(0)}%` : ''}.</> : null}
          </p>
        )}
        <div class="actions">
          <a class="btn btn--accent" href={mapHref({ y, sel: null, l: 'political' })}>Open on the atlas</a>
          <a class="btn" href={`#/browse?kind=artifact&from=${y - 2}&to=${y + 2}`}>Documents of these years</a>
          <a class="btn btn--ghost" href={`#/browse?kind=event&from=${y - 5}&to=${y + 5}`}>All events of the decade</a>
        </div>
      </header>

      <div class="yearview__grid">
        <section class="yearview__map" aria-label="Map">
          <MiniMap year={y} height={300} label={`Political map of ${m?.worldName ?? 'the world'} in AY ${y}`} />
          <div class="yearview__stats">
            <div><span class="stat__n">{powers?.total ?? '…'}</span><span class="stat__l">states</span></div>
            <div><span class="stat__n">{price && price[1] != null ? `${price[1].toFixed(1)} g` : '—'}</span><span class="stat__l">grain, a measure</span></div>
            <div><span class="stat__n">{clim ? `${clim.temp > 0 ? '+' : ''}${clim.temp.toFixed(1)} °C` : '—'}</span><span class="stat__l">temperature anomaly</span></div>
            <div><span class="stat__n">{era?.name.replace(/^Age of /, '') ?? '—'}</span><span class="stat__l">age</span></div>
          </div>
        </section>
        <section class="yearview__powers" aria-label="The great powers">
          <h2 class="sect">The great powers</h2>
          {!powers && <div class="center-load"><div class="spinner" /></div>}
          <ol class="powers">
            {powers?.list.slice(0, 10).map((p, i) => (
              <li class="powers__row">
                <span class="powers__n">{i + 1}</span>
                <span class="swatch" style={{ background: p.color }} />
                <span class="powers__main">
                  <a class="powers__t" href={`#/p/${p.id}`}>{p.name}</a>
                  <span class="powers__m">
                    {p.n} districts{p.cap ? <> · capital <a href={`#/p/${p.cap.id}`}>{p.cap.name}</a></> : null}
                    {p.ruler ? <> · ruled by <a href={`#/p/${p.ruler.id}`}>{p.ruler.name}{p.ruler.epithet ? ` ${p.ruler.epithet}` : ''}</a></> : null}
                  </span>
                </span>
                <span class="powers__bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (p.share / (powers.list[0]?.share || 1)) * 100)}%`, background: p.color }} /></span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section class="yearview__sect" aria-label="Events">
        <h2 class="sect">The decade’s events <span class="muted small">(AY {y - 5}–{y + 5})</span></h2>
        {events.length ? (
          <ul class="yrlist">
            {events.slice(0, 16).map((e) => (
              <li><span class="yrlist__y">{e.year}</span><a href={`#/p/${e.id}`}>{e.title || '…'}</a><span class="yrlist__s">{subLabel(e.sub)}</span></li>
            ))}
          </ul>
        ) : <p class="muted small">No major events recorded in these years.</p>}
      </section>

      <section class="yearview__sect" aria-label="Documents">
        <h2 class="sect">Written in these years <span class="muted small">(AY {y - 2}–{y + 2})</span></h2>
        {!docs && <div class="center-load"><div class="spinner" /> Searching the catalogue…</div>}
        {docs && (docs.length ? (
          <ul class="yrlist">
            {docs.slice(0, 24).map((i) => (
              <li>
                <span class="yrlist__y">{idx!.t0[i]}</span>
                <a href={`#/p/${idx!.ids[i]}`}>{flags.has(idx!.ids[i]) && <span class="row__flag" aria-hidden="true">✦</span>}{idx!.titles[i]}</a>
                <span class="yrlist__s">{subLabel(idx!.subs[i] || (KIND_LABEL.artifact[0]), 'artifact')}</span>
              </li>
            ))}
            {docs.length > 24 && <li class="muted small"><a href={`#/browse?kind=artifact&from=${y - 2}&to=${y + 2}`}>All {docs.length} documents →</a></li>}
          </ul>
        ) : <p class="muted small">No surviving documents from these years.</p>)}
      </section>
      <p class="muted small yearview__tip">Tip: ← and → step a decade; hold Shift for a century.</p>
    </div>
  );
}
