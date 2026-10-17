"""Build the clay and household props pack: jars and pithoi, bowls, lamps, a broken jar and shards, tablets drying on a
board, a tannur, a potter's wheel, sacks, baskets, reed mats and firewood. Exports build/kit/export/props.glb and
build/kit/stats/props.json.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/streets/kit/build_props.py -- \
      [--only=pithos,lamp_a] [--pack=props]

Frames: pivot at the base centre on the ground (z = 0 in glTF y), front toward +Z glTF (-Y Blender) unless a piece's
pivot note says otherwise.
"""
import os
import sys
import math
import time
import bmesh
import bpy
from mathutils import Vector, Matrix, Euler

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import kitlib as K  # noqa: E402
import proplib as PL  # noqa: E402
from proplib import TERRA, TERRA_BAND, CLAY, BASK, BASK_TILE  # noqa: E402
from archparts import beam_box, log_cyl  # noqa: E402

A = K.args()
PACK = A.get('pack', 'props')
ONLY = set(A['only'].split(',')) if 'only' in A else None
BASE = 'base centre on the ground (y = 0); upright along +Y; front +Z'

PIECES = []


def piece(name, kind, notes='', pivot=BASE, view=None, lens=None, bake_ground=True, ao=0.55, **extra):
    def deco(fn):
        PIECES.append(dict(name=name, kind=kind, notes=notes, pivot=pivot, fn=fn, view=view, lens=lens,
                           bake_ground=bake_ground, ao=ao, extra=extra))
        return fn
    return deco


# ---------------------------------------------------------------- pottery

SEGS = {0: 28, 1: 18, 2: 10}
STEP = {0: 0.045, 1: 0.085, 2: 0.16}


def r_at(outer, z):
    """Outer radius of a resampled profile at height z."""
    for a, b in zip(outer, outer[1:]):
        if (a[1] - z) * (b[1] - z) <= 0 and abs(b[1] - a[1]) > 1e-9:
            t = (z - a[1]) / (b[1] - a[1])
            return a[0] + (b[0] - a[0]) * t
    return outer[-1][0]


def pot_bm(lod, ctrl, thick, seed, bands=(), ridge=0.011, paint_bands=(), step_scale=1.0, inner_n=(6, 4, 3), wobble=0.012,
           segs=None, deform=None, bm=None, xform=None):
    """A lathed pot into a bmesh. bands: applied cord-impressed ridges (z0, z1). Returns (bm, outer profile)."""
    bm = bm or bmesh.new()
    uvl = K.ensure_uv(bm)
    st = STEP[lod] * step_scale
    refine = list(bands) + list(paint_bands) if lod < 2 else []
    outer = PL.adaptive(ctrl, st, refine, band_step=max(0.008, st * 0.25))
    if lod < 2:
        o2 = []
        for (r, z) in outer:
            for z0, z1 in bands:
                if z0 <= z <= z1:
                    r += ridge * math.sin(math.pi * (z - z0) / (z1 - z0)) ** 0.6
            o2.append((r, z))
        outer = o2
    maps = [(z0, z1, TERRA_BAND) for z0, z1 in bands] if lod < 2 else None
    prof = PL.vessel(None, thick, 0, inner_n[lod], lip=4 if lod == 0 else 2, maps=maps, outer=outer)
    n0 = len(bm.verts)

    def lumpy(co, th, k):
        if deform:
            co = deform(co, th, k)
        r = math.hypot(co.x, co.y)
        if r < 1e-5 or lod == 2:
            return co
        d = 0.0035 * K.noise3((co.x * 6.0, co.y * 6.0, co.z * 6.0), seed + 77, octaves=2)
        return Vector((co.x * (1 + d / r), co.y * (1 + d / r), co.z))
    PL.lathe(bm, uvl, prof, segs or SEGS[lod], 0, tile=0.5, vmap=TERRA, seed=seed, wobble=wobble if lod < 2 else 0.0,
             angle0=seed * 0.37, deform=lumpy)
    if xform:
        for v in list(bm.verts)[n0:]:
            v.co = xform @ v.co
    return bm, outer


def lug(bm, outer, z, ang, size=0.045, lod=0):
    """A horizontal loop handle on the shoulder."""
    uvl = K.ensure_uv(bm)
    r = r_at(outer, z)
    d = size / max(r, 0.05)
    n = 9 if lod == 0 else 5
    path = []
    for k in range(n):
        t = k / (n - 1)
        a = ang - d + 2 * d * t
        rr = r - 0.006 + size * 0.9 * math.sin(math.pi * t)
        path.append(Vector((rr * math.cos(a), rr * math.sin(a), z + 0.004 * math.sin(math.pi * t))))
    PL.tube(bm, uvl, path, 0.012, 7 if lod == 0 else 5, 0, ('strip', 0.1, 0.6), tile=0.5)


def strap(bm, outer, z_top, z_bot, ang, reach=0.07, lod=0, radius=0.011):
    """A vertical strap handle from the neck down to the shoulder."""
    uvl = K.ensure_uv(bm)
    rt, rb = r_at(outer, z_top), r_at(outer, z_bot)
    n = 11 if lod == 0 else 6
    ca, sa = math.cos(ang), math.sin(ang)
    path = []
    for k in range(n):
        t = k / (n - 1)
        rr = (rt - 0.006) * (1 - t) + (rb - 0.006) * t + reach * math.sin(math.pi * t) ** 0.8
        z = z_top * (1 - t) + z_bot * t + 0.03 * math.sin(math.pi * t)
        path.append(Vector((rr * ca, rr * sa, z)))
    PL.tube(bm, uvl, path, radius, 7 if lod == 0 else 5, 0, ('strip', 0.1, 0.6), tile=0.5)


def pottery(name, bm, tint, seed, chips=(), soot=None, base_grime=0.25, paint=None, weather=1.0):
    ob = K.new_object(name, bm, ['M_Terracotta'])
    for c in chips:
        PL.cut(ob, c[0], c[1], seed + c[2], squash=c[3] if len(c) > 3 else (1, 1, 1))
    PL.break_uvs(ob)
    h = max(v.co.z for v in ob.data.vertices) - min(v.co.z for v in ob.data.vertices)
    # in the street the clean peach of fired clay read too new: a little less saturated, darker, more weathered
    lum = 0.3 * tint[0] + 0.55 * tint[1] + 0.15 * tint[2]
    tint = tuple((0.86 * c + 0.14 * lum) * 0.93 for c in tint)
    PL.paint_pottery(ob, tint, soot=soot, seed=seed, base_grime=base_grime * 1.3, h=h, weather=min(1.6, weather * 1.3))
    if paint:
        K.paint(ob, paint, mode='multiply')
    return ob


PITHOS = [(0.0, 0.0), (0.13, 0.0), (0.165, 0.025), (0.27, 0.16), (0.39, 0.40), (0.452, 0.68), (0.43, 0.90),
          (0.345, 1.06), (0.235, 1.155), (0.198, 1.195), (0.205, 1.215), (0.248, 1.245), (0.258, 1.272), (0.236, 1.30)]
PITHOS_BANDS = [(0.60, 0.665), (0.93, 0.995)]


@piece('pithos', 'pottery', 'big storage pithos, 1.3 m: thick rolled rim, two applied cord-impressed bands',
       snap={'footprint_m': 0.92, 'height_m': 1.3})
def pithos(name, lod):
    bm, outer = pot_bm(lod, PITHOS, 0.028, 1, bands=PITHOS_BANDS)
    return pottery(name, bm, (0.88, 0.68, 0.53), 1)


