// F14 motion quality: guards the smoothness work so a later change cannot
// quietly bring the camera judder or the on/off controls back.
import { test, expect, boot, state } from './helpers';
import { recordDrive } from './motion-metrics';

test.describe('F14 motion quality', () => {
  for (const [name, seed] of [['desert', 1337], ['forest', 4242]] as const) {
    test(`F14-H1 camera tracks smoothly while driving (${name})`, async ({ page }) => {
      await boot(page, `/?seed=${seed}`);
      await page.waitForTimeout(800);
      const m = await recordDrive(page, 6);
      console.log(`F14 ${name} ${JSON.stringify(m)}`);
      // before the smoothing pass these were ~33 mm and ~2.0 mrad
      expect(m.camJitter).toBeLessThan(8);
      expect(m.aimJitter).toBeLessThan(0.5);
      expect(m.pitchJolt).toBeLessThan(0.1);
      expect(m.avgKmh).toBeGreaterThan(30);           // and it still drives
    });
  }

  test('F14-E1 throttle ramps in instead of snapping to full', async ({ page }) => {
    await boot(page, '/?seed=1337');
    await page.keyboard.down('ArrowUp');
    const early = await page.evaluate(async () => {
      const g = (window as any).game;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return g.input.state.throttle;
    });
    await page.waitForTimeout(700);
    const later = await page.evaluate(() => (window as any).game.input.state.throttle);
    await page.keyboard.up('ArrowUp');
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.6);
    expect(later).toBeGreaterThan(0.95);
  });

  test('F14-E2 flight turns build up smoothly', async ({ page }) => {
    await boot(page, '/?seed=1337');
    await page.keyboard.press('KeyF');
    await page.keyboard.down('Space');
    await page.waitForTimeout(1500);
    await page.keyboard.up('Space');
    await page.keyboard.down('ArrowLeft');
    const rates: number[] = await page.evaluate(async () => {
      const p = (window as any).game.phys;
      const out: number[] = [];
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        out.push(Math.abs(p.yawRate));
      }
      return out;
    });
    await page.keyboard.up('ArrowLeft');
    const steps = rates.slice(1).map((v, i) => v - rates[i]);
    expect(Math.max(...rates)).toBeGreaterThan(0.6);     // it does turn
    expect(Math.max(...steps)).toBeLessThan(0.15);       // with no sudden jump
    expect((await state(page)).flying).toBe(true);
  });
});
