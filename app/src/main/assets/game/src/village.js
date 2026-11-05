/* ------------------------------------------------------------------
   village.js — alpine log-cabin settlements.

   Each village is a handful of Swiss-style chalets: stacked log walls
   with the ends crossing at the corners, a shallow gabled roof with deep
   overhangs, a full-width balcony under it, shutters, flower boxes and a
   stone chimney. Around them go a barn, log piles, split-rail fencing, a
   well and street lamps that come on at dusk.

   The ground is already levelled by world.js, so everything simply sits
   at the village platform height. Buildings are laid out along a curved
   main street, which is where a real one would be.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';
import { mergeGeometries } from '../libs/three/addons/utils/BufferGeometryUtils.js';
import { makeRandom } from './noise.js';
import { villagesNear, heightAt } from './world.js';

const C = new THREE.Color();

function paint(geo, hex, jitter = 0.05, rnd = Math.random) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  C.set(hex);
  for (let i = 0; i < n; i++) {
    const j = 1 + (rnd() - 0.5) * jitter * 2;
    col[i * 3] = C.r * j; col[i * 3 + 1] = C.g * j; col[i * 3 + 2] = C.b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
function log(len, r, x, y, z, axis = 'x', seg = 7) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/* ---- palette ---- */
const WOOD_DARK = 0x5a3f28;
const WOOD_MID  = 0x7a5836;
const WOOD_WARM = 0x8a6740;
const ROOF      = 0x39322c;
const STONE     = 0x8d8a84;
const TRIM      = 0xe8e2d4;
const SHUTTER   = 0x8e2f24;

/* =========================== CHALET =========================== */
/**
 * @param seed   variation
 * @param size   0 small cottage .. 1 big farmhouse
 */
