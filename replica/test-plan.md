# Test plan: Dune Runner

Build: `17a3423` (1.2.8)  Date: 2026-11-05  Env: local static server on the web
build (`app/src/main/assets/game`, the same files the Android and iOS apps
bundle), Playwright 1.64 + Chromium on Apple M5 (real GPU via ANGLE/Metal).

Dune Runner is an original game, not a clone, so there is no `recon.md`: the
flows below were mapped from the game's own UI and code (`index.html`,
`src/input.js`, `src/settings.js`, `src/main.js`, the two native `Updater`s).

Edge cases from the standard list that do not apply to a single-player,
account-less, offline-first game: empty / very long / emoji input (there is no
text input), second user's data, expired session, time zones and DST (the
in-game clock is simulated), card declined (no payments). Two tabs at once is
covered by F01-E5.

Result: **37 automated cases, 37 pass** (34 desktop + 3 phone) after fixing
BUG-001; 4 manual cases need a real phone. Run: `npx playwright test`.

Every automated spec also fails on: any console error, any 4xx/5xx response
for the game's own files, and (where marked) axe accessibility violations.

| case | flow | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- | --- |
| F01-H1 | boot & start | happy | open `/`, wait for the loader, click START ENGINE | loader reaches "Ready", HUD appears, game loop running, no errors, no failed requests | e2e | pass |
| F01-E1 | | edge: double click START | double-click START ENGINE | exactly one game loop (one rAF callback per frame), not two | e2e | pass |
| F01-E2 | | edge: keyboard only | Tab to START ENGINE, press Enter | game starts | e2e | pass |
| F01-E3 | | edge: refresh mid-game | start, reload | boots again to Ready, saved settings kept | e2e | pass |
| F01-E4 | | edge: slow network | delay every texture by 1.5 s | still boots, loader keeps progressing | e2e | pass |
| F01-E5 | | edge: two tabs | open the game in two tabs | both boot and run | e2e | pass |
| F01-N1 | | negative: a photo texture fails | abort `/textures/sand.jpg` | falls back to procedural sand, game runs | e2e | pass |
| F01-N2 | | negative: truck model fails | abort `/models/pickup6x6.glb` | keeps the procedural truck, game runs | e2e | pass |
| F01-A1 | | a11y | axe on the start screen | no violations | e2e | pass |
| F02-H1 | drive | happy | hold ↑ for 3 s | speed > 20 km/h, truck moved > 10 m, HUD speed matches | e2e | pass |
| F02-E1 | | edge: turbo | hold ↑ + Shift vs ↑ alone | faster with turbo | e2e | pass |
| F02-E2 | | edge: handbrake | drive, then hold Space | speed drops | e2e | pass |
| F02-E3 | | edge: steering | drive, hold ← | heading changes | e2e | pass |
| F02-E4 | | edge: WASD | hold W | same as ↑ | e2e | pass |
| F03-H1 | flight | happy | press F, hold Space | HUD mode FLIGHT, altitude rises | e2e | pass |
| F03-E1 | | edge: toggle back | in flight press F again | mode DRIVE, truck comes down to the ground | e2e | pass |
| F04-H1 | camera | happy | press C repeatedly | camera mode cycles through all modes and wraps | e2e | pass |
| F05-H1 | recover | happy | drive, press R | truck back on the ground, stopped | e2e | pass |
| F05-E1 | | edge: recover in the air | fly up, press R | back on the ground, not flying | e2e | pass |
| F06-H1 | settings | happy | click Settings | panel opens with Ultra/High/Medium/Low and sound controls | e2e | pass (failed before BUG-001 fix) |
| F06-H2 | | happy: change graphics | pick Low | page reloads on Low, choice remembered after reload | e2e | pass |
| F06-H3 | | happy: mute | click Mute | button becomes "Unmute", remembered after reload | e2e | pass |
| F06-E1 | | edge: M key | press M twice | muted, then unmuted | e2e | pass |
| F06-E2 | | edge: volume while muted | mute, drag volume up | unmutes | e2e | pass (failed before BUG-001 fix) |
| F06-E3 | | edge: click outside | open panel, click the scene | panel closes | e2e | pass |
| F06-A1 | | a11y | axe on HUD with the panel open | no violations | e2e | pass (failed before BUG-001 fix) |
| F07-H1 | touch controls | happy (@mobile) | open on a phone-size touch device, start | stick and buttons shown, each has a name | e2e | pass |
| F07-E1 | | edge: tap Toggle flight | tap the fly button | flying | e2e | pass |
| F07-E2 | | edge: mobile width layout | phone viewport | HUD fits, nothing overflows the screen | e2e | pass |
| F08-H1 | HUD | happy | start, drive | biome, coordinates, clock HH:MM, fps, speed, altitude and minimap all populated | e2e | pass |
| F09-H1 | resize / rotate | happy | start, resize 1280×720 → 800×1000 | canvas fills the new size, camera aspect matches | e2e | pass |
| F10-H1 | offline | happy | load, let the service worker cache, go offline, reload | game boots and runs offline | e2e | pass |
| F10-E1 | | edge: new version | load, check the cache name | cache name equals the one in `sw.js` (old caches removed) | e2e | pass |
| F11-N1 | no WebGL | negative | launch Chromium with WebGL disabled | friendly "WebGL" error screen, no crash loop | e2e | pass |
| F12-H1 | URL options | happy | `?q=low`, `?seed=1337` | Low tier; same seed spawns at the same place twice | e2e | pass |
| F12-N1 | | negative: junk params | `?q=bogus&seed=abc` | falls back to auto tier, boots | e2e | pass |
| F13-H1 | in-app update feed | happy | fetch `version.json` from dune-runner-releases | valid JSON, APK and IPA URLs reachable, sizes match | e2e | pass |
| F13-M1 | | manual: Android update | install 1.2.7, open, accept update | download progress, system installer, app reopens on 1.2.8 | manual | not run: needs a real device |
| F13-M2 | | manual: iOS update | install 1.2.7 IPA, open | "Update available" with AltStore/SideStore or Download .ipa → share sheet | manual | not run: needs a real device |
| F13-M3 | | manual: offline launch | airplane mode, open the app | no update prompt, no error, game runs | manual | not run: needs a real device |
| F14-M1 | device performance | manual | play forest, desert, village, coast on a mid-range phone (Medium) | steady frame rate, no stutter when trees stream in | manual | not run: needs a real device |
