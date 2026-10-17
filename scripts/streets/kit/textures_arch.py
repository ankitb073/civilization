"""Build the architecture texture sets (tileable PBR) from the Poly Haven scans plus procedural layers:

  mudplaster  2048 px = 2.0 m   mud-and-straw plaster (from clay_plaster): mottling, chaff, hairline cracks
  mudbrick    2048 px = 2.0 m   sun-dried mud bricks in alternating header/stretcher courses, eroded, mortar recessed
  roofmud     2048 px = 2.0 m   rolled roof mud, heavier straw, cracks, grit
  timber      2048 px trim      bands: weathered timber A/B, bark, debarked pole, end-grain tiles
  reedmat     1024 px = 0.5 m   2/2 twill-plaited reed strips
  ground      2048 px = 2.6 m   packed earth for test scenes (from brown_mud_dry)

Run: build/kit/venv/bin/python -I scripts/streets/kit/textures_arch.py [names...]
Output: build/kit/textures/<name>/<name>_{bc,n,orm}.png
"""
import sys
import os
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tools'))
from texgen import (ph, load, resize, save_set, decode_normal, pnoise, sample_wrap, blur_wrap, smoothstep,  # noqa: E402
                    height_to_normal, blend_normals, cavity_ao, fibres, match_mean, lum)


def rot90_normal(n):
    """Rotate a decoded normal map 90 degrees counter-clockwise (image and vectors)."""
    r = np.rot90(n, 1).copy()
    x, y = r[..., 0].copy(), r[..., 1].copy()
    r[..., 0], r[..., 1] = -y, x
    return r


# ---------------------------------------------------------------- mud plaster

