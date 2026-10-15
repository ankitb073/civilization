import { useMemo } from 'preact/hooks';
import { layer, selection, setYear, year } from '../state.ts';
import { eraAt, mapData, meta } from '../store.ts';
import { fmtCompact, fmtYear, subLabel } from '../format.ts';
import { PageCard } from '../components/PageCard.tsx';
import { MapRenderer } from './mapRenderer.ts';

export function MapPanel() {
  const sel = selection.value;
  return sel ? <Selected id={sel} /> : <Intro />;
}

function Intro() {
  const m = meta.value;
  const d = mapData.value;
  const y = year.value;
  const L = layer.value;
  const era = eraAt(y);
  const top = useMemo(() => {
    if (!d) return [];
    const st = d.layers[L].at(y);
    const counts = new Map<number, number>();
    for (let i = 0; i < d.geo.n; i++) if (st[i] >= 0 && d.geo.land[i]) counts.set(st[i], (counts.get(st[i]) ?? 0) + 1);
    const legend = d.timeline.layers[L].legend;
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([idx, n]) => {
      let name = legend[idx]?.name ?? '';
      if (L === 'political') {
        const p = d.timeline.polities[idx];
        if (p) for (const [yy, nm] of p.names) if (yy <= y) name = nm;
      }
      return { id: legend[idx]?.id, name, color: legend[idx]?.color, n, total: counts.size };
    });
  }, [d, L, Math.floor(y / 5)]);
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
      {top.length > 0 && (
        <section class="legend">
          <h3 class="sect">{L === 'political' ? `${total} powers in ${y}` : L === 'culture' ? `${total} peoples in ${y}` : `${total} faiths in ${y}`}</h3>
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
      {m && m.featured.length > 0 && (
        <section class="featured">
          <h3 class="sect">Start here</h3>
          {m.featured.map((f) => (
            <a class="feat" href={`#/p/${f.id}`}>
              <span class="feat__t">{f.title}</span>
              <span class="feat__w">{f.why}</span>
            </a>
          ))}
        </section>
      )}
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
    const idx = d.timeline.layers.political.legend.find((l) => l.id === id)?.idx ?? -1;
    if (idx >= 0) {
      const st = d.layers.political.at(y);
      let n = 0;
      for (let i = 0; i < d.geo.n; i++) if (st[i] === idx) n++;
      const p = d.timeline.polities[idx];
      let cap = -1;
      let name = d.timeline.layers.political.legend[idx].name;
      if (p) {
        for (const [yy, si] of p.capitals) if (yy <= y) cap = si;
        for (const [yy, nm] of p.names) if (yy <= y) name = nm;
      }
      const legend = d.timeline.layers.political.legend[idx];
      extra = (
        <div class="now">
          <div class="now__label">In {y}</div>
          {n > 0 ? (
            <div class="now__body">
              <strong>{name}</strong> holds {n} {n === 1 ? 'cell' : 'cells'} of land
              {cap >= 0 && <> · capital <a href="#" onClick={(e) => { e.preventDefault(); selection.value = d.timeline.settlements[cap].id; }}>{d.timeline.settlements[cap].name}</a></>}
            </div>
          ) : (
            <div class="now__body muted">
              {legend.start > y ? <>Not yet founded — first appears in <button class="linkish" onClick={() => setYear(legend.start)}>{legend.start}</button>.</> : <>No longer exists — last seen in <button class="linkish" onClick={() => setYear(Math.min(legend.end, 5000))}>{legend.end}</button>.</>}
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
      const ownerL = owner >= 0 ? d.timeline.layers.political.legend[owner] : null;
      extra = (
        <div class="now">
          <div class="now__label">In {y}</div>
          <div class="now__body">
            {alive ? (
              <>
                About <strong>{fmtCompact(MapRenderer.popAt(s.pop, y))}</strong> inhabitants
                {ownerL && <> · held by <a href="#" onClick={(e) => { e.preventDefault(); selection.value = ownerL.id; }}>{ownerL.name}</a></>}
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
  const row = (label: string, layerName: 'political' | 'culture' | 'religion') => {
    const v = d.layers[layerName].at(y)[cell];
    const l = v >= 0 ? d.timeline.layers[layerName].legend[v] : null;
    let name = l?.name;
    if (l && layerName === 'political') {
      const p = d.timeline.polities[v];
      if (p) for (const [yy, nm] of p.names) if (yy <= y) name = nm;
    }
    return (
      <>
        <dt>{label}</dt>
        <dd>
          {l ? (
            <button class="linkish" onClick={() => { selection.value = l.id; }}>
              <span class="swatch swatch--sm" style={{ background: l.color }} />{name}
            </button>
          ) : <span class="muted">{layerName === 'political' ? 'Unclaimed' : '—'}</span>}
        </dd>
      </>
    );
  };
  const region = d.world.regions[d.world.regionOf[cell]];
  const biome = d.world.biomes[d.world.biome[cell]];
  const near = useMemo(() => {
    const out: { id: string; title: string; year: number; sub: string; dist: number }[] = [];
    const cx = d.geo.sx[cell], cy = d.geo.sy[cell];
    for (const e of d.timeline.events) {
      if (e.cell < 0 || Math.abs(e.year - y) > 60) continue;
      const dist = Math.hypot(d.geo.sx[e.cell] - cx, d.geo.sy[e.cell] - cy);
      if (dist < 90) out.push({ id: e.id, title: e.title, year: e.year, sub: e.sub, dist });
    }
    return out.sort((a, b) => Math.abs(a.year - y) - Math.abs(b.year - y)).slice(0, 8);
  }, [cell, Math.floor(y / 5)]);
  return (
    <div class="card">
      <dl class="kv">
        {row('Held by', 'political')}
        {row('People', 'culture')}
        {row('Faith', 'religion')}
        <dt>Region</dt>
        <dd>{region ? <a href={`#/p/${region.id}`}>{region.name}</a> : '—'}</dd>
        <dt>Land</dt>
        <dd>{biome?.name ?? '—'}</dd>
      </dl>
      <h3 class="sect">Nearby, {y - 60}–{y + 60}</h3>
      {near.length ? (
        <ul class="evlist">
          {near.map((e) => (
            <li>
              <button class="evlist__row" onClick={() => { selection.value = e.id; }}>
                <span class="evlist__y">{e.year}</span>
                <span class="evlist__t">{e.title}</span>
                <span class="evlist__s">{subLabel(e.sub)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p class="muted small">No recorded events nearby in this window.</p>}
    </div>
  );
}
