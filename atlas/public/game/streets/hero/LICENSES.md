# The hero: sources and licences

The realistic runner for Runner of the Tablet House (`#/streets`): a young runner of a palace tablet house in a
Bronze Age river city, built by `scripts/streets/hero/build.sh` (each step's script is in that folder; the recipe and
tool versions are in `build.sh`'s header). Every source below is CC0 1.0 (public domain dedication,
https://creativecommons.org/publicdomain/zero/1.0/). Attribution is not required; we give it anyway. No Mixamo file
is used anywhere (Adobe's terms forbid redistributing its files).

| File | What | Size | SHA-256 |
|---|---|---|---|
| `hero.glb` | LOD0: 39,952 triangles, 2048² skin maps, all 16 clips of `runner.glb` | 2,614,484 bytes (2,242,707 gzipped) | `fbce1b3b111b6806848ddadd9fa8730f881b799f70a31c669c0ea3c603968da0` |
| `hero_lod1.glb` | LOD1 for phones: 10,826 triangles, 1024² skin maps, the same clips | 1,122,424 bytes (838,171 gzipped) | `086458514af0bff9f4b8e8d64683df862fe13758bab079a401162395b142765f` |
| `hero_skin_detail.webp` | a tiling pore normal for the game's optional skin shader patch (ours) | 120,478 bytes | `2b43200cf21c34b40297c090189acc6a603535e5594e18e5eafc2cbaa250ffe7` |

Both GLBs are meshopt-compressed (`EXT_meshopt_compression`, `KHR_mesh_quantization`) with WebP textures
(`EXT_texture_webp`); they also use `KHR_materials_ior`, `KHR_materials_transmission` (the cornea) and
`KHR_materials_anisotropy` (the hair). three.js's `GLTFLoader` with `MeshoptDecoder` reads them as it reads
`runner.glb`.

## Sources

| Source | Author | Licence | Used for |
|---|---|---|---|
| **MPFB 2.0.18** (MakeHuman's Blender extension), https://extensions.blender.org/add-ons/mpfb/ (code: https://github.com/makehumancommunity/mpfb2) | MakeHuman Team (Joel Palmius and contributors) | Code GPL-3.0-or-later (used as a tool only; none of it ships). Bundled assets CC0 1.0 (`LICENSE.ASSETS.md`). Its `LICENSE.md`, section D: "no output from MPFB contains any trace of program logic … As the assets have been released under CC0, there is no limitation on what you can do with this combined output … Exports to files … Saved model files." | The body: base mesh `hm08` (`data/3dobjs/base.obj`), its phenotype and face targets, the `game_engine` rig, its hand-made skin weights and its `t-pose.json` (to calibrate the bind pose) |
| **MakeHuman system assets** (asset pack), https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html | makehuman_system (Data Collection AB, Joel Palmius, Jonas Hauquier) | CC0 1.0 (pack page and each file's header: "This asset was explicitly released as CC0 in september 2020") | `eyebrow001` (mesh and texture, recoloured), `eyelashes02` (mesh and texture, recoloured), and the `high-poly` eye proxy's shape (our eyes are projected onto it so the lids close on them; its mesh and texture are not shipped) |
| **Natural male skins** (asset pack `skins02`), https://static.makehumancommunity.org/assets/assetpacks/skins02.html; the skin's own page http://www.makehumancommunity.org/node/526 | Mindfront (Sweden) | CC0 1.0 (pack manifest; the author's note: "I set the license to CC0 for maximum usage freedom"; the texture itself is stamped "License: CC0") | "skin male african middleage": its colour, normal and specular maps are the starting point of the skin maps (regraded, re-lit, re-roughened; see below) |
| **Kiara 8 Sunset** HDRI, https://polyhaven.com/a/kiara_8_sunset | Greg Zaal (Poly Haven) | CC0 1.0 (https://polyhaven.com/license) | Light for the renders and the dev harness only (with its sun disc removed); not in the GLBs |
| **runner.glb**'s skeleton and clips (Quaternius Universal Animation Library 1 and 2, Mesh2Motion, and our authored clips) | see `../LICENSES.md` | CC0 1.0 | The 65-joint skeleton and all 16 clips, copied unchanged |

Downloaded files and their SHA-256 (checked by `build.sh` before use; only model, texture, target, rig and material
data were read; no script from any download was run):

| File | SHA-256 | From |
|---|---|---|
| `add-on-mpfb-v2.0.18.zip` | `c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad` | https://extensions.blender.org/download/sha256:c075b3e9…/add-on-mpfb-v2.0.18.zip |
| `makehuman_system_assets_cc0.zip` | `b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107` | https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip |
| `skins02_cc0.zip` | `1613f1ef3afca53094511d26620ed7cf1d2dedc29ed3d384d60bdebe250698ae` | https://files.makehumancommunity.org/asset_packs/skins02/skins02_cc0.zip |
| `kiara_8_sunset_1k.hdr` | `b26b18fd296c5a5044a36eddfc210bb2125c94d185675eb43aae61a01510e61e` | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kiara_8_sunset_1k.hdr |
| `kiara_8_sunset_2k.hdr` | `74842b3235b3c044d653718b1021beb32bd857618073258213da999113e4d57d` | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kiara_8_sunset_2k.hdr |

The files used from inside them:

| File | SHA-256 |
|---|---|
| MPFB `data/3dobjs/base.obj` | `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c` |
| MPFB `data/rigs/standard/rig.game_engine.json` | `b324ddb4b707721c19630bfadb87c3e3b38eed3b6e4590bb3cead43ea918f799` |
| MPFB `data/rigs/standard/weights.game_engine.json` | `9f4a773e74ce5ba08415b4f30070338e9f75bae5971b5075b10cd6b9caa58473` |
| MPFB `data/poses/game_engine_fk/t-pose.json` | `fefc2969c3e16049803e1ffea2a7cf9b7d98ec5eaeef42ca38dc6184241aacf8` |
| `skins/mindfront_skin_male_african_middleage/skin_male_african_middleage.png` | `5130c59aa53fa92044030c6b1c94d8627cddc4fc2512608cbe0bc4380f5198b9` |
| `skins/mindfront_skin_male_african_middleage/skin_male_african_middleage_NRM.png` | `5b7e90353022b38cd8f59606f39ca4a5c2af51de3589240ad8592748b58bf102` |
| `skins/mindfront_skin_male_african_middleage/skin_male_african_middleage_SPEC.png` | `98b8f5dc6f7e3edbc43501f394f4e84c717d32a70e569a4417a076c2b84fc72a` |
| `eyebrows/eyebrow001/eyebrow001.obj` | `88b13146395133f3901715e11706cdfd293e5d6087ad7c5e01efe1485a26b513` |
| `eyebrows/eyebrow001/eyebrow001.mhclo` | `54c8892c2ba577f4152d779ce1f20f7cd323beb8cbd9cb701796165c221b4f5b` |
| `eyebrows/eyebrow001/eyebrow001.png` | `9940f7d0b1b223709a19b05156ba6f6e9e4dbdbced02d7574f4d51d72c58967b` |
| `eyelashes/eyelashes02/eyelashes02.obj` | `331595b4e19a179be1fe603edc58ba6d088ab7898007b7e8321428efcbaf2eba` |
| `eyelashes/eyelashes02/eyelashes02.mhclo` | `51b858de6005bf9476035a739a695726b2227b853daf60cbf0f6b5eb9f70628e` |
| `eyelashes/eyelashes02/eyelashes02.png` | `6375eb8934d86d49eb2a37589e179614fb557dd92a772ced11e269ad6d72d79d` |
| `eyes/high-poly/high-poly.obj` (shape only) | `da2493215b708a344c33dc72f2a9a5b8fa985dcc5a70ad3b208995cf871da8e1` |
| `eyes/high-poly/high-poly.mhclo` (shape only) | `b183cfe37120ab726f9b3f2ea6cd3a64c44ce7b4bd91a77c841cf70c04f83a0d` |

## What is ours (CC0, like its sources)

- **The fit to the game's skeleton** (`human.py`): MPFB's body sized to the UAL legs, the UAL skeleton posed into the
  mesh's own relaxed A-pose (calibrated through both rigs' T-poses) as the bind pose, the mesh's limb joints moved and
  stretched onto UAL's by linear blend skinning with MPFB's weights, the feet raised onto the sandal soles, and the
  trunk's weights re-spread over UAL's spine joints.
- **The skin maps** (`skin.py`): Mindfront's colour regraded to a sun-browned medium brown, then browned where the sun
  falls, flushed where blood shows (nose, cheeks, ears, knuckles, elbows, knees), body hair lightened, armpits
  cleaned; its normal map softened and given a fine grain; roughness, occlusion and thickness built from the fitted
  mesh. The tiling pore normal (`hero_skin_detail.webp`).
- **The eyes** (eyeball with a recessed iris, painted iris and sclera with occlusion baked from the lids, and a glass
  cornea), **the cropped hair** (a shell over the scalp with short strands following the growth from the crown, and
  their anisotropic highlight), **the linen wrap kilt** (cloth-simulated drape over the body, a front overlap, a turned
  hem, a tiling plain weave), **the leather belt, satchel and strap, the sandals, and three clay tablets** with
  incised marks of an invented script (`face.py`, `gear.py`); all their textures are generated by those scripts.
- **LOD1** (`lod.py`) and the assembly onto `runner.glb`'s skeleton and clips (`assemble.ts`).

The hero is invented: no real person's likeness and no real culture's dress is copied.

## Considered and not used

- **Mixamo**: Adobe's terms forbid redistributing its characters and animations.
- **MetaHuman, Character Creator / ActorCore, Ready Player Me**: proprietary licences, not CC0 or permissive.
- **SMPL / SMPL-X** body models: research licences that forbid this use.
- **Quaternius Universal Base Characters** (CC0, the current `runner.glb`): stylised, not realistic.
- **MakeHuman's own hair proxies** (`short01`–`short04`, CC0): older hair cards that read worse than the shell here.
- **Other CC0 MakeHuman skins**: `mindfront_aksel_skin` carries a black eye and moles in its face; the system skins
  have no normal maps.

## Notes for the game (integration)

- Load it exactly as `runner.glb` (`GLTFLoader` + `MeshoptDecoder`); WebP needs nothing more. Joint names, rest pose
  and clips are `runner.glb`'s own, so `runner.ts` and `measureGait` work unchanged (checked: every joint of every
  clip within 0.15 mm of `runner.glb`'s, the difference being quantization).
- `hero_lod1.glb` for phones (no eyelashes, no cornea), `hero.glb` elsewhere.
- Turn shadow casting off for the `Brows` and `Lashes` meshes (alpha-blended cards would cast their whole quads).
- `runner.ts` darkens a material called `MI_Hair_1`; the hero has none, so that line does nothing for it.
- The cornea is glass (`KHR_materials_transmission`), which makes three render a transmission pass. To skip that
  cost, draw it additively instead: `transmission = 0`, black base colour, `AdditiveBlending`, `depthWrite = false`
  (see `corneaAdditive()` in `atlas/dev/hero-harness.ts`).
- Optional skin patch (`skinShader()` in the same file): a wrapped, reddened terminator and light through thin parts,
  driven by the thickness in the blue channel of the skin's ORM map, plus `hero_skin_detail.webp` repeated 32× as a
  pore normal for close-ups.
