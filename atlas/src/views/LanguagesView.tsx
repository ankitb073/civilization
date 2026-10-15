import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { indexLanguages, loadLanguages, type Lang, type LangIndex } from '../languages.ts';
import { isMobile, navigate, route } from '../state.ts';
import { ensureMeta, meta } from '../store.ts';

const X0 = -3200, X1 = 5000;

interface Row { lang: Lang; row: number; parentRow: number }
interface FamilyBlock { id: string; name: string; color: string; size: number; top: number; bottom: number }

/** Lay out each family as a tree: later-born daughters sit closest to their parent so branches never cross a living line. */
function layout(ix: LangIndex): { rows: Row[]; blocks: FamilyBlock[]; total: number } {
  const kids = new Map<string, Lang[]>();
  for (const l of ix.data.languages) if (l.parent) { if (!kids.has(l.parent)) kids.set(l.parent, []); kids.get(l.parent)!.push(l); }
  const rows: Row[] = [];
  const blocks: FamilyBlock[] = [];
  let cursor = 1; // leave a row for the first family's label
  const order = (l: Lang): Lang[] => {
    const ks = (kids.get(l.id) ?? []).slice().sort((a, b) => b.born - a.born || a.id.localeCompare(b.id)); // latest first
    const above: Lang[] = [], below: Lang[] = [];
    ks.forEach((k, i) => (i % 2 === 0 ? above : below).push(k));
    above.reverse(); // farthest (earliest) at the top
    return [...above.flatMap(order), l, ...below.flatMap(order)];
  };
  for (const f of ix.families) {
    const root = ix.byId.get(f.id);
    if (!root) continue;
    const seq = order(root);
    const top = cursor;
    const at = new Map<string, number>();
    seq.forEach((l, i) => at.set(l.id, top + i));
    for (const l of seq) rows.push({ lang: l, row: at.get(l.id)!, parentRow: l.parent ? at.get(l.parent) ?? -1 : -1 });
    cursor += seq.length;
    blocks.push({ id: f.id, name: f.name, color: f.color, size: f.size, top, bottom: cursor - 1 });
    cursor += 2; // gap between families
  }
  return { rows, blocks, total: cursor - 2 };
  // (total counts the leading label row)
}

