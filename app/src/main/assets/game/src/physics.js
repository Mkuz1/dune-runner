/* ------------------------------------------------------------------
   physics.js — rigid-body 4x4 with raycast suspension, a proper tyre
   friction circle, buoyancy in the sea, and an arcade flight mode.

   Ground mode  : four independent spring/damper struts plus per-wheel
                  longitudinal and lateral tyre forces with a friction
                  circle. Grip depends on what you are driving on — sand
                  is loose, rock bites, packed dirt is in between — so
                  weight transfer, drift, jumps and landings all fall out
                  of the simulation rather than being faked.
   Flight mode  : F lifts off, SPACE climbs, CTRL descends. The truck
                  banks into turns and keeps a soft floor above the
                  terrain so you can skim the dunes.

   The hot loop is allocation free: every vector below is scratch.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';
import { surface, normalAt, splat, SEA_LEVEL } from './world.js';
import { clamp, lerp, smoothstep } from './noise.js';
import { CAR } from './vehicle.js';
import { waveAt, waveVelAt } from './ocean.js';

/* --- hull, for the swimming model --- */
const HULL_BOTTOM = 0.44;     // underside of the body, in local Y
const HULL_DEPTH = 0.95;      // how far it can sink before it is fully under
const HULL_HALF_LEN = 2.2;

const GRAV = 9.81;
const MASS = 1950;
const SUS_REST = 0.26;        // droop travel above the loaded position
const SUS_MAX = 0.40;         // hard bump stop
/* Six wheels share the load four used to, so per-wheel spring and damper
   rates scale by 4/N: the truck sits at the same ride height and has the
   same bounce as before, and all the handling tuning still holds. */
const N_WHEELS = CAR.axles.length * 2;
const SUS_K = 62000 * 4 / N_WHEELS;   // N/m per wheel
const SUS_C = 6800 * 4 / N_WHEELS;    // N per m/s
const MAX_STEER = 0.58;
const WHEEL_R = CAR.wheelR;

/* scratch ---------------------------------------------------------- */
const _force = new THREE.Vector3();
const _torque = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _a = new THREE.Vector3();
const _n = new THREE.Vector3();
const _r = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _wf = new THREE.Vector3();
const _wr = new THREE.Vector3();
const _tmpF = new THREE.Vector3();
const _tmpT = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _M3 = new THREE.Matrix3();
const _M4 = new THREE.Matrix4();
const AXIS_Y = new THREE.Vector3(0, 1, 0);

export class VehiclePhysics {
  constructor(spawn) {
    this.pos = new THREE.Vector3(spawn.x, spawn.h + 1.0, spawn.z);
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();

    const w = 2.0, h = 2.0, d = CAR.length;
    this.invI = new THREE.Vector3(
      12 / (MASS * (h * h + d * d)),
      12 / (MASS * (w * w + d * d)),
      12 / (MASS * (w * w + h * h))
    );

    // same order as Vehicle's visual wheels: per axle, +X then -X
    this.wheels = CAR.axles.flatMap(a => [
      { x: CAR.trackHalf, z: a.z, steers: a.steers },
      { x: -CAR.trackHalf, z: a.z, steers: a.steers }
    ]).map(o => ({
      ...o, comp: 0, spin: 0, grounded: false, load: 0, surf: 0, slip: 0,
      normal: new THREE.Vector3(0, 1, 0), cx: 0, cy: 0, cz: 0
    }));

    this.steer = 0;
    this.flying = false;
    this.flyPower = 0;
    this.yaw = 0;
    this.yawRate = 0;
    this.climbS = 0;
    this.pitchVis = 0;
    this.bankVis = 0;
    this.boost = 1;
    this.boostLock = false;      // set when the meter empties, cleared on refill

    this.speed = 0;
    this.forwardSpeed = 0;
    this.altitude = 0;
    this.groundY = spawn.h;
    this.grounded = false;
    this.inWater = false;
    this.submersion = 0;
    this.wheelSlip = 0;
    this.engineLoad = 0;
    this.trailness = 0;
    this.desertness = 0;
    this.sandiness = 0;
    this.landedHard = 0;
    this.boosting = false;
    this.handbraking = false;
    this.time = 0;          // shared with the ocean so the swell matches
    this.waterY = -1e9;

    this._sp = [0, 0, 0, 0];
    this._S = { h: 0, desert: 0, land: 0, trail: 0, base: 0 };
  }

