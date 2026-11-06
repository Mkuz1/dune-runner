"""Generate game textures with the local Draw Things API (FLUX.1 dev).

usage: python dt_gen.py JOBS.json OUT_DIR [--only name,name]

Each job: {"name", "prompt", "w", "h", "seed", "seamless": bool, "steps"}.
Seamless jobs get the classic offset-and-repaint pass: the image is rolled
by half its size so the old borders meet in a cross through the middle, that
cross is repaired by an img2img pass (Draw Things' API takes no inpainting
mask, so the whole image is lightly repainted and only the cross is blended
back in), and the result therefore tiles.
Prints a seam score (edge mismatch relative to the image's own neighbouring
pixels: ~1.0 means the wrap-around join is as smooth as anywhere inside).
"""
import base64, io, json, sys, time, urllib.request
import numpy as np
from PIL import Image, ImageFilter

API = 'http://127.0.0.1:7860'
BASE = {
    'loras': [], 'guidance_scale': 3.5, 'sampler': 'Euler A Trailing',
    'batch_size': 1, 'batch_count': 1, 'shift': 1.0, 'tiled_diffusion': False,
    'negative_prompt': 'text, watermark, logo, signature, frame, border, vignette, blurry, people, cartoon'
}


def call(path, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=1800) as r:
        out = json.loads(r.read())
    return Image.open(io.BytesIO(base64.b64decode(out['images'][0]))).convert('RGB')


def b64(img):
    buf = io.BytesIO(); img.save(buf, 'PNG'); return base64.b64encode(buf.getvalue()).decode()


def txt2img(job):
    body = dict(BASE, prompt=job['prompt'], width=job['w'], height=job['h'], seed=job['seed'],
                steps=job.get('steps', 24), strength=1.0)
    return call('/sdapi/v1/txt2img', body)


def seam_score(img):
    a = np.asarray(img, dtype=np.float32)
    inner = (np.abs(a[:, 1:] - a[:, :-1]).mean() + np.abs(a[1:] - a[:-1]).mean()) / 2
    wrap = (np.abs(a[:, 0] - a[:, -1]).mean() + np.abs(a[0] - a[-1]).mean()) / 2
    return wrap / max(inner, 1e-3)


def make_seamless(img, job):
    w, h = img.size
    rolled = Image.fromarray(np.roll(np.asarray(img), (h // 2, w // 2), axis=(0, 1)))
    band = max(48, w // 7)
    m = np.zeros((h, w), np.uint8)
    m[:, w // 2 - band // 2: w // 2 + band // 2] = 255
    m[h // 2 - band // 2: h // 2 + band // 2, :] = 255
    mask = Image.fromarray(m).filter(ImageFilter.GaussianBlur(band // 6))
    body = dict(BASE, prompt=job['prompt'], width=w, height=h, seed=job['seed'] + 1,
                steps=job.get('steps', 24), strength=job.get('seam_strength', 0.55),
                init_images=[b64(rolled)])
    fixed = call('/sdapi/v1/img2img', body)
    # keep the untouched pixels exactly; blend the repainted cross in softly
    alpha = np.asarray(mask, dtype=np.float32)[..., None] / 255
    out = np.asarray(rolled, np.float32) * (1 - alpha) + np.asarray(fixed, np.float32) * alpha
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def main():
    jobs = json.load(open(sys.argv[1])); out = sys.argv[2]
    only = None
    if '--only' in sys.argv: only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
    for job in jobs:
        if only and job['name'] not in only: continue
        t0 = time.time()
        img = txt2img(job)
        img.save(f"{out}/{job['name']}_raw.png")
        if job.get('seamless'):
            before = seam_score(img)
            img = make_seamless(img, job)
            print(f"{job['name']}: seam {before:.2f} -> {seam_score(img):.2f}", flush=True)
        img.save(f"{out}/{job['name']}.png")
        print(f"{job['name']}: done in {time.time() - t0:.0f}s", flush=True)


if __name__ == '__main__':
    main()
