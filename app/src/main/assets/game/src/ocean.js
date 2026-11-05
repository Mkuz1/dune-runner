/* ------------------------------------------------------------------
   ocean.js — deep-water sea with a shared wave model.

   The swell is six Gerstner components with real deep-water dispersion
   (ω = √(gk)). The exact same wave set is evaluated on the CPU by
   `waveAt()`, so the truck bobs on the same swell you can see — the
   physics and the shader never disagree.

   Waves shoal and flatten as the sea bed comes up, which is read from
   the shared terrain height field in the vertex shader. Colour is
   Beer-Lambert absorption over the sea floor rather than a flat blue,
   so shallows go turquoise and the deep goes almost black.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';

/* ---------------- the wave set, shared by GPU and CPU ---------------- */
const WAVES = [
  { dx:  0.96, dz:  0.28, amp: 0.50, len: 61.0, steep: 0.92 },
  { dx: -0.39, dz:  0.92, amp: 0.33, len: 33.0, steep: 0.88 },
  { dx:  0.77, dz: -0.64, amp: 0.195, len: 18.0, steep: 0.82 },
  { dx: -0.94, dz: -0.34, amp: 0.110, len: 10.0, steep: 0.76 },
  { dx:  0.30, dz:  0.95, amp: 0.060, len: 5.4, steep: 0.68 },
  { dx: -0.71, dz:  0.70, amp: 0.031, len: 2.9, steep: 0.60 }
];
const G = 9.81;

/** Wave surface height at a world point. `depth` in metres flattens the
    swell as it runs into the shallows, matching the shader. */
export function waveAt(x, z, t, depth = 40) {
  const shoal = Math.min(1, Math.max(0, (depth - 0.4) / 7.5));
  let y = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    const k = 6.28318 / w.len;
    const phase = k * (w.dx * x + w.dz * z) - t * Math.sqrt(G * k);
    y += Math.sin(phase) * w.amp * shoal;
  }
  return y;
}

/** Vertical velocity of the surface — used to make the truck ride the swell. */
export function waveVelAt(x, z, t, depth = 40) {
  const shoal = Math.min(1, Math.max(0, (depth - 0.4) / 7.5));
  let v = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    const k = 6.28318 / w.len;
    const om = Math.sqrt(G * k);
    const phase = k * (w.dx * x + w.dz * z) - t * om;
    v += -Math.cos(phase) * om * w.amp * shoal;
  }
  return v;
}

/* The wave table goes to the GPU as uniforms: GLSL ES 1.00 (which three
   uses for ShaderMaterial) has no array constructors, and uniform arrays
   indexed by a loop counter are legal there. */
function waveUniforms() {
  return {
    uWave:  { value: WAVES.map(w => new THREE.Vector4(w.dx, w.dz, w.amp, w.len)) },
    uSteep: { value: WAVES.map(w => w.steep) }
  };
}

/* ---------------- radial grid that follows the camera ---------------- */
function radialGrid(rings, segs, radius, inner = 1.4) {
  const verts = (rings + 1) * segs;
  const pos = new Float32Array(verts * 3 + 3);
  let p = 0;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const rad = inner + Math.pow(t, 3.05) * radius;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos[p++] = Math.cos(a) * rad;
      pos[p++] = 0;
      pos[p++] = Math.sin(a) * rad;
    }
  }
  const centre = p / 3;
  pos[p++] = 0; pos[p++] = 0; pos[p++] = 0;

  const idx = [];
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      const a = r * segs + s, b = r * segs + s2;
      const c = (r + 1) * segs + s, d = (r + 1) * segs + s2;
      idx.push(a, c, b, b, c, d);
    }
  }
  for (let s = 0; s < segs; s++) idx.push(centre, (s + 1) % segs, s);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.2);
  return g;
}

/* ============================ SHADERS ============================ */

