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

/* ================= PUBLIC BUILDER ================= */

export async function buildTextures(quality, onProgress = () => {}) {
  const size = quality.texSize;         // 512 high / 384 med / 256 low
  const aniso = quality.aniso;
  const out = {};
  const steps = [
    ['sand',  bakeSand,  6, 2.4],
    ['grass', bakeGrass, 6, 1.9],
    ['rock',  bakeRock,  4, 3.2],
    ['dirt',  bakeDirt,  4, 2.0],
    ['bark',  bakeBark,  3, 2.6]
  ];

  for (let i = 0; i < steps.length; i++) {
    const [name, fn, rep, strength] = steps[i];
    const res = fn(size);
    out[name] = toTexture(res.canvas, 1, true, aniso);
    out[name + 'N'] = toTexture(normalFromHeight(res.height, size, strength), 1, false, aniso);
    onProgress((i + 1) / (steps.length + 1), `Baking ${name}…`);
    await new Promise(r => setTimeout(r, 0));   // keep the loader animating
  }

  out.tuft = bakeTuft(quality.tier === 'low' ? 128 : 224);
  out.needles = bakeNeedles(quality.tier === 'low' ? 160 : 256);
  out.dust = sprite(128, 'rgba(255,246,232,0.95)', 'rgba(255,246,232,0)');
  out.smoke = sprite(128, 'rgba(210,220,230,0.75)', 'rgba(210,220,230,0)');
  out.glow = sprite(128, 'rgba(255,240,214,1)', 'rgba(255,180,90,0)', 0.6);
  onProgress(1, 'Ready');
  return out;
}
