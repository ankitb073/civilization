"""Architecture pieces beyond plain walls: openings, door leaves, roofs, parapets, stairs, ladders, courtyard walls,
the city wall and gate, the temple porch. Each builder takes (name, lod, ...) and returns one object."""
import math
import bmesh
from mathutils import Vector
import kitlib as K
from surface import Builder, layered, axis, MAT_PLASTER, MAT_BRICK
from mudwall import BASE_H, P_THICK, grime
from archparts import (build_wall, finalize_lod, Opening, beam_box, log_cyl, MATS, MAT_TIMBER, STEP, Wear, relief3)
from profiles import Profile, sweep, sweep_P

T = 0.5


# ---------------------------------------------------------------- doorways, windows, doors

def door_wall(name, lod, W, dw, dh, seed, double_lintel=False):
    x0, x1 = W / 2 - dw / 2, W / 2 + dw / 2
    op = Opening('door', x0, x1, 0.0, dh, lintel=0.30 if double_lintel else 0.17, bearing=0.26, beams=2 if double_lintel else 1)

    def extra(bm, uvl):
        # a worn timber threshold, its top a little above the street
        beam_box(bm, uvl, (x0 - 0.05, 0.03, -0.08), (x1 + 0.05, T - 0.03, 0.045), band='plankB', seed=seed + 3,
                 bevel=0.02, along='x', jitter=0.002 if lod == 0 else 0.0, end_tile=5)
    ob = build_wall(name, W, 3.0, T, seed, lod, openings=[op], extra=extra, density=0.9)
    return finalize_lod(ob, lod)


def window_wall(name, lod, W, ww, wh, z0, seed):
    x0, x1 = W / 2 - ww / 2, W / 2 + ww / 2
    op = Opening('window', x0, x1, z0, z0 + wh, lintel=0.12, bearing=0.2)

    def extra(bm, uvl):
        r = 0.016
        yg = 0.17
        sides = 6 if lod == 0 else 4
        if lod < 2:
            for k in range(3):
                x = x0 + ww * (k + 1) / 4
                log_cyl(bm, uvl, (x, yg, z0 - 0.01), (x, yg, z0 + wh + 0.01), r, seed=seed + k, band='pole', sides=sides,
                        end_tile=6, wobble=0.003, seg_len=0.5)
            for k in range(2):
                z = z0 + wh * (k + 1) / 3
                log_cyl(bm, uvl, (x0 - 0.01, yg + 0.03, z), (x1 + 0.01, yg + 0.03, z), r * 0.9, seed=seed + 5 + k, band='pole',
                        sides=sides, end_tile=6, wobble=0.003, seg_len=0.6)
        # the dark room behind
        vs = [bm.verts.new(v) for v in ((x0, T - 0.04, z0), (x1, T - 0.04, z0), (x1, T - 0.04, z0 + wh), (x0, T - 0.04, z0 + wh))]
        f = bm.faces.new(vs)
        f.material_index = MAT_PLASTER
        for l in f.loops:
            l[uvl].uv = (l.vert.co.x / 2, l.vert.co.z / 2)

    def post(ob):
        me = ob.data
        col = me.color_attributes['Col']
        for p in me.polygons:
            c = p.center
            if c.y > T - 0.06 and x0 - 1e-3 < c.x < x1 + 1e-3 and z0 - 1e-3 < c.z < z0 + wh + 1e-3 and abs(p.normal.y) > 0.9:
                for li in p.loop_indices:
                    col.data[li].color = (0.05, 0.045, 0.04, 1)
    ob = build_wall(name, W, 3.0, T, seed, lod, openings=[op], extra=extra, post=post, density=0.9)
    return finalize_lod(ob, lod)