def mudplaster(N=2048, name='mudplaster', target=(0.63, 0.53, 0.41), seed=11):
    px = 2.0 / N
    bc = load(ph('clay_plaster', 'diff'), N)
    n = decode_normal(load(ph('clay_plaster', 'nor_gl'), N))
    rough = load(ph('clay_plaster', 'rough'), N, gray=True)
    ao = load(ph('clay_plaster', 'ao'), N, gray=True)
    lo = blur_wrap(lum(bc), 48)
    bc = bc * (lo.mean() / np.maximum(lo, 1e-3))[..., None] ** 0.7
    bc = match_mean(bc, target)
    # hand-applied undulation and mottling
    und = pnoise(N, 4, seed, octaves=3)
    h = (und - 0.5) * 0.005
    m1 = pnoise(N, 3, seed + 1, octaves=4)
    m2 = pnoise(N, 8, seed + 2, octaves=3)
    bc = bc * (1 + 0.05 * (m1 - 0.5))[..., None] * np.array([1.0, 0.995, 0.985]) ** ((m2 - 0.5) * 6)[..., None]
    # pale dusty bloom in patches (faint: big variation comes from vertex colour and instance tint, not the tile)
    bloom = smoothstep(0.6, 0.85, pnoise(N, 5, seed + 3, octaves=3)) * 0.035
    bc = bc * (1 - bloom[..., None]) + np.array([0.80, 0.74, 0.64]) * bloom[..., None]
    # chaff: short straw in the plaster, some proud, some fallen out as grooves
    fm, fv = fibres(N, 1100, 0.018 / px, 1.1, seed + 4)
    proud = fv > 0.45
    straw_c = np.array([0.74, 0.65, 0.47])
    k = (fm * np.where(proud, 0.3, 0.0))[..., None]
    bc = bc * (1 - k) + straw_c * (0.85 + 0.3 * fv[..., None]) * k
    groove = fm * (~proud)
    bc *= (1 - 0.05 * groove)[..., None]
    h += fm * np.where(proud, 0.00025, -0.0002)
    # hairline cracks in some areas (from the cracked-mud scan's height, high-passed)
    cd = load(ph('mud_cracked_dry_03', 'disp'), N // 2, gray=True)
    cd = np.tile(cd, (2, 2))
    hp = cd - blur_wrap(cd, 5)
    crack = smoothstep(0.05, 0.13, -hp)
    region = smoothstep(0.62, 0.82, pnoise(N, 4, seed + 5, octaves=3))
    crack *= region
    h -= crack * 0.0005
    bc *= (1 - 0.13 * crack)[..., None]
    nn = height_to_normal(h, px)
    n = blend_normals(n, nn, 1.0)
    ao = np.clip(ao * cavity_ao(h, px, radii_m=(0.002, 0.006), depth_m=0.002) ** 0.5, 0, 1)
    rough = np.clip(0.80 + 0.17 * rough - 0.12 * k[..., 0], 0, 1)
    save_set(name, np.clip(bc, 0, 1), n, ao, rough)


# ---------------------------------------------------------------- mud brick

def mudbrick(N=2048, name='mudbrick', seed=21):
    """Sun-dried mud bricks: header/stretcher courses, eroded faces and arrises, mud mortar recessed."""
    rng = np.random.default_rng(seed)
    W = 2.0
    px = W / N
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    ym, xm = yy * px, xx * px                       # metres, y down
    courses = 16
    ch = W / courses                                # 0.125 m
    joint = 0.022
    # wavy coursing: each course line jitters a few mm, smoothly along x
    line_off = np.zeros((courses + 1, N), np.float32)
    for c in range(courses + 1):
        cc = c % courses
        r = np.random.default_rng(seed * 100 + cc)
        lat = r.random(8).astype(np.float32)
        line_off[c] = (np.interp(np.arange(N) / N * 8, np.arange(9), np.append(lat, lat[0])) - 0.5) * 0.006
    ci = np.floor(ym / ch).astype(np.int32) % courses
    # course-local y with the wavy lines
    top = ci * ch + line_off[ci, xx.astype(np.int32)]
    bot = (ci + 1) * ch + line_off[(ci + 1), xx.astype(np.int32)]
    # bond: 0 stretcher, 1 header (offset), 2 stretcher (half offset), 3 header
    kind = ci % 4
    pitch = np.where(kind % 2 == 0, 0.40, 0.20)
    offs = np.select([kind == 0, kind == 1, kind == 2, kind == 3], [0.0, 0.10, 0.20, 0.0])
    # per course, jitter the head joints (consistent between neighbours)
    u = (xm - offs) / pitch
    bi = np.floor(u).astype(np.int32)
    nb = np.round(W / pitch).astype(np.int32)
    bi_w = np.mod(bi, nb)
    jit = np.random.default_rng(seed + 7).random((courses, 11)).astype(np.float32)
    jl = (jit[ci, bi_w] - 0.5) * 0.03
    jr = (jit[ci, np.mod(bi_w + 1, nb)] - 0.5) * 0.03
    jl = np.where(bi_w == 0, (jit[ci, 0] - 0.5) * 0.03, jl)
    x0 = offs + bi * pitch + jl
    x1 = offs + (bi + 1) * pitch + jr
    # brick id (stable, wraps)
    bid = ci * 16 + bi_w
    nid = courses * 16
    P = np.random.default_rng(seed + 9).random((nid, 12)).astype(np.float32)
    # signed distance to the brick's rounded rectangle (negative inside)
    hx = (x1 - x0) / 2 - joint / 2
    hy = (bot - top) / 2 - joint / 2
    cx = (x0 + x1) / 2
    cy = (top + bot) / 2
    rad = 0.02 + 0.035 * P[bid, 0] ** 2
    qx = np.abs(xm - cx) - (hx - rad)
    qy = np.abs(ym - cy) - (hy - rad)
    d = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0) - rad
    edge_n = pnoise(N, 64, seed + 11, octaves=3)
    eroded = P[bid, 1] < 0.18
    d = d + (edge_n - 0.5) * np.where(eroded, 0.028, 0.014)
    s = -d                                          # depth inside the brick (m)
    # brick surface: the cracked-mud scan, sampled at a per-brick offset so no two bricks repeat
    src = load(ph('clay_block_wall', 'diff'), N)
    src_n = decode_normal(load(ph('clay_block_wall', 'nor_gl'), N))
    src_h = load(ph('clay_block_wall', 'disp'), N, gray=True)
    oy, ox = P[bid, 2] * N, P[bid, 3] * N
    sy, sx = yy + oy, xx + ox
    b_rgb = sample_wrap(src, sy, sx)
    b_n = sample_wrap(src_n, sy, sx)
    b_n /= np.linalg.norm(b_n, axis=-1, keepdims=True)
    b_h = sample_wrap(src_h, sy, sx)
    # heights
    bulge = 0.002 * (1 - np.clip(((xm - cx) / np.maximum(hx, 1e-3)) ** 2 + ((ym - cy) / np.maximum(hy, 1e-3)) ** 2, 0, 1))
    tilt = (P[bid, 4] - 0.5) * 0.008 * (xm - cx) / np.maximum(hx, 1e-3) + (P[bid, 5] - 0.5) * 0.006 * (ym - cy) / np.maximum(hy, 1e-3)
    hb = (P[bid, 6] - 0.5) * 0.004 + bulge + tilt * 0.6 + (b_h - 0.5) * 0.0025
    erode_n = pnoise(N, 24, seed + 12, octaves=4)
    hb -= np.where(eroded, 0.012 * smoothstep(0.3, 0.8, erode_n), 0.003 * smoothstep(0.6, 0.9, erode_n))
    r_depth = 0.011
    e = np.clip(s / np.maximum(rad, 1e-3), 0, 1)
    hb_edge = hb - r_depth * (1 - np.sqrt(1 - (1 - e) ** 2))
    mort_n = pnoise(N, 32, seed + 13, octaves=4)
    grit = pnoise(N, 256, seed + 14, octaves=2)
    hm = -0.012 + (mort_n - 0.5) * 0.006 + smoothstep(0.7, 0.9, grit) * 0.002
    inside = smoothstep(-0.0015, 0.0015, s)
    h = np.where(s > 0, np.maximum(hb_edge, hm), hm)
    h = h * inside + hm * (1 - inside)
    # chaff in the bricks
    fm, fv = fibres(N, 4200, 0.022 / px, 1.4, seed + 15)
    h -= fm * 0.0007 * inside
    # colour
    b_rgb = match_mean(b_rgb, (0.62, 0.50, 0.37))
    b_rgb = b_rgb * 0.55 + b_rgb.reshape(-1, 3).mean(0) * 0.45
    pal = np.array([[0.56, 0.45, 0.34], [0.53, 0.43, 0.32], [0.58, 0.47, 0.36], [0.53, 0.45, 0.36], [0.55, 0.44, 0.33]], np.float32)
    pc = pal[(P[:, 7] * len(pal)).astype(np.int32) % len(pal)] * (0.95 + 0.10 * P[:, 8:9])
    bt = pc[bid] / np.array([0.62, 0.50, 0.37])
    brick_c = b_rgb * bt
    straw = np.array([0.82, 0.72, 0.50])
    brick_c = brick_c * (1 - 0.6 * fm[..., None] * (fv[..., None] > 0.5)) + straw * 0.6 * fm[..., None] * (fv[..., None] > 0.5)
    brick_c *= (1 - 0.25 * fm * (fv <= 0.5))[..., None]
    m_rgb = match_mean(sample_wrap(src, yy + 517, xx + 1301), (0.50, 0.42, 0.33))
    mort_c = m_rgb * (0.92 + 0.16 * mort_n[..., None]) * (0.94 + 0.1 * grit[..., None])
    mort_c = mort_c * (1 - 0.1 * smoothstep(0.75, 0.95, grit))[..., None]
    col = brick_c * inside[..., None] + mort_c * (1 - inside[..., None])
    # large-scale variation
    lv = pnoise(N, 3, seed + 16, octaves=3)
    col *= (0.94 + 0.12 * lv)[..., None]
    nh = height_to_normal(h, px)
    detail = np.where(inside[..., None] > 0.5, b_n, decode_normal(np.full((N, N, 3), 0.5, np.float32) + np.array([0, 0, 0.5])))
    n = blend_normals(nh, detail, 0.45)
    ao = cavity_ao(h, px, radii_m=(0.004, 0.012, 0.03), depth_m=0.012, power=1.2)
    col *= (0.82 + 0.18 * ao)[..., None]
    rough = np.clip(0.86 + 0.08 * (1 - inside) + 0.05 * (b_h - 0.5) * inside, 0, 1)
    save_set(name, np.clip(col, 0, 1), n, ao, rough)


