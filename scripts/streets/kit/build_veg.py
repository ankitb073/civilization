"""Build the vegetation pack: date palms (mature, young), a fig tree, reed clumps and a reed edge strip, grass tufts and
dry weeds, as alpha-card foliage on modelled trunks and branches. Exports build/kit/export/veg.glb and
build/kit/stats/veg.json. Textures: textures_veg.py (foliage atlas, palm trunk, fig bark).

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/streets/kit/build_veg.py -- [--only=palm_mature]

Frames (glTF): the base of the trunk or clump at the origin on the ground, y up, +Z front. Plants are round, so
integration can turn them freely about y; scale 0.85-1.15 keeps them believable.
"""
import math
import os
import sys
import time
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import kitlib as K  # noqa: E402
import veglib as V  # noqa: E402

A = K.args()
ONLY = set(A['only'].split(',')) if 'only' in A else None
UP = Vector((0, 0, 1))
DOWN = Vector((0, 0, -1))
MF, MT, MB = 'M_Foliage', 'M_PalmTrunk', 'M_Bark'


def mix(a, b, t):
    return a * (1 - t) + b * t


def nmix(a, b, t):
    v = Vector(a) * (1 - t) + Vector(b) * t
    return v.normalized() if v.length > 1e-9 else Vector(b)


# ---------------------------------------------------------------- date palm

def frond(acc, base, d0, length, roll, droop, wing, R, region, ns, nt, tint, crown_c, mat=0, dead=False):
    """One frond as a V of two cards along an arched rachis. d0: initial direction; droop: gravity bend; wing: V angle."""
    # rachis curve (shortened until it stays above the ground: young palms' lowest fronds, hanging dead ones)
    steps = 24
    for _try in range(12):
        pts, dirs = [], []
        p, d = Vector(base), Vector(d0).normalized()
        ds = length / steps
        for i in range(steps + 1):
            pts.append(p.copy())
            dirs.append(d.copy())
            s = i / steps
            d = (d + DOWN * droop * ds * (0.4 + 1.6 * s) * (1 - abs(d.z) * 0.3)).normalized()
            p = p + d * ds
        if min(q.z for q in pts) > 0.12 + 0.4 * length / 3.2:
            break
        length *= 0.88
    # side vector: horizontal, perpendicular to the frond's azimuth, rolled
    az = Vector((d0.x, d0.y, 0))
    if az.length < 1e-4:
        az = Vector((1, 0, 0))
    S0 = az.normalized().cross(UP).normalized()
    S0 = Matrix.Rotation(roll, 3, Vector(d0).normalized()) @ S0
    scale = length / 3.2
    wmax = 0.4 * scale
    beta = math.radians(R.uniform(10, 25) + (25 if dead else 0))

    def frame(s):
        f = s * steps
        i = min(steps - 1, int(f))
        u = f - i
        P = pts[i].lerp(pts[i + 1], u)
        T = dirs[i].lerp(dirs[i + 1], u).normalized()
        S = (S0 - T * S0.dot(T)).normalized()
        U = S.cross(T).normalized()
        return P, T, S, U

    for side in (1, -1):
        def Pf(s, t, side=side):
            P, T, S, U = frame(s)
            W = (S * side * math.cos(wing) + U * math.sin(wing)).normalized()
            # leaflet droop across the wing: the outer half bends toward the ground
            Wd = (W + DOWN * math.tan(beta) * (0.6 + 0.8 * s)).normalized()
            if t <= 0.45:
                return P + W * (t * wmax)
            return P + W * (0.45 * wmax) + Wd * ((t - 0.45) * wmax)

        def nf(p, fn):
            out = (p - crown_c)
            out = out.normalized() if out.length > 1e-6 else UP
            return nmix(fn, out, 0.25)

        def cf(s, t):
            ao = mix(0.5, 1.0, K.smoothstep(0.0, 0.32, s)) * mix(0.9, 1.0, t)
            return (tint[0] * ao, tint[1] * ao, tint[2] * ao)
        V.grid_card(acc, Pf, region, ns, nt, nf, cf, mat=mat, both=True, shared=False)
    return pts