def door_leaf(name, lod, w, h, seed, heavy=False):
    """A plank door: vertical planks, battens behind, a round pivot post at x = 0 (its axis is the hinge)."""
    r = K.rng(seed)
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    th = 0.045 if not heavy else 0.055
    post_r = 0.05 if not heavy else 0.06
    if lod == 2:
        beam_box(bm, uvl, (post_r * 0.6, -th / 2, 0.0), (w, th / 2, h), band='plankB', along='z', bevel=0.0, jitter=0)
        log_cyl(bm, uvl, (0, 0, -0.02), (0, 0, h + 0.06), post_r, seed=seed, band='pole', sides=5, end_tile=1, wobble=0)
    else:
        n = max(3, int(round((w - post_r) / 0.24)))
        pw = (w - post_r * 0.6) / n
        x = post_r * 0.6
        for k in range(n):
            gap = 0.006
            top = h - r.uniform(0, 0.025)
            beam_box(bm, uvl, (x + gap / 2, -th / 2 + r.uniform(-0.003, 0.003), r.uniform(0.0, 0.015)), (x + pw - gap / 2, th / 2, top),
                     band='plankB' if k % 3 else 'plankA', seed=seed + k, along='z', bevel=0.006, jitter=0.002 if lod == 0 else 0,
                     u0=r.random(), end_tile=5)
            x += pw
        # battens on the inside (+Y), and a brace
        for z in ((0.18, h * 0.5, h - 0.2) if not heavy else (0.16, h * 0.36, h * 0.66, h - 0.18)):
            beam_box(bm, uvl, (post_r * 0.4, th / 2, z - 0.06), (w - 0.04, th / 2 + 0.035, z + 0.06), band='plankA', along='x',
                     seed=seed + int(z * 100), bevel=0.008, jitter=0.002 if lod == 0 else 0, u0=r.random(), end_tile=5)
        log_cyl(bm, uvl, (0, 0.005, -0.03), (0, 0.005, h + 0.08), post_r, seed=seed + 9, band='pole', sides=8 if lod == 0 else 6,
                end_tile=1, wobble=0.004, seg_len=0.6)
        # a wooden pull: a peg through the planks
        log_cyl(bm, uvl, (w - 0.16, -th / 2 - 0.06, h * 0.48), (w - 0.16, -th / 2 + 0.01, h * 0.48), 0.018, seed=seed + 11,
                band='pole', sides=6, end_tile=6, wobble=0)
    ob = K.new_object(name, bm, ['M_Timber'])
    # the outside is weathered paler at the foot and the edge people push
    K.paint(ob, lambda co, n, m, p: (0.82 + 0.18 * K.smoothstep(0.0, 0.5, co.z),) * 3, mode='set')
    return finalize_lod(ob, lod, {0: 1.0, 1: 0.6, 2: 1.0}[lod])



# ---------------------------------------------------------------- small helpers

def fill_cap(bm, uvl, pts, mat, axes=(0, 2), tile=2.0, flip=False):
    """A flat cap (ngon) through 3-D points (Vectors), planar UVs on two axes."""
    vs = [bm.verts.new(p) for p in (pts[::-1] if flip else pts)]
    try:
        f = bm.faces.new(vs)
    except ValueError:
        return None
    f.material_index = mat
    for l in f.loops:
        l[uvl].uv = (l.vert.co[axes[0]] / tile, l.vert.co[axes[1]] / tile)
    return f


def profile_points(prof, P, t, n=24):
    """Points along a swept profile at run parameter t (for end caps)."""
    return [P(prof.length * k / n, t, 0.0) for k in range(n + 1)]


def finish_obj(name, bm, mats, H, seed, damp=0.55, lod=0, ratio=None, deform=None, dissolve=True):
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    if dissolve:
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-5)
    ob = K.new_object(name, bm, mats)
    if deform:
        for v in ob.data.vertices:
            deform(v.co)
        ob.data.update()
    K.paint(ob, grime(H, seed, damp), mode='set')
    return finalize_lod(ob, lod, ratio)