@piece('pithos_chipped', 'pottery', 'a second pithos, its rim chipped and a flake spalled off the belly (break faces '
       'show the paler fired core)', snap={'footprint_m': 0.9, 'height_m': 1.29})
def pithos_chipped(name, lod):
    ctrl = [(r * 0.98, z * 0.99) for r, z in PITHOS]
    bm, outer = pot_bm(lod, ctrl, 0.028, 2, bands=[(0.58, 0.64)])
    chips = [((0.255 * math.cos(1.9), 0.255 * math.sin(1.9), 1.29), 0.075, 3, (1.0, 1.0, 0.75))]
    if lod < 2:
        chips.append(((0.5 * math.cos(-0.9), 0.5 * math.sin(-0.9), 0.5), 0.068, 5, (1.0, 1.0, 1.3)))
    return pottery(name, bm, (0.84, 0.64, 0.50), 2, chips=chips)


JAR = [(0.0, 0.0), (0.07, 0.0), (0.09, 0.02), (0.19, 0.14), (0.255, 0.36), (0.25, 0.53), (0.195, 0.645),
       (0.12, 0.715), (0.088, 0.745), (0.086, 0.77), (0.098, 0.795), (0.108, 0.81)]


@piece('jar_storage', 'pottery', 'storage jar, 0.81 m, two horizontal loop handles on the shoulder',
       snap={'footprint_m': 0.6, 'height_m': 0.81})
def jar_storage(name, lod):
    bm, outer = pot_bm(lod, JAR, 0.016, 3, segs={0: 28, 1: 18, 2: 10}[lod])
    for a in (0.0, math.pi):
        lug(bm, outer, 0.6, a + 3 * 0.37, lod=lod)
    return pottery(name, bm, (0.90, 0.63, 0.47), 3)


JUG = [(0.0, 0.0), (0.04, 0.0), (0.052, 0.008), (0.088, 0.075), (0.1, 0.145), (0.088, 0.215), (0.055, 0.265),
       (0.04, 0.29), (0.041, 0.315), (0.052, 0.34), (0.056, 0.35)]


@piece('jug_small', 'pottery', 'small jug, 0.35 m, a strap handle, two painted bands', snap={'footprint_m': 0.24, 'height_m': 0.35},
       view=[-0.7, -1.3, 0.55])
def jug_small(name, lod):
    bands = [(0.17, 0.19), (0.205, 0.215)]
    bm, outer = pot_bm(lod, JUG, 0.008, 4, paint_bands=bands, step_scale=0.45, segs={0: 26, 1: 16, 2: 8}[lod])
    strap(bm, outer, 0.30, 0.2, 4 * 0.37 + math.pi, reach=0.065, lod=lod)

    def paint(co, n, m, p):
        z = co.z
        on = any(z0 <= z <= z1 for z0, z1 in bands) and math.hypot(co.x, co.y) > 0.07
        return (0.62, 0.36, 0.27) if on else (1, 1, 1)
    return pottery(name, bm, (0.94, 0.83, 0.69), 4, paint=paint, weather=0.7)


BOWL = [(0.0, 0.0), (0.045, 0.0), (0.058, 0.007), (0.10, 0.04), (0.134, 0.074), (0.129, 0.088), (0.131, 0.106)]


@piece('bowl', 'pottery', 'carinated bowl, 0.27 m across', snap={'footprint_m': 0.27, 'height_m': 0.11}, view=[-0.6, -1.2, 0.9])
def bowl(name, lod):
    bm, outer = pot_bm(lod, BOWL, 0.007, 5, step_scale=0.35, segs={0: 30, 1: 18, 2: 10}[lod], inner_n=(8, 5, 3))
    return pottery(name, bm, (0.88, 0.64, 0.50), 5, base_grime=0.1, weather=0.6)


@piece('bowl_stack', 'pottery', 'four carinated bowls stacked', snap={'footprint_m': 0.28, 'height_m': 0.19}, view=[-0.6, -1.2, 0.8])
def bowl_stack(name, lod):
    bm = bmesh.new()
    for k in range(4):
        s = 1 - 0.03 * k
        ctrl = [(r * s, z * s) for r, z in BOWL]
        M = Matrix.Translation((0.004 * math.cos(k * 2.1), 0.004 * math.sin(k * 2.1), 0.026 * k)) @ Matrix.Rotation(0.02 * (k % 2 - 0.5), 4, 'X')
        pot_bm(lod, ctrl, 0.007, 6 + k, step_scale=0.45, segs={0: 22, 1: 14, 2: 8}[lod], inner_n=(4, 3, 2), bm=bm, xform=M)
    return pottery(name, bm, (0.87, 0.66, 0.52), 6, base_grime=0.1, weather=0.6)


# ---------------------------------------------------------------- lamps

def lamp(name, lod, seed, dia, depth, pinch, foot=False):
    R = dia / 2
    f0 = 0.01 if foot else 0.0
    ctrl = [(0.0, 0.0), (R * 0.3, 0.0), (R * 0.38, 0.004)] + ([(R * 0.4, f0), (R * 0.44, f0)] if foot else []) + \
           [(R * 0.62, depth * 0.42 + f0), (R * 0.8, depth * 0.72 + f0), (R * 0.95, depth * 0.88 + f0), (R * 1.08, depth * 0.95 + f0)]
    h = depth + (0.012 if foot else 0)

    def deform(co, th, k):
        w = K.smoothstep(0.5, 0.0, abs(math.atan2(math.sin(th), math.cos(th))))
        hz = K.smoothstep(h * 0.3, h * 0.95, co.z)
        p = min(1.0, pinch * w * hz)
        return Vector((co.x + 0.32 * R * p, co.y * (1 - 0.86 * p), co.z + 0.004 * p))
    bm, outer = pot_bm(lod, ctrl, 0.0055, seed, step_scale=0.14, segs={0: 24, 1: 16, 2: 10}[lod], inner_n=(4, 3, 2),
                       wobble=0.02, deform=deform)
    # a charred wick lying in the spout
    if lod < 2:
        uvl = K.ensure_uv(bm)
        path = [Vector((R * 0.25, 0.004, 0.01 + f0)), Vector((R * 0.7, 0.0, h * 0.62)), Vector((R * 1.2, 0.0, h + 0.003)),
                Vector((R * 1.32, 0.0, h + 0.006))]
        PL.tube(bm, uvl, path, 0.0045, 6, 0, ('strip', 0.1, 0.6), tile=0.5)
    tip = Vector((R * 1.3, 0, h))

    def soot(co):
        d = (co - tip).length
        s = K.smoothstep(R * 0.6, 0.0, d) ** 0.7
        if math.hypot(co.y, 0) < 0.006 and co.x > R * 0.2 and co.z > 0.008 + f0 and abs(co.y) < 0.005:
            s = 1.0                                     # the wick
        inside = K.smoothstep(R * 0.9, R * 0.2, math.hypot(co.x, co.y)) * K.smoothstep(h * 0.9, 0.0, co.z) * 0.25
        return min(1.0, s + inside)
    return pottery(name, bm, (0.90, 0.70, 0.55), seed, soot=soot, base_grime=0.05, weather=0.5)


@piece('lamp_a', 'pottery', 'saucer oil lamp with one pinched spout, a burnt wick and soot; 0.15 m',
       snap={'footprint_m': 0.17, 'height_m': 0.05}, view=[-0.5, -1.1, 1.0])
