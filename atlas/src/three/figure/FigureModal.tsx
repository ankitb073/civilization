// A piece on a turntable, in a dialog: drag to turn it, the notes say why it looks as it does.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { reducedMotion, isMobile, theme } from '../../state.ts';
import { sigilBlazon } from '../../heraldry.ts';
import { buildFigure } from './build.ts';
import { figureNotes, figureSpec, lifeLine, roleLine, type FigureSource } from './spec.ts';
import { portrait, Turntable } from './stage.ts';
import './figure.css';

export function FigureModal({ source, year, onClose }: { source: FigureSource; year?: number; onClose: () => void }) {
  const spec = useMemo(() => figureSpec(source, { year }), [source.id, year]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const ttRef = useRef<Turntable | null>(null);
  const [turning, setTurning] = useState(!reducedMotion);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!spec || !canvasRef.current) return;
    let tt: Turntable;
    try {
      tt = new Turntable(canvasRef.current, { theme: theme.peek(), reducedMotion, mobile: isMobile.peek() });
      tt.setFigure(buildFigure(spec));
      tt.resize();
      tt.start();
    } catch (e) {
      setFailed(String((e as Error)?.message ?? e));
      return;
    }
    ttRef.current = tt;
    (window as unknown as { __figureTurntable?: Turntable }).__figureTurntable = tt;
    const ro = new ResizeObserver(() => tt.resize());
    ro.observe(canvasRef.current.parentElement!);
    return () => { ro.disconnect(); tt.dispose(); ttRef.current = null; delete (window as unknown as { __figureTurntable?: Turntable }).__figureTurntable; };
  }, [spec]);

  useEffect(() => {
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  }, []);

  if (!spec) return null;
  const notes = figureNotes(spec, sigilBlazon(spec.sigil));
  const save = async () => {
    const url = await portrait(spec, 1024);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${spec.id.replace(':', '-')}-${spec.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.png`;
    a.click();
  };
  return (
    <div class="figm" role="dialog" aria-modal="true" aria-label={`${spec.name} as a figure`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="figm__box">
        <div class="figm__stage">
          {failed ? <p class="figm__fail">This browser could not draw the piece ({failed}).</p> : <canvas ref={canvasRef} class="figm__canvas" aria-label={`A painted figure of ${spec.name}; drag to turn it`} />}
          <div class="figm__hint">{reducedMotion ? 'Drag to turn' : 'Drag to turn · scroll to zoom'}</div>
        </div>
        <div class="figm__side">
          <button ref={closeRef} class="btn-icon btn-icon--sm figm__x" type="button" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          </button>
          <div class="eyebrow">A figure from the record</div>
          <h2 class="figm__name">{spec.name}</h2>
          <div class="figm__role">{roleLine(spec)}</div>
          <div class="figm__life">{lifeLine(spec)}{spec.death && spec.death !== 'natural' ? ` · ${spec.death === 'battle' ? 'fell in battle' : spec.death}` : ''}</div>
          <ul class="figm__notes">{notes.map((n) => <li>{n}</li>)}</ul>
          <div class="figm__actions">
            {!reducedMotion && <button class="btn btn--ghost" type="button" onClick={() => { const on = !turning; setTurning(on); ttRef.current?.setAutoRotate(on); }}>{turning ? 'Stop turning' : 'Turn'}</button>}
            <button class="btn btn--ghost" type="button" onClick={save}>Save as PNG</button>
            <a class="btn btn--ghost" href={`#/figures?sel=${encodeURIComponent(spec.id)}`} onClick={onClose}>All figures</a>
          </div>
          <p class="figm__small">Nothing here is invented: the piece is cut from this page’s record. No faces — a turned head of bare wood, like the pieces of an old board game.</p>
        </div>
      </div>
    </div>
  );
}
