"""kitlib: shared helpers for the streets kit's Blender build scripts (Blender 5.2, run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/streets/kit/<builder>.py -- [args]

Conventions (every builder follows them; kit.json documents them for integration)
- Units are metres. Blender is Z-up; the glTF exporter converts to Y-up (glTF x = Blender x, glTF y = Blender z,
  glTF z = -Blender y). So a face that faces -Y in Blender faces +Z ("front") in glTF.
- Object names: '<piece>' is LOD0, '<piece>_LOD1', '<piece>_LOD2' the lower levels; each is one mesh at the origin with
  its pivot baked into the mesh (no object transforms at export).
- Materials are shared and named 'M_<Name>'; their texture sets live in build/kit/textures/<set>/ and are attached
  (KTX2) by pack.ts from scripts/streets/kit/materials*.json. Blender exports materials without images.
- Every mesh carries one colour attribute 'Col' (linear float, corner domain), exported as COLOR_0, which glTF
  multiplies into the base colour: baked contact occlusion, grime and per-piece tint. Keep it in 0.35..1.0.
- Every mesh has one UV map 'UVMap' (TEXCOORD_0). Tileable materials are mapped at world scale (uv = metres / tile).
- Determinism: never use unseeded randomness; use rng(seed) (random.Random) and noise3(p, seed).
"""
import bpy
import bmesh
import json
import math
import os
import random
import sys
from mathutils import Vector, Matrix, noise

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
KIT = os.path.join(ROOT, 'scripts', 'streets', 'kit')
TEX = os.path.join(ROOT, 'build', 'kit', 'textures')
EXPORT = os.path.join(ROOT, 'build', 'kit', 'export')
STATS = os.path.join(ROOT, 'build', 'kit', 'stats')
RENDERS = os.path.join(ROOT, 'build', 'kit', 'renders')
PH = os.path.join(ROOT, 'build', 'kit', 'downloads', 'polyhaven')
HDRI = os.path.join(PH, 'qwantani_late_afternoon_puresky', 'qwantani_late_afternoon_puresky_4k.hdr')


# ---------------------------------------------------------------- args, scene

def args():
    """--key=value pairs after '--' on the Blender command line."""
    out = {}
    if '--' in sys.argv:
        for a in sys.argv[sys.argv.index('--') + 1:]:
            if a.startswith('--'):
                k, _, v = a[2:].partition('=')
                out[k] = v if v else '1'
    return out


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    return sc


def rng(seed):
    return random.Random(seed)


def noise3(p, seed=0, scale=1.0, octaves=1, lac=2.0, gain=0.5):
    """Deterministic fBm in about -1..1 at point p (seeded by an offset)."""
    o = Vector(((seed * 12.9898) % 97.0, (seed * 78.233) % 89.0, (seed * 37.719) % 83.0))
    v, a, f, tot = 0.0, 1.0, scale, 0.0
    for _ in range(octaves):
        v += a * noise.noise(Vector(p) * f + o, noise_basis='PERLIN_ORIGINAL')
        tot += a
        a *= gain
        f *= lac
    return v / tot


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def collection(name='KIT'):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


# ---------------------------------------------------------------- materials

def material_defs():
    defs = {}
    for f in sorted(os.listdir(KIT)):
        if f.startswith('materials') and f.endswith('.json'):
            defs.update(json.load(open(os.path.join(KIT, f))))
    return defs


def _img(path, colorspace):
    key = os.path.basename(path)
    im = bpy.data.images.get(key)
    if not im:
        im = bpy.data.images.load(path, check_existing=True)
        im.name = key
    im.colorspace_settings.name = colorspace
    return im