def lamp_a(name, lod):
    return lamp(name, lod, 11, 0.15, 0.034, 1.0)


@piece('lamp_b', 'pottery', 'deeper saucer lamp on a low foot, tighter pinch; 0.13 m', snap={'footprint_m': 0.15, 'height_m': 0.06},
       view=[-0.5, -1.1, 1.0])
def lamp_b(name, lod):
    return lamp(name, lod, 12, 0.135, 0.036, 1.2, foot=True)


# ---------------------------------------------------------------- broken jar, shards

@piece('jar_broken', 'pottery', 'a storage jar lying on its side, the shoulder broken away', snap={'footprint_m': 0.75, 'height_m': 0.45},
       pivot='its rest point on the ground (y = 0); lies along x; front +Z', view=[-0.6, -1.3, 0.75])
def jar_broken(name, lod):
    ctrl = [(r * 0.8, z * 0.8) for r, z in JAR]
    bm, outer = pot_bm(lod, ctrl, 0.014, 21, segs={0: 28, 1: 18, 2: 10}[lod])
    ob = pottery(name, bm, (0.86, 0.62, 0.48), 21,
                 chips=[((0.17, -0.06, 0.53), 0.16, 22, (1.2, 0.9, 0.85)), ((0.1, 0.17, 0.62), 0.07, 23)], weather=1.3)
    # lay it down: axis along x, rolled so the break shows, resting on the ground
    me = ob.data
    M = Euler((0.0, math.radians(-84), math.radians(18)), 'XYZ').to_matrix().to_4x4()
    for v in me.vertices:
        v.co = M @ v.co
    zmin = min(v.co.z for v in me.vertices)
    cx = sum(v.co.x for v in me.vertices) / len(me.vertices)
    cy = sum(v.co.y for v in me.vertices) / len(me.vertices)
    for v in me.vertices:
        v.co.z -= zmin + 0.012
        v.co.x -= cx
        v.co.y -= cy
    me.update()
    return ob


@piece('shards', 'pottery', 'a scatter of potsherds, 0.6 m across', snap={'footprint_m': 0.6, 'height_m': 0.04},
       view=[-0.4, -1.0, 1.1])
def shards(name, lod):
    rng = K.rng(31)
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    n = {0: 9, 1: 9, 2: 6}[lod]
    brk = bm.faces.layers.int.new('brk')
    for k in range(n):
        R = rng.uniform(0.14, 0.3)               # the vessel's curvature
        th = 0.009 + rng.uniform(0, 0.006)
        npt = {0: 8, 1: 6, 2: 5}[lod]
        sz = rng.uniform(0.03, 0.075)
        outline = []
        for i in range(npt):
            a = 2 * math.pi * i / npt + rng.uniform(-0.25, 0.25)
            rr = sz * rng.uniform(0.55, 1.0)
            outline.append((rr * math.cos(a), rr * math.sin(a)))
        up = rng.random() < 0.55
        top, bot = [], []
        for (x, y) in outline:
            zc = (x * x) / (2 * R) * (1 if up else -1)
            top.append(bm.verts.new((x, y, zc + th)))
            bot.append(bm.verts.new((x, y, zc)))
        ft = bm.faces.new(top)
        fb = bm.faces.new(bot[::-1])
        for f in (ft, fb):
            f.material_index = 0
            for l in f.loops:
                l[uvl].uv = (l.vert.co.x / 0.5 + k * 0.13, (l.vert.co.y / 0.5 + 0.3) % 0.87)
        for i in range(npt):
            j = (i + 1) % npt
            f = bm.faces.new([bot[i], bot[j], top[j], top[i]])
            f.material_index = 0
            f[brk] = 1
            for l, uv in zip(f.loops, [(0, 0), (0.03, 0), (0.03, 0.03), (0, 0.03)]):
                l[uvl].uv = (uv[0] + k * 0.1, uv[1] + 0.2)
        # place: rotate, tilt, move
        M = Matrix.Translation((rng.uniform(-0.25, 0.25), rng.uniform(-0.22, 0.22), 0.0)) @ \
            Matrix.Rotation(rng.uniform(0, 6.28), 4, 'Z') @ Matrix.Rotation(rng.uniform(-0.25, 0.25), 4, 'X')
        for v in top + bot:
            v.co = M @ v.co
    # rest each piece on the ground
    zmin = min(v.co.z for v in bm.verts)
    for v in bm.verts:
        v.co.z -= zmin
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = K.new_object(name, bm, ['M_Terracotta'])
    PL.paint_pottery(ob, (0.85, 0.62, 0.48), seed=31, base_grime=0.0, h=0.05)
    return ob


# ---------------------------------------------------------------- tannur

TANNUR = [(0.0, 0.0), (0.33, 0.0), (0.385, 0.03), (0.375, 0.25), (0.33, 0.52), (0.26, 0.76), (0.215, 0.86), (0.205, 0.885)]


@piece('tannur', 'oven', 'clay bread oven (tannur), 0.9 m: open mouth, a side vent at the foot, a mud-plaster skirt, '
       'soot at the mouth and inside', snap={'footprint_m': 1.1, 'height_m': 0.9})
def tannur(name, lod):
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    st = STEP[lod]
    outer = PL.adaptive(TANNUR, st)
    prof = PL.vessel(None, 0.04, 0, {0: 6, 1: 4, 2: 3}[lod], lip=4 if lod == 0 else 2, outer=outer)
    segs = {0: 24, 1: 16, 2: 10}[lod]

    def lumpy(co, th, k):
        r = math.hypot(co.x, co.y)
        if r < 1e-5 or lod == 2:
            return co
        d = 0.006 * K.noise3((co.x * 5, co.y * 5, co.z * 5), 41, octaves=2)
        return Vector((co.x * (1 + d / r), co.y * (1 + d / r), co.z))
    PL.lathe(bm, uvl, prof, segs, 0, tile=0.5, vmap=TERRA, seed=41, wobble=0.015 if lod < 2 else 0, deform=lumpy)
    # the mud-plaster skirt, its top edge ragged
    sk = [(0.0, -0.01), (0.47, -0.01), (0.53, 0.0), (0.5, 0.12), (0.44, 0.3), (0.39, 0.42)]
    sko = PL.adaptive(sk, st * 1.2)
    r_in = lambda z: PL_r(outer, z) - 0.01
    sko = sko + [(r_in(0.4) + 0.01, 0.44), (r_in(0.38), 0.4)]
    nk = len(sko)

    def ragged(co, th, k):
        r = math.hypot(co.x, co.y)
        if r < 1e-5:
            return co
        if k >= nk - 3:
            dz = 0.06 * K.noise3((math.cos(th) * 2, math.sin(th) * 2, 0.4), 43, octaves=2) - 0.03
            co = Vector((co.x, co.y, co.z + dz))
        d = 0.012 * K.noise3((co.x * 4, co.y * 4, co.z * 4), 44, octaves=2)
        return Vector((co.x * (1 + d / r), co.y * (1 + d / r), co.z))
    PL.lathe(bm, uvl, [(r, z, None) for r, z in sko], segs, 1, tile=2.0, vmap=PL.TILE, seed=42, deform=ragged)
    ob = K.new_object(name, bm, ['M_Terracotta', 'M_MudPlaster'])
    if lod < 2:
        PL.cut(ob, (0.0, -0.45, 0.06), 0.11, 45, squash=(1.0, 2.4, 0.75))
    PL.break_uvs(ob, tile=0.5)
    brk = PL.is_break(ob)

    def col(co, n, m, p):
        r = math.hypot(co.x, co.y)
        top = K.smoothstep(0.55, 0.9, co.z)
        inside = 1.0 if (m == 0 and r < PL_r(outer, co.z) - 0.02) else 0.0
        if m == 1:
            k = 0.82 + 0.18 * K.smoothstep(0.0, 0.25, co.z)
            c = (k, k * 0.98, k * 0.96)
        else:
            k = 0.8 + 0.12 * K.noise3((co.x * 3, co.y * 3, co.z * 3), 46, octaves=2)
            c = (k * 0.84, k * 0.62, k * 0.5)       # baked in use: brown-orange
        streak = K.smoothstep(0.2, 0.7, K.noise3((co.x * 14, co.y * 14, co.z * 1.5), 48)) * K.smoothstep(0.35, 0.75, co.z)
        soot = max(inside * 0.9, K.smoothstep(0.52, 0.84, co.z) * 0.97 * (0.8 + 0.2 * K.noise3((co.x * 9, co.y * 9, co.z * 3), 47)),
                   streak * 0.55 * (m == 0))
        if p is not None and brk(p):
            soot = 0.9                                  # the vent: black inside
        vent = K.smoothstep(0.25, 0.0, math.hypot(co.x, co.y + 0.45 - 0.0) - 0.1) * K.smoothstep(0.3, 0.05, co.z) * (co.y < -0.2)
        soot = max(soot, 0.6 * vent)
        return (c[0] * (1 - 0.9 * soot), c[1] * (1 - 0.91 * soot), c[2] * (1 - 0.91 * soot))
    K.paint(ob, col, mode='set')
    return ob


