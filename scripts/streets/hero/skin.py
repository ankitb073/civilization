# Step 3 of the hero build: the skin's maps, 2048² on MakeHuman's UV layout (build/hero/work/tex/):
#   skin_basecolor.png  sRGB albedo. Source: Mindfront's "skin male african middleage" (MakeHuman community, CC0),
#                       regraded to a sun-browned medium brown, then darkened and warmed where the sun falls (face,
#                       shoulders, the backs of forearms and hands, the tops of feet), flushed where blood shows
#                       through (nose, cheeks, ears, knuckles, elbows, knees, lips), lips and nails kept.
#   skin_normal.png     tangent-space normal (OpenGL/glTF, +Y up): Mindfront's normal map (muscle and face detail) at
#                       reduced strength, plus a fine procedural skin grain.
#   skin_orm.png        R = ambient occlusion (baked from the body, eyes in place), G = roughness (oilier T-zone, wet
#                       lips, dry palms and soles, the cropped hair), B = thickness/translucency (from rays through the
#                       body: ears, nostrils, fingers and eyelids glow red against the sun; read by the game's skin
#                       shader patch — three ignores it as metalness because the material's metallicFactor is 0).
# Per-vertex masks are computed from the fitted mesh and its weights, baked to UV space by Cycles, and composited with
# numpy; unused texels are filled from their neighbours so mipmaps and compression do not bleed.
#   Blender -b build/hero/work/human.blend --python skin.py
import os
import sys
sys.dont_write_bytecode = True  # no __pycache__ in the repo
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import math
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import hero_common as H

A = H.args()
SIZE = int(A.get('size', '2048'))
OUT = os.path.join(H.WORK, 'tex')
os.makedirs(OUT, exist_ok=True)
SKINS = os.path.join(H.BUILD, 'blender-user', 'extensions', '.user', 'user_default', 'mpfb', 'data', 'skins')
SRC = os.path.join(SKINS, 'mindfront_skin_male_african_middleage')
rng = np.random.default_rng(332)

body = bpy.data.objects['Body']
me = body.data
nv = len(me.vertices)
CO = np.array([v.co[:] for v in me.vertices])
me.calc_normals_split() if hasattr(me, 'calc_normals_split') else None
NO = np.array([v.normal[:] for v in me.vertices])
gname = {g.index: g.name for g in body.vertex_groups}


def group(name):
    w = np.zeros(nv)
    gi = body.vertex_groups.get(name)
    if gi is None:
        return w
    for v in me.vertices:
        for g in v.groups:
            if g.group == gi.index:
                w[v.index] = g.weight
    return w


def groups(prefixes):
    w = np.zeros(nv)
    for g in body.vertex_groups:
        if g.name.startswith(prefixes):
            w += group(g.name)
    return np.clip(w, 0, 1)


arm = bpy.data.objects['UAL_bind']
J = {b.name: np.array((arm.matrix_world @ b.head_local)[:]) for b in arm.data.bones}


def blob(center, radius, w=None):
    d = np.linalg.norm(CO - center, axis=1)
    g = np.exp(-(d / radius) ** 2)
    return g if w is None else g * w


head = groups(('Head',))
neck = groups(('neck_01',))
hands = groups(('hand_', 'index_', 'middle_', 'ring_', 'pinky_', 'thumb_'))
feet = groups(('foot_', 'ball_'))
lips = group('m_lips')
ears = group('m_ears')
nails = np.clip(group('m_fingernails') + group('m_toenails'), 0, 1)
scalp = group('m_scalp')
forearms = groups(('lowerarm_',))
upperarms = groups(('upperarm_',))

# landmarks on the face: the nose tip is the most forward point of the head below the eyes
face = head * (CO[:, 1] < J['Head'][1] - 0.02)
cand = np.where(head > 0.5)[0]
nose_tip = CO[cand[np.argmin(CO[cand, 1])]]
eye_z = nose_tip[2] + 0.035
cheek_l = np.array([nose_tip[0] + 0.045, nose_tip[1] + 0.035, nose_tip[2] + 0.005])
cheek_r = np.array([nose_tip[0] - 0.045, nose_tip[1] + 0.035, nose_tip[2] + 0.005])
print('HERO nose tip', nose_tip)

