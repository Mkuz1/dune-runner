"""Headless bake + export for the Dune Runner truck.

blender -b pickup6x6_textured.blend --python bake_car.py -- TEX_DIR OUT_DIR GLB_OUT

Builds bake materials (Draw Things photo textures + procedural wear), bakes
per part: base colour, roughness and tangent-space normal (AO was baked
earlier with the wheels in place), then exports the UV-mapped model as GLB
with plain named materials and no embedded images.
"""
import bpy, math, os, sys, time

argv = sys.argv[sys.argv.index('--') + 1:]
TEX, OUT, GLB = argv[0], argv[1], argv[2]
os.makedirs(OUT, exist_ok=True)

sc = bpy.data.scenes['Pickup6x6']
if bpy.context.window: bpy.context.window.scene = sc
sc.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices: d.use = True
    sc.cycles.device = 'GPU'
except Exception as e:
    print('GPU setup failed, using CPU:', e)
sc.render.bake.margin = 12

PARTS = {'p6_body': 2048, 'p6_cab': 2048, 'p6_detail': 2048, 'p6_wheel': 1024}

def img(name, cs='sRGB'):
    path = os.path.join(TEX, name + '.png')
    if not os.path.exists(path): path = os.path.join(TEX, name + '.jpg')   # committed copies
    i = bpy.data.images.load(path, check_existing=True)
    i.colorspace_settings.name = cs
    return i

T = {k: img(k) for k in ('tread', 'sidewall', 'mud', 'grille', 'plastic', 'chassis')}

