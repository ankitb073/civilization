"""Texture sets for the structure props (props_struct pack):

  struct_textile   1024 px = 0.27 m   plain-woven linen (rough_linen scan), near white so vertex colour dyes it
  struct_textpat   2048 px atlas      four whole-cloth designs (quadrants) in natural dyes: woven bands and stripes,
                                      invented geometric motifs only (zigzags, lozenges, stepped bands), weave overlaid
  struct_misc      1024 px trim       bands in v: rope 0.5-1 (3-strand twist), leather 0.25-0.5, bronze 0.125-0.25
                                      (metallic, patinated), fired clay 0-0.125 (loom weights)

Run: build/kit/venv/bin/python -I scripts/streets/kit/textures_struct.py [names...]
"""
import os
import sys
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tools'))
from texgen import (ph, load, resize, save_set, decode_normal, pnoise, blur_wrap, smoothstep,  # noqa: E402
                    height_to_normal, blend_normals, cavity_ao, fibres, match_mean, lum)

# natural dyes (sRGB albedo)
MADDER = np.array([0.60, 0.20, 0.14])
INDIGO = np.array([0.17, 0.24, 0.40])
SAFFRON = np.array([0.80, 0.58, 0.20])
UNDYED = np.array([0.86, 0.81, 0.70])
BROWN = np.array([0.36, 0.25, 0.17])
OCHRE = np.array([0.66, 0.50, 0.31])


def _linen_detail(size):
    """The linen scan as (luminance detail around 1, normal, roughness) at `size` px per scan tile (0.27 m)."""
    d = load(ph('rough_linen', 'diff'), size)
    l = lum(d)
    l = l / blur_wrap(l, size / 16)
    n = decode_normal(load(ph('rough_linen', 'nor_gl'), size))
    r = load(ph('rough_linen', 'rough'), size, gray=True)
    return l, n, r


def textile(N=1024, name='struct_textile', seed=71):
    l, n, r = _linen_detail(N)
    # slubs: thicker threads along the weft and warp, periodic
    yy = np.arange(N)
    rng = np.random.default_rng(seed)
    slub_w = np.zeros(N, np.float32)
    slub_h = np.zeros(N, np.float32)
    for _ in range(14):
        c, w = rng.integers(0, N), rng.uniform(1.5, 3.0)
        slub_w += np.exp(-(((yy - c + N / 2) % N - N / 2) / w) ** 2) * rng.uniform(0.04, 0.09)
        c, w = rng.integers(0, N), rng.uniform(1.5, 3.0)
        slub_h += np.exp(-(((yy - c + N / 2) % N - N / 2) / w) ** 2) * rng.uniform(0.04, 0.09)
    seg_a = smoothstep(0.55, 0.85, pnoise(N, 16, seed + 1, octaves=2))
    seg_b = smoothstep(0.55, 0.85, pnoise(N, 16, seed + 4, octaves=2))
    slub = 0.6 * (slub_w[:, None] * seg_a + slub_h[None, :] * seg_b)
    mot = pnoise(N, 4, seed + 2, octaves=3)
    col = UNDYED[None, None, :] * (l * (0.94 + 0.08 * mot) * (1 + slub))[..., None]
    # a little greyed dirt in the weave
    col *= (0.96 + 0.04 * smoothstep(0.3, 0.7, pnoise(N, 8, seed + 3, octaves=2)))[..., None]
    h = slub * 0.0002
    n = blend_normals(n, height_to_normal(h, 0.27 / N), 1.0)
    ao = np.clip(0.75 + 0.25 * (l - l.min()) / (l.max() - l.min() + 1e-6), 0, 1)
    rough = np.clip(0.86 + 0.1 * r, 0, 1)
    save_set(name, np.clip(col, 0, 1), n, ao, rough)


def _zigzag(u, v, period, amp, width):
    """A zigzag line band: distance from a triangle wave in u."""
    tri = np.abs(((u / period) % 1.0) * 2 - 1) * amp
    return np.abs(v - tri) < width


