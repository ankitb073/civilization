"""Assemble a test street in Pumi's hero district from the exported kit packs and render it (Cycles).

  Blender -b --factory-startup --python scripts/streets/kit/test_street.py -- [--views=street,third,roof,gate]
      [--samples=256] [--res=1920x1080] [--save=build/kit/test_street.blend]

Reads build/kit/export/{arch,props,props_struct,veg}.glb (whichever exist), places pieces exactly as kit.json
documents (Blender frames: exterior faces -Y, x along a run), and adds the runner (atlas/public/game/streets/runner.glb)
for scale. Output: build/kit/renders/street_<view>.png
"""
import os
import sys
import math
import bpy
from mathutils import Vector, Matrix, Euler

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import kitlib as K  # noqa: E402

A = K.args()
VIEWS = A.get('views', 'street,third,roof,gate').split(',')
SAMPLES = int(A.get('samples', 256))
RES = tuple(int(v) for v in A.get('res', '1920x1080').split('x'))

K.reset()
LIB = bpy.data.collections.new('LIB')          # imported source meshes (hidden)
bpy.context.scene.collection.children.link(LIB)
SCN = K.collection('STREET')
SRC = {}
CUR = []


def load_pack(name):
    path = os.path.join(K.EXPORT, f'{name}.glb')
    if not os.path.exists(path):
        print('no pack', name)
        return
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    for m in bpy.data.materials:
        if not m.get('kit_set') or 'imported' in m.name:
            continue
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        LIB.objects.link(o)
        if o.type == 'MESH':
            me = o.data
            if 'Col' not in me.color_attributes and len(me.color_attributes):
                me.color_attributes[0].name = 'Col'
            if len(me.color_attributes):
                me.color_attributes.active_color = me.color_attributes['Col']
            for s in o.material_slots:
                if s.material and not s.material.name.endswith('_imported') and not s.material.get('kit_built'):
                    base = s.material.name.split('.')[0]
                    s.material.name = base + '_imported'
                    try:
                        km = K.material(base)
                        km['kit_built'] = 1
                        s.material = km
                    except KeyError:
                        pass
                elif s.material and s.material.name.endswith('_imported'):
                    base = s.material.name.split('.')[0].replace('_imported', '')
                    try:
                        s.material = K.material(base)
                    except KeyError:
                        pass
            o.location = (0, 0, 0)
            SRC[o.name] = o
    LIB.hide_render = True
    LIB.hide_viewport = True


for p in ('arch', 'props', 'props_struct', 'veg'):
    load_pack(p)


def put(name, x, y, z=0.0, rot=0.0, sx=1.0, sy=1.0, sz=1.0, frame=None):
    """Instance piece `name` (LOD0 unless name has _LODn) at (x, y, z), turned `rot` degrees about z. With a frame
    (origin, rot), coordinates are local to it."""
    src = SRC.get(name)
    if not src:
        return None
    if frame:
        (ox, oy, oz), fr = frame
        c, s = math.cos(math.radians(fr)), math.sin(math.radians(fr))
        x, y = ox + x * c - y * s, oy + x * s + y * c
        z += oz
        rot += fr
    o = bpy.data.objects.new(name + '.i', src.data)
    SCN.objects.link(o)
    CUR.append(o)
    o.location = (x, y, z)
    o.rotation_euler = (0, 0, math.radians(rot))
    o.scale = (sx, sy, sz)
    return o


def run(names, L, frame, z=0.0, sz=1.0, x0=0.5):
    """Fill a side from x0 to L - 0.5 with the named modules, stretched to fit exactly."""
    widths = {'wall_1m': 1, 'wall_1m_b': 1, 'wall_2m_a': 2, 'wall_2m_b': 2, 'wall_2m_c': 2, 'wall_4m_a': 4, 'wall_4m_b': 4,
              'wall_4m_c': 4, 'door_2m': 2, 'door_2m_b': 2, 'door_3m': 3, 'parapet_2m_b': 2,
              'window_2m': 2, 'wallband_1m': 1, 'wallband_2m': 2, 'wallband_4m': 4, 'parapet_1m': 1, 'parapet_2m': 2,
              'roof_edge_2m': 2, 'beam_ends_2m': 2, 'parapet_stepped_2m': 2, 'cwall_2m': 2, 'cwall_4m': 4}
    tot = sum(widths[n] for n in names)
    k = (L - 0.5 - x0) / tot
    x = x0
    out = []
    for n in names:
        out.append(put(n, x, 0, z, 0, k, 1, sz, frame=frame))
        if n in ('door_2m', 'door_2m_b'):
            put('door_leaf_s', x + 0.49 * k, 0.34, z, 35 + 40 * ((len(CUR) * 7) % 3), frame=frame)
        elif n == 'door_3m':
            put('door_leaf_l', x + 0.77 * k, 0.34, z, 70, frame=frame)
            put('door_leaf_l', x + 2.23 * k, 0.34, z, -70, -1, 1, 1, frame=frame)
        x += widths[n] * k
    return out


