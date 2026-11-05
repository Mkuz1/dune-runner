// Motion-quality metrics, recorded in the real game during a scripted drive.
// Used by f14-motion.spec.ts; also handy on its own when tuning the feel.
//
//   camJitter   high-frequency camera motion: mean |second difference| of the
//               camera position per frame, in mm. Smooth tracking ≈ small;
//               random shake or bumps passed straight through ≈ large.
//   aimJitter   the same for where the camera points, in milli-radians.
//   bumpRms     RMS vertical acceleration of the truck (m/s²): how bumpy the
//               ride is. Taken from the physics velocity and the browser's own
//               frame timestamps, so frame-timing noise does not inflate it.
//   wobbleRms   RMS pitch + roll rate of the body (rad/s): how much it rocks.
//   pitchJolt   largest pitch rate of the body in the first second of
//               full throttle (rad/s): how hard it rocks back on take-off.
import { Page } from '@playwright/test';

export type Metrics = { camJitter: number; aimJitter: number; bumpRms: number; wobbleRms: number; pitchJolt: number; frames: number; avgKmh: number };

export async function recordDrive(page: Page, seconds = 6): Promise<Metrics> {
  await page.evaluate(() => {
    const w = window as any;
    const g = w.game;
    const rec: any[] = [];
    w.__rec = rec;
    w.__recOn = true;
    const tick = (ts: number) => {
      if (!w.__recOn) return;
      const c = g.camera, p = g.phys;
      const dir = c.getWorldDirection(c.position.clone());
      rec.push({
        t: ts, vy: p.vel.y,
        cx: c.position.x, cy: c.position.y, cz: c.position.z,
        dx: dir.x, dy: dir.y, dz: dir.z,
        px: p.pos.x, py: p.pos.y, pz: p.pos.z,
        av: p.angVel.clone(), q: p.quat.clone(), spd: p.speed
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // a scripted drive: full throttle, then weave left and right
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1500);
  for (let i = 0; i < Math.floor((seconds - 1.5) / 1.5); i++) {
    const k = i % 2 ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(k);
    await page.waitForTimeout(700);
    await page.keyboard.up(k);
    await page.waitForTimeout(800);
  }
  await page.keyboard.up('ArrowUp');

  return page.evaluate(() => {
    const w = window as any;
    w.__recOn = false;
    const r = w.__rec as any[];
    const n = r.length;
    let cam = 0, aim = 0, bump = 0, nb = 0, wob = 0, pitchJolt = 0, kmh = 0;
    for (let i = 2; i < n; i++) {
      const a = r[i], b = r[i - 1], c = r[i - 2];
      cam += Math.hypot(a.cx - 2 * b.cx + c.cx, a.cy - 2 * b.cy + c.cy, a.cz - 2 * b.cz + c.cz);
      aim += Math.hypot(a.dx - 2 * b.dx + c.dx, a.dy - 2 * b.dy + c.dy, a.dz - 2 * b.dz + c.dz);
      kmh += a.spd * 3.6;
    }
    for (let i = 1; i < n; i++) {
      const dt = (r[i].t - r[i - 1].t) / 1000;
      if (dt <= 0.002 || dt > 0.05) continue;
      const ay = (r[i].vy - r[i - 1].vy) / dt;
      bump += ay * ay; nb++;
      // body pitch + roll rate: angular velocity minus its component about body up
      const q = r[i].q, v = r[i].av;
      const ux = 2 * (q.x * q.y - q.w * q.z), uy = 1 - 2 * (q.x * q.x + q.z * q.z), uz = 2 * (q.y * q.z + q.w * q.x);
      const wy = v.x * ux + v.y * uy + v.z * uz;
      const px = v.x - wy * ux, py = v.y - wy * uy, pz = v.z - wy * uz;
      wob += px * px + py * py + pz * pz;
    }
    const t0 = r[0].t;
    for (const f of r) {
      if (f.t - t0 > 1000) break;
      // pitch rate = angular velocity about the body's right axis
      const q = f.q, v = f.av;
      const rx = 1 - 2 * (q.y * q.y + q.z * q.z), ry = 2 * (q.x * q.y + q.w * q.z), rz = 2 * (q.x * q.z - q.w * q.y);
      pitchJolt = Math.max(pitchJolt, Math.abs(v.x * rx + v.y * ry + v.z * rz));
    }
    const m = Math.max(1, n - 2);
    return {
      camJitter: +(cam / m * 1000).toFixed(2),
      aimJitter: +(aim / m * 1000).toFixed(3),
      bumpRms: +Math.sqrt(bump / Math.max(1, nb)).toFixed(2),
      wobbleRms: +Math.sqrt(wob / Math.max(1, nb)).toFixed(3),
      pitchJolt: +pitchJolt.toFixed(3),
      frames: n,
      avgKmh: +(kmh / m).toFixed(1)
    };
  });
}
