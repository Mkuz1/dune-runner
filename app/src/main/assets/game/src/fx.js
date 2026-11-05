/* ------------------------------------------------------------------
   fx.js — billboarded particle system for wheel dust, sand rooster
   tails, water spray and the flight thrusters. One instanced draw call
   for the whole lot.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';
import { clamp } from './noise.js';

const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec4 iCol;
attribute vec2 iSize;      // x = radius, y = spin
uniform vec3 uRight;
uniform vec3 uUp;
varying vec2 vUv;
varying vec4 vCol;
void main(){
  vUv = uv;
  vCol = iCol;
  float c = cos( iSize.y ), s = sin( iSize.y );
  vec2 p = vec2( position.x * c - position.y * s, position.x * s + position.y * c ) * iSize.x;
  vec3 wp = iPos + uRight * p.x + uUp * p.y;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}`;

const FRAG = /* glsl */`
precision mediump float;
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vCol;
void main(){
  vec4 t = texture2D( uMap, vUv );
  float a = t.a * vCol.a;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( vCol.rgb * t.rgb, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Particles {
  constructor(scene, map, max = 720, additive = false) {
    this.max = max;
    this.n = 0;
    this.px = new Float32Array(max); this.py = new Float32Array(max); this.pz = new Float32Array(max);
    this.vx = new Float32Array(max); this.vy = new Float32Array(max); this.vz = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.spin = new Float32Array(max); this.spinV = new Float32Array(max);
    this.cr = new Float32Array(max); this.cg = new Float32Array(max); this.cb = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);

    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aCol.setUsage(THREE.DynamicDrawUsage);
    this.aSize.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iCol', this.aCol);
    geo.setAttribute('iSize', this.aSize);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.uniforms = {
      uMap: { value: map },
      uRight: { value: new THREE.Vector3(1, 0, 0) },
      uUp: { value: new THREE.Vector3(0, 1, 0) }
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.geo = geo;
    this.mesh.name = 'particles';
    scene.add(this.mesh);
  }

  spawn(o) {
    let i = this.n < this.max ? this.n++ : (Math.random() * this.max) | 0;
    this.px[i] = o.x; this.py[i] = o.y; this.pz[i] = o.z;
    this.vx[i] = o.vx; this.vy[i] = o.vy; this.vz[i] = o.vz;
    this.life[i] = 0; this.maxLife[i] = o.life;
    this.s0[i] = o.s0; this.s1[i] = o.s1;
    this.spin[i] = Math.random() * 6.283; this.spinV[i] = (Math.random() - 0.5) * 2.2;
    this.cr[i] = o.r; this.cg[i] = o.g; this.cb[i] = o.b;
    this.alpha[i] = o.a;
    this.grav[i] = o.grav === undefined ? -2.2 : o.grav;
    this.drag[i] = o.drag === undefined ? 1.15 : o.drag;
  }

  update(dt, camera) {
    const cm = camera.matrixWorld.elements;
    this.uniforms.uRight.value.set(cm[0], cm[1], cm[2]);
    this.uniforms.uUp.value.set(cm[4], cm[5], cm[6]);

    let w = 0;
    const P = this.aPos.array, C = this.aCol.array, S = this.aSize.array;
    for (let i = 0; i < this.n; i++) {
      this.life[i] += dt;
      const t = this.life[i] / this.maxLife[i];
      if (t >= 1) continue;

      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d; this.vz[i] *= d;
      this.vy[i] = this.vy[i] * d + this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.spin[i] += this.spinV[i] * dt;

      const fade = t < 0.14 ? t / 0.14 : 1 - (t - 0.14) / 0.86;
      P[w * 3] = this.px[i]; P[w * 3 + 1] = this.py[i]; P[w * 3 + 2] = this.pz[i];
      C[w * 4] = this.cr[i]; C[w * 4 + 1] = this.cg[i]; C[w * 4 + 2] = this.cb[i];
      C[w * 4 + 3] = this.alpha[i] * fade * fade;
      S[w * 2] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      S[w * 2 + 1] = this.spin[i];
      w++;
    }

    // compact the pool so dead particles do not accumulate
    if (w < this.n * 0.55 && this.n > 40) this.compact();

    this.geo.instanceCount = w;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
  }

  compact() {
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] / this.maxLife[i] >= 1) continue;
      if (k !== i) {
        this.px[k] = this.px[i]; this.py[k] = this.py[i]; this.pz[k] = this.pz[i];
        this.vx[k] = this.vx[i]; this.vy[k] = this.vy[i]; this.vz[k] = this.vz[i];
        this.life[k] = this.life[i]; this.maxLife[k] = this.maxLife[i];
        this.s0[k] = this.s0[i]; this.s1[k] = this.s1[i];
        this.spin[k] = this.spin[i]; this.spinV[k] = this.spinV[i];
        this.cr[k] = this.cr[i]; this.cg[k] = this.cg[i]; this.cb[k] = this.cb[i];
        this.alpha[k] = this.alpha[i];
        this.grav[k] = this.grav[i]; this.drag[k] = this.drag[i];
      }
      k++;
    }
    this.n = k;
  }
}

/* ------------------------------------------------------------------ */
export class Fx {
  constructor(scene, textures, quality) {
    const cap = quality.tier === 'low' ? 260 : quality.tier === 'med' ? 520 : 900;
    this.dust = new Particles(scene, textures.dust, cap, false);
    this.spray = new Particles(scene, textures.smoke, Math.floor(cap * 0.5), false);
    this.thrust = new Particles(scene, textures.glow, Math.floor(cap * 0.4), true);
    this.acc = 0;
    this.q = quality;
    this._v = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._f = new THREE.Vector3();
  }

  update(dt, phys, vehicle, camera, env) {
    const speed = phys.speed;
    const fwd = this._f.set(0, 0, 1).applyQuaternion(phys.quat);

    /* ---- wheel dust / sand ---- */
    if (!phys.flying) {
      for (const w of phys.wheels) {
        if (!w.grounded) continue;
        const sandy = w.surf === 1;
        const dirty = w.surf === 2;
        const intensity = clamp(speed / 26, 0, 1) * (0.35 + w.slip * 1.5) * (sandy ? 1.5 : dirty ? 1.1 : 0.55);
        if (intensity < 0.05) continue;
        const count = Math.min(3, Math.floor(intensity * 3 * (this.q.tier === 'low' ? 0.4 : 1)) + (Math.random() < intensity ? 1 : 0));
        for (let k = 0; k < count; k++) {
          const back = -phys.forwardSpeed * 0.12;
          const jx = (Math.random() - 0.5) * 0.5;
          const jz = (Math.random() - 0.5) * 0.5;
          const r = sandy ? 0.86 : dirty ? 0.55 : 0.44;
          const g = sandy ? 0.72 : dirty ? 0.43 : 0.42;
          const b = sandy ? 0.50 : dirty ? 0.30 : 0.28;
          this.dust.spawn({
            x: w.cx + jx, y: w.cy + 0.12, z: w.cz + jz,
            vx: fwd.x * back + (Math.random() - 0.5) * 2.2,
            vy: 0.8 + Math.random() * 1.8 + w.slip * 2.5,
            vz: fwd.z * back + (Math.random() - 0.5) * 2.2,
            life: 0.9 + Math.random() * 1.4,
            s0: 0.5 + Math.random() * 0.5, s1: 3.0 + Math.random() * 3.5 + speed * 0.05,
            r, g, b, a: 0.30 * intensity + 0.12,
            grav: -0.8, drag: 1.5
          });
        }
      }
      if (phys.landedHard > 0.4 && Math.random() < 0.9) {
        for (let k = 0; k < 8; k++) {
          this.dust.spawn({
            x: phys.pos.x + (Math.random() - 0.5) * 2.4, y: phys.groundY + 0.2, z: phys.pos.z + (Math.random() - 0.5) * 2.4,
            vx: (Math.random() - 0.5) * 7, vy: 1.5 + Math.random() * 2.5, vz: (Math.random() - 0.5) * 7,
            life: 1.4, s0: 0.8, s1: 6.5, r: 0.78, g: 0.68, b: 0.52, a: 0.34, grav: -1.2, drag: 1.2
          });
        }
      }
    }

    /* ---- water spray ---- */
    if (phys.inWater && speed > 1.5) {
      const n = Math.min(6, 1 + Math.floor(speed * 0.35));
      for (let k = 0; k < n; k++) {
        this.spray.spawn({
          x: phys.pos.x + (Math.random() - 0.5) * 2.6, y: 0.25 + Math.random() * 0.4, z: phys.pos.z + (Math.random() - 0.5) * 2.6,
          vx: (Math.random() - 0.5) * 5, vy: 1.8 + Math.random() * 3.2, vz: (Math.random() - 0.5) * 5,
          life: 0.8 + Math.random() * 0.7,
          s0: 0.4, s1: 2.6, r: 0.90, g: 0.96, b: 1.0, a: 0.55, grav: -6.5, drag: 0.9
        });
      }
    }

    /* ---- turbo: a jet of flame out of the tailpipe ---- */
    if (phys.boosting) {
      for (let k = 0; k < 7; k++) {
        const t = k / 7;
        /* The 6x6 has dual side-exit pipes on the -X flank, just ahead of the
           lead tandem axle, angled down — so the flame shoots out sideways. */
        const pipe = k & 1 ? -0.52 : -0.42;
        this._v.set(-1.10 - t * 0.55, 0.56 - t * 0.12, pipe).applyQuaternion(phys.quat).add(phys.pos);
        this._side.set(-1, -0.25, -0.15).applyQuaternion(phys.quat);
        // white-hot at the pipe, orange then smoky further back
        const heat = 1 - t;
        this.thrust.spawn({
          x: this._v.x, y: this._v.y, z: this._v.z,
          vx: this._side.x * (9 + Math.random() * 5) + (Math.random() - 0.5) * 1.4,
          vy: this._side.y * 6 + 0.3 + Math.random() * 0.6,
          vz: this._side.z * (9 + Math.random() * 5) + (Math.random() - 0.5) * 1.4,
          life: 0.16 + Math.random() * 0.20,
          s0: 0.30 + t * 0.85, s1: 0.06 + t * 0.5,
          r: 1.0,
          g: 0.42 + heat * 0.55,
          b: 0.10 + heat * 0.62,
          a: 0.55 + heat * 0.45,
          grav: 1.6, drag: 2.4
        });
      }
      // a couple of soot puffs trailing behind the flame
      if (Math.random() < 0.5) {
        this._v.set(-1.75, 0.50, -0.47).applyQuaternion(phys.quat).add(phys.pos);
        this.spray.spawn({
          x: this._v.x, y: this._v.y, z: this._v.z,
          vx: this._side.x * 3.5 - fwd.x * 2 + (Math.random() - 0.5) * 2, vy: 0.8 + Math.random(),
          vz: this._side.z * 3.5 - fwd.z * 2 + (Math.random() - 0.5) * 2,
          life: 0.7 + Math.random() * 0.5, s0: 0.4, s1: 2.4,
          r: 0.26, g: 0.24, b: 0.23, a: 0.30, grav: 0.5, drag: 1.6
        });
      }
    }

    /* ---- tyre smoke while the handbrake is down ---- */
    if (phys.handbraking && speed > 4) {
      for (const w of phys.wheels) {
        if (!w.grounded || w.steers) continue;
        this.dust.spawn({
          x: w.cx, y: w.cy + 0.15, z: w.cz,
          vx: (Math.random() - 0.5) * 2.5, vy: 0.9 + Math.random() * 1.4,
          vz: (Math.random() - 0.5) * 2.5,
          life: 1.1 + Math.random(), s0: 0.55, s1: 4.2 + speed * 0.06,
          r: 0.80, g: 0.80, b: 0.82, a: 0.24, grav: -0.4, drag: 1.1
        });
      }
    }

    /* ---- thrusters ---- */
    if (phys.flying) {
      const p = phys.flyPower;
      const n = 2 + (phys.boost < 0.999 ? 2 : 0);
      for (let k = 0; k < n; k++) {
        const sx = (k % 2 ? 0.8 : -0.8), sz = (k < 2 ? 1.2 : -1.5);
        this._v.set(sx, -0.35, sz).applyQuaternion(phys.quat).add(phys.pos);
        this.thrust.spawn({
          x: this._v.x, y: this._v.y, z: this._v.z,
          vx: (Math.random() - 0.5) * 1.2, vy: -3.5 - Math.random() * 4, vz: (Math.random() - 0.5) * 1.2,
          life: 0.32 + Math.random() * 0.22,
          s0: 0.75 + p * 0.5, s1: 0.12,
          r: 0.55, g: 0.80, b: 1.0, a: 0.55 * p,
          grav: -1.0, drag: 2.6
        });
      }
    }

    this.dust.update(dt, camera);
    this.spray.update(dt, camera);
    this.thrust.update(dt, camera);
  }
}
