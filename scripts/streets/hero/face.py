# Step 4 of the hero build: the eyes, brows, lashes and cropped hair, on the fitted body (human.blend → face.blend).
#   Eyes (ours): MakeHuman's eye proxy only gives the shape the lids close on. Each new eye is two meshes on a polar
#     grid about the gaze, projected onto that shape: an eyeball whose front is pressed flat into an iris plane set
#     back behind the limbus, and a cornea, a thin clear shell over the whole front that bulges as a 7.8 mm sphere over
#     the iris. The eyeball texture is painted here (sclera with faint vessels, a dark limbal ring, a brown iris of
#     radial fibres, collarette and crypts, the pupil) and multiplied by occlusion baked from the lids, so the eye
#     sits in its socket; the cornea is glass (KHR_materials_transmission, IOR 1.376).
#   Brows and lashes: MakeHuman's CC0 cards (eyebrow010, eyelashes02) with their alpha, coloured near-black brown.
#   Hair (ours): a shell over the scalp, 3 mm out, textured with short strands that follow the growth from the crown
#     (line-integral convolution of noise along that flow, baked in the skin's UV layout), soft at the hairline;
#     anisotropic specular along the strands (KHR_materials_anisotropy).
#   Blender -b build/hero/work/human.blend --python face.py -- [--out=build/hero/work/face.blend]
import os
import sys
sys.dont_write_bytecode = True  # no __pycache__ in the repo
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import math
import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
import hero_common as H

A = H.args()
OUT = A.get('out', os.path.join(H.WORK, 'face.blend'))
TEX = os.path.join(H.WORK, 'tex')
os.makedirs(TEX, exist_ok=True)
DATA = os.path.join(H.BUILD, 'blender-user', 'extensions', '.user', 'user_default', 'mpfb', 'data')
rng = np.random.default_rng(919)
arm = bpy.data.objects['UAL_bind']
body = bpy.data.objects['Body']


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def save_png(name, rgba, srgb=True):
    h, w = rgba.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=rgba.shape[2] == 4)
    im.colorspace_settings.name = 'Non-Color'
    px = np.ones((h, w, 4), dtype=np.float32)
    px[..., :3] = lin_to_srgb(rgba[..., :3]) if srgb else np.clip(rgba[..., :3], 0, 1)
    if rgba.shape[2] == 4:
        px[..., 3] = np.clip(rgba[..., 3], 0, 1)
    im.pixels = px.ravel()
    path = os.path.join(TEX, name + '.png')
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    print('HERO wrote', path)
    return path


def bind(obj, groups_weights):
    """Parent to the bind armature with fixed weights {bone: weight}."""
    for b, w in groups_weights.items():
        g = obj.vertex_groups.get(b) or obj.vertex_groups.new(name=b)
        g.add(list(range(len(obj.data.vertices))), w, 'REPLACE')
    obj.parent = arm
    md = obj.modifiers.new('Armature', 'ARMATURE')
    md.object = arm


def material(name, **k):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    for key, val in k.items():
        b.inputs[key].default_value = val
    return m, b


def image_node(m, path, non_color=False):
    t = m.node_tree.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(path, check_existing=True)
    if non_color:
        t.image.colorspace_settings.name = 'Non-Color'
    return t


# ================================================================ eyes
old = bpy.data.objects['high-poly']
V = np.array([old.matrix_world @ v.co for v in old.data.vertices])
old_bvh = BVHTree.FromObject(old, bpy.context.evaluated_depsgraph_get())
RINGS = [0, 3.5, 7, 10.5, 14, 17.5, 21, 23.5, 26, 30, 36, 44, 54, 66]  # beyond 66° the lids hide the eye
SEG = 24
IRIS_R = 0.0059  # iris radius (m)
EYE_SIZE = 512


def polar_frame(c, gaze, sgn):
    z = Vector(gaze).normalized()
    x = Vector((sgn, 0, 0))  # outward, mirrored per eye so both eyes are built alike
    x = (x - z * x.dot(z)).normalized()
    y = z.cross(x)
    return x, y, z