def cap_profile(h, tp, r=0.09, crown=0.015):
    """Front up, a rounded (slightly crowned) top, back down: a parapet or courtyard-wall section, foot at y = 0,
    exterior face z = 0, thickness tp toward -z."""
    r = min(r, tp / 2 - 0.005)
    pr = Profile((0.0, 0.0)).line(0.0, h - r).arc(-r, h - r, r, math.pi / 2)
    if tp - 2 * r > 0.01:
        pr.line(-(tp - r), h)
    pr.arc(-(tp - r), h - r, r, math.pi).line(-tp, 0.0)
    return pr


def wall_like(B, tag, prof, x0, x1, wear, lod, miter0=False, miter1=False, xform=None, mats=(0, 1), relief=True,
              step=None, p=0.02):
    st = step or STEP[lod]
    rel = relief3(hash(tag) % 1000) if (relief and lod < 2) else None
    return sweep(B, tag, prof, x0, x1, wear, st, miter0, miter1, xform, p=p, relief=rel, mats=mats)


def end_caps(bm, uvl, prof, x0, x1, mat=0, which=(True, True)):
    P = sweep_P(prof, x0, x1)
    for t, w in ((0.0, which[0]), (1.0, which[1])):
        if not w:
            continue
        pts = profile_points(prof, P, t)
        fill_cap(bm, uvl, pts, mat, axes=(1, 2), flip=(t == 1.0))


LEFT_ARM = lambda v: Vector((v.y, -v.x, v.z))      # maps a run's frame onto the previous side at a corner


def corner_of(prof, depth, wear, lod, tag, mats=(0, 1), step=None, p=0.02):
    """A corner piece from two mitred arms of a profile: the front arm from the mitre to x = depth, the left arm
    (exterior -X) from the mitre back along the previous side."""
    B = Builder()
    wall_like(B, (tag, 'f'), prof, 0.0, depth, wear, lod, miter0=True, mats=mats, step=step, p=p)
    wall_like(B, (tag, 'l'), prof, -depth, 0.0, wear, lod, miter1=True, xform=LEFT_ARM, mats=mats, step=step, p=p)
    return B


# ---------------------------------------------------------------- parapets

PARAPET_H, PARAPET_T = 0.55, 0.26


def parapet(name, lod, W, seed, h=PARAPET_H, tp=PARAPET_T):
    prof = cap_profile(h, tp)
    wear = Wear(seed, W, h, base=True, base_h=0.06, density=1.6, t_range=(0.12, h - 0.12), lod=lod, band_amp=0.4,
                patch_scale=0.6, tongues=0.25)
    wear.line((0, 0, h - 0.05), (W, 0, h - 0.05), 0.05, 1.0, 0.0)
    wear.line((0, tp, h - 0.05), (W, tp, h - 0.05), 0.04, 1.0, 0.0)
    B = Builder()
    wall_like(B, 'p', prof, 0.0, W, wear, lod)
    end_caps(B.bm, B.uv, prof, 0.0, W)
    return finish_obj(name, B.bm, ['M_MudPlaster', 'M_MudBrick'], h, seed, damp=0.3, lod=lod)


def parapet_corner(name, lod, seed, h=PARAPET_H, tp=PARAPET_T):
    prof = cap_profile(h, tp)
    wear = Wear(seed, tp, h, base=True, base_h=0.06, density=0.0, lod=lod, band_amp=0.4)
    wear.line((0, 0, 0), (0, 0, h), 0.04, 1.0, 0.4)
    B = corner_of(prof, tp, wear, lod, 'pc')
    return finish_obj(name, B.bm, ['M_MudPlaster', 'M_MudBrick'], h, seed, damp=0.3, lod=lod)