# ---------------------------------------------------------------- per-vertex masks
up = np.clip(NO[:, 2], -1, 1)
front = np.clip(-NO[:, 1], -1, 1)
# where the sun falls most of the day: up- and out-facing surfaces of exposed skin
expo = np.clip(0.55 + 0.55 * up + 0.15 * front, 0, 1)
# shade under the chin, in the armpits, on the inner arms and thighs
inner_arm = (upperarms + forearms) * np.clip(-NO[:, 0] * np.sign(CO[:, 0] + 1e-6), 0, 1)
expo *= 1 - 0.6 * inner_arm
expo *= 1 - 0.7 * np.clip(-up, 0, 1) * (head + neck)
# palms and soles never brown
palm = hands * np.clip(-NO[:, 2] * 0.6 + 0.4, 0, 1) * 0  # set below from the hand's own frame
for sd, sgn in (('l', 1), ('r', -1)):
    hw = groups((f'hand_{sd}', f'index_01_{sd}', f'middle_01_{sd}', f'ring_01_{sd}', f'pinky_01_{sd}', f'thumb_01_{sd}',
                 f'index_02_{sd}', f'middle_02_{sd}', f'ring_02_{sd}', f'pinky_02_{sd}', f'index_03_{sd}',
                 f'middle_03_{sd}', f'ring_03_{sd}', f'pinky_03_{sd}', f'thumb_02_{sd}', f'thumb_03_{sd}'))
    # the palm faces the thigh in the bind pose: inward and a little back
    inward = np.array([-sgn, 0.25, -0.15])
    inward /= np.linalg.norm(inward)
    palm = np.maximum(palm, hw * np.clip((NO @ inward) * 1.4 - 0.2, 0, 1))
sole = feet * np.clip(-up * 1.5 - 0.3, 0, 1)
expo *= 1 - 0.9 * np.maximum(palm, sole)
expo = np.clip(expo, 0, 1)

red = np.zeros(nv)
red += 0.9 * blob(nose_tip, 0.018, head)
red += 0.55 * blob(cheek_l, 0.028, head) + 0.55 * blob(cheek_r, 0.028, head)
red += 0.7 * ears
for sd in ('l', 'r'):
    for f in ('index', 'middle', 'ring', 'pinky'):
        red += 0.55 * blob(J[f'{f}_01_{sd}'], 0.012) + 0.4 * blob(J[f'{f}_02_{sd}'], 0.009)
    red += 0.4 * blob(J[f'lowerarm_{sd}'] + np.array([0, 0.03, 0]), 0.035)  # elbow point
    red += 0.45 * blob(J[f'calf_{sd}'] + np.array([0, -0.045, 0]), 0.04)  # knee cap
red += 0.35 * lips
red = np.clip(red, 0, 1)

# thickness: rays from each vertex straight into the body, to the far side
bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
thick = np.full(nv, 0.2)
for i in range(nv):
    o = Vector(CO[i]) - Vector(NO[i]) * 0.0005
    hit = bvh.ray_cast(o, -Vector(NO[i]), 0.2)
    thick[i] = hit[3] if hit[0] is not None else 0.2
trans = np.clip(np.exp(-thick / 0.011), 0, 1)
trans = np.maximum(trans, 0.85 * ears)
trans *= 1 - scalp * 0.7

rough = np.full(nv, 0.56)
tzone = head * np.clip(1 - np.abs(CO[:, 0] - nose_tip[0]) / 0.03, 0, 1) * (CO[:, 2] > nose_tip[2] - 0.01) * np.clip(front, 0, 1)
rough -= 0.08 * tzone + 0.06 * blob(nose_tip, 0.02, head)
rough -= 0.10 * lips
rough += 0.12 * np.maximum(palm, sole)
rough -= 0.15 * nails
rough += 0.1 * scalp
rough = np.clip(rough, 0.25, 0.8)

# ---------------------------------------------------------------- bake masks to UV space
def attr(name, cols):
    a = me.color_attributes.get(name) or me.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
    data = np.ones((nv, 4), dtype=np.float32)
    for i, c in enumerate(cols):
        data[:, i] = c
    a.data.foreach_set('color', data.ravel())
    return a


