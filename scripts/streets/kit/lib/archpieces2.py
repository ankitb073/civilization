"""Architecture pieces, part 2: external stairs, ladders, courtyard walls, the city wall, the gate (towers, arch,
leaves) and the temple's columned porch. Blender frames: exterior faces -Y (glTF +Z)."""
import math
import bmesh
from mathutils import Vector
import kitlib as K
from surface import Builder, layered, axis, MAT_PLASTER, MAT_BRICK
from mudwall import BASE_H, P_THICK, grime, bulge
from archparts import (build_wall, finalize_lod, beam_box, log_cyl, MAT_TIMBER, STEP, Wear, relief3, add_gullies)
from profiles import Profile, sweep, sweep_P
from archpieces import (fill_cap, profile_points, finish_obj, cap_profile, end_caps, corner_of, LEFT_ARM, door_leaf,
                        parapet_stepped, ROOF_T, OVER)

MUD = ['M_MudPlaster', 'M_MudBrick', 'M_Timber', 'M_RoofMud']


# ---------------------------------------------------------------- external stair

def stair_profile(n, rise, going, rn=0.035):
    """Saw-tooth of n steps in the (pz, py) plane with x = -pz (the flight rises toward +x)."""
    pr = Profile((0.0, 0.0))
    for k in range(n):
        x0 = k * going
        top = (k + 1) * rise
        pr.line(-x0, top - rn)
        pr.arc(-x0 - rn, top - rn, rn, math.pi / 2)
        pr.line(-(k + 1) * going, top)
    return pr


def stair_flight(name, lod, seed, n=12, rise=0.25, going=0.28, width=1.0):
    """Blender: x along the run (foot at x = 0), the flight against the wall at y = 0, out to y = -width."""
    H = n * rise
    run = n * going
    prof = stair_profile(n, rise, going)
    step = {0: 0.04, 1: 0.1, 2: 0.3}[lod]
    wear = Wear(seed, run, H, base=True, base_h=0.15, density=0.0, lod=lod, band_amp=0.6)
    for k in range(n):
        x0, top = k * going, (k + 1) * rise
        wear.line((x0 - 0.01, -0.05, top), (x0 - 0.01, -width + 0.05, top), 0.06, 1.0, 0.0)
    B = Builder()

    def P(s, t, d):
        z, y, nz, ny = prof.at(s)
        return Vector((-(z - nz * d), -t, y - ny * d))
    s_ax = axis(0.0, prof.length, step, prof.breaks)
    t_ax = axis(0.0, width, step, [])

    def F(s, t):
        q = P(s, t, 0.0)
        # treads wear in the middle where feet go
        z, y, nz, ny = prof.at(s)
        mid = 0.0
        if ny > 0.7:
            mid = 0.035 - abs(q.y + width * 0.5) * 0.12 + 0.025 * K.noise3((q.x * 4, q.y * 4, 1.0), seed + 3)
        return max(wear(q), mid)
    layered(B, 'st', P, s_ax, t_ax, F, p=0.018, uvf=lambda s, t, layer: (P(s, t, 0).x / 2.0, (P(s, t, 0).z + t) / 2.0))
    # the outer side face under the steps (Blender y = -width, facing -Y): a grid whose lines fall on every riser and
    # tread, cells above the saw-tooth left out
    wear_s = Wear(seed + 5, run, H, base=True, density=0.8, t_range=(0.6, H - 0.5), lod=lod)

    def Ps(s, t, d):
        return Vector((s, -width + d, t))
    xs = axis(0.0, run, step * 1.5, [k * going for k in range(n + 1)])
    zs = axis(0.0, H, step * 1.5, [k * rise for k in range(n + 1)])
    layered(B, 'sd', Ps, xs, zs, lambda s, t: wear_s(Ps(s, t, 0)), p=P_THICK,
            skip=lambda s, t: t > (math.floor(s / going + 1e-6) + 1) * rise,
            uvf=lambda s, t, layer: (s / 2.0, t / 2.0))
    bm = B.bm
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.004)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-4)
    # the top end, against the landing
    fill_cap(bm, B.uv, [Vector((run, 0, 0)), Vector((run, -width, 0)), Vector((run, -width, H)), Vector((run, 0, H))], 0,
             axes=(1, 2))
    ob = K.new_object(name, bm, ['M_MudPlaster', 'M_MudBrick'])
    K.paint(ob, grime(H, seed, 0.4), mode='set')
    return finalize_lod(ob, lod, {0: 0.25, 1: 0.45, 2: 0.5}[lod])


def stair_landing(name, lod, seed, H=3.0, L=1.0, width=1.0, rc=0.06):
    """A solid landing block: Blender x 0..L (after the flight), y 0..-width; faces: side (-Y), end (+X), top."""
    step = {0: 0.05, 1: 0.15, 2: 0.6}[lod]
    pr = Profile((0.0, -width)).line(L - rc, -width).arc(L - rc, -width + rc, rc, 0.0).line(L, 0.0)
    # plan profile in (x, y): normals = clockwise turn of the tangent -> CCW traversal keeps them outward

    def P(s, t, d):
        x, y, nx, ny = pr.at(s)
        return Vector((x - nx * d, y - ny * d, t))
    # check orientation: on the first segment (going +x at y = -width) the normal must point -y
    wear = Wear(seed, pr.length, H, base=True, density=0.8, lod=lod)
    s_mid = (L - rc) + math.pi / 4 * rc
    wear.line((s_mid, 0, 0), (s_mid, 0, H), 0.08, 1.0, 1.0)
    B = Builder()
    s_ax = axis(0.0, pr.length, step, pr.breaks)
    t_ax = axis(0.0, H, step, [])
    layered(B, 'ld', P, s_ax, t_ax, lambda s, t: wear((s, 0.0, t)), p=P_THICK,
            uvf=lambda s, t, layer: (s / 2.0, t / 2.0))
    bm = B.bm
    # top
    n = {0: 6, 1: 2, 2: 1}[lod]
    vs = {}
    for i in range(n + 1):
        for j in range(n + 1):
            vs[i, j] = bm.verts.new((L * i / n, -width * j / n, H))
    for i in range(n):
        for j in range(n):
            f = bm.faces.new([vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1]][::-1])
            f.material_index = 0
            f.smooth = True
            for l in f.loops:
                l[B.uv].uv = (l.vert.co.x / 2.0, l.vert.co.y / 2.0)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.003)
    ob = K.new_object(name, bm, ['M_MudPlaster', 'M_MudBrick'])
    K.paint(ob, grime(H, seed, 0.45), mode='set')
    return finalize_lod(ob, lod, {0: 0.25, 1: 0.6, 2: 1.0}[lod])


