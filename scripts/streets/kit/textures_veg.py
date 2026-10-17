"""Vegetation textures for the streets kit (pack `veg`), in two steps:

1. In Blender (renders the foliage atlas from modelled leaves, one region at a time, orthographic from above):
     Blender -b --factory-startup --python scripts/streets/kit/textures_veg.py -- --render [--only=palmA,figA]
   Each region is real geometry (palm leaflets folded along the midrib, fig leaves with lobes and cupping, grass
   blades, reed stems with plumes, thistles) lit by nothing: four emission passes give base colour (sRGB), the
   surface normal facing the camera (= the card's tangent-space normal, OpenGL), ambient occlusion, roughness.
   Output: build/kit/tmp/veg_atlas/<region>_{bc,n,ao,r}.png (RGBA; alpha from coverage).

2. With the kit venv (composites the atlas, bleeds colour under the alpha, and generates the bark tiles):
     build/kit/venv/bin/python -I scripts/streets/kit/textures_veg.py post
   Output: build/kit/textures/veg_foliage/veg_foliage_{bca,n,orm}.png (2048, alpha cut-out atlas),
           build/kit/textures/veg_palmtrunk/... (2048 = 1.4 m: date-palm leaf bases, tileable),
           build/kit/textures/veg_bark/... (1024 = 1.0 m: smooth grey fig bark, tileable).

Atlas regions (pixels from the top-left; the UV of a region is u = x / 2048, v = 1 - y / 2048) are in REGIONS and are
read by lib/veglib.py, so cards and atlas always agree.
"""
import math
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
RAW = os.path.join(ROOT, 'build', 'kit', 'tmp', 'veg_atlas')
ATLAS = 2048

# name: (x, y, w, h) in atlas pixels, (world width, world height) in metres of the rendered patch
REGIONS = {
    'palmA':    ((0, 0, 2048, 256), (3.2, 0.4)),
    'palmB':    ((0, 256, 2048, 256), (3.2, 0.4)),
    'palmDead': ((0, 512, 2048, 256), (3.2, 0.4)),
    'reedA':    ((0, 768, 2048, 256), (3.2, 0.4)),
    'reedB':    ((0, 1024, 2048, 256), (3.2, 0.4)),
    'figA':     ((0, 1280, 768, 768), (0.96, 0.96)),
    'weedA':    ((768, 1280, 384, 384), (0.6, 0.6)),
    'weedB':    ((768, 1664, 384, 384), (0.6, 0.6)),
    'figB':     ((1152, 1280, 384, 768), (0.48, 0.96)),
    'grassA':   ((1536, 1280, 512, 384), (0.64, 0.48)),
    'grassB':   ((1536, 1664, 512, 384), (0.64, 0.48)),
}


def region_uv(name):
    """(u0, v0, u1, v1) of a region in UV space (v up)."""
    (x, y, w, h), _ = REGIONS[name]
    return (x / ATLAS, 1 - (y + h) / ATLAS, (x + w) / ATLAS, 1 - y / ATLAS)


# ====================================================================================================== Blender side

