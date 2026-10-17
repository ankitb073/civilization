"""Helpers for the clay and household props (build_props.py): lathed vessels with trim-aware UVs, chips and breaks,
cushion tablets, cloth sacks, woven baskets, mats and wood.

Texture regions used here (Blender UV, v up):
  M_Terracotta  body v 0..0.875 (periodic in v), applied cord band v 0.875..1; tile 0.5 m
  M_ClayRaw     body v 0.25..1 (periodic), tablet faces v 0..0.25 in four tiles across u; tile 0.5 m
  M_Basketry    trim, u tile 0.4 m: coiled 0.625..1, plaited 0.25..0.625, cord 0.0625..0.25, fibre 0..0.0625
  M_Hessian     tileable 0.27 m; M_Grain tileable 0.15 m
"""
import math
import bmesh
import bpy
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
import kitlib as K

TERRA = ('wrap', 0.0, 0.875)
TERRA_BAND = ('strip', 0.885, 0.99)
CLAY = ('wrap', 0.25, 1.0)
BASK_TILE = 0.4
BASK = {'coiled': ('wrap', 0.625, 1.0), 'plaited': ('wrap', 0.25, 0.625), 'cord': ('strip', 0.07, 0.245),
        'fibre': ('strip', 0.004, 0.058)}
TILE = ('tile',)


# ---------------------------------------------------------------- curves

def spline(ctrl, n):
    """Catmull-Rom through 2-D control points, resampled to n points evenly by arc length."""
    pts = [Vector((p[0], p[1])) for p in ctrl]
    if len(pts) < 3:
        return [tuple(p) for p in pts]
    dense = []
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(16):
            t = k / 16
            t2, t3 = t * t, t * t * t
            dense.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    dense.append(pts[-1])
    L = [0.0]
    for a, b in zip(dense, dense[1:]):
        L.append(L[-1] + (b - a).length)
    out = []
    j = 0
    for k in range(n):
        s = L[-1] * k / (n - 1)
        while j < len(L) - 2 and L[j + 1] < s:
            j += 1
        seg = L[j + 1] - L[j]
        t = 0 if seg < 1e-9 else (s - L[j]) / seg
        p = dense[j].lerp(dense[j + 1], t)
        out.append((p.x, p.y))
    return out


def offset_inward(prof, t):
    """Offset an (r, z) polyline (running outward/up along an outer surface) inward by t."""
    out = []
    n = len(prof)
    for i in range(n):
        a = Vector(prof[max(0, i - 1)])
        b = Vector(prof[min(n - 1, i + 1)])
        d = (b - a)
        if d.length < 1e-9:
            d = Vector((0, 1))
        d.normalize()
        nrm = Vector((d.y, -d.x))                  # outward
        p = Vector(prof[i]) - nrm * t
        out.append((max(0.0, p.x), p.y))
    return out


def adaptive(ctrl, step, bands=(), band_step=0.01, dense=600):
    """Resample a control polyline (through a spline) every `step` metres, every `band_step` inside the z ranges of
    `bands`; returns (r, z) points."""
    d = spline(ctrl, dense)
    out = [d[0]]
    acc = 0.0
    for a, b in zip(d, d[1:]):
        acc += math.hypot(b[0] - a[0], b[1] - a[1])
        z = b[1]
        st = band_step if any(z0 - band_step <= z <= z1 + band_step for z0, z1 in bands) else step
        if acc >= st:
            out.append(b)
            acc = 0.0
    if out[-1] != d[-1]:
        if math.hypot(out[-1][0] - d[-1][0], out[-1][1] - d[-1][1]) < step * 0.4 and len(out) > 2:
            out[-1] = d[-1]
        else:
            out.append(d[-1])
    return out