def palm(name, lod, H=9.6, seed=1, n_green=32, n_dead=8, young=False):
    R = K.rng(seed)
    acc_t, acc_f = V.Acc(), V.Acc()
    # trunk: a gentle S-curve with a lean
    lean = Vector((R.uniform(-1, 1), R.uniform(-1, 1), 0)).normalized() * H * (0.06 if not young else 0.03)
    p0 = Vector((0, 0, 0))
    p3 = Vector((lean.x, lean.y, H))
    p1 = Vector((lean.x * 0.1 + R.uniform(-0.2, 0.2), lean.y * 0.1 + R.uniform(-0.2, 0.2), H * 0.35))
    p2 = Vector((lean.x * 0.9 + R.uniform(-0.25, 0.25), lean.y * 0.9 + R.uniform(-0.25, 0.25), H * 0.7))
    rings = {0: max(8, int(H / 0.33)), 1: max(5, int(H / 0.7)), 2: max(3, int(H / 2.0))}[lod]
    sides = {0: 12, 1: 8, 2: 5}[lod]
    pts = V.resample(V.bezier(p0, p1, p2, p3, 64), rings)
    r_base, r_mid = (0.24, 0.215) if not young else (0.27, 0.26)

    def rad(t):
        z = t * H
        return r_mid + (r_base - r_mid) * math.exp(-z / 0.5) + 0.05 * math.exp(-z / 0.18) + (0.01 if t > 0.92 else 0)
    radii = [rad(i / rings) for i in range(rings + 1)]
    jit = (lambda i, k: 0.035 * K.noise3((i * 0.9, k * 1.3, seed), seed)) if lod < 2 else None

    def tcol(t, p):
        z = p.z
        k = mix(0.62, 1.0, K.smoothstep(0.0, 1.6, z)) * mix(1.0, 0.72, K.smoothstep(H - 1.2, H, z))
        return (k, k * 0.98, k * 0.95)
    V.tube(acc_t, pts, radii, sides, 0, 1 / 1.4, tcol, jitter=jit, u_wrap=1.0)
    top = pts[-1]
    tdir = (pts[-1] - pts[-2]).normalized()
    # the crown's boot: leaf bases swelling out of the trunk top
    if lod < 2:
        boot = [top + tdir * h for h in (0.0, 0.25, 0.55, 0.85, 1.05)]
        V.tube(acc_t, boot, [radii[-1], radii[-1] * 1.35, radii[-1] * 1.55, radii[-1] * 1.25, 0.08], sides, 0, 1 / 1.4,
               lambda t, p: (0.62, 0.6, 0.57), u_wrap=1.0, cap=True)
    # roots: a few thick fibrous roots at the foot
    if lod == 0:
        for k in range(7):
            a = 2 * math.pi * k / 7 + R.uniform(-0.3, 0.3)
            d = Vector((math.cos(a), math.sin(a), 0))
            b = d * r_base * 0.8 + Vector((0, 0, R.uniform(0.08, 0.2)))
            e = d * (r_base + R.uniform(0.18, 0.32)) + Vector((0, 0, -0.06))
            V.tube(acc_t, [b, b.lerp(e, 0.5) + Vector((0, 0, 0.02)), e], [0.06, 0.045, 0.025], 5, 0, 1 / 1.4,
                   lambda t, p: (0.55, 0.53, 0.5), u_wrap=0.25)
    crown_c = top + tdir * 0.9
    # fronds: golden-angle spiral; young ones upright in the middle, old ones low and drooping
    f_scale = {0: 1.0, 1: 0.78, 2: 0.36}[lod]
    ns, nt = {0: (8 if young else 9, 2), 1: (7, 1), 2: (3, 1)}[lod]
    ng = max(6, int(round(n_green * f_scale)))
    nd = max(1, int(round(n_dead * f_scale))) if n_dead else 0
    golden = math.radians(137.508)
    for i in range(ng):
        age = (i + 0.5) / ng
        az = i * golden + R.uniform(-0.15, 0.15)
        elev = math.radians(mix(74 if not young else 68, -18 if not young else -4, age ** 0.85) + R.uniform(-7, 7))
        d0 = Vector((math.cos(az) * math.cos(elev), math.sin(az) * math.cos(elev), math.sin(elev)))
        L = (mix(3.4, 4.9, math.sin(math.pi * min(1, 0.2 + age))) * R.uniform(0.92, 1.06)) * (0.55 if young else 1.0)
        base = top + tdir * mix(1.0, 0.35, age) + Vector((math.cos(az), math.sin(az), 0)) * mix(0.06, 0.2, age)
        droop = mix(0.06, 0.32, age ** 1.3) * R.uniform(0.8, 1.2)
        wing = math.radians(R.uniform(14, 30))
        yel = K.smoothstep(0.65, 1.0, age) * R.uniform(0.3, 1.0)
        b = R.uniform(0.86, 1.04)
        tint = (b * (1 + 0.1 * yel), b * (1 + 0.03 * yel), b * (1 - 0.22 * yel))
        region = 'palmA' if i % 2 else 'palmB'
        frond(acc_f, base, d0, L, R.uniform(-0.35, 0.35), droop, wing, R, region, ns, nt, tint, crown_c)
    for i in range(nd):
        az = R.uniform(0, 2 * math.pi)
        elev = math.radians(R.uniform(-82, -58))
        d0 = Vector((math.cos(az) * math.cos(elev), math.sin(az) * math.cos(elev), math.sin(elev)))
        L = R.uniform(3.0, 4.0) * (0.75 if young else 1.0)
        base = top + tdir * R.uniform(0.0, 0.3) + Vector((math.cos(az), math.sin(az), 0)) * 0.22
        b = R.uniform(0.8, 1.0)
        frond(acc_f, base, d0, L, R.uniform(-0.6, 0.6), 0.05, math.radians(R.uniform(10, 30)), R, 'palmDead', ns, nt,
              (b, b, b), crown_c, dead=True)
    # date clusters (a mature palm): bunches on arching stalks from under the crown, strands of dates hanging from them
    if not young:
        nb = {0: 5, 1: 4, 2: 3}[lod]
        for b in range(nb):
            az = 2 * math.pi * b / nb + R.uniform(-0.4, 0.4)
            out = Vector((math.cos(az), math.sin(az), 0))
            s0 = top + tdir * 0.15 + out * 0.2
            s1 = s0 + out * 0.45 + Vector((0, 0, 0.12))
            s2 = s0 + out * 0.75 + Vector((0, 0, -0.35))
            stalk_c = lambda t, p: (0.95, 0.72, 0.3)
            V.tube(acc_t, [s0, s1, s2], [0.035, 0.03, 0.022], max(3, 5 - lod), 0, 1 / 1.4, stalk_c, u_wrap=0.3)
            ripe = R.uniform(0, 1)
            dcol = (1.0, mix(0.62, 0.38, ripe), mix(0.24, 0.12, ripe))
            ns_ = {0: 9, 1: 6, 2: 3}[lod]
            for j in range(ns_):
                a = 2 * math.pi * j / ns_ + R.uniform(-0.3, 0.3)
                h0 = s2 + Vector((math.cos(a), math.sin(a), 0)) * R.uniform(0.04, 0.12)
                ln = R.uniform(0.35, 0.6)
                pts_ = [h0, h0 + Vector((math.cos(a), math.sin(a), 0)) * 0.08 + Vector((0, 0, -ln * 0.5)),
                        h0 + Vector((math.cos(a), math.sin(a), 0)) * 0.13 + Vector((0, 0, -ln))]
                # the strand swollen with dates along its lower two thirds
                V.tube(acc_t, pts_, [0.012, 0.045, 0.04], {0: 5, 1: 4, 2: 3}[lod], 0, 1 / 1.4,
                       lambda t, p, c=dcol: c, u_wrap=0.2, cap=True)
    coll = K.collection()
    ob_t = acc_t.to_object('_t', [MT], coll)
    ob_f = acc_f.to_object('_f', [MF], coll)
    return join(name, [ob_t, ob_f])