def parapet_stepped(name, lod, W, seed, h=0.4, tp=0.3):
    """A low parapet with stepped merlons (two tiers), one every metre."""
    B = Builder()
    prof = cap_profile(h, tp, r=0.05)
    wear = Wear(seed, W, h, base=True, base_h=0.06, density=1.0, t_range=(0.1, h - 0.1), lod=lod, band_amp=0.4,
                patch_scale=0.5)
    wall_like(B, 'b', prof, 0.0, W, wear, lod)
    end_caps(B.bm, B.uv, prof, 0.0, W)
    n = max(1, int(round(W)))
    for k in range(n):
        c = (k + 0.5) * W / n
        for tier, (hw, h0, h1, inset) in enumerate(((0.32, h, h + 0.34, 0.0), (0.16, h + 0.34, h + 0.62, 0.03))):
            pr = cap_profile(h1 - h0, tp - 2 * inset, r=0.04)
            xf = (lambda v, h0=h0, inset=inset: Vector((v.x, v.y + inset, v.z + h0)))
            w2 = Wear(seed + 10 * k + tier, 2 * hw, h1 - h0, base=False, density=0.0, lod=lod)
            w2.line((c - hw, 0, h1), (c + hw, 0, h1), 0.035, 1.0)
            sweep(B, ('m', k, tier), pr, c - hw, c + hw, lambda q, w2=w2: w2(q), {0: 0.05, 1: 0.12, 2: 0.4}[lod], xform=xf,
                  p=0.015)
            P = sweep_P(pr, c - hw, c + hw, xform=xf)
            for t in (0.0, 1.0):
                fill_cap(B.bm, B.uv, profile_points(pr, P, t, {0: 12, 1: 6, 2: 3}[lod]), 0, axes=(1, 2), flip=(t == 1.0))
    return finish_obj(name, B.bm, ['M_MudPlaster', 'M_MudBrick'], h + 0.62, seed, damp=0.25, lod=lod)


# ---------------------------------------------------------------- roof edges, field, beam ends, spout, hatch

ROOF_T, OVER = 0.4, 0.1


def roof_profile():
    """The slab's mud edge: from the fascia (above the reed layer) up, over a rounded edge, back 0.5 m on top."""
    r = 0.1
    return Profile((OVER, 0.085)).line(OVER, ROOF_T - r).arc(OVER - r, ROOF_T - r, r, math.pi / 2).line(-0.5, ROOF_T)


def _reed_layer(bm, uvl, x0, x1, miter0=False, miter1=False, xform=None, seed=0):
    """The reed/brushwood layer under the mud (y 0..0.085) and the reed-mat soffit back to the wall face."""
    r = K.rng(seed)
    zf = OVER - 0.015
    def X(x, z, end):
        if end == 0 and miter0:
            return x0 - z
        if end == 1 and miter1:
            return x1 + z
        return x0 if end == 0 else x1
    def V(x, y, z):
        v = Vector((x, -z, y))
        return xform(v) if xform else v
    # fascia strip with a ragged lower edge (reed ends), u across the reeds
    n = max(2, int((x1 - x0) / 0.06))
    top, bot = [], []
    for k in range(n + 1):
        t = k / n
        xa = X(0, zf, 0) + (X(0, zf, 1) - X(0, zf, 0)) * t
        yb = -0.005 - r.uniform(0.0, 0.035) if 0 < k < n else 0.0
        top.append(bm.verts.new(V(xa, 0.085, zf)))
        bot.append(bm.verts.new(V(xa, yb, zf + r.uniform(-0.01, 0.015))))
    for k in range(n):
        f = bm.faces.new([bot[k], bot[k + 1], top[k + 1], top[k]])
        f.material_index = 1
        for l in f.loops:
            co = l.vert.co
            l[uvl].uv = (co.z / 0.5 * 4.0, (co.x + co.y) / 0.5)
    # soffit: reed mat from the fascia back to the wall face (y = 0), seen from below
    za, zb = zf, 0.0
    pts = [V(X(0, za, 0), 0.0, za), V(X(0, zb, 0), 0.0, zb), V(X(0, zb, 1), 0.0, zb), V(X(0, za, 1), 0.0, za)]
    vs = [bm.verts.new(p) for p in pts]
    try:
        f = bm.faces.new(vs)
        f.material_index = 1
        for l in f.loops:
            l[uvl].uv = ((l.vert.co.x - l.vert.co.y) / 0.5, (l.vert.co.x + l.vert.co.y) / 0.5)
    except ValueError:
        pass


