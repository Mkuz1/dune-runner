/* ------------------------------------------------------------------
   hud.js — speed / altitude gauge, compass minimap and status chips.
   The minimap is painted straight out of the shared terrain height
   field, so it always matches the ground you are driving on.
------------------------------------------------------------------ */

import { biomeName, villagesNear } from './world.js';
import { clamp, lerp } from './noise.js';

// 240° of a radius-76 arc = 76 · (240π/180)
const GAUGE_LEN = 318.4;

export class Hud {
  constructor(heightField) {
    this.hf = heightField;
    this.el = {
      root: document.getElementById('hud'),
      biome: document.getElementById('biomeName'),
      coords: document.getElementById('coords'),
      clock: document.getElementById('clock'),
      fps: document.getElementById('fps'),
      mode: document.getElementById('modeChip'),
      speed: document.getElementById('speedVal'),
      unit: document.getElementById('speedUnit'),
      alt: document.getElementById('altRead'),
      fill: document.getElementById('gaugeFill'),
      boost: document.getElementById('boostFill'),
      gauge: document.querySelector('.hud-gauge'),
      hint: document.getElementById('hint'),
      map: document.getElementById('minimap')
    };
    this.mapCtx = this.el.map ? this.el.map.getContext('2d') : null;

    // offscreen canvas holding the whole height field as a colour image
    const R = heightField.res;
    this.off = document.createElement('canvas');
    this.off.width = this.off.height = R;
    this.offCtx = this.off.getContext('2d');
    this.img = this.offCtx.createImageData(R, R);
    this.lastCenter = null;

    this.smoothSpeed = 0;
    this.acc = 0;
    this.frames = 0;
    this.fpsAcc = 0;
    this.hintTimer = 12;
    this.el.fill.style.strokeDasharray = `0 ${GAUGE_LEN}`;
  }

  show() { this.el.root.hidden = false; }

  /* ---------------- minimap ---------------- */
  paintField() {
    const hf = this.hf, R = hf.res, d = this.img.data;
    for (let i = 0; i < R * R; i++) {
      const h = hf.data[i];
      const desert = hf.biome[i];
      let r, g, b;
      if (h < -14) { r = 12; g = 30; b = 52; }
      else if (h < 0) {
        const t = (h + 14) / 14;
        r = 12 + t * 22; g = 30 + t * 70; b = 52 + t * 70;
      } else if (h < 7) { r = 205; g = 186; b = 138; }
      else {
        const alt = clamp((h - 7) / 260, 0, 1);
        const dr = 196, dg = 168, db = 112;      // desert
        const fr = 46 + alt * 90, fg = 84 + alt * 70, fb = 40 + alt * 70;   // forest → rock
        r = lerp(fr, dr, desert); g = lerp(fg, dg, desert); b = lerp(fb, db, desert);
        if (h > 200) { const s = clamp((h - 200) / 70, 0, 1); r = lerp(r, 235, s); g = lerp(g, 242, s); b = lerp(b, 250, s); }
      }
      // cheap relief shading from the west
      const x = i % R, y = (i / R) | 0;
      if (x > 0 && y > 0) {
        const dh = (h - hf.data[i - 1]) + (h - hf.data[i - R]);
        const sh = clamp(1 + dh * 0.02, 0.55, 1.5);
        r *= sh; g *= sh; b *= sh;
      }
      d[i * 4] = clamp(r, 0, 255); d[i * 4 + 1] = clamp(g, 0, 255);
      d[i * 4 + 2] = clamp(b, 0, 255); d[i * 4 + 3] = 255;
    }
    this.offCtx.putImageData(this.img, 0, 0);
  }

