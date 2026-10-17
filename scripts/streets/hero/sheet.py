# Contact sheet: tiles PNG renders into one image (Blender's image API, so no extra Python packages).
#   Blender -b --python sheet.py -- --out=<sheet.png> --cols=4 --w=480 <img> <img> ...
import os
import sys
import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
opts = {a[2:].split('=')[0]: a.split('=', 1)[1] for a in argv if a.startswith('--')}
files = [a for a in argv if not a.startswith('--')]
cols = int(opts.get('cols', '4'))
W = int(opts.get('w', '480'))
tiles = []
for f in files:
    im = bpy.data.images.load(f)
    w, h = im.size
    H = int(round(h * W / w))
    im.scale(W, H)
    px = np.array(im.pixels[:], dtype=np.float32).reshape(H, W, 4)
    tiles.append(px)
    bpy.data.images.remove(im)
th = max(t.shape[0] for t in tiles)
rows = (len(tiles) + cols - 1) // cols
sheet = np.ones((rows * th, cols * W, 4), dtype=np.float32) * np.array([0.08, 0.08, 0.08, 1.0], dtype=np.float32)
for i, t in enumerate(tiles):
    r, c = divmod(i, cols)
    y0 = (rows - 1 - r) * th + (th - t.shape[0])
    sheet[y0:y0 + t.shape[0], c * W:(c + 1) * W] = t
out = bpy.data.images.new('sheet', cols * W, rows * th, alpha=True)
out.pixels = sheet.ravel()
out.filepath_raw = opts['out']
out.file_format = 'PNG'
out.save()
print('sheet', opts['out'])
