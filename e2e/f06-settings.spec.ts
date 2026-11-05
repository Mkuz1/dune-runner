import { test, expect, boot, state, axe } from './helpers';

test.describe('F06 settings', () => {
  test.beforeEach(async ({ page }) => { await boot(page); });

  test('F06-H1 settings panel opens with graphics and sound controls', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    const panel = page.locator('#gfxPanel');
    await expect(panel).toBeVisible();
    for (const name of ['Ultra', 'High', 'Medium', 'Low', 'On', 'Muted']) {
      await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
    }
    // BUG-001: the volume slider must be announced by name
    await expect(panel.getByRole('slider', { name: 'Volume' })).toBeVisible();
  });

  test('F06-H2 choosing Low reloads on Low and remembers it', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await Promise.all([
      page.waitForEvent('load'),
      page.locator('#gfxPanel').getByRole('button', { name: 'Low', exact: true }).click()
    ]);
    await boot(page);
    expect((await state(page)).tier).toBe('low');
    await page.reload();
    await boot(page);
    expect((await state(page)).tier).toBe('low');
  });

  test('F06-H3 mute button toggles and is remembered', async ({ page }) => {
    await page.getByRole('button', { name: 'Mute', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('duneRunner.settings') || '{}').muted)).toBe(true);
    await page.getByRole('button', { name: 'Unmute', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  });

  test('F06-E1 M key mutes and unmutes', async ({ page }) => {
    await page.keyboard.press('KeyM');
    await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toBeVisible();
    await page.keyboard.press('KeyM');
    await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  });

  test('F06-E2 raising the volume while muted unmutes', async ({ page }) => {
    await page.getByRole('button', { name: 'Mute', exact: true }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    const slider = page.locator('#gfxPanel').getByRole('slider', { name: 'Volume' });
    await slider.fill('80');
    await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  });

  test('F06-E3 clicking outside closes the panel', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.locator('#gfxPanel')).toBeVisible();
    await page.mouse.click(640, 400);
    await expect(page.locator('#gfxPanel')).toBeHidden();
  });

  test('F06-A1 HUD and settings panel have no accessibility violations', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    expect(await axe(page, '#hud')).toEqual([]);
  });
});