def surface_dist(c, d):
    """Distance from c along d to MakeHuman's eye surface (cast from outside, so the outermost layer counts)."""
    hit = old_bvh.ray_cast(c + d * 0.05, -d, 0.06)
    return 0.05 - hit[3] if hit[0] is not None else 0.0155


eyes = []
for side, sgn in (('l', 1), ('r', -1)):
    P = V[(V[:, 0] * sgn) > 0]
    Am = np.hstack([2 * P, np.ones((len(P), 1))])
    sol, *_ = np.linalg.lstsq(Am, (P ** 2).sum(1), rcond=None)
    c = Vector(sol[:3])
    apex = Vector(P[np.argmin(P[:, 1])])
    gaze = (apex - c).normalized()
    ex, ey, ez = polar_frame(c, gaze, sgn)
    # where the limbus is: the angle at which the iris radius is reached on the surface
    th_l = None
    for t in np.linspace(5, 40, 141):
        d = (ez * math.cos(math.radians(t)) + ex * math.sin(math.radians(t))).normalized()
        if surface_dist(c, d) * math.sin(math.radians(t)) >= IRIS_R:
            th_l = t
            break
    th_l = th_l or 23.5
    RG = sorted(set([r * th_l / 23.5 if r <= 23.5 else r for r in RINGS]))
    dl = surface_dist(c, (ez * math.cos(math.radians(th_l)) + ex * math.sin(math.radians(th_l))).normalized())
    z_iris = dl * math.cos(math.radians(th_l)) - 0.0003   # iris plane, just behind the limbus
    apex_d = surface_dist(c, ez) + 0.0004
    # cornea: a sphere through the limbus circle (lifted 0.35 mm) with its apex where the eye's front is
    R_l, z_l = dl * math.sin(math.radians(th_l)), dl * math.cos(math.radians(th_l)) + 0.00035
    # centre z_c and radius r_c with r_c = apex_d - z_c and R_l² + (z_l - z_c)² = r_c²
    z_c = (apex_d ** 2 - R_l ** 2 - z_l ** 2) / (2 * (apex_d - z_l))
    r_c = apex_d - z_c
    print(f'HERO eye {side}: centre {tuple(round(x, 4) for x in c)}, limbus {th_l:.1f}°, iris plane {z_iris * 1000:.2f} mm, cornea r {r_c * 1000:.2f} mm, apex {apex_d * 1000:.2f} mm')

    def build(name, radius_fn, uv=True):
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        verts = [bm.verts.new(c + ez * radius_fn(0, 0))]
        rows = []
        for th in RG[1:]:
            row = []
            for k in range(SEG):
                ph = 2 * math.pi * k / SEG
                d = (ez * math.cos(math.radians(th)) + (ex * math.cos(ph) + ey * math.sin(ph)) * math.sin(math.radians(th))).normalized()
                row.append(bm.verts.new(c + d * radius_fn(th, ph, d)))
            rows.append(row)
        faces = []
        for k in range(SEG):
            faces.append(bm.faces.new((verts[0], rows[0][k], rows[0][(k + 1) % SEG])))
        for i in range(len(rows) - 1):
            for k in range(SEG):
                faces.append(bm.faces.new((rows[i][k], rows[i + 1][k], rows[i + 1][(k + 1) % SEG], rows[i][(k + 1) % SEG])))
        for f in faces:
            f.smooth = True
            for l in f.loops:
                p = l.vert.co - c
                # planar UV across the front: the iris disc spans 0.5 ± 0.5·IRIS_R/0.016
                l[uvl].uv = (0.5 + p.dot(ex) / 0.032, 0.5 + p.dot(ey) / 0.032)
        bm.normal_update()
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        for p in me.polygons:
            if p.normal.dot(p.center - c) < 0:
                p.flip()
        return o

    def ball(th, ph, d=None):
        if th == 0:
            return z_iris
        if th <= th_l + 1e-6:
            return z_iris / math.cos(math.radians(th))
        return surface_dist(c, d) - 0.0002

    def cornea(th, ph, d=None):
        d = d if d is not None else ez
        if th <= th_l + 1e-6:
            u = d
            cc = ez * z_c
            b_ = u.dot(cc)
            return b_ + math.sqrt(max(0.0, b_ * b_ - cc.length_squared + r_c * r_c))
        return surface_dist(c, d) + 0.00035

    eb = build(f'eye_{side}', ball)
    RG_full = RG
    RG = [r for r in RG if r <= 54]  # the clear layer only matters where the lids part
    co = build(f'cornea_{side}', cornea)
    RG = RG_full
    eyes.append((side, eb, co, c, ex, ey, ez))

