// The turntable viewer: one archive object in 3D, built from its page. Opened from an artifact page ("View in 3D",
// #/p/art:N?3d=1) and from the Museum. Lazy: three.js and the model builders load with this chunk only.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PageJson } from '../../../../engine/src/export/contract.ts';
import { isMobile, reducedMotion, theme } from '../../state.ts';
import { buildObject } from './models.ts';
import { provenanceNote, sizeLabel, specOf, type ObjectSpec, type SpecExtras } from './record.ts';
import { ensureFonts } from './paint.ts';
import { eraStarts, extrasFor, imagesFor } from './load.ts';
import { Turntable } from './stage.ts';
import './museum.css';

const VERB: Record<string, string> = {
  stele: 'Cutting the stone…', rock: 'Cutting the rock…', slab: 'Cutting the stone…', brick: 'Firing the brick…', foundation: 'Cutting the stone…',
  plaster: 'Plastering the wall…', plaque: 'Casting the bronze…', tablet: 'Pressing the clay…', tablets: 'Pressing the clay…', envelope: 'Pressing the clay…',
  wax: 'Warming the wax…', sherd: 'Breaking the pot…', coin: 'Striking the coin…', scroll: 'Unrolling the papyrus…', charter: 'Sealing the charter…',
  codex: 'Binding the book…', sheet: 'Setting the type…', newspaper: 'Setting the type…', telegram: 'Tapping the wire…',
};

export interface ViewerProps { page: PageJson; extras?: SpecExtras; why?: string; onClose: () => void }

export function Viewer({ page, extras, why, onClose }: ViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tt = useRef<Turntable | null>(null);
  const [spec, setSpec] = useState<ObjectSpec | null>(() => specOf(page, { ...(extras ?? {}), eraStarts: eraStarts() }));
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [rake, setRake] = useState(false);
  const [spin, setSpin] = useState(!reducedMotion);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const back = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) setRake((x) => !x);
    };
    window.addEventListener('keydown', key);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', key); back?.focus?.({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    let live = true;
    let stage: Turntable;
    try {
      stage = new Turntable(canvasRef.current!, { theme: theme.peek(), reducedMotion, mobile: isMobile.peek() });
    } catch {
      setStatus('failed');
      return;
    }
    tt.current = stage;
    (window as unknown as { __museumViewer?: Turntable }).__museumViewer = stage;
    stage.resize();
    stage.start();
    const ro = new ResizeObserver(() => stage.resize());
    ro.observe(canvasRef.current!.parentElement!);
    (async () => {
      const ex = extras ?? await extrasFor(page);
      if (!live) return;
      const s = specOf(page, { ...ex, eraStarts: eraStarts() });
      setSpec(s);
      await ensureFonts();
      const imgs = await imagesFor(s);
      if (!live) return;
      // let the spinner paint before the (synchronous) carving
      await new Promise((r) => setTimeout(r, 30));
      const t0 = performance.now();
      // phones: 60% of the desktop texture size (sharp at their pixel density, ~2.5× quicker to carve)
      const built = buildObject(s, imgs, { detail: 'high', scale: isMobile.peek() ? 0.6 : 1, anisotropy: stage.renderer.capabilities.getMaxAnisotropy() });
      (stage as unknown as { buildMs: number }).buildMs = performance.now() - t0;
      if (!live) { return; }
      stage.setObject(built);
      setStatus('ready');
    })().catch((e) => { console.error(e); if (live) setStatus('failed'); });
    return () => { live = false; ro.disconnect(); stage.dispose(); tt.current = null; };
  }, [page.id]);

  useEffect(() => { tt.current?.setTheme(theme.value); }, [theme.value]);
  useEffect(() => { tt.current?.setRaking(rake); }, [rake]);
  useEffect(() => { tt.current?.setSpin(spin); }, [spin]);

  const a = page.artifact!;
  return (
    <div class="mv" role="dialog" aria-modal="true" aria-label={`${page.title}, in 3D`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="mv__panel">
        <header class="mv__head">
          <div class="mv__heading">
            <div class="mv__kick"><span class="mono">{a.catalog}</span> · {a.medium}{spec ? <> · {sizeLabel(spec)}</> : null}</div>
            <h2 class="mv__title">{page.title}</h2>
          </div>
          <button ref={closeRef} class="mv__x" onClick={onClose} aria-label="Close the 3D view">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          </button>
        </header>
        <div class={`mv__stage${rake ? ' is-raking' : ''}`}>
          <canvas ref={canvasRef} class="mv__canvas" tabIndex={0} aria-label={`A model of ${page.title}: drag to turn it, pinch or scroll to zoom`} />
          {status === 'loading' && <div class="mv__load"><div class="spinner" /> {spec ? VERB[spec.family] ?? 'Building…' : 'Building…'}</div>}
          {status === 'failed' && <div class="mv__load">This browser could not draw the model.</div>}
        </div>
        <footer class="mv__bar">
          <div class="mv__tools" role="group" aria-label="View">
            <button class={`mv__tool${rake ? ' is-on' : ''}`} aria-pressed={rake} onClick={() => setRake(!rake)} title="Light the surface from a low angle, so carved and stamped text stands out (R)">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 18h18M5 14l4-2 4 1 6-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /><circle cx="4" cy="7" r="2" fill="currentColor" /></svg>
              Raking light
            </button>
            <button class={`mv__tool${spin ? ' is-on' : ''}`} aria-pressed={spin} onClick={() => setSpin(!spin)}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 12a8 4 0 1 0 8-4M12 5l2 3-3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
              Turn
            </button>
            <button class="mv__tool" onClick={() => tt.current?.frame()}>Front</button>
          </div>
          <p class="mv__note">
            {why && <strong>{why} </strong>}
            <span>{a.condition}</span> {spec && <span class="muted">{provenanceNote(spec)}</span>}
          </p>
        </footer>
      </div>
    </div>
  );
}