def _design(k, Q, seed):
    """One whole-cloth design, Q x Q px over about 1.2 m; v runs along the cloth's length (bands near both ends)."""
    rng = np.random.default_rng(seed + k)
    yy, xx = np.mgrid[0:Q, 0:Q].astype(np.float32)
    # woven, not printed: motifs step at thread size (2 px) and wander a little from pick to pick
    th = 2.0
    yq, xq = np.floor(yy / th) * th, np.floor(xx / th) * th
    pick_j = (rng.random(Q) - 0.5)[np.clip((yq).astype(int), 0, Q - 1)] * 2.5
    end_j = (rng.random(Q) - 0.5)[np.clip((xq).astype(int), 0, Q - 1)] * 1.5
    u, v = (xq + pick_j) / Q, (yq + end_j) / Q         # 0..1 across, 0..1 along
    vm = np.minimum(v, 1 - v)                          # distance from the nearer end (bands mirror)
    col = np.zeros((Q, Q, 3), np.float32)
    if k == 0:
        # madder cloth; at each end: indigo stripes, an undyed zigzag band, a fringe-dark selvedge
        col[:] = MADDER
        for a, b, c in ((0.035, 0.05, INDIGO), (0.06, 0.07, UNDYED), (0.135, 0.145, UNDYED), (0.155, 0.17, INDIGO)):
            m = (vm >= a) & (vm < b)
            col[m] = c
        band = (vm >= 0.075) & (vm < 0.13)
        col[band] = INDIGO
        zz = _zigzag(u, (vm - 0.075) / 0.055, 1 / 14, 1.0, 0.16) & band
        col[zz] = UNDYED
    elif k == 1:
        # undyed with warp stripes in indigo and madder
        col[:] = UNDYED
        x = u * 48
        for i in range(48):
            if i % 8 in (2, 3):
                col[(x >= i) & (x < i + 0.6)] = INDIGO
            if i % 8 == 6:
                col[(x >= i + 0.1) & (x < i + 0.45)] = MADDER
        m = (vm < 0.03)
        col[m] = col[m] * 0.85
    elif k == 2:
        # indigo cloth with a saffron and undyed lozenge band at each end
        col[:] = INDIGO
        for a, b, c in ((0.03, 0.04, SAFFRON), (0.05, 0.055, UNDYED), (0.145, 0.15, UNDYED), (0.16, 0.17, SAFFRON)):
            col[(vm >= a) & (vm < b)] = c
        band = (vm >= 0.06) & (vm < 0.14)
        bv = (vm - 0.06) / 0.08
        p = 1 / 9
        du = np.abs(((u / p) % 1.0) - 0.5) * 2
        dv = np.abs(bv - 0.5) * 2
        loz = (du + dv) < 0.85
        inner = (du + dv) < 0.4
        col[band & loz] = SAFFRON
        col[band & inner] = MADDER
    else:
        # ochre ground with stepped (merlon) bands in madder and brown, and brown weft stripes in the field
        col[:] = OCHRE * 1.02
        for a, b, c in ((0.03, 0.04, BROWN), (0.135, 0.145, BROWN)):
            col[(vm >= a) & (vm < b)] = c
        band = (vm >= 0.045) & (vm < 0.13)
        bv = (vm - 0.045) / 0.085
        p = 1 / 10
        ph_ = (u / p) % 1.0
        step = np.where(ph_ < 0.25, 0.25, np.where(ph_ < 0.5, 0.55, np.where(ph_ < 0.75, 0.85, 0.55)))
        col[band & (bv < step)] = MADDER
        col[band & (bv >= step) & (bv < step + 0.08)] = BROWN
        for s0 in np.arange(0.22, 0.8, 0.09):
            col[(v >= s0) & (v < s0 + 0.008)] = BROWN
    # abrash: uneven dye lots along the weft
    ab = pnoise(Q, 2, seed + 10 + k, octaves=2)
    col = col * (0.94 + 0.1 * ab[:, :1])[..., None]
    # thread-to-thread variation in both directions
    rw = 1 + 0.06 * (rng.random(Q) - 0.5)
    cw = 1 + 0.06 * (rng.random(Q) - 0.5)
    col = col * rw[:, None, None] * cw[None, :, None]
    return col