def join(name, obs):
    import bpy
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


# ---------------------------------------------------------------- fig

def fig(name, lod, seed=5):
    """Fig: four grey stems from the foot, branching three times; at every twig tip a clump of crossed leaf
    rosettes (figA) facing out of the crown, and leafy twigs (figB) along the outer branches."""
    R = K.rng(seed)
    acc_w, acc_f = V.Acc(), V.Acc()
    sides = {0: 7, 1: 5, 2: 4}
    tips, twigs = [], []
    canopy_c = Vector((0, 0, 3.0))
    CR = Vector((2.7, 2.7, 1.7))

    def bcol(t, p):
        k = mix(0.62, 1.0, K.smoothstep(0.0, 1.4, p.z))
        return (k, k, k)

    def inside_canopy(p):
        q = p - canopy_c
        return Vector((q.x / CR.x, q.y / CR.y, max(0.0, q.z) / CR.z)).length

    def branch(start, d, L, r0, depth):
        bend = Vector((R.uniform(-1, 1), R.uniform(-1, 1), R.uniform(-0.2, 0.4))) * L * 0.2
        flat = Vector((d.x, d.y, d.z * 0.75)).normalized()
        e = start + (d * 0.6 + flat * 0.4).normalized() * L
        # keep the crown round: a branch that would run out of the canopy is shortened (and turned up a little)
        for _ in range(8):
            if inside_canopy(e) <= 1.0 or L < 0.35:
                break
            L *= 0.82
            d = (d + Vector((0, 0, 0.25))).normalized()
            flat = Vector((d.x, d.y, d.z * 0.75)).normalized()
            e = start + (d * 0.6 + flat * 0.4).normalized() * L
        c1 = start + d * L * 0.4 + bend
        c2 = e - flat * L * 0.3 + bend * 0.5
        n = ({0: 8, 1: 5, 2: 3, 3: 2} if lod == 0 else {0: 5, 1: 3, 2: 2, 3: 2})[depth]
        pts = V.bezier(start, c1, c2, e, n)
        r1 = r0 * 0.6
        draw = lod == 0 or (lod == 1 and depth < 3) or (lod == 2 and depth < 2)
        if draw:
            V.tube(acc_w, pts, [mix(r0, r1, i / n) for i in range(n + 1)], max(3, sides[lod] - depth),
                   0, 1.0, bcol, jitter=(lambda i, k: 0.04 * K.noise3((i, k, depth), seed)) if lod == 0 else None, u_wrap=1.0)
        if depth < 3:
            nk = R.choice((2, 3, 3)) if depth < 2 else R.choice((3, 3, 4))
            for k in range(nk):
                t = R.uniform(0.45, 0.95) if depth < 2 else R.uniform(0.6, 1.0)
                f = t * n
                j = min(n - 1, int(f))
                p = pts[j].lerp(pts[j + 1], f - j)
                pd = (pts[j + 1] - pts[j]).normalized()
                az = R.uniform(0, 2 * math.pi)
                side = Vector((math.cos(az), math.sin(az), 0))
                side = (side - pd * side.dot(pd)).normalized()
                ang = math.radians(R.uniform(25, 50))
                nd = (pd * math.cos(ang) + side * math.sin(ang)).normalized()
                branch(p, nd, L * R.uniform(0.55, 0.72), mix(r0, r1, t) * 0.72, depth + 1)
        else:
            tips.append((e, (pts[-1] - pts[-2]).normalized()))
        if depth in (1, 2):
            f = (0.55 if depth == 2 else 0.85) * n
            j = min(n - 1, int(f))
            tips.append((pts[j].lerp(pts[j + 1], f - j), (pts[j + 1] - pts[j]).normalized()))
        if depth == 2:
            for t in (0.5, 0.85):
                f = t * n
                j = min(n - 1, int(f))
                twigs.append((pts[j].lerp(pts[j + 1], f - j), (pts[j + 1] - pts[j]).normalized()))

    for k in range(4):
        az = 2 * math.pi * k / 4 + R.uniform(-0.4, 0.4)
        el = math.radians(R.uniform(55, 72))
        d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        branch(Vector((R.uniform(-0.08, 0.08), R.uniform(-0.08, 0.08), 0)), d, R.uniform(1.75, 2.2), R.uniform(0.085, 0.11), 0)

    def outward(p):
        q = p - canopy_c
        n = Vector((q.x / CR.x ** 2, q.y / CR.y ** 2, q.z / CR.z ** 2))
        return n.normalized() if n.length > 1e-6 else UP

    def depth_of(p):
        q = p - canopy_c
        return Vector((q.x / CR.x, q.y / CR.y, q.z / CR.z)).length

    def rosette(c, nrm, size, ao, vb, nsr):
        ref = UP if abs(nrm.dot(UP)) < 0.9 else Vector((1, 0, 0))
        xa = ref.cross(nrm).normalized()
        ya = nrm.cross(xa).normalized()
        rot = R.uniform(0, 2 * math.pi)
        xa, ya = xa * math.cos(rot) + ya * math.sin(rot), ya * math.cos(rot) - xa * math.sin(rot)
        dome = R.uniform(0.05, 0.12) * size
        out = outward(c)

        def P(s, t):
            r2 = (2 * s - 1) ** 2 + (2 * t - 1) ** 2
            return c + xa * ((s - 0.5) * size) + ya * ((t - 0.5) * size) + nrm * (dome * (1 - 0.5 * r2))

        def nfn(pp, fn):
            o = outward(pp)
            return nmix(fn, o, 0.6)

        def cfn(s, t):
            k = ao * vb
            return (k, k, k * 0.97)
        V.grid_card(acc_f, P, 'figA', nsr, nsr, nfn, cfn, both=True, shared=True)

    per = {0: 3, 1: 2, 2: 1}[lod]
    nsr = 2 if lod == 0 else 1
    for i, (p, d) in enumerate(tips):
        if lod == 2 and i % 2:
            continue
        c = p + d * 0.12
        out = outward(c)
        N0 = (out + UP * 0.35 + d * 0.3).normalized()
        dep = depth_of(c)
        ao = mix(0.78, 1.0, K.smoothstep(0.45, 1.0, dep)) * mix(0.88, 1.0, K.smoothstep(1.4, 3.0, c.z))
        vb = R.uniform(0.9, 1.1)
        size = R.uniform(1.1, 1.4) * (1.0 if lod < 2 else 1.7)
        axis = N0.cross(Vector((R.uniform(-1, 1), R.uniform(-1, 1), R.uniform(-1, 1)))).normalized()
        for k in range(per):
            if k == 0:
                nrm = N0
            else:
                ang = math.radians(55) * (1 if k == 1 else -1)
                nrm = (Matrix.Rotation(ang, 3, axis) @ N0).normalized()
            rosette(c + nrm * 0.03 * k, nrm, size, ao, vb, nsr if k == 0 else 1)
    # leafy twigs hanging off the outer branches
    if lod < 2:
        for i, (p, d) in enumerate(twigs):
            if lod == 1 and i % 2:
                continue
            out = outward(p)
            up = (d * 0.5 + out * 0.6 + UP * 0.1).normalized()
            nrm = (out - up * out.dot(up))
            nrm = nrm.normalized() if nrm.length > 1e-4 else Vector((1, 0, 0))
            xa = up.cross(nrm).normalized()
            sc = R.uniform(0.85, 1.1)
            w, h = 0.48 * sc, 0.96 * sc
            bend = R.uniform(0.1, 0.25)
            dep = depth_of(p)
            ao = mix(0.7, 1.0, K.smoothstep(0.45, 1.0, dep))

            def Pc(s, t, p=p, xa=xa, up=up, nrm=nrm, w=w, h=h, bend=bend):
                return p + xa * ((s - 0.5) * w) + up * (t * h) - nrm * (bend * t * t * h)

            def nfn(pp, fn, out=out):
                return nmix(fn, out, 0.5)
            V.grid_card(acc_f, Pc, 'figB', 1, 2 if lod == 0 else 1, nfn, lambda s, t, ao=ao: (ao, ao, ao * 0.97), both=True, shared=True)
    coll = K.collection()
    return join(name, [acc_w.to_object('_w', [MB], coll), acc_f.to_object('_f', [MF], coll)])


