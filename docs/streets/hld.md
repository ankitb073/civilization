# HLD: Runner of the Tablet House (`#/streets`)

Draft for review, 2026-10-16. Read [`prfaq.md`](prfaq.md) first. This document sets the architecture, the borrowed parts, the budgets and the order of work. It does not write code or record decisions; candidates for both are listed at the end.

**In short.** A lazy route, `#/streets/<scenario>`, beside `#/tablet`. The existing `buildCity(record, year)` draws the city; a new deterministic **streets layer** on the same plan adds what street level needs and yields collision, traversal, navigation and places. A fixed-step simulation drives plain three.js, with Preact for the HUD, and reuses the Tablet House's sound, art and reckoning. The first city is Pumi, AY 332 (`sc-919`).

```
world.sqlite ─▶ export ─▶ scenarios.json (+ market prices, more names)   scenario-scripts/sc-919.json (Tablet House)
                         cities.json · tl/core · world.json              streets-scripts/sc-919.json (new: errands, lines)
                                  │                                         └─ validator: placeholders resolve, no typed
             loadCityRecord ─▶ buildCity(rec, year)   (unchanged)               figures, every place and person exists
                                  ▼
             streets layer (new; same plan; hashes of the city id, never Math.random)
             ├─ near detail: rooms, parapets, hatches, ladders, planks, awnings, stalls, gates
             ├─ collision mesh ─▶ BVH ─▶ controller · camera · sight lines
             ├─ traversal graph: roof edges, gaps by width, ladders, vault points
             ├─ navmesh input ─▶ recast (worker) ─▶ crowd
             └─ places: tablet house, palace gate, temple, weigher's scale, gates, the dyer's door …
                                  ▼
input ─▶ fixed 60 Hz sim (controller, parkour, people, errands) ─▶ three.js render + Preact HUD
                 │                                                  ─▶ soundscape beat + positional emitters
                 └─▶ save (localStorage) ─▶ reckoning (Tablet House engine) ─▶ share line, card, s/streets.html
```

The code lives in `atlas/src/game/streets/` and ships as one lazy chunk. No other view changes, apart from one small option on the city model (see "Data from the record").

## Components

**1. Engine and renderer.**
- **three.js 0.185.1** with `WebGLRenderer` (WebGL2).
  - Not WebGPU: the city model patches its shaders with `onBeforeCompile`, and every 3D view on the site is WebGL.
  - Not react-three-fiber: the atlas is Preact.
- **The loop.** The simulation runs at a fixed 60 Hz with an accumulator; rendering follows the display and interpolates. It pauses when the tab is hidden.
- **Light.** The backdrop's sky, fog and per-beat looks (`game/tablet/backdrop/sky.ts`, `looks.ts`) set the time of day. One sun.
- **Shadows.**
  - The city's shadow map renders once per day, because the sun only moves between days.
  - People get blob shadows on phones.
- **Resolution.** Phones scale dynamically between DPR 1.0 and 1.5. Desktop is capped at 2.

**2. Physics and character controller.**
- **Recommended: no physics engine.**
  - The world is static: boxes and a few primitives. Nothing is pushed around.
  - **three-mesh-bvh** answers capsule, ray and sphere queries against one merged collision mesh.
- **A custom kinematic controller.**
  - It moves and slides in up to 4 passes, steps up 0.45 m, snaps to the ground within 0.3 m, and limits slopes to 45°.
  - On top of it sits a parkour state machine: ground, air, ledge hang, climb-up, vault, ladder, plank, drop, landing roll.
- **Ledges come from the plan, not from probing.** Every roof edge, gap and ladder is known exactly, so they form a **traversal graph** built at load; rays only confirm them. This is why a generated city suits parkour.
- **Rapier is what the movement spike uses** (`@dimforge/rapier3d-compat` 0.19.3, the right pin: the 0.21.0 wasm is twice the size).
  - Its KinematicCharacterController is good, but nothing here needs rigid-body dynamics.
  - Its compat build is 835 KB gzipped, five times the rest of the game's code.
  - Step 1 measures it against the BVH controller on a real phone (download, wasm init, ms per step). The cheaper one that keeps the feel wins, and the decision record says why.

**3. Animation.**
- **One CC0 skeleton for every person.** It is dressed in the **figurine look** of decision 0023: a faceless head of bare wood, a Bronze Age kilt or sheath gown, and the state's colours.
- **`AnimationMixer`.**
  - Idle, walk and run blend by speed.
  - Parkour states fire one-shot clips with 0.1–0.2 s cross-fades.
  - Clips play in place and the controller moves the body. Climb-up follows a short scripted path timed to its clip.
  - Carrying a basket is a masked upper-body layer.
  - `CCDIKSolver` plants the hands on ledges.
