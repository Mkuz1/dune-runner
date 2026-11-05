/* ------------------------------------------------------------------
   camera.js — chase camera with four modes, speed FOV, terrain
   avoidance and a little shake when the ride gets rough.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';
import { heightAt, SEA_LEVEL } from './world.js';
import { clamp, lerp } from './noise.js';

const MODES = [
  { name: 'Chase',     dist: 11.0, height: 3.9, look: 1.6, fovAdd: 0 },
  { name: 'Close',     dist: 7.6,  height: 2.9, look: 1.4, fovAdd: -2 },
  { name: 'Cinematic', dist: 18.0, height: 6.0, look: 1.9, fovAdd: -6 },
  { name: 'Hood',      dist: -0.2, height: 1.70, look: 6.0, fovAdd: 4, hood: true }
];

const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _off = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

const DEG = Math.PI / 180;
const REF_ASPECT = 16 / 9;

/**
 * three's `fov` is vertical, so on a tall screen you would keep the same
 * vertical view and lose most of the width — the world looks zoomed in and
 * cramped. Widen the vertical fov on narrow aspects so the *horizontal*
 * field of view stays roughly what it is in landscape.
 */
function fitFov(baseFov, aspect) {
  if (!aspect || aspect >= REF_ASPECT) return baseFov;
  const hRef = 2 * Math.atan(Math.tan(baseFov * DEG / 2) * REF_ASPECT);
  const v = 2 * Math.atan(Math.tan(hRef / 2) / aspect) / DEG;
  return Math.min(v, 104);      // don't let portrait go fish-eye
}

export class ChaseCamera {
  constructor(camera, quality) {
    this.cam = camera;
    this.q = quality;
    this.mode = 0;
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.shake = 0;
    this.rollVis = 0;
    this.initialised = false;
    this.baseFov = quality.fov;
  }

  cycle() {
    this.mode = (this.mode + 1) % MODES.length;
    return MODES[this.mode].name;
  }
  get modeName() { return MODES[this.mode].name; }

  update(dt, phys, input) {
    const M = MODES[this.mode];
    const speed = phys.speed;

    // heading: follow the body yaw, but keep the horizon level on the ground
    const yaw = phys.flying ? phys.yaw : phys.yawAngle();
    const lookYaw = yaw + input.lookX;
    const lookPitch = input.lookY;

    if (M.hood) {
      _off.set(0.34, M.height, 0.35).applyQuaternion(phys.quat);
      this.pos.copy(phys.pos).add(_off);
      _t.set(0, M.height - 0.1, M.look).applyQuaternion(phys.quat).add(phys.pos);
      this.cam.position.copy(this.pos);
      this.cam.up.set(0, 1, 0).applyQuaternion(phys.quat);
      this.cam.lookAt(_t);
      this.cam.fov = lerp(this.cam.fov,
        fitFov(this.baseFov + M.fovAdd + clamp(speed * 0.20, 0, 16), this.cam.aspect),
        1 - Math.exp(-4 * dt));
      this.cam.updateProjectionMatrix();
      this.initialised = true;
      return;
    }

    // desired position behind and above the truck
    const back = M.dist * (1 + clamp(speed / 120, 0, 0.45));
    const rise = M.height + clamp(speed / 90, 0, 0.5) + (phys.flying ? 1.2 : 0);
    _off.set(
      -Math.sin(lookYaw) * back * Math.cos(lookPitch),
      rise + Math.sin(lookPitch) * back,
      -Math.cos(lookYaw) * back * Math.cos(lookPitch)
    );
    _v.copy(phys.pos).add(_off);

    // lead the camera with velocity so fast driving feels fast
    _v.addScaledVector(phys.vel, 0.085);

    if (!this.initialised) { this.pos.copy(_v); this.initialised = true; }

    const follow = 1 - Math.exp(-(phys.flying ? 5.0 : 7.5) * dt);
    this.pos.lerp(_v, follow);

    // never let the camera sink into a dune or the sea
    const gh = Math.max(heightAt(this.pos.x, this.pos.z), SEA_LEVEL - 0.4) + 1.9;
    if (this.pos.y < gh) this.pos.y = lerp(this.pos.y, gh, 0.55);

    // look at a point slightly ahead of the truck
    _t.copy(phys.pos);
    _t.y += M.look;
    _t.addScaledVector(phys.vel, 0.10);
    this.target.lerp(_t, 1 - Math.exp(-10 * dt));

    // shake: rough ground, wheel slip, hard landings
    const rough = clamp((phys.wheelSlip * 0.8 + phys.landedHard * 1.6) * clamp(speed / 20, 0, 1), 0, 1);
    this.shake = lerp(this.shake, rough, 1 - Math.exp(-8 * dt));
    const amp = this.shake * 0.16;
    this.cam.position.set(
      this.pos.x + (Math.random() - 0.5) * amp,
      this.pos.y + (Math.random() - 0.5) * amp,
      this.pos.z + (Math.random() - 0.5) * amp
    );

    // subtle roll into corners
    const lateral = phys.flying ? -phys.bankVis * 0.55 : clamp(phys.angVel.y * 0.09, -0.16, 0.16);
    this.rollVis = lerp(this.rollVis, lateral, 1 - Math.exp(-5 * dt));
    this.cam.up.set(Math.sin(this.rollVis), Math.cos(this.rollVis), 0)
      .applyAxisAngle(_up, lookYaw);

    this.cam.lookAt(this.target);

    const fovTarget = fitFov(
      this.baseFov + M.fovAdd + clamp(speed * 0.22, 0, 15) + (phys.flying ? 3 : 0),
      this.cam.aspect);
    this.cam.fov = lerp(this.cam.fov, fovTarget, 1 - Math.exp(-3.5 * dt));
    this.cam.updateProjectionMatrix();
  }
}
