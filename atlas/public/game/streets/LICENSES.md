# Streets assets: sources and licences

Assets used by the Streets route (`#/streets`). Everything here is CC0 1.0 (public domain dedication,
https://creativecommons.org/publicdomain/zero/1.0/). Attribution is not required; we give it anyway.

## runner.glb

The runner: one animated glTF binary built from two Quaternius packs by `scripts/streets/runner-asset.ts` (the recipe,
with the exact tool versions, is in that file's header).

| | |
|---|---|
| Author | Quaternius (https://quaternius.com) |
| Licence | CC0 1.0 Universal, stated on each pack page and in each pack's licence file |
| Mesh, skeleton, textures | **Universal Base Characters [Standard]**: `Superhero_Male_FullBody.gltf` / `.bin`, and the base-colour textures `T_Superhero_Male_Dark.png`, `T_Hair_1_BaseColor.png` and `T_Eye_Brown.png` |
| Animations | **Universal Animation Library [Standard]** (`UAL1_Standard.glb`): `Idle_Loop`, `Walk_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop`, `Jump_Start`, `Jump_Loop`, `Jump_Land`, `Roll`. **Universal Animation Library 2 [Standard]** (`UAL2_Standard.glb`): `ClimbUp_1m` (kept for the mantle in step 2) |
| Authored clips (ours, CC0 like their sources) | `Run_Jump_L`, `Run_Jump_R` (a running jump off the left or right foot) and `Jump_Air` (the standing jump's flight), posed by `runner-asset.ts` from frames of `Jog_Fwd_Loop`, `Jump_Start`, `Jump_Loop` and `Jump_Land` above, with joint angles set in the script and Catmull-Rom in-betweens. No other source is in them. |

Pack pages (official):
- https://quaternius.com/packs/universalbasecharacters.html (download: https://quaternius.itch.io/universal-base-characters)
- https://quaternius.com/packs/universalanimationlibrary.html (download: https://quaternius.itch.io/universal-animation-library)
- https://quaternius.com/packs/universalanimationlibrary2.html (download: https://quaternius.itch.io/universal-animation-library-2)

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

Licence files beside them: `Universal_Animation_Library_License.txt` and `Universal_Base_Characters_License.txt`
(LinuxGroove/verdigris-protocol, same commit), and `License_Standard.txt` (BoQsc/gpu-marching-cubes, same commit):
"CC0 1.0 Universal (CC0 1.0) Public Domain Dedication … Models by @Quaternius".

Only model and texture data were taken (no scripts, projects or other files), and they were read as data by the
build script, never executed.

What we changed (all CC0, so changes are allowed): clips copied onto the base character's skeleton (rotations as they
are, pelvis translation scaled to its leg length, scale tracks dropped); unused vertex streams removed; normal and
roughness maps dropped; base-colour textures downsampled (body 512 px, brows and eyes 128 px) and the dark shorts
recoloured as a madder-red loincloth; keyframes resampled; geometry quantized (`KHR_mesh_quantization`) and
meshopt-compressed (`EXT_meshopt_compression`).

`runner.glb` SHA-256: `4fb3bd323184ed900fdb39b6a57055bcd9a4fd395ecfe09ab1d13b8a711029f1` (447,448 bytes).

## Considered and not used

Running-jump clips, checked 2026-10-16 before authoring our own:
- **Universal Animation Library 1 and 2 [Standard]** (Quaternius, CC0): no running jump. `Jump_Start`/`Jump_Loop`/`Jump_Land` are a standing jump; UAL2's `NinjaJump_*` is a stylised tuck with the arms swept back.
- **Mesh2Motion** (https://github.com/Mesh2Motion/mesh2motion-app, `static/animations/human-addon-animations.glb` at commit `653a9698`, SHA-256 `a0d64d555e0d492026b72d58bf8e16c5e86779295f9093e376dcc001915c2c95`; art CC0 per its README and `LICENSE-CC0.MD`, its source repository `Mesh2Motion/mesh2motion-assets` is CC0-1.0): the same 65-joint skeleton (rest angles differ slightly), but its `Run Jump` is one held pose (two keyframes), and `Jump_2` is a standing tuck jump. Its `Ledge Hang`, `Climb Wall`, `Climb Ladder`, `Ladder_Idle` and `Pipe Climb` are candidates for step 2's climbing.

KayKit Character Pack: Adventurers 1.0 (Kay Lousberg, CC0,
https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0). It has every clip we need, but its
characters are chibi (legs about a fifth of their height): matched to its own clips, its run covers about 1.4 m/s at
human height, too slow for a runner across a city.

## Code

- **Rapier** (`@dimforge/rapier3d-compat` 0.19.3, https://github.com/dimforge/rapier.js), the physics engine and character controller, bundled into the Streets chunk. Copyright Dimforge EURL and contributors, Apache License 2.0; the licence text ships beside this file as `LICENSE-rapier.txt`.
