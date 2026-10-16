# 0020: A 3D relief view (`#/3d`) on three.js, and a frame-stepped fly-through for video

**Context.** The 2D map is the archive's front door, but a flat political map of a world nobody knows is hard to share: it reads as another fantasy map. A relief model you can turn, with five thousand years of borders running over it, shows at a glance that this world has mountains, rivers, cities and a history. We also wanted a short video of it for social posts, which has to be rendered deterministically (no wall-clock jitter).

**Decision.**
- **A new lazy view, `#/3d`, on three.js** (`three@0.185.1`, exact version; `@types/three` for the types). three.js, the mesh builder and the view's CSS live in one lazy chunk (151 KB gzip), so the main bundle grows by 0.2 KB (the route and links).
- **The mesh comes from the same Voronoi cells as the 2D map** (`atlas/src/terrain/mesh.ts`). Each cell is fanned from its site to its polygon and subdivided (land 3×, sea 1×). Heights come from cell elevation (exaggerated), with sea level pinned on every land–sea edge, so the coast follows the 2D map's cell edges exactly. They are smoothed, and land gets a little deterministic ridge noise. About 188k triangles. The mesh is built once in about 50–120 ms and cached.
- **A year change touches colours, never geometry.** Every vertex carries its cell and the neighbour across its fan edge. A 128×62 float texture holds each cell's owner and colour for the chosen year, and the fragment shader tints the cell and draws borders and frontiers wherever the neighbour's owner differs. So a year costs one 126 KB texture upload, plus the city towers (instanced) and label anchors: about 1 ms of CPU.
- **Colours match the 2D map:** the same legend colours, mixed over a neutral paper albedo so the relief comes from the light. Unclaimed land keeps its biome colours. Light and dark palettes follow the atlas theme.
- **Light:** one directional sun with a static shadow map (re-rendered only when the relief changes), plus a hemisphere fill. The sea is matte: a specular sea washed out white under Schlick Fresnel whenever the camera faced the sun.
- **Labels are DOM, not WebGL:** the largest states and biggest cities of the year, projected each frame, decluttered, occlusion-tested against the terrain, and faded.
- **Motion:** idle auto-rotate eases in after 4.5 s and stops on interaction. It is off under `prefers-reduced-motion`, as are the intro dolly and fly-tos.
- **Cinema mode (`#/3d?cinema=1`):** no chrome; a keyframed camera spline; AY 0 → 5000 over 40 s with eased timing; title and end cards. `window.__cinema(t)` renders the frame for t ∈ [0, 1] synchronously, and label fades advance by a fixed 1/30 s, so `atlas/scripts/film.ts` can step it in Playwright and encode with ffmpeg (16:9, 1:1 and 9:16; the camera reframes for each aspect rather than cropping).

**Why.**
- **Shareability:** a turning relief with borders rising and falling is the most postable image the archive can make, and the video comes from the same code, not a separate pipeline.
- **No engine change:** everything is derived from `world.json` and the political layer the 2D map already uses; the export contract is unchanged.
- **Phones:** one draw call for the terrain, a shadow map rendered once, render-on-demand when idle, and pixel ratio capped at 2.
