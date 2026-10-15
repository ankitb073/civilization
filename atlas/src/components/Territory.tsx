import { useEffect, useMemo, useState } from 'preact/hooks';
import type { PageJson } from '../../../engine/src/export/contract.ts';
import { MiniMap, polityBox } from './MiniMap.tsx';
import { ensureMapData, ensurePoliticalYear, layersVersion, mapData } from '../store.ts';
import { mapHref } from '../state.ts';

/** The polity's territory on a small map, with a scrubber across its lifespan. */
export function Territory({ page }: { page: PageJson }) {
  const t0 = Math.max(0, page.t0), t1 = Math.min(5000, page.t1);
  const peak = useMemo(() => {
    const s = page.series?.find((x) => /territor/i.test(x.label));
    if (!s || !s.points.length) return Math.round((t0 + t1) / 2);
    return s.points.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  }, [page]);
  const peakSize = page.series?.find((x) => /territor/i.test(x.label))?.points.reduce((a, b) => Math.max(a, b[1]), 0);
  const [y, setY] = useState(peak);
  const [box, setBox] = useState<[number, number, number, number] | null>(null);
  const [playing, setPlaying] = useState(false);
  const d = mapData.value;
  const lv = layersVersion.value;
  useEffect(() => { setY(peak); }, [peak]);
  useEffect(() => {
    let live = true;
    ensureMapData().then((dd) => ensurePoliticalYear(peak).then(() => {
      if (!live) return;
      const idx = dd.layers.political.layer.legend.find((l) => l.id === page.id)?.idx ?? -1;
      setBox(idx >= 0 ? polityBox(dd, idx, peak) : null);
    })).catch(() => {});
    return () => { live = false; };
  }, [page.id, peak]);
  // play through the lifespan
  useEffect(() => {
    if (!playing) return;
    let cur = y >= t1 ? t0 : y;
    const stepYears = Math.max(5, Math.round((t1 - t0) / 60));
    const id = setInterval(() => {
      cur = Math.min(t1, cur + stepYears);
      setY(cur);
      if (cur >= t1) { setPlaying(false); clearInterval(id); }
    }, 120);
    return () => clearInterval(id);
  }, [playing]);
  const held = useMemo(() => {
    if (!d) return null;
    const idx = d.layers.political.layer.legend.find((l) => l.id === page.id)?.idx ?? -1;
    if (idx < 0) return null;
    const st = d.layers.political.at(y);
    let n = 0;
    for (let i = 0; i < d.geo.n; i++) if (st[i] === idx) n++;
    return n;
  }, [d, y, lv, page.id]);
  if (t1 <= t0) return null;
  return (
    <section class="aside-sect territory" aria-label="Territory">
      <h2 class="sect">Territory</h2>
      <MiniMap year={y} highlight={page.id} box={box} height={200} label={`Territory of ${page.title} in AY ${y}`} />
      <div class="territory__row">
        <button class="btn-icon btn-icon--sm" aria-label={playing ? 'Pause' : `Play its history from AY ${t0}`} onClick={() => setPlaying(!playing)}>
          {playing ? '❚❚' : '▶'}
        </button>
        <input class="territory__range" type="range" min={t0} max={t1} step={1} value={y} aria-label="Year" aria-valuetext={`AY ${y}`}
          onInput={(e) => { setPlaying(false); setY(Number((e.target as HTMLInputElement).value)); }} />
      </div>
      <div class="territory__cap">
        <span><a class="ylink" href={`#/year/${y}`}>AY {y}</a> · {held ?? '…'} districts{y === peak && peakSize ? ' · its greatest extent' : ''}</span>
        <a href={mapHref({ y, sel: page.id, l: 'political' })}>Open on the atlas →</a>
      </div>
      {y !== peak && <button class="linkish small" onClick={() => setY(peak)}>Back to its peak (AY {peak})</button>}
    </section>
  );
}