- **Crowds are not skinned.**
  - They are instanced figurine parts with a limb swing in the vertex shader, as the battle dioramas draw thousands of soldiers.
  - Only near, named people are skinned; far ones update at 15 Hz.

**4. Camera.** A custom spring-arm follow camera.
- Drag or stick orbits it, and a BVH sphere cast pulls it in before a wall.
- On roofs it pitches up to show the next gap.
- Hang and ladder have set framings; story beats use the backdrop's slow drift.
- **Reduced motion:** no shake, no field-of-view kick, and the camera never turns by itself.
- `camera-controls` (MIT) is an orbit control, not a character camera, so it is not used.

**5. Input.**
- **One action map:** move, look, jump, interact, sprint, map, pause.
- **Desktop:** WASD or arrows; drag to look (pointer lock optional, never forced); Space, Shift and E; gamepad through the Gamepad API.
- **Touch:**
  - A dynamic **nipplejs** stick on the left half; dragging on the right half moves the camera; jump and context buttons in the bottom-right safe area.
  - **Auto-parkour:** running at an edge jumps it, and running at a low wall climbs it. An **edge-stop** keeps a walking runner on the roof.
  - No page scroll or zoom (`touch-action: none`). Nothing depends on fullscreen, which iPhone Safari lacks.
  - Landscape is preferred; portrait works with a wider field of view.

**6. City-to-collision pipeline (the streets layer).**
- **Input:** `buildCity`'s plan (`layoutOf`): lots, rotations, roads, rings, palace site, river.
- **Scale: 1 lot = 8 m.**
  - Pumi's houses are then 3.4–5.3 m tall, one or two storeys.
  - Gaps inside a courtyard block are 0.2–2 m, so roofs can be hopped.
  - Streets are about 8–10 m: climb down to cross, or take a plank.
  - The walled town is about 250–300 m across (step 2 measures it), roughly 40 s at a run.
  - The city is compressed: the model draws one building for about 70 people. Detail adds density; the count of buildings never changes (decision 0024).
- **What the layer adds.** Each lot becomes a compound of 2–4 rooms of different heights, which gives natural steps to the roof. It adds parapets, roof hatches, ladders and stairs, planks and awnings over chosen gaps, market stalls and named gates.
- **The rule for additions:** add only what the record does not contradict and what the scripts or flagships need.
  - The eyewitness account (fl-354) names the river gate, the gate of the barley-merchants, and the streets of the potters and the weavers.
  - The Tablet House script's "postern on the dyers' side" goes where the model's sack direction burns houses, so the model and the script agree.
- **Outputs:**
  1. near-detail instanced meshes;
  2. one collision mesh of ≤ 30k triangles and its BVH;
  3. the traversal graph;
  4. navmesh input, with off-mesh links at ladders;
  5. the table of places.
- **Tests:**
  - Every place is reachable on foot from the tablet house.
  - Every block's roof has a way up.
  - No gap an errand requires is wider than the jump.
  - Footprints match `#/city/set:17?y=331` lot for lot.

**7. Navigation and crowds.**
- **recast-navigation-js** builds the navmesh in a Web Worker after the runner can already move. **DetourCrowd** steers the active agents. Off-mesh links let soldiers use ladders on the night of the sack.
- Beyond the active set, ambient walkers follow street polylines: instanced, with no avoidance, and culled by distance.
- **Small role state machines follow a day schedule:**
  - day 1, the market is full;
  - day 3, there is a queue at the granary;
  - day 4 at night, the streets empty, soldiers search, and fire spreads in the plan's sack direction;
  - day 5, a crowd stands in the burned square.
- **Soldiers perceive** with a view cone and a BVH line-of-sight ray, and they hear running on roofs.
- **Not used:**
  - Yuka has had no release since 2022-09.
  - three-pathfinding only queries paths on an authored navmesh.
- **Fallback** if recast fails the budget: A* and flow fields on a 1 m grid of the street plan. About 300 lines; streets only, no roofs.