const VERT = /* glsl */`
uniform float uTime;
uniform vec3  uCamPos;
uniform sampler2D uField;
uniform vec2  uFieldCenter;
uniform float uFieldSpan;
uniform float uBand;

varying vec3  vWorld;
varying vec3  vNrm;
varying float vCrest;
varying float vDepth;
varying float vShoal;

const int NW = 6;
uniform vec4 uWave[NW];
uniform float uSteep[NW];

void main() {
  vec3 wp = ( modelMatrix * vec4( position, 1.0 ) ).xyz;

  // sea-bed depth from the shared height field
  vec2 fuv = ( wp.xz - uFieldCenter ) / uFieldSpan + 0.5;
  float inField = step( 0.0, fuv.x ) * step( fuv.x, 1.0 ) * step( 0.0, fuv.y ) * step( fuv.y, 1.0 );
  float bed = mix( -uBand, uBand, texture2D( uField, clamp( fuv, 0.002, 0.998 ) ).r );
  /* Outside the height field, hold the nearest edge sample instead of
     forcing a deep value. Forcing -45 m here painted an opaque near-black
     disc of "deep ocean" over the land beyond the field radius — which is
     the black square that flashes past when you fly. */
  bed = mix( max( bed, 4.0 ), bed, inField );
  float depth = max( 0.0, -bed );
  vDepth = depth;

  // waves shoal and flatten as the bottom comes up
  float shoal = smoothstep( 0.4, 7.9, depth );
  vShoal = shoal;

  // distance fade so far-off water does not alias into noise
  float dist = length( wp.xz - uCamPos.xz );
  float fade = 1.0 - smoothstep( 600.0, 3400.0, dist );
  float amp = shoal * fade;

  vec3 disp = vec3( 0.0 );
  vec3 tx = vec3( 1.0, 0.0, 0.0 );
  vec3 tz = vec3( 0.0, 0.0, 1.0 );
  float crest = 0.0;

  for ( int i = 0; i < NW; i++ ) {
    vec2 d = uWave[i].xy;
    float a = uWave[i].z * amp;
    float k = 6.28318 / uWave[i].w;
    float om = sqrt( 9.81 * k );
    float f = k * dot( d, wp.xz ) - uTime * om;
    float s = sin( f ), c = cos( f );
    float q = uSteep[i] / ( k * max( a, 1e-4 ) * float( NW ) );

    disp.x += q * a * d.x * c;
    disp.z += q * a * d.y * c;
    disp.y += a * s;
    crest  += a * s;

    float wa = k * a;
    tx.x -= q * d.x * d.x * wa * s;
    tx.z -= q * d.x * d.y * wa * s;
    tx.y += d.x * wa * c;
    tz.x -= q * d.x * d.y * wa * s;
    tz.z -= q * d.y * d.y * wa * s;
    tz.y += d.y * wa * c;
  }

  wp += disp;
  vNrm = normalize( cross( tz, tx ) );
  vCrest = crest;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}
`;

