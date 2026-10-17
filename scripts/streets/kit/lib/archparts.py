"""Architecture parts shared by the architecture builders: walls with openings, corners, timber members.

Blender frame for wall-like pieces: x along the run (0..W), z up, y into the wall (0..T); exterior face y = 0 (-Y),
which is +Z in glTF. All wear fields are functions of 3-D position, so faces that meet (a front and a jamb reveal)
agree on where the plaster is gone and weld without gaps.
"""
import math
import bmesh
from mathutils import Vector
import kitlib as K
from surface import Builder, layered, axis, MAT_PLASTER, MAT_BRICK
from mudwall import BASE_H, P_THICK, SEAM, grime, bulge

MATS = ['M_MudPlaster', 'M_MudBrick', 'M_Timber']
MAT_TIMBER = 2
STEP = {0: 0.05, 1: 0.15, 2: 0.6}
DECIMATE = {0: 0.18, 1: 0.6, 2: 1.0}


# ---------------------------------------------------------------- wear in 3-D

class Wear:
    """A wear field over a piece: a ragged worn band along the foot, patches, and worn arrises (lines)."""

    def __init__(self, seed, W, H, base=True, base_h=BASE_H, density=1.0, seams=(0.0, None), t_range=(0.75, None),
                 band_amp=1.0, patch_scale=1.0, lod=0, tongues=1.0):
        self.seed, self.W, self.H = seed, W, H
        self.base, self.base_h, self.band_amp = base, base_h, band_amp
        self.lines = []        # (a, b, reach, strength, foot_boost) worn arrises
        self.boxes = []        # axis-aligned regions forced to plaster (no wear), e.g. around lintels
        r = K.rng(seed)
        self.seams = [s for s in seams if s is not None] if seams else []
        sx0, sx1 = 0.0, W
        self.tongues = [(r.uniform(SEAM + 0.2, max(SEAM + 0.25, W - SEAM - 0.2)), r.uniform(0.1, 0.36) * band_amp,
                         r.uniform(0.12, 0.28)) for _ in range(int(W / 2.2 * density * tongues + r.random()))]
        self.patches = []
        t0 = t_range[0]
        t1 = t_range[1] if t_range[1] is not None else H - 0.45
        n = int(round(W * max(0.0, t1 - t0) / 3.6 * density + r.random() * 0.8))
        if lod >= 2:
            n = min(n, 1)
        for _ in range(n):
            rx, rz = r.uniform(0.1, 0.42) * patch_scale, r.uniform(0.08, 0.3) * patch_scale
            if W - 2 * (SEAM + rx) < 0.05 or t1 - t0 < 0.1:
                continue
            cx = r.uniform(SEAM + rx, W - SEAM - rx)
            cz = r.uniform(t0, max(t0 + 0.05, t1))
            self.patches.append((cx, cz, rx, rz, r.random() * 100))
            for _k in range(r.randint(1, 4) if lod == 0 else 0):
                fx, fz = cx + r.uniform(-1.6, 1.6) * rx, cz + r.uniform(-1.8, 1.8) * rz
                fr = r.uniform(0.03, 0.08)
                if SEAM + fr < fx < W - SEAM - fr and t0 - 0.2 < fz < t1 + 0.2:
                    self.patches.append((fx, fz, fr * r.uniform(0.8, 1.5), fr, r.random() * 100))

    def band(self, x):
        if not self.base:
            return -1.0
        W, seed = self.W, self.seed
        w = K.smoothstep(0.0, SEAM, x) * K.smoothstep(0.0, SEAM, W - x)
        n = (0.11 * K.noise3((x * 1.9, 0.3, 0.0), seed, octaves=2) + 0.04 * K.noise3((x * 7.0, 1.7, 0.0), seed + 1, octaves=2)
             + 0.022 * K.noise3((x * 19.0, 2.9, 0.0), seed + 2) + 0.01 * K.noise3((x * 43.0, 4.1, 0.0), seed + 8))
        g = sum(h * math.exp(-((x - c) / wd) ** 2) for c, h, wd in self.tongues)
        return self.base_h + w * self.band_amp * (n + 0.06) + w * g

    def line(self, a, b, reach=0.07, strength=1.0, foot=0.0):
        """A worn arris from a to b (3-D points): plaster gone within ~reach of it, more near the foot."""
        self.lines.append((Vector(a), Vector(b), reach, strength, foot))

    def keep(self, lo, hi):
        """Force plaster inside the box lo..hi (3-D): e.g. around a lintel's bearing."""
        self.boxes.append((Vector(lo), Vector(hi)))

    def __call__(self, p):
        x, y, z = p
        seed = self.seed
        f = self.band(x) - z if self.base else -1.0
        for cx, cz, rx, rz, ps in self.patches:
            dx, dz = (x - cx) / rx, (z - cz) / rz
            if dx * dx + dz * dz > 4.0:
                continue
            wx = 0.35 * K.noise3((x * 3.0, z * 3.0, ps), seed + 4)
            wz = 0.35 * K.noise3((x * 3.0, z * 3.0, ps + 5.0), seed + 4)
            rr = math.sqrt((dx + wx) ** 2 + (dz + wz) ** 2)
            m = min(rx, rz)
            ff = m * (1 - rr) + (0.05 * K.noise3((x * 4.5, z * 4.5, ps), seed + 3, octaves=2)
                                 + 0.02 * K.noise3((x * 14.0, z * 14.0, ps), seed + 6)) * min(1.0, m / 0.15 + 0.3)
            f = max(f, ff)
        for a, b, reach, st, foot in self.lines:
            ab = b - a
            L2 = ab.length_squared
            u = 0.0 if L2 < 1e-9 else max(0.0, min(1.0, (Vector(p) - a).dot(ab) / L2))
            q = a + ab * u
            d = (Vector(p) - q).length
            nz = K.noise3((x * 6.0 + y * 6.0, z * 6.0, 11.0), seed + 13, octaves=2)
            nz2 = K.noise3((x * 2.0 + y * 2.0, z * 1.3, 17.0), seed + 14)
            boost = foot * (1 - K.smoothstep(0.0, 1.4, z))
            ff = st * (reach * (0.3 + 0.95 * nz2 + boost) - d) + 0.03 * nz
            f = max(f, ff)
        for lo, hi in self.boxes:
            if lo.x <= x <= hi.x and lo.y <= y <= hi.y and lo.z <= z <= hi.z:
                f = min(f, -0.03)
        return f


