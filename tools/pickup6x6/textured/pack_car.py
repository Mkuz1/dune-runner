"""Pack the baked truck maps for the game.

python pack_car.py BAKE_DIR OUT_DIR

  <part>_col.jpg  base colour (sRGB)
  <part>_nrm.jpg  tangent-space normal
  <part>_orm.jpg  R = ambient occlusion, G = roughness (B unused)
Texture sizes are capped per part to keep the app small.
"""
import os, sys
import numpy as np
from PIL import Image

BAKE, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
PARTS = {'body': ('p6_body', 2048, 1024), 'cab': ('p6_cab', 1024, 1024),
         'detail': ('p6_detail', 2048, 1024), 'wheel': ('p6_wheel', 1024, 1024)}

def load(path, size, mode='RGB'):
    im = Image.open(path).convert(mode)
    return im.resize((size, size), Image.LANCZOS) if im.size[0] != size else im

total = 0
for short, (name, col_size, aux_size) in PARTS.items():
    col = load(f'{BAKE}/{name}_col.png', col_size)
    col.save(f'{OUT}/{short}_col.jpg', quality=86, optimize=True)
    nrm = load(f'{BAKE}/{name}_nrm.png', aux_size)
    nrm.save(f'{OUT}/{short}_nrm.jpg', quality=90, optimize=True)
    ao = np.asarray(load(f'{BAKE}/{name}_ao.png', aux_size, 'L'), np.float32)
    rough = np.asarray(load(f'{BAKE}/{name}_rough.png', aux_size, 'L'), np.float32)
    # occlusion is lifted a touch: the game adds its own shadows on top
    ao = 255 * (0.12 + 0.88 * (ao / 255))
    orm = np.stack([ao, rough, np.zeros_like(ao)], -1).clip(0, 255).astype(np.uint8)
    Image.fromarray(orm).save(f'{OUT}/{short}_orm.jpg', quality=90, optimize=True)
    sizes = [os.path.getsize(f'{OUT}/{short}_{k}.jpg') for k in ('col', 'nrm', 'orm')]
    total += sum(sizes)
    print(short, [f'{s // 1024} KB' for s in sizes])
print('total', total // 1024, 'KB')
