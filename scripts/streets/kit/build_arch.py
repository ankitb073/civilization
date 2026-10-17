"""Build the architecture pack (walls, corners, openings, roofs, parapets, stairs, ladders, courtyard walls, city wall
and gate, temple porch) and export build/kit/export/arch.glb + build/kit/stats/arch.json.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/streets/kit/build_arch.py -- \
      [--only=wall_4m_a,corner_out] [--pack=arch]

Frames (glTF, as kit.json states): x runs along a wall, y up, the exterior faces +Z. In Blender the exterior faces -Y.
"""
import os
import sys
import time
import math
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import kitlib as K  # noqa: E402
from archparts import (build_wall, build_corner, finalize_lod, Opening, beam_box, log_cyl, MATS,  # noqa: E402
                       MAT_TIMBER, STEP)
import archpieces as AP  # noqa: E402

A = K.args()
PACK = A.get('pack', 'arch')
ONLY = set(A['only'].split(',')) if 'only' in A else None
T_WALL = 0.5
H_STOREY = 3.0

WALL_PIVOT = ('x 0..W along the run from the pivot; y 0 at the foot; the exterior face is the plane z = 0, the wall '
              'body runs to z = -0.5; exterior faces +Z')
BAND_PIVOT = WALL_PIVOT.replace('y 0 at the foot', 'y 0 at its foot (stack on a wall or band at y = 3.0 / 1.0)')


def lods(fn, name, **kw):
    out = []
    for lod in (0, 1, 2):
        ob = fn(name if lod == 0 else f'{name}_LOD{lod}', lod=lod, **kw)
        out.append(ob)
    return out


def wall_piece(name, lod, W, seed, H=H_STOREY, openings=(), base=True, density=1.0, t_range=(0.75, None), damp=0.55):
    ob = build_wall(name, W, H, T_WALL, seed, lod, openings=openings, base=base, density=density, t_range=t_range,
                    damp=damp)
    return finalize_lod(ob, lod)


def corner_piece(name, lod, H=H_STOREY, seed=5, base=True, damp=0.55):
    return finalize_lod(build_corner(name, H, T_WALL, seed, lod, base=base, damp=damp), lod, {0: 0.35, 1: 0.8, 2: 1.0}[lod])


PIECES = []


def piece(name, kind, snap, pivot, notes='', view=None, bake_ground=True, **extra):
    def deco(fn):
        PIECES.append(dict(name=name, kind=kind, snap=snap, pivot=pivot, notes=notes, fn=fn, view=view,
                           bake_ground=bake_ground, extra=extra))
        return fn
    return deco


# ---------------------------------------------------------------- walls

for nm, W, seed, dens in (('wall_1m', 1.0, 11, 0.8), ('wall_1m_b', 1.0, 16, 1.2), ('wall_2m_a', 2.0, 12, 1.0),
                          ('wall_2m_b', 2.0, 13, 1.3), ('wall_2m_c', 2.0, 17, 0.7), ('wall_4m_a', 4.0, 14, 1.0),
                          ('wall_4m_b', 4.0, 15, 1.4), ('wall_4m_c', 4.0, 18, 0.8)):
    piece(nm, 'wall', {'x': W, 'y': H_STOREY, 'z': T_WALL, 'stretch': 'x 0.9-1.1, y 0.85-1.15'}, WALL_PIVOT,
          'house wall, one storey: plaster worn to brick along the foot (meets the ends at 0.30 m) and in patches; '
          'plain plaster inside face')(lambda name, lod, W=W, seed=seed, dens=dens: wall_piece(name, lod, W, seed, density=dens))

for nm, W, seed in (('wallband_1m', 1.0, 21), ('wallband_2m', 2.0, 22), ('wallband_4m', 4.0, 23)):
    piece(nm, 'wall', {'x': W, 'y': 1.0, 'z': T_WALL, 'stretch': 'x 0.9-1.1, y 0.85-1.15'}, BAND_PIVOT,
          'upper band of plaster for taller walls (no worn foot); stack above a wall_*', bake_ground=False)(
        lambda name, lod, W=W, seed=seed: wall_piece(name, lod, W, seed, H=1.0, base=False, density=0.7,
                                                     t_range=(0.3, 0.7), damp=-2.0))

piece('corner_out', 'corner', {'x': T_WALL, 'y': H_STOREY, 'z': T_WALL}, 'the corner column x 0..0.5, z -0.5..0; '
      'exterior faces +Z and -X, rounded arris at the origin. Put one at the start of every side; that side\'s walls '
      'start at x = 0.5, the previous side ends against its -X face',
      'external corner, worn hardest along the arris and at the foot', view=[-1.0, -1.0, 0.55])(
    lambda name, lod: corner_piece(name, lod))
