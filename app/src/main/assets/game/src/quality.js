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

export function detectQuality(override) {
  if (override && PRESETS[override]) return { ...PRESETS[override], chosen: true };
  const saved = loadSettings().quality;
  if (saved && PRESETS[saved]) return { ...PRESETS[saved], chosen: true };

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
  q.isPhone = isPhone;
  if (isPhone) q.fov += 4;
  return q;
}

export function presetList() {
  return ['ultra', 'high', 'med', 'low'].map(k => ({ key: k, label: PRESETS[k].label }));
}

/* ------------------------------------------------------------------ */
export class QualityGovernor {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.q = quality;
    this.samples = [];
    this.scale = 1;
    this.cool = 2.5;
    this.dropped = 0;
    this.fps = 60;
  }

  update(dt, composer) {
    this.samples.push(dt);
    if (this.samples.length > 60) this.samples.shift();
    this.cool -= dt;
    if (this.samples.length < 45 || this.cool > 0) return;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.fps = 1 / median;

    // a hand-picked preset is respected: only the render scale is nudged
    const floor = this.q.chosen ? 0.75 : 0.62;
    const base = Math.min(this.q.maxPixelRatio, devicePixelRatio || 1);
    if (this.fps < 38 && this.scale > floor) {
      this.scale = Math.max(floor, this.scale - 0.12);
      this.apply(base, composer);
      this.dropped++;
    } else if (this.fps < 28 && this.dropped >= 3 && this.q.bloom && !this.q.chosen) {
      this.q.bloom = false;                       // last resort
      if (composer) composer.setBloom(false);
      this.cool = 4;
    } else if (this.fps > 56 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.08);
      this.apply(base, composer);
    }
    this.cool = 2.0;
    this.samples.length = 0;
  }

  apply(base, composer) {
    const pr = Math.max(0.6, base * this.scale);
    this.renderer.setPixelRatio(pr);
    if (composer) composer.resize();
  }
}
