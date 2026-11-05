/* ------------------------------------------------------------------
   input.js — keyboard, gamepad and touch, unified into one state
   object. The on-screen D-pad is fully multi-touch: you can hold
   accelerate, steer and climb at the same time.
------------------------------------------------------------------ */

import { clamp } from './noise.js';

const KEYMAP = {
  up:      ['KeyW', 'ArrowUp'],
  down:    ['KeyS', 'ArrowDown'],
  left:    ['KeyA', 'ArrowLeft'],
  right:   ['KeyD', 'ArrowRight'],
  boost:   ['ShiftLeft', 'ShiftRight'],
  lift:    ['Space'],
  descend: ['ControlLeft', 'ControlRight', 'KeyZ'],
  fly:     ['KeyF'],
  cam:     ['KeyC'],
  reset:   ['KeyR'],
  lights:  ['KeyL'],
  mute:    ['KeyM'],
  timeBack:['BracketLeft'],
  timeFwd: ['BracketRight']
};

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.touch = {};          // btn name -> Set of pointerIds
    this.pad = null;

    this.state = {
      throttle: 0, brake: 0, steer: 0, pitch: 0,
      boost: false, lift: false, descend: false, handbrake: false,
      toggleFly: false, toggleCam: false, reset: false, toggleLights: false, toggleMute: false,
      timeShift: 0, boostArmed: false,
      lookX: 0, lookY: 0, lookActive: false
    };
    this._edges = { fly: false, cam: false, reset: false, lights: false, mute: false };
    /* Double-tap forward to engage turbo: tap W/↑ twice inside 320 ms and it
       stays on for as long as you keep holding. Same gesture works on the
       thumbstick — flick forward twice. */
    this._lastFwdTap = -1e9;
    this._tapBoost = false;
    this.hasTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.usedTouch = false;

    /* ---------------- keyboard ---------------- */
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (KEYMAP.fly.includes(e.code)) this._edges.fly = true;
      if (KEYMAP.cam.includes(e.code)) this._edges.cam = true;
      if (KEYMAP.reset.includes(e.code)) this._edges.reset = true;
      if (KEYMAP.lights.includes(e.code)) this._edges.lights = true;
      if (KEYMAP.mute.includes(e.code)) this._edges.mute = true;
      if (KEYMAP.up.includes(e.code)) this.tapForward();
    }, { passive: false });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (KEYMAP.up.includes(e.code) && !this.held('up')) this._tapBoost = false;
    });
    addEventListener('blur', () => this.keys.clear());

    /* ---------------- touch buttons ---------------- */
    const bind = (el) => {
      const name = el.dataset.btn;
      if (!this.touch[name]) this.touch[name] = new Set();
      const down = (e) => {
        e.preventDefault();
        this.usedTouch = true;
        this.touch[name].add(e.pointerId);
        el.classList.add('on');
        if (name === 'fly') this._edges.fly = true;
        if (name === 'cam') this._edges.cam = true;
        if (name === 'reset') this._edges.reset = true;
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
      };
      const up = (e) => {
        this.touch[name].delete(e.pointerId);
        if (!this.touch[name].size) el.classList.remove('on');
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('contextmenu', e => e.preventDefault());
    };
    document.querySelectorAll('[data-btn]').forEach(bind);

    /* ---------------- analogue thumbstick ----------------
       Continuous steering and throttle in any direction. The stick
       re-centres wherever the thumb lands inside the live zone, so you
       never have to find it, and it springs back on release. */
    this.stick = { x: 0, y: 0, active: false, id: null };
    const zone = document.getElementById('stickZone');
    const stickEl = document.getElementById('stick');
    const knobEl = document.getElementById('stickKnob');
    if (zone && stickEl && knobEl) {
      const R = () => parseFloat(getComputedStyle(stickEl).getPropertyValue('--r')) || 82;
      let home = null;

      const place = (cx, cy) => {
        const zb = zone.getBoundingClientRect();
        stickEl.style.left = (cx - zb.left) + 'px';
        stickEl.style.bottom = (zb.bottom - cy) + 'px';
      };
      const setKnob = (dx, dy) => {
        knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
      };

      const down = (e) => {
        if (this.stick.id !== null) return;
        e.preventDefault();
        this.usedTouch = true;
        this.stick.id = e.pointerId;
        this.stick.active = true;
        if (!home) home = { left: stickEl.style.left, bottom: stickEl.style.bottom };
        // keep the stick fully on screen even if you grab near an edge
        const r = R();
        const zb = zone.getBoundingClientRect();
        const cx = clamp(e.clientX, zb.left + r + 6, zb.right - 8);
        const cy = clamp(e.clientY, zb.top + 8, zb.bottom - r - 6);
        place(cx, cy);
        this.stickCentre = { x: cx, y: cy };
        stickEl.classList.add('live');
        try { zone.setPointerCapture(e.pointerId); } catch (_) {}
        move(e);
      };

      const move = (e) => {
        if (e.pointerId !== this.stick.id) return;
        const r = R();
        let dx = e.clientX - this.stickCentre.x;
        let dy = e.clientY - this.stickCentre.y;
        const len = Math.hypot(dx, dy);
        const max = r * 0.82;
        if (len > max) { dx *= max / len; dy *= max / len; }
        setKnob(dx, dy);
        // radial dead zone, then a smooth ramp to full deflection
        const nx = dx / max, ny = -dy / max;
        const mag = Math.hypot(nx, ny);
        if (mag < 0.16) {
          this.stick.x = 0; this.stick.y = 0;
          this._stickFwd = false;
          return;
        }
        // flick forward twice to arm turbo, same as double-tapping W
        if (-dy / max > 0.75) {
          if (!this._stickFwd) { this._stickFwd = true; this.tapForward(); }
        } else if (-dy / max < 0.45) this._stickFwd = false;
        const k = Math.min(1, (mag - 0.16) / (1 - 0.16)) / mag;
        this.stick.x = clamp(nx * k, -1, 1);
        this.stick.y = clamp(ny * k, -1, 1);
      };

      const up = (e) => {
        if (e.pointerId !== this.stick.id) return;
        this.stick.id = null;
        this.stick.active = false;
        this.stick.x = 0; this.stick.y = 0;
        this._stickFwd = false;
        this._tapBoost = false;
        setKnob(0, 0);
        stickEl.classList.remove('live');
        if (home) { stickEl.style.left = home.left; stickEl.style.bottom = home.bottom; }
      };

      zone.addEventListener('pointerdown', down);
      zone.addEventListener('pointermove', move);
      zone.addEventListener('pointerup', up);
      zone.addEventListener('pointercancel', up);
      zone.addEventListener('contextmenu', e => e.preventDefault());
    }

    /* ---------------- drag to look ---------------- */
    if (canvas) {
      let id = null, lx = 0, ly = 0;
      canvas.addEventListener('pointerdown', (e) => {
        if (id !== null) return;
        id = e.pointerId; lx = e.clientX; ly = e.clientY;
        this.state.lookActive = true;
      });
      canvas.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        this.state.lookX += (e.clientX - lx) * 0.0055;
        this.state.lookY += (e.clientY - ly) * 0.0045;
        this.state.lookY = clamp(this.state.lookY, -0.85, 0.95);
        lx = e.clientX; ly = e.clientY;
      });
      const end = (e) => { if (e.pointerId === id) { id = null; this.state.lookActive = false; } };
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
    }

    addEventListener('gamepadconnected', (e) => { this.pad = e.gamepad.index; });
    addEventListener('gamepaddisconnected', () => { this.pad = null; });
  }

  /** Register a forward tap; two in quick succession latch turbo on. */
  tapForward() {
    const now = performance.now();
    if (now - this._lastFwdTap < 320) this._tapBoost = true;
    this._lastFwdTap = now;
  }

  held(name) {
    const keys = KEYMAP[name];
    if (keys) for (const k of keys) if (this.keys.has(k)) return true;
    const t = this.touch[name];
    return !!(t && t.size);
  }

  /** @param forwardSpeed  m/s along the nose, used to pick brake vs reverse */
  update(dt, forwardSpeed, flying) {
    const s = this.state;
    let up = this.held('up') ? 1 : 0;
    let down = this.held('down') ? 1 : 0;
    let left = this.held('left') ? 1 : 0;
    let right = this.held('right') ? 1 : 0;
    let boost = this.held('boost') || !!(this.touch.boost && this.touch.boost.size);
    // double-tap turbo only counts while you are actually going forward
    if (this._tapBoost && (this.held('up') || (this.stick && this.stick.y > 0.3))) boost = true;
    else if (this._tapBoost && !this.held('up') && !(this.stick && this.stick.y > 0.3)) this._tapBoost = false;
    let lift = this.held('lift') || !!(this.touch.lift && this.touch.lift.size);
    let descend = this.held('descend');
    let handbrake = (!flying && this.keys.has('Space')) || !!(this.touch.brake && this.touch.brake.size);

    /* ---------------- gamepad ---------------- */
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = this.pad !== null ? pads[this.pad] : (pads && pads[0]);
    let axSteer = 0;
    if (gp && gp.connected) {
      const dz = (v) => (Math.abs(v) < 0.14 ? 0 : v);
      axSteer = dz(gp.axes[0] || 0);
      const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
      const lt = gp.buttons[6] ? gp.buttons[6].value : 0;
      if (rt > 0.05) up = Math.max(up, rt);
      if (lt > 0.05) down = Math.max(down, lt);
      if (gp.buttons[0] && gp.buttons[0].pressed) lift = true;
      if (gp.buttons[1] && gp.buttons[1].pressed) handbrake = true;
      if (gp.buttons[5] && gp.buttons[5].pressed) boost = true;
      if (gp.buttons[2] && gp.buttons[2].pressed) {
        if (!this._padFly) { this._edges.fly = true; this._padFly = true; }
      } else this._padFly = false;
      if (gp.buttons[3] && gp.buttons[3].pressed) {
        if (!this._padCam) { this._edges.cam = true; this._padCam = true; }
      } else this._padCam = false;
      if (gp.buttons[9] && gp.buttons[9].pressed) this._edges.reset = true;
      const ly = dz(gp.axes[1] || 0);
      if (ly) s.pitch = -ly;
    }

    /* ---------------- thumbstick ---------------- */
    const st = this.stick;
    if (st && st.active) {
      if (st.y > 0) up = Math.max(up, st.y);
      else if (st.y < 0) down = Math.max(down, -st.y);
    }

    /* ---------------- combine ---------------- */
    const stickX = st ? st.x : 0;
    const steerRaw = clamp(right - left + axSteer + stickX, -1, 1);
    // digital keys get smoothed so steering does not snap; the stick is
    // already analogue, so it goes through almost untouched
    const analogue = Math.abs(stickX) > 0.001 || Math.abs(axSteer) > 0.001;
    const kSmooth = 1 - Math.exp(-(analogue ? 26 : 14) * dt);
    s.steer += (steerRaw - s.steer) * kSmooth;
    if (Math.abs(s.steer) < 0.001) s.steer = 0;

    if (flying) {
      // forward flies level; pulling back drops the altitude rather than
      // braking, which is what the down control should obviously do up here
      s.throttle = up;
      s.brake = 0;
      s.pitch = 0;
      if (down > 0.15) descend = true;
    } else {
      if (up && !down) { s.throttle = up; s.brake = 0; }
      else if (down && !up) {
        if (forwardSpeed > 1.2) { s.throttle = 0; s.brake = down; }
        else { s.throttle = -down * 0.55; s.brake = 0; }
      } else { s.throttle = 0; s.brake = 0; }
      s.pitch = (up ? -0.6 : 0) + (down ? 0.6 : 0);   // air control on jumps
    }

    s.boost = boost;
    s.boostArmed = this._tapBoost;
    s.lift = lift;
    s.descend = descend;
    s.handbrake = handbrake;

    s.toggleFly = this._edges.fly;
    s.toggleCam = this._edges.cam;
    s.reset = this._edges.reset;
    s.toggleLights = this._edges.lights;
    s.toggleMute = this._edges.mute;
    s.timeShift = (this.held('timeFwd') ? 1 : 0) - (this.held('timeBack') ? 1 : 0);

    this._edges.fly = this._edges.cam = this._edges.reset = this._edges.lights = this._edges.mute = false;

    // let the look angle drift back behind the truck
    if (!s.lookActive) {
      s.lookX *= Math.exp(-1.8 * dt);
      s.lookY *= Math.exp(-1.4 * dt);
    }
    return s;
  }
}
