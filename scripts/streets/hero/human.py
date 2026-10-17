# Step 2 of the hero build: the body. Builds the MakeHuman/MPFB human from hero_human.json (CC0 base mesh, targets,
# rig weights and system assets), fits it to the game's UAL skeleton and binds it there:
#   1. Size: MPFB's scale is chosen so its hip-to-ankle length equals the UAL skeleton's.
#   2. Bind pose: the UAL skeleton is posed like the MPFB mesh (its relaxed A-pose), so the mesh needs no big
#      rotations. Each UAL bone takes MPFB's rest orientation through a per-bone offset measured with both rigs in a
#      T-pose (UAL's rest, MPFB's own t-pose.json), then is aimed exactly at MPFB's next joint; the spine leans so the
#      neck and shoulders meet MPFB's.
#   3. Fit: MPFB's own rig moves the mesh's joints onto the posed UAL joints (limbs, neck and head: moved, turned and
#      stretched along the bone); the pose is applied to the mesh.
#   4. Weights: MPFB's hand-made weights for its game_engine rig (the same bone names as UAL) for limbs, neck and head;
#      the trunk's share is re-spread over UAL's own spine joints by height (the two rigs place spine joints
#      differently).
# Writes build/hero/work/human.blend (meshes bound to UAL_bind, an armature whose rest is the bind pose) and
# build/hero/work/bind.json (each joint's bind pose as a change from the UAL rest, in glTF space).
import os
import sys
sys.dont_write_bytecode = True  # no __pycache__ in the repo
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import json
import bpy
from mathutils import Matrix, Vector
import hero_common as H

A = H.args()
OUT = A.get('out', os.path.join(H.WORK, 'human.blend'))
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # glTF (y up) → Blender (z up)
CI = C.inverted()

sk = json.load(open(os.path.join(H.WORK, 'skeleton.json')))
INFO = json.load(open(os.path.join(H.HERE, 'hero_human.json')))


def build(scale):
    H.clear_scene()
    M = H.mpfb()
    HS = M['humanservice'].HumanService
    human = json.loads(json.dumps(INFO['human']))
    st = HS.get_default_deserialization_settings()
    st.update({'subdiv_levels': 0, 'load_clothes': False, 'material_instances': 'NEVER', 'scale': scale})
    base = HS.deserialize_from_dict(human, st)
    return base, base.parent, M


def wloc(rig, name, tail=False):
    b = rig.data.bones[name]
    return rig.matrix_world @ (b.tail_local if tail else b.head_local)


# ---------------------------------------------------------------- 1. size
ual_rest = {}
for j in sk['joints']:
    W = Matrix([j['world'][i::4] for i in range(4)])  # column-major → rows
    ual_rest[j['name']] = C @ W
ual_leg = (ual_rest['thigh_l'].translation - ual_rest['foot_l'].translation).length
base, rig, M = build(0.1)
mp_leg = (wloc(rig, 'thigh_l') - wloc(rig, 'foot_l')).length
scale = 0.1 * ual_leg / mp_leg
print(f'HERO size: UAL leg {ual_leg:.4f}, MPFB leg {mp_leg:.4f} → scale {scale:.5f}')
base, rig, M = build(scale)
print('HERO leg now', (wloc(rig, 'thigh_l') - wloc(rig, 'foot_l')).length)

# ---------------------------------------------------------------- UAL armature from skeleton.json (frames = glTF frames)
parent = {j['name']: j['parent'] for j in sk['joints']}
children = {}
for j in sk['joints']:
    children.setdefault(j['parent'], []).append(j['name'])
order = [j['name'] for j in sk['joints']]  # skin order is parent-first in runner.glb
def depth(n):
    d = 0
    while parent.get(n) in ual_rest:
        n = parent[n]; d += 1
    return d
order.sort(key=depth)