# eye texture (shared painting, per-eye occlusion): 1024×512, left eye in the left half
S = EYE_SIZE
yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
u = (xx + 0.5) / S - 0.5
v = (yy + 0.5) / S - 0.5
rr = np.sqrt(u * u + v * v) * 0.032  # metres from the gaze axis
ang = np.arctan2(v, u)
ri = IRIS_R
pupil = 0.0021


def noise_polar(n_ang, n_rad, seed):
    g = np.random.default_rng(seed)
    a = g.standard_normal((n_rad, n_ang)).astype(np.float32)
    # sample bilinearly at (radius, angle)
    ia = (ang / (2 * np.pi) % 1) * n_ang
    ir = np.clip(rr / ri, 0, 0.999) * (n_rad - 1)
    a0, r0 = np.floor(ia).astype(int), np.floor(ir).astype(int)
    fa, fr = ia - a0, ir - r0
    a1, r1 = (a0 + 1) % n_ang, np.minimum(r0 + 1, n_rad - 1)
    return (a[r0, a0] * (1 - fa) * (1 - fr) + a[r0, a1] * fa * (1 - fr) + a[r1, a0] * (1 - fa) * fr + a[r1, a1] * fa * fr)


fib = noise_polar(360, 8, 1) * 0.6 + noise_polar(140, 5, 2) * 0.4
crypt = np.clip(noise_polar(48, 6, 3), 0.9, 3) - 0.9
t = np.clip(rr / ri, 0, 1)
iris_dark = srgb_to_lin(np.array([34, 19, 11]) / 255.0)
iris_mid = srgb_to_lin(np.array([74, 42, 21]) / 255.0)
collar = srgb_to_lin(np.array([112, 72, 36]) / 255.0)
ir_col = iris_dark + (iris_mid - iris_dark) * np.clip(0.5 + 0.35 * fib, 0, 1)[..., None]
ring = np.exp(-((t - 0.42) / 0.07) ** 2)
ir_col = ir_col * (1 - 0.55 * ring[..., None]) + collar * 0.55 * ring[..., None] * np.clip(0.6 + 0.4 * fib, 0, 1)[..., None]
ir_col *= (1 - 0.5 * np.clip(crypt, 0, 1))[..., None]
ir_col *= (1 - 0.45 * np.clip((t - 0.8) / 0.2, 0, 1))[..., None]  # darker toward the limbus
sclera = srgb_to_lin(np.array([214, 200, 182]) / 255.0) * np.ones_like(ir_col)
vessel = np.clip(noise_polar(90, 4, 4) - 1.3, 0, 1) * np.clip((rr - ri * 1.25) / 0.004, 0, 1)
sclera = sclera * (1 - 0.35 * vessel[..., None]) + srgb_to_lin(np.array([170, 60, 50]) / 255.0) * 0.35 * vessel[..., None]
sclera *= (1 - 0.18 * np.clip((rr - ri * 1.2) / 0.008, 0, 1))[..., None]
limbal = np.exp(-((rr - ri) / 0.00045) ** 2)
img = np.where((rr < ri)[..., None], ir_col, sclera)
img = img * (1 - 0.85 * limbal[..., None]) + srgb_to_lin(np.array([25, 15, 10]) / 255.0) * 0.85 * limbal[..., None]
pup = np.clip((pupil - rr) / 0.00012 + 0.5, 0, 1)
img = img * (1 - pup[..., None]) + 0.004 * pup[..., None]

