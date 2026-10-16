import { useState } from 'preact/hooks';
import { fmtCompact } from '../format.ts';
import { year as yearSig } from '../state.ts';

export function Sparkline({ series, height = 54 }: { series: { label: string; unit: string; points: [number, number][]; decadal?: boolean }; height?: number }) {
  const when = (x: number) => (series.decadal ? `${x}s` : String(x));
  const [hover, setHover] = useState<number | null>(null);
  const pts = series.points;
  if (pts.length < 2) {
    return (
      <div class="spark">
        <div class="spark__head"><span class="spark__label">{series.label}</span><span class="spark__val">{pts[0] ? `${fmtCompact(pts[0][1])} ${series.unit}` : '—'}</span></div>
      </div>
    );
  }
  const W = 300, H = height, pad = 3;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (y0 > 0 && y0 / (y1 || 1) < 0.6) y0 = 0;
  const sx = (x: number) => pad + ((x - x0) / Math.max(1, x1 - x0)) * (W - 2 * pad);
  const sy = (y: number) => H - pad - ((y - y0) / Math.max(1e-9, y1 - y0)) * (H - 2 * pad - 4);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('');
  const area = `${line}L${sx(x1).toFixed(1)},${H - pad}L${sx(x0).toFixed(1)},${H - pad}Z`;
  const hi = hover ?? pts.length - 1;
  const [hx, hy] = pts[hi];
  const cur = yearSig.value;
  const showCur = cur >= x0 && cur <= x1;
  const onMove = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const x = x0 + ((e.clientX - r.left) / r.width) * (x1 - x0);
    let best = 0, bd = Infinity;
    pts.forEach(([px], i) => { const d = Math.abs(px - x); if (d < bd) { bd = d; best = i; } });
    setHover(best);
  };
  return (
    <figure class="spark">
      <figcaption class="spark__head">
        <span class="spark__label">{series.label}</span>
        <span class="spark__val">{fmtCompact(hy)} <small>{series.unit}</small> <span class="muted">· {when(hx)}</span></span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class="spark__svg" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img"
        aria-label={`${series.label}: from ${fmtCompact(pts[0][1])} in ${when(pts[0][0])} to ${fmtCompact(pts[pts.length - 1][1])} in ${when(pts[pts.length - 1][0])}`}>
        <path d={area} class="spark__area" />
        <path d={line} class="spark__line" vector-effect="non-scaling-stroke" />
        {showCur && <line x1={sx(cur)} x2={sx(cur)} y1={0} y2={H} class="spark__now" vector-effect="non-scaling-stroke" />}
        <circle cx={sx(hx)} cy={sy(hy)} r="3" class="spark__dot" />
      </svg>
      <div class="spark__axis"><span>{x0}</span><span>{x1}</span></div>
    </figure>
  );
}