export function makeChalet(seed = 3, size = 0.5) {
  const rnd = makeRandom(seed);
  const P = { wood: [], roof: [], stone: [], trim: [], glass: [], shutter: [], lamp: [] };

  const W = 7.0 + size * 3.6 + rnd() * 1.2;      // width  (gable faces ±Z)
  const D = 5.6 + size * 2.4 + rnd() * 1.0;      // depth
  const storeys = size > 0.55 ? 2 : 1;
  const wallH = 2.5 * storeys + 0.5;
  const logR = 0.19;
  const base = 0.55;                              // stone plinth height

  /* ---- stone plinth ---- */
  P.stone.push(box(W + 0.5, base, D + 0.5, 0, base / 2, 0));
  for (let i = 0; i < 5; i++) {                   // rough boulder course
    const a = rnd() * 6.283;
    P.stone.push(box(0.5 + rnd() * 0.5, 0.34, 0.4,
      Math.cos(a) * (W / 2 + 0.1), 0.18, Math.sin(a) * (D / 2 + 0.1), 0, rnd() * 3, 0));
  }

  /* ---- stacked log walls, ends crossing at the corners ---- */
  const rows = Math.round(wallH / (logR * 2));
  for (let i = 0; i < rows; i++) {
    const y = base + logR + i * logR * 2;
    const over = 0.42 + (i % 2) * 0.1;            // alternate the notch overhang
    const tone = i % 2 ? WOOD_MID : WOOD_WARM;
    if (i % 2 === 0) {
      P.wood.push(paint(log(W + over * 2, logR, 0, y, D / 2, 'x'), tone, 0.09, rnd));
      P.wood.push(paint(log(W + over * 2, logR, 0, y, -D / 2, 'x'), tone, 0.09, rnd));
    } else {
      P.wood.push(paint(log(D + over * 2, logR, W / 2, y, 0, 'z'), tone, 0.09, rnd));
      P.wood.push(paint(log(D + over * 2, logR, -W / 2, y, 0, 'z'), tone, 0.09, rnd));
    }
  }
  // fill the gaps behind the logs so you cannot see through the walls
  P.wood.push(paint(box(W - 0.02, wallH, D - 0.02, 0, base + wallH / 2, 0), WOOD_DARK, 0.05, rnd));

  /* ---- gable ends ---- */
  const roofH = 1.5 + size * 0.7;
  const gable = new THREE.BufferGeometry();
  {
    const h = roofH, w = W / 2;
    const v = new Float32Array([
      -w, 0, 0, w, 0, 0, 0, h, 0,
      -w, 0, 0, 0, h, 0, w, 0, 0
    ]);
    gable.setAttribute('position', new THREE.BufferAttribute(v, 3));
    gable.computeVertexNormals();
  }
  for (const s of [1, -1]) {
    const g = gable.clone();
    g.translate(0, base + wallH, s * D / 2);
    P.wood.push(paint(g, WOOD_MID, 0.07, rnd));
    // vertical boarding on the gable
    for (let k = -3; k <= 3; k++) {
      const hh = roofH * (1 - Math.abs(k) / 3.6);
      if (hh < 0.2) continue;
      P.wood.push(paint(box(0.30, hh, 0.07, k * (W / 8), base + wallH + hh / 2, s * (D / 2 + 0.04)),
        k % 2 ? WOOD_DARK : WOOD_MID, 0.08, rnd));
    }
  }

  /* ---- roof: two big slabs, deep overhang, exposed purlins ---- */
  const over = 1.15 + size * 0.35;
  const slope = Math.atan2(roofH, W / 2);
  const slabLen = Math.hypot(W / 2 + over * 0.6, roofH) + 0.3;
  for (const s of [1, -1]) {
    const r = box(slabLen, 0.17, D + over * 2, 0, 0, 0, 0, 0, 0);
    r.rotateZ(-s * slope);          // outboard end drops to the eave
    r.translate(s * (slabLen / 2 - 0.1) * Math.cos(slope),
                base + wallH + roofH - (slabLen / 2) * Math.sin(slope) + 0.06, 0);
    P.roof.push(paint(r, ROOF, 0.06, rnd));
    // shingle courses
    for (let k = 1; k < 5; k++) {
      const t = k / 5;
      const rr = box(0.10, 0.05, D + over * 2, 0, 0, 0);
      rr.rotateZ(-s * slope);
      rr.translate(s * (slabLen * t) * Math.cos(slope),
                   base + wallH + roofH - (slabLen * t) * Math.sin(slope) + 0.14, 0);
      P.roof.push(paint(rr, 0x2b2521, 0.05, rnd));
    }
  }
  P.wood.push(paint(box(0.26, 0.22, D + over * 2 + 0.2, 0, base + wallH + roofH + 0.06, 0), WOOD_DARK, 0.05, rnd));
  for (const s of [1, -1]) {                       // purlins poking out of the gable
    for (const t of [0.35, 0.7]) {
      P.wood.push(paint(log(D + over * 2, 0.09,
        s * (W / 2) * t, base + wallH + roofH * (1 - t) + 0.02, 0, 'z', 6), WOOD_DARK, 0.06, rnd));
    }
  }

  /* ---- balcony under the eaves ---- */
  const balY = base + wallH - (storeys > 1 ? 2.35 : 1.0);
  for (const s of [1, -1]) {
    P.wood.push(paint(box(W + 1.5, 0.12, 1.25, 0, balY, s * (D / 2 + 0.55)), WOOD_WARM, 0.07, rnd));
    P.wood.push(paint(box(W + 1.5, 0.10, 0.09, 0, balY + 0.92, s * (D / 2 + 1.12)), WOOD_DARK, 0.06, rnd));
    P.wood.push(paint(box(W + 1.5, 0.07, 0.07, 0, balY + 0.52, s * (D / 2 + 1.12)), WOOD_DARK, 0.06, rnd));
    const n = Math.round(W / 0.52);
    for (let k = 0; k <= n; k++) {
      const bx = -(W + 1.3) / 2 + k * ((W + 1.3) / n);
      P.wood.push(paint(box(0.075, 0.92, 0.075, bx, balY + 0.46, s * (D / 2 + 1.12)), WOOD_MID, 0.07, rnd));
    }
    for (const bx of [-(W + 1.4) / 2 + 0.2, (W + 1.4) / 2 - 0.2]) {
      P.wood.push(paint(box(0.16, 1.0, 0.16, bx, balY - 0.5, s * (D / 2 + 1.0)), WOOD_DARK, 0.06, rnd));
    }
  }

  /* ---- windows, shutters, flower boxes ---- */
  const winRows = storeys > 1 ? [base + 1.25, base + 3.6] : [base + 1.3];
  for (const wy of winRows) {
    const cols = Math.max(2, Math.round(W / 3.0));
    for (let k = 0; k < cols; k++) {
      const wx = -W / 2 + (W / cols) * (k + 0.5);
      for (const s of [1, -1]) {
        P.glass.push(box(1.0, 1.05, 0.06, wx, wy, s * (D / 2 + 0.06)));
        P.trim.push(box(1.22, 1.26, 0.05, wx, wy, s * (D / 2 + 0.03)));
        for (const sh of [-1, 1]) {
          P.shutter.push(box(0.30, 1.20, 0.05, wx + sh * 0.76, wy, s * (D / 2 + 0.09)));
        }
        P.wood.push(paint(box(1.30, 0.20, 0.26, wx, wy - 0.72, s * (D / 2 + 0.14)), WOOD_DARK, 0.05, rnd));
        P.shutter.push(box(1.16, 0.16, 0.20, wx, wy - 0.62, s * (D / 2 + 0.16)));   // flowers
      }
    }
  }
  // gable-end windows
  for (const s of [1, -1]) {
    P.glass.push(box(0.65, 0.6, 0.06, 0, base + wallH + roofH * 0.35, s * (D / 2 + 0.06)));
    P.trim.push(box(0.82, 0.76, 0.05, 0, base + wallH + roofH * 0.35, s * (D / 2 + 0.03)));
  }

  /* ---- door + steps ---- */
  P.wood.push(paint(box(1.05, 2.05, 0.09, -W / 2 + 1.5, base + 1.02, D / 2 + 0.1), WOOD_DARK, 0.05, rnd));
  P.trim.push(box(1.24, 2.24, 0.05, -W / 2 + 1.5, base + 1.1, D / 2 + 0.05));
  for (let k = 0; k < 3; k++) {
    P.stone.push(box(1.5, 0.16, 0.34 * (k + 1), -W / 2 + 1.5, 0.08 + k * 0.16, D / 2 + 0.6 - k * 0.12));
  }

  /* ---- stone chimney ---- */
  const chX = W / 2 - 1.1;
  P.stone.push(box(0.85, wallH + roofH + 1.2, 0.85, chX, base + (wallH + roofH + 1.2) / 2, -D / 4));
  P.stone.push(box(1.05, 0.18, 1.05, chX, base + wallH + roofH + 1.25, -D / 4));

  /* ---- warm light behind the glass ---- */
  P.lamp.push(box(0.9, 0.95, 0.02, -W / 2 + 1.5, base + 1.0, D / 2 + 0.02));

  return finish(P);
}

