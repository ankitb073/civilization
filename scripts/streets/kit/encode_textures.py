"""Encode every kit material's texture set to KTX2 (Basis Universal, open source `basisu` CLI) for two tiers:
  hi  (desktop): the set's `hi` size; base colour and ORM ETC1S, normals UASTC (zstd) when the material says so
  lo  (phones):  the set's `lo` size; everything ETC1S
Sources: build/kit/textures/<set>/<set>_{bc|bca,n,orm}.png. Output: build/kit/ktx2/<tier>/<set>_{bc,n,orm}.ktx2.
Skips outputs newer than their source. Run: build/kit/venv/bin/python -I scripts/streets/kit/encode_textures.py [--force] [--only=set1,set2]
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
KIT = os.path.join(ROOT, 'scripts', 'streets', 'kit')
TEX = os.path.join(ROOT, 'build', 'kit', 'textures')
OUT = os.path.join(ROOT, 'build', 'kit', 'ktx2')
TMP = os.path.join(ROOT, 'build', 'kit', 'tmp', 'resized')
BASISU = '/opt/homebrew/bin/basisu'
force = '--force' in sys.argv
ONLY = next((set(a[7:].split(',')) for a in sys.argv if a.startswith('--only=')), None)


def defs():
    d = {}
    for f in sorted(os.listdir(KIT)):
        if f.startswith('materials') and f.endswith('.json'):
            d.update(json.load(open(os.path.join(KIT, f))))
    return d


def job(src, dst, size, flags):
    if not force and os.path.exists(dst) and os.path.getmtime(dst) > os.path.getmtime(src):
        return dst, 'cached'
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    os.makedirs(TMP, exist_ok=True)
    im = Image.open(src)
    if im.width != size:
        im = im.resize((size, size), Image.LANCZOS)
    tmp = os.path.join(TMP, os.path.basename(dst).replace('.ktx2', f'_{size}.png'))
    im.save(tmp)
    cmd = [BASISU, '-ktx2', '-mipmap', '-effort', '5'] + flags + [tmp, '-output_file', dst]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(dst):
        raise RuntimeError(f'basisu failed for {src}: {r.stdout[-800:]} {r.stderr[-800:]}')
    return dst, 'ok'


def main():
    jobs = []
    for name, d in defs().items():
        s = d['set']
        if ONLY and s not in ONLY:
            continue
        base = os.path.join(TEX, s, s)
        bc = base + ('_bca.png' if d.get('alpha') else '_bc.png')
        for tier in ('hi', 'lo'):
            size = d[tier]
            o = os.path.join(OUT, tier, s)
            jobs.append((bc, o + '_bc.ktx2', size, ['-etc1s', '-quality', '95' if d.get('alpha') else '90']))
            if d.get('normal', 'etc1s') == 'uastc' and tier == 'hi':
                jobs.append((base + '_n.png', o + '_n.ktx2', size, ['-uastc', '-linear', '-quality', '70']))
            else:
                jobs.append((base + '_n.png', o + '_n.ktx2', size, ['-etc1s', '-linear', '-normal_map', '-quality', '100']))
            jobs.append((base + '_orm.png', o + '_orm.ktx2', size, ['-etc1s', '-linear', '-quality', '90']))
    # unique outputs (two materials may share a set)
    seen, uniq = set(), []
    for j in jobs:
        if j[1] not in seen:
            seen.add(j[1])
            uniq.append(j)
    with ThreadPoolExecutor(max_workers=12) as ex:
        for dst, st in ex.map(lambda j: job(*j), uniq):
            print(st, os.path.relpath(dst, ROOT), os.path.getsize(dst))


main()
