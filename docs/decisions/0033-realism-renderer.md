# 0033: The streets draw the realism look on WebGPU, in four tiers; without WebGPU, the classic look as before

**Context.** The user asked for *Runner of the Tablet House* to look "as realistic as possible … insane quality …
millions will view it". Look-dev (docs/streets/lookdev.md) chose grounded realism on three's `WebGPURenderer`: TSL
materials from CC0 scans, an HDRI sky and image light, cascaded shadows, GTAO, contact shadows, TRAA or TAAU, depth of
field, motion blur, bloom, planar water reflections. It measured the look's WebGL2 fallback at a 13–21 s shader
compile, and left integration, tiers, loading, ownership of the light and phones to do.

**Decision.**
- **Two renderers, chosen per visit** (`look/tiers.ts`, before either is fetched).
  - With WebGPU (an adapter that is not a software one): `WebGPURenderer` and the realism look (`look/`).
  - Without it: `WebGLRenderer` and the classic look, unchanged. The realism look is never drawn on
    `WebGPURenderer`'s WebGL2 backend; a renderer that falls back to it is refused and the city restarts classic on a
    fresh canvas.
  - Overrides: `?look=classic|realism`, `?tier=desktop|desktop-medium|phone|phone-low`, and the player's choice in the
    HUD's Graphics menu (localStorage `pal-streets-look-v1`, in try/catch).
  - Every other view (city, Tablet House, battle, museum) keeps `WebGLRenderer`.
- **Four tiers**, picked from the device (a phone or a narrow window) and a GPU probe (a fixed fragment workload,
  timed, about 50 ms; score 1 = the M5 Max it was tuned on):

  | Tier | Who | What |
  |---|---|---|
  | desktop | computers scoring ≥ 0.33 | 1K scans with a 2K albedo on the closest surfaces, parallax, 3 cascades × 2048², GTAO into indirect light, contact shadows, TRAA, far DOF, motion blur, bloom, sun shafts; DPR ≤ 1.5; the 40k-triangle hero. The river mirror is built but off: it drew the whole town again (1.2 ms of CPU) |
  | desktop-medium | other computers (integrated GPUs) | 1K scans, 2 cascades, GTAO, TAAU at 80%, bloom; no mirror, contact shadows, DOF, blur or shafts; DPR ≤ 1.25 |
  | phone | phones scoring ≥ 0.12 | 512 scans, one 2048² follow shadow, GTAO (on the finished image: no pre-pass, half the draw calls), TAAU at 75%; DPR ≤ 1.25; **held at 30 fps**; the 11k hero |
  | phone-low | every other phone (the default) | as phone without GTAO, with FXAA, DPR 1; aims for 60 fps |

- **Adaptive quality** (`look/governor.ts`), for an automatically picked tier only (a tier the player or the route
  chose stays): when the median frame runs a third over the tier's budget for 4 s, and
  the frame's own CPU work or a GPU sample shows the device is the cause (not a display or battery cap), the game steps
  one tier down, rebuilds the look behind a short card and says so in a toast.
- **Loading.**
  - **Shaders compile behind the loading card, in parallel.** Every WebGPU pipeline is created with the async call:
    a frame drawn with frustum culling off asks for all of them, and the card shows pipelines ready of pipelines
    asked. Later pipelines (the levy, the kit, a tier change) compile the same way, without a hitch; an object
    appears when its pipeline is ready. The image light is prefiltered with synchronous pipelines (it is drawn once).
  - **The first frame needs no texture download.** Every look material samples texture slots that start as
    4×4 placeholders (each scan's mean colour, a flat normal); the sky starts as a 2 KB preview.
  - **Textures stream after the first frame** and are swapped into the slots with no shader rebuilt: the tier's full set
    and its KTX2 sky, then, on desktop, the hero albedo. The hero set's layers are the full set's first layers, so one
    layer index serves both.
  - **The sky is a KTX2** (Basis UASTC): 4K on computers (1.8 MB; 5.6 MB of GPU memory instead of 22 MB as RGBA8),
    2K on phones.
- **The look owns the light**: the sun's direction, colour and shadows, the sky, the image light, the fog, the exposure
  and the grade. `game.ts` no longer places the sun under the realism look. The world's classic sky dome, hemisphere
  fill and fog stay for the classic look and are switched off (and back) by the look.
- **A late-afternoon light**, after the Tablet House's painted plates: Poly Haven's `qwantani_late_afternoon_puresky`
  (CC0; the sun 19° up over a warm, hazy horizon) replaces look-dev's midday cumulus sky; the image light is warmed a
  third of the way toward a warm grey, the sky and fog are graded warm.
- **The ground of a mud-brick town**: packed earth everywhere (the record's painted colour pulled to dry earth, about
  0.3 albedo), lighter dust in drifts, the main roads trodden darker with two wheel ruts whose normals dip; damp earth
  and silt by the river. Flagstones only in the temple's court (its footprint grown by 3 m, a ragged edge), large warm
  limestone slabs (Poly Haven `stone_tiles_02`, replacing the grey `grassy_cobblestone` that made the market read as
  European cobbles).
- **Clean interfaces with the world**:
  - the streets layer's kit meshes carry `aBox`, `aDim` and `aNrm` (`setWorldOptions({ surfaceTags: true })`,
    world/kit.ts); their material family comes from `material.userData.lookKind` ('mud' or 'plain',
    world/materials.ts). Look-dev's hook on `Kit.build` is gone; a kit built without tags (the errand's levy) keeps its
    own painted-wood material;
  - the hero district (`city.district`, decision 0034): its glTF meshes are lit as they are; the look keeps no soot
    decals inside `district.contains()`, and the kit's far levels (LOD2, LOD3, the far pools) cast no shadow;
  - one KTX2 loader for the kit and the look (`kitKtx2`, world/kitload.ts), so one transcoder;
  - the banners' wind and the birds' flap have TSL versions in `world/life.ts` (`nodeMaterials()`), the classic patches
    unchanged;
  - glTF assets (the hero, the world's Blender kit) need nothing: the lights and the post stack light them.
- **The hero** (`hero/hero.glb`, 40k triangles; `hero_lod1.glb`, 11k) is the realism look's runner (LOD1 on the phone
  tiers); the classic look keeps `runner.glb` unless `?hero=1`. Its cornea is an additive gloss (no transmission pass);
  its brows and lashes cast no shadow.
