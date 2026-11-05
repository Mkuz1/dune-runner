/* ------------------------------------------------------------------
   textures.js — every texture in the game is generated procedurally at
   load time. Nothing is downloaded, so the whole build is a couple of
   hundred KB and works offline / behind any CDN.

   Each ground material ships with a matching normal map derived from
   its own height field, which is what gives the sand ripples and rock
   faces their relief under the moving sun.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';
import { hash2, lerp, clamp } from './noise.js';

/* --- seamless periodic value noise --------------------------------- */
function pval(x, y, period) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const tx = x - xi, ty = y - yi;
  const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
  const P = Math.max(1, period | 0);
  const w = (i, j) => hash2(((i % P) + P) % P, ((j % P) + P) % P);
  const a = lerp(w(xi, yi), w(xi + 1, yi), u);
  const b = lerp(w(xi, yi + 1), w(xi + 1, yi + 1), u);
  return lerp(a, b, v);
}

function pfbm(x, y, period, oct = 4, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * pval(x * f, y * f, period * f);
    n += a; a *= gain; f *= 2;
  }
  return s / n;
}

/* --- canvas helpers -------------------------------------------------- */
function newCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(canvas, repeat = 1, srgb = false, aniso = 8, renderer = null) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Sobel a height field into a tangent-space normal map. */
function normalFromHeight(height, size, strength = 2.2) {
  const c = newCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Build a colour canvas + height field from a per-pixel shader function. */
function bake(size, period, fn) {
  const c = newCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const height = new Float32Array(size * size);
  const out = { r: 0, g: 0, b: 0, h: 0 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      fn(x / size * period, y / size * period, out, x, y);
      const i = (y * size + x) * 4;
      d[i] = clamp(out.r, 0, 1) * 255;
      d[i + 1] = clamp(out.g, 0, 1) * 255;
      d[i + 2] = clamp(out.b, 0, 1) * 255;
      d[i + 3] = 255;
      height[y * size + x] = out.h;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, height };
}

/* ================= GROUND MATERIALS ================= */

function bakeSand(size) {
  const P = 8;
  return bake(size, P, (u, v, o) => {
    const grain = pfbm(u * 26, v * 26, P * 26, 3);
    const ripple = Math.sin((u * 5.5 + pfbm(u * 2, v * 2, P * 2, 2) * 3.2) * Math.PI * 2) * 0.5 + 0.5;
    const macro = pfbm(u * 2.0, v * 2.0, P * 2, 3);
    const h = ripple * 0.55 + grain * 0.30 + macro * 0.15;
    const tone = 0.80 + h * 0.26 + (grain - 0.5) * 0.12;
    o.r = 0.86 * tone;
    o.g = 0.72 * tone + macro * 0.045;
    o.b = 0.51 * tone;
    o.h = h;
  });
}

function bakeGrass(size) {
  const P = 8;
  return bake(size, P, (u, v, o) => {
    const blades = pfbm(u * 46, v * 46, P * 46, 2);
    const clump = pfbm(u * 5.0, v * 5.0, P * 5, 4);
    const dry = pfbm(u * 1.7 + 12, v * 1.7 - 4, P * 2, 3);
    const h = blades * 0.6 + clump * 0.4;

    // forest floor: mossy green shifting into dry needle-litter brown
    const g1 = [0.16, 0.29, 0.11];
    const g2 = [0.29, 0.40, 0.15];
    const soil = [0.30, 0.24, 0.14];
    const t = clamp(clump * 1.25 - 0.1, 0, 1);
    const m = clamp((dry - 0.42) * 2.2, 0, 1);
    const base = [
      lerp(g1[0], g2[0], t), lerp(g1[1], g2[1], t), lerp(g1[2], g2[2], t)
    ];
    const sh = 0.72 + blades * 0.55;
    o.r = lerp(base[0], soil[0], m) * sh;
    o.g = lerp(base[1], soil[1], m) * sh;
    o.b = lerp(base[2], soil[2], m) * sh;
    o.h = h;
  });
}

function bakeRock(size) {
  const P = 6;
  return bake(size, P, (u, v, o) => {
    const strata = pfbm(u * 3.2, v * 11.0, P * 4, 4);
    const crack = 1 - Math.abs(pfbm(u * 7.5, v * 7.5, P * 8, 4) * 2 - 1);
    const grain = pfbm(u * 40, v * 40, P * 40, 2);
    const h = strata * 0.55 + Math.pow(crack, 3) * 0.3 + grain * 0.15;
    const tone = 0.42 + h * 0.55;
    const warm = pfbm(u * 1.4 + 5, v * 1.4 + 9, P * 2, 3);
    o.r = tone * (0.86 + warm * 0.26);
    o.g = tone * (0.82 + warm * 0.16);
    o.b = tone * (0.78 + warm * 0.06);
    o.h = h;
  });
}

function bakeDirt(size) {
  const P = 6;
  return bake(size, P, (u, v, o) => {
    const packed = pfbm(u * 9, v * 9, P * 9, 4);
    const stones = pfbm(u * 34, v * 34, P * 34, 2);
    const ruts = Math.sin(v * Math.PI * 2 * 1.0) * 0.5 + 0.5;
    const h = packed * 0.6 + stones * 0.25 + ruts * 0.15;
    const tone = 0.58 + h * 0.42;
    o.r = 0.52 * tone + 0.10;
    o.g = 0.40 * tone + 0.065;
    o.b = 0.29 * tone + 0.04;
    o.h = h * 0.7;
  });
}

/* ================= FOLIAGE / PROP TEXTURES ================= */

function bakeBark(size) {
  const P = 4;
  return bake(size, P, (u, v, o) => {
    const fib = pfbm(u * 3.0, v * 34, P * 8, 4);
    const rough = pfbm(u * 20, v * 60, P * 32, 2);
    const h = fib * 0.7 + rough * 0.3;
    const tone = 0.35 + h * 0.6;
    o.r = 0.34 * tone + 0.055;
    o.g = 0.24 * tone + 0.035;
    o.b = 0.17 * tone + 0.024;
    o.h = h;
  });
}

/** Soft radial sprite: dust, splash, glow. */
export function sprite(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', power = 1) {
  const c = newCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(Math.min(0.95, 0.35 * power), outer.replace('0)', '0.28)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Billboard grass tuft: tall, thin, tapered blades on a clear card. */
function bakeTuft(size = 160) {
  const c = newCanvas(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const blade = (x0, hgt, bend, w, shade, lean) => {
    // taper the blade by drawing it as a filled triangle-ish path
    const tipX = x0 + bend, tipY = size - hgt;
    const midX = x0 + bend * 0.35 + lean, midY = size - hgt * 0.55;
    ctx.beginPath();
    ctx.moveTo(x0 - w, size);
    ctx.quadraticCurveTo(midX - w * 0.55, midY, tipX, tipY);
    ctx.quadraticCurveTo(midX + w * 0.55, midY, x0 + w, size);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, size, 0, tipY);
    g.addColorStop(0, `rgba(${Math.round(38 * shade + 16)},${Math.round(74 * shade + 20)},${Math.round(26 * shade + 12)},1)`);
    g.addColorStop(1, `rgba(${Math.round(118 * shade + 46)},${Math.round(170 * shade + 52)},${Math.round(74 * shade + 26)},1)`);
    ctx.fillStyle = g;
    ctx.fill();
  };

  for (let i = 0; i < 22; i++) {
    const x0 = size * (0.18 + Math.random() * 0.64);
    const hgt = size * (0.55 + Math.random() * 0.44);
    const bend = (Math.random() - 0.5) * size * 0.34;
    const w = size * (0.011 + Math.random() * 0.014);
    blade(x0, hgt, bend, w, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Pine-needle canopy patch with alpha, used on the tree card meshes. */
function bakeNeedles(size = 256) {
  const c = newCanvas(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 420; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.55) * size * 0.47;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r * 0.86;
    const len = size * (0.03 + Math.random() * 0.08);
    const ang = a + (Math.random() - 0.5) * 1.2;
    const s = 0.35 + Math.random() * 0.6;
    ctx.strokeStyle = `rgba(${Math.round(30 * s + 12)},${Math.round(86 * s + 20)},${Math.round(40 * s + 14)},${0.75 + Math.random() * 0.25})`;
    ctx.lineWidth = size * 0.011;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ================= PHOTO-SCANNED GROUND ================= */
/* The four terrain layers use real photogrammetry scans (Poly Haven, CC0)
   from ./textures/: aerial captures 15–50 m across, so their physical
   scale matches the 16–32 m tiles the terrain shader samples them at.

   Each photo is calibrated against the procedural texture it replaces:
   the shader multiplies it by a per-layer gain that matches the old
   layer's average brightness exactly and most of its tint, so the
   lighting, fog and grading tuned around the procedural palette still
   hold. If an image fails to load, that layer quietly falls back to the
   procedural bake. */

const PHOTO_DIR = './textures/';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('could not load ' + url));
    im.src = url;
  });
}

const toLin = (v) => Math.pow(v / 255, 2.2);

/** Average colour in linear space (the space the shader multiplies in). */
function meanLinear(src) {
  const n = 64;
  const c = newCanvas(n);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, n, n);
  const d = ctx.getImageData(0, 0, n, n).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += toLin(d[i]); g += toLin(d[i + 1]); b += toLin(d[i + 2]); }
  const k = 1 / (n * n);
  return [r * k, g * k, b * k];
}

/** Per-channel gain that maps the photo's average onto the procedural one:
    full luminance match, 60 % of the way on tint. */
function calibrate(photoMean, targetMean, tint = 0.6) {
  const L = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  const gL = L(targetMean) / Math.max(1e-4, L(photoMean));
  const g = [0, 1, 2].map(i => {
    const full = targetMean[i] / Math.max(1e-4, photoMean[i]);
    return clamp(lerp(gL, full, tint), 0.35, 3.0);
  });
  return new THREE.Vector3(g[0], g[1], g[2]);
}

function imageTexture(img, srgb, aniso, maxSize) {
  let src = img;
  if (img.width > maxSize) {
    const c = newCanvas(maxSize);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, maxSize, maxSize);
    src = c;
  }
  const t = new THREE.Texture(src);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Foliage atlas for card trees: an opaque colour canvas (the pixels
    behind the cut-outs filled with the average leaf colour, so mipmaps
    never bleed white or black into the edges) plus the alpha mask as a
    separate alphaMap. Kept separate on purpose: a canvas with real
    transparency is stored premultiplied, which throws that colour away. */
async function loadCardAtlas(name, size, aniso) {
  const [col, mask] = await Promise.all([
    loadImage(PHOTO_DIR + name + '.jpg'),
    loadImage(PHOTO_DIR + name + '_a.png')
  ]);
  const c = newCanvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mask, 0, 0, size, size);
  const a = ctx.getImageData(0, 0, size, size).data;
  ctx.drawImage(col, 0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (a[i + 1] > 160) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  }
  if (n) {
    r /= n; g /= n; b /= n;
    for (let i = 0; i < d.length; i += 4) {
      if (a[i + 1] < 96) { d[i] = r; d[i + 1] = g; d[i + 2] = b; }
    }
  }
  ctx.putImageData(img, 0, 0);

  const setup = (t) => {
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = aniso;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  const colour = setup(new THREE.CanvasTexture(c));
  colour.colorSpace = THREE.SRGBColorSpace;
  return [colour, setup(new THREE.Texture(mask))];
}

/* ================= PUBLIC BUILDER ================= */

export async function buildTextures(quality, onProgress = () => {}) {
  const size = quality.texSize;         // 1024 ultra … 320 low
  const aniso = quality.aniso;
  const photoMax = quality.tier === 'low' ? 512 : 1024;
  const out = { gain: {}, photoMean: {}, antiTile: quality.tier !== 'low' };
  const steps = [
    ['sand',  bakeSand,  2.4, true],
    ['grass', bakeGrass, 1.9, true],
    ['rock',  bakeRock,  3.2, true],
    ['dirt',  bakeDirt,  2.0, true],
    ['bark',  bakeBark,  2.6, true]
  ];

  // start every download at once; they decode while the bakes below run
  const photos = {};
  for (const [name, , , photo] of steps) {
    if (!photo) continue;
    photos[name] = Promise.all([
      loadImage(PHOTO_DIR + name + '.jpg'),
      loadImage(PHOTO_DIR + name + '_n.jpg')
    ]).catch((e) => { console.warn('[textures]', e.message, '— using the procedural layer'); return null; });
  }

  for (let i = 0; i < steps.length; i++) {
    const [name, fn, strength, photo] = steps[i];
    const pair = photo ? await photos[name] : null;
    if (pair) {
      const [col, nrm] = pair;
      // a small bake is enough to know the colour the world was tuned for
      const target = meanLinear(fn(64).canvas);
      const mean = meanLinear(col);
      out.gain[name] = calibrate(mean, target);
      out.photoMean[name] = new THREE.Vector3(mean[0], mean[1], mean[2]);
      out[name] = imageTexture(col, true, aniso, photoMax);
      out[name + 'N'] = imageTexture(nrm, false, aniso, photoMax);
      out[name + 'Photo'] = true;
    } else {
      const res = fn(size);
      out[name] = toTexture(res.canvas, 1, true, aniso);
      out[name + 'N'] = toTexture(normalFromHeight(res.height, size, strength), 1, false, aniso);
      out.gain[name] = new THREE.Vector3(1, 1, 1);
    }
    onProgress((i + 1) / (steps.length + 1), `Preparing ${name}…`);
    await new Promise(r => setTimeout(r, 0));   // keep the loader animating
  }

  /* Large-scale brightness variation. It used to be read from the
     procedural rock texture; the rock layer is a photo now, so the
     same bake is kept, small, purely as a macro-noise source. */
  out.macro = toTexture(bakeRock(256).canvas, 1, true, 1);   // sRGB, as before

  /* More photo surfaces: the road (gravel-road scan) and beach (coastal sand
     scan) are calibrated against the procedural layer they stand in for;
     chalet logs, roof shingles and foundation stone only record their mean
     colour, because the village shader uses them to modulate its own
     palette. Any that fail to load are simply left out. */
  const extra = [
    // [name, has normal map, procedural target, how much of the target's tint to take]
    ['road', true, bakeDirt, 0.1], ['beach', true, bakeSand, 0.5],
    ['logs', false, null, 0], ['roof', false, null, 0], ['stone', false, null, 0]
  ];
  await Promise.all(extra.map(async ([name, withNormal, target, tint]) => {
    try {
      const [col, nrm] = await Promise.all([
        loadImage(PHOTO_DIR + name + '.jpg'),
        withNormal ? loadImage(PHOTO_DIR + name + '_n.jpg') : Promise.resolve(null)
      ]);
      const mean = meanLinear(col);
      out.photoMean[name] = new THREE.Vector3(mean[0], mean[1], mean[2]);
      out.gain[name] = target ? calibrate(mean, meanLinear(target(64).canvas), tint) : new THREE.Vector3(1, 1, 1);
      out[name] = imageTexture(col, true, aniso, photoMax);
      if (nrm) out[name + 'N'] = imageTexture(nrm, false, aniso, photoMax);
    } catch (e) {
      console.warn('[textures]', e.message);
    }
  }));

  // photo foliage for the card trees (the low tier keeps the solid ones)
  if (quality.tier !== 'low') {
    try {
      const sz = quality.tier === 'med' ? 512 : 1024;
      [out.pineCards, out.pineCardsA] = await loadCardAtlas('pine_twig', sz, aniso);
      [out.leafCards, out.leafCardsA] = await loadCardAtlas('leaf_sprig', sz, aniso);
    } catch (e) {
      console.warn('[textures] foliage atlas failed — using solid trees:', e.message);
      out.pineCards = out.leafCards = null;
    }
  }

  out.tuft = bakeTuft(quality.tier === 'low' ? 128 : 224);
  out.needles = bakeNeedles(quality.tier === 'low' ? 160 : 256);
  out.dust = sprite(128, 'rgba(255,246,232,0.95)', 'rgba(255,246,232,0)');
  out.smoke = sprite(128, 'rgba(210,220,230,0.75)', 'rgba(210,220,230,0)');
  out.glow = sprite(128, 'rgba(255,240,214,1)', 'rgba(255,180,90,0)', 0.6);
  onProgress(1, 'Ready');
  return out;
}
