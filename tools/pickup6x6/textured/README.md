# Textured truck — Blender + Draw Things pipeline

The game's truck (`models/pickup6x6.glb` + `models/truck/*.jpg`) is the
p6_geom model, finished in Blender with baked photo textures:

1. **Model** (Blender 5.2, interactive): build with `../p6_build.py`; add a
   4 mm / 2-segment micro-bevel + weighted normals to body and cab and a
   3 mm / 1-segment bevel to the details, apply; Smart-UV-project each part
   (`p6_body`, `p6_cab`, `p6_detail`, `p6_wheel`; the spare shares the wheel).
   Bake ambient occlusion per part with six temporary wheels at the axle
   positions so the arches darken properly. Save the .blend.
2. **Photo textures** (Draw Things, FLUX.1 [dev], HTTP API on 127.0.0.1:7860):
   `python dt_gen.py car_jobs.json OUT` → tread, sidewall, mud, grille,
   plastic, chassis. Seamless via roll-by-half + img2img repair of the seam
   cross (it prints a seam score; ~1.0 = tiles cleanly). If the repair makes
   one worse, use its `_raw` image (the mud texture did). Copies of the six
   used are in `source_textures/`.
3. **Bake + export** (headless):
   `Blender -b model.blend --python bake_car.py -- TEX_DIR BAKE_DIR out.glb`
   builds wear-aware bake materials (dust thickening towards the ground,
   film on top faces, crevice dust, photo mud splatter; tread wrapped round
   the tyre, sidewall round its sides), bakes colour / roughness / normal
   per part, and exports the GLB with UVs + tangents and plain named
   materials (no images).
4. **Pack**: `python pack_car.py BAKE_DIR app/src/main/assets/game/models/truck`
   writes `<part>_col.jpg`, `<part>_nrm.jpg`, `<part>_orm.jpg`
   (R = occlusion, G = roughness).

`src/vehicle.js` gives each part's meshes a copy of the tuned game material
(clear-coat paint, chrome, glass…) with these maps attached, and falls back
to the plain vertex-coloured materials if the textures are missing.
