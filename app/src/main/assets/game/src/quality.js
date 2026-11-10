/* ------------------------------------------------------------------
   quality.js — device detection and a runtime governor.

   The game picks a tier at startup from the GPU string, core count and
   screen, then keeps watching the frame time and quietly steps the
   render scale (and finally the post-processing) down or back up so it
   stays smooth on anything from a phone to a desktop GPU.
------------------------------------------------------------------ */

const PRESETS = {
  ultra: {
    tier: 'ultra', label: 'Ultra', viewRadius: 6, nearRes: 192, texSize: 1024, aniso: 16,
    shadows: true, shadowSize: 4096, shadowExtent: 105, shadowRing: 2,
    treeRing: 3, grass: true, grassCount: 11000, grassRadius: 96, clutter: true,
    clouds: true, bloom: true, smaa: true, finish: true, sharpen: 0.55, headlights: true,
    maxPixelRatio: 2, fogDensity: 0.000085, fov: 60
  },
  high: {
    tier: 'high', label: 'High', viewRadius: 5, nearRes: 160, texSize: 768, aniso: 16,
    shadows: true, shadowSize: 3072, shadowExtent: 96, shadowRing: 2,
    treeRing: 3, grass: true, grassCount: 7000, grassRadius: 78, clutter: true,
    clouds: true, bloom: true, smaa: true, finish: true, sharpen: 0.45, headlights: true,
    maxPixelRatio: 2, fogDensity: 0.000105, fov: 62
  },
  med: {
    tier: 'med', label: 'Medium', viewRadius: 4, nearRes: 112, texSize: 512, aniso: 8,
    shadows: true, shadowSize: 2048, shadowExtent: 82, shadowRing: 1,
    treeRing: 2, grass: true, grassCount: 3400, grassRadius: 54, clutter: false,
    clouds: true, bloom: true, smaa: false, finish: true, sharpen: 0.35, headlights: true,
    maxPixelRatio: 1.75, fogDensity: 0.00014, fov: 64
  },
  low: {
    tier: 'low', label: 'Low', viewRadius: 3, nearRes: 72, texSize: 320, aniso: 4,
    shadows: true, shadowSize: 1024, shadowExtent: 58, shadowRing: 0,
    treeRing: 1, grass: true, grassCount: 900, grassRadius: 30, clutter: false,
    clouds: false, bloom: false, smaa: false, finish: false, sharpen: 0, headlights: false,
    maxPixelRatio: 1.35, fogDensity: 0.0002, fov: 66
  }
};

const STORE = 'duneRunner.settings';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {};
}

export function saveSettings(patch) {
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...loadSettings(), ...patch }));
  } catch (_) {}
}

function gpuString() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return String(s || '').toLowerCase();
  } catch (_) { return ''; }
}

function isPhoneDevice() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  return /Android|iPhone|iPod/i.test(navigator.userAgent) ||
    (coarse && Math.min(innerWidth, innerHeight) < 500);
}

/* A phone that picks Ultra or High in the menu still gets the desktop
   preset's look, but not its desktop-only costs. Uncapped, Ultra on a
   phone was rendering 169 terrain chunks into a 4096² soft shadow map at
   2x pixel ratio, through SMAA's three extra full-screen passes, while
   re-placing 11,000 grass tufts every 5 m on the main thread — a few
   frames a second, at best. These caps keep the higher tiers visibly
   better than Medium (more chunks, sharper textures, bloom, clutter)
   while keeping the frame inside a phone's budget. */
const PHONE_CAPS = {
  ultra: { viewRadius: 4, nearRes: 112, texSize: 768, shadowSize: 2048, shadowExtent: 80,
           shadowRing: 0, treeRing: 2, grassCount: 3000, grassRadius: 54, maxPixelRatio: 1.5 },
  high:  { viewRadius: 4, nearRes: 96, texSize: 768, shadowSize: 1536, shadowExtent: 76,
           shadowRing: 0, treeRing: 2, grassCount: 2400, grassRadius: 48, maxPixelRatio: 1.5 },
  med:   { nearRes: 96, treeRing: 1, grassCount: 2000, maxPixelRatio: 1.5 },
  low:   {}
};