# ---------------------------------------------------------------- reeds, grass, weeds

def clump(acc, R, regions, n, height, width, spread, lean, curl, ns, center=Vector((0, 0, 0)), yaw_jit=1.0, base_dark=0.5,
          up_bias=0.55, line=None):
    """n upright cards around a centre (or along a line from line[0] to line[1]); region per card from `regions`."""
    for k in range(n):
        region, rw, rh = regions[R.randrange(len(regions))]
        if line:
            t = (k + R.uniform(0.1, 0.9)) / n
            c = line[0].lerp(line[1], t) + Vector((0, R.uniform(-spread, spread), 0))
            out = Vector((R.uniform(-1, 1), R.uniform(-1, 1), 0)).normalized()
        else:
            a = 2 * math.pi * (k + R.uniform(-0.3 * yaw_jit, 0.3 * yaw_jit)) / n
            out = Vector((math.cos(a), math.sin(a), 0))
            c = center + out * R.uniform(0, spread)
        sc = R.uniform(*height) / rh
        w, h = rw * sc * R.uniform(*width), rh * sc
        yaw = math.atan2(out.y, out.x) + math.pi / 2 + R.uniform(-0.6, 0.6) * yaw_jit
        xa = Vector((math.cos(yaw), math.sin(yaw), 0))
        fwd = xa.cross(UP)
        ln = math.radians(R.uniform(*lean))
        lean_dir = out if fwd.dot(out) >= 0 else -out
        up = (UP * math.cos(ln) + lean_dir * math.sin(ln)).normalized()
        cu = R.uniform(*curl)
        vb = R.uniform(0.85, 1.08)

        def P(s, t, c=c, xa=xa, up=up, lean_dir=lean_dir, h=h, w=w, cu=cu):
            # region u runs along the card's height for long strips (reeds) or across (tufts); see `along`
            return c + xa * ((t - 0.5) * w) + up * (s * h) + lean_dir * (cu * s * s * h) + DOWN * (cu * 0.3 * s ** 3 * h)

        def P2(s, t, c=c, xa=xa, up=up, lean_dir=lean_dir, h=h, w=w, cu=cu):
            return c + xa * ((s - 0.5) * w) + up * (t * h) + lean_dir * (cu * t * t * h) + DOWN * (cu * 0.3 * t ** 3 * h)

        def nfn(p, fn, lean_dir=lean_dir):
            return nmix(fn, (UP + lean_dir * 0.6).normalized(), up_bias)

        if region.startswith('reed'):
            def cfn(s, t, vb=vb):
                k = vb * mix(base_dark, 1.0, K.smoothstep(0.0, 0.45, s))
                return (k, k, k)
            V.grid_card(acc, P, region, ns, 1, nfn, cfn, both=True, shared=True)
        else:
            def cfn(s, t, vb=vb):
                k = vb * mix(base_dark, 1.0, K.smoothstep(0.0, 0.6, t))
                return (k, k, k)
            V.grid_card(acc, P2, region, 1, ns, nfn, cfn, both=True, shared=True)


