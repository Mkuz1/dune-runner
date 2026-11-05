/* ------------------------------------------------------------------
   trees.js — photo-card trees.

   The old trees were solid shapes: stacked cones for pines, lumpy
   spheres for broadleaf crowns. No texture makes a sphere read as a
   tree, so foliage is now built the way game engines do it — from many
   small alpha-tested cards carrying photographed twigs and leaves
   (Poly Haven, CC0), hung on a real trunk-and-branch structure:

     pine      whorls of drooping branches, each a V of twig cards so
               it reads from the side and from above
     birch     forked limbs ending in clusters of leaf cards
     acacia    flat umbrella canopy of mostly-horizontal leaf cards
     bush      low leaf-card clusters

   Two tricks make cards look like foliage rather than paper:
     • bent normals — every card's normal is pulled towards "outward from
       the crown", so the crown shades as one soft volume (lit side,
       shadow side) instead of a scatter of flat planes;
     • mip-aware alpha — alpha coverage shrinks in the smaller mip levels,
       which makes distant trees go thin and see-through; the shader
       boosts alpha with the mip level to keep their density.

   Each tree is returned as { multi: [[geometry, materialKey], …] } so
   the terrain scatter can draw the trunk (bark material) and the cards
   (foliage material) as two instanced meshes sharing the same transforms.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';
import { mergeGeometries } from '../libs/three/addons/utils/BufferGeometryUtils.js';
import { makeRandom } from './noise.js';

/* Sub-rectangles of the atlases, in image space (y down), measured from
   the alpha masks. Twigs have their stem at the bottom edge. */
const TWIGS = [
  { x0: 0.316, y0: 0.406, x1: 0.637, y1: 0.773 },
  { x0: 0.645, y0: 0.465, x1: 0.949, y1: 0.828 },
  { x0: 0.660, y0: 0.055, x1: 0.934, y1: 0.367 },
  { x0: 0.215, y0: 0.055, x1: 0.414, y1: 0.313 }
];
const LEAVES = [
  { x0: 0.023, y0: 0.281, x1: 0.539, y1: 0.750 },
  { x0: 0.000, y0: 0.000, x1: 0.383, y1: 0.297 }
];
const aspect = (r) => (r.x1 - r.x0) / (r.y1 - r.y0);

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