arm = bpy.data.armatures.new('UAL')
ual = bpy.data.objects.new('UAL', arm)
bpy.context.scene.collection.objects.link(ual)
bpy.context.view_layer.objects.active = ual
bpy.ops.object.mode_set(mode='EDIT')
for n in order:
    Wb = ual_rest[n]
    kids = children.get(n, [])
    L = min([(ual_rest[k].translation - Wb.translation).length for k in kids] or [0.05])
    L = max(L, 0.02)
    eb = arm.edit_bones.new(n)
    eb.head = Wb.translation
    eb.tail = Wb.translation + Wb.col[1].xyz.normalized() * L
    eb.align_roll(Wb.col[2].xyz)
    if parent[n] in ual_rest:
        eb.parent = arm.edit_bones[parent[n]]
bpy.ops.object.mode_set(mode='OBJECT')
# check: Blender bone frames equal the glTF joint frames
err = max(abs(a - b) for n in order for ra, rb in zip(ual.data.bones[n].matrix_local.to_3x3(), ual_rest[n].to_3x3()) for a, b in zip(ra, rb))
print(f'HERO UAL frames vs glTF: max element error {err:.2e}')

# ---------------------------------------------------------------- 2. bind pose
MP = {b.name.lower(): b.name for b in rig.data.bones}  # lower-case → MPFB name ('head', 'Root')
def mp(n):
    return MP.get(n.lower()) if n != 'root' else None

# MPFB frames at rest (its A-pose) and in its own T-pose
rest_m = {b.name: rig.matrix_world @ b.matrix_local for b in rig.data.bones}
import importlib
LS = importlib.import_module('bl_ext.user_default.mpfb.services.locationservice').LocationService
tpose = json.load(open(os.path.join(LS.get_mpfb_data('poses'), 'game_engine_fk', 't-pose.json')))
for pb in rig.pose.bones:
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = tpose['bone_rotations'].get(pb.name, (0, 0, 0))
bpy.context.view_layer.update()
t_m = {pb.name: rig.matrix_world @ pb.matrix for pb in rig.pose.bones}
for pb in rig.pose.bones:
    pb.rotation_euler = (0, 0, 0)
bpy.context.view_layer.update()

R = {}       # bind-pose world rotation (3×3) of each UAL joint
P = {}       # bind-pose world position of each UAL joint
off = {n: ual_rest[parent[n]].to_3x3().inverted() @ (ual_rest[n].translation - ual_rest[parent[n]].translation)
       for n in order if parent[n] in ual_rest}
loc_rest = {n: ual_rest[parent[n]].to_3x3().inverted() @ ual_rest[n].to_3x3() for n in order if parent[n] in ual_rest}

def calib(n):
    m = mp(n)
    if not m:
        return None
    O = ual_rest[n].to_3x3().inverted() @ t_m[m].to_3x3()
    return rest_m[m].to_3x3() @ O.inverted()

def fk(n):
    """Recompute positions (and inherited rotations of unmapped joints) below n."""
    stack = [n]
    while stack:
        a = stack.pop()
        for k in children.get(a, []):
            if k not in R or not mp(k):
                R[k] = R[a] @ loc_rest[k]
            P[k] = P[a] + R[a] @ off[k]
            stack.append(k)

# start: every joint at its calibrated orientation (unmapped ones keep their rest relation to the parent)
for n in order:
    if parent[n] not in ual_rest:
        R[n] = ual_rest[n].to_3x3(); P[n] = ual_rest[n].translation.copy(); continue
    c = calib(n)
    R[n] = c.normalized() if c is not None else R[parent[n]] @ loc_rest[n]
    P[n] = P[parent[n]] + R[parent[n]] @ off[n]
# pelvis: hips' midpoint on MPFB's
mid_u = (P['thigh_l'] + P['thigh_r']) / 2
mid_m = (wloc(rig, 'thigh_l') + wloc(rig, 'thigh_r')) / 2
P['pelvis'] = P['pelvis'] + (mid_m - mid_u)
fk('pelvis')

def aim(n, child, target):
    """Turn joint n (least rotation) so its child points at target."""
    e = (P[child] - P[n]).normalized()
    d = (target - P[n]).normalized()
    q = e.rotation_difference(d).to_matrix()
    R[n] = (q @ R[n]).normalized()
    fk(n)

def mpt(name, tail=False):
    return wloc(rig, MP[name.lower()], tail)

