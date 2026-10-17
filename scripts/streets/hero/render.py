# Renders the hero as shipped (a decompressed copy of hero.glb, imported with Blender's glTF importer, so the export
# is what is checked) posed at moments of its clips, in Cycles, under the warm late-afternoon HDRI (Poly Haven's
# Kiara 8 Sunset, CC0) with a matching sun, from the game's camera distance and in close-up.
#   Blender -b --python render.py -- --glb=<hero-plain.glb> --out=<dir> [--shots=all|name,name] [--samples=128]
#     [--sss=0|1] (Blender-only subsurface on the skin, off by default so the render shows what the glTF says)
#     [--res=1600x1000] [--sheet] (also a contact sheet)
import os
import sys
sys.dont_write_bytecode = True  # no __pycache__ in the repo
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import json
import math
import bpy
from mathutils import Vector
import hero_common as H

A = H.args()
GLB = A['glb']
OUT = A.get('out', os.path.join(H.BUILD, 'renders', 'blender'))
SAMPLES = int(A.get('samples', '128'))
RES = tuple(int(x) for x in A.get('res', '1600x1000').split('x'))
FPS = 30

# name: (clip, seconds, camera, extra)
#   cameras: game = the follow camera (behind and above, ~3.2 m), three = front three-quarter at 2.6 m, side = profile,
#   close = head and shoulders, hands = the hands
SHOTS = {k: tuple(v) for k, v in json.load(open(os.path.join(H.HERE, 'shots.json')))['shots'].items()}
want = list(SHOTS) if A.get('shots', 'all') == 'all' else A['shots'].split(',')

H.clear_scene()
sc = bpy.context.scene
sc.render.fps = FPS
H.setup_cycles(samples=SAMPLES, res=RES)
sc.cycles.use_denoising = True
# light: the sun-less sky (hdri.py) and a warm sun lamp 20° up, from his right and a little ahead (hero_common.KEY_*)
H.world_hdri(strength=float(A.get('hdri', '0.6')))
H.key_sun(strength=float(A.get('sunk', '6.5')))
g = H.ground(60.0, color=(0.30, 0.235, 0.17), rough=0.95)

bpy.ops.import_scene.gltf(filepath=GLB, import_shading='NORMALS', bone_heuristic='TEMPERANCE', guess_original_bind_pose=True)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm]
print('HERO imported', arm.name, [m.name for m in meshes], 'actions', [a.name for a in bpy.data.actions])

DETAIL = os.path.join(H.WORK, 'tex', 'skin_detail_normal.png')
if A.get('sss', '0') == '1':
    # the beauty renders: Cycles' own subsurface scattering on the skin (three.js gets the cheaper hints of the
    # harness's skinShader), and the same tiling pore normal the game's skin patch adds for close-ups
    for o in meshes:
        for s in o.material_slots:
            m = s.material
            if not (m and 'skin' in m.name.lower()):
                continue
            nt = m.node_tree
            b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
            b.inputs['Subsurface Weight'].default_value = 0.2
            b.inputs['Subsurface Radius'].default_value = (1.0, 0.36, 0.18)
            b.inputs['Subsurface Scale'].default_value = 0.012
            if os.path.exists(DETAIL) and b.inputs['Normal'].is_linked:
                base_n = b.inputs['Normal'].links[0].from_socket
                uv = nt.nodes.new('ShaderNodeUVMap')
                mp = nt.nodes.new('ShaderNodeMapping')
                mp.inputs['Scale'].default_value = (32, 32, 1)
                tx = nt.nodes.new('ShaderNodeTexImage')
                tx.image = bpy.data.images.load(DETAIL, check_existing=True)
                tx.image.colorspace_settings.name = 'Non-Color'
                nm = nt.nodes.new('ShaderNodeNormalMap')
                nm.inputs['Strength'].default_value = 0.35
                geo = nt.nodes.new('ShaderNodeNewGeometry')
                add = nt.nodes.new('ShaderNodeVectorMath')
                add.operation = 'ADD'
                sub = nt.nodes.new('ShaderNodeVectorMath')
                sub.operation = 'SUBTRACT'
                nor = nt.nodes.new('ShaderNodeVectorMath')
                nor.operation = 'NORMALIZE'
                L = nt.links
                L.new(uv.outputs['UV'], mp.inputs['Vector'])
                L.new(mp.outputs['Vector'], tx.inputs['Vector'])
                L.new(tx.outputs['Color'], nm.inputs['Color'])
                L.new(base_n, add.inputs[0])
                L.new(nm.outputs['Normal'], add.inputs[1])
                L.new(add.outputs['Vector'], sub.inputs[0])
                L.new(geo.outputs['Normal'], sub.inputs[1])
                L.new(sub.outputs['Vector'], nor.inputs[0])
                L.new(nor.outputs['Vector'], b.inputs['Normal'])