/* ------------------------------------------------------------ cards */
class Cards {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }

  /**
   * One card, two segments long so it can droop.
   *   base   stem position          L  unit vector along the card (stem → tip)
   *   S      unit vector across     len / wid  size in metres
   *   bend   (pos, cardNormal) → shading normal (written into `out`)
   *   ao     brightness at the tip; the stem end is a little darker
   *   droop  metres the tip sags
   */
  card(base, L, S, len, wid, rect, bend, ao, droop = 0, tint = null, segs = 2) {
    const N = _n.crossVectors(S, L).normalize();
    const i0 = this.p.length / 3;
    const out = new THREE.Vector3();
    for (let row = 0; row <= segs; row++) {
      const t = row / segs;
      for (let col = 0; col <= 1; col++) {
        const sx = col - 0.5;
        const px = base.x + S.x * sx * wid + L.x * t * len;
        const py = base.y + S.y * sx * wid + L.y * t * len - droop * t * t;
        const pz = base.z + S.z * sx * wid + L.z * t * len;
        this.p.push(px, py, pz);
        bend(_a.set(px, py, pz), N, out);
        this.n.push(out.x, out.y, out.z);
        this.uv.push(
          col ? rect.x1 : rect.x0,
          1 - (rect.y1 + (rect.y0 - rect.y1) * t)       // flipY: v = 1 - y
        );
        const k = ao * (0.78 + 0.22 * t);
        if (tint) this.c.push(k * tint[0], k * tint[1], k * tint[2]);
        else this.c.push(k, k, k);
      }
    }
    for (let r = 0; r < segs; r++) {
      const a = i0 + r * 2;
      this.i.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

/** Unit vector perpendicular to v, rotated `roll` radians about v. */
function perp(v, roll, out) {
  const ref = Math.abs(v.y) < 0.9 ? UP : _b.set(1, 0, 0);
  out.crossVectors(v, ref).normalize();
  return out.applyAxisAngle(v, roll);
}

/* ------------------------------------------------------------ bark parts */
function paint(geo, hex, jitter, rnd) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(hex);
  const pos = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    const k = (1 + (rnd() - 0.5) * jitter * 2) * (0.82 + Math.min(1, Math.max(0, (pos.getY(i) + 1) * 0.16)) * 0.28);
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function limb(r0, r1, len, seg, from, dir, hex, rnd) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  g.applyQuaternion(q);
  g.translate(from.x, from.y, from.z);
  return paint(g, hex, 0.12, rnd);
}

function finish(parts) {
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

/* ================================================================ PINE */
export function makePineCards(seed, detail) {
  const rnd = makeRandom(seed);
  const h = 11 + rnd() * 7;
  const bark = [];
  const cards = new Cards();

  // trunk with a slight lean, and a root flare
  const lean = new THREE.Vector3((rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.12).normalize();
  bark.push(limb(0.36, 0.06, h, detail ? 9 : 6, new THREE.Vector3(0, -0.2, 0), lean, 0x4a3524, rnd));
  const flare = new THREE.ConeGeometry(0.7, 1.0, detail ? 9 : 6, 1);
  flare.translate(0, 0.35, 0);
  bark.push(paint(flare, 0x453120, 0.12, rnd));

  const crownBase = h * (0.16 + rnd() * 0.08);
  const whorls = detail ? 18 : 11;
  const axisAt = (y) => lean.clone().multiplyScalar(y / lean.y);

  // shading normal: out from the trunk axis and a little up
  const bend = (p, N, out) => {
    const ax = axisAt(p.y);
    _b.set(p.x - ax.x, 0, p.z - ax.z);
    const r = _b.length() || 1;
    _b.multiplyScalar(1 / r);
    out.copy(N);
    if (out.dot(_b) + out.y * 0.5 < 0) out.negate();
    out.multiplyScalar(0.3).addScaledVector(_b, 0.62).addScaledVector(UP, 0.42).normalize();
  };

  for (let i = 0; i < whorls; i++) {
    const t = i / (whorls - 1);
    const y = crownBase + (h - crownBase - 0.6) * Math.pow(t, 0.9);
    const reach = (3.2 - 2.75 * t) * (0.85 + rnd() * 0.3);
    const n = Math.max(3, Math.round((detail ? 7 : 5) - t * 3 + rnd()));
    const ax = axisAt(y);
    const lightLevel = 0.62 + 0.38 * t;               // lower whorls sit in shade

    for (let b = 0; b < n; b++) {
      const a = (b / n) * Math.PI * 2 + i * 2.4 + rnd() * 0.5;
      const droopAng = 0.10 + 0.32 * (1 - t) + rnd() * 0.12;
      const dir = new THREE.Vector3(Math.cos(a), -droopAng, Math.sin(a)).normalize();
      const L = reach * (0.75 + rnd() * 0.35);
      const from = ax.clone().add(new THREE.Vector3(0, y - ax.y, 0));

      // a visible branch near the trunk where the needles thin out
      if (detail && t < 0.7 && rnd() < 0.55) {
        bark.push(limb(0.06, 0.02, L * 0.55, 4, from, dir, 0x3e2c1d, rnd));
      }

      // two or three twig cards along the branch, each a V of two
      const segs = L > 2.2 ? 3 : L > 1.2 ? 2 : 1;
      for (let s = 0; s < segs; s++) {
        const start = s === 0 ? 0.05 : s / segs - 0.08;
        const base = from.clone().addScaledVector(dir, L * start);
        const len = L * (s === 0 ? 0.72 : 0.6) * (0.9 + rnd() * 0.2);
        const rect = TWIGS[(b + s + i) % (detail ? 4 : 2)];
        const wid = len * aspect(rect) * 1.05;
        const lit = lightLevel * (0.82 + 0.18 * (start + 0.5));
        for (const roll of [0.55, -0.55]) {
          const S = perp(dir, roll + (rnd() - 0.5) * 0.4, new THREE.Vector3());
          cards.card(base, dir, S, len, wid, rect, bend, lit, len * 0.14);
        }
      }
    }
  }

  // leader at the top: a few upright twigs around the tip
  const tip = axisAt(h - 0.9).add(new THREE.Vector3(0, h - 0.9 - axisAt(h - 0.9).y, 0));
  for (let k = 0; k < 2; k++) {
    const dir = new THREE.Vector3((rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.12).normalize();
    const S = perp(dir, k * Math.PI / 2 + rnd() * 0.3, new THREE.Vector3());
    cards.card(tip, dir, S, 1.1, 1.1 * aspect(TWIGS[3]) * 0.7, TWIGS[3], bend, 1.0, 0.0);
  }

  return { multi: [[finish(bark), 'foliageMat'], [cards.geometry(), 'pineCardMat']] };
}

/* ========================================================= LEAF CLUSTERS */
/** Scatter leaf cards through an ellipsoid (centre c, radius r, squash sy). */
function cluster(cards, rnd, c, r, sy, count, size, upBias, tint) {
  const bend = (p, N, out) => {
    _b.set((p.x - c.x) / r, (p.y - c.y) / (r * sy), (p.z - c.z) / r);
    const d = _b.length() || 1;
    _b.multiplyScalar(1 / d);
    out.copy(N);
    if (out.dot(_b) < 0) out.negate();
    out.multiplyScalar(0.28).addScaledVector(_b, 0.72).addScaledVector(UP, 0.18).normalize();
  };
  for (let k = 0; k < count; k++) {
    // a random direction, biased upward, and a depth inside the crown
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(s * Math.cos(th), u * 0.8 + upBias, s * Math.sin(th)).normalize();
    const depth = 0.38 + 0.62 * Math.sqrt(rnd());
    const p = new THREE.Vector3(c.x + dir.x * r * depth, c.y + dir.y * r * sy * depth, c.z + dir.z * r * depth);

    // card faces roughly outward, at a random spin
    const N = dir.clone().lerp(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5 + upBias, rnd() - 0.5), 0.5).normalize();
    const L = perp(N, rnd() * Math.PI * 2, new THREE.Vector3());
    const S = new THREE.Vector3().crossVectors(L, N).normalize();
    const rect = LEAVES[k % 3 === 2 ? 1 : 0];
    const len = size * (0.8 + rnd() * 0.4);
    const wid = len * aspect(rect);
    const base = p.clone().addScaledVector(L, -len * 0.5);
    // inside of the crown and its underside are darker
    const lower = Math.min(1, Math.max(0, 0.5 + (p.y - c.y) / (r * sy) * 0.5));
    const ao = (0.42 + 0.58 * depth) * (0.72 + 0.28 * lower);
    cards.card(base, L, S, len, wid, rect, bend, ao, 0, tint, 1);
  }
}

/* =============================================================== BIRCH */
export function makeBirchCards(seed, detail) {
  const rnd = makeRandom(seed);
  const h = 8.5 + rnd() * 4;
  const bark = [];
  const cards = new Cards();
  const per = detail ? 60 : 30;

  bark.push(limb(0.30, 0.10, h * 0.8, detail ? 8 : 6, new THREE.Vector3(0, -0.2, 0), UP, 0x9a9384, rnd));

  const limbs = 5 + Math.floor(rnd() * 2);
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rnd() * 0.7;
    const len = 2.6 + rnd() * 1.6;
    const tilt = 0.5 + rnd() * 0.4;
    const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
    const from = new THREE.Vector3(0, h * (0.42 + (i / limbs) * 0.25 + rnd() * 0.06), 0);
    bark.push(limb(0.12, 0.04, len, 5, from, dir, 0x8d8676, rnd));
    const tipP = from.clone().addScaledVector(dir, len * 0.8);
    cluster(cards, rnd, tipP.add(new THREE.Vector3(0, 0.3, 0)), 1.7 + rnd() * 0.7, 0.8, per, 0.62, 0.15, null);
  }
  cluster(cards, rnd, new THREE.Vector3(0, h * 0.86, 0), 2.1 + rnd() * 0.5, 0.85, per + 12, 0.62, 0.25, null);

  return { multi: [[finish(bark), 'foliageMat'], [cards.geometry(), 'leafCardMat']] };
}

/* ============================================================== ACACIA */
export function makeAcaciaCards(seed, detail) {
  const rnd = makeRandom(seed);
  const h = 4.6 + rnd() * 2.4;
  const bark = [];
  const cards = new Cards();
  const per = detail ? 80 : 40;

  bark.push(limb(0.40, 0.17, h * 0.8, 6, new THREE.Vector3(0, -0.2, 0), UP, 0x59452e, rnd));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6 + rnd() * 0.4;
    const dir = new THREE.Vector3(Math.cos(a) * 0.75, 1, Math.sin(a) * 0.75).normalize();
    const from = new THREE.Vector3(0, h * 0.62, 0);
    const len = h * 0.55;
    bark.push(limb(0.15, 0.06, len, 5, from, dir, 0x59452e, rnd));
    const c = from.clone().addScaledVector(dir, len);
    c.y += 0.35;
    // flat umbrella: wide and squashed, cards mostly horizontal
    cluster(cards, rnd, c, 2.2 + rnd() * 0.8, 0.36, per, 0.7, 0.65, [0.93, 0.95, 0.80]);
  }
  return { multi: [[finish(bark), 'foliageMat'], [cards.geometry(), 'leafCardMat']] };
}

/* ================================================================ BUSH */
export function makeBushCards(seed, dry, detail) {
  const rnd = makeRandom(seed);
  const cards = new Cards();
  const tint = dry ? [1.05, 0.88, 0.55] : null;
  const blobs = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < blobs; i++) {
    const r = 0.55 + rnd() * 0.65;
    const c = new THREE.Vector3((rnd() - 0.5) * 1.5, r * 0.72 + rnd() * 0.3, (rnd() - 0.5) * 1.5);
    cluster(cards, rnd, c, r, 0.82, detail ? 26 : 14, 0.5 + r * 0.25, 0.2, tint);
  }
  return { multi: [[cards.geometry(), 'leafCardMat']] };
}