# spine: lean so the neck meets MPFB's (three joints share the turn), then the neck aims at the head
for _ in range(6):
    for s, share in (('spine_01', 0.34), ('spine_02', 0.5), ('spine_03', 1.0)):
        e = (P['neck_01'] - P[s]).normalized()
        d = (mpt('neck_01') - P[s]).normalized()
        q = Matrix.Identity(3).to_quaternion().slerp(e.rotation_difference(d), share).to_matrix()
        R[s] = (q @ R[s]).normalized()
        fk(s)
aim('neck_01', 'Head', mpt('head'))

CHAINS = []
for sd in ('l', 'r'):
    CHAINS += [(f'clavicle_{sd}', f'upperarm_{sd}'), (f'upperarm_{sd}', f'lowerarm_{sd}'), (f'lowerarm_{sd}', f'hand_{sd}'),
               (f'hand_{sd}', f'middle_01_{sd}')]
    for f in ('index', 'middle', 'ring', 'pinky', 'thumb'):
        CHAINS += [(f'{f}_01_{sd}', f'{f}_02_{sd}'), (f'{f}_02_{sd}', f'{f}_03_{sd}'), (f'{f}_03_{sd}', f'{f}_04_leaf_{sd}')]
    CHAINS += [(f'thigh_{sd}', f'calf_{sd}'), (f'calf_{sd}', f'foot_{sd}'), (f'foot_{sd}', f'ball_{sd}'), (f'ball_{sd}', f'ball_leaf_{sd}')]
def target_of(child):
    if '04_leaf' in child:
        return mpt(child.replace('04_leaf', '03'), tail=True)
    if child.startswith('ball_leaf'):
        return mpt(child.replace('ball_leaf', 'ball'), tail=True)
    return mpt(child)
import numpy as np
def fit_hand(sd):
    """The palm: turn the hand about the wrist so its five knuckles best meet MPFB's (Kabsch)."""
    h = f'hand_{sd}'
    ks = [f'{f}_01_{sd}' for f in ('index', 'middle', 'ring', 'pinky', 'thumb')]
    for _ in range(3):
        X = np.array([list(P[k] - P[h]) for k in ks])
        Y = np.array([list(mpt(k) - P[h]) for k in ks])
        Wt = np.diag([1.0, 2.0, 1.0, 1.0, 0.5])
        U, S, Vt = np.linalg.svd(X.T @ Wt @ Y)
        d = np.sign(np.linalg.det(Vt.T @ U.T))
        Rk = Vt.T @ np.diag([1, 1, d]) @ U.T
        R[h] = (Matrix(Rk.tolist()) @ R[h]).normalized()
        fk(h)

for n, k in CHAINS:
    aim(n, k, target_of(k))
    if n.startswith('lowerarm_'):
        fit_hand(n[-1])

print('HERO bind-pose joints vs MPFB (cm):')
for n in order:
    m = mp(n)
    if m:
        print(f'  {n:14s} {(P[n] - wloc(rig, m)).length * 100:6.2f}  len UAL {((P[children[n][0]] - P[n]).length if children.get(n) else 0):.3f} MPFB {rig.data.bones[m].length:.3f}')

# ---------------------------------------------------------------- 3. fit the mesh onto the bind-pose joints
# Linear blend skinning with MPFB's own weights and one affine map per bone, computed here (not through Blender's pose,
# which cannot hold a stretch across a bone): each limb bone takes its MPFB joint onto the UAL joint and its next joint
# onto the next UAL joint (turned and stretched along that line); the palm takes the wrist and the five knuckles by a
# least-squares affine map; the clavicle keeps its root and reaches to UAL's shoulder. The trunk, neck and head stay
# put, so the neck keeps its length (UAL's head joint then sits a little low in the neck, which only lowers the nod's
# pivot). The feet are then raised on their bones until the sole stands on the ground, as UAL's did.
first = {n: k for n, k in CHAINS}
MOVE = {n for n in first if not n.startswith('clavicle_')}
FEET = ('foot_', 'ball_')