function forPhone(q) {
  const cap = PHONE_CAPS[q.tier] || {};
  for (const k in cap) q[k] = Math.min(q[k], cap[k]);
  q.smaa = false;            // three full-screen passes; MSAA is skipped too
  if (q.tier === 'low') q.shadows = false;   // a second scene pass; the truck keeps its blob shadow
  if (q.tier === 'med') {
    /* Measured on an Adreno 610 (Medium, 925x577): post-processing 12 ms,
       shadows 5.5 ms of a 55 ms frame. Rendering straight to the canvas
       (tone mapping still applies; only grain/vignette/sharpen go) and
       dropping real-time shadows lets Medium hold 30 fps at full resolution
       instead of the governor shrinking the picture. */
    q.bloom = false;
    q.finish = false;
    q.shadows = false;
    q.clouds = false;        // ~3 ms for a thin layer that is barely seen while driving
  }
  // smooth alpha-tested leaf and grass edges with the MSAA that mobile has on
  q.alphaToCoverage = true;
  /* Mobile lighting. The on-device test on an Adreno 610 showed physically
     based shading was ~60% of the frame (88 ms -> 36 ms with simple
     lighting). So on phones and tablets: Lambert shading for ground, plants,
     rocks and grass; no image-based sky reflections; no daytime-idle spot
     lights (every pixel paid for the three headlight cones); no fill light.
     The truck keeps its glossy paint. */
  q.simpleLighting = true;
  q.ibl = false;
  q.headlights = false;
  q.softShadows = false;     // PCF instead of PCFSoft: a third of the taps
  q.isPhone = true;
  q.fov += 4;
  return q;
}

export function detectQuality(override) {
  const pick = PRESETS[override] ? override : loadSettings().quality;
  if (pick && PRESETS[pick]) {
    const q = { ...PRESETS[pick], chosen: true };
    return isPhoneDevice() ? forPhone(q) : q;
  }

  const ua = navigator.userAgent;
  const gpu = gpuString();
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const isPhone = /Android|iPhone|iPod/i.test(ua) || (coarse && Math.min(innerWidth, innerHeight) < 500);
  const isTablet = /iPad/i.test(ua) || (coarse && !isPhone);
  const software = /swiftshader|llvmpipe|software|basic render/.test(gpu);
  const weakGpu = /adreno (3|4|5[0-2])|mali-(t|g3|g5)|powervr|intel.*(hd|uhd) graphics (3|4|5)/.test(gpu);

  const strongGpu = /rtx|radeon rx (6|7|9)|apple m[1-9]|geforce (gtx 16|rtx)|arc a/.test(gpu);

  let tier = 'high';
  if (software || weakGpu || cores <= 2 || mem <= 2) tier = 'low';
  else if (isPhone) tier = cores >= 8 && mem >= 6 ? 'med' : 'low';
  else if (isTablet) tier = 'med';
  else if (cores <= 4 || mem <= 4) tier = 'med';
  else if (strongGpu && cores >= 8 && mem >= 8) tier = 'ultra';

  const q = { ...PRESETS[tier] };
  q.gpu = gpu;
  return isPhone ? forPhone(q) : q;
}

export function presetList() {
  return ['ultra', 'high', 'med', 'low'].map(k => ({ key: k, label: PRESETS[k].label }));
}

/* Mobile resolution budget. Phones and tablets are limited by how many
   pixels the GPU fills, not by the pixel ratio: a 2000-px-wide tablet at
   1.35x was drawing almost as many pixels as a desktop. Each tier gets a
   fixed number of drawn pixels instead, whatever the screen. */
/* Raised after testing on an Adreno 610 tablet: it was limited by geometry,
   not pixels, and at 0.45 MP a 13-inch screen looked blocky. The governor
   still lowers this on devices where pixels really are the bottleneck. */
const PHONE_PIXELS = { low: 0.80e6, med: 0.95e6, high: 1.10e6, ultra: 1.25e6 };