# ---------------------------------------------------------------- roof mud

def roofmud(N=2048, name='roofmud', seed=31):
    px = 2.0 / N
    bc = load(ph('clay_plaster', 'diff'), N)
    n = decode_normal(load(ph('clay_plaster', 'nor_gl'), N))
    rough = load(ph('clay_plaster', 'rough'), N, gray=True)
    ao = load(ph('clay_plaster', 'ao'), N, gray=True)
    lo0 = blur_wrap(lum(bc), 48)
    bc = bc * (lo0.mean() / np.maximum(lo0, 1e-3))[..., None] ** 0.8
    bc = match_mean(bc, (0.60, 0.51, 0.40))
    # grit and pebbles from the dry mud scan, in patches
    gm = load(ph('brown_mud_dry', 'diff'), N)
    gn = decode_normal(load(ph('brown_mud_dry', 'nor_gl'), N))
    gm = match_mean(gm, (0.55, 0.46, 0.36))
    patch = smoothstep(0.5, 0.85, pnoise(N, 4, seed, octaves=4)) * 0.28
    bc = bc * (1 - patch[..., None]) + gm * patch[..., None]
    n = n * (1 - patch[..., None]) + gn * patch[..., None]
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    h = (pnoise(N, 16, seed + 1, octaves=3) - 0.5) * 0.0025
    # high-pass the scan's normals: a 2 m tile seen from above in raking light must not carry broad tilts (it would
    # read as a checkerboard)
    nb = blur_wrap(n, 40)
    n = n - nb + np.array([0.0, 0.0, 1.0])
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    # heavy chaff
    fm, fv = fibres(N, 6500, 0.035 / px, 1.8, seed + 2)
    straw = np.array([0.82, 0.71, 0.47])
    k = (fm * (fv > 0.4) * 0.8)[..., None]
    bc = bc * (1 - k) + straw * (0.8 + 0.3 * fv[..., None]) * k
    h += fm * np.where(fv > 0.4, 0.0005, -0.0008)
    # drying cracks, polygonal, in most of the surface
    cd = load(ph('dry_ground_01', 'disp'), N, gray=True)
    hp = cd - blur_wrap(cd, 6)
    crack = smoothstep(0.02, 0.07, -hp) * smoothstep(0.35, 0.6, pnoise(N, 3, seed + 3, octaves=3))
    h -= crack * 0.002
    bc *= (1 - 0.4 * crack)[..., None]
    mot = pnoise(N, 6, seed + 4, octaves=4)
    bc *= (0.96 + 0.08 * mot)[..., None]
    # flatten the low-frequency light/dark (a tile seen many times reads as a checkerboard otherwise)
    lo = blur_wrap(lum(bc), 64)
    bc = np.clip(bc * (lo.mean() / np.maximum(lo, 1e-3))[..., None] ** 0.85, 0, 1)
    n = blend_normals(n, height_to_normal(h, px), 1.0)
    ao = np.clip(ao * cavity_ao(h, px, radii_m=(0.002, 0.008), depth_m=0.002) ** 0.6, 0, 1)
    rough = np.clip(0.84 + 0.14 * rough, 0, 1)
    save_set(name, np.clip(bc, 0, 1), n, ao, rough)


