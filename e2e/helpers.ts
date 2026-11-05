// Shared fixtures for the Dune Runner e2e suite.
//
// Every test automatically fails on a console error or on any 4xx/5xx for
// the game's own files (a missing texture or module is exactly the kind of
// bug that only shows up in a real browser). Selectors use roles and labels.
import { test as base, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type Guard = { errors: string[]; allow: (re: RegExp) => void };

export const test = base.extend<{ guard: Guard }>({
  guard: [async ({ page, baseURL }, use) => {
    const errors: string[] = [];
    const allowed: RegExp[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !allowed.some((re) => re.test(m.text()))) errors.push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 400 && baseURL && r.url().startsWith(baseURL)) errors.push(`${r.status()} ${r.url()}`);
    });
    await use({ errors, allow: (re) => allowed.push(re) });
    expect(errors, 'console errors / failed requests').toEqual([]);
  }, { auto: true }]
});
export { expect };

/** Open the game and wait for the START ENGINE button. */
export async function load(page: Page, path = '/') {
  await page.goto(path);
  const start = page.getByRole('button', { name: 'START ENGINE' });
  await expect(start).toBeVisible({ timeout: 60_000 });
  return start;
}

/** Open, press START ENGINE, wait until the HUD is up and the loop runs. */
export async function boot(page: Page, path = '/') {
  const start = await load(page, path);
  await start.click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.waitForFunction(() => (window as any).game?.running === true);
  // let the first frames run and the terrain under the truck stream in
  await page.waitForTimeout(1500);
}

/** Snapshot of the simulation the tests assert on. */
export async function state(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).game;
    const p = g.phys;
    return {
      x: p.pos.x, y: p.pos.y, z: p.pos.z,
      speedKmh: p.speed * 3.6,
      forward: p.forwardSpeed,
      yaw: p.yawAngle ? p.yawAngle() : p.yaw,
      flying: p.flying,
      groundY: p.groundY,
      cam: g.chase.modeName,
      tier: g.q.tier
    };
  });
}

/** Hold a key for `ms` milliseconds. */
export async function hold(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/** axe scan; returns violations as short strings for readable failures. */
export async function axe(page: Page, include?: string) {
  let b = new AxeBuilder({ page });
  if (include) b = b.include(include);
  const r = await b.analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}
