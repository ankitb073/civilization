"""Render a contact sheet of a kit pack from its exported GLB (so the sheet shows what was exported, not the build
scene): each piece's LOD0 alone on packed earth, from a three-quarter view, in late-afternoon light; then a labelled
sheet. With --lods, also a strip per piece of LOD0 | LOD1 | LOD2.

  Blender -b --factory-startup --python scripts/streets/kit/render_sheet.py -- --pack=arch [--cols=5] [--cell=560]
      [--only=a,b] [--lods] [--samples=64]
Output: build/kit/renders/<pack>/<piece>.png, build/kit/renders/<pack>_sheet.png (and <pack>_lods.png)
"""
import os
import sys
import json
import math
import subprocess
import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import kitlib as K  # noqa: E402

A = K.args()
pack = A['pack']
cols = int(A.get('cols', 5))
cell = int(A.get('cell', 560))
samples = int(A.get('samples', 64))
only = set(A['only'].split(',')) if 'only' in A else None
stats = json.load(open(os.path.join(K.STATS, f'{pack}.json')))
glb = os.path.join(K.EXPORT, stats['file'])
out_dir = os.path.join(K.RENDERS, pack)
os.makedirs(out_dir, exist_ok=True)

K.reset()
bpy.ops.import_scene.gltf(filepath=glb)
for m in list(bpy.data.materials):
    m.name = m.name.split('.')[0] + '_imported'
objs = {o.name: o for o in bpy.context.scene.objects if o.type == 'MESH'}
for o in objs.values():
    # the importer keeps COLOR_0 under another name; previews read 'Col'
    me = o.data
    if 'Col' not in me.color_attributes and len(me.color_attributes):
        me.color_attributes[0].name = 'Col'
    if len(me.color_attributes):
        me.color_attributes.active_color = me.color_attributes['Col']
    for s in o.material_slots:
        if s.material:
            base = s.material.name.split('.')[0].replace('_imported', '')
            try:
                s.material = K.material(base)
            except KeyError:
                pass
    o.hide_render = True
    o.location = (0, 0, 0)

res = (cell, int(cell * 0.75))
K.render_setup(res=res, samples=samples, sun_elev=34, sun_azim=-40, sun_strength=4.0, hdri_strength=0.9)
CULL = 'cull' in A
if CULL:
    # face-orientation check: single-sided like three.js (EEVEE honours back-face culling), seen from two sides
    bpy.context.scene.render.engine = 'BLENDER_EEVEE'
    for m in bpy.data.materials:
        m.use_backface_culling = True
ground = K.ground_plane(size=80)

files = []
for p in stats['pieces']:
    name = p['name']
    if only and name not in only:
        continue
    ob = objs.get(name)
    if not ob:
        print('missing', name)
        continue
    ob.hide_render = False
    view = p.get('view', [-0.75, -1.35, 0.6])
    ground.hide_render = bool(p.get('no_ground')) or CULL
    views = [view] if not CULL else [view, [-view[0] * 0.8, -view[1], 0.9], [0.4, -0.6, -0.7]]
    for vi, vw in enumerate(views):
        cam = K.frame([ob], direction=vw, lens=p.get('lens', 50), margin=1.08)
        tris = p['lods'][0]['tris']
        path = os.path.join(out_dir, f"{name} · {tris} tris.png" if not CULL else f"cull {name} {vi}.png")
        K.render(path)
        files.append(path)
        bpy.data.objects.remove(cam, do_unlink=True)
    ob.hide_render = True

py = os.path.join(K.ROOT, 'build', 'kit', 'venv', 'bin', 'python')
sheet = os.path.join(K.KIT, 'tools', 'sheet.py')
if files:
    subprocess.run([py, '-I', sheet, os.path.join(K.RENDERS, f'{pack}_{"cull" if CULL else "sheet"}.png'), str(cols), str(cell)] + files, check=True)

if 'lods' in A:
    lfiles = []
    ground.hide_render = False
    for p in stats['pieces']:
        name = p['name']
        if only and name not in only:
            continue
        obs = [objs.get(l['node']) for l in p['lods']]
        obs = [o for o in obs if o]
        if not obs:
            continue
        (x0, y0, z0), (x1, y1, z1) = K.bbox(obs[0])
        w = (x1 - x0) * 1.25 + 0.2
        for i, o in enumerate(obs):
            o.location = (i * w, 0, 0)
            o.hide_render = False
        bpy.context.view_layer.update()
        cam = K.frame(obs, direction=p.get('view', [-0.4, -1.4, 0.5]), lens=50, margin=1.05)
        bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = cell * 2, int(cell * 0.75)
        tr = ' - '.join(str(l['tris']) for l in p['lods'])
        path = os.path.join(out_dir, f"lods {name} · {tr}.png")
        K.render(path)
        lfiles.append(path)
        for o in obs:
            o.hide_render = True
            o.location = (0, 0, 0)
        bpy.data.objects.remove(cam, do_unlink=True)
    if lfiles:
        subprocess.run([py, '-I', sheet, os.path.join(K.RENDERS, f'{pack}_lods.png'), '2', str(cell * 2)] + lfiles, check=True)