# ---------------------------------------------------------------- timber trim sheet

def _segments_band(rgb, nrm, rgh, aoi, out_w, out_h, seg_w, seed, fade=0.35):
    """A band out_w x out_h built from segments of a tileable source at random offsets, cross-faded, wrapping in x."""
    rng = np.random.default_rng(seed)
    H, W = rgb.shape[:2]
    nseg = out_w // seg_w
    yy, xx = np.mgrid[0:out_h, 0:out_w].astype(np.float32)
    acc_c = np.zeros((out_h, out_w, 3), np.float32)
    acc_n = np.zeros((out_h, out_w, 3), np.float32)
    acc_r = np.zeros((out_h, out_w), np.float32)
    acc_a = np.zeros((out_h, out_w), np.float32)
    wsum = np.zeros((out_h, out_w), np.float32)
    for i in range(nseg):
        oy, ox = rng.random() * H, rng.random() * W
        c = (i + 0.5) * seg_w
        dx = (xx - c + out_w / 2) % out_w - out_w / 2
        w = np.clip(1 - (np.abs(dx) - seg_w * (0.5 - fade / 2)) / (seg_w * fade), 0, 1)
        w = w * w * (3 - 2 * w) + 1e-4
        sy, sx = yy + oy, xx + ox
        acc_c += sample_wrap(rgb, sy, sx) * w[..., None]
        acc_n += sample_wrap(nrm, sy, sx) * w[..., None]
        acc_r += sample_wrap(rgh, sy, sx) * w
        acc_a += sample_wrap(aoi, sy, sx) * w
        wsum += w
    n = acc_n / wsum[..., None]
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return acc_c / wsum[..., None], n, acc_r / wsum, acc_a / wsum