# ---------------------------------------------------------------- ladder

def ladder(name, lod, L, seed, w=0.46):
    """Two poles and lashed rungs, standing vertical along +z from the origin (lean it as needed)."""
    r = K.rng(seed)
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    sides = {0: 8, 1: 6, 2: 4}[lod]
    for sx in (-1, 1):
        x = sx * w / 2
        log_cyl(bm, uvl, (x + r.uniform(-0.01, 0.01), 0, 0), (x * 0.92 + r.uniform(-0.01, 0.01), 0, L), 0.036, seed=seed + sx,
                band='pole', sides=sides, end_tile=1 + (sx > 0), taper=0.15, wobble=0.008 if lod == 0 else 0.0, seg_len=0.6)
    nr = int((L - 0.2) / 0.32)
    for k in range(nr):
        z = 0.3 + k * 0.32 + r.uniform(-0.015, 0.015)
        half = w / 2 * (1 - 0.08 * z / L) + 0.05
        log_cyl(bm, uvl, (-half, 0.0, z + r.uniform(-0.01, 0.01)), (half, 0.0, z + r.uniform(-0.01, 0.01)), 0.021,
                seed=seed + 10 + k, band='pole', sides=max(4, sides - 2), end_tile=6, wobble=0.0, seg_len=1.0)
        if lod == 0:
            for sx in (-1, 1):
                x = sx * w / 2 * (1 - 0.08 * z / L)
                # cord lashing: a short fat wrap round the pole at the rung
                log_cyl(bm, uvl, (x, 0, z - 0.03), (x, 0, z + 0.03), 0.045, seed=seed + 50 + k, band='bark', sides=6,
                        end_tile=2, wobble=0.0, seg_len=1.0)
    ob = K.new_object(name, bm, ['M_Timber'])
    K.paint(ob, lambda co, n, m, p: (0.8 + 0.2 * K.smoothstep(0.0, 0.8, co.z),) * 3, mode='set')
    return ob


# ---------------------------------------------------------------- courtyard walls

CW_H, CW_T = 2.0, 0.4


def _cw_wear(seed, W, lod, end_free=False):
    front = Wear(seed, W, CW_H, base=True, density=1.2, t_range=(0.6, CW_H - 0.35), lod=lod)
    back = Wear(seed + 31, W, CW_H, base=True, density=1.0, t_range=(0.6, CW_H - 0.35), lod=lod)
    for w in (front, back):
        w.line((0, 0, CW_H + 0.02), (W, 0, CW_H + 0.02), 0.05, 1.0, 0.0)
        if end_free:
            w.line((0, 0, 0), (0, 0, CW_H), 0.12, 1.0, 1.0)

    def F(p):
        k = K.smoothstep(-0.1, 0.1, p.y)
        return front(p) * (1 - k) + back(Vector((W - p.x, -p.y, p.z))) * k
    return F


def cwall(name, lod, W, seed, end_free=False):
    """A courtyard wall: 2.0 m, 0.4 m thick, centred on its line (glTF z -0.2..0.2), a rounded cap that sags a little,
    both faces worn. end_free makes the x = 0 end a weathered free end."""
    prof = cap_profile(CW_H, CW_T, r=0.12)
    shift = lambda v: Vector((v.x, v.y - CW_T / 2, v.z))
    F = _cw_wear(seed, W, lod, end_free)
    B = Builder()
    rel = relief3(seed) if lod < 2 else None
    sweep(B, 'cw', prof, 0.0, W, F, STEP[lod], xform=shift, p=0.02, relief=rel)
    P = sweep_P(prof, 0.0, W, xform=shift)
    for t in (0.0, 1.0):
        fill_cap(B.bm, B.uv, profile_points(prof, P, t, {0: 24, 1: 10, 2: 5}[lod]), 1 if not (end_free and t == 0) else 0,
                 axes=(1, 2), flip=(t == 1.0))
    sag_ph = K.rng(seed).uniform(0, 9)

    def deform(co):
        x = co.x
        w = math.sin(math.pi * min(1.0, max(0.0, x / W))) if not end_free else min(1.0, max(0.0, 1 - x / W)) ** 2
        sag = (0.035 if not end_free else 0.12) * w * (0.6 + 0.4 * K.noise3((x, 0.0, sag_ph), seed))
        co.z -= sag * (co.z / CW_H) ** 2
        b = 0.012 * math.sin(math.pi * min(1.0, max(0.0, x / W))) * math.sin(math.pi * min(1.0, co.z / CW_H))
        co.y += b
    return finish_obj(name, B.bm, ['M_MudPlaster', 'M_MudBrick'], CW_H, seed, damp=0.5, lod=lod, deform=deform)


def cwall_corner(name, lod, seed):
    prof = cap_profile(CW_H, CW_T, r=0.12)
    wear = Wear(seed, CW_T, CW_H, base=True, density=0.0, lod=lod)
    wear.line((0, 0, 0), (0, 0, CW_H), 0.1, 1.0, 1.0)
    B = corner_of(prof, CW_T, wear, lod, 'cc')
    return finish_obj(name, B.bm, ['M_MudPlaster', 'M_MudBrick'], CW_H, seed, damp=0.5, lod=lod)


# ---------------------------------------------------------------- city wall and gate

CITY_H, CITY_T = 6.8, 3.36


