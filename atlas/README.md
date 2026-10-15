# Palimpsest Atlas

The static web atlas for the archive. It's built with Vite, Preact and TypeScript, and deploys to GitHub Pages under `/civilization/`.

It reads only the files defined in `../engine/src/export/contract.ts`, which live in `public/data/`. The engine export writes those files. `npm run mock` writes a contract-conformant stand-in.

```sh
npm install
npm run mock       # stand-in data (refuses to overwrite a real export without -- --force)
npm run dev        # http://localhost:5173
npm run build      # prepare-data + tsc + vite build -> dist/
npm run loadprobe  # first-load bytes and time to first map (gzip server, 4G throttling)
npm run shoot      # screenshots (.shots/), interaction flows, slider perf probe
npm run shoot -- --only=og --year=2750   # writes public/og.png social card (needs a build)
```

## Views

| View | Route | What it shows |
|---|---|---|
| Map | `#/map?y=&l=&sel=&routes=1` | Map with the time slider. |
| Graph | `#/graph?y=&k=&focus=&sel=` | Sigma and ForceAtlas2 for the whole graph. The `focus` param gives a two-hop d3-force view. |
| Reader | `#/p/<id>` | One entity or artifact page. |
| Compare | `#/compare/<eventId>` | Rival accounts set against the ground truth. |
| Browse | `#/browse?kind=&from=&to=&q=` | Filterable lists. |
| About | `#/about` | About the project. |
| Collections | `#/collections[/<id>]` | Curated lists. `#/collections/history` is the History's contents page. |
| Today | `#/today[/YYYY-MM-DD]` | Opens the document of the day: a flagship picked by hashing the viewer's local date, the same for everyone. |
| Story, Histomap, Prices | `#/story`, `#/histomap`, `#/prices` | The guided story, every state as a stream, prices over five millennia. |
| Dynasties | `#/dynasties`, `#/dynasty/<id>` | Family trees of the ruling houses. |
| Year | `#/year/<y>` | One year: mini-map, great powers, events and the documents written then. |
| Languages | `#/languages` | The Tree of Tongues. |
| Word Machine | `#/words`, `#/words/<concept>?y=&l=` | One word in all 126 languages: a year scrubber with play, and the derivation of any language from its proto-form, law by law. |

`clean=1` hides the UI chrome. The social card uses it.

## Books and reading

- Pages in an ordered collection (`history`, then `lives`, then `voices`, in `collections.json` order) get previous/next navigation at the top and bottom (`src/book.ts`, `BookNav` in `PageView.tsx`).
- Long documents (a book chapter, or 1,500+ words) read in a single 700 px column, with a reading-time estimate (words / 230) and a contents list built from their `##` headings.
- Reading progress through the History is kept in this browser only (`localStorage` key `pal-reading`). The landing panel shows "Continue reading" from it.
- The EPUB ("The Reader", the `.epub` entry in `meta.downloads`) is offered on About, on the History's contents page and after its last chapter.
- Genre layouts that Markdown alone can't express (omen tablets, itineraries, customs tariffs) reshape the rendered HTML in `src/genres.ts`. Their styles live in `src/styles/genres.css`.

## Data preparation

`scripts/prepare-data.ts` runs before every build. It splits the engine's `timeline.json` into `public/data/tl/`, so that the first map paint loads only a small core and the political layer for the current millennium:

- a columnar core;
- six millennium chunks of the political layer;
- events, and routes.

Nothing changes in the engine contract; the atlas falls back to `timeline.json` when `tl/` is missing.

## Code layout

- `src/views/mapRenderer.ts` is an imperative Canvas 2D renderer. Terrain is cached as Path2D groups. The per-year fills, borders and labels are computed once per (layer, year) and cached.
- `src/layers.ts` reconstructs ownership, culture and religion at any year from keyframes plus deltas.
- `src/md.ts` is a small Markdown renderer that handles `[[id|text]]` WikiLinks.
- `src/tongueLayout.ts` lays out the language families; the Tree of Tongues and the Word Machine share it. `src/words.ts` turns a word file into a derivation (see `docs/lld/atlas.md`).
