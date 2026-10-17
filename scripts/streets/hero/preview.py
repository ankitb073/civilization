# Quick look at a hero .blend in its bind pose (no clips): portrait front, three-quarter and profile, and full body.
# With --tex=<dir> it uses the baked maps there (skin_basecolor/normal/orm.png); otherwise MakeHuman's source skin.
#   Blender -b <file.blend> --python preview.py -- --out=<dir> [--samples=64] [--tex=<dir>] [--views=front,three,side,body]
import os
import sys
sys.dont_write_bytecode = True  # no __pycache__ in the repo
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import hero_common as H

A = H.args()
OUT = A.get('out', os.path.join(H.WORK, 'preview'))
VIEWS = A.get('views', 'front,three,side,body').split(',')
sc = bpy.context.scene
H.setup_cycles(samples=int(A.get('samples', '64')), res=(900, 1100))
H.world_hdri(strength=float(A.get('hdri', '0.6')))
H.key_sun(strength=float(A.get('sunk', '6.5')))
H.ground(60.0, color=(0.30, 0.235, 0.17), rough=0.95)

body = bpy.data.objects['Body']
SK = os.path.join(H.BUILD, 'blender-user', 'extensions', '.user', 'user_default', 'mpfb', 'data', 'skins',
                  'mindfront_skin_male_african_middleage')
TEX = A.get('tex')


def img(path, non_color=False):
    im = bpy.data.images.load(path, check_existing=True)
    if non_color:
        im.colorspace_settings.name = 'Non-Color'
    return im


def skin_material():
    m = bpy.data.materials.new('preview_skin')
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tc = nt.nodes.new('ShaderNodeTexImage')
    nm = nt.nodes.new('ShaderNodeTexImage')
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    if TEX:
        tc.image = img(os.path.join(TEX, 'skin_basecolor.png'))
        nm.image = img(os.path.join(TEX, 'skin_normal.png'), True)
        orm = nt.nodes.new('ShaderNodeTexImage')
        orm.image = img(os.path.join(TEX, 'skin_orm.png'), True)
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
    else:
        tc.image = img(os.path.join(SK, 'skin_male_african_middleage.png'))
        nm.image = img(os.path.join(SK, 'skin_male_african_middleage_NRM.png'), True)
        b.inputs['Roughness'].default_value = 0.5
        nmap.inputs['Strength'].default_value = 0.6
    nt.links.new(tc.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(nm.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Subsurface Weight'].default_value = 0.2
    b.inputs['Subsurface Radius'].default_value = (1.0, 0.36, 0.18)
    b.inputs['Subsurface Scale'].default_value = 0.012
    b.inputs['IOR'].default_value = 1.4
    return m


if A.get('keepmat', '0') != '1':
    body.data.materials.clear()
    body.data.materials.append(skin_material())

arm = bpy.data.objects['UAL_bind']
head = arm.matrix_world @ arm.data.bones['Head'].head_local
eyes = head + Vector((0, -0.02, 0.085))
hips = arm.matrix_world @ arm.data.bones['pelvis'].head_local
cams = {
    'front': (eyes + Vector((0.0, -0.75, 0.0)), eyes + Vector((0, 0, -0.02)), 85),
    'three': (eyes + Vector((-0.45, -0.62, 0.02)), eyes + Vector((0, 0, -0.02)), 85),
    'side': (eyes + Vector((-0.78, -0.02, 0.0)), eyes + Vector((0, 0, -0.02)), 85),
    'body': (hips + Vector((-1.2, -3.0, 0.45)), hips + Vector((0, 0, 0.0)), 45),
    'torso': (hips + Vector((-0.6, -1.5, 0.5)), hips + Vector((0, 0, 0.35)), 55),
    'back': (hips + Vector((1.3, 2.6, 0.5)), hips + Vector((0, 0, 0.1)), 45),
    'kilt': (hips + Vector((-0.5, -1.2, -0.1)), hips + Vector((0, 0, -0.12)), 50),
    'feet': (hips + Vector((-0.35, -0.75, -0.65)), hips + Vector((0.0, -0.05, -0.88)), 50),
    'bag': (hips + Vector((1.0, 0.7, 0.2)), hips + Vector((0.12, 0.08, 0.0)), 50),
}
if A.get('white') == '1':
    for m in body.data.materials:
        for l in list(m.node_tree.links):
            if l.to_node.type == 'BSDF_PRINCIPLED' and l.to_socket.name == 'Base Color':
                m.node_tree.links.remove(l)
        next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (0.5, 0.5, 0.5, 1)
if A.get('nonormal') == '1':
    for m in body.data.materials:
        for l in list(m.node_tree.links):
            if l.to_node.type == 'BSDF_PRINCIPLED' and l.to_socket.name == 'Normal':
                m.node_tree.links.remove(l)
for v in VIEWS:
    for o in list(bpy.data.objects):
        if o.type == 'CAMERA':
            bpy.data.objects.remove(o, do_unlink=True)
    loc, tgt, lens = cams[v]
    H.camera(loc, tgt, lens=lens)
    H.render(os.path.join(OUT, f'{v}.png'))
