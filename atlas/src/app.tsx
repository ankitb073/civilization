import { lazy, Suspense } from 'preact/compat';
import { useEffect } from 'preact/hooks';
import { route, toggleTheme, theme, year, mapHref } from './state.ts';
import { ensureMeta, loadError, meta } from './store.ts';
import { MapView } from './views/MapView.tsx';
import { SearchBox } from './components/SearchBox.tsx';
import { PageView } from './views/PageView.tsx';
import { CompareView } from './views/CompareView.tsx';
import { BrowseView } from './views/BrowseView.tsx';
import { AboutView } from './views/AboutView.tsx';

const GraphView = lazy(() => import('./views/GraphView.tsx').then((m) => ({ default: m.GraphView })));

const NAV = [
  { view: 'map', label: 'Atlas', href: () => mapHref({}), icon: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14' },
  { view: 'graph', label: 'Graph', href: () => `#/graph?y=${year.value}`, icon: 'M6 6m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M18 8m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M10 18m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M8 7.5l7.5 0.8M7 8.2l2 7.5M16.3 10l-4.6 6' },
  { view: 'browse', label: 'Archive', href: () => '#/browse', icon: 'M4 5h16v4H4zM5 9v10h14V9M10 13h4' },
  { view: 'search', label: 'Search', href: () => '#/search', icon: 'M11 11m-6.5 0a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0M16 16l4.5 4.5', mobileOnly: true },
  { view: 'about', label: 'About', href: () => '#/about', icon: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 11v6M12 7.5v.5' },
];

export function App() {
  useEffect(() => { ensureMeta().catch(() => {}); }, []);
  const r = route.value;
  const m = meta.value;
  useEffect(() => {
    const base = m?.title ?? 'Palimpsest';
    if (r.view === 'map') document.title = `${base} — Atlas`;
    else if (r.view === 'graph') document.title = `${base} — Graph`;
    else if (r.view === 'browse') document.title = `${base} — Archive`;
    else if (r.view === 'about') document.title = `${base} — About`;
  }, [r.view, m]);
  useEffect(() => { if (r.view !== 'map' && r.view !== 'graph') window.scrollTo(0, 0); }, [r.view, r.id]);

  const active = r.view === 'page' || r.view === 'compare' ? 'browse' : r.view;
  const clean = r.params.get('clean') === '1';
  const og = r.params.get('og') === '1';
  return (
    <div class={`app app--${r.view}${clean || og ? ' is-clean' : ''}${og ? ' is-og' : ''}`}>
      <a class="skip" href="#main">Skip to content</a>
      <header class="topbar">
        <a class="brand" href={mapHref({})} aria-label={`${m?.title ?? 'Palimpsest'} — home`}>
          <span class="wordmark">{m?.title ?? 'Palimpsest'}</span>
          {m && <span class="brand__world">The archive of {m.worldName}</span>}
        </a>
        <nav class="topnav" aria-label="Primary">
          {NAV.filter((n) => !n.mobileOnly).map((n) => (
            <a class={`topnav__a${active === n.view ? ' is-on' : ''}`} href={n.href()} aria-current={active === n.view ? 'page' : undefined}>{n.label}</a>
          ))}
        </nav>
        <div class="topbar__search"><SearchBox /></div>
        <button class="btn-icon theme-toggle" onClick={toggleTheme} aria-label={theme.value === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          {theme.value === 'dark' ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
          )}
        </button>
      </header>
      <main id="main" class="main">
        {loadError.value && r.view !== 'about' && <div class="banner">Couldn’t load the archive data ({loadError.value}). Try reloading.</div>}
        {r.view === 'map' && <MapView />}
        {r.view === 'graph' && (
          <Suspense fallback={<div class="center-load"><div class="spinner" /> Loading the graph…</div>}>
            <GraphView />
          </Suspense>
        )}
        {r.view === 'page' && r.id && <PageView id={r.id} />}
        {r.view === 'compare' && r.id && <CompareView id={r.id} />}
        {r.view === 'browse' && <BrowseView />}
        {r.view === 'about' && <AboutView />}
        {r.view === 'search' && (
          <div class="searchpage">
            <h1 class="h-page">Search the archive</h1>
            <SearchBox autoFocus full />
          </div>
        )}
      </main>
      <nav class="tabbar" aria-label="Sections">
        {NAV.map((n) => (
          <a class={`tabbar__a${active === n.view ? ' is-on' : ''}`} href={n.href()} aria-current={active === n.view ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={n.icon} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <span>{n.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