  drawMap(phys, heading) {
    const ctx = this.mapCtx;
    if (!ctx) return;
    const hf = this.hf;
    if (!this.lastCenter || this.lastCenter.x !== hf.center.x || this.lastCenter.y !== hf.center.y) {
      this.paintField();
      this.lastCenter = { x: hf.center.x, y: hf.center.y };
    }

    const W = this.el.map.width, H = this.el.map.height;
    const VIEW = 2100;                                  // metres across the dial
    const pxPerM = W / VIEW;
    const fieldPx = hf.res / hf.span;                   // field pixels per metre

    /* Dial rotation. Map space is x = world +X, y = world +Z (down the
       canvas). The truck's forward vector is therefore (sin h, cos h) in
       that space, and a heading-up dial has to put it at screen-up (0,-1).
       Canvas rotate(t) maps (x,y) to (x·cos t − y·sin t, x·sin t + y·cos t),
       so we need sin(h − t) = 0 and cos(h − t) = −1, i.e. t = h + π.

       It used to rotate by −h, which works out to sin(2h)/cos(2h): the map
       spun at *twice* the rate the truck turned and only agreed with
       reality at a handful of angles. */
    const rot = heading + Math.PI;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(rot);
    ctx.imageSmoothingEnabled = true;

    const scale = pxPerM / fieldPx;                     // field px → canvas px
    const cx = (phys.pos.x - hf.center.x) * fieldPx + hf.res / 2;
    const cy = (phys.pos.z - hf.center.y) * fieldPx + hf.res / 2;
    ctx.drawImage(this.off, -cx * scale, -cy * scale, hf.res * scale, hf.res * scale);
    ctx.restore();

    // player marker
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.fillStyle = '#ff8a29';
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(5.5, 7); ctx.lineTo(0, 4); ctx.lineTo(-5.5, 7);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();

    /* village markers — without these you could drive past a town all day
       and never know it was there */
    const vs = villagesNear(phys.pos.x, phys.pos.z, VIEW * 0.72);
    if (vs.length) {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(rot);
      for (const v of vs) {
        const mx = (v.cx - phys.pos.x) * pxPerM;
        const my = (v.cz - phys.pos.z) * pxPerM;
        if (Math.hypot(mx, my) > W / 2 - 8) continue;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(-rot);                          // keep the icon upright
        ctx.fillStyle = '#ffd08a';
        ctx.strokeStyle = 'rgba(20,12,4,.8)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();                           // little house glyph
        ctx.moveTo(0, -6); ctx.lineTo(5, -1); ctx.lineTo(5, 5);
        ctx.lineTo(-5, 5); ctx.lineTo(-5, -1);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }

    // range rings
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 1;
    for (const r of [W * 0.17, W * 0.33]) {
      ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, 6.283); ctx.stroke();
    }

    /* North marker. The dial is heading-up, so north is only at the top of
       the screen when you happen to be driving north — the fixed "N" label
       that used to sit up there was wrong at every other heading. North is
       −Z in this world, which is −y in map space before rotation. */
    const NR = W / 2 - 11;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(rot);
    ctx.translate(0, -NR);
    ctx.rotate(-rot);                              // keep the letter upright
    ctx.fillStyle = 'rgba(255,255,255,.82)';
    ctx.strokeStyle = 'rgba(0,0,0,.65)';
    ctx.lineWidth = 2.5;
    ctx.font = '700 10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText('N', 0, 0);
    ctx.fillText('N', 0, 0);
    ctx.restore();
  }

  /* ---------------- main update ---------------- */
  update(dt, phys, env, camMode, fps) {
    this.acc += dt;
    this.hintTimer -= dt;
    if (this.hintTimer < 0 && this.el.hint) this.el.hint.classList.add('hide');

    const flying = phys.flying;
    const kmh = Math.abs(phys.forwardSpeed) * 3.6;
    this.smoothSpeed = lerp(this.smoothSpeed, kmh, 1 - Math.exp(-9 * dt));

    if (this.acc > 0.06) {
      this.acc = 0;
      const shown = flying ? Math.round(phys.speed * 3.6) : Math.round(this.smoothSpeed);
      this.el.speed.textContent = shown;
      this.el.unit.textContent = 'km/h';
      this.el.alt.textContent = `ALT ${Math.round(Math.max(0, phys.pos.y))} m`;

      const frac = clamp(this.smoothSpeed / (flying ? 400 : 240), 0, 1);
      this.el.fill.style.strokeDasharray = `${frac * GAUGE_LEN} ${GAUGE_LEN}`;
      this.el.boost.style.width = (phys.boost * 100).toFixed(0) + '%';

      this.el.gauge.classList.toggle('fly', flying);
      this.el.mode.classList.toggle('fly', flying);
      this.el.mode.textContent = phys.boosting ? 'TURBO'
        : flying ? 'FLIGHT' : (phys.inWater ? 'SWIM' : phys.handbraking ? 'DRIFT' : 'DRIVE');
      this.el.mode.classList.toggle('turbo', !!phys.boosting);

      this.el.biome.textContent = flying && phys.pos.y > 300
        ? 'High Altitude' : biomeName(phys.pos.x, phys.pos.z);
      this.el.coords.textContent =
        `${phys.pos.z >= 0 ? 'S' : 'N'} ${Math.abs(phys.pos.z) | 0} · ${phys.pos.x >= 0 ? 'E' : 'W'} ${Math.abs(phys.pos.x) | 0} · ${camMode}`;

      const t = env.timeOfDay;
      const hh = String(Math.floor(t)).padStart(2, '0');
      const mm = String(Math.floor((t % 1) * 60)).padStart(2, '0');
      this.el.clock.textContent = `${hh}:${mm}`;
      this.el.fps.textContent = fps > 0 ? `${Math.round(fps)} fps` : '… fps';
    }

    this.frames++;
    if (this.frames % 3 === 0) this.drawMap(phys, flying ? phys.yaw : phys.yawAngle());
  }
}