meshes = [o for o in rig.children if o.type == 'MESH']
for o in meshes:
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    if o.data.shape_keys:
        o.shape_key_add(name='mix', from_mix=True)
        mixed = [v.co.copy() for v in o.data.shape_keys.key_blocks['mix'].data]
        o.shape_key_clear()
        for v, c in zip(o.data.vertices, mixed):
            v.co = c
    for md in list(o.modifiers):
        if md.type == 'MASK':
            bpy.ops.object.modifier_apply(modifier=md.name)
        else:
            o.modifiers.remove(md)
    o.select_set(False)
    m4 = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = m4
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.select_set(False)
body = base

def affine_fit(src, dst):
    """Least-squares affine map taking points src onto dst (4×4)."""
    S = np.hstack([np.array(src), np.ones((len(src), 1))])
    D = np.array(dst)
    X, *_ = np.linalg.lstsq(S, D, rcond=None)
    M4 = np.eye(4)
    M4[:3, :3] = X[:3].T
    M4[:3, 3] = X[3]
    return Matrix(M4.tolist())

def deform_mats(T):
    X = {}
    for n in first:
        m = mp(n)
        h0 = wloc(rig, m)
        c0 = target_of(first[n])
        if n.startswith('hand_'):
            sd = n[-1]
            ks = [f'{f}_01_{sd}' for f in ('index', 'middle', 'ring', 'pinky', 'thumb')]
            X[m] = affine_fit([list(h0)] + [list(mpt(k)) for k in ks], [list(T[n])] + [list(T[k]) for k in ks])
            continue
        h1 = T[n] if n in MOVE else h0
        c1 = T[first[n]]
        d0, d1 = c0 - h0, c1 - h1
        u = d0.normalized()
        St = Matrix.Identity(3)
        for i in range(3):
            for j in range(3):
                St[i][j] += (d1.length / d0.length - 1) * u[i] * u[j]
        L = d0.rotation_difference(d1).to_matrix() @ St
        X[m] = Matrix.Translation(h1) @ L.to_4x4() @ Matrix.Translation(-h0)
    return X

def weights_of(o):
    names = [g.name for g in o.vertex_groups]
    bones = [n for n in names if n in rig.data.bones]
    bi = {n: i for i, n in enumerate(bones)}
    W = np.zeros((len(o.data.vertices), len(bones)), dtype=np.float64)
    for v in o.data.vertices:
        for g in v.groups:
            nm = names[g.group]
            if nm in bi:
                W[v.index, bi[nm]] = g.weight
    s = W.sum(1, keepdims=True)
    W = np.where(s > 1e-8, W / np.maximum(s, 1e-8), 0.0)
    return bones, W

REST = {o.name: np.array([list(v.co) for v in o.data.vertices]) for o in meshes}
WTS = {o.name: weights_of(o) for o in meshes}

def lbs(o, X):
    bones, W = WTS[o.name]
    V = REST[o.name]
    out = V * (1 - W.sum(1, keepdims=True))
    Vh = np.hstack([V, np.ones((len(V), 1))])
    for i, b in enumerate(bones):
        w = W[:, i:i + 1]
        if not w.any():
            continue
        M4 = np.array(X[b]) if b in X else np.eye(4)
        out += w * (Vh @ M4.T)[:, :3]
    return out

def sole(o, V):
    bones, W = WTS[o.name]
    feet = [i for i, b in enumerate(bones) if b.startswith(FEET)]
    dom = W.argmax(1)
    sel = np.isin(dom, feet) & (W.max(1) > 0)
    return V[sel, 2].min()

# the sandal's sole (gear.py) is 6 mm thick from the ground up; the foot stands 4 mm up, pressed 2 mm into it
SOLE = 0.004
T = {n: P[n].copy() for n in P}
z0 = sole(body, lbs(body, deform_mats(T)))
for _ in range(3):
    z = sole(body, lbs(body, deform_mats(T)))
    for n in T:
        if n.startswith(FEET):
            T[n].z -= z - SOLE
z1 = sole(body, lbs(body, deform_mats(T)))
print(f'HERO sole before {z0 * 1000:.1f} mm, after {z1 * 1000:.2f} mm (sandal sole below it; feet raised {(T["foot_l"].z - P["foot_l"].z) * 1000:.1f} mm on their bones)')
X = deform_mats(T)
for o in meshes:
    V = lbs(o, X)
    o.data.vertices.foreach_set('co', V.ravel().astype(np.float32))
    o.data.update()