def reed_clump(name, lod, seed, dry=0.15):
    R = K.rng(seed)
    acc = V.Acc()
    n = {0: 18, 1: 9, 2: 5}[lod]
    ns = {0: 4, 1: 2, 2: 1}[lod]
    regs = [('reedA', 0.4, 3.2)] * int(10 * (1 - dry)) + [('reedB', 0.4, 3.2)] * max(1, int(10 * dry))
    clump(acc, R, regs, n, (2.0, 2.9), (0.9, 1.15), 0.3, (3, 14), (0.0, 0.08), ns, base_dark=0.62, up_bias=0.5)
    # a skirt of shorter, drier stems
    if lod < 2:
        clump(acc, R, [('reedB', 0.4, 3.2)], {0: 8, 1: 4}[lod], (0.9, 1.5), (0.9, 1.1), 0.45, (10, 28), (0.02, 0.12), max(1, ns - 1),
              base_dark=0.5)
    return acc.to_object(name, [MF], K.collection())


def reed_edge(name, lod, seed=31):
    R = K.rng(seed)
    acc = V.Acc()
    n = {0: 34, 1: 14, 2: 6}[lod]
    ns = {0: 3, 1: 2, 2: 1}[lod]
    line = (Vector((0, 0, 0)), Vector((4.0, 0, 0)))
    clump(acc, R, [('reedA', 0.4, 3.2), ('reedB', 0.4, 3.2), ('reedB', 0.4, 3.2)], n, (0.8, 1.6), (0.9, 1.1), 0.25, (4, 20),
          (0.0, 0.15), ns, base_dark=0.5, line=line)
    if lod < 2:
        clump(acc, R, [('grassA', 0.64, 0.48), ('grassB', 0.64, 0.48)], {0: 22, 1: 8}[lod], (0.3, 0.55), (0.9, 1.2), 0.35, (5, 25),
              (0.05, 0.2), 1 if lod else 2, base_dark=0.55, up_bias=0.7, line=line)
    return acc.to_object(name, [MF], K.collection())


