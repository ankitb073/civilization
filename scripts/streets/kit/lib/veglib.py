"""veglib: geometry for the vegetation pack (cards, fronds, trunks, branches), built as plain lists and turned into a
mesh with custom per-corner normals, UVs and the 'Col' colour, so foliage cards can carry bent ("volume") normals.

Foliage cards are emitted twice (a front and a back face, each wound outward) and the material is single-sided:
three.js flips the normal of a double-sided material's back faces, which would undo bent normals, so both faces of a
card carry the normals we choose here.
"""
import math
import os
import sys
import bpy
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from textures_veg import region_uv  # noqa: E402

UP = Vector((0, 0, 1))


class Acc:
    """Accumulates faces with per-corner data."""

    def __init__(self):
        self.V, self.F, self.UV, self.N, self.C, self.M = [], [], [], [], [], []

    def face(self, pts, uvs, normals, cols, mat=0):
        base = len(self.V)
        self.V += [tuple(p) for p in pts]
        self.F.append(tuple(range(base, base + len(pts))))
        self.UV += [tuple(u) for u in uvs]
        self.N += [tuple(Vector(n).normalized()) for n in normals]
        self.C += [tuple(c) for c in cols]
        self.M.append(mat)

    def tris(self):
        return sum(len(f) - 2 for f in self.F)

    def to_object(self, name, mats, coll):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.V, [], self.F)
        me.update()
        uv = me.uv_layers.new(name='UVMap')
        for i, u in enumerate(self.UV):
            uv.data[i].uv = u
        col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        for i, c in enumerate(self.C):
            col.data[i].color = (c[0], c[1], c[2], 1.0)
        me.color_attributes.active_color = col
        for p, m in zip(me.polygons, self.M):
            p.material_index = m
            p.use_smooth = True
        me.normals_split_custom_set(self.N)
        for mn in mats:
            import kitlib as K
            me.materials.append(K.material(mn))
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        return ob


def clamp_hemi(n, f, c=0.35):
    """Pull normal n toward face normal f until dot(n, f) >= c."""
    n = Vector(n).normalized()
    d = n.dot(f)
    if d >= c:
        return n
    # rotate within the plane of n and f: n' = cos(a) f + sin(a) t, with t the part of n perpendicular to f
    t = n - f * d
    t = t.normalized() if t.length > 1e-6 else Vector((0, 0, 1))
    return (f * c + t * math.sqrt(max(0.0, 1 - c * c))).normalized()


def grid_card(acc, P, region, ns, nt, normal_fn, col_fn, mat=0, both=True, shared=True, s_range=(0.0, 1.0),
              t_range=(0.0, 1.0), eps=0.0008):
    """A card over parameters s (along u of the region) and t (along v), P(s, t) -> point.
    normal_fn(p, face_normal) -> the normal for the front side; col_fn(s, t) -> rgb.
    both: also emit the back face; shared: the back face gets the same normals (volume), else the mirrored ones."""
    u0, v0, u1, v1 = region_uv(region) if isinstance(region, str) else region
    S = [s_range[0] + (s_range[1] - s_range[0]) * i / ns for i in range(ns + 1)]
    T = [t_range[0] + (t_range[1] - t_range[0]) * j / nt for j in range(nt + 1)]
    pts = [[P(s, t) for t in T] for s in S]
    for i in range(ns):
        for j in range(nt):
            q = [pts[i][j], pts[i + 1][j], pts[i + 1][j + 1], pts[i][j + 1]]
            st = [(S[i], T[j]), (S[i + 1], T[j]), (S[i + 1], T[j + 1]), (S[i], T[j + 1])]
            fn = (q[1] - q[0]).cross(q[3] - q[0])
            if fn.length < 1e-12:
                fn = (q[2] - q[1]).cross(q[3] - q[1])
            fn = fn.normalized() if fn.length > 1e-12 else Vector(UP)
            uvs = [(u0 + (u1 - u0) * s, v0 + (v1 - v0) * t) for s, t in st]
            ns_ = [clamp_hemi(normal_fn(p, fn), fn) for p in q]
            cs = [col_fn(s, t) for s, t in st]
            # the two faces sit eps apart, each on its own side, so whichever faces the viewer is also the nearer one
            # (a renderer without back-face culling, like Cycles, then never shows the far face's flipped normal)
            off = fn * eps if both else Vector((0, 0, 0))
            acc.face([p + off for p in q], uvs, ns_, cs, mat)
            if both:
                # each face bends its own normal (toward the plant's outside or up), kept in its own hemisphere:
                # a shading normal facing away from the visible side renders black in Cycles and wrong in three
                nb = [clamp_hemi(normal_fn(p, -fn), -fn) for p in q]
                acc.face([p - off for p in q[::-1]], uvs[::-1], nb[::-1], cs[::-1], mat)


