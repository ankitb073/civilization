# Step 5 of the hero build: what he wears, modelled here around the fitted body in its bind pose (face.blend →
# hero.blend). All ours (CC0 like the rest):
#   Kilt: a knee-length linen wrap, its drape from a cloth simulation over the body (gravity, collision with the hips
#     and thighs, the waist pinned), with a front overlap whose free edge hangs as a separate layer and a turned hem.
#     Linen: a tiling plain-weave (64 threads to 4 cm, irregular homespun yarn) for colour, normal and roughness,
#     repeated in cloth space; the folds' occlusion and the grime at hem and waist are vertex colours.
#   Belt: a leather band over the kilt's waist, knotted at the front left with two tails.
#   Satchel: a leather bag at the back of the left hip with a flap and a toggle, three clay tablets standing out of
#     it, and a strap across the chest, over the right shoulder and down the back (laid on the body's surface).
#   Sandals: leather soles shaped to the feet, with a toe post, a V over the instep and a heel strap.
# Leather: a tiling grain with creases for colour, normal and roughness; worn edges, darkening and occlusion are
# vertex colours. Clay: a tiling fired-clay texture with incised marks of an invented script.
# Weights: the kilt blends the pelvis with each thigh by height and side, so the front lifts with a raised knee and
# the hem follows the stride; the strap takes the body's own weights where it lies; the bag and tablets ride the
# pelvis; the belt the pelvis and lower spine; the sandals the foot and the toes.
#   Blender -b build/hero/work/face.blend --python gear.py -- [--out=build/hero/work/hero.blend] [--frames=60]
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
OUT = A.get('out', os.path.join(H.WORK, 'hero.blend'))
TEX = os.path.join(H.WORK, 'tex')
rng = np.random.default_rng(17)
arm = bpy.data.objects['UAL_bind']
body = bpy.data.objects['Body']
J = {b.name: (arm.matrix_world @ b.head_local) for b in arm.data.bones}
dg = bpy.context.evaluated_depsgraph_get()
body_bvh = BVHTree.FromObject(body, dg)


def lin(c):
    c = np.asarray(c, dtype=np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def save_png(name, rgb, srgb=True):
    h, w = rgb.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=False)
    im.colorspace_settings.name = 'Non-Color'
    px = np.ones((h, w, 4), dtype=np.float32)
    px[..., :3] = to_srgb(rgb) if srgb else np.clip(rgb, 0, 1)
    im.pixels = px.ravel()
    path = os.path.join(TEX, name + '.png')
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    print('HERO wrote', path)
    return path


# ---------------------------------------------------------------- periodic noise (tiles seamlessly)
def pnoise(n, scale, seed, octaves=1):
    """Periodic band-limited noise on an n×n torus: white noise filtered in frequency (wavelength ≈ n/scale)."""
    g = np.random.default_rng(seed)
    out = np.zeros((n, n))
    amp = 1.0
    for o in range(octaves):
        f = np.fft.fftfreq(n)
        fx, fy = np.meshgrid(f, f)
        r = np.sqrt(fx * fx + fy * fy) * n / (scale * 2 ** o)
        filt = np.exp(-r * r)
        w = g.standard_normal((n, n))
        out += amp * np.real(np.fft.ifft2(np.fft.fft2(w) * filt))
        amp *= 0.5
    return out / (out.std() + 1e-9)