# ---------------------------------------------------------------- node helpers
class NB:
    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.x = 0
        self.out = self.n('ShaderNodeOutputMaterial')
        self.bsdf = self.n('ShaderNodeBsdfPrincipled')
        self.link(self.bsdf.outputs['BSDF'], self.out.inputs['Surface'])
        tc = self.n('ShaderNodeTexCoord')
        self.obj, self.onrm = tc.outputs['Object'], tc.outputs['Normal']

    def n(self, kind, **props):
        node = self.nt.nodes.new(kind)
        node.location = (self.x, 0); self.x -= 200
        for k, v in props.items(): setattr(node, k, v)
        return node

    def link(self, a, b): self.nt.links.new(a, b)

    def val(self, v):
        n = self.n('ShaderNodeValue'); n.outputs[0].default_value = v; return n.outputs[0]

    def rgb(self, c):
        n = self.n('ShaderNodeRGB'); n.outputs[0].default_value = (*c, 1); return n.outputs[0]

    def math(self, op, a, b=None, clamp=False):
        n = self.n('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, x in enumerate((a, b)):
            if x is None: continue
            if isinstance(x, (int, float)): n.inputs[i].default_value = x
            else: self.link(x, n.inputs[i])
        return n.outputs[0]

    def smooth(self, x, e0, e1):
        n = self.n('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        self.link(x, n.inputs['Value'])
        n.inputs['From Min'].default_value, n.inputs['From Max'].default_value = e0, e1
        return n.outputs['Result']

    def mix(self, fac, a, b):
        n = self.n('ShaderNodeMix', data_type='RGBA', clamp_factor=True)
        ins = {s.identifier: s for s in n.inputs}
        for sock, x in ((ins['Factor_Float'], fac), (ins['A_Color'], a), (ins['B_Color'], b)):
            if isinstance(x, (int, float)): sock.default_value = x
            else: self.link(x, sock)
        return [s for s in n.outputs if s.identifier == 'Result_Color'][0]

    def sep(self, v):
        n = self.n('ShaderNodeSeparateXYZ'); self.link(v, n.inputs[0]); return n.outputs

    def lum(self, c):
        n = self.n('ShaderNodeRGBToBW'); self.link(c, n.inputs[0]); return n.outputs[0]

    def noise(self, scale, detail=6.0):
        n = self.n('ShaderNodeTexNoise'); self.link(self.obj, n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail
        return n.outputs['Fac']

    def box(self, image, scale, blend=0.3):
        m = self.n('ShaderNodeMapping'); self.link(self.obj, m.inputs['Vector'])
        m.inputs['Scale'].default_value = (scale, scale, scale)
        t = self.n('ShaderNodeTexImage', projection='BOX', projection_blend=blend)
        t.image = image; self.link(m.outputs['Vector'], t.inputs['Vector'])
        return t.outputs['Color']

    def flat(self, image, vec):
        t = self.n('ShaderNodeTexImage'); t.image = image; self.link(vec, t.inputs['Vector'])
        return t.outputs['Color']

    def combine(self, x, y):
        n = self.n('ShaderNodeCombineXYZ')
        for i, v in enumerate((x, y)):
            if isinstance(v, (int, float)): n.inputs[i].default_value = v
            else: self.link(v, n.inputs[i])
        return n.outputs[0]

    def ao(self, dist=0.12):
        n = self.n('ShaderNodeAmbientOcclusion', samples=16, only_local=False)
        n.inputs['Distance'].default_value = dist
        return n.outputs['AO']

    def finish(self, color, rough, metal=0.0, height=None, bump=0.4, bump_dist=0.01):
        self.link(color, self.bsdf.inputs['Base Color'])
        if isinstance(rough, (int, float)): self.bsdf.inputs['Roughness'].default_value = rough
        else: self.link(rough, self.bsdf.inputs['Roughness'])
        self.bsdf.inputs['Metallic'].default_value = metal
        if height is not None:
            b = self.n('ShaderNodeBump'); b.inputs['Strength'].default_value = bump
            b.inputs['Distance'].default_value = bump_dist
            self.link(height, b.inputs['Height']); self.link(b.outputs['Normal'], self.bsdf.inputs['Normal'])

DUST = (0.40, 0.31, 0.21)        # linear tan
MUD = (0.13, 0.085, 0.05)

def wear(nb, base, heavy=1.0, top=True):
    """dust thick near the ground with a ragged edge, a film on top faces,
    dust in crevices, and photo mud splatter low down"""
    # height above the ground: parts are modelled with the origin on the
    # ground, except the wheel, which sits at its axle; a per-material value
    # node ('zoff') lifts it to ride height while the wheel bakes
    zo = nb.n('ShaderNodeValue'); zo.name = 'zoff'; zo.outputs[0].default_value = 0.0
    z = nb.math('ADD', nb.sep(nb.obj)[2], zo.outputs[0])
    edge = nb.math('MULTIPLY', nb.math('SUBTRACT', nb.noise(3.0), 0.5), 0.35)
    low = nb.math('SUBTRACT', 1.0, nb.smooth(nb.math('ADD', z, edge), 0.42, 1.05))
    crev = nb.math('SUBTRACT', 1.0, nb.ao(0.10))
    film = nb.math('MULTIPLY', nb.smooth(nb.sep(nb.onrm)[2], 0.55, 0.95), 0.22) if top else nb.val(0.0)
    dust = nb.math('MINIMUM', nb.math('MULTIPLY', nb.math('MAXIMUM', nb.math('MAXIMUM', nb.math('MULTIPLY', low, 0.85), film), nb.math('MULTIPLY', crev, 0.7)), heavy), 1.0)
    c = nb.mix(dust, base, nb.rgb(DUST))
    mudtex = nb.box(T['mud'], 0.9)
    mudamt = nb.math('MULTIPLY', nb.math('SUBTRACT', 1.0, nb.lum(mudtex)), 1.6, clamp=True)
    mudmask = nb.math('MULTIPLY', mudamt, nb.math('MULTIPLY', low, heavy), clamp=True)
    c = nb.mix(mudmask, c, nb.rgb(MUD))
    roughmask = nb.math('MAXIMUM', dust, mudmask)
    return c, roughmask, mudmask

def paint(m):
    nb = NB(m)
    c, rm, mud = wear(nb, nb.rgb((0.807, 0.838, 0.854)))
    rough = nb.math('ADD', 0.28, nb.math('MULTIPLY', rm, 0.62))
    nb.finish(c, rough, 0.05, height=mud, bump=0.25, bump_dist=0.004)

def textured(m, image, scale, rough0, metal=0.0, tint=(1, 1, 1), bump=0.5, heavy=1.0):
    nb = NB(m)
    t = nb.box(T[image], scale)
    base = t
    if tint != (1, 1, 1):
        mul = nb.n('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY', clamp_factor=True)
        ins = {s.identifier: s for s in mul.inputs}
        ins['Factor_Float'].default_value = 1.0
        nb.link(t, ins['A_Color']); ins['B_Color'].default_value = (*tint, 1)
        base = [s for s in mul.outputs if s.identifier == 'Result_Color'][0]
    c, rm, _ = wear(nb, base, heavy=heavy, top=False)
    rough = nb.math('ADD', rough0, nb.math('MULTIPLY', rm, 0.9 - rough0))
    nb.finish(c, rough, metal, height=nb.lum(t), bump=bump, bump_dist=0.006)

def plain(m, col, rough0, metal=0.0, heavy=0.6):
    nb = NB(m)
    c, rm, _ = wear(nb, nb.rgb(col), heavy=heavy, top=False)
    rough = nb.math('ADD', rough0, nb.math('MULTIPLY', rm, 0.9 - rough0))
    nb.finish(c, rough, metal)

def rubber(m):
    """tread wrapped round the tyre, sidewall texture round its sides"""
    nb = NB(m)
    x, y, z = nb.sep(nb.obj)
    ang = nb.math('DIVIDE', nb.math('ARCTAN2', z, y), 2 * math.pi)
    rad = nb.math('POWER', nb.math('ADD', nb.math('MULTIPLY', y, y), nb.math('MULTIPLY', z, z)), 0.5)
    tread = nb.flat(T['tread'], nb.combine(nb.math('ADD', nb.math('DIVIDE', x, 0.34), 0.5), nb.math('MULTIPLY', ang, 8.0)))
    side = nb.flat(T['sidewall'], nb.combine(nb.math('MULTIPLY', ang, 6.0), nb.math('MULTIPLY', rad, 2.2)))
    nx = nb.math('ABSOLUTE', nb.sep(nb.onrm)[0])
    w = nb.smooth(nx, 0.45, 0.75)
    col = nb.mix(w, tread, side)
    h = nb.math('ADD', nb.math('MULTIPLY', nb.lum(tread), nb.math('SUBTRACT', 1.0, w)), nb.math('MULTIPLY', nb.math('MULTIPLY', nb.lum(side), 0.4), w))
    crev = nb.math('SUBTRACT', 1.0, nb.ao(0.05))
    col = nb.mix(nb.math('MULTIPLY', crev, 0.5), col, nb.rgb(DUST))
    nb.finish(col, nb.math('ADD', 0.8, nb.math('MULTIPLY', crev, 0.1)), 0.0, height=h, bump=0.9, bump_dist=0.02)

SPEC = {
    'paint': paint,
    'rubber': rubber,
    'trim': lambda m: textured(m, 'plastic', 1.4, 0.66),
    'grille': lambda m: textured(m, 'grille', 3.0, 0.55, 0.3, bump=0.8),
    'chassis': lambda m: textured(m, 'chassis', 1.2, 0.8, 0.1, heavy=1.3),
    'metal': lambda m: textured(m, 'chassis', 1.6, 0.55, 0.2, tint=(0.35, 0.35, 0.35)),
    'gunmetal': lambda m: plain(m, (0.065, 0.07, 0.075), 0.38, 0.85, heavy=0.18),
    'silver': lambda m: plain(m, (0.32, 0.35, 0.38), 0.42, 0.85, heavy=0.2),
    'chrome': lambda m: plain(m, (0.70, 0.73, 0.77), 0.10, 1.0, heavy=0.3),
    'gold': lambda m: plain(m, (0.58, 0.37, 0.08), 0.32, 1.0, heavy=0.2),
    'red': lambda m: plain(m, (0.36, 0.01, 0.006), 0.38, 0.35),
    'orange': lambda m: plain(m, (0.89, 0.15, 0.005), 0.55),
    'yellow': lambda m: plain(m, (0.80, 0.48, 0.006), 0.6),
    'interior': lambda m: plain(m, (0.035, 0.035, 0.04), 0.85),
}
for m in bpy.data.materials:
    key = m.name[3:] if m.name.startswith('p6_') else None
    if key in SPEC: SPEC[key](m)

# ---------------------------------------------------------------- bake
def target(ob, kind, size, cs):
    name = f'{ob.name}_{kind}'
    im = bpy.data.images.get(name)
    if im: bpy.data.images.remove(im)
    im = bpy.data.images.new(name, size, size, alpha=False, float_buffer=(kind == 'nrm'))
    im.colorspace_settings.name = cs
    for m in ob.data.materials:
        nt = m.node_tree
        n = nt.nodes.new('ShaderNodeTexImage'); n.name = 'bake_target'; n.image = im
        nt.nodes.active = n
    for o in bpy.context.view_layer.objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    return im

def drop_targets(ob):
    for m in ob.data.materials:
        for n in [n for n in m.node_tree.nodes if n.name == 'bake_target']: m.node_tree.nodes.remove(n)

def save(im, path):
    im.filepath_raw = path; im.file_format = 'PNG'; im.save()

spare_hidden = bpy.data.objects['p6_spare'].hide_render
for name, size in PARTS.items():
    ob = bpy.data.objects[name]
    t0 = time.time()
    for m in bpy.data.materials:
        if m.node_tree and 'zoff' in m.node_tree.nodes:
            m.node_tree.nodes['zoff'].outputs[0].default_value = 1.0 if name == 'p6_wheel' else 0.0
    sc.cycles.samples = 24
    # the colour pass is diffuse albedo, which is zero on metals: bake them
    # as dielectrics so chrome and gunmetal keep their colour
    metal_was = {}
    for m in ob.data.materials:
        b = m.node_tree.nodes.get('Principled BSDF')
        if b: metal_was[m.name] = b.inputs['Metallic'].default_value; b.inputs['Metallic'].default_value = 0.0
    im = target(ob, 'col', size, 'sRGB')
    sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False; sc.render.bake.use_pass_color = True
    bpy.ops.object.bake(type='DIFFUSE', use_clear=True)
    save(im, f'{OUT}/{name}_col.png'); drop_targets(ob)
    for m in ob.data.materials:
        b = m.node_tree.nodes.get('Principled BSDF')
        if b and m.name in metal_was: b.inputs['Metallic'].default_value = metal_was[m.name]

    sc.cycles.samples = 4
    im = target(ob, 'rough', size, 'Non-Color')
    bpy.ops.object.bake(type='ROUGHNESS', use_clear=True)
    save(im, f'{OUT}/{name}_rough.png'); drop_targets(ob)

    im = target(ob, 'nrm', size, 'Non-Color')
    sc.render.bake.normal_space = 'TANGENT'
    bpy.ops.object.bake(type='NORMAL', use_clear=True)
    save(im, f'{OUT}/{name}_nrm.png'); drop_targets(ob)
    print(f'BAKED {name} in {time.time() - t0:.0f}s', flush=True)

# ---------------------------------------------------------------- export
# plain named materials, no images: the game attaches the baked textures
for m in bpy.data.materials:
    if m.name.startswith('p6_'):
        key = m.name[3:]
        m.use_nodes = True
        nt = m.node_tree; nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial'); b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        nt.links.new(b.outputs['BSDF'], out.inputs['Surface'])
        m.name = key
KEEP = ('p6_body', 'p6_cab', 'p6_wheel', 'p6_detail', 'p6_spare')
for o in list(bpy.data.objects):          # the starter scene's cube, camera, light
    if o.name not in KEEP: bpy.data.objects.remove(o, do_unlink=True)
for o in bpy.context.view_layer.objects: o.select_set(False)
for n in KEEP:
    bpy.data.objects[n].select_set(True)
bpy.ops.export_scene.gltf(
    filepath=GLB, export_format='GLB', use_selection=True,
    export_texcoords=True, export_normals=True, export_tangents=True,
    export_materials='EXPORT', export_image_format='NONE', export_vertex_color='NONE',
    export_yup=True, export_apply=False, export_animations=False, export_cameras=False, export_lights=False)
print('EXPORTED', GLB, os.path.getsize(GLB), flush=True)
