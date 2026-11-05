/* ------------------------------------------------------------------
   environment.js — sky, sun, moon, stars, clouds, fog and the moving
   shadow camera. Everything is driven by a single "time of day" value
   so the whole world lights consistently.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';
import { Sky } from '../libs/three/addons/objects/Sky.js';
import { clamp, smoothstep, makeRandom } from './noise.js';

const CLOUD_VERT = /* glsl */`
varying vec2 vUvW;
varying vec3 vW;
void main(){
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vW = wp.xyz;
  vUvW = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const CLOUD_FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTint;
uniform float uCover;
uniform float uNight;
uniform vec3 uCamPos;
varying vec2 vUvW;
varying vec3 vW;

float h21( vec2 p ){ p = floor(p); return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float vnoise( vec2 p ){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = h21(i), b = h21(i+vec2(1,0)), c = h21(i+vec2(0,1)), d = h21(i+vec2(1,1));
  return mix( mix(a,b,f.x), mix(c,d,f.x), f.y );
}
float fbm( vec2 p ){
  float s = 0.0, a = 0.5;
  for ( int i = 0; i < 5; i++ ){ s += a * vnoise(p); p *= 2.03; p += 17.0; a *= 0.5; }
  return s;
}

void main(){
  vec2 p = vUvW * 0.00042 + vec2( uTime * 0.0035, uTime * 0.0016 );
  float n = fbm( p * 2.0 );
  float n2 = fbm( p * 6.0 + n );
  float d = smoothstep( 1.0 - uCover, 1.28 - uCover, n * 0.72 + n2 * 0.38 );

  float dist = length( vW.xz - uCamPos.xz );
  d *= smoothstep( 12000.0, 3000.0, dist );      // fade out at the horizon
  if ( d < 0.004 ) discard;

  float lit = clamp( n2 * 1.5, 0.25, 1.0 );
  vec3 col = mix( uSkyTint * 0.62, vec3( 1.0 ), lit );
  col = mix( col, uSunColor, 0.28 * pow( clamp( uSunDir.y, 0.0, 1.0 ), 0.5 ) );
  col *= mix( 1.0, 0.22, uNight );

  gl_FragColor = vec4( col, d * 0.82 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ------------------------------------------------------------------
   Aerial perspective.

   three's built-in fog is a flat grey wash: one colour, applied by
   distance, identical in every direction. Real distance haze does two
   things it does not. It thins out with altitude, so mountain tops stay
   crisp while valleys fill with mist and the sky reads as a volume you
   are inside rather than a painted dome. And it scatters light forward,
   so haze looking towards the sun is bright and warm while haze looking
   away from it is cool and blue.

   Patching the shared fog chunk upgrades every fogged material in the
   game at once — terrain, trees, chalets, the truck — for the cost of a
   handful of instructions per pixel. It is the single biggest realism
   gain available here per unit of GPU time.
------------------------------------------------------------------ */
/* The three uniforms the patched fog needs, shared by every material.

   three clones a material's uniforms when it builds the program, so a
   normal uniform value would end up as a private copy per material and
   updating it once would not reach the rest. Its `cloneUniforms` copies
   Color/Vector/Matrix by `.clone()` and plain Arrays by `.slice()`, but
   anything else — including a **typed** array — is copied by reference.
   So the values live in Float32Arrays and every material really does
   share them; writing here updates the whole scene at once. Scalars are
   packed into `uAerialParams` for the same reason. */
export const AERIAL = {
  uAerialSunDir:  { value: new Float32Array([0, 1, 0]) },
  uAerialSunTint: { value: new Float32Array([1, 1, 1]) },
  uAerialParams:  { value: new Float32Array([300, 0]) }   // x = haze scale height, y = night
};

function installAerialPerspective() {
  if (THREE.ShaderChunk.__duneAerial) return;
  THREE.ShaderChunk.__duneAerial = true;

  // ShaderLib was already assembled at import time, so the uniforms have to
  // be added to each built-in material's prototype set rather than UniformsLib
  for (const k of ['basic', 'lambert', 'phong', 'standard', 'physical', 'toon']) {
    if (THREE.ShaderLib[k]) Object.assign(THREE.ShaderLib[k].uniforms, AERIAL);
  }

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
    #ifdef USE_FOG
      varying vec3 vFogWorld;
      varying float vFogDepth;
    #endif`;

  THREE.ShaderChunk.fog_vertex = /* glsl */`
    #ifdef USE_FOG
      vFogDepth = - mvPosition.z;
      vFogWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
    #endif`;

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying vec3 vFogWorld;
      varying float vFogDepth;
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif
      uniform vec3 uAerialSunDir;
      uniform vec3 uAerialSunTint;
      uniform vec2 uAerialParams;   // x = haze scale height, y = night
    #endif`;

  THREE.ShaderChunk.fog_fragment = /* glsl */`
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
      #else
        float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
      #endif

      // haze thins with altitude — ridges stay sharp, valleys fill in
      float hFade = exp( - max( vFogWorld.y, 0.0 ) / uAerialParams.x );
      fogFactor *= mix( 0.30, 1.0, hFade );

      // forward scattering: haze towards the sun is bright and warm
      vec3 viewDirW = normalize( vFogWorld - cameraPosition );
      float sunAmt = max( dot( viewDirW, uAerialSunDir ), 0.0 );
      vec3 haze = mix( fogColor, uAerialSunTint, pow( sunAmt, 4.0 ) * 0.55 * ( 1.0 - uAerialParams.y ) );
      // and a touch cooler looking away from it
      haze = mix( haze * vec3( 0.94, 0.97, 1.06 ), haze, sunAmt );

      gl_FragColor.rgb = mix( gl_FragColor.rgb, haze, clamp( fogFactor, 0.0, 1.0 ) );
    #endif`;
}

