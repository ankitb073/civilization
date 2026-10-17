#!/bin/zsh
# Rebuild the whole streets kit from its sources, in order. Run from the repo root:  zsh scripts/streets/kit/build_all.sh
# Needs: Blender 5.2 (/Applications/Blender.app), basisu (Homebrew), python3, node >= 24.
# Scratch tools live in build/kit (a Python venv with numpy/scipy/Pillow, and node modules for glTF-Transform).
set -euo pipefail
ROOT=${0:A:h:h:h:h}
cd "$ROOT"
BL=/Applications/Blender.app/Contents/MacOS/Blender
KIT=scripts/streets/kit

# 0. tools (once)
[ -x build/kit/venv/bin/python ] || { python3 -m venv build/kit/venv && build/kit/venv/bin/pip install -q pillow numpy scipy; }
if [ ! -d build/kit/node/node_modules/@gltf-transform ]; then
  mkdir -p build/kit/node && (cd build/kit/node && npm init -y >/dev/null && npm pkg set type=module && \
    npm i @gltf-transform/core@4.5.0 @gltf-transform/functions@4.5.0 @gltf-transform/extensions@4.5.0 meshoptimizer@0.25.0)
fi

# 1. CC0 sources (Poly Haven), into build/kit/downloads (untrusted data: images and models only)
python3 -I $KIT/fetch_polyhaven.py

# 2. textures (tileable PBR sets) into build/kit/textures; the foliage atlas is rendered in Blender first
for t in textures_arch textures_props textures_struct; do build/kit/venv/bin/python -I $KIT/$t.py; done
$BL -b --factory-startup --python $KIT/textures_veg.py -- --render
build/kit/venv/bin/python -I $KIT/textures_veg.py post

# 3. geometry: each pack exports build/kit/export/<pack>.glb and build/kit/stats/<pack>.json
for b in build_arch build_props build_props_struct build_veg; do
  $BL -b --factory-startup --python $KIT/$b.py
done

# 4. KTX2 (both tiers), then pack: atlas/public/game/streets/kit/{<pack>.gltf,<pack>.lo.gltf,<pack>.bin,tex/,kit.json}
build/kit/venv/bin/python -I $KIT/encode_textures.py
build/kit/venv/bin/python -I $KIT/means.py
cp $KIT/pack.ts build/kit/node/pack.ts && (cd build/kit/node && node pack.ts --root=../../..)
python3 -I $KIT/build_licenses.py

# 5. review: contact sheets (+ LOD strips), the test street, and the packed kit in a browser
for p in arch props props_struct veg; do
  $BL -b --factory-startup --python $KIT/render_sheet.py -- --pack=$p --lods
done
$BL -b --factory-startup --python $KIT/test_street.py -- --views=street,third,roof,gate,door,roofwalk
node $KIT/verify.ts