def _end_grain(T, seed, log=True):
    """One end-grain tile T x T (0.25 m): rings, checks, pith; a log end has a bark rim."""
    rng = np.random.default_rng(seed)
    px = 0.25 / T
    yy, xx = np.mgrid[0:T, 0:T].astype(np.float32)
    if log:
        cx, cy = T / 2 + (rng.random() - 0.5) * T * 0.06, T / 2 + (rng.random() - 0.5) * T * 0.06
    else:
        cx, cy = T * (0.5 + (rng.random() - 0.5) * 0.9), T * (1.1 + rng.random() * 0.5)
    warp = (pnoise(T, 4, seed, octaves=3) - 0.5) * T * 0.06
    r = np.hypot(xx - cx, yy - cy + warp) * px                  # metres from the pith
    ang = np.arctan2(yy - cy, xx - cx)
    spacing = 0.004 + 0.003 * rng.random()
    ring = (r / spacing + (pnoise(T, 8, seed + 1, octaves=2) - 0.5) * 0.6) % 1.0
    late = smoothstep(0.6, 0.85, ring) * (1 - smoothstep(0.92, 1.0, ring))
    h = late * 0.0006
    col = np.array([0.60, 0.52, 0.42]) * (1 - 0.22 * late)[..., None]
    # weathering: greyer toward the outside, darker checks
    grey = np.clip(r / 0.12, 0, 1)[..., None]
    col = col * (1 - 0.3 * grey) + np.array([0.52, 0.50, 0.47]) * 0.3 * grey
    checks = np.zeros((T, T), np.float32)
    for k in range(int(3 + rng.random() * 4)):
        a0 = rng.random() * 2 * np.pi
        da = np.abs(np.angle(np.exp(1j * (ang - a0))))
        r0 = rng.random() * 0.02
        length = 0.05 + rng.random() * 0.08
        width = 0.002 + 0.004 * smoothstep(r0, r0 + length, r)          # widening outward
        on = (r > r0) & (r < r0 + length)
        checks = np.maximum(checks, on * smoothstep(width / np.maximum(r, 1e-3), 0, da))
    h -= checks * 0.004
    col *= (1 - 0.7 * checks)[..., None]
    pith = smoothstep(0.004, 0.0015, r)
    col *= (1 - 0.4 * pith)[..., None]
    if log:
        R = 0.118
        rim = smoothstep(R - 0.012, R - 0.008, r)
        bark = smoothstep(R - 0.002, R, r)
        col = col * (1 - rim[..., None]) + np.array([0.36, 0.29, 0.22]) * rim[..., None]
        col = col * (1 - bark[..., None]) + np.array([0.30, 0.25, 0.20]) * bark[..., None]
        h -= rim * 0.002
    mot = pnoise(T, 8, seed + 3, octaves=3)
    col *= (0.9 + 0.2 * mot)[..., None]
    return col, h, px