def house(ox, oy, rot, W, D, sides, storeys=1, band=True, parapet=True, beams=(0, 2), spout=None, hatch=False,
          stair=None, upper=None, seed=0):
    """A house: footprint W x D from its front-left corner (ox, oy), turned rot; sides = 4 lists of wall modules
    (front, right, back, left)."""
    CUR.clear()
    H = 3.0
    top = H + (1.0 if band else 0.0)
    for k, (L, names) in enumerate(((W, sides[0]), (D, sides[1]), (W, sides[2]), (D, sides[3]))):
        c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        corners = [(0, 0), (W, 0), (W, D), (0, D)]
        cx, cy = corners[k]
        fr = ((ox + cx * c - cy * s, oy + cx * s + cy * c, 0.0), rot + 90 * k)
        put('corner_out', 0, 0, 0, frame=fr)
        run(names, L, fr)
        if band:
            put('cornerband', 0, 0, H, frame=fr)
            band_names = []
            for n in names:
                w = {'door_3m': 3}.get(n, None)
                if n in ('wall_1m', 'wall_1m_b'):
                    band_names.append('wallband_1m')
                elif n in ('wall_4m_a', 'wall_4m_b', 'wall_4m_c'):
                    band_names.append('wallband_4m')
                elif n == 'door_3m':
                    band_names += ['wallband_2m', 'wallband_1m']
                else:
                    band_names.append('wallband_2m')
            run(band_names, L, fr, z=H)
        put('roof_edge_corner', 0, 0, top, frame=fr)
        run(['roof_edge_2m'] * max(1, round((L - 1) / 2)), L, fr, z=top)
        if k in beams:
            run(['beam_ends_2m'] * max(1, round((L - 1) / 2)), L, fr, z=top)
        if parapet:
            pfr = ((fr[0][0] + (-0.1) * math.cos(math.radians(fr[1])) - (-0.1) * math.sin(math.radians(fr[1])),
                    fr[0][1] + (-0.1) * math.sin(math.radians(fr[1])) + (-0.1) * math.cos(math.radians(fr[1])), 0.0), fr[1])
            put('parapet_corner', 0, 0, top + 0.4, frame=pfr)
            npar = max(1, round((L + 0.2 - 0.52) / 2))
            run([('parapet_2m', 'parapet_2m_b')[(i + k + seed) % 2] for i in range(npar)], L + 0.2, pfr, z=top + 0.4, x0=0.26)
    # roof field
    c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    fr0 = ((ox, oy, 0.0), rot)
    nx, ny = max(1, round((W - 1) / 2)), max(1, round((D - 1) / 2))
    kx, ky = (W - 1) / (2 * nx), (D - 1) / (2 * ny)
    for i in range(nx):
        for j in range(ny):
            put('roof_field_2m', 0.5 + i * 2 * kx, 0.5 + j * 2 * ky, top, 0, kx, ky, 1, frame=fr0)
    if spout:
        put('drain_spout', spout, -0.1, top + 0.4, frame=fr0)
    if hatch:
        put('roof_hatch', W * 0.65, D * 0.6, top + 0.4, frame=fr0)
    tints = [(1.0, 0.97, 0.93), (0.93, 0.91, 0.9), (1.04, 1.0, 0.94), (0.97, 0.93, 0.87), (1.02, 0.99, 0.97)]
    tc = tints[seed % len(tints)]
    for o in CUR:
        if not o.name.startswith(('door_leaf', 'beam_ends', 'drain', 'ladder')):
            o.color = (*tc, 1.0)
    return top


# ---------------------------------------------------------------- the lane

