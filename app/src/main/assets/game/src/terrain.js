/* ------------------------------------------------------------------
   terrain.js — streaming, unbounded terrain.

   • 512 m chunks generated on demand around the player, with 5 levels of
     detail and vertical skirts so LOD borders never crack.
   • Four-way splat mapping (forest floor / sand / rock / packed dirt)
     with per-layer normal maps, macro variation to kill tiling, wet-sand
     shorelines and snow above the tree line.
   • Vegetation is scattered from the same height data, deterministically,
     so a tree stays exactly where it was when the chunk changes LOD.
   • All generation is time-sliced against a frame budget: no hitches.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';
import { surface, splat, villageAt, SEA_LEVEL } from './world.js';
import { hash2, clamp, smoothstep } from './noise.js';

export const CHUNK = 512;
const TILE = 16;          // metres per texture tile → 32 tiles per chunk
const SKIRT = 34;         // vertical apron hiding LOD seams

/* ============================ MATERIAL ============================ */

function makeTerrainMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    normalMap: tex.grassN,                       // enables the tangent frame
    normalScale: new THREE.Vector2(1.15, 1.15)
  });

  const one = new THREE.Vector3(1, 1, 1);
  const gain = tex.gain || {};
  const U = {
    tGrass: { value: tex.grass }, tSand: { value: tex.sand },
    tRock: { value: tex.rock },   tDirt: { value: tex.dirt },
    nGrass: { value: tex.grassN }, nSand: { value: tex.sandN },
    nRock: { value: tex.rockN },   nDirt: { value: tex.dirtN },
    tMacro: { value: tex.macro || tex.rock },
    // colour calibration for the photo-scanned layers (1,1,1 if procedural)
    gGrass: { value: gain.grass || one }, gSand: { value: gain.sand || one },
    gRock:  { value: gain.rock  || one }, gDirt: { value: gain.dirt || one }
  };
  mat.userData.U = U;
  /* Photo textures repeat visibly from the air. ANTI_TILE blends in a
     second, rotated sample at an unrelated scale, switched by macro noise,
     so the combined pattern practically never repeats. Four extra texture
     reads, so the low tier goes without. */
  if (tex.antiTile) mat.defines = { ANTI_TILE: '' };

  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);

    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aSplat;
        attribute float aAO;
        varying vec4 vSplat;
        varying vec3 vWPos;
        varying float vNrmY;
        varying float vAO;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat = aSplat;
        vAO    = aAO;
        vWPos  = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
        vNrmY  = normalize( mat3( modelMatrix ) * normal ).y;`);

    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vSplat;
        varying vec3 vWPos;
        varying float vNrmY;
        varying float vAO;
        uniform sampler2D tGrass, tSand, tRock, tDirt;
        uniform sampler2D nGrass, nSand, nRock, nDirt;
        uniform sampler2D tMacro;
        uniform vec3 gGrass, gSand, gRock, gDirt;

        vec3 layer( sampler2D t, vec2 uv, float w ){
          vec3 a = texture2D( t, uv ).rgb;
          #ifdef ANTI_TILE
            if ( w > 0.004 ) {
              vec3 b = texture2D( t, vec2( uv.y, -uv.x ) * 0.381 + 0.27 ).rgb;
              a = mix( a, b, w );
            }
          #endif
          return a;
        }`)

      .replace('#include <map_fragment>', `
        vec2 uvA = vNormalMapUv;            // 16 m tile
        vec2 uvB = vNormalMapUv * 2.0;      //  8 m tile
        vec2 uvC = vNormalMapUv * 0.5;      // 32 m tile
        vec2 uvD = vNormalMapUv * 8.0;      //  2 m close-up detail
        vec2 uvM = vNormalMapUv * 0.125;    // 128 m macro
        vec4 sp  = vSplat;

        // which of the two anti-tiling samples shows, in ~40 m patches
        float tileW = 0.0;
        #ifdef ANTI_TILE
          tileW = smoothstep( 0.42, 0.62, texture2D( tMacro, uvM * 3.1 + 0.5 ).r );
        #endif

        vec3 terra =
            layer( tGrass, uvA, tileW ) * gGrass * sp.r +
            layer( tSand,  uvA, tileW ) * gSand  * sp.g +
            layer( tRock,  uvC, tileW ) * gRock  * sp.b +
            layer( tDirt,  uvA, tileW ) * gDirt  * sp.a;

        // a second, much finer layer that only shows up close, so the
        // ground keeps texture right under the wheels
        float near = 1.0 - smoothstep( 8.0, 46.0, length( vViewPosition ) );
        if ( near > 0.001 ) {
          vec3 fine =
              texture2D( tGrass, uvD ).rgb * gGrass * sp.r +
              texture2D( tSand,  uvD ).rgb * gSand  * sp.g +
              texture2D( tRock,  uvD ).rgb * gRock  * sp.b +
              texture2D( tDirt,  uvD ).rgb * gDirt  * sp.a;
          terra = mix( terra, terra * ( 0.45 + 1.15 * fine ), near * 0.55 );
        }

        float macro = texture2D( tMacro, uvM ).g;
        terra *= 0.76 + 0.48 * macro;

        // ambient occlusion baked from the terrain's own curvature
        terra *= mix( 1.0, vAO, 0.85 );

        // damp sand where the tide reaches
        float wetF = ( 1.0 - smoothstep( -0.4, 3.2, vWPos.y ) ) * sp.g;
        terra = mix( terra, terra * vec3( 0.46, 0.45, 0.48 ), wetF );

        // snow line on the high ridges
        float snow = smoothstep( 168.0, 262.0, vWPos.y ) * smoothstep( 0.52, 0.86, vNrmY );
        terra = mix( terra, vec3( 0.90, 0.94, 1.0 ), snow );

        diffuseColor.rgb *= terra;`)

      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = 1.0;
        roughnessFactor = mix( roughnessFactor, 0.84, sp.b );
        roughnessFactor = mix( roughnessFactor, 0.94, sp.a );
        roughnessFactor *= ( 1.0 - wetF * 0.55 );
        roughnessFactor = mix( roughnessFactor, 0.42, snow );`)

      .replace('#include <normal_fragment_maps>', `
        vec3 mapN = normalize(
            ( texture2D( nGrass, uvA ).xyz * 2.0 - 1.0 ) * sp.r +
            ( texture2D( nSand,  uvA ).xyz * 2.0 - 1.0 ) * sp.g +
            ( texture2D( nRock,  uvC ).xyz * 2.0 - 1.0 ) * sp.b +
            ( texture2D( nDirt,  uvA ).xyz * 2.0 - 1.0 ) * sp.a );
        // a finer normal layer up close, fading out before it can shimmer
        vec3 fineN = normalize(
            ( texture2D( nGrass, uvD ).xyz * 2.0 - 1.0 ) * sp.r +
            ( texture2D( nSand,  uvD ).xyz * 2.0 - 1.0 ) * sp.g +
            ( texture2D( nRock,  uvD ).xyz * 2.0 - 1.0 ) * sp.b +
            ( texture2D( nDirt,  uvD ).xyz * 2.0 - 1.0 ) * sp.a );
        mapN = normalize( mapN + fineN * near * 0.8 );
        float nFade = 1.0 - smoothstep( 70.0, 420.0, length( vViewPosition ) );
        mapN.xy *= normalScale * nFade;
        normal = normalize( tbn * mapN );`);
  };

  mat.customProgramCacheKey = () => 'duneRunnerTerrain';
  return mat;
}

/* ============================ CHUNK JOB ============================ */

class ChunkJob {
  constructor(terrain, cx, cz, N, ring) {
    this.t = terrain;
    this.cx = cx; this.cz = cz;
    this.N = N; this.ring = ring;
    this.key = cx + ',' + cz;
    this.E = N + 3;
    this.d = CHUNK / N;
    this.ox = cx * CHUNK - this.d;
    this.oz = cz * CHUNK - this.d;
    this.hs = new Float32Array(this.E * this.E);
    this.ds = new Float32Array(this.E * this.E);
    this.ts = new Float32Array(this.E * this.E);
    this.row = 0;
    this.phase = 0;
    this.minY = 1e9; this.maxY = -1e9;
  }

  step(deadline) {
    const { E, d, ox, oz, hs, ds, ts } = this;
    if (this.phase === 0) {
      const S = { h: 0, desert: 0, land: 0, trail: 0, base: 0 };
      while (this.row < E) {
        const wz = oz + this.row * d;
        const b = this.row * E;
        for (let c = 0; c < E; c++) {
          surface(ox + c * d, wz, this.N >= 48, S);
          hs[b + c] = S.h;
          ds[b + c] = S.desert;
          ts[b + c] = S.trail;
          if (S.h < this.minY) this.minY = S.h;
          if (S.h > this.maxY) this.maxY = S.h;
        }
        this.row++;
        if ((this.row & 3) === 0 && performance.now() > deadline) return false;
      }
      this.phase = 1;
      if (performance.now() > deadline) return false;
    }

    if (this.phase === 1) {
      this.geometry = this.buildGeometry();
      this.phase = 2;
      if (performance.now() > deadline) return false;
    }

    if (this.phase === 2) {
      this.finish();
      return true;
    }
    return false;
  }

  buildGeometry() {
    const { N, E, d, hs, ds, ts } = this;
    const gw = N + 1;
    const main = gw * gw;
    const border = gw * 4;
    const total = main + border;

    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const spl = new Float32Array(total * 4);
    const ao = new Float32Array(total);

    const S = { h: 0, desert: 0, land: 0, trail: 0, base: 0 };
    const sp = [0, 0, 0, 0];
    // AO reach scales with the cell size so it looks the same at every LOD
    const aoR = Math.max(1, Math.round(6 / d));
    const aoK = 0.16 / Math.max(1, d);

    for (let i = 0; i <= N; i++) {
      const r = i + 1;
      for (let j = 0; j <= N; j++) {
        const c = j + 1;
        const vi = i * gw + j;
        const h = hs[r * E + c];

        /* Cheap curvature AO: compare this vertex with the average of the
           ring around it. Sitting in a hollow darkens, sitting on a ridge
           brightens slightly. Reads as contact shadow in gullies. */
        let sum = 0, cnt = 0;
        for (let k = 1; k <= aoR; k++) {
          const rr = Math.min(E - 1, Math.max(0, r + k)), rl = Math.min(E - 1, Math.max(0, r - k));
          const cr = Math.min(E - 1, Math.max(0, c + k)), cl = Math.min(E - 1, Math.max(0, c - k));
          sum += hs[r * E + cr] + hs[r * E + cl] + hs[rr * E + c] + hs[rl * E + c];
          cnt += 4;
        }
        const conc = (sum / cnt - h) * aoK;
        ao[vi] = clamp(1 - clamp(conc, 0, 1) * 0.65 + clamp(-conc, 0, 1) * 0.10, 0.35, 1.06);

        const nx = hs[r * E + (c - 1)] - hs[r * E + (c + 1)];
        const nz = hs[(r - 1) * E + c] - hs[(r + 1) * E + c];
        const ny = 2 * d;
        const inv = 1 / Math.hypot(nx, ny, nz);

        pos[vi * 3] = j * d;
        pos[vi * 3 + 1] = h;
        pos[vi * 3 + 2] = i * d;
        nor[vi * 3] = nx * inv;
        nor[vi * 3 + 1] = ny * inv;
        nor[vi * 3 + 2] = nz * inv;
        uv[vi * 2] = (j * d) / TILE;
        uv[vi * 2 + 1] = (i * d) / TILE;

        S.h = h; S.desert = ds[r * E + c]; S.trail = ts[r * E + c];
        splat(S, ny * inv, sp);
        spl[vi * 4] = sp[0]; spl[vi * 4 + 1] = sp[1];
        spl[vi * 4 + 2] = sp[2]; spl[vi * 4 + 3] = sp[3];
      }
    }

    // ---- skirts: copy each border vertex straight down
    const copy = (src, dst) => {
      pos[dst * 3] = pos[src * 3];
      pos[dst * 3 + 1] = pos[src * 3 + 1] - SKIRT;
      pos[dst * 3 + 2] = pos[src * 3 + 2];
      nor[dst * 3] = nor[src * 3]; nor[dst * 3 + 1] = nor[src * 3 + 1]; nor[dst * 3 + 2] = nor[src * 3 + 2];
      uv[dst * 2] = uv[src * 2]; uv[dst * 2 + 1] = uv[src * 2 + 1];
      spl[dst * 4] = spl[src * 4]; spl[dst * 4 + 1] = spl[src * 4 + 1];
      spl[dst * 4 + 2] = spl[src * 4 + 2]; spl[dst * 4 + 3] = spl[src * 4 + 3];
      ao[dst] = ao[src];
    };
    const skTop = main, skBot = main + gw, skLeft = main + gw * 2, skRight = main + gw * 3;
    for (let j = 0; j <= N; j++) {
      copy(0 * gw + j, skTop + j);
      copy(N * gw + j, skBot + j);
    }
    for (let i = 0; i <= N; i++) {
      copy(i * gw + 0, skLeft + i);
      copy(i * gw + N, skRight + i);
    }

    // ---- indices
    const triCount = N * N * 2 + N * 16;           // grid + double-sided skirt quads
    const IndexArray = total >= 65536 ? Uint32Array : Uint16Array;
    const idx = new IndexArray(triCount * 3);
    let p = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const a = i * gw + j, b = a + 1, c2 = a + gw, dd = c2 + 1;
        idx[p++] = a; idx[p++] = c2; idx[p++] = b;
        idx[p++] = b; idx[p++] = c2; idx[p++] = dd;
      }
    }
    const strip = (base, offset, stride) => {
      for (let k = 0; k < N; k++) {
        const a = offset + k * stride, b = offset + (k + 1) * stride;
        const a2 = base + k, b2 = base + k + 1;
        idx[p++] = a; idx[p++] = a2; idx[p++] = b;
        idx[p++] = b; idx[p++] = a2; idx[p++] = b2;
        idx[p++] = a; idx[p++] = b; idx[p++] = a2;   // opposite winding
        idx[p++] = b; idx[p++] = b2; idx[p++] = a2;
      }
    };
    strip(skTop, 0, 1);
    strip(skBot, N * gw, 1);
    strip(skLeft, 0, gw);
    strip(skRight, N, gw);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aSplat', new THREE.BufferAttribute(spl, 4));
    g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(CHUNK / 2, (this.minY + this.maxY) / 2, CHUNK / 2),
      Math.hypot(CHUNK * 0.75, (this.maxY - this.minY) / 2 + SKIRT + 30)
    );
    return g;
  }

  /* bilinear height from this chunk's own sample grid (cheap, exact enough) */
  hAt(lx, lz) {
    const { N, E, d, hs } = this;
    const fx = clamp(lx / d, 0, N), fz = clamp(lz / d, 0, N);
    const j = Math.min(N - 1, Math.floor(fx)), i = Math.min(N - 1, Math.floor(fz));
    const tx = fx - j, tz = fz - i;
    const r = i + 1, c = j + 1;
    const h00 = hs[r * E + c], h10 = hs[r * E + c + 1];
    const h01 = hs[(r + 1) * E + c], h11 = hs[(r + 1) * E + c + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }
  fieldAt(arr, lx, lz) {
    const { N, E, d } = this;
    const j = Math.min(N, Math.max(0, Math.round(lx / d))) + 1;
    const i = Math.min(N, Math.max(0, Math.round(lz / d))) + 1;
    return arr[i * E + j];
  }

  finish() {
    const t = this.t;
    const mesh = new THREE.Mesh(this.geometry, t.material);
    mesh.name = `terrain[${this.cx},${this.cz}] ring${this.ring} N${this.N}`;
    mesh.position.set(this.cx * CHUNK, 0, this.cz * CHUNK);
    mesh.receiveShadow = true;
    mesh.castShadow = this.ring <= 1;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.frustumCulled = true;

    const group = new THREE.Group();
    group.name = `chunk[${this.cx},${this.cz}]`;
    group.matrixAutoUpdate = false;
    group.add(mesh);

    const old = t.chunks.get(this.key);
    if (old) t.disposeChunk(old);

    const rec = {
      cx: this.cx, cz: this.cz, N: this.N, ring: this.ring,
      mesh, group, hs: this.hs, E: this.E, d: this.d,
      props: []
    };

    if (this.ring <= t.q.treeRing) this.scatter(rec);

    t.scene.add(group);
    t.chunks.set(this.key, rec);
    this.ds = null; this.ts = null; this.geometry = null;
  }

  /* ---------------- vegetation ---------------- */
  scatter(rec) {
    const t = this.t;
    const lib = t.props;
    const density = this.ring <= 1 ? 1.0 : this.ring === 2 ? 0.62 : 0.34;
    const step = 19;
    const wx0 = this.cx * CHUNK, wz0 = this.cz * CHUNK;
    const g0 = Math.ceil(wx0 / step), g1 = Math.floor(((this.cx + 1) * CHUNK - 0.001) / step);
    const k0 = Math.ceil(wz0 / step), k1 = Math.floor(((this.cz + 1) * CHUNK - 0.001) / step);

    const buckets = { pine: [], birch: [], acacia: [], palm: [], cactus: [], bush: [], rock: [], wood: [] };
    const tints = { pine: [], birch: [], acacia: [], palm: [], cactus: [], bush: [], rock: [], wood: [] };
    const col = new THREE.Color();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const nrm = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();

    for (let gx = g0; gx <= g1; gx++) {
      for (let gz = k0; gz <= k1; gz++) {
        const r1 = hash2(gx, gz), r2 = hash2(gx + 8123, gz - 4211);
        const r3 = hash2(gx - 991, gz + 3307), r4 = hash2(gx + 55, gz + 77);
        if (r4 > density) continue;

        const wx = gx * step + (r1 - 0.5) * step * 0.9;
        const wz = gz * step + (r2 - 0.5) * step * 0.9;
        const lx = wx - wx0, lz = wz - wz0;
        const h = this.hAt(lx, lz);
        if (h < 0.9 || h > 330) continue;

        const trail = this.fieldAt(this.ts, lx, lz);
        const desert = this.fieldAt(this.ds, lx, lz);
        // no trees in the middle of a village — only a fringe of them
        const vi = villageAt(wx, wz);
        if (vi && vi.w > 0.12 && r3 > 0.10 * (1 - vi.w)) continue;

        // local slope from the height grid
        const e = 2.2;
        const hx = this.hAt(lx + e, lz) - this.hAt(lx - e, lz);
        const hz = this.hAt(lx, lz + e) - this.hAt(lx, lz - e);
        const slope = Math.hypot(hx, hz) / (2 * e);
        const flat = 1 / Math.sqrt(1 + slope * slope);

        let kind = null, scale = 1;
        const beach = h < 10.5;

        if (trail > 0.34) {
          if (r3 < 0.05 && flat > 0.9) { kind = 'rock'; scale = 0.28 + r1 * 0.3; }
        } else if (beach) {
          if (flat > 0.93 && r3 < 0.085 * (1 - desert * 0.4)) { kind = 'palm'; scale = 0.85 + r1 * 0.5; }
          else if (r3 < 0.115) { kind = 'wood'; scale = 0.7 + r1 * 0.6; }
          else if (r3 < 0.15) { kind = 'rock'; scale = 0.3 + r1 * 0.45; }
        } else if (desert > 0.55) {
          if (flat > 0.86 && r3 < 0.14) { kind = 'cactus'; scale = 0.8 + r1 * 0.7; }
          else if (r3 < 0.40) { kind = 'bush'; scale = 0.55 + r1 * 0.6; }
          else if (r3 < 0.47) { kind = 'acacia'; scale = 0.8 + r1 * 0.5; }
          else if (r3 < 0.54) { kind = 'rock'; scale = 0.35 + r1 * 0.7; }
        } else {
          const forest = 1 - desert;
          // mixed woodland: conifer on the higher, cooler ground,
          // broadleaf lower down and along the valleys
          const broadleaf = r2 < 0.30 && h < 150;
          if (flat > 0.72 && r3 < 0.62 * forest) {
            kind = broadleaf ? 'birch' : 'pine';
            scale = (broadleaf ? 0.8 : 0.72) + r1 * 0.75;
          }
          else if (r3 < 0.74) { kind = 'bush'; scale = 0.6 + r1 * 0.7; }
          else if (r3 < 0.81) { kind = 'acacia'; scale = 0.75 + r1 * 0.6; }
          else if (r3 < 0.93) { kind = 'rock'; scale = 0.24 + r1 * 0.95; }
        }
        if (!kind) continue;
        if (kind !== 'rock' && flat < 0.62) continue;

        pos.set(wx, h - 0.25 * scale, wz);
        // rocks and driftwood settle into the slope, plants stay upright
        if (kind === 'rock' || kind === 'wood') {
          nrm.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
          q.setFromUnitVectors(up, nrm);
          const yaw = new THREE.Quaternion().setFromAxisAngle(up, r2 * 6.283);
          q.multiply(yaw);
        } else {
          q.setFromAxisAngle(up, r2 * 6.283);
        }
        scl.set(scale * (0.9 + r3 * 0.22), scale * (0.88 + r1 * 0.3), scale * (0.9 + r3 * 0.22));
        m.compose(pos, q, scl);
        buckets[kind].push(m.clone());

        // per-instance tint: no two trees exactly alike, and foliage
        // dries out towards the desert
        const dry = clamp(desert * 0.9, 0, 1);
        const v = 0.84 + r2 * 0.34;
        if (kind === 'rock' || kind === 'wood') {
          const g = 0.86 + r1 * 0.34;
          col.setRGB(g * (1 + dry * 0.12), g, g * (1 - dry * 0.06));
        } else {
          col.setRGB(
            (0.82 + dry * 0.42 + r1 * 0.14) * v,
            (1.02 - dry * 0.16 + r3 * 0.10) * v,
            (0.78 - dry * 0.10 + r1 * 0.08) * v
          );
        }
        tints[kind].push(col.getHex());
      }
    }

    for (const kind in buckets) {
      const list = buckets[kind];
      if (!list.length) continue;
      const variants = lib[kind];
      const geo = variants[(Math.abs(this.cx * 31 + this.cz * 17)) % variants.length];
      const material = lib.staticFamilies.has(kind) ? lib.mat : lib.foliageMat;
      const im = new THREE.InstancedMesh(geo, material, list.length);
      for (let i = 0; i < list.length; i++) {
        im.setMatrixAt(i, list[i]);
        col.setHex(tints[kind][i]);
        im.setColorAt(i, col);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = this.ring <= t.q.shadowRing;
      im.receiveShadow = true;
      im.frustumCulled = true;
      im.matrixAutoUpdate = false;
      im.updateMatrix();
      im.computeBoundingSphere();   // instance matrices are already in world space
      rec.group.add(im);
      rec.props.push(im);
    }
  }
}

/* ============================== TERRAIN ============================== */

export class Terrain {
  constructor(scene, textures, quality, props) {
    this.scene = scene;
    this.q = quality;
    this.props = props;
    this.material = makeTerrainMaterial(textures);
    this.chunks = new Map();
    this.jobs = [];
    this.active = null;
    this.center = { cx: 1e9, cz: 1e9 };
  }

  resForRing(ring) {
    const base = this.q.nearRes;
    if (ring <= 1) return base;
    if (ring === 2) return Math.max(16, base >> 1);
    if (ring === 3) return Math.max(16, base >> 2);
    return Math.max(8, base >> 3);
  }

  update(x, z, budgetMs = 7) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    if (cx !== this.center.cx || cz !== this.center.cz) {
      this.center.cx = cx; this.center.cz = cz;
      this.replan(cx, cz);
    }
    const deadline = performance.now() + budgetMs;
    while (performance.now() < deadline) {
      if (!this.active) {
        if (!this.jobs.length) break;
        this.active = this.jobs.shift();
      }
      if (this.active.step(deadline)) this.active = null;
      else break;
    }
    return this.jobs.length + (this.active ? 1 : 0);
  }

  /* Decide what to build after the player crosses into a new chunk.

     This scheduler is what caused the flashing black squares. Two faults,
     and they compounded:

     1. A chunk was rebuilt whenever its *ring* changed. Crossing one
        boundary shifts every chunk's ring, so all 169 chunks (Ultra) were
        re-queued — even though rings 4, 5 and 6 all resolve to the same
        mesh resolution, so 120 of those rebuilds produced a byte-identical
        chunk. Ring only really matters for shadow casting and whether the
        chunk gets vegetation; both can be changed in place.

     2. The queue was sorted purely by distance, so those pointless nearby
        rebuilds ran *before* the genuinely missing chunks at the frontier —
        which are by definition the farthest away. Flying fast, the player
        crossed the next boundary before the frontier was reached, the queue
        was rebuilt, and the missing chunks were sent to the back again. They
        could stay unbuilt indefinitely.

     A chunk that does not exist is a hole, and looking down through a hole
     from the air you see the underside of the sky dome, which is black.
     Hence: a black square, exactly one chunk across, flashing in and out as
     the streamer won and lost the race. Missing chunks now always outrank
     refinements. */
  replan(cx, cz) {
    const R = this.q.viewRadius;
    const want = new Set();
    const todo = [];
    for (let i = -R; i <= R; i++) {
      for (let j = -R; j <= R; j++) {
        const ring = Math.max(Math.abs(i), Math.abs(j));
        const kx = cx + i, kz = cz + j;
        const key = kx + ',' + kz;
        want.add(key);
        const N = this.resForRing(ring);
        const cur = this.chunks.get(key);
        const d = i * i + j * j;

        if (!cur) {
          todo.push({ kx, kz, N, ring, d, missing: true });
        } else if (cur.N !== N || (ring <= this.q.treeRing && cur.ring > this.q.treeRing)) {
          // real change: different mesh resolution, or it needs vegetation now
          todo.push({ kx, kz, N, ring, d, missing: false });
        } else {
          // same geometry either way — just relabel it
          cur.ring = ring;
          cur.mesh.castShadow = ring <= 1;
        }
      }
    }
    // drop anything that fell out of range
    for (const [key, rec] of this.chunks) {
      if (!want.has(key)) { this.disposeChunk(rec); this.chunks.delete(key); }
    }
    // holes first, then nearest — never leave a gap to polish a neighbour
    todo.sort((a, b) => (a.missing === b.missing) ? a.d - b.d : (a.missing ? -1 : 1));
    this.jobs = todo.map(o => new ChunkJob(this, o.kx, o.kz, o.N, o.ring));
    if (this.active && !want.has(this.active.key)) this.active = null;
  }

  /** How many of the chunks we want are not on screen yet. */
  missingCount() {
    const R = this.q.viewRadius, c = this.center;
    if (c.cx > 1e8) return 0;
    let n = 0;
    for (let i = -R; i <= R; i++)
      for (let j = -R; j <= R; j++)
        if (!this.chunks.has((c.cx + i) + ',' + (c.cz + j))) n++;
    return n;
  }

  disposeChunk(rec) {
    this.scene.remove(rec.group);
    rec.mesh.geometry.dispose();
    for (const p of rec.props) p.dispose();   // shared geometry/material stay alive
    rec.props.length = 0;
    rec.group.clear();
    rec.hs = null;
  }

  /** Cheap height lookup from cached chunk grids — used by the grass field. */
  gridHeight(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const rec = this.chunks.get(cx + ',' + cz);
    if (!rec || !rec.hs) return null;
    const { E, d, hs } = rec;
    const N = rec.N;
    const fx = clamp((x - cx * CHUNK) / d, 0, N), fz = clamp((z - cz * CHUNK) / d, 0, N);
    const j = Math.min(N - 1, Math.floor(fx)), i = Math.min(N - 1, Math.floor(fz));
    const tx = fx - j, tz = fz - i;
    const r = i + 1, c = j + 1;
    const h00 = hs[r * E + c], h10 = hs[r * E + c + 1];
    const h01 = hs[(r + 1) * E + c], h11 = hs[(r + 1) * E + c + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }
}

/* ====================== SHARED HEIGHT FIELD ======================
   A coarse height texture around the player. The ocean shader uses it
   for depth colouring and shoreline foam; the minimap draws from the
   same numbers, so both always agree with the terrain.
================================================================= */

export class HeightField {
  constructor(res = 128, span = 6144) {
    this.res = res;
    this.span = span;
    this.data = new Float32Array(res * res);
    this.pending = new Float32Array(res * res);
    this.center = new THREE.Vector2(1e9, 1e9);
    this.pendingCenter = new THREE.Vector2(0, 0);
    this.row = res;                       // res = idle
    this.biome = new Float32Array(res * res);
    this.pendingBiome = new Float32Array(res * res);

    const tex = new THREE.DataTexture(
      new Uint8Array(res * res * 4), res, res, THREE.RGBAFormat, THREE.UnsignedByteType
    );
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.texture = tex;
    this.bytes = tex.image.data;
    /* R holds a high-precision band around sea level (±64 m, 0.5 m steps)
       which is all the ocean shader needs for depth and foam; the CPU-side
       Float32 array keeps full precision for the minimap. */
    this.BAND = 64;
  }

  update(x, z, budgetMs = 1.6) {
    const half = this.span * 0.5;
    if (this.row >= this.res) {
      const dx = Math.abs(x - this.center.x), dz = Math.abs(z - this.center.y);
      if (dx > this.span * 0.12 || dz > this.span * 0.12) {
        this.pendingCenter.set(x, z);
        this.row = 0;
      } else return;
    }

    const deadline = performance.now() + budgetMs;
    const R = this.res;
    const step = this.span / (R - 1);
    const ox = this.pendingCenter.x - half, oz = this.pendingCenter.y - half;
    const S = { h: 0, desert: 0, land: 0, trail: 0, base: 0 };

    while (this.row < R) {
      const wz = oz + this.row * step;
      const b = this.row * R;
      for (let c = 0; c < R; c++) {
        surface(ox + c * step, wz, false, S);
        this.pending[b + c] = S.h;
        this.pendingBiome[b + c] = S.desert;
      }
      this.row++;
      if ((this.row & 7) === 0 && performance.now() > deadline) return;
    }

    // commit
    this.data.set(this.pending);
    this.biome.set(this.pendingBiome);
    this.center.copy(this.pendingCenter);
    const B = this.BAND;
    for (let i = 0; i < R * R; i++) {
      const h = this.data[i];
      this.bytes[i * 4]     = clamp((h + B) / (2 * B), 0, 1) * 255;   // shore band
      this.bytes[i * 4 + 1] = clamp(this.biome[i], 0, 1) * 255;       // desert-ness
      this.bytes[i * 4 + 2] = clamp(h / 340, 0, 1) * 255;             // coarse altitude
      this.bytes[i * 4 + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }

  /** World position → 0..1 texture coordinate inside the field. */
  uvFor(x, z, out = { u: 0, v: 0 }) {
    out.u = (x - this.center.x) / this.span + 0.5;
    out.v = (z - this.center.y) / this.span + 0.5;
    return out;
  }

  heightAtUV(u, v) {
    const R = this.res;
    const x = clamp(u * (R - 1), 0, R - 1), y = clamp(v * (R - 1), 0, R - 1);
    const i = Math.floor(x), j = Math.floor(y);
    return this.data[j * R + i];
  }
}

export { SEA_LEVEL, smoothstep };