def add_gullies(wear, W, H, n, seed):
    """Rain gullies: narrow worn runnels from the top of a tall wall down a metre or three."""
    r = K.rng(seed + 77)
    for _ in range(n):
        x = r.uniform(SEAM + 0.1, W - SEAM - 0.1)
        L = r.uniform(0.8, 2.8)
        wear.line((x, 0, H + 0.1), (x + r.uniform(-0.15, 0.15), 0, H - L), r.uniform(0.04, 0.09), 1.0, 0.0)


def relief3(seed, amp=0.0025):
    return lambda p: amp * (0.5 + 0.5 * K.noise3((p[0] * 2.7 + p[1] * 2.7, p[2] * 2.7, 3.3), seed + 9, octaves=2))


# ---------------------------------------------------------------- timber

def beam_box(bm, uvl, lo, hi, band='plankA', mat=MAT_TIMBER, seed=0, bevel=0.012, along='x', u0=0.0, end_tile=4,
             jitter=0.004, ends=(True, True)):
    """An adzed squared beam (box lo..hi, long axis `along`) with chamfered arrises; trim-sheet UVs: the long faces
    run along a band, the ends take an end-grain tile."""
    r = K.rng(seed)
    lo, hi = Vector(lo), Vector(hi)
    ax = {'x': 0, 'y': 1, 'z': 2}[along]
    o1, o2 = [i for i in range(3) if i != ax]
    L = hi[ax] - lo[ax]
    w1, w2 = hi[o1] - lo[o1], hi[o2] - lo[o2]
    c1, c2 = (lo[o1] + hi[o1]) / 2, (lo[o2] + hi[o2]) / 2
    # cross-section: an octagon (chamfered square), slightly irregular
    b = min(bevel, w1 * 0.3, w2 * 0.3)
    prof = [(w1 / 2, -w2 / 2 + b), (w1 / 2, w2 / 2 - b), (w1 / 2 - b, w2 / 2), (-w1 / 2 + b, w2 / 2),
            (-w1 / 2, w2 / 2 - b), (-w1 / 2, -w2 / 2 + b), (-w1 / 2 + b, -w2 / 2), (w1 / 2 - b, -w2 / 2)]
    nseg = max(1, int(round(L / 0.5)))
    rings = []
    for k in range(nseg + 1):
        t = k / nseg
        ring = []
        for (a1, a2) in prof:
            v = [0.0, 0.0, 0.0]
            v[ax] = lo[ax] + L * t
            v[o1] = c1 + a1 + (r.uniform(-1, 1) * jitter if 0 < k < nseg else 0)
            v[o2] = c2 + a2 + (r.uniform(-1, 1) * jitter if 0 < k < nseg else 0)
            ring.append(bm.verts.new(v))
        rings.append(ring)
    n = len(prof)
    # perimeter positions for v within the band
    per = [0.0]
    for i in range(n):
        a, c = prof[i], prof[(i + 1) % n]
        per.append(per[-1] + math.hypot(c[0] - a[0], c[1] - a[1]))
    tot = per[-1]
    scale_v = (K.TRIM[band][1] - K.TRIM[band][0]) / 0.5           # band height is 0.5 m of texture
    faces = []
    for k in range(nseg):
        for i in range(n):
            f = bm.faces.new([rings[k][i], rings[k + 1][i], rings[k + 1][(i + 1) % n], rings[k][(i + 1) % n]])
            f.material_index = mat
            ua, ub = u0 + (L * k / nseg) / 2.0, u0 + (L * (k + 1) / nseg) / 2.0
            va = K.trim_v(band, (per[i] / max(tot, 0.5)) * min(1.0, tot / 0.5))
            vb = K.trim_v(band, (per[i + 1] / max(tot, 0.5)) * min(1.0, tot / 0.5))
            for l, uv in zip(f.loops, [(ua, va), (ub, va), (ub, vb), (ua, vb)]):
                l[uvl].uv = uv
            faces.append(f)
    for e_i, ring in ((0, rings[0]), (1, rings[-1])):
        if not ends[e_i]:
            continue
        f = bm.faces.new(ring if e_i == 1 else ring[::-1])
        f.material_index = mat
        for l in f.loops:
            co = l.vert.co
            du = (co[o1] - c1) / max(w1, w2) * 2
            dv = (co[o2] - c2) / max(w1, w2) * 2
            l[uvl].uv = K.end_tile_uv(end_tile, du, dv)
        faces.append(f)
    return faces