def wall_top(B, x0, x1, seed, lod, H=CITY_H, T=CITY_T, merlons=True, kerb=True, front_y=None):
    """The wall-walk: rolled mud from the parapet to the kerb, a parapet with stepped merlons on the outer edge and a
    low kerb on the inner edge. Blender: outer face at y = -T/2."""
    fy = -T / 2 if front_y is None else front_y
    bm, uvl = B.bm, B.uv
    ph, pt = 0.55, 0.45
    W = x1 - x0
    pr = cap_profile(ph, pt, r=0.07)
    xf = lambda v: Vector((v.x, v.y + fy, v.z + H))
    wear = Wear(seed, W, ph, base=True, base_h=0.06, density=1.0, t_range=(0.1, ph - 0.1), lod=lod, band_amp=0.4,
                patch_scale=0.5)
    sweep(B, ('par', seed), pr, x0, x1, lambda q: wear(Vector((q.x - x0, q.y, q.z - H))), STEP[lod] * 1.5, xform=xf,
          p=0.015)
    P = sweep_P(pr, x0, x1, xform=xf)
    for t in (0.0, 1.0):
        fill_cap(bm, uvl, profile_points(pr, P, t, 10), 1, axes=(1, 2), flip=(t == 1.0))
    if merlons:
        n = max(1, int(round(W / 2.0)))
        for k in range(n):
            c = x0 + (k + 0.5) * W / n
            for tier, (hw, h0, h1, inset) in enumerate(((0.45, ph, ph + 0.55, 0.0), (0.24, ph + 0.55, ph + 1.0, 0.04))):
                prm = cap_profile(h1 - h0, pt - 2 * inset, r=0.05)
                xfm = (lambda v, h0=h0, inset=inset: Vector((v.x, v.y + fy + inset, v.z + H + h0)))
                w2 = Wear(seed + 7 * k + tier, 2 * hw, h1 - h0, base=False, density=0.0, lod=lod)
                w2.line((c - hw, 0, H + h1), (c + hw, 0, H + h1), 0.04, 1.0)
                sweep(B, ('mer', seed, k, tier), prm, c - hw, c + hw, w2, {0: 0.06, 1: 0.14, 2: 0.5}[lod], xform=xfm,
                      p=0.015)
                Pm = sweep_P(prm, c - hw, c + hw, xform=xfm)
                for t in (0.0, 1.0):
                    fill_cap(bm, uvl, profile_points(prm, Pm, t, {0: 10, 1: 5, 2: 3}[lod]), 0, axes=(1, 2), flip=(t == 1.0))
    yk = T / 2
    if kerb:
        prk = cap_profile(0.25, 0.3, r=0.06)
        # the kerb's exterior faces the walk (-Y side of the kerb is toward the town? the inner edge: face +Y outward)
        xfk = lambda v: Vector((x1 - (v.x - x0), -v.y + yk, v.z + H))
        sweep(B, ('kerb', seed), prk, x0, x1, lambda q: -0.05, STEP[lod] * 2, xform=xfk, p=0.015, only_plaster=True)
    # the walk surface
    y0, y1 = fy + pt, yk - (0.3 if kerb else 0.0)
    nx, ny = max(1, int(W / 1.0)), max(1, int((y1 - y0) / 1.0))
    vs = {}
    for i in range(nx + 1):
        for j in range(ny + 1):
            x = x0 + W * i / nx
            y = y0 + (y1 - y0) * j / ny
            dz = 0.0 if i in (0, nx) or j in (0, ny) else 0.02 * K.noise3((x, y, 1.0), seed)
            vs[i, j] = bm.verts.new((x, y, H + dz))
    for i in range(nx):
        for j in range(ny):
            f = bm.faces.new([vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1]])
            f.material_index = 3
            f.smooth = True
            for l in f.loops:
                l[uvl].uv = (l.vert.co.x / 2.0, l.vert.co.y / 2.0)


def city_wall(name, lod, W, seed):
    """A section of the city wall: W long, 6.8 m tall, 3.36 m thick, centred on its line; exterior (outside the city)
    faces -Y. Both faces worn and gullied; the walk on top."""
    step = {0: 0.08, 1: 0.2, 2: 0.8}[lod]
    B = build_wall(name, W, CITY_H, CITY_T, seed, lod, back=True, two_sided=True, density=0.9, step=step,
                   base_h=0.55, band_amp=1.6, patch_scale=1.8, gullies=3 if lod < 2 else 0, finish=False,
                   t_range=(1.4, CITY_H - 0.8))
    bm = B.bm
    for v in bm.verts:
        v.co.y -= CITY_T / 2
    wall_top(B, 0.0, W, seed, lod)
    # end caps (hidden against towers or the next section)
    for x in (0.0, W):
        fill_cap(bm, B.uv, [Vector((x, -CITY_T / 2, 0)), Vector((x, CITY_T / 2, 0)), Vector((x, CITY_T / 2, CITY_H)),
                            Vector((x, -CITY_T / 2, CITY_H))], 1, axes=(1, 2), flip=(x == 0.0))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    ob = K.new_object(name, bm, MUD)
    bf = bulge(W, CITY_H, seed, 0.05)
    for v in ob.data.vertices:
        if v.co.z < CITY_H - 0.01:
            v.co.y += bf(v.co.x, v.co.z) * (1 if v.co.y < 0 else -1)
    ob.data.update()
    K.paint(ob, grime(CITY_H, seed, 0.9), mode='set')
    return finalize_lod(ob, lod, {0: 0.22, 1: 0.55, 2: 1.0}[lod])


def outline(points, r):
    """A closed plan outline (CCW (x, y) points) as a Profile: convex corners rounded with radius r."""
    n = len(points)
    P = [Vector((p[0], p[1])) for p in points]
    def d(i):
        a, b = P[i % n], P[(i + 1) % n]
        return (b - a).normalized()
    # start in the middle of the first edge
    s0 = (P[0] + P[1]) / 2
    pr = Profile((s0.x, s0.y))
    for k in range(1, n + 1):
        c = P[k % n]
        d0, d1 = d(k - 1), d(k)
        convex = d0.x * d1.y - d0.y * d1.x > 0
        if convex and r > 0:
            a = c - d0 * r
            pr.line(a.x, a.y)
            cen = a + Vector((-d0.y, d0.x)) * r
            b = c + d1 * r
            pr.arc(cen.x, cen.y, r, math.atan2(b.y - cen.y, b.x - cen.x) if True else 0)
            # make the angle continuous (CCW, increasing)
            seg = pr.segs[-1]
            a0, a1 = seg[3], seg[4]
            while a1 < a0:
                a1 += 2 * math.pi
            L = (a1 - a0) * r
            pr.length -= seg[6]
            pr.breaks.pop()
            pr.segs[-1] = ('A', seg[1], r, a0, a1, seg[5], L)
            pr.length += L
            pr.breaks.append(pr.length)
        else:
            pr.line(c.x, c.y)
    pr.line(s0.x, s0.y)
    return pr


