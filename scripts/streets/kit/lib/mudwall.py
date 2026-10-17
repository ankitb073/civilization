"""Mud-brick walls with a worn plaster skin: wear fields and the wall, corner and opening builders.

Blender frame of a wall piece (glTF: x along the run, y up, exterior +Z):
  x in [0, W] along the run, z in [0, H] up, y in [0, T] into the wall; the exterior plaster face is y = 0 (facing -Y).
The plaster is worn back to brick in a ragged band along the foot and in patches; the band meets the piece's ends at a
fixed height (BASE_H) and nothing else touches the ends, so any two pieces placed side by side join without a seam.
"""
import math
import bmesh
from mathutils import Vector
import kitlib as K
from surface import Builder, layered, axis, MAT_PLASTER, MAT_BRICK

BASE_H = 0.30        # height of the worn band where pieces meet (m)
P_THICK = 0.02       # plaster thickness (m)
SEAM = 0.32          # no wear patches this close to a piece's ends


def win(s, W, m=SEAM):
    return K.smoothstep(0.0, m, s) * K.smoothstep(0.0, m, W - s)


def wear_field(W, H, seed, base_h=BASE_H, band_amp=1.0, patches=None, density=1.0, opening_wear=(), seam=SEAM,
               top_wear=0.0, ends=(True, True)):
    """F(s, t): metres, > 0 where the plaster is gone. `ends` (left, right): True keeps the band at base_h at that end
    (a seam with a neighbour); False lets the wear run free (a free end)."""
    r = K.rng(seed)
    # erosion tongues climbing from the foot
    tongues = []
    for _ in range(int(W / 2.2 * density + r.random())):
        tongues.append((r.uniform(seam + 0.2, max(seam + 0.25, W - seam - 0.2)), r.uniform(0.12, 0.38) * band_amp, r.uniform(0.12, 0.3)))
    if patches is None:
        patches = []
        n = int(round(W * H / 4.5 * density + r.random() * 0.8))
        for _ in range(n):
            rx, rz = r.uniform(0.1, 0.42), r.uniform(0.08, 0.3)
            if W - 2 * (seam + rx) < 0.05:
                continue
            cx = r.uniform(seam + rx, W - seam - rx)
            cz = r.uniform(0.75, max(0.8, H - 0.45))
            patches.append((cx, cz, rx, rz, r.random() * 100))
            # flakes around a worn patch
            for _k in range(r.randint(1, 4)):
                fx = cx + r.uniform(-1.6, 1.6) * rx
                fz = cz + r.uniform(-1.8, 1.8) * rz
                fr = r.uniform(0.03, 0.08)
                if seam + fr < fx < W - seam - fr and 0.4 < fz < H - 0.2:
                    patches.append((fx, fz, fr * r.uniform(0.8, 1.5), fr, r.random() * 100))
    patches = list(patches) + list(opening_wear)

    def band(s):
        wl = K.smoothstep(0.0, seam, s) if ends[0] else 1.0
        wr = K.smoothstep(0.0, seam, W - s) if ends[1] else 1.0
        w = wl * wr
        n = (0.11 * K.noise3((s * 1.9, 0.3, 0.0), seed, octaves=2) + 0.04 * K.noise3((s * 7.0, 1.7, 0.0), seed + 1, octaves=2)
             + 0.022 * K.noise3((s * 19.0, 2.9, 0.0), seed + 2) + 0.01 * K.noise3((s * 43.0, 4.1, 0.0), seed + 8))
        g = sum(h * math.exp(-((s - c) / wd) ** 2) for c, h, wd in tongues)
        return base_h + w * band_amp * (n + 0.06) + w * g

    def F(s, t):
        f = band(s) - t
        for cx, cz, rx, rz, ps in patches:
            dx, dz = (s - cx) / rx, (t - cz) / rz
            if dx * dx + dz * dz > 4.0:
                continue
            wx = 0.35 * K.noise3((s * 3.0, t * 3.0, ps), seed + 4)
            wz = 0.35 * K.noise3((s * 3.0, t * 3.0, ps + 5.0), seed + 4)
            rr = math.sqrt((dx + wx) ** 2 + (dz + wz) ** 2)
            m = min(rx, rz)
            ff = m * (1 - rr) + (0.05 * K.noise3((s * 4.5, t * 4.5, ps), seed + 3, octaves=2) + 0.02 * K.noise3((s * 14.0, t * 14.0, ps), seed + 6)) * min(1.0, m / 0.15 + 0.3)
            f = max(f, ff)
        if top_wear > 0:
            f = max(f, (t - (H - top_wear)) + 0.05 * K.noise3((s * 4.0, t * 4.0, 7.0), seed + 5, octaves=2) - 0.02)
        return f
    return F


