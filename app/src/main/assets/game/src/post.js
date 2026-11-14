/* ------------------------------------------------------------------
   post.js — optional post-processing chain.

   High / medium: render → bloom → tone map + sRGB (+ SMAA on desktop).
   Low or when the frame-rate governor gives up on bloom: straight to
   the canvas, which is measurably cheaper on mobile GPUs.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';
import { EffectComposer } from '../libs/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../libs/three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from '../libs/three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../libs/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../libs/three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from '../libs/three/addons/postprocessing/SMAAPass.js';

/* Contrast-adaptive sharpening + vignette + a whisper of grain and edge
   chromatic aberration. Cheap, and it is what makes the image read as
   "detailed" rather than soft. */
const FinishShader = {
  uniforms: {
    tDiffuse:   { value: null },
    uTexel:     { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uSharpen:   { value: 0.45 },
    uVignette:  { value: 0.30 },
    uGrain:     { value: 0.022 },
    uAberration:{ value: 0.0016 },
    uTime:      { value: 0 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2  uTexel;
    uniform float uSharpen, uVignette, uGrain, uAberration, uTime;
    varying vec2 vUv;

    float luma( vec3 c ){ return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }

    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot( d, d );

      // lateral chromatic aberration, strongest at the corners
      vec2 ab = d * r2 * uAberration;
      vec3 c;
      c.r = texture2D( tDiffuse, vUv + ab ).r;
      c.g = texture2D( tDiffuse, vUv ).g;
      c.b = texture2D( tDiffuse, vUv - ab ).b;

      // CAS-style sharpen from a 4-tap cross
      vec3 n = texture2D( tDiffuse, vUv + vec2( 0.0, -uTexel.y ) ).rgb;
      vec3 s = texture2D( tDiffuse, vUv + vec2( 0.0,  uTexel.y ) ).rgb;
      vec3 w = texture2D( tDiffuse, vUv + vec2( -uTexel.x, 0.0 ) ).rgb;
      vec3 e = texture2D( tDiffuse, vUv + vec2(  uTexel.x, 0.0 ) ).rgb;
      vec3 mn = min( min( n, s ), min( w, e ) );
      vec3 mx = max( max( n, s ), max( w, e ) );
      // back off where the neighbourhood is already high contrast
      float amp = uSharpen * ( 1.0 - clamp( luma( mx - mn ) * 2.4, 0.0, 1.0 ) );
      vec3 sharp = c + ( c * 4.0 - ( n + s + w + e ) ) * amp * 0.25;
      c = clamp( sharp, min( mn, c ) * 0.92, max( mx, c ) * 1.08 );

      /* Colour grade. Tone mapping gets the image into range; grading is
         what makes it look photographed rather than rendered. Three moves,
         all a couple of instructions each:
           · a gentle contrast S-curve about mid grey, so the picture has
             a proper black point instead of sitting in a grey band;
           · split toning — shadows pushed slightly cool, highlights
             slightly warm, which is what daylight actually does and what
             every film stock exaggerates;
           · a small saturation lift that spares the near-greys, so
             foliage and sea gain depth without the sand going lurid. */
      float lum = luma( c );
      c = mix( vec3( lum ), c, 1.12 );                       // saturation
      c = clamp( ( c - 0.5 ) * 1.075 + 0.5, 0.0, 1.6 );      // contrast
      vec3 shadowTint    = vec3( 0.96, 0.99, 1.06 );
      vec3 highlightTint = vec3( 1.045, 1.005, 0.955 );
      c *= mix( shadowTint, highlightTint, smoothstep( 0.18, 0.85, lum ) );

      // vignette
      c *= 1.0 - uVignette * smoothstep( 0.18, 0.78, r2 );

      // film grain, a touch stronger in the shadows
      float g = fract( sin( dot( vUv * vec2( 1223.7, 913.1 ) + uTime, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
      c += ( g - 0.5 ) * uGrain * ( 1.25 - luma( c ) );

      gl_FragColor = vec4( c, 1.0 );
    }`
};

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.q = quality;
    this.direct = !quality.bloom && !quality.smaa && !quality.finish;

    if (this.direct) return;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: (quality.tier === 'ultra' || quality.tier === 'high' || quality.isPhone) && !quality.smaa ? 4 : 0
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(size, quality.tier === 'ultra' ? 0.26 : 0.30, 0.70, 0.94);
    this.bloom.enabled = !!quality.bloom;
    // belt and braces: whatever reaches the bloom is finite and bounded
    this.bloom.materialHighPassFilter.fragmentShader = this.bloom.materialHighPassFilter.fragmentShader
      .replace('vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = min( texture2D( tDiffuse, vUv ), vec4( 64.0 ) );');
    this.bloom.materialHighPassFilter.needsUpdate = true;
    this.composer.addPass(this.bloom);

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    // antialias before sharpening, otherwise the sharpen re-hardens the edges
    if (quality.smaa) {
      this.smaa = new SMAAPass(size.x, size.y);
      this.composer.addPass(this.smaa);
    }

    if (quality.finish) {
      this.finish = new ShaderPass(FinishShader);
      this.finish.uniforms.uSharpen.value = quality.sharpen;
      this.finish.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
      this.composer.addPass(this.finish);
    }
  }

  setBloom(on) { if (this.bloom) this.bloom.enabled = on; }

  setExposure(e) { this.renderer.toneMappingExposure = e; }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      /* The frame-rate governor lowers the renderer's pixel ratio, but the
         composer keeps its own copy from construction time — so its render
         targets stayed at full resolution and dropping the render scale
         achieved nothing. Re-sync it here. */
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.composer.setSize(w, h);
      if (this.smaa) this.smaa.setSize(s.x, s.y);
      if (this.bloom) this.bloom.setSize(s.x, s.y);
      if (this.finish) this.finish.uniforms.uTexel.value.set(1 / s.x, 1 / s.y);
    }
  }

  render(dt) {
    if (this.composer && (this.bloom?.enabled || this.smaa || this.finish)) {
      if (this.finish) this.finish.uniforms.uTime.value += dt;
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