def PL_r(outer, z):
    return r_at(outer, z)


# ---------------------------------------------------------------- potter's wheel

@piece("potters_wheel", 'craft', "a slow wheel (tournette): a basalt pivot stone, a heavy wooden wheel-head with a pot "
       "being thrown, and a water bowl", snap={'footprint_m': 0.9, 'height_m': 0.42}, view=[-0.7, -1.2, 0.8])
def potters_wheel(name, lod):
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    segs = {0: 28, 1: 18, 2: 10}[lod]
    # basalt pivot stone (ClayRaw, darkened)
    stone = [(0.0, 0.0), (0.17, 0.0), (0.19, 0.03), (0.18, 0.09), (0.13, 0.115), (0.06, 0.12), (0.0, 0.12)]
    PL.lathe(bm, uvl, [(r, z, None) for r, z in stone], segs, 0, tile=0.5, vmap=CLAY, seed=51, wobble=0.04 if lod < 2 else 0)
    n_stone = len(bm.faces)
    # wooden wheel-head: a thick disc
    disc = [(0.0, 0.118), (0.26, 0.118), (0.285, 0.13), (0.285, 0.165), (0.27, 0.172), (0.0, 0.172)]
    n0 = len(bm.faces)
    PL.lathe(bm, uvl, [(r, z, None) for r, z in disc], segs + 4, 1, tile=2.0, vmap=('strip', 0.52, 0.73), seed=52)
    bm.faces.ensure_lookup_table()
    for f in list(bm.faces)[n0:]:
        if abs(f.normal.z) > 0.7:
            for l in f.loops:
                co = l.vert.co
                l[uvl].uv = (co.x / 2.0 + 0.3, K.trim_v('plankB', (co.y + 0.29) / 0.58))
    # the pot being thrown: wet clay, open
    pot = [(0.0, 0.172), (0.09, 0.172), (0.105, 0.2), (0.115, 0.26), (0.1, 0.32), (0.085, 0.345), (0.088, 0.355)]
    outer = PL.adaptive(pot, 0.02 if lod == 0 else 0.04)
    prof = PL.vessel(None, 0.012, 0, {0: 5, 1: 3, 2: 2}[lod], lip=3, outer=outer)
    n1 = len(bm.faces)
    PL.lathe(bm, uvl, prof, segs, 0, tile=0.5, vmap=CLAY, seed=53)
    n2 = len(bm.faces)
    # a water bowl on the ground beside it
    bm_b, _ = pot_bm(lod, [(r * 0.9, z * 0.9) for r, z in BOWL], 0.007, 54, step_scale=0.35, segs={0: 22, 1: 14, 2: 8}[lod],
                     inner_n=(5, 3, 2), bm=None, xform=Matrix.Translation((0.48, -0.18, 0.0)))
    me_tmp = bpy.data.meshes.new('_b')
    bm_b.to_mesh(me_tmp)
    bm_b.free()
    for f in bm.faces:
        pass
    nb0 = len(bm.faces)
    bm.from_mesh(me_tmp)
    bpy.data.meshes.remove(me_tmp)
    for f in list(bm.faces)[nb0:]:
        f.material_index = 2
    ob = K.new_object(name, bm, ['M_ClayRaw', 'M_Timber', 'M_Terracotta'])
    nf = len(ob.data.polygons)

    def col(co, n, m, p):
        i = p.index
        if i < n_stone:
            k = 0.42 + 0.06 * K.noise3((co.x * 8, co.y * 8, co.z * 8), 55)
            return (k, k * 0.98, k * 0.97)
        if m == 1:
            k = 0.85 + 0.15 * K.smoothstep(0.12, 0.17, co.z)
            return (k, k * 0.97, k * 0.94)
        if m == 0:
            return (0.78, 0.72, 0.66)                     # wet clay is darker
        r = math.hypot(co.x - 0.48, co.y + 0.18)
        wet = K.smoothstep(0.1, 0.06, r) * K.smoothstep(0.08, 0.02, co.z)
        return (0.86 - 0.3 * wet, 0.64 - 0.22 * wet, 0.5 - 0.17 * wet)
    K.paint(ob, col, mode='set')
    return ob


# ---------------------------------------------------------------- tablets

def tablet_tile(k):
    return (k / 4 + 0.012, (k + 1) / 4 - 0.012, 0.012, 0.238)


@piece('tablet_board', 'craft', 'clay tablets drying on a plank board on two mud-brick piers: 24 blank or lightly marked '
       'tablets (invented ruling and stylus pocks, no script)', snap={'x': 1.6, 'z': 0.42, 'height_m': 0.5},
       pivot='centre of the board on the ground (y = 0); board along x; front +Z', view=[-0.45, -1.2, 0.85])