def material(name):
    """The shared material `name` (M_*), built from its texture set for previews and renders."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    d = material_defs()[name]
    s = d['set']
    base = os.path.join(TEX, s, s)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'UVMap'
    bc = nt.nodes.new('ShaderNodeTexImage')
    bc.image = _img(base + ('_bca.png' if d.get('alpha') else '_bc.png'), 'sRGB')
    nrm = nt.nodes.new('ShaderNodeTexImage')
    nrm.image = _img(base + '_n.png', 'Non-Color')
    orm = nt.nodes.new('ShaderNodeTexImage')
    orm.image = _img(base + '_orm.png', 'Non-Color')
    for t in (bc, nrm, orm):
        nt.links.new(uv.outputs[0], t.inputs[0])
        t.interpolation = 'Cubic' if False else 'Linear'
    col = nt.nodes.new('ShaderNodeVertexColor')
    col.layer_name = 'Col'
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    nt.links.new(bc.outputs['Color'], mul.inputs['A'])
    nt.links.new(col.outputs['Color'], mul.inputs['B'])
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(orm.outputs['Color'], sep.inputs[0])
    # preview only: a little of the AO channel in the base colour (three applies it to indirect light)
    aomix = nt.nodes.new('ShaderNodeMix')
    aomix.data_type = 'RGBA'
    aomix.blend_type = 'MULTIPLY'
    aomix.inputs['Factor'].default_value = 0.5
    nt.links.new(mul.outputs['Result'], aomix.inputs['A'])
    nt.links.new(sep.outputs[0], aomix.inputs['B'])
    # preview only: the object's colour (white by default) tints like the integrator's instance colour
    oi = nt.nodes.new('ShaderNodeObjectInfo')
    om = nt.nodes.new('ShaderNodeMix')
    om.data_type = 'RGBA'
    om.blend_type = 'MULTIPLY'
    om.inputs['Factor'].default_value = 1.0
    nt.links.new(aomix.outputs['Result'], om.inputs['A'])
    nt.links.new(oi.outputs['Color'], om.inputs['B'])
    aomix = om
    tintc = d.get('tint')
    if tintc:
        tn = nt.nodes.new('ShaderNodeMix')
        tn.data_type = 'RGBA'
        tn.blend_type = 'MULTIPLY'
        tn.inputs['Factor'].default_value = 1.0
        tn.inputs['B'].default_value = (*tintc, 1.0)
        nt.links.new(aomix.outputs['Result'], tn.inputs['A'])
        nt.links.new(tn.outputs['Result'], bsdf.inputs['Base Color'])
    else:
        nt.links.new(aomix.outputs['Result'], bsdf.inputs['Base Color'])
    rmul = nt.nodes.new('ShaderNodeMath')
    rmul.operation = 'MULTIPLY'
    rmul.inputs[1].default_value = d.get('roughness', 1.0)
    nt.links.new(sep.outputs[1], rmul.inputs[0])
    nt.links.new(rmul.outputs[0], bsdf.inputs['Roughness'])
    bsdf.inputs['Metallic'].default_value = 0.0
    if d.get('metallic'):
        mm = nt.nodes.new('ShaderNodeMath')
        mm.operation = 'MULTIPLY'
        mm.inputs[1].default_value = d['metallic']
        nt.links.new(sep.outputs[2], mm.inputs[0])
        nt.links.new(mm.outputs[0], bsdf.inputs['Metallic'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.uv_map = 'UVMap'
    nm.inputs['Strength'].default_value = d.get('normal_strength', 1.0)
    nt.links.new(nrm.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if d.get('alpha'):
        nt.links.new(bc.outputs['Alpha'], bsdf.inputs['Alpha'])
        try:
            m.surface_render_method = 'DITHERED'
        except Exception:
            pass
    if d.get('sss'):
        # thin foliage: some light through the leaf (preview only)
        bsdf.inputs['Subsurface Weight'].default_value = 0.0
        tr = bsdf.inputs.get('Transmission Weight')
        if tr:
            tr.default_value = 0.0
    m.use_backface_culling = not d.get('doubleSided', False)
    m['kit_set'] = s
    return m


# ---------------------------------------------------------------- mesh building

def new_object(name, bm, mats, coll=None):
    """Create an object from a bmesh (consumed). `mats` is a list of material names, indexed by face.material_index."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for mn in mats:
        me.materials.append(material(mn))
    ob = bpy.data.objects.new(name, me)
    (coll or collection()).objects.link(ob)
    ensure_col(ob)
    return ob


