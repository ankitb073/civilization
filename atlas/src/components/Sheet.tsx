import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { isMobile, panelCollapsed, selection, sheetSnap } from '../state.ts';

type Snap = 'peek' | 'half' | 'full';
const ORDER: Snap[] = ['peek', 'half', 'full'];

/** Desktop: floating side panel. Mobile: draggable bottom sheet. */
export function Sheet({ children }: { children: ComponentChildren }) {
  const snap = sheetSnap.value;
  const setSnap = (v: Snap | ((s: Snap) => Snap)) => { sheetSnap.value = typeof v === 'function' ? v(sheetSnap.peek()) : v; };
  const [drag, setDrag] = useState(0);
  const start = useRef<{ y: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (selection.value) { setSnap((s) => (s === 'peek' ? 'half' : s)); panelCollapsed.value = false; }
  }, [selection.value]);

  const collapsed = panelCollapsed.value;
  const setCollapsed = (v: boolean) => { panelCollapsed.value = v; };
  if (!isMobile.value) {
    return (
      <aside class={`panel${collapsed ? ' is-collapsed' : ''}`} aria-label="Details">
        <button class="panel__toggle btn-icon" aria-label={collapsed ? 'Show panel' : 'Hide panel'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d={collapsed ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        {!collapsed && <div class="panel__body">{children}</div>}
      </aside>
    );
  }

  const onDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { y: e.clientY, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    if (!start.current) return;
    const dy = e.clientY - start.current.y;
    if (Math.abs(dy) > 4) start.current.moved = true;
    setDrag(dy);
  };
  const onUp = () => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const i = ORDER.indexOf(snap);
    if (!s.moved) setSnap(ORDER[(i + 1) % ORDER.length]);
    else if (drag < -40) setSnap(ORDER[Math.min(2, i + 1 + (drag < -260 ? 1 : 0))]);
    else if (drag > 40) setSnap(ORDER[Math.max(0, i - 1 - (drag > 260 ? 1 : 0))]);
    setDrag(0);
  };

  return (
    <section class={`sheet sheet--${snap}${drag ? ' is-dragging' : ''}`} style={drag ? { '--drag': `${drag}px` } : undefined} aria-label="Details">
      <div class="sheet__grip" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role="button" aria-label="Resize panel" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSnap(ORDER[(ORDER.indexOf(snap) + 1) % 3]); } }}>
        <span class="sheet__handle" />
      </div>
      <div class="sheet__body">{children}</div>
    </section>
  );
}
