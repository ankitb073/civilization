"""Layered mud surfaces: a skin of plaster over mud brick, with the plaster worn away where a wear field F > 0.

A surface is a parameter patch P(s, t, d) -> point: s and t run across the surface (metres), d is depth into the wall
(0 = plaster face). The patch is sampled on a grid (s_ax x t_ax); each cell is split into two triangles and cut by
marching triangles at F = 0, so the edge of the plaster follows a smooth contour, not the grid:
  - plaster faces sit at depth ~0 (small relief; sinking toward a worn edge so the edge looks eroded, not cut);
  - brick faces sit at depth p (+ a little more erosion further inside the worn patch);
  - a lip strip joins the two along the contour (the plaster's broken edge, 2-3 cm).
UVs are (s, t) / tile so plaster and brick textures run continuously over bends (rounded corners, jambs).
Faces get material index MAT_PLASTER or MAT_BRICK (the caller maps indices to M_MudPlaster / M_MudBrick).
"""
import math
import bmesh
from mathutils import Vector

MAT_PLASTER, MAT_BRICK = 0, 1


class Builder:
    """Accumulates welded vertices and faces into one bmesh."""

    def __init__(self, bm=None):
        self.bm = bm or bmesh.new()
        self.uv = self.bm.loops.layers.uv.get('UVMap') or self.bm.loops.layers.uv.new('UVMap')
        self.verts = {}

    def v(self, key, co):
        vv = self.verts.get(key)
        if vv is None:
            vv = self.bm.verts.new(co)
            self.verts[key] = vv
        return vv

    def face(self, vs, uvs, mat, flip=False):
        if flip:
            vs, uvs = vs[::-1], uvs[::-1]
        # drop repeated verts (degenerate iso points at a corner)
        out_v, out_uv = [], []
        for a, u in zip(vs, uvs):
            if out_v and out_v[-1] is a:
                continue
            out_v.append(a)
            out_uv.append(u)
        if len(out_v) > 2 and out_v[0] is out_v[-1]:
            out_v.pop()
            out_uv.pop()
        if len(out_v) < 3 or len(set(out_v)) < len(out_v):
            return None
        try:
            f = self.bm.faces.new(out_v)
        except ValueError:
            return None
        f.material_index = mat
        f.smooth = True
        for l, u in zip(f.loops, out_uv):
            l[self.uv].uv = u
        return f


