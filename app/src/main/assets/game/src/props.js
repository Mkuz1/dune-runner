/* ------------------------------------------------------------------
   props.js — procedural vegetation & rock geometry.

   Every prop is baked once into a single vertex-coloured BufferGeometry
   so the whole forest can be drawn with a handful of InstancedMesh
   calls. No textures, no alpha sorting, no popping.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';
import { mergeGeometries } from '../libs/three/addons/utils/BufferGeometryUtils.js';
import { makeRandom } from './noise.js';

const C = new THREE.Color();

function paint(geo, hex, jitter = 0.06, rnd = Math.random) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const pos = geo.attributes.position;
  C.set(hex);
  for (let i = 0; i < n; i++) {
    // vertical gradient + per-vertex jitter = free ambient occlusion feel
    const y = pos.getY(i);
    const j = 1 + (rnd() - 0.5) * jitter * 2;
    const k = j * (0.82 + Math.min(1, Math.max(0, (y + 1) * 0.16)) * 0.28);
    col[i * 3] = C.r * k;
    col[i * 3 + 1] = C.g * k;
    col[i * 3 + 2] = C.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function tr(geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  geo.scale(sx, sy, sz);
  if (rx) geo.rotateX(rx);
  if (rz) geo.rotateZ(rz);
  if (ry) geo.rotateY(ry);
  geo.translate(x, y, z);
  return geo;
}

/** Push vertices in and out along their normals so a sphere stops looking
    like a sphere. This is what turns blob canopies into foliage. */
function lumpy(geo, amount = 0.22, freq = 2.2, rnd = Math.random) {
  const p = geo.attributes.position;
  const seed = rnd() * 100;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const n =
      Math.sin(x * freq + seed) * Math.cos(z * freq * 1.31 - seed) +
      Math.sin(y * freq * 1.7 + seed * 2.1) * 0.6;
    const k = 1 + n * amount * 0.5;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/* ---------------------------------------------------------------- PINE
   Tapered trunk, eight foliage tiers that get smaller and droop as they
   go up, plus individual branch fans poking through the silhouette so
   the outline is ragged instead of a stack of clean cones. */
export function makePine(seed = 7, detail = 1) {
  const rnd = makeRandom(seed);
  const parts = [];
  const h = 10 + rnd() * 7;
  const seg = detail > 0 ? 9 : 6;

  // trunk, visibly tapered, with a slight lean
  const trunk = new THREE.CylinderGeometry(0.10, 0.40, h * 0.96, seg, 3);
  const tp = trunk.attributes.position;
  const lean = (rnd() - 0.5) * 0.10;
  for (let i = 0; i < tp.count; i++) {
    const t = (tp.getY(i) + h * 0.48) / (h * 0.96);
    tp.setX(i, tp.getX(i) + lean * t * t * h * 0.5);
  }
  trunk.translate(0, h * 0.48, 0);
  parts.push(paint(trunk, 0x4a3524, 0.13, rnd));

  // root flare
  const flare = new THREE.ConeGeometry(0.72, 1.0, seg, 1);
  flare.translate(0, 0.42, 0);
  parts.push(paint(flare, 0x453120, 0.12, rnd));

  const tiers = detail > 0 ? 8 : 5;
  let y = h * 0.20;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = (3.1 - t * 2.45) * (0.88 + rnd() * 0.3);
    const ch = 3.0 - t * 0.9;
    const cone = new THREE.ConeGeometry(r, ch, detail > 0 ? 9 : 6, 2);

    // droop the skirt of each tier so the branches hang
    const p = cone.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const yy = p.getY(v);
      const rad = Math.hypot(p.getX(v), p.getZ(v));
      p.setY(v, yy - Math.pow(rad / Math.max(r, 0.01), 2) * ch * 0.34);
    }
    cone.translate(0, y + ch * 0.44, 0);
    cone.rotateY(rnd() * 6.283);
    const tone = i % 2 ? 0x2b5c2c : 0x37703a;
    parts.push(paint(cone, t > 0.82 ? 0x458549 : tone, 0.17, rnd));

    // a couple of loose branches sticking out of this tier
    if (detail > 0 && i < tiers - 1) {
      const n = 2 + Math.floor(rnd() * 2);
      for (let b = 0; b < n; b++) {
        const a = rnd() * 6.283;
        const bl = r * (0.55 + rnd() * 0.5);
        const br = new THREE.ConeGeometry(0.34 + rnd() * 0.2, bl, 5, 1);
        br.rotateZ(Math.PI / 2 + 0.32);
        br.rotateY(a);
        br.translate(Math.cos(a) * r * 0.62, y + ch * 0.34 + rnd() * 0.5, Math.sin(a) * r * 0.62);
        parts.push(paint(br, 0x2f6130, 0.2, rnd));
      }
    }
    y += ch * 0.50;
  }

  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