**8. Errands and state.**
- **A pure state machine,** like `game/tablet/engine.ts`, so every path can be played headless in a test.
- **State:** day, errand and step, what is carried, flags, the Tablet House meters (Favour, Conscience, Household), checkpoint, time of day.
- **An errand is data:** a giver; steps (go, carry, talk, choose, avoid, report); then effects and the record facts it reveals.
- **Choices are destinations.** Where you carry the roll of the dead is the choice.
- **Reports** reuse the Tablet House's true, rounded and king's figures (`valuesOf`).
- **The reckoning reuses the Tablet House engine:** `hardeningOf`, `conditionOf`, `endingOf`, `archaeologist`, `truthScore` and `shareText`. A burned archive bakes clay, which is what makes the night's choice matter: the fire, the cistern or the road.
- **No state can change the outcome,** the treaty or the dates; a test checks it.

**9. Dialogue.** Text only, no voice: a Preact panel for conversations and short barks above heads, readable on a phone and accessible.
- **Lines come from `streets-scripts/<id>.json`** under the Tablet House rules: every figure and record name is a `{placeholder}`, and prose has no digits.
- **A validator** in the style of `scenario-validate.ts` also checks that every place and person named exists.
- **The Tablet House script for Pumi**, *Until the Tokens Come Home*, supplies the scenes, people and choices to adapt; its scribe becomes the runner's master.
- inkjs (MIT) was considered, but plain JSON keeps one validator for both games.

**10. Audio.**
- **The bed:** `createSoundscape` (procedural, no files), seeded by the scenario id. Each day maps to a beat (muster, field, walls, fall-sack, tablet), and intensity follows a chase or a fire.
- **New:** at most 8 positional emitters on equal-power `PannerNode`s (HRTF costs too much on phones): the market, temple drums, the river, fire, horns, dogs.
- **Footsteps** are synthesised per surface from the existing DSP.
- **Defaults:** muted on phones until tapped, as now. At most 1 ms per frame.

**11. Save.** `localStorage` in try/catch, as `TabletView.tsx` does: one versioned record per scenario (≤ 4 KB), with checkpoints at each errand's start and end and "Continue" on the title. No account, no server. Sharing goes through `s/streets.html?c=<id>` with a card, like `s/tablet.html`.

**12. Streaming and LOD.**
- **No streaming:** the walled city (about 300 compounds) fits in memory.
- **By distance:**
  - Near detail extends 60 m on phones and 120 m on desktop, rebuilt in 32 m cells; beyond that, the model's own parts.
  - Outside the walls: fields, the river, a low horizon.
  - People: skinned to 20 m, instanced to 60 m, then nothing, with fog hiding the cut.
- **Over time:** the sky and the shadow map change each day; the geometry changes once, at the sack.

**13. Data from the record.**
- **Sources:** the scenario (`scenarios.json`), the city via `loadCityRecord('set:17')`, the painted art (`art.json`), and the two scripts.
- **The city record:** `loadCityRecord` pulls `tl/core`, `world` and `cities`, about 200 KB gzipped. A trimmed per-city record would be about 5 KB (decision candidate).
- **Contract additions** go through `engine/src/export/contract.ts` and are recounted in `engine/test/scenarios.test.ts`:
  1. **The market's prices for the decade,** from the same series the ledgers and the checker use. Pumi in the 330s, in grams of silver: grain 9.25, salt 16.75, cloth 8.84, oil 5.99, bronze 16.98. The Bima coin weighs 7.6 g.
  2. **More names:** 10 per sex today; about 60 needed.
  3. **The ids of the documents about the siege,** for links: the eyewitness account fl-354 is PAL·CH·08471.
- **Before the sack.** `buildCity` at AY 332 already draws burnt quarters. Days 1–3 need a "before the sack" `ModelOpts` flag, or the AY 331 model (295 houses, against 294 at AY 333).
- **Name forms.** Use the scenario's ("Pumi", in the defender's language at the date), not the city page's ("Pummi").
- **Population.**
  - The scenario says 20,817 and the city view says 20,066; show the scenario's figure.
  - Poyonga (`sc-159`) differs by 31% (13,975 against about 9,670), because the view extrapolates back before the first survey. That deserves a P3 issue before Poyonga is played.

## Open-source components

Checked on npm and GitHub on 2026-10-16. Every pin was published at least 14 days earlier. Sizes are gzipped, measured from the published packages.

