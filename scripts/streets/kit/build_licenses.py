"""Write atlas/public/game/streets/kit/LICENSES.md from the download manifest (build/kit/downloads/polyhaven/
manifest.json) and the build scripts: every third-party source with its URL, authors, licence and file hashes, which
scripts use it, and a statement on everything else (generated here). Run: python3 -I scripts/streets/kit/build_licenses.py
"""
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
KIT = os.path.join(ROOT, 'scripts', 'streets', 'kit')
MAN = os.path.join(ROOT, 'build', 'kit', 'downloads', 'polyhaven', 'manifest.json')
OUT = os.path.join(ROOT, 'atlas', 'public', 'game', 'streets', 'kit', 'LICENSES.md')

man = json.load(open(MAN))
scripts = []
for d, _, fs in os.walk(KIT):
    for f in fs:
        if f.endswith('.py') and f != 'build_licenses.py' and f != 'fetch_polyhaven.py':
            scripts.append(os.path.join(d, f))
src = {p: open(p).read() for p in scripts}
users = {}
for aid in man:
    pat = re.compile(r"['\"/]" + re.escape(aid) + r"['\"/_]")
    users[aid] = sorted(os.path.relpath(p, ROOT) for p, t in src.items() if pat.search(t))

L = []
L.append('# Streets kit: sources and licences\n')
L.append('Files in this folder (`*.gltf`, `*.bin`, `tex/**.ktx2`, `kit.json`) are the Pumi hero-district kit for '
         '*Runner of the Tablet House* (`#/streets`). They are built by the scripts in `scripts/streets/kit/` '
         '(Blender 5.2 headless, numpy, basisu, glTF-Transform); every asset can be regenerated from them.\n')
L.append('## What is ours\n')
L.append('All geometry (architecture, props, vegetation) is modelled procedurally by those scripts; none is taken '
         'from a third-party model unless listed below. Textures are built by `textures_*.py` from the CC0 scans '
         'listed below plus procedural layers (brick bonds, straw and chaff, cracks, weaves, end grain, patterns, '
         'foliage cards). This derived work is part of this repository and carries its licence. The scans themselves '
         'stay CC0.\n')
L.append('## Third-party sources (all CC0 1.0 Universal)\n')
L.append('Poly Haven (https://polyhaven.com) publishes every asset under CC0 1.0 '
         '(https://creativecommons.org/publicdomain/zero/1.0/); attribution is not required and is given anyway. '
         'Downloads were kept in their own folder (`build/kit/downloads/polyhaven/<id>/`), only image and model files '
         'were fetched (`fetch_polyhaven.py`), and they were read as data, never executed.\n')
used = {k: v for k, v in man.items() if users[k] and 'render only' not in v['kind']}
render_only = {k: v for k, v in man.items() if 'render only' in v['kind']}
unused = {k: v for k, v in man.items() if not users[k] and 'render only' not in v['kind']}
L.append('| Asset | Kind | Authors | Licence | Used by |')
L.append('|---|---|---|---|---|')
for k, v in sorted(used.items()):
    L.append(f"| [{v.get('name') or k}]({v['page']}) (`{k}`) | {v['kind']} | {', '.join(v['authors'])} | {v['licence']} | "
             f"{', '.join('`' + u + '`' for u in users[k])} |")
L.append('')
if render_only:
    L.append('**Used only to light the review renders (not shipped):** ' + '; '.join(
        f"[{v.get('name') or k}]({v['page']}) by {', '.join(v['authors'])}, {v['licence']}" for k, v in sorted(render_only.items())) + '.\n')
if unused:
    L.append('**Downloaded for evaluation, not used in shipped files:** ' + ', '.join(
        f"[{k}]({v['page']})" for k, v in sorted(unused.items())) + ' (all CC0 1.0).\n')
L.append('The review renders also place the runner (`../runner.glb`, CC0, see `../LICENSES.md`) for scale.\n')
L.append('### Files fetched (URL and SHA-256)\n')
for k, v in sorted(man.items()):
    L.append(f"- `{k}`:")
    for m, f in sorted(v['files'].items()):
        L.append(f"  - {m}: {f['url']} `{f['sha256']}`")
L.append('')
open(OUT, 'w').write('\n'.join(L))
print('wrote', OUT, len(used), 'used,', len(unused), 'unused,', len(render_only), 'render-only')