  reset(x, z, h) {
    this.pos.set(x, h + 1.2, z);
    this.quat.identity();
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.flying = false;
    this.flyPower = 0;
    this.yaw = 0;
    this.yawRate = 0;
    this.climbS = 0;
    this.pitchVis = this.bankVis = 0;
  }

  yawAngle() {
    _fwd.set(0, 0, 1).applyQuaternion(this.quat);
    return Math.atan2(_fwd.x, _fwd.z);
  }

  /* ================================================================ */
  update(dt, input) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    const steps = Math.min(5, Math.max(1, Math.ceil(dt / (1 / 110))));
    const h = dt / steps;

    if (input.toggleFly) {
      this.flying = !this.flying;
      if (this.flying) {
        this.flyPower = 0;
        this.yaw = this.yawAngle();
        this.yawRate = 0;
        this.climbS = 0;
        this.angVel.set(0, 0, 0);
      }
    }

    // turbo meter
    /* Turbo meter.

       This used to drain whenever the turbo *input* was on and recharge
       whenever it was off — which sounds right and is not. Holding forward
       after a double-tap keeps the input latched on indefinitely, so once
       the meter hit zero the "recharge" branch was never reached: turbo
       died permanently and the only cure was letting go of the throttle.
       That is the "turbo stops working after a few times".

       Now it drains only while turbo is actually being *delivered*, so the
       meter always refills, whatever the player is holding down. The lock
       adds hysteresis: once empty it needs a real refill before it will
       re-engage, otherwise it would stutter on and off at zero. */
    const wantBoost = input.boost
      && (Math.abs(input.throttle) > 0.1 || (this.flying && (input.lift || input.throttle > 0)));
    if (this.boost <= 0.001) this.boostLock = true;
    if (this.boostLock && this.boost > 0.25) this.boostLock = false;
    const boosting = wantBoost && !this.boostLock;
    if (boosting) this.boost = Math.max(0, this.boost - dt * 0.105);   // ~9.5 s of turbo
    else this.boost = Math.min(1, this.boost + dt * 0.17);             // ~5.9 s to refill

    // speed-sensitive steering
    const spd = this.vel.length();
    const limit = MAX_STEER * (1 - 0.60 * smoothstep(4, 44, spd));
    const target = input.steer * limit;
    const rate = 5.0 * dt;
    this.steer += clamp(target - this.steer, -rate, rate);

    this.handbraking = !!input.handbrake && !this.flying;
    this.landedHard = Math.max(0, this.landedHard - dt * 3);
    for (let s = 0; s < steps; s++) {
      if (this.flying) this.stepFlight(h, input, boosting);
      else this.stepGround(h, input, boosting);
    }

    this.speed = this.vel.length();
    _fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.forwardSpeed = this.vel.dot(_fwd);