| Library | Use | Pin (published) | Licence | Health | Size | Verdict |
|---|---|---|---|---|---|---|
| three | renderer, mixer, loaders, MeshoptDecoder, CCDIKSolver | 0.185.1 (2026-07-01) | MIT | very active; 0.186.1 out | 143 KB, already shared | **Adopt**; upgrade site-wide later |
| three-mesh-bvh | collision, rays, camera casts | 0.9.15 (2026-09-09) | MIT | active (push 2026-10-12) | 62 KB before tree-shaking | **Adopt** (0.9.16 is only 8 days old) |
| @dimforge/rapier3d-compat | controller and physics (used by the spike) | 0.19.3 (2025-11-05) | Apache-2.0 | active; JS bindings moved into `dimforge/rapier` (old repo archived 2026) | wasm 584 KB (0.19.3), 761 KB (0.20.0), 1,169 KB (0.21.0); compat build 835 KB (0.19.3) | **Measure in step 1** against the BVH controller |
| @recast-navigation/core, /three, /generators | navmesh, DetourCrowd, off-mesh links | 0.43.1 (2026-04-07) | MIT | active (push 2026-07-06) | wasm 131 KB + glue 60 KB | **Adopt**, loaded lazily |
| nipplejs | touch stick | 1.0.4 (2026-05-26) | MIT | revived (1.0 in 2026-03) | 6 KB | **Adopt** |
| yuka | steering, FSM | 0.7.8 (2022-09-17) | MIT | no release in 4 years | 84 KB | **Reject** |
| three-pathfinding | path queries | 1.3.0 (2024-05-17) | MIT | quiet | — | **Reject** (recast covers it) |
| camera-controls | orbit camera | 3.1.2 (2025-11-17) | MIT | active | — | **Reject** for a follow camera |
| @gltf-transform/cli, gltfpack | GLB trimming and compression | 4.5.1 (2026-09-28), 1.3.0 (2026-09-25) | MIT | active | dev only | **Adopt** as build tools |
| Quaternius UAL1 + UAL2 Standard; Mesh2Motion | skeleton and clips | UAL v3.0 (2026-06-16); Mesh2Motion (push 2026-10-06) | CC0 | active | ≤ 600 KB GLB after trimming | **Adopt** |

**Characters (CC0).** Checked by opening the files.

| Need | Source | Notes |
|---|---|---|
| idle, walk, jog, sprint, jump start / loop / land, roll, crouch, sit, talk, push, carry, a 1 m mantle | Quaternius Universal Animation Library: UAL1 and UAL2 Standard | Free, CC0, GLB. Use the exports on the shared UE-style skeleton: UAL1's Godot export has 53 joints, UAL2 has 65. |
| climb wall, ledge hang, ladder | Mesh2Motion | CC0 assets, MIT code. Its rest pose is up to 28° off the UAL rig, so retarget it in Blender. Quality not yet judged. |
| the same, consistently on one rig, plus vault, step-up and a 2 m climb | UAL1 Pro ($9.99), UAL2 Source ($14.99) | Paid, but still CC0. Recommended. |
| pull-up from a hang, ledge shimmy, true fall loop | nobody | Key in Blender. |

- **Not chosen:**
  - KayKit Character Animations 1.1 (CC0): no climbing.
  - Kenney Mini Characters (CC0): a 7-bone rig.
  - Kenney Animated Characters: FBX only.
  - CMU motion capture forbids resale, so it is not CC0.
  - The Bandai Namco set is BY-NC.
  - Rokoko and ActorCore: proprietary.
- **Size.** The full UAL GLBs are 6.7 and 8.1 MB. Trimmed to about 15 clips on a 2–4k-triangle figurine body and compressed with meshopt, the target is ≤ 600 KB.

**Mixamo.**
- It is free and royalty-free in games.
- Adobe's community FAQ says "really the only thing you can't do is distribute the raw character and animation files."
- Committing them to a public MIT repo is exactly that, and would mislabel them as MIT. A web build is a game use, but anyone can save the GLB from the network tab.
- **So no Mixamo file goes in the repo or the build.**

**Licence duties.**
- MIT, Apache-2.0 and CC0 all fit under the repo's MIT licence.
- Rapier's Apache-2.0 would require shipping its licence text with the build.
- Every asset folder records its source and licence, as `art.json` does.

**Blender and ComfyUI.**
- **Blender** (local MCP) is on the critical path at step 4. It trims the packs to in-place clips, retargets Mesh2Motion, keys the missing clips, skins the figurine body to the skeleton and exports one meshopt GLB. It is not used for the city, which stays procedural.
- **ComfyUI** (local, decision 0029) adds little: the look is vertex colour, and the six Bronze Age Tablet House plates already exist. At step 7, at most: tileable detail textures (mud-brick, reed mat, plaster), checked by eye for seams and lettering.

## Performance budget

