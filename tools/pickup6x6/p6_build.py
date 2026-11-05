# p6_build.py — rebuild the pickup inside Blender and export it.
# In Blender: Scripting tab -> open this file -> Run Script.
import bpy, os, sys
BUILD_DIR = os.path.dirname(bpy.data.texts[0].filepath) if bpy.data.texts and bpy.data.texts[0].filepath else os.path.dirname(os.path.abspath(__file__))
if BUILD_DIR not in sys.path: sys.path.insert(0, BUILD_DIR)
import p6lib
sc, coll = p6lib.scene()
for o in list(coll.objects): bpy.data.objects.remove(o, do_unlink=True)
exec(open(os.path.join(BUILD_DIR, "p6_geom.py")).read(), {"__name__": "p6", "BUILD_DIR": BUILD_DIR})