def tower_outline(S, pil=0.9, proj=0.3, niche=1.6, nd=0.15):
    """CCW plan outline of a buttressed tower, S square (centred), corner buttresses projecting `proj`, a central
    niche on each face."""
    h = S / 2
    pts = []
    # one face (the -y face, walked +x), then rotate for the others
    face = [(-h - proj, -h - proj), (-h + pil, -h - proj), (-h + pil, -h), (-niche / 2, -h), (-niche / 2, -h + nd),
            (niche / 2, -h + nd), (niche / 2, -h), (h - pil, -h), (h - pil, -h - proj)]
    for k in range(4):
        c, s_ = math.cos(k * math.pi / 2), math.sin(k * math.pi / 2)
        for x, y in face:
            pts.append((x * c - y * s_, x * s_ + y * c))
    return pts


def gate_tower(name, lod, seed, S=6.4, H=10.4, walk=CITY_H):
    """A gate (or wall) tower: buttressed mud-brick body, corner buttresses and a niche on every face, slit windows,
    doorways onto the wall-walk on its +-X faces, a corbelled slab on beam ends, stepped merlons. Pivot: centre of its
    footprint; exterior (outside the city) faces -Y."""
    step = {0: 0.13, 1: 0.3, 2: 1.0}[lod]
    Hb = H - 0.9                                   # body top; slab and parapet above
    pr = outline(tower_outline(S), 0.07)
    door_w, door_h = 1.1, 2.1
    # doorways onto the walk: on the +x and -x faces, centred on y = 0
    def plan(s):
        x, y, nx, ny = pr.at(s)
        return x, y, nx, ny
    # find s ranges of the doorways and slits (by sampling the outline)
    N = 4000
    ss = [pr.length * k / N for k in range(N + 1)]
    def s_range(pred):
        inside = [s for s in ss if pred(*plan(s))]
        return (min(inside), max(inside)) if inside else None
    openings = []
    for sx in (1, -1):
        rng_ = s_range(lambda x, y, nx, ny, sx=sx: abs(nx - sx) < 0.1 and abs(y) < door_w / 2 and abs(x - sx * (S / 2 - 0.15)) < 0.05)
        if rng_:
            openings.append((rng_[0], rng_[1], walk, walk + door_h, 'door'))
    slits = []
    for face, u, hz in (('-y', 0.0, 3.2), ('-y', 0.0, 6.0), ('-y', 1.6, 8.6), ('-y', -1.6, 8.6), ('+y', 0.0, 4.5),
                        ('+x', 1.6, 3.4), ('-x', -1.6, 3.4)):
        def pred(x, y, nx, ny, face=face, u=u):
            if face == '-y':
                return ny < -0.9 and abs(x - u) < 0.065
            if face == '+y':
                return ny > 0.9 and abs(x - u) < 0.065
            if face == '+x':
                return nx > 0.9 and abs(y - u) < 0.065
            return nx < -0.9 and abs(y - u) < 0.065
        rr = s_range(pred)
        if rr:
            slits.append((rr[0], rr[1], hz, hz + 0.75))
    holes = [(a, b, c, d) for a, b, c, d, _ in openings] + slits
    wear = Wear(seed, pr.length, Hb, base=True, base_h=0.6, band_amp=1.8, density=0.7, patch_scale=1.8, lod=lod,
                t_range=(1.5, Hb - 1.0))
    add_gullies(wear, pr.length, Hb, 8 if lod < 2 else 0, seed)
    for a, b, c, d in holes:
        wear.keep((a - 0.15, -1, c - 0.15), (b + 0.15, 1, d + 0.15))

    def P(s, t, d):
        x, y, nx, ny = pr.at(s)
        return Vector((x - nx * d, y - ny * d, t))
    B = Builder()
    void_l = B.bm.faces.layers.int.new('void')
    s_breaks = list(pr.breaks) + [v for h_ in holes for v in h_[:2]]
    t_breaks = [v for h_ in holes for v in h_[2:]]
    s_ax = axis(0.0, pr.length, step, s_breaks)
    t_ax = axis(0.0, Hb + 0.1, step, t_breaks)
    skip = lambda s, t: any(a < s < b and c < t < d for a, b, c, d in holes)
    rel = relief3(seed, 0.004) if lod < 2 else None
    layered(B, 'tw', P, s_ax, t_ax, lambda s, t: wear((s, 0.0, t)), p=P_THICK, skip=skip,
            relief=(lambda s, t: rel(P(s, t, 0))) if rel else None, uvf=lambda s, t, layer: (s / 2.0, t / 2.0))
    bm, uvl = B.bm, B.uv
    # reveals and dark interiors behind every hole (flat, brick), timber lintels over the doorways
    for a, b, c, d in holes:
        depth = 0.7 if d - c > 1.0 else 0.45
        pa, pb = P(a, c, 0), P(b, c, 0)
        x0_, y0_, nx, ny = pr.at((a + b) / 2)
        inward = Vector((-nx, -ny, 0)) * depth
        corners = [P(a, c, 0), P(b, c, 0), P(b, d, 0), P(a, d, 0)]
        for i in range(4):
            q0, q1 = corners[i], corners[(i + 1) % 4]
            fill_cap(bm, uvl, [q1, q0, q0 + inward, q1 + inward], 1, axes=(0, 2))
        f = fill_cap(bm, uvl, [c_ + inward for c_ in corners][::-1], 0, axes=(0, 2))
        if f:
            f[void_l] = 1
        if d - c > 1.0:
            mid = (P(a, d, 0) + P(b, d, 0)) / 2
            w = (b - a) / 2 + 0.3
            if abs(nx) > 0.5:
                x0_, x1_ = (mid.x - 0.6, mid.x + 0.02) if nx > 0 else (mid.x - 0.02, mid.x + 0.6)
                beam_box(bm, uvl, (x0_, mid.y - w, d), (x1_, mid.y + w, d + 0.2), band='plankA', seed=seed + int(a),
                         along='y', bevel=0.015, jitter=0.0, ends=(False, False))
            else:
                y0b, y1b = (mid.y - 0.6, mid.y + 0.02) if ny > 0 else (mid.y - 0.02, mid.y + 0.6)
                beam_box(bm, uvl, (mid.x - w, y0b, d), (mid.x + w, y1b, d + 0.2), band='plankA', seed=seed + int(a),
                         along='x', bevel=0.015, jitter=0.0, ends=(False, False))
    # corbelled slab: beam ends round the top, a mud slab, a stepped parapet on every side, the roof
    So = S / 2 + 0.3 + OVER                       # half-size of the slab (over the buttresses)
    n_b = int(S / 0.55)
    for side in range(4):
        c, s_ = math.cos(side * math.pi / 2), math.sin(side * math.pi / 2)
        rot = lambda v, c=c, s_=s_: Vector((v.x * c - v.y * s_, v.x * s_ + v.y * c, v.z))
        if lod < 2:
            for k in range(n_b):
                x = -S / 2 + 0.3 + (k + 0.5) * (S - 0.6) / n_b
                r_ = K.rng(seed + side * 100 + k)
                a3 = rot(Vector((x, -S / 2 + 0.6, Hb + 0.09)))
                b3 = rot(Vector((x + r_.uniform(-0.03, 0.03), -S / 2 - 0.3 - r_.uniform(0.25, 0.45), Hb + 0.09 + r_.uniform(-0.02, 0.0))))
                log_cyl(bm, uvl, a3, b3, r_.uniform(0.07, 0.09), seed=seed + side * 100 + k, band='pole', sides=8 if lod == 0 else 5,
                        end_tile=k % 4, ends=(False, True), seg_len=0.6)
        # slab edge (the roof-edge profile, scaled up a little) mitred at both ends, and the stepped parapet on it
        from archpieces import roof_profile
        rp = roof_profile()
        xf = lambda v, rot=rot: rot(Vector((v.x, v.y - So + OVER, v.z + Hb)))
        we = Wear(seed + side, 2 * So, ROOF_T, base=False, density=1.5, t_range=(0.1, 0.35), lod=lod, patch_scale=0.5)
        sweep(B, ('slab', side), rp, -So + OVER, So - OVER, lambda q, we=we: we(q), {0: 0.08, 1: 0.2, 2: 0.6}[lod],
              miter0=True, miter1=True, xform=xf, p=0.015, mats=(0, 3))
        prp = cap_profile(0.5, 0.35, r=0.06)
        xfp = lambda v, rot=rot: rot(Vector((v.x, v.y - So + 0.05, v.z + Hb + ROOF_T)))
        wp = Wear(seed + 9 + side, 2 * So, 0.5, base=True, base_h=0.05, density=1.0, t_range=(0.1, 0.4), lod=lod,
                  band_amp=0.4, patch_scale=0.5)
        sweep(B, ('tp', side), prp, -So + 0.05, So - 0.05, lambda q, wp=wp: wp(q), {0: 0.07, 1: 0.18, 2: 0.6}[lod],
              miter0=True, miter1=True, xform=xfp, p=0.015)
        nm = 3
        for k in range(nm):
            cx = -So + 0.05 + (k + 0.5) * (2 * So - 0.1) / nm
            for tier, (hw, h0, h1, inset) in enumerate(((0.45, 0.5, 1.05, 0.0), (0.24, 1.05, 1.5, 0.04))):
                prm = cap_profile(h1 - h0, 0.35 - 2 * inset, r=0.05)
                xfm = (lambda v, rot=rot, h0=h0, inset=inset: rot(Vector((v.x, v.y - So + 0.05 + inset, v.z + Hb + ROOF_T + h0))))
                w2 = Wear(seed + 7 * k + tier + side * 31, 2 * hw, h1 - h0, base=False, density=0.0, lod=lod)
                sweep(B, ('mer', side, k, tier), prm, cx - hw, cx + hw, w2, {0: 0.06, 1: 0.15, 2: 0.5}[lod], xform=xfm,
                      p=0.015)
                Pm = sweep_P(prm, cx - hw, cx + hw, xform=xfm)
                for t in (0.0, 1.0):
                    fill_cap(bm, uvl, profile_points(prm, Pm, t, {0: 10, 1: 5, 2: 3}[lod]), 0, axes=(0, 2), flip=(t == 1.0))
    # the roof
    ri = So - OVER - 0.5
    rt = Hb + ROOF_T
    fill_cap(bm, uvl, [Vector((-ri, -ri, rt)), Vector((ri, -ri, rt)), Vector((ri, ri, rt)), Vector((-ri, ri, rt))], 3)
    # underside of the slab over the buttresses
    zu = Hb + 0.085
    fill_cap(bm, uvl, [Vector((-So, -So, zu)), Vector((-So, So, zu)), Vector((So, So, zu)), Vector((So, -So, zu))], 0)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    ob = K.new_object(name, bm, MUD)
    K.paint(ob, grime(Hb, seed, 1.0), mode='set')
    me = ob.data
    col = me.color_attributes['Col']
    vl = me.attributes.get('void')
    if vl:
        for pl in me.polygons:
            if vl.data[pl.index].value:
                for li in pl.loop_indices:
                    col.data[li].color = (0.035, 0.03, 0.028, 1)
        me.attributes.remove(vl)
    return finalize_lod(ob, lod, {0: 0.22, 1: 0.45, 2: 0.4}[lod])