const FRAG = /* glsl */`
precision highp float;

uniform float uTime;
uniform vec3  uCamPos;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uSkyTop;
uniform vec3  uSkyHorizon;
uniform vec3  uDeep;
uniform vec3  uShallow;
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform float uNight;
uniform sampler2D uField;
uniform vec2  uFieldCenter;
uniform float uFieldSpan;

varying vec3  vWorld;
varying vec3  vNrm;
varying float vCrest;
varying float vDepth;
varying float vShoal;

/* ---- value noise with analytic-ish gradients for the ripple normals ---- */
float h21( vec2 p ){
  p = fract( p * vec2( 127.31, 311.7 ) );
  p += dot( p, p + 34.72 );
  return fract( p.x * p.y );
}
float vn( vec2 p ){
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = h21( i ), b = h21( i + vec2( 1.0, 0.0 ) );
  float c = h21( i + vec2( 0.0, 1.0 ) ), d = h21( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}

/* Stacked scrolling ripples. Each octave drifts on its own heading so the
   surface never shows a repeating pattern. */
vec3 rippleNormal( vec2 p, float t, float strength ) {
  vec2 g = vec2( 0.0 );
  float amp = 1.0, frq = 0.085, e = 0.55;
  for ( int i = 0; i < 5; i++ ) {
    vec2 drift = vec2( sin( float( i ) * 2.13 ), cos( float( i ) * 1.71 ) ) * t * ( 0.35 + float( i ) * 0.22 );
    vec2 q = p * frq + drift;
    float n0 = vn( q );
    float nx = vn( q + vec2( e, 0.0 ) );
    float nz = vn( q + vec2( 0.0, e ) );
    g += vec2( nx - n0, nz - n0 ) * amp;
    amp *= 0.55; frq *= 2.35; e *= 1.0;
  }
  return normalize( vec3( -g.x * strength, 1.0, -g.y * strength ) );
}

vec3 skyColour( vec3 rd ) {
  float y = clamp( rd.y * 0.5 + 0.5, 0.0, 1.0 );
  vec3 c = mix( uSkyHorizon, uSkyTop, pow( y, 0.7 ) );
  float sun = max( dot( rd, uSunDir ), 0.0 );
  c += uSunColor * pow( sun, 1200.0 ) * 16.0;      // the disc
  c += uSunColor * pow( sun, 28.0 ) * 0.18;        // the glow around it
  return c;
}

void main() {
  vec3  V     = normalize( uCamPos - vWorld );
  float distC = length( uCamPos - vWorld );

  /* ---- surface normal: swell + ripples, ripples fading with distance ---- */
  float ripFade = 1.0 - smoothstep( 25.0, 700.0, distC );
  float choppy  = 0.55 + 0.45 * vShoal;
  vec3  rip = rippleNormal( vWorld.xz, uTime, 2.6 * choppy );
  vec3  N   = normalize( mix( vNrm, normalize( vNrm * 0.55 + rip ), ripFade ) );
  // never let the normal face away at grazing angles — that is what makes
  // cheap water look like plastic
  N = normalize( mix( N, vec3( 0.0, 1.0, 0.0 ), smoothstep( 400.0, 2600.0, distC ) ) );

  float NdV   = clamp( dot( N, V ), 0.0, 1.0 );
  float fres  = 0.02 + 0.98 * pow( 1.0 - NdV, 5.0 );

  /* ---- reflection ---- */
  vec3 R = reflect( -V, N );
  R.y = abs( R.y ) * 0.85 + 0.02;
  vec3 refl = skyColour( R );

  /* ---- refracted body: Beer-Lambert absorption over the sea bed ---- */
  float depth = vDepth;
  // the light path is longer at grazing angles
  float path = depth / max( NdV, 0.25 );
  vec3 absorb = exp( -path * vec3( 0.16, 0.055, 0.035 ) );
  vec3 bedCol = vec3( 0.76, 0.68, 0.50 );                 // pale sand
  bedCol *= 0.35 + 0.65 * clamp( uSunDir.y, 0.0, 1.0 );

  // caustics dancing on the bottom, only visible where it is shallow
  vec2 cp = vWorld.xz * 0.55;
  float ca = vn( cp + vec2( uTime * 0.35, uTime * 0.21 ) );
  float cb = vn( cp * 1.7 - vec2( uTime * 0.27, uTime * 0.4 ) );
  float caus = pow( clamp( 1.0 - abs( ca - cb ) * 2.4, 0.0, 1.0 ), 4.0 );
  bedCol += uSunColor * caus * 0.55 * smoothstep( 6.0, 0.4, depth ) * ( 1.0 - uNight );

  vec3 water = mix( uDeep, uShallow, exp( -depth * 0.16 ) );
  vec3 body  = bedCol * absorb + water * ( 1.0 - absorb );

  // light scattering up through the back of a swell
  float sss = pow( clamp( dot( V, -normalize( vec3( uSunDir.x, -abs( uSunDir.y ), uSunDir.z ) ) ), 0.0, 1.0 ), 4.0 );
  body += uSunColor * uShallow * sss * clamp( vCrest, 0.0, 1.0 ) * 0.55 * ( 1.0 - uNight );

  vec3 col = mix( body, refl, fres );

  /* ---- sun glitter: a tight lobe plus a broad rough one ---- */
  vec3 H = normalize( uSunDir + V );
  float NdH = max( dot( N, H ), 0.0 );
  col += uSunColor * pow( NdH, 900.0 ) * 5.0;
  col += uSunColor * pow( NdH, 60.0 ) * 0.22 * ripFade;

  /* ---- foam ---- */
  // breaking surf: a band that tracks the depth contour and pulses in
  float phase  = depth * 1.9 - uTime * 1.55 + vn( vWorld.xz * 0.02 ) * 8.0;
  float surf   = smoothstep( 2.9, 0.15, depth ) * ( 0.30 + 0.70 * pow( sin( phase ) * 0.5 + 0.5, 2.2 ) );
  // wave-crest whitecaps out at sea
  float caps   = smoothstep( 0.55, 0.92, vCrest ) * 0.7;
  // texture the foam so it is not a flat wash
  float grain  = vn( vWorld.xz * 3.1 + uTime * 0.6 ) * 0.6 + vn( vWorld.xz * 9.0 - uTime * 1.1 ) * 0.4;
  float foam   = clamp( surf + caps, 0.0, 1.0 ) * smoothstep( 0.18, 0.72, grain );
  vec3 foamCol = vec3( 0.95, 0.98, 1.0 ) * ( 0.35 + 0.65 * ( 1.0 - uNight ) );
  col = mix( col, foamCol, foam * 0.94 );

  /* ---- alpha: dissolve onto the wet sand at the water's edge ---- */
  float alpha = clamp( smoothstep( -0.05, 0.55, depth ) + foam * 0.8, 0.0, 1.0 );

  /* ---- fog, matching the scene ---- */
  float fogF = 1.0 - exp( -pow( distC * uFogDensity, 2.0 ) );
  col = mix( col, uFogColor, clamp( fogF, 0.0, 1.0 ) );

  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ============================== OCEAN ============================== */
export class Ocean {
  constructor(scene, quality, heightField) {
    const t = quality.tier;
    const rings = t === 'low' ? 64 : t === 'med' ? 92 : t === 'high' ? 124 : 150;
    const segs  = t === 'low' ? 80 : t === 'med' ? 112 : t === 'high' ? 150 : 180;
    const geo = radialGrid(rings, segs, 7000);

    this.uniforms = {
      uTime:        { value: 0 },
      uCamPos:      { value: new THREE.Vector3() },
      uSunDir:      { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() },
      uSunColor:    { value: new THREE.Color(1.0, 0.93, 0.82) },
      uSkyTop:      { value: new THREE.Color(0.16, 0.35, 0.66) },
      uSkyHorizon:  { value: new THREE.Color(0.66, 0.78, 0.92) },
      uDeep:        { value: new THREE.Color(0.010, 0.055, 0.098) },
      uShallow:     { value: new THREE.Color(0.075, 0.44, 0.44) },
      uFogColor:    { value: new THREE.Color(0.72, 0.80, 0.88) },
      uFogDensity:  { value: 0.00012 },
      uField:       { value: heightField.texture },
      uFieldCenter: { value: new THREE.Vector2(0, 0) },
      uFieldSpan:   { value: heightField.span },
      uBand:        { value: heightField.BAND },
      uNight:       { value: 0 },
      ...waveUniforms()
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.matrixAutoUpdate = false;
    this.hf = heightField;
    this.time = 0;
    this.mesh.name = 'ocean';
    scene.add(this.mesh);
  }

  update(dt, camera, env, time) {
    this.time = (time === undefined) ? this.time + dt : time;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uCamPos.value.copy(camera.position);
    this.mesh.position.set(camera.position.x, 0, camera.position.z);
    this.mesh.updateMatrix();
    this.uniforms.uFieldCenter.value.copy(this.hf.center);
    if (env) {
      this.uniforms.uSunDir.value.copy(env.sunDir);
      this.uniforms.uSunColor.value.copy(env.sunColor);
      this.uniforms.uSkyTop.value.copy(env.skyTop);
      this.uniforms.uSkyHorizon.value.copy(env.skyHorizon);
      this.uniforms.uFogColor.value.copy(env.fogColor);
      this.uniforms.uFogDensity.value = env.fogDensity;
      this.uniforms.uNight.value = env.night;
    }
  }
}