def tablet_board(name, lod):
    rng = K.rng(61)
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    # piers of mud brick
    for x in (-0.55, 0.55):
        PL.box(bm, uvl, (x - 0.2, -0.18, 0.0), (x + 0.2, 0.18, 0.4), 1, tile=2.0)
    # the board: two planks
    beam_box(bm, uvl, (-0.8, -0.205, 0.4), (0.8, -0.005, 0.445), band='plankA', mat=2, seed=62, bevel=0.006, along='x',
             jitter=0.002 if lod == 0 else 0.0, end_tile=5)
    beam_box(bm, uvl, (-0.79, 0.003, 0.4), (0.81, 0.21, 0.447), band='plankB', mat=2, seed=63, bevel=0.006, along='x',
             jitter=0.002 if lod == 0 else 0.0, end_tile=6)
    n = {0: 3, 1: 2, 2: 1}[lod]
    kinds = [0, 0, 0, 1, 1, 2, 2, 3]
    for row in range(3):
        for i in range(8):
            sx = 0.085 * rng.uniform(0.92, 1.08)
            sy = 0.062 * rng.uniform(0.92, 1.1)
            sz = 0.024 * rng.uniform(0.9, 1.15)
            x = -0.66 + i * 0.19 + rng.uniform(-0.02, 0.02)
            y = -0.13 + row * 0.13 + rng.uniform(-0.015, 0.015)
            k = kinds[int(rng.random() * len(kinds))]
            PL.cushion(bm, uvl, (x, y, 0.447), (sx, sy, sz), n, 0, top_uv=tablet_tile(k), tile=0.5, p=7.0,
                       rot=rng.uniform(-0.12, 0.12) + (math.pi / 2 if rng.random() < 0.15 else 0.0), sag=0.003)
    PL.finish_normals(bm)
    ob = K.new_object(name, bm, ['M_ClayRaw', 'M_MudBrick', 'M_Timber'])
    r2 = K.rng(64)
    shade = {}

    def col(co, nn, m, p):
        if m == 0:
            key = (round(co.x * 6), round(co.y * 6))
            if key not in shade:
                shade[key] = r2.uniform(0.78, 1.0)
            k = shade[key]
            return (k, k * 0.98, k * 0.96)
        if m == 1:
            k = 0.85 + 0.15 * K.smoothstep(0.0, 0.25, co.z)
            return (k, k, k)
        return (0.92, 0.9, 0.88)
    K.paint(ob, col, mode='set')
    return ob


@piece('tablet', 'craft', 'a single clay tablet, 11 x 7.5 cm, ruled faintly (invented, no script)',
       snap={'footprint_m': 0.11, 'height_m': 0.03}, view=[-0.3, -0.9, 1.1], lens=85)
def tablet(name, lod):
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    PL.cushion(bm, uvl, (0, 0, 0), (0.11, 0.075, 0.028), {0: 5, 1: 3, 2: 1}[lod], 0, top_uv=tablet_tile(1), tile=0.5, p=7.0,
               sag=0.004)
    PL.finish_normals(bm)
    ob = K.new_object(name, bm, ['M_ClayRaw'])
    K.paint(ob, lambda co, n, m, p: (0.95, 0.93, 0.9), mode='set')
    return ob


# ---------------------------------------------------------------- sacks

SACK = [(0.0, 0.0), (0.15, 0.003), (0.235, 0.04), (0.268, 0.17), (0.262, 0.4), (0.215, 0.56), (0.13, 0.645), (0.058, 0.69),
        (0.046, 0.705), (0.05, 0.72), (0.085, 0.76), (0.1, 0.795), (0.075, 0.83), (0.0, 0.845)]


def sack_bm(lod, prof, seed, folds=9, squash=0.86, lean=0.0, slump=0.0, tuft=True):
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    st = {0: 0.035, 1: 0.07, 2: 0.14}[lod]
    pts = PL.adaptive(prof, st, bands=[(0.62, 0.86)], band_step=st * 0.5)
    segs = {0: 30, 1: 18, 2: 10}[lod]
    ph = K.rng(seed).uniform(0, 6)

    def deform(co, th, k):
        r = math.hypot(co.x, co.y)
        z = co.z
        if r < 1e-6:
            return Vector((co.x + lean * z * z, co.y, z * (1 - slump)))
        # gathered folds toward the neck and in the tuft
        a = 0.02 + 0.2 * K.smoothstep(0.42, 0.66, z) + (0.2 * K.smoothstep(0.72, 0.8, z) if tuft else 0)
        f = math.sin(th * folds + ph + 2.0 * K.noise3((z * 3, 0.2, ph), seed)) * a
        w = 0.022 * K.noise3((co.x * 5, co.y * 5, z * 5), seed + 1, octaves=2) / max(r, 0.05)
        s = 1 + f * (0.5 if z < 0.6 else 1.0) + w
        x, y = co.x * s, co.y * s * squash
        # bottom spreads under the weight
        if z < 0.12:
            g = 1 + 0.07 * (1 - z / 0.12)
            x, y = x * g, y * g
        zz = z * (1 - slump) - slump * 0.15 * math.hypot(x, y)
        x += lean * zz * zz
        return Vector((x, y, max(0.0, zz)))
    PL.lathe(bm, uvl, [(r, z, None) for r, z in pts], segs, 0, tile=0.27, vmap=PL.TILE, seed=seed, deform=deform)
    return bm


def sack_colour(seed, h):
    def fn(co, n, m, p):
        if m == 1:
            return (0.8, 0.78, 0.74)
        k = 0.84 + 0.12 * K.noise3((co.x * 3, co.y * 3, co.z * 3), seed, octaves=2)
        dirt = 1 - 0.3 * (1 - K.smoothstep(0.0, 0.2 * h, co.z))
        st = K.smoothstep(0.4, 0.8, K.noise3((co.x * 5, co.y * 5, co.z * 2), seed + 3)) * 0.12
        k *= dirt * (1 - st)
        return (k, k * 0.98, k * 0.95)
    return fn


@piece('sack_closed', 'sack', 'a full grain sack, its neck tied with cord', snap={'footprint_m': 0.58, 'height_m': 0.84})
def sack_closed(name, lod):
    bm = sack_bm(lod, SACK, 71)
    uvl = K.ensure_uv(bm)
    if lod < 2:
        PL.tube(bm, uvl, PL.ring_path((0, 0, 0), 0.052, 0.703, 14 if lod == 0 else 8, 0.05, 72), 0.0075, 6 if lod == 0 else 4, 1,
                BASK['cord'], tile=BASK_TILE, closed=True)
        PL.tube(bm, uvl, [Vector((0.05, -0.01, 0.70)), Vector((0.08, -0.03, 0.66)), Vector((0.1, -0.035, 0.6))], 0.006, 5, 1,
                BASK['cord'], tile=BASK_TILE)
    ob = K.new_object(name, bm, ['M_Hessian', 'M_Basketry'])
    K.paint(ob, sack_colour(71, 0.84), mode='set')
    return ob


SACK_OPEN = [(0.0, 0.0), (0.15, 0.003), (0.235, 0.04), (0.268, 0.17), (0.27, 0.42), (0.262, 0.54), (0.275, 0.58),
             (0.29, 0.615), (0.278, 0.648), (0.25, 0.655), (0.232, 0.635), (0.236, 0.6), (0.0, 0.59)]


@piece('sack_open', 'sack', 'an open grain sack, the neck rolled down, barley heaped in it', snap={'footprint_m': 0.6, 'height_m': 0.7})
def sack_open(name, lod):
    bm = sack_bm(lod, SACK_OPEN, 73, folds=11, tuft=False)
    uvl = K.ensure_uv(bm)
    dome = [(0.0, 0.70), (0.08, 0.695), (0.16, 0.672), (0.215, 0.645), (0.245, 0.615), (0.25, 0.59)]
    PL.lathe(bm, uvl, [(r, z, None) for r, z in dome], {0: 26, 1: 16, 2: 8}[lod], 1, tile=0.15, vmap=PL.TILE, seed=74,
             deform=lambda co, th, k: Vector((co.x, co.y * 0.86, co.z + 0.006 * K.noise3((co.x * 12, co.y * 12, 0.3), 75))))
    ob = K.new_object(name, bm, ['M_Hessian', 'M_Grain'])
    base = sack_colour(73, 0.65)

    def col(co, n, m, p):
        if m == 1:
            return (1.0, 0.97, 0.92)
        return base(co, n, 0, p)
    K.paint(ob, col, mode='set')
    return ob


@piece('sack_slumped', 'sack', 'a half-empty sack slumped over, its tied neck fallen sideways',
       snap={'footprint_m': 0.7, 'height_m': 0.5})