/* --------------------------------------------------------------- BIRCH
   A broadleaf with a real forked branch structure, for variety in the
   mixed woodland. */
export function makeBirch(seed = 101) {
  const rnd = makeRandom(seed);
  const parts = [];
  const h = 7.5 + rnd() * 4;

  const trunk = new THREE.CylinderGeometry(0.13, 0.32, h * 0.72, 7, 2);
  trunk.translate(0, h * 0.36, 0);
  parts.push(paint(trunk, 0x9a9384, 0.09, rnd));

  const limbs = 4 + Math.floor(rnd() * 2);
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * 6.283 + rnd() * 0.7;
    const len = 2.2 + rnd() * 1.5;
    const tilt = 0.62 + rnd() * 0.35;
    const br = new THREE.CylinderGeometry(0.05, 0.13, len, 5, 1);
    br.translate(0, len * 0.5, 0);
    br.rotateZ(tilt);
    br.rotateY(a);
    br.translate(0, h * 0.62 + rnd() * 0.8, 0);
    parts.push(paint(br, 0x8d8676, 0.1, rnd));

    // leaf cluster at the tip
    const lx = Math.cos(a) * Math.sin(tilt) * len * 0.92;
    const lz = -Math.sin(a) * Math.sin(tilt) * len * 0.92;
    const ly = h * 0.62 + Math.cos(tilt) * len * 0.92 + 0.4;
    for (let k = 0; k < 2; k++) {
      const r = 1.25 + rnd() * 0.75;
      const s = lumpy(new THREE.SphereGeometry(r, 9, 7), 0.34, 2.6, rnd);
      tr(s, lx + (rnd() - 0.5) * 1.1, ly + (rnd() - 0.5) * 0.9, lz + (rnd() - 0.5) * 1.1,
        0, 0, 0, 1, 0.78, 1);
      parts.push(paint(s, k % 2 ? 0x4f7a34 : 0x63913f, 0.19, rnd));
    }
  }
  // crown
  const crown = lumpy(new THREE.SphereGeometry(1.7 + rnd() * 0.5, 10, 7), 0.32, 2.2, rnd);
  tr(crown, 0, h * 0.92, 0, 0, 0, 0, 1, 0.8, 1);
  parts.push(paint(crown, 0x58852f, 0.17, rnd));

  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

