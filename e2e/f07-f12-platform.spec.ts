import { test, expect, load, boot, state } from './helpers';
import { chromium } from '@playwright/test';

test.describe('F07 touch controls @mobile', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone project only');

  test('F07-H1 touch controls are shown and labelled @mobile', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#touch')).toBeVisible();
    for (const name of ['CAM', 'RESET', 'DRIFT', 'Turbo', 'Climb', 'Toggle flight']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }
  });

  test('F07-E1 tapping Toggle flight takes off @mobile', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'Toggle flight' }).tap();
    await expect.poll(async () => (await state(page)).flying).toBe(true);
  });

  test('F07-E2 HUD fits a phone screen @mobile', async ({ page }) => {
    await boot(page);
    const vp = page.viewportSize()!;
    const outside = await page.evaluate(({ w, h }) => {
      const bad: string[] = [];
      document.querySelectorAll('#hud *, #touch *').forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') return;
        if (r.left < -1 || r.top < -1 || r.right > w + 1 || r.bottom > h + 1) bad.push(`${el.id || el.className || el.tagName}`);
      });
      return bad;
    }, { w: vp.width, h: vp.height });
    expect(outside).toEqual([]);
  });
});

test.describe('F08 HUD', () => {
  test('F08-H1 every HUD readout is populated', async ({ page }) => {
    await boot(page, '/?seed=1337');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(2000);
    await expect(page.locator('#biomeName')).not.toHaveText('');
    await expect(page.locator('#coords')).toHaveText(/[NS] \d+ · [EW] \d+/);
    await expect(page.locator('#clock')).toHaveText(/^\d{2}:\d{2}$/);
    await expect(page.locator('#fps')).toHaveText(/^\d+ fps$/);
    await expect(page.locator('#speedVal')).not.toHaveText('0');
    await expect(page.locator('#altRead')).toHaveText(/ALT \d+ m/);
    await page.keyboard.up('ArrowUp');
    const inked = await page.locator('#minimap').evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n / (c.width * c.height);
    });
    expect(inked).toBeGreaterThan(0.3);
  });
});

test.describe('F09 resize', () => {
  test('F09-H1 resizing keeps the canvas full-size and the camera undistorted', async ({ page }) => {
    await boot(page);
    await page.setViewportSize({ width: 800, height: 1000 });
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const g = (window as any).game;
      const c = g.renderer.domElement as HTMLCanvasElement;
      const b = c.getBoundingClientRect();
      return { cw: b.width, ch: b.height, aspect: g.camera.aspect, w: innerWidth, h: innerHeight };
    });
    expect(Math.abs(r.cw - r.w)).toBeLessThan(2);
    expect(Math.abs(r.ch - r.h)).toBeLessThan(2);
    expect(Math.abs(r.aspect - r.w / r.h)).toBeLessThan(0.01);
  });
});

test.describe('F10 offline', () => {
  test('F10-H1 plays offline after the first visit', async ({ page, context }) => {
    await boot(page);
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!(reg && reg.active);
    }, null, { timeout: 30_000 });
    await context.setOffline(true);
    await page.reload();
    await boot(page);
    expect(await page.evaluate(() => (window as any).game.running)).toBe(true);
    await context.setOffline(false);
  });

  test('F10-E1 only the current cache version is kept', async ({ page, request }) => {
    await boot(page);
    const sw = await (await request.get('/sw.js')).text();
    const current = sw.match(/const CACHE = '([^']+)'/)![1];
    await page.waitForFunction(async (name) => (await caches.keys()).includes(name), current, { timeout: 30_000 });
    const keys = await page.evaluate(() => caches.keys());
    expect(keys).toEqual([current]);
  });
});

test.describe('F11 no WebGL', () => {
  test('F11-N1 shows a friendly error when WebGL is unavailable', async ({ guard }) => {
    guard.allow(/./);
    const browser = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:4173/');
    await expect(page.locator('#fatal')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#fatal')).toContainText(/WebGL|3D/i);
    await browser.close();
  });
});

test.describe('F12 URL options', () => {
  test('F12-H1 ?q=low and a fixed ?seed give a Low tier and a repeatable spawn', async ({ page }) => {
    await boot(page, '/?q=low&seed=1337');
    const a = await state(page);
    expect(a.tier).toBe('low');
    await page.reload();
    await boot(page, '/?q=low&seed=1337');
    const b = await state(page);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1);
  });

  test('F12-N1 junk parameters fall back safely', async ({ page }) => {
    await boot(page, '/?q=bogus&seed=abc');
    expect(['ultra', 'high', 'med', 'low']).toContain((await state(page)).tier);
  });
});

test.describe('F13 update feed', () => {
  test('F13-H1 version.json is valid and its downloads exist', async ({ request }) => {
    const base = 'https://raw.githubusercontent.com/Mkuz1/dune-runner-release/main/';
    const v = await (await request.get(base + 'version.json')).json();
    expect(Number.isInteger(v.versionCode)).toBe(true);
    expect(v.versionName).toMatch(/^\d+\.\d+\.\d+$/);
    for (const [url, size] of [[v.apk, v.apkSize], [v.ipa, v.ipaSize]]) {
      const r = await request.head(url);
      expect(r.status(), url).toBe(200);
      expect(Number(r.headers()['content-length'])).toBe(size);
    }
  });
});