def log_cyl(bm, uvl, a, b, radius, seed=0, band='bark', sides=10, mat=MAT_TIMBER, end_tile=0, taper=0.0,
            wobble=0.01, ends=(True, True), u0=0.0, seg_len=0.5):
    """A round log/pole from a to b (radius m), with bark or pole band UVs and end-grain caps."""
    r = K.rng(seed)
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    z = d.normalized()
    x = z.cross(Vector((0, 0, 1)))
    if x.length < 1e-4:
        x = z.cross(Vector((1, 0, 0)))
    x.normalize()
    y = z.cross(x)
    nseg = max(1, int(round(L / seg_len)))
    rings = []
    ph = r.uniform(0, 6.28)
    for k in range(nseg + 1):
        t = k / nseg
        rad = radius * (1 - taper * t)
        c = a + d * t
        if 0 < k < nseg:
            c += x * r.uniform(-wobble, wobble) + y * r.uniform(-wobble, wobble)
        ring = []
        for i in range(sides):
            ang = 2 * math.pi * i / sides + ph
            rr = rad * (1 + 0.06 * K.noise3((i * 0.7, k * 0.9, seed), seed))
            ring.append(bm.verts.new(c + (x * math.cos(ang) + y * math.sin(ang)) * rr))
        rings.append(ring)
    circ = 2 * math.pi * radius
    vspan = min(1.0, circ / 0.5) if band != 'pole' else min(1.0, circ / 0.25)
    faces = []
    for k in range(nseg):
        for i in range(sides):
            j = (i + 1) % sides
            f = bm.faces.new([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]])
            f.material_index = mat
            f.smooth = True
            ua, ub = u0 + (L * k / nseg) / 2.0, u0 + (L * (k + 1) / nseg) / 2.0
            va, vb = K.trim_v(band, vspan * i / sides), K.trim_v(band, vspan * (i + 1) / sides)
            for l, uv in zip(f.loops, [(ua, va), (ua, vb), (ub, vb), (ub, va)]):
                l[uvl].uv = uv
            faces.append(f)
    for e_i, ring in ((0, rings[0]), (1, rings[-1])):
        if not ends[e_i]:
            continue
        f = bm.faces.new(ring[::-1] if e_i == 0 else ring)
        f.material_index = mat
        cen = sum((v.co for v in ring), Vector()) / len(ring)
        for l in f.loops:
            dv = l.vert.co - cen
            l[uvl].uv = K.end_tile_uv(end_tile, dv.dot(x) / radius, dv.dot(y) / radius)
        faces.append(f)
    return faces