attr('mA', [expo, red, trans])
attr('mB', [rough, lips, nails])
attr('mC', [scalp, np.maximum(palm, sole), head])
attr('mCov', [np.ones(nv), np.ones(nv), np.ones(nv)])
# the armpits (their hair stretches into a smudge when the arms go overhead)
pit = np.zeros(nv)
for sd, sgn in (('l', 1), ('r', -1)):
    c = J[f'upperarm_{sd}'] + np.array([-sgn * 0.035, 0.01, -0.075])
    pit = np.maximum(pit, blob(c, 0.06))
legs = groups(('thigh_', 'calf_'))
attr('mPit', [pit, legs, pit])

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
H.setup_cycles(samples=1, res=(64, 64))
sc.cycles.samples = 1
for o in bpy.data.objects:
    if o.type == 'MESH' and o != body:
        o.hide_render = not o.name.startswith('high-poly')
bake_mat = bpy.data.materials.new('bake')
bake_mat.use_nodes = True
nt = bake_mat.node_tree
nt.nodes.clear()
outn = nt.nodes.new('ShaderNodeOutputMaterial')
em = nt.nodes.new('ShaderNodeEmission')
at = nt.nodes.new('ShaderNodeAttribute')
tex = nt.nodes.new('ShaderNodeTexImage')
nt.links.new(at.outputs['Color'], em.inputs['Color'])
nt.links.new(em.outputs['Emission'], outn.inputs['Surface'])
nt.nodes.active = tex
orig_mats = list(me.materials)
me.materials.clear()
me.materials.append(bake_mat)
for o in bpy.data.objects:
    o.select_set(False)
body.select_set(True)
bpy.context.view_layer.objects.active = body


def bake(kind, name, samples=1):
    im = bpy.data.images.new(name, SIZE, SIZE, alpha=True, float_buffer=True)
    im.colorspace_settings.name = 'Non-Color'
    im.generated_color = (0, 0, 0, 0)
    tex.image = im
    sc.cycles.samples = samples
    if kind == 'EMIT':
        at.attribute_name = name
        bpy.ops.object.bake(type='EMIT', margin=0, use_clear=True)
    else:
        bpy.ops.object.bake(type=kind, margin=0, use_clear=True)
    px = np.array(im.pixels[:], dtype=np.float32).reshape(SIZE, SIZE, 4)
    return px


used = bake('EMIT', 'mCov')[..., 0] > 0.5  # texels the body's UVs cover (the bake clears the rest to black)
mA = bake('EMIT', 'mA')
mB = bake('EMIT', 'mB')
mC = bake('EMIT', 'mC')
_mp = bake('EMIT', 'mPit')
pits, legs_t = _mp[..., 0], _mp[..., 1]
bpy.context.scene.world = bpy.data.worlds.new('w') if not bpy.context.scene.world else bpy.context.scene.world
bpy.context.scene.world.light_settings.distance = 0.12
ao = bake('AO', 'ao', samples=128)[..., 0]
me.materials.clear()
for m in orig_mats:
    me.materials.append(m)
print('HERO baked masks; used texels', used.mean())

# ---------------------------------------------------------------- composite
def load(path, non_color=False):
    im = bpy.data.images.load(path)
    if non_color:
        im.colorspace_settings.name = 'Non-Color'
    w, h = im.size
    px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
    if w != SIZE:
        k = w // SIZE
        px = px.reshape(SIZE, k, SIZE, k, 4).mean((1, 3))
    return px


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def blur(img, r):
    """Separable box blur, repeated (≈ Gaussian), on the first axes."""
    out = img.copy()
    for _ in range(3):
        for ax in (0, 1):
            c = np.cumsum(np.pad(out, [(r + 1, r) if a == ax else (0, 0) for a in range(out.ndim)], mode='edge'), axis=ax)
            sl_hi = [slice(None)] * out.ndim
            sl_lo = [slice(None)] * out.ndim
            sl_hi[ax] = slice(2 * r + 1, None)
            sl_lo[ax] = slice(0, -(2 * r + 1))
            out = (c[tuple(sl_hi)] - c[tuple(sl_lo)]) / (2 * r + 1)
    return out