def tube(acc, pts, radii, sides, mat, v_scale, col_fn, jitter=None, u_wrap=1.0, cap=False):
    """A tube along pts with radii; UV u around (0..u_wrap), v = arc length * v_scale; smooth radial normals."""
    n = len(pts)
    frames = []
    prev_x = None
    for i in range(n):
        d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        if prev_x is None:
            x = d.cross(Vector((0, 1, 0)))
            if x.length < 1e-4:
                x = d.cross(Vector((1, 0, 0)))
        else:
            x = prev_x - d * prev_x.dot(d)
        x.normalize()
        y = d.cross(x)
        frames.append((x, y))
        prev_x = x
    arc = [0.0]
    for i in range(1, n):
        arc.append(arc[-1] + (pts[i] - pts[i - 1]).length)
    ring = []
    for i in range(n):
        x, y = frames[i]
        r = []
        for k in range(sides + 1):
            a = 2 * math.pi * k / sides
            nrm = x * math.cos(a) + y * math.sin(a)
            rr = radii[i] * (1 + (jitter(i, k % sides) if jitter else 0.0))
            r.append((pts[i] + nrm * rr, nrm, (u_wrap * k / sides, arc[i] * v_scale)))
        ring.append(r)
    for i in range(n - 1):
        for k in range(sides):
            a, b, c, d = ring[i][k], ring[i][k + 1], ring[i + 1][k + 1], ring[i + 1][k]
            acc.face([a[0], b[0], c[0], d[0]], [a[2], b[2], c[2], d[2]], [a[1], b[1], c[1], d[1]],
                     [col_fn(i / (n - 1), a[0]), col_fn(i / (n - 1), b[0]), col_fn((i + 1) / (n - 1), c[0]), col_fn((i + 1) / (n - 1), d[0])], mat)
    if cap:
        top = ring[-1][:-1]
        c = sum((t[0] for t in top), Vector()) / len(top)
        d = (pts[-1] - pts[-2]).normalized()
        for k in range(sides):
            a, b = top[k], top[(k + 1) % sides]
            acc.face([a[0], b[0], c], [(0.5, 0.5), (0.5, 0.5), (0.5, 0.5)], [d, d, d], [col_fn(1, c)] * 3, mat)


def bezier(p0, p1, p2, p3, n):
    out = []
    for i in range(n + 1):
        t = i / n
        a = (1 - t) ** 3
        b = 3 * (1 - t) ** 2 * t
        c = 3 * (1 - t) * t * t
        d = t ** 3
        out.append(p0 * a + p1 * b + p2 * c + p3 * d)
    return out


def resample(pts, n):
    """n+1 points evenly spaced by arc length along a polyline."""
    arc = [0.0]
    for i in range(1, len(pts)):
        arc.append(arc[-1] + (pts[i] - pts[i - 1]).length)
    L = arc[-1]
    out = []
    j = 0
    for i in range(n + 1):
        s = L * i / n
        while j < len(arc) - 2 and arc[j + 1] < s:
            j += 1
        f = (s - arc[j]) / max(1e-9, arc[j + 1] - arc[j])
        out.append(pts[j].lerp(pts[j + 1], min(1.0, max(0.0, f))))
    return out