def roof_edge(name, lod, W, seed):
    prof = roof_profile()
    wear = Wear(seed, W, ROOF_T, base=False, density=2.2, t_range=(0.12, 0.38), lod=lod, patch_scale=0.45)
    wear.line((0, -OVER, ROOF_T - 0.03), (W, -OVER, ROOF_T - 0.03), 0.06, 1.0, 0.0)
    B = Builder()
    wall_like(B, 'r', prof, 0.0, W, wear, lod, mats=(0, 2))
    _reed_layer(B.bm, B.uv, 0.0, W, seed=seed)
    ob = finish_obj(name, B.bm, ['M_MudPlaster', 'M_ReedMat', 'M_RoofMud'], ROOF_T, seed, damp=-2.0, lod=lod,
                    ratio={0: 0.35, 1: 0.7, 2: 1.0}[lod])
    return ob


def roof_edge_corner(name, lod, seed):
    prof = roof_profile()
    wear = Wear(seed, 0.5, ROOF_T, base=False, density=0.0, lod=lod)
    wear.line((-OVER, -OVER, 0.1), (-OVER, -OVER, ROOF_T), 0.09, 1.0, 0.0)
    B = Builder()
    wall_like(B, ('rc', 'f'), prof, 0.0, 0.5, wear, lod, miter0=True, mats=(0, 2))
    wall_like(B, ('rc', 'l'), prof, -0.5, 0.0, wear, lod, miter1=True, xform=LEFT_ARM, mats=(0, 2))
    _reed_layer(B.bm, B.uv, 0.0, 0.5, miter0=True, seed=seed)
    _reed_layer(B.bm, B.uv, -0.5, 0.0, miter1=True, xform=LEFT_ARM, seed=seed + 1)
    return finish_obj(name, B.bm, ['M_MudPlaster', 'M_ReedMat', 'M_RoofMud'], ROOF_T, seed, damp=-2.0, lod=lod,
                      ratio={0: 0.5, 1: 0.85, 2: 1.0}[lod])


def roof_field(name, lod, S, seed):
    """S x S m of roof top at y = ROOF_T (glTF), x 0..S, z 0..-S; gentle hollows, flat at its edges."""
    n = {0: 10, 1: 4, 2: 1}[lod]
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    vs = {}
    for i in range(n + 1):
        for j in range(n + 1):
            x, z = S * i / n, -S * j / n
            w = math.sin(math.pi * i / n) * math.sin(math.pi * j / n)
            y = ROOF_T + w * 0.003 * K.noise3((x * 1.3, z * 1.3, 0.5), seed, octaves=2)
            vs[i, j] = bm.verts.new((x, -z, y))
    for i in range(n):
        for j in range(n):
            f = bm.faces.new([vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1]])
            f.material_index = 0
            f.smooth = True
            for l in f.loops:
                l[uvl].uv = (l.vert.co.x / 2.0, l.vert.co.y / 2.0)
    ob = K.new_object(name, bm, ['M_RoofMud'])
    K.paint(ob, lambda co, nn, m, p: (0.97, 0.97, 0.97), mode='set')
    return ob


