# Dune Runner — open-world off-road

A browser driving-and-flight game. A white boxy 4x4 roams an endless procedural
world of pine forest, desert dunes, beaches and open sea, linked by a network of
winding off-road trails. Press **F** to lift off and **SPACE** to climb.

Everything is generated at runtime — terrain, textures, trees, the truck, the
sky, the engine sound. There are no downloaded assets, so the whole thing is
about **1.3 MB** and works offline.

---

## Deploying to Cloudflare Pages

The build is plain static files. Nothing to compile.

**Option A — drag and drop (fastest)**

1. Go to Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
2. Drag the whole `fj-cruiser-offroad` folder in (or upload the `.zip`).
3. Deploy. Done.

**Option B — Git**

1. Push this folder to a GitHub/GitLab repo.
2. Cloudflare Pages → **Connect to Git** → pick the repo.
3. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `/` (or the folder name if the repo has it nested)

**Option C — Wrangler CLI**

```bash
npx wrangler pages deploy . --project-name dune-runner
```

`_headers` is included and sets long-lived caching for `/libs/*` plus a few
sensible security headers. Cloudflare picks it up automatically.

> The site must be served over **http/https**, not opened as a `file://` path —
> ES modules are blocked on `file://` by every browser. For a local preview:
> `npx serve .` or `python3 -m http.server`.

---

## Controls

| Action | Keyboard | Touch | Gamepad |
|---|---|---|---|
| Accelerate | `W` / `↑` | thumbstick ▲ | Right trigger |
| Brake / reverse | `S` / `↓` | thumbstick ▼ | Left trigger |
| Steer | `A` `D` / `←` `→` | thumbstick ◀ ▶ | Left stick |
| **Toggle flight** | **`F`** | **FLY** | X / □ |
| **Climb (in flight)** | **`SPACE`** | **CLIMB ▲** | A / ✕ |
| Descend (in flight) | `Ctrl` / `Z` | thumbstick ▼ | — |
| **Turbo boost** | **`Shift`**, or **double-tap `W`/`↑`** | **⚡ TURBO** | Right bumper |
| Handbrake (drift) | `SPACE` on the ground | **DRIFT** | B / ○ |
| Change camera | `C` | CAM | Y / △ |
| Recover / respawn | `R` | RESET | Start |
| Headlights | `L` | auto at night | — |
| **Mute / unmute** | **`M`** | speaker button | — |
| Time of day | `[` `]` | — | — |
| Look around | drag the screen | drag the screen | — |

Four camera modes: Chase, Close, Cinematic and Hood.

On touch devices the left thumb gets a **circular analogue thumbstick**. It is
fully proportional — a small push is a gentle turn, a diagonal is part steer and
part throttle at the same time, and pulling back brakes then reverses. The whole
lower-left of the screen is live: the stick jumps to wherever your thumb lands,
so you never have to look for it, and it springs back when you let go.

The right thumb gets the action cluster: **TURBO** and **FLY** on the bottom
row, **CLIMB** above them, and CAM / RESET / DRIFT as small pills along the top.
Everything is on a fixed grid, so nothing lands under the minimap or the gauge,
and it scales up on tablets and unfolded foldables.

### Settings

The gear icon in the top right opens a panel with **sound on/off**, a
**volume slider** and a **graphics tier** picker (Ultra / High / Medium / Low).
The speaker icon next to it is a one-click mute, and `M` does the same from the
keyboard. Choices are remembered in the browser, so the game comes back the way
you left it. Changing the graphics tier reloads the page, because terrain
resolution and texture size are baked at load time.

---

## The world

Unbounded — it is defined by noise functions of (x, z), so you can drive or fly
in any direction forever and terrain keeps generating around you.

- **Pine forest** — rolling ridges, pines, bushes, boulders, snow above ~200 m
- **Desert dunes** — warped linear dunes with slip faces, cacti, dry scrub, acacia
- **Beach** — every coastline gets a sand band, palms and driftwood
- **Open sea** — six-component Gerstner swell with real deep-water dispersion.
  Colour is Beer-Lambert absorption over the sea floor, so shallows go
  turquoise and the deep goes almost black, with caustics dancing on the
  bottom, sun glitter on the chop, and surf that shoals and breaks along the
  depth contour. Drive in and the truck floats, bobs on the actual swell and
  steers like a boat — the physics evaluates the same wave set as the shader,
  so what you ride is exactly what you see.