    const g = surface(this.pos.x, this.pos.z, true, this._S);
    this.groundY = g.h;
    this.altitude = this.pos.y - Math.max(g.h, SEA_LEVEL);
    this.trailness = g.trail;
    this.desertness = g.desert;
    splat(g, 1, this._sp);
    this.sandiness = this._sp[1];
  }

  /* ============================ GROUND ============================ */
  stepGround(dt, input, boosting) {
    const q = this.quat;
    _force.set(0, -GRAV * MASS, 0);
    _torque.set(0, 0, 0);
    _up.set(0, 1, 0).applyQuaternion(q);
    _fwd.set(0, 0, 1).applyQuaternion(q);

    const wasGrounded = this.grounded;
    const prevVy = this.vel.y;
    let groundedCount = 0;
    let slipSum = 0;

    const maxSpeed = boosting ? 130 : 66;          // turbo really moves
    const totalDrive = boosting ? 62000 : 23000;

    for (const w of this.wheels) {
      // strut top in world space
      _a.set(w.x, WHEEL_R + SUS_REST, w.z).applyQuaternion(q).add(this.pos);
      const S = surface(_a.x, _a.z, true, this._S);
      const gh = S.h;

      const droopY = _a.y - SUS_REST;               // wheel centre at full droop
      const comp = clamp((gh + WHEEL_R) - droopY, 0, SUS_MAX);
      w.comp = comp;
      w.cx = _a.x; w.cy = gh; w.cz = _a.z;

      if (comp <= 0.0002) { w.grounded = false; w.load = 0; continue; }
      groundedCount++;
      w.grounded = true;

      normalAt(_a.x, _a.z, 1.5, w.normal);
      _n.copy(w.normal);

      // contact-patch velocity
      _r.set(_a.x - this.pos.x, gh - this.pos.y, _a.z - this.pos.z);
      _vc.copy(this.angVel).cross(_r).add(this.vel);

      // ---- strut
      const vN = _vc.dot(_n);
      let N = SUS_K * comp - SUS_C * vN;
      if (comp > SUS_REST) N += (comp - SUS_REST) * 240000;      // bump stop
      N = clamp(N, 0, 60000);
      w.load = N;

      _tmpF.copy(_n).multiplyScalar(N);
      _force.add(_tmpF);
      _torque.add(_tmpT.copy(_r).cross(_tmpF));

      // ---- surface grip
      splat(S, w.normal.y, this._sp);
      const sp = this._sp;
      const mu = 1.00 * sp[0] + 0.78 * sp[1] + 1.26 * sp[2] + 1.16 * sp[3];
      w.surf = sp[1] > 0.45 ? 1 : sp[3] > 0.40 ? 2 : 0;

      /* ---- tyre axes on the ground plane
         The body's forward is +Z and up is +Y, so the vehicle's right-hand
         side is -X. A positive yaw about +Y therefore swings the wheels to
         the LEFT — hence the negation, so positive steer means turn right. */
      _wf.set(0, 0, 1);
      if (w.steers) _wf.applyQuaternion(_q1.setFromAxisAngle(AXIS_Y, -this.steer));
      _wf.applyQuaternion(q);
      _wf.addScaledVector(_n, -_wf.dot(_n));
      if (_wf.lengthSq() < 1e-6) continue;
      _wf.normalize();
      _wr.copy(_wf).cross(_n).normalize();

      const vF = _vc.dot(_wf);
      const vR = _vc.dot(_wr);

      // ---- longitudinal
      let fLong = input.throttle * (totalDrive / N_WHEELS) * (1 - clamp(Math.abs(vF) / maxSpeed, 0, 1));
      if (input.brake > 0) {
        fLong -= Math.sign(vF || 1) * input.brake * 11500 * clamp(Math.abs(vF) * 0.7, 0, 1);
      }
      fLong -= vF * 46;                                    // rolling resistance
      // coasting: engine braking, and enough static friction to hold on a hill
      if (Math.abs(input.throttle) < 0.02 && input.brake < 0.02) {
        const hold = clamp(1 - Math.abs(vF) / 3, 0, 1);
        fLong -= vF * (260 + hold * 9000);
      }

      // ---- handbrake: lock the rear axle and let go of the back end
      const hb = input.handbrake && !w.steers;
      if (hb) {
        // locked wheels drag hard against whichever way they are rolling
        fLong -= Math.sign(vF || 1) * 9000 * clamp(Math.abs(vF) * 0.9, 0, 1);
        w.spin *= 0.82;                       // visibly stops turning
      }

      // ---- lateral, from the slip angle (this is what stops it sliding)
      const slipAngle = Math.atan2(vR, Math.abs(vF) + 0.8);
      let fLat = -slipAngle * (w.steers ? 7.6 : 8.8) * N * (hb ? 0.10 : 1);

      /* ---- friction circle, with a real tyre's shape.
         Demand rises linearly with slip, then a measured tyre rounds off as
         it nears the limit and loses a little grip once it is properly
         sliding. A hard clip at the limit (what this used to do) makes the
         force jump between "gripping" and "sliding" from one step to the
         next: slides start with a snap and the chassis jolts. */
      const limit = mu * N * (hb ? 0.62 : 1);
      const mag = Math.hypot(fLong, fLat);
      if (mag > 1e-3 && limit > 1e-3) {
        const x = mag / limit;
        let f = x < 0.7 ? x : 0.7 + 0.3 * Math.tanh((x - 0.7) / 0.3);
        f *= 1 - 0.12 * smoothstep(1.4, 3.2, x);          // sliding friction < peak
        const k = f / x;
        fLong *= k; fLat *= k;
        w.slip = clamp((x - 1) * 0.6, 0, 1);
      } else w.slip = 0;
      slipSum += w.slip;

      _tmpF.set(0, 0, 0).addScaledVector(_wf, fLong).addScaledVector(_wr, fLat);
      _force.add(_tmpF);
      _torque.add(_tmpT.copy(_r).cross(_tmpF));

      w.spin += (vF / WHEEL_R) * dt;
      if (input.throttle > 0.05 && Math.abs(vF) < 2.5) w.spin += input.throttle * 10 * dt;
    }

    /* Turbo. Drive torque alone is wasted here: the friction circle caps
       what the tyres can transmit, so above about 19 kN the wheels just spin.
       The boost therefore adds a shove straight to the chassis, falling off
       as it approaches its own speed ceiling. */
    if (boosting && input.throttle > 0.1 && groundedCount > 0) {
      const vF = this.vel.dot(_fwd);
      const rocket = 17500 * clamp(1 - vF / 62, 0, 1) * input.throttle;
      _force.addScaledVector(_fwd, rocket);
      this.boosting = true;
    } else if (!this.inWater) this.boosting = false;

    this.grounded = groundedCount > 0;
    this.wheelSlip = clamp(slipSum / N_WHEELS, 0, 1);
    this.engineLoad = clamp(Math.abs(input.throttle) * (1 - this.speed / maxSpeed) + this.wheelSlip * 0.5, 0, 1);
    if (!wasGrounded && this.grounded && prevVy < -7) {
      this.landedHard = clamp(-prevVy / 18, 0, 1);
    }

    /* ---- swimming ------------------------------------------------
       Buoyancy is worked out against the actual wave surface, so the
       truck rides the swell instead of hovering on a flat plane. It
       steers like a boat: thrust from the wheels, a rudder yaw from the
       steering, and heavy resistance to sliding sideways. */
    const seaBed = surface(this.pos.x, this.pos.z, false, this._S).h;
    const seaDepth = Math.max(0, SEA_LEVEL - seaBed);
    this.waterY = seaDepth > 0.05
      ? SEA_LEVEL + waveAt(this.pos.x, this.pos.z, this.time, seaDepth) : -1e9;

    const hullY = this.pos.y + HULL_BOTTOM;
    const draft = this.waterY - hullY;
    this.submersion = clamp(draft / HULL_DEPTH, 0, 1);
    this.inWater = this.submersion > 0.02 && seaDepth > 0.05;

    if (this.inWater) {
      const sub = this.submersion;
      // displaced volume: it settles with roughly three quarters under
      _force.y += sub * MASS * GRAV * 1.55;   // rides with ~2/3 of the hull under

      // heave damping against the water's own vertical motion
      const wv = waveVelAt(this.pos.x, this.pos.z, this.time, seaDepth);
      _force.y -= (this.vel.y - wv) * 5200 * sub;

      // hull drag: low along the keel, very high sideways
      const vF = this.vel.dot(_fwd);
      _tmpF.copy(this.vel).addScaledVector(_fwd, -vF);          // lateral part
      _force.addScaledVector(_fwd, -vF * Math.abs(vF) * 120 * sub - vF * 300 * sub);
      _force.addScaledVector(_tmpF, -1450 * sub);

      // the wheels still paddle — and turbo drives them hard
      const swimThrust = boosting ? 15000 : 4300;
      _force.addScaledVector(_fwd, input.throttle * sub * swimThrust);
      if (boosting && input.throttle > 0.1) {
        // a turbo blast lifts the nose and planes the hull
        _force.y += sub * 5200 * input.throttle;
        this.boosting = true;
      }

      // rudder: turns on the spot at idle, tighter with way on
      const authority = 0.45 + 0.55 * clamp(Math.abs(vF) / 7, 0, 1);
      _torque.y -= this.steer * sub * 16000 * authority;
      if (input.throttle < -0.05) _torque.y += this.steer * sub * 9000; // reverse
      this.angVel.y *= 1 - Math.min(0.55, 2.4 * dt * sub);

      // keep the hull upright and level with the surface
      _torque.add(_tmpT.set(0, 1, 0).cross(_up).multiplyScalar(-5200 * sub));
      this.angVel.x *= 1 - Math.min(0.6, 4.0 * dt * sub);
      this.angVel.z *= 1 - Math.min(0.6, 4.0 * dt * sub);

      // the wheels keep turning: that is what is pushing it along
      for (const w of this.wheels) w.spin += input.throttle * 7 * dt;
    }

    // ---- aero drag
    _force.addScaledVector(this.vel, -(3.0 + this.wheelSlip + (boosting ? 1.1 : 0)) * this.vel.length() * 0.5);

    // ---- airborne stabiliser: big jumps land on their wheels
    if (!this.grounded && !this.inWater) {
      _torque.add(_tmpT.set(0, 1, 0).cross(_up).multiplyScalar(-MASS * 1.8));
      this.angVel.multiplyScalar(1 - Math.min(0.8, 1.4 * dt));
      if (input.pitch) _torque.x -= input.pitch * MASS * 3.0;
      if (input.steer) _torque.y -= input.steer * MASS * 1.6;
    }

    this.integrate(dt);

    const floor = surface(this.pos.x, this.pos.z, true, this._S).h - 1.15;
    if (this.pos.y < floor) {
      this.pos.y = floor;
      if (this.vel.y < 0) this.vel.y *= -0.15;
    }
  }

  /* ============================ FLIGHT ============================ */
  stepFlight(dt, input, boosting) {
    this.flyPower = Math.min(1, this.flyPower + dt * 1.5);

    _fwd.set(0, 0, 1).applyQuaternion(this.quat);
    _force.set(0, -GRAV * MASS, 0);

    // thrusters cancel gravity once spooled up
    _force.y += GRAV * MASS * this.flyPower;

    // climb and descend ease in and out (~0.3 s) instead of switching
    const climbT = (input.lift ? 1 : 0) - (input.descend ? 1 : 0);
    this.climbS += (climbT - this.climbS) * (1 - Math.exp(-7 * dt));
    const climb = Math.abs(this.climbS) < 0.01 && !climbT ? 0 : this.climbS;
    _force.y += climb * (boosting ? 32000 : 18500) * this.flyPower;

    // thinning air near the ceiling
    _force.y -= smoothstep(1500, 2200, this.pos.y) * 26000;

    /* Thrust follows the *heading*, not the nose. Pushing forward used to
       drive along the pitched-up body axis, so the truck climbed steadily
       whether you asked it to or not. Now forward is dead level and altitude
       is only ever changed by CLIMB and DESCEND. */
    _tmpF.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const thrust = input.throttle * (boosting ? 36000 : 18000);
    _force.addScaledVector(_tmpF, thrust * this.flyPower);

    // bleed off any residual vertical drift when neither climb nor descend
    if (climb === 0) _force.y -= this.vel.y * 2600;

    // drag
    _force.addScaledVector(this.vel, -1.05 * this.vel.length() * 0.5 - 320);

    this.vel.addScaledVector(_force, dt / MASS);
    this.pos.addScaledVector(this.vel, dt);

    // ---- attitude: yaw integrates, pitch and bank follow the controls
    // turn rate builds and settles like an aircraft's, not on/off
    const yawRateT = -input.steer * 1.30 * (0.55 + 0.45 * this.flyPower);
    this.yawRate += (yawRateT - this.yawRate) * (1 - Math.exp(-4.5 * dt));
    this.yaw += this.yawRate * dt;
    const bankT = -input.steer * 0.66;
    const pitchT = clamp(-this.vel.y * 0.020 + input.throttle * 0.05, -0.42, 0.42);
    const k = 1 - Math.exp(-5.5 * dt);
    this.bankVis = lerp(this.bankVis, bankT, k);
    this.pitchVis = lerp(this.pitchVis, pitchT, k);
    _euler.set(this.pitchVis, this.yaw, this.bankVis);
    _q2.setFromEuler(_euler);
    this.quat.slerp(_q2, 1 - Math.exp(-9 * dt));
    this.angVel.set(0, 0, 0);

    // ---- soft floor
    const S = surface(this.pos.x, this.pos.z, true, this._S);
    const floor = Math.max(S.h, SEA_LEVEL) + 1.25;
    if (this.pos.y < floor) {
      this.pos.y += (floor - this.pos.y) * Math.min(1, 14 * dt);
      if (this.vel.y < 0) this.vel.y *= 0.30;
    }

    this.grounded = false;
    this.inWater = false;
    this.submersion = 0;
    this.wheelSlip = 0;
    this.engineLoad = clamp(Math.abs(input.throttle) + (input.lift ? 0.7 : 0), 0, 1);
    for (const w of this.wheels) {
      w.comp = 0; w.grounded = false; w.load = 0; w.slip = 0;
      w.spin += this.vel.length() * 0.03 * dt;
    }
  }

  /* ========================== INTEGRATION ========================== */
  integrate(dt) {
    this.vel.addScaledVector(_force, dt / MASS);
    this.pos.addScaledVector(this.vel, dt);

    _M4.makeRotationFromQuaternion(this.quat);
    _M3.setFromMatrix4(_M4);
    const e = _M3.elements, t = _torque;

    const lx = e[0] * t.x + e[1] * t.y + e[2] * t.z;
    const ly = e[3] * t.x + e[4] * t.y + e[5] * t.z;
    const lz = e[6] * t.x + e[7] * t.y + e[8] * t.z;
    const ax = lx * this.invI.x, ay = ly * this.invI.y, az = lz * this.invI.z;

    this.angVel.x += (e[0] * ax + e[3] * ay + e[6] * az) * dt;
    this.angVel.y += (e[1] * ax + e[4] * ay + e[7] * az) * dt;
    this.angVel.z += (e[2] * ax + e[5] * ay + e[8] * az) * dt;
    /* A little artificial damping keeps the integrator calm, but on the
       ground the tyres already resist yaw; damping it hard as well made the
       steering feel mushy and the truck reluctant to rotate. */
    const dRoll = 1 - Math.min(0.35, 2.0 * dt);
    const dYaw = 1 - Math.min(0.35, (this.grounded ? 0.8 : 2.0) * dt);
    _up.set(0, 1, 0).applyQuaternion(this.quat);
    const wy = this.angVel.dot(_up);
    this.angVel.addScaledVector(_up, -wy).multiplyScalar(dRoll).addScaledVector(_up, wy * dYaw);

    this.integrateRotation(dt);
  }

  integrateRotation(dt) {
    const q = this.quat;
    const ox = this.angVel.x * 0.5, oy = this.angVel.y * 0.5, oz = this.angVel.z * 0.5;
    const dx = ox * q.w + oy * q.z - oz * q.y;
    const dy = oy * q.w + oz * q.x - ox * q.z;
    const dz = oz * q.w + ox * q.y - oy * q.x;
    const dw = -ox * q.x - oy * q.y - oz * q.z;
    q.set(q.x + dx * dt, q.y + dy * dt, q.z + dz * dt, q.w + dw * dt).normalize();
  }

  /* ------------------------------------------------------------------ */
  applyTo(vehicle) {
    vehicle.group.position.copy(this.pos);
    vehicle.group.quaternion.copy(this.quat);
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      const droop = this.flying ? -0.09 : 0;
      // same sign convention as the tyre forces above
      vehicle.setWheel(i, clamp(w.comp, -0.1, 0.30) + droop, -this.steer, w.spin);
    }
  }
}
