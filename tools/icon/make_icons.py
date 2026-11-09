"""Regenerate every app icon from tools/icon/source.jpg.

    python3 -I tools/icon/make_icons.py

The source art arrives as a rounded square on white. Each platform cuts its
own shape (iOS squircle, Android masks, maskable web icons), so first the
white corners are filled in from the neighbouring sky and sand to get a
full-bleed square, then every size is cut from that.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'tools', 'icon', 'source.jpg')
GAME = os.path.join(ROOT, 'app', 'src', 'main', 'assets', 'game', 'icons')
RES = os.path.join(ROOT, 'app', 'src', 'main', 'res')
IOS = os.path.join(ROOT, 'ios', 'DuneRunner', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-1024.png')


def full_bleed():
    img = Image.open(SRC).convert('RGB')
    a = np.asarray(img).astype(np.float32)
    h, w, _ = a.shape
    # outside = the near-white region reachable from each corner
    white = (a.min(axis=2) > 200)
    outside = np.zeros((h, w), bool)
    for cy, cx in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)):
        if not white[cy, cx]:
            continue
        stack = [(cy, cx)]
        while stack:
            y, x = stack.pop()
            if outside[y, x] or not white[y, x]:
                continue
            # flood a whole run along the row at once
            x0 = x
            while x0 > 0 and white[y, x0 - 1] and not outside[y, x0 - 1]:
                x0 -= 1
            x1 = x
            while x1 < w - 1 and white[y, x1 + 1] and not outside[y, x1 + 1]:
                x1 += 1
            outside[y, x0:x1 + 1] = True
            for ny in (y - 1, y + 1):
                if 0 <= ny < h:
                    for nx in np.nonzero(white[ny, x0:x1 + 1] & ~outside[ny, x0:x1 + 1])[0]:
                        stack.append((ny, x0 + nx))
    # also replace the anti-aliased rim
    m = Image.fromarray((outside * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(13))
    hole = np.asarray(m) > 0
    # Fill by growing inward: blur the known pixels (normalised convolution),
    # adopt the estimate wherever enough known neighbours contributed, repeat
    # until the holes close. Then soften only the filled area.
    def box(x, r):
        k = 2 * r + 1
        pad = ((r + 1, r), (0, 0)) + ((0, 0),) * (x.ndim - 2)
        c = np.cumsum(np.pad(x, pad, mode='edge'), axis=0)
        x = (c[k:] - c[:-k]) / k
        pad = ((0, 0), (r + 1, r)) + ((0, 0),) * (x.ndim - 2)
        c = np.cumsum(np.pad(x, pad, mode='edge'), axis=1)
        return (c[:, k:] - c[:, :-k]) / k

    known = ~hole
    filled = a.copy()
    while not known.all():
        kf = known.astype(np.float32)
        num = box(filled * kf[..., None], 10)
        den = box(kf, 10)
        grow = ~known & (den > 0.15)
        filled[grow] = num[grow] / den[grow][:, None]
        known |= grow
    smooth = box(filled, 24)
    w8 = np.asarray(m.filter(ImageFilter.GaussianBlur(8))).astype(np.float32)[..., None] / 255
    filled = filled * (1 - w8) + smooth * w8
    # light grain so the filled corners do not look airbrushed
    rng = np.random.default_rng(1)
    filled[hole] += rng.normal(0, 1.5, (hole.sum(), 3))
    return Image.fromarray(np.clip(filled, 0, 255).astype(np.uint8))


def rounded(img, size, radius=0.2237):
    im = img.resize((size * 4, size * 4), Image.LANCZOS)
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1),
                                           radius=int(im.size[0] * radius), fill=255)
    im.putalpha(mask)
    return im.resize((size, size), Image.LANCZOS)


def circle(img, size):
    im = img.resize((size * 4, size * 4), Image.LANCZOS)
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, im.size[0] - 1, im.size[1] - 1), fill=255)
    im.putalpha(mask)
    return im.resize((size, size), Image.LANCZOS)


def padded(img, size, art):
    """The art at `art` px, centred on a `size` canvas whose margin continues
    the picture's edges (blurred), for masks that crop the outer ring."""
    off = (size - art) // 2
    a = np.asarray(img.resize((art, art), Image.LANCZOS)).astype(np.float32)
    # continue the outermost pixels outward, then blur the margin only
    ext = np.pad(a, ((off, size - art - off), (off, size - art - off), (0, 0)), mode='edge')
    soft = np.asarray(Image.fromarray(ext.astype(np.uint8)).filter(ImageFilter.GaussianBlur(size / 60))).astype(np.float32)
    mask = Image.new('L', (size, size), 0)
    feather = max(4, art // 40)
    ImageDraw.Draw(mask).rectangle((off + feather, off + feather, off + art - 1 - feather, off + art - 1 - feather), fill=255)
    w = np.asarray(mask.filter(ImageFilter.GaussianBlur(feather / 2))).astype(np.float32)[..., None] / 255
    return Image.fromarray(np.clip(ext * w + soft * (1 - w), 0, 255).astype(np.uint8))


def main():
    sq = full_bleed()
    sq.save(os.path.join(ROOT, 'tools', 'icon', 'full-bleed.png'))

    # iOS: opaque full-bleed square, the system rounds it
    sq.resize((1024, 1024), Image.LANCZOS).save(IOS)

    # web
    for n in (1024, 512, 192):
        rounded(sq, n).save(os.path.join(GAME, f'icon-{n}.png'))
    for n in (192, 144, 96, 72, 48):
        rounded(sq, n).save(os.path.join(GAME, f'launcher-{n}.png'))
    # maskable: the safe zone is the central 80% circle
    padded(sq, 512, 440).convert('RGBA').save(os.path.join(GAME, 'icon-maskable-512.png'))

    # Android legacy launcher icons
    for d, n in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
        rounded(sq, n).save(os.path.join(RES, f'mipmap-{d}', 'ic_launcher.png'))
        circle(sq, n).save(os.path.join(RES, f'mipmap-{d}', 'ic_launcher_round.png'))

    # Android adaptive foreground: 108dp canvas, 72dp visible after masking
    fg = padded(sq, 432, 330).convert('RGBA')
    fg.save(os.path.join(RES, 'drawable', 'ic_launcher_foreground.png'))
    fg.save(os.path.join(GAME, 'adaptive-foreground-432.png'))


if __name__ == '__main__':
    main()