def textpat(N=2048, name='struct_textpat', seed=81):
    Q = N // 2
    l, n_tile, r_tile = _linen_detail(Q // 4)
    # coarser hand-woven wool: the linen weave at double scale
    reps = 4
    L = np.tile(l, (reps, reps))
    Nn = np.tile(n_tile, (reps, reps, 1))
    R = np.tile(r_tile, (reps, reps))
    bc = np.zeros((N, N, 3), np.float32)
    nn = np.zeros((N, N, 3), np.float32)
    rr = np.zeros((N, N), np.float32)
    ao = np.zeros((N, N), np.float32)
    for k in range(4):
        y0, x0 = (k // 2) * Q, (k % 2) * Q
        col = _design(k, Q, seed)
        # soften the pattern edges a touch (threads, not pixels)
        col = np.stack([blur_wrap(col[..., c], 0.8) for c in range(3)], -1)
        mot = pnoise(Q, 4, seed + 20 + k, octaves=3)
        bc[y0:y0 + Q, x0:x0 + Q] = col * (L * (0.94 + 0.08 * mot))[..., None]
        nk = Nn.copy()
        nk[..., :2] *= 2.2
        nn[y0:y0 + Q, x0:x0 + Q] = nk / np.linalg.norm(nk, axis=-1, keepdims=True)
        rr[y0:y0 + Q, x0:x0 + Q] = 0.86 + 0.1 * R
        ao[y0:y0 + Q, x0:x0 + Q] = np.clip(0.78 + 0.22 * (L - L.min()) / (L.max() - L.min() + 1e-6), 0, 1)
    save_set(name, np.clip(bc, 0, 1), nn, ao, rr)


def _rope_band(W, H, seed):
    """Three-strand rope: strands as diagonal ridges; u along the rope, v around it (H = full circumference)."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    strands = 3
    # one u unit = 0.12 m of rope; a strand's pitch about 3 cm -> 4 twists per 0.12 m
    twists = 4 * (W / H)
    ph = (xx / W * twists * 1.0 + yy / H) * strands
    f = ph % 1.0
    prof = np.sin(f * np.pi) ** 0.6                     # rounded strand
    groove = 1 - smoothstep(0.0, 0.08, np.minimum(f, 1 - f))
    fib_n = pnoise(H, 8, seed, octaves=3, size_w=W)
    # fibres run along each strand (diagonal): stretch noise along the strand direction
    fib = np.sin((xx / W * twists * 9 - yy / H * 9 * 0.3 + fib_n * 3) * np.pi * 2) * 0.5 + 0.5
    h = prof * 0.003 + fib * 0.0003 - groove * 0.001
    base = np.array([0.66, 0.57, 0.42])
    col = base * (0.75 + 0.25 * prof)[..., None] * (0.92 + 0.12 * fib)[..., None]
    col *= (0.9 + 0.15 * pnoise(H, 4, seed + 1, octaves=2, size_w=W))[..., None]
    rough = 0.82 + 0.1 * fib
    return col, h, rough


def _leather_band(W, H, seed):
    pore = pnoise(H, 128, seed, octaves=2, size_w=W)
    wr = pnoise(H, 12, seed + 1, octaves=4, size_w=W)
    wrinkle = 1 - np.abs(wr - 0.5) * 2
    worn = smoothstep(0.55, 0.8, pnoise(H, 4, seed + 2, octaves=3, size_w=W))
    h = (pore - 0.5) * 0.0002 + smoothstep(0.75, 1.0, wrinkle) * 0.0008
    base = np.array([0.38, 0.25, 0.15])
    col = base * (0.85 + 0.15 * pore)[..., None] * (1 - 0.25 * smoothstep(0.8, 1.0, wrinkle))[..., None]
    col = col * (1 - worn[..., None] * 0.4) + np.array([0.52, 0.38, 0.25]) * worn[..., None] * 0.4
    rough = 0.55 + 0.25 * worn + 0.1 * pore
    return col, h, rough


def _bronze_band(W, H, seed):
    pat = smoothstep(0.45, 0.75, pnoise(H, 6, seed, octaves=4, size_w=W))
    scr = pnoise(H, 64, seed + 1, octaves=2, size_w=W)
    pit = smoothstep(0.75, 0.9, pnoise(H, 96, seed + 2, octaves=2, size_w=W))
    metal = np.array([0.72, 0.50, 0.30])
    patina = np.array([0.36, 0.42, 0.33])
    col = metal * (0.85 + 0.15 * scr)[..., None]
    col = col * (1 - pat[..., None] * 0.85) + patina * pat[..., None] * 0.85
    col *= (1 - 0.3 * pit)[..., None]
    h = -pit * 0.0003 + (scr - 0.5) * 0.00005
    rough = 0.38 + 0.4 * pat + 0.1 * scr
    metalness = np.clip(1 - pat * 0.9, 0, 1)
    return col, h, rough, metalness


def _clay_band(W, H, seed):
    src = load(ph('clay_plaster', 'diff'), H)
    src = np.tile(src, (1, W // H, 1))
    src = match_mean(src, (0.68, 0.50, 0.36))
    grit = pnoise(H, 96, seed, octaves=2, size_w=W)
    blot = smoothstep(0.55, 0.8, pnoise(H, 6, seed + 1, octaves=3, size_w=W))
    col = src * (0.92 + 0.1 * grit)[..., None]
    col = col * (1 - 0.3 * blot[..., None]) + np.array([0.42, 0.33, 0.27]) * 0.3 * blot[..., None]
    h = (grit - 0.5) * 0.0004
    rough = 0.85 + 0.1 * grit
    return col, h, rough


def misc(N=1024, name='struct_misc', seed=91):
    bc = np.zeros((N, N, 3), np.float32)
    h = np.zeros((N, N), np.float32)
    rough = np.zeros((N, N), np.float32)
    metal = np.zeros((N, N), np.float32)

    def rows(a, b):
        return int(round((1 - b) * N)), int(round((1 - a) * N))
    r0, r1 = rows(0.5, 1.0)
    c, hh, r = _rope_band(N, r1 - r0, seed)
    bc[r0:r1], h[r0:r1], rough[r0:r1] = c, hh, r
    r0, r1 = rows(0.25, 0.5)
    c, hh, r = _leather_band(N, r1 - r0, seed + 1)
    bc[r0:r1], h[r0:r1], rough[r0:r1] = c, hh, r
    r0, r1 = rows(0.125, 0.25)
    c, hh, r, m = _bronze_band(N, r1 - r0, seed + 2)
    bc[r0:r1], h[r0:r1], rough[r0:r1], metal[r0:r1] = c, hh, r, m
    r0, r1 = rows(0.0, 0.125)
    c, hh, r = _clay_band(N, r1 - r0, seed + 3)
    bc[r0:r1], h[r0:r1], rough[r0:r1] = c, hh, r
    px = 0.25 / N
    n = height_to_normal(h, px)
    ao = cavity_ao(h, px, radii_m=(0.0005, 0.0015, 0.004), depth_m=0.0012)
    bc *= (0.8 + 0.2 * ao)[..., None]
    from texgen import save, TEX
    d = os.path.join(TEX, name)
    save(os.path.join(d, f'{name}_bc.png'), np.clip(bc, 0, 1))
    save(os.path.join(d, f'{name}_n.png'), n * 0.5 + 0.5)
    save(os.path.join(d, f'{name}_orm.png'), np.stack([ao, np.clip(rough, 0, 1), metal], -1))
    print('wrote', name, bc.shape)


SETS = {'struct_textile': textile, 'struct_textpat': textpat, 'struct_misc': misc}

if __name__ == '__main__':
    for nm in (sys.argv[1:] or list(SETS)):
        SETS[nm]()
