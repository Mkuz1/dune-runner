// Playwright config for the Dune Runner web build.
// The game is static files, so the "dev server" is a plain static server on
// the same folder the Android and iOS apps bundle.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,                 // WebGL boot + terrain streaming is slow headless
  expect: { timeout: 20_000 },
  fullyParallel: false,            // one GPU-heavy page at a time keeps timings honest
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // use the Mac's real GPU through ANGLE/Metal rather than software GL
      args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
    }
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /@mobile/ }
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory app/src/main/assets/game`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: true,
    timeout: 20_000,
    stdout: 'ignore',
    stderr: 'ignore'
  }
});
