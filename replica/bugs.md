# Bugs: Dune Runner

Build tested: `17a3423` (1.2.8). Suite: `npx playwright test` (see `replica/test-plan.md`).

### BUG-001: Volume slider has no accessible name

- Severity: S3
- Flow / case: F06 / F06-A1 (also F06-H1, F06-E2)
- Screen: in-game settings panel
- Build: 17a3423  Browser / device: Chromium 1.64 (Playwright), 1280px

Steps
1. Open the game, press START ENGINE.
2. Click the Settings (gear) button.
3. Run an axe scan on `#hud`, or move a screen reader onto the volume slider.

Expected: the slider is announced as "Volume".
Actual: an unnamed slider; axe reports `label (critical): #volRange`. The
visible word "Volume" was a `<span>` that was not tied to the input.
Evidence: failing tests F06-A1, F06-H1 (`getByRole('slider', { name: 'Volume' })` not found), F06-E2.
Suspected cause: `<span class="panel-lbl">Volume</span>` instead of a `<label for>`.
Status: fixed in 094b7d1 (`<label class="panel-lbl" for="volRange">`); F06-A1/H1/E2 pass.

## To check (not reproduced)

- **Loading stalls while the tab is in the background.** Boot waits on
  `requestAnimationFrame`, which browsers pause in hidden tabs, so a game
  opened in a background tab sits on the loading screen until it is shown.
  Expected to resume as soon as the tab is visible; not confirmed on mobile
  Safari.
- **Frame rate on mid-range phones** with the photo-card trees and the extra
  road/beach texture reads (F14-M1, manual).
- **Native in-app update flows** on a real Android phone and iPhone
  (F13-M1…M3, manual).

## Not bugs (test issues found and fixed while writing the suite)

- `getByRole('button', { name: 'Mute' })` also matched the "Muted" button:
  now `exact: true`.
- `page.route` cannot block requests the service worker makes on the page's
  behalf, so the network-failure cases (F01-E4/E5/N1/N2) run with
  `serviceWorkers: 'block'`.
