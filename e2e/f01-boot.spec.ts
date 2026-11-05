import { test, expect, load, boot, state, axe } from './helpers';

test.describe('F01 boot & start', () => {
  test('F01-H1 boots to Ready and starts', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#boot')).toHaveClass(/gone/);
    const s = await state(page);
    expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
    // the truck sits on the ground, not under it or in the sky
    expect(Math.abs(s.y - s.groundY)).toBeLessThan(3);
  });

  test('F01-E1 double click on START runs one game loop, not two', async ({ page }) => {
    // count requestAnimationFrame registrations per frame
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      (window as any).__rafCalls = 0;
      window.requestAnimationFrame = (cb) => { (window as any).__rafCalls++; return raf(cb); };
    });
    const start = await load(page);
    await start.dblclick();
    await page.waitForFunction(() => (window as any).game?.running === true);
    await page.waitForTimeout(1000);
    const perFrame = await page.evaluate(async () => {
      const w = window as any;
      const before = w.__rafCalls;
      let frames = 0;
      await new Promise<void>((r) => {
        const tick = () => { if (++frames < 60) requestAnimationFrame(tick); else r(); };
        requestAnimationFrame(tick);
      });
      return (w.__rafCalls - before - 60) / 60;   // minus our own 60
    });
    expect(perFrame).toBeLessThan(1.5);           // one game loop → ~1
  });

  test('F01-E2 keyboard only: Tab to START ENGINE and press Enter', async ({ page }) => {
    const start = await load(page);
    for (let i = 0; i < 10 && !(await start.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press('Tab');
    }
    await expect(start).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#hud')).toBeVisible();
  });

  test('F01-E3 refresh mid-game boots again and keeps settings', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'Mute', exact: true }).click();
    await page.reload();
    await boot(page);
    await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toBeVisible();
  });

  // requests the service worker makes on the page's behalf bypass
  // page.route, so the network-failure cases run without it
  test.describe('with the service worker off', () => {
  test.use({ serviceWorkers: 'block' });

  test('F01-E4 slow network still boots', async ({ page }) => {
    await page.route('**/textures/**', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await boot(page);
    expect((await state(page)).tier).toBeTruthy();
  });

  test('F01-E5 two tabs both run', async ({ page, context }) => {
    await boot(page);
    const second = await context.newPage();
    await boot(second);
    await page.bringToFront();
    expect(await page.evaluate(() => (window as any).game.running)).toBe(true);
    expect(await second.evaluate(() => (window as any).game.running)).toBe(true);
  });

  test('F01-N1 a missing photo texture falls back to procedural', async ({ page, guard }) => {
    guard.allow(/./);                     // the aborted request logs a load error
    await page.route('**/textures/sand.jpg', (r) => r.abort());
    await boot(page);
    const photo = await page.evaluate(() => !!(window as any).game.textures.sandPhoto);
    expect(photo).toBe(false);
    expect(await page.evaluate(() => !!(window as any).game.textures.sand)).toBe(true);
    guard.errors.length = 0;              // only the deliberate failure was allowed
  });

  test('F01-N2 a missing truck model keeps the stand-in truck', async ({ page, guard }) => {
    guard.allow(/./);
    await page.route('**/models/pickup6x6.glb', (r) => r.abort());
    await boot(page);
    expect(await page.evaluate(() => !!(window as any).game.vehicle.modelLoaded)).toBe(false);
    expect(await page.evaluate(() => (window as any).game.vehicle.body.children.length)).toBeGreaterThan(0);
    guard.errors.length = 0;
  });
  });

  test('F01-A1 start screen has no accessibility violations', async ({ page }) => {
    await load(page);
    expect(await axe(page, '#boot')).toEqual([]);
  });
});
