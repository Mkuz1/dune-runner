# p6_render.py — portfolio-grade Cycles render of the 6x6 pickup.
#
# Run in Blender AFTER p6_build.py (Scripting tab -> open -> Run Script).
# Everything here is non-destructive: modifiers stay live and the game
# model (models/pickup6x6.glb) is untouched — that is built separately.
#
# Optional: set HDRI to a 32-bit .exr/.hdr path for image-based lighting.
# Left empty, a physically based procedural sky + matched sun is used.

import bpy, math, os
from mathutils import Vector, Matrix

HDRI = ""                      # e.g. "/Users/you/hdri/desert_overcast_4k.exr"
OUT = os.path.join(os.path.dirname(bpy.data.filepath) or os.path.expanduser("~"), "pickup6x6_cycles.png")
SUN_ELEV, SUN_AZ = 22.0, 145.0  # degrees — harsh low-angle sun

sc = bpy.data.scenes.get("Pickup6x6") or bpy.context.scene
bpy.context.window.scene = sc
coll = bpy.data.collections["Pickup6x6"]
G2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def sock(node, *names):
    """First matching input socket — names moved between Blender versions."""
    for n in names:
        if n in node.inputs: return node.inputs[n]
    return None


def principled(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    return nt, nt.nodes.get("Principled BSDF")


# ---------------- 1. micro-bevels + weighted normals ----------------
for name in ("p6_body", "p6_detail"):
    ob = bpy.data.objects[name]
    if "micro_bevel" not in ob.modifiers:
        b = ob.modifiers.new("micro_bevel", 'BEVEL')
        b.width, b.segments = 0.0025, 2                  # 2.5 mm, two segments
        b.limit_method, b.angle_limit = 'ANGLE', math.radians(30)
        b.harden_normals = True
    if "weighted_normal" not in ob.modifiers:
        w = ob.modifiers.new("weighted_normal", 'WEIGHTED_NORMAL')
        w.keep_sharp = True
        w.weight = 50

# ---------------- 2. multi-layer paint with orange peel ----------------
nt, bsdf = principled(bpy.data.materials["p6_paint"])
bsdf.inputs["Base Color"].default_value = (0.807, 0.838, 0.854, 1)   # #E8ECEE (linear)
bsdf.inputs["Metallic"].default_value = 0.05
bsdf.inputs["Roughness"].default_value = 0.28
sock(bsdf, "Coat Weight", "Clearcoat").default_value = 1.0
sock(bsdf, "Coat Roughness", "Clearcoat Roughness").default_value = 0.04
peel = nt.nodes.new("ShaderNodeTexNoise"); peel.inputs["Scale"].default_value = 650.0
peel.inputs["Detail"].default_value = 10.0
bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.02
nt.links.new(peel.outputs["Fac"], bump.inputs["Height"])
cn = sock(bsdf, "Coat Normal", "Clearcoat Normal")
if cn: nt.links.new(bump.outputs["Normal"], cn)

# ---------------- 3a. pebbled ABS trim ----------------
nt, bsdf = principled(bpy.data.materials["p6_trim"])
bsdf.inputs["Base Color"].default_value = (0.0103, 0.0116, 0.0129, 1)  # #1A1C1E
bsdf.inputs["Roughness"].default_value = 0.70
vor = nt.nodes.new("ShaderNodeTexVoronoi"); vor.inputs["Scale"].default_value = 420.0
fine = nt.nodes.new("ShaderNodeTexNoise"); fine.inputs["Scale"].default_value = 1800.0
mix = nt.nodes.new("ShaderNodeMath"); mix.operation = 'ADD'
nt.links.new(vor.outputs["Distance"], mix.inputs[0]); nt.links.new(fine.outputs["Fac"], mix.inputs[1])
bump = nt.nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.12; bump.inputs["Distance"].default_value = 0.002
nt.links.new(mix.outputs[0], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

# ---------------- 3b. crinkle-coat steel with edge wear ----------------
nt, bsdf = principled(bpy.data.materials["p6_metal"])
bsdf.inputs["Base Color"].default_value = (0.0056, 0.0060, 0.0065, 1)  # #111213
geo = nt.nodes.new("ShaderNodeNewGeometry")
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.52; ramp.color_ramp.elements[1].position = 0.60
nt.links.new(geo.outputs["Pointiness"], ramp.inputs["Fac"])        # exposed corners only
rough = nt.nodes.new("ShaderNodeMapRange")
rough.inputs["To Min"].default_value, rough.inputs["To Max"].default_value = 0.55, 0.30
metal = nt.nodes.new("ShaderNodeMapRange")
metal.inputs["To Min"].default_value, metal.inputs["To Max"].default_value = 0.20, 0.85
for m, tgt in ((rough, "Roughness"), (metal, "Metallic")):
    nt.links.new(ramp.outputs["Color"], m.inputs["Value"]); nt.links.new(m.outputs["Result"], bsdf.inputs[tgt])
crink = nt.nodes.new("ShaderNodeTexNoise"); crink.inputs["Scale"].default_value = 900.0
cb = nt.nodes.new("ShaderNodeBump"); cb.inputs["Strength"].default_value = 0.08
nt.links.new(crink.outputs["Fac"], cb.inputs["Height"]); nt.links.new(cb.outputs["Normal"], bsdf.inputs["Normal"])

# ---------------- 4. aged rubber with dust in the tread valleys ----------------
nt, bsdf = principled(bpy.data.materials["p6_rubber"])
ao = nt.nodes.new("ShaderNodeAmbientOcclusion"); ao.inputs["Distance"].default_value = 0.04
inv = nt.nodes.new("ShaderNodeMath"); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
nt.links.new(ao.outputs["AO"], inv.inputs[1])
zpos = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(geo_r := nt.nodes.new("ShaderNodeNewGeometry").outputs["Position"], zpos.inputs[0])
low = nt.nodes.new("ShaderNodeMapRange")                         # dust settles low on the sidewall
low.inputs["From Min"].default_value, low.inputs["From Max"].default_value = 0.0, 0.6
low.inputs["To Min"].default_value, low.inputs["To Max"].default_value = 1.0, 0.0
nt.links.new(zpos.outputs["Z"], low.inputs["Value"])
dust = nt.nodes.new("ShaderNodeMath"); dust.operation = 'MULTIPLY'; dust.use_clamp = True
nt.links.new(inv.outputs[0], dust.inputs[0]); nt.links.new(low.outputs["Result"], dust.inputs[1])
mixc = nt.nodes.new("ShaderNodeMix"); mixc.data_type = 'RGBA'
mixc.inputs[6].default_value = (0.0175, 0.0185, 0.0194, 1)       # #242526
mixc.inputs[7].default_value = (0.262, 0.209, 0.147, 1)          # #8C7D6B dust
nt.links.new(dust.outputs[0], mixc.inputs[0]); nt.links.new(mixc.outputs[2], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.84
s = sock(bsdf, "Specular IOR Level", "Specular")
if s: s.default_value = 0.35

# ---------------- 5a. glazing + lamps ----------------
nt, bsdf = principled(bpy.data.materials["p6_glass"])
sock(bsdf, "Transmission Weight", "Transmission").default_value = 1.0
bsdf.inputs["Roughness"].default_value = 0.02; bsdf.inputs["IOR"].default_value = 1.52
bsdf.inputs["Alpha"].default_value = 1.0
for k in ("p6_chrome", "p6_silver"):
    nt, bsdf = principled(bpy.data.materials[k])
    bsdf.inputs["Metallic"].default_value = 1.0; bsdf.inputs["Roughness"].default_value = 0.05

# ---------------- 5b. wheels at the hubs, ground, light ----------------
pv = bpy.data.collections.get("p6_render") or bpy.data.collections.new("p6_render")
if pv.name not in sc.collection.children: sc.collection.children.link(pv)
for o in list(pv.objects): bpy.data.objects.remove(o, do_unlink=True)
wheel = bpy.data.objects["p6_wheel"]; wheel.hide_render = True
for z in (1.80, -1.20, -2.35):
    for s_ in (1, -1):
        o = bpy.data.objects.new(f"p6_r_{z}_{s_}", wheel.data); pv.objects.link(o)
        o.location = (s_ * 0.88, -z, 0.47); o.rotation_euler = (0, 0, 0 if s_ > 0 else math.pi)
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
ground = bpy.context.active_object; ground.name = "p6_r_ground"
for c in ground.users_collection: c.objects.unlink(ground)
pv.objects.link(ground)
gm = bpy.data.materials.get("p6_r_ground") or bpy.data.materials.new("p6_r_ground")
gm.use_nodes = True; gb = gm.node_tree.nodes["Principled BSDF"]
gb.inputs["Base Color"].default_value = (0.32, 0.25, 0.17, 1); gb.inputs["Roughness"].default_value = 0.95
ground.data.materials.append(gm)

world = sc.world or bpy.data.worlds.new("p6_world"); sc.world = world
world.use_nodes = True; wn = world.node_tree; bg = wn.nodes["Background"]
for n in [n for n in wn.nodes if n.type in ('TEX_SKY', 'TEX_ENVIRONMENT')]: wn.nodes.remove(n)
sun_dir = Vector((math.cos(math.radians(SUN_ELEV)) * math.sin(math.radians(SUN_AZ)),
                  math.cos(math.radians(SUN_ELEV)) * math.cos(math.radians(SUN_AZ)),
                  math.sin(math.radians(SUN_ELEV))))
if HDRI and os.path.exists(HDRI):
    env = wn.nodes.new("ShaderNodeTexEnvironment"); env.image = bpy.data.images.load(HDRI)
    wn.links.new(env.outputs["Color"], bg.inputs["Color"]); bg.inputs["Strength"].default_value = 1.0
else:
    sky = wn.nodes.new("ShaderNodeTexSky")
    for t in ("MULTIPLE_SCATTERING", "NISHITA", "HOSEK_WILKIE"):
        try: sky.sky_type = t; break
        except TypeError: pass
    try:
        sky.sun_elevation = math.radians(SUN_ELEV); sky.sun_rotation = math.radians(SUN_AZ)
    except AttributeError: pass
    wn.links.new(sky.outputs["Color"], bg.inputs["Color"]); bg.inputs["Strength"].default_value = 0.35
sun = bpy.data.objects.get("p6_r_sun")
if sun is None:
    sun = bpy.data.objects.new("p6_r_sun", bpy.data.lights.new("p6_r_sun", 'SUN')); pv.objects.link(sun)
sun.data.energy, sun.data.angle = 4.5, math.radians(0.55)
sun.rotation_euler = (-sun_dir).to_track_quat('-Z', 'Y').to_euler()   # aligned with the sky's sun

cam = bpy.data.objects.get("p6_r_cam")
if cam is None:
    cam = bpy.data.objects.new("p6_r_cam", bpy.data.cameras.new("p6_r_cam")); pv.objects.link(cam)
cam.data.lens = 50
cam.location = (6.8, -8.2, 1.55)
cam.rotation_euler = (Vector((0, -0.3, 0.95)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.camera = cam

# ---------------- 5c. Cycles settings ----------------
sc.render.engine = 'CYCLES'
cy = sc.cycles
cy.samples = 512
cy.use_denoising = True
try:
    cy.denoiser = 'OPENIMAGEDENOISE'; cy.denoising_prefilter = 'ACCURATE'
except (AttributeError, TypeError): pass
try: cy.device = 'GPU'
except TypeError: pass
vs = sc.view_settings
try:
    vs.view_transform = 'AgX'
    for look in ("AgX - Medium High Contrast", "Medium High Contrast"):
        try: vs.look = look; break
        except TypeError: pass
except TypeError: pass
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 2560, 1440, 100
sc.render.filepath = OUT
print("p6_render: scene ready. Render with F12, or render.render(write_still=True) ->", OUT)