def fill(img, mask, passes=64):
    """Fill texels outside mask from their neighbours (push outward), so edges do not bleed when mipmapped."""
    img = img.copy()
    m = mask.astype(np.float32)
    acc = img * m[..., None]
    for _ in range(passes):
        if m.min() > 0:
            break
        s = np.zeros_like(acc)
        c = np.zeros_like(m)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            s += np.roll(np.roll(acc, dy, 0), dx, 1)
            c += np.roll(np.roll(m, dy, 0), dx, 1)
        new = (c > 0) & (m == 0)
        acc[new] = s[new] / c[new][:, None]
        m[new] = 1
    rest = m == 0
    if rest.any():
        acc[rest] = acc[m > 0].mean(0)
    return acc


src = srgb_to_lin(load(os.path.join(SRC, 'skin_male_african_middleage.png'))[..., :3])  # pixels of byte images are the stored (sRGB) values
skin = used & (mB[..., 1] < 0.3) & (mB[..., 2] < 0.3) & (mC[..., 0] < 0.3)
mean = src[skin].mean(0)
# sun-browned medium brown (linear), keeping the source's variation around its mean
TARGET = srgb_to_lin(np.array([150, 98, 70]) / 255.0)
graded = src * (TARGET / mean)
# body hair: the source is a hairy middle-aged man, the hero a young one; keep a trace of the hair on the chest and
# limbs but lift its darkest strands most of the way toward the skin around them (not on the head, where the brows and the cropped hair live)
lum = graded @ np.array([0.2126, 0.7152, 0.0722])
soft = np.stack([blur(graded[..., c], 5) for c in range(3)], -1)
darker = np.clip((soft @ np.array([0.2126, 0.7152, 0.0722]) - lum) / (lum + 1e-4), 0, 1)
k = (np.maximum(0.72, 0.85 * legs_t) * darker * (1 - np.clip(mC[..., 2] * 1.5, 0, 1)))[..., None]
graded = graded * (1 - k) + soft * k
# armpits: toward the plain skin around them (their dark hair would smear when the arms go up)
around = np.stack([blur(graded[..., c], 24) for c in range(3)], -1)
pk = np.clip(pits * 1.2, 0, 0.85)[..., None]
graded = graded * (1 - pk) + np.maximum(around, graded) * pk
expo_t = mA[..., 0][..., None]
red_t = mA[..., 1][..., None]
tan = 1 - expo_t * np.array([0.16, 0.22, 0.27])
graded *= tan
graded = graded * (1 - 0.22 * red_t) + graded * np.array([1.35, 0.78, 0.72]) * 0.22 * red_t
graded = graded * (1 - 0.25 * mC[..., 1][..., None]) + graded * np.array([1.18, 1.12, 1.08]) * 0.25 * mC[..., 1][..., None]
# a little low-frequency mottling breaks up the even grade (sun spots and unevenness)
mott = blur(rng.standard_normal((SIZE, SIZE)).astype(np.float32), 18)
mott = mott / (mott.std() + 1e-6)
graded *= (1 + 0.035 * mott)[..., None]
base = fill(np.clip(graded, 0, 1), used)
print('HERO skin mean (sRGB)', (lin_to_srgb(base[skin].mean(0)) * 255).round())