/* ============================================================ MATERIAL */
/**
 * Alpha-tested, double-sided foliage. `addWind` (from props.js) is applied
 * first by the caller; this wraps it.
 */
export function makeCardMaterial(colorTex, alphaTex) {
  const mat = new THREE.MeshStandardMaterial({
    map: colorTex, alphaMap: alphaTex, alphaTest: 0.5,
    side: THREE.DoubleSide, vertexColors: true,
    roughness: 0.88, metalness: 0.0,
    envMapIntensity: 0.45          // needles and leaves are not glossy
  });
  return mat;
}

/** Shader tweaks for card foliage; chain after the wind patch. */
export function patchCardMaterial(mat) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  const normalBegin = THREE.ShaderChunk.normal_fragment_begin
    .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');

  mat.onBeforeCompile = (sh, renderer) => {
    if (prev) prev.call(mat, sh, renderer);
    sh.fragmentShader = sh.fragmentShader
      // bent normals already point the right way on both faces
      .replace('#include <normal_fragment_begin>', normalBegin)
      // keep distant foliage dense: boost alpha with the mip level
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
        #ifdef USE_ALPHAMAP
          vec2 dUx = dFdx( vAlphaMapUv * 1024.0 ), dUy = dFdy( vAlphaMapUv * 1024.0 );
          float mipL = max( 0.0, 0.5 * log2( max( dot( dUx, dUx ), dot( dUy, dUy ) ) ) );
          diffuseColor.a *= 1.0 + mipL * 0.28;
        #endif`)
      // a little light through the leaves when looking towards the sun
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * 0.035;`);
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '_cards';
  return mat;
}
