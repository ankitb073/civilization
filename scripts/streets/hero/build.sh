#!/usr/bin/env bash
# Builds the realistic hero of Runner of the Tablet House (#/streets) from its sources:
#   atlas/public/game/streets/hero/hero.glb       LOD0 (~39k triangles, 2K skin), every clip of runner.glb
#   atlas/public/game/streets/hero/hero_lod1.glb  LOD1 for phones (~10k triangles, 1K skin)
# Sources, licences and hashes: atlas/public/game/streets/hero/LICENSES.md. Everything downloaded is data, kept in its
# own folder under build/hero/src and checked against its SHA-256; no script that comes with it is run. MPFB (the
# MakeHuman extension, from extensions.blender.org) is installed into a sandboxed Blender profile under
# build/hero/blender-user, never into the user's own Blender.
#
# Steps (each reads the one before; STEPS="human skin" runs only those):
#   fetch     download and verify the sources                                   build/hero/src/<source>/
#   tools     gltf-transform, meshoptimizer, pngjs for the Node steps           build/hero/tools/
#   skeleton  runner.glb's skeleton and clips, decompressed (skeleton.ts)       build/hero/work/skeleton.json
#   hdri      the late-afternoon sky without its sun (hdri.py)                  build/hero/work/env_*.hdr
#   human     MPFB body fitted and bound to the UAL skeleton (human.py)         build/hero/work/human.blend, bind.json
#   skin      skin maps (skin.py)                                               build/hero/work/tex/skin_*.png
#   face      eyes, brows, lashes, cropped hair (face.py)                       build/hero/work/face.blend
#   gear      kilt (cloth sim), belt, satchel, tablets, sandals (gear.py)       build/hero/work/hero.blend
#   lod       LOD1 (lod.py)                                                     build/hero/work/hero.blend
#   export    skinned meshes without clips, per LOD (export.py)                 build/hero/work/meshes-lod*.glb
#   assemble  on runner.glb's skeleton and clips, materials, compression        build/hero/work/hero*.glb
#   publish   copy the two GLBs into atlas/public/game/streets/hero/
#   render    Blender (Cycles) renders of every shot in shots.json (render.py)  build/hero/renders/blender*/
#   shoot     three.js 0.185.1 renders, every clip, joint check (hero-shoot.ts) build/hero/renders/three*/
#   sheets    contact sheets of both (sheet.py)                                 build/hero/renders/sheet-*.png
# Dev tools beside them: preview.py (a .blend in its bind pose, portrait and body), sheet.py (contact sheets),
# shots.json (the shots both renderers take), atlas/dev/hero.html (the three.js harness, by hand on `npm run dev`).
# Needs: Blender 5.2 (BLENDER=...), Node 24, curl, unzip, shasum, cwebp (and basisu for KTX2=1).
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
HS=$REPO/scripts/streets/hero
W=$REPO/build/hero
B=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
export BLENDER_USER_RESOURCES=$W/blender-user
STEPS=${STEPS:-fetch tools skeleton hdri human skin face gear lod export assemble publish render shoot sheets}
step() { [[ " $STEPS " == *" $1 "* ]]; }
blender() { "$B" -b "$@" > "$W/work/last-blender.log" 2>&1 || { tail -40 "$W/work/last-blender.log"; exit 1; }; grep -E '^HERO' "$W/work/last-blender.log" || true; }
mkdir -p "$W/src" "$W/work" "$W/tools"

get() { # dir file url sha256
  mkdir -p "$W/src/$1"
  local f="$W/src/$1/$2"
  [[ -f "$f" ]] || curl -fsSL -o "$f" "$3"
  echo "$4  $f" | shasum -a 256 -c - >/dev/null || { echo "checksum mismatch: $f"; exit 1; }
}

if step fetch; then
  get mpfb add-on-mpfb-v2.0.18.zip \
    https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/add-on-mpfb-v2.0.18.zip \
    c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad
  get mh_system_assets makehuman_system_assets_cc0.zip \
    https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip \
    b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107
  get mh_skins02 skins02_cc0.zip https://files.makehumancommunity.org/asset_packs/skins02/skins02_cc0.zip \
    1613f1ef3afca53094511d26620ed7cf1d2dedc29ed3d384d60bdebe250698ae
  get hdri kiara_8_sunset_1k.hdr https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kiara_8_sunset_1k.hdr \
    b26b18fd296c5a5044a36eddfc210bb2125c94d185675eb43aae61a01510e61e
  get hdri kiara_8_sunset_2k.hdr https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kiara_8_sunset_2k.hdr \
    74842b3235b3c044d653718b1021beb32bd857618073258213da999113e4d57d
  # MPFB into the sandboxed profile; the asset packs (models, textures, material and proxy files; no code) into its
  # user data folder, where MPFB's own "install asset pack" would put them
  if [[ ! -d "$BLENDER_USER_RESOURCES/extensions/user_default/mpfb" ]]; then
    "$B" -b --command extension install-file -r user_default --enable "$W/src/mpfb/add-on-mpfb-v2.0.18.zip" > /dev/null
  fi
  D=$BLENDER_USER_RESOURCES/extensions/.user/user_default/mpfb/data
  mkdir -p "$D"
  if [[ ! -d "$D/skins/mindfront_skin_male_african_middleage" ]]; then
    unzip -o -q "$W/src/mh_system_assets/makehuman_system_assets_cc0.zip" -d "$D"
    unzip -o -q "$W/src/mh_skins02/skins02_cc0.zip" -d "$D"
  fi
fi

