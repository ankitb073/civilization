// "View as a figure" on a person's page: a small button that loads three.js and the figure maker only when pressed.
// #/p/per:N?figure=1 opens it straight away (a shareable link to the piece).
import { lazy, Suspense } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import type { PageJson } from '../../../../engine/src/export/contract.ts';
import { route } from '../../state.ts';

const FigureModal = lazy(() => import('./FigureModal.tsx').then((m) => ({ default: m.FigureModal })));

export function FigureButton({ page }: { page: PageJson }) {
  const [open, setOpen] = useState(() => route.peek().params.get('figure') === '1');
  useEffect(() => { setOpen(route.peek().params.get('figure') === '1'); }, [page.id]);
  if (page.kind !== 'person') return null;
  return (
    <>
      <button class="btn btn--ghost" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 3.5a2.6 2.6 0 1 1 0 5.2a2.6 2.6 0 1 1 0-5.2zM8.6 20l1-7.6-2.1.4.9-3.3h7.2l.9 3.3-2.1-.4 1 7.6M5 20.5h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" /></svg>
        View as a figure
      </button>
      {open && (
        <Suspense fallback={<div class="figm figm--loading" role="status"><div class="spinner" /> Carving the piece…</div>}>
          <FigureModal source={page} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