def sack_slumped(name, lod):
    bm = sack_bm(lod, SACK, 76, folds=7, squash=0.8, lean=0.9, slump=0.38)
    uvl = K.ensure_uv(bm)
    ob = K.new_object(name, bm, ['M_Hessian'])
    K.paint(ob, sack_colour(76, 0.5), mode='set')
    return ob


# ---------------------------------------------------------------- baskets

@piece('basket_grain', 'basket', 'a wide coiled grain basket, 0.56 m, heaped with barley', snap={'footprint_m': 0.58, 'height_m': 0.36},
       view=[-0.6, -1.2, 0.95])
def basket_grain(name, lod):
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    ctrl = [(0.0, 0.0), (0.17, 0.0), (0.215, 0.02), (0.255, 0.12), (0.276, 0.27), (0.282, 0.315)]
    outer = PL.adaptive(ctrl, {0: 0.03, 1: 0.06, 2: 0.12}[lod])
    prof = PL.vessel(None, 0.022, 0, {0: 5, 1: 3, 2: 2}[lod], lip=5 if lod == 0 else 2, outer=outer)
    # the lip (between outer and inner) takes the fibre binding band
    o_set = {tuple(p) for p in outer}
    prof = [(r, z, (BASK['fibre'] if (r, z) not in o_set and z > 0.29 else None)) for r, z, _ in prof]
    segs = {0: 34, 1: 20, 2: 10}[lod]
    PL.lathe(bm, uvl, prof, segs, 0, tile=BASK_TILE, vmap=BASK['coiled'], seed=81, wobble=0.015 if lod < 2 else 0)
    dome = [(0.0, 0.36), (0.06, 0.357), (0.12, 0.345), (0.18, 0.322), (0.235, 0.298), (0.258, 0.285)]
    PL.lathe(bm, uvl, [(r, z, None) for r, z in dome], {0: 26, 1: 16, 2: 8}[lod], 1, tile=0.15, vmap=PL.TILE, seed=82,
             deform=lambda co, th, k: Vector((co.x, co.y, co.z + 0.012 * K.noise3((co.x * 7, co.y * 7, 0.3), 83, octaves=2)
                                              * K.smoothstep(0.26, 0.1, math.hypot(co.x, co.y)))))
    ob = K.new_object(name, bm, ['M_Basketry', 'M_Grain'])

    def col(co, n, m, p):
        if m == 1:
            return (1, 0.97, 0.93)
        k = 0.88 + 0.12 * K.noise3((co.x * 4, co.y * 4, co.z * 4), 84, octaves=2)
        k *= 1 - 0.2 * (1 - K.smoothstep(0.0, 0.08, co.z))
        return (k, k * 0.97, k * 0.92)
    K.paint(ob, col, mode='set')
    return ob


@piece('basket_tall', 'basket', 'a tall plaited palm-leaf basket with two cord handles, 0.58 m', snap={'footprint_m': 0.38, 'height_m': 0.72})
def basket_tall(name, lod):
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    ctrl = [(0.0, 0.0), (0.12, 0.0), (0.15, 0.02), (0.175, 0.15), (0.18, 0.35), (0.168, 0.52), (0.165, 0.575)]
    outer = PL.adaptive(ctrl, {0: 0.035, 1: 0.07, 2: 0.14}[lod])
    prof = PL.vessel(None, 0.012, 0, {0: 6, 1: 3, 2: 2}[lod], lip=4 if lod == 0 else 2, outer=outer)
    o_set = {tuple(p) for p in outer}
    prof = [(r, z, (BASK['fibre'] if (r, z) not in o_set and z > 0.56 else None)) for r, z, _ in prof]
    segs = {0: 30, 1: 18, 2: 10}[lod]
    PL.lathe(bm, uvl, prof, segs, 0, tile=BASK_TILE, vmap=BASK['plaited'], seed=85, wobble=0.02 if lod < 2 else 0)
    if lod < 2:
        # a cord binding round the rim, and two arched handles
        PL.tube(bm, uvl, PL.ring_path((0, 0, 0), 0.171, 0.565, 28 if lod == 0 else 14, 0.02, 86), 0.009, 6 if lod == 0 else 4, 0,
                BASK['cord'], tile=BASK_TILE, closed=True)
        for s in (1, -1):
            path = []
            n = 10 if lod == 0 else 6
            for k in range(n):
                t = k / (n - 1)
                a = math.radians(-28 + 56 * t)
                path.append(Vector((s * 0.168 * math.cos(a), 0.168 * math.sin(a), 0.54 + 0.13 * math.sin(math.pi * t))))
            PL.tube(bm, uvl, path, 0.01, 6 if lod == 0 else 4, 0, BASK['cord'], tile=BASK_TILE)
    ob = K.new_object(name, bm, ['M_Basketry'])
    K.paint(ob, lambda co, n, m, p: ((0.86 + 0.14 * K.noise3((co.x * 4, co.y * 4, co.z * 4), 87, octaves=2)) * (1 - 0.2 * (1 - K.smoothstep(0.0, 0.08, co.z))),) * 3, mode='set')
    return ob


@piece('tray_winnowing', 'basket', 'a flat coiled winnowing tray, 0.62 m, a little grain on it', snap={'footprint_m': 0.62, 'height_m': 0.06},
       view=[-0.5, -1.1, 1.0])
def tray_winnowing(name, lod):
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    ctrl = [(0.0, 0.0), (0.24, 0.0), (0.285, 0.012), (0.305, 0.035), (0.31, 0.05)]
    outer = PL.adaptive(ctrl, {0: 0.025, 1: 0.05, 2: 0.1}[lod])
    prof = PL.vessel(None, 0.012, 0, {0: 6, 1: 4, 2: 2}[lod], lip=4 if lod == 0 else 2, outer=outer)
    o_set = {tuple(p) for p in outer}
    prof = [(r, z, (BASK['fibre'] if (r, z) not in o_set and z > 0.045 else None)) for r, z, _ in prof]
    PL.lathe(bm, uvl, prof, {0: 36, 1: 20, 2: 10}[lod], 0, tile=BASK_TILE, vmap=BASK['coiled'], seed=88,
             deform=lambda co, th, k: Vector((co.x, co.y, co.z + 0.006 * K.noise3((co.x * 3, co.y * 3, 0.1), 89))))
    if lod < 2:
        heap = [(0.0, 0.032), (0.05, 0.028), (0.1, 0.018), (0.13, 0.012)]
        PL.lathe(bm, uvl, [(r, z, None) for r, z in heap], 16, 1, tile=0.15, vmap=PL.TILE, seed=90,
                 deform=lambda co, th, k: Vector((co.x * 1.2 + 0.03, co.y * 0.9 - 0.02, co.z)))
    ob = K.new_object(name, bm, ['M_Basketry', 'M_Grain'])
    K.paint(ob, lambda co, n, m, p: (1, 1, 1) if m == 1 else ((0.85 + 0.15 * K.noise3((co.x * 4, co.y * 4, 0.3), 91, octaves=2)),) * 3, mode='set')
    return ob


# ---------------------------------------------------------------- reed mats

@piece('mat_flat', 'mat', 'a plaited reed mat, 2 x 1 m, lying flat, its ends frayed', snap={'x': 2.0, 'z': 1.0},
       pivot='centre on the ground (y = 0); long side along x', view=[-0.4, -1.2, 0.9])