def beam_ends(name, lod, W, seed, spacing=0.5):
    """Roof beams (poplar logs) projecting from under the slab: y = 0 at the wall top, logs resting on it."""
    r = K.rng(seed)
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    n = max(1, int(round(W / spacing)))
    sides = {0: 12, 1: 8, 2: 5}[lod]
    for k in range(n):
        x = (k + 0.5) * W / n + r.uniform(-0.04, 0.04)
        rad = r.uniform(0.065, 0.085)
        out = r.uniform(0.28, 0.46)
        a = Vector((x + r.uniform(-0.02, 0.02), 0.45, rad + r.uniform(0, 0.01)))
        b = Vector((x + r.uniform(-0.03, 0.03), -out, rad + r.uniform(-0.025, 0.0)))
        log_cyl(bm, uvl, a, b, rad, seed=seed + k, band='pole' if k % 3 else 'bark', sides=sides, end_tile=k % 4,
                taper=0.04, wobble=0.006 if lod == 0 else 0.0, ends=(False, True), seg_len=0.4)
    ob = K.new_object(name, bm, ['M_Timber'])
    K.paint(ob, lambda co, nn, m, p: (0.75 + 0.25 * K.smoothstep(-0.05, -0.3, co.y),) * 3, mode='set')
    return ob


def drain_spout(name, lod, seed):
    """A carved half-log channel through the parapet foot, projecting 0.45 m, tilted down; y = 0 at the roof."""
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    n = {0: 10, 1: 6, 2: 4}[lod]
    R, ri, L0, L1 = 0.09, 0.06, 0.35, -0.48
    tilt = 0.12
    rings_o, rings_i = [], []
    for k in range(4):
        yb = L0 + (L1 - L0) * k / 3
        z0 = 0.06 + (yb < 0) * (yb * tilt)
        ro, ri_ = [], []
        for i in range(n + 1):
            a = math.pi + math.pi * i / n          # lower half circle
            ro.append(bm.verts.new((R * math.cos(a), yb, z0 + R * 0.95 + R * math.sin(a))))
            ri_.append(bm.verts.new((ri * math.cos(a), yb, z0 + R * 0.95 + ri * math.sin(a) + 0.005)))
        rings_o.append(ro)
        rings_i.append(ri_)
    def face(vs, band, along_u):
        f = bm.faces.new(vs)
        f.material_index = 0
        f.smooth = True
        for l in f.loops:
            co = l.vert.co
            l[uvl].uv = (co.y / 2.0, K.trim_v(band, 0.5 + 0.5 * math.atan2(co.z - 0.15, co.x) / math.pi))
        return f
    for k in range(3):
        for i in range(n):
            face([rings_o[k][i], rings_o[k + 1][i], rings_o[k + 1][i + 1], rings_o[k][i + 1]][::-1], 'bark', True)
            face([rings_i[k][i], rings_i[k + 1][i], rings_i[k + 1][i + 1], rings_i[k][i + 1]], 'pole', True)
        for i in (0, n):
            face([rings_o[k][i], rings_o[k + 1][i], rings_i[k + 1][i], rings_i[k][i]][::(1 if i == 0 else -1)], 'pole', True)
    end = rings_o[3] + rings_i[3][::-1]
    f = bm.faces.new(end[::-1])
    f.material_index = 0
    for l in f.loops:
        l[uvl].uv = K.end_tile_uv(5, l.vert.co.x / R, (l.vert.co.z - 0.15) / R)
    ob = K.new_object(name, bm, ['M_Timber'])
    K.paint(ob, lambda co, nn, m, p: (0.65 + 0.35 * K.smoothstep(0.3, -0.2, co.y),) * 3, mode='set')
    return ob


