# LLD: Atlas (`atlas/`)

A static web app (Vite, TypeScript, Preact) that reads the files defined in `engine/src/export/contract.ts` from `atlas/public/data/`. It is deployed to GitHub Pages under `/civilization/`, so every fetch uses `import.meta.env.BASE_URL`.

## Views and routes (hash router, shareable permalinks)

| Route | View |
|---|---|
| `#/` or `#/map?y=2310&l=political&sel=pol:12` | Map + time slider (home) |
| `#/graph?y=2310&focus=evt:12&k=polity,event` | Force-directed graph |
| `#/p/<id>` | Page reader (entity or artifact); `#/p/lan:N?sc=<year>&law=<label>` opens a language page at one dated sound law |
| `#/compare/<eventId>` | Rival accounts vs. ground truth |
| `#/browse?kind=artifact&sub=treaty&from=1000&to=2000` | Filterable index |
| `#/about` | Method, consistency report, downloads, credits |
| `#/story?at=c2b3` | The story: one chapter per era, a few beats each |
| `#/histomap` | Every polity as a stream over 5,000 years |
| `#/languages` | The Tree of Tongues |
| `#/words`, `#/words/<concept>?y=2112&l=lan:6` | The Word Machine (one word in every language) |
| `#/prices` | Prices and currencies over five millennia |
| `#/collections[/<id>]` | Curated lists; `#/collections/history` is the History's contents |
| `#/dynasties`, `#/dynasty/<id>` | Family trees of ruling houses |
| `#/year/<y>` | One year in detail |
| `#/today[/YYYY-MM-DD]` | Redirects to the document of the day |

Global state lives in the URL: year, layer, selection. A global search box in the top bar (lazy-loads `search.json`) works everywhere; typing "AY 2310" offers the year view.

