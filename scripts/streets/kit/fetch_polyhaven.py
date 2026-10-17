"""Fetch the Poly Haven (CC0) sources the streets kit is built from.

Downloads are untrusted data: each asset goes in its own directory under build/kit/downloads/polyhaven/<id>/, only
image files (and, for models, glTF + .bin + images) are kept, and nothing downloaded is ever executed. A manifest of
every file (URL, authors, licence, SHA-256) is written to build/kit/downloads/polyhaven/manifest.json; LICENSES.md is
generated from it by build_licenses.py.

Run with the system python (no third-party modules):
  python3 -I scripts/streets/kit/fetch_polyhaven.py [--only=id,id]
"""
import hashlib
import json
import os
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'build', 'kit', 'downloads', 'polyhaven')
API = 'https://api.polyhaven.com'
UA = {'User-Agent': 'palimpsest-streets-kit/1.0 (build script)'}

# id -> (resolution, maps); map keys are the API's (Diffuse, nor_gl, Rough, AO, Displacement, arm)
TEXTURES = {
    # walls: mud plaster (hero), lime-washed plaster, raw mud for brick faces
    'clay_plaster': ('4k', ['Diffuse', 'nor_gl', 'Rough', 'AO', 'Displacement']),
    'patterned_clay_plaster': ('2k', ['Diffuse', 'nor_gl', 'Rough', 'AO', 'Displacement']),
    'mud_cracked_dry_03': ('2k', ['Diffuse', 'nor_gl', 'Rough', 'Displacement']),
    'clay_block_wall': ('2k', ['Diffuse', 'nor_gl', 'Rough', 'Displacement']),
    'sand_01': ('2k', ['Diffuse', 'nor_gl', 'Rough', 'Displacement']),
    # roofs and ground
    'dry_mud_field_001': ('2k', ['Diffuse', 'nor_gl', 'Rough', 'AO', 'Displacement']),
    'brown_mud_dry': ('2k', ['Diffuse', 'nor_gl', 'Rough', 'AO', 'Displacement']),
    'dirt': ('2k', ['Diffuse', 'nor_gl', 'Rough', 'AO', 'Displacement']),
    'dry_ground_01': ('2k', ['Diffuse', 'nor_gl', 'Rough', 'Displacement']),
    # timber
    'rough_wood': ('4k', ['Diffuse', 'nor_gl', 'Rough', 'AO', 'Displacement']),
    'bark_willow_02': ('2k', ['Diffuse', 'nor_gl', 'Rough', 'AO', 'Displacement']),
    'weathered_planks': ('2k', ['Diffuse', 'nor_gl', 'Rough', 'AO', 'Displacement']),
    # cloth, trunks
    'hessian_230': ('2k', ['Diffuse', 'nor_gl', 'Rough', 'Displacement']),
    'rough_linen': ('2k', ['Diffuse', 'nor_gl', 'Rough', 'Displacement']),
    'palm_bark': ('2k', ['Diffuse', 'nor_gl', 'Rough', 'Displacement']),
    'bark_platanus': ('2k', ['Diffuse', 'nor_gl', 'Rough', 'Displacement']),
    'withered_grass': ('2k', ['Diffuse', 'nor_gl', 'Rough']),
}
# render-only lighting (never shipped)
HDRIS = {
    'qwantani_late_afternoon_puresky': '4k',
    'qwantani_mid_morning_puresky': '4k',
}
IMAGE_EXT = ('.jpg', '.jpeg', '.png', '.exr', '.hdr')


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def download(url, dest):
    if not url.lower().endswith(IMAGE_EXT):
        raise ValueError(f'refusing non-image file {url}')
    if not os.path.exists(dest):
        tmp = dest + '.part'
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r, open(tmp, 'wb') as f:
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                f.write(b)
        os.replace(tmp, dest)
    h = hashlib.sha256()
    with open(dest, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def extra_sources():
    """More sources from scripts/streets/kit/sources_*.json: {"textures": {id: [res, [maps]]}, "models": {id: res}}."""
    kit = os.path.dirname(os.path.abspath(__file__))
    for f in sorted(os.listdir(kit)):
        if f.startswith('sources_') and f.endswith('.json'):
            d = json.load(open(os.path.join(kit, f)))
            for k, v in d.get('textures', {}).items():
                TEXTURES[k] = (v[0], v[1])
            for k, v in d.get('models', {}).items():
                MODELS[k] = v


MODELS = {}
MODEL_EXT = ('.gltf', '.bin') + IMAGE_EXT


def fetch_model(aid, res, manifest):
    """A Poly Haven model as glTF: the .gltf, its .bin and its texture images only."""
    info = get_json(f'{API}/info/{aid}')
    files = get_json(f'{API}/files/{aid}')
    g = files['gltf'][res]['gltf']
    d = os.path.join(OUT, aid)
    os.makedirs(d, exist_ok=True)
    entry = {'kind': 'model', 'name': info.get('name'), 'authors': list(info.get('authors', {}).keys()),
             'page': f'https://polyhaven.com/a/{aid}', 'licence': 'CC0 1.0', 'files': {}}
    todo = [('gltf', g['url'], os.path.join(d, g['url'].rsplit('/', 1)[-1]))]
    for rel, inc in g.get('include', {}).items():
        if not rel.lower().endswith(MODEL_EXT) or '..' in rel or rel.startswith('/'):
            continue
        todo.append((rel, inc['url'], os.path.join(d, rel)))
    for key, url, dest in todo:
        if not url.lower().endswith(MODEL_EXT):
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if not os.path.exists(dest):
            tmp = dest + '.part'
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r, open(tmp, 'wb') as f:
                f.write(r.read())
            os.replace(tmp, dest)
        h = hashlib.sha256(open(dest, 'rb').read()).hexdigest()
        entry['files'][key] = {'url': url, 'file': os.path.relpath(dest, ROOT), 'sha256': h}
    manifest[aid] = entry
    print(aid, 'model ok')


def main():
    extra_sources()
    only = None
    for a in sys.argv[1:]:
        if a.startswith('--only='):
            only = set(a[7:].split(','))
    os.makedirs(OUT, exist_ok=True)
    mpath = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(mpath)) if os.path.exists(mpath) else {}
    for aid, (res, maps) in TEXTURES.items():
        if only and aid not in only:
            continue
        info = get_json(f'{API}/info/{aid}')
        files = get_json(f'{API}/files/{aid}')
        d = os.path.join(OUT, aid)
        os.makedirs(d, exist_ok=True)
        entry = {'kind': 'texture', 'name': info.get('name'), 'authors': list(info.get('authors', {}).keys()),
                 'page': f'https://polyhaven.com/a/{aid}', 'licence': 'CC0 1.0', 'dimensions_mm': info.get('dimensions'),
                 'files': {}}
        for m in maps:
            fmt = 'png' if m in ('nor_gl', 'Displacement') else 'jpg'
            url = files[m][res][fmt]['url']
            dest = os.path.join(d, url.rsplit('/', 1)[-1])
            entry['files'][m] = {'url': url, 'file': os.path.relpath(dest, ROOT), 'sha256': download(url, dest)}
            print(aid, m, 'ok')
        manifest[aid] = entry
    for aid, res in HDRIS.items():
        if only and aid not in only:
            continue
        info = get_json(f'{API}/info/{aid}')
        files = get_json(f'{API}/files/{aid}')
        d = os.path.join(OUT, aid)
        os.makedirs(d, exist_ok=True)
        url = files['hdri'][res]['hdr']['url']
        dest = os.path.join(d, url.rsplit('/', 1)[-1])
        manifest[aid] = {'kind': 'hdri (render only, not shipped)', 'name': info.get('name'),
                         'authors': list(info.get('authors', {}).keys()), 'page': f'https://polyhaven.com/a/{aid}',
                         'licence': 'CC0 1.0', 'files': {'hdri': {'url': url, 'file': os.path.relpath(dest, ROOT),
                                                                   'sha256': download(url, dest)}}}
        print(aid, 'hdri ok')
    for aid, res in MODELS.items():
        if only and aid not in only:
            continue
        fetch_model(aid, res, manifest)
    json.dump(manifest, open(mpath, 'w'), indent=1, sort_keys=True)


main()
