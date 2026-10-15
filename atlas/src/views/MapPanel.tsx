import { useEffect, useMemo, useState } from 'preact/hooks';
import { layer, selection, setYear, year, type LayerName } from '../state.ts';
import { capitalAt, ensureLayer, eraAt, firstPaint, layersVersion, legendOf, mapData, meta, polityNameAt } from '../store.ts';
import { fmtCompact, fmtYear, subLabel } from '../format.ts';
import { KIND_LABEL, kindFromId } from '../kinds.ts';
import { PageCard } from '../components/PageCard.tsx';
import { MapRenderer } from './mapRenderer.ts';
import { indexLanguages, loadLanguages, type LangIndex } from '../languages.ts';
import { startTour } from '../components/Tour.tsx';
import { HistomapThumb } from './HistomapView.tsx';
import { CollectionStrip } from './CollectionsView.tsx';
import { SurpriseButton } from '../components/Surprise.tsx';
import { reducedMotion } from '../state.ts';

export function MapPanel() {
  const sel = selection.value;
  return sel ? <Selected id={sel} /> : <Intro />;
}

/** Strip a trailing disambiguating id such as " (cli:71)" from a display title. */
export function cleanTitle(t: string): string {
  return t.replace(/\s*\([a-z]{3}:\d+\)\s*$/, '');
}

export function Featured({ limit = 4 }: { limit?: number }) {
  const m = meta.value;
  const [all, setAll] = useState(false);
  if (!m || !m.featured.length) return null;
  const items = all ? m.featured : m.featured.slice(0, limit);
  return (
    <section class="featured">
      <h3 class="sect">Start here</h3>
      {items.map((f) => {
        const k = kindFromId(f.id) ?? 'artifact';
        return (
          <a class="feat" href={`#/p/${f.id}`}>
            <span class="feat__k"><span class={`kdot k-${k}`} aria-hidden="true" />{KIND_LABEL[k][0]}</span>
            <span class="feat__t">{cleanTitle(f.title)}</span>
            <span class="feat__w">{f.why}</span>
          </a>
        );
      })}
      {m.featured.length > limit && (
        <button class="linkish small feat__more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${m.featured.length} entry points`}</button>
      )}
    </section>
  );
}

function FamilyLegend() {
  const [ix, setIx] = useState<LangIndex | null>(null);
  useEffect(() => { loadLanguages().then((d) => setIx(indexLanguages(d))).catch(() => {}); }, []);
  if (!ix) return null;
  return (
    <div class="famlegend">
      {ix.families.map((f) => (
        <a class="famlegend__f" href={`#/p/${f.id}`}><span class="swatch" style={{ background: f.color }} />{f.name} <span class="muted">{f.size}</span></a>
      ))}
      <a class="famlegend__tree" href="#/languages">The Tree of Tongues →</a>
    </div>
  );
}