/* =========================== BARN =========================== */
export function makeBarn(seed = 9) {
  const rnd = makeRandom(seed);
  const P = { wood: [], roof: [], stone: [], trim: [], glass: [], shutter: [], lamp: [] };
  const W = 8.5 + rnd() * 2, D = 6.5 + rnd() * 1.5, H = 3.4;

  P.stone.push(box(W + 0.4, 0.4, D + 0.4, 0, 0.2, 0));
  // vertical plank walls
  const n = Math.round(W / 0.55);
  for (let k = 0; k <= n; k++) {
    const x = -W / 2 + k * (W / n);
    for (const s of [1, -1]) {
      P.wood.push(paint(box(0.50, H, 0.10, x, 0.4 + H / 2, s * D / 2),
        k % 2 ? WOOD_DARK : WOOD_MID, 0.09, rnd));
    }
  }
  for (const s of [1, -1]) {
    P.wood.push(paint(box(0.10, H, D, s * W / 2, 0.4 + H / 2, 0), WOOD_DARK, 0.07, rnd));
  }
  P.wood.push(paint(box(W, H, D, 0, 0.4 + H / 2, 0), 0x3a2a1c, 0.05, rnd));

  const roofH = 1.9, over = 0.9;
  const slope = Math.atan2(roofH, W / 2);
  const slabLen = Math.hypot(W / 2 + over * 0.5, roofH) + 0.2;
  for (const s of [1, -1]) {
    const r = box(slabLen, 0.16, D + over * 2, 0, 0, 0);
    r.rotateZ(-s * slope);
    r.translate(s * (slabLen / 2 - 0.08) * Math.cos(slope),
                0.4 + H + roofH - (slabLen / 2) * Math.sin(slope) + 0.05, 0);
    P.roof.push(paint(r, 0x4a3b2c, 0.07, rnd));
  }
  // big sliding door
  P.wood.push(paint(box(3.0, 2.6, 0.12, 0, 0.4 + 1.3, D / 2 + 0.09), 0x6b4a2c, 0.06, rnd));
  P.trim.push(box(3.2, 0.14, 0.16, 0, 0.4 + 2.68, D / 2 + 0.12));
  // hay under the eave
  P.shutter.push(box(2.2, 0.9, 1.4, W / 2 - 1.6, 0.85, -D / 2 - 0.9));

  return finish(P);
}

