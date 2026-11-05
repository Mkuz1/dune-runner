import { test, expect, boot, state, hold } from './helpers';

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

test.describe('F02 drive', () => {
  test.beforeEach(async ({ page }) => { await boot(page, '/?seed=1337'); });

  test('F02-H1 holding ↑ accelerates and moves the truck', async ({ page }) => {
    const a = await state(page);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(3000);
    const b = await state(page);
    const hud = Number(await page.locator('#speedVal').textContent());
    await page.keyboard.up('ArrowUp');
    expect(b.speedKmh).toBeGreaterThan(20);
    expect(dist(a, b)).toBeGreaterThan(10);
    expect(Math.abs(hud - b.speedKmh)).toBeLessThan(15);     // HUD shows the real speed
  });

  test('F02-E1 turbo is faster than plain throttle', async ({ page }) => {
    await hold(page, 'ArrowUp', 2500);
    const plain = (await state(page)).speedKmh;
    await page.keyboard.press('KeyR');                       // back to a standstill
    await page.waitForTimeout(800);
    await page.keyboard.down('ShiftLeft');
    await hold(page, 'ArrowUp', 2500);
    await page.keyboard.up('ShiftLeft');
    const turbo = (await state(page)).speedKmh;
    expect(turbo).toBeGreaterThan(plain * 1.1);
  });

  test('F02-E2 handbrake slows the truck', async ({ page }) => {
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(3000);
    await page.keyboard.up('ArrowUp');
    const before = (await state(page)).speedKmh;
    await hold(page, 'Space', 1500);
    const after = (await state(page)).speedKmh;
    expect(after).toBeLessThan(before * 0.75);
  });

  test('F02-E3 steering changes the heading', async ({ page }) => {
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(1500);
    const a = (await state(page)).yaw;
    await hold(page, 'ArrowLeft', 1500);
    await page.keyboard.up('ArrowUp');
    const b = (await state(page)).yaw;
    const d = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
    expect(d).toBeGreaterThan(0.2);
  });

  test('F02-E4 W works like ↑', async ({ page }) => {
    await hold(page, 'KeyW', 2500);
    expect((await state(page)).speedKmh).toBeGreaterThan(15);
  });
});

test.describe('F03 flight', () => {
  test.beforeEach(async ({ page }) => { await boot(page, '/?seed=1337'); });

  test('F03-H1 F takes off and Space climbs', async ({ page }) => {
    await page.keyboard.press('KeyF');
    await expect(page.locator('#modeChip')).toHaveText(/FLIGHT/);
    const a = await state(page);
    await hold(page, 'Space', 3000);
    const b = await state(page);
    expect(b.flying).toBe(true);
    expect(b.y - a.y).toBeGreaterThan(5);
    await expect(page.locator('#altRead')).toHaveText(/ALT \d+ m/);
  });

  test('F03-E1 F again lands back in drive mode', async ({ page }) => {
    await page.keyboard.press('KeyF');
    await hold(page, 'Space', 2000);
    await page.keyboard.press('KeyF');
    await expect(page.locator('#modeChip')).toHaveText(/DRIVE|TURBO/);
    await expect.poll(async () => { const s = await state(page); return s.y - s.groundY; },
      { timeout: 15_000 }).toBeLessThan(3);
  });
});

test.describe('F04 camera', () => {
  test('F04-H1 C cycles every camera mode and wraps', async ({ page }) => {
    await boot(page);
    const first = (await state(page)).cam;
    const seen = new Set([first]);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('KeyC');
      await page.waitForTimeout(150);
      const c = (await state(page)).cam;
      if (c === first) break;
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect((await state(page)).cam).toBe(first);      // wrapped back round
  });
});

test.describe('F05 recover', () => {
  test.beforeEach(async ({ page }) => { await boot(page, '/?seed=1337'); });

  test('F05-H1 R puts the truck back on the ground, stopped', async ({ page }) => {
    await hold(page, 'ArrowUp', 2500);
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(600);
    const s = await state(page);
    expect(s.speedKmh).toBeLessThan(8);
    expect(Math.abs(s.y - s.groundY)).toBeLessThan(3);
  });

  test('F05-E1 R while flying lands the truck', async ({ page }) => {
    await page.keyboard.press('KeyF');
    await hold(page, 'Space', 2500);
    expect((await state(page)).flying).toBe(true);
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(600);
    const s = await state(page);
    expect(s.flying).toBe(false);
    expect(Math.abs(s.y - s.groundY)).toBeLessThan(3);
    await expect(page.locator('#modeChip')).toHaveText(/DRIVE/);
  });
});