def roof_hatch(name, lod, seed):
    """A roof hatch: a square opening with a raised mud curb, a timber frame, and a plank lid lying beside it.
    Pivot: centre of the opening on the roof surface (y = 0)."""
    B = Builder()
    a = 0.36                                       # half opening
    w = 0.16                                       # curb width
    h = 0.13
    # the curb: a closed square ring profile swept around (four mitred arms)
    prof = Profile((0.0, 0.0)).line(0.0, h - 0.05).arc(-0.05, h - 0.05, 0.05, math.pi / 2).line(-(w - 0.05), h) \
        .arc(-(w - 0.05), h - 0.05, 0.05, math.pi).line(-w, -0.25)
    wear = Wear(seed, 2 * (a + w), h, base=False, density=0.0, lod=lod)
    wear.line((-(a + w), -(a + w), h), ((a + w), -(a + w), h), 0.05, 1.0)
    rot = [lambda v: v, lambda v: Vector((-v.y, v.x, v.z)), lambda v: Vector((-v.x, -v.y, v.z)), lambda v: Vector((v.y, -v.x, v.z))]
    for k in range(4):
        L = a + w
        xf = (lambda v, k=k, L=L: rot[k](Vector((v.x, v.y - L, v.z))))
        sweep(B, ('h', k), prof, -L, L, wear, {0: 0.04, 1: 0.1, 2: 0.3}[lod], miter0=True, miter1=True, xform=xf, p=0.015,
              mats=(0, 1))
    bm = B.bm
    uvl = B.uv
    # void below
    fill_cap(bm, uvl, [Vector((-a, a, -0.3)), Vector((a, a, -0.3)), Vector((a, -a, -0.3)), Vector((-a, -a, -0.3))][::-1], 0)
    # timber frame on the curb, and a plank lid lying beside the hatch
    L = a + 0.05
    for k, (lo, hi, al) in enumerate((((-L, -L - 0.08, h), (L, -L, h + 0.07), 'x'), ((-L, L, h), (L, L + 0.08, h + 0.07), 'x'),
                                     ((-L - 0.08, -L, h + 0.004), (-L, L, h + 0.074), 'y'), ((L, -L, h + 0.004), (L + 0.08, L, h + 0.074), 'y'))):
        beam_box(bm, uvl, lo, hi, band='plankA', seed=seed + k, along=al, bevel=0.01, jitter=0.0, end_tile=4 + k % 4)
    r = K.rng(seed)
    x0 = a + w + 0.1
    for k in range(5):
        beam_box(bm, uvl, (x0 + k * 0.17, -0.42, 0.0), (x0 + k * 0.17 + 0.16, 0.42, 0.04), band='plankB', seed=seed + 20 + k,
                 along='y', bevel=0.006, jitter=0.0, u0=r.random(), end_tile=5)
    for z in (-0.25, 0.25):
        beam_box(bm, uvl, (x0 - 0.01, z - 0.05, 0.04), (x0 + 5 * 0.17, z + 0.05, 0.075), band='plankA', seed=seed + 40,
                 along='x', bevel=0.006, jitter=0.0, end_tile=4)
    ob = K.new_object(name, bm, ['M_MudPlaster', 'M_MudBrick', 'M_Timber'])
    me = ob.data
    K.paint(ob, lambda co, nn, m, p: (0.92,) * 3, mode='set')
    col = me.color_attributes['Col']
    for pl in me.polygons:
        if pl.center.z < -0.25:
            for li in pl.loop_indices:
                col.data[li].color = (0.04, 0.035, 0.03, 1)
    return finalize_lod(ob, lod, {0: 0.3, 1: 0.6, 2: 1.0}[lod])


# ---------------------------------------------------------------- registry