def relief_fn(seed, amp=0.0025):
    return lambda s, t: amp * (0.5 + 0.5 * K.noise3((s * 2.7, t * 2.7, 3.3), seed + 9, octaves=2))


def bulge(W, H, seed, amp=0.022):
    """Low-frequency bowing of a wall out of plane (Blender -y = outward), zero at the ends, top and foot."""
    ph = K.rng(seed).uniform(0, 10)

    def f(x, z):
        wx = math.sin(math.pi * min(1, max(0, x / W))) ** 0.8
        wz = math.sin(math.pi * min(1, max(0, z / H))) ** 0.7
        n = 0.6 + 0.4 * K.noise3((x * 0.6, z * 0.6, ph), seed + 21)
        # hand-built unevenness: soft lumps half a metre to a metre across, gone at the ends (seams) and the top
        we = K.smoothstep(0.0, 0.35, x) * K.smoothstep(0.0, 0.35, W - x) * K.smoothstep(0.0, 0.3, H - z)
        lump = K.noise3((x * 1.4, z * 1.4, ph + 3), seed + 22, octaves=2)
        return -amp * wx * wz * n - 0.011 * we * lump
    return f


def grime(H, seed, damp=0.55, top_streaks=True):
    """Vertex colour: a damp, splashed foot, rain streaks from the top, a little mottling."""
    def fn(co, n, mat, poly):
        x, z = co.x, co.z
        h = damp + 0.12 * K.noise3((x * 2.2, 0.0, 1.0), seed + 31)
        k = 0.72 + 0.28 * K.smoothstep(-0.05, h, z)
        k *= 0.97 + 0.05 * K.noise3((x * 0.8, z * 0.8, co.y * 0.8), seed + 32)
        if top_streaks:
            st = K.smoothstep(0.25, 0.8, K.noise3((x * 3.5, z * 0.25, 2.0), seed + 33))
            k *= 1 - 0.07 * st * K.smoothstep(0.4 * H, H, z)
        if mat == MAT_BRICK:
            k *= 0.94
        return (k, k * 0.985, k * 0.97)
    return fn


def wall_face(B, tag, W, H, seed, step, F, y0=0.0, flipx=False, only_plaster=False, skip=None, extra_s=(), extra_t=(),
              relief=True, x0=0.0):
    """One face of a wall: plane y = y0 (front, facing -Y) or, with flipx, the back face (facing +Y, s runs -x)."""
    if flipx:
        P = lambda s, t, d: Vector((x0 + W - s, y0 - d, t))
    else:
        P = lambda s, t, d: Vector((x0 + s, y0 + d, t))
    s_ax = axis(0.0, W, step, extra_s)
    t_ax = axis(0.0, H, step, extra_t)
    layered(B, tag, P, s_ax, t_ax, F, p=P_THICK, skip=skip, only_plaster=only_plaster,
            relief=relief_fn(seed) if relief else None, uv_off=(x0 if not flipx else -x0, 0.0))


def finish(ob, W, H, seed, bulge_amp=0.022, damp=0.55, bake=True, deform=None):
    """Bow the wall, set colours, bake contact occlusion."""
    me = ob.data
    bf = bulge(W, H, seed, bulge_amp) if bulge_amp else None
    for v in me.vertices:
        if bf:
            v.co.y += bf(v.co.x, v.co.z)
        if deform:
            deform(v.co)
    me.update()
    K.paint(ob, grime(H, seed, damp), mode='set')


def lod_steps(lod):
    return {0: 0.05, 1: 0.16, 2: 0.6}[lod]