# north side of the lane (fronts face -Y onto the lane at y = 3.6)
LN = 3.6
tN1 = house(-9.0, LN, 0, 7.0, 6.0, [['wall_2m_a', 'door_2m', 'window_2m'], ['wall_4m_a', 'wall_1m'], ['wall_4m_b', 'wall_2m_a'], ['wall_4m_b', 'wall_1m']],
            spout=5.2, hatch=True, seed=0)
tN2 = house(-0.3, LN + 0.3, 2, 6.0, 7.0, [['door_3m', 'window_2m'], ['wall_4m_a', 'wall_2m_b'], ['wall_4m_a', 'wall_1m'], ['wall_2m_b', 'wall_4m_b']],
            band=False, spout=1.6, seed=1)
tN3 = house(6.0, LN, -1, 7.0, 6.0, [['window_2m', 'wall_2m_c', 'door_2m_b'], ['wall_4m_c', 'wall_1m_b'], ['wall_4m_a', 'wall_2m_a'], ['wall_4m_a', 'wall_1m']],
            spout=2.4, seed=2)
# south side (fronts face +Y: footprint turned 180 deg, its front-left corner at the far end)
tS1 = house(-2.5, -0.2, 180, 7.0, 6.0, [['window_2m', 'door_2m_b', 'wall_2m_c'], ['wall_4m_c', 'wall_1m'], ['wall_4m_a', 'wall_2m_b'], ['wall_4m_a', 'wall_1m_b']],
            spout=3.0, hatch=True, seed=3)
tS2 = house(11.0, -0.4, 181, 8.0, 6.0, [['wall_2m_c', 'door_3m', 'wall_2m_a'], ['wall_4m_c', 'wall_1m'], ['wall_4m_b', 'wall_2m_b', 'wall_1m'], ['wall_4m_b', 'wall_1m_b']],
            band=False, spout=6.0, seed=4)
# a courtyard wall between the south houses, with a free end at the lane mouth
for i, n in enumerate(['cwall_4m', 'cwall_2m']):
    put(n, -2.0 + i * 4.0, -0.4, 0, 0)
put('cwall_end', -3.0, -0.4, 0, 0)
# an external stair up the right side of the first north house (that side is x = -2.0, exterior +X); the flight
# runs along +y (turned 90 deg: its outer side faces +X), stretched to the roof at 4.4 m
put('stair_flight', -2.0, LN + 0.45, 0, 90, 1.2, 1.0, 4.4 / 3.0)
put('stair_landing', -2.0, LN + 0.45 + 3.36 * 1.2, 0, 90, 1.0, 1.0, 4.4 / 3.0)
# a ladder against the south house's front, up to its roof
lad = put('ladder_5m', 1.4, -0.75, 0, 0)
if lad:
    lad.rotation_euler = (math.radians(-14), 0, 0)
# the gate at the end of the lane: two towers, the arch between them, wall runs either side; outside is +X
GX, GY = 34.0, 1.8
for sg in (-1, 1):
    put('gate_tower', GX, GY + sg * 6.0, 0, 90, 1, 1, 1.08)
put('gate_arch', GX, GY - 2.8, 0, 90)
for k in range(3):
    put('citywall_4m', GX, GY + 9.2 + 4 * k, 0, 90)
    put('citywall_4m', GX, GY - 9.2 - 4 * (k + 1), 0, 90)
for sg in (-1, 1):
    # the leaves swung open against the passage walls, hinged at the jambs on the town side
    put('gate_leaf', GX - 1.2, GY + sg * 1.62, 0, 180 if sg > 0 else 180)
# the temple's porch on a small square past the houses (south of the lane), facing the lane (+Y)
for i in range(3):
    put('porch_column', 18.0 + i * 3.4, -3.0, 0, 0)
put('porch_beam_4m', 17.4, -3.0, 3.6, 0, 8.0 / 4.0)
put('porch_roof_4m', 25.6, -2.75, 3.92, 180, 8.4 / 4.0, 1, 1)
run(['wall_4m_a', 'door_3m', 'wall_4m_b'], 12.0, ((26.5, -5.8, 0.0), 180), x0=0.5)
run(['wallband_4m', 'wallband_2m', 'wallband_1m', 'wallband_4m'], 12.0, ((26.5, -5.8, 0.0), 180), z=3.0, x0=0.5)
run(['wallband_4m', 'wallband_2m', 'wallband_1m', 'wallband_4m'], 12.0, ((26.5, -5.8, 0.0), 180), z=4.0, x0=0.5)

