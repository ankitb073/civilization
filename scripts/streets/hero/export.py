# Step 5 of the hero build: exports the bound meshes of a hero .blend (bound to UAL_bind, whose rest is the bind pose)
# as a skinned glTF without animations, for assemble.ts to put on the game's own skeleton and clips.
#   Blender -b <hero.blend> --python export.py -- --out=<file.glb> [--lod=0|1]
import os
import sys
sys.dont_write_bytecode = True  # no __pycache__ in the repo
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import bpy
import hero_common as H

A = H.args()
OUT = A['out']
LOD = A.get('lod', '0')

arm = bpy.data.objects['UAL_bind']
keep = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm and not o.hide_render
        and o.get('lod', 'all') in ('all', LOD)]
for o in bpy.data.objects:
    o.select_set(False)
arm.select_set(True)
for o in keep:
    o.select_set(True)
bpy.context.view_layer.objects.active = arm
print('HERO export', [o.name for o in keep])
# materials go out as names only: assemble.ts builds them from the maps in build/hero/work/tex
kw = dict(filepath=OUT, export_format='GLB', use_selection=True, export_animations=False, export_skins=True,
          export_morph=False, export_tangents=True, export_yup=True, export_apply=False, export_materials='EXPORT', export_image_format='NONE',
          export_texcoords=True, export_normals=True, export_vertex_color='ACTIVE', export_attributes=False,
          export_def_bones=False, export_rest_position_armature=True)
try:
    bpy.ops.export_scene.gltf(**kw)
except TypeError as e:
    print('HERO export option fallback:', e)
    for k in ('export_rest_position_armature', 'export_def_bones', 'export_attributes', 'export_vertex_color'):
        kw.pop(k, None)
    bpy.ops.export_scene.gltf(**kw)
print('HERO wrote', OUT)
