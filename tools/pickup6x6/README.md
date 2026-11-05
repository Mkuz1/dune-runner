# 6x6 pickup — vehicle source

The game's truck (`app/src/main/assets/game/models/pickup6x6.glb`) is generated
from these scripts. The geometry lives in one file, `p6_geom.py`, written in
game coordinates (+Y up, +Z forward), and builds two ways:

**Without Blender (what produced the shipped GLB)**

    python3 -I headless/gen_glb.py ../../app/src/main/assets/game/models/pickup6x6.glb

Needs only Python 3 and numpy. `headless/mathutils.py` is a small stand-in for
Blender's maths module, and `headless/p6lib.py` writes the glTF directly.

**In Blender (for editing and portfolio renders)**

1. Scripting tab → open `p6_build.py` → Run Script. Builds the truck into its
   own scene ("Pickup6x6"); nothing else in the open file is touched.
2. Open `p6_render.py` → Run Script → F12. Cycles + OIDN + AgX, micro-bevels,
   orange-peel clear coat, pebbled ABS, edge-worn powder coat, dusty tyres.
   Set `HDRI` at the top for image-based lighting.

If you change dimensions, keep `CAR` in `src/vehicle.js` in step with the
axle positions in `p6_geom.py` — physics reads its wheel layout from `CAR`.
