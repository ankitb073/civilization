# The light for every hero render (Blender and three.js): Poly Haven's "Kiara 8 Sunset" (Greg Zaal, CC0) with its sun
# disc taken out, so the sky gives the ambient light and one sun lamp (set by the renderer, as the game's own sun is)
# gives the key. The HDRI's sun sits 3.6° above the horizon, a sunset; the lamp is placed higher for the late
# afternoon. Writes build/hero/work/env_<size>.hdr and env.json (where the removed sun was, and its colour).
#   Blender -b --factory-startup --python hdri.py
import os
import sys
sys.dont_write_bytecode = True  # no __pycache__ in the repo
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import json
import math
import bpy
import numpy as np
import hero_common as H

info = {}
for size in ('1k', '2k'):
    src = os.path.join(H.SRC, 'hdri', f'kiara_8_sunset_{size}.hdr')
    im = bpy.data.images.load(src)
    w, h = im.size
    px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
    lum = px[..., :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    sky = np.percentile(lum, 99.0)
    cap = sky * 1.5
    hot = lum > cap
    y, x = np.unravel_index(np.argmax(lum), lum.shape)
    removed = (px[..., :3][hot] - px[..., :3][hot] * (cap / lum[hot])[:, None]).sum(0)
    px[..., :3][hot] *= (cap / lum[hot])[:, None]
    out = bpy.data.images.new(f'env_{size}', w, h, alpha=False, float_buffer=True)
    out.pixels = px.ravel()
    path = os.path.join(H.WORK, f'env_{size}.hdr')
    out.filepath_raw = path
    out.file_format = 'HDR'
    out.save()
    u, v = (x + 0.5) / w, (y + 0.5) / h
    az, el = (u - 0.5) * 2 * math.pi, (v - 0.5) * math.pi
    info[size] = {'file': path, 'clampedPixels': int(hot.sum()), 'cap': float(cap),
                  'sunDirBlender': [-math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)],
                  'sunElevationDeg': math.degrees(el), 'sunColor': (removed / removed.max()).tolist()}
    print('HDRI', size, info[size])
H.save_json(os.path.join(H.WORK, 'env.json'), info)