# ---------------------------------------------------------------- walls with openings

class Opening:
    """A rectangular opening through a wall: x0..x1 along the run, z0..z1 up. kind 'door' or 'window'."""

    def __init__(self, kind, x0, x1, z0, z1, lintel=0.16, bearing=0.22, beams=1):
        self.kind, self.x0, self.x1, self.z0, self.z1 = kind, x0, x1, z0, z1
        self.lintel, self.bearing, self.beams = lintel, bearing, beams


def _front_path_plane(x0, y0):
    return lambda s, t, d: Vector((x0 + s, y0 + d, t))


def build_wall(name, W, H, T, seed, lod, openings=(), base=True, back=True, density=1.0, bulge_amp=None,
               t_range=(0.75, None), top_wear=0.0, damp=0.55, cap=False, two_sided=False, extra=None, post=None, caps=True,
               step=None, base_h=BASE_H, band_amp=1.0, patch_scale=1.0, gullies=0, B=None, finish=True):
    """A straight wall piece. Returns the object (materials MATS)."""
    step = step or STEP[lod]
    B = B or Builder()
    uvl = B.uv
    wear = Wear(seed, W, H, base=base, density=density, t_range=t_range, lod=lod, base_h=base_h, band_amp=band_amp,
                patch_scale=patch_scale)
    add_gullies(wear, W, H, gullies, seed)
    re = 0.035                              # radius of the rounded arris at an opening
    for o in openings:
        foot = 1.0 if o.kind == 'door' else 0.0
        reach = 0.09 if o.kind == 'door' else 0.05
        # the jambs' front arrises, the sill's for a window; plaster kept around the lintel's bearing
        wear.line((o.x0, 0, o.z0), (o.x0, 0, o.z1), reach, 1.0, foot)
        wear.line((o.x1, 0, o.z0), (o.x1, 0, o.z1), reach, 1.0, foot)
        if o.kind == 'window':
            wear.line((o.x0, 0, o.z0), (o.x1, 0, o.z0), 0.06, 1.0, 0.0)
    rel = relief3(seed)

    def F(p):
        return wear(p)

    # skip regions on the faces: the opening grown by the arris radius, plus the lintel slot
    def in_front_hole(x, z):
        for o in openings:
            g = re if o.kind == 'door' else 0.0
            if o.x0 - g < x < o.x1 + g and o.z0 - (0.0 if o.kind == 'window' else 1.0) < z < o.z1 + g:
                return True
            if o.x0 - o.bearing < x < o.x1 + o.bearing and o.z1 < z < o.z1 + o.lintel:
                return True
        return False

    breaks_x, breaks_z = [], []
    for o in openings:
        g = re if o.kind == 'door' else 0.0
        breaks_x += [o.x0 - g, o.x1 + g, o.x0 - o.bearing, o.x1 + o.bearing]
        breaks_z += [o.z1, o.z1 + o.lintel] + ([o.z1 + g] if g else []) + ([o.z0] if o.kind == 'window' else [])

    def face(tag, flip, Fn, wear_on=True):
        x0 = 0.0
        if flip:
            P = lambda s, t, d: Vector((W - s, T - d, t))
            hole = lambda s, t: in_front_hole(W - s, t)
            bx = [W - b for b in breaks_x]
        else:
            P = lambda s, t, d: Vector((s, d, t))
            hole = lambda s, t: in_front_hole(s, t)
            bx = breaks_x
        st = step if (wear_on or lod == 2) else max(step, 0.5 if lod else 0.25)
        s_ax = axis(0.0, W, st, bx)
        t_ax = axis(0.0, H, st, breaks_z)
        Ff = (lambda s, t: Fn(P(s, t, 0))) if wear_on else None
        relief = (lambda s, t: rel(P(s, t, 0))) if (wear_on and lod < 2) else None
        layered(B, tag, P, s_ax, t_ax, Ff, p=P_THICK, skip=hole, only_plaster=not wear_on, relief=relief,
                uv_off=(0.0, 0.0))
        return s_ax, t_ax

    s_front, t_front = face('f', False, F, True)
    if back:
        if two_sided:
            wear_b = Wear(seed + 101, W, H, base=base, density=density, t_range=t_range, lod=lod, base_h=base_h,
                          band_amp=band_amp, patch_scale=patch_scale)
            add_gullies(wear_b, W, H, gullies, seed + 101)
            face('b', True, lambda p: wear_b((W - p[0], T - p[1], p[2])), True)
        else:
            face('b', True, None, False)
    # reveals: door jambs turn round a rounded arris; window jambs and sills are plain (their arrises wear instead)
    def zsamp(z0, z1):
        return [z for z in t_front if z0 - 1e-6 <= z <= z1 + 1e-6]

    def xsamp(x0, x1):
        return [x for x in s_front if x0 - 1e-6 <= x <= x1 + 1e-6]
    for k, o in enumerate(openings):
        r_ = re if o.kind == 'door' else 0.0
        arc = math.pi / 2 * r_
        for side in (0, 1):
            xe = o.x0 if side == 0 else o.x1
            m = 1.0 if side == 0 else -1.0       # outward normal of the reveal: +x (left jamb), -x (right)

            def path(s, t, d, xe=xe, m=m, r_=r_, arc=arc):
                if r_ > 0 and s < arc:
                    a = s / r_
                    nx, ny = m * math.sin(a), -math.cos(a)
                    px, py = xe - m * r_ + r_ * nx, r_ + r_ * ny
                    return Vector((px - nx * d, py - ny * d, t))
                return Vector((xe - m * d, r_ + (s - arc), t))
            s_ax = axis(0.0, arc + (T - r_), step, [arc] if r_ > 0 else [])
            z_ax = zsamp(o.z0, o.z1)
            layered(B, ('j', k, side), path, s_ax, z_ax, lambda s, t, path=path: F(path(s, t, 0)), p=P_THICK * 0.8,
                    relief=(lambda s, t, path=path: rel(path(s, t, 0))) if lod < 2 else None)
        if o.kind == 'window':
            def sill(s, t, d, o=o):
                return Vector((t, s, o.z0 - d))
            layered(B, ('s', k), sill, axis(0.0, T, step, []), xsamp(o.x0, o.x1), lambda s, t, sill=sill: F(sill(s, t, 0)),
                    p=P_THICK * 0.8, relief=(lambda s, t, sill=sill: rel(sill(s, t, 0))) if lod < 2 else None)
    bm = B.bm
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    # lintels: an adzed beam over each opening, its front just proud of the plaster
    for k, o in enumerate(openings):
        hb = o.lintel / o.beams
        for j in range(o.beams):
            sh = (0.01 if j % 2 else -0.004) * (o.beams > 1)
            beam_box(bm, uvl, (o.x0 - o.bearing + 0.01 + sh, -0.012 + sh, o.z1 + j * hb), (o.x1 + o.bearing - 0.01 - sh, T + 0.005, o.z1 + (j + 1) * hb - 0.004 * (j < o.beams - 1)),
                     band='plankA' if j == 0 else 'plankB', seed=seed + 7 * k + j, bevel=0.014, along='x',
                     u0=K.rng(seed + k + j).random(), ends=(False, False), jitter=0.003 if lod == 0 else 0.0)
    if extra:
        extra(bm, uvl)
    if not finish:
        return B
    if caps:
        def quad(pts, mat, uvs):
            f = bm.faces.new([bm.verts.new(p_) for p_ in pts])
            f.material_index = mat
            for l, u in zip(f.loops, uvs):
                l[uvl].uv = u
        # ends (brick, hidden by neighbours) and top (plaster, under the roof)
        quad([(0, T, 0), (0, P_THICK, 0), (0, P_THICK, H), (0, T, H)], MAT_BRICK, [(T / 2, 0), (0, 0), (0, H / 2), (T / 2, H / 2)])
        quad([(W, P_THICK, 0), (W, T, 0), (W, T, H), (W, P_THICK, H)], MAT_BRICK, [(0, 0), (T / 2, 0), (T / 2, H / 2), (0, H / 2)])
        quad([(0, 0, H), (0, T, H), (W, T, H), (W, 0, H)], MAT_PLASTER, [(0, 0), (0, T / 2), (W / 2, T / 2), (W / 2, 0)])
    ob = K.new_object(name, bm, MATS)
    amp = (bulge_amp if bulge_amp is not None else 0.035) * min(1.0, W / 4.0)
    bf = bulge(W, H, seed, amp) if amp > 0 else None
    for v in ob.data.vertices:
        if bf:
            v.co.y += bf(v.co.x, v.co.z)
    ob.data.update()
    K.paint(ob, grime(H, seed, damp), mode='set')
    if post:
        post(ob)
    return ob