def layered(B, tag, P, s_ax, t_ax, F, p=0.025, rec=0.02, lipround=0.45, relief=None, skip=None, tile=2.0,
            uv_off=(0.0, 0.0), only_plaster=False, brick_depth=None, uvf=None, mats=(MAT_PLASTER, MAT_BRICK)):
    """Add a layered surface to builder B. P(s, t, d) -> Vector. F(s, t) -> wear in metres (+ = plaster gone).
    relief(s, t) -> extra plaster depth (m, small). skip(s, t) -> True to leave a cell out (openings).
    brick_depth(s, t, F) overrides the brick depth. Returns nothing; faces go into B."""
    ns, nt = len(s_ax), len(t_ax)
    Fv = [[(-1.0 if only_plaster else F(s, t)) for t in t_ax] for s in s_ax]
    # orientation: is (dP/ds x dP/dt) pointing out of the wall (toward smaller d)?
    s0, t0 = s_ax[ns // 2], t_ax[nt // 2]
    ds, dt = (s_ax[1] - s_ax[0]) * 0.5, (t_ax[1] - t_ax[0]) * 0.5
    a = P(s0 + ds, t0, 0) - P(s0, t0, 0)
    b = P(s0, t0 + dt, 0) - P(s0, t0, 0)
    inward = P(s0, t0, 0.01) - P(s0, t0, 0)
    flip = a.cross(b).dot(inward) > 0

    def dP(s, t, f):
        d = 0.0
        if relief:
            d += relief(s, t)
        if f > -0.05:
            d += lipround * p * (1 - min(1.0, -f / 0.05)) ** 2
        return d

    def dB(s, t, f):
        if brick_depth:
            return brick_depth(s, t, f)
        return p + rec * min(1.0, max(0.0, f / 0.08)) ** 0.7

    def uvof(s, t, layer='P'):
        if uvf:
            return uvf(s, t, layer)
        return ((s + uv_off[0]) / tile, (t + uv_off[1]) / tile)

    def node(i, j, layer):
        s, t, f = s_ax[i], t_ax[j], Fv[i][j]
        d = dP(s, t, min(f, 0.0)) if layer == 'P' else dB(s, t, max(f, 0.0))
        return B.v((tag, 'n', i, j, layer), P(s, t, d)), uvof(s, t, layer)

    iso_cache = {}

    def iso(n1, n2, layer):
        k = (min(n1, n2), max(n1, n2))
        (i1, j1), (i2, j2) = k
        f1, f2 = Fv[i1][j1], Fv[i2][j2]
        u = f1 / (f1 - f2)
        u = min(0.98, max(0.02, u))
        s = s_ax[i1] + (s_ax[i2] - s_ax[i1]) * u
        t = t_ax[j1] + (t_ax[j2] - t_ax[j1]) * u
        d = dP(s, t, 0.0) if layer == 'P' else dB(s, t, 0.0)
        return B.v((tag, 'e', k, layer), P(s, t, d)), uvof(s, t, layer)

    for i in range(ns - 1):
        for j in range(nt - 1):
            sc, tc = (s_ax[i] + s_ax[i + 1]) / 2, (t_ax[j] + t_ax[j + 1]) / 2
            if skip and skip(sc, tc):
                continue
            # two triangles, CCW in (s, t); alternate the diagonal for an even mesh
            c = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            tris = [(c[0], c[1], c[2]), (c[0], c[2], c[3])] if (i + j) % 2 == 0 else [(c[0], c[1], c[3]), (c[1], c[2], c[3])]
            for tri in tris:
                _march(B, tri, Fv, node, iso, flip, mats)


def _march(B, tri, Fv, node, iso, flip, mats=(MAT_PLASTER, MAT_BRICK)):
    hole = [Fv[i][j] > 0 for (i, j) in tri]
    nh = sum(hole)
    if nh == 0 or nh == 3:
        layer, mat = ('B', mats[1]) if nh == 3 else ('P', mats[0])
        vs, uvs = zip(*[node(i, j, layer) for (i, j) in tri])
        B.face(list(vs), list(uvs), mat, flip)
        return
    # walk the boundary: corners and iso points, CCW
    seq = []
    for k in range(3):
        a, b = tri[k], tri[(k + 1) % 3]
        seq.append(('c', a))
        if hole[k] != hole[(k + 1) % 3]:
            seq.append(('e', (a, b)))
    for cls, layer, mat in ((False, 'P', mats[0]), (True, 'B', mats[1])):
        vs, uvs, isos = [], [], []
        for kind, x in seq:
            if kind == 'c':
                if hole[tri.index(x)] == cls:
                    v, u = node(x[0], x[1], layer)
                    vs.append(v)
                    uvs.append(u)
            else:
                v, u = iso(x[0], x[1], layer)
                vs.append(v)
                uvs.append(u)
                isos.append(x)
        B.face(vs, uvs, mat, flip)
        if not cls:
            # the lip along the contour: in the plaster polygon the two iso points are adjacent and the contour edge
            # runs Y -> X, where X is the iso point followed (in boundary order) by a plaster corner. The lip
            # reverses that edge on top: [P(X), P(Y), B(Y), B(X)].
            L = len(seq)
            X = Y = None
            for n, (kd, x) in enumerate(seq):
                if kd != 'e':
                    continue
                nxt = seq[(n + 1) % L][1]
                if not hole[tri.index(nxt)]:
                    X = x
                else:
                    Y = x
            px, ux = iso(X[0], X[1], 'P')
            py, uy = iso(Y[0], Y[1], 'P')
            by, vy = iso(Y[0], Y[1], 'B')
            bx, vx = iso(X[0], X[1], 'B')
            B.face([px, py, by, bx], [ux, uy, vy, vx], mats[0], flip)


def axis(a, b, step, extra=()):
    """Sorted grid coordinates from a to b, about `step` apart, always including the extra break values (uniform
    values closer than 30% of a step to a break are dropped)."""
    n = max(1, int(math.ceil((b - a) / step - 1e-6)))
    ex = sorted({round(e, 6) for e in extra if a - 1e-9 <= e <= b + 1e-9} | {round(a, 6), round(b, 6)})
    uni = [round(a + (b - a) * k / n, 6) for k in range(n + 1)]
    keep = [u for u in uni if all(abs(u - e) >= step * 0.3 for e in ex)]
    return sorted(set(keep) | set(ex))