def gate_arch(name, lod, seed, W=5.6, span=3.6, spring=3.3):
    """The gate passage between two towers: a wall W long (stretch to the gap), 3.36 m thick, an arched passage
    `span` wide springing at `spring`; the walk and merlons on top. Pivot: x 0..W, centred on the wall line, exterior
    faces -Y. Hang gate_leaf pairs inside the arch."""
    step = {0: 0.08, 1: 0.2, 2: 0.7}[lod]
    T = CITY_T
    R = span / 2
    xc = W / 2
    xa, xb = xc - R, xc + R
    H = CITY_H
    B = Builder()
    wear_f = Wear(seed, W, H, base=True, base_h=0.5, band_amp=1.4, density=0.6, patch_scale=1.5, lod=lod,
                  t_range=(1.2, H - 0.8))
    add_gullies(wear_f, W, H, 2 if lod < 2 else 0, seed)
    wear_f.keep((xa - 0.5, -9, spring - 0.2), (xb + 0.5, 9, spring + R + 0.6))
    wear_f.line((xa, 0, 0), (xa, 0, spring), 0.12, 1.0, 1.0)
    wear_f.line((xb, 0, 0), (xb, 0, spring), 0.12, 1.0, 1.0)
    rel = relief3(seed, 0.004) if lod < 2 else None

    def arch_y(x):
        u = (x - xc) / R
        return spring + R * math.sqrt(max(0.0, 1 - u * u))
    nth = {0: 28, 1: 12, 2: 6}[lod]
    th_ax = [math.pi * k / nth for k in range(nth + 1)]
    xs_arch = sorted(xc + R * math.cos(t) for t in th_ax)
    xs_arch[0], xs_arch[-1] = xa, xb
    t_ax_p = axis(0.0, H, step, [spring])
    for face, y0 in (('f', -T / 2), ('b', T / 2)):
        sg = 1.0 if face == 'f' else -1.0
        Fw = (lambda p: wear_f(p)) if face == 'f' else (lambda p: wear_f(Vector((W - p.x, -p.y, p.z))))
        for k, (s0, s1) in enumerate(((0.0, xa), (xb, W))):
            Pp = lambda s, t, d, y0=y0, sg=sg: Vector((s, y0 + sg * d, t))
            layered(B, (face, 'pier', k), Pp, axis(s0, s1, step, []), t_ax_p, lambda s, t, Pp=Pp, Fw=Fw: Fw(Pp(s, t, 0)),
                    p=P_THICK, relief=(lambda s, t, y0=y0: rel(Vector((s, y0, t)))) if rel else None,
                    uvf=lambda s, t, l: (s / 2.0, t / 2.0))
        above = [t for t in t_ax_p if t >= spring - 1e-6]
        tt = [(t - spring) / (H - spring) for t in above]

        def Ps(s, t, d, y0=y0, sg=sg):
            y = arch_y(s) + t * (H - arch_y(s))
            return Vector((s, y0 + sg * d, y))
        layered(B, (face, 'sp'), Ps, xs_arch, tt, lambda s, t, Ps=Ps, Fw=Fw: Fw(Ps(s, t, 0)), p=P_THICK,
                relief=(lambda s, t, Ps=Ps: rel(Ps(s, t, 0))) if rel else None,
                uvf=lambda s, t, l, Ps=Ps: (s / 2.0, Ps(s, t, 0).z / 2.0))
    # the vault (intrados) and the jambs below the springing
    ys = axis(-T / 2, T / 2, step * 2, [])
    for side, xe in ((0, xa), (1, xb)):
        def Pj(s, t, d, xe=xe, side=side):
            return Vector((xe - d if side == 0 else xe + d, s, t))
        layered(B, ('jamb', side), Pj, ys, [t for t in t_ax_p if t <= spring + 1e-6], lambda s, t: -0.05, p=P_THICK, only_plaster=True,
                uvf=lambda s, t, l: (s / 2.0, t / 2.0))
    def Pv(s, t, d):
        # s across the thickness (y), t the angle from the +x springing round to the -x one
        x = xc + (R + d) * math.cos(t)
        z = spring + (R + d) * math.sin(t)
        return Vector((x, s, z))
    layered(B, 'vault', Pv, ys, th_ax, lambda s, t: -0.05, p=P_THICK, only_plaster=True,
            uvf=lambda s, t, l: (s / 2.0, t * R / 2.0))
    wall_top(B, 0.0, W, seed, lod)
    bm = B.bm
    for x in (0.0, W):
        fill_cap(bm, B.uv, [Vector((x, -T / 2, 0)), Vector((x, T / 2, 0)), Vector((x, T / 2, H)), Vector((x, -T / 2, H))], 1,
                 axes=(1, 2), flip=(x == 0.0))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.003)
    ob = K.new_object(name, bm, MUD)
    K.paint(ob, grime(H, seed, 0.9), mode='set')
    return finalize_lod(ob, lod, {0: 0.25, 1: 0.6, 2: 1.0}[lod])


