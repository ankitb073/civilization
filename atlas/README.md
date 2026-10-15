# Palimpsest Atlas

The static web atlas for the archive. It's built with Vite, Preact and TypeScript, and deploys to GitHub Pages under `/civilization/`.

It reads only the files defined in `../engine/src/export/contract.ts`, which live in `public/data/`. The engine export writes those files. `npm run mock` writes a contract-conformant stand-in.

```sh
npm install
npm run mock       # stand-in data (refuses to overwrite a real export without -- --force)
npm run dev        # http://localhost:5173
npm run build      # tsc + vite build -> dist/
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

`clean=1` hides the UI chrome. The social card uses it.

## Code layout

- `src/views/mapRenderer.ts` is an imperative Canvas 2D renderer. Terrain is cached as Path2D groups. The per-year fills, borders and labels are computed once per (layer, year) and cached.
- `src/layers.ts` reconstructs ownership, culture and religion at any year from keyframes plus deltas.
- `src/md.ts` is a small Markdown renderer that handles `[[id|text]]` WikiLinks.