# normal: Mindfront's, softened, plus fine grain
nrm = load(os.path.join(SRC, 'skin_male_african_middleage_NRM.png'), non_color=True)[..., :3] * 2 - 1
STRENGTH = float(A.get('nrm', '0.45'))
nx, ny = nrm[..., 0] * STRENGTH, nrm[..., 1] * STRENGTH
grain = rng.standard_normal((SIZE, SIZE)).astype(np.float32)
grain = blur(grain, 1) - blur(grain, 4)
grain /= grain.std() + 1e-6
gk = (0.02 + 0.02 * mC[..., 2]) * (1 - mB[..., 2]) * (1 - mC[..., 0])  # finer and a little stronger on the face; not on nails or hair
gy, gx = np.gradient(grain)
nx = nx - gx * gk
ny = ny - gy * gk
nz = np.sqrt(np.clip(1 - nx * nx - ny * ny, 0.05, 1))
n = np.stack([nx, ny, nz], -1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
normal = fill(n * 0.5 + 0.5, used)

aoc = np.clip(ao, 0, 1)
aoc = 0.35 + 0.65 * aoc  # keep it gentle: the game also has its own shadowing
spec = load(os.path.join(SRC, 'skin_male_african_middleage_SPEC.png'), non_color=True)[..., 0]
r = mB[..., 0] - 0.12 * (spec - spec[skin].mean()) + 0.03 * blur(rng.standard_normal((SIZE, SIZE)).astype(np.float32), 6) * 5
orm = np.stack([aoc, np.clip(r, 0.22, 0.85), np.clip(mA[..., 2], 0, 1)], -1)
orm = fill(orm, used)


def save(name, rgb, srgb):
    im = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=False)
    im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    px = np.ones((SIZE, SIZE, 4), dtype=np.float32)
    px[..., :3] = lin_to_srgb(rgb) if srgb else np.clip(rgb, 0, 1)
    if srgb:
        # Blender stores byte images as sRGB-encoded values when the colour space is sRGB; write the encoded bytes
        im.colorspace_settings.name = 'Non-Color'
    im.pixels = px.ravel()
    path = os.path.join(OUT, name + '.png')
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    print('HERO wrote', path)


# a tiling detail normal for close-ups (the game's skin shader patch and the Blender beauty renders repeat it 32 times
# across the skin's UVs: about a millimetre between pores on the face, two on the body): pores as soft pits, and the
# fine criss-cross of the skin's surface
def pnoise(n, scale, seed):
    g = np.random.default_rng(seed)
    f = np.fft.fftfreq(n)
    fx, fy = np.meshgrid(f, f)
    filt = np.exp(-((np.sqrt(fx * fx + fy * fy) * n / scale) ** 2))
    out = np.real(np.fft.ifft2(np.fft.fft2(g.standard_normal((n, n))) * filt))
    return out / (out.std() + 1e-9)


DN = 512
pores = np.clip(pnoise(DN, 150, 41) - 1.1, 0, None) ** 1.5
pores = pores / (pores.max() + 1e-6)
ang = np.radians(35)
yy, xx = np.mgrid[0:DN, 0:DN] / DN
cross = 0.0
for a in (ang, -ang):
    # anisotropic noise: stretched along direction a (fine lines), tiled
    u = np.cos(a) * xx + np.sin(a) * yy
    lines = np.sin(2 * np.pi * (u * 48 + 0.6 * pnoise(DN, 12, 42 + int(a > 0))))
    cross = cross + 0.5 * np.clip(lines, -1, 1) * np.clip(pnoise(DN, 20, 44), 0, None)
hgt = -1.0 * pores + 0.18 * cross + 0.12 * pnoise(DN, 90, 45)
gy, gx = np.gradient(np.pad(hgt, 1, mode='wrap'))
gx, gy = gx[1:-1, 1:-1], gy[1:-1, 1:-1]
dnrm = np.stack([-gx * 2.5, -gy * 2.5, np.ones_like(hgt)], -1)
dnrm /= np.linalg.norm(dnrm, axis=-1, keepdims=True)
im = bpy.data.images.new('skin_detail_normal', DN, DN, alpha=False)
im.colorspace_settings.name = 'Non-Color'
px = np.ones((DN, DN, 4), dtype=np.float32)
px[..., :3] = dnrm * 0.5 + 0.5
im.pixels = px.ravel()
im.filepath_raw = os.path.join(OUT, 'skin_detail_normal.png')
im.file_format = 'PNG'
im.save()
print('HERO wrote', im.filepath_raw)

save('skin_basecolor', base, True)
save('skin_normal', normal, False)
save('skin_orm', orm, False)
H.save_json(os.path.join(OUT, 'skin.json'), {'size': SIZE, 'usedTexels': float(used.mean()), 'noseTip': nose_tip.tolist(),
                                              'meanSRGB': (lin_to_srgb(base[skin].mean(0)) * 255).round().tolist()})