def register(piece, T_WALL, H):
    PAR = ('x 0..W along the run; y 0 on the roof surface; exterior face z = 0, 0.26 thick toward -z; exterior +Z. '
           'Sits on the roof slab with its face flush with the slab\'s fascia')
    for nm, W, sd in (('parapet_1m', 1.0, 51), ('parapet_2m', 2.0, 52), ('parapet_2m_b', 2.0, 57)):
        piece(nm, 'parapet', {'x': W, 'y': PARAPET_H, 'z': PARAPET_T, 'stretch': 'x 0.85-1.15, y 0.7-1.3'}, PAR,
              'roof parapet, rounded eroded top, worn plaster; closed ends so it can stop at a ladder or stair head',
              view=[-0.8, -1.4, 0.8], bake_ground=False)(lambda name, lod, W=W, sd=sd: parapet(name, lod, W, sd))
    piece('parapet_corner', 'parapet', {'x': PARAPET_T, 'y': PARAPET_H, 'z': PARAPET_T},
          'the corner square x 0..0.26, z -0.26..0; exterior faces +Z and -X (as corner_out)', 'mitred parapet corner',
          view=[-1.0, -1.0, 0.8], bake_ground=False)(lambda name, lod: parapet_corner(name, lod, 53))
    piece('parapet_stepped_2m', 'parapet', {'x': 2.0, 'y': 1.02, 'z': 0.3, 'stretch': 'x 0.9-1.1'},
          PAR.replace('0.26 thick', '0.30 thick'), 'low parapet with two stepped merlons (palace, temple, gate tops)',
          view=[-0.8, -1.4, 0.7], bake_ground=False)(lambda name, lod: parapet_stepped(name, lod, 2.0, 54))
    RF = ('y 0 at the wall top (the slab\'s underside); the slab top is y = 0.40; the wall\'s exterior face is z = 0, '
          'the slab overhangs to z = +0.10')
    piece('roof_edge_2m', 'roof', {'x': 2.0, 'y': 0.4, 'z': 0.6, 'stretch': 'x 0.8-1.2'}, RF + '; x 0..2 along the '
          'edge; its top strip reaches back to z = -0.5', 'roof slab edge: rounded mud lip worn to rough mud, the reed '
          'and brushwood layer under it, a reed-mat soffit', view=[-0.6, -1.5, -0.25], bake_ground=False, no_ground=True)(
        lambda name, lod: roof_edge(name, lod, 2.0, 61))
    piece('roof_edge_corner', 'roof', {'x': 0.6, 'y': 0.4, 'z': 0.6}, RF + '; the house corner at the origin, the '
          'piece covers x -0.10..0.50, z -0.50..0.10 (mitred); edges start at x = 0.5 as walls do',
          'roof slab corner', view=[-1.0, -1.0, -0.2], bake_ground=False, no_ground=True)(lambda name, lod: roof_edge_corner(name, lod, 62))
    piece('roof_field_2m', 'roof', {'x': 2.0, 'z': 2.0, 'stretch': 'x, z 0.5-1.5'}, RF + '; x 0..2, z 0..-2: fill the '
          'slab between the edge strips', 'roof top: rolled mud with straw', view=[-0.6, -1.0, 1.2], bake_ground=False)(
        lambda name, lod: roof_field(name, lod, 2.0, 63))
    piece('beam_ends_2m', 'roof', {'x': 2.0, 'y': 0.17, 'z': 0.46, 'stretch': 'x 0.75-1.25'}, 'y 0 at the wall top '
          '(the logs rest on it); x 0..2 along the wall; logs project 0.28-0.46 beyond the exterior face (z = 0)',
          'four poplar roof beams projecting under the slab edge', view=[-0.7, -1.3, -0.25], bake_ground=False, no_ground=True)(
        lambda name, lod: beam_ends(name, lod, 2.0, 64))
    piece('drain_spout', 'roof', {'x': 0.18, 'y': 0.2, 'z': 0.48}, 'y 0 on the roof surface; through the parapet foot, '
          'its mouth 0.48 m out from the parapet\'s exterior face (z = 0)', 'carved half-log rain spout',
          view=[-1.0, -1.2, 0.4], bake_ground=False)(lambda name, lod: drain_spout(name, lod, 65))
    piece('roof_hatch', 'roof', {'x': 1.0, 'z': 1.0}, 'centre of the 0.72 m opening at the origin, y 0 on the roof '
          'surface; its plank lid lies on the +x side', 'roof hatch: mud curb, timber frame, plank lid',
          view=[-0.5, -1.0, 1.1], bake_ground=False)(lambda name, lod: roof_hatch(name, lod, 66))
    register_more(piece, T_WALL, H)


def register_more(piece, T_WALL, H):
    import archpieces2
    archpieces2.register(piece, T_WALL, H)