# occlusion of each eye by the lids: bake AO on the eyeballs with the head in place
sc = bpy.context.scene
H.setup_cycles(samples=128, res=(64, 64))
sc.world = sc.world or bpy.data.worlds.new('w')
sc.world.light_settings.distance = 0.02
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.hide_render = not (o == body or o.name.startswith('eye_'))
ao_imgs = {}
for side, eb, co, c, ex, ey, ez in eyes:
    im = bpy.data.images.new(f'ao_{side}', S, S, float_buffer=True)
    im.colorspace_settings.name = 'Non-Color'
    m = bpy.data.materials.new(f'bake_{side}')
    m.use_nodes = True
    tn = m.node_tree.nodes.new('ShaderNodeTexImage')
    tn.image = im
    m.node_tree.nodes.active = tn
    eb.data.materials.append(m)
    for o in bpy.data.objects:
        o.select_set(False)
    eb.select_set(True)
    bpy.context.view_layer.objects.active = eb
    bpy.ops.object.bake(type='AO', margin=8, use_clear=True)
    ao_imgs[side] = np.array(im.pixels[:], dtype=np.float32).reshape(S, S, 4)[..., 0]
    eb.data.materials.clear()
tex_eye = np.zeros((S, 2 * S, 3), dtype=np.float32)
for i, side in enumerate(('l', 'r')):
    ao = np.clip(0.25 + 0.75 * ao_imgs[side], 0, 1)
    ao = np.where(ao_imgs[side] <= 0, 1.0, ao)
    tex_eye[:, i * S:(i + 1) * S] = img * ao[..., None]
eye_png = save_png('eye_basecolor', tex_eye)
for o in bpy.data.objects:
    o.hide_render = False

m_eye, b = material('eye', **{'Roughness': 0.35})
tn = image_node(m_eye, eye_png)
m_eye.node_tree.links.new(tn.outputs['Color'], b.inputs['Base Color'])
m_cor, b = material('cornea', **{'Roughness': 0.02, 'IOR': 1.376, 'Transmission Weight': 1.0, 'Base Color': (1, 1, 1, 1)})
m_cor.use_backface_culling = True
for i, (side, eb, co, c, ex, ey, ez) in enumerate(eyes):
    # each eye uses its half of the texture
    for l in eb.data.uv_layers['UVMap'].data:
        l.uv = (l.uv[0] * 0.5 + 0.5 * i, l.uv[1])
    eb.data.materials.append(m_eye)
    co.data.materials.append(m_cor)
    bind(eb, {'Head': 1.0})
    bind(co, {'Head': 1.0})
bpy.data.objects.remove(old, do_unlink=True)

# ================================================================ brows and lashes: MakeHuman's cards, darkened
def card_material(name, src_png, color_srgb, alpha_gain=1.0):
    im = bpy.data.images.load(src_png)
    w, h = im.size
    px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
    a = np.clip(px[..., 3] * alpha_gain, 0, 1)
    # the source keeps its strand shading in luminance; tint it to the hair colour
    lum = px[..., :3] @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    col = srgb_to_lin(np.array(color_srgb) / 255.0) * (0.6 + 0.8 * lum[..., None])
    out = np.concatenate([col, a[..., None]], -1)
    path = save_png(name, out)
    m, b = material(name, **{'Roughness': 0.5})
    t = image_node(m, path)
    m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    m.node_tree.links.new(t.outputs['Alpha'], b.inputs['Alpha'])
    m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    m.surface_render_method = 'BLENDED' if hasattr(m, 'surface_render_method') else None
    return m


for o in list(bpy.data.objects):
    if o.name.startswith('eyebrow'):
        o.data.materials.clear()
        brow = os.path.splitext(os.path.basename(o.name.split('.')[-1] if '.' in o.name else o.name))[0]
        brow = brow if os.path.isdir(os.path.join(DATA, 'eyebrows', brow)) else 'eyebrow001'
        o.data.materials.append(card_material('brows', os.path.join(DATA, 'eyebrows', brow, brow + '.png'), (28, 20, 15), 1.3))
        o.name = 'Brows'
    elif o.name.startswith('eyelashes'):
        o.data.materials.clear()
        lash = o.name if os.path.isdir(os.path.join(DATA, 'eyelashes', o.name)) else 'eyelashes02'
        o.data.materials.append(card_material('lashes', os.path.join(DATA, 'eyelashes', lash, lash + '.png'), (14, 10, 8), 1.0))
        o.name = 'Lashes'

