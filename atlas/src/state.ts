import { signal, effect, computed } from '@preact/signals';

export type View = 'map' | 'graph' | 'page' | 'compare' | 'browse' | 'about' | 'search' | 'story' | 'histomap' | 'languages' | 'prices' | 'collections' | 'dynasties' | 'year' | 'today' | 'words' | 'game';
export type LayerName = 'political' | 'culture' | 'religion' | 'language';

export interface Route {
  view: View;
  id: string | null;
  params: URLSearchParams;
}

function parseHash(): Route {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [path, query = ''] = h.split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  const head = parts[0] ?? 'map';
  if (head === 'p' && parts[1]) return { view: 'page', id: parts.slice(1).join('/'), params };
  if (head === 'compare' && parts[1]) return { view: 'compare', id: parts.slice(1).join('/'), params };
  if (head === 'collections') return { view: 'collections', id: parts[1] ?? null, params };
  if (head === 'year' && parts[1]) return { view: 'year', id: parts[1], params };
  if (head === 'today') return { view: 'today', id: parts[1] ?? null, params };
  if (head === 'words') return { view: 'words', id: parts[1] ?? null, params };
  if (head === 'game') return { view: 'game', id: null, params };
  if (head === 'dynasties') return { view: 'dynasties', id: null, params };
  if (head === 'dynasty' && parts[1]) return { view: 'dynasties', id: parts.slice(1).join('/'), params };
  if (head === 'graph' || head === 'browse' || head === 'about' || head === 'search' || head === 'story' || head === 'histomap' || head === 'languages' || head === 'prices') return { view: head, id: null, params };
  return { view: 'map', id: null, params };
}

export const route = signal<Route>(parseHash());

// --- shared exploration state (persisted in the URL for map/graph)
const init = route.value.params;
const clampYear = (y: number) => Math.max(0, Math.min(5000, Math.round(y)));
export const year = signal<number>(init.has('y') ? clampYear(Number(init.get('y'))) : 1200);
export const layer = signal<LayerName>((['political', 'culture', 'religion', 'language'].includes(init.get('l') ?? '') ? init.get('l') : 'political') as LayerName);
export const selection = signal<string | null>(init.get('sel'));
export const playing = signal(false);
export const yearEnd = signal(5000);
export const showRoutes = signal(init.get('routes') === '1');

export function setYear(y: number) {
  year.value = Math.max(0, Math.min(yearEnd.value, Math.round(y)));
}

// --- theme
type Theme = 'light' | 'dark' | 'auto';
function readTheme(): Theme {
  try {
    const t = localStorage.getItem('pal-theme');
    if (t === 'light' || t === 'dark') return t;
  } catch { /* storage blocked */ }
  return 'auto';
}
export const themePref = signal<Theme>(readTheme());
const mql = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
const systemDark = signal(!!mql?.matches);
mql?.addEventListener('change', (e) => { systemDark.value = e.matches; });
export const theme = computed<'light' | 'dark'>(() => (themePref.value === 'auto' ? (systemDark.value ? 'dark' : 'light') : themePref.value));
effect(() => {
  const t = themePref.value;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  try {
    if (t === 'auto') localStorage.removeItem('pal-theme');
    else localStorage.setItem('pal-theme', t);
  } catch { /* storage blocked */ }
});
export function toggleTheme() {
  themePref.value = theme.value === 'dark' ? 'light' : 'dark';
}

// --- navigation
window.addEventListener('hashchange', () => {
  const r = parseHash();
  route.value = r;
  if (r.view === 'map' || r.view === 'graph') {
    if (r.params.has('y')) year.value = clampYear(Number(r.params.get('y')));
    const l = r.params.get('l');
    if (l === 'political' || l === 'culture' || l === 'religion' || l === 'language') layer.value = l;
    if (r.params.has('sel')) selection.value = r.params.get('sel');
  }
});

export function navigate(hash: string) {
  if (!hash.startsWith('#')) hash = '#' + hash;
  if (location.hash === hash) return;
  location.hash = hash;
}

export function pageHref(id: string): string {
  return `#/p/${id}`;
}
export function mapHref(opts: { y?: number; sel?: string | null; l?: LayerName } = {}): string {
  const p = new URLSearchParams();
  p.set('y', String(Math.round(opts.y ?? year.value)));
  if (opts.l ?? layer.value) p.set('l', opts.l ?? layer.value);
  const sel = opts.sel === undefined ? selection.value : opts.sel;
  if (sel) p.set('sel', sel);
  return `#/map?${p.toString()}`;
}

// Keep the URL in sync with map/graph state without spamming history.
let syncTimer = 0;
effect(() => {
  const r = route.value;
  const y = year.value;
  const l = layer.value;
  const sel = selection.value;
  const routes = showRoutes.value;
  if (r.view !== 'map' && r.view !== 'graph') return;
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    const p = new URLSearchParams(r.params);
    p.set('y', String(y));
    if (r.view === 'map') {
      p.set('l', l);
      if (routes) p.set('routes', '1'); else p.delete('routes');
    }
    if (sel) p.set('sel', sel); else p.delete('sel');
    const next = `#/${r.view}?${p.toString()}`;
    if (location.hash !== next) {
      history.replaceState(null, '', next);
    }
  }, 180);
});

export function setRouteParam(key: string, value: string | null) {
  const r = route.value;
  const p = new URLSearchParams(r.params);
  if (value === null) p.delete(key); else p.set(key, value);
  const base = r.view === 'page' ? `#/p/${r.id}` : r.view === 'compare' ? `#/compare/${r.id}` : `#/${r.view}`;
  const q = p.toString();
  navigate(q ? `${base}?${q}` : base);
}

export const isMobile = signal(typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767px)').matches);
if (typeof matchMedia !== 'undefined') {
  matchMedia('(max-width: 767px)').addEventListener('change', (e) => { isMobile.value = e.matches; });
}

/** Desktop side panel collapsed (shared so the map can re-centre around it). */
export const panelCollapsed = signal(false);
export const PANEL_W = 384;
export const SHEET_PEEK = 72;

export const sheetSnap = signal<'peek' | 'half' | 'full'>('peek');

/** True when the visitor arrived without a year in the URL (a fresh landing, not a shared permalink). */
export const freshLanding = !/[?&]y=/.test(location.hash) && !/^#\/(p|compare|browse|about|search|graph|story|histomap|languages|prices|collections|dynast|year|today|words)/.test(location.hash);
export const reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
