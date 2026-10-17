# Step 6 of the hero build: LOD1 for phones (about 10k triangles; assemble.ts gives it 1K textures). Every mesh is
# copied and decimated (Blender's collapse decimation, which carries UVs, vertex colours and weights along), the face
# and hands kept denser than the rest; the eyelashes go, and the eyes lose their glass cornea (whose transmission pass
# phones should not pay for) for a glossier eyeball. Objects are tagged lod=0 / lod=1 for export.py.
#   Blender -b build/hero/work/hero.blend --python lod.py   (saves in place)
import os
import sys
sys.dont_write_bytecode = True  # no __pycache__ in the repo
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import bpy
import hero_common as H

A = H.args()
arm = bpy.data.objects['UAL_bind']
RATIO = {'Body': 0.235, 'Hair': 0.2, 'Kilt': 0.5, 'Leather': 0.4, 'Tablets': 0.6, 'Eyes': 0.3, 'Brows': 1.0}
DROP = {'Lashes', 'Corneas'}


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


for o in [o for o in bpy.data.objects if o.get('lod') == '1']:  # a re-run starts over
    bpy.data.objects.remove(o, do_unlink=True)
src = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm]
total = 0
for o in src:
    o['lod'] = '0'
    if o.name in DROP:
        continue
    c = o.copy()
    c.data = o.data.copy()
    c.name = c.data.name = o.name + '_LOD1'
    bpy.context.scene.collection.objects.link(c)
    c['lod'] = '1'
    r = RATIO.get(o.name, 0.5)
    if r < 1.0:
        # protect the face and hands a little: decimation weighted by a vertex group
        if o.name == 'Body':
            g = c.vertex_groups.new(name='keep')
            gi = {x.name: x.index for x in c.vertex_groups}
            for v in c.data.vertices:
                w = 0.0
                for gg in v.groups:
                    n = c.vertex_groups[gg.group].name
                    if n == 'Head' or n.startswith(('hand_', 'index_', 'middle_', 'ring_', 'pinky_', 'thumb_')):
                        w += gg.weight
                g.add([v.index], 1.0 - 0.6 * min(1.0, w), 'REPLACE')
        md = c.modifiers.new('Decimate', 'DECIMATE')
        md.decimate_type = 'COLLAPSE'
        md.ratio = r
        md.use_collapse_triangulate = True
        if o.name == 'Body':
            md.vertex_group = 'keep'
            md.vertex_group_factor = 1.0
        # the decimate must run before the armature (it is evaluated on the bind pose)
        bpy.context.view_layer.objects.active = c
        while c.modifiers[0] != md:
            bpy.ops.object.modifier_move_up(modifier=md.name)
        bpy.ops.object.modifier_apply(modifier=md.name)
        if 'keep' in c.vertex_groups:
            c.vertex_groups.remove(c.vertex_groups['keep'])
    if o.name == 'Eyes':
        m = bpy.data.materials.get('eye_glossy') or bpy.data.materials['eye'].copy()
        m.name = 'eye_glossy'
        c.data.materials.clear()
        c.data.materials.append(m)
    total += tris(c)
    print(f'HERO LOD1 {c.name}: {tris(o)} → {tris(c)} triangles')
print('HERO LOD1 total', total)
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