/* =================== SMALL PROPS =================== */
export function makeWoodPile(seed = 21) {
  const rnd = makeRandom(seed);
  const P = { wood: [], roof: [], stone: [], trim: [], glass: [], shutter: [], lamp: [] };
  const rows = 4, cols = 7;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const y = 0.16 + r * 0.30;
      const x = -cols * 0.16 + c * 0.32 + (r % 2) * 0.06;
      P.wood.push(paint(log(1.6, 0.145, x, y, 0, 'z', 6), r % 2 ? WOOD_MID : WOOD_WARM, 0.12, rnd));
    }
  }
  for (const s of [-1, 1]) {
    P.wood.push(paint(box(0.12, 1.5, 0.12, s * (cols * 0.17), 0.75, 0.7), WOOD_DARK, 0.06, rnd));
    P.wood.push(paint(box(0.12, 1.5, 0.12, s * (cols * 0.17), 0.75, -0.7), WOOD_DARK, 0.06, rnd));
  }
  return finish(P);
}

export function makeFence(seed = 33) {
  const rnd = makeRandom(seed);
  const P = { wood: [], roof: [], stone: [], trim: [], glass: [], shutter: [], lamp: [] };
  // one 4 m section of split-rail fence
  P.wood.push(paint(box(0.14, 1.15, 0.14, -2, 0.58, 0), WOOD_DARK, 0.08, rnd));
  P.wood.push(paint(box(0.14, 1.15, 0.14, 2, 0.58, 0), WOOD_DARK, 0.08, rnd));
  for (const y of [0.42, 0.78]) {
    P.wood.push(paint(box(4.0, 0.10, 0.09, 0, y, 0), WOOD_MID, 0.09, rnd));
  }
  P.wood.push(paint(box(4.4, 0.09, 0.09, 0, 0.6, 0, 0, 0, 0.16), WOOD_WARM, 0.09, rnd));
  return finish(P);
}

export function makeWell(seed = 44) {
  const rnd = makeRandom(seed);
  const P = { wood: [], roof: [], stone: [], trim: [], glass: [], shutter: [], lamp: [] };
  const ring = new THREE.CylinderGeometry(0.95, 1.05, 0.85, 12, 1, true);
  ring.translate(0, 0.42, 0);
  P.stone.push(paint(ring, STONE, 0.1, rnd));
  P.stone.push(paint(box(2.3, 0.12, 2.3, 0, 0.9, 0), STONE, 0.06, rnd));
  for (const s of [-1, 1]) P.wood.push(paint(box(0.14, 1.7, 0.14, s * 0.85, 1.75, 0), WOOD_DARK, 0.06, rnd));
  P.wood.push(paint(log(2.2, 0.09, 0, 2.55, 0, 'x', 6), WOOD_MID, 0.06, rnd));
  const r1 = box(1.35, 0.13, 1.0, -0.45, 2.9, 0, 0, 0, 0.62);
  const r2 = box(1.35, 0.13, 1.0, 0.45, 2.9, 0, 0, 0, -0.62);
  P.roof.push(paint(r1, ROOF, 0.06, rnd));
  P.roof.push(paint(r2, ROOF, 0.06, rnd));
  P.wood.push(paint(box(0.45, 0.4, 0.45, 0, 1.95, 0), WOOD_WARM, 0.06, rnd));
  return finish(P);
}

export function makeLamp(seed = 55) {
  const rnd = makeRandom(seed);
  const P = { wood: [], roof: [], stone: [], trim: [], glass: [], shutter: [], lamp: [] };
  P.stone.push(paint(box(0.42, 0.22, 0.42, 0, 0.11, 0), STONE, 0.06, rnd));
  P.wood.push(paint(box(0.16, 3.1, 0.16, 0, 1.65, 0), WOOD_DARK, 0.05, rnd));
  P.trim.push(box(0.34, 0.05, 0.34, 0, 3.24, 0));
  P.lamp.push(box(0.26, 0.34, 0.26, 0, 3.44, 0));
  const cap = new THREE.ConeGeometry(0.30, 0.26, 4);
  cap.rotateY(Math.PI / 4);
  cap.translate(0, 3.74, 0);
  P.roof.push(paint(cap, ROOF, 0.05, rnd));
  return finish(P);
}

