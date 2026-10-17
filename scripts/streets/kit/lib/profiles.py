"""Profiles swept along a run: parapets, courtyard walls, roof edges, wall-walk kerbs.

A profile lives in the plane across a run: (z, y) where z points outward (glTF +Z = Blender -Y) and y is up. It is a
chain of lines and arcs walked so that the outward normal is the tangent turned clockwise (front faces go up, tops
go backward, back faces go down). sweep() lays a layered plaster/brick surface over (s along the profile, x along the
run), optionally mitred at either end for corner pieces.
"""
import math
from mathutils import Vector
import kitlib as K
from surface import layered, axis


class Profile:
    def __init__(self, start):
        self.segs = []          # ('L', p0, p1) | ('A', c, r, a0, a1)
        self.pos = (float(start[0]), float(start[1]))
        self.breaks = [0.0]
        self.length = 0.0

    def line(self, z, y):
        p0, p1 = self.pos, (float(z), float(y))
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        if L > 1e-6:
            self.segs.append(('L', p0, p1, self.length, L))
            self.length += L
            self.breaks.append(self.length)
        self.pos = p1
        return self

    def arc(self, cz, cy, r, a1):
        """Arc from the current point around centre (cz, cy) to angle a1 (radians, in the (z, y) plane)."""
        a0 = math.atan2(self.pos[1] - cy, self.pos[0] - cz)
        L = abs(a1 - a0) * r
        self.segs.append(('A', (cz, cy), r, a0, a1, self.length, L))
        self.length += L
        self.breaks.append(self.length)
        self.pos = (cz + r * math.cos(a1), cy + r * math.sin(a1))
        return self

    def at(self, s):
        """(z, y, nz, ny) at arc length s."""
        s = min(max(s, 0.0), self.length)
        for sg in self.segs:
            if sg[0] == 'L':
                _, p0, p1, s0, L = sg
                if s <= s0 + L + 1e-9:
                    u = (s - s0) / L
                    tz, ty = (p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L
                    return p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u, ty, -tz
            else:
                _, c, r, a0, a1, s0, L = sg
                if s <= s0 + L + 1e-9:
                    a = a0 + (a1 - a0) * ((s - s0) / L if L > 0 else 0)
                    pz, py = c[0] + r * math.cos(a), c[1] + r * math.sin(a)
                    sgn = 1.0 if a1 > a0 else -1.0
                    tz, ty = -math.sin(a) * sgn, math.cos(a) * sgn
                    return pz, py, ty, -tz
        sg = self.segs[-1]
        return self.at(self.length - 1e-9)


def sweep_P(prof, x0, x1, miter0=False, miter1=False, xform=None):
    """P(s, t, d) for a profile swept along x (t is 0..1 along the run). A mitred end follows the corner diagonal
    x = x_end -/+ z (so two pieces meeting at a right-angled corner join exactly). xform(Vector) -> Vector maps the
    result (e.g. to rotate a mitred half into the other arm of a corner)."""
    def P(s, t, d):
        z, y, nz, ny = prof.at(s)
        za = z - nz * d
        ya = y - ny * d
        a = x0 - z if miter0 else x0
        b = x1 + z if miter1 else x1
        x = a + (b - a) * t
        v = Vector((x, -za, ya))
        return xform(v) if xform else v
    return P


def sweep(B, tag, prof, x0, x1, F3, step, miter0=False, miter1=False, xform=None, p=0.02, relief=None, mats=(0, 1),
          only_plaster=False, tile=2.0, t_breaks=(), lod=0):
    """Layered surface over a swept profile. F3(point) -> wear (m). UVs: u along the run (metres/tile), v along the
    profile, so brick courses run level on the vertical faces."""
    P = sweep_P(prof, x0, x1, miter0, miter1, xform)
    s_ax = axis(0.0, prof.length, step, prof.breaks)
    n = max(1, int(math.ceil((x1 - x0) / step)))
    t_ax = sorted(set([k / n for k in range(n + 1)] + [b for b in t_breaks]))

    v0 = prof.at(0.0)[1]
    Pu = sweep_P(prof, x0, x1, miter0, miter1)

    def uvf(s, t, layer):
        # u along the run, v along the profile (equal to height up a front face that starts at its foot)
        return (Pu(s, t, 0.0).x / tile, (s + v0) / tile)
    Ff = None if only_plaster else (lambda s, t: F3(P(s, t, 0.0)))
    rel = (lambda s, t: relief(P(s, t, 0.0))) if relief else None
    layered(B, tag, P, s_ax, t_ax, Ff, p=p, relief=rel, uvf=uvf, mats=mats, only_plaster=only_plaster)
    return s_ax, t_ax