def ensure_uv(bm):
    return bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')


def ensure_col(ob, default=(1.0, 1.0, 1.0, 1.0)):
    me = ob.data
    a = me.color_attributes.get('Col')
    if not a:
        a = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        for d in a.data:
            d.color = default
    me.color_attributes.active_color = a
    try:
        me.color_attributes.render_color_index = me.color_attributes.find('Col')
    except Exception:
        pass
    return a


def paint(ob, fn, mode='multiply'):
    """Set (or multiply) the 'Col' attribute per corner: fn(co, normal, material_index, poly) -> (r, g, b)."""
    me = ob.data
    a = ensure_col(ob)
    for p in me.polygons:
        for li in p.loop_indices:
            v = me.loops[li].vertex_index
            c = fn(me.vertices[v].co, p.normal, p.material_index, p)
            if mode == 'multiply':
                o = a.data[li].color
                a.data[li].color = (o[0] * c[0], o[1] * c[1], o[2] * c[2], 1.0)
            else:
                a.data[li].color = (c[0], c[1], c[2], 1.0)


def uv_box(bm, tile=2.0, faces=None, offset=(0.0, 0.0, 0.0), rot=0.0):
    """World-scale box projection: walls get u along the face, v = z (so brick courses stay level); tops get x, y."""
    uvl = ensure_uv(bm)
    ox, oy, oz = offset
    cs, sn = math.cos(rot), math.sin(rot)
    for f in (faces if faces is not None else bm.faces):
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            x, y, z = l.vert.co.x + ox, l.vert.co.y + oy, l.vert.co.z + oz
            if ax == 2:
                u, v = x, y if n.z > 0 else -y
                u, v = u * cs - v * sn, u * sn + v * cs
            elif ax == 1:
                u, v = (x if n.y < 0 else -x), z
            else:
                u, v = (y if n.x > 0 else -y), z
            l[uvl].uv = (u / tile, v / tile)


def uv_planar(bm, faces, origin, uaxis, vaxis, su, sv, u0=0.0, v0=0.0):
    """Planar UVs: u = u0 + dot(p - origin, uaxis) * su, v likewise."""
    uvl = ensure_uv(bm)
    o, ua, va = Vector(origin), Vector(uaxis), Vector(vaxis)
    for f in faces:
        for l in f.loops:
            d = l.vert.co - o
            l[uvl].uv = (u0 + d.dot(ua) * su, v0 + d.dot(va) * sv)


# Timber trim sheet (build/kit/textures/timber): bands in v (0 = bottom of the image in UV space).
# Each band tiles in u at 1024 px/m (one u unit = 2 m along the grain).
TRIM = {
    'plankA': (0.75, 1.0),      # weathered grey-brown timber, 0.5 m tall band
    'plankB': (0.5, 0.75),      # darker oiled/brown timber
    'bark': (0.25, 0.5),        # poplar/willow bark
    'pole': (0.125, 0.25),      # debarked weathered pole, 0.25 m band
    'end': (0.0, 0.125),        # end-grain tiles: 8 across, 0..3 log ends with bark rim, 4..7 squared-beam ends
}


def trim_v(band, t):
    """v within a trim band (t 0..1 across the band, kept off its edges)."""
    a, b = TRIM[band]
    pad = (b - a) * 0.02
    return a + pad + (b - a - 2 * pad) * t


def end_tile_uv(k, du, dv):
    """UV in end-grain tile k (0..7) for a point at (du, dv) in -1..1 across the tile."""
    a, b = TRIM['end']
    s = (b - a)
    return ((k + 0.5 + 0.47 * du) / 8.0, a + s * (0.5 + 0.47 * dv))


def tri_count(ob):
    deps = bpy.context.evaluated_depsgraph_get()
    e = ob.evaluated_get(deps)
    me = e.to_mesh()
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    e.to_mesh_clear()
    return n


def apply_modifiers(ob):
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def triangulate(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='BEAUTY')
    bm.to_mesh(ob.data)
    bm.free()


