// "View in 3D" on an artifact page: a small button; the viewer (and three.js) load only when it is pressed.
// The open viewer is part of the URL (#/p/art:N?3d=1), so it can be shared and the back button closes it.
import { lazy, Suspense } from 'preact/compat';
import type { PageJson } from '../../../../engine/src/export/contract.ts';
import { route, setRouteParam } from '../../state.ts';

const Viewer = lazy(() => import('./Viewer.tsx').then((m) => ({ default: m.Viewer })));
let openedHere = false;

export function View3DButton({ page }: { page: PageJson }) {
  const a = page.artifact;
  // a work known only from quotations in later books has no object to show
  if (page.kind !== 'artifact' || !a || /^Lost\b/.test(a.condition)) return null;
  const open = route.value.params.get('3d') === '1';
  const close = () => {
    if (openedHere && history.length > 1) { openedHere = false; history.back(); } else setRouteParam('3d', null);
  };
  return (
    <>
      <button class="btn btn--ghost" onClick={() => { openedHere = true; setRouteParam('3d', '1'); }} title="A model of the object, built from this record">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
        View in 3D
      </button>
      {open && (
        <Suspense fallback={<div style="position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgb(20 16 12 / 0.55)"><div class="spinner" /></div>}>
          <Viewer page={page} onClose={close} />
        </Suspense>
      )}
    </>
  );
}