piece('cornerband', 'corner', {'x': T_WALL, 'y': 1.0, 'z': T_WALL}, 'as corner_out, 1 m tall, stack above it',
      'upper band of an external corner', view=[-1.0, -1.0, 0.55], bake_ground=False)(
    lambda name, lod: corner_piece(name, lod, H=1.0, seed=6, base=False, damp=-2.0))

# ---------------------------------------------------------------- openings

piece('door_2m', 'wall', {'x': 2.0, 'y': H_STOREY, 'z': T_WALL, 'stretch': 'x 0.95-1.05, y 0.9-1.15'}, WALL_PIVOT,
      'wall with a doorway 0.95 x 1.90 m centred at x = 1.0: rounded, worn jambs, an adzed timber lintel, a timber '
      'threshold; hang door_leaf_s in it (see that piece)')(lambda name, lod: AP.door_wall(name, lod, 2.0, 0.95, 1.9, 31))
piece('door_3m', 'wall', {'x': 3.0, 'y': H_STOREY, 'z': T_WALL, 'stretch': 'x 0.95-1.05, y 0.9-1.15'}, WALL_PIVOT,
      'wall with a wide doorway 1.40 x 2.25 m centred at x = 1.5 (the house of tablets, the palace): lintel of two '
      'beams; hang door_leaf_l')(lambda name, lod: AP.door_wall(name, lod, 3.0, 1.4, 2.25, 32, double_lintel=True))
piece('door_2m_b', 'wall', {'x': 2.0, 'y': H_STOREY, 'z': T_WALL, 'stretch': 'x 0.95-1.05, y 0.9-1.15'}, WALL_PIVOT,
      'as door_2m, another wear pattern')(lambda name, lod: AP.door_wall(name, lod, 2.0, 0.95, 1.9, 35))
piece('window_2m', 'wall', {'x': 2.0, 'y': H_STOREY, 'z': T_WALL, 'stretch': 'x 0.95-1.05, y 0.9-1.15'}, WALL_PIVOT,
      'wall with a small high window 0.50 x 0.42 m (sill at 2.0 m) centred at x = 1.0: timber lintel, a grille of '
      'lashed sticks, dark interior behind')(lambda name, lod: AP.window_wall(name, lod, 2.0, 0.5, 0.42, 2.0, 33))
piece('door_leaf_s', 'door', {'x': 1.05, 'y': 1.95}, 'hinge-post axis at the origin (vertical, y up); the leaf runs '
      'along +x when closed, its outer face toward +Z. In door_2m (and door_2m_b): place at (0.49, 0, -0.34) and rotate about y to open (inward)',
      'plank door with battens and a pivot post', view=[-0.6, -1.4, 0.35])(lambda name, lod: AP.door_leaf(name, lod, 1.03, 1.93, 41))
piece('door_leaf_l', 'door', {'x': 0.74, 'y': 2.3}, 'as door_leaf_s; a pair fills door_3m: (0.77, 0, -0.34) and '
      '(2.23, 0, -0.34) mirrored', 'one leaf of a double door, heavier battens', view=[-0.6, -1.4, 0.35])(
    lambda name, lod: AP.door_leaf(name, lod, 0.74, 2.28, 42, heavy=True))

# ---------------------------------------------------------------- the rest of the kit lives in archpieces.py
AP.register(piece, T_WALL, H_STOREY)


def build():
    t0 = time.time()
    K.reset()
    metas, objs = [], []
    for p in PIECES:
        if ONLY and p['name'] not in ONLY:
            continue
        t = time.time()
        obs = lods(p['fn'], p['name'])
        for o in obs:
            K.ensure_col(o)
        K.bake_ao(obs, samples=256, distance=0.5, ground=p['bake_ground'], strength=0.55)
        for o in obs:
            o.location = (0, 0, 0)
        extra = dict(p['extra'])
        if p['view']:
            extra['view'] = p['view']
        metas.append(K.piece_meta(p['name'], obs, p['kind'], p['snap'], p['pivot'], p['notes'], extra))
        objs += obs
        print(f"{p['name']}: {[m['tris'] for m in metas[-1]['lods']]} tris, {time.time() - t:.1f}s", flush=True)
    path = os.path.join(K.EXPORT, f'{PACK}.glb')
    K.export_glb(objs, path)
    K.write_stats(PACK, metas, f'{PACK}.glb')
    print(f'exported {path} in {time.time() - t0:.0f}s')


build()