def decimate_lod(ob, ratio, name, planar_first=False):
    """A decimated copy of `ob` (collapse; keeps materials, UVs and colours interpolated)."""
    me = ob.data.copy()
    lo = bpy.data.objects.new(name, me)
    for c in ob.users_collection:
        c.objects.link(lo)
    if planar_first:
        m0 = lo.modifiers.new('plan', 'DECIMATE')
        m0.decimate_type = 'DISSOLVE'
        m0.angle_limit = math.radians(1.0)
        m0.delimit = {'MATERIAL', 'SEAM', 'UV'}
    m = lo.modifiers.new('dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = ratio
    m.use_collapse_triangulate = True
    apply_modifiers(lo)
    return lo


def bbox(ob):
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]
    zs = [v.co.z for v in ob.data.vertices]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def gltf_bbox(ob):
    """Bounding box in glTF axes (x, y, z) = (x, z, -y)."""
    (x0, y0, z0), (x1, y1, z1) = bbox(ob)
    return [round(x0, 4), round(z0, 4), round(-y1, 4)], [round(x1, 4), round(z1, 4), round(-y0, 4)]


# ---------------------------------------------------------------- vertex occlusion

def _smooth_corner_values(me, vals, iters):
    """Average per-corner scalar values per vertex, smooth them over edges `iters` times, return per-corner values."""
    nv = len(me.vertices)
    acc, cnt = [0.0] * nv, [0] * nv
    for i, l in enumerate(me.loops):
        acc[l.vertex_index] += vals[i]
        cnt[l.vertex_index] += 1
    pv = [acc[i] / cnt[i] if cnt[i] else 1.0 for i in range(nv)]
    nb = [[] for _ in range(nv)]
    for e in me.edges:
        a, b = e.vertices
        nb[a].append(b)
        nb[b].append(a)
    for _ in range(iters):
        pv = [0.5 * pv[i] + 0.5 * (sum(pv[j] for j in nb[i]) / len(nb[i]) if nb[i] else pv[i]) for i in range(nv)]
    return [pv[l.vertex_index] for l in me.loops]


def bake_ao(obs, samples=256, distance=0.8, ground=True, ground_z=0.0, strength=0.75, power=1.0, extra=None, smooth=2):
    """Bake ambient occlusion into each object's 'Col' (multiplied in, scaled by strength). `extra` objects occlude
    but are not baked. A ground plane at ground_z occludes when `ground` is set."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'GPU'
    sc.cycles.samples = samples
    _gpu()
    if not sc.world:
        sc.world = bpy.data.worlds.new('W')
    sc.world.light_settings.distance = distance
    tmp = []
    if ground:
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60)
        for v in bm.verts:
            v.co.z = ground_z
        me = bpy.data.meshes.new('_ground')
        bm.to_mesh(me)
        bm.free()
        g = bpy.data.objects.new('_ground', me)
        bpy.context.scene.collection.objects.link(g)
        tmp.append(g)
    hidden = []
    keep = set(obs) | set(tmp) | set(extra or [])
    # everything else is hidden from the bake (hide_render is what a Cycles bake honours; the builders leave every
    # finished piece at the origin, overlapping the one being baked)
    for o in bpy.context.scene.objects:
        if o.type in ('MESH', 'CURVE', 'FONT') and o not in keep and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    for ob in obs:
        # one object at a time: the LODs of a piece overlap each other too
        for o2 in obs:
            o2.hide_render = o2 is not ob
        me = ob.data
        tmpa = me.color_attributes.new('_ao', 'FLOAT_COLOR', 'CORNER')
        me.color_attributes.active_color = tmpa
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
        col = me.color_attributes['Col']
        raw = [d.color[0] for d in tmpa.data]
        if smooth:
            raw = _smooth_corner_values(me, raw, smooth)
        for i, d in enumerate(tmpa.data):
            a = raw[i] ** power
            k = 1 - strength * (1 - a)
            c = col.data[i].color
            col.data[i].color = (c[0] * k, c[1] * k, c[2] * k, 1.0)
        me.color_attributes.remove(me.color_attributes['_ao'])
        ensure_col(ob)
    for o2 in obs:
        o2.hide_render = False
    for o in hidden:
        o.hide_render = False
    for t in tmp:
        bpy.data.objects.remove(t, do_unlink=True)


def _gpu():
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
    except Exception:
        pass
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type != 'CPU'


# ---------------------------------------------------------------- export and metadata

def export_glb(obs, path):
    """Export objects (meshes at the origin, LODs included) to a GLB without images; pack.ts adds the textures."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_image_format='NONE', export_vertex_color='NAME', export_vertex_color_name='Col',
        export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True, export_extras=True,
        export_cameras=False, export_lights=False, export_animations=False, export_morph=False, export_skins=False)