def _blender_main():
    import bpy
    import bmesh
    from mathutils import Vector, Matrix
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
    import kitlib as K

    def lin(c):
        return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)

    # ---------------------------------------------------------------- materials with switchable passes
    MATS = {}

    def leafmat(name, colA, colB, tip=(0.62, 0.52, 0.34), tip_amt=0.0, tip_start=0.8, rib=0.12, rough=0.55,
                kind='blade', veins=0.0, bump=1.0, speck=0.08):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        N = nt.nodes.new
        L = nt.links.new
        out = N('ShaderNodeOutputMaterial')
        uv = N('ShaderNodeUVMap')
        uv.uv_map = 'UVMap'
        sep = N('ShaderNodeSeparateXYZ')
        L(uv.outputs[0], sep.inputs[0])
        rnd = N('ShaderNodeAttribute')
        rnd.attribute_type = 'GEOMETRY'
        rnd.attribute_name = 'rand'
        geo = N('ShaderNodeNewGeometry')

        def math(op, a, b=None, c=None):
            nd = N('ShaderNodeMath')
            nd.operation = op
            for i, v in enumerate((a, b, c)):
                if v is None:
                    continue
                if isinstance(v, (int, float)):
                    nd.inputs[i].default_value = v
                else:
                    L(v, nd.inputs[i])
            return nd.outputs[0]

        def mixc(fac, a, b):
            nd = N('ShaderNodeMix')
            nd.data_type = 'RGBA'
            if isinstance(fac, (int, float)):
                nd.inputs['Factor'].default_value = fac
            else:
                L(fac, nd.inputs['Factor'])
            for key, v in (('A', a), ('B', b)):
                if isinstance(v, tuple):
                    nd.inputs[key].default_value = (*v, 1.0)
                else:
                    L(v, nd.inputs[key])
            return nd.outputs['Result']
        u, v = sep.outputs[0], sep.outputs[1]
        r = rnd.outputs['Fac']
        base = mixc(r, lin(colA), lin(colB))
        # fine speckle and streaks along the blade
        nz = N('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = 60.0
        nz.inputs['Detail'].default_value = 4.0
        L(uv.outputs[0], nz.inputs['Vector'])
        sp = math('MULTIPLY_ADD', nz.outputs['Fac'], speck * 2, 1 - speck)
        mm = N('ShaderNodeMix')
        mm.data_type = 'RGBA'
        mm.blend_type = 'MULTIPLY'
        mm.inputs['Factor'].default_value = 1.0
        L(base, mm.inputs['A'])
        cv = N('ShaderNodeCombineColor')
        for i in range(3):
            L(sp, cv.inputs[i])
        L(cv.outputs[0], mm.inputs['B'])
        base = mm.outputs['Result']
        height = None
        if kind == 'blade':
            # u along the blade 0..1, v across 0..1: a midrib, parallel veins, browned tips
            dv = math('ABSOLUTE', math('SUBTRACT', v, 0.5))
            sm = N('ShaderNodeMapRange')
            sm.interpolation_type = 'SMOOTHSTEP'
            L(dv, sm.inputs['Value'])
            sm.inputs['From Min'].default_value = 0.05
            sm.inputs['From Max'].default_value = 0.0
            ribm = sm.outputs['Result']
            base = mixc(math('MULTIPLY', ribm, rib), base, lin((0.85, 0.83, 0.62)))
            pv = math('SINE', math('MULTIPLY', v, 6.2831 * 7))
            height = math('MULTIPLY_ADD', pv, 0.15, math('MULTIPLY', ribm, -0.6))
            if tip_amt > 0:
                tm = N('ShaderNodeMapRange')
                tm.interpolation_type = 'SMOOTHSTEP'
                L(math('MULTIPLY_ADD', r, 0.15, u), tm.inputs['Value'])
                tm.inputs['From Min'].default_value = tip_start
                tm.inputs['From Max'].default_value = 1.05
                base = mixc(math('MULTIPLY', tm.outputs['Result'], tip_amt), base, lin(tip))
        elif kind == 'palmate':
            # radiating veins from the petiole at the origin (uv 0.5, 0.5)
            dx = math('MULTIPLY', math('SUBTRACT', u, 0.5), 2.0)
            dy = math('MULTIPLY', math('SUBTRACT', v, 0.5), 2.0)
            th = math('ARCTAN2', dx, dy)
            rr = math('SQRT', math('ADD', math('MULTIPLY', dx, dx), math('MULTIPLY', dy, dy)))
            step = 0.62
            md = math('SUBTRACT', math('FLOORED_MODULO', math('ADD', th, step / 2), step), step / 2)
            d = math('MULTIPLY', math('ABSOLUTE', md), rr)
            vm = N('ShaderNodeMapRange')
            vm.interpolation_type = 'SMOOTHSTEP'
            L(d, vm.inputs['Value'])
            vm.inputs['From Min'].default_value = 0.022
            vm.inputs['From Max'].default_value = 0.0
            vein = vm.outputs['Result']
            # secondary veins: a finer net
            vor = N('ShaderNodeTexVoronoi')
            vor.feature = 'DISTANCE_TO_EDGE'
            vor.inputs['Scale'].default_value = 26.0
            L(uv.outputs[0], vor.inputs['Vector'])
            vm2 = N('ShaderNodeMapRange')
            vm2.interpolation_type = 'SMOOTHSTEP'
            L(vor.outputs['Distance'], vm2.inputs['Value'])
            vm2.inputs['From Min'].default_value = 0.04
            vm2.inputs['From Max'].default_value = 0.0
            base = mixc(math('MULTIPLY', vein, veins), base, lin((0.66, 0.70, 0.42)))
            base = mixc(math('MULTIPLY', vm2.outputs['Result'], veins * 0.35), base, lin((0.45, 0.52, 0.28)))
            height = math('ADD', math('MULTIPLY', vein, -0.8), math('MULTIPLY', vm2.outputs['Result'], -0.25))
            # paler toward the edge, a little
            em = N('ShaderNodeMapRange')
            em.interpolation_type = 'SMOOTHSTEP'
            L(rr, em.inputs['Value'])
            em.inputs['From Min'].default_value = 0.3
            em.inputs['From Max'].default_value = 1.0
            base = mixc(math('MULTIPLY', em.outputs['Result'], 0.12), base, lin((0.55, 0.60, 0.35)))
        # passes
        emit_bc = N('ShaderNodeEmission')
        L(base, emit_bc.inputs['Color'])
        nrm = geo.outputs['Normal']
        if height is not None and bump > 0:
            bp = N('ShaderNodeBump')
            bp.inputs['Strength'].default_value = 0.35 * bump
            bp.inputs['Distance'].default_value = 0.002
            L(height, bp.inputs['Height'])
            nrm = bp.outputs['Normal']
        flip = math('MULTIPLY_ADD', geo.outputs['Backfacing'], -2.0, 1.0)
        vs = N('ShaderNodeVectorMath')
        vs.operation = 'SCALE'
        L(nrm, vs.inputs[0])
        L(flip, vs.inputs['Scale'])
        enc = N('ShaderNodeVectorMath')
        enc.operation = 'MULTIPLY_ADD'
        L(vs.outputs[0], enc.inputs[0])
        enc.inputs[1].default_value = (0.5, 0.5, 0.5)
        enc.inputs[2].default_value = (0.5, 0.5, 0.5)
        emit_n = N('ShaderNodeEmission')
        L(enc.outputs[0], emit_n.inputs['Color'])
        ao = N('ShaderNodeAmbientOcclusion')
        ao.samples = 16
        ao.inputs['Distance'].default_value = 0.04
        emit_ao = N('ShaderNodeEmission')
        L(ao.outputs['AO'], emit_ao.inputs['Color'])
        emit_r = N('ShaderNodeEmission')
        rv = math('MULTIPLY_ADD', r, 0.08, rough - 0.04)
        L(rv, emit_r.inputs['Color'])
        m['passes'] = 1
        MATS[name] = {'mat': m, 'out': out, 'bc': emit_bc, 'n': emit_n, 'ao': emit_ao, 'r': emit_r}
        return m

    def set_pass(p):
        for d in MATS.values():
            d['mat'].node_tree.links.new(d[p].outputs[0], d['out'].inputs['Surface'])

    # ---------------------------------------------------------------- geometry helpers
    def new_bm():
        bm = bmesh.new()
        return bm, bm.loops.layers.uv.new('UVMap'), bm.faces.layers.float.new('rand')

    def ribbon(bm, uvl, rl, pts, sides, halfw, ups, fold=0.35, rand=0.0, mat=0, u0=0.0, u1=1.0):
        """A folded blade along pts: each half raised by `fold` (rad) toward `ups`; UV u along, v across."""
        rows = []
        n = len(pts)
        for i in range(n):
            p, s, w, up = pts[i], sides[i], halfw[i], ups[i]
            c, sn = math.cos(fold), math.sin(fold)
            rows.append((bm.verts.new(p - s * w * c + up * w * sn), bm.verts.new(p), bm.verts.new(p + s * w * c + up * w * sn)))
        for i in range(n - 1):
            for j in range(2):
                f = bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
                f.material_index = mat
                f.smooth = True
                f[rl] = rand
                ua, ub = u0 + (u1 - u0) * i / (n - 1), u0 + (u1 - u0) * (i + 1) / (n - 1)
                for l, uvv in zip(f.loops, ((ua, j / 2), (ub, j / 2), (ub, (j + 1) / 2), (ua, (j + 1) / 2))):
                    l[uvl].uv = uvv

    def blade(bm, uvl, rl, base, direction, length, width, up=Vector((0, 0, 1)), curve=0.0, curve_dir=None, twist=0.0,
              fold=0.35, rand=0.0, mat=0, segs=8, taper=1.0, wshape='lance', droop=0.0):
        """A leaf blade from base along direction (in the card plane), bending by `curve` (radians total) toward
        curve_dir, twisting by `twist` about its axis, drooping out of the plane by `droop` (m at the tip)."""
        d = Vector(direction).normalized()
        cd = Vector(curve_dir).normalized() if curve_dir is not None else Vector((-d.y, d.x, 0))
        pts, sides, ws, ups = [], [], [], []
        p = Vector(base)
        cur = d.copy()
        for i in range(segs + 1):
            t = i / segs
            if wshape == 'lance':
                w = width * (math.sin(math.pi * min(1.0, 0.15 + 0.85 * t)) ** 0.6) * (1 - t) ** 0.3 if t < 1 else 0.0
                w = width * min(1.0, (t + 0.08) / 0.25) * (1 - t ** 2.2) ** 0.6
            elif wshape == 'linear':
                w = width * (1 - t ** 3) ** 0.7 * min(1.0, (t + 0.05) / 0.08)
            elif wshape == 'taper':
                w = width * min(1.0, (t + 0.04) / 0.12) * (1 - t) ** 0.85
            else:
                w = width * (1 - t)
            pts.append(p.copy() + Vector((0, 0, -droop * t * t)))
            side = Vector((-cur.y, cur.x, 0)).normalized()
            a = twist * t
            # twist: rotate the across-vector out of the plane
            s3 = side * math.cos(a) + Vector(up) * math.sin(a)
            u3 = Vector(up) * math.cos(a) - side * math.sin(a)
            sides.append(s3)
            ups.append(u3)
            ws.append(w / 2 * (taper if i == segs else 1))
            # advance, bending
            ang = curve / segs
            cur = (cur * math.cos(ang) + cd * math.sin(ang)).normalized()
            p = p + cur * (length / segs)
        ribbon(bm, uvl, rl, pts, sides, ws, ups, fold=fold, rand=rand, mat=mat)

    def tube(bm, uvl, rl, pts, radii, sides=6, rand=0.0, mat=0):
        rings = []
        n = len(pts)
        for i in range(n):
            d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
            x = d.cross(Vector((0, 0, 1)))
            if x.length < 1e-4:
                x = d.cross(Vector((1, 0, 0)))
            x.normalize()
            y = d.cross(x)
            rings.append([bm.verts.new(pts[i] + (x * math.cos(2 * math.pi * k / sides) + y * math.sin(2 * math.pi * k / sides)) * radii[i]) for k in range(sides)])
        for i in range(n - 1):
            for k in range(sides):
                f = bm.faces.new((rings[i][k], rings[i][(k + 1) % sides], rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
                f.smooth = True
                f.material_index = mat
                f[rl] = rand
                for l, uvv in zip(f.loops, ((i / (n - 1), k / sides), (i / (n - 1), (k + 1) / sides), ((i + 1) / (n - 1), (k + 1) / sides), ((i + 1) / (n - 1), k / sides))):
                    l[uvl].uv = uvv

    def obj(name, bm, mats):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for m in mats:
            me.materials.append(m)
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        return o

    # ---------------------------------------------------------------- the regions
    def palm_half(seed, dead=False):
        """Half a date-palm frond lying along +x (base at x = 0), leaflets toward +y; spines near the base."""
        R = K.rng(seed)
        if dead:
            m_leaf = leafmat('dleaf', (0.58, 0.48, 0.34), (0.47, 0.39, 0.29), tip=(0.36, 0.30, 0.24), tip_amt=0.5,
                             tip_start=0.6, rib=0.08, rough=0.8, speck=0.15)
            m_rach = leafmat('drach', (0.62, 0.54, 0.40), (0.55, 0.47, 0.35), rib=0.0, rough=0.8, kind='plain')
        else:
            m_leaf = leafmat('leaf', (0.44, 0.50, 0.40), (0.36, 0.43, 0.33), tip=(0.70, 0.62, 0.40), tip_amt=0.55,
                             tip_start=0.88, rib=0.18, rough=0.5, speck=0.06)
            m_rach = leafmat('rach', (0.66, 0.66, 0.46), (0.58, 0.60, 0.42), rib=0.0, rough=0.55, kind='plain')
        m_spine = leafmat('spine', (0.72, 0.64, 0.42), (0.62, 0.55, 0.38), tip=(0.45, 0.38, 0.28), tip_amt=0.6,
                          tip_start=0.5, rib=0.0, rough=0.5)
        bm, uvl, rl = new_bm()
        y0 = 0.012
        x0, x1 = 0.02, 3.17
        # rachis: tapering, lying along the bottom edge
        pts = [Vector((x0 + (x1 - x0) * t, y0 + 0.004 * math.sin(t * 9), 0.0)) for t in [k / 24 for k in range(25)]]
        tube(bm, uvl, rl, pts, [0.016 * (1 - 0.85 * k / 24) + 0.002 for k in range(25)], sides=8, mat=1)
        xs = 0.55          # start of leaflets
        x = 0.28
        while x < xs:
            # spines: stiff, short, yellowish
            ang = math.radians(R.uniform(30, 55))
            L = R.uniform(0.05, 0.12) * (0.5 + x / xs)
            blade(bm, uvl, rl, (x, y0 + 0.006, 0.004), (math.cos(ang), math.sin(ang), 0), L, 0.006, fold=0.9,
                  rand=R.random(), mat=2, segs=4, wshape='tri')
            x += R.uniform(0.035, 0.06)
        x = xs
        k = 0
        while x < x1 - 0.04:
            t = (x - xs) / (x1 - xs)
            Lmax = 0.56 if not dead else 0.46
            L = Lmax * (math.sin(math.pi * min(1.0, 0.18 + 0.82 * t)) ** 0.5) * (1 - 0.3 * t)
            group = R.choice((2, 3, 3, 4))
            for g in range(group):
                if dead and R.random() < 0.28:
                    continue
                ang = math.radians(R.uniform(26, 46) - 8 * t + g * R.uniform(3, 8))
                # leaflets in different planes: some tilt toward or away from the viewer (foreshortened)
                tilt = R.uniform(-0.6, 0.6) if not dead else R.uniform(-1.0, 1.0)
                LL = L * R.uniform(0.85, 1.05) * (R.uniform(0.35, 0.8) if dead and R.random() < 0.25 else 1.0)
                d = Vector((math.cos(ang), math.sin(ang) * math.cos(tilt), 0)).normalized()
                up = Vector((0, -math.sin(tilt), math.cos(tilt)))
                blade(bm, uvl, rl, (x + g * 0.008, y0 + 0.008, 0.01 * g + 0.002 * k % 3), d, LL * (0.5 + 0.5 * abs(math.cos(tilt))),
                      R.uniform(0.024, 0.034) * (1 - 0.35 * t), up=up, curve=R.uniform(-0.12, 0.12) + (0.25 if dead else 0.0),
                      twist=R.uniform(-0.4, 0.4), fold=R.uniform(0.35, 0.6) if not dead else R.uniform(0.6, 1.1),
                      rand=R.random(), mat=0, segs=8, droop=0.0)
            x += R.uniform(0.03, 0.045) * (1 + 0.4 * t)
            k += 1
        return [obj('frond', bm, [m_leaf, m_rach, m_spine])]

    def reeds(seed, dry=False):
        """Reed stems lying along +x (base at x = 0), leaves alternate, a feathery plume at the tip (Phragmites)."""
        R = K.rng(seed)
        if dry:
            m_leaf = leafmat('rleaf', (0.58, 0.51, 0.38), (0.48, 0.44, 0.34), tip=(0.40, 0.34, 0.28), tip_amt=0.5,
                             tip_start=0.55, rib=0.1, rough=0.8, speck=0.12)
            m_stem = leafmat('rstem', (0.60, 0.53, 0.40), (0.52, 0.47, 0.36), rib=0.0, rough=0.7, kind='plain')
        else:
            m_leaf = leafmat('rleaf', (0.36, 0.44, 0.26), (0.42, 0.49, 0.30), tip=(0.58, 0.52, 0.36), tip_amt=0.7,
                             tip_start=0.7, rib=0.12, rough=0.72, speck=0.08)
            m_stem = leafmat('rstem', (0.50, 0.53, 0.36), (0.56, 0.54, 0.38), rib=0.0, rough=0.65, kind='plain')
        m_plume = leafmat('plume', (0.42, 0.33, 0.30), (0.55, 0.47, 0.40), rib=0.0, rough=0.9, kind='plain', speck=0.2)
        bm, uvl, rl = new_bm()
        n = 5
        for s in range(n):
            yb = 0.07 + 0.26 * (s + R.uniform(-0.2, 0.2)) / (n - 1)
            Lst = R.uniform(2.5, 3.1) if s % 2 == 0 else R.uniform(2.0, 2.8)
            wav = R.uniform(-0.03, 0.03)
            pts = [Vector((0.02 + Lst * t, yb + wav * math.sin(t * 3.0) + 0.02 * t * (s - 2) / 2, 0.0)) for t in [k / 16 for k in range(17)]]
            tube(bm, uvl, rl, pts, [0.0055 * (1 - 0.6 * k / 16) for k in range(17)], sides=6, rand=R.random(), mat=1)
            has_plume = not dry or R.random() < 0.6
            # leaves at nodes, alternating up/down in the card
            xn = R.uniform(0.25, 0.4)
            side = 1 if R.random() < 0.5 else -1
            while xn < Lst - (0.35 if has_plume else 0.1):
                t = xn / Lst
                p = Vector((0.02 + xn, yb + wav * math.sin(t * 3.0), 0.003))
                ang = math.radians(R.uniform(14, 30)) * side
                Lf = R.uniform(0.36, 0.6) * (1 - 0.3 * t)
                if dry and R.random() < 0.3:
                    Lf *= 0.5
                blade(bm, uvl, rl, p, (math.cos(ang), math.sin(ang), 0), Lf, R.uniform(0.02, 0.03), curve=-side * R.uniform(0.3, 0.9),
                      twist=R.uniform(-0.9, 0.9), fold=0.3, rand=R.random(), mat=0, segs=12, wshape='taper')
                side = -side
                xn += R.uniform(0.13, 0.22)
            if has_plume:
                # plume: a main axis with many fine branches carrying spikelets, swept toward the tip
                px0 = 0.02 + Lst - R.uniform(0.32, 0.42)
                plen = 0.02 + Lst - px0
                for b in range(72):
                    t = b / 72
                    bx = px0 + plen * t * 0.85
                    by = yb + wav * math.sin(3.0)
                    blen = R.uniform(0.06, 0.15) * (1 - 0.6 * t)
                    ang = math.radians(R.uniform(8, 28)) * (1 if b % 2 else -1)
                    tip = Vector((bx + math.cos(ang) * blen, by + math.sin(ang) * blen, 0.005))
                    tube(bm, uvl, rl, [Vector((bx, by, 0.004)), tip], [0.0012, 0.0006], sides=3, rand=R.random(), mat=2)
                    for q in range(9):
                        tq = 0.2 + 0.8 * q / 8
                        sp = Vector((bx, by, 0.006)).lerp(tip, tq)
                        sa = ang + math.radians(R.uniform(-25, 25))
                        blade(bm, uvl, rl, sp, (math.cos(sa), math.sin(sa), 0), R.uniform(0.012, 0.024), R.uniform(0.003, 0.0045),
                              fold=0.6, rand=R.random(), mat=2, segs=2, wshape='tri')
        return [obj('reeds', bm, [m_leaf, m_stem, m_plume])]

    def fig_leaf(bm, uvl, rl, origin, rot, R, Rsize, tilt=0.0, mat=0):
        """A palmate fig leaf with 3-5 rounded lobes, attached at origin (the petiole end), pointing along rot."""
        lobes = [(0.0, 1.0, 0.44), (0.82, 0.88, 0.42), (-0.82, 0.88, 0.42)]
        if R.random() < 0.75:
            lobes += [(1.62, 0.58, 0.36), (-1.62, 0.58, 0.36)]
        def rad(th):
            v = 0.42
            for c, Lk, w in lobes:
                v = max(v, 0.42 + 0.58 * Lk * math.exp(-((th - c) / w) ** 2))
            v *= 1 + 0.05 * math.sin(th * 23 + R.random())
            if abs(th) > 2.5:
                v *= 0.25 + 0.75 * (math.pi - abs(th)) / (math.pi - 2.5)
            return v
        n_th, n_r = 48, 4
        cs, sn = math.cos(rot), math.sin(rot)
        ct, st = math.cos(tilt), math.sin(tilt)
        centre = bm.verts.new(origin)
        rings = []
        for i in range(n_r):
            ring = []
            fr = (i + 1) / n_r
            for k in range(n_th):
                th = -math.pi + 2 * math.pi * k / n_th
                r = Rsize * rad(th) * fr
                lx, ly = r * math.sin(th), r * math.cos(th)
                lz = 0.06 * Rsize * fr * fr - 0.05 * Rsize * (ly / Rsize) ** 2   # cupped, tips curling down
                # tilt about the local x axis, then rotate in plane
                ly2, lz2 = ly * ct - lz * st, ly * st + lz * ct
                ring.append((bm.verts.new((origin[0] + lx * cs - ly2 * sn, origin[1] + lx * sn + ly2 * cs, origin[2] + lz2)), lx, ly))
            rings.append(ring)
        rv = R.random()
        def uvof(lx, ly):
            return (0.5 + lx / (2 * Rsize), 0.5 + ly / (2 * Rsize))
        for k in range(n_th):
            a, b = rings[0][k], rings[0][(k + 1) % n_th]
            f = bm.faces.new((centre, a[0], b[0]))
            f.smooth = True
            f.material_index = mat
            f[rl] = rv
            for l, uvv in zip(f.loops, ((0.5, 0.5), uvof(a[1], a[2]), uvof(b[1], b[2]))):
                l[uvl].uv = uvv
            for i in range(n_r - 1):
                a0, b0, a1, b1 = rings[i][k], rings[i][(k + 1) % n_th], rings[i + 1][k], rings[i + 1][(k + 1) % n_th]
                f = bm.faces.new((a0[0], a1[0], b1[0], b0[0]))
                f.smooth = True
                f.material_index = mat
                f[rl] = rv
                for l, uvv in zip(f.loops, (uvof(a0[1], a0[2]), uvof(a1[1], a1[2]), uvof(b1[1], b1[2]), uvof(b0[1], b0[2]))):
                    l[uvl].uv = uvv

    def fig(seed, narrow=False):
        """figA: a branch tip seen from outside the crown, a rosette of 10-13 lobed leaves round it;
        figB: a twig seen from the side, leaves arching off it."""
        R = K.rng(seed)
        m_leaf = leafmat('fleaf', (0.42, 0.55, 0.25), (0.49, 0.61, 0.30), rib=0.0, rough=0.6, kind='palmate', veins=0.3, speck=0.07)
        m_twig = leafmat('ftwig', (0.50, 0.47, 0.40), (0.42, 0.40, 0.35), rib=0.0, rough=0.7, kind='plain')
        m_fruit = leafmat('ffruit', (0.42, 0.50, 0.24), (0.36, 0.28, 0.30), rib=0.0, rough=0.5, kind='plain')
        bm, uvl, rl = new_bm()
        W, H = REGIONS['figB' if narrow else 'figA'][1]
        if not narrow:
            c = Vector((W / 2, H / 2, 0.0))
            n = 12
            for i in range(n):
                ang = 2 * math.pi * (i + R.uniform(-0.25, 0.25)) / n
                d = Vector((math.sin(ang), math.cos(ang), 0))
                pl = R.uniform(0.05, 0.1)
                at = c + d * R.uniform(0.0, 0.03) + Vector((0, 0, 0.02 * (n - i) / n))
                pend = at + d * pl
                tube(bm, uvl, rl, [at, pend], [0.004, 0.003], sides=4, mat=1)
                size = R.uniform(0.15, 0.2)
                fig_leaf(bm, uvl, rl, pend, -ang, R, size, tilt=R.uniform(-0.3, 0.25), mat=0)
            # an inner ring of young leaves on top, and a figs or two
            for i in range(5):
                ang = 2 * math.pi * (i + 0.5) / 5 + R.uniform(-0.3, 0.3)
                d = Vector((math.sin(ang), math.cos(ang), 0))
                fig_leaf(bm, uvl, rl, c + d * 0.03 + Vector((0, 0, 0.05)), -ang, R, R.uniform(0.08, 0.11), tilt=R.uniform(0.1, 0.4), mat=0)
            for i in range(R.randint(1, 3)):
                bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.018, matrix=Matrix.Translation(c + Vector((R.uniform(-0.05, 0.05), R.uniform(-0.05, 0.05), 0.07))))
        else:
            base = Vector((W / 2 + R.uniform(-0.03, 0.03), 0.01, 0.0))
            top = Vector((W / 2 + R.uniform(-0.06, 0.06), H * 0.55, 0.0))
            pts = [base.lerp(top, t) + Vector((0.02 * math.sin(t * 5), 0, 0)) for t in [k / 10 for k in range(11)]]
            tube(bm, uvl, rl, pts, [0.011 - 0.005 * k / 10 for k in range(11)], sides=6, mat=1)
            for i in range(7):
                t = 0.3 + 0.7 * (i + R.uniform(-0.2, 0.2)) / 7
                at = base.lerp(top, min(1.0, t)) + Vector((0, 0, 0.01 * i))
                side = 1 if i % 2 else -1
                ang = side * R.uniform(0.2, 0.6) + R.uniform(-0.15, 0.15)
                if i == 6:
                    ang = R.uniform(-0.2, 0.2)
                dirv = Vector((math.sin(ang), math.cos(ang), 0))
                pend = at + dirv * R.uniform(0.04, 0.08)
                tube(bm, uvl, rl, [at, pend], [0.004, 0.003], sides=4, mat=1)
                fig_leaf(bm, uvl, rl, pend, -ang, R, R.uniform(0.11, 0.16), tilt=R.uniform(-0.35, 0.3), mat=0)
        o = obj('fig', bm, [m_leaf, m_twig, m_fruit])
        # icospheres came in with material 0 and no 'rand': they are figs
        for p in o.data.polygons:
            if p.material_index == 0 and o.data.attributes['rand'].data[p.index].value == 0.0:
                p.material_index = 2
        return [o]

    def grass(seed, dry=False):
        R = K.rng(seed)
        if dry:
            m_bl = leafmat('gblade', (0.66, 0.59, 0.43), (0.55, 0.50, 0.40), tip=(0.46, 0.42, 0.36), tip_amt=0.5, tip_start=0.6,
                           rib=0.06, rough=0.82, speck=0.12)
        else:
            m_bl = leafmat('gblade', (0.42, 0.47, 0.26), (0.64, 0.57, 0.40), tip=(0.66, 0.59, 0.42), tip_amt=0.8, tip_start=0.55,
                           rib=0.08, rough=0.75, speck=0.1)
        m_seed = leafmat('gseed', (0.60, 0.53, 0.40), (0.50, 0.45, 0.36), rib=0.0, rough=0.85, kind='plain', speck=0.15)
        bm, uvl, rl = new_bm()
        W, H = REGIONS['grassA'][1]
        cx = W / 2
        nb = 64 if not dry else 54
        for i in range(nb):
            a = R.gauss(0, 0.42)
            L = R.uniform(0.12, 0.44) * (1 - 0.35 * abs(a))
            base = Vector((cx + R.uniform(-0.05, 0.05), 0.004, R.uniform(-0.01, 0.01)))
            d = Vector((math.sin(a), math.cos(a), 0))
            cdir = Vector((1 if a > 0 else -1, -0.2, 0))
            bend = abs(a) * R.uniform(0.6, 1.6) + (R.uniform(0.6, 1.4) if R.random() < 0.2 else 0)
            blade(bm, uvl, rl, base, d, L, R.uniform(0.003, 0.006), curve=bend, curve_dir=cdir, twist=R.uniform(-1.2, 1.2),
                  fold=0.35, rand=R.random(), mat=0, segs=8, wshape='linear')
        # seed heads on thin stalks
        for i in range(5 if not dry else 8):
            a = R.gauss(0, 0.3)
            L = R.uniform(0.3, 0.46)
            base = Vector((cx + R.uniform(-0.03, 0.03), 0.004, 0.012))
            tipv = base + Vector((math.sin(a), math.cos(a), 0)) * L
            mid = base.lerp(tipv, 0.5) + Vector((0.02 * a, 0, 0))
            tube(bm, uvl, rl, [base, mid, tipv], [0.0012, 0.001, 0.0007], sides=3, rand=R.random(), mat=0)
            for q in range(14):
                tq = 0.72 + 0.28 * q / 13
                sp = base.lerp(tipv, tq)
                sa = a + (0.35 if q % 2 else -0.35) * R.uniform(0.5, 1.0)
                blade(bm, uvl, rl, sp, (math.sin(sa), math.cos(sa), 0), R.uniform(0.012, 0.02), 0.004, fold=0.7,
                      rand=R.random(), mat=1, segs=2, wshape='lance')
        return [obj('grass', bm, [m_bl, m_seed])]

    def thistle(seed):
        R = K.rng(seed)
        m_leaf = leafmat('tleaf', (0.45, 0.45, 0.34), (0.50, 0.47, 0.36), tip=(0.42, 0.36, 0.28), tip_amt=0.6, tip_start=0.5,
                         rib=0.25, rough=0.8, speck=0.12)
        m_stem = leafmat('tstem', (0.55, 0.51, 0.40), (0.48, 0.45, 0.36), rib=0.0, rough=0.75, kind='plain')
        m_head = leafmat('thead', (0.50, 0.44, 0.34), (0.42, 0.34, 0.32), rib=0.0, rough=0.85, kind='plain', speck=0.2)
        bm, uvl, rl = new_bm()
        W, H = REGIONS['weedA'][1]
        base = Vector((W / 2, 0.01, 0))
        heads = []
        for s in range(3):
            a = (s - 1) * 0.35 + R.uniform(-0.1, 0.1)
            L = R.uniform(0.38, 0.52)
            pts = [base + Vector((math.sin(a) * L * t + 0.02 * math.sin(t * 4), math.cos(a) * L * t, 0)) for t in [k / 8 for k in range(9)]]
            tube(bm, uvl, rl, pts, [0.006 - 0.003 * k / 8 for k in range(9)], sides=5, mat=1)
            heads.append(pts[-1])
            # spiny lobed leaves up the stem
            for k in range(2, 7, 2):
                p = pts[k]
                for sg in (-1, 1):
                    la = a + sg * R.uniform(0.6, 1.1)
                    d = Vector((math.sin(la), math.cos(la), 0))
                    Lf = R.uniform(0.09, 0.16) * (1 - k / 10)
                    blade(bm, uvl, rl, p, d, Lf, R.uniform(0.03, 0.045), curve=sg * 0.3, twist=R.uniform(-0.5, 0.5), fold=0.5,
                          rand=R.random(), mat=0, segs=6)
                    # spines on the lobes
                    for q in range(4):
                        sp = p + d * Lf * (0.3 + 0.2 * q)
                        sa = la + sg * 1.2
                        blade(bm, uvl, rl, sp, (math.sin(sa), math.cos(sa), 0), 0.02, 0.003, fold=0.0, rand=R.random(), mat=1,
                              segs=2, wshape='tri')
        for h in heads:
            # a spiny dry head: bracts radiating from a ball, a tuft of pale pappus on top
            for q in range(26):
                a = 2 * math.pi * q / 26
                d = Vector((math.cos(a), math.sin(a), 0))
                blade(bm, uvl, rl, h + Vector((0, 0, 0.01)), d, R.uniform(0.022, 0.034), 0.004, fold=0.4, rand=R.random(), mat=2, segs=2, wshape='tri')
            for q in range(18):
                a = math.radians(R.uniform(-60, 60))
                blade(bm, uvl, rl, h + Vector((0, 0.01, 0.015)), (math.sin(a), math.cos(a), 0), R.uniform(0.02, 0.04), 0.002,
                      fold=0.0, rand=0.95, mat=1, segs=2, wshape='linear')
        return [obj('thistle', bm, [m_leaf, m_stem, m_head])]

    def stalks(seed):
        R = K.rng(seed)
        m_stem = leafmat('sstem', (0.58, 0.52, 0.40), (0.48, 0.43, 0.34), rib=0.0, rough=0.8, kind='plain', speck=0.12)
        m_seed = leafmat('sseed', (0.45, 0.38, 0.30), (0.54, 0.47, 0.36), rib=0.0, rough=0.85, kind='plain', speck=0.2)
        bm, uvl, rl = new_bm()
        W, H = REGIONS['weedB'][1]
        base = Vector((W / 2, 0.01, 0))
        for s in range(5):
            a = R.gauss(0, 0.28)
            L = R.uniform(0.35, 0.56)
            tipv = base + Vector((math.sin(a) * L, math.cos(a) * L, 0))
            pts = [base.lerp(tipv, t) + Vector((0.015 * math.sin(t * 5 + s), 0, 0)) for t in [k / 8 for k in range(9)]]
            tube(bm, uvl, rl, pts, [0.0065 - 0.003 * k / 8 for k in range(9)], sides=4, rand=R.random(), mat=0)
            # umbels: rays from the tip with seed clusters
            for k, p in ((8, pts[8]), (5, pts[5])):
                nr = R.randint(6, 11) if k == 8 else R.randint(3, 6)
                for q in range(nr):
                    ra = a + math.radians(R.uniform(-55, 55))
                    rl_ = R.uniform(0.03, 0.06) * (1 if k == 8 else 0.7)
                    e = p + Vector((math.sin(ra) * rl_, math.cos(ra) * rl_, 0.004))
                    tube(bm, uvl, rl, [p, e], [0.0012, 0.0008], sides=3, rand=R.random(), mat=0)
                    for z in range(6):
                        sa = ra + math.radians(R.uniform(-60, 60))
                        blade(bm, uvl, rl, e, (math.sin(sa), math.cos(sa), 0), R.uniform(0.006, 0.012), 0.004, fold=0.6,
                              rand=R.random(), mat=1, segs=2, wshape='lance')
        return [obj('stalks', bm, [m_stem, m_seed])]

    BUILD = {
        'palmA': lambda: palm_half(1), 'palmB': lambda: palm_half(2), 'palmDead': lambda: palm_half(3, dead=True),
        'reedA': lambda: reeds(4), 'reedB': lambda: reeds(5, dry=True),
        'figA': lambda: fig(6), 'figB': lambda: fig(7, narrow=True),
        'weedA': lambda: thistle(8), 'weedB': lambda: stalks(9),
        'grassA': lambda: grass(10), 'grassB': lambda: grass(11, dry=True),
    }

    A = K.args()
    only = set(A['only'].split(',')) if 'only' in A else None
    os.makedirs(RAW, exist_ok=True)
    for name, ((x, y, w, h), (Wm, Hm)) in REGIONS.items():
        if only and name not in only:
            continue
        K.reset()
        MATS.clear()
        sc = bpy.context.scene
        sc.render.engine = 'CYCLES'
        sc.cycles.device = 'GPU'
        K._gpu()
        sc.cycles.samples = 64
        sc.cycles.use_denoising = False
        sc.cycles.max_bounces = 0
        sc.render.film_transparent = True
        sc.render.resolution_x, sc.render.resolution_y = w, h
        sc.render.image_settings.file_format = 'PNG'
        sc.render.image_settings.color_mode = 'RGBA'
        sc.render.image_settings.color_depth = '8'
        sc.render.filter_size = 1.0
        w_ = bpy.data.worlds.new('W')
        sc.world = w_
        w_.use_nodes = True
        w_.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
        BUILD[name]()
        cd = bpy.data.cameras.new('cam')
        cd.type = 'ORTHO'
        cd.ortho_scale = max(Wm, Hm)
        co = bpy.data.objects.new('cam', cd)
        sc.collection.objects.link(co)
        co.location = (Wm / 2, Hm / 2, 5.0)
        sc.camera = co
        for p, vt in (('bc', 'Standard'), ('n', 'Raw'), ('ao', 'Raw'), ('r', 'Raw')):
            set_pass(p)
            sc.view_settings.view_transform = vt
            sc.view_settings.look = 'None'
            sc.cycles.samples = 32 if p != 'ao' else 64
            sc.render.filepath = os.path.join(RAW, f'{name}_{p}.png')
            bpy.ops.render.render(write_still=True)
        print('region', name, 'done', flush=True)


# ====================================================================================================== venv side

def _post():
    import numpy as np
    from PIL import Image
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tools'))
    from texgen import (save, save_set, dilate_alpha, pnoise, blur_wrap, smoothstep, height_to_normal, cavity_ao,
                        fibres, sample_wrap)

    def rd(name, p):
        a = np.asarray(Image.open(os.path.join(RAW, f'{name}_{p}.png')).convert('RGBA')).astype(np.float32) / 255
        return a

    N = ATLAS
    bc = np.zeros((N, N, 3), np.float32)
    al = np.zeros((N, N), np.float32)
    nm = np.zeros((N, N, 3), np.float32)
    nm[..., 2] = 1.0
    ao = np.ones((N, N), np.float32)
    rg = np.full((N, N), 0.6, np.float32)
    for name, ((x, y, w, h), _) in REGIONS.items():
        c = rd(name, 'bc')
        a = c[..., 3]
        # Blender writes straight (unassociated) alpha
        bc[y:y + h, x:x + w] = c[..., :3]
        al[y:y + h, x:x + w] = a
        n = rd(name, 'n')[..., :3] * 2 - 1
        n /= np.linalg.norm(n, axis=-1, keepdims=True).clip(1e-6)
        n[..., 2] = np.maximum(n[..., 2], 0.08)
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        nm[y:y + h, x:x + w] = n * a[..., None] + np.array([0, 0, 1.0]) * (1 - a[..., None])
        ao[y:y + h, x:x + w] = rd(name, 'ao')[..., 0] * a + (1 - a)
        rg[y:y + h, x:x + w] = rd(name, 'r')[..., 0] * a + 0.6 * (1 - a)
    # sharpen coverage a little (the cut-out uses 0.45) and bleed colour and normals under the transparent texels
    bc = dilate_alpha(bc, al, iters=24)
    nmd = dilate_alpha(nm * 0.5 + 0.5, al, iters=24) * 2 - 1
    nmd /= np.linalg.norm(nmd, axis=-1, keepdims=True).clip(1e-6)
    # beyond the bleed, fill with each region's mean colour so low mips do not go dark
    for name, ((x, y, w, h), _) in REGIONS.items():
        reg = (slice(y, y + h), slice(x, x + w))
        a = al[reg] > 0.5
        if a.any():
            mean = bc[reg][a].mean(0)
            empty = bc[reg].sum(-1) <= 1e-4
            bc[reg][empty] = mean
    ao = np.clip(ao, 0, 1) ** 1.2
    d = os.path.join(ROOT, 'build', 'kit', 'textures', 'veg_foliage')
    os.makedirs(d, exist_ok=True)
    save(os.path.join(d, 'veg_foliage_bca.png'), np.concatenate([np.clip(bc, 0, 1), al[..., None]], -1))
    save(os.path.join(d, 'veg_foliage_bc.png'), np.clip(bc, 0, 1))
    save(os.path.join(d, 'veg_foliage_n.png'), nmd * 0.5 + 0.5)
    save(os.path.join(d, 'veg_foliage_orm.png'), np.stack([ao, np.clip(rg, 0, 1), np.zeros_like(ao)], -1))
    print('wrote veg_foliage')
    palm_trunk()
    fig_bark()


def palm_trunk(N=2048, seed=71):
    """Date-palm trunk, tileable: 1.4 m around (the whole circumference) x 1.4 m up. Persistent leaf bases (the cut
    petiole stubs, 'kernaf'): rhombic shields in a crossing spiral lattice, each protruding most at its slanted cut
    top (a dark, fibrous cut face), the lower part tucked behind the stubs below; dark fibre sheath in the gaps."""
    import numpy as np
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tools'))
    from texgen import save_set, pnoise, height_to_normal, cavity_ao, fibres, smoothstep, blur_wrap
    S = 1.4
    px = S / N
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    xm, ym = xx * px, (N - yy) * px            # metres, y up
    around, rows = 10, 16
    cw, rh = S / around, S / rows
    rng = np.random.default_rng(seed)
    P = rng.random((rows, around, 10)).astype(np.float32)
    h = np.full((N, N), -1.0, np.float32)
    owner = np.zeros((N, N), np.int32)
    cut = np.zeros((N, N), np.float32)
    tmap = np.zeros((N, N), np.float32)
    for r in range(rows):
        for c in range(around):
            pp = P[r, c]
            shift = (r % 2) * 0.5 + r * (1.0 / rows)
            cx = (c + shift) * cw + (pp[0] - 0.5) * cw * 0.2
            top = (r + 1) * rh + (pp[1] - 0.5) * rh * 0.25
            L = rh * (2.1 + 0.4 * pp[2])
            wmax = cw * (0.5 + 0.08 * pp[3])
            slant = (pp[6] - 0.5) * 0.7
            dx = (xm - cx + S / 2) % S - S / 2
            dy = (top + slant * dx - ym + S / 2) % S - S / 2
            inside = (dy > -0.004) & (dy < L)
            t = np.clip(1 - dy / L, 0, 1)
            half = wmax * (0.12 + 0.88 * np.sin(np.pi / 2 * np.clip(t / 0.72, 0, 1)) ** 0.8) * (1 - 0.18 * smoothstep(0.86, 1.0, t))
            q = np.abs(dx) / np.maximum(half, 1e-4)
            m = inside & (q < 1)
            broken = pp[7] < 0.12
            protr = (0.05 + 0.035 * pp[4]) * (0.45 if broken else 1.0)
            prof = protr * t ** 1.4 * np.clip(1 - q ** 2, 0, 1) ** 0.35
            hv = np.where(m, prof, -1.0)
            better = hv > h
            h = np.where(better, hv, h)
            owner = np.where(better, r * around + c, owner)
            cut = np.where(better, smoothstep(0.9, 0.99, t), cut)
            tmap = np.where(better, t, tmap)
    stub = h > -0.5
    fm1, _ = fibres(N, 12000, 0.07 / px, 1.6, seed + 1, angle=1.0, angle_jitter=0.3, curl=0.25)
    fm2, _ = fibres(N, 12000, 0.07 / px, 1.6, seed + 2, angle=2.15, angle_jitter=0.3, curl=0.25)
    fib = np.maximum(fm1, fm2)
    base_h = -0.012 + 0.005 * fib + 0.003 * (pnoise(N, 32, seed + 3, octaves=3) - 0.5)
    h = np.where(stub, h, base_h)
    grain, _ = fibres(N, 16000, 0.06 / px, 1.2, seed + 4, angle=-np.pi / 2, angle_jitter=0.1, curl=0.05)
    rough_n = pnoise(N, 64, seed + 5, octaves=3)
    h += stub * (grain * 0.0014 + (rough_n - 0.5) * 0.003 * (0.4 + cut))
    h = blur_wrap(h, 0.7)
    n = height_to_normal(h, px)
    ao = cavity_ao(h, px, radii_m=(0.004, 0.012, 0.03, 0.06), depth_m=0.02, power=1.2)
    var = P[owner // around, owner % around, 5][..., None]
    var2 = P[owner // around, owner % around, 8][..., None]
    grey = np.array([0.53, 0.49, 0.43])
    tan = np.array([0.50, 0.41, 0.31])
    col = grey * (1 - var2 * 0.6) + tan * var2 * 0.6
    col = col * (0.82 + 0.3 * var)
    # the lower part of a stub (in shadow of the one below) is browner; the cut face dark and fibrous
    col = col * (0.85 + 0.15 * tmap[..., None])
    col = col * (1 - cut[..., None] * 0.45) + np.array([0.24, 0.18, 0.13]) * cut[..., None] * 0.45
    col = col * (1 - 0.15 * grain[..., None])
    col = np.where(stub[..., None], col, np.array([0.30, 0.23, 0.16]) * (0.7 + 0.45 * fib[..., None]))
    col *= (0.9 + 0.2 * pnoise(N, 6, seed + 6, octaves=3))[..., None]
    col *= (0.6 + 0.4 * ao)[..., None]
    rough = np.where(stub, 0.82 + 0.1 * cut, 0.95).astype(np.float32)
    save_set('veg_palmtrunk', np.clip(col, 0, 1), n, ao, rough)


def fig_bark(N=1024, seed=81):
    """Smooth grey fig bark, tileable, 1.0 m: mottled, faint horizontal lenticels and wrinkles."""
    import numpy as np
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tools'))
    from texgen import save_set, pnoise, height_to_normal, cavity_ao, fibres
    px = 1.0 / N
    m1 = pnoise(N, 4, seed, octaves=4)
    m2 = pnoise(N, 16, seed + 1, octaves=3)
    len_m, _ = fibres(N, 1800, 0.008 / px, 2.2, seed + 2, angle=0.0, angle_jitter=0.1, curl=0.05)
    wr, _ = fibres(N, 90, 0.12 / px, 3.0, seed + 3, angle=0.0, angle_jitter=0.35, curl=0.6)
    h = (m2 - 0.5) * 0.0015 + len_m * 0.0006 - wr * 0.0002
    n = height_to_normal(h, px)
    ao = cavity_ao(h, px, radii_m=(0.002, 0.006), depth_m=0.0012)
    col = np.array([0.40, 0.39, 0.36]) * (0.88 + 0.22 * m1[..., None])
    col = col * (1 - 0.3 * len_m[..., None]) + np.array([0.66, 0.62, 0.52]) * 0.3 * len_m[..., None]
    col = col * (1 - 0.03 * wr[..., None])
    lich = (pnoise(N, 8, seed + 4, octaves=4) > 0.78)[..., None] * 0.25
    col = col * (1 - lich) + np.array([0.66, 0.66, 0.56]) * lich
    col *= (0.8 + 0.2 * ao)[..., None]
    save_set('veg_bark', np.clip(col, 0, 1), n, ao, np.full((N, N), 0.72, np.float32))


if __name__ == '__main__':
    try:
        import bpy  # noqa: F401
        _blender_main()
    except ImportError:
        if 'post' in sys.argv:
            _post()
        elif 'trunk' in sys.argv:
            palm_trunk()
            fig_bark()
        else:
            print(__doc__)
