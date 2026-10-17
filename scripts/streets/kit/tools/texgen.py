"""Texture toolkit for the streets kit: tileable PBR sets (base colour, normal, ORM) built from CC0 scans plus procedural
layers, all periodic so every set tiles. Pure numpy/scipy/Pillow; run with build/kit/venv/bin/python -I.

Conventions
- Arrays are float32, colour in sRGB 0..1 (H, W, 3); heights in metres; px_m is metres per pixel.
- Normal maps are OpenGL / glTF convention (+Y = up the texture, i.e. toward smaller row index).
- ORM: R = ambient occlusion, G = roughness, B = metalness (always 0 here).
- Every random draw comes from np.random.default_rng(seed) with fixed seeds, so the sets rebuild byte for byte.
"""
import os
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
PH = os.path.join(ROOT, 'build', 'kit', 'downloads', 'polyhaven')
TEX = os.path.join(ROOT, 'build', 'kit', 'textures')


# ---------------------------------------------------------------- io

def ph(aid, key):
    """Path of a downloaded Poly Haven map: key in diff, nor_gl, rough, ao, disp, arm."""
    d = os.path.join(PH, aid)
    for f in sorted(os.listdir(d)):
        if f.startswith(f'{aid}_{key}_'):
            return os.path.join(d, f)
    raise FileNotFoundError(f'{aid} {key}')


def load(path, size=None, gray=False):
    im = Image.open(path)
    if gray:
        im = im.convert('I;16') if im.mode in ('I;16', 'I', 'I;16B') else im.convert('L')
    else:
        im = im.convert('RGB')
    a = np.asarray(im).astype(np.float32)
    a /= 65535.0 if a.max() > 255.5 else 255.0
    if size is not None and a.shape[0] != size:
        a = resize(a, size)
    return a


def resize(a, size, size_w=None):
    """Resize a tileable image (wrap-padded so the borders stay seamless)."""
    h, w = a.shape[:2]
    tw = size_w or size
    pad = max(4, h // 16)
    big = np.pad(a, ((pad, pad), (pad, pad)) + (((0, 0),) if a.ndim == 3 else ()), mode='wrap')
    sy, sx = size / h, tw / w
    out_h, out_w = int(round(big.shape[0] * sy)), int(round(big.shape[1] * sx))
    chans = [big] if big.ndim == 2 else [big[..., c] for c in range(big.shape[2])]
    res = []
    for c in chans:
        im = Image.fromarray(c.astype(np.float32), mode='F').resize((out_w, out_h), Image.LANCZOS)
        res.append(np.asarray(im))
    r = res[0] if a.ndim == 2 else np.stack(res, -1)
    py, px = int(round(pad * sy)), int(round(pad * sx))
    return r[py:py + size, px:px + tw].astype(np.float32)


def save(path, a):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    a = np.clip(a, 0, 1)
    if a.ndim == 2:
        Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'L').save(path, optimize=True)
    elif a.shape[2] == 4:
        Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'RGBA').save(path, optimize=True)
    else:
        Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'RGB').save(path, optimize=True)


def save_set(name, bc, n, ao, rough, extra=None):
    """Write <TEX>/<name>/<name>_bc.png, _n.png, _orm.png (and _a.png etc. from extra)."""
    d = os.path.join(TEX, name)
    save(os.path.join(d, f'{name}_bc.png'), bc)
    save(os.path.join(d, f'{name}_n.png'), n * 0.5 + 0.5)
    orm = np.stack([ao, rough, np.zeros_like(ao)], -1)
    save(os.path.join(d, f'{name}_orm.png'), orm)
    for k, v in (extra or {}).items():
        save(os.path.join(d, f'{name}_{k}.png'), v)
    print('wrote', name, bc.shape)


def decode_normal(rgb):
    n = rgb * 2 - 1
    return n / np.linalg.norm(n, axis=-1, keepdims=True).clip(1e-6)


# ---------------------------------------------------------------- noise (periodic)

def pnoise(size, cells, seed, octaves=1, persistence=0.5, size_w=None):
    """Periodic fBm in 0..1: lattice `cells` across the image (an integer dividing the size), cubic interpolation."""
    rng = np.random.default_rng(seed)
    h, w = size, size_w or size
    acc = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    c = cells
    for _ in range(octaves):
        cy, cx = c, max(1, int(round(c * w / h)))
        lat = rng.random((cy, cx)).astype(np.float32)
        z = ndimage.zoom(lat, (h / cy, w / cx), order=3, mode='grid-wrap', grid_mode=True)
        acc += amp * z[:h, :w]
        tot += amp
        amp *= persistence
        c *= 2
    acc /= tot
    lo, hi = np.percentile(acc, 0.5), np.percentile(acc, 99.5)
    return np.clip((acc - lo) / max(1e-6, hi - lo), 0, 1)


