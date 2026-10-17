"""Mean linear albedo of every kit texture set, for the game's far LOD (drawn with vertex colours, no textures):
reads build/kit/textures/<set>/<set>_bc.png (or _bca.png, weighted by alpha) and writes scripts/streets/kit/means.json,
which pack.ts copies into kit.json's materials as `mean`. Run: build/kit/venv/bin/python -I scripts/streets/kit/means.py
"""
import json
import os
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
TEX = os.path.join(ROOT, 'build', 'kit', 'textures')
OUT = os.path.join(ROOT, 'scripts', 'streets', 'kit', 'means.json')


def lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def main():
    out = {}
    for s in sorted(os.listdir(TEX)):
        f = os.path.join(TEX, s, s + '_bca.png')
        if not os.path.exists(f):
            f = os.path.join(TEX, s, s + '_bc.png')
        if not os.path.exists(f):
            continue
        im = np.asarray(Image.open(f).convert('RGBA').resize((256, 256), Image.BOX), dtype=np.float64)
        a = im[..., 3] / 255.0
        w = a if a.min() < 0.99 else np.ones_like(a)
        m = (lin(im[..., :3]) * w[..., None]).sum((0, 1)) / max(float(w.sum()), 1.0)
        out[s] = [round(float(v), 4) for v in m]
    with open(OUT, 'w') as fh:
        json.dump(out, fh, indent=1)
    print('means for', len(out), 'sets ->', os.path.relpath(OUT, ROOT))


main()