def timber(N=2048, name='timber', seed=41):
    out_c = np.zeros((N, N, 3), np.float32)
    out_n = np.zeros((N, N, 3), np.float32)
    out_r = np.zeros((N, N), np.float32)
    out_a = np.ones((N, N), np.float32)
    # weathered timber: rough_wood is 0.5 m at 4k; at 1024 px/m that is 512 px, grain turned to run along u
    wc = load(ph('rough_wood', 'diff'), 512)
    wn = decode_normal(load(ph('rough_wood', 'nor_gl'), 512))
    wr = load(ph('rough_wood', 'rough'), 512, gray=True)
    wa = load(ph('rough_wood', 'ao'), 512, gray=True)
    wc, wr, wa = np.rot90(wc, 1).copy(), np.rot90(wr, 1).copy(), np.rot90(wa, 1).copy()
    wn = rot90_normal(wn)
    c, n, r, a = _segments_band(wc, wn, wr, wa, N, 512, 512, seed)
    out_c[0:512], out_n[0:512], out_r[0:512], out_a[0:512] = match_mean(c, (0.47, 0.42, 0.36)), n, 0.72 + 0.2 * r, a
    c, n, r, a = _segments_band(wc, wn, wr, wa, N, 512, 512, seed + 1)
    out_c[512:1024], out_n[512:1024], out_r[512:1024], out_a[512:1024] = match_mean(c, (0.42, 0.33, 0.25)), n, 0.66 + 0.2 * r, a
    # bark (willow/poplar), 2.15 m at 2k -> 1024 px/m
    bc_ = load(ph('bark_willow_02', 'diff'), 2202)
    bn_ = decode_normal(load(ph('bark_willow_02', 'nor_gl'), 2202))
    br_ = load(ph('bark_willow_02', 'rough'), 2202, gray=True)
    ba_ = load(ph('bark_willow_02', 'ao'), 2202, gray=True)
    bc_, br_, ba_ = np.rot90(bc_, 1).copy(), np.rot90(br_, 1).copy(), np.rot90(ba_, 1).copy()
    bn_ = rot90_normal(bn_)
    c, n, r, a = _segments_band(bc_, bn_, br_, ba_, N, 512, 512, seed + 2)
    out_c[1024:1536], out_n[1024:1536], out_r[1024:1536], out_a[1024:1536] = match_mean(c, (0.40, 0.35, 0.29)), n, 0.8 + 0.15 * r, a
    # debarked pole: the timber scan at twice the scale, softened, greyed
    c, n, r, a = _segments_band(resize(wc, 1024), decode_normal(resize(wn * 0.5 + 0.5, 1024)),
                                resize(wr, 1024), resize(wa, 1024), N, 256, 512, seed + 3)
    n[..., :2] *= 0.6
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    out_c[1536:1792], out_n[1536:1792], out_r[1536:1792], out_a[1536:1792] = match_mean(c, (0.55, 0.50, 0.43)), n, 0.7 + 0.2 * r, a
    # end grain: 4 log ends, 4 squared-beam ends
    for k in range(8):
        col, h, pxm = _end_grain(256, seed + 10 + k, log=k < 4)
        nn = height_to_normal(h, pxm)
        x0 = k * 256
        out_c[1792:2048, x0:x0 + 256] = col
        out_n[1792:2048, x0:x0 + 256] = nn
        out_r[1792:2048, x0:x0 + 256] = 0.85
        out_a[1792:2048, x0:x0 + 256] = cavity_ao(h, pxm, radii_m=(0.002, 0.006), depth_m=0.002)
    save_set(name, np.clip(out_c, 0, 1), out_n, np.clip(out_a, 0, 1), np.clip(out_r, 0, 1))


# ---------------------------------------------------------------- reed mat