def tuft(name, lod, seed, regions, n0, height, width=(0.85, 1.15), spread=0.05, lean=(8, 26), curl=(0.05, 0.2)):
    R = K.rng(seed)
    acc = V.Acc()
    n = {0: n0, 1: max(2, n0 - 1), 2: 2}[lod]
    ns = {0: 2, 1: 1, 2: 1}[lod]
    clump(acc, R, regions, n, height, width, spread, lean, curl, ns, base_dark=0.55, up_bias=0.7)
    return acc.to_object(name, [MF], K.collection())


# ---------------------------------------------------------------- pieces

PIECES = []


def piece(name, snap, notes, view=None, lens=50, **kw):
    def deco(fn):
        PIECES.append(dict(name=name, snap=snap, notes=notes, fn=fn, view=view, lens=lens))
        return fn
    return deco


PIV = 'trunk or clump base at the origin on the ground; y up; turn freely about y'
piece('palm_mature', {'footprint_r': 0.35, 'height': 11.5, 'crown_r': 4.5}, 'date palm, ~11.5 m overall (trunk 6.8 m): '
      'curved trunk of leaf-base stubs, 38 fronds and a skirt of dead ones', view=[-1.0, -1.6, 0.25], lens=35)(
    lambda n, lod: palm(n, lod, H=6.8, seed=1, n_green=38, n_dead=9))
piece('palm_young', {'footprint_r': 0.35, 'height': 4.5, 'crown_r': 2.8}, 'young date palm, ~4.5 m overall: short thick '
      'trunk, upright crown', view=[-1.0, -1.6, 0.3], lens=35)(
    lambda n, lod: palm(n, lod, H=0.7, seed=2, n_green=24, n_dead=3, young=True))
piece('fig_tree', {'footprint_r': 0.3, 'height': 4.4, 'crown_r': 3.2}, 'fig tree: four grey stems, wide low crown of '
      'lobed leaves', view=[-1.0, -1.5, 0.35], lens=35)(lambda n, lod: fig(n, lod))
piece('reeds_a', {'footprint_r': 0.6, 'height': 3.0}, 'reed clump (Phragmites) with plumes, for the riverbank',
      view=[-1.0, -1.6, 0.3])(lambda n, lod: reed_clump(n, lod, 21))
piece('reeds_b', {'footprint_r': 0.6, 'height': 2.6}, 'reed clump, drier, later in the season', view=[-1.0, -1.6, 0.3])(
    lambda n, lod: reed_clump(n, lod, 22, dry=0.5))
piece('reed_edge_4m', {'x': 4.0, 'height': 1.6}, 'a 4 m strip of low reeds, rushes and grass along a bank (x 0..4)',
      view=[-0.4, -1.6, 0.35])(lambda n, lod: reed_edge(n, lod))
GA, GB = ('grassA', 0.64, 0.48), ('grassB', 0.64, 0.48)
piece('grass_a', {'footprint_r': 0.3, 'height': 0.45}, 'grass tuft, green and straw', view=[-1.0, -1.6, 0.6])(
    lambda n, lod: tuft(n, lod, 41, [GA], 6, (0.36, 0.48)))
piece('grass_b', {'footprint_r': 0.3, 'height': 0.45}, 'dry grass tuft', view=[-1.0, -1.6, 0.6])(
    lambda n, lod: tuft(n, lod, 42, [GB], 6, (0.36, 0.5)))
piece('grass_c', {'footprint_r': 0.25, 'height': 0.3}, 'small sparse tuft, mixed', view=[-1.0, -1.6, 0.6])(
    lambda n, lod: tuft(n, lod, 43, [GA, GB], 3, (0.2, 0.32)))