# ---------------------------------------------------------------- props and plants (whatever packs exist)
P = SRC


def maybe(name, x, y, z=0.0, rot=0.0, s=1.0):
    return put(name, x, y, z, rot, s, s, s) if name in P else None

# north side (props face -Y, the lane)
maybe('pithos', -7.25, 3.05, 0, 12)
maybe('pithos_chipped', -8.2, 3.12, 0, -40)
maybe('jar_storage', -4.05, 3.3, 0, 30)
maybe('jug_small', -3.65, 3.05, 0, 70)
maybe('basket_tall', -4.6, 3.25, 0, 10)
maybe('sack_open', 2.65, 3.45, 0, 8)
maybe('sack_closed', 3.25, 3.55, 0, -15)
maybe('sack_slumped', 3.9, 3.35, 0, 95)
maybe('basket_grain', 2.0, 3.1, 0, 0)
maybe('tray_winnowing', 1.55, 3.3, 0, 0)
maybe('firewood_stack', 9.6, 3.2, 0, 0)
maybe('loom', 11.6, 3.6, 0, 0)
maybe('jar_broken', -1.5, 2.9, 0, 200)
maybe('shards', -1.2, 2.55, 0, 40)
# south side (props face +Y)
maybe('tannur', -8.4, 0.45, 0, 160)
maybe('jar_storage', -6.2, 0.15, 0, 190)
maybe('bowl_stack', -5.7, 0.3, 0, 0)
maybe('potters_wheel', 5.6, 0.55, 0, 200)
maybe('bowl', 6.4, 0.35, 0, 0)
maybe('jug_small', 4.9, 0.3, 0, 20)
maybe('firewood_bundle', 9.8, 0.25, 0, 190)
maybe('cloth_line', 7.3, 1.0, 0, 0)
# the square by the temple: market, scale, well, cart
maybe('stall_large', 16.2, 5.0, 0, 0)
maybe('stall_lean', 26.5, -5.8, 0, 180)
maybe('scale', 19.0, 1.9, 0, 200)
maybe('cart', 13.2, 2.4, 0, -70)
w = maybe('well_head', 21.5, 5.6, 0, 0)
if w and 'shaduf_pole' in P:
    sp = put('shaduf_pole', 21.5 + 2.3, 5.6, 2.31, 0)
    if sp:
        sp.rotation_euler = (0, 0, 0)
    maybe('shaduf_bucket', 21.5 + 2.3 - 2.2936, 5.6, 2.31 + 1.606, 0)
# roofs: the house of tablets dries its tablets on the roof, sleeping mats on another
maybe('tablet_board', 1.4, 6.6, 3.4, 2)
maybe('tablet_board', 2.9, 6.9, 3.4, 2)
maybe('mat_flat', -6.5, 6.2, 4.4, 8)
maybe('mat_rolled', -5.2, 7.4, 4.4, 80)
maybe('basket_grain', -3.6, 6.0, 4.4, 0)
# plants: palms over the roofs, a fig in the courtyard, grass and weeds at the wall feet
maybe('palm_mature', -5.0, 13.0, 0, 30)
maybe('palm_young', 3.5, 11.5, 0, 140)
maybe('palm_mature', 25.0, 9.5, 0, 200, 0.9)
maybe('fig_tree', -1.0, -3.4, 0, 60)
for i, (x, y, n) in enumerate(((-8.8, 3.45, 'grass_a'), (-2.3, 3.5, 'grass_b'), (5.4, 3.5, 'grass_c'), (12.6, 3.45, 'weed_stalks'),
                               (-9.2, -0.05, 'grass_b'), (-2.8, 0.05, 'weed_thistle'), (2.9, -0.2, 'grass_a'), (10.7, -0.25, 'grass_c'),
                               (-3.6, -0.3, 'grass_a'), (14.5, 3.8, 'weed_thistle'), (30.5, 0.2, 'grass_b'), (30.2, 3.6, 'weed_stalks'))):
    maybe(n, x, y, 0, i * 47)
for i in range(4):
    maybe('reeds_a' if i % 2 else 'reeds_b', 23.0 + i * 0.6, 7.2 + (i % 2) * 0.4, 0, i * 70)