def mat_flat(name, lod):
    rng = K.rng(95)
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    nx, ny = {0: (40, 20), 1: (16, 8), 2: (4, 2)}[lod]
    W, D = 2.0, 1.0
    verts = {}
    for i in range(nx + 1):
        for j in range(ny + 1):
            x = -W / 2 + W * i / nx
            y = -D / 2 + D * j / ny
            z = 0.004 + 0.004 * K.noise3((x * 1.5, y * 1.5, 0.2), 96, octaves=2) + 0.018 * K.smoothstep(0.42, 0.5, abs(y)) \
                + 0.01 * K.smoothstep(0.9, 1.0, abs(x)) * (0.5 + 0.5 * K.noise3((y * 4, x, 0.0), 97))
            verts[(i, j)] = bm.verts.new((x, y, z))
    for i in range(nx):
        for j in range(ny):
            f = bm.faces.new([verts[(i, j)], verts[(i + 1, j)], verts[(i + 1, j + 1)], verts[(i, j + 1)]])
            f.smooth = True
            for l in f.loops:
                l[uvl].uv = (l.vert.co.x / 0.5, l.vert.co.y / 0.5)
    if lod < 2:
        # frayed ends: loose strips of reed past the last weft
        for sx in (-1, 1):
            nstr = 32 if lod == 0 else 14
            for k in range(nstr):
                y = -D / 2 + D * (k + 0.5) / nstr + rng.uniform(-0.008, 0.008)
                L = rng.uniform(0.02, 0.09)
                w = 0.012
                droop = rng.uniform(0.0, 0.012)
                x0 = sx * W / 2
                a = bm.verts.new((x0 - sx * 0.01, y - w / 2, 0.012))
                b = bm.verts.new((x0 - sx * 0.01, y + w / 2, 0.012))
                c = bm.verts.new((x0 + sx * L, y + w / 2 + rng.uniform(-0.01, 0.01), 0.008 - droop))
                d = bm.verts.new((x0 + sx * L, y - w / 2 + rng.uniform(-0.01, 0.01), 0.008 - droop))
                f = bm.faces.new([a, b, c, d] if sx > 0 else [b, a, d, c])
                for l in f.loops:
                    l[uvl].uv = (l.vert.co.x / 0.5, l.vert.co.y / 0.5)
    ob = K.new_object(name, bm, ['M_ReedMat'])
    K.paint(ob, lambda co, n, m, p: ((0.85 + 0.15 * K.noise3((co.x * 2, co.y * 2, 0.4), 98, octaves=2)) * (0.9 + 0.1 * K.smoothstep(0.4, 0.5, abs(co.y))),) * 3, mode='set')
    return ob


@piece('mat_rolled', 'mat', 'a reed mat rolled up and tied, 1 m long', snap={'x': 1.0, 'footprint_m': 0.15},
       pivot='centre of the roll on the ground (y = 0); roll axis along x', view=[-0.7, -1.2, 0.6])
def mat_rolled(name, lod):
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    W = 1.0
    r0, turn = 0.025, 0.007
    b = turn / (2 * math.pi)
    dphi = {0: 0.22, 1: 0.45, 2: 0.9}[lod]
    phi_end = 38.0
    nx = {0: 4, 1: 2, 2: 1}[lod]
    rows = []
    phi, s = 0.0, 0.0
    while phi <= phi_end:
        r = r0 + b * phi
        rows.append((phi, r, s))
        s += r * dphi
        phi += dphi
    R = rows[-1][1]
    verts = []
    for (phi, r, s) in rows:
        row = []
        for i in range(nx + 1):
            x = -W / 2 + W * i / nx
            row.append(bm.verts.new((x, r * math.sin(phi), R + r * math.cos(phi) - 0.002)))
        verts.append((row, s))
    for k in range(len(verts) - 1):
        A, sa = verts[k]
        B, sb = verts[k + 1]
        for i in range(nx):
            f = bm.faces.new([A[i], A[i + 1], B[i + 1], B[i]])
            f.smooth = True
            for l, uv in zip(f.loops, [(A[i].co.x / 0.5, sa / 0.5), (A[i + 1].co.x / 0.5, sa / 0.5), (B[i + 1].co.x / 0.5, sb / 0.5), (B[i].co.x / 0.5, sb / 0.5)]):
                l[uvl].uv = uv
    if lod < 2:
        for x in (-0.3, 0.28):
            PL.tube(bm, uvl, PL.ring_path((0, 0, R), R + 0.006, x, 16 if lod == 0 else 8, 0.0, 99, axis='x'), 0.006,
                    5 if lod == 0 else 4, 1, BASK['cord'], tile=BASK_TILE, closed=True)
    ob = K.new_object(name, bm, ['M_ReedMat', 'M_Basketry'])
    K.paint(ob, lambda co, n, m, p: (0.92, 0.9, 0.86), mode='set')
    return ob


# ---------------------------------------------------------------- firewood

@piece('firewood_stack', 'wood', 'split logs and branches stacked against a wall, 1.2 m long', snap={'x': 1.3, 'z': 0.5, 'height_m': 0.7},
       pivot='the wall line at the back of the stack, on the ground (y = 0); stack in front toward +Z; along x',
       view=[-0.6, -1.3, 0.55])
def firewood_stack(name, lod):
    rng = K.rng(101)
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    sides = {0: 8, 1: 6, 2: 4}[lod]
    layers = [(0.0, 7), (1, 6), (2, 5), (3, 4), (4, 3)] if lod < 2 else [(0.0, 5), (1, 4), (2, 2)]
    z = 0.0
    for li, (_, n) in enumerate(layers):
        rmax = 0.0
        y = -0.03
        for k in range(n):
            rad = rng.uniform(0.03, 0.065)
            L = rng.uniform(1.0, 1.25)
            x0 = rng.uniform(-0.08, 0.08) - L / 2
            yy = y - rad
            zc = z + rad
            a = Vector((x0, yy + rng.uniform(-0.01, 0.01), zc + rng.uniform(-0.01, 0.01)))
            b = Vector((x0 + L, yy + rng.uniform(-0.03, 0.03), zc + rng.uniform(-0.015, 0.015)))
            if rng.random() < 0.45:
                PL.half_log(bm, uvl, a, b, rad * 1.2, 0, seed=101 + li * 10 + k, sides=sides - 1, roll=rng.uniform(-2.5, 2.5),
                            end_tile=4 + int(rng.random() * 4))
            else:
                log_cyl(bm, uvl, a, b, rad, seed=101 + li * 10 + k, band='bark', sides=sides, end_tile=int(rng.random() * 4),
                        wobble=0.012, seg_len=0.6 if lod == 0 else 1.3, mat=0)
            y -= rad * 2 * 0.95
            rmax = max(rmax, rad)
        z += rmax * 1.75
    ob = K.new_object(name, bm, ['M_Timber'])
    K.paint(ob, lambda co, n, m, p: ((0.8 + 0.2 * K.smoothstep(0.0, 0.3, co.z)) * (0.9 + 0.1 * K.noise3((co.x * 3, co.y * 3, co.z * 3), 102)),) * 3, mode='set')
    return ob


@piece('firewood_bundle', 'wood', 'a bundle of brushwood tied with two cords, 1 m, lying', snap={'x': 1.05, 'footprint_m': 0.24},
       pivot='centre on the ground (y = 0); along x', view=[-0.6, -1.3, 0.6])