def sample_wrap(a, yy, xx, order=1):
    """Sample a (H, W[, C]) image at float pixel coords with wrap."""
    if a.ndim == 2:
        return ndimage.map_coordinates(a, [yy, xx], order=order, mode='grid-wrap')
    return np.stack([ndimage.map_coordinates(a[..., c], [yy, xx], order=order, mode='grid-wrap') for c in range(a.shape[2])], -1)


def blur_wrap(a, sigma):
    if a.ndim == 2:
        return ndimage.gaussian_filter(a, sigma, mode='wrap')
    return np.stack([ndimage.gaussian_filter(a[..., c], sigma, mode='wrap') for c in range(a.shape[2])], -1)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- surface maths

def height_to_normal(h, px_m, strength=1.0):
    """OpenGL normal map from a height field in metres (wraps)."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * px_m)
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * px_m)
    # +x right; +y up the texture = toward smaller rows, so dh/dv = -dy
    n = np.stack([-dx * strength, dy * strength, np.ones_like(h)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def blend_normals(base, detail, k=1.0):
    """Whiteout blend of two decoded normal maps (detail weighted by k)."""
    d = detail.copy()
    d[..., :2] *= k
    n = np.stack([base[..., 0] + d[..., 0], base[..., 1] + d[..., 1], base[..., 2] * d[..., 2]], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def cavity_ao(h, px_m, radii_m=(0.004, 0.012, 0.035, 0.08), depth_m=0.02, power=1.0):
    """Ambient occlusion from height: how far each pixel sits below its blurred neighbourhood, over a few radii."""
    occ = np.zeros_like(h)
    for r in radii_m:
        s = max(0.6, r / px_m)
        b = ndimage.gaussian_filter(h, s, mode='wrap')
        occ += np.clip((b - h) / depth_m, 0, 1)
    occ /= len(radii_m)
    return np.clip(1 - occ, 0, 1) ** power


def fibres(size, n, length_px, width_px, seed, size_w=None, curl=0.15, angle=None, angle_jitter=np.pi):
    """A mask of short fibres (straw, chaff) drawn with wrap; returns (mask 0..1, per-fibre value map 0..1)."""
    rng = np.random.default_rng(seed)
    h, w = size, size_w or size
    im = Image.new('L', (w * 3, h * 3), 0)
    val = Image.new('L', (w * 3, h * 3), 0)
    d, dv = ImageDraw.Draw(im), ImageDraw.Draw(val)
    for _ in range(n):
        x, y = rng.random() * w + w, rng.random() * h + h
        a = (angle if angle is not None else 0) + (rng.random() - 0.5) * 2 * angle_jitter
        L = length_px * (0.4 + rng.random() * 0.9)
        wd = max(1, int(round(width_px * (0.6 + rng.random() * 0.8))))
        v = int(60 + rng.random() * 195)
        segs = 4
        pts = [(x, y)]
        for _s in range(segs):
            a += (rng.random() - 0.5) * curl
            x += np.cos(a) * L / segs
            y += np.sin(a) * L / segs
            pts.append((x, y))
        d.line(pts, fill=255, width=wd)
        dv.line(pts, fill=v, width=wd)
    m = np.asarray(im).astype(np.float32) / 255
    vv = np.asarray(val).astype(np.float32) / 255
    # fold the 3x3 canvas back onto the tile (wrap)
    fold = lambda a: np.maximum.reduce([a[i * h:(i + 1) * h, j * w:(j + 1) * w] for i in range(3) for j in range(3)])
    return fold(m), fold(vv)


def tint(rgb, mul):
    return np.clip(rgb * np.asarray(mul, np.float32), 0, 1)


def lum(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def match_mean(rgb, target):
    """Scale a colour image so its mean matches `target` (sRGB triple)."""
    m = rgb.reshape(-1, 3).mean(0)
    return np.clip(rgb * (np.asarray(target, np.float32) / np.maximum(m, 1e-4)), 0, 1)


def dilate_alpha(rgb, alpha, iters=16):
    """Bleed colour out of an alpha mask (for cutout cards), so mips do not darken edges."""
    rgb = rgb.copy()
    m = alpha > 0.5
    for _ in range(iters):
        if m.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(m.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            mm = np.roll(np.roll(m, dy, 0), dx, 1)
            acc += np.roll(np.roll(rgb, dy, 0), dx, 1) * mm[..., None]
            cnt += mm
        grow = (~m) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        m = m | grow
    return rgb
