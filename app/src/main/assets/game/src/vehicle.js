/* ------------------------------------------------------------------
   vehicle.js — the player vehicle: an original 6x6 off-road pickup.

   The body is a glTF model (models/pickup6x6.glb) generated from the
   build scripts in blender/ — the same scripts rebuild it inside Blender
   for editing. Engineering envelope: 5.90 m long, 2.15 m wide over the
   flares, 2.03 m to the roof basket, 360 mm under the diffs, tandem rear
   axles 1.15 m apart on 37x12.5R17 mud-terrains.

   The model's material *names* match the keys of this.M below, so on load
   every mesh is re-pointed at the game's own tuned materials. That keeps
   the headlights, brake lights and night glow working exactly as before.

   Until the model arrives (or if it ever fails to load) a simpler
   procedural body built in this file stands in.

   This is an original design. It carries no manufacturer badges, logos,
   lettering or other trademarked detailing.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';
import { mergeGeometries } from '../libs/three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from '../libs/three/addons/loaders/GLTFLoader.js';

/* ---- key dimensions (metres) ---- */
export const CAR = {
  halfWidth: 0.98,
  wheelR: 0.47,          // 37" tyre
  wheelW: 0.318,         // 12.5" section
  axleF: 1.80,
  axleR: -2.35,
  trackHalf: 0.88,
  restHeight: 0.47,
  length: 5.90,
  /* Three axles: steering front, then the tandem bogie 1.15 m apart.
     Physics builds its wheel list from this, in this order, and the
     visual wheels are created in the same order so index i always refers
     to the same corner in both. */
  axles: [
    { z: 1.80, steers: true },
    { z: -1.20, steers: false },
    { z: -2.35, steers: false }
  ]
};

const HW = CAR.halfWidth;

