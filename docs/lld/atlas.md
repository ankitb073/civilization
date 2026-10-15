# LLD: Atlas (`atlas/`)

A static web app (Vite, TypeScript, Preact) that reads the files defined in `engine/src/export/contract.ts` from `atlas/public/data/`. It is deployed to GitHub Pages under `/civilization/`, so every fetch uses `import.meta.env.BASE_URL`.

## Views and routes (hash router, shareable permalinks)

| Route | View |
|---|---|
| `#/` or `#/map?y=2310&l=political&sel=pol:12` | Map + time slider (home) |
| `#/graph?y=2310&focus=evt:12&k=polity,event` | Force-directed graph |
| `#/p/<id>` | Page reader (entity or artifact) |
| `#/compare/<eventId>` | Rival accounts vs. ground truth |
| `#/browse?kind=artifact&sub=treaty&from=1000&to=2000` | Filterable index |
| `#/about` | Method, consistency report, downloads, credits |

Global state lives in the URL: year, layer, selection. A global search box in the top bar (lazy-loads `search.json`) works everywhere.

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
- **Accessibility:** focus rings, aria labels, keyboard slider, color plus pattern for kinds where needed.

## Dev data

`atlas/scripts/mock-data.ts` writes contract-conformant mock data, so the atlas can be developed before the engine export exists. The real export overwrites `public/data/`.
