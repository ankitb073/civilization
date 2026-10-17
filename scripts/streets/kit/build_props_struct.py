"""Build the structure props pack (props_struct): well head and water sweep (shaduf), market stalls with draped cloth
awnings, a donkey cart with tripartite disc wheels, a warp-weighted loom, cloths drying on a line, single hanging
cloths and the weigher's scale. Exports build/kit/export/props_struct.glb + build/kit/stats/props_struct.json.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/streets/kit/build_props_struct.py \
      -- [--only=stall_large,cart] [--preview=stall_large] [--hero]

--preview=<piece> renders the build scene (LOD0) to build/kit/renders/props_struct/preview_<piece>.png and skips export.
--hero renders the hero shots from the exported GLBs (arch.glb walls as a backdrop).
Blender frame: Z up, fronts face -Y (glTF +Z), pivots baked into the meshes (see each piece's pivot text).
"""
import os
import sys
import math
import time
import bmesh
import bpy
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import kitlib as K  # noqa: E402
import structlib as S  # noqa: E402

A = K.args()
PACK = 'props_struct'
ONLY = set(A['only'].split(',')) if 'only' in A else None

# dyes as linear multipliers of the undyed linen texture (texture mean ~ sRGB 0.86, 0.81, 0.70)
_lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
_UNDYED = (0.86, 0.81, 0.70)


def dye(srgb):
    return tuple(_lin(a) / _lin(b) for a, b in zip(srgb, _UNDYED))


DYES = {
    'madder': (0.54, 0.17, 0.11), 'indigo': (0.18, 0.25, 0.42), 'saffron': (0.80, 0.57, 0.20),
    'undyed': (0.84, 0.79, 0.68), 'ochre': (0.70, 0.50, 0.26), 'brown': (0.42, 0.30, 0.20),
}
# whole-cloth designs in M_TextilePattern (struct_textpat quadrants, u0 v0 u1 v1)
QUAD = {'zigzag': (0.0, 0.5, 0.5, 1.0), 'stripes': (0.5, 0.5, 1.0, 1.0), 'lozenge': (0.0, 0.0, 0.5, 0.5),
        'stepped': (0.5, 0.0, 1.0, 0.5)}

PIECES = []
CLOTH_CACHE = {}


def piece(name, kind, snap, pivot, notes='', view=None, lens=50, bake_ground=True, no_ground=False, **extra):
    def deco(fn):
        PIECES.append(dict(name=name, kind=kind, snap=snap, pivot=pivot, notes=notes, fn=fn, view=view, lens=lens,
                           bake_ground=bake_ground, no_ground=no_ground, extra=extra))
        return fn
    return deco


def new_bm():
    bm = bmesh.new()
    return bm, K.ensure_uv(bm)


# ================================================================ market stall (four posts)

def awning_sim(key, w, d, nx, ny, frame_pts, colliders_spec, pin_fn, frames=90, dye_name='madder', quad=None, seed=0,
               stiff=40.0, bend=3.0, lift=0.03):
    """Simulate an awning once (LOD0 resolution) and cache it: a sheet w x d placed on a sloping plane, pinned where
    pin_fn(x, y) is true, falling onto collider tubes."""
    if key in CLOTH_CACHE:
        return CLOTH_CACHE[key]
    mat = 'M_TextilePattern' if quad else 'M_Textile'
    ob = S.cloth_sheet(f'_cloth_{key}', w, d, nx, ny, mat, uv_rect=QUAD[quad] if quad else (0, 0, 1, 1),
                       tile=None if quad else 0.27)
    (p_front, p_back) = frame_pts                       # points (centre of the front and back edges, on the frame)
    # orient the sheet: local y -> from front to back along the slope
    fwd = (Vector(p_back) - Vector(p_front)).normalized()
    xax = Vector((1, 0, 0))
    zax = xax.cross(fwd).normalized()
    M = Matrix((xax, fwd, zax)).transposed().to_4x4()
    centre = (Vector(p_front) + Vector(p_back)) / 2 + zax * lift
    M.translation = centre
    ob.data.transform(M)
    pins = [v.index for v in ob.data.vertices if pin_fn(v.co)]
    cols = [S.collider_tube(f'_col_{key}_{i}', pts, r) for i, (pts, r) in enumerate(colliders_spec)]
    S.simulate_cloth(ob, cols, frames=frames, pin=pins, stiff=stiff, bend=bend, mass=0.4, quality=14, air=2.0)
    for c in cols:
        S.remove(c)
    if not quad:
        S.paint_dye(ob, dye(DYES[dye_name]))
    CLOTH_CACHE[key] = ob
    ob.hide_render = True
    return ob


def awning(name, q, xs, rails, y_back, y_front, z_back, z_front, w, back_over, valance, side_over, sag, seed,
           dye_name='madder', quad=None, wall_back=False):
    """A cloth awning resting on rails between a back support (y_back, z_back) and a front bar (y_front, z_front),
    sloping down to the front, as a parametric drape. u across (x), v along the cloth from its back edge."""
    span = math.hypot(y_back - y_front, z_back - z_front)
    fwd = Vector((0, y_front - y_back, z_front - z_back)).normalized()      # down the slope, toward the front
    down = Vector((0, 0, -1))
    r_wrap = 0.05
    v_total = back_over + span + valance
    rails = sorted(rails)

    def top_sag(u, t):
        # t: 0 at the back support .. 1 at the front bar
        sv = math.sin(math.pi * min(1, max(0, t))) ** 0.8
        su = 0.0
        for a_, b_ in zip(rails[:-1], rails[1:]):
            if a_ <= u <= b_:
                su = math.sin(math.pi * (u - a_) / (b_ - a_)) ** 1.1
        wr = 0.006 * K.noise3((u * 2.2, t * 3.0, seed), seed, octaves=2)
        return sag * su * (0.35 + 0.65 * sv) + wr

    def place(u, v):
        # back overhang: hangs/wraps behind the back support (or tucked against a wall)
        x = u
        side = max(0.0, abs(u) - xs)
        if v < back_over:
            e = back_over - v
            if wall_back:
                p = Vector((x, y_back + 0.01, z_back - e))
            else:
                a = min(e / r_wrap, math.pi / 2)
                p = Vector((x, y_back, z_back)) - fwd * (r_wrap * math.sin(a)) + down * (r_wrap * (1 - math.cos(a)) + max(0.0, e - r_wrap * math.pi / 2))
        elif v < back_over + span:
            t = (v - back_over) / span
            uu = min(abs(u), xs) * (1 if u >= 0 else -1)
            p = Vector((x, y_back, z_back)) + fwd * (t * span) + down * (top_sag(uu, t) + wrinkles(u, t * span))
        else:
            e = v - back_over - span
            a = min(e / r_wrap, math.pi / 2 - math.asin(max(-1, min(1, -fwd.z))))
            arc = r_wrap * a
            p = Vector((x, y_front, z_front)) + fwd * (r_wrap * math.sin(a)) * 0.6 + down * (r_wrap * (1 - math.cos(a)))
            hang = max(0.0, e - arc)
            p = p + down * hang
            p.y += S.fold_wave(u, hang, seed + 3, lam=0.32, amp=0.04, ramp=0.3) * -1.0 - 0.01 * hang
        # past the side rails the cloth droops a little
        if side > 0:
            p.z -= side * (0.25 + 0.6 * side / max(side_over, 1e-3))
            p.x = (xs + side * 0.9) * (1 if u > 0 else -1)
        return p

    ties = [(-xs, span), (xs, span), (-xs, 0.0), (xs, 0.0)]

    def wrinkles(u, d):
        # ridges running toward the tie points (front and back corners), fading inward
        out = 0.0
        for (tu, td) in ties:
            du, dd = u - tu, d - td
            dist = math.hypot(du, dd)
            if dist < 1e-3 or dist > 1.2:
                continue
            perp = (du * (td - span / 2) - dd * tu) / (math.hypot(tu, td - span / 2) + 1e-6)
            out += 0.008 * math.sin(2 * math.pi * perp / 0.16) * math.exp(-dist / 0.45) * K.smoothstep(0.04, 0.25, dist)
        return out

    def uvf(u, v):
        if quad:
            u0, v0, u1, v1 = QUAD[quad]
            return (u0 + (u1 - u0) * (u + w / 2) / w, v0 + (v1 - v0) * v / v_total)
        return ((u + w / 2) / 0.27, v / 0.27)
    nu, nv = ((44, 34), (24, 18), (12, 8))[q]
    mat = 'M_TextilePattern' if quad else 'M_Textile'
    ob = S.drape_sheet(name, mat, nu, nv, (-w / 2, w / 2), (0.0, v_total), place, uvf,
                       None if quad else dye(DYES[dye_name]), flip=True)
    return ob