- **Assets shipped** (`atlas/public/game/streets/look/`): 17.9 MB, from 33 MB at look-dev. `full-1k` (9.0 MB),
  `full-512` (2.6 MB), `hero-2k` albedo only (3.9 MB; the 15 MB 2K data array is dropped: normals stay 1K), the sky
  as KTX2 at 4K (1.8 MB) and 2K (0.5 MB) with a 2 KB preview, and the image light at 512 and 256 (0.4 MB). The
  look's own transcoder copy is gone (the kit's is shared). Under a 4G phone's first frame: 82 KB of light and 2 KB
  of sky; the 3.1 MB phone set and sky stream after it; a computer streams 14.7 MB.

**Why.** Measured with `atlas/scripts/streets-look.ts` on 2026-10-17, on an Apple M5 Max with the GPU otherwise idle
(the shared GPU lock; a loaded machine halves every rate). Every phone figure is this Mac's GPU, with 4× CPU
throttling; a real phone's GPU is several times slower, and none has been measured. Over 20 s per view (market,
rooftop, river, lane, palace gate, the errand's run), the view panning:

| | Classic (WebGL) | desktop | desktop-medium | phone (30 fps lock) | phone-low |
|---|---|---|---|---|---|
| Frame, median / p95 (ms) | 16.7 / 16.8 | 16.7 / 16.8 | 16.7 / 16.8 | 33.3 / 33.4 | 16.7 / 16.8 |
| CPU per frame, median | 1.0–1.8 ms (phone 0.9–1.1) | 4.6–5.6 ms | 3.8–4.3 ms | 5.1–6.0 ms | 3.2–3.9 ms |
| GPU per frame, median (submit to idle) | 1.4–1.6 ms (phone 0.7) | 4.9–7.0 ms | 4.7–5.1 ms | 3.2–3.6 ms | 1.9–2.6 ms |
| Draw calls, median | 103–159 (phone 69–90) | 257–405 | 218–299 | 85–111 | 80–105 |
| Triangles, median | 0.41–0.78 M (phone 0.21–0.31 M) | 1.1–2.1 M | 0.94–1.6 M | 0.27–0.35 M | 0.23–0.31 M |
| Shader compile behind the card | — | 0.5 s (cold 0.45–2.0 s) | 0.4 s (cold 1.4 s) | 0.2 s (cold 1.2 s) | 0.2 s (cold 0.7 s) |
| First frame / full quality, local | 0.45 s | 1.0 / 1.3 s | 0.9 / 1.1 s | 0.7 / 0.8 s | 0.7 / 0.8 s |
| Slow 4G: first frame / full quality | 13.9 s (phone 14.1 s) | 27.7 / 211 s | 27.5 / 190 s | 19.8 / 79 s | 19.6 / 80 s |

- **The realism look holds its tier's rate** on every view, desktop at a steady 60 fps.
- **Three things made it hold.** Each was found by profiling the passes:
  - every pipeline compiles async and in parallel: cold, 17.7 s became 2.0 s;
  - the phone tier has no separate pre-pass (draws halved; CPU at 4× throttle from about 25 ms to 5–6 ms);
  - the river mirror is off (it re-drew the town).
- **Slow 4G costs about 6 s more on a phone** before the first frame than the classic look. That is the WebGPU
  renderer (190 KB gzip), the look's code (30 KB) and 82 KB of light. The streamed textures follow over a minute on
  4G; the city is playable throughout. On a computer the hero district's kit (decision 0034) dominates the 4G
  download.
- **The classic look is unchanged for browsers without WebGPU.** The probes' movement, traversal, errand and axe
  results are the same under both looks.

