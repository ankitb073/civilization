# Streets assets: sources and licences

Assets used by the Streets route (`#/streets`). Everything here is CC0 1.0 (public domain dedication,
https://creativecommons.org/publicdomain/zero/1.0/). Attribution is not required; we give it anyway.

## runner.glb

The runner: one animated glTF binary built from three Quaternius packs and Mesh2Motion's animations by
`scripts/streets/runner-asset.ts` (the recipe, with the exact tool versions, is in that file's header).

| | |
|---|---|
| Authors | Quaternius (https://quaternius.com); Mesh2Motion (Scott Petrovic and contributors, https://mesh2motion.org) |
| Licence | CC0 1.0 Universal, stated on each pack page and in each pack's licence file (Mesh2Motion: `LICENSE-CC0.MD` and its README, "The art assets (3d models, rigs, animations) are all licensed under CC0") |
| Head, legs, skeleton | **Universal Base Characters [Standard]**: `Superhero_Male_FullBody.gltf` / `.bin` (its torso, arms and hands are cut away under the costume), and the base-colour textures `T_Superhero_Male_Dark.png`, `T_Hair_1_BaseColor.png` and `T_Eye_Brown.png` |
| Costume | **Modular Character Outfits – Fantasy [Standard]**: the Peasant's shirt and arms (`Outfits/Male_Peasant.gltf` / `.bin`, meshes `Male_Peasant_Body` and `Male_Peasant_Arms`), with `T_Peasant_BaseColor.png` (the shirt's cream lightened to linen) and `T_Regular_Male_Dark_BaseColor.png` (the forearms and hands). The trousers and boots are not used: the runner goes barefoot in a kilt (the base character's shorts, madder-red). |
| Animations | **Universal Animation Library [Standard]** (`UAL1_Standard.glb`): `Idle_Loop`, `Walk_Loop`, `Jog_Fwd_Loop` (the run), `Jump_Start`, `Jump_Loop`, `Jump_Land`, `Roll`. **Universal Animation Library 2 [Standard]** (`UAL2_Standard.glb`): `ClimbUp_1m` (the mantle). **Mesh2Motion** (`human-addon-animations.glb`, retargeted to this skeleton): `Ledge Hang` → `Hang_Loop`, `Climb Wall` → `Climb_Wall`, `Climb Ladder` → `Climb_Ladder` (one of its three cycles) |
| Authored (ours, CC0 like their sources) | `Run_Jump_L`, `Run_Jump_R` (a running jump off the left or right foot), `Jump_Air` (the standing jump's flight), `Jog_Loop` (the run's stride made smaller and quicker) and `Hang_PullUp` (from the hang to standing on top), posed by `runner-asset.ts` from frames of the clips above, with joint angles set in the script and Catmull-Rom in-betweens; and the **tablet satchel** (a leather bag with two clay tablets, on a strap across the chest), modelled and skinned in the same script. No other source is in them. |

Pack pages (official):
- https://quaternius.com/packs/universalbasecharacters.html (download: https://quaternius.itch.io/universal-base-characters)
- https://quaternius.com/packs/universalanimationlibrary.html (download: https://quaternius.itch.io/universal-animation-library)
- https://quaternius.com/packs/universalanimationlibrary2.html (download: https://quaternius.itch.io/universal-animation-library-2)
- https://quaternius.com/packs/modularcharacteroutfitsfantasy.html (download: https://quaternius.itch.io/modular-character-outfits-fantasy)
- Mesh2Motion: https://github.com/Mesh2Motion/mesh2motion-app (art sources: https://github.com/Mesh2Motion/mesh2motion-assets, CC0-1.0)

Where the files were fetched from (the official downloads go through itch.io, which cannot be scripted; these are
byte-for-byte redistributions of the free Standard packs, kept with the packs' own licence files). The two UAL1 copies
and the two `Superhero_Male_FullBody.gltf` copies from unrelated repositories were identical, which supports that
they are the unmodified pack files.

| File | SHA-256 | Fetched from |
|---|---|---|
| `UAL1_Standard.glb` | `69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997` | https://github.com/LinuxGroove/verdigris-protocol/blob/c5c4d463c22d318f60849a30a4a3e93da5c31d63/assets/quaternius/crew/UAL1_Standard.glb (also https://github.com/zttimmerman/project-whiskeyjack at `1c769eec`, identical) |
| `UAL2_Standard.glb` | `8cee20ab1bc55130092447e810e26df22dd2803eccc54f52137a7d54d7ab88a8` | same folder, `UAL2_Standard.glb` |
| `Superhero_Male_FullBody.gltf` | `e7fcea214ecf8855afbf910b50de6f9c7d1decfb71ca28bad8a4481452dafeb4` | https://github.com/BoQsc/gpu-marching-cubes/tree/54368c0875c5f72be00160fafb040c6ce5c4e760/models/entities/player/Universal%20Base%20Characters%5BStandard%5D/Base%20Characters/Godot%20-%20UE (also https://github.com/ZBishopM/chasqui-godot at `41c5827f`, identical) |
| `Superhero_Male_FullBody.bin` | `459003f9745853ae562a85506a2b94dd56515c1f37728f9fa3d2ce1a3e4cd92f` | same folder |
| `T_Superhero_Male_Dark.png` | `df680cbc1967a61e85998bfafb8f7bc0a36dd604bb3266486c4b06b1a184bb45` | same folder |
| `T_Hair_1_BaseColor.png` | `bc7aa863bd22ab0a995cd838cceb4d3a5186ee54ee2fb0108fad85d20c057e6e` | same folder |
| `T_Eye_Brown.png` | `d08e3356a83211bc6ca21fe3a8e39f4b5c1a3b8f85457fc2c0fb57be09935025` | same folder |
| `Male_Peasant.gltf` | `8f5a6cf6c1cf96e0a0f8e1a861b4245d42b7f88d44e5076da3d48f3fc52f4e76` | https://github.com/agentkaerf/FreeModels/tree/db3df04d1e4714298a09510b26fb6de6645138a2/Modular%20Character%20Outfits%20-%20Fantasy%5BStandard%5D/Exports/glTF%20(Godot-Unreal)/Outfits (also https://github.com/tomoponz/novel-game-prototype at `c9bcdc68`, `assets/models/…`, identical) |
| `Male_Peasant.bin` | `e46bde795f7b69b351d322d7a5628e07131cfb48ed0afe366293f1b3f530433c` | same folder (identical in both) |
| `T_Peasant_BaseColor.png` | `a43635628d95571cd62fd4db0cc3a6ea32778b2bc02f242dda224c89d07f1ade` | same folder (identical in both) |
| `T_Regular_Male_Dark_BaseColor.png` | `b4dcc0f4139aab548d7c070c4655bd2080ef16caeaaabee6c4aeb693c524e802` | same folder (identical in both) |
| `human-addon-animations.glb` | `a0d64d555e0d492026b72d58bf8e16c5e86779295f9093e376dcc001915c2c95` | https://github.com/Mesh2Motion/mesh2motion-app/blob/653a9698f5f315523072f1c3ff3496100401317b/static/animations/human-addon-animations.glb (the official repository) |

Licence files beside them: `Universal_Animation_Library_License.txt` and `Universal_Base_Characters_License.txt`
(LinuxGroove/verdigris-protocol, same commit), and `License_Standard.txt` (BoQsc/gpu-marching-cubes, same commit):
"CC0 1.0 Universal (CC0 1.0) Public Domain Dedication … Models by @Quaternius". The outfits' `License_Standard.txt`
(agentkaerf/FreeModels, same commit, SHA-256 `2202cc2f…`): "This is the standard FREE version of the the Modular
Character Outfits - Fantasy … License: CC0 1.0 Universal (CC0 1.0) Public Domain Dedication … Models by @Quaternius".
Mesh2Motion's `LICENSE-CC0.MD` (same commit): "All 3d models, blend files, rigs, animations — CC0 1.0 Universal".

Only model and texture data were taken (no scripts, projects or other files), and they were read as data by the
build script, never executed.

What we changed (all CC0, so changes are allowed): clips copied onto the base character's skeleton (rotations as they
are, pelvis translation scaled to its leg length, scale tracks dropped); Mesh2Motion's clips retargeted to it; the
jumps, jog and pull-up authored from the packs' frames; the Peasant's shirt and arms put on with their own skin of our
joints and the body under them cut away; the satchel added; the dense meshes simplified (meshoptimizer); unused vertex
streams removed; normal and roughness maps dropped; base-colour textures downsampled (body and shirt 512 px, arms 256,
brows and eyes 128), the dark shorts recoloured madder-red, the shirt lightened to linen, unused texels flattened;
keyframes resampled; geometry quantized (`KHR_mesh_quantization`) and meshopt-compressed (`EXT_meshopt_compression`).

`runner.glb` SHA-256: `a6139556088779ba7385fa57201e6d2de639c6d32a98d7d59d87ff6dd68d90e2` (580,448 bytes; built the same
from either outfit mirror).

## Considered and not used

Running-jump clips, checked 2026-10-16 before authoring our own:
- **Universal Animation Library 1 and 2 [Standard]** (Quaternius, CC0): no running jump. `Jump_Start`/`Jump_Loop`/`Jump_Land` are a standing jump; UAL2's `NinjaJump_*` is a stylised tuck with the arms swept back.
- **Mesh2Motion** (`human-addon-animations.glb`, above): the same 65-joint skeleton (rest angles differ slightly), but its `Run Jump` is one held pose (two keyframes), `Jump_2` a standing tuck jump, and its `Jog` the UAL run again (so the jog is authored). Its `Ledge Hang`, `Climb Wall` and `Climb Ladder` are used; `Ladder_Idle` and `Pipe Climb` are not (a held `Climb_Ladder` frame does for the first).

KayKit Character Pack: Adventurers 1.0 (Kay Lousberg, CC0,
https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0). It has every clip we need, but its
characters are chibi (legs about a fifth of their height): matched to its own clips, its run covers about 1.4 m/s at
human height, too slow for a runner across a city.

## Code

- **Rapier** (`@dimforge/rapier3d-compat` 0.19.3, https://github.com/dimforge/rapier.js), the physics engine and character controller, bundled into the Streets chunk. Copyright Dimforge EURL and contributors, Apache License 2.0; the licence text ships beside this file as `LICENSE-rapier.txt`.