- **Off-road trails** — a graded track network carved into the terrain, cutting
  through dune crests and winding over the hills. Visible on the minimap.
- **Alpine villages** — settlements of Swiss-style log chalets: stacked log
  walls notched at the corners, deep-eaved gabled roofs, full-width balconies,
  shutters and stone chimneys, with barns, log piles, fencing, a well and
  street lamps that light up at dusk. The ground is levelled under each one.
  They show as house markers on the minimap, and you start next to one.

Vegetation is a mixed woodland: layered conifers with drooping branch tiers on
the higher ground, broadleaf birch lower down, acacia and dry scrub towards the
desert, palms and driftwood on the sand. Everything that grows sways in a
shared wind field, every instance is individually tinted, and foliage dries out
as the biome turns to desert.

A full day/night cycle runs underneath it all (about 60 real minutes per day),
with a physical sky model, moving sun, stars, moon, drifting clouds and
headlights that switch on at dusk.

---

## Performance

Quality is auto-detected from the GPU string, core count and screen, then a
runtime governor watches the frame time and adjusts render scale (and finally
post-processing) to hold a steady frame rate.

Force a tier with a query string (this also overrides the saved setting):

```
?q=ultra   ?q=high   ?q=med   ?q=low
```

You can also fix the world seed: `?seed=12345`.

| | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Draw distance | 1.8 km | 2.3 km | 2.8 km | 3.3 km |
| Terrain resolution | 7.1 m | 4.6 m | 3.2 m | 2.7 m |
| Ground textures | 320² | 512² | 768² | 1024² |
| Shadow map | 1024² | 2048² | 3072² | 4096² |
| Grass tufts | 900 | 3 400 | 7 000 | 11 000 |
| Clouds / bloom | off | on | on | on |
| SMAA + sharpening | — | sharpen | full | full |

Terrain, vegetation and the water height field are all generated against a
per-frame time budget, so streaming never blocks the frame.

---

## Project layout

```
index.html          shell, HUD markup, touch controls
css/style.css       HUD, gauges, minimap, thumbstick, responsive layout
manifest.webmanifest, sw.js, icons/   PWA: installable + offline on Android
_headers            Cloudflare Pages caching + security headers
libs/three/         three.js r169 + the four addons used (vendored, offline)
src/
  main.js           boot, asset generation, game loop
  quality.js        device tiering + runtime frame-rate governor
  noise.js          seeded simplex noise, fbm, ridged fractals
  world.js          the terrain function — single source of truth
  terrain.js        chunk streaming, LOD, splat material, height field
  textures.js       procedural ground/bark textures + normal maps
  props.js          trees, palms, cacti, bushes, rocks, driftwood
  grass.js          wind-blown grass field that follows the camera
  ocean.js          Gerstner sea shader + the shared CPU wave model
  environment.js    sky, sun, moon, stars, clouds, fog, shadows
  settings.js       sound + graphics panel, saved to localStorage
  vehicle.js        the 4x4 model — body, glass, lamps, wheels, rack
  physics.js        suspension, tyre model, buoyancy, flight
  camera.js         chase camera
  input.js          keyboard / touch / gamepad
  hud.js            gauge, chips, minimap
  fx.js             dust, spray, thruster particles
  post.js           bloom, tone mapping, SMAA, sharpen/vignette/grain
  audio.js          synthesised engine, tyres, wind, thrusters
```

## Install it on Android

Two options, both covered in detail in `../dune-runner-android/README.md`:

1. **From the website, no store.** The build is a PWA — open it in Chrome on
   Android and choose **⋮ → Add to Home screen**. It installs with its own
   icon, launches fullscreen, and the service worker keeps the whole game
   cached so it runs with no signal.
2. **As a real APK.** The `dune-runner-android` folder is a complete Android
   Studio project with the game bundled in `assets/`. Open it, press Run.
   ~1.6 MB, no permissions, Android 7.0+, and it handles folding, unfolding,
   split-screen and tablets without restarting or losing the WebGL context.

---

## Notes

- Requires WebGL 2 — every current version of Chrome, Edge, Firefox and Safari
  (including iOS Safari 15+) supports it. A clear message is shown if it is
  unavailable.
- The vehicle is an original model built from scratch in code: a generic boxy
  retro 4x4 silhouette with no manufacturer badges, logos or trademarked
  detailing.
- three.js is included under the MIT licence (`libs/three/`).