/* Every part has to carry the exact same attribute set or mergeGeometries
   refuses. The hand-built gable triangles have no uv, the primitives do —
   so level them all up before merging. */
function normalise(g) {
  const n = g.attributes.position.count;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!g.attributes.color) paint(g, 0xffffff, 0);
  return g.index ? g.toNonIndexed() : g;
}

/* ---- merge each material bucket into one geometry ---- */
function finish(P) {
  const out = {};
  for (const k in P) {
    if (!P[k].length) continue;
    const parts = P[k].map(normalise);
    const g = mergeGeometries(parts, false);
    if (!g) { console.warn('village: could not merge', k); continue; }
    g.computeVertexNormals();
    out[k] = g;
  }
  return out;
}

/* =========================== LIBRARY =========================== */
export function buildVillageLibrary() {
  const mk = (extra = {}) => new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.86, metalness: 0.0, side: THREE.DoubleSide, ...extra
  });
  const mats = {
    wood:    mk({ color: 0xffffff, roughness: 0.9 }),
    roof:    mk({ color: 0xffffff, roughness: 0.78 }),
    stone:   mk({ color: 0xffffff, roughness: 0.95 }),
    trim:    mk({ color: TRIM, vertexColors: false, roughness: 0.7 }),
    shutter: mk({ color: SHUTTER, vertexColors: false, roughness: 0.72 }),
    glass:   new THREE.MeshPhysicalMaterial({
      color: 0x101820, roughness: 0.08, metalness: 0, transparent: true,
      opacity: 0.72, envMapIntensity: 1.6, side: THREE.DoubleSide
    }),
    lamp:    new THREE.MeshStandardMaterial({
      color: 0xffe6b0, emissive: 0xffb861, emissiveIntensity: 0.0,
      roughness: 0.4, metalness: 0, side: THREE.DoubleSide
    })
  };

  return {
    mats,
    chalet: [makeChalet(3, 0.25), makeChalet(17, 0.7), makeChalet(29, 0.5), makeChalet(41, 0.9)],
    barn: [makeBarn(9), makeBarn(23)],
    pile: [makeWoodPile(21)],
    fence: [makeFence(33)],
    well: [makeWell(44)],
    lamp: [makeLamp(55)]
  };
}

/* =========================== MANAGER =========================== */
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

export class Villages {
  constructor(scene, quality, lib) {
    this.scene = scene;
    this.q = quality;
    this.lib = lib;
    this.active = new Map();
    this.range = Math.min(2400, quality.viewRadius * 512 * 0.92);
    this.centre = { x: 1e9, z: 1e9 };
    this.night = 0;
  }

  update(x, z) {
    if (Math.abs(x - this.centre.x) < 220 && Math.abs(z - this.centre.z) < 220) return;
    this.centre.x = x; this.centre.z = z;

    const near = villagesNear(x, z, this.range);
    const want = new Set();
    for (const v of near) {
      const key = v.seed;
      want.add(key);
      if (!this.active.has(key)) this.build(v, key);
    }
    for (const [key, rec] of this.active) {
      if (!want.has(key)) {
        this.scene.remove(rec.group);
        for (const im of rec.meshes) im.dispose();
        this.active.delete(key);
      }
    }
  }