def vessel(outer_ctrl, thick, n_out, n_in, lip=4, inner_floor=None, maps=None, outer=None):
    """A closed (r, z, map) profile for a pot: outer surface from the axis up to the rim, a rounded lip, the inner
    surface back down to the axis. `maps` (list of (z0, z1, map) on the outer surface) override the default map.
    Pass `outer` (resampled (r, z) points) to skip the spline."""
    if outer is None:
        outer = spline(outer_ctrl, n_out)
    inner = offset_inward(outer, thick)
    # drop inner points that fold over (tight curves) and resample the inner surface
    inner = [p for p in inner if p[1] >= (inner_floor if inner_floor is not None else outer[0][1] + thick)]
    inner = spline(inner[::max(1, len(inner) // max(4, n_in))] + [inner[-1]], max(4, n_in)) if len(inner) > 3 else inner
    inner = inner[::-1]
    ro, zo = outer[-1]
    ri, zi = inner[0]
    cx, cz = (ro + ri) / 2, (zo + zi) / 2
    rad = Vector((ro - ri, zo - zi)).length / 2
    ang0 = math.atan2(zo - cz, ro - cx)
    lip_pts = []
    for k in range(1, lip):
        a = ang0 + math.pi * k / lip
        lip_pts.append((cx + rad * math.cos(a), cz + rad * math.sin(a)))
    zf = inner[-1][1]
    prof = [(0.0, outer[0][1])] + outer[1:] + lip_pts + inner + [(0.0, zf)]
    res = []
    outer_set = {tuple(p) for p in outer}
    for (r, z) in prof:
        m = None
        if maps and (r, z) in outer_set:
            for z0, z1, mm in maps:
                if z0 <= z < z1:
                    m = mm
        res.append((r, z, m))
    return res


# ---------------------------------------------------------------- lathe

def lathe(bm, uvl, prof, segs, mat, tile=0.5, vmap=TILE, seed=0, wobble=0.0, angle0=0.0, rref=None, smooth=True,
          deform=None, arc=None):
    """Revolve (r, z[, map]) profile points about Z. Map per segment: ('tile',) v = s / tile; ('wrap', v0, v1) v wraps
    within v0..v1 (break points inserted where it wraps); ('strip', v0, v1) the run is spread across v0..v1.
    Returns the rings (lists of verts, a single vert at the axis)."""
    P = [(p[0], p[1], (p[2] if len(p) > 2 and p[2] else vmap)) for p in prof]
    # arc lengths and wrap breaks
    pts = [P[0]]
    for a, b in zip(P, P[1:]):
        m = a[2]
        if m[0] == 'wrap':
            per = m[2] - m[1]
            la = 0.0
            # running length computed below; here only insert breaks by local length
        pts.append(b)
    L = [0.0]
    for a, b in zip(pts, pts[1:]):
        L.append(L[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    out = [(pts[0], L[0])]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        m = a[2]
        if m[0] == 'wrap':
            per = (m[2] - m[1]) * tile
            ka = math.floor(L[i] / per + 1e-9)
            kb = math.floor(L[i + 1] / per - 1e-9)
            for k in range(ka + 1, kb + 1):
                s = k * per
                t = (s - L[i]) / max(1e-12, L[i + 1] - L[i])
                out.append(((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, m), s))
        out.append((b, L[i + 1]))
    pts = [o[0] for o in out]
    L = [o[1] for o in out]
    # v at each segment's ends
    segv = []
    i = 0
    n = len(pts)
    while i < n - 1:
        m = pts[i][2]
        if m[0] == 'strip':
            j = i
            while j < n - 1 and pts[j][2] == m:
                j += 1
            tot = max(1e-9, L[j] - L[i])
            for k in range(i, j):
                segv.append((m[1] + (m[2] - m[1]) * (L[k] - L[i]) / tot, m[1] + (m[2] - m[1]) * (L[k + 1] - L[i]) / tot))
            i = j
            continue
        if m[0] == 'wrap':
            per = (m[2] - m[1]) * tile
            base = math.floor(L[i] / per + 1e-7) * per
            va = m[1] + (L[i] - base) / tile
            segv.append((va, va + (L[i + 1] - L[i]) / tile))
        else:
            segv.append((L[i] / tile, L[i + 1] / tile))
        i += 1
    rmax = rref or max(p[0] for p in pts)
    reps = max(1, round(2 * math.pi * rmax / tile)) if arc is None else max(1, round(arc * rmax / tile))
    total = 2 * math.pi if arc is None else arc
    nseg = segs
    rings = []
    for k, p in enumerate(pts):
        r, z = p[0], p[1]
        if r < 1e-6 and arc is None:
            co = Vector((0, 0, z))
            if deform:
                co = deform(co, 0.0, k)
            rings.append(bm.verts.new(co))
            continue
        ring = []
        cnt = nseg if arc is None else nseg + 1
        for i in range(cnt):
            th = angle0 + total * i / nseg
            rr = r * (1 + wobble * K.noise3((math.cos(th) * 1.3, math.sin(th) * 1.3, z * 3.0), seed)) if wobble else r
            co = Vector((rr * math.cos(th), rr * math.sin(th), z))
            if deform:
                co = deform(co, th, k)
            ring.append(bm.verts.new(co))
        rings.append(ring)
    for k in range(len(pts) - 1):
        A, B = rings[k], rings[k + 1]
        va, vb = segv[k]
        for i in range(nseg):
            i2 = (i + 1) % nseg if arc is None else i + 1
            ua, ub = reps * i / nseg, reps * (i + 1) / nseg
            if isinstance(A, list) and isinstance(B, list):
                vs, uvs = [A[i], A[i2], B[i2], B[i]], [(ua, va), (ub, va), (ub, vb), (ua, vb)]
            elif isinstance(B, list):
                vs, uvs = [A, B[i2], B[i]], [((ua + ub) / 2, va), (ub, vb), (ua, vb)]
            elif isinstance(A, list):
                vs, uvs = [A[i], A[i2], B], [(ua, va), (ub, va), ((ua + ub) / 2, vb)]
            else:
                continue
            try:
                f = bm.faces.new(vs)
            except ValueError:
                continue
            f.material_index = mat
            f.smooth = smooth
            for l, uv in zip(f.loops, uvs):
                l[uvl].uv = uv
    return rings


def tube(bm, uvl, path, radius, sides, mat, vmap, tile=0.4, seed=0, closed=False, caps=True, smooth=True, rscale=None):
    """A tube along a 3-D path (list of Vectors); v around maps into vmap (a strip), u along the path."""
    n = len(path)
    rings = []
    prev_x = None
    for k in range(n):
        a = path[max(0, k - 1)]
        b = path[min(n - 1, k + 1)]
        if closed:
            a, b = path[(k - 1) % n], path[(k + 1) % n]
        t = (b - a).normalized()
        x = t.cross(Vector((0, 0, 1)))
        if x.length < 1e-4:
            x = t.cross(Vector((1, 0, 0)))
        if prev_x is not None:
            x = prev_x - t * prev_x.dot(t)
        x.normalize()
        prev_x = x
        y = t.cross(x)
        rr = radius * (rscale(k / max(1, n - 1)) if rscale else 1.0)
        rings.append([bm.verts.new(path[k] + (x * math.cos(2 * math.pi * i / sides) + y * math.sin(2 * math.pi * i / sides)) * rr) for i in range(sides)])
    L = [0.0]
    for a, b in zip(path, path[1:]):
        L.append(L[-1] + (b - a).length)
    segs = n if closed else n - 1
    for k in range(segs):
        A, B = rings[k], rings[(k + 1) % n]
        la, lb = L[k] / tile, (L[k] + (path[(k + 1) % n] - path[k]).length) / tile
        for i in range(sides):
            j = (i + 1) % sides
            f = bm.faces.new([A[i], A[j], B[j], B[i]])
            f.material_index = mat
            f.smooth = smooth
            va = vmap[1] + (vmap[2] - vmap[1]) * i / sides
            vb = vmap[1] + (vmap[2] - vmap[1]) * (i + 1) / sides
            for l, uv in zip(f.loops, [(la, va), (la, vb), (lb, vb), (lb, va)]):
                l[uvl].uv = uv
    if caps and not closed:
        for ring, rev in ((rings[0], True), (rings[-1], False)):
            f = bm.faces.new(ring[::-1] if rev else ring)
            f.material_index = mat
            for l in f.loops:
                l[uvl].uv = (0.5, (vmap[1] + vmap[2]) / 2)
    return rings


# ---------------------------------------------------------------- breaks

def _noisy_blob(size, seed, squash=(1.0, 1.0, 1.0), subdiv=3, rough=0.22):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    for v in bm.verts:
        n = v.co.normalized()
        d = 1 + rough * K.noise3(n * 1.7, seed, octaves=3) + 0.12 * K.noise3(n * 5.0, seed + 1)
        v.co = Vector((n.x * d * squash[0], n.y * d * squash[1], n.z * d * squash[2])) * size
    me = bpy.data.meshes.new('_cut')
    bm.to_mesh(me)
    bm.free()
    return me


def cut(ob, center, size, seed, squash=(1, 1, 1), rot=(0, 0, 0), op='DIFFERENCE'):
    """Boolean a noisy blob out of (or intersect it with) `ob`; mark the new faces in the 'brk' face attribute."""
    me = _noisy_blob(size, seed, squash)
    c = bpy.data.objects.new('_cut', me)
    bpy.context.scene.collection.objects.link(c)
    c.location = Vector(center)
    c.rotation_euler = rot
    bpy.context.view_layer.update()
    m = ob.modifiers.new('cut', 'BOOLEAN')
    m.operation = op
    m.solver = 'EXACT'
    m.use_hole_tolerant = True
    m.use_self = True
    m.object = c
    npoly = len(ob.data.polygons)
    K.apply_modifiers(ob)
    ob.data.validate(clean_customdata=False)
    if len(ob.data.polygons) < npoly * 0.3:
        raise RuntimeError(f'boolean on {ob.name} lost the mesh ({npoly} -> {len(ob.data.polygons)} faces)')
    # faces lying on the cutter's surface are break faces
    deps = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(c, deps)
    a = ob.data.attributes.get('brk') or ob.data.attributes.new('brk', 'INT', 'FACE')
    for p in ob.data.polygons:
        loc, nrm, idx, dist = tree.find_nearest(ob.matrix_world @ p.center)
        if dist is not None and dist < max(2e-4, size * 0.004):
            a.data[p.index].value = 1
    bpy.data.objects.remove(c, do_unlink=True)
    bpy.data.meshes.remove(me)


def break_uvs(ob, tile=0.5, v0=0.0, v1=0.875):
    """Box-project UVs onto the break faces (into a body region of the material)."""
    me = ob.data
    a = me.attributes.get('brk')
    if not a:
        return
    uv = me.uv_layers['UVMap']
    for p in me.polygons:
        if not a.data[p.index].value:
            continue
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u, v = [(co.y, co.z), (co.x, co.z), (co.x, co.y)][ax]
            uv.data[li].uv = (u / tile, v0 + ((v / tile) % (v1 - v0)))


def is_break(ob):
    a = ob.data.attributes.get('brk')
    return (lambda p: bool(a.data[p.index].value)) if a else (lambda p: False)


# ---------------------------------------------------------------- tablets, boxes

def cushion(bm, uvl, center, size, n, mat, top_uv=None, side_v=(0.25, 1.0), tile=0.5, p=5.0, rot=0.0, seed=0, sag=0.0):
    """A rounded 'cushion' box (superellipsoid cube-sphere) of size (sx, sy, sz) at center (its base on center.z).
    top_uv: (u0, u1, v0, v1) for the upward face (e.g. a tablet face tile)."""
    sx, sy, sz = size
    cx, cy, cz = center
    cs, sn = math.cos(rot), math.sin(rot)
    verts = {}

    def vert(key, d):
        v = verts.get(key)
        if v:
            return v
        # superellipsoid-ish: normalise the cube direction with an Lp norm
        nd = (abs(d.x) ** p + abs(d.y) ** p + abs(d.z) ** p) ** (1 / p)
        q = Vector((d.x / nd * sx / 2, d.y / nd * sy / 2, d.z / nd * sz / 2))
        # top bulges a little, base flattens
        if q.z > 0:
            q.z += sag * (1 - (2 * q.x / sx) ** 2) * (1 - (2 * q.y / sy) ** 2)
        x, y = q.x * cs - q.y * sn, q.x * sn + q.y * cs
        v = bm.verts.new((cx + x, cy + y, cz + q.z + sz / 2))
        verts[key] = v
        return v
    axes = [(0, 1, 2, 1), (0, 1, 2, -1), (0, 2, 1, 1), (0, 2, 1, -1), (1, 2, 0, 1), (1, 2, 0, -1)]
    for (a, b, c, s) in axes:
        for i in range(n):
            for j in range(n):
                quad = []
                uvs = []
                for (ii, jj) in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                    d = [0.0, 0.0, 0.0]
                    d[a] = -1 + 2 * ii / n
                    d[b] = -1 + 2 * jj / n
                    d[c] = s
                    key = tuple(round(x, 6) for x in d)
                    quad.append(vert(key, Vector(d)))
                    if top_uv and c == 2 and s > 0:
                        uvs.append((top_uv[0] + (top_uv[1] - top_uv[0]) * (d[0] + 1) / 2, top_uv[2] + (top_uv[3] - top_uv[2]) * (d[1] + 1) / 2))
                    else:
                        co = quad[-1].co
                        uu = [(co.y, co.z), (co.x, co.z), (co.x, co.y)][c]
                        uvs.append((uu[0] / tile, side_v[0] + ((uu[1] / tile) % (side_v[1] - side_v[0]))))
                if (c == 2 and s > 0) or (c == 1 and s < 0) or (c == 0 and s > 0):
                    order = [0, 1, 2, 3]
                else:
                    order = [3, 2, 1, 0]
                # orientation is fixed below with recalc_face_normals
                try:
                    f = bm.faces.new([quad[k] for k in order])
                except ValueError:
                    continue
                f.material_index = mat
                f.smooth = True
                for l, k in zip(f.loops, order):
                    l[uvl].uv = uvs[k]


def box(bm, uvl, lo, hi, mat, tile=2.0, smooth=False):
    lo, hi = Vector(lo), Vector(hi)
    vs = [bm.verts.new((x, y, z)) for z in (lo.z, hi.z) for y in (lo.y, hi.y) for x in (lo.x, hi.x)]
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    out = []
    for fi in faces:
        f = bm.faces.new([vs[i] for i in fi])
        f.material_index = mat
        f.smooth = smooth
        out.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=out)
    for f in out:
        f.normal_update()
    K.uv_box(bm, tile=tile, faces=out)
    return out


def finish_normals(bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])


# ---------------------------------------------------------------- colour helpers

def tint_fn(body, brk=(0.97, 0.93, 0.88), soot=None, seed=0, base_grime=0.25, rim_wear=None, h=1.0, weather=1.0):
    """Vertex colour for pottery: body tint with firing clouds, soil up the foot, drips from the rim, salt bloom,
    paler break faces, optional soot (fn(co) -> 0..1). h: the vessel's height (scales the stains)."""
    def fn(co, n, mat, poly):
        x, y, z = co.x, co.y, co.z
        if poly is not None and fn.brk and fn.brk(poly):
            c = brk
            core = K.smoothstep(0.3, 0.9, K.noise3((x * 30, y * 30, z * 30), seed + 7))
            c = (c[0] * (1 - 0.2 * core), c[1] * (1 - 0.18 * core), c[2] * (1 - 0.14 * core))
        else:
            c = list(body)
            # firing clouds: grey-brown patches
            fc = K.smoothstep(0.15, 0.7, K.noise3((x * 2.6, y * 2.6, z * 2.6), seed + 1, octaves=2)) * 0.45 * weather
            c = [c[0] * (1 - 0.30 * fc), c[1] * (1 - 0.26 * fc), c[2] * (1 - 0.18 * fc)]
            m = 0.92 + 0.08 * K.noise3((x * 7, y * 7, z * 7), seed + 2, octaves=2)
            c = [v * m for v in c]
            # soil up the foot, ragged
            sl = h * 0.2 * (0.7 + 0.5 * K.noise3((x * 6, y * 6, 0.5), seed + 3))
            soil = (1 - K.smoothstep(sl * 0.4, sl, z)) * (base_grime * 2.4) * weather
            c = [c[0] * (1 - 0.30 * soil), c[1] * (1 - 0.34 * soil), c[2] * (1 - 0.36 * soil)]
            # drips and streaks below the rim
            if h > 0.2:
                st = K.smoothstep(0.35, 0.8, K.noise3((x * 18, y * 18, z * 1.2), seed + 4)) * K.smoothstep(0.25 * h, 0.85 * h, z)
                c = [c[0] * (1 - 0.16 * st * weather), c[1] * (1 - 0.18 * st * weather), c[2] * (1 - 0.18 * st * weather)]
            # salt bloom above the soil line
            sb = K.smoothstep(0.55, 0.9, K.noise3((x * 9, y * 9, z * 5), seed + 5)) * K.smoothstep(h * 0.45, h * 0.1, z) * 0.6 * weather
            c = [c[0] * (1 - sb) + 0.93 * sb, c[1] * (1 - sb) + 0.90 * sb, c[2] * (1 - sb) + 0.85 * sb]
        if soot:
            s = soot(co)
            c = [c[0] * (1 - 0.88 * s), c[1] * (1 - 0.9 * s), c[2] * (1 - 0.9 * s)]
        return tuple(c)
    fn.brk = None
    return fn


def paint_pottery(ob, body, **kw):
    fn = tint_fn(body, **kw)
    fn.brk = is_break(ob)
    K.paint(ob, fn, mode='set')


# ---------------------------------------------------------------- wood

def half_log(bm, uvl, a, b, radius, mat, seed=0, sides=6, roll=0.0, end_tile=4):
    """A split log from a to b: a half-round of bark, a flat split face (trim 'plankA'), end-grain caps."""
    r = K.rng(seed)
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    z = d.normalized()
    x = z.cross(Vector((0, 0, 1)))
    if x.length < 1e-4:
        x = z.cross(Vector((1, 0, 0)))
    x.normalize()
    y = z.cross(x)
    # rotate the section by roll
    x, y = x * math.cos(roll) + y * math.sin(roll), -x * math.sin(roll) + y * math.cos(roll)
    pts = []
    for i in range(sides + 1):
        ang = math.pi * i / sides
        rr = radius * (1 + 0.06 * K.noise3((i * 0.8, seed, 0.3), seed))
        pts.append((math.cos(ang) * rr, math.sin(ang) * rr))
    rings = []
    for k in (0, 1):
        c = a + d * k
        rings.append([bm.verts.new(c + x * px + y * py) for (px, py) in pts])
    vb0, vb1 = K.TRIM['bark']
    for i in range(sides):
        f = bm.faces.new([rings[0][i], rings[1][i], rings[1][i + 1], rings[0][i + 1]])
        f.material_index = mat
        f.smooth = True
        u0, u1 = 0.0 + seed * 0.071, L / 2.0 + seed * 0.071
        va = vb0 + (vb1 - vb0) * (0.05 + 0.9 * i / sides) * min(1.0, math.pi * radius / 0.5)
        vb = vb0 + (vb1 - vb0) * (0.05 + 0.9 * (i + 1) / sides) * min(1.0, math.pi * radius / 0.5)
        for l, uv in zip(f.loops, [(u0, va), (u1, va), (u1, vb), (u0, vb)]):
            l[uvl].uv = uv
    # split face
    f = bm.faces.new([rings[0][sides], rings[1][sides], rings[1][0], rings[0][0]])
    f.material_index = mat
    pa0, pa1 = K.TRIM['plankA']
    u0, u1 = seed * 0.13, L / 2.0 + seed * 0.13
    for l, uv in zip(f.loops, [(u0, pa0 + 0.02), (u1, pa0 + 0.02), (u1, pa0 + 0.02 + (pa1 - pa0) * 2 * radius / 0.5),
                               (u0, pa0 + 0.02 + (pa1 - pa0) * 2 * radius / 0.5)]):
        l[uvl].uv = uv
    for k, ring in ((0, rings[0]), (1, rings[1])):
        f = bm.faces.new(ring[::-1] if k == 0 else ring)
        f.material_index = mat
        cen = (a + d * k) - y * radius * 0.0
        for l in f.loops:
            dv = l.vert.co - (a + d * k)
            l[uvl].uv = K.end_tile_uv(end_tile, dv.dot(x) / radius, dv.dot(y) / radius - 0.5)


def ring_path(center, radius, z, n, wobble=0.0, seed=0, axis='z'):
    """A closed circular path (list of Vectors) around an axis through center."""
    c = Vector(center)
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        rr = radius * (1 + wobble * K.noise3((math.cos(a), math.sin(a), 0.3), seed))
        if axis == 'z':
            out.append(c + Vector((rr * math.cos(a), rr * math.sin(a), z)))
        else:
            out.append(c + Vector((z, rr * math.cos(a), rr * math.sin(a))))
    return out