def piece_meta(name, lods, kind, snap, pivot, notes='', extra=None):
    """Metadata for kit.json: tris per LOD, bbox (glTF axes), materials."""
    lo0 = lods[0]
    mats = sorted({s.material.name for s in lo0.material_slots if s.material})
    d = {
        'name': name, 'kind': kind, 'snap': snap, 'pivot': pivot,
        'lods': [{'node': o.name, 'tris': tri_count(o)} for o in lods],
        'bbox': gltf_bbox(lo0), 'materials': mats, 'notes': notes,
    }
    if extra:
        d.update(extra)
    return d


def write_stats(pack, metas, file):
    os.makedirs(STATS, exist_ok=True)
    json.dump({'pack': pack, 'file': file, 'pieces': metas}, open(os.path.join(STATS, f'{pack}.json'), 'w'), indent=1)


# ---------------------------------------------------------------- rendering

def render_setup(res=(1600, 1000), samples=128, exposure=0.0, hdri=HDRI, hdri_strength=0.8, sun=True,
                 sun_elev=32.0, sun_azim=-50.0, sun_strength=4.5, look='AgX - Medium High Contrast'):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'GPU'
    _gpu()
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.cycles.max_bounces = 6
    sc.cycles.transparent_max_bounces = 64      # alpha-cut foliage stacks many layers; fewer renders black
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = look
    except Exception:
        pass
    sc.view_settings.exposure = exposure
    w = bpy.data.worlds.new('World')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(hdri, check_existing=True)
    mp = nt.nodes.new('ShaderNodeMapping')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp.inputs['Rotation'].default_value[2] = math.radians(sun_azim + 180)
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = hdri_strength
    nt.links.new(bg.outputs[0], out.inputs[0])
    if sun:
        ld = bpy.data.lights.new('Sun', 'SUN')
        ld.energy = sun_strength
        ld.angle = math.radians(0.6)
        ld.color = (1.0, 0.93, 0.82)
        so = bpy.data.objects.new('Sun', ld)
        sc.collection.objects.link(so)
        so.rotation_euler = (math.radians(90 - sun_elev), 0, math.radians(sun_azim))
    return sc


def camera(loc, target, lens=35.0, name='Cam'):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_start = 0.05
    cd.clip_end = 2000
    co = bpy.data.objects.new(name, cd)
    sc.collection.objects.link(co)
    co.location = Vector(loc)
    d = Vector(target) - Vector(loc)
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co
    return co


def frame(obs, direction=(-1.0, -1.3, 0.75), lens=50.0, margin=1.12, res=None):
    """Point a camera at the objects' bounds from `direction`."""
    pts = []
    for o in obs:
        for v in o.data.vertices:
            pts.append(o.matrix_world @ v.co)
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    r = (hi - lo).length / 2
    sc = bpy.context.scene
    rx, ry = res or (sc.render.resolution_x, sc.render.resolution_y)
    sensor = 36.0
    fov = 2 * math.atan(sensor / (2 * lens))
    if ry > rx:
        fov *= rx / ry
    dist = r * margin / math.sin(fov / 2)
    d = Vector(direction).normalized()
    return camera(c + d * dist, c, lens)


def ground_plane(size=40.0, mat='M_Ground', z=0.0, tile=2.6):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    for v in bm.verts:
        v.co.z = z
    uv_box(bm, tile=tile)
    return new_object('_ground', bm, [mat])


def render(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc = bpy.context.scene
    sc.render.filepath = path
    sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