piece('weed_thistle', {'footprint_r': 0.3, 'height': 0.6}, 'dry thistle', view=[-1.0, -1.6, 0.5])(
    lambda n, lod: tuft(n, lod, 51, [('weedA', 0.6, 0.6)], 3, (0.5, 0.65), spread=0.03, lean=(2, 12), curl=(0.0, 0.06)))
piece('weed_stalks', {'footprint_r': 0.3, 'height': 0.6}, 'dry umbel stalks', view=[-1.0, -1.6, 0.5])(
    lambda n, lod: tuft(n, lod, 52, [('weedB', 0.6, 0.6)], 3, (0.5, 0.7), spread=0.03, lean=(2, 14), curl=(0.0, 0.06)))


def build():
    t0 = time.time()
    K.reset()
    metas, objs = [], []
    for p in PIECES:
        if ONLY and p['name'] not in ONLY:
            continue
        obs = []
        for lod in (0, 1, 2):
            ob = p['fn'](p['name'] if lod == 0 else f"{p['name']}_LOD{lod}", lod)
            ob.location = (0, 0, 0)
            obs.append(ob)
        extra = {'view': p['view'] or [-1.0, -1.6, 0.4], 'lens': p['lens']}
        metas.append(K.piece_meta(p['name'], obs, 'vegetation', p['snap'], PIV, p['notes'], extra))
        objs += obs
        print(f"{p['name']}: {[m['tris'] for m in metas[-1]['lods']]} tris", flush=True)
    K.export_glb(objs, os.path.join(K.EXPORT, 'veg.glb'))
    K.write_stats('veg', metas, 'veg.glb')
    print(f'exported veg in {time.time() - t0:.0f}s')


# ---------------------------------------------------------------- hero renders (from the exported packs)

def import_pack(path):
    import bpy
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    for m in list(bpy.data.materials):
        if m.get('kit_set') and not m.name.endswith('_imported') and m.node_tree and not any(n.type == 'TEX_IMAGE' for n in m.node_tree.nodes):
            m.name = m.name.split('.')[0] + '_imported'
    objs = {}
    for o in set(bpy.data.objects) - before:
        if o.type != 'MESH':
            continue
        me = o.data
        if 'Col' not in me.color_attributes and len(me.color_attributes):
            me.color_attributes[0].name = 'Col'
        if len(me.color_attributes):
            me.color_attributes.active_color = me.color_attributes['Col']
        for sl in o.material_slots:
            if sl.material:
                base = sl.material.name.split('.')[0].replace('_imported', '')
                try:
                    sl.material = K.material(base)
                except KeyError:
                    pass
        o.hide_render = True
        o.location = (0, 0, 0)
        objs[o.name] = o
    return objs


def place(objs, name, loc, rot=0.0, scale=1.0):
    import bpy
    src = objs[name]
    o = src.copy()
    bpy.context.scene.collection.objects.link(o)
    o.hide_render = False
    o.location = loc
    o.rotation_euler = (0, 0, rot)
    o.scale = (scale, scale, scale)
    return o