def height_to_normal(h, strength):
    gy, gx = np.gradient(np.pad(h, 1, mode='wrap'))
    gx, gy = gx[1:-1, 1:-1], gy[1:-1, 1:-1]
    n = np.stack([-gx * strength, -gy * strength, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


# ================================================================ tiling textures
def linen_textures(n=512, threads=32):
    """Plain weave: warp (vertical) and weft (horizontal) yarns crossing over and under, each yarn a little thicker or
    thinner along its length (slubs), the colour of unbleached linen with flecks."""
    y, x = np.mgrid[0:n, 0:n] / n
    p = n / threads  # pixels per thread
    tx, ty = x * threads, y * threads
    # yarn profiles across their width, with slubs: width varies slowly along the yarn
    slub_w = 0.75 + 0.18 * pnoise(n, threads / 6, 1)
    slub_h = 0.75 + 0.18 * pnoise(n, threads / 6, 2).T
    fx, fy = tx % 1 - 0.5, ty % 1 - 0.5
    warp = np.clip(1 - (2 * fx / slub_w) ** 2, 0, 1) ** 0.5
    weft = np.clip(1 - (2 * fy / slub_h) ** 2, 0, 1) ** 0.5
    # over/under: on a checkerboard of crossings one yarn is on top
    over = ((np.floor(tx) + np.floor(ty)) % 2 == 0)
    wave_x = np.cos(np.pi * (ty % 2 - 0.5))  # the warp rises and falls over the weft
    wave_y = np.cos(np.pi * (tx % 2 - 0.5))
    hw = warp * (0.6 + 0.4 * np.where(over, 1, -1) * 0.5) + 0.25 * wave_x * warp
    hf = weft * (0.6 + 0.4 * np.where(over, -1, 1) * 0.5) + 0.25 * wave_y * weft
    h = np.maximum(hw, hf)
    fibre = pnoise(n, n / 3, 3) * 0.08
    h = h + fibre
    base = lin([192, 178, 150])
    tone = 1 + 0.06 * pnoise(n, threads / 2, 4) + 0.04 * pnoise(n, 6, 5)
    fleck = np.clip(pnoise(n, n / 2.5, 6) - 2.6, 0, 1)
    col = base * tone[..., None] * (0.82 + 0.18 * np.clip(h, 0, 1))[..., None]
    col = col * (1 - 0.5 * fleck[..., None]) + lin([120, 100, 75]) * 0.5 * fleck[..., None]
    nrm = height_to_normal(h, 2.2 * threads / 64 * 1.0)
    rough = 0.78 + 0.08 * (1 - np.clip(h, 0, 1)) + 0.03 * pnoise(n, 20, 7)
    orm = np.stack([0.75 + 0.25 * np.clip(h, 0, 1), np.clip(rough, 0, 1), np.zeros_like(h)], -1)
    return col, nrm, orm


def leather_textures(n=512):
    """Vegetable-tanned leather: a fine pebbled grain, soft creases from wear, uneven tanning."""
    cells = pnoise(n, 80, 11)
    pores = np.clip(pnoise(n, 160, 12) - 1.2, 0, 2)
    grain = 0.5 * np.tanh(cells) - 0.25 * pores
    crease = -np.clip(np.abs(pnoise(n, 9, 13, octaves=2)), 0, 2.5) ** 2 / 6.25  # 0 … -1 in the valleys of the creases
    crease = np.where(crease < -0.55, crease, 0.0) + 0.55 * (crease < -0.55)
    h = grain * 0.25 + crease * 1.2
    nrm = height_to_normal(h, 2.2)
    base = lin([62, 36, 20])
    tone = 1 + 0.10 * np.tanh(pnoise(n, 5, 14)) + 0.03 * np.tanh(cells)
    col = base * tone[..., None] * (1 + 0.35 * crease)[..., None] * (1 - 0.08 * pores)[..., None]
    rough = 0.58 + 0.06 * np.tanh(pnoise(n, 30, 15)) - 0.1 * crease
    orm = np.stack([1 + 0.25 * crease, np.clip(rough, 0.35, 0.85), np.zeros_like(h)], -1)
    return np.clip(col, 0, 1), nrm, np.clip(orm, 0, 1)


def clay_textures(n=512):
    """Sun-dried clay with incised strokes: rows of short wedge marks (an invented script, not any real one)."""
    h = 0.15 * pnoise(n, 40, 21) + 0.08 * pnoise(n, 120, 22)
    y, x = np.mgrid[0:n, 0:n] / n
    rows = 10
    marks = np.zeros((n, n))
    g = np.random.default_rng(23)
    for r in range(rows):
        cy = (r + 0.5) / rows
        cx = 0.03
        while cx < 0.97:
            w = g.uniform(0.012, 0.03)
            kind = g.integers(0, 3)
            ang = [0.0, np.pi / 2, np.pi / 4][kind] + g.normal(0, 0.08)
            L = g.uniform(0.02, 0.045)
            dx, dy = x - cx, y - cy
            # periodic distance (tiles)
            dx = (dx + 0.5) % 1 - 0.5
            dy = (dy + 0.5) % 1 - 0.5
            u = dx * np.cos(ang) + dy * np.sin(ang)
            v = -dx * np.sin(ang) + dy * np.cos(ang)
            t = np.clip(u / L, 0, 1)
            wedge = np.exp(-(v / (0.0045 * (1.4 - t))) ** 2) * ((u > 0) & (u < L))
            marks = np.maximum(marks, wedge * (1 - 0.4 * t))
            cx += L + w
    h = h - 1.2 * marks
    nrm = height_to_normal(h, 9.0)
    base = lin([156, 104, 68])
    col = base * (1 + 0.08 * pnoise(n, 12, 24))[..., None] * (1 - 0.5 * marks)[..., None]
    rough = 0.88 + 0.04 * pnoise(n, 30, 25)
    orm = np.stack([1 - 0.5 * marks, np.clip(rough, 0, 1), np.zeros_like(h)], -1)
    return col, nrm, orm


paths = {}
for name, fn in (('linen', linen_textures), ('leather', leather_textures), ('clay', clay_textures)):
    col, nrm, orm = fn()
    paths[name] = (save_png(f'{name}_basecolor', col), save_png(f'{name}_normal', nrm, False), save_png(f'{name}_orm', orm, False))


def tiled_material(name, tex, vertex_color=True, double=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    c, nm_, o = tex
    tc = nt.nodes.new('ShaderNodeTexImage')
    tc.image = bpy.data.images.load(c, check_existing=True)
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = bpy.data.images.load(nm_, check_existing=True)
    tn.image.colorspace_settings.name = 'Non-Color'
    to = nt.nodes.new('ShaderNodeTexImage')
    to.image = bpy.data.images.load(o, check_existing=True)
    to.image.colorspace_settings.name = 'Non-Color'
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(tn.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], b.inputs['Normal'])
    nt.links.new(to.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
    if vertex_color:
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        nt.links.new(tc.outputs['Color'], mul.inputs[6])
        nt.links.new(vc.outputs['Color'], mul.inputs[7])
        nt.links.new(mul.outputs[2], b.inputs['Base Color'])
    else:
        nt.links.new(tc.outputs['Color'], b.inputs['Base Color'])
    m.use_backface_culling = not double
    return m


M_LINEN = tiled_material('linen', paths['linen'], double=True)
M_LEATHER = tiled_material('leather', paths['leather'])
M_CLAY = tiled_material('clay', paths['clay'])


def link(o):
    if o.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(o)


def mesh_from_bm(name, bm, mat, sharp=0.0):
    """A mesh from bmesh; edges whose faces meet at more than `sharp` radians stay crisp (leather's cut edges)."""
    if sharp > 0:
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0) > sharp:
                e.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    link(o)
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    return o


def body_radius(center, ang, z, cap=0.3):
    """Distance from a vertical axis through center to the body's outer surface at height z, along angle ang
    (0 = front, -Y; +90° = his left, +X)."""
    d = Vector((math.sin(ang), -math.cos(ang), 0))
    o = Vector((center.x, center.y, z)) + d * cap
    hit = body_bvh.ray_cast(o, -d, cap)
    return cap - hit[3] if hit[0] is not None else 0.0


# ================================================================ kilt
Z_TOP, Z_HEM = 1.02, 0.60


def z_top(a):
    """The waistline at angle a round the body (0 = front): low in front, higher behind, as a wrap sits."""
    return Z_TOP + 0.04 * (1 - math.cos(a)) / 2


def z_top_at(p):
    return z_top(math.atan2(p.x - axis.x, -(p.y - axis.y)))
SEG, ROWS = 72, 20
N_PLEATS = 15
FLAP = (math.radians(-10), math.radians(42))  # the wrap's outer layer: from just right of centre round to his left
axis = Vector((0, -0.03, 0))
TILE = 0.02  # metres per linen tile (32 threads: 16 to the centimetre)


def ang_of(k):
    return 2 * math.pi * k / SEG


top_r = [body_radius(axis, ang_of(k), z_top(ang_of(k))) + 0.006 for k in range(SEG)]
bm = bmesh.new()
uvl = bm.loops.layers.uv.new('UVMap')
grid = []
circ = 0.0
for k in range(SEG):
    a, b = ang_of(k), ang_of(k + 1)
    circ += (Vector((math.sin(a) * top_r[k], -math.cos(a) * top_r[k], 0)) -
             Vector((math.sin(b) * top_r[(k + 1) % SEG], -math.cos(b) * top_r[(k + 1) % SEG], 0))).length
for r in range(ROWS + 1):
    t = r / ROWS
    row = []
    for k in range(SEG):
        a = ang_of(k)
        z = z_top(a) + (Z_HEM - z_top(a)) * t
        # gathered at the waist into soft pleats (not in the wrap's smooth front), hanging wider below
        in_flap = FLAP[0] - 0.1 < (a + math.pi) % (2 * math.pi) - math.pi < FLAP[1] + 0.1
        pleat = 0.0 if in_flap else 0.011 * max(0.0, math.sin(N_PLEATS * a)) * (1 - 0.6 * t)
        flare = 0.075 * t ** 1.15 * (1 + 0.5 * abs(math.sin(a)))
        rr = max(top_r[k] + pleat + flare, body_radius(axis, a, z) + 0.012)
        row.append(bm.verts.new(axis + Vector((math.sin(a) * rr, -math.cos(a) * rr, z))))
    grid.append(row)
for r in range(ROWS):
    for k in range(SEG):
        f = bm.faces.new((grid[r][k], grid[r + 1][k], grid[r + 1][(k + 1) % SEG], grid[r][(k + 1) % SEG]))
        for l, (rr_, kk) in zip(f.loops, ((r, k), (r + 1, k), (r + 1, k + 1), (r, k + 1))):
            l[uvl].uv = (kk / SEG * circ / TILE, -rr_ / ROWS * (Z_TOP - Z_HEM) / TILE)
bm.normal_update()
kilt = mesh_from_bm('Kilt', bm, M_LINEN)
for p in kilt.data.polygons:
    if p.normal.dot(p.center - Vector((axis.x, axis.y, p.center.z))) < 0:
        p.flip()
pin = kilt.vertex_groups.new(name='pin')
pin.add(list(range(SEG)), 1.0, 'REPLACE')

col_mod = body.modifiers.new('Collision', 'COLLISION')
body.collision.thickness_outer = 0.006
body.collision.thickness_inner = 0.004
body.collision.cloth_friction = 3.0
cm = kilt.modifiers.new('Cloth', 'CLOTH')
cs = cm.settings
cs.quality = 12
cs.mass = 0.18
cs.air_damping = 3.0
cs.tension_stiffness = 35
cs.compression_stiffness = 35
cs.shear_stiffness = 15
cs.bending_stiffness = 0.25
cs.vertex_group_mass = 'pin'
cm.collision_settings.distance_min = 0.003
cm.collision_settings.use_self_collision = False
sc = bpy.context.scene
FR = int(A.get('frames', '70'))
cm.point_cache.frame_start = 1
cm.point_cache.frame_end = FR
sc.frame_start, sc.frame_end = 1, FR
for f in range(1, FR + 1):
    sc.frame_set(f)
bpy.context.view_layer.objects.active = kilt
kilt.select_set(True)
bpy.ops.object.modifier_apply(modifier=cm.name)
kilt.select_set(False)
body.modifiers.remove(col_mod)
sc.frame_set(1)
kilt.vertex_groups.remove(kilt.vertex_groups['pin'])

# the wrap's outer layer over the front: the draped cloth again, 5 mm out, its free edge rolled under; and a turned hem
kbm = bmesh.new()
kbm.from_mesh(kilt.data)
kbm.verts.ensure_lookup_table()
KV = list(kbm.verts)  # the draped cloth's own vertices, row-major (ROWS + 1) × SEG
kuv = kbm.loops.layers.uv.active
cols = [k for k in range(SEG) if FLAP[0] <= (ang_of(k) + math.pi) % (2 * math.pi) - math.pi <= FLAP[1]]
cols.sort(key=lambda k: (ang_of(k) + math.pi) % (2 * math.pi) - math.pi)
kbm.normal_update()
outer = {}
for r in range(ROWS + 1):
    for k in cols:
        v = KV[r * SEG + k]
        n = v.normal.copy()
        n.z *= 0.3
        n.normalize()
        outer[(r, k)] = kbm.verts.new(v.co + n * (0.004 + 0.003 * r / ROWS))
for r in range(ROWS):
    for i in range(len(cols) - 1):
        k0, k1 = cols[i], cols[i + 1]
        f = kbm.faces.new((outer[(r, k0)], outer[(r + 1, k0)], outer[(r + 1, k1)], outer[(r, k1)]))
        for l, (rr_, kk) in zip(f.loops, ((r, k0), (r + 1, k0), (r + 1, k1), (r, k1))):
            l[kuv].uv = (kk / SEG * circ / TILE + 0.37, -rr_ / ROWS * (Z_TOP - Z_HEM) / TILE)
# the free edge (first column) rolls back under the layer: a narrow strip turning inward
k0 = cols[0]
roll = {}
for r in range(ROWS + 1):
    v = outer[(r, k0)]
    tan = (outer[(r, cols[1])].co - v.co).normalized()
    nrm = (v.co - KV[r * SEG + k0].co).normalized()
    roll[r] = kbm.verts.new(v.co - nrm * 0.0035 + tan * 0.004)
for r in range(ROWS):
    f = kbm.faces.new((roll[r], roll[r + 1], outer[(r + 1, k0)], outer[(r, k0)]))
    for l, rr_ in zip(f.loops, (r, r + 1, r + 1, r)):
        l[kuv].uv = (0.1, -rr_ / ROWS * (Z_TOP - Z_HEM) / TILE)
# turned hem: the bottom edge (both layers) folds up inside by 9 mm
def hem(verts, shift):
    ring = []
    for v in verts:
        inward = Vector((axis.x - v.co.x, axis.y - v.co.y, 0)).normalized()
        ring.append(kbm.verts.new(v.co + inward * 0.003 + Vector((0, 0, 0.009))))
    return ring
bottom = [KV[ROWS * SEG + k] for k in range(SEG)]
hring = hem(bottom, 0)
for k in range(SEG):
    f = kbm.faces.new((bottom[k], bottom[(k + 1) % SEG], hring[(k + 1) % SEG], hring[k]))
    for l, kk in zip(f.loops, (k, k + 1, k + 1, k)):
        l[kuv].uv = (kk / SEG * circ / TILE, 0.3)
ob = [outer[(ROWS, k)] for k in cols]
ohr = hem(ob, 0)
for i in range(len(ob) - 1):
    f = kbm.faces.new((ob[i], ob[i + 1], ohr[i + 1], ohr[i]))
    for l in f.loops:
        l[kuv].uv = (i * 0.1, 0.3)
kbm.normal_update()
kbm.to_mesh(kilt.data)
kbm.free()
for p in kilt.data.polygons:
    p.use_smooth = True
print('HERO kilt', len(kilt.data.polygons), 'faces')

kilt_bvh = BVHTree.FromObject(kilt, bpy.context.evaluated_depsgraph_get())


def outer_radius(center, ang, z, objs_bvh=(body_bvh, kilt_bvh), cap=0.32):
    d = Vector((math.sin(ang), -math.cos(ang), 0))
    o = Vector((center.x, center.y, z)) + d * cap
    best = 0.0
    for bvh in objs_bvh:
        hit = bvh.ray_cast(o, -d, cap)
        if hit[0] is not None:
            best = max(best, cap - hit[3])
    return best


# ================================================================ sweeps (belt, strap, sandal straps)
def sweep(name, pts, normals, width, thick, mat, closed=False, uv_tile=0.05, taper_ends=False):
    """A flat band along pts (each with the surface normal it lies on): width across, thickness along the normal."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    n = len(pts)
    rings = []
    s = [0.0]
    for i in range(1, n):
        s.append(s[-1] + (pts[i] - pts[i - 1]).length)
    for i in range(n):
        p = pts[i]
        t = (pts[(i + 1) % n] - pts[i - 1]) if closed else (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)])
        t.normalize()
        nn = normals[i] - t * normals[i].dot(t)
        nn.normalize()
        b = t.cross(nn).normalized()
        w = width * (0.75 if taper_ends and (i == 0 or i == n - 1) else 1.0)
        ring = [bm.verts.new(p + b * w / 2), bm.verts.new(p + b * w / 2 + nn * thick),
                bm.verts.new(p - b * w / 2 + nn * thick), bm.verts.new(p - b * w / 2)]
        rings.append(ring)
    seg = n if closed else n - 1
    vs = [0.0, thick / width, 1.0, 1.0 + thick / width]
    for i in range(seg):
        a, c = rings[i], rings[(i + 1) % n]
        for j in range(4):
            f = bm.faces.new((a[j], c[j], c[(j + 1) % 4], a[(j + 1) % 4]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                l[uvl].uv = (s[min(ii, n - 1)] / uv_tile if ii < n else (s[-1] + (pts[0] - pts[-1]).length) / uv_tile,
                             [0.0, thick, width + thick, width + 2 * thick, width + 2 * thick][jj] / uv_tile)
    if not closed:
        for ring, rev in ((rings[0], True), (rings[-1], False)):
            f = bm.faces.new(list(reversed(ring)) if rev else ring)
            for l in f.loops:
                l[uvl].uv = (0, 0)
    bm.normal_update()
    o = mesh_from_bm(name, bm, mat, sharp=0.9)
    return o


def on_surface(p, off, bvhs=(body_bvh,)):
    """Nearest point on the given surfaces and its normal, pushed out by off."""
    best = None
    for bvh in bvhs:
        loc, nrm, idx, d = bvh.find_nearest(p)
        if loc is not None and (best is None or d < best[2]):
            best = (loc, nrm, d)
    loc, nrm, _ = best
    return loc + nrm * off, nrm


def catmull(ctrl, n):
    out = []
    m = len(ctrl)
    for i in range(n):
        u = i / (n - 1) * (m - 1)
        k = min(int(u), m - 2)
        t = u - k
        p0, p1, p2, p3 = ctrl[max(k - 1, 0)], ctrl[k], ctrl[k + 1], ctrl[min(k + 2, m - 1)]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    return out


# ================================================================ belt
B_Z, B_W, B_T = 1.012, 0.038, 0.0042
KNOT = math.radians(34)
pts, nrms = [], []
for k in range(120):
    a = 2 * math.pi * k / 120
    bz = B_Z + (z_top(a) - Z_TOP)  # the belt follows the waistline round to the back
    r = outer_radius(axis, a, bz) + 0.0015
    for dz in (-B_W / 2, B_W / 2):
        r = max(r, outer_radius(axis, a, bz + dz) + 0.0015)
    pts.append(axis + Vector((math.sin(a) * r, -math.cos(a) * r, bz)))
    nrms.append(Vector((math.sin(a), -math.cos(a), 0)))
# the band's "normal" for sweep is the outward direction; sweep puts the width across (vertical here)
belt = sweep('Belt', [p - n * 0.0 for p, n in zip(pts, nrms)], nrms, B_W, B_T, M_LEATHER, closed=True)
# knot and tails at the front left
kc = axis + Vector((math.sin(KNOT), -math.cos(KNOT), 0)) * (outer_radius(axis, KNOT, B_Z) + 0.012)
kc.z = B_Z + (z_top(KNOT) - Z_TOP)
bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=1, location=kc)
knot = bpy.context.active_object
knot.name = 'BeltKnot'
knot.scale = (0.021, 0.014, 0.017)
knot.rotation_euler = (0, 0, KNOT)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
knot.data.materials.append(M_LEATHER)
for p in knot.data.polygons:
    p.use_smooth = True
tails = []
for i, (spread, length) in enumerate(((-0.018, 0.20), (0.02, 0.16))):
    ctrl = []
    for j in range(7):
        t = j / 6
        z = B_Z + (z_top(KNOT) - Z_TOP) - 0.01 - length * t
        a = KNOT + spread * 2.2 * t + spread * 0.5
        r = outer_radius(axis, a, z) + 0.004 + 0.006 * t
        ctrl.append(axis + Vector((math.sin(a) * r, -math.cos(a) * r, z)))
    path = catmull(ctrl, 14)
    nn = [Vector((math.sin(KNOT + spread), -math.cos(KNOT + spread), 0)) for _ in path]
    tails.append(sweep(f'BeltTail{i}', path, nn, 0.026, 0.004, M_LEATHER, taper_ends=True))

# ================================================================ satchel
BAG_A = math.radians(128)  # back of the left hip
BAG_Z = 0.905
bag_dir = Vector((math.sin(BAG_A), -math.cos(BAG_A), 0))
r_out = max(outer_radius(axis, BAG_A + da, BAG_Z + dz) for da in (-0.25, 0, 0.25) for dz in (-0.08, 0, 0.08))
BW, BH, BD = 0.23, 0.185, 0.06
bc = axis + bag_dir * (r_out + BD / 2 + 0.004)
bc.z = BAG_Z
bpy.ops.mesh.primitive_cube_add(size=1, location=bc)
bag = bpy.context.active_object
bag.name = 'Satchel'
bag.scale = (BW, BD, BH)
bag.rotation_euler = (0, 0, BAG_A + math.pi)  # its local -Y (front) faces away from the body
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.bevel(offset=0.024, segments=3, profile=0.55, affect='EDGES')
bpy.ops.mesh.select_all(action='DESELECT')
bpy.ops.object.mode_set(mode='OBJECT')
# open top: remove the upward-facing faces and roll a rim
bbm = bmesh.new()
bbm.from_mesh(bag.data)
top_faces = [f for f in bbm.faces if f.normal.z > 0.9 and f.calc_center_median().z > BAG_Z + BH / 2 - 0.004]
bmesh.ops.delete(bbm, geom=top_faces, context='FACES')
# bulge the outer face a little (it holds tablets) and sag the bottom
for v in bbm.verts:
    rel = v.co - bc
    out = rel.dot(bag_dir)
    if out > BD / 2 - 0.01:
        v.co += bag_dir * 0.006 * max(0.0, 1 - (abs(rel.z) / (BH / 2)) ** 2)
    if rel.z < -BH / 2 + 0.02:
        v.co.z -= 0.004 * (1 - (rel.cross(Vector((0, 0, 1))).length / (BW / 2)) ** 2)
    # wrap round the hip: the bag bends with the body behind it
    lat = rel.dot(Vector((0, 0, 1)).cross(bag_dir).normalized())
    v.co -= bag_dir * (lat * lat) / (2 * 0.26)
bbm.to_mesh(bag.data)
bbm.free()
bag.data.materials.append(M_LEATHER)
mod = bag.modifiers.new('Solidify', 'SOLIDIFY')
mod.thickness = 0.004
mod.offset = -1
bpy.context.view_layer.objects.active = bag
bpy.ops.object.modifier_apply(modifier=mod.name)
for p in bag.data.polygons:
    p.use_smooth = True
# box-mapped UVs in metres (the leather tiles every 5 cm)
bm_ = bmesh.new()
bm_.from_mesh(bag.data)
uvl = bm_.loops.layers.uv.verify()
for f in bm_.faces:
    n = f.normal
    for l in f.loops:
        p = l.vert.co
        if abs(n.z) > 0.7:
            l[uvl].uv = (p.x / 0.05, p.y / 0.05)
        elif abs(n.x) > abs(n.y):
            l[uvl].uv = (p.y / 0.05, p.z / 0.05)
        else:
            l[uvl].uv = (p.x / 0.05, p.z / 0.05)
bm_.to_mesh(bag.data)
bm_.free()

# a cord and toggle across the front
tog_c = bc + bag_dir * (BD / 2 + 0.01) + Vector((0, 0, BH / 2 - 0.035))
bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.006, depth=0.05, location=tog_c)
toggle = bpy.context.active_object
toggle.name = 'Toggle'
toggle.rotation_euler = (0, math.pi / 2, BAG_A + math.pi)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
toggle.data.materials.append(M_LEATHER)

# tablets: three, standing in the bag, tilted a little each
tabs = []
side = Vector((0, 0, 1)).cross(bag_dir).normalized()
for i, (off, tilt, h, w) in enumerate(((-0.065, -6, 0.098, 0.068), (0.0, 3, 0.104, 0.072), (0.066, 8, 0.094, 0.066))):
    c = bc + side * off + Vector((0, 0, BH / 2 - h / 2 + 0.045 + 0.006 * i))
    bpy.ops.mesh.primitive_cube_add(size=1, location=c)
    tb = bpy.context.active_object
    tb.name = f'Tablet{i}'
    tb.scale = (w, 0.021, h)
    tb.rotation_euler = (math.radians(rng.uniform(-4, 4)), math.radians(tilt), BAG_A + math.pi)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.bevel(offset=0.006, segments=2, profile=0.7, affect='EDGES')
    bpy.ops.object.mode_set(mode='OBJECT')
    for p in tb.data.polygons:
        p.use_smooth = True
    bm_ = bmesh.new()
    bm_.from_mesh(tb.data)
    uvl = bm_.loops.layers.uv.verify()
    lx = side
    lz = Vector((0, 0, 1))
    for f in bm_.faces:
        for l in f.loops:
            p = l.vert.co - c
            l[uvl].uv = (p.dot(lx) / 0.07 + 0.31 * i, p.dot(lz) / 0.07 + 0.17 * i)
    # pillowy faces: push the broad faces out a touch in the middle
    for v in bm_.verts:
        p = v.co - c
        d = p.dot(bag_dir)
        if abs(d) > 0.006:
            k = max(0.0, 1 - (p.dot(lx) / (w / 2)) ** 2) * max(0.0, 1 - (p.dot(lz) / (h / 2)) ** 2)
            v.co += bag_dir * math.copysign(0.0025 * k, d)
    bm_.to_mesh(tb.data)
    bm_.free()
    tb.data.materials.append(M_CLAY)
    tabs.append(tb)

# ================================================================ strap: across the chest, over the right shoulder, down the back
front_end = bc + side * (BW / 2 - 0.01) * -1 + Vector((0, 0, BH / 2 - 0.01))
back_end = bc + side * (BW / 2 - 0.01) + Vector((0, 0, BH / 2 - 0.01))
if front_end.y > back_end.y:
    front_end, back_end = back_end, front_end
ctrl = [front_end + Vector((0, 0, 0.0)), Vector((0.12, -0.10, 1.10)), Vector((0.055, -0.135, 1.20)),
        Vector((-0.02, -0.14, 1.30)), Vector((-0.075, -0.12, 1.39)), Vector((-0.105, -0.07, 1.455)),
        Vector((-0.115, -0.01, 1.49)), Vector((-0.105, 0.05, 1.46)), Vector((-0.07, 0.10, 1.37)),
        Vector((0.0, 0.125, 1.25)), Vector((0.075, 0.13, 1.13)), back_end]
path = catmull(ctrl, 90)
sp, sn = [], []
for p in path:
    q, n = on_surface(p, 0.0025, (body_bvh, kilt_bvh))
    sp.append(q)
    sn.append(n)
# a strap under tension runs smooth and bridges hollows: relax it along its length, never letting it sink into
# the skin or the cloth
for _ in range(40):
    sm = [sp[0]] + [sp[i] * 0.5 + (sp[i - 1] + sp[i + 1]) * 0.25 for i in range(1, len(sp) - 1)] + [sp[-1]]
    for i in range(1, len(sm) - 1):
        q, n = on_surface(sm[i], 0.0, (body_bvh, kilt_bvh))
        d = (sm[i] - q).dot(n)
        if d < 0.0025:
            sm[i] = sm[i] + n * (0.0025 - d)
        sn[i] = n
    sp = sm
strap = sweep('Strap', sp, sn, 0.036, 0.0035, M_LEATHER, uv_tile=0.05)

# ================================================================ sandals
SOLE_T = 0.006
sandals = []
foot_v = np.array([v.co[:] for v in body.data.vertices])
gw = {g.index: g.name for g in body.vertex_groups}
dom = []
for v in body.data.vertices:
    best = max(((gw[g.group], g.weight) for g in v.groups if not gw[g.group].startswith('m_')), key=lambda x: x[1], default=('', 0))
    dom.append(best[0])
dom = np.array(dom)


def hull2d(P):
    P = sorted(map(tuple, P))
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in P:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(P):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return np.array(lo[:-1] + hi[:-1])


for sd, sgn in (('l', 1), ('r', -1)):
    sel = np.isin(dom, [f'foot_{sd}', f'ball_{sd}']) & (foot_v[:, 2] < 0.022)
    P2 = foot_v[sel][:, :2]
    hull = hull2d(P2)
    cen = P2.mean(0)
    # resample the outline evenly and push it out 5 mm
    seg = np.concatenate([hull, hull[:1]])
    lens = np.linalg.norm(np.diff(seg, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(lens)])
    N = 40
    outline = []
    for s in np.linspace(0, cum[-1], N, endpoint=False):
        i = np.searchsorted(cum, s, side='right') - 1
        t = (s - cum[i]) / max(lens[i], 1e-9)
        p = seg[i] + (seg[i + 1] - seg[i]) * t
        d = p - cen
        outline.append(p + d / np.linalg.norm(d) * 0.005)
    outline = np.array(outline)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    layers = [(-0.0015, 0.0), (0.0, 0.0025), (0.0, SOLE_T - 0.0015), (-0.0018, SOLE_T)]  # (inset, z)
    rings = []
    for inset, z in layers:
        ring = []
        for p in outline:
            d = p - cen
            q = p + d / np.linalg.norm(d) * inset
            ring.append(bm.verts.new((q[0], q[1], z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(N):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % N], rings[i + 1][(k + 1) % N], rings[i + 1][k]))
    ctop = bm.verts.new((cen[0], cen[1], SOLE_T))
    cbot = bm.verts.new((cen[0], cen[1], 0.0))
    for k in range(N):
        bm.faces.new((rings[-1][k], rings[-1][(k + 1) % N], ctop))
        bm.faces.new((rings[0][(k + 1) % N], rings[0][k], cbot))
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv = (l.vert.co.x / 0.05, l.vert.co.y / 0.05)
    bm.normal_update()
    sole = mesh_from_bm(f'Sandal_{sd}', bm, M_LEATHER, sharp=0.6)
    for p in sole.data.polygons:
        if p.normal.dot(p.center - Vector((cen[0], cen[1], SOLE_T / 2))) < 0:
            p.flip()
    sandals.append(sole)
    # straps: toe post between the first and second toes, a V back to the sole's sides, and a heel strap
    ball = J[f'ball_{sd}']
    ankle = J[f'foot_{sd}']
    fwd = Vector((ball.x - ankle.x, ball.y - ankle.y, 0)).normalized()
    lat = Vector((0, 0, 1)).cross(fwd) * -sgn  # toward the little toe
    post = ball + fwd * 0.03 - lat * 0.014
    post.z = SOLE_T
    instep = ball - fwd * 0.045 + Vector((0, 0, 0.045))
    med = ankle + fwd * 0.03 - lat * 0.045
    med.z = 0.012
    latp = ankle + fwd * 0.03 + lat * 0.045
    latp.z = 0.012
    heel = ankle - fwd * 0.055 + Vector((0, 0, 0.035))
    foot_bvh_objs = (body_bvh,)
    for nm, ctrl in (('post', [post, post + Vector((0, 0, 0.015)) - fwd * 0.01, instep]),
                     ('med', [instep, (instep + med) / 2 + Vector((0, 0, 0.01)), med]),
                     ('lat', [instep, (instep + latp) / 2 + Vector((0, 0, 0.01)), latp]),
                     ('heel', [med + Vector((0, 0, 0.012)), ankle - fwd * 0.02 - lat * 0.03 + Vector((0, 0, 0.0)), heel,
                               ankle - fwd * 0.02 + lat * 0.03, latp + Vector((0, 0, 0.012))])):
        path = catmull(ctrl, 10 if nm != 'heel' else 18)
        pp, nn = [], []
        for p in path:
            q, n = on_surface(p, 0.0015)
            pp.append(q)
            nn.append(n)
        sandals.append(sweep(f'Sandal_{sd}_{nm}', pp, nn, 0.007 if nm != 'post' else 0.005, 0.0025, M_LEATHER, uv_tile=0.05))

gear = [kilt, belt, knot, *tails, bag, toggle, *tabs, strap, *sandals]
print('HERO gear objects', len(gear), 'faces', sum(len(o.data.polygons) for o in gear))

# ================================================================ weights
def set_weights(o, fn):
    """fn(world position) → {bone: weight}."""
    for g in list(o.vertex_groups):
        o.vertex_groups.remove(g)
    groups = {}
    for v in o.data.vertices:
        ws = fn(o.matrix_world @ v.co)
        s = sum(ws.values()) or 1.0
        for b, w in ws.items():
            if w / s < 1e-3:
                continue
            g = groups.get(b) or o.vertex_groups.new(name=b)
            groups[b] = g
            g.add([v.index], w / s, 'REPLACE')


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def kilt_weights(p):
    zt = z_top_at(p)
    h = (zt - p.z) / (zt - Z_HEM)
    k = 0.97 * smoothstep(0.0, 0.62, h)
    fl = min(1.0, max(0.0, 0.5 + p.x / 0.09))
    return {'pelvis': 1 - k, 'thigh_l': k * fl, 'thigh_r': k * (1 - fl)}


# body weights, sampled at the nearest point of the body's surface
bw_names = [g.name for g in body.vertex_groups if not g.name.startswith('m_')]
bw_idx = {g.index: g.name for g in body.vertex_groups if not g.name.startswith('m_')}
BW = np.zeros((len(body.data.vertices), len(bw_names)))
col_of = {n: i for i, n in enumerate(bw_names)}
for v in body.data.vertices:
    for g in v.groups:
        n = bw_idx.get(g.group)
        if n:
            BW[v.index, col_of[n]] = g.weight
polys = body.data.polygons


def body_weights(p, keep=None):
    loc, nrm, idx, d = body_bvh.find_nearest(p)
    vs = polys[idx].vertices
    co = [body.data.vertices[i].co for i in vs]
    ws = np.array([1 / max((c - loc).length, 1e-5) for c in co])
    w = (BW[list(vs)] * ws[:, None]).sum(0) / ws.sum()
    out = {bw_names[i]: float(w[i]) for i in np.argsort(-w)[:4] if w[i] > 1e-3}
    if keep:
        out = {b: x for b, x in out.items() if b in keep} or {keep[0]: 1.0}
    return out


# the kilt: where it lies on the skin it takes the skin's own weights (so a thigh never passes through it); away from
# the skin (the flare, between the legs) it blends toward the pelvis-and-thigh mix by height and side; then the
# weights are relaxed across the cloth so it stretches smoothly rather than creasing at a boundary
KB = ('pelvis', 'thigh_l', 'thigh_r', 'spine_01')
kv = kilt.data.vertices
Wk = np.zeros((len(kv), len(KB)))
for v in kv:
    p = kilt.matrix_world @ v.co
    loc, nrm, idx, d = body_bvh.find_nearest(p)
    near = body_weights(p, keep=list(KB))
    far = kilt_weights(p)
    a = smoothstep(0.03, 0.12, d)
    zt = z_top_at(p)
    h = (zt - p.z) / (zt - Z_HEM)
    a = max(a, 1 - smoothstep(0.05, 0.22, h))  # the waistband rides the pelvis
    for i, b in enumerate(KB):
        Wk[v.index, i] = (1 - a) * near.get(b, 0.0) + a * far.get(b, 0.0)
nbr = [[] for _ in kv]
for e in kilt.data.edges:
    i, j = e.vertices
    nbr[i].append(j)
    nbr[j].append(i)
for _ in range(8):
    Wk = np.array([0.5 * Wk[i] + 0.5 * Wk[nbr[i]].mean(0) if nbr[i] else Wk[i] for i in range(len(kv))])
Wk /= Wk.sum(1, keepdims=True)
for g in list(kilt.vertex_groups):
    kilt.vertex_groups.remove(g)
for i, b in enumerate(KB):
    g = kilt.vertex_groups.new(name=b)
    for vi in range(len(kv)):
        if Wk[vi, i] > 1e-3:
            g.add([vi], float(Wk[vi, i]), 'REPLACE')
for o in (belt, knot, *tails):
    set_weights(o, lambda p: {'pelvis': 0.85, 'spine_01': 0.15} if p.z > 0.99 else
                {'pelvis': 0.8, 'thigh_l': 0.2 * smoothstep(0.99, 0.83, p.z)})
for o in (bag, toggle, *tabs):
    set_weights(o, lambda p: {'pelvis': 1.0})
set_weights(strap, lambda p: body_weights(p) if p.z > 1.06 else {'pelvis': 1.0})
for o in sandals:
    set_weights(o, lambda p: body_weights(p, keep=[b for b in bw_names if b.startswith(('foot_', 'ball_', 'calf_'))]))
for o in gear:
    o.parent = arm
    md = o.modifiers.new('Armature', 'ARMATURE')
    md.object = arm

# hide the body where the kilt always covers it: the hips, groin and buttocks, and the tops of the thighs in front and
# behind (a raised or trailing thigh would otherwise push its skin through the cloth there; the kilt rides over it).
# The thighs' inner and outer sides stay, for the glimpses under a flying hem.
bbm = bmesh.new()
bbm.from_mesh(body.data)
dl = bbm.verts.layers.deform.active
gi = {g.name: g.index for g in body.vertex_groups}
drop = []
for f in bbm.faces:
    ok = True
    for v in f.verts:
        z = v.co.z
        w_pel = v[dl].get(gi['pelvis'], 0.0)
        w_th = v[dl].get(gi['thigh_l'], 0.0) + v[dl].get(gi['thigh_r'], 0.0)
        n = v.normal
        top = z_top_at(v.co) - 0.035
        hips = 0.80 < z < top and w_pel > 0.4
        # only the fronts of the thighs (a raised knee pushes them into the cloth); the backs stay, since a trailing
        # leg can open the kilt's back and show them
        thigh_top = 0.76 < z < top and w_th > 0.5 and n.y < -0.55
        if not (hips or thigh_top):
            ok = False
            break
    if ok:
        drop.append(f)
bmesh.ops.delete(bbm, geom=drop, context='FACES')
bmesh.ops.delete(bbm, geom=[v for v in bbm.verts if not v.link_faces], context='VERTS')
bbm.to_mesh(body.data)
bbm.free()
print('HERO body faces after hiding under the kilt', len(body.data.polygons), f'(-{len(drop)})')

# ================================================================ vertex colours: occlusion, grime, wear
for o in gear:
    if not o.data.color_attributes.get('Col'):
        o.data.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
    o.data.color_attributes.active_color = o.data.color_attributes['Col']
H.setup_cycles(samples=64, res=(64, 64))
sc.world = sc.world or bpy.data.worlds.new('w')
sc.world.light_settings.distance = 0.15
for o in gear:
    for x in bpy.data.objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
for o in gear:
    ca = o.data.color_attributes['Col']
    n = len(o.data.vertices)
    c = np.zeros(n * 4, dtype=np.float32)
    ca.data.foreach_get('color', c)
    c = c.reshape(n, 4)
    ao = np.clip(0.3 + 0.7 * c[:, 0], 0, 1)
    co = np.array([o.matrix_world @ v.co for v in o.data.vertices])
    if o == kilt:
        hem_dust = np.clip((0.70 - co[:, 2]) / 0.10, 0, 1) * 0.18
        sweat = np.clip((co[:, 2] - 0.97) / 0.04, 0, 1) * 0.12
        tint = np.array([1.0, 0.985, 0.95])
        rgb = ao[:, None] * tint * (1 - hem_dust[:, None] * np.array([0.8, 1.0, 1.25])) * (1 - sweat[:, None])
    else:
        # worn edges are lighter: estimate convexity from the mesh
        bm_ = bmesh.new()
        bm_.from_mesh(o.data)
        bm_.verts.ensure_lookup_table()
        conv = np.zeros(n)
        for v in bm_.verts:
            if v.link_edges:
                conv[v.index] = sum((v.co - e.other_vert(v).co).dot(v.normal) / max((v.co - e.other_vert(v).co).length, 1e-6)
                                    for e in v.link_edges) / len(v.link_edges)
        bm_.free()
        wear = np.clip(conv * 3.0, 0, 1)
        # scuffs: soft lighter patches where the leather has been rubbed (a smooth 3D noise of position)
        g = np.random.default_rng(abs(hash(o.name)) % 2 ** 32)
        waves = g.normal(0, 1, (6, 3)) * 28.0
        phase = g.uniform(0, 2 * np.pi, 6)
        scuff = np.clip(np.sin(co @ waves.T + phase).sum(1) / 2.4, -1, 1)
        scuff = np.clip(scuff - 0.35, 0, 1)
        rgb = ao[:, None] * (1 + 0.6 * wear[:, None] * np.array([1.0, 0.9, 0.75]))
        rgb = rgb * (1 + 0.28 * scuff[:, None] * np.array([1.0, 0.92, 0.8]))
        if o.name == 'Strap':
            # the side against the skin is darker with sweat
            nn = np.array([o.matrix_world.to_3x3() @ v.normal for v in o.data.vertices])
            out_dir = co - np.array([0.0, -0.03, co[:, 2].mean()])[None, :] * np.array([1, 1, 0])
            out_dir[:, 2] = 0
            inward = (nn * out_dir).sum(1) < 0
            rgb[inward] *= 0.72
        if o.name.startswith('Sandal') and '_' not in o.name[7:]:
            rgb *= np.array([0.82, 0.8, 0.78])  # the soles carry the street's dust
    out = np.ones((n, 4), dtype=np.float32)
    out[:, :3] = np.clip(rgb, 0, 1)
    ca.data.foreach_set('color', out.ravel())

# ================================================================ one mesh per material (fewer draw calls)
def join(name, objs):
    objs = [o for o in objs if o]
    for x in bpy.data.objects:
        x.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = o.data.name = name
    return o


join('Leather', [belt, knot, *tails, bag, toggle, strap, *sandals])
join('Tablets', tabs)
join('Eyes', [bpy.data.objects.get('eye_l'), bpy.data.objects.get('eye_r')])
join('Corneas', [bpy.data.objects.get('cornea_l'), bpy.data.objects.get('cornea_r')])
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.data.name = o.name
print('HERO meshes', [(o.name, len(o.data.polygons)) for o in bpy.data.objects if o.type == 'MESH'])
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('HERO saved', OUT)
