"""structlib: helpers for the structure props (props_struct): ropes, lashings, lathe solids, cloth simulation,
planks and the struct_misc trim. Blender conventions as kitlib (Z-up, front -Y, pivots baked, 'Col', 'UVMap')."""
import math
import bmesh
import bpy
from mathutils import Vector, Matrix
import kitlib as K

# struct_misc trim bands (v ranges)
MISC = {'rope': (0.5, 1.0), 'leather': (0.25, 0.5), 'bronze': (0.125, 0.25), 'clay': (0.0, 0.125)}


def misc_v(band, t):
    a, b = MISC[band]
    pad = (b - a) * 0.03
    return a + pad + (b - a - 2 * pad) * min(1.0, max(0.0, t))


# ---------------------------------------------------------------- curves

def catenary(a, b, sag, n):
    """Points from a to b hanging `sag` metres at the middle (parabola), n segments."""
    a, b = Vector(a), Vector(b)
    pts = []
    for i in range(n + 1):
        t = i / n
        p = a.lerp(b, t)
        p.z -= 4 * sag * t * (1 - t)
        pts.append(p)
    return pts


def frames(pts):
    """Parallel-transport frames (tangent, normal, binormal) along a polyline."""
    out = []
    t0 = (pts[1] - pts[0]).normalized()
    up = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    n = t0.cross(up).normalized()
    for i, p in enumerate(pts):
        if i == 0:
            t = t0
        elif i == len(pts) - 1:
            t = (pts[i] - pts[i - 1]).normalized()
        else:
            t = (pts[i + 1] - pts[i - 1]).normalized()
        n = (n - t * n.dot(t))
        if n.length < 1e-6:
            n = t.cross(up)
        n.normalize()
        out.append((t, n, t.cross(n)))
    return out


def tube(bm, uvl, pts, radius, mat, sides=6, band='rope', u_scale=0.12, caps=True, radii=None, trim='misc',
         twist=0.0, smooth=True):
    """A tube along pts (rope, cord, thin pole). UVs: u = length / u_scale, v around the circumference in the band."""
    fr = frames(pts)
    rings = []
    L = [0.0]
    for i in range(1, len(pts)):
        L.append(L[-1] + (pts[i] - pts[i - 1]).length)
    for i, (p, (t, n, b)) in enumerate(zip(pts, fr)):
        r = radii[i] if radii else radius
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides + twist * L[i]
            ring.append(bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * r))
        rings.append(ring)
    vf = misc_v if trim == 'misc' else K.trim_v
    faces = []
    for i in range(len(pts) - 1):
        for k in range(sides):
            j = (k + 1) % sides
            f = bm.faces.new([rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]])
            f.material_index = mat
            f.smooth = smooth
            ua, ub = L[i] / u_scale, L[i + 1] / u_scale
            va, vb = vf(band, k / sides), vf(band, (k + 1) / sides)
            for l, uv in zip(f.loops, [(ua, va), (ua, vb), (ub, vb), (ub, va)]):
                l[uvl].uv = uv
            faces.append(f)
    if caps:
        for ring, rev in ((rings[0], True), (rings[-1], False)):
            f = bm.faces.new(ring[::-1] if rev else ring)
            f.material_index = mat
            for l in f.loops:
                l[uvl].uv = (0.0, vf(band, 0.5))
            faces.append(f)
    return faces


def lashing(bm, uvl, center, axis, radius, mat, turns=4, cord=0.008, width=None, sides=5, seg=10, seed=0, cross=None):
    """Rope wrapped round a pole at a joint: `turns` rings along `axis` (unit), around radius `radius`.
    With `cross` (a second axis), half the turns are wrapped diagonally (an X lashing)."""
    r = K.rng(seed)
    axis = Vector(axis).normalized()
    width = width or turns * cord * 2.1
    up = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))
    e1 = axis.cross(up).normalized()
    e2 = axis.cross(e1)
    for k in range(turns):
        off = (k - (turns - 1) / 2) * (width / max(1, turns))
        tilt = (cross is not None and k % 2) * 0.5
        pts = []
        for i in range(seg + 1):
            a = 2 * math.pi * i / seg
            rr = radius + cord * (1.0 + 0.15 * r.random())
            p = Vector(center) + axis * (off + tilt * math.sin(a) * radius) + (e1 * math.cos(a) + e2 * math.sin(a)) * rr
            pts.append(p)
        tube(bm, uvl, pts, cord, mat, sides=sides, u_scale=0.08, caps=False)