# ================================================================ hair: a cropped cut as a shell over the scalp
HAIR = 1024
sg = body.vertex_groups['m_scalp'].index
hg = body.vertex_groups['Head'].index
scalp_w = np.zeros(len(body.data.vertices))
for v in body.data.vertices:
    for g in v.groups:
        if g.group == sg:
            scalp_w[v.index] = g.weight
bbm = bmesh.new()
bbm.from_mesh(body.data)
bbm.verts.ensure_lookup_table()
bbm.faces.ensure_lookup_table()
buv = bbm.loops.layers.uv['UVMap']
# the hair reaches a little past MakeHuman's scalp group, so the shell's soft edge falls on the hairline
core = set(i for i in range(len(scalp_w)) if scalp_w[i] > 0.5)
ring1 = set()
for i in core:
    for e in bbm.verts[i].link_edges:
        ring1.add(e.other_vert(bbm.verts[i]).index)
inside = core | ring1
hfaces = [f for f in bbm.faces if all(v.index in inside for v in f.verts)]
# hops from the edge of the region: the hair thins out over the last two
dist = {}
frontier = [i for i in inside if any(e.other_vert(bbm.verts[i]).index not in inside for e in bbm.verts[i].link_edges)]
for i in frontier:
    dist[i] = 0
k = 0
while frontier:
    k += 1
    nxt = []
    for i in frontier:
        for e in bbm.verts[i].link_edges:
            j = e.other_vert(bbm.verts[i]).index
            if j in inside and j not in dist:
                dist[j] = k
                nxt.append(j)
    frontier = nxt
crown = Vector((0.0, 0.035, 1.755))  # the whorl, at the back of the crown
hm = bmesh.new()
huv = hm.loops.layers.uv.new('UVMap')
vmap = {}
uvs = np.array([l[buv].uv[:] for f in hfaces for l in f.loops])
u0, u1 = uvs.min(0) - 0.004, uvs.max(0) + 0.004
span = max(u1 - u0)
for f in hfaces:
    for v in f.verts:
        if v.index not in vmap:
            d = dist.get(v.index, 3)
            off = 0.0008 + 0.0024 * min(1.0, d / 3.0)
            vmap[v.index] = hm.verts.new(v.co + v.normal * off)
for f in hfaces:
    nf = hm.faces.new([vmap[v.index] for v in f.verts])
    for l, ol in zip(nf.loops, f.loops):
        u, w = ol[buv].uv
        l[huv].uv = ((u - u0[0]) / span, (w - u0[1]) / span)
    nf.smooth = True
hm.normal_update()
# per-vertex growth direction (out from the crown, falling with gravity at the sides and back, forward on top) and
# how far in from the hairline, kept for the texture
grow = {}
for i, nv_ in vmap.items():
    p = nv_.co
    n = nv_.normal
    d = (p - crown)
    d.z -= 0.6 * max(0.0, crown.z - p.z) / 0.15 * 0.1
    d = d - n * d.dot(n)
    grow[i] = d.normalized() if d.length > 1e-6 else Vector((0, -1, 0))
hme = bpy.data.meshes.new('Hair')
hm.to_mesh(hme)
hair = bpy.data.objects.new('Hair', hme)
bpy.context.scene.collection.objects.link(hair)
order_idx = list(vmap.keys())  # bmesh assigned new indices in creation order
dir_attr = hme.color_attributes.new('flow', 'FLOAT_COLOR', 'POINT')
col = np.ones((len(order_idx), 4), dtype=np.float32)
for new_i, old_i in enumerate(order_idx):
    g_ = grow[old_i]
    col[new_i, :3] = (g_.x * 0.5 + 0.5, g_.y * 0.5 + 0.5, g_.z * 0.5 + 0.5)
    col[new_i, 3] = min(1.0, dist.get(old_i, 3) / 3.0)