/** The pixel ratio to start at for this preset on this screen. */
export function basePixelRatio(q) {
  let pr = Math.min(q.maxPixelRatio, devicePixelRatio || 1);
  const budget = q.isPhone && PHONE_PIXELS[q.tier];
  if (budget) {
    const css = Math.max(1, innerWidth * innerHeight);
    pr = Math.min(pr, Math.sqrt(budget / css));
  }
  return Math.max(0.5, pr);
}

/* ------------------------------------------------------------------
   Runtime governor. Watches the frame time and steps the render scale
   (then bloom) down, or back up when there is headroom.

   Decisions are made on elapsed time, not frame count: it used to wait
   for 45 frames, which at 5 fps is nine seconds per step — on a slow
   device it took over half a minute to recover. It also used to bounce
   between two scales every two seconds (drop below 38 fps, climb back
   above 56), and every change reallocates the post-processing buffers,
   which shows as a flash. Raising now needs sustained headroom, and
   stops for good once it has had to come back down twice.
------------------------------------------------------------------ */
export class QualityGovernor {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.q = quality;
    this.samples = [];
    this.scale = 1;
    this.cool = 2.0;
    this.window = 0;
    this.dropped = 0;
    this.bounces = 0;
    this.goodWindows = 0;
    this.lastMove = 0;
    this.fps = 0;            // 0 = not measured yet
    this.probe = null;       // { fps, scale } before the last drop
    this.notFillBound = false;
  }

  update(dt, composer) {
    this.samples.push(dt);
    this.window += dt;
    this.cool -= dt;
    // normally 1.2 s and 8 frames; a very slow device decides after 3 s anyway
    if (this.window < 1.2 || this.samples.length < 2 || (this.samples.length < 8 && this.window < 3)) return;

    const sorted = [...this.samples].sort((a, b) => a - b);
    this.fps = 1 / sorted[sorted.length >> 1];
    this.samples.length = 0;
    this.window = 0;
    if (this.cool > 0) return;

    /* A hand-picked preset is respected on desktop: only the render scale
       is nudged. On a phone a smooth frame matters more than holding the
       exact look, so the governor may go further there. */
    const strict = this.q.chosen && !this.q.isPhone;
    const floor = strict ? 0.75 : (this.q.isPhone ? 0.50 : 0.62);   // the probe below stops it where pixels are not the bottleneck
    const base = basePixelRatio(this.q);

    /* Did the last drop help? If the frame rate barely moved, this device is
       limited by geometry or the CPU, not by pixels: lowering the resolution
       further only makes it blurry. Put the resolution back and stop. */
    if (this.probe) {
      const p = this.probe; this.probe = null;
      if (this.fps < p.fps * 1.08) {
        this.scale = p.scale;
        this.apply(base, composer);
        this.notFillBound = true;
        this.cool = 1.5;
        return;
      }
    }

    const T = this.target || 60;            // 30 when the frame rate is capped
    if (this.fps < T * 0.66 && this.scale > floor && !this.notFillBound) {
      this.probe = { fps: this.fps, scale: this.scale };
      // the slower it is, the bigger the step
      const step = this.fps < T * 0.33 ? 0.25 : 0.12;
      this.scale = Math.max(floor, this.scale - step);
      this.apply(base, composer);
      this.dropped++;
      if (this.lastMove > 0) this.bounces++;
      this.lastMove = -1;
      this.goodWindows = 0;
      this.cool = 1.5;
    } else if (this.fps < T * 0.5 && this.q.bloom && !strict) {
      this.q.bloom = false;                       // last resort
      if (composer) composer.setBloom(false);
      this.cool = 3;
    } else if (this.fps > T * 0.95 && this.scale < 1 && this.bounces < 2) {
      if (++this.goodWindows >= 3) {              // ~4 s of real headroom
        this.scale = Math.min(1, this.scale + 0.08);
        this.apply(base, composer);
        this.lastMove = 1;
        this.goodWindows = 0;
        this.cool = 2;
      }
    } else {
      this.goodWindows = 0;
    }
  }

  apply(base, composer) {
    const pr = Math.max(0.45, base * this.scale);
    this.renderer.setPixelRatio(pr);
    if (composer) composer.resize();
  }
}