# ---------------------------------------------------------------- temple porch

def porch_column(name, lod, seed, H=3.6, rad=0.17):
    """A timber column plastered with mud (worn back to the wood at the foot and in patches), on a plastered brick
    plinth, with a timber bolster capital. Pivot: centre of the plinth's foot; the bolster runs along x."""
    B = Builder()
    plinth_h, plinth_w = 0.32, 0.62
    cap_h = 0.22
    shaft0, shaft1 = plinth_h, H - cap_h
    circ = 2 * math.pi * rad
    step = {0: 0.04, 1: 0.1, 2: 0.3}[lod]
    wear = Wear(seed, circ, shaft1 - shaft0, base=True, base_h=0.25, band_amp=0.8, density=1.6, patch_scale=0.5, lod=lod,
                t_range=(0.4, shaft1 - shaft0 - 0.3))
    def P(s, t, d):
        a = s / rad
        rr = rad * (1 + 0.015 * K.noise3((math.cos(a), math.sin(a), t * 0.5), seed)) - d
        return Vector((rr * math.cos(a), rr * math.sin(a), shaft0 + t))
    s_ax = axis(0.0, circ, step, [])
    t_ax = axis(0.0, shaft1 - shaft0, step, [])
    # the wood under the plaster takes the timber trim's bark band, grain running up the column
    layered(B, 'col', P, s_ax, t_ax, lambda s, t: wear((s, 0, t)), p=0.015, mats=(0, 2),
            uvf=lambda s, t, l: ((t / 2.0), K.trim_v('bark', min(1.0, s / circ))) if l == 'B' else (s / 2.0, t / 2.0))
    # the plinth: a plastered block with rounded edges (four mitred sides of a cap profile)
    prof = cap_profile(plinth_h, 0.16, r=0.05)
    rot = [lambda v: v, lambda v: Vector((-v.y, v.x, v.z)), lambda v: Vector((-v.x, -v.y, v.z)), lambda v: Vector((v.y, -v.x, v.z))]
    wp = Wear(seed + 3, 4 * plinth_w, plinth_h, base=True, base_h=0.08, band_amp=0.5, density=0.0, lod=lod)
    for k in range(4):
        L = plinth_w / 2
        xf = (lambda v, k=k, L=L: rot[k](Vector((v.x, v.y - L, v.z))))
        sweep(B, ('pl', k), prof, -L, L, wp, {0: 0.04, 1: 0.1, 2: 0.3}[lod], miter0=True, miter1=True, xform=xf, p=0.015)
    bm, uvl = B.bm, B.uv
    inner = plinth_w / 2 - 0.16
    fill_cap(bm, uvl, [Vector((-inner, -inner, plinth_h)), Vector((inner, -inner, plinth_h)), Vector((inner, inner, plinth_h)),
                       Vector((-inner, inner, plinth_h))], 0)
    # the capital: a squared bolster across the top, and a square abacus block
    beam_box(bm, uvl, (-0.2, -0.2, shaft1), (0.2, 0.2, shaft1 + 0.08), band='plankA', seed=seed + 5, along='x', bevel=0.012,
             end_tile=4)
    beam_box(bm, uvl, (-0.55, -0.15, shaft1 + 0.08), (0.55, 0.15, H), band='plankA', seed=seed + 6, along='x', bevel=0.02,
             end_tile=5, jitter=0.004 if lod == 0 else 0.0)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    ob = K.new_object(name, bm, ['M_MudPlaster', 'M_MudBrick', 'M_Timber'])
    K.paint(ob, grime(H, seed, 0.5), mode='set')
    return finalize_lod(ob, lod, {0: 0.35, 1: 0.7, 2: 1.0}[lod])