Every view except the map, reader, compare, browse and about is a lazy chunk (`lazy()` in `app.tsx`), and so is its CSS when the view imports its own stylesheet (the Word Machine does). The top nav has room for seven items; newer views are reached from the "explore" rows on Browse (the phone's way in) and About, and from related views.

## Map

- Cells are rebuilt from `world.points` with d3-delaunay and drawn on Canvas 2D:
  - a base terrain layer (biome color shaded by elevation, water with depth tint), cached to an offscreen canvas;
  - a layer fill (political, culture or religion) at the current year, semi-transparent over the terrain;
  - borders, drawn as edges between cells with different owners;
  - coastlines;
  - rivers (smoothed polylines);
  - settlements (dots sized by population, capitals marked);
  - labels for polities (at the centroid of their largest component, sized by area, collision-culled) and for settlements at higher zoom.
- Pan and zoom by wheel, drag and pinch. The layer rebuild is cached per year.
- Time state: reconstruct cell ownership for year Y from keyframe ⌊Y/100⌋ plus the deltas. The play button animates about 50 years/s, with speed control.
- Clicking or tapping a cell opens a side panel (a bottom sheet on mobile). It shows:
  - the polity at that year (name, ruler if known, gov), linked;
  - the region, culture and religion;
  - nearby events within ±25 years;
  - links into pages.
- Overlays: event markers in the window [Y−50, Y], filtered by significance at low zoom, with icons per sub-type; trade routes for the century; a climate badge.

## Time slider

The slider is fixed to the bottom of the map and covers 0–5000 AY. It has:
- era bands (from `meta.eras`) behind the track;
- an event-density sparkline;
- a temperature anomaly line;
- arrow-key stepping (±10, Shift ±100).

The year readout is large and tabular-numeral. The era name shows beside it.

## Graph

- Sigma.js (WebGL) and graphology with precomputed ForceAtlas2 positions from `graph.json`. Nodes are colored by kind and sized by `size`.
- The time filter shows nodes with `t0 ≤ Y` (and dims those with `t1 < Y`).
- Kind toggles, a "live physics" button (FA2 web worker) and search-to-focus.
- Clicking a node highlights its neighborhood and shows the page card.
- The ego mode (`focus=`) shows a 2-hop subgraph with a live d3-force layout.

## Reader

The renderer draws `PageJson.body` (Markdown) with `[[id|text]]` turned into internal links, plus an infobox, a names-through-time table, sparklines (`series`) and a backlinks list grouped by kind. Artifact pages get period styling by `sub`:

- **Inscription:** a stele-like card with transliteration, normalized text, an interlinear gloss table (token columns that wrap) and the translation.
- **Ledger:** a ruled table.
- **Treaty:** numbered articles.
- **Newspaper:** columns.
- **Telegram:** monospace caps.

"View on map" jumps to `cell` at `t0`. Each artifact shows its catalog number, provenance and translator.

## Year view (`#/year/<y>`)

A page for one year, reached from every date in the reader (`YearLink`), from the time slider's "AY y in detail" link and from search. It shows:
- previous/next navigation (±10 and ±100 years; the arrow keys do the same, Shift for ±100);
- a mini-map of the political layer at that year, with the share of land claimed, the grain price and price level (`economy.json`) and the climate anomaly;
- the great powers by territory, with capital, ruling house and ruler (`dynasties.json`);
- the decade's events (±5 years) and the documents written within ±2 years, flagships first.

**Mini-map** (`components/MiniMap.tsx`): a static Canvas 2D render of the political layer at a year, reusing the map's geometry (`geo.ts`). Land is cached as one Path2D per world. With `highlight`, only that polity is coloured and outlined, and neighbours are shaded faintly; `box` frames a region. It is reused by the polity page's **Territory** panel, which frames the polity at its peak and plays through its lifespan.

## Cite

Artifact pages carry a Cite button (`components/Cite.tsx`) that opens a panel with a plain citation and a BibTeX entry, each with Copy. Both use the canonical site URL, the catalogue number, the date, the author and the translator; names have their "(translator, AY …)" disambiguators removed.

## First visit: tour and explainer

A fresh landing (no year in the URL) plays a 9-second flight from AY 0 to 4990 with era titles (`components/Tour.tsx`); any pointer, wheel or key interrupts it, and it is skipped under reduced motion. Afterwards, once per browser (`localStorage` `pal-explained`), a small "What is this?" card offers three ways in: read the History (or the story), compare a war told twice, or open a document at random. Escape or the close button dismisses it.

## Books and Today in the archive

- **The History as a book.** Pages in an ordered collection (`history`, then `lives`, then `voices`) get previous/next navigation at the top and bottom (`book.ts`, `BookNav`). Long documents (a chapter, or 1,500+ words) read in one 700 px column with a reading-time estimate (words / 230) and a contents list from their `##` headings.
- **Reading progress** through the History stays in this browser (`localStorage` `pal-reading`): opening a chapter records it, and reaching its end marks it read. The landing panel's History card says "Start reading" or "Continue reading: Chapter N — title", with a progress bar.
- **Today in the archive.** One flagship a day, picked by hashing the viewer's local date, so everyone sees the same one on the same date. The landing panel shows its title, date and first line; its page shard is fetched only when the card scrolls into view. `#/today` is a bookmarkable redirect to it.
- The EPUB ("The Reader") is offered on About, on the History's contents page and after its last chapter.

## Genre layouts

Each artifact gets a period style from its `sub` (`docStyle` in `PageView.tsx`). Where Markdown alone can't express the form, `genres.ts` reshapes the rendered HTML and `styles/genres.css` styles it:
- **omen collections:** a clay tablet with sign / outcome / precedent columns;
- **itineraries (periplus):** stages along a route line, sea or land;
- **customs tariffs:** a posted schedule, with free goods marked.

CSS alone handles glossaries (two-column word tables), muster rolls and harbour registers (tallies), wills, school exercises (red-ink corrections), graffiti, almanacs (a twelve-month grid) and lawsuits (a case record). Every transform falls back to the plain rendering when a line doesn't have the expected shape, because lacunae can eat the punctuation it relies on.

## The Word Machine (`#/words`)

One word in all 126 languages, scrubbed through 8,200 years (`views/WordsView.tsx`, `words.ts`, `styles/words.css`).

**Data.** `words/index.json` (`WordsIndexJson`) lists 114 concepts, core and culture, each with today's form in the editorial language. `words/<concept>.json` (`WordJson`, about 3 to 6 KB gzipped) gives each language its own stretch of the word's history as steps `[year, form, ipa, change]`. The first step is the form inherited at birth (change null; `proto` for a family root); after that come the changes, each labelled by its sound law or `replaced` (a borrowing). Names, parents, families and life spans come from `languages.json`. The view chunk, its CSS and each word file load lazily.

**Derivation.** The form of a word in language L at year Y is the last step at or before Y, taken from L's own steps once L is born (binary search, `stepAt`). The full derivation (`derivation()`) walks root → … → parent → L, taking each ancestor's steps before the next language split off, and tags each link:
- `proto`: the reconstructed root (shown with an asterisk);
- `law`: a dated sound law;
- `replaced`: the word swapped for a borrowing;
- `split`: the daughter inherits the form unchanged;
- `respelled`: the daughter inherits it in its own spelling (same IPA);
- `swapped`: the daughter carried a different word from its birth.

About 7% of splits are respellings and 1.7% are different words.

**Picker** (`#/words`): a searchable grid of cards in two groups, core vocabulary and culture words, each showing the English gloss and today's form. The filter folds diacritics and matches either; Enter opens the first match.

**Machine** (`#/words/<concept>`):
- **Header:** the gloss, today's form, how many sound changes and borrowings this word went through, the six family roots as buttons (each selects its proto-language), and a word switcher. The switcher keeps the year and language, so you can compare words.
- **Sticky scrubber:** play/pause, the year with its era, and a range from −3200 to 5000 over a histogram of when this word changed (100-year bins, every language). The chosen language's changes are marked in accent on the histogram. Arrow keys move ±10 years, Shift ±100. Play runs the whole span in about 14 s on `requestAnimationFrame` and holds 60 fps (measured by `npm run shoot -- --only=perf`).
- **Tree (desktop):** the Tree of Tongues layout (`tongueLayout.ts`, shared with `LanguagesView`), with:
  - a year cursor;
  - lines drawn twice: a faint layer, and a full-colour layer clipped to the left of the cursor, so time passing only resizes one clip rectangle;
  - unborn languages faint, dead ones dimmed;
  - a tick for each sound law and a ring for each borrowing;
  - beside the cursor, each living language's form at that year, plus its name; a dead language keeps its last form at its death; at AY 5000 every language shows the form at its end;
  - each family label carries its root form.

  The static layers (frame, rows, hit targets) are `memo` components, so a play frame re-renders only the labels, the cursor and the clip. Hover or selection lights the language's ancestry. The tree is one keyboard stop: Up/Down choose a language, Left/Right move the year, Escape clears.
- **List:** on phones (below 768 px) the tree becomes an indented list, one section per family with its root. Each language is a 44 px button with its form at the year, dimmed when unborn or dead. On desktop the same list is the "as a list" alternative; it is rendered only while open.
- **Derivation panel:** a sticky side panel at 1100 px and wider, a bottom sheet below that. It shows:
  - the language, its family, parent and life span;
  - its form at the cursor year (or what its ancestor said before it was born, or its last form after it died);
  - the derivation in one line (`*kikweka → 'ikwe'a → … → yiv`), with later forms faded and the current one highlighted;
  - the steps grouped by language, each with its year, form and IPA. Each sound law links to the language page where it happened (`#/p/<lan>?sc=<year>&law=<label>`), which opens the full list scrolled to that law and highlights it. Borrowings are marked "replaced by a borrowing".

  Before a language is chosen, the panel explains the chart and lists the six roots and the most-changed living languages.
- **Shareable:** the URL carries concept, year and language (`#/words/water?y=2112&l=lan:6`). It is written with `history.replaceState`, debounced so scrubbing and playing add no history entries, and read back on hashchange. "Copy link" copies the full URL, falling back to the share sheet.

Links in: the Tree of Tongues header, every language page ("Word Machine"), and the explore rows on Browse and About. The nav highlights Languages.

**Budget.** On the current export, the change added 0.6 KB gzip to the main bundle (routing, the lazy import and links). The view is an 8.4 KB gzip chunk, plus 3.1 KB of CSS and a 0.5 KB shared layout chunk.

## Compare

Three columns (stacked on mobile): Ground truth, Account A and Account B. Each field row highlights claims that differ from the truth. The page explains the bias model.

## Design

- **Aesthetic:** "archive reading room".
  - Light theme: warm paper (#f4efe4) with ink (#1f1a14).
  - Dark theme: deep blue-black with parchment text.
  - Display font: serif (EB Garamond or Cormorant). UI font: Inter-like system sans. Data: tabular numbers.
- Colors are tokens on `:root` and are redefined for dark mode via `prefers-color-scheme`, with a manual toggle.
- **Responsive:**
  - From 360 px up, with no horizontal scroll.
  - Below 768 px: bottom tab bar (Map, Graph, Browse, Search), bottom-sheet panels, a slider at least 44 px tall.
  - Desktop: the side panel is 380 px.
- **Performance:**
  - The initial load is only `meta.json`, `world.json` and `timeline.json` (target under 1.5 MB gzipped total). The graph and page shards load lazily.
  - No layout thrash on slider drag (use `requestAnimationFrame`, reuse `ImageData`/Path2D).
- **Accessibility:** focus rings, aria labels, keyboard slider, color plus pattern for kinds where needed. Every SVG chart has an "as a list" alternative. `npm --prefix atlas run a11y` runs axe-core over the main views, including the Word Machine, in both themes; it must stay clean.
- **Screenshots:** `npm --prefix atlas run shoot` captures every view at 390 and 1440 px (light and some dark), flags horizontal overflow and console errors, runs the interaction flows (including the Word Machine's keyboard, deep link and law link) and the perf probes. `-- --only=readme --readme=word-machine.png` writes just that README still.

## Dev data

`atlas/scripts/mock-data.ts` writes contract-conformant mock data, so the atlas can be developed before the engine export exists. The real export overwrites `public/data/`.