def stall_large(name, lod):
    """3.0 x 2.0 m market stall: four poles, rails lashed at the tops, a middle rafter, a draped awning sloping to the
    front with a hanging valance, a plank counter on two trestles."""
    q = lod
    bm, uvl = new_bm()
    TIM, TEX, MISC = 0, 1, 2
    sides = (8, 6, 5)[q]
    xs, yf, yb = 1.45, -0.95, 0.95
    zf, zb = 2.2, 2.55
    posts = [(-xs, yf, zf), (xs, yf, zf), (-xs, yb, zb), (xs, yb, zb)]
    for i, (x, y, z) in enumerate(posts):
        lean = 0.02 * (1 if i % 2 else -1)
        S.pole(bm, uvl, (x - lean, y, -0.05), (x, y, z + 0.06), 0.052, TIM, seed=10 + i, band='pole', sides=sides,
               end_tile=1 + i % 3, taper=0.12, seg_len=0.6 if q == 0 else 1.2)
    rail_r = 0.04
    # front and back crossbars on the post tops, side rails over them, a middle rafter
    S.pole(bm, uvl, (-xs - 0.18, yf, zf + 0.05), (xs + 0.2, yf, zf + 0.05), rail_r, TIM, seed=20, sides=sides, end_tile=2)
    S.pole(bm, uvl, (-xs - 0.15, yb, zb + 0.05), (xs + 0.18, yb, zb + 0.05), rail_r, TIM, seed=21, sides=sides, end_tile=3)
    for i, x in enumerate((-xs, xs)):
        S.pole(bm, uvl, (x, yf - 0.12, zf + 0.05 + 2 * rail_r - 0.03), (x, yb + 0.1, zb + 0.05 + 2 * rail_r - 0.03), 0.035, TIM,
               seed=22 + i, sides=sides, end_tile=1)
    S.pole(bm, uvl, (0.02, yf - 0.05, zf + 0.05 + 2 * rail_r - 0.03), (-0.02, yb + 0.05, zb + 0.05 + 2 * rail_r - 0.03), 0.03, TIM,
           seed=24, sides=sides, end_tile=2)
    if q < 2:
        for i, (x, y, z) in enumerate(posts):
            S.lashing(bm, uvl, (x, y, z + 0.05), (0, 1, 0), rail_r + 0.01, MISC, turns=4 if q == 0 else 2, cord=0.007,
                      seed=30 + i, seg=10 if q == 0 else 6, sides=4)
        for i, sg in enumerate((-1, 1)):
            # the awning's front corners tied down: loose rope ends hanging from the knots
            top = Vector((sg * (xs + 0.03), yf - 0.05, zf + 0.0))
            S.tube(bm, uvl, [top, top + Vector((0.01 * sg, -0.01, -0.18)), top + Vector((0.03 * sg, 0.0, -0.36))], 0.006, MISC, sides=4,
                   u_scale=0.08)
    # counter: three planks on two trestles
    zc = 0.82
    for k in range(3):
        y0 = -0.78 + k * 0.225
        S.plank(bm, uvl, (-1.22, y0, zc - 0.04), (1.22, y0 + 0.215, zc), TIM, seed=40 + k, along='x',
                band='plankA' if k != 1 else 'plankB', jitter=0.002 if q == 0 else 0.0)
    for i, x in enumerate((-0.95, 0.95)):
        # an A-frame trestle: two splayed legs each side and a top bar
        S.plank(bm, uvl, (x - 0.05, -0.82, zc - 0.11), (x + 0.05, -0.08, zc - 0.04), TIM, seed=50 + i, along='y', band='plankB')
        for j, y in enumerate((-0.74, -0.16)):
            S.pole(bm, uvl, (x - 0.22, y, 0.0), (x - 0.02, y, zc - 0.08), 0.03, TIM, seed=55 + i * 4 + j, sides=max(5, sides - 2),
                   end_tile=1, taper=0.05)
            S.pole(bm, uvl, (x + 0.22, y, 0.0), (x + 0.02, y, zc - 0.08), 0.03, TIM, seed=57 + i * 4 + j, sides=max(5, sides - 2),
                   end_tile=1, taper=0.05)
    frame_ob = S.obj_from_bm(name, bm, ['M_Timber', 'M_Textile', 'M_StructMisc'])
    # the awning: lies on the rails (x = -1.45, 0, 1.45) between the back and front bars, sags between them, wraps
    # over the front bar into a hanging valance with soft folds, droops a little past the side rails
    rt_f = zf + 0.05 + 2 * rail_r - 0.03 + 0.035 + 0.035
    rt_b = zb + 0.05 + 2 * rail_r - 0.03 + 0.035 + 0.035
    awn = awning(f'_awn_{name}', q, xs=xs, rails=(-xs, 0.0, xs), y_back=yb + 0.08, y_front=yf - 0.14, z_back=rt_b, z_front=rt_f,
                 w=3.2, back_over=0.14, valance=0.38, side_over=0.15, sag=0.11, seed=5, dye_name='madder')
    c = awn
    ob = S.join([frame_ob, c], name)
    # the awning was simulated at LOD0 density; lower levels decimate everything
    return ob


def lod_ratio(lod, r1=0.5, r2=0.18):
    return {0: 1.0, 1: r1, 2: r2}[lod]


piece('stall_large', 'prop', {'x': 3.4, 'y': 2.7, 'z': 2.6}, 'base centre on the ground; the counter and the low front '
      'edge of the awning face +Z', 'market stall 3 x 2 m: four lashed poles, a middle rafter, a draped linen awning '
      'with a hanging valance, a plank counter on trestles. Awning dyed madder in COLOR_0 (dye in extras); tint its '
      'M_Textile primitive per instance with instanceColor = target / dye.', view=[-0.9, -1.4, 0.75], lens=45,
      dye=DYES['madder'])(lambda name, lod: S.decimate(stall_large(name, lod), lod_ratio(lod, 0.55, 0.2)))


# ================================================================ lean-to stall

def stall_lean(name, lod):
    """A lean-to stall against a wall: a ridge pole on pegs in the wall, two front posts and a bar, rafters, a sloping
    awning tucked at the wall with a front valance, a plank table, a reed mat for the seller."""
    q = lod
    bm, uvl = new_bm()
    TIM, MISC, REED = 0, 2, 3
    sides = (8, 6, 5)[q]
    xs, yf = 1.15, -1.45
    zr, zf = 2.42, 2.05
    # pegs driven into the wall carry the ridge pole
    for i, x in enumerate((-1.0, 1.0)):
        S.pole(bm, uvl, (x, 0.12, zr - 0.07), (x, -0.13, zr - 0.07), 0.025, TIM, seed=60 + i, sides=max(5, sides - 2),
               end_tile=2, taper=0.0, wobble=0.0)
    S.pole(bm, uvl, (-1.32, -0.06, zr), (1.34, -0.06, zr), 0.045, TIM, seed=62, sides=sides, end_tile=1)
    for i, x in enumerate((-xs, xs)):
        S.pole(bm, uvl, (x + 0.02 * (1 if i else -1), yf, -0.05), (x, yf, zf), 0.05, TIM, seed=63 + i, sides=sides, end_tile=3,
               taper=0.12, seg_len=0.6 if q == 0 else 1.2)
    S.pole(bm, uvl, (-xs - 0.16, yf, zf + 0.04), (xs + 0.18, yf, zf + 0.04), 0.038, TIM, seed=65, sides=sides, end_tile=2)
    rafters = (-xs, 0.0, xs)
    for i, x in enumerate(rafters):
        S.pole(bm, uvl, (x, -0.02, zr + 0.065), (x * 0.99, yf - 0.1, zf + 0.04 + 0.068), 0.03, TIM, seed=66 + i,
               sides=max(5, sides - 1), end_tile=1, taper=0.1)
    if q < 2:
        for i, x in enumerate((-xs, xs)):
            S.lashing(bm, uvl, (x, yf, zf + 0.04), (0, 1, 0), 0.05, MISC, turns=4 if q == 0 else 2, cord=0.007, seed=70 + i,
                      seg=10 if q == 0 else 6, sides=4)
        for i, x in enumerate((-1.0, 1.0)):
            S.lashing(bm, uvl, (x, -0.06, zr - 0.02), (1, 0, 0), 0.05, MISC, turns=3 if q == 0 else 2, cord=0.007, seed=72 + i,
                      seg=10 if q == 0 else 6, sides=4)
    # a plank table
    zc = 0.74
    for k in range(2):
        y0 = -1.22 + k * 0.24
        S.plank(bm, uvl, (-0.85, y0, zc - 0.04), (0.85, y0 + 0.23, zc), TIM, seed=75 + k, along='x', band='plankB' if k else 'plankA',
                jitter=0.002 if q == 0 else 0.0)
    for i, x in enumerate((-0.7, 0.7)):
        S.plank(bm, uvl, (x - 0.04, -1.25, zc - 0.1), (x + 0.04, -0.72, zc - 0.04), TIM, seed=78 + i, along='y', band='plankB')
        for j, y in enumerate((-1.18, -0.8)):
            S.pole(bm, uvl, (x - 0.16, y, 0.0), (x, y, zc - 0.08), 0.028, TIM, seed=80 + i * 2 + j, sides=max(5, sides - 2),
                   end_tile=1, taper=0.05)
            S.pole(bm, uvl, (x + 0.16, y, 0.0), (x, y, zc - 0.08), 0.028, TIM, seed=84 + i * 2 + j, sides=max(5, sides - 2),
                   end_tile=1, taper=0.05)
    # a reed mat on the ground behind the table, its far end curling against the wall
    mw, md = 1.3, 0.75
    nmx, nmy = ((12, 8), (6, 4), (2, 2))[q]
    mv = [[None] * (nmy + 1) for _ in range(nmx + 1)]
    for i in range(nmx + 1):
        for j in range(nmy + 1):
            x = -mw / 2 + mw * i / nmx + 0.15
            y = -0.62 + md * j / nmy
            z = 0.008 + 0.004 * K.noise3((x * 3, y * 3, 1.0), 9) + (0.06 * ((j / nmy - 0.85) / 0.15) ** 2 if j / nmy > 0.85 else 0.0)
            mv[i][j] = bm.verts.new((x, y, z))
    for i in range(nmx):
        for j in range(nmy):
            f = bm.faces.new([mv[i][j], mv[i + 1][j], mv[i + 1][j + 1], mv[i][j + 1]])
            f.material_index = REED
            f.smooth = True
            for l in f.loops:
                l[uvl].uv = (l.vert.co.x / 0.5, l.vert.co.y / 0.5)
    frame_ob = S.obj_from_bm(name, bm, ['M_Timber', 'M_Textile', 'M_StructMisc', 'M_ReedMat'])
    rt_b = zr + 0.065 + 0.03 + 0.03
    rt_f = zf + 0.04 + 0.068 + 0.03 + 0.03
    awn = awning(f'_awn_{name}', q, xs=xs, rails=rafters, y_back=-0.03, y_front=yf - 0.12, z_back=rt_b, z_front=rt_f,
                 w=2.55, back_over=0.1, valance=0.32, side_over=0.1, sag=0.09, seed=8, dye_name='indigo', wall_back=True)
    return S.join([frame_ob, awn], name)