def hero():
    import bpy
    import bmesh
    out = K.RENDERS
    shots = A.get('shots', 'palm,reeds,wall,fig').split(',')
    for shot in shots:
        K.reset()
        veg = import_pack(os.path.join(K.EXPORT, 'veg.glb'))
        arch = import_pack(os.path.join(K.EXPORT, 'arch.glb')) if os.path.exists(os.path.join(K.EXPORT, 'arch.glb')) else {}
        R = K.rng(7)
        if shot == 'palm':
            K.render_setup(res=(1600, 1000), samples=128, sun_elev=16, sun_azim=150, sun_strength=4.0, hdri_strength=1.0)
            K.ground_plane(size=200)
            place(veg, 'palm_mature', (0, 0, 0), 0.4)
            place(veg, 'palm_mature', (-6.5, 7, 0), 2.1, 1.08)
            place(veg, 'palm_young', (4.5, 2.5, 0), 1.0)
            place(veg, 'palm_young', (-3.0, -2.0, 0), 3.0, 0.9)
            for k in range(14):
                place(veg, ('grass_a', 'grass_b', 'grass_c', 'weed_stalks')[k % 4], (R.uniform(-6, 6), R.uniform(-4, 5), 0), R.uniform(0, 6))
            K.camera((3.5, -15.5, 1.5), (0.0, 0, 6.5), lens=26)
            K.render(os.path.join(out, 'veg_hero_palms.png'))
        elif shot == 'reeds':
            K.render_setup(res=(1600, 1000), samples=128, sun_elev=22, sun_azim=-60, sun_strength=4.0, hdri_strength=1.0)
            # a bank sloping into water
            bm = bmesh.new()
            bmesh.ops.create_grid(bm, x_segments=60, y_segments=40, size=30)
            for v in bm.verts:
                v.co.z = -0.6 * K.smoothstep(-1.0, 3.5, v.co.y) + 0.08 * K.noise3((v.co.x * 0.4, v.co.y * 0.4, 0), 3)
            K.uv_box(bm, tile=2.6)
            K.new_object('_bank', bm, ['M_Ground'])
            wbm = bmesh.new()
            bmesh.ops.create_grid(wbm, x_segments=1, y_segments=1, size=40)
            for v in wbm.verts:
                v.co.z = -0.42
                v.co.y += 22
            me = bpy.data.meshes.new('_water')
            wbm.to_mesh(me)
            wbm.free()
            wm = bpy.data.materials.new('_water')
            wm.use_nodes = True
            bs = next(n for n in wm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            bs.inputs['Base Color'].default_value = (0.05, 0.07, 0.06, 1)
            bs.inputs['Roughness'].default_value = 0.06
            bs.inputs['IOR'].default_value = 1.33
            nz = wm.node_tree.nodes.new('ShaderNodeTexNoise')
            nz.inputs['Scale'].default_value = 6.0
            bump = wm.node_tree.nodes.new('ShaderNodeBump')
            bump.inputs['Strength'].default_value = 0.08
            wm.node_tree.links.new(nz.outputs['Fac'], bump.inputs['Height'])
            wm.node_tree.links.new(bump.outputs['Normal'], bs.inputs['Normal'])
            me.materials.append(wm)
            wo = bpy.data.objects.new('_water', me)
            bpy.context.scene.collection.objects.link(wo)
            for k in range(9):
                x = -9 + k * 2.3 + R.uniform(-0.6, 0.6)
                y = 2.2 + R.uniform(-0.4, 0.6)
                place(veg, 'reeds_a' if k % 3 else 'reeds_b', (x, y, -0.5 * K.smoothstep(-1.0, 3.5, y)), R.uniform(0, 6), R.uniform(0.85, 1.1))
            for k in range(5):
                x = -10 + k * 4.0
                o = place(veg, 'reed_edge_4m', (x, 1.2 + R.uniform(-0.3, 0.3), -0.25), R.uniform(-0.1, 0.1))
            for k in range(16):
                x, y = R.uniform(-8, 8), R.uniform(-4, 0.8)
                place(veg, ('grass_a', 'grass_b', 'grass_c', 'weed_thistle')[k % 4], (x, y, -0.6 * K.smoothstep(-1.0, 3.5, y)), R.uniform(0, 6))
            place(veg, 'palm_mature', (6, 14, -0.6), 1.0)
            place(veg, 'palm_mature', (10, 18, -0.6), 2.0, 0.9)
            place(veg, 'palm_young', (-7, 12, -0.6), 0.5)
            K.camera((-1.5, -6.5, 1.55), (0.5, 3.0, 0.9), lens=30)
            K.render(os.path.join(out, 'veg_hero_reeds.png'))
        elif shot == 'wall':
            K.render_setup(res=(1600, 1000), samples=128, sun_elev=30, sun_azim=-40, sun_strength=4.0, hdri_strength=0.9)
            K.ground_plane(size=60)
            if arch:
                x = 0.0
                place(arch, 'corner_out', (0, 0, 0), 0)
                for nm, w in (('wall_4m_a', 4.0), ('door_2m', 2.0), ('wall_2m_a', 2.0)):
                    place(arch, nm, (0.5 + x, 0, 0), 0)
                    x += w
            for k, (nm, x, y) in enumerate((('grass_a', 0.9, -0.25), ('grass_c', 1.5, -0.15), ('weed_thistle', 2.6, -0.3), ('grass_b', 3.6, -0.2),
                                             ('grass_c', 4.1, -0.12), ('weed_stalks', 7.4, -0.25), ('grass_a', 7.9, -0.3), ('grass_b', 3.0, -1.2),
                                             ('grass_c', 5.5, -1.6), ('grass_a', -0.6, -0.6))):
                place(veg, nm, (x, y, 0), R.uniform(0, 6), R.uniform(0.9, 1.15))
            place(veg, 'fig_tree', (9.5, 4.0, 0), 0.7)
            K.camera((1.0, -3.2, 1.25), (3.2, 0.0, 0.55), lens=30)
            K.render(os.path.join(out, 'veg_hero_wallfoot.png'))
        elif shot == 'fig':
            K.render_setup(res=(1600, 1000), samples=128, sun_elev=38, sun_azim=-30, sun_strength=4.2, hdri_strength=1.0)
            K.ground_plane(size=100)
            place(veg, 'fig_tree', (0, 0, 0), 0.3)
            place(veg, 'grass_a', (1.2, -1.0, 0), 0.0)
            place(veg, 'grass_b', (-1.5, -0.6, 0), 1.0)
            K.camera((-3.0, -9.5, 2.0), (0, 0, 2.3), lens=30)
            K.render(os.path.join(out, 'veg_hero_fig.png'))


if 'hero' in A:
    hero()
else:
    build()