def porch_beam(name, lod, W, seed):
    """The architrave: a squared beam W long (0.30 x 0.32) to lie on the column bolsters, its bottom at y = 0."""
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    beam_box(bm, uvl, (0.0, -0.15, 0.0), (W, 0.15, 0.32), band='plankB', seed=seed, along='x', bevel=0.025, end_tile=6,
             jitter=0.006 if lod == 0 else 0.0)
    ob = K.new_object(name, bm, ['M_Timber'])
    K.paint(ob, lambda co, n, m, p: (0.85 + 0.15 * K.smoothstep(0.0, 0.3, co.z),) * 3, mode='set')
    return ob


def porch_roof(name, lod, W, D, seed):
    """The porch roof: log joists from the architrave back to the temple wall, a reed-mat ceiling on them, the mud
    slab above with a rounded front edge. Pivot: x 0..W along the front, y 0 at the joists' underside (the architrave
    top), the front edge at z = 0 (glTF) running back to z = -D."""
    B = Builder()
    bm, uvl = B.bm, B.uv
    r = K.rng(seed)
    n = int(W / 0.45)
    jr = 0.075
    for k in range(n):
        x = (k + 0.5) * W / n + r.uniform(-0.03, 0.03)
        log_cyl(bm, uvl, (x, -0.25, jr), (x + r.uniform(-0.03, 0.03), D, jr + r.uniform(-0.01, 0.01)), jr * r.uniform(0.9, 1.1),
                seed=seed + k, band='pole' if k % 2 else 'bark', sides={0: 10, 1: 6, 2: 4}[lod], end_tile=k % 4,
                ends=(True, False), seg_len=0.7, wobble=0.01 if lod == 0 else 0.0)
    # reed-mat ceiling on the joists (seen from below between them)
    yc = 2 * jr
    fill_cap(bm, uvl, [Vector((0, -0.2, yc)), Vector((W, -0.2, yc)), Vector((W, D, yc)), Vector((0, D, yc))][::-1], 1,
             axes=(0, 1), tile=0.5)
    # the mud slab: its front edge profile swept along x, a flat top behind
    prof = Profile((OVER - 0.25, yc)).line(OVER - 0.25, 0.42).arc(OVER - 0.35, 0.42, 0.1, math.pi / 2).line(-0.6, 0.52)
    wear = Wear(seed, W, 0.52, base=False, density=2.0, t_range=(0.2, 0.45), lod=lod, patch_scale=0.4)
    sweep(B, 'edge', prof, 0.0, W, wear, STEP[lod], p=0.015, mats=(0, 3))
    fill_cap(bm, uvl, [Vector((0, 0.6, 0.52)), Vector((W, 0.6, 0.52)), Vector((W, D, 0.52)), Vector((0, D, 0.52))], 3)
    for x in (0.0, W):
        fill_cap(bm, uvl, [Vector((x, 0.15, yc)), Vector((x, D, yc)), Vector((x, D, 0.52)), Vector((x, 0.6, 0.52)), Vector((x, 0.25, 0.52)), Vector((x, 0.15, 0.42))], 0,
                 axes=(1, 2), flip=(x == W))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    ob = K.new_object(name, bm, ['M_MudPlaster', 'M_ReedMat', 'M_Timber', 'M_RoofMud'])
    K.paint(ob, lambda co, nn, m, p: (0.7 + 0.3 * K.smoothstep(0.0, 0.5, co.z),) * 3, mode='set')
    return finalize_lod(ob, lod, {0: 0.6, 1: 0.85, 2: 1.0}[lod])


# ---------------------------------------------------------------- registry