if step tools && [[ ! -d "$W/tools/node_modules/@gltf-transform/core" ]]; then
  (cd "$W/tools" && npm init -y >/dev/null && npm pkg set type=module && \
    npm i @gltf-transform/core@4.5.0 @gltf-transform/functions@4.5.0 @gltf-transform/extensions@4.5.0 meshoptimizer@0.25.0 pngjs@7.0.0 >/dev/null)
fi
cp "$HS/skeleton.ts" "$HS/assemble.ts" "$W/tools/"

step skeleton && (cd "$W/tools" && node skeleton.ts --runner="$REPO/atlas/public/game/streets/runner.glb" --out="$W/work")
step hdri && blender --factory-startup --python "$HS/hdri.py"
step human && blender --python "$HS/human.py"
step skin && blender "$W/work/human.blend" --python "$HS/skin.py"
step face && blender "$W/work/human.blend" --python "$HS/face.py"
step gear && blender "$W/work/face.blend" --python "$HS/gear.py"
step lod && blender "$W/work/hero.blend" --python "$HS/lod.py"
if step export; then
  for L in 0 1; do blender "$W/work/hero.blend" --python "$HS/export.py" -- --lod=$L --out="$W/work/meshes-lod$L.glb"; done
fi
if step assemble; then
  K=${KTX2:+--ktx2}
  (cd "$W/tools" && node assemble.ts --runner="$REPO/atlas/public/game/streets/runner.glb" --meshes="$W/work/meshes-lod0.glb" \
      --bind="$W/work/bind.json" --tex="$W/work/tex" --out="$W/work/hero.glb" --raw="$W/work/hero-raw.glb" $K 2>&1 | grep -v '^prune\|^dedup\|quantize: Skipping')
  (cd "$W/tools" && node assemble.ts --runner="$REPO/atlas/public/game/streets/runner.glb" --meshes="$W/work/meshes-lod1.glb" \
      --bind="$W/work/bind.json" --tex="$W/work/tex" --size=1024 --out="$W/work/hero_lod1.glb" --raw="$W/work/hero_lod1-raw.glb" $K 2>&1 | grep -v '^prune\|^dedup\|quantize: Skipping')
fi
if step publish; then
  mkdir -p "$REPO/atlas/public/game/streets/hero"
  cp "$W/work/hero.glb" "$W/work/hero_lod1.glb" "$REPO/atlas/public/game/streets/hero/"
  # the tiling pore normal for the game's optional skin patch (not part of the glTF materials)
  cwebp -quiet -q 92 -m 6 -sharp_yuv "$W/work/tex/skin_detail_normal.png" -o "$REPO/atlas/public/game/streets/hero/hero_skin_detail.webp"
  shasum -a 256 "$REPO/atlas/public/game/streets/hero/"*.glb "$REPO/atlas/public/game/streets/hero/"*.webp
fi
if step render; then
  blender --python "$HS/render.py" -- --glb="$W/work/hero-raw.glb" --out="$W/renders/blender" --sss=1 --samples=${SAMPLES:-160} --res=1200x1500
  blender --python "$HS/render.py" -- --glb="$W/work/hero_lod1-raw.glb" --out="$W/renders/blender-lod1" --sss=1 --samples=64 --res=780x1688 \
    --shots=idle-game,run-game,jump-game,idle-three,run-three,hang-three,climb-back,idle-close
fi
if step shoot; then
  node "$REPO/atlas/dev/hero-shoot.ts" --glb=/game/streets/hero/hero.glb --out="$W/renders/three" --size=1200x1500
  node "$REPO/atlas/dev/hero-shoot.ts" --glb=/game/streets/hero/hero_lod1.glb --out="$W/renders/three-lod1" --size=390x844 \
    --shots=idle-game,run-game,jump-game,idle-three,run-three,hang-three,climb-back,idle-close
fi
if step sheets; then
  R=$W/renders
  sheet() { local out=$1 cols=$2 w=$3; shift 3; "$B" -b --factory-startup --python "$HS/sheet.py" -- --out="$R/$out" --cols=$cols --w=$w "$@" 2>&1 | grep -E '^sheet' || true; }
  for k in blender three; do
    d=$R/$k
    sheet sheet-$k-game.png 3 520 $d/{idle-game,run-game,jump-game,climb-back,hang-back,ladder-back}.png
    sheet sheet-$k-poses.png 5 400 $d/{idle-three,walk-three,jog-three,run-three,run-side,jump-side,jump-three,land-three,climb-three,hang-three,mantle-side,pull-side,roll-side,hop-three,bind-three}.png
    sheet sheet-$k-close.png 3 560 $d/{idle-portrait,idle-close,run-close,hang-close,idle-hands,climb-hands}.png
    sheet sheet-$k-deform.png 3 520 $d/{hang-shoulders,climb-shoulders,pull-shoulders,run-hips,jump-hips,roll-hips,land-knees,mantle-knees,run-knees}.png
  done
  sheet sheet-compare.png 4 420 $R/blender/run-game.png $R/three/run-game.png $R/blender/idle-three.png $R/three/idle-three.png \
    $R/blender/hang-three.png $R/three/hang-three.png $R/blender/idle-close.png $R/three/idle-close.png
  sheet sheet-lod1.png 8 260 $R/three-lod1/{idle-game,run-game,jump-game,idle-three,run-three,hang-three,climb-back,idle-close}.png \
    $R/blender-lod1/{idle-game,run-game,jump-game,idle-three,run-three,hang-three,climb-back,idle-close}.png
fi