**Reference devices:**
- **Mid-range phone:** iPhone 12/13 class; Galaxy A54/A55 or Pixel 7a class.
- **Desktop:** an integrated-GPU laptop (M1, Iris Xe) at 1080p–1440p.

**Baseline,** measured today on desktop: Pumi's model builds in 5.2–6.6 ms from 1,066–1,190 instanced parts, renders in 0.3 ms of CPU, and needs about a dozen draw calls.

**There are no phone figures yet.** Step 1 measures on a real device; until then the phone column is a target, not evidence.

| | Mid-range phone | Desktop |
|---|---|---|
| Frame rate | 60 fps on iPhone 12+ and Pixel 7a; a locked 30 fps floor on Galaxy A54 class | 60 fps |
| Main-thread CPU per frame | ≤ 8 ms (sim ≤ 3: controller ≤ 1, people ≤ 1.5, errands and UI ≤ 0.5; render submit ≤ 3) | ≤ 5 ms |
| Draw calls | ≤ 100 (about 60 expected) | ≤ 250 |
| Triangles drawn | ≤ 300k (about 170k expected) | ≤ 1M |
| Resolution | DPR 1.0–1.5, dynamic | DPR ≤ 2 |
| Shadows | 1024² rendered once a day; blob shadows | 2048² static, plus a live shadow for the runner |
| Collision | BVH ≤ 30k triangles, built in ≤ 50 ms; queries ≤ 1 ms per frame | ≤ 0.5 ms |
| Physics bodies | 0 dynamic; 1 kinematic runner; agents as crowd cylinders | same |
| People | 6 skinned, 24 agents, ≤ 80 drawn | 20 skinned, 64 agents, ≤ 250 drawn |
| Memory | JS heap ≤ 120 MB; tab ≤ 300 MB (Safari Web Inspector) | ≤ 500 MB |
| JS (gzip) | game ≤ 150 KB; three 143 KB (shared); BVH ≤ 60 KB; nipplejs 6 KB; recast 190 KB after first control | same |
| Assets (gzip) | figure GLB ≤ 600 KB; data ≤ 250 KB (about 30 KB with a trimmed record); art ≤ 150 KB; audio 0 | full-size art |
| Before the first step | ≤ 1.5 MB; ≤ 4 s cold on 4G; ≤ 1.5 s warm | ≤ 2 s |
| Endurance | 30 minutes at ≥ 30 fps on the Galaxy A54 class | — |

## Step plan

Each step is playable, fits one review sitting, and ends with its measurements written down. A step starts only after the one before it is accepted.

| # | Step | You can play | Accepted when |
|---|---|---|---|
| 1 | **Movement spike** (being built now; Rapier 0.19.3 and a 12-clip UAL runner) | A runner walks, runs and jumps through a generated city at `#/streets`, on desktop and phone | Keys and mouse, and stick, drag and jump, all work, with no page scroll or zoom. A 5-minute replayed bot walk logs zero wall or floor penetrations. Frame times probed on desktop, on Playwright at 4× CPU throttle, and on one real mid-range phone. The collider's download, init time and ms per step are measured, and the choice is recorded. |
| 2 | **Pumi, walkable** | Pumi of AY 332 at 1 lot = 8 m: walk from the tablet house to every named place and up ladders onto the roofs, in the five lights of the week | Footprints match `#/city/set:17?y=331`. The reachability test passes. Gap widths are reported. On phone: ≤ 100 draw calls, ≤ 300k triangles, first step ≤ 4 s on throttled 4G. |
| 3 | **Life** | People at their trades and named people at their posts; the market at the record's prices; each day's soundscape and positional sound | A 10-minute soak with no agent stuck for more than 5 s, within the frame budget. A test shows every name and price comes from the record. The day schedule is visible. Muted by default on phones. |
| 4 | **Traversal** | Hop gaps, vault parapets, grab, hang and climb, ladders, planks over lanes, drop and roll, with a basket that weighs on the jump | Every clip runs on one rig in the figurine look. A bot replays a reference roof route on phone and desktop controls. Edge-stop holds. The user plays 10 minutes on each device and signs off on the feel. |
| 5 | **Errands, days 1–3** | The muster tokens; the battle news and the wounded; the walls, the grain and the roll of the dead. Choices by destination; reports true, rounded or the king's; save and continue. | `streets-scripts/sc-919.json` passes the validator. A headless test plays every path and fills every line. A reload resumes at the checkpoint. A first playthrough of days 1–3 takes 15–25 minutes. |
| 6 | **Errands, days 4–5** | The sack at night: fire in the dyers' quarter, soldiers to avoid, the tablets to the fire, the cistern or the road. Then the Treaty of Himi in the burned square, and the reckoning. | The PRFAQ's violence checklist passes review. A test shows the ending always matches the record. The reckoning, share line and card come from the Tablet House engine. Skip-the-chase and reduced motion both work. |
| 7 | **Polish and launch** | The whole week on the Play hub, with a 60-second onboarding | A real-device pass at budget on the iPhone 12 and Galaxy A54 classes, including the 30-minute soak. `npm --prefix atlas run streets` plays it through with screenshots, axe on the DOM UI, the card and frame probes. Finishable by keyboard only and by touch only. Decision records, README and CLAUDE.md updated. |
| 8 | **A second city, as content only** | Another Bronze Age scenario with a different ending, e.g. Kagün, AY 1727 (a treaty) | Only data, a streets script and layer parameters change, and it plays end to end. This proves that the next ten flat-roofed cities are writing, not engineering. |