function Intro() {
  const m = meta.value;
  const d = mapData.value;
  const y = year.value;
  const L = layer.value;
  const era = eraAt(y);
  const lv = layersVersion.value;
  const top = useMemo(() => {
    const st = d?.layers[L];
    if (!d || !st) return [];
    const arr = st.at(y);
    const counts = new Map<number, number>();
    for (let i = 0; i < d.geo.n; i++) if (arr[i] >= 0 && d.geo.land[i]) counts.set(arr[i], (counts.get(arr[i]) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([idx, n]) => {
      const l = legendOf(d, L, idx);
      const name = L === 'political' ? polityNameAt(d, idx, y) : l?.name ?? '';
      return { id: l?.id, name, color: l?.color, n, total: counts.size };
    });
  }, [d, L, lv, Math.floor(y / 5)]);
  const total = top[0]?.total ?? 0;
  return (
    <div class="intro">
      <div class="intro__peek">
        <div class="wordmark wordmark--sm">{m?.title ?? 'Palimpsest'}</div>
        <div class="intro__now"><strong>{fmtYear(y)}</strong> · {era?.name}</div>
      </div>
      <p class="intro__lede">{m?.subtitle ?? 'A 5,000-year archive of a civilization that never existed.'}</p>
      <ol class="hints">
        <li><span>1</span>Drag the timeline — borders, cities and events follow the year.</li>
        <li><span>2</span>Tap a territory, city or marker to see who held it.</li>
        <li><span>3</span>Open any page to read the primary sources behind it.</li>
      </ol>
      <div class="introlinks">
        <a class="introlink" href="#/story"><span class="introlink__k">Read</span>The story of five thousand years →</a>
        {!reducedMotion && <button class="introlink" onClick={startTour}><span class="introlink__k">Watch</span>All 5,000 years in nine seconds ▶</button>}
      </div>
      <Featured />
      {firstPaint.value && <CollectionStrip ids={['queens', 'rival', 'lives']} />}
      <div class="introdice"><SurpriseButton label="Surprise me: a random document" /></div>
      <section class="hmsect">
        <h3 class="sect">The Histomap</h3>
        {firstPaint.value ? <HistomapThumb height={86} /> : <div class="hmthumb hmthumb--wait" style={{ height: '120px' }} />}
      </section>
      {top.length > 0 && (
        <section class="legend">
          <h3 class="sect">{L === 'political' ? `${total} powers in ${y}` : L === 'culture' ? `${total} peoples in ${y}` : L === 'language' ? `${total} languages spoken in ${y}` : `${total} faiths in ${y}`}</h3>
          {L === 'language' && <FamilyLegend />}
          <ul>
            {top.map((t) => (
              <li>
                <button class="legend__row" onClick={() => { if (t.id) selection.value = t.id; }}>
                  <span class="swatch" style={{ background: t.color }} />
                  <span class="legend__name">{t.name}</span>
                  <span class="legend__n">{t.n}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section class="glyphs" aria-label="Map symbols">
        <h3 class="sect">On the map</h3>
        <ul>
          <li><svg viewBox="-8 -8 16 16" aria-hidden="true"><path d="M0-6L6 0 0 6-6 0z" fill="#a3363a" /></svg>War, battle</li>
          <li><svg viewBox="-8 -8 16 16" aria-hidden="true"><rect x="-5" y="-5" width="10" height="10" fill="#2f5d7c" /></svg>Treaty</li>
          <li><svg viewBox="-8 -8 16 16" aria-hidden="true"><path d="M0-6L5.7 4.5H-5.7z" fill="#d0601a" /></svg>Eruption, drought, famine</li>
          <li><svg viewBox="-8 -8 16 16" aria-hidden="true"><circle r="5" fill="#4f7a3d" /></svg>Founding</li>
          <li><svg viewBox="-8 -8 16 16" aria-hidden="true"><path d="M-6-3.7L-3.7-6 0-2.3 3.7-6 6-3.7 2.3 0 6 3.7 3.7 6 0 2.3-3.7 6-6 3.7-2.3 0z" fill="#5a1a1a" /></svg>Collapse, conquest</li>
          <li><svg viewBox="-8 -8 16 16" aria-hidden="true"><circle r="3" fill="currentColor" /><circle r="5.5" fill="none" stroke="currentColor" stroke-width="1.2" /></svg>Capital</li>
        </ul>
      </section>
    </div>
  );
}

function Selected({ id }: { id: string }) {
  const d = mapData.value;
  const y = year.value;
  const header = (title: string) => (
    <div class="sel__head">
      <span class="sel__crumb">{title}</span>
      <button class="btn-icon btn-icon--sm" aria-label="Clear selection" onClick={() => { selection.value = null; }}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      </button>
    </div>
  );

  if (id.startsWith('cell:')) {
    const cell = Number(id.slice(5));
    return (
      <div class="sel">
        {header(`Location · ${fmtYear(y)}`)}
        {d && <CellInfo cell={cell} />}
      </div>
    );
  }

  let extra = null;
  if (d && id.startsWith('pol:')) {
    const idx = d.layers.political.layer.legend.find((l) => l.id === id)?.idx ?? -1;
    const legend = legendOf(d, 'political', idx);
    if (legend) {
      const st = d.layers.political.at(y);
      let n = 0;
      for (let i = 0; i < d.geo.n; i++) if (st[i] === idx) n++;
      const cap = capitalAt(d, idx, y);
      const capS = cap >= 0 ? d.settlementByIdx.get(cap) : undefined;
      const name = polityNameAt(d, idx, y);
      extra = (
        <div class="now">
          <div class="now__label">In {y}</div>
          {n > 0 ? (
            <div class="now__body">
              <strong>{name}</strong> holds {n} {n === 1 ? 'district' : 'districts'}
              {capS && <> · capital <a href="#" onClick={(e) => { e.preventDefault(); selection.value = capS.id; }}>{capS.name}</a></>}
            </div>
          ) : (
            <div class="now__body muted">
              {legend.start > y ? <>Not yet founded — first appears in <button class="linkish" onClick={() => setYear(legend.start)}>{legend.start}</button>.</> : <>No longer exists — last seen in <button class="linkish" onClick={() => setYear(Math.max(0, Math.min(legend.end, 5000) - 1))}>{legend.end}</button>.</>}
            </div>
          )}
        </div>
      );
    }
  } else if (d && id.startsWith('set:')) {
    const s = d.timeline.settlements.find((x) => x.id === id);
    if (s) {
      const alive = s.start <= y && (s.end >= y || s.end >= 5000);
      const owner = d.layers.political.at(y)[s.cell];
      const ownerL = legendOf(d, 'political', owner);
      extra = (
        <div class="now">
          <div class="now__label">In {y}</div>
          <div class="now__body">
            {alive ? (
              <>
                About <strong>{fmtCompact(MapRenderer.popAt(s.pop, y))}</strong> inhabitants
                {ownerL && <> · held by <a href="#" onClick={(e) => { e.preventDefault(); selection.value = ownerL.id; }}>{polityNameAt(d, owner, y)}</a></>}
              </>
            ) : s.start > y ? (
              <span class="muted">Not yet founded (founded <button class="linkish" onClick={() => setYear(s.start)}>{s.start}</button>).</span>
            ) : (
              <span class="muted">Abandoned by {s.end}.</span>
            )}
          </div>
        </div>
      );
    }
  }

  return (
    <div class="sel">
      {header(id.startsWith('evt:') ? 'Event' : id.startsWith('set:') ? 'Settlement' : id.startsWith('pol:') ? 'Polity' : id.startsWith('cul:') ? 'People' : id.startsWith('mov:') ? 'Faith' : 'Selection')}
      {extra}
      <PageCard id={id} />
    </div>
  );
}

function CellInfo({ cell }: { cell: number }) {
  const d = mapData.value!;
  const y = year.value;
  layersVersion.value;
  useEffect(() => { ensureLayer('culture').catch(() => {}); ensureLayer('religion').catch(() => {}); ensureLayer('language').catch(() => {}); }, []);
  const row = (label: string, layerName: LayerName) => {
    const st = d.layers[layerName];
    if (!st) return (<><dt>{label}</dt><dd class="muted">…</dd></>);
    const v = st.at(y)[cell];
    const l = legendOf(d, layerName, v);
    const name = l && layerName === 'political' ? polityNameAt(d, v, y) : l?.name;
    return (
      <>
        <dt>{label}</dt>
        <dd>
          {l ? (
            <button class="linkish" onClick={() => { if (layerName !== layer.peek() && layerName !== 'political') layer.value = layerName; selection.value = l.id; }}>
              <span class="swatch swatch--sm" style={{ background: l.color }} />{name}
            </button>
          ) : <span class="muted">{layerName === 'political' ? 'Unclaimed' : '—'}</span>}
        </dd>
      </>
    );
  };
  const region = d.world.regions[d.world.regionOf[cell]];
  const biome = d.world.biomes.find((b) => b.id === d.world.biome[cell]) ?? d.world.biomes[d.world.biome[cell]];
  const near = useMemo(() => {
    const out: { id: string; title: string; year: number; sub: string; dist: number }[] = [];
    const cx = d.geo.sx[cell], cy = d.geo.sy[cell];
    for (const e of d.timeline.events) {
      if (e.cell < 0 || Math.abs(e.year - y) > 60) continue;
      const dist = Math.hypot(d.geo.sx[e.cell] - cx, d.geo.sy[e.cell] - cy);
      if (dist < 90) out.push({ id: e.id, title: e.title, year: e.year, sub: e.sub, dist });
    }
    return out.sort((a, b) => Math.abs(a.year - y) - Math.abs(b.year - y)).slice(0, 8);
  }, [cell, Math.floor(y / 5), layersVersion.value]);
  return (
    <div class="card">
      <dl class="kv">
        {row('Held by', 'political')}
        {row('People', 'culture')}
        {row('Faith', 'religion')}
        {row('Language', 'language')}
        <dt>Region</dt>
        <dd>{region ? <a href={`#/p/${region.id}`}>{region.name}</a> : '—'}</dd>
        <dt>Land</dt>
        <dd>{biome?.name ?? '—'}</dd>
      </dl>
      <h3 class="sect">Nearby, {Math.max(0, y - 60)}–{y + 60}</h3>
      {near.length ? (
        <ul class="evlist">
          {near.map((e) => (
            <li>
              <button class="evlist__row" onClick={() => { selection.value = e.id; }}>
                <span class="evlist__y">{e.year}</span>
                <span class="evlist__t">{e.title || '…'}</span>
                <span class="evlist__s">{subLabel(e.sub)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p class="muted small">No recorded events nearby in this window.</p>}
    </div>
  );
}