export function LanguagesView() {
  const [ix, setIx] = useState<LangIndex | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const m = meta.value;
  const exportMode = route.value.params.get('export') === '1';
  const mobile = isMobile.value && !exportMode;
  useEffect(() => { loadLanguages().then((d) => setIx(indexLanguages(d))).catch(() => {}); ensureMeta().catch(() => {}); }, []);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ix]);
  useEffect(() => { document.title = `${m?.title ?? 'Palimpsest'} — The Tree of Tongues`; }, [m]);

  const lay = useMemo(() => (ix ? layout(ix) : null), [ix]);
  const lineage = useMemo(() => {
    if (!ix || !hover) return null;
    const set = new Set<string>([hover.id]);
    let p = ix.byId.get(hover.id)?.parent;
    while (p) { set.add(p); p = ix.byId.get(p)?.parent ?? null; }
    const down = (id: string) => { for (const l of ix.data.languages) if (l.parent === id) { set.add(l.id); down(l.id); } };
    down(hover.id);
    return set;
  }, [ix, hover?.id]);

  if (!ix || !lay) return <div class="center-load"><div class="spinner" /> Gathering the tongues…</div>;

  const width = Math.max(320, w);
  const L = mobile ? 6 : 16, R = mobile ? 78 : 150, TOP = mobile ? 30 : 36, BOT = 26;
  const availH = exportMode ? 1400 - 210 : 0;
  const rowH = exportMode ? Math.max(6, (availH - TOP - BOT) / (lay.total + 1)) : mobile ? 9 : 12.5;
  const height = TOP + (lay.total + 1) * rowH + BOT;
  const cw = width - L - R;
  const X = (y: number) => L + ((y - X0) / (X1 - X0)) * cw;
  const Y = (r: number) => TOP + (r + 0.5) * rowH;
  const thick = (sc: number) => (mobile ? 0.7 : 1) + Math.log2(sc + 1) * (mobile ? 0.32 : 0.48);
  const fontSize = exportMode ? Math.min(13, rowH * 1.05) : mobile ? 8 : 11;
  const eras = m?.eras ?? [];
  const hl = hover ? ix.byId.get(hover.id) : null;

  const onMove = (e: PointerEvent) => {
    const id = (e.target as SVGElement).getAttribute?.('data-id');
    if (!id) { if (e.pointerType === 'mouse') setHover(null); return; }
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    setHover({ id, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  return (
    <div class={`tongues${exportMode ? ' tongues--export' : ''}`}>
      <header class="tongues__head">
        <div class="eyebrow">{ix.data.languages.length} languages · {ix.families.length} families · 8,200 years</div>
        <h1 class="h-page tongues__title">The Tree of Tongues</h1>
        <p class="tongues__lede">
          Every language of {m?.worldName ?? 'the world'}, from its six proto-languages to the tongues spoken today. Each line is a language’s life;
          a branch is a daughter splitting from its mother. Thicker lines changed more — {ix.data.languages.reduce((s, l) => s + l.soundChanges, 0).toLocaleString('en-US')} sound laws in all.
          {!exportMode && <> {mobile ? 'Tap' : 'Hover'} a line for its words then and now.</>}
        </p>
      </header>
      <div class="tongues__chart" ref={wrapRef} onPointerLeave={() => { if (!mobile) setHover(null); }}>
        {w > 0 && (
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} class={`tt${hover ? ' has-hover' : ''}`} role="img"
            aria-label={`Family tree of ${ix.data.languages.length} languages`}
            onPointerMove={onMove}
            onPointerDown={(e) => { if (e.pointerType !== 'mouse') onMove(e); }}
            onClick={(e) => {
              const id = (e.target as SVGElement).getAttribute?.('data-id');
              if (!id) { setHover(null); return; }
              if (!mobile) navigate(`#/p/${id}`);
            }}>
            {/* before the archive */}
            <rect x={X(X0)} y={TOP - 4} width={X(0) - X(X0)} height={height - TOP - BOT + 8} class="tt-pre" />
            <text x={X(X0) + 6} y={TOP - 10} class="tt-band">{mobile ? 'BEFORE AY 0' : 'BEFORE THE ARCHIVE · PROTO-LANGUAGES'}</text>
            {eras.map((e, i) => (
              <g>
                <line x1={X(e.start)} x2={X(e.start)} y1={TOP - 4} y2={height - BOT + 4} class={i === 0 ? 'tt-zero' : 'tt-era'} />
                {!mobile && X(e.end) - X(e.start) > 70 && <text x={X(e.start) + 5} y={TOP - 10} class="tt-band">{e.name.replace(/^Age of (the )?/, '').toUpperCase()}</text>}
              </g>
            ))}
            {/* axis */}
            {[-3000, -2000, -1000, 0, 1000, 2000, 3000, 4000, 5000].map((t) => (
              <text x={X(t)} y={height - 8} class="tt-tick" text-anchor="middle">{t === 0 ? 'AY 0' : t < 0 ? `−${-t}` : t}</text>
            ))}
            {/* family labels */}
            {lay.blocks.map((b) => (
              <text x={X(X0) + 6} y={Y(b.top) - rowH * 0.9} class="tt-fam" fill={b.color}>{b.name} <tspan class="tt-fam__n">{b.size}</tspan></text>
            ))}
            {/* connectors */}
            <g class="tt-conn">
              {lay.rows.filter((r) => r.parentRow >= 0).map((r) => {
                const x = X(r.lang.born), y0 = Y(r.parentRow), y1 = Y(r.row);
                const rr = Math.min(5, Math.abs(y1 - y0) / 2, (X(r.lang.died ?? X1) - x) / 2);
                const dir = y1 > y0 ? 1 : -1;
                return <path d={`M${x},${y0}V${y1 - dir * rr}Q${x},${y1} ${x + rr},${y1}`} stroke={ix.color.get(r.lang.id)} class={lineage && !lineage.has(r.lang.id) ? 'dim' : ''} />;
              })}
            </g>
            {/* life lines */}
            <g class="tt-lines">
              {lay.rows.map((r) => {
                const l = r.lang, x0 = X(l.born), x1 = X(l.died ?? X1), y = Y(r.row);
                const c = ix.color.get(l.id)!;
                const dim = lineage && !lineage.has(l.id);
                return (
                  <g class={dim ? 'dim' : lineage ? 'lit' : ''}>
                    <line x1={x0} x2={x1} y1={y} y2={y} stroke={c} stroke-width={thick(l.soundChanges)} stroke-linecap="round" />
                    {l.died !== null && <line x1={x1} x2={x1} y1={y - 3} y2={y + 3} stroke={c} stroke-width="1.2" />}
                    {!l.parent && <circle cx={x0} cy={y} r={mobile ? 2.4 : 3.4} fill={c} />}
                    <line x1={x0} x2={x1} y1={y} y2={y} class="tt-hit" data-id={l.id} />
                  </g>
                );
              })}
            </g>
            {/* labels */}
            <g class="tt-labels">
              {lay.rows.map((r) => {
                const l = r.lang;
                const alive = l.died === null;
                if (mobile && !alive) return null;
                const x = alive ? X(X1) + 6 : X(l.died!) + 6;
                const dim = lineage && !lineage.has(l.id);
                return <text x={x} y={Y(r.row) + fontSize * 0.36} font-size={fontSize} class={`${alive ? 'alive' : 'dead'}${dim ? ' dim' : ''}`} data-id={l.id}>{l.name}</text>;
              })}
            </g>
          </svg>
        )}
        {hl && hover && (
          <div class={`tt-tip${mobile ? ' tt-tip--sheet' : ''}`} style={mobile ? undefined : { transform: `translate(${Math.min(hover.x + 16, width - 300)}px, ${hover.y + 14}px)` }}>
            <div class="tt-tip__n" style={{ color: ix.color.get(hl.id) }}>{hl.name}</div>
            <div class="tt-tip__m">
              {hl.parent ? <>daughter of {ix.byId.get(hl.parent)?.name}</> : 'proto-language'} · {ix.familyOf.get(hl.id)?.name} family
            </div>
            <div class="tt-tip__m">
              {hl.born < 0 ? `${-hl.born} before AY 0` : `AY ${hl.born}`} – {hl.died === null ? 'still spoken' : `AY ${hl.died}`} · {hl.soundChanges} sound change{hl.soundChanges === 1 ? '' : 's'}
              {hl.speakers.length ? ` · ${hl.speakers.length} ${hl.speakers.length === 1 ? 'people' : 'peoples'}` : ''}
            </div>
            {hl.sample.length > 0 && (
              <table class="tt-tip__w">
                <tbody>
                  {hl.sample.map(([c, a, b]) => (
                    <tr><td>‘{c}’</td><td><i>{a}</i></td><td class="arr">→</td><td><i>{b}</i></td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {mobile && (
              <div class="actions">
                <a class="btn btn--accent" href={`#/p/${hl.id}`}>Open page</a>
                <button class="btn btn--ghost" onClick={() => setHover(null)}>Close</button>
              </div>
            )}
          </div>
        )}
      </div>
      {!exportMode && (
        <details class="a11ylist">
          <summary>All {ix.data.languages.length} languages, as a list</summary>
          {ix.families.map((f) => (
            <section>
              <h2 class="sect">{f.name} family</h2>
              <ul>
                {lay.rows.filter((r) => ix.familyOf.get(r.lang.id)?.id === f.id).sort((a, b) => a.lang.born - b.lang.born).map((r) => (
                  <li><a href={`#/p/${r.lang.id}`}>{r.lang.name}</a> <span class="muted small">{r.lang.born < 0 ? `${-r.lang.born} before AY 0` : `AY ${r.lang.born}`} – {r.lang.died === null ? 'still spoken' : `AY ${r.lang.died}`}{r.lang.parent ? ` · from ${ix.byId.get(r.lang.parent)?.name}` : ' · proto-language'}</span></li>
                ))}
              </ul>
            </section>
          ))}
        </details>
      )}
      {exportMode && m && (
        <footer class="tongues__foot">{m.title} · the archive of {m.worldName} · {(m.counts.artifact ?? 0).toLocaleString('en-US')} primary sources · ankitb073.github.io/civilization</footer>
      )}
    </div>
  );
}