dir_attr.data.foreach_set('color', col.ravel())
bbm.free()
hm.free()
for p in hme.polygons:
    p.use_smooth = True
# one level of smoothing, so the head's outline is round rather than faceted
bpy.context.view_layer.objects.active = hair
sub = hair.modifiers.new('Subdivision', 'SUBSURF')
sub.levels = 1
sub.uv_smooth = 'PRESERVE_BOUNDARIES'
bpy.ops.object.modifier_apply(modifier=sub.name)
hme = hair.data
print('HERO hair shell', len(hme.polygons), 'faces')

# bake the flow (as a UV-space direction, using the shell's tangents) and the edge distance into the hair's UV square
hme.calc_tangents(uvmap='UVMap')
loop_uvdir = np.zeros((len(hme.loops), 4), dtype=np.float32)
fa = hme.color_attributes['flow']
fl = np.zeros(len(hme.vertices) * 4, dtype=np.float32)
fa.data.foreach_get('color', fl)
fl = fl.reshape(-1, 4)  # the flow, interpolated by the subdivision
for l in hme.loops:
    g_ = Vector((fl[l.vertex_index, 0] * 2 - 1, fl[l.vertex_index, 1] * 2 - 1, fl[l.vertex_index, 2] * 2 - 1))
    t = l.tangent
    b = l.bitangent
    du, dv = g_.dot(t), g_.dot(b)
    nn = math.hypot(du, dv) or 1.0
    loop_uvdir[l.index] = (du / nn * 0.5 + 0.5, dv / nn * 0.5 + 0.5, fl[l.vertex_index, 3], 1)
la = hme.color_attributes.new('uvflow', 'FLOAT_COLOR', 'CORNER')
la.data.foreach_set('color', loop_uvdir.ravel())
hme.free_tangents()

sc = bpy.context.scene
H.setup_cycles(samples=1, res=(64, 64))
bm_mat = bpy.data.materials.new('bake_hair')
bm_mat.use_nodes = True
nt = bm_mat.node_tree
nt.nodes.clear()
o_ = nt.nodes.new('ShaderNodeOutputMaterial')
e_ = nt.nodes.new('ShaderNodeEmission')
a_ = nt.nodes.new('ShaderNodeAttribute')
a_.attribute_name = 'uvflow'
t_ = nt.nodes.new('ShaderNodeTexImage')
nt.links.new(a_.outputs['Color'], e_.inputs['Color'])
nt.links.new(e_.outputs['Emission'], o_.inputs['Surface'])
im = bpy.data.images.new('hair_flow', HAIR, HAIR, float_buffer=True)
im.colorspace_settings.name = 'Non-Color'
t_.image = im
nt.nodes.active = t_
hme.materials.append(bm_mat)
for o in bpy.data.objects:
    o.select_set(False)
hair.select_set(True)
bpy.context.view_layer.objects.active = hair
bpy.ops.object.bake(type='EMIT', margin=24, use_clear=True)
F = np.array(im.pixels[:], dtype=np.float32).reshape(HAIR, HAIR, 4)
hme.materials.clear()
hme.color_attributes.remove(hme.color_attributes['uvflow'])
fu, fv, edge = F[..., 0] * 2 - 1, F[..., 1] * 2 - 1, np.clip(F[..., 2], 0, 1)
covered = (np.abs(fu) + np.abs(fv)) > 0.05
nn = np.sqrt(fu * fu + fv * fv) + 1e-6
fu, fv = np.where(covered, fu / nn, 0.0), np.where(covered, fv / nn, 1.0)


def sample(img, x, y):
    x = np.clip(x, 0, HAIR - 1.001)
    y = np.clip(y, 0, HAIR - 1.001)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    tx, ty = x - x0, y - y0
    return (img[y0, x0] * (1 - tx) * (1 - ty) + img[y0, x0 + 1] * tx * (1 - ty) + img[y0 + 1, x0] * (1 - tx) * ty + img[y0 + 1, x0 + 1] * tx * ty)


