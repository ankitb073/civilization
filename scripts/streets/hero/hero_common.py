# Shared helpers for the hero's Blender scripts (scripts/streets/hero/*.py). Run by Blender 5.2 headless:
#   BLENDER_USER_RESOURCES=build/hero/blender-user Blender -b --python <script> -- --k=v ...
# (build.sh sets the sandboxed profile that holds MPFB; nothing is installed into the user's own Blender.)
import bpy
import json
import math
import os
import sys

from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
BUILD = os.path.join(REPO, 'build', 'hero')
WORK = os.path.join(BUILD, 'work')
SRC = os.path.join(BUILD, 'src')
HDRI = os.path.join(SRC, 'hdri', 'kiara_8_sunset_2k.hdr')


def args():
    """--k=v pairs after Blender's '--'."""
    out = {}
    if '--' in sys.argv:
        for a in sys.argv[sys.argv.index('--') + 1:]:
            if a.startswith('--'):
                k, _, v = a[2:].partition('=')
                out[k] = v if v else '1'
    return out


def mpfb():
    """MPFB's services (the extension lives in the sandboxed profile's user_default repository)."""
    import importlib
    base = 'bl_ext.user_default.mpfb.services.'
    mods = {}
    for n in ['humanservice', 'targetservice', 'rigservice', 'objectservice', 'materialservice', 'assetservice']:
        mods[n] = importlib.import_module(base + n)
    return mods


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # read_factory_settings resets preferences in memory: turn the extension back on for this session
    try:
        bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb')
    except Exception as e:  # noqa: BLE001
        print('mpfb enable:', e)


def setup_cycles(samples=96, res=(1280, 720), denoise=True, transparent=False):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:  # noqa: BLE001
        print('cycles GPU unavailable:', e)
    sc.cycles.samples = samples
    sc.cycles.use_denoising = denoise
    sc.cycles.max_bounces = 8
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.render.image_settings.file_format = 'PNG'


# The key light, in the character's frame (he faces -Y in Blender, +Z in glTF): the sun comes from azimuth KEY_AZ
# (0 = straight in front of him, +90 = his left, -90 = his right) at KEY_EL above the horizon, warm late-afternoon.
KEY_AZ, KEY_EL = -62.0, 20.0
KEY_COLOR = (1.0, 0.74, 0.50)


def key_dir(az=KEY_AZ, el=KEY_EL):
    """Unit vector toward the sun (Blender space)."""
    a, e = math.radians(az), math.radians(el)
    return Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))


def world_hdri(path=None, strength=1.0, az=KEY_AZ):
    """The sun-less sky (hdri.py), turned so its bright side (where its sun was) is where the key comes from."""
    path = path or os.path.join(WORK, 'env_2k.hdr')
    env = json.load(open(os.path.join(WORK, 'env.json')))['2k']
    s = Vector(env['sunDirBlender'])
    d = key_dir(az, 0)
    rot = math.atan2(s.y, s.x) - math.atan2(d.y, d.x)
    w = bpy.data.worlds.new('hdri') if not bpy.context.scene.world else bpy.context.scene.world
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Rotation'].default_value = (0, 0, rot)
    env_n = nt.nodes.new('ShaderNodeTexEnvironment')
    env_n.image = bpy.data.images.load(path, check_existing=True)
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], env_n.inputs['Vector'])
    nt.links.new(env_n.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    return w


def key_sun(strength=4.5, az=KEY_AZ, el=KEY_EL, color=KEY_COLOR, angle_deg=0.53, name='sun'):
    ld = bpy.data.lights.new(name, 'SUN')
    ld.energy = strength
    ld.color = color
    ld.angle = math.radians(angle_deg)
    lo = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(lo)
    lo.rotation_euler = (-key_dir(az, el)).to_track_quat('-Z', 'Y').to_euler()
    return lo


def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def camera(loc, target, lens=50.0, name='cam'):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_start = 0.01
    co = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(co)
    co.location = Vector(loc)
    look_at(co, target)
    bpy.context.scene.camera = co
    return co


def ground(size=40.0, color=(0.33, 0.27, 0.2), rough=0.9, name='ground'):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    g = bpy.context.active_object
    g.name = name
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    g.data.materials.append(m)
    return g


def render(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('rendered', path)


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(data, f, indent=1)
