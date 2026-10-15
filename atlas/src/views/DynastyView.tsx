import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { loadDynasties, type Dynasty } from '../extras.ts';
import { ensureMapData, mapData } from '../store.ts';
import { isMobile } from '../state.ts';

type Member = Dynasty['members'][number];

function polityName(id: string): string {
  const d = mapData.value;
  return d?.layers.political.layer.legend.find((l) => l.id === id)?.name ?? '';
}

export function DynastiesView({ id }: { id: string | null }) {
  const [data, setData] = useState<Dynasty[] | null>(null);
  useEffect(() => { loadDynasties().then((d) => setData(d.dynasties)).catch(() => {}); ensureMapData().catch(() => {}); }, []);
  mapData.value;
  if (!data) return <div class="center-load"><div class="spinner" /> Unrolling the pedigrees…</div>;
  if (id) {
    const dy = data.find((x) => x.id === id);
    if (!dy) return <div class="dynasties"><h1 class="h-page">No such house</h1><a href="#/dynasties">All houses</a></div>;
    return <DynastyPage dy={dy} />;
  }
  const sorted = data.slice().sort((a, b) => (b.end - b.start) - (a.end - a.start));
  return (
    <div class="dynasties">
      <header class="collections__head">
        <div class="eyebrow">{data.length} ruling houses · {data.reduce((s, d) => s + d.members.length, 0).toLocaleString('en-US')} members</div>
        <h1 class="h-page">Dynasties</h1>
        <p class="collections__lede">The great ruling houses, longest-lasting first. Each tree runs from the founder down through the generations; the bars show who wore the crown, and for how long.</p>
      </header>
      <div class="colgrid">
        {sorted.map((d) => {
          const rulers = d.members.filter((m) => m.reign);
          const queens = rulers.filter((m) => m.sex === 'f').length;
          return (
            <a class="colcard dyncard" href={`#/dynasty/${d.id}`}>
              <span class="colcard__t">{d.name}</span>
              <span class="dyncard__p">{polityName(d.polity) ? `of ${polityName(d.polity)}` : ''} · AY {d.start}–{d.end}</span>
              <DynastyStrip dy={d} />
              <span class="dyncard__s">{d.end - d.start} years · {rulers.length} rulers{queens ? ` (${queens} queens)` : ''} · {d.members.length} members</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/** A thin reign strip: one segment per ruler, queens tinted. */
function DynastyStrip({ dy }: { dy: Dynasty }) {
  const rulers = dy.members.filter((m) => m.reign).sort((a, b) => a.reign![0] - b.reign![0]);
  const from = Math.min(dy.start, ...rulers.map((m) => m.reign![0]));
  const to = Math.max(dy.end, ...rulers.map((m) => m.reign![1]));
  const span = Math.max(1, to - from);
  return (
    <svg class="dynstrip" viewBox="0 0 300 10" preserveAspectRatio="none" aria-hidden="true">
      {rulers.map((m, i) => (
        <rect x={((m.reign![0] - from) / span) * 300} y="1" width={Math.max(0.8, ((m.reign![1] - m.reign![0]) / span) * 300 - 0.6)} height="8"
          class={`${m.sex === 'f' ? 'is-f' : ''}${i % 2 ? ' is-alt' : ''}`} />
      ))}
    </svg>
  );
}

function DynastyPage({ dy }: { dy: Dynasty }) {
  useEffect(() => { document.title = `${dy.name} — Palimpsest`; }, [dy]);
  const rulers = dy.members.filter((m) => m.reign);
  return (
    <div class="dynasties dynasties--one">
      <header class="collections__head">
        <a class="eyebrow" href="#/dynasties">← Dynasties</a>
        <h1 class="h-page">{dy.name}</h1>
        <p class="collections__lede">
          Ruled <a href={`#/p/${dy.polity}`}>{polityName(dy.polity) || dy.polity}</a> from AY {dy.start} to AY {dy.end}: {rulers.length} rulers over {dy.end - dy.start} years,
          {' '}{dy.members.length} members in {generations(dy)} generations.
        </p>
        <DynastyStrip dy={dy} />
      </header>
      <DynastyTree dy={dy} />
    </div>
  );
}

function generations(dy: Dynasty): number {
  const by = new Map(dy.members.map((m) => [m.id, m]));
  const depth = (m: Member): number => (m.parent && by.has(m.parent) ? depth(by.get(m.parent)!) + 1 : 0);
  return Math.max(...dy.members.map(depth)) + 1;
}

interface Placed { m: Member; gen: number; x: number }

/** Tidy family tree: generations top → bottom, siblings by birth, parents centred over children. */
function layoutTree(dy: Dynasty): { nodes: Placed[]; width: number; gens: number } {
  const by = new Map(dy.members.map((m) => [m.id, m]));
  const kids = new Map<string, Member[]>();
  const roots: Member[] = [];
  for (const m of dy.members) {
    if (m.parent && by.has(m.parent)) { if (!kids.has(m.parent)) kids.set(m.parent, []); kids.get(m.parent)!.push(m); }
    else roots.push(m);
  }
  for (const k of kids.values()) k.sort((a, b) => a.born - b.born);
  roots.sort((a, b) => a.born - b.born);
  const nodes: Placed[] = [];
  let next = 0, gens = 0;
  const place = (m: Member, gen: number): number => {
    gens = Math.max(gens, gen + 1);
    const ks = kids.get(m.id) ?? [];
    let x: number;
    if (!ks.length) x = next++;
    else {
      const xs = ks.map((k) => place(k, gen + 1));
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    nodes.push({ m, gen, x });
    return x;
  };
  for (const r of roots) { place(r, 0); next += 0.4; }
  return { nodes, width: Math.max(1, next), gens };
}

export function DynastyTree({ dy, compact = false }: { dy: Dynasty; compact?: boolean }) {
  const mobile = isMobile.value;
  const lay = useMemo(() => layoutTree(dy), [dy]);
  const CW = compact || mobile ? 168 : 214, CH = compact ? 62 : 72, GAPX = 18, GAPY = compact ? 22 : 30;
  const pos = new Map(lay.nodes.map((n) => [n.m.id, n]));
  const W = Math.max(CW, lay.width * (CW + GAPX) - GAPX + 2), H = lay.gens * (CH + GAPY);
  const X = (x: number) => x * (CW + GAPX) + 1;
  const Y = (g: number) => g * (CH + GAPY);
  const maxReign = Math.max(10, ...dy.members.map((m) => (m.reign ? m.reign[1] - m.reign[0] : 0)));
  const scroller = useRef<HTMLDivElement>(null);
  // when the tree is wider than the screen, start with the founder in view
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const root = lay.nodes.find((n) => n.gen === 0);
    if (root) el.scrollLeft = Math.max(0, X(root.x) + CW / 2 - el.clientWidth / 2);
  }, [lay, CW]);
  return (
    <div class={`dyntree${compact ? ' dyntree--compact' : ''}`} ref={scroller}>
      <div class="dyntree__inner" style={{ width: `${W}px`, height: `${H}px` }}>
        <svg class="dyntree__links" width={W} height={H} aria-hidden="true">
          {lay.nodes.filter((n) => n.m.parent && pos.has(n.m.parent)).map((n) => {
            const p = pos.get(n.m.parent!)!;
            const x1 = X(p.x) + CW / 2, y1 = Y(p.gen) + CH, x2 = X(n.x) + CW / 2, y2 = Y(n.gen);
            const ym = y1 + GAPY / 2;
            return <path d={`M${x1},${y1}V${ym}H${x2}V${y2}`} />;
          })}
        </svg>
        {lay.nodes.map((n) => {
          const m = n.m;
          const reign = m.reign;
          return (
            <a class={`dyn${reign ? ' is-ruler' : ''} ${m.sex === 'f' ? 'is-f' : 'is-m'}`} href={`#/p/${m.id}`}
              style={{ left: `${X(n.x)}px`, top: `${Y(n.gen)}px`, width: `${CW}px`, height: `${CH}px` }}
              title={`${m.name}${m.epithet ? ` ${m.epithet}` : ''} · ${m.born}–${m.died}${reign ? ` · reigned ${reign[0]}–${reign[1]}` : ''}`}>
              <span class="dyn__n"><span class="dyn__sex" aria-label={m.sex === 'f' ? 'woman' : 'man'} /><span class="dyn__nm">{m.name}{m.epithet && <em class="dyn__e"> {m.epithet}</em>}</span></span>
              <span class="dyn__l">{m.born}–{m.died}</span>
              {reign && (
                <span class="dyn__r">
                  <span class="dyn__bar" style={{ width: `${Math.max(6, ((reign[1] - reign[0]) / maxReign) * 100)}%` }} />
                  <span class="dyn__rt">r. {reign[0]}–{reign[1]}</span>
                </span>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}

/** For polity pages: the ruling house(s), collapsed by default. */
export function PolityDynasties({ polity }: { polity: string }) {
  const [list, setList] = useState<Dynasty[]>([]);
  useEffect(() => { loadDynasties().then((d) => setList(d.dynasties.filter((x) => x.polity === polity))).catch(() => {}); }, [polity]);
  if (!list.length) return null;
  return (
    <section class="poldyn">
      {list.map((dy) => (
        <details class="poldyn__d">
          <summary>
            <span class="sect">Ruling house</span>
            <span class="poldyn__t">{dy.name}</span>
            <span class="muted small">AY {dy.start}–{dy.end} · {dy.members.filter((m) => m.reign).length} rulers · {dy.members.length} members · show the family tree</span>
          </summary>
          <DynastyStrip dy={dy} />
          <DynastyTree dy={dy} compact />
          <a class="linkish small" href={`#/dynasty/${dy.id}`}>Open the house page →</a>
        </details>
      ))}
    </section>
  );
}

/** For person pages: which house they belong to. */
export function PersonHouse({ person }: { person: string }) {
  const [dy, setDy] = useState<Dynasty | null>(null);
  useEffect(() => { loadDynasties().then((d) => setDy(d.dynasties.find((x) => x.members.some((mm) => mm.id === person)) ?? null)).catch(() => {}); }, [person]);
  if (!dy) return null;
  const me = dy.members.find((m) => m.id === person)!;
  return (
    <a class="personhouse" href={`#/dynasty/${dy.id}`}>
      <span class="sect">House</span>
      <span class="personhouse__t">{dy.name}</span>
      <span class="muted small">{me.reign ? `Reigned ${me.reign[0]}–${me.reign[1]}` : 'Member'} · see the family tree →</span>
    </a>
  );
}