/* -------------------------------------------------------------- ACACIA */
export function makeAcacia(seed = 11) {
  const rnd = makeRandom(seed);
  const parts = [];
  const h = 4.6 + rnd() * 2.4;

  const trunk = new THREE.CylinderGeometry(0.18, 0.42, h, 6, 1);
  trunk.translate(0, h * 0.5, 0);
  parts.push(paint(trunk, 0x59452e, 0.12, rnd));

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rnd();
    const br = new THREE.CylinderGeometry(0.07, 0.15, h * 0.55, 5, 1);
    tr(br, Math.cos(a) * 0.9, h * 0.85, Math.sin(a) * 0.9, 0, 0, Math.cos(a) * 0.5);
    parts.push(paint(br, 0x59452e, 0.12, rnd));
  }

  // flat-topped canopy: 3 squashed spheres
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    const r = 2.1 + rnd() * 0.9;
    const cap = lumpy(new THREE.SphereGeometry(r, 9, 6), 0.30, 1.9, rnd);
    tr(cap, Math.cos(a) * 1.5, h + 0.5 + rnd() * 0.3, Math.sin(a) * 1.5, 0, 0, 0, 1, 0.4, 1);
    parts.push(paint(cap, i % 2 ? 0x50692c : 0x5e7833, 0.15, rnd));
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------------- PALM */
export function makePalm(seed = 23) {
  const rnd = makeRandom(seed);
  const parts = [];
  const h = 7 + rnd() * 4;
  const lean = 0.16 + rnd() * 0.18;

  // curved trunk built from stacked segments
  const segs = 7;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const sh = h / segs;
    const seg = new THREE.CylinderGeometry(0.20 - t * 0.07, 0.26 - t * 0.07, sh * 1.06, 6, 1);
    const bend = lean * t * t * h;
    tr(seg, bend, sh * (i + 0.5), 0, 0, 0, -lean * t * 0.9);
    parts.push(paint(seg, 0x6b563c, 0.14, rnd));
  }

  const topX = lean * h, topY = h;
  const fronds = 9;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rnd() * 0.3;
    const droop = 0.55 + rnd() * 0.5;
    const len = 3.4 + rnd() * 1.5;
    const shape = new THREE.PlaneGeometry(len, 0.95, 4, 1);
    // taper + droop the frond
    const p = shape.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v) + len / 2;         // 0..len
      const t = x / len;
      p.setY(v, p.getY(v) * (1 - t * 0.82) * (1 - Math.abs(p.getY(v)) * 0.1));
      p.setZ(v, -t * t * len * droop * 0.5);
    }
    shape.translate(len / 2, 0, 0);
    shape.rotateX(-Math.PI / 2);
    shape.rotateY(a);
    shape.translate(topX, topY + 0.25, 0);
    parts.push(paint(shape, i % 2 ? 0x3d7a35 : 0x4a8c3c, 0.14, rnd));
  }

  // coconut cluster
  const nuts = new THREE.SphereGeometry(0.28, 6, 4);
  nuts.translate(topX + 0.2, topY - 0.15, 0.15);
  parts.push(paint(nuts, 0x6f5433, 0.1, rnd));

  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

