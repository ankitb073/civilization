# Look-dev assets: sources and licences

Textures and skies of the realism look of *Runner of the Tablet House* (`docs/streets/lookdev.md`, decision 0033).
Built by `atlas/scripts/lookdev-assets.ts` (`fetch`, then `build`) from the sources below.

## Poly Haven (CC0 1.0)

Every Poly Haven asset is CC0 1.0 Universal (public domain dedication; https://polyhaven.com/license). Attribution is
not required; we give it anyway. Sources were fetched from Poly Haven's public API (`api.polyhaven.com/files/<id>`)
on 2026-10-17, at 2K JPEG (textures) and Radiance HDR (skies), into `build/lookdev/src2k/`
(not committed). Each download's magic bytes were checked; only image files were kept.

### Textures

| Asset | Used for | Authors | Page | Files |
|---|---|---|---|---|
| Clay Plaster (`clay_plaster`) | mud plaster on walls and roofs; terracotta jars (tinted) | Amal Kumar | https://polyhaven.com/a/clay_plaster | `clay_plaster_diff_2k.jpg`, `clay_plaster_nor_gl_2k.jpg`, `clay_plaster_arm_2k.jpg`, `clay_plaster_disp_2k.jpg` |
| Worn Brick Wall (`worn_brick_wall`) | mud brick where the plaster has flaked off | Amal Kumar | https://polyhaven.com/a/worn_brick_wall | `worn_brick_wall_diff_2k.jpg`, `worn_brick_wall_nor_gl_2k.jpg`, `worn_brick_wall_arm_2k.jpg`, `worn_brick_wall_disp_2k.jpg` |
| Dirt Floor (`dirt_floor`) | packed earth of the streets, the market and the courtyards | eye-candy.xyz | https://polyhaven.com/a/dirt_floor | `dirt_floor_diff_2k.jpg`, `dirt_floor_nor_gl_2k.jpg`, `dirt_floor_arm_2k.jpg`, `dirt_floor_disp_2k.jpg` |
| Stone Tiles 02 (`stone_tiles_02`) | irregular flagstones of the temple court (only there) | Charlotte Baglioni | https://polyhaven.com/a/stone_tiles_02 | `stone_tiles_02_diff_2k.jpg`, `stone_tiles_02_nor_gl_2k.jpg`, `stone_tiles_02_arm_2k.jpg`, `stone_tiles_02_disp_2k.jpg` |
| Large Sandstone Blocks 01 (`large_sandstone_blocks_01`) | temple and palace platforms, columns, rubble | Rob Tuytel | https://polyhaven.com/a/large_sandstone_blocks_01 | `large_sandstone_blocks_01_diff_2k.jpg`, `large_sandstone_blocks_01_nor_gl_2k.jpg`, `large_sandstone_blocks_01_arm_2k.jpg`, `large_sandstone_blocks_01_disp_2k.jpg` |
| Weathered Brown Planks (`weathered_brown_planks`) | doors, beams, ladders, planks, poles | Dimitrios Savva, Rico Cilliers | https://polyhaven.com/a/weathered_brown_planks | `weathered_brown_planks_diff_2k.jpg`, `weathered_brown_planks_nor_gl_2k.jpg`, `weathered_brown_planks_arm_2k.jpg`, `weathered_brown_planks_disp_2k.jpg` |
| Reed Roof 04 (`reed_roof_04`) | reed mats, awnings of reed, the temple roof | Rob Tuytel | https://polyhaven.com/a/reed_roof_04 | `reed_roof_04_diff_2k.jpg`, `reed_roof_04_nor_gl_2k.jpg`, `reed_roof_04_arm_2k.jpg`, `reed_roof_04_disp_2k.jpg` |
| Hessian 230 (`hessian_230`) | awnings, banners, the clothes of still figures (tinted) | colormass, Rico Cilliers | https://polyhaven.com/a/hessian_230 | `hessian_230_diff_2k.jpg`, `hessian_230_nor_gl_2k.jpg`, `hessian_230_arm_2k.jpg`, `hessian_230_disp_2k.jpg` |

How they are processed: the albedo is multiplied by the scan's ambient occlusion (60%); the OpenGL normal map's x and
y, the roughness (the green channel of `arm`) and the displacement (stretched to the full range) make the data
layer. `hero-2k` holds the albedo of the five surfaces seen closest (plaster, brick, earth, paving, stone) at 2K for
desktop; `full-1k` and `full-512` hold all eight materials, the hero five first. All are the scans resized (Lanczos). Albedo arrays are Basis ETC1S (sRGB),
data arrays Basis UASTC (linear), both mipmapped KTX2 2D arrays, one layer per material.

### Skies

| Asset | Used for | Authors | Page | Files |
|---|---|---|---|---|
| Qwantani Late Afternoon (Pure Sky) (`qwantani_late_afternoon_puresky`) | image-based lighting and the visible sky | Greg Zaal, Jarod Guest | https://polyhaven.com/a/qwantani_late_afternoon_puresky | `qwantani_late_afternoon_puresky_1k.hdr`, `qwantani_late_afternoon_puresky_4k.hdr` |

`sky-<id>-ibl-512.hdr` is the 1K HDR, with the sun clamped to four times the sky's 99th percentile (the directional
light carries the sun, so the image must not count it twice), halved to 512×256 for computers; `-ibl-256.hdr` is the
same at 256×128, for phones. Both are run-length encoded Radiance files. `sky-<id>-4k.ktx2` and `-2k.ktx2` are the
upper hemisphere, exposed so the sky's 99th percentile is 0.9, as Basis UASTC sRGB (4096×1024 and 2048×512, mipmapped),
for the visible backdrop; `-preview.webp` (1024×256) is the first frame's sky, until the KTX2 streams in.

## Basis Universal (Apache-2.0)

The KTX2 files were encoded with `basisu` 2.50 (Apache-2.0, https://github.com/BinomialLLC/basis_universal). The game
transcodes them with the copy of three 0.185.1's transcoder that the kit ships (`../kit/basis/`), one loader for both.

## Shipped files

| File | Size | SHA-256 |
|---|---|---|
| `full-1k-albedo.ktx2` | 1662 KB | `d11e7a380353e536…` |
| `full-1k-data.ktx2` | 7366 KB | `aab4d210a338c563…` |
| `full-512-albedo.ktx2` | 417 KB | `51782bc7b9883e9c…` |
| `full-512-data.ktx2` | 2227 KB | `21c27439d4a9a5da…` |
| `hero-2k-albedo.ktx2` | 3978 KB | `aba91171c4724136…` |
| `sky-qwantani_late_afternoon_puresky-2k.ktx2` | 500 KB | `0cdda68e53d92b2a…` |
| `sky-qwantani_late_afternoon_puresky-4k.ktx2` | 1782 KB | `b9395d95e1d7dcba…` |
| `sky-qwantani_late_afternoon_puresky-ibl-256.hdr` | 82 KB | `314f52a191a120dd…` |
| `sky-qwantani_late_afternoon_puresky-ibl-512.hdr` | 295 KB | `8dbfa6d27166eab0…` |
| `sky-qwantani_late_afternoon_puresky-preview.webp` | 2 KB | `a6cfa5c6559b90c2…` |