def action_for(clip):
    for a in bpy.data.actions:
        if a.name == clip or a.name.startswith(clip + '_') or a.name.endswith('_' + clip):
            return a
    raise KeyError(clip)

ad = arm.animation_data or arm.animation_data_create()
for tr in list(ad.nla_tracks):
    ad.nla_tracks.remove(tr)

def bone_world(name):
    pb = arm.pose.bones[name]
    return arm.matrix_world @ pb.head

def place_camera(kind):
    hips = bone_world('pelvis')
    head = bone_world('Head')
    chest = bone_world('spine_03')
    fwd = Vector((0, -1, 0))  # glTF +z forward → Blender -y
    if kind == 'game':
        return H.camera(hips + Vector((0.9, 3.0, 1.15)), chest + Vector((0, 0, 0.1)), lens=32)
    if kind == 'three':
        return H.camera(hips + Vector((-1.5, -2.1, 0.55)), hips + Vector((0, 0, 0.12)), lens=40)
    if kind == 'side':
        return H.camera(hips + Vector((-3.0, 0.0, 0.35)), hips + Vector((0, 0, 0.1)), lens=45)
    if kind == 'back':
        return H.camera(hips + Vector((1.2, 2.6, 0.9)), (hips + head) / 2, lens=40)
    if kind == 'close':
        return H.camera(head + Vector((-0.28, -0.72, 0.02)), head + Vector((0, 0, 0.06)), lens=85)
    if kind == 'portrait':
        return H.camera(head + Vector((0.1, -0.85, 0.05)), head + Vector((0, 0, 0.07)), lens=100)
    if kind == 'shoulders':
        return H.camera(chest + Vector((-0.9, -1.25, 0.25)), chest + Vector((0, 0, 0.12)), lens=55)
    if kind == 'shoulders_back':
        return H.camera(chest + Vector((0.45, 1.05, 0.2)), chest + Vector((0, 0, 0.05)), lens=50)
    if kind == 'hips_side':
        return H.camera(hips + Vector((-1.25, -0.25, 0.0)), hips + Vector((0, 0, -0.08)), lens=50)
    if kind == 'knees':
        return H.camera(hips + Vector((-0.65, -1.0, -0.3)), hips + Vector((0, 0, -0.42)), lens=50)
    if kind == 'hands':
        hl = (bone_world('hand_l') + bone_world('middle_01_l')) / 2
        return H.camera(hl + Vector((0.25, -0.55, 0.18)), hl, lens=60)
    raise KeyError(kind)

done = []
for name in want:
    clip, t, cam = SHOTS[name]
    if clip in ('bind', 'rest'):
        # bind: the pose the mesh was bound in (the importer's rest); rest: the skeleton's own rest (UAL's T-pose)
        ad.action = None
        for pb in arm.pose.bones:
            pb.matrix_basis.identity()
        if clip == 'rest':
            for pb in arm.pose.bones:
                if pb.get('rest_basis') is not None:
                    pass
        sc.frame_set(0)
    else:
        ad.action = action_for(clip)
        if hasattr(ad, 'action_slot') and ad.action.slots:
            ad.action_slot = ad.action.slots[0]
        f = t * FPS
        sc.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
    for o in list(bpy.data.objects):
        if o.type == 'CAMERA':
            bpy.data.objects.remove(o, do_unlink=True)
    place_camera(cam)
    path = os.path.join(OUT, f'{name}.png')
    H.render(path)
    done.append(path)
print('HERO rendered', len(done))