def lathe(bm, uvl, prof, segs, mat, center=(0, 0, 0), band='clay', trim='misc', u_scale=None, close_top=False,
          close_bottom=False, smooth=True, phase=0.0, uv_fn=None):
    """A solid of revolution about z: prof = [(r, z)] bottom to top. UVs: u around (circumference / u_scale or
    0..1), v along the profile within the band (misc trim) unless uv_fn(k, i) is given."""
    c = Vector(center)
    rings = []
    for (rr, z) in prof:
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs + phase
            ring.append(bm.verts.new(c + Vector((rr * math.cos(a), rr * math.sin(a), z))))
        rings.append(ring)
    Lp = [0.0]
    for i in range(1, len(prof)):
        Lp.append(Lp[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
    tot = Lp[-1] or 1.0
    vf = misc_v if trim == 'misc' else K.trim_v
    faces = []
    for i in range(len(prof) - 1):
        for k in range(segs):
            j = (k + 1) % segs
            f = bm.faces.new([rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]])
            f.material_index = mat
            f.smooth = smooth
            uvs = []
            for (ii, kk) in ((i, k), (i, k + 1), (i + 1, k + 1), (i + 1, k)):
                if uv_fn:
                    uvs.append(uv_fn(kk, ii))
                else:
                    u = kk / segs
                    if u_scale:
                        u = kk / segs * 2 * math.pi * max(prof[ii][0], 0.01) / u_scale
                    uvs.append((u, vf(band, Lp[ii] / tot)))
            for l, uv in zip(f.loops, uvs):
                l[uvl].uv = uv
            faces.append(f)
    if close_bottom:
        f = bm.faces.new(rings[0][::-1])
        f.material_index = mat
        for l in f.loops:
            l[uvl].uv = (0.5, vf(band, 0.0))
    if close_top:
        f = bm.faces.new(rings[-1])
        f.material_index = mat
        for l in f.loops:
            l[uvl].uv = (0.5, vf(band, 1.0))
    return rings


def transform_faces(bm, faces, M):
    verts = {v for f in faces for v in f.verts}
    for v in verts:
        v.co = M @ v.co


def plank(bm, uvl, lo, hi, mat, seed=0, along='x', band='plankA', bevel=0.006, jitter=0.0, end_tile=5):
    """A plank (thin adzed board) via archparts.beam_box."""
    from archparts import beam_box
    return beam_box(bm, uvl, lo, hi, band=band, mat=mat, seed=seed, bevel=bevel, along=along, jitter=jitter,
                    end_tile=end_tile, u0=K.rng(seed).random())


def pole(bm, uvl, a, b, r, mat, seed=0, band='pole', sides=8, end_tile=1, wobble=0.006, taper=0.08, seg_len=0.5,
         ends=(True, True)):
    from archparts import log_cyl
    return log_cyl(bm, uvl, a, b, r, seed=seed, band=band, sides=sides, mat=mat, end_tile=end_tile, taper=taper,
                   wobble=wobble, seg_len=seg_len, ends=ends)


# ---------------------------------------------------------------- objects

def obj_from_bm(name, bm, mats):
    return K.new_object(name, bm, mats)


def copy_obj(ob, name):
    me = ob.data.copy()
    o = bpy.data.objects.new(name, me)
    K.collection().objects.link(o)
    return o


def join(objs, name):
    """Join objects (materials merged by name) into the first; returns it renamed."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def decimate(ob, ratio):
    if ratio < 0.999:
        m = ob.modifiers.new('dec', 'DECIMATE')
        m.ratio = ratio
        m.use_collapse_triangulate = True
        K.apply_modifiers(ob)
    ob.data.validate(clean_customdata=False)
    return ob


# ---------------------------------------------------------------- cloth

def cloth_sheet(name, w, h, nx, ny, mat_name, uv_rect=(0.0, 0.0, 1.0, 1.0), tile=None):
    """A flat cloth grid in the XY plane centred at the origin (w along x, h along y). UVs fill uv_rect
    (u0, v0, u1, v1), or with `tile` are world-scale (metres / tile)."""
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    vs = [[bm.verts.new((-w / 2 + w * i / nx, -h / 2 + h * j / ny, 0.0)) for j in range(ny + 1)] for i in range(nx + 1)]
    u0, v0, u1, v1 = uv_rect
    for i in range(nx):
        for j in range(ny):
            f = bm.faces.new([vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]])
            f.smooth = True
            for l in f.loops:
                co = l.vert.co
                if tile:
                    l[uvl].uv = ((co.x + w / 2) / tile, (co.y + h / 2) / tile)
                else:
                    l[uvl].uv = (u0 + (u1 - u0) * (co.x + w / 2) / w, v0 + (v1 - v0) * (co.y + h / 2) / h)
    return K.new_object(name, bm, [mat_name])


def collider_tube(name, pts, radius, sides=10):
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    tube(bm, uvl, [Vector(p) for p in pts], radius, 0, sides=sides, caps=True)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def simulate_cloth(ob, colliders, frames=60, pin=None, mass=0.25, stiff=15.0, bend=0.6, quality=8, air=1.0,
                   shrink=0.0, fps=24, thickness=0.006, self_collision=False):
    """Run Blender's cloth solver on `ob` (headless, frame by frame) and apply the result. `pin` is a list of vertex
    indices held in place. Colliders are objects given collision physics."""
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, frames
    sc.render.fps = fps
    for c in colliders:
        bpy.context.view_layer.objects.active = c
        c.modifiers.new('col', 'COLLISION')
        c.collision.thickness_outer = 0.004
        c.collision.cloth_friction = 8.0
        c.collision.damping = 0.6
    if pin:
        vg = ob.vertex_groups.new(name='pin')
        vg.add(pin, 1.0, 'REPLACE')
    m = ob.modifiers.new('cloth', 'CLOTH')
    s = m.settings
    s.quality = quality
    s.mass = mass
    s.tension_stiffness = stiff
    s.compression_stiffness = stiff
    s.shear_stiffness = stiff * 0.5
    s.bending_stiffness = bend
    s.air_damping = air
    s.shrink_min = shrink
    if pin:
        s.vertex_group_mass = 'pin'
    m.collision_settings.collision_quality = 4
    m.collision_settings.distance_min = thickness
    m.collision_settings.use_self_collision = self_collision
    m.point_cache.frame_start = 1
    m.point_cache.frame_end = frames
    for f in range(1, frames + 1):
        sc.frame_set(f)
    deps = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(deps)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = ob.name
    bpy.data.meshes.remove(old)
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    sc.frame_set(1)
    return ob


def remove(ob):
    bpy.data.objects.remove(ob, do_unlink=True)


def solidify_cloth(ob, thickness=0.004):
    """Give a simulated sheet a little thickness at its hem (keeps shading when seen edge-on). Doubles tris: only for
    small pieces; large awnings stay single-sheet (their material is double-sided)."""
    m = ob.modifiers.new('sol', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = 0.0
    K.apply_modifiers(ob)
    return ob


def paint_dye(ob, dye, mat_index=None, ao_floor=1.0):
    """Multiply 'Col' by a dye colour on faces of material index `mat_index` (all faces when None)."""
    me = ob.data
    col = K.ensure_col(ob)
    for p in me.polygons:
        if mat_index is not None and p.material_index != mat_index:
            continue
        for li in p.loop_indices:
            c = col.data[li].color
            col.data[li].color = (c[0] * dye[0], c[1] * dye[1], c[2] * dye[2], 1.0)


# ---------------------------------------------------------------- procedural drape

def drape_sheet(name, mat_name, nu, nv, u_range, v_range, place, uv_fn, dye_mul=None, flip=False):
    """A cloth sheet from a parametric drape: place(u, v) -> Vector. Grid nu x nv over u_range x v_range.
    uv_fn(u, v) -> (s, t). Faces smooth; returns the object."""
    bm = bmesh.new()
    uvl = K.ensure_uv(bm)
    u0, u1 = u_range
    v0, v1 = v_range
    us = [u0 + (u1 - u0) * i / nu for i in range(nu + 1)]
    vs = [v0 + (v1 - v0) * j / nv for j in range(nv + 1)]
    grid = [[bm.verts.new(place(u, v)) for v in vs] for u in us]
    for i in range(nu):
        for j in range(nv):
            order = ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)) if flip else ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))
            f = bm.faces.new([grid[a][b] for a, b in order])
            f.smooth = True
            for l, (ii, jj) in zip(f.loops, order):
                l[uvl].uv = uv_fn(us[ii], vs[jj])
    ob = K.new_object(name, bm, [mat_name])
    if dye_mul:
        paint_dye(ob, dye_mul)
    return ob


def fold_wave(u, depth, seed, lam=0.3, amp=0.035, ramp=0.35):
    """Lateral displacement of hanging cloth: soft vertical folds whose amplitude grows with depth below the
    support, with wandering spacing, uneven depth and a few folds running a little diagonally."""
    warp = K.noise3((u * 1.1, depth * 0.7, seed), seed) * lam * 0.9 + depth * 0.06 * K.noise3((u * 0.7, 0.0, seed + 5), seed + 5)
    env = K.smoothstep(0.0, ramp, depth) * (0.45 + 0.55 * (0.5 + 0.5 * K.noise3((u * 2.3, depth * 0.5, seed + 1), seed + 1)))
    w1 = math.sin(2 * math.pi * (u + warp) / lam)
    w2 = 0.45 * math.sin(2 * math.pi * (u - 0.6 * warp) / (lam * 0.53) + 1.7)
    return amp * env * (w1 + w2) / 1.2
