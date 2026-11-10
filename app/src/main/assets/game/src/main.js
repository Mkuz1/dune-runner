/* ------------------------------------------------------------------
   main.js — boot, asset generation, game loop.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';

import { detectQuality, QualityGovernor, basePixelRatio } from './quality.js';
import { buildTextures } from './textures.js';
import { buildPropLibrary } from './props.js';
import { Terrain, HeightField, CHUNK } from './terrain.js';
import { Ocean } from './ocean.js';
import { Environment } from './environment.js';
import { GrassField } from './grass.js';
import { Villages, buildVillageLibrary } from './village.js';
import { Vehicle } from './vehicle.js';
import { VehiclePhysics } from './physics.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Fx } from './fx.js';
import { Post } from './post.js';
import { Audio } from './audio.js';
import { Settings } from './settings.js';
import { Diag } from './diag.js';
import { findSpawn, findSpawnNearVillage, villagesNear } from './world.js';
import { seedNoise } from './noise.js';

const bootEl = document.getElementById('boot');
const bootFill = document.getElementById('bootFill');
const bootMsg = document.getElementById('bootMsg');
const startBtn = document.getElementById('startBtn');

function setProgress(p, msg) {
  bootFill.style.width = Math.round(p * 100) + '%';
  if (msg) bootMsg.textContent = msg;
}

function fatal(msg) {
  document.getElementById('fatal').hidden = false;
  const m = document.getElementById('fatalMsg');
  if (m && msg) m.textContent = msg;
  bootEl.classList.add('gone');
}

/* ------------------------------------------------------------------ */
class Game {
  async boot() {
    setProgress(0.03, 'Starting renderer…');

    const params = new URLSearchParams(location.search);
    this.q = detectQuality(params.get('q'));
    if (params.get('seed')) seedNoise(parseInt(params.get('seed'), 10) || 1337);

    const canvas = document.getElementById('scene');
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        /* Mobile GPUs are tile-based: 4x MSAA resolves on-chip and costs
           very little, and without it a scaled-up mobile frame looks blocky. */
        canvas, antialias: !!this.q.isPhone, powerPreference: 'high-performance',
        stencil: false, alpha: false
      });
    } catch (e) {
      fatal('WebGL is not available in this browser.'); return;
    }
    if (!renderer.getContext()) { fatal(); return; }

    renderer.setPixelRatio(basePixelRatio(this.q));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = this.q.shadows;
    renderer.shadowMap.type = this.q.softShadows === false ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    renderer.info.autoReset = true;
    this.renderer = renderer;
    /* Record shader compile/link failures instead of only logging them, so a
       device whose GPU driver rejects a shader can fall back (see below) and
       the settings panel can report it. */
    this.shaderErrors = [];
    renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const log = (gl.getProgramInfoLog(program) || '') + (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || '');
      this.shaderErrors.push(log.trim().slice(0, 300) || 'link failed');
      console.error('shader error', log);
    };

    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      bootMsg.textContent = 'Graphics context lost — reload the page.';
      bootEl.classList.remove('gone');
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      this.q.fov, innerWidth / innerHeight, 0.35, CHUNK * (this.q.viewRadius + 1) * 1.6
    );
    this.camera.position.set(0, 40, 0);

    setProgress(0.10, 'Painting ground materials…');
    this.textures = await buildTextures(this.q, (p, m) => setProgress(0.10 + p * 0.34, m));

    setProgress(0.46, 'Growing forests…');
    await frame();
    this.props = buildPropLibrary(this.textures, this.q);

    setProgress(0.54, 'Raising the sun…');
    await frame();
    this.env = new Environment(this.scene, renderer, this.q);

    setProgress(0.60, 'Surveying the land…');
    await frame();
    this.hf = new HeightField(128, 6144);
    this.terrain = new Terrain(this.scene, this.textures, this.q, this.props);
    this.ocean = new Ocean(this.scene, this.q, this.hf);
    this.grass = new GrassField(this.scene, this.props, this.terrain, this.q);
    this.villageLib = buildVillageLibrary(this.textures);
    this.villages = new Villages(this.scene, this.q, this.villageLib);

    setProgress(0.66, 'Prepping the truck…');
    await frame();
    this.vehicle = new Vehicle(this.scene, this.q, this.textures);
    // the modelled 6x6 body; the procedural stand-in stays if this fails
    setProgress(0.68, 'Loading the 6x6…');
    await this.vehicle.loadModel('./models/pickup6x6.glb');

    const spawn = findSpawnNearVillage(0, 0);
    this.phys = new VehiclePhysics(spawn);
    this.phys.yaw = 0;
    this.spawn = spawn;

    this.chase = new ChaseCamera(this.camera, this.q);
    this.input = new Input(canvas);
    this.hud = new Hud(this.hf);
    this.fx = new Fx(this.scene, this.textures, this.q);
    this.post = new Post(renderer, this.scene, this.camera, this.q);
    this.gov = new QualityGovernor(renderer, this.q);
    this.audio = new Audio();
    this.settings = new Settings(this);

    if (this.input.hasTouch) {
      document.getElementById('touch').hidden = false;
      document.body.classList.add('touch');
    }

    /* ---- pre-generate the world around the spawn so there is no pop-in ---- */
    setProgress(0.72, 'Generating terrain…');
    this.camera.position.set(spawn.x, spawn.h + 12, spawn.z + 16);
    this.camera.lookAt(spawn.x, spawn.h, spawn.z);
    this.env.update(0, this.phys.pos, true);

    let guard = 0;
    while (guard++ < 900) {
      const left = this.terrain.update(spawn.x, spawn.z, 12);
      this.hf.update(spawn.x, spawn.z, 6);
      setProgress(0.72 + Math.min(0.26, (1 - left / 60) * 0.26), 'Generating terrain…');
      if (left === 0 && this.hf.row >= this.hf.res) break;
      if (guard % 4 === 0) await frame();
    }
    this.villages.update(spawn.x, spawn.z);
    this.hud.paintField();

    setProgress(0.99, 'Compiling shaders…');
    await frame();
    try { this.renderer.compile(this.scene, this.camera); } catch (_) {}
    // one warm-up frame so the first real frame is not a stutter
    this.phys.applyTo(this.vehicle);
    this.post.render(0.016);
    // a shader that failed to build: drop the truck's dust shader and retry
    if (this.shaderErrors.length && this.vehicle.removeGrime()) {
      this.post.render(0.016);
    }

    setProgress(1, 'Ready');
    /* Some Android WebViews fall back to software rendering (an outdated
       "Android System WebView", or a GPU the browser has blocklisted). The
       game then crawls at every setting, and nothing in the game can fix it,
       so say so plainly. */
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) {
        bootMsg.innerHTML = 'Graphics are running in <b>software mode</b> on this device, so the game will be very slow.<br>' +
          'Update <b>Android System WebView</b> and <b>Chrome</b> in the Play Store, then restart the game.';
        bootMsg.classList.add('warn');
      }
    } catch (_) {}
    startBtn.hidden = false;
    startBtn.addEventListener('click', () => this.start(), { once: true });

    /* Artifact hunter. Watches the real frame for a solid dark rectangle and
       raycasts to name whatever object is being drawn there.

       Two ways in, because the Android build has no address bar to put a
       query string in: `?diag=1` on the web, or tap the fps readout five
       times anywhere. */
    const armDiag = () => {
      if (this.diag) return;
      this.diag = new Diag(this);
      window.diag = this.diag;
    };
    if (params.get('diag')) armDiag();
    if (this.hud.el.fps) {
      let taps = 0, last = 0;
      const tap = (e) => {
        e.preventDefault();
        const now = performance.now();
        taps = (now - last < 900) ? taps + 1 : 1;
        last = now;
        if (taps >= 5) armDiag();
      };
      this.hud.el.fps.style.pointerEvents = 'auto';
      this.hud.el.fps.addEventListener('click', tap);
      this.hud.el.fps.addEventListener('touchend', tap);
    }

    addEventListener('resize', () => this.post.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.post.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio.fade(0, 0.2);
      else this.audio.fade(this.settings.muted ? 0 : this.settings.volume, 0.6);
    });
  }

  start() {
    bootEl.classList.add('gone');
    this.hud.show();
    this.audio.start();
    this.last = performance.now();
    this.acc = 0;
    this.running = true;
    requestAnimationFrame(this.loop);
  }

  /* Frame-rate cap. 'auto' locks phones and tablets to an even 30 fps once
     they show they cannot hold ~50: a steady 30 feels smoother than a
     ragged 38-45 on a 90/120 Hz screen, and the device runs cooler, so it
     is not thermally throttled a few minutes in. Desktop stays uncapped. */
  frameCap() {
    const pref = this.settings ? this.settings.fps : 'auto';
    if (pref === '30') return 30;
    if (pref === '60') return 60;
    return this.autoCap || 0;
  }

  loop = (now) => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);

    const cap = this.frameCap();
    if (cap) {
      // skip this vsync if the next frame is not due yet (2 ms of slack
      // so a 60 Hz screen does not drop to 20 when capped at 30)
      const interval = 1000 / cap;
      if (now - this.last < interval - 2) return;
    }

    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25;           // tab was backgrounded
    const rdt = dt;
    dt = Math.max(dt, 1 / 240);

    const phys = this.phys;
    const input = this.input.update(dt, phys.forwardSpeed, phys.flying);

    /* ---- one-shot actions ---- */
    if (input.toggleCam) this.chase.cycle();
    if (input.reset) {
      const s = findSpawn(phys.pos.x, phys.pos.z);
      phys.reset(s.x, s.z, s.h);
    }
    if (input.toggleLights) this.manualLights = !this.manualLights;
    if (input.toggleMute) this.settings.setMuted(!this.settings.muted);
    if (input.timeShift) this.env.setTimeOfDay(this.env.timeOfDay + input.timeShift * dt * 2.2);

    /* ---- simulate ---- */
    phys.update(dt, input);
    phys.applyTo(this.vehicle);
    this.vehicle.updateShadow(phys);

    /* ---- world streaming ---- */
    this.props.windClock.value += dt;
    /* Give the terrain streamer more of the frame the faster we are moving.
       Flying covers ground three to five times quicker than driving, and a
       chunk that has not been built yet is a hole in the world — much more
       noticeable than the couple of milliseconds this costs. */
    const streamBudget = this.q.isPhone
      // a phone has ~16 ms for everything; 16 ms of streaming alone was a slideshow
      ? 2.5 + Math.min(4, phys.speed * 0.06)
      : (this.q.tier === 'low' ? 4.5 : 7) + Math.min(9, phys.speed * 0.13);
    this.terrain.update(phys.pos.x, phys.pos.z, streamBudget);
    this.hf.update(phys.pos.x, phys.pos.z, 1.6);
    this.grass.update(dt, phys.pos.x, phys.pos.z);
    this.villages.update(phys.pos.x, phys.pos.z);

    /* ---- camera, sky, water ---- */
    this.chase.update(dt, phys, input);
    // the shadow camera needs to know where the ground is, not just the truck
    phys.pos.groundY = phys.groundY;
    this.env.update(dt, phys.pos);
    this.ocean.update(dt, this.camera, this.env, phys.time);
    this.villages.setNight(this.env.night);
    this.post.setExposure(this.env.exposure);

    /* ---- lights ---- */
    const wantLights = this.manualLights !== undefined
      ? this.manualLights : this.env.night > 0.35;
    this.vehicle.setLights(wantLights, input.brake, this.env.night);

    /* ---- fx, audio, hud ---- */
    this.fx.update(dt, phys, this.vehicle, this.camera, this.env);
    this.audio.update(dt, phys, input);
    this.gov.target = this.frameCap() || 60;
    this.gov.update(rdt, this.post);
    // auto: phones/tablets that cannot sustain ~50 fps get a steady 30
    if (this.q.isPhone && !this.autoCap && this.gov.fps > 0) {
      if (this.gov.fps >= 50) this.slowSince = 0;
      else if (!this.slowSince) this.slowSince = now;
      else if (now - this.slowSince > 3000) this.autoCap = 30;
    }
    this.hud.update(dt, phys, this.env, this.chase.modeName, this.gov.fps);

    this.post.render(dt);
    // must run after the render, while the drawing buffer is still readable
    if (this.diag) this.diag.update();
  };
}

const frame = () => new Promise(r => requestAnimationFrame(() => r()));

/* ------------------------------------------------------------------ */
window.__bootStarted = true;      // tells the loading watchdog we are alive

/* Offline support. Skipped inside the Android app, where the assets are
   already served straight out of the APK. */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')
    && location.hostname !== 'appassets.androidplatform.net') {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

const game = new Game();
window.game = game;          // handy for tinkering from the console
game.boot().catch((err) => {
  console.error(err);
  fatal('Something went wrong while starting the game: ' + (err && err.message ? err.message : err));
});