## Risks

| Risk | Why it is real | How it is retired | Step |
|---|---|---|---|
| **1. Traversal feels bad on a touch stick** | Free parkour on a virtual stick is the classic failure, and the "Spider-Man feel" is the whole promise. | Auto-parkour, edge-stop, and a camera that frames the next gap. A bot route proves the route can be run; the user's own play judges whether it is fun. If it is not, narrow to marked roof paths before building errands on top. | 1, 4 |
| **2. Phones run hot or slow** | Skinned people, crowds, collision and fire, for 30 minutes on a mid-range Android. | Real-device measurement from step 1; instanced crowds; static shadows; dynamic resolution; a 30 fps lock; people capped by device class. | 1–3, 7 |
| **3. Scope creep** ("like GTA") | Combat, vehicles, interiors, more cities and voice all pull at it. Introversion's Subversion was shelved after building tech instead of a game. | One city, five days, about 12 errands, the PRFAQ's not-now list, and steps that each end playable. | all |
| 4. Missing climbing clips | The free tiers have no climb or hang; Mesh2Motion uses another rest pose; nobody has a pull-up or shimmy. | Retarget Mesh2Motion or buy the CC0 tiers (about $25); key the rest in Blender; `CCDIKSolver` for the hands. | 4 |
| 5. The generator was made for dioramas | Unreachable roofs, odd gaps. | Ladders, steps and planks added by rule; the reachability test fails the build. | 2 |
| 6. Scripts and model disagree | The Pumi script has a canal ringing the city; the model has a river through it. | The additions rule, a decision record, and the validator's place check. | 2, 5 |
| 7. The sack becomes spectacle | Street level brings it close. | The PRFAQ's rules, a content note, a skippable chase, and the user's review of day 4. | 6 |
| 8. A city-model change breaks the layer | `buildCity` serves five views. | Fingerprint Pumi's plan in a test, as the figurines do. | 2 |
| 9. iOS Safari | Audio unlock, no element fullscreen, memory kills. | Design around them from step 1; a real iPhone in every acceptance. | 1, 7 |

## Decision candidates (for `docs/decisions/`, not yet written)

1. Build the streets game: scope, not-now list, working title.
2. The first city is Pumi, AY 332 (`sc-919`).
3. Renderer: WebGL2 on three 0.185.1; no WebGPU, no react-three-fiber.
4. Collision: three-mesh-bvh with a custom controller, or Rapier (from step 1's numbers).
5. Navigation: recast and DetourCrowd; navmesh built at runtime or at build time; grid fallback.
6. Characters: UAL plus Mesh2Motion (and the paid CC0 tiers?), the figurine look, no Mixamo.
7. Crowds: instanced figurine parts with a shader walk.
8. Scale and additions: 1 lot = 8 m; what the layer may add (and the canal?).
9. Before and after the sack: a city-model option, or the AY 331 model.
10. Contract additions (prices, names, document ids) and a trimmed per-city record.
11. The streets-script format and its validator.
12. The player's role: a runner whose reports can bend, reusing the Tablet House slots and reckoning.
13. How a sack's violence is shown.
14. Touch controls: auto-parkour, edge-stop, nipplejs, portrait.
15. Measurement: probes and device soaks; whether to add privacy-respecting play counts (the site has none today).

**LLDs to write next, one per component:**
- the streets layer and collision;
- controller and parkour;
- camera and input;
- animation and characters;
- people and navigation;
- errands, dialogue and the script format;
- audio;
- save and share;
- the data contract.
