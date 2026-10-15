# LLD: Worldgen (`engine/src/world/`)

## Output: `World` (immutable after generation)

| Field | Type | Notes |
|---|---|---|
| `width`, `height` | number | 2000 × 1250 map units |
| `n` | number | about 8,000 cells |
| `x`, `y` | Float64Array | Voronoi sites (jittered grid, 1-decimal rounded so the atlas rebuilds identical cells) |
| `neighbors` | Int32Array[] | From the Delaunay triangulation |
| `elev` | Float32Array | −1..1; sea below 0 |
| `land` | Uint8Array | |
| `lat` | Float32Array | Degrees; top of map ≈ 58°N, bottom ≈ 2°S |
| `temp`, `precip` | Float32Array | Climate normals: °C annual mean; mm/yr |
| `biome` | Uint8Array | Whittaker-style, see `biomes.ts` |
| `flux` | Float32Array | Accumulated runoff; river cells have `flux > riverThreshold` |
| `downhill` | Int32Array | Steepest-descent receiver, −1 at sea |
| `coastal` | Uint8Array | Land cell adjacent to sea |
| `fertility` | Float32Array | 0..1 from biome, river floodplain, loess |
| `resources` | Uint16Array | Bit flags: copper, tin, iron, silver, gold, salt, horses, timber, stone, spice, coal, oil |
| `region` | Int32Array | Region index; −1 for sea |
| `landmass` | Int32Array | Connected land component id |
| `rivers` | `River[]` | `{cells, flux}` source→mouth, for the major rivers |

## Steps

1. **Sites:** jittered grid with spacing `s = sqrt(W·H/N)` and jitter 0.4s.
2. **Elevation:**
   - Three landmass "blobs": a large western continent, a medium eastern one across an ocean, and an archipelago. The blobs use a smooth radial falloff with domain-warped simplex fBm.
   - Ridged noise forms mountain chains, biased along blob edges (collision belts).
   - Normalize, then pick sea level so that about 37% of the map is land.
3. **Hydrology:** priority-flood filling of depressions on the cell graph, steepest-descent receivers, and runoff accumulated from precipitation in topological order. River cells are those with flux at or above the 94th percentile of land. Major rivers are traced from the mouths of the largest basins.
4. **Climate normals:**
   - Temperature: `T = −12 + 40·cos(lat)^1.2 − 6.5·elevKm`.
   - Precipitation by moisture advection over a 250×156 raster:
     - Westerlies above 32° latitude, easterly trades below.
     - Ocean recharges moisture. Land precipitates `base + orographic·max(0, Δh)`. Rain shadow is emergent.
     - Equatorial convergence adds rain.
   - Precipitation is then sampled back to cells and smoothed.
5. **Biomes:** from (T, P, elevation): ice, tundra, taiga, temperate forest, temperate grassland (steppe), Mediterranean scrub, hot desert, cold desert, savanna, tropical forest, wetland (river and low slope), alpine.
6. **Resources:** seeded rules by terrain.
   - Tin is deliberately rare and clustered in 3–4 provinces, which forces long-distance Bronze Age trade.
   - Copper sits on hills; iron is widespread; silver and gold sit in mountains; salt is in arid coasts and evaporites; horses are on the steppe.
   - Coal is in temperate basins (clustered); oil is in arid and coastal basins (clustered).
7. **Regions:** seeded region growing with cost (mountains and wide rivers are expensive), about 110 cells per region. Each region is confined to one landmass.

## Determinism

Worldgen uses only `rng.fork('world', step)` streams. Snapshot tests check that seed 1 produces stable land fraction and biome counts.