# ground: packed earth, darker and smoother where people walk the lane, dustier along the walls
import bmesh
bm = bmesh.new()
uvl = bm.loops.layers.uv.new('UVMap')
x0g, x1g, y0g, y1g, stg = -40.0, 80.0, -40.0, 40.0, 0.5
nxg, nyg = int((x1g - x0g) / 1.0), int((y1g - y0g) / 1.0)
vs = {}
for i in range(nxg + 1):
    for j in range(nyg + 1):
        x, y = x0g + i * 1.0, y0g + j * 1.0
        vs[i, j] = bm.verts.new((x, y, 0.004 * K.noise3((x * 0.7, y * 0.7, 3.0), 5)))
for i in range(nxg):
    for j in range(nyg):
        f = bm.faces.new([vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1]])
        f.material_index = 0
        f.smooth = True
        for l in f.loops:
            l[uvl].uv = (l.vert.co.x / 2.6, l.vert.co.y / 2.6)
gob = K.new_object('ground', bm, ['M_Ground'])
def gcol(co, n, m, p):
    lane = math.exp(-((co.y - 1.7) / 1.1) ** 2) * (1 if -12 < co.x < 32 else 0.4)
    k = (0.92 - 0.1 * lane) * (0.95 + 0.08 * K.noise3((co.x * 0.25, co.y * 0.25, 1.0), 9))
    return (k, k * 0.98, k * 0.95)
K.paint(gob, gcol, mode='set')

# the runner for scale
try:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(K.ROOT, 'atlas', 'public', 'game', 'streets', 'runner.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    arm = next((o for o in new if o.type == 'ARMATURE'), None)
    for o in new:
        if o.name.startswith('Icosphere'):
            o.hide_render = True
    if arm:
        arm.location = (-3.2, 1.6, 0)
        arm.rotation_euler = (0, 0, math.radians(-90))
        act = bpy.data.actions.get('Walk_Loop')
        if act and arm.animation_data:
            arm.animation_data.action = act
        bpy.context.scene.frame_set(9)
    RUNNER = arm
except Exception as e:
    print('runner failed', e)
    RUNNER = None

# ---------------------------------------------------------------- render
K.render_setup(res=RES, samples=SAMPLES, sun_elev=24, sun_azim=-118, sun_strength=4.2, hdri_strength=0.85)
sc = bpy.context.scene
sc.cycles.max_bounces = 8
if A.get('haze', '1') != '0':
    # a faint dusty haze for depth (a volume box over the district)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(15, 0, 20))
    hz = bpy.context.active_object
    hz.scale = (220, 160, 40)
    hm = bpy.data.materials.new('haze')
    hm.use_nodes = True
    nt = hm.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    vo = nt.nodes.new('ShaderNodeVolumePrincipled')
    vo.inputs['Density'].default_value = float(A.get('haze', '0.0022'))
    vo.inputs['Color'].default_value = (0.93, 0.86, 0.76, 1)
    vo.inputs['Anisotropy'].default_value = 0.45
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(vo.outputs[0], out.inputs['Volume'])
    hz.data.materials.append(hm)
    hz.visible_shadow = False
cams = {
    'street': ((-11.5, 1.6, 1.65), (2.0, 2.4, 2.4), 26),
    'third': ((-6.4, 0.6, 2.35), (-1.0, 2.2, 1.6), 24),
    'roof': ((-8.4, 6.2, 6.6), (2.0, 4.0, 4.6), 22),
    'gate': ((12.0, 1.4, 1.7), (34.0, 1.8, 5.0), 40),
    'door': ((-6.6, 1.2, 1.55), (-5.4, 3.6, 1.2), 30),
    'corner': ((-0.6, 1.0, 1.4), (-2.0, 3.6, 1.6), 26),
    'stair': ((0.2, 0.9, 1.7), (-1.5, 6.0, 2.4), 24),
    'roofwalk': ((-8.2, 4.6, 6.1), (-3.0, 4.2, 4.6), 24),
}
out = os.path.join(K.RENDERS, 'street')
for v in VIEWS:
    loc, tgt, lens = cams[v]
    K.camera(loc, tgt, lens=lens, name=f'cam_{v}')
    K.render(os.path.join(K.RENDERS, f'street_{v}.png'))
if 'save' in A:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(K.ROOT, A['save']))
