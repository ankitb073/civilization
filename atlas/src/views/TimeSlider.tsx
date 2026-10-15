import { useEffect, useRef, useState } from 'preact/hooks';
import { playing, setYear, theme, year, yearEnd } from '../state.ts';
import { eraAt, layersVersion, mapData, meta } from '../store.ts';

const SPEEDS = [25, 50, 100, 200];

/** "1,567 wars and 238 collapses. Largest state: …" → "1,567 wars · 238 collapses". */
export function eraStat(blurb: string): string {
  const w = blurb.match(/([\d,]+)\s+wars?/i)?.[1];
  const c = blurb.match(/([\d,]+)\s+collapses?/i)?.[1];
  if (w || c) return [w && `${w} wars`, c && `${c} collapses`].filter(Boolean).join(' · ');
  return blurb.length > 80 ? blurb.slice(0, 78) + '…' : blurb;
}

export function TimeSlider({ compact = false }: { compact?: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [editing, setEditing] = useState(false);
  const [eraOpen, setEraOpen] = useState(false);
  useEffect(() => {
    if (!eraOpen) return;
    const close = () => setEraOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [eraOpen]);
  const [w, setW] = useState(0);
  const m = meta.value;
  const d = mapData.value;
  const y = year.value;
  const end = yearEnd.value;
  const era = eraAt(y);

  // draw the track background (eras, event density, temperature)
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !w || !m) return;
    const h = c.parentElement!.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim();
    const muted = css.getPropertyValue('--muted').trim();
    const rule = css.getPropertyValue('--rule').trim();
    const dark = theme.value === 'dark';
    const X = (yy: number) => (yy / end) * w;
    // era bands
    m.eras.forEach((e, i) => {
      ctx.fillStyle = i % 2 ? (dark ? 'rgba(255,240,210,0.035)' : 'rgba(120,90,50,0.07)') : (dark ? 'rgba(255,240,210,0.015)' : 'rgba(120,90,50,0.025)');
      ctx.fillRect(X(e.start), 0, X(e.end) - X(e.start), h);
      if (i > 0) {
        ctx.fillStyle = rule;
        ctx.fillRect(Math.round(X(e.start)), 0, 1, h);
      }
    });
    // era names
    ctx.font = `600 9.5px ${css.getPropertyValue('--font-ui')}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    m.eras.forEach((e) => {
      const x0 = X(e.start), x1 = X(e.end);
      const short = e.name.replace(/^(The )?Age of (the )?/i, '').toUpperCase();
      const tw = ctx.measureText(short).width;
      if (x1 - x0 > tw + 12) {
        ctx.fillStyle = muted;
        ctx.globalAlpha = 0.85;
        ctx.fillText(short, x0 + 6, 4);
        ctx.globalAlpha = 1;
      }
    });
    // event density
    if (d) {
      const bins = Math.max(50, Math.min(400, Math.floor(w / 3)));
      const arr = new Float64Array(bins);
      for (const ev of d.timeline.events) {
        const b = Math.min(bins - 1, Math.floor((ev.year / end) * bins));
        arr[b] += 0.25 + ev.sig;
      }
      let mx = 0;
      for (const v of arr) mx = Math.max(mx, v);
      const base = h - 2;
      const top = h * 0.38;
      ctx.beginPath();
      ctx.moveTo(0, base);
      for (let b = 0; b < bins; b++) {
        const v = Math.sqrt(arr[b] / (mx || 1));
        ctx.lineTo(((b + 0.5) / bins) * w, base - v * (base - top));
      }
      ctx.lineTo(w, base);
      ctx.closePath();
      ctx.fillStyle = dark ? 'rgba(224,138,108,0.28)' : 'rgba(142,47,31,0.18)';
      ctx.fill();
      // temperature anomaly line
      const cl = d.timeline.climate;
      if (cl.length > 1) {
        let lo = Infinity, hi = -Infinity;
        for (const p of cl) { lo = Math.min(lo, p.temp); hi = Math.max(hi, p.temp); }
        const span = Math.max(0.5, hi - lo);
        const mid = h * 0.3;
        const amp = h * 0.22;
        const Y = (t: number) => mid - ((t - (lo + hi) / 2) / span) * 2 * amp;
        ctx.beginPath();
        cl.forEach((p, i) => { const x = X(p.year); if (i === 0) ctx.moveTo(x, Y(p.temp)); else ctx.lineTo(x, Y(p.temp)); });
        ctx.strokeStyle = dark ? 'rgba(138,180,212,0.75)' : 'rgba(47,93,124,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    // ticks (labels sit just above the baseline, haloed)
    ctx.font = `500 9.5px ${css.getPropertyValue('--font-ui')}`;
    ctx.textBaseline = 'bottom';
    const step = w < 420 ? 1000 : 500;
    const bg = css.getPropertyValue('--bg').trim();
    for (let t = step; t < end; t += step) {
      const x = Math.round(X(t));
      ctx.fillStyle = rule;
      ctx.fillRect(x, h - 5, 1, 5);
      ctx.textAlign = 'left';
      ctx.lineWidth = 3;
      ctx.strokeStyle = bg;
      ctx.strokeText(String(t), x + 3, h - 1);
      ctx.fillStyle = muted;
      ctx.fillText(String(t), x + 3, h - 1);
    }
    void ink;
  }, [w, m, d, theme.value, end, d?.timeline.events.length, layersVersion.value]);

  // global keys: ←/→ step the year (Shift = 100), space plays — unless typing somewhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.closest('.slider__track'))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const big = e.shiftKey ? 100 : 10;
      if (e.key === 'ArrowLeft') { setYear(year.value - big); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { setYear(year.value + big); e.preventDefault(); }
      else if (e.key === ' ' && t.tagName !== 'BUTTON' && t.tagName !== 'A') { playing.value = !playing.value; e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // playback
  useEffect(() => {
    if (!playing.value) return;
    let last = performance.now();
    let raf = 0;
    let acc = year.value;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += SPEEDS[speedIdx] * dt;
      if (acc >= end) { setYear(end); playing.value = false; return; }
      if (Math.round(acc) !== year.value) setYear(acc);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing.value, speedIdx, end]);

  const fromPointer = (e: PointerEvent) => {
    const r = trackRef.current!.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setYear(t * end);
  };
  const onDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    playing.value = false;
    fromPointer(e);
  };
  const onMove = (e: PointerEvent) => {
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) fromPointer(e);
  };
  const onKey = (e: KeyboardEvent) => {
    const big = e.shiftKey ? 100 : 10;
    let handled = true;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setYear(year.value - big);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setYear(year.value + big);
    else if (e.key === 'PageUp') setYear(year.value + 100);
    else if (e.key === 'PageDown') setYear(year.value - 100);
    else if (e.key === 'Home') setYear(0);
    else if (e.key === 'End') setYear(end);
    else if (e.key === ' ') playing.value = !playing.value;
    else handled = false;
    if (handled) e.preventDefault();
  };

  const pct = (y / end) * 100;
  return (
    <div class={`slider${compact ? ' slider--compact' : ''}`}>
      <div class="slider__head">
        <button
          class="btn-icon slider__play"
          aria-label={playing.value ? 'Pause' : 'Play through time'}
          onClick={() => { if (year.value >= end) setYear(0); playing.value = !playing.value; }}
        >
          {playing.value ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" /></svg>
          )}
        </button>
        <div class="slider__year" aria-live="off">
          {editing ? (
            <input class="slider__input" type="number" inputMode="numeric" min={0} max={end} defaultValue={String(y)} aria-label="Go to year" autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') { setYear(Number((e.target as HTMLInputElement).value) || 0); setEditing(false); }
                else if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={(e) => { const v = (e.target as HTMLInputElement).value; if (v !== '') setYear(Number(v) || 0); setEditing(false); }} />
          ) : (
            <button class="slider__num" title="Type a year" aria-label={`Year ${y}. Click to type a year`} onClick={() => { playing.value = false; setEditing(true); }}>{y}</button>
          )}
          <span class="slider__unit">{m?.yearLabel ?? 'AY'}</span>
        </div>
        <div class="slider__era">
          <button class="slider__era-name" aria-expanded={eraOpen} aria-label={`${era?.name ?? ''}: about this age`} title={era?.blurb}
            onClick={(e) => { e.stopPropagation(); setEraOpen(!eraOpen); }}>
            {era?.name ?? ''}
          </button>
          {!compact && era && <span class="slider__era-stat" title={era.blurb}>{eraStat(era.blurb)}</span>}
          {eraOpen && era && (
            <div class="erapop" role="dialog" aria-label={era.name} onClick={(e) => e.stopPropagation()}>
              <div class="erapop__k">{era.start}–{era.end} {m?.yearLabel ?? 'AY'}</div>
              <div class="erapop__n">{era.name}</div>
              <p class="erapop__b">{era.blurb}</p>
              <div class="erapop__a">
                <button class="btn btn--ghost" onClick={() => { setYear(era.start); setEraOpen(false); }}>Go to its start</button>
                <a class="btn btn--ghost" href={`#/browse?kind=event&from=${era.start}&to=${era.end}`}>Its events</a>
              </div>
            </div>
          )}
        </div>
        <div class="slider__tools">
          <button class="btn-ghost slider__step" aria-label="Back 100 years" onClick={() => setYear(year.value - 100)}>−100</button>
          <button class="btn-ghost slider__step" aria-label="Forward 100 years" onClick={() => setYear(year.value + 100)}>+100</button>
          <button class="btn-ghost slider__speed" aria-label="Playback speed" title="Playback speed (years per second)" onClick={() => setSpeedIdx((speedIdx + 1) % SPEEDS.length)}>
            {SPEEDS[speedIdx]}<small> yr/s</small>
          </button>
        </div>
      </div>
      <div
        class="slider__track"
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Year"
        aria-valuemin={0}
        aria-valuemax={end}
        aria-valuenow={y}
        aria-valuetext={`${y} ${m?.yearLabel ?? 'AY'}${era ? `, ${era.name}` : ''}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onKeyDown={onKey}
      >
        <canvas ref={canvasRef} class="slider__canvas" aria-hidden="true" />
        <div class="slider__fill" style={{ width: `${pct}%` }} />
        <div class="slider__thumb" style={{ left: `${pct}%` }}>
          <div class="slider__knob" />
        </div>
      </div>
    </div>
  );
}