export class Environment {
  constructor(scene, renderer, quality) {
    installAerialPerspective();
    this.scene = scene;
    this.renderer = renderer;
    this.q = quality;

    /* ---------- sky dome ---------- */
    this.sky = new Sky();
    this.sky.scale.setScalar(45000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4.2;
    u.rayleigh.value = 1.9;
    u.mieCoefficient.value = 0.0042;
    u.mieDirectionalG.value = 0.82;
    this.sky.name = 'sky-dome';
    this.sky.material.depthWrite = false;
    scene.add(this.sky);

    /* ---------- lights ---------- */
    this.sun = new THREE.DirectionalLight(0xffffff, 3.0);
    this.sun.castShadow = quality.shadows;
    if (quality.shadows) {
      const s = this.sun.shadow;
      s.mapSize.set(quality.shadowSize, quality.shadowSize);
      s.camera.near = 1;
      s.camera.far = 900;
      const e = quality.shadowExtent;
      s.camera.left = -e; s.camera.right = e;
      s.camera.top = e; s.camera.bottom = -e;
      s.bias = -0.0006;
      s.normalBias = 0.9;
      s.blurSamples = 8;
    }
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sun, this.sunTarget);
    this.sun.target = this.sunTarget;

    this.hemi = new THREE.HemisphereLight(0xbcd6f2, 0x59503f, 0.85);
    scene.add(this.hemi);

    this.fill = new THREE.DirectionalLight(0x8fb6de, 0.35);
    this.fill.position.set(-0.4, 0.5, -0.6);
    scene.add(this.fill);

    /* ---------- fog ---------- */
    this.fogColor = new THREE.Color(0.72, 0.80, 0.88);
    this.fogDensity = quality.fogDensity;
    scene.fog = new THREE.FogExp2(this.fogColor.getHex(), this.fogDensity);

    /* ---------- void backdrop ----------
       A safety net, not scenery. The terrain streamer can always be
       outrun — fly fast enough and a chunk simply will not exist yet.
       Without this you look straight down through the gap at the underside
       of the sky dome, which is black, and a hole reads as a hard-edged
       black square. This sheet sits below the deepest possible sea bed
       (about -265 m) and is painted the fog colour, so a gap reads as
       haze. It is invisible in normal play: terrain covers it on land, and
       deep water is opaque enough to hide it at sea. */
    this.backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: this.fogColor.clone(), fog: false, depthWrite: true })
    );
    this.backdrop.geometry.scale(13000, 13000, 1);
    this.backdrop.rotation.x = -Math.PI / 2;
    this.backdrop.position.y = -520;
    this.backdrop.name = 'void-backdrop';
    this.backdrop.frustumCulled = false;
    this.backdrop.renderOrder = -20;
    this.backdrop.matrixAutoUpdate = true;
    scene.add(this.backdrop);

    /* ---------- stars ---------- */
    const rnd = makeRandom(4242);
    const N = quality.tier === 'low' ? 700 : 1800;
    const sp = new Float32Array(N * 3);
    const sc = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      let x, y, z, l;
      do { x = rnd() * 2 - 1; y = rnd(); z = rnd() * 2 - 1; l = Math.hypot(x, y, z); } while (l < 0.15);
      sp[i * 3] = x / l * 20000; sp[i * 3 + 1] = y / l * 20000; sp[i * 3 + 2] = z / l * 20000;
      const w = 0.72 + rnd() * 0.28, b = 0.65 + rnd() * 0.35;
      sc[i * 3] = w * b; sc[i * 3 + 1] = w * b * (0.94 + rnd() * 0.08); sc[i * 3 + 2] = b;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    this.starMat = new THREE.PointsMaterial({
      size: 2.4, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 0, depthWrite: false, fog: false
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.name = 'stars';
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -10;
    scene.add(this.stars);

    /* ---------- moon ---------- */
    this.moonMat = new THREE.MeshBasicMaterial({ color: 0xf2f4ff, fog: false, transparent: true, opacity: 0 });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), this.moonMat);
    this.moon.scale.setScalar(320);
    this.moon.name = 'moon';
    this.moon.frustumCulled = false;
    scene.add(this.moon);

    /* ---------- clouds ---------- */
    this.clouds = null;
    if (quality.clouds) {
      this.cloudU = {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSkyTint: { value: new THREE.Color(0.7, 0.8, 0.95) },
        uCover: { value: 0.44 },
        uNight: { value: 0 },
        uCamPos: { value: new THREE.Vector3() }
      };
      const cm = new THREE.ShaderMaterial({
        uniforms: this.cloudU, vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false
      });
      this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000, 1, 1), cm);
      this.clouds.rotation.x = -Math.PI / 2;
      this.clouds.position.y = 1250;
      this.clouds.name = 'cloud-plane';
      this.clouds.frustumCulled = false;
      this.clouds.renderOrder = -5;
      scene.add(this.clouds);
    }

    /* ---------- environment map for PBR reflections ---------- */
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(10000);
    this.envScene.add(this.envSky);
    this.envRT = null;
    this.lastEnvElev = -999;

    /* ---------- state ---------- */
    this.timeOfDay = 8.4;                 // hours
    this.daySpeed = 1 / 150;              // 1 in-game hour per 150 real seconds
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.sunColor = new THREE.Color(1, 1, 1);
    this.skyTop = new THREE.Color(0.16, 0.35, 0.66);
    this.skyHorizon = new THREE.Color(0.66, 0.78, 0.92);
    this.night = 0;
    this.exposure = 1.0;
    this.update(0, new THREE.Vector3(), true);
  }

  setTimeOfDay(h) { this.timeOfDay = ((h % 24) + 24) % 24; }

  update(dt, focus, force = false) {
    this.timeOfDay = (this.timeOfDay + dt * this.daySpeed) % 24;
    const t = this.timeOfDay;

    // sun path: elevation peaks at 13:00, azimuth sweeps east → west
    const a = ((t - 6) / 24) * Math.PI * 2;
    const elev = Math.sin(a) * 0.98;
    const azi = ((t - 12) / 24) * Math.PI * 2 + 0.6;
    const cosE = Math.cos(Math.asin(clamp(elev, -1, 1)));
    this.sunDir.set(Math.sin(azi) * cosE, elev, Math.cos(azi) * cosE).normalize();

    const up = clamp(this.sunDir.y, -1, 1);
    this.night = 1 - smoothstep(-0.09, 0.14, up);
    const golden = 1 - smoothstep(0.02, 0.34, up);   // 1 at sunrise/sunset

    // sky
    const su = this.sky.material.uniforms;
    su.sunPosition.value.copy(this.sunDir).multiplyScalar(40000);
    su.turbidity.value = 2.6 + golden * 5.0;
    su.rayleigh.value = 0.9 + golden * 2.0 + this.night * 0.35;
    su.mieCoefficient.value = 0.0030 + golden * 0.007;

    // colours used by water, fog and the HUD
    this.sunColor.setRGB(
      1.0,
      0.62 + 0.36 * smoothstep(-0.02, 0.35, up),
      0.32 + 0.60 * smoothstep(0.0, 0.42, up)
    );
    const dayTop = new THREE.Color(0.13, 0.32, 0.66);
    const nightTop = new THREE.Color(0.014, 0.028, 0.075);
    const duskTop = new THREE.Color(0.14, 0.13, 0.30);
    this.skyTop.copy(nightTop).lerp(duskTop, 1 - this.night).lerp(dayTop, smoothstep(0.05, 0.42, up));

    const dayHz = new THREE.Color(0.66, 0.78, 0.92);
    const duskHz = new THREE.Color(0.86, 0.44, 0.22);
    const nightHz = new THREE.Color(0.045, 0.062, 0.115);
    this.skyHorizon.copy(nightHz)
      .lerp(duskHz, (1 - this.night) * golden)
      .lerp(dayHz, smoothstep(0.10, 0.46, up));

    // fog follows the horizon so distance always reads correctly
    this.fogColor.copy(this.skyHorizon).lerp(this.skyTop, 0.34).multiplyScalar(0.92);
    this.fogDensity = this.q.fogDensity * (1 + this.night * 0.5);
    if (this.scene.fog) {
      this.scene.fog.color.copy(this.fogColor);

      /* drive the aerial-perspective haze (see installAerialPerspective) */
      const A = AERIAL;
      A.uAerialSunDir.value[0] = this.sunDir.x;
      A.uAerialSunDir.value[1] = this.sunDir.y;
      A.uAerialSunDir.value[2] = this.sunDir.z;
      // inscattered light: the sun's colour, lifted towards white overhead
      A.uAerialSunTint.value[0] = Math.min(1.6, this.sunColor.r * 1.35 + 0.22);
      A.uAerialSunTint.value[1] = Math.min(1.6, this.sunColor.g * 1.25 + 0.20);
      A.uAerialSunTint.value[2] = Math.min(1.6, this.sunColor.b * 1.10 + 0.18);
      // haze sits lower and tighter at dawn and dusk, higher at midday
      A.uAerialParams.value[0] = 190 + 260 * clamp(this.sunDir.y, 0, 1);
      A.uAerialParams.value[1] = this.night;
      this.scene.fog.density = this.fogDensity;
    }

    /* Lights. The Preetham sky is a physically-scaled model, so the whole
       scene is exposed low and the analytic lights are scaled up to match;
       otherwise the sky blows out to white. */
    const sunI = clamp(smoothstep(-0.06, 0.22, up), 0, 1);
    this.sun.intensity = 0.25 + sunI * 5.4;
    this.sun.color.copy(this.sunColor);
    this.hemi.intensity = 0.30 + sunI * 1.30;
    this.hemi.color.copy(this.skyHorizon).multiplyScalar(1.5);
    this.hemi.groundColor.setRGB(0.18 + sunI * 0.14, 0.15 + sunI * 0.12, 0.11 + sunI * 0.09);
    this.fill.intensity = 0.10 + sunI * 0.42;
    this.exposure = 0.56 - sunI * 0.09 + this.night * 0.22;

    /* ---------------- shadow rig ----------------

       This is where the flashing black square came from, and it is worth
       spelling out because the symptom looks nothing like the cause.

       The shadow map covers a fixed ortho box — 210 m across at Ultra —
       centred under the player. Inside that box surfaces are shadow-tested;
       outside it they are simply lit. So *any* systematic error in the
       shadow test paints a hard-edged square exactly the size of the box,
       and from the air you see the whole square at once.

       The error was the light's position. It used to be placed at
       `max(70, sunDir.y * dist)` above the ground, which is a different
       direction from `sunDir` itself whenever the sun is lower than ~18°.
       The scene was therefore *shaded* from one direction and
       *shadow-tested* from another. Every surface the low sun grazes then
       fails its own depth comparison and reads as self-shadowed: the entire
       footprint goes black. Morning, evening, and any overcast-angle sun —
       which is most of the day.

       Two rules now:
         1. The light sits on the true sun direction. No separate height
            clamp, ever. Shading direction and shadow direction agree.
         2. Shadows fade out (they are never toggled — flipping `castShadow`
            recompiles every shader in the scene) when they cannot be
            correct or cannot be seen: with the sun on the horizon, and
            from altitude, where a 210 m patch of contact shadow is
            invisible detail but a very visible square edge.               */
    const ext = this.q.shadowExtent;
    const gy = (focus.groundY !== undefined) ? focus.groundY : focus.y;
    this.sunTarget.position.set(focus.x, gy, focus.z);

    // Keep the light's *elevation angle* honest, and back it off far enough
    // that it always clears the terrain relief inside the box.
    const D = ext * 2.4 / Math.max(this.sunDir.y, 0.16);
    this.sun.position.set(
      focus.x + this.sunDir.x * D,
      gy      + this.sunDir.y * D,
      focus.z + this.sunDir.z * D
    );
    this.sunTarget.updateMatrixWorld();

    if (this.q.shadows) {
      const s = this.sun.shadow;
      const far = D + ext * 6 + 300;
      if (Math.abs(s.camera.far - far) > 60) {
        s.camera.far = far;
        s.camera.updateProjectionMatrix();
      }
      const alt = Math.max(0, focus.y - gy);
      s.intensity = (1 - smoothstep(140, 340, alt))      // gone by the time you are flying
                  * smoothstep(0.05, 0.20, this.sunDir.y); // gone as the sun touches the horizon
    }

    // stars & moon
    this.starMat.opacity = this.night * 0.95;
    this.stars.position.set(focus.x, 0, focus.z);
    this.stars.rotation.y = this.timeOfDay * 0.09;
    const md = this.sunDir.clone().negate();
    this.moon.position.set(focus.x + md.x * 16000, md.y * 16000, focus.z + md.z * 16000);
    this.moonMat.opacity = clamp(this.night * 1.1 * smoothstep(-0.05, 0.12, md.y), 0, 1);

    this.sky.position.set(focus.x, 0, focus.z);

    // keep the void backdrop under the player and matched to the haze
    this.backdrop.position.x = focus.x;
    this.backdrop.position.z = focus.z;
    this.backdrop.material.color.copy(this.fogColor);

    if (this.clouds) {
      this.cloudU.uTime.value += dt;
      this.cloudU.uSunDir.value.copy(this.sunDir);
      this.cloudU.uSunColor.value.copy(this.sunColor);
      this.cloudU.uSkyTint.value.copy(this.skyHorizon);
      this.cloudU.uNight.value = this.night;
      this.cloudU.uCamPos.value.set(focus.x, focus.y, focus.z);
      this.clouds.position.set(focus.x, 1250, focus.z);
    }

    // refresh the reflection probe when the sun has visibly moved
    if (force || Math.abs(up - this.lastEnvElev) > 0.045) {
      this.lastEnvElev = up;
      this.refreshEnv();
    }
  }

  refreshEnv() {
    const eu = this.envSky.material.uniforms;
    const su = this.sky.material.uniforms;
    eu.sunPosition.value.copy(su.sunPosition.value);
    eu.turbidity.value = su.turbidity.value;
    eu.rayleigh.value = su.rayleigh.value;
    eu.mieCoefficient.value = su.mieCoefficient.value;
    eu.mieDirectionalG.value = su.mieDirectionalG.value;
    const old = this.envRT;
    try {
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 40000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.6 + (1 - this.night) * 0.5;
      if (old) old.dispose();
    } catch (e) { /* probe is a nicety, never fatal */ }
  }

  dispose() {
    if (this.envRT) this.envRT.dispose();
    this.pmrem.dispose();
  }
}