def register(piece, T_WALL, H):
    piece('stair_flight', 'stair', {'x': 3.36, 'y': 3.0, 'z': 1.0, 'stretch': 'x 0.8-1.2, y 0.85-1.2 (keep the slope '
          'under ~45 deg)'}, 'foot of the first riser at x = 0, rising toward +x (12 steps, 0.25 x 0.28); against the '
          'wall at z = 0 and 1.0 wide toward +z (outside the wall); y 0 at the street',
          'solid mud-brick stair, plastered, nosings and tread middles worn to brick', view=[-1.2, -1.0, 0.55])(
        lambda name, lod: stair_flight(name, lod, 71))
    piece('stair_landing', 'stair', {'x': 1.0, 'y': 3.0, 'z': 1.0, 'stretch': 'y as the flight'}, 'continues the flight: '
          'x 0..1 (place at the flight\'s x = 3.36), z 0..1 outside the wall, top at y = 3.0',
          'landing block at the head of the stair', view=[-0.5, -1.4, 0.6])(lambda name, lod: stair_landing(name, lod, 72))
    for nm, L, sd in (('ladder_3m', 3.2, 73), ('ladder_5m', 5.0, 74)):
        piece(nm, 'ladder', {'y': L, 'x': 0.56}, 'foot of the rails at the origin, standing along +y, rungs along x; '
              'lean it by rotating about x (rails 0.46 apart, rungs every 0.32 m)', 'poles with lashed rungs',
              view=[-0.6, -1.4, 0.35], lens=40)(lambda name, lod, L=L, sd=sd: ladder(name, lod, L, sd))
    CW = 'x 0..W along the run, y 0 at the foot, centred on its line (z -0.2..0.2), both faces finished'
    for nm, W, sd in (('cwall_2m', 2.0, 81), ('cwall_4m', 4.0, 82)):
        piece(nm, 'courtyard', {'x': W, 'y': CW_H, 'z': CW_T, 'stretch': 'x 0.85-1.15, y 0.8-1.2'}, CW,
              'mud-brick courtyard wall, rounded sagging cap, worn both sides', view=[-0.8, -1.4, 0.6])(
            lambda name, lod, W=W, sd=sd: cwall(name, lod, W, sd))
    piece('cwall_end', 'courtyard', {'x': 1.0, 'y': CW_H, 'z': CW_T}, CW + '; its x = 0 end is a free, weathered end',
          'free end of a courtyard wall (slumped, worn arrises)', view=[-1.2, -1.0, 0.6])(
        lambda name, lod: cwall(name, lod, 1.0, 83, end_free=True))
    piece('cwall_corner', 'courtyard', {'x': CW_T, 'y': CW_H, 'z': CW_T}, 'corner square x 0..0.4, z -0.4..0, exterior '
          'faces +Z and -X (as corner_out): the runs meeting it are centred on z = -0.2 and x = 0.2',
          'courtyard wall corner', view=[-1.0, -1.0, 0.6])(lambda name, lod: cwall_corner(name, lod, 84))
    piece('citywall_4m', 'citywall', {'x': 4.0, 'y': CITY_H, 'z': CITY_T, 'stretch': 'x 0.8-1.2, y 0.8-1.2'},
          'x 0..4 along the run, y 0 at the foot, centred on the wall line (z -1.68..1.68); the outside of the city is '
          '+Z; walk at y = 6.8 with stepped merlons on the outer edge and a kerb on the inner',
          'city wall section: gullied, worn foot, wall-walk, merlons', view=[-0.9, -1.5, 0.45], lens=40)(
        lambda name, lod: city_wall(name, lod, 4.0, 91))
    piece('gate_tower', 'citywall', {'x': 7.0, 'y': 12.3, 'z': 7.0, 'stretch': 'y 0.9-1.25 (towers 10.4-12.8 m)'},
          'centre of the footprint (6.4 m square body, buttresses to 7.0), y 0 at the foot; outside of the city +Z; '
          'doorways onto the wall-walk on its +-X faces at y = 6.8',
          'gate/wall tower: buttresses and niches, slits, corbelled slab on beam ends, stepped merlons',
          view=[-0.9, -1.5, 0.5], lens=35)(lambda name, lod: gate_tower(name, lod, 92))
    piece('gate_arch', 'citywall', {'x': 5.6, 'y': CITY_H, 'z': CITY_T, 'stretch': 'x 0.85-1.2'},
          'x 0..5.6 between the two towers\' faces, centred on the wall line; a 3.6 m arch springing at 3.3 m centred at '
          'x = 2.8; outside +Z', 'gate passage: mud-brick arch, the wall-walk over it',
          view=[-0.6, -1.5, 0.4], lens=35)(lambda name, lod: gate_arch(name, lod, 93))
    piece('gate_leaf', 'door', {'x': 1.78, 'y': 3.4}, 'as door_leaf_s (hinge axis at the origin); a pair closes '
          'gate_arch below the springing', 'heavy gate leaf, plank and batten', view=[-0.6, -1.4, 0.35])(
        lambda name, lod: door_leaf(name, lod, 1.78, 3.3, 94, heavy=True))
    piece('porch_column', 'porch', {'x': 1.1, 'y': 3.6, 'z': 0.62}, 'centre of the plinth at the origin, y 0 at its '
          'foot; the bolster on top runs along x; set columns 2-4 m apart and lay porch_beam_4m on them at y = 3.6',
          'temple porch column: mud-plastered timber, brick plinth, timber bolster capital', view=[-0.8, -1.3, 0.4])(
        lambda name, lod: porch_column(name, lod, 95))
    piece('porch_beam_4m', 'porch', {'x': 4.0, 'y': 0.32, 'z': 0.3, 'stretch': 'x 0.75-1.5'}, 'x 0..4, y 0 at its '
          'underside (on the bolsters, y = 3.6 on porch_column), centred on z', 'architrave beam',
          view=[-0.6, -1.4, 0.5])(lambda name, lod: porch_beam(name, lod, 4.0, 96))
    piece('porch_roof_4m', 'porch', {'x': 4.0, 'y': 0.52, 'z': 3.0, 'stretch': 'x 0.75-1.5, z 0.7-1.4'},
          'x 0..4 along the porch front, y 0 on the architrave top (y = 3.92 over porch_column), the front at z = 0 '
          'running back to z = -3 (the temple wall)', 'porch roof: log joists, reed-mat ceiling, mud slab',
          view=[-0.7, -1.2, -0.35], no_ground=True)(lambda name, lod: porch_roof(name, lod, 4.0, 3.0, 97))
