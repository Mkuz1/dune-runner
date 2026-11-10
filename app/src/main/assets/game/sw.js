/* Dune Runner service worker — precache the whole game so it runs offline.

   Strategy note. This used to be cache-first for everything: it served the
   cached copy immediately and refreshed in the background, so a redeploy
   only took effect on the *second* launch. That is fine for images and
   three.js, and actively harmful for the game code — you could fix a bug,
   redeploy, reload, and still be running the old build with no sign that
   anything had changed.

   So it is now split:
     • HTML, CSS and everything under /src  → network-first. Always the
       current build when there is a connection; cache is the offline
       fallback.
     • /libs, icons, manifest              → cache-first. These only change
       when CACHE is bumped, and they are the bulk of the bytes.

   Bump CACHE on every deploy. */
const CACHE = 'dune-runner-v18';
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./src/audio.js",
  "./src/camera.js",
  "./src/environment.js",
  "./src/fx.js",
  "./src/grass.js",
  "./src/hud.js",
  "./src/input.js",
  "./src/main.js",
  "./src/noise.js",
  "./src/ocean.js",
  "./src/physics.js",
  "./src/post.js",
  "./src/props.js",
  "./src/quality.js",
  "./src/settings.js",
  "./src/terrain.js",
  "./src/textures.js",
  "./src/vehicle.js",
  "./src/village.js",
  "./src/diag.js",
  "./src/world.js",
  "./src/updates.js",
  "./src/privacy.js",
  "./privacy.html",
  "./build.json",
  "./libs/three/three.module.js",
  "./libs/three/addons/objects/Sky.js",
  "./libs/three/addons/loaders/GLTFLoader.js",
  "./models/pickup6x6.glb",
  "./textures/sand.jpg",
  "./textures/sand_n.jpg",
  "./textures/grass.jpg",
  "./textures/grass_n.jpg",
  "./textures/rock.jpg",
  "./textures/rock_n.jpg",
  "./textures/dirt.jpg",
  "./textures/dirt_n.jpg",
  "./textures/bark.jpg",
  "./textures/bark_n.jpg",
  "./textures/pine_twig.jpg",
  "./textures/pine_twig_a.png",
  "./textures/leaf_sprig.jpg",
  "./textures/leaf_sprig_a.png",
  "./src/trees.js",
  "./textures/road.jpg",
  "./textures/road_n.jpg",
  "./textures/beach.jpg",
  "./textures/beach_n.jpg",
  "./textures/logs.jpg",
  "./textures/roof.jpg",
  "./textures/stone.jpg",
  "./libs/three/addons/utils/BufferGeometryUtils.js",
  "./libs/three/addons/postprocessing/EffectComposer.js",
  "./libs/three/addons/postprocessing/MaskPass.js",
  "./libs/three/addons/postprocessing/OutputPass.js",
  "./libs/three/addons/postprocessing/Pass.js",
  "./libs/three/addons/postprocessing/RenderPass.js",
  "./libs/three/addons/postprocessing/SMAAPass.js",
  "./libs/three/addons/postprocessing/ShaderPass.js",
  "./libs/three/addons/postprocessing/UnrealBloomPass.js",
  "./libs/three/addons/shaders/CopyShader.js",
  "./libs/three/addons/shaders/LuminosityHighPassShader.js",
  "./libs/three/addons/shaders/OutputShader.js",
  "./libs/three/addons/shaders/SMAAShader.js",
  "./icons/icon-1024.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // game code must never be served stale — see the note at the top
  const isCode = url.pathname.endsWith('.html')
              || url.pathname.endsWith('.css')
              || url.pathname.includes('/src/')
              || url.pathname.endsWith('/build.json')
              || url.pathname === '/' || url.pathname.endsWith('/');

  if (isCode) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true })
                        .then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
