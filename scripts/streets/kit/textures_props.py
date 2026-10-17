"""Texture sets for the clay and household props (tileable PBR, numpy; same conventions as tools/texgen.py):

  props_terracotta  1024 px = 0.5 m   fired clay. Rows 128..1023 (Blender v 0..0.875): body, tiles in u and, with
                                      period 0.875, in v (lathe UVs wrap there). Rows 0..127 (v 0.875..1): an applied
                                      band with twisted-cord impressions, tiles in u.
  props_clayraw     1024 px = 0.5 m   unfired clay. Rows 0..767 (v 0.25..1): body, tiles in u and with period 0.75 in v.
                                      Rows 768..1023 (v 0..0.25): four tablet faces, 256 px each (blank; faint ruled
                                      lines; random stylus pocks; a thumb-smoothed face). Invented marks, no writing.
  props_basketry    1024 px trim      u tiles at 0.4 m. Bands (Blender v): coiled 0.625..1, plaited palm leaf
                                      0.25..0.625, two-ply cord 0.0625..0.25, loose fibre binding 0..0.0625.
  props_hessian     1024 px = 0.27 m  coarse sackcloth (from Poly Haven hessian_230), undyed flax/jute.
  props_grain       1024 px = 0.15 m  a heap of hulled barley grains.

Run: build/kit/venv/bin/python -I scripts/streets/kit/textures_props.py [names...]
"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tools'))
from texgen import (ph, load, resize, save_set, decode_normal, pnoise, sample_wrap, blur_wrap, smoothstep,  # noqa: E402
                    height_to_normal, blend_normals, cavity_ao, fibres, match_mean, lum)


def periodic_v(img, rows):
    """Resample a periodic square image to `rows` rows (keeps periodicity both ways)."""
    w = img.shape[1]
    return resize(img, rows, w)


# ---------------------------------------------------------------- fired clay

def terracotta(N=1024, name='props_terracotta', seed=101):
    px = 0.5 / N
    S = 128                                     # strip rows
    BR = N - S                                  # body rows
    # body: generate square periodic fields, squash to BR rows (stays periodic)
    grit_d, grit_v = fibres(N, 1500, 2.0, 2.0, seed, curl=0.0)       # dots: short "fibres" of ~2 px = grit
    grit_l, grit_lv = fibres(N, 1400, 1.6, 1.6, seed + 1, curl=0.0)
    pits, _ = fibres(N, 500, 1.2, 2.5, seed + 2, curl=0.0)
    cloud = pnoise(N, 6, seed + 3, octaves=4)
    slip = pnoise(N, 4, seed + 4, octaves=3)
    fine = pnoise(N, 64, seed + 5, octaves=3)
    h = (fine - 0.5) * 0.00012 + grit_d * 0.00018 - pits * 0.00035 + (pnoise(N, 8, seed + 6, octaves=3) - 0.5) * 0.0006
    col = np.ones((N, N, 3), np.float32) * np.array([0.80, 0.70, 0.58])
    col *= (0.95 + 0.08 * fine)[..., None]
    col = col * (1 - 0.35 * grit_d[..., None] * (grit_v[..., None] > 0.5)) + np.array([0.36, 0.30, 0.25]) * 0.35 * grit_d[..., None] * (grit_v[..., None] > 0.5)
    col = col * (1 - 0.5 * grit_l[..., None]) + np.array([0.93, 0.88, 0.80]) * 0.5 * grit_l[..., None]
    # firing clouds: greyer, darker patches
    fc = smoothstep(0.62, 0.9, cloud)[..., None]
    col = col * (1 - 0.14 * fc) + np.array([0.45, 0.41, 0.38]) * 0.14 * fc
    # a smoother, slightly redder slip in places
    sl = smoothstep(0.45, 0.7, slip)
    col *= (1 + 0.05 * sl)[..., None] * np.array([1.02, 0.98, 0.95]) ** sl[..., None]
    rough = 0.86 - 0.16 * sl + 0.06 * grit_d
    stack = np.concatenate([col, h[..., None], rough[..., None]], -1)
    stack = periodic_v(stack, BR)
    col, h, rough = stack[..., :3], stack[..., 3], stack[..., 4]
    # throwing marks: horizontal ridges, an exact number per body period
    yy = np.arange(BR, dtype=np.float32)[:, None]
    xx = np.arange(N, dtype=np.float32)[None, :]
    amp = 0.6 + 0.4 * periodic_v(pnoise(N, 4, seed + 8, octaves=2)[..., None], BR)[..., 0]
    # faint, uneven: smoothed coil-built pots keep only traces, stronger in bands that fade in and out
    fade = smoothstep(0.45, 0.85, periodic_v(pnoise(N, 6, seed + 11, octaves=3)[..., None], BR)[..., 0])
    warp = periodic_v(pnoise(N, 5, seed + 12, octaves=2)[..., None], BR)[..., 0]
    ridges = np.sin(2 * np.pi * (yy * 70 / BR + 0.6 * (warp - 0.5))) * amp * fade
    h = h + ridges * 0.00004
    # the cord-impressed applied band (strip): a rounded ridge with slanted twisted-cord impressions
    sy = np.arange(S, dtype=np.float32)[:, None] / S
    sx = np.arange(N, dtype=np.float32)[None, :]
    ridge = np.cos((sy - 0.5) * np.pi * 0.95) ** 0.8
    per = N / 64.0                                  # 64 impressions around a u tile (7.8 mm)
    jit = pnoise(N, 16, seed + 13, octaves=2)[:S] - 0.5
    phase = (sx / per + sy * 1.6 + 0.35 * jit) % 1.0     # slanted (S-twist), pressed unevenly
    dent = smoothstep(0.0, 0.25, phase) * smoothstep(1.0, 0.55, phase)
    band_in = smoothstep(0.12, 0.3, sy) * smoothstep(0.88, 0.7, sy)
    sh = ridge * 0.004 - (1 - dent) * 0.0013 * band_in + (pnoise(N, 64, seed + 9, octaves=2)[:S] - 0.5) * 0.0002
    scol = np.ones((S, N, 3), np.float32) * np.array([0.80, 0.68, 0.55]) * (0.95 + 0.1 * pnoise(N, 16, seed + 10)[:S, :, None])
    scol *= (1 - 0.15 * (1 - dent) * band_in)[..., None]
    srough = np.full((S, N), 0.85, np.float32)
    # assemble: strip on top rows, normals and AO per region (each wraps on itself), with 8-row gutters above and
    # below the strip that continue the body, so mips and filtering at the body's wrap see body, not band
    nb = height_to_normal(h, px)
    ab = cavity_ao(h, px, radii_m=(0.0008, 0.002, 0.005), depth_m=0.0008)
    ns = height_to_normal(sh, px)
    as_ = cavity_ao(sh, px, radii_m=(0.0008, 0.002, 0.005), depth_m=0.0008)
    G = 8

    def gut(body, strip):
        return np.concatenate([body[:G], strip[G:S - G], body[BR - G:], body], 0)
    C = gut(col, scol)
    n = gut(nb, ns)
    ao = gut(ab, as_)
    R = gut(rough, srough)
    C *= (0.85 + 0.15 * ao)[..., None]
    save_set(name, np.clip(C, 0, 1), n, ao, np.clip(R, 0, 1))


# ---------------------------------------------------------------- unfired clay, tablet faces

def clayraw(N=1024, name='props_clayraw', seed=111):
    px = 0.5 / N
    BR = 768
    base = np.array([0.56, 0.50, 0.43])
    fine = pnoise(N, 48, seed, octaves=3)
    mid = pnoise(N, 6, seed + 1, octaves=4)
    grit_d, grit_v = fibres(N, 1600, 1.8, 1.8, seed + 2, curl=0.0)
    fm, fv = fibres(N, 500, 0.012 / px, 1.0, seed + 3)          # a little chaff
    smear = pnoise(N, 10, seed + 4, octaves=3)
    h = (fine - 0.5) * 0.00015 + (mid - 0.5) * 0.0012 + grit_d * 0.00015 - fm * 0.0002
    # smoothing strokes (palm-smoothed): long low ridges in one direction
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    strokes = np.sin(2 * np.pi * (yy / N * 18 + (smear - 0.5) * 1.5)) * 0.00015
    h += strokes
    col = base * (0.96 + 0.08 * mid[..., None]) * (0.96 + 0.08 * fine[..., None])
    col = col * (1 - 0.4 * grit_d[..., None]) + np.array([0.35, 0.31, 0.27]) * 0.4 * grit_d[..., None]
    col = col * (1 - 0.3 * fm[..., None]) + np.array([0.72, 0.64, 0.46]) * 0.3 * fm[..., None]
    rough = np.clip(0.82 + 0.1 * fine - 0.08 * smoothstep(0.55, 0.8, smear), 0, 1)
    stack = np.concatenate([col, h[..., None], rough[..., None]], -1)
    stack = periodic_v(stack, BR)
    col, h, rough = stack[..., :3], stack[..., 3], stack[..., 4]
    # four tablet faces, 256 px each (a face ~ 8 cm across -> 0.31 mm/px)
    T = 256
    tpx = 0.08 / T
    faces_c, faces_h, faces_r = [], [], []
    for k in range(4):
        rng = np.random.default_rng(seed + 20 + k)
        ty, tx = np.mgrid[0:T, 0:T].astype(np.float32)
        u, v = tx / T, ty / T
        th = (pnoise(T, 4, seed + 30 + k, octaves=3) - 0.5) * 0.0004 + (pnoise(T, 32, seed + 40 + k, octaves=2) - 0.5) * 0.00006
        tc = np.ones((T, T, 3), np.float32) * base * (0.95 + 0.1 * pnoise(T, 8, seed + 50 + k, octaves=3)[..., None])
        if k == 1:
            # faint ruled guide lines, unevenly spaced and not quite straight
            rows = np.cumsum(rng.uniform(0.09, 0.13, 9))
            for r0 in rows:
                if r0 > 0.92:
                    break
                yline = r0 + 0.006 * np.sin(u * 7 + r0 * 9) + (pnoise(T, 8, seed + 60 + int(r0 * 100))[..., :] - 0.5) * 0.004
                d = np.abs(v - yline)
                g = smoothstep(0.006, 0.0, d) * smoothstep(0.04, 0.1, u) * smoothstep(0.96, 0.9, u)
                th -= g * 0.00006
                tc *= (1 - 0.05 * g)[..., None]
        if k == 2:
            # random stylus pocks: small round dents scattered, some in loose rows (an invented tally, not script)
            for _ in range(rng.integers(26, 40)):
                cx, cy = rng.uniform(0.1, 0.9), rng.uniform(0.1, 0.9)
                if rng.random() < 0.6:
                    cy = round(cy * 6) / 6
                rr = rng.uniform(0.012, 0.022)
                d = np.hypot(u - cx, v - cy) / rr
                dent = np.clip(1 - d * d, 0, 1)
                th -= dent * 0.0004
                rim = smoothstep(1.0, 1.25, d) * smoothstep(1.6, 1.25, d)
                th += rim * 0.00006
                tc *= (1 - 0.18 * dent)[..., None]
        if k == 3:
            # a thumb-smoothed face: a few broad arcs
            for j in range(4):
                cx, cy, rr = rng.uniform(0.2, 0.8), rng.uniform(0.2, 0.8), rng.uniform(0.15, 0.35)
                d = np.hypot(u - cx, v - cy)
                ring = np.sin((d / rr) * 6 * np.pi) * smoothstep(rr, rr * 0.6, d)
                th += ring * 0.00004
        faces_c.append(tc)
        faces_h.append(th)
        faces_r.append(np.full((T, T), 0.78, np.float32))
    # tablet faces are at a finer scale: resample their height to the strip's metres-per-pixel expectation
    strip_c = np.concatenate(faces_c, 1)
    strip_h = np.concatenate(faces_h, 1)
    strip_r = np.concatenate(faces_r, 1)
    n_body = height_to_normal(h, px)
    n_strip = height_to_normal(strip_h, tpx)
    a_body = cavity_ao(h, px, radii_m=(0.001, 0.004), depth_m=0.0008)
    a_strip = cavity_ao(strip_h, tpx, radii_m=(0.0003, 0.001), depth_m=0.0002)
    G = 8

    def gut(body, strip):
        # rows 768..775 continue the body below its last row (periodic: its first rows); 1016..1023 precede row 0
        return np.concatenate([body, body[:G], strip[G:256 - G], body[BR - G:]], 0)
    C = gut(col, strip_c)
    Nn = gut(n_body, n_strip)
    R = gut(rough, strip_r)
    ao = gut(a_body, a_strip)
    C *= (0.85 + 0.15 * ao)[..., None]
    save_set(name, np.clip(C, 0, 1), Nn, ao, np.clip(R, 0, 1))


# ---------------------------------------------------------------- basketry trim

def basketry(N=1024, name='props_basketry', seed=121):
    """Bands (rows): coiled 0..383, plaited 384..767, cord 768..959, fibre 960..1023. u tile = 0.4 m."""
    pxm = 0.4 / N
    out_c = np.zeros((N, N, 3), np.float32)
    out_h = np.zeros((N, N), np.float32)
    out_r = np.zeros((N, N), np.float32)
    straw = np.array([0.74, 0.63, 0.42])
    rng = np.random.default_rng(seed)
    # --- coiled: 10 coils (15 mm) of grass bundle, wrapped with palm-leaf stitches
    Hc = 384
    yy, xx = np.mgrid[0:Hc, 0:N].astype(np.float32)
    coil = Hc / 10.0
    cv = (yy % coil) / coil
    ci = (yy // coil).astype(np.int32)
    prof = np.sin(np.clip(cv, 0, 1) * np.pi) ** 0.6
    # stitches: diagonal wraps every ~7 mm, offset per coil
    spacing = N / 56.0
    off = (ci * 0.37) % 1.0
    sp = ((xx / spacing + off + cv * 0.45) % 1.0)
    stitch = smoothstep(0.0, 0.12, sp) * smoothstep(0.62, 0.45, sp)
    h = prof * 0.004 + stitch * prof * 0.0008
    fib = pnoise(N, 2, seed, octaves=1)
    stri = np.sin((cv * 7 + (xx / N) * 3) * np.pi) * 0.5 + 0.5
    col = straw * (0.85 + 0.2 * stri[..., None]) * (0.9 + 0.2 * pnoise(N, 16, seed + 1, octaves=2)[:Hc, :, None])
    stc = np.array([0.66, 0.55, 0.36])
    col = col * (1 - stitch[..., None] * 0.6) + stc * stitch[..., None] * 0.6
    col *= (0.55 + 0.45 * prof)[..., None]
    out_c[0:Hc], out_h[0:Hc], out_r[0:Hc] = col, h, 0.72
    # --- plaited: diagonal 2/2 twill of palm-leaf strips 12 mm wide
    Hp = 384
    yy, xx = np.mgrid[0:Hp, 0:N].astype(np.float32)
    S = N / 32.0                                     # 12.5 mm strips; 32 per u tile, and the band holds 12
    a = (xx + yy) / S
    b = (xx - yy) / S
    i, j = np.floor(a).astype(np.int32), np.floor(b).astype(np.int32)
    ua, ub = a - i, b - j
    top_a = ((i + j) % 4) < 2
    pr = lambda t: np.cos((t - 0.5) * np.pi * 0.95) ** 0.5
    gp = lambda t: smoothstep(0.0, 0.07, t) * smoothstep(1.0, 0.93, t)
    ha = 0.0008 * pr(ub) * gp(ub)
    hb = 0.0008 * pr(ua) * gp(ua)
    h = np.where(top_a, ha + 0.0006, hb + 0.0006)
    vis = np.where(top_a, gp(ub), gp(ua))
    sv = rng.random((2, 64)).astype(np.float32)
    shade = np.where(top_a, sv[0, i % 64], sv[1, j % 64])
    col = np.array([0.72, 0.64, 0.42]) * (0.85 + 0.25 * shade[..., None])
    vein = np.sin((np.where(top_a, ub, ua) * 11) * np.pi) * 0.5 + 0.5
    col *= (0.93 + 0.08 * vein[..., None])
    col = col * vis[..., None] + np.array([0.2, 0.16, 0.1]) * (1 - vis[..., None])
    h = h * vis - 0.001 * (1 - vis)
    out_c[Hc:Hc + Hp], out_h[Hc:Hc + Hp], out_r[Hc:Hc + Hp] = col, h, 0.66
    # --- two-ply cord, 192 rows (the band wraps a cord's circumference)
    Hr = 192
    yy, xx = np.mgrid[0:Hr, 0:N].astype(np.float32)
    per = N / 80.0
    ph = (xx / per + yy / Hr * 2.0) % 1.0
    ply = np.sin(ph * np.pi) ** 0.7
    hairs = pnoise(N, 128, seed + 3, octaves=2)[:Hr]
    h = ply * 0.0012 + (hairs - 0.5) * 0.0001
    col = np.array([0.66, 0.57, 0.40]) * (0.6 + 0.4 * ply[..., None]) * (0.92 + 0.12 * hairs[..., None])
    r0 = 768
    out_c[r0:r0 + Hr], out_h[r0:r0 + Hr], out_r[r0:r0 + Hr] = col, h, 0.8
    # --- loose fibre binding (rims): fine lengthwise fibres
    Hf = 64
    fm, fv = fibres(N, 900, 40, 1.2, seed + 4, size_w=N, angle=0.0, angle_jitter=0.12)
    fm, fv = fm[:Hf], fv[:Hf]
    h = fm * 0.0003
    col = np.array([0.70, 0.60, 0.40]) * (0.75 + 0.35 * fv[..., None]) * (0.8 + 0.2 * fm[..., None])
    out_c[960:1024], out_h[960:1024], out_r[960:1024] = col, h, 0.75
    n = height_to_normal(out_h, pxm)
    ao = cavity_ao(out_h, pxm, radii_m=(0.0008, 0.002, 0.005), depth_m=0.001)
    out_c *= (0.75 + 0.25 * ao)[..., None]
    save_set(name, np.clip(out_c, 0, 1), n, ao, np.clip(out_r, 0, 1))


# ---------------------------------------------------------------- sackcloth

def hessian(N=1024, name='props_hessian', seed=131):
    bc = load(ph('hessian_230', 'diff'), N)
    n = decode_normal(load(ph('hessian_230', 'nor_gl'), N))
    rough = load(ph('hessian_230', 'rough'), N, gray=True)
    d = load(ph('hessian_230', 'disp'), N, gray=True)
    g = lum(bc)
    g = g / max(1e-3, g.mean())
    # undyed flax/jute, a little uneven
    col = np.array([0.56, 0.48, 0.35]) * np.clip(g, 0.2, 1.8)[..., None] ** 0.9
    col *= (0.94 + 0.12 * pnoise(N, 3, seed, octaves=3))[..., None]
    ao = cavity_ao(d * 0.0015, 0.27 / N, radii_m=(0.0005, 0.0015), depth_m=0.0003)
    save_set(name, np.clip(col, 0, 1), n, ao, np.clip(0.88 + 0.1 * rough, 0, 1))


# ---------------------------------------------------------------- barley

def grain(N=1024, name='props_grain', seed=141):
    """Hulled barley in a heap: overlapping grains ~8 x 3.5 mm, 0.15 m tile, drawn with wrap."""
    pxm = 0.15 / N
    rng = np.random.default_rng(seed)
    H = np.zeros((3 * N, 3 * N), np.float32)
    C = np.zeros((3 * N, 3 * N, 3), np.float32)
    L = 0.0085 / pxm
    Wd = 0.0036 / pxm
    gy, gx = np.mgrid[-int(L):int(L) + 1, -int(L):int(L) + 1].astype(np.float32)
    count = int(N * N / (L * Wd) * 3.2)
    for _ in range(count):
        a = rng.uniform(0, np.pi)
        ca, sa = np.cos(a), np.sin(a)
        lx = (gx * ca + gy * sa) / (L / 2 * rng.uniform(0.85, 1.1))
        ly = (-gx * sa + gy * ca) / (Wd / 2 * rng.uniform(0.85, 1.15))
        e = 1 - lx * lx - ly * ly
        m = e > 0
        hh = np.sqrt(np.clip(e, 0, 1)) * 0.0016 + rng.uniform(0, 0.0012)
        crease = smoothstep(0.1, 0.0, np.abs(ly)) * (e > 0.2) * 0.6
        hh -= crease * 0.0003
        x0, y0 = int(rng.uniform(0, N)) + N, int(rng.uniform(0, N)) + N
        ys, xs = slice(y0 - int(L), y0 + int(L) + 1), slice(x0 - int(L), x0 + int(L) + 1)
        sub = H[ys, xs]
        upd = m & (hh > sub)
        sub[upd] = hh[upd]
        cc = np.array([0.80, 0.66, 0.40]) * rng.uniform(0.82, 1.08) * np.array([1, rng.uniform(0.95, 1.03), rng.uniform(0.9, 1.05)])
        tip = smoothstep(0.75, 1.0, np.abs(lx))
        shade = (1 - 0.35 * crease - 0.25 * tip)
        Cs = C[ys, xs]
        Cs[upd] = (cc[None, :] * shade[upd][:, None])
    # fold
    fold = lambda a: a[N:2 * N, N:2 * N]
    H3, C3 = H.copy(), C.copy()
    for i in range(3):
        for j in range(3):
            if i == 1 and j == 1:
                continue
            hs = H[i * N:(i + 1) * N, j * N:(j + 1) * N]
            cs = C[i * N:(i + 1) * N, j * N:(j + 1) * N]
            core = H3[N:2 * N, N:2 * N]
            upd = hs > core
            core[upd] = hs[upd]
            C3[N:2 * N, N:2 * N][upd] = cs[upd]
    h = fold(H3)
    col = fold(C3)
    empty = h <= 0
    col[empty] = np.array([0.30, 0.24, 0.15])
    n = height_to_normal(h, pxm)
    ao = cavity_ao(h, pxm, radii_m=(0.0008, 0.002, 0.004), depth_m=0.001)
    col *= (0.4 + 0.6 * ao)[..., None]
    save_set(name, np.clip(col, 0, 1), n, ao, np.full((N, N), 0.7, np.float32))


SETS = {'terracotta': terracotta, 'clayraw': clayraw, 'basketry': basketry, 'hessian': hessian, 'grain': grain}

if __name__ == '__main__':
    for nm in (sys.argv[1:] or list(SETS)):
        SETS[nm]()