def reedmat(N=1024, name='reedmat', seed=51):
    """2/2 twill plaited reed strips, 0.5 m square, 32 strips each way (15.6 mm)."""
    px = 0.5 / N
    S = N // 32
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    i = (xx // S).astype(np.int32)                  # warp strip (vertical)
    j = (yy // S).astype(np.int32)                  # weft strip (horizontal)
    u = (xx % S) / S                                # across the warp strip
    v = (yy % S) / S                                # across the weft strip
    weft_top = ((i + j) % 4) < 2
    rng = np.random.default_rng(seed)
    sv = rng.random((2, 32, 4)).astype(np.float32)
    prof = lambda t: np.cos((t - 0.5) * np.pi * 0.95) ** 0.6
    gap = lambda t: smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.92, t)
    # each strip rises where it crosses over and dips where it passes under (along its own length)
    along_w = (yy / S)                               # warp runs along y
    along_f = (xx / S)                               # weft runs along x
    lift_w = np.cos(np.pi * (along_w - 0.5) / 2 + np.pi * ((i % 4) / 2)) * 0.0004
    lift_f = np.cos(np.pi * (along_f - 0.5) / 2 + np.pi * ((j % 4) / 2)) * 0.0004
    hw = 0.0012 * prof(u) * gap(u) + lift_w
    hf = 0.0012 * prof(v) * gap(v) + lift_f
    h = np.where(weft_top, hf + 0.0008, hw + 0.0008)
    vis = np.where(weft_top, gap(v), gap(u))
    h = h * vis - 0.002 * (1 - vis)
    # fibre striations along each strip
    stri_w = pnoise(N, 2, seed + 1, octaves=1)
    fine = np.sin((np.where(weft_top, v, u) * 9 + np.where(weft_top, sv[0, j % 32, 0], sv[1, i % 32, 0]) * 6) * np.pi) * 0.5 + 0.5
    fn = pnoise(N, 64, seed + 2, octaves=2)
    h += (fine - 0.5) * 0.00012 + (fn - 0.5) * 0.00008
    base = np.array([0.76, 0.64, 0.42])
    sk = np.where(weft_top, sv[0, j % 32, 1], sv[1, i % 32, 1])
    sg = np.where(weft_top, sv[0, j % 32, 2], sv[1, i % 32, 2])
    col = base * (0.82 + 0.3 * sk)[..., None]
    grey = (sg > 0.75)[..., None] * 0.35
    col = col * (1 - grey) + np.array([0.62, 0.58, 0.50]) * grey
    col *= (0.92 + 0.1 * fine)[..., None]
    col *= (0.9 + 0.2 * stri_w)[..., None]
    col = col * vis[..., None] + np.array([0.18, 0.14, 0.10]) * (1 - vis[..., None])
    n = height_to_normal(h, px)
    ao = cavity_ao(h, px, radii_m=(0.001, 0.003, 0.006), depth_m=0.0015)
    col *= (0.7 + 0.3 * ao)[..., None]
    rough = np.clip(0.62 + 0.2 * (1 - vis) + 0.1 * fn, 0, 1)
    save_set(name, np.clip(col, 0, 1), n, ao, rough)


# ---------------------------------------------------------------- ground (test scenes)

def ground(N=2048, name='ground', seed=61):
    bc = load(ph('brown_mud_dry', 'diff'), N)
    n = decode_normal(load(ph('brown_mud_dry', 'nor_gl'), N))
    rough = load(ph('brown_mud_dry', 'rough'), N, gray=True)
    ao = load(ph('brown_mud_dry', 'ao'), N, gray=True)
    bc = match_mean(bc, (0.56, 0.46, 0.35))
    d = load(ph('dirt', 'diff'), N)
    d = match_mean(d, (0.52, 0.43, 0.33))
    m = smoothstep(0.4, 0.75, pnoise(N, 4, seed, octaves=4))[..., None] * 0.6
    bc = bc * (1 - m) + d * m
    save_set(name, np.clip(bc, 0, 1), n, ao, np.clip(0.85 + 0.12 * rough, 0, 1))


SETS = {'mudplaster': mudplaster, 'mudbrick': mudbrick, 'roofmud': roofmud, 'timber': timber, 'reedmat': reedmat, 'ground': ground}

if __name__ == '__main__':
    names = sys.argv[1:] or list(SETS)
    for nm in names:
        SETS[nm]()
