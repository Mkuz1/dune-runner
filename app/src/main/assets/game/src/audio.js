/* ------------------------------------------------------------------
   audio.js — a tiny Web Audio engine. No sample files: the motor, the
   tyre roar, the wind and the thrusters are all synthesised, so the
   build stays a few hundred KB.
------------------------------------------------------------------ */

import { clamp, lerp } from './noise.js';

function noiseBuffer(ctx, seconds = 2) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;      // slightly brown
    d[i] = last * 3.2;
  }
  return buf;
}

export class Audio {
  constructor() {
    this.ready = false;
    this.enabled = true;
    this.volume = 0.55;
    this.started = false;
    this.rpm = 0;
  }

  start() {
    if (this.ready) return;
    this.started = true;                 // a user gesture has happened
    if (this.volume <= 0) return;        // stay silent; build the graph on unmute
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);

    /* ---- engine: two detuned saws through a resonant low-pass ---- */
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 700;
    this.engFilter.Q.value = 5.5;
    this.osc = [];
    for (const detune of [0, 7, -9]) {
      const o = ctx.createOscillator();
      o.type = detune === 0 ? 'sawtooth' : 'square';
      o.frequency.value = 55;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = detune === 0 ? 0.6 : 0.22;
      o.connect(g).connect(this.engFilter);
      o.start();
      this.osc.push(o);
    }
    // sub thump
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    this.sub.frequency.value = 40;
    this.subGain = ctx.createGain(); this.subGain.gain.value = 0.5;
    this.sub.connect(this.subGain).connect(this.engFilter);
    this.sub.start();
    this.engFilter.connect(this.engGain).connect(this.master);

    /* ---- tyre / wind noise ---- */
    const nb = noiseBuffer(ctx);
    this.noise = ctx.createBufferSource();
    this.noise.buffer = nb; this.noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 900;
    this.noiseFilter.Q.value = 0.8;
    this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
    this.noise.start();

    /* ---- thruster ---- */
    this.thr = ctx.createBufferSource();
    this.thr.buffer = nb; this.thr.loop = true;
    this.thrFilter = ctx.createBiquadFilter();
    this.thrFilter.type = 'highpass';
    this.thrFilter.frequency.value = 1400;
    this.thrGain = ctx.createGain(); this.thrGain.gain.value = 0;
    this.thr.connect(this.thrFilter).connect(this.thrGain).connect(this.master);
    this.thr.start();

    this.ready = true;
    this.fade(this.volume, 1.2);
  }

  fade(to, time = 0.4) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(to, t, time / 3);
  }

  /** 0 mutes; anything above starts the graph lazily on first unmute. */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.enabled = this.volume > 0;
    if (!this.ready) {
      if (this.enabled && this.started) this.start();
      return;
    }
    this.fade(this.volume, 0.25);
    if (this.enabled && this.ctx.state === 'suspended') this.ctx.resume();
  }

  update(dt, phys, input) {
    if (!this.ready || !this.enabled) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const t = this.ctx.currentTime;
    const set = (p, v, tc = 0.06) => p.setTargetAtTime(v, t, tc);

    const speed = phys.speed;
    const load = phys.engineLoad;

    // fake gearbox: revs climb then drop as it shifts
    const gearSpan = 15;
    const gear = Math.min(5, Math.floor(speed / gearSpan));
    const inGear = (speed - gear * gearSpan) / gearSpan;
    const targetRpm = clamp(0.16 + inGear * 0.9 + load * 0.35 + phys.wheelSlip * 0.5, 0, 1.45);
    this.rpm = lerp(this.rpm, targetRpm, 1 - Math.exp(-5 * dt));

    if (phys.flying) {
      const f = 62 + this.rpm * 40 + phys.pos.y * 0.004;
      for (const o of this.osc) set(o.frequency, f, 0.1);
      set(this.sub.frequency, f * 0.5, 0.1);
      set(this.engFilter.frequency, 480 + load * 500);
      set(this.engGain.gain, 0.10 + load * 0.06);
      set(this.thrGain.gain, 0.05 + (input.lift ? 0.14 : 0) + Math.abs(input.throttle) * 0.10 + (input.boost ? 0.08 : 0));
      set(this.thrFilter.frequency, 1100 + speed * 12);
      set(this.noiseGain.gain, clamp(speed / 120, 0, 1) * 0.11);
      set(this.noiseFilter.frequency, 600 + speed * 10);
    } else {
      const f = 46 + this.rpm * 96;
      for (const o of this.osc) set(o.frequency, f, 0.05);
      set(this.sub.frequency, f * 0.5, 0.05);
      set(this.engFilter.frequency, 380 + this.rpm * 1500 + load * 700);
      set(this.engGain.gain, 0.085 + load * 0.10 + this.rpm * 0.03);
      set(this.thrGain.gain, 0);

      const rough = phys.grounded ? clamp(speed / 34, 0, 1) : 0;
      const splash = phys.inWater ? 0.22 : 0;
      set(this.noiseGain.gain, rough * (0.10 + phys.wheelSlip * 0.20) + splash);
      set(this.noiseFilter.frequency, 380 + speed * 26 + phys.wheelSlip * 900);
      set(this.noiseFilter.Q, phys.inWater ? 0.5 : 0.9);
    }
  }
}