piece('stall_lean', 'prop', {'x': 2.7, 'y': 1.6, 'z': 2.5}, 'centre of its back edge on the ground, on the face of the '
      'wall it leans on (the wall is behind it, toward -Z); the stall stands in front, toward +Z',
      'lean-to stall: a ridge pole on pegs driven into the wall, two front posts, rafters, an indigo awning tucked at '
      'the wall with a front valance, a plank table, a reed mat. Tint the M_Textile primitive with '
      'instanceColor = target / dye.', view=[-1.0, -1.3, 0.7], lens=45, dye=DYES['indigo'])(
    lambda name, lod: S.decimate(stall_lean(name, lod), lod_ratio(lod, 0.55, 0.22)))


# ================================================================ well head and water sweep

WELL_POST_X = 2.3
FULCRUM = Vector((WELL_POST_X, 0.0, 2.31))
SWEEP_ANGLE = math.radians(35)
SWEEP_LONG, SWEEP_SHORT = 2.8, 1.3


def well_head(name, lod):
    from surface import Builder, layered, axis
    q = lod
    step = (0.05, 0.13, 0.4)[q]
    Ro, Rb, Ri, H, rr = 0.78, 0.83, 0.52, 0.78, 0.07
    # the curb's profile (r, z) as a polyline with arc-length parameter, outward normals
    prof = []
    nA = 6
    for k in range(nA + 1):                         # outer face, a slight batter
        z = (H - rr) * k / nA
        prof.append((Rb + (Ro - Rb) * z / (H - rr), z))
    for k in range(1, 7):                           # outer arris
        a = math.pi / 2 * k / 6
        prof.append((Ro - rr + rr * math.cos(a), H - rr + rr * math.sin(a)))
    prof.append((Ri + rr, H))
    for k in range(1, 7):                           # inner arris
        a = math.pi / 2 + math.pi / 2 * k / 6
        prof.append((Ri + rr + rr * math.cos(a), H - rr + rr * math.sin(a)))
    for k in range(1, 7):                           # inner face down to the ground
        prof.append((Ri, (H - rr) * (1 - k / 6) + 0.02 * k / 6))
    Lp = [0.0]
    for i in range(1, len(prof)):
        Lp.append(Lp[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
    Ltot = Lp[-1]

    def prof_at(t):
        t = min(max(t, 0.0), Ltot)
        for i in range(1, len(prof)):
            if t <= Lp[i] + 1e-9:
                f = (t - Lp[i - 1]) / max(1e-9, Lp[i] - Lp[i - 1])
                r = prof[i - 1][0] + (prof[i][0] - prof[i - 1][0]) * f
                z = prof[i - 1][1] + (prof[i][1] - prof[i - 1][1]) * f
                dr, dz = prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]
                L = math.hypot(dr, dz) or 1
                # outward normal: rotate the tangent (dr, dz) by -90 degrees
                return r, z, dz / L, -dr / L
        return prof[-1][0], prof[-1][1], -1.0, 0.0
    C = 2 * math.pi * Ro
    grooves = [math.radians(a) for a in (-8.0, 12.0, 178.0)]  # worn where the sweep's rope runs (toward +x) and opposite

    def P(s, t, d):
        th = s / Ro
        r, z, nr, nz = prof_at(t)
        # rope grooves worn into the inner arris and the rim top
        g = 0.0
        if Lp[nA] - 0.02 < t < Lp[nA + 13] + 0.04:
            for gt in grooves:
                da = math.atan2(math.sin(th - gt), math.cos(th - gt)) * Ro
                g += 0.022 * math.exp(-(da / 0.022) ** 2)
        rr_ = r - nr * (d + g)
        zz = z - nz * (d + g)
        return Vector((rr_ * math.cos(th), rr_ * math.sin(th), zz))
    t_top0, t_in0 = Lp[nA], Lp[nA + 13]

    def F(s, t):
        p = P(s, t, 0)
        x, y, z = p
        n1 = K.noise3((x * 3.0, y * 3.0, z * 3.0), 101, octaves=2)
        n2 = K.noise3((x * 9.0, y * 9.0, z * 9.0), 102)
        if t <= t_top0:
            base = 0.24 + 0.1 * n1 + 0.03 * n2
            f = base - z
            # a worn patch on the outer face
            f = max(f, 0.09 - math.hypot(x - 0.55, (z - 0.5) * 1.3, y + 0.55) + 0.04 * n2)
            return f
        if t < t_in0:
            # the rim: plaster gone in places, worst where jars are set down and ropes run
            return -0.02 + 0.045 * n1 + 0.02 * n2
        # inside: the brick lining shows below the rim
        return (H - 0.28 - z) + 0.08 * n1 + 0.03 * n2
    B = Builder()
    s_ax = axis(0.0, C, step, [g * Ro % C for g in grooves] + [(g * Ro + o) % C for g in grooves for o in (-0.03, -0.015, 0.015, 0.03)])
    t_ax = axis(0.0, Ltot, step * 0.8, [Lp[nA], Lp[nA + 6], Lp[nA + 7], Lp[nA + 13]])
    layered(B, 'curb', P, s_ax, t_ax, F, p=0.02, rec=0.015,
            relief=(lambda s, t: 0.002 * (0.5 + 0.5 * K.noise3(tuple(P(s, t, 0) * 3.0), 103))) if q < 2 else None)
    bm = B.bm
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    uvl = B.uv
    # the dark water far below: a disc just above the ground inside the shaft
    segs = (24, 16, 10)[q]
    ring = [bm.verts.new((Ri * 1.02 * math.cos(2 * math.pi * k / segs), Ri * 1.02 * math.sin(2 * math.pi * k / segs), 0.025)) for k in range(segs)]
    f = bm.faces.new(ring)
    f.material_index = 0
    for l in f.loops:
        l[uvl].uv = (l.vert.co.x / 2, l.vert.co.y / 2)
    TIM, MISC = 2, 3
    sides = (8, 6, 5)[q]
    X = WELL_POST_X
    # the forked post, its fork and the pin the sweep rests on
    S.pole(bm, uvl, (X, 0.0, -0.1), (X + 0.02, 0.0, 1.78), 0.105, TIM, seed=110, band='bark', sides=sides + 2, end_tile=0, taper=0.12,
           seg_len=0.5 if q == 0 else 1.0)
    for i, sg in enumerate((-1, 1)):
        S.pole(bm, uvl, (X + 0.015, sg * 0.03, 1.62), (X + 0.03, sg * 0.15, 2.36), 0.062, TIM, seed=111 + i, band='bark',
               sides=sides, end_tile=0, taper=0.15, seg_len=0.4 if q == 0 else 1.0)
    S.pole(bm, uvl, (X + 0.03, -0.26, 2.22), (X + 0.03, 0.27, 2.22), 0.028, TIM, seed=113, band='pole', sides=max(5, sides - 2),
           end_tile=2, taper=0.0, wobble=0.0)
    if q < 2:
        for i, sg in enumerate((-1, 1)):
            S.lashing(bm, uvl, (X + 0.03, sg * 0.14, 2.22), (0, 1, 0), 0.03, MISC, turns=3, cord=0.006, seed=114 + i, seg=8, sides=4)
            S.lashing(bm, uvl, (X + 0.022, sg * 0.105, 2.0), (0.02, sg * 0.16, 1.0), 0.066, MISC, turns=4, cord=0.007, seed=116 + i,
                      seg=10, sides=4)
    # a mud collar round the post's foot
    nfa = len(bm.faces)
    S.lathe(bm, uvl, [(0.30, -0.02), (0.29, 0.05), (0.22, 0.12), (0.14, 0.17), (0.105, 0.18)], (16, 10, 6)[q], 0,
            center=(X, 0, 0), trim='kit', band='plankA', uv_fn=lambda k, i: (0.0, 0.0))
    bm.faces.ensure_lookup_table()
    collar = bm.faces[nfa:]
    for v in {v for f_ in collar for v in f_.verts}:
        d = v.co - Vector((X, 0, 0))
        if d.z > 0.0:
            v.co += Vector((d.x, d.y, 0)).normalized() * 0.03 * K.noise3(tuple(v.co * 6.0), 141) if d.length > 0.12 else Vector()
            v.co.z += 0.015 * K.noise3(tuple(v.co * 7.0), 142)
    K.uv_box(bm, tile=2.0, faces=collar)
    # a small mud trough on the other side, for the animals (its own bmesh, joined below)
    tw, td, th, tx = 0.95, 0.46, 0.3, -1.38
    tb = bmesh.new()
    tuv = K.ensure_uv(tb)
    bmesh.ops.create_cube(tb, size=1.0)
    for v in tb.verts:
        v.co = Vector((tx + v.co.x * tw, -0.2 + v.co.y * td, (v.co.z + 0.5) * th))
    tb.normal_update()
    top = [f_ for f_ in tb.faces if f_.normal.z > 0.9]
    bmesh.ops.inset_region(tb, faces=top, thickness=0.07, depth=0.0)
    for f_ in top:
        for v in f_.verts:
            v.co.z -= 0.18
    bmesh.ops.bevel(tb, geom=tb.edges[:], offset=0.022, segments=2 if q < 2 else 1, affect='EDGES', clamp_overlap=True)
    tb.normal_update()
    for f_ in tb.faces:
        f_.smooth = True
        n = f_.normal
        for l in f_.loops:
            co = l.vert.co
            if abs(n.z) > 0.7:
                l[tuv].uv = (co.x / 2, co.y / 2)
            elif abs(n.x) > abs(n.y):
                l[tuv].uv = (co.y / 2, co.z / 2)
            else:
                l[tuv].uv = (co.x / 2, co.z / 2)
    for v in tb.verts:
        v.co += Vector((0.006 * K.noise3(tuple(v.co * 5), 140), 0.006 * K.noise3(tuple(v.co * 5 + Vector((3, 0, 0))), 140), 0))
    trough_ob = S.obj_from_bm('_trough', tb, ['M_MudPlaster'])
    ob = S.obj_from_bm(name, bm, ['M_MudPlaster', 'M_MudBrick', 'M_Timber', 'M_StructMisc'])
    me = ob.data
    col = K.ensure_col(ob)
    for p in me.polygons:
        c = p.center
        r = math.hypot(c.x, c.y)
        k = 1.0
        if p.material_index in (0, 1):
            if r < Ri + 0.01 and c.z < H - 0.02:
                k = 0.18 + 0.82 * K.smoothstep(0.05, H, c.z) ** 1.5
            if c.z < 0.04 and r < Ri * 1.05:
                k = 0.035
            elif r > Ro - 0.01 and c.z < 0.4:
                k = 0.78 + 0.22 * K.smoothstep(0.0, 0.4, c.z)
            if c.x < -0.85 and c.z < th and abs(p.normal.z) > 0.7 and c.z < th - 0.1:
                k = 0.45                                    # damp mud in the trough
        for li in p.loop_indices:
            col.data[li].color = (k, k * 0.98, k * 0.96, 1)
    tcol = K.ensure_col(trough_ob)
    for p in trough_ob.data.polygons:
        c = p.center
        k = 0.5 if (c.z < th - 0.1 and p.normal.z > 0.7) else (0.8 + 0.2 * K.smoothstep(0.0, 0.25, c.z))
        for li in p.loop_indices:
            tcol.data[li].color = (k, k * 0.98, k * 0.95, 1)
    return S.join([ob, trough_ob], name)


def shaduf_pole(name, lod):
    """The sweep: pivot at the fulcrum; long arm toward -x raised 35 degrees, counterweight at the short end."""
    q = lod
    bm, uvl = new_bm()
    TIM, MISC, MUD = 0, 1, 2
    ca, sa = math.cos(SWEEP_ANGLE), math.sin(SWEEP_ANGLE)
    tip = Vector((-SWEEP_LONG * ca, 0, SWEEP_LONG * sa))
    butt = Vector((SWEEP_SHORT * ca, 0, -SWEEP_SHORT * sa))
    sides = (9, 7, 5)[q]
    # the pole rests on the pin: its axis 0.06 above the pivot's contact
    lift = Vector((0, 0, -0.0))
    S.pole(bm, uvl, butt + lift, tip + lift, 0.068, TIM, seed=120, band='pole', sides=sides, end_tile=1, taper=0.5, wobble=0.012,
           seg_len=0.45 if q == 0 else 1.0)
    if q < 2:
        S.lashing(bm, uvl, (0, 0, 0), (-ca, 0, sa), 0.066, MISC, turns=5 if q == 0 else 3, cord=0.007, seed=121, seg=10, sides=4)
        # the rope's knot at the tip
        S.lashing(bm, uvl, tip * 0.985, (-ca, 0, sa), 0.036, MISC, turns=3, cord=0.006, seed=122, seg=8, sides=4)
    # the counterweight: a lump of river mud dried round the butt, bound with rope
    cw = butt + Vector((0.02, 0, -0.15))
    nfa = len(bm.faces)
    S.lathe(bm, uvl, [(0.0, -0.17), (0.12, -0.15), (0.18, -0.07), (0.19, 0.02), (0.15, 0.1), (0.07, 0.16), (0.0, 0.17)],
            (14, 10, 6)[q], MUD, center=cw, trim='kit', band='plankA', uv_fn=lambda k, i: (0.0, 0.0), close_top=False)
    bm.faces.ensure_lookup_table()
    lump = bm.faces[nfa:]
    for v in {v for f_ in lump for v in f_.verts}:
        d = v.co - cw
        n1 = K.noise3(tuple(d * 5.0), 123, octaves=2)
        v.co = cw + Vector((d.x * 1.2, d.y * 0.95, d.z * 0.88)) * (1 + 0.14 * n1)
    K.uv_box(bm, tile=2.0, faces=lump)
    if q < 2:
        for k, a in enumerate((0.35, -0.35)):
            pts = []
            for i in range(15):
                t = 2 * math.pi * i / 14
                pts.append(cw + Vector((math.cos(t) * 0.215 * math.cos(a), math.cos(t) * 0.2 * math.sin(a) * 2.2, math.sin(t) * 0.17)))
            S.tube(bm, uvl, pts, 0.008, MISC, sides=4, u_scale=0.08, caps=False)
        band = [cw + Vector((0.205 * math.cos(2 * math.pi * i / 14), 0.18 * math.sin(2 * math.pi * i / 14), 0.0)) for i in range(15)]
        S.tube(bm, uvl, band, 0.009, MISC, sides=4, u_scale=0.08, caps=False)
        S.tube(bm, uvl, [butt + Vector((0, 0, 0.04)), cw + Vector((0, 0, 0.15))], 0.01, MISC, sides=4, u_scale=0.08)
    ob = S.obj_from_bm(name, bm, ['M_Timber', 'M_StructMisc', 'M_MudPlaster'])
    return ob


def shaduf_bucket(name, lod):
    """The rope and leather bucket: pivot at the rope's top (hang it from the sweep's tip; keep it vertical)."""
    q = lod
    bm, uvl = new_bm()
    MISC, TIM = 0, 1
    L = 2.05
    S.tube(bm, uvl, [Vector((0, 0, -0.02)), Vector((0.005, 0, -L * 0.5)), Vector((0, 0.004, -L))], 0.009, MISC,
           sides=(6, 4, 3)[q], u_scale=0.12)
    # bail cords to the hoop
    hz = -L - 0.12
    if q < 2:
        for a in (0, math.pi):
            S.tube(bm, uvl, [Vector((0, 0, -L)), Vector((0.155 * math.cos(a), 0.155 * math.sin(a), hz))], 0.006, MISC, sides=4,
                   u_scale=0.08)
    # a wooden hoop holds the bag's mouth open
    hoop = [Vector((0.155 * math.cos(2 * math.pi * k / 16), 0.155 * math.sin(2 * math.pi * k / 16), hz)) for k in range(17)]
    S.tube(bm, uvl, hoop, 0.014, TIM, sides=(6, 4, 3)[q], band='pole', u_scale=1.0, trim='kit', caps=False)
    # the leather bag, sagging, stitched
    prof = [(0.15, hz), (0.165, hz - 0.08), (0.17, hz - 0.18), (0.15, hz - 0.28), (0.1, hz - 0.34), (0.03, hz - 0.36), (0.0, hz - 0.36)]
    S.lathe(bm, uvl, prof, (16, 10, 6)[q], MISC, band='leather', u_scale=0.5)
    for v in bm.verts:
        if v.co.z < hz - 0.01:
            v.co.x *= 1 + 0.06 * K.noise3((v.co.x * 8, v.co.y * 8, v.co.z * 8), 130)
            v.co.y *= 1 + 0.06 * K.noise3((v.co.x * 8, v.co.y * 8, v.co.z * 8 + 3), 130)
    return S.obj_from_bm(name, bm, ['M_StructMisc', 'M_Timber'])


_fx = FULCRUM
piece('well_head', 'prop', {'x': 4.0, 'y': 2.4, 'z': 1.7}, 'the well\'s centre on the ground; the forked post stands at '
      f'x = {WELL_POST_X}; the sweep\'s fulcrum (shaduf_pole\'s origin) is at ({_fx.x}, {_fx.z}, 0)',
      'public well: a mud-brick curb plastered and worn (rope grooves in the rim, brick lining showing inside, the dark '
      'shaft), a forked post with the pin, a mud trough. Pair with shaduf_pole and shaduf_bucket.', view=[-0.6, -1.4, 0.7],
      lens=40, fulcrum=[_fx.x, _fx.z, 0.0])(lambda name, lod: S.decimate(well_head(name, lod), {0: 0.42, 1: 0.6, 2: 0.7}[lod]))
piece('shaduf_pole', 'prop', {'x': 4.1, 'y': 2.0}, 'the fulcrum (place it at well_head\'s fulcrum); the long arm toward -x '
      'raised 35 degrees. Rotate about +Z: 0 (rest) to about +32 degrees lowers the bucket to the curb',
      'the water sweep: a tapering pole, lashed to the pin, a mud counterweight bound with rope at the short end',
      view=[-0.3, -1.5, 0.3], lens=40, no_ground=True, bake_ground=False,
      tip=[round(-SWEEP_LONG * math.cos(SWEEP_ANGLE), 4), round(SWEEP_LONG * math.sin(SWEEP_ANGLE), 4), 0.0])(
    lambda name, lod: shaduf_pole(name, lod))
piece('shaduf_bucket', 'prop', {'y': 2.55}, 'the top of the rope: hang it at shaduf_pole\'s tip (extras.tip, rotated '
      'with the pole) and keep it vertical; rope 2.05 m, then a hooped leather bucket',
      'rope and leather bucket for the water sweep', view=[-0.5, -1.5, 0.2], lens=50, no_ground=True, bake_ground=False)(
    lambda name, lod: shaduf_bucket(name, lod))


# ================================================================ donkey cart

def disc_wheel(bm, uvl, q, centre, R, th, seed, TIM, MISC, outer_sign=-1.0):
    """A solid tripartite disc wheel in the YZ plane (axle along x) at `centre`: three vertical planks with small gaps,
    two battens across the outer face, a raised nave, bronze studs round the rim (q 0)."""
    r = K.rng(seed)
    c = Vector(centre)
    segs = (40, 24, 14)[q]
    gap = 0.008
    strips = [(-R, -0.15 - gap / 2), (-0.15 + gap / 2, 0.15 - gap / 2), (0.15 + gap / 2, R)]
    for k, (a_, b_) in enumerate(strips):
        # outline of disc ∩ strip, as (u, w) in the wheel plane (u horizontal = y, w vertical = z)
        pts = []
        for i in range(segs + 1):
            ang = 2 * math.pi * i / segs
            u, w = R * math.cos(ang), R * math.sin(ang)
            if a_ - 1e-6 <= u <= b_ + 1e-6:
                pts.append((u, w, True))
        # add the strip's straight edges where they cut the circle
        poly = []
        for u0 in (a_, b_):
            if abs(u0) < R:
                h = math.sqrt(R * R - u0 * u0)
                poly += [(u0, -h), (u0, h)]
        poly += [(u, w) for u, w, _ in pts]
        cu = sum(p_[0] for p_ in poly) / len(poly)
        cw = sum(p_[1] for p_ in poly) / len(poly)
        poly = sorted(set((round(u, 6), round(w, 6)) for u, w in poly), key=lambda p_: math.atan2(p_[1] - cw, p_[0] - cu))
        t0, t1 = -th / 2, th / 2
        front = [bm.verts.new(c + Vector((t0, u, w))) for u, w in poly]
        back = [bm.verts.new(c + Vector((t1, u, w))) for u, w in poly]
        u0 = r.random()
        band = 'plankA' if k != 1 else 'plankB'

        def uvp(u, w):
            return (u0 + (w + R) / 2.0, K.trim_v(band, ((u - a_) / 0.5) % 1.0))
        f = bm.faces.new(front[::-1])
        f.material_index = TIM
        for l in f.loops:
            l[uvl].uv = uvp(l.vert.co.y - c.y, l.vert.co.z - c.z)
        f = bm.faces.new(back)
        f.material_index = TIM
        for l in f.loops:
            l[uvl].uv = uvp(l.vert.co.y - c.y, l.vert.co.z - c.z)
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new([front[i], front[j], back[j], back[i]])
            f.material_index = TIM
            ua, ub = (poly[i][1] + R) / 2.0 + u0, (poly[j][1] + R) / 2.0 + u0
            for l, uv in zip(f.loops, [(ua, K.trim_v(band, 0.1)), (ub, K.trim_v(band, 0.1)), (ub, K.trim_v(band, 0.2)), (ua, K.trim_v(band, 0.2))]):
                l[uvl].uv = uv
    # battens across the outer face, pegged
    ox = outer_sign * (th / 2 + 0.014)
    for wz in (-0.24, 0.24):
        half = math.sqrt(R * R - wz * wz) - 0.04
        S.plank(bm, uvl, (c.x + ox - 0.014, c.y - half, c.z + wz - 0.03), (c.x + ox + 0.014, c.y + half, c.z + wz + 0.03), TIM,
                seed=seed + int(wz * 100), along='y', band='plankB', bevel=0.006)
        if q == 0:
            for u in (-half + 0.06, 0.0, half - 0.06):
                S.lathe(bm, uvl, [(0.0, 0.0), (0.011, 0.0), (0.011, 0.008), (0.0, 0.01)], 6, MISC,
                        center=(c.x + ox + outer_sign * 0.014, c.y + u, c.z + wz), band='bronze')
    # the nave: a raised hub both sides, the axle hole dark
    nave = [(0.11, -th / 2 - 0.07), (0.125, -th / 2 - 0.04), (0.13, -th / 2), (0.13, th / 2), (0.125, th / 2 + 0.04), (0.11, th / 2 + 0.07)]
    rings = S.lathe(bm, uvl, nave, (18, 12, 8)[q], TIM, trim='kit', band='plankA', uv_fn=lambda k, i: (k / 18.0, K.trim_v('plankA', i / 6)))
    for ring in rings:
        for v in ring:
            lx, ly, lz = v.co.x, v.co.y, v.co.z
            v.co = c + Vector((lz, lx, ly))
    for ring in (rings[0], rings[-1]):
        f = bm.faces.new(ring if ring is rings[0] else ring[::-1])
        f.material_index = TIM
        for l in f.loops:
            d = l.vert.co - c
            l[uvl].uv = K.end_tile_uv(5, d.y / 0.11, d.z / 0.11)
    # bronze studs round the outer face's edge
    if q == 0:
        n = 22
        for i in range(n):
            ang = 2 * math.pi * (i + 0.5) / n
            pc = c + Vector((outer_sign * th / 2, (R - 0.022) * math.cos(ang), (R - 0.022) * math.sin(ang)))
            rings = S.lathe(bm, uvl, [(0.0, -0.002), (0.011, -0.002), (0.011, 0.004), (0.006, 0.008), (0.0, 0.009)], 6, MISC, band='bronze')
            for ring in rings:
                for v in ring:
                    lx, ly, lz = v.co.x, v.co.y, v.co.z
                    v.co = pc + Vector((outer_sign * lz, lx, ly))


def cart(name, lod):
    """A two-wheeled cart: tripartite disc wheels on a fixed axle, a plank bed with low sides, side beams running on
    as shafts; parked with the shafts' tips on the ground."""
    q = lod
    bm, uvl = new_bm()
    TIM, MISC = 0, 1
    R, th = 0.46, 0.075
    track = 1.36
    sides = (8, 6, 5)[q]
    # wheels at their place (they are symmetric about the axle, so the parking tilt does not matter to them)
    wheel_bm = bmesh.new()
    wuv = K.ensure_uv(wheel_bm)
    for i, sg in enumerate((-1, 1)):
        disc_wheel(wheel_bm, wuv, q, (sg * track / 2, 0.0, R), R, th, 200 + i, TIM, MISC, outer_sign=sg)
    # the bed, beams and shafts in the cart's frame (axle at the origin), tilted after
    zb = 0.12                       # bed bottom above the axle line
    S.pole(bm, uvl, (-track / 2 - 0.1, 0, 0), (track / 2 + 0.1, 0, 0), 0.05, TIM, seed=210, band='pole', sides=sides, end_tile=4, taper=0.0,
           wobble=0.0)
    for i, sg in enumerate((-1, 1)):
        # side beam continuing forward as a shaft, converging toward the tip
        pts = [Vector((sg * 0.5, 0.86, zb + 0.05)), Vector((sg * 0.5, -0.66, zb + 0.05)), Vector((sg * 0.40, -1.6, zb + 0.06)),
               Vector((sg * 0.32, -2.5, zb + 0.08))]
        S.tube(bm, uvl, pts, 0.042, TIM, sides=sides, band='pole', u_scale=2.0, trim='kit', radii=[0.05, 0.048, 0.042, 0.034])
        # bearing blocks on the axle
        S.plank(bm, uvl, (sg * 0.5 - 0.06, -0.09, 0.03), (sg * 0.5 + 0.06, 0.09, zb), TIM, seed=212 + i, along='y', band='plankB')
    # cross bearers and floor planks
    for k, y in enumerate((-0.6, 0.0, 0.62)):
        S.plank(bm, uvl, (-0.56, y - 0.04, zb + 0.06), (0.56, y + 0.04, zb + 0.13), TIM, seed=215 + k, along='x', band='plankB')
    nfl = 6
    for k in range(nfl):
        y0 = -0.66 + k * (1.52 / nfl)
        S.plank(bm, uvl, (-0.56, y0 + 0.004, zb + 0.13), (0.56, y0 + 1.52 / nfl - 0.004, zb + 0.165), TIM, seed=220 + k, along='x',
                band='plankA' if k % 2 else 'plankB', jitter=0.002 if q == 0 else 0)
    # low sides: two boards each side on edge, pegged to corner stakes; a rear board
    for i, sg in enumerate((-1, 1)):
        for j, h in enumerate((0.0, 0.14)):
            S.plank(bm, uvl, (sg * 0.56 - 0.015, -0.66, zb + 0.17 + h), (sg * 0.56 + 0.015, 0.86, zb + 0.30 + h), TIM, seed=230 + i * 2 + j,
                    along='y', band='plankA')
        for y in (-0.64, 0.1, 0.84):
            S.pole(bm, uvl, (sg * 0.585, y, zb + 0.08), (sg * 0.585, y, zb + 0.48), 0.022, TIM, seed=240 + int(y * 10) + i,
                   sides=max(5, sides - 2), end_tile=1, taper=0.1, wobble=0.0)
    for j, h in enumerate((0.0, 0.14)):
        S.plank(bm, uvl, (-0.55, 0.85, zb + 0.17 + h), (0.55, 0.88, zb + 0.30 + h), TIM, seed=245 + j, along='x', band='plankB')
    # a cross-bar between the shafts' tips for the harness, lashed
    S.pole(bm, uvl, (-0.36, -2.36, zb + 0.1), (0.36, -2.36, zb + 0.1), 0.028, TIM, seed=250, sides=max(5, sides - 2), end_tile=2,
           taper=0.0)
    if q < 2:
        for i, sg in enumerate((-1, 1)):
            S.lashing(bm, uvl, (sg * 0.33, -2.36, zb + 0.09), (1, 0, 0), 0.036, MISC, turns=4 if q == 0 else 2, cord=0.006, seed=252 + i,
                      seg=8, sides=4)
            # linchpins through the axle ends
            S.pole(bm, uvl, (sg * (track / 2 + 0.075), 0, 0.09), (sg * (track / 2 + 0.075), 0, -0.07), 0.012, TIM, seed=255 + i,
                   sides=5, end_tile=6, taper=0.0, wobble=0.0)
    # park it: tilt about the axle until the shafts' tips (y -2.5, z zb + 0.08) touch the ground
    ty, tz = -2.5, zb + 0.08 - 0.034
    # solve -R = ty sin a + tz cos a properly
    lo_, hi_ = -0.6, 0.6
    for _ in range(60):
        mid = (lo_ + hi_) / 2
        if ty * math.sin(mid) + tz * math.cos(mid) > -R:
            lo_ = mid
        else:
            hi_ = mid
    ang = (lo_ + hi_) / 2
    M = Matrix.Translation((0, 0, R)) @ Matrix.Rotation(ang, 4, 'X')
    for v in bm.verts:
        v.co = M @ v.co
    ob = S.obj_from_bm(name, bm, ['M_Timber', 'M_StructMisc'])
    wob = S.obj_from_bm('_wheels', wheel_bm, ['M_Timber', 'M_StructMisc'])
    # the wheel faces as built are flat; smooth the rims only
    return S.join([ob, wob], name)


piece('cart', 'prop', {'x': 1.7, 'y': 1.0, 'z': 3.4}, 'the ground under the axle\'s centre; the shafts point to +Z and '
      'rest on the ground', 'a two-wheeled cart, parked: solid tripartite disc wheels (three planks, two battens, raised '
      'naves) on a fixed axle with linchpins, a plank bed with low board sides, the side beams running on as shafts with '
      'a lashed harness bar. No animal.', view=[-1.2, -1.0, 0.6], lens=45)(
    lambda name, lod: S.decimate(cart(name, lod), {0: 1.0, 1: 0.6, 2: 0.5}[lod]))


# ================================================================ warp-weighted loom

def loom(name, lod):
    """A warp-weighted loom leaning on a wall: two uprights, the cloth beam with the woven cloth wound on it, the
    woven web down to the fell, a shed rod and a heddle rod on pegs, warp threads in two sheds to two rows of clay
    doughnut weights, a weaving sword leaning on an upright."""
    q = lod
    bm, uvl = new_bm()
    TIM, TEX, TPAT, MISC = 0, 1, 2, 3
    sides = (8, 6, 5)[q]
    yfoot, ytop, ztop = -0.66, -0.07, 2.32
    xs = 0.84

    def yplane(z):
        return yfoot + (ytop - yfoot) * z / ztop
    for i, sg in enumerate((-1, 1)):
        S.pole(bm, uvl, (sg * xs, yfoot, 0.0), (sg * xs * 1.01, ytop, ztop), 0.055, TIM, seed=300 + i, band='bark', sides=sides,
               end_tile=0, taper=0.1, seg_len=0.5 if q == 0 else 1.2)
    zb = 2.18
    yb = yplane(zb) - 0.02
    # the cloth beam with the woven cloth wound round it
    S.pole(bm, uvl, (-1.0, yb, zb), (1.0, yb, zb), 0.05, TIM, seed=302, band='pole', sides=sides, end_tile=1, taper=0.0, wobble=0.0)
    W = 1.42
    _u0, _v0, _u1, _v1 = QUAD['stepped']
    roll = S.lathe(bm, uvl, [(0.075, -W / 2), (0.08, -W / 2 + 0.03), (0.08, W / 2 - 0.03), (0.075, W / 2)], (16, 10, 6)[q], TPAT,
                   trim='kit', band='plankA', uv_fn=lambda k, i: (_u0 + (_u1 - _u0) * (i / 3), _v1 - (_v1 - _v0) * 0.04 * k / 16))
    for ring in roll:
        for v in ring:
            lx, ly, lz = v.co.x, v.co.y, v.co.z
            v.co = Vector((lz, yb + lx, zb + ly))
    # the woven web: from under the roll down to the fell, in the loom's plane, a little slack
    zfell = 1.22
    web_top = zb - 0.06
    nu, nv = ((18, 14), (8, 6), (3, 2))[q]
    u0q, v0q, u1q, v1q = QUAD['stepped']
    verts = []
    for i in range(nu + 1):
        col_ = []
        for j in range(nv + 1):
            x = -W / 2 + W * i / nu
            z = web_top - (web_top - zfell) * j / nv
            y = yplane(z) - 0.03 - 0.006 * math.sin(math.pi * i / nu) * math.sin(math.pi * j / nv) + 0.003 * K.noise3((x * 4, z * 4, 1), 310)
            col_.append(bm.verts.new((x, y, z)))
        verts.append(col_)
    for i in range(nu):
        for j in range(nv):
            f = bm.faces.new([verts[i][j], verts[i][j + 1], verts[i + 1][j + 1], verts[i + 1][j]])
            f.material_index = TPAT
            f.smooth = True
            for l in f.loops:
                co = l.vert.co
                uu = u0q + (u1q - u0q) * (co.x + W / 2) / W
                vv = v1q - (v1q - v0q) * 0.55 * (web_top - co.z) / (web_top - zfell)
                l[uvl].uv = (uu, vv)
    # shed rod and heddle rod on pegs in front of the uprights
    y_shed = yplane(0.98) - 0.16
    y_hed = yplane(1.12) - 0.2
    for zr_, yr_, rr_, sd in ((0.98, y_shed, 0.024, 311), (1.12, y_hed, 0.02, 312)):
        S.pole(bm, uvl, (-0.98, yr_, zr_), (0.98, yr_, zr_), rr_, TIM, seed=sd, band='pole', sides=max(5, sides - 2), end_tile=2,
               taper=0.0, wobble=0.003)
        for sg in (-1, 1):
            S.pole(bm, uvl, (sg * (xs + 0.01), yplane(zr_ - 0.03) + 0.02, zr_ - 0.03), (sg * (xs + 0.01), yr_ - 0.03, zr_ - 0.03), 0.014, TIM,
                   seed=sd + 5 + sg, sides=5, end_tile=6, taper=0.0, wobble=0.0)
    # warp threads and weights: front sheet over the shed rod, back sheet straight down; doughnut weights in two rows
    nw = 12
    per = (6, 2, 1)[q]
    tw = 0.0028 if q == 0 else 0.006
    y_fell = yplane(zfell) - 0.03
    r = K.rng(320)
    wprof = [(0.017, -0.019), (0.034, -0.02), (0.05, -0.012), (0.054, 0.0), (0.05, 0.012), (0.034, 0.02), (0.017, 0.019), (0.012, 0.0), (0.017, -0.019)]

    def thread(a, b):
        # a flat strip a -> b, facing the viewer (-y)
        d = (b - a).normalized()
        side = d.cross(Vector((0, -1, 0))).normalized() * tw / 2
        vs = [bm.verts.new(a - side), bm.verts.new(a + side), bm.verts.new(b + side), bm.verts.new(b - side)]
        f = bm.faces.new(vs)
        f.material_index = TEX
        L = (b - a).length
        for l, uv in zip(f.loops, [(0, 0), (0.01, 0), (0.01, L / 0.27), (0, L / 0.27)]):
            l[uvl].uv = uv
    for row, (yw, over) in enumerate(((y_fell + 0.005, False), (y_shed - 0.03, True))):
        for k in range(nw):
            xw = -W / 2 + W * (k + 0.5) / nw + (0.03 if row else -0.03)
            zw = 0.42 + r.uniform(-0.05, 0.04) + (0.06 if row else 0)
            top = Vector((xw, yw, zw + 0.06))
            if q < 2:
                for t_ in range(per):
                    xf = -W / 2 + W * (k + (t_ + 0.5 + (0.5 if row else 0)) / per / 1.0) / nw
                    xf = min(W / 2 - 0.01, xf)
                    fell = Vector((xf, y_fell - (0.002 if row else -0.002), zfell))
                    if over:
                        mid = Vector((xf * 0.98 + xw * 0.02, y_shed - 0.026, 0.98 + 0.02))
                        thread(fell, mid)
                        thread(mid, top)
                    else:
                        thread(fell, top)
            else:
                thread(Vector((xw, y_fell, zfell)), top)
            # the weight, hanging with its hole across the threads' pull (axis along y)
            rings = S.lathe(bm, uvl, wprof, (14, 9, 6)[q], MISC, band='clay', u_scale=0.3)
            sq = 1 + 0.12 * (r.random() - 0.5)
            for ring in rings:
                for v in ring:
                    lx, ly, lz = v.co.x, v.co.y, v.co.z
                    v.co = Vector((xw + lx * sq, yw + lz, zw + ly * sq * 1.05))
    # a weaving sword leaning on the right upright
    sw = S.plank(bm, uvl, (-0.03, -0.012, 0.0), (0.03, 0.012, 0.95), TIM, seed=330, along='z', band='plankB', bevel=0.008)
    Msw = Matrix.Translation((xs + 0.13, yplane(0.5) - 0.18, 0.0)) @ Matrix.Rotation(math.radians(-14), 4, 'X') @ Matrix.Rotation(math.radians(8), 4, 'Y')
    S.transform_faces(bm, sw, Msw)
    ob = S.obj_from_bm(name, bm, ['M_Timber', 'M_Textile', 'M_TextilePattern', 'M_StructMisc'])
    me = ob.data
    col = K.ensure_col(ob)
    for p in me.polygons:
        if p.material_index == TEX:
            for li in p.loop_indices:
                col.data[li].color = (0.95, 0.92, 0.86, 1)
    return ob


piece('loom', 'prop', {'x': 2.0, 'y': 2.35, 'z': 0.75}, 'centre of its foot line projected to the wall: the origin is '
      'on the wall face at the ground; the loom leans on that wall (toward -Z) and stands in front of it (+Z)',
      'a warp-weighted loom leaning on a wall: bark-covered uprights, the cloth beam with woven cloth wound on it, a '
      'web with stepped bands, shed rod and heddle rod on pegs, warp threads in two sheds, two rows of fired-clay '
      'doughnut weights, a weaving sword', view=[-0.7, -1.4, 0.35], lens=45)(lambda name, lod: S.decimate(loom(name, lod), {0: 1.0, 1: 0.75, 2: 0.28}[lod]))


# ================================================================ cloths hung over a line

def hang_cloth(name, q, w, h_front, h_back, design=None, dye_name=None, seed=0, line_r=0.008, origin=(0, 0, 0), tilt=0.0,
               flare=0.018):
    """A cloth folded over a horizontal line along x through `origin`: one side hangs h_front toward -y, the other
    h_back toward +y. With `design` (a QUAD name) the texture carries the colours; else dye_name tints COLOR_0."""
    rc = line_r + 0.004
    arc = math.pi * rc
    total = h_front + h_back + arc
    o = Vector(origin)

    def place(u, v):
        # v: 0 at the back hem .. total at the front hem; the fold over the line is in the middle
        if v < h_back:
            depth = h_back - v
            side = 1.0
        elif v < h_back + arc:
            a = (v - h_back) / rc                      # 0..pi over the top, back to front
            p = Vector((u, rc * math.cos(a), rc * math.sin(a) - 0.0))
            return o + p
        else:
            depth = v - h_back - arc
            side = -1.0
        y = side * (rc + flare * K.smoothstep(0.0, 0.7, depth) * (0.5 + 0.5 * depth))
        y += side * S.fold_wave(u, depth, seed + (0 if side > 0 else 7), lam=0.3, amp=0.05, ramp=0.5)
        z = -depth
        # the corners droop a touch lower than the middle; the hem waves
        z -= 0.02 * (2 * u / w) ** 2 * K.smoothstep(0.2, 1.0, depth)
        z += 0.008 * K.noise3((u * 3.0, depth, seed), seed + 3) * K.smoothstep(0.3, 1.0, depth)
        return o + Vector((u, y, z))

    def uvf(u, v):
        if design:
            u0, v0, u1, v1 = QUAD[design]
            return (u0 + (u1 - u0) * (u + w / 2) / w, v0 + (v1 - v0) * v / total)
        return ((u + w / 2) / 0.27, v / 0.27)
    nu = max(3, int(round(w / (0.065, 0.13, 0.3)[q])))
    nv = max(5, int(round(total / (0.065, 0.13, 0.3)[q])))
    ob = S.drape_sheet(name, 'M_TextilePattern' if design else 'M_Textile', nu, nv, (-w / 2, w / 2), (0.0, total), place, uvf,
                       dye(DYES[dye_name]) if (dye_name and not design) else None, flip=False)
    if tilt:
        ob.data.transform(Matrix.Translation(o) @ Matrix.Rotation(tilt, 4, 'Y') @ Matrix.Translation(-o))
    return ob


CLOTHS = {
    'cloth_hang_a': dict(w=1.1, h_front=0.85, h_back=0.78, design='zigzag', seed=401),
    'cloth_hang_b': dict(w=0.9, h_front=0.62, h_back=0.66, dye_name='indigo', seed=402),
    'cloth_hang_c': dict(w=1.0, h_front=0.74, h_back=0.7, design='lozenge', seed=403),
    'cloth_hang_d': dict(w=0.8, h_front=0.55, h_back=0.5, dye_name='saffron', seed=404),
}
for nm, kw in CLOTHS.items():
    desc = (f"woven cloth with the '{kw['design']}' band design" if kw.get('design') else f"plain linen dyed {kw['dye_name']}")
    piece(nm, 'cloth', {'x': kw['w'], 'y': max(kw['h_front'], kw['h_back'])}, 'the line at the top of the fold (the cloth '
          'hangs over a line along x through the origin; its longer side toward +Z)', desc + ' folded over a line, soft '
          'folds; string several on a rope between poles', view=[-0.5, -1.5, 0.3], lens=50, no_ground=True, bake_ground=False,
          **({'dye': DYES[kw['dye_name']]} if kw.get('dye_name') else {}))(
        lambda name, lod, kw=kw: hang_cloth(name, lod, **kw))


def cloth_line(name, lod):
    """Two forked poles and a sagging rope with four cloths drying on it."""
    q = lod
    bm, uvl = new_bm()
    TIM, MISC = 0, 1
    sides = (8, 6, 5)[q]
    xa, xb, zt = -2.2, 2.2, 2.02
    for i, x in enumerate((xa, xb)):
        S.pole(bm, uvl, (x + 0.03 * (1 if i else -1), 0.0, -0.05), (x, 0.0, zt + 0.12), 0.042, TIM, seed=420 + i, band='pole', sides=sides,
               end_tile=1, taper=0.15, seg_len=0.6 if q == 0 else 1.5)
        if q < 2:
            S.lashing(bm, uvl, (x, 0.0, zt), (0, 0, 1), 0.04, MISC, turns=3, cord=0.007, seed=423 + i, seg=8, sides=4)
    sag = 0.11
    rope = S.catenary((xa, 0, zt), (xb, 0, zt), sag, (24, 12, 6)[q])
    S.tube(bm, uvl, rope, 0.007, MISC, sides=(5, 4, 3)[q], u_scale=0.12)
    frame = S.obj_from_bm(name, bm, ['M_Timber', 'M_StructMisc'])
    parts = [frame]
    spots = [(-1.5, 'cloth_hang_c'), (-0.42, 'cloth_hang_b'), (0.66, 'cloth_hang_a'), (1.62, 'cloth_hang_d')]
    for k, (x, key) in enumerate(spots):
        kw = dict(CLOTHS[key])
        t = (x - xa) / (xb - xa)
        z = zt - 4 * sag * t * (1 - t)
        slope = -4 * sag * (1 - 2 * t) / (xb - xa)
        kw['seed'] = kw['seed'] + 50
        c = hang_cloth(f'_cl_{name}_{k}', q, origin=(x, 0.0, z + 0.007), tilt=-math.atan(slope), **kw)
        parts.append(c)
    return S.join(parts, name)


piece('cloth_line', 'prop', {'x': 4.5, 'y': 2.15, 'z': 0.6}, 'base centre between the two poles on the ground; the line '
      'runs along x', 'a drying line: two poles and a sagging rope with four cloths (two woven designs, indigo and '
      'saffron linen) folded over it', view=[-0.6, -1.5, 0.45], lens=45)(
    lambda name, lod: S.decimate(cloth_line(name, lod), {0: 1.0, 1: 0.8, 2: 0.6}[lod]))


# ================================================================ the weigher's scale

def scale(name, lod):
    """The weigher's scale: a post with an arm, a balance beam on a cord, bronze pans on three cords each, a few
    weights on a cloth on the ground."""
    q = lod
    bm, uvl = new_bm()
    TIM, MISC = 0, 1
    sides = (8, 6, 5)[q]
    S.pole(bm, uvl, (0.0, 0.0, -0.05), (0.0, 0.0, 2.2), 0.07, TIM, seed=500, band='bark', sides=sides, end_tile=0, taper=0.15)
    S.plank(bm, uvl, (-0.05, -0.04, 2.08), (0.62, 0.04, 2.16), TIM, seed=501, along='x', band='plankB')
    S.pole(bm, uvl, (0.12, 0.0, 2.1), (0.0, 0.0, 1.78), 0.02, TIM, seed=502, sides=5, end_tile=6, taper=0.0, wobble=0.0)
    hx, hz = 0.55, 2.08
    bz = 1.68
    S.tube(bm, uvl, [Vector((hx, 0, hz)), Vector((hx, 0, bz + 0.03))], 0.006, MISC, sides=4, u_scale=0.08)
    # the beam: a bronze-capped wooden rod
    S.pole(bm, uvl, (hx - 0.46, 0, bz), (hx + 0.46, 0, bz), 0.016, TIM, seed=503, band='plankB', sides=6, end_tile=5, taper=0.0, wobble=0.0)
    S.lathe(bm, uvl, [(0.0, -0.025), (0.03, -0.02), (0.03, 0.02), (0.0, 0.025)], 8, MISC, center=(hx, 0, bz), band='bronze')
    for sg in (-1, 1):
        ex = hx + sg * 0.44
        pz = 1.18
        for k in range(3 if q < 2 else 1):
            a = 2 * math.pi * k / 3 + 0.3
            S.tube(bm, uvl, [Vector((ex, 0, bz - 0.01)), Vector((ex + 0.11 * math.cos(a), 0.11 * math.sin(a), pz + 0.025))], 0.003, MISC,
                   sides=3, u_scale=0.08, caps=False)
        S.lathe(bm, uvl, [(0.0, 0.0), (0.06, 0.002), (0.11, 0.015), (0.135, 0.035), (0.13, 0.038), (0.105, 0.02), (0.055, 0.008), (0.0, 0.006)],
                (18, 12, 8)[q], MISC, center=(ex, 0, pz), band='bronze', u_scale=0.25)
    # weights: barrel-shaped stones on one pan and a few on the ground
    r = K.rng(510)
    spots = [(hx - 0.44, 0.0, 1.19, 0.03), (hx - 0.42, 0.04, 1.19, 0.02)] + [(0.35 + r.uniform(-0.1, 0.3), -0.35 + r.uniform(-0.1, 0.1), 0.0, s) for s in (0.045, 0.035, 0.028, 0.022)]
    for (x, y, z, s) in spots:
        rings = S.lathe(bm, uvl, [(0.0, -s), (s * 0.55, -s * 0.9), (s * 0.75, -s * 0.5), (s * 0.8, 0.0), (s * 0.75, s * 0.5), (s * 0.55, s * 0.9), (0.0, s)],
                        10 if q == 0 else 6, MISC, band='leather', u_scale=0.2)
        for ring in rings:
            for v in ring:
                lx, ly, lz = v.co.x, v.co.y, v.co.z
                v.co = Vector((x + lz, y + ly, z + s * 0.78 + lx))
    return S.obj_from_bm(name, bm, ['M_Timber', 'M_StructMisc'])


piece('scale', 'prop', {'x': 1.2, 'y': 2.2, 'z': 0.6}, 'the post\'s foot on the ground; the arm and pans toward +x',
      'the weigher\'s scale: a post with an arm, a balance beam hung on a cord, two bronze pans on three cords each, '
      'barrel-shaped weights (dark stone) on a pan and on the ground', view=[-0.4, -1.5, 0.45], lens=50)(
    lambda name, lod: S.decimate(scale(name, lod), {0: 1.0, 1: 0.6, 2: 0.4}[lod]))


# ================================================================ build / export

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
            o.location = (0, 0, 0)
        K.bake_ao(obs, samples=48, distance=0.6, ground=p['bake_ground'], strength=0.6)
        extra = dict(p['extra'])
        if p['view']:
            extra['view'] = p['view']
        extra['lens'] = p['lens']
        if p['no_ground']:
            extra['no_ground'] = True
        metas.append(K.piece_meta(p['name'], obs, p['kind'], p['snap'], p['pivot'], p['notes'], extra))
        objs += obs
        print(f"{p['name']}: {[m['tris'] for m in metas[-1]['lods']]} tris, {time.time() - t:.1f}s", flush=True)
    for o in list(bpy.context.scene.objects):
        if o.name.startswith('_'):
            S.remove(o)
    if 'preview' in A:
        nm = A['preview']
        show = {nm}
        if nm == 'well_head' and 'shaduf_pole' in bpy.data.objects:
            show |= {'shaduf_pole', 'shaduf_bucket'}
            bpy.data.objects['shaduf_pole'].location = FULCRUM
            tip = Vector((-SWEEP_LONG * math.cos(SWEEP_ANGLE), 0, SWEEP_LONG * math.sin(SWEEP_ANGLE)))
            bpy.data.objects['shaduf_bucket'].location = FULCRUM + tip
        for o in bpy.context.scene.objects:
            o.hide_render = o.name not in show
        K.render_setup(res=(1400, 1000), samples=96, sun_elev=32, sun_azim=-40)
        K.ground_plane(size=40)
        bpy.context.view_layer.update()
        K.frame([bpy.data.objects[n] for n in show], direction=[-0.9, -1.4, 0.6], lens=40, margin=1.05)
        K.render(os.path.join(K.RENDERS, PACK, f'preview_{nm}.png'))
        return
    path = os.path.join(K.EXPORT, f'{PACK}.glb')
    K.export_glb(objs, path)
    K.write_stats(PACK, metas, f'{PACK}.glb')
    print(f'exported {path} in {time.time() - t0:.0f}s')


# ================================================================ hero shots

def _import(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for m in bpy.data.materials:
        if m.name.startswith('M_') and not m.name.endswith('_imported') and not m.node_tree.nodes.get('Image Texture'):
            m.name = m.name.split('.')[0] + '_imported'
    out = {}
    for o in new:
        if o.type != 'MESH':
            continue
        me = o.data
        if 'Col' not in me.color_attributes and len(me.color_attributes):
            me.color_attributes[0].name = 'Col'
        for sl in o.material_slots:
            if sl.material:
                base = sl.material.name.split('.')[0].replace('_imported', '')
                try:
                    sl.material = K.material(base)
                except KeyError:
                    pass
        o.hide_render = True
        o.hide_set(True)
        out[o.name] = o
    return out


def _place(lib, name, loc, yaw=0.0, label=None):
    src = lib[name]
    o = bpy.data.objects.new(label or name + '_i', src.data)
    bpy.context.scene.collection.objects.link(o)
    o.location = Vector(loc)
    o.rotation_euler = (0, 0, math.radians(yaw))
    return o


def _runner(loc, yaw, frame=8):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(K.ROOT, 'atlas', 'public', 'game', 'streets', 'runner.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    arm = next((o for o in new if o.type == 'ARMATURE'), None)
    for o in new:
        if o.name.startswith('Icosphere'):
            o.hide_render = True
    if arm:
        arm.location = Vector(loc)
        arm.rotation_euler = (0, 0, math.radians(yaw))
        idle = next((a for a in bpy.data.actions if 'Idle' in a.name), None)
        if idle and arm.animation_data:
            arm.animation_data.action = idle
        bpy.context.scene.frame_set(frame)
    return new


def _facade(arch, x0, y, pieces, bands=True, yaw=0.0):
    x = x0
    for nm in pieces:
        w = {'wall_1m': 1, 'wall_2m_a': 2, 'wall_2m_b': 2, 'wall_4m_a': 4, 'wall_4m_b': 4, 'door_2m': 2, 'door_3m': 3, 'window_2m': 2}[nm]
        _place(arch, nm, (x, y, 0))
        if bands:
            band = {1: 'wallband_1m', 2: 'wallband_2m', 3: None, 4: 'wallband_4m'}[w]
            if band:
                _place(arch, band, (x, y, 3.0))
            elif w == 3:
                _place(arch, 'wallband_2m', (x, y, 3.0))
                _place(arch, 'wallband_1m', (x + 2, y, 3.0))
        x += w
    return x


def hero():
    K.reset()
    arch = _import(os.path.join(K.EXPORT, 'arch.glb'))
    lib = _import(os.path.join(K.EXPORT, f'{PACK}.glb'))
    out = os.path.join(K.RENDERS, PACK)
    shots = A.get('hero', 'market,well,loom').split(',') if A.get('hero') not in (None, '1') else ['market', 'well', 'loom']
    for shot in shots:
        keep = set(arch.values()) | set(lib.values())
        for o in list(bpy.context.scene.objects):
            if o not in keep:
                bpy.data.objects.remove(o, do_unlink=True)
        if shot == 'market':
            K.render_setup(res=(1920, 1080), samples=160, sun_elev=24, sun_azim=-62, sun_strength=4.2, hdri_strength=0.85)
            K.ground_plane(size=80)
            _place(arch, 'corner_out', (-6.5, 3.0, 0))
            _place(arch, 'cornerband', (-6.5, 3.0, 3.0))
            _facade(arch, -6.0, 3.0, ['wall_4m_a', 'door_2m', 'wall_2m_a', 'window_2m', 'wall_4m_b'])
            _place(lib, 'stall_lean', (4.3, 3.0, 0), 0)
            _place(lib, 'stall_large', (-1.6, 0.4, 0), 6)
            _place(lib, 'scale', (1.5, -1.2, 0), -30)
            _runner((0.9, -2.2, 0), 160)
            K.camera((-5.2, -7.6, 1.62), (0.4, 1.0, 1.55), lens=30)
        elif shot == 'well':
            K.render_setup(res=(1920, 1080), samples=160, sun_elev=26, sun_azim=-130, sun_strength=4.2, hdri_strength=0.85)
            K.ground_plane(size=80)
            _place(arch, 'corner_out', (-5.5, 4.2, 0))
            _facade(arch, -5.0, 4.2, ['wall_4m_b', 'wall_2m_b', 'door_2m', 'wall_4m_a'], bands=True)
            _place(lib, 'well_head', (0, 0, 0), 0)
            _place(lib, 'shaduf_pole', tuple(FULCRUM), 0)
            tip = Vector((-SWEEP_LONG * math.cos(SWEEP_ANGLE), 0, SWEEP_LONG * math.sin(SWEEP_ANGLE)))
            _place(lib, 'shaduf_bucket', tuple(FULCRUM + tip), 0)
            _place(lib, 'cart', (-3.4, 1.4, 0), 115)
            _runner((2.6, -1.9, 0), 225)
            K.camera((4.6, -6.4, 1.66), (0.3, 0.6, 1.5), lens=32)
        elif shot == 'loom':
            K.render_setup(res=(1920, 1080), samples=192, sun_elev=30, sun_azim=-30, sun_strength=4.0, hdri_strength=0.8)
            K.ground_plane(size=60)
            _place(arch, 'corner_out', (-3.5, 0.0, 0))
            _facade(arch, -3.0, 0.0, ['wall_2m_a', 'wall_4m_a', 'wall_2m_b'], bands=True)
            _place(lib, 'loom', (0.2, 0.0, 0), 0)
            _place(lib, 'cloth_hang_c', (2.3, -0.9, 1.9), 8)
            _place(lib, 'cloth_hang_a', (3.4, -0.9, 1.88), 4)
            _runner((-1.25, -1.35, 0), 125)
            K.camera((-1.9, -3.9, 1.6), (0.35, -0.3, 1.15), lens=32)
        K.render(os.path.join(K.RENDERS, f'{PACK}_hero_{shot}.png'))


if __name__ == '__main__':
    if 'hero' in A:
        hero()
    else:
        build()
