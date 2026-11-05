/* ------------------------------------------------------------------
   grass.js — a carpet of wind-blown tufts that follows the camera.

   Positions come from a fixed world lattice hashed per cell, so tufts
   stay put as you drive; heights are read from the terrain chunk that
   is already in memory, which makes rebuilding cheap enough to do
   several times a second.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';
import { hash2, clamp } from './noise.js';
import { surface, splat, villageAt } from './world.js';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const _S = { h: 0, desert: 0, land: 0, trail: 0, base: 0 };
const _sp = [0, 0, 0, 0];

export class GrassField {
  constructor(scene, props, terrain, quality) {
    this.q = quality;
    this.terrain = terrain;
    this.count = quality.grassCount;
    this.radius = quality.grassRadius;
    this.spacing = 1.55;
    this.enabled = quality.grass && this.count > 0;
    if (!this.enabled) return;

    this.mesh = new THREE.InstancedMesh(props.tuft, props.tuftMat, this.count);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.count * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.name = 'grass-field';
    scene.add(this.mesh);

    this.last = new THREE.Vector2(1e9, 1e9);
    this.time = 0;
    this._c = new THREE.Color();
  }

  update(dt, x, z) {
    if (!this.enabled) return;
    this.time += dt;
    if (Math.abs(x - this.last.x) < 5 && Math.abs(z - this.last.y) < 5) return;
    this.last.set(x, z);
    this.rebuild(x, z);
  }

  rebuild(cx, cz) {
    const sp = this.spacing;
    const R = this.radius;
    const i0 = Math.floor((cx - R) / sp), i1 = Math.floor((cx + R) / sp);
    const j0 = Math.floor((cz - R) / sp), j1 = Math.floor((cz + R) / sp);
    const R2 = R * R;
    let n = 0;

    for (let i = i0; i <= i1 && n < this.count; i++) {
      for (let j = j0; j <= j1 && n < this.count; j++) {
        const r1 = hash2(i, j);
        if (r1 > 0.55) continue;                       // thin it out
        const r2 = hash2(i + 7717, j - 3391);
        const r3 = hash2(i - 511, j + 9973);
        const x = i * sp + (r1 - 0.5) * sp * 1.4;
        const z = j * sp + (r2 - 0.5) * sp * 1.4;
        const dx = x - cx, dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > R2) continue;

        let h = this.terrain.gridHeight(x, z);
        if (h === null) continue;
        if (h < 1.4 || h > 300) continue;

        // grass on soil, dry scrub tufts on sand — nothing on the tracks
        surface(x, z, false, _S);
        splat(_S, 1, _sp);
        const green = _sp[0], sand = _sp[1];
        if (green < 0.30 && sand < 0.55) continue;
        if (_S.trail > 0.3) continue;
        if (sand > green && r3 > 0.15) continue;
        const vg = villageAt(x, z);
        if (vg && r3 < vg.w * 0.75) continue;      // mown around the houses        // only the odd tuft in the sand

        const fade = 1 - d2 / R2;
        const scale = (0.34 + r3 * 0.46) * clamp(fade * 2.2, 0.3, 1);
        _p.set(x, h - 0.05, z);
        _q.setFromAxisAngle(AXIS_Y, r3 * 6.283);
        _s.set(scale, scale * (0.75 + r1 * 0.7), scale);
        _m.compose(_p, _q, _s);
        this.mesh.setMatrixAt(n, _m);

        // tint: lush green on soil, bleached straw on sand, plus variation
        const dry = clamp(sand * 1.3, 0, 1);
        const v = 0.80 + r1 * 0.40;
        this._c.setRGB(
          (0.70 + dry * 0.46) * v,
          (0.94 - dry * 0.20) * v,
          (0.52 + dry * 0.10) * v
        );
        this.mesh.setColorAt(n, this._c);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