/* ---------------- geometry helpers ---------------- */
function extrudeProfile(points, depth, bevel = 0.05, curveSegments = 12) {
  const s = new THREE.Shape();
  let first = true;
  for (const op of points) {
    if (op.arc) s.absarc(op.x, op.y, op.r, op.a0, op.a1, true);
    else if (first) { s.moveTo(op.x, op.y); first = false; }
    else s.lineTo(op.x, op.y);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 3, curveSegments, steps: 1
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

function cyl(rt, rb, h, seg, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

/* =========================== WHEEL =========================== */
function buildWheel() {
  const rubber = [];
  const metal = [];
  const R = CAR.wheelR, W = CAR.wheelW;

  const tyre = new THREE.CylinderGeometry(R, R, W, 32, 1, true);
  tyre.rotateZ(Math.PI / 2);
  rubber.push(tyre);

  // shoulders and sidewalls
  for (const s of [-1, 1]) {
    const sh = new THREE.CylinderGeometry(s > 0 ? R * 0.82 : R, s > 0 ? R : R * 0.82, W * 0.16, 32, 1, true);
    sh.rotateZ(Math.PI / 2);
    sh.translate(s * (W / 2 + W * 0.08), 0, 0);
    rubber.push(sh);
    const wall = new THREE.RingGeometry(R * 0.60, R * 0.82, 32);
    wall.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
    wall.translate(s * (W / 2 + W * 0.16), 0, 0);
    rubber.push(wall);
  }

  // aggressive all-terrain block pattern
  const LUGS = 22;
  for (let i = 0; i < LUGS; i++) {
    const a = (i / LUGS) * Math.PI * 2;
    for (const off of [-0.30, -0.10, 0.10, 0.30]) {
      const stagger = (off < 0 ? 1 : -1) * 0.055;
      const lug = new THREE.BoxGeometry(W * 0.20, 0.05, 0.095);
      lug.rotateX(a + stagger);
      lug.translate(off * W, Math.cos(a + stagger) * (R + 0.010), Math.sin(a + stagger) * (R + 0.010));
      rubber.push(lug);
    }
    for (const s of [-1, 1]) {
      const sb = new THREE.BoxGeometry(0.032, 0.075, 0.048);
      sb.rotateX(a);
      sb.translate(s * (W / 2 + 0.018), Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88);
      rubber.push(sb);
    }
  }

  // rim: barrel, dished face, six spokes, lug nuts
  metal.push(cyl(R * 0.60, R * 0.60, W * 0.9, 26, 0, 0, 0, 0, 0, Math.PI / 2));
  const lip = new THREE.TorusGeometry(R * 0.60, 0.026, 6, 26);
  lip.rotateY(Math.PI / 2);
  lip.translate(W * 0.45, 0, 0);
  metal.push(lip);
  const face = new THREE.CircleGeometry(R * 0.60, 26);
  face.rotateY(Math.PI / 2);
  face.translate(W * 0.42, 0, 0);
  metal.push(face);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sp = new THREE.BoxGeometry(0.042, R * 0.52, 0.10);
    sp.rotateX(a);
    sp.translate(W * 0.455, Math.cos(a) * R * 0.30, Math.sin(a) * R * 0.30);
    metal.push(sp);
    const nut = new THREE.CylinderGeometry(0.021, 0.021, 0.03, 6);
    nut.rotateZ(Math.PI / 2);
    nut.translate(W * 0.50, Math.cos(a) * 0.088, Math.sin(a) * 0.088);
    metal.push(nut);
  }
  metal.push(cyl(0.072, 0.072, 0.05, 14, W * 0.49, 0, 0, 0, 0, Math.PI / 2));
  // brake disc peeking through the spokes
  metal.push(cyl(R * 0.44, R * 0.44, 0.03, 20, -W * 0.05, 0, 0, 0, 0, Math.PI / 2));

  const gRubber = mergeGeometries(rubber, false);
  const gMetal = mergeGeometries(metal, false);
  gRubber.computeVertexNormals();
  gMetal.computeVertexNormals();
  return { gRubber, gMetal };
}

/* =========================== VEHICLE =========================== */
export class Vehicle {
  constructor(scene, quality, textures) {
    this.q = quality;
    this.textures = textures;
    this.group = new THREE.Group();
    this.group.name = 'vehicle';
    scene.add(this.group);

    /* ---------------- materials ---------------- */
    this.M = {
      paint: new THREE.MeshPhysicalMaterial({
        color: 0xdde3e6, metalness: 0.0, roughness: 0.33,
        clearcoat: 0.75, clearcoatRoughness: 0.09, envMapIntensity: 0.85
      }),
      roof: new THREE.MeshPhysicalMaterial({
        color: 0xf7fafb, metalness: 0.0, roughness: 0.26,
        clearcoat: 0.8, clearcoatRoughness: 0.07, envMapIntensity: 0.9
      }),
      trim: new THREE.MeshStandardMaterial({ color: 0x131619, roughness: 0.78, metalness: 0.10 }),
      grille: new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 0.55, metalness: 0.25 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x0c0e11, roughness: 0.96, metalness: 0.0 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x424950, roughness: 0.34, metalness: 0.94, envMapIntensity: 1.2 }),
      silver: new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.42, metalness: 0.85, envMapIntensity: 1.1 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xdae0e6, roughness: 0.10, metalness: 1.0, envMapIntensity: 1.5 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x0e1318, metalness: 0.0, roughness: 0.04, transparent: true,
        opacity: 0.72, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.02,
        side: THREE.DoubleSide
      }),
      lampWhite: new THREE.MeshStandardMaterial({
        color: 0xfff8ea, emissive: 0xfff2d8, emissiveIntensity: 0.15, roughness: 0.10, metalness: 0
      }),
      lampRed: new THREE.MeshStandardMaterial({
        color: 0x8d1414, emissive: 0xff2200, emissiveIntensity: 0.35, roughness: 0.20, metalness: 0
      }),
      lampAmber: new THREE.MeshStandardMaterial({
        color: 0xc07a12, emissive: 0xff9b17, emissiveIntensity: 0.25, roughness: 0.24, metalness: 0
      }),
      interior: new THREE.MeshStandardMaterial({ color: 0x191d22, roughness: 0.9, metalness: 0.0 })
    };

    const P = {
      paint: [], roof: [], trim: [], grille: [], metal: [], silver: [], chrome: [],
      glass: [], lampWhite: [], lampRed: [], lampAmber: [], interior: [], rubber: []
    };

    /* ================= LOWER BODY =================
       Short overhangs, flat stubby bonnet, near-vertical tail. */
    P.paint.push(extrudeProfile([
      { x: -2.30, y: 0.60 },
      { x: -1.93, y: 0.54 },
      { arc: 1, x: -1.345, y: 0.54, r: 0.585, a0: Math.PI, a1: 0 },
      { x: -0.74, y: 0.54 },
      { x: 0.74, y: 0.54 },
      { arc: 1, x: 1.345, y: 0.54, r: 0.585, a0: Math.PI, a1: 0 },
      { x: 2.02, y: 0.55 },
      { x: 2.26, y: 0.64 },
      { x: 2.335, y: 0.90 },
      { x: 2.335, y: 1.18 },
      { x: 2.25, y: 1.28 },       // bonnet leading edge
      { x: 1.66, y: 1.33 },
      { x: 1.10, y: 1.36 },       // cowl
      { x: -2.08, y: 1.38 },      // beltline, lifting slightly to the rear
      { x: -2.30, y: 1.24 }
    ], HW * 2 - 0.10, 0.05));
    /* With bevelSize 0.05 the shell's outer skin ends up at x = ±HW and the
       nose at z = 2.385, so every applied detail below has to sit proud of
       those numbers or it disappears inside the bodywork. */

    /* ================= GREENHOUSE =================
       Dark glass volume; the pillars and roof go on top of it. */
    P.glass.push(extrudeProfile([
      { x: 1.06, y: 1.37 },
      { x: 0.44, y: 1.90 },       // raked screen
      { x: -1.88, y: 1.93 },
      { x: -2.06, y: 1.37 }
    ], 1.80, 0.02, 4));

    /* ---- roof cap: white, overhangs the cabin, sits on a drip rail ---- */
    P.roof.push(box(1.90, 0.085, 2.44, 0, 1.975, -0.72));
    P.roof.push(box(1.74, 0.06, 0.30, 0, 1.955, 0.545));           // header over the screen
    for (const s of [-1, 1]) {
      P.trim.push(box(0.05, 0.055, 2.42, s * 0.925, 1.925, -0.72));  // drip rail
    }
    P.trim.push(box(1.80, 0.05, 0.08, 0, 1.938, 0.525));             // screen top trim

    /* ---- pillars: white A and a very thick white C, black B ---- */
    for (const s of [-1, 1]) {
      // A-pillar, following the screen rake
      P.paint.push(box(0.075, 0.80, 0.15, s * 0.930, 1.635, 0.755, -0.86, 0, 0));
      // B-pillar, blacked out so the side glass reads as one band
      P.trim.push(box(0.062, 0.60, 0.10, s * 0.933, 1.63, -0.30));
      // C-pillar: the signature slab
      P.paint.push(box(0.076, 0.60, 0.52, s * 0.930, 1.645, -1.66));
      // window surround
      P.trim.push(box(0.05, 0.075, 3.06, s * 0.936, 1.385, -0.52));
    }
    // rear roof spoiler lip
    P.trim.push(box(1.72, 0.07, 0.10, 0, 1.955, -1.93));

    /* ================= FRONT END ================= */
    /* Front face, laid out the way the real thing reads:
         · body-colour bar straight across at headlamp height
         · black grille mesh in the band directly beneath it
         · round lamps sitting on the ends of the bar
         · plain body-colour above the bar up to the bonnet shut */
    // black grille mesh, below the bar
    P.grille.push(box(1.90, 0.165, 0.12, 0, 0.915, 2.400));
    for (let i = 0; i < 3; i++) {
      P.trim.push(box(1.86, 0.016, 0.022, 0, 0.862 + i * 0.052, 2.465));
    }
    // black surround wrapping the bar and the lamps
    P.grille.push(box(1.90, 0.30, 0.055, 0, 1.075, 2.392));

    // the body-colour bar
    P.paint.push(box(1.90, 0.150, 0.105, 0, 1.075, 2.440));

    for (const s of [-1, 1]) {
      P.trim.push(cyl(0.222, 0.222, 0.05, 26, s * 0.688, 1.075, 2.452, Math.PI / 2, 0, 0));
      P.chrome.push(cyl(0.200, 0.200, 0.035, 26, s * 0.688, 1.075, 2.482, Math.PI / 2, 0, 0));
      P.lampWhite.push(cyl(0.168, 0.168, 0.035, 26, s * 0.688, 1.075, 2.496, Math.PI / 2, 0, 0));
      P.lampWhite.push(cyl(0.055, 0.055, 0.05, 14, s * 0.688, 1.075, 2.510, Math.PI / 2, 0, 0));
      // slim amber indicator outboard of each lamp
      P.lampAmber.push(box(0.10, 0.13, 0.04, s * 0.885, 1.075, 2.452));
    }

    // bumper: black shell, silver skid plate, round fog lamps
    P.trim.push(box(1.96, 0.30, 0.42, 0, 0.700, 2.290));
    for (const s of [-1, 1]) {
      P.trim.push(box(0.20, 0.36, 0.48, s * 0.88, 0.700, 2.21));
      P.lampWhite.push(cyl(0.080, 0.080, 0.04, 18, s * 0.60, 0.700, 2.522, Math.PI / 2, 0, 0));
      P.trim.push(cyl(0.100, 0.100, 0.05, 18, s * 0.60, 0.700, 2.498, Math.PI / 2, 0, 0));
      P.metal.push(box(0.085, 0.13, 0.09, s * 0.40, 0.595, 2.50));
    }
    P.silver.push(box(1.20, 0.085, 0.34, 0, 0.560, 2.40));
    P.silver.push(box(1.20, 0.17, 0.045, 0, 0.628, 2.515));
    P.trim.push(box(0.36, 0.115, 0.03, 0, 0.790, 2.515));

    /* ================= REAR END ================= */
    for (const s of [-1, 1]) {
      P.trim.push(box(0.175, 0.50, 0.05, s * 0.815, 1.055, -2.372));
      P.lampRed.push(box(0.135, 0.44, 0.05, s * 0.815, 1.055, -2.392));
    }
    P.trim.push(box(1.94, 0.32, 0.34, 0, 0.755, -2.28));                 // rear bumper
    P.silver.push(box(1.10, 0.06, 0.26, 0, 0.905, -2.36));               // step pad
    P.lampRed.push(box(0.36, 0.055, 0.04, 0, 1.965, -1.965));            // high-mount stop lamp
    P.trim.push(box(0.09, 0.055, 0.03, 0, 0.83, -2.47));
    // tailgate shut line — it opens sideways, so the split is on one edge
    P.trim.push(box(0.022, 0.78, 0.022, 0.94, 1.00, -2.372));

    // spare wheel carrier
    P.metal.push(box(0.10, 0.10, 0.30, -0.24, 1.06, -2.44));
    P.metal.push(box(0.10, 0.76, 0.10, -0.24, 1.30, -2.56));
    P.metal.push(box(0.34, 0.10, 0.10, -0.06, 1.62, -2.56));

    /* ================= SIDES ================= */
    for (const s of [-1, 1]) {
      // wide flares over each arch
      for (const az of [CAR.axleF, CAR.axleR]) {
        const flare = new THREE.TorusGeometry(0.635, 0.095, 7, 22, Math.PI * 1.06);
        flare.rotateY(Math.PI / 2);
        flare.scale(2.4, 1, 1);
        flare.translate(s * (HW + 0.005), 0.54, az);
        P.trim.push(flare);
        const liner = new THREE.TorusGeometry(0.585, 0.05, 5, 16, Math.PI * 0.95);
        liner.rotateY(Math.PI / 2);
        liner.scale(3.6, 1, 1);
        liner.translate(s * (HW - 0.14), 0.54, az);
        P.trim.push(liner);
      }

      // rock rails and step
      // rotateX, not rotateZ — the rail runs front-to-back along the sill
      P.metal.push(cyl(0.062, 0.062, 2.06, 10, s * 1.012, 0.495, 0.0, Math.PI / 2, 0, 0));
      P.metal.push(box(0.30, 0.05, 1.74, s * 1.045, 0.50, 0.0));
      P.metal.push(cyl(0.048, 0.048, 0.30, 8, s * 0.985, 0.415, 0.60, Math.PI / 2, 0, 0));
      P.metal.push(cyl(0.048, 0.048, 0.30, 8, s * 0.985, 0.415, -0.56, Math.PI / 2, 0, 0));

      // door shut lines: a normal front door, then a rear-hinged half door
      for (const dz of [0.98, -0.32, -1.66]) {
        P.trim.push(box(0.016, 0.80, 0.024, s * 0.962, 0.95, dz));
      }
      P.trim.push(box(0.016, 0.024, 2.62, s * 0.962, 0.66, -0.34));      // lower crease

      // handles: front door conventional, rear one hidden in the C-pillar
      P.chrome.push(box(0.036, 0.052, 0.21, s * 0.970, 1.20, 0.30));
      P.chrome.push(box(0.034, 0.115, 0.045, s * 0.955, 1.50, -1.50));

      // mirrors
      P.trim.push(cyl(0.024, 0.024, 0.20, 8, s * 0.985, 1.53, 0.90, 0, 0, Math.PI / 2 - 0.42));
      P.trim.push(box(0.055, 0.14, 0.21, s * 1.105, 1.575, 0.875));
      P.chrome.push(box(0.014, 0.115, 0.175, s * 1.136, 1.575, 0.880));

      // side markers and a fuel filler
      P.lampAmber.push(box(0.03, 0.05, 0.11, s * 0.968, 1.07, 1.86));
      P.trim.push(cyl(0.085, 0.085, 0.026, 14, s * 0.966, 1.06, -1.62, 0, 0, Math.PI / 2));
    }

    /* three wipers parked on the screen */
    for (const wx of [-0.50, 0.0, 0.50]) {
      P.trim.push(box(0.028, 0.022, 0.54, wx, 1.395, 0.955, -0.62, 0.10, 0));
      P.trim.push(box(0.048, 0.03, 0.05, wx, 1.36, 1.14));
    }

    /* ================= ROOF RACK + LIGHT BAR ================= */
    const rackY = 2.055;
    for (const s of [-1, 1]) {
      P.metal.push(cyl(0.03, 0.03, 2.30, 10, s * 0.80, rackY + 0.10, -0.74, Math.PI / 2, 0, 0));
      for (const z of [0.34, -0.74, -1.80]) {
        P.metal.push(cyl(0.026, 0.026, 0.12, 8, s * 0.80, rackY + 0.045, z));
      }
    }
    for (const z of [0.35, -0.74, -1.81]) {
      P.metal.push(cyl(0.026, 0.026, 1.62, 10, 0, rackY + 0.10, z, 0, 0, Math.PI / 2));
    }
    P.metal.push(box(1.66, 0.03, 0.032, 0, rackY + 0.20, 0.35));
    P.metal.push(box(1.66, 0.03, 0.032, 0, rackY + 0.20, -1.81));
    // a jerry can and a sand ladder strapped to the rack
    P.metal.push(box(0.34, 0.42, 0.20, 0.52, rackY + 0.32, -1.42));
    P.trim.push(box(0.36, 0.05, 0.22, 0.52, rackY + 0.55, -1.42));
    P.silver.push(box(0.30, 0.05, 1.40, -0.50, rackY + 0.14, -1.05));

    // LED light bar
    P.trim.push(box(1.28, 0.105, 0.09, 0, rackY + 0.20, 0.62));
    for (let i = 0; i < 7; i++) {
      P.lampWhite.push(cyl(0.039, 0.039, 0.035, 12, -0.51 + i * 0.17, rackY + 0.20, 0.675, Math.PI / 2, 0, 0));
    }
    P.metal.push(box(0.05, 0.14, 0.05, -0.62, rackY + 0.135, 0.62));
    P.metal.push(box(0.05, 0.14, 0.05, 0.62, rackY + 0.135, 0.62));

    /* ================= SNORKEL ================= */
    P.trim.push(cyl(0.064, 0.064, 1.02, 12, 0.905, 1.46, 1.44, 0.16, 0, 0));
    P.trim.push(cyl(0.064, 0.064, 0.44, 12, 0.905, 1.99, 1.26, Math.PI / 2 - 0.35, 0, 0));
    P.trim.push(box(0.155, 0.17, 0.21, 0.905, 2.15, 1.07));
    P.trim.push(cyl(0.078, 0.078, 0.10, 12, 0.905, 2.15, 0.965, Math.PI / 2, 0, 0));

    /* ================= EXHAUST ================= */
    P.metal.push(cyl(0.056, 0.056, 0.58, 12, -0.70, 0.52, -2.26, Math.PI / 2 - 0.14, 0, 0));
    P.chrome.push(cyl(0.078, 0.066, 0.16, 12, -0.70, 0.55, -2.52, Math.PI / 2, 0, 0));

    /* ================= INTERIOR ================= */
    P.interior.push(box(1.66, 0.05, 2.24, 0, 1.34, -0.74));
    P.interior.push(box(1.68, 0.18, 0.46, 0, 1.40, 0.88));
    P.interior.push(box(1.68, 0.05, 0.32, 0, 1.34, 1.08, -0.46));
    for (const s of [-1, 1]) {
      P.interior.push(box(0.46, 0.10, 0.48, s * 0.40, 1.44, 0.12));
      P.interior.push(box(0.46, 0.58, 0.10, s * 0.40, 1.69, -0.14, -0.16));
      P.interior.push(box(0.42, 0.12, 0.44, s * 0.40, 1.46, -0.96));
      P.interior.push(box(0.42, 0.46, 0.09, s * 0.40, 1.65, -1.20, -0.12));
      P.interior.push(box(0.075, 0.50, 0.075, s * 0.40, 1.98, -0.30));   // head rests
    }
    P.trim.push(cyl(0.14, 0.14, 0.03, 16, 0.36, 1.54, 0.68, Math.PI / 2 - 0.5, 0, 0));
    P.trim.push(cyl(0.022, 0.022, 0.24, 8, 0.36, 1.48, 0.74, Math.PI / 2 - 0.5, 0, 0));
    P.trim.push(box(0.07, 0.22, 0.07, -0.02, 1.48, 0.30, -0.25));        // gear lever

    /* ================= ASSEMBLE ================= */
    this.body = new THREE.Group();
    this.parts = {};
    for (const key in P) {
      if (!P[key].length) continue;
      // ExtrudeGeometry comes out non-indexed while the primitives are
      // indexed; mergeGeometries needs one or the other, so flatten first
      const parts = P[key].map(g => (g.index ? g.toNonIndexed() : g));
      const g = mergeGeometries(parts, false);
      if (!g) { console.warn('vehicle: could not merge', key); continue; }
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, this.M[key]);
      mesh.castShadow = true;
      mesh.receiveShadow = key !== 'glass';
      if (key === 'glass') { mesh.renderOrder = 2; mesh.castShadow = false; }
      this.body.add(mesh);
      this.parts[key] = mesh;
    }
    this.group.add(this.body);

    /* ---------------- wheels ---------------- */
    const W = buildWheel();
    this.wheels = [];
    const positions = [];
    for (const a of CAR.axles) {
      positions.push([CAR.trackHalf, a.z, a.steers], [-CAR.trackHalf, a.z, a.steers]);
    }
    for (const [x, z, steers] of positions) {
      const steer = new THREE.Group();
      steer.position.set(x, CAR.restHeight, z);
      const spin = new THREE.Group();
      // mirror the left wheels with a yaw, not a negative scale — a negative
      // scale would invert the winding and turn them inside out
      const flip = new THREE.Group();
      if (x < 0) flip.rotation.y = Math.PI;
      const tyre = new THREE.Mesh(W.gRubber, this.M.rubber);
      const rim = new THREE.Mesh(W.gMetal, this.M.metal);
      tyre.castShadow = rim.castShadow = true;
      tyre.receiveShadow = rim.receiveShadow = true;
      flip.add(tyre, rim);
      spin.add(flip);
      steer.add(spin);
      this.group.add(steer);
      this.wheels.push({ steer, spin, flip, steers, restY: CAR.restHeight, x, z });
    }

    // spare on the tailgate
    const spare = new THREE.Group();
    spare.position.set(-0.05, 1.20, -2.62);
    spare.rotation.y = Math.PI / 2;
    const st = new THREE.Mesh(W.gRubber, this.M.rubber);
    const sr = new THREE.Mesh(W.gMetal, this.M.metal);
    st.castShadow = sr.castShadow = true;
    spare.add(st, sr);
    this.body.add(spare);

    /* ---------------- lights ---------------- */
    this.headlights = [];
    if (quality.headlights) {
      for (const s of [-1, 1]) {
        const sp = new THREE.SpotLight(0xfff0d4, 0, 140, 0.54, 0.45, 1.4);
        sp.position.set(s * 0.685, 1.045, 2.4);
        const tgt = new THREE.Object3D();
        tgt.position.set(s * 0.9, -0.2, 26);
        this.group.add(sp, tgt);
        sp.target = tgt;
        this.headlights.push(sp);
      }
      const barLight = new THREE.SpotLight(0xffffff, 0, 240, 0.34, 0.5, 1.2);
      barLight.position.set(0, 2.26, 0.7);
      const bt = new THREE.Object3D();
      bt.position.set(0, -1.5, 60);
      this.group.add(barLight, bt);
      barLight.target = bt;
      this.barLight = barLight;
      this.headlights.push(barLight);
    }

    this.glows = [];
    if (textures) {
      const mk = (color, size, x, y, z) => {
        const m = new THREE.Sprite(new THREE.SpriteMaterial({
          map: textures.glow, color, transparent: true, opacity: 0,
          depthWrite: false, blending: THREE.AdditiveBlending, fog: false
        }));
        m.scale.set(size, size, 1);
        m.position.set(x, y, z);
        this.group.add(m);
        this.glows.push(m);
        return m;
      };
      this.glowFront = [mk(0xfff0cf, 1.5, -0.685, 1.045, 2.45), mk(0xfff0cf, 1.5, 0.685, 1.045, 2.45)];
      this.glowBar = mk(0xffffff, 2.6, 0, 2.255, 0.75);
      this.glowRear = [mk(0xff2200, 1.1, -0.815, 1.055, -2.40), mk(0xff2200, 1.1, 0.815, 1.055, -2.40)];
    }

    /* Soft contact shadow so the truck never looks like it is hovering.
       It lives in world space, not on the body, so it stays flat on the
       ground while the truck leans and pitches. */
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(3.0, 6.6),
      new THREE.MeshBasicMaterial({
        map: textures ? textures.smoke : null, color: 0x000000,
        transparent: true, opacity: 0.3, depthWrite: false, fog: true
      })
    );
    blob.name = 'contact-shadow-blob';
    blob.rotation.x = -Math.PI / 2;
    blob.renderOrder = 1;
    blob.frustumCulled = false;
    scene.add(blob);
    this.blob = blob;

    this.lightsOn = false;
  }

  /* ---------------------------------------------------------------
     Swap in the glTF body. Resolves true on success; on any failure the
     procedural stand-in simply stays, so the game never loses its truck.
  --------------------------------------------------------------- */
  async loadModel(url) {
    let gltf;
    try { gltf = await new GLTFLoader().loadAsync(url); }
    catch (e) { console.warn('vehicle: model failed to load, keeping stand-in', e); return false; }

    const root = gltf.scene;
    const wheelSrc = root.getObjectByName('p6_wheel');
    if (wheelSrc) wheelSrc.removeFromParent();

    // keys this.M does not have yet (rim gunmetal, gold bolts, red shackles…)
    const extra = {
      // satin-black wheels with dark hardware, as on the app icon
      gunmetal: { color: 0x1c1e21, metalness: 0.5, roughness: 0.5, envMapIntensity: 1.0 },
      gold:     { color: 0x3a3c40, metalness: 0.8, roughness: 0.4, envMapIntensity: 1.0 },
      // amber light-guide strips in the headlights and fogs, and the LED roof bar
      lampDrl:  { color: 0xff9a3c, emissive: 0xff7a12, emissiveIntensity: 1.6, roughness: 0.2, metalness: 0 },
      lampBar:  { color: 0xffd8a0, emissive: 0xffa640, emissiveIntensity: 0.7, roughness: 0.2, metalness: 0 },
      red:      { color: 0xa01a12, metalness: 0.35, roughness: 0.38 },
      orange:   { color: 0xff5a00, metalness: 0.0, roughness: 0.6 },
      yellow:   { color: 0xe8b80e, metalness: 0.0, roughness: 0.6 },
      chassis:  { color: 0x101113, metalness: 0.2, roughness: 0.82 }
    };
    /* Glazing that is part of the curved cabin surface. It has to be opaque:
       a see-through pane on a closed shell would show the inside of the shell. */
    if (!this.M.tint) this.M.tint = new THREE.MeshPhysicalMaterial({
      color: 0x05080a, roughness: 0.05, metalness: 0.0, clearcoat: 1.0,
      clearcoatRoughness: 0.02, envMapIntensity: 1.6
    });
    for (const k in extra) if (!this.M[k]) this.M[k] = new THREE.MeshStandardMaterial(extra[k]);
    // the spec'd body finish: glossy white over a clear coat
    /* Finish values from the realism guide. #E8ECEE with a little roughness
       under a hard clear coat reads as bright gloss white; the brighter
       #F4F6F7 tipped into a bloom glow under ACES. */
    this.M.paint.color.set(0xe8ecee);
    this.M.paint.metalness = 0.05;
    this.M.paint.roughness = 0.28;
    this.M.paint.clearcoat = 1.0;
    this.M.paint.clearcoatRoughness = 0.04;
    this.M.trim.color.set(0x1a1c1e); this.M.trim.roughness = 0.68;      // pebbled ABS
    this.M.metal.color.set(0x111213); this.M.metal.metalness = 0.2;      // crinkle-coat steel
    this.M.metal.roughness = 0.55;
    this.M.rubber.color.set(0x2b2420); this.M.rubber.roughness = 0.9;    // warm, dusty mud-terrain rubber

    /* Baked texture sets (modelled and baked in Blender, surface detail
       from Draw Things): colour, tangent-space normal, and occlusion /
       roughness packed into one image (R / G), one set per part. Each
       part's meshes get their own copy of the tuned game
       material with those maps attached, so paint keeps its clear coat and
       glass stays glass. Missing textures leave the plain materials. */
    /* Baked textures only fit a model that was UV-unwrapped in Blender. The
       current body is generated straight from tools/pickup6x6/p6_geom.py
       (no UVs), so skip the twelve image requests when there is nothing to
       put them on; the vertex-colour grime and shader dust take over. */
    let hasUV = false;
    root.traverse(o => { if (o.isMesh && o.geometry.attributes.uv) hasUV = true; });
    const tex = hasUV ? await this.loadPartTextures() : null;
    const NO_MAPS = new Set(['glass', 'tint', 'lampWhite', 'lampRed', 'lampAmber']);
    const partOf = (o) => {
      for (let p = o; p; p = p.parent) {
        const m = /^p6_(body|cab|detail|wheel|spare)/.exec(p.name || '');
        if (m) return m[1] === 'spare' ? 'wheel' : m[1];
      }
      return null;
    };
    const textured = new Map();
    const texturedMat = (key, part, geo) => {
      const id = part + ':' + key;
      if (textured.has(id)) return textured.get(id);
      const set = tex[part];
      const m = this.M[key].clone();
      m.color.set(0xffffff);                 // the colour lives in the map now
      m.map = set.col;
      m.normalMap = set.nrm;
      // glTF normal maps need Y flipped unless the mesh carries tangents
      m.normalScale.set(1, geo.attributes.tangent ? 1 : -1);
      // occlusion (R) and roughness (G) are baked; metalness stays the
      // tuned per-material value, since it never varies within a material
      m.aoMap = set.orm; m.aoMapIntensity = 1;
      m.roughnessMap = set.orm; m.roughness = 1;
      m.vertexColors = false;
      m.needsUpdate = true;
      textured.set(id, m);
      return m;
    };
    this.textured = !!tex;

    const remap = (obj) => obj.traverse(o => {
      if (!o.isMesh) return;
      const key = o.material && o.material.name;
      if (key && this.M[key]) {
        o.material.dispose();
        const part = tex && !NO_MAPS.has(key) && o.geometry.attributes.uv ? partOf(o) : null;
        if (part && tex[part]) {
          o.material = texturedMat(key, part, o.geometry);
        } else {
          o.material = this.M[key];
          /* the plain model carries baked occlusion + road dust as vertex colours */
          if (o.geometry.attributes.color && !o.material.vertexColors) {
            o.material.vertexColors = true; o.material.needsUpdate = true;
          }
        }
      }
      o.castShadow = key !== 'glass';
      o.receiveShadow = key !== 'glass';
      if (key === 'glass') o.renderOrder = 2;
    });
    remap(root);
    if (wheelSrc) remap(wheelSrc);

    // retire the stand-in body
    for (const c of [...this.body.children]) {
      c.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
      this.body.remove(c);
    }
    for (const c of [...root.children]) this.body.add(c);

    // re-dress all six wheels with the modelled tyre + beadlock
    if (wheelSrc) {
      wheelSrc.position.set(0, 0, 0); wheelSrc.rotation.set(0, 0, 0);
      for (const w of this.wheels) {
        for (const c of [...w.flip.children]) w.flip.remove(c);
        w.flip.add(wheelSrc.clone());
      }
    }

    // lamps and glows to the new front, roof bar and tail
    const NOSE = 2.70;
    if (this.headlights.length >= 2) {
      this.headlights[0].position.set(-0.775, 1.19, NOSE);
      this.headlights[1].position.set(0.775, 1.19, NOSE);
      this.headlights[0].target.position.set(-0.95, -0.2, 28);
      this.headlights[1].target.position.set(0.95, -0.2, 28);
      if (this.barLight) {
        this.barLight.position.set(0, 2.0, 0.45);
        this.barLight.target.position.set(0, -1.5, 60);
      }
    }
    if (this.glowFront) {
      this.glowFront[0].position.set(-0.775, 1.19, NOSE + 0.05);
      this.glowFront[1].position.set(0.775, 1.19, NOSE + 0.05);
      this.glowBar.position.set(0, 2.005, 0.45);
      this.glowBar.scale.set(2.2, 2.2, 1);
      this.glowRear[0].position.set(-0.90, 1.27, -2.99);
      this.glowRear[1].position.set(0.90, 1.27, -2.99);
    }
    this.modelLoaded = true;
    // the baked textures already carry the dust and mud
    if (!this.textured) this.addGrime();
    return true;
  }

  /** Load the baked per-part textures, or null if any are missing. */
  async loadPartTextures() {
    const L = new THREE.TextureLoader();
    const aniso = (this.q && this.q.aniso) || 4;
    const load = (url, srgb) => L.loadAsync(url).then((t) => {
      t.flipY = false;                       // glTF UV convention
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = aniso;
      return t;
    });
    try {
      const out = {};
      await Promise.all(['body', 'cab', 'detail', 'wheel'].map(async (k) => {
        const [col, nrm, orm] = await Promise.all([
          load(`./models/truck/${k}_col.jpg`, true),
          load(`./models/truck/${k}_nrm.jpg`, false),
          load(`./models/truck/${k}_orm.jpg`, false)
        ]);
        out[k] = { col, nrm, orm };
      }));
      return out;
    } catch (e) {
      console.warn('vehicle: baked truck textures not found, using plain materials');
      return null;
    }
  }

  /* ---------------------------------------------------------------- grime
     A showroom-clean truck is the quickest tell that a car is rendered.
     This adds what a few days off-road leave behind, in the shader so it
     costs no extra geometry or textures:
       • heavy tan dust on the lower body, wheels and chassis, fading up
         the doors along a ragged edge taken from the dirt photo-scan;
       • a light film on upward-facing panels (bonnet, roof, rails);
       • dusty areas lose their clear coat and go matte.
     Positions are measured in the truck's own space (origin at ground
     level), so the dirt stays put however the truck tilts or flies. */
  addGrime() {
    const tex = this.textures;
    /* Not on phones and tablets: the model already carries baked grime as
       vertex colours, and this shader variant is the likeliest thing for a
       mobile GPU driver to reject — which leaves the truck invisible. */
    if (!tex || !tex.dirt || (this.q && (this.q.tier === 'low' || this.q.isPhone))) return;
    const U = this.grimeU = {
      uBodyInv: { value: new THREE.Matrix4() },
      tGrime: { value: tex.dirt },
      uDustColor: { value: new THREE.Color(0.34, 0.255, 0.17) }
    };
    // how much each surface collects: tyres and chassis the most
    const amount = {
      paint: 1.0, roof: 1.0, trim: 0.5, grille: 0.4, metal: 0.45, chassis: 1.1,
      rubber: 0.35, gunmetal: 0.4, silver: 0.9, red: 1.0, orange: 0.3, yellow: 1.0,
      chrome: 0.6, gold: 0.5
    };
    // the paint: a little less blinding, and more of the sky in it
    this.M.paint.color.set(0xdde1e3);
    this.M.paint.envMapIntensity = 1.25;

    for (const key in amount) {
      const m = this.M[key];
      if (!m || m.userData.grime) continue;
      m.userData.grime = true;
      const k = amount[key];
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => {
        if (prev) prev.call(m, sh, r);
        Object.assign(sh.uniforms, U);
        sh.uniforms.uGrime = { value: k };
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>
            uniform mat4 uBodyInv;
            varying vec3 vGrimeP;
            varying vec3 vGrimeN;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vGrimeP = ( uBodyInv * modelMatrix * vec4( transformed, 1.0 ) ).xyz;
            vGrimeN = normalize( mat3( uBodyInv ) * mat3( modelMatrix ) * objectNormal );`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform sampler2D tGrime;
            uniform vec3 uDustColor;
            uniform float uGrime;
            varying vec3 vGrimeP;
            varying vec3 vGrimeN;`)
          .replace('#include <color_fragment>', `#include <color_fragment>
            float grimeMask = 0.0;
            {
              vec3 w = pow( abs( normalize( vGrimeN ) ), vec3( 4.0 ) );
              w /= ( w.x + w.y + w.z );
              vec3 q = vGrimeP * 0.9;
              float dl = dot( texture2D( tGrime, q.zy ).rgb * w.x +
                              texture2D( tGrime, q.xz ).rgb * w.y +
                              texture2D( tGrime, q.xy ).rgb * w.z, vec3( 0.333 ) );
              float fine = dot( texture2D( tGrime, vGrimeP.zy * 3.7 + 0.3 ).rgb, vec3( 0.333 ) );
              // thrown up by the wheels: heavy low down, ragged edge above
              float edge = ( dl - 0.25 ) * 1.6 + ( fine - 0.25 ) * 0.6;
              float low = 1.0 - smoothstep( 0.45, 1.0, vGrimeP.y + edge * 0.4 );
              // settled dust on anything facing up
              float top = smoothstep( 0.6, 0.95, normalize( vGrimeN ).y ) * ( 0.08 + 0.14 * fine );
              grimeMask = clamp( max( low * 0.85, top ) * uGrime, 0.0, 1.0 );
              vec3 dust = uDustColor * ( 0.72 + 0.6 * dl );
              diffuseColor.rgb = mix( diffuseColor.rgb, dust, grimeMask * 0.75 );
            }`)
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
            roughnessFactor = mix( roughnessFactor, 0.93, grimeMask );`)
          .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
            metalnessFactor *= 1.0 - grimeMask * 0.85;`)
          .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
            #ifdef USE_CLEARCOAT
              material.clearcoat *= 1.0 - grimeMask;
            #endif`);
      };
      const prevKey = m.customProgramCacheKey;
      m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '_grime' + key;
      m.needsUpdate = true;
    }
  }

  /** Undo addGrime (used if a device's GPU driver rejects the shader). */
  removeGrime() {
    if (!this.grimeU) return false;
    for (const key in this.M) {
      const m = this.M[key];
      if (!m || !m.userData.grime) continue;
      m.userData.grime = false;
      m.onBeforeCompile = () => {};
      m.customProgramCacheKey = () => 'nogrime' + key;
      m.needsUpdate = true;
    }
    this.grimeU = null;
    return true;
  }

  /** Wheel visual state. `compression` is how far the strut is pushed up. */
  setWheel(i, compression, steerAngle, spinAngle) {
    const w = this.wheels[i];
    w.steer.position.y = w.restY + compression;
    if (w.steers) w.steer.rotation.y = steerAngle;
    w.spin.rotation.x = spinAngle;
  }

  setLights(on, brake, night) {
    if (this.headlights.length) {
      const want = on ? 1 : 0;
      this.headlights[0].intensity = want * 240;
      this.headlights[1].intensity = want * 240;
      if (this.barLight) this.barLight.intensity = want * 380;
    }
    this.M.lampWhite.emissiveIntensity = on ? 2.6 : 0.06;
    this.M.lampRed.emissiveIntensity = 0.25 + brake * 3.2 + (on ? 0.6 : 0);
    this.M.lampAmber.emissiveIntensity = on ? 0.9 : 0.12;
    // daytime running lights stay lit; the roof bar always shows a warm glow
    if (this.M.lampDrl) this.M.lampDrl.emissiveIntensity = on ? 2.6 : 1.6;
    if (this.M.lampBar) this.M.lampBar.emissiveIntensity = on ? 3.2 : 0.7;
    if (this.glowFront) {
      const o = on ? 0.95 : 0.0;
      this.glowFront[0].material.opacity = o;
      this.glowFront[1].material.opacity = o;
      this.glowBar.material.opacity = on ? 1.0 : 0;
      const r = Math.min(1, 0.10 + brake * 0.9 + (on ? 0.25 : 0));
      this.glowRear[0].material.opacity = r;
      this.glowRear[1].material.opacity = r;
    }
    this.lightsOn = on;
  }

  /** Park the contact shadow on the ground under the truck and fade it
      out as the truck climbs away. */
  updateShadow(phys) {
    if (this.grimeU) {
      this.group.updateMatrixWorld();
      this.grimeU.uBodyInv.value.copy(this.group.matrixWorld).invert();
    }
    const b = this.blob;
    if (!b) return;
    const lift = Math.max(0, phys.pos.y - phys.groundY);
    const a = Math.max(0, 1 - lift / 6);
    b.material.opacity = 0.30 * a * a;
    b.visible = a > 0.015;
    if (!b.visible) return;
    b.position.set(phys.pos.x, Math.max(phys.groundY, 0) + 0.05, phys.pos.z);
    b.rotation.z = -phys.yawAngle();
    const s = 1 + lift * 0.10;
    b.scale.set(s, s, 1);
  }
}