# strands: sparse roots smeared along the flow (line-integral convolution), each a few millimetres long
roots = (rng.random((HAIR, HAIR)) < 0.14).astype(np.float32) * rng.uniform(0.5, 1.0, (HAIR, HAIR)).astype(np.float32)
yy, xx = np.mgrid[0:HAIR, 0:HAIR].astype(np.float32)
acc = np.zeros((HAIR, HAIR), dtype=np.float32)
L = 7
for sgn_ in (1, -1):
    px, py = xx.copy(), yy.copy()
    for s_ in range(L):
        w_ = 1 - s_ / L
        acc += sample(roots, px, py) * w_
        px += sgn_ * sample(fu, px, py) * 1.0
        py += sgn_ * sample(fv, px, py) * 1.0
strands = acc / acc[covered].max()
strands = np.clip(strands * 2.2, 0, 1)
dens = np.clip(edge * 1.4, 0, 1) ** 1.5  # thins over the last hops before the hairline
alpha = np.clip(dens * (0.62 + 0.8 * strands), 0, 1) * covered
dark = srgb_to_lin(np.array([11, 8, 7]) / 255.0)
light = srgb_to_lin(np.array([36, 27, 21]) / 255.0)
hcol = dark + (light - dark) * (strands ** 1.5)[..., None]
hair_png = save_png('hair_basecolor', np.concatenate([hcol, alpha[..., None]], -1))
half = strands.reshape(HAIR // 2, 2, HAIR // 2, 2).mean((1, 3))  # the normal map at half size, softer
gy, gx = np.gradient(half)
hn = np.stack([-gx * 1.5, -gy * 1.5, np.ones_like(gx)], -1)
hn /= np.linalg.norm(hn, axis=-1, keepdims=True)
hair_nrm = save_png('hair_normal', hn * 0.5 + 0.5, srgb=False)
# anisotropy (KHR_materials_anisotropy): RG the strand direction in tangent space, B the strength
ani = np.stack([fu * 0.5 + 0.5, fv * 0.5 + 0.5, np.where(covered, 0.85, 0.0)], -1)
hair_ani = save_png('hair_anisotropy', ani, srgb=False)
m_hair, b = material('hair', **{'Roughness': 0.66, 'IOR': 1.45})
t1 = image_node(m_hair, hair_png)
t2 = image_node(m_hair, hair_nrm, True)
nmh = m_hair.node_tree.nodes.new('ShaderNodeNormalMap')
m_hair.node_tree.links.new(t1.outputs['Color'], b.inputs['Base Color'])
m_hair.node_tree.links.new(t1.outputs['Alpha'], b.inputs['Alpha'])
m_hair.node_tree.links.new(t2.outputs['Color'], nmh.inputs['Color'])
m_hair.node_tree.links.new(nmh.outputs['Normal'], b.inputs['Normal'])
b.inputs['Anisotropic'].default_value = 0.5
hme.materials.append(m_hair)
hme.color_attributes.remove(hme.color_attributes['flow'])
bind(hair, {'Head': 1.0})
# the scalp under the hair is darker still, so gaps between strands read as hair in shadow

# ================================================================ skin material (the baked maps)
m_skin, b = material('skin', **{'IOR': 1.4, 'Subsurface Weight': 0.0})
tc = image_node(m_skin, os.path.join(TEX, 'skin_basecolor.png'))
tn = image_node(m_skin, os.path.join(TEX, 'skin_normal.png'), True)
to = image_node(m_skin, os.path.join(TEX, 'skin_orm.png'), True)
nm = m_skin.node_tree.nodes.new('ShaderNodeNormalMap')
sep = m_skin.node_tree.nodes.new('ShaderNodeSeparateColor')
L = m_skin.node_tree.links
L.new(tc.outputs['Color'], b.inputs['Base Color'])
L.new(tn.outputs['Color'], nm.inputs['Color'])
L.new(nm.outputs['Normal'], b.inputs['Normal'])
L.new(to.outputs['Color'], sep.inputs['Color'])
L.new(sep.outputs['Green'], b.inputs['Roughness'])
body.data.materials.clear()
body.data.materials.append(m_skin)

bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('HERO saved', OUT, [o.name for o in bpy.data.objects if o.type == 'MESH'])