# ---------------------------------------------------------------- corners

def build_corner(name, H, T, seed, lod, rc=0.08, base=True, damp=0.55, density=1.0):
    """An external corner: the T x T column at x 0..T, y 0..T, exterior faces -Y (front) and -X (left), rounded arris
    at the origin. The previous run ends on its left face (at y = T), the next run starts at x = T."""
    step = STEP[lod]
    L1 = T - rc
    La = math.pi / 2 * rc
    L = 2 * L1 + La

    def P(s, t, d):
        if s <= L1:
            px, py, nx, ny = 0.0, T - s, -1.0, 0.0
        elif s <= L1 + La:
            a = (s - L1) / rc
            nx, ny = -math.cos(a), -math.sin(a)
            px, py = rc + rc * nx, rc + rc * ny
        else:
            px, py, nx, ny = rc + (s - L1 - La), 0.0, 0.0, -1.0
        return Vector((px - nx * d, py - ny * d, t))
    wear = Wear(seed, L, H, base=base, density=density * 0.6, lod=lod)
    sm = L1 + La / 2
    wear.line((sm, 0, 0), (sm, 0, H), 0.11, 1.0, 1.2)
    rel = relief3(seed)
    B = Builder()
    s_ax = axis(0.0, L, step, [L1, L1 + La])
    t_ax = axis(0.0, H, step, [])
    layered(B, 'c', P, s_ax, t_ax, lambda s, t: wear((s, 0.0, t)), p=P_THICK,
            relief=(lambda s, t: rel(P(s, t, 0))) if lod < 2 else None)
    bm = B.bm
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    ob = K.new_object(name, bm, MATS)
    K.paint(ob, grime(H, seed, damp), mode='set')
    return ob


def finalize_lod(ob, lod, ratio=None):
    """Decimate a generated LOD (LOD0 is built dense and reduced)."""
    r = ratio if ratio is not None else DECIMATE[lod]
    if r < 0.999:
        m = ob.modifiers.new('dec', 'DECIMATE')
        m.ratio = r
        m.use_collapse_triangulate = True
        K.apply_modifiers(ob)
    return ob