  /** Lay a village out along a gently curved main street. */
  build(v, key) {
    const rnd = makeRandom(v.seed || 1);
    const group = new THREE.Group();
    const buckets = {};                  // family -> array of matrices
    const push = (fam, m) => (buckets[fam] || (buckets[fam] = [])).push(m.clone());

    const streetDir = rnd() * 6.283;
    const bend = (rnd() - 0.5) * 0.5;
    const half = v.r * 0.62;
    const nPlots = 5 + Math.floor(rnd() * 6);

    // plots down both sides of the street
    for (let i = 0; i < nPlots; i++) {
      const t = (i / Math.max(1, nPlots - 1) - 0.5) * 2;         // -1 .. 1
      const along = t * half;
      const ang = streetDir + bend * t;
      const sx = v.cx + Math.cos(ang) * along;
      const sz = v.cz + Math.sin(ang) * along;
      for (const side of [-1, 1]) {
        if (rnd() < 0.22) continue;                              // a few gaps
        const off = 13 + rnd() * 7;
        const px = sx + Math.cos(ang + Math.PI / 2) * off * side;
        const pz = sz + Math.sin(ang + Math.PI / 2) * off * side;
        if (Math.hypot(px - v.cx, pz - v.cz) > v.r * 0.9) continue;

        // face the street
        const face = ang + (side > 0 ? -Math.PI / 2 : Math.PI / 2) + (rnd() - 0.5) * 0.14;
        _p.set(px, heightAt(px, pz) - 0.12, pz);
        _q.setFromAxisAngle(AXIS_Y, face);
        _s.setScalar(0.96 + rnd() * 0.16);
        _m.compose(_p, _q, _s);

        const barn = rnd() < 0.22;
        push(barn ? 'barn' : 'chalet', _m);

        // a log pile and some fence against the plot
        if (rnd() < 0.6) {
          const a2 = face + 1.2 + rnd();
          _p.set(px + Math.cos(a2) * 6.5, heightAt(px, pz) - 0.1, pz + Math.sin(a2) * 6.5);
          _q.setFromAxisAngle(AXIS_Y, face + (rnd() - 0.5));
          _s.setScalar(1);
          _m.compose(_p, _q, _s);
          push('pile', _m);
        }
        if (rnd() < 0.75) {
          for (let f = -1; f <= 1; f++) {
            const fa = ang;
            const fx = px + Math.cos(fa) * f * 4.2 + Math.cos(fa + Math.PI / 2) * 8 * side;
            const fz = pz + Math.sin(fa) * f * 4.2 + Math.sin(fa + Math.PI / 2) * 8 * side;
            _p.set(fx, heightAt(fx, fz) - 0.05, fz);
            _q.setFromAxisAngle(AXIS_Y, fa);
            _s.setScalar(1);
            _m.compose(_p, _q, _s);
            push('fence', _m);
          }
        }
      }
    }

    // a well in the middle and lamps down the street
    _p.set(v.cx, heightAt(v.cx, v.cz) - 0.1, v.cz);
    _q.setFromAxisAngle(AXIS_Y, rnd() * 6.283);
    _s.setScalar(1);
    _m.compose(_p, _q, _s);
    push('well', _m);

    for (let i = -2; i <= 2; i++) {
      const along = (i / 2) * half * 0.85;
      const ang = streetDir + bend * (i / 2);
      const lx = v.cx + Math.cos(ang) * along + Math.cos(ang + Math.PI / 2) * 5.5;
      const lz = v.cz + Math.sin(ang) * along + Math.sin(ang + Math.PI / 2) * 5.5;
      _p.set(lx, heightAt(lx, lz) - 0.05, lz);
      _q.setFromAxisAngle(AXIS_Y, 0);
      _s.setScalar(1);
      _m.compose(_p, _q, _s);
      push('lamp', _m);
    }

    /* ---- instance it ---- */
    const meshes = [];
    for (const fam in buckets) {
      const list = buckets[fam];
      const variants = this.lib[fam];
      if (!variants || !list.length) continue;
      const geoSet = variants[Math.floor(rnd() * variants.length)];
      for (const matKey in geoSet) {
        const im = new THREE.InstancedMesh(geoSet[matKey], this.lib.mats[matKey], list.length);
        for (let i = 0; i < list.length; i++) im.setMatrixAt(i, list[i]);
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = matKey !== 'glass' && matKey !== 'lamp';
        im.receiveShadow = matKey !== 'glass';
        im.computeBoundingSphere();
        group.add(im);
        meshes.push(im);
      }
    }

    group.name = 'village';
    this.scene.add(group);
    this.active.set(key, { group, meshes, v });
  }

  /** Windows and street lamps glow after dark. */
  setNight(n) {
    this.night = n;
    const m = this.lib.mats.lamp;
    m.emissiveIntensity = 0.05 + n * 3.2;
    this.lib.mats.glass.emissive = this.lib.mats.glass.emissive || new THREE.Color();
    this.lib.mats.glass.emissive.setRGB(0.55 * n, 0.36 * n, 0.14 * n);
    this.lib.mats.glass.emissiveIntensity = n * 0.9;
  }
}