/* -------------------------------------------------------------- CACTUS */
export function makeCactus(seed = 31) {
  const rnd = makeRandom(seed);
  const parts = [];
  const h = 2.6 + rnd() * 2.6;
  const body = new THREE.CylinderGeometry(0.34, 0.42, h, 9, 3);
  body.translate(0, h * 0.5, 0);
  parts.push(paint(body, 0x3f6b3a, 0.1, rnd));

  const cap = new THREE.SphereGeometry(0.34, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.translate(0, h, 0);
  parts.push(paint(cap, 0x3f6b3a, 0.1, rnd));

  const arms = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < arms; i++) {
    const a = rnd() * Math.PI * 2;
    const ay = h * (0.4 + rnd() * 0.25);
    const al = 1.0 + rnd() * 0.8;
    const arm = new THREE.CylinderGeometry(0.2, 0.22, al, 7, 1);
    tr(arm, Math.cos(a) * 0.5, ay, Math.sin(a) * 0.5, 0, 0, Math.cos(a) * 1.2);
    parts.push(paint(arm, 0x3f6b3a, 0.1, rnd));
    const up = new THREE.CylinderGeometry(0.19, 0.2, al * 0.9, 7, 1);
    up.translate(Math.cos(a) * (0.5 + al * 0.45), ay + al * 0.45, Math.sin(a) * (0.5 + al * 0.45));
    parts.push(paint(up, 0x3f6b3a, 0.1, rnd));
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------------- BUSH */
export function makeBush(seed = 41, dry = false) {
  const rnd = makeRandom(seed);
  const parts = [];
  const blobs = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < blobs; i++) {
    const r = 0.5 + rnd() * 0.7;
    const s = lumpy(new THREE.SphereGeometry(r, 8, 6), 0.38, 4.2, rnd);
    tr(s, (rnd() - 0.5) * 1.5, r * 0.72 + rnd() * 0.4, (rnd() - 0.5) * 1.5, 0, 0, 0, 1, 0.82, 1);
    parts.push(paint(s, dry ? (i % 2 ? 0x6d6238 : 0x7d7145) : (i % 2 ? 0x2f5a2b : 0x3d6b33), 0.18, rnd));
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------------- ROCK */
export function makeRock(seed = 53) {
  const rnd = makeRandom(seed);
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // flatten into strata, then chip the faces
    const strata = 1 + Math.sin(y * 5.5 + x) * 0.13;
    const d = (0.66 + rnd() * 0.5) * strata;
    p.setXYZ(i, x * d * 1.28, y * d * 0.70, z * d * 1.12);
  }
  g.computeVertexNormals();
  return paint(g, 0x8b8377, 0.14, rnd);
}

/* ------------------------------------------------------------ DRIFTWOOD */
export function makeDriftwood(seed = 61) {
  const rnd = makeRandom(seed);
  const parts = [];
  const main = new THREE.CylinderGeometry(0.22, 0.3, 3.2 + rnd() * 2, 6, 1);
  tr(main, 0, 0.28, 0, 0, rnd() * 3, Math.PI / 2);
  parts.push(paint(main, 0x9a8a76, 0.14, rnd));
  for (let i = 0; i < 2; i++) {
    const b = new THREE.CylinderGeometry(0.1, 0.14, 1.2 + rnd(), 5, 1);
    tr(b, (rnd() - 0.5) * 2, 0.4, (rnd() - 0.5) * 0.8, 0, rnd() * 3, 1.1);
    parts.push(paint(b, 0x9a8a76, 0.14, rnd));
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

/* --------------------------------------------------------- GRASS TUFT */
export function makeTuft() {
  const a = new THREE.PlaneGeometry(0.52, 1.0, 1, 2);
  a.translate(0, 0.5, 0);
  const b = a.clone(); b.rotateY(Math.PI / 2);
  const c = a.clone(); c.rotateY(Math.PI / 4);
  return mergeGeometries([a, b, c], false);
}

/* --------------------------------------------------------- WIND SHADER
   Foliage leans and springs in the breeze. The displacement scales with
   height above the trunk base so roots stay planted, and it is keyed off
   world position so neighbouring trees are out of phase. */
function addWind(mat, clock, strength = 1, anchor = 0.7) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWindTime = clock;
    sh.uniforms.uWindAmp = { value: strength };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uWindTime;
        uniform float uWindAmp;
        uniform float uWindAnchor;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 wOrigin = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );
        #else
          vec3 wOrigin = vec3( modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2] );
        #endif
        float rigid = max( 0.0, transformed.y - uWindAnchor );
        float ph = uWindTime * 0.85 + wOrigin.x * 0.055 + wOrigin.z * 0.043;
        float gust = 0.65 + 0.35 * sin( uWindTime * 0.21 + wOrigin.x * 0.004 );
        float amp = 0.019 * rigid * uWindAmp * gust;
        transformed.x += ( sin( ph ) + sin( ph * 2.31 + 1.7 ) * 0.42 ) * amp;
        transformed.z += ( cos( ph * 0.83 ) + sin( ph * 1.93 ) * 0.36 ) * amp * 0.8;`);
  };
  mat.customProgramCacheKey = () => 'duneRunnerWind' + strength + '_' + anchor;
  return mat;
}

/* ---------------------------------------------------------------------- */
export function buildPropLibrary(textures, quality) {
  const detail = quality && (quality.tier === 'ultra' || quality.tier === 'high') ? 1 : 0;
  const clock = { value: 0 };

  // rocks and logs: no wind
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.9, metalness: 0.0,
    side: THREE.DoubleSide, flatShading: false
  });
  // everything that grows: wind
  const foliageMat = addWind(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.87, metalness: 0.0,
    side: THREE.DoubleSide, flatShading: false
  }), clock, 1.4, 0.7);

  const tuftMat = addWind(new THREE.MeshStandardMaterial({
    map: textures.tuft, transparent: false, alphaTest: 0.30,
    side: THREE.DoubleSide, roughness: 1.0, metalness: 0,
    color: 0xd7e3b4
  }), clock, 15.0, 0.0);

  const lib = {
    mat, foliageMat, tuftMat, windClock: clock,
    pine: [makePine(7, detail), makePine(19, detail), makePine(88, detail), makePine(151, detail)],
    birch: [makeBirch(101), makeBirch(211)],
    acacia: [makeAcacia(11), makeAcacia(77)],
    palm: [makePalm(23), makePalm(97)],
    cactus: [makeCactus(31), makeCactus(131)],
    bush: [makeBush(41, false), makeBush(43, true), makeBush(47, false)],
    rock: [makeRock(53), makeRock(59), makeRock(67), makeRock(71)],
    wood: [makeDriftwood(61)],
    tuft: makeTuft()
  };
  // which family uses which material
  lib.staticFamilies = new Set(['rock', 'wood']);
  return lib;
}