low = min(v.co.z for v in body.data.vertices)
print(f'HERO body: {len(body.data.vertices)} vertices, {len(body.data.polygons)} faces, lowest point z={low * 1000:.1f} mm')

# ---------------------------------------------------------------- 4. weights
TRUNK = ['pelvis', 'spine_01', 'spine_02', 'spine_03']
zs = [P[n].z for n in TRUNK] + [P['neck_01'].z]
def trunk_weights(z):
    """The trunk's share over UAL's pelvis and spine joints: each joint's span, blended across each boundary."""
    w = [0.0] * 4
    k = 0
    while k < 3 and z > zs[k + 1]:
        k += 1
    w[k] = 1.0
    for j in range(1, 4):  # boundary between bone j-1 and j at zs[j]
        h = 0.4 * min(zs[j] - zs[j - 1], zs[j + 1] - zs[j])
        t = min(1.0, max(0.0, (z - (zs[j] - h)) / (2 * h)))
        if 0.0 < t < 1.0:
            w = [0.0] * 4
            w[j - 1], w[j] = 1 - t, t
            break
    return w

MASKS = ('lips', 'fingernails', 'toenails', 'ears', 'scalp', 'nipple')
def rename_groups(o):
    """Bone groups take UAL's names; MPFB's region groups (lips, nails, ears, scalp) stay as m_* masks for the
    textures; the rest go."""
    for g in o.vertex_groups:
        if g.name == 'head':
            g.name = 'Head'
        elif g.name in MASKS:
            g.name = 'm_' + g.name
    for g in list(o.vertex_groups):
        if g.name == 'Root' or (g.name not in ual_rest and not g.name.startswith('m_')):
            o.vertex_groups.remove(g)

for o in meshes:
    rename_groups(o)
    gi = {g.name: g.index for g in o.vertex_groups}
    for n in TRUNK:
        if n not in gi:
            gi[n] = o.vertex_groups.new(name=n).index
    groups = [o.vertex_groups[n] for n in TRUNK]
    for v in o.data.vertices:
        ws = {o.vertex_groups[g.group].name: g.weight for g in v.groups}
        s = sum(ws.get(n, 0.0) for n in TRUNK)
        if s <= 1e-6:
            continue
        z = (o.matrix_world @ v.co).z
        for g, w in zip(groups, trunk_weights(z)):
            if w * s > 1e-4:
                g.add([v.index], w * s, 'REPLACE')
            else:
                g.remove([v.index])

# ---------------------------------------------------------------- the bind armature, and bind.json
bpy.data.objects.remove(rig, do_unlink=True)
bpy.context.view_layer.objects.active = ual
bpy.ops.object.mode_set(mode='POSE')
for n in order:
    pb = ual.pose.bones[n]
    pb.matrix = Matrix.Translation(P[n]) @ R[n].to_4x4()
    bpy.context.view_layer.update()
bpy.ops.object.mode_set(mode='OBJECT')
bind = {}
for n in order:
    pb = ual.pose.bones[n]
    D = pb.matrix @ pb.bone.matrix_local.inverted()
    Dg = CI @ D @ C
    bind[n] = [Dg[r][c] for c in range(4) for r in range(4)]  # column-major
H.save_json(os.path.join(H.WORK, 'bind.json'), {'about': 'Each UAL joint in the bind pose: world change from its rest (glTF space, column-major).', 'delta': bind})

bind_obj = ual.copy()
bind_obj.data = ual.data.copy()
bind_obj.name = bind_obj.data.name = 'UAL_bind'
bpy.context.scene.collection.objects.link(bind_obj)
bpy.context.view_layer.objects.active = bind_obj
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')
for o in meshes:
    o.parent = bind_obj
    md = o.modifiers.new('Armature', 'ARMATURE')
    md.object = bind_obj
names = {o.name: o.name for o in meshes}
for o in meshes:
    nm = o.name.split('.')[-1] if '.' in o.name else o.name
    o.name = {'body': 'Body'}.get(nm, nm)
print('HERO meshes:', [(o.name, len(o.data.polygons)) for o in meshes])
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('HERO saved', OUT)