def firewood_bundle(name, lod):
    rng = K.rng(111)
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    n = {0: 18, 1: 11, 2: 5}[lod]
    Rb = 0.1
    part = bm.faces.layers.int.new('part')
    for k in range(n):
        nf0 = len(bm.faces)
        a = rng.uniform(0, 6.28)
        rr = Rb * math.sqrt(rng.random()) * 0.85
        y, z = rr * math.cos(a), Rb + rr * math.sin(a)
        L = rng.uniform(0.85, 1.08)
        x0 = rng.uniform(-0.06, 0.06) - L / 2
        spread = rng.uniform(0.02, 0.06)
        log_cyl(bm, uvl, (x0, y * (1 + spread * 4), z + rng.uniform(-0.02, 0.02)), (x0 + L, y * (1 + spread * 6), z + rng.uniform(-0.03, 0.02)),
                rng.uniform(0.008, 0.02), seed=111 + k, band='pole', sides={0: 5, 1: 4, 2: 4}[lod],
                end_tile=int(rng.random() * 4), wobble=0.01, seg_len=0.5 if lod == 0 else 1.2, mat=0)
        bm.faces.ensure_lookup_table()
        for f in list(bm.faces)[nf0:]:
            f[part] = k + 1
    if lod < 2:
        for x in (-0.25, 0.25):
            PL.tube(bm, uvl, PL.ring_path((0, 0, Rb), Rb * 0.92, x, 16 if lod == 0 else 8, 0.08, 112, axis='x'), 0.0065,
                    5 if lod == 0 else 4, 1, BASK['cord'], tile=BASK_TILE, closed=True)
    zmin = min(v.co.z for v in bm.verts)
    for v in bm.verts:
        v.co.z -= zmin
    ob = K.new_object(name, bm, ['M_Timber', 'M_Basketry'])
    rs = K.rng(113)
    shades = [(rs.uniform(0.6, 0.95), rs.uniform(0.9, 1.0)) for _ in range(64)]
    pa = ob.data.attributes['part']

    def col(co, n, m, p):
        if m == 1:
            return (0.92, 0.9, 0.87)
        k, w = shades[pa.data[p.index].value % 64]
        return (k, k * w, k * w * 0.95)
    K.paint(ob, col, mode='set')
    ob.data.attributes.remove(pa)
    return ob


# ---------------------------------------------------------------- build

def build():
    t0 = time.time()
    K.reset()
    metas, objs = [], []
    for p in PIECES:
        if ONLY and p['name'] not in ONLY:
            continue
        t = time.time()
        obs = [p['fn'](p['name'] if lod == 0 else f"{p['name']}_LOD{lod}", lod) for lod in (0, 1, 2)]
        for o in obs:
            K.ensure_col(o)
            if 'brk' in o.data.attributes:
                o.data.attributes.remove(o.data.attributes['brk'])
        K.bake_ao(obs, samples=128, distance=0.3, ground=p['bake_ground'], strength=p['ao'])
        extra = dict(p['extra'])
        if p['view']:
            extra['view'] = p['view']
        if p['lens']:
            extra['lens'] = p['lens']
        snap = extra.pop('snap', {})
        metas.append(K.piece_meta(p['name'], obs, p['kind'], snap, p['pivot'], p['notes'], extra))
        objs += obs
        print(f"{p['name']}: {[m['tris'] for m in metas[-1]['lods']]} tris, {time.time() - t:.1f}s", flush=True)
    path = os.path.join(K.EXPORT, f'{PACK}.glb')
    K.export_glb(objs, path)
    K.write_stats(PACK, metas, f'{PACK}.glb')
    print(f'exported {path} in {time.time() - t0:.0f}s')


def hero():
    """Close shots of the props in use, against architecture pieces from build/kit/export/arch.glb (run build_arch.py
    first): build/kit/renders/props_hero_*.png."""
    K.reset()
    for f in (f'{PACK}.glb', 'arch.glb'):
        bpy.ops.import_scene.gltf(filepath=os.path.join(K.EXPORT, f))
    for m in list(bpy.data.materials):
        m.name = m.name.split('.')[0] + '_imported'
    objs = {o.name: o for o in bpy.context.scene.objects if o.type == 'MESH'}
    for o in objs.values():
        me = o.data
        if 'Col' not in me.color_attributes and len(me.color_attributes):
            me.color_attributes[0].name = 'Col'
        for sl in o.material_slots:
            if sl.material:
                sl.material = K.material(sl.material.name.split('.')[0].replace('_imported', ''))
        o.hide_render = True
    K.ground_plane(size=60)

    def put(name, x, y, rz=0.0, z=0.0, copy=False):
        o = objs[name]
        if copy:
            o = o.copy()
            bpy.context.scene.collection.objects.link(o)
        o.hide_render = False
        o.location = (x, y, z)
        o.rotation_euler = (0, 0, rz)
        return o
    # a lane wall: two plain runs and a doorway
    put('wall_4m_a', 0.0, 0.0)
    put('door_2m', 4.0, 0.0)
    put('wall_2m_b', 6.0, 0.0)
    put('door_leaf_s', 4.47, 0.34, rz=-0.6)
    put('corner_out', -0.5, 0.0)
    # stores along the wall
    put('pithos', 0.75, -0.62, 0.4)
    put('pithos_chipped', 1.72, -0.6, 2.1)
    put('jar_storage', 2.5, -0.42, 1.0)
    put('sack_closed', 3.12, -0.42, 0.3)
    put('sack_open', 3.62, -0.62, 2.0)
    put('sack_slumped', 6.7, -0.55, 3.6)
    put('basket_grain', 2.85, -1.25, 0.0)
    put('jug_small', 1.28, -1.1, 0.8)
    put('bowl_stack', 1.62, -1.32, 0.0)
    put('jar_broken', 0.35, -1.55, 0.9)
    put('shards', 0.9, -1.9, 0.3)
    put('firewood_stack', 7.15, -0.05, 0.0)
    put('basket_tall', 5.45, -0.35, 0.5)
    put('mat_rolled', 6.2, -1.1, 0.35)
    put('tannur', -1.6, -1.6, 0.6)
    put('potters_wheel', -1.5, -3.4, 0.2)
    put('firewood_bundle', -0.4, -2.6, 1.2)
    put('tray_winnowing', 2.0, -2.15, 0.0)
    put('mat_flat', 4.3, -2.6, 0.08)
    put('tablet_board', 5.9, -2.4, 0.15)
    put('lamp_a', 5.5, -2.36, 0.4, z=0.47)
    put('lamp_b', 6.42, -2.48, 2.8, z=0.47)
    put('tablet', 4.15, -2.55, 0.3, z=0.006)
    K.render_setup(res=(1920, 1080), samples=160, sun_elev=30, sun_azim=-58, sun_strength=4.2, hdri_strength=0.85)
    out = os.path.join(K.RENDERS, 'props_hero_')
    shots = {
        'stores': ((2.3, -3.6, 1.6), (2.0, -0.6, 0.55), 30),
        'close': ((1.9, -2.45, 1.25), (1.6, -0.8, 0.45), 32),
        'kitchen': ((0.9, -5.3, 1.65), (-1.2, -2.4, 0.4), 30),
        'tablets': ((6.4, -3.75, 1.35), (5.95, -2.35, 0.47), 40),
    }
    only = set(A['shots'].split(',')) if 'shots' in A else None
    for k, (loc, tgt, lens) in shots.items():
        if only and k not in only:
            continue
        cam = K.camera(loc, tgt, lens=lens)
        K.render(out + k + '.png')
        bpy.data.objects.remove(cam, do_unlink=True)


if 'hero' in A:
    hero()
else:
    build()
