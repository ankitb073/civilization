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
const StoryView = lazy(() => import('./views/StoryView.tsx').then((m) => ({ default: m.StoryView })));
const HistomapView = lazy(() => import('./views/HistomapView.tsx').then((m) => ({ default: m.HistomapView })));
const LanguagesView = lazy(() => import('./views/LanguagesView.tsx').then((m) => ({ default: m.LanguagesView })));
const CollectionsView = lazy(() => import('./views/CollectionsView.tsx').then((m) => ({ default: m.CollectionsView })));
const DynastiesView = lazy(() => import('./views/DynastyView.tsx').then((m) => ({ default: m.DynastiesView })));
const YearView = lazy(() => import('./views/YearView.tsx').then((m) => ({ default: m.YearView })));
const PricesView = lazy(() => import('./views/PricesView.tsx').then((m) => ({ default: m.PricesView })));
const TodayRedirect = lazy(() => import('./components/Reading.tsx').then((m) => ({ default: m.TodayRedirect })));

const NAV = [
  { view: 'map', label: 'Atlas', href: () => mapHref({}), icon: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14' },
  { view: 'story', label: 'Story', href: () => '#/story', icon: 'M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM17 7h2v13M8 9h6M8 13h6' },
  { view: 'histomap', label: 'Histomap', href: () => '#/histomap', icon: 'M5 3c2 4 0 7 2 11s-1 5 0 7M10 3c-1 4 2 6 1 10s1 5 0 8M15 3c1 3-2 6 0 10s-1 5 1 8M19 3c-1 4 1 8 0 12s1 4 0 6' },
  { view: 'languages', label: 'Languages', href: () => '#/languages', icon: 'M4 12h5M9 12c3 0 3-6 7-6h4M9 12c3 0 3 6 7 6h4M14 6h0', desktopOnly: true },
  { view: 'graph', label: 'Graph', href: () => `#/graph?y=${year.value}`, icon: 'M6 6m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M18 8m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M10 18m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M8 7.5l7.5 0.8M7 8.2l2 7.5M16.3 10l-4.6 6' },
  { view: 'browse', label: 'Archive', href: () => '#/browse', icon: 'M4 5h16v4H4zM5 9v10h14V9M10 13h4' },
  { view: 'search', label: 'Search', href: () => '#/search', icon: 'M11 11m-6.5 0a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0M16 16l4.5 4.5', mobileOnly: true },
  { view: 'about', label: 'About', href: () => '#/about', icon: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 11v6M12 7.5v.5', desktopOnly: true },
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
    else if (r.view === 'story') document.title = `${base} — The story`;
  }, [r.view, m]);
  useEffect(() => { if (r.view !== 'map' && r.view !== 'graph') window.scrollTo(0, 0); }, [r.view, r.id]);

  const active = r.view === 'page' || r.view === 'compare' || r.view === 'collections' || r.view === 'dynasties' ? 'browse' : r.view === 'prices' ? 'about' : r.view === 'year' ? 'map' : r.view;
  const tabActive = active === 'languages' || r.view === 'prices' ? 'browse' : active;
  const clean = r.params.get('clean') === '1';
  const og = r.params.get('og') === '1' || r.params.get('frames') === '1';
  return (
    <div class={`app app--${r.view}${clean || og ? ' is-clean' : ''}${og ? ' is-og' : ''}${r.params.get('export') === '1' ? ' is-export' : ''}`}>
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
        <a class="btn-icon about-icon" href="#/about" aria-label="About this archive">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 11v6M12 7.5v.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        </a>
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
        {r.view === 'story' && (
          <Suspense fallback={<div class="center-load"><div class="spinner" /> Opening the story…</div>}>
            <StoryView />
          </Suspense>
        )}
        {r.view === 'histomap' && (
          <Suspense fallback={<div class="center-load"><div class="spinner" /> Drawing the streams…</div>}>
            <HistomapView />
          </Suspense>
        )}
        {r.view === 'languages' && (
          <Suspense fallback={<div class="center-load"><div class="spinner" /> Gathering the tongues…</div>}>
            <LanguagesView />
          </Suspense>
        )}
        {r.view === 'prices' && (
          <Suspense fallback={<div class="center-load"><div class="spinner" /> Opening the ledgers…</div>}>
            <PricesView />
          </Suspense>
        )}
        {r.view === 'collections' && (
          <Suspense fallback={<div class="center-load"><div class="spinner" /> Opening the cabinets…</div>}>
            <CollectionsView id={r.id} />
          </Suspense>
        )}
        {r.view === 'dynasties' && (
          <Suspense fallback={<div class="center-load"><div class="spinner" /> Unrolling the pedigrees…</div>}>
            <DynastiesView id={r.id} />
          </Suspense>
        )}
        {r.view === 'year' && r.id && (
          <Suspense fallback={<div class="center-load"><div class="spinner" /> Turning to the year…</div>}>
            <YearView y={r.id} />
          </Suspense>
        )}
        {r.view === 'today' && <Suspense fallback={null}><TodayRedirect date={r.id} /></Suspense>}
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
        {NAV.filter((n) => !n.desktopOnly).map((n) => (
          <a class={`tabbar__a${tabActive === n.view ? ' is-on' : ''}`} href={n.href()} aria-current={tabActive === n.view ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={n.icon} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <span>{n.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
