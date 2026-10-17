# 0034: A hero district drawn with the Blender kit, lot for lot over the model, streamed after the first step

**Context.** The user asked for streets "as realistic as possible", with a smaller map if need be. Look-dev
(docs/streets/lookdev.md) showed that light and materials go a long way but that "only the modular kit can" fix straight
edges and doors that are black slabs. The kit now exists (atlas/public/game/streets/kit/, built headless in Blender by
scripts/streets/kit/): 93 pieces in four packs, three LODs each, KTX2 textures in a desktop (`hi`) and a phone (`lo`)
tier, and a house recipe in kit.json. The world had to adopt it without breaking what the game already proves:
footprints that match `#/city/set:17?y=331` lot for lot, every traversal probe, and the errand's horn.

**Decision.**
- **The district: a corridor, not a circle.** Its shape is the union of the errand's own street route from the door of
  the house of tablets to the river gate (22 m either side), discs at the temple square and market, the house of
  tablets, the palace and its gate, the well and the river gate, and capsules along the two bridges near the square.
  It holds 23 houses of 295 (plus the temple, the palace, two wall runs and two towers): a circle that covered the
  same places would hold 117. `city.district` exposes `center`, `radius`, `polygon`, `contains(x, z)`, `group` and
  `ready`.
- **The kit redraws; the layer still decides.** The streets layer (0031) keeps placing everything and making every
  collider at load. It now records what it placed as *intents* (world/intents.ts: windows, parapet runs, stairs,
  ladders, jars, stalls, the well …) under an *owner* (a house, a stall, a wall run). world/assemble.ts redraws each
  owner from kit pieces at the same places and sizes, following kit.json's recipe: corner columns and wall modules
  stretched to the model's footprint, door and window modules where the layer put them, upper bands to the model's
  wall height, the roof slab's edge and field, the layer's parapet runs with their gaps, upper rooms, door leaves open
  on dark rooms. Where kit and layer differed, the layer moved to the kit's documented collision boxes (parapets
  0.26 m thick on the slab's edge, courtyard walls 0.4 m, the well's post at 2.3 m, the wall walk's breastwork and
  merlons); colliders still come only from the layer and the model, so physics.ts is unchanged.
- **Streaming.** Nothing loads before the first frame: the player starts in today's city. Then kit.json, the houses'
  pack, then props and plants (`lo` on phones, `hi` on desktop). The district is cut into 24 m cells (the palace and
  the temple into several), each built nearest first by a merge that runs 3–4 ms a frame and pauses, so no frame
  waits on it. A cell fades in (dithered alpha) over the boxes it replaces, which then go: the model's instances are
  hidden and the layer's parts collapsed in place, once all of an owner's cells are in. `ready` resolves when the
  cells within 40 m (24 m on phones) are in.
- **LODs by distance, per cell, merged by material.** LOD1 near (the kit's renders show it beside LOD0 on screen at half
  the triangles): one textured mesh per material (walls, roofs, timber, pottery, cloth on desktop; walls and roofs on
  phones), the rest folded into one untextured mesh whose vertex colours carry each material's mean albedo
  (scripts/streets/kit/means.py). LOD2 from 20 m (8 m on phones) is that untextured mesh alone, and LOD3 from 64 m
  (28 m) plain boxes in the same colours. Cells settled at LOD2 are pooled into one mesh per 48 m block, and all
  cells at LOD3 into one, rebuilt by the same paused job when their members change. The kit's LOD0 moved to its own
  buffer (`<pack>.lod0.bin`), which the game never fetches.
- **Textures.** The desktop tier's normal maps are ETC1S like the rest (judged side by side up close: no visible
  difference), which cut its download from 30.1 to 19.0 MB; the phone tier is 7.3 MB (was 9.9).
- **Kit gaps filled:** a lime wash for the palace and temple (a tinted plaster material), dark rooms behind open doors,
  date clusters on the mature palm, a round fig crown, a lighter loom LOD2, and texture phase carried from module to
  module (no step after a 1 m module).
- **Surfaces.** `Kit.define` takes a `surface`; `build({ tags })` writes aBox/aDim/aNrm (world option `surfaceTags`).

**Why.**
- **The corridor is what the player sees.** The first days are spent between the house of tablets, the square and the
  river gate; a circle wide enough for the gate pays for a hundred houses nobody walks past.
- **One source of truth for collision.** Keeping the layer's colliders means every probe, the errand's route and the
  horn's measurements still hold without re-measuring.
- **Measured** (probes on an M5 Max, another agent's jobs running alongside; phone = 390×844, 4× CPU):

| | Desktop, classic | Desktop, realism | Phone, classic | Phone, realism |
|---|---|---|---|---|
| Frame median / p95 (world loop) | 16.7 / 16.8 ms | 33.3 / 33.4 ms ¹ | 16.7 / 16.8 ms | 33.4 / 66.7 ms ¹ |
| CPU median / p95 | 2.2 / 5.9 ms (was 0.8 / 1.0) | 12.3 / 19.9 ms | 11.6 / 18 ms ² | 36 / 56 ms |
| Draw calls median | 140 (was 85) | 222 | 86 (was 64) | 101 |
| Triangles median | 741k (was 253k) | 1.07M | 483k → ~290k after phones took LOD2 geometry near | 503k |
| Kit download | 20.9 MB (`hi`) | | 8.9 MB (`lo`) | |
| Kit texture memory | 80 MB | | 20 MB | |
| District `ready` after load | 12.7 s | 16.7 s | 9.0 s | 14.4 s; **92 s on slow 4G** |
| Colliders | 3,863 (was 3,733) | | 3,838 | |
| Assembly | 13 ms | | 89–149 ms (4× CPU) | |

¹ the realism look's own frame (30 fps lock on phones; its governor); the kit adds about 4 ms CPU and 80–150 draws there.
² while cells stream in as the loop runs; the merge budget is now 2.5 ms a frame on phones.

Traversal and errand probes match the baseline: 80/80 walls street-to-roof (median 1.57 s), 5/5 mantles, the same
ladder times, 12/12 edge-stops, every place walkable, stairs climbed (the phone's "walls 1" stair miss is as before);
the horn's routes re-measure at 29.8 s run, 54.5 s jog, 127.1 s walk, 34.0 s over the roofs (were 29.8, 54.5, 127.1,
33.9), so `streets-scripts/sc-919.json` is unchanged.

**Next.** The realism look draws each kit mesh in five passes: keeping LOD2 and LOD3 out of the mirror and the far
cascades would halve the kit's share. The kit's 92 s on slow 4G is its textures; a 512 phone set would cut it to about
half. LOD0 (now never fetched) could return for the one house the camera touches.
