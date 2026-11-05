/* ------------------------------------------------------------------
   world.js — the single source of truth for the terrain surface.

   Everything (mesh building, vehicle physics, water depth, minimap,
   vegetation scattering) samples these functions, so what you see is
   exactly what you drive on. The world is unbounded: it is defined by
   pure noise functions of (x, z), so you can roam forever in any
   direction and it keeps generating.
------------------------------------------------------------------ */

import { fbm, ridged, noise2, smoothstep, clamp, lerp, hash2 } from './noise.js';

export const SEA_LEVEL = 0;

/* --- master shape ------------------------------------------------- */
const CONT_SCALE   = 0.00021;   // continents / oceans
const BIOME_SCALE  = 0.00033;   // desert <-> forest selector
const HILL_SCALE   = 0.00125;   // forested ridges
const MID_SCALE    = 0.0048;    // rolling bumps
const FINE_SCALE   = 0.028;     // wheel-scale chatter

const TRAIL_SPACING_A = 760;
const TRAIL_SPACING_B = 1180;
const TRAIL_SPACING_C = 1900;

/* Reusable output object so hot loops never allocate. */
export const S = {
  h: 0,        // terrain height (metres, sea level = 0)
  desert: 0,   // 0..1 desert-ness
  land: 0,     // 0..1 inland-ness (0 at the shoreline)
  trail: 0,    // 0..1 on an off-road track
  base: 0      // large-scale elevation without micro detail
};

/* --- dune field ---------------------------------------------------- */
function duneAt(x, z) {
  // domain warp so the dune ridges snake instead of running dead straight
  const wx = fbm(x * 0.00062, z * 0.00062, 3) * 300;
  const wz = fbm(x * 0.00062 + 400.5, z * 0.00062 - 220.5, 3) * 300;
  const px = x + wx, pz = z + wz;

  // primary linear dunes, ~25 degrees
  let s = Math.sin((px * 0.9063 + pz * 0.4226) * 0.0128);
  s = Math.sign(s) * Math.pow(Math.abs(s), 0.6);
  let h = (s * 0.5 + 0.5) * 40;

  // slip-face asymmetry: steeper on the lee side
  h += Math.max(0, s) * 7;

  // secondary cross dunes
  h += (Math.sin((px * -0.342 + pz * 0.9397) * 0.0041) * 0.5 + 0.5) * 13;

  // ripples
  h += fbm(x * 0.02, z * 0.02, 2) * 0.9;
  return h;
}

/* --- off-road trail network ---------------------------------------- */
/** Signed distance to the nearest trail centreline (in the warped space the
    network is laid out in). The sign says which side of the road a point is
    on; the renderer uses it to lay the road surface, ruts and verges out
    across the road, and its gradient to find the road's direction. */
export function trailSigned(x, z) {
  const wx = x + fbm(x * 0.00037 + 11.3, z * 0.00088, 3) * 340;
  const wz = z + fbm(x * 0.00088 - 31.7, z * 0.00037 + 7.1, 3) * 340;
  const m = (v, sp) => { const r = v % sp; return r < 0 ? r + sp : r; };
  const s1 = m(wx, TRAIL_SPACING_A) - TRAIL_SPACING_A * 0.5;
  const s2 = m(wz, TRAIL_SPACING_B) - TRAIL_SPACING_B * 0.5;
  const s3 = m(wx * 0.7071 + wz * 0.7071, TRAIL_SPACING_C) - TRAIL_SPACING_C * 0.5;
  const s4 = m(wx * 0.7071 - wz * 0.7071, TRAIL_SPACING_C) - TRAIL_SPACING_C * 0.5;
  let best = s1;
  if (Math.abs(s2) < Math.abs(best)) best = s2;
  if (Math.abs(s3) < Math.abs(best)) best = s3;
  if (Math.abs(s4) < Math.abs(best)) best = s4;
  return best;
}

function trailDistance(x, z) {
  const wx = x + fbm(x * 0.00037 + 11.3, z * 0.00088, 3) * 340;
  const wz = z + fbm(x * 0.00088 - 31.7, z * 0.00037 + 7.1, 3) * 340;

  const m = (v, sp) => { const r = v % sp; return r < 0 ? r + sp : r; };

  const d1 = Math.abs(m(wx, TRAIL_SPACING_A) - TRAIL_SPACING_A * 0.5);
  const d2 = Math.abs(m(wz, TRAIL_SPACING_B) - TRAIL_SPACING_B * 0.5);
  const dg = (wx * 0.7071 + wz * 0.7071);
  const d3 = Math.abs(m(dg, TRAIL_SPACING_C) - TRAIL_SPACING_C * 0.5);
  const dg2 = (wx * 0.7071 - wz * 0.7071);
  const d4 = Math.abs(m(dg2, TRAIL_SPACING_C) - TRAIL_SPACING_C * 0.5);

  return Math.min(d1, d2, d3, d4);
}

/* --- alpine villages ------------------------------------------------
   Settlements sit on a coarse lattice. Each candidate cell either has a
   village or it does not, and if it does the centre is nudged towards the
   nearest off-road track so the place is actually reachable. The terrain
   is levelled off inside the village so the chalets stand on flat ground —
   done here, in the one function everything samples, so the mesh, the
   physics and the minimap all agree.
------------------------------------------------------------------- */
const VILLAGE_CELL = 1900;
const VILLAGE_MAX_R = 190;
const villageCache = new Map();

/** Elevation without the village term — used to pick the platform height
    without the definition becoming circular. */
function rawElevation(x, z) {
  const cont = fbm(x * CONT_SCALE, z * CONT_SCALE, 5);
  const e = cont + 0.10;
  let base = e < 0 ? e * 285 : Math.pow(e, 1.3) * 335;
  const land = smoothstep(0.5, 32, base);
  let desert = 0;
  if (land > 0.001) {
    const bsel = fbm(x * BIOME_SCALE + 311.7, z * BIOME_SCALE - 207.4, 3);
    desert = smoothstep(-0.06, 0.30, bsel);
    let add = 0;
    if (desert < 0.995) add += ridged(x * HILL_SCALE, z * HILL_SCALE, 5) * 78 * (1 - desert);
    if (desert > 0.005) add += duneAt(x, z) * desert;
    base += add * land;
  }
  base += fbm(x * MID_SCALE, z * MID_SCALE, 3) * 6.5 * (0.3 + 0.7 * land);
  return { h: base, desert, land };
}

/** Village record for a lattice cell, or null. Cached — this is the hot path. */
function villageCell(ix, iz) {
  const key = ix * 131071 + iz;
  let v = villageCache.get(key);
  if (v !== undefined) return v;

  v = null;
  if (hash2(ix * 7919 + 13, iz * 104729 + 7) < 0.55) {
    // try a few spots inside the cell, prefer the one nearest a track
    let best = null;
    for (let k = 0; k < 6; k++) {
      const jx = hash2(ix * 31 + k, iz * 17 - k);
      const jz = hash2(ix * 53 - k, iz * 71 + k);
      const cx = (ix + 0.2 + jx * 0.6) * VILLAGE_CELL;
      const cz = (iz + 0.2 + jz * 0.6) * VILLAGE_CELL;
      const s = rawElevation(cx, cz);
      if (s.h < 26 || s.h > 175 || s.desert > 0.4) continue;
      // reject steep ground: a village needs a shelf, not a cliff
      const e = 26;
      const dx = rawElevation(cx + e, cz).h - rawElevation(cx - e, cz).h;
      const dz = rawElevation(cx, cz + e).h - rawElevation(cx, cz - e).h;
      const slope = Math.hypot(dx, dz) / (2 * e);
      if (slope > 0.22) continue;
      const td = trailDistance(cx, cz);
      const score = td * 0.02 + slope * 40;
      if (!best || score < best.score) {
        best = { cx, cz, y: s.h, score, slope };
      }
    }
    if (best) {
      const r = 96 + hash2(ix + 909, iz - 404) * 70;      // 96 .. 166 m
      v = { cx: best.cx, cz: best.cz, y: best.y, r, seed: (ix * 73856093) ^ (iz * 19349663) };
    }
  }
  villageCache.set(key, v);
  return v;
}

/** Strongest village influence at a point: 0 outside, 1 on the level core. */
export function villageAt(x, z) {
  const ix0 = Math.floor(x / VILLAGE_CELL);
  const iz0 = Math.floor(z / VILLAGE_CELL);
  let bestW = 0, bestV = null;
  // a village can only reach VILLAGE_MAX_R past its own cell edge
  const lx = x - ix0 * VILLAGE_CELL, lz = z - iz0 * VILLAGE_CELL;
  const i0 = lx < VILLAGE_MAX_R ? -1 : 0, i1 = lx > VILLAGE_CELL - VILLAGE_MAX_R ? 1 : 0;
  const j0 = lz < VILLAGE_MAX_R ? -1 : 0, j1 = lz > VILLAGE_CELL - VILLAGE_MAX_R ? 1 : 0;

  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const v = villageCell(ix0 + i, iz0 + j);
      if (!v) continue;
      const d = Math.hypot(x - v.cx, z - v.cz);
      if (d > v.r) continue;
      // flat core, then a graded apron out to the edge
      const w = 1 - smoothstep(v.r * 0.42, v.r, d);
      if (w > bestW) { bestW = w; bestV = v; }
    }
  }
  return bestW > 0 ? { w: bestW, v: bestV } : null;
}

/** Every village whose centre lies within `range` of a point. */
export function villagesNear(x, z, range) {
  const out = [];
  const r = Math.ceil((range + VILLAGE_MAX_R) / VILLAGE_CELL);
  const ix0 = Math.floor(x / VILLAGE_CELL), iz0 = Math.floor(z / VILLAGE_CELL);
  for (let i = -r; i <= r; i++) {
    for (let j = -r; j <= r; j++) {
      const v = villageCell(ix0 + i, iz0 + j);
      if (v && Math.hypot(x - v.cx, z - v.cz) <= range) out.push(v);
    }
  }
  return out;
}

/* --- main sampler --------------------------------------------------
   detail = true  → full micro detail (near mesh + physics)
   detail = false → coarse (far LOD, minimap, water heightmap)
------------------------------------------------------------------- */
export function surface(x, z, detail = true, out = S) {
  const cont = fbm(x * CONT_SCALE, z * CONT_SCALE, 5);
  const e = cont + 0.10;
  let base = e < 0 ? e * 285 : Math.pow(e, 1.3) * 335;

  const land = smoothstep(0.5, 32, base);

  let elev = base;
  let big = base;

  if (land > 0.001) {
    const bsel = fbm(x * BIOME_SCALE + 311.7, z * BIOME_SCALE - 207.4, 3);
    const desert = smoothstep(-0.06, 0.30, bsel);
    out.desert = desert;

    let add = 0, addBig = 0;
    if (desert < 0.995) {
      const hills = ridged(x * HILL_SCALE, z * HILL_SCALE, 5) * 78 * (1 - desert);
      add += hills; addBig += hills;
    }
    if (desert > 0.005) {
      const d = duneAt(x, z) * desert;
      add += d; addBig += d * 0.5;      // graded tracks cut the dune crests down
    }
    elev += add * land;
    big += addBig * land;
  } else {
    out.desert = 0;
  }

  const mid = fbm(x * MID_SCALE, z * MID_SCALE, 3) * 6.5;
  elev += mid * (0.3 + 0.7 * land);

  if (detail) {
    elev += fbm(x * FINE_SCALE, z * FINE_SCALE, 2) * 0.85 * (0.25 + 0.75 * land);
  }

  // carve the trail network into the surface
  let trail = 0;
  out.trailD = 1e3;
  if (land > 0.02 && base > 1.5) {
    const d = trailDistance(x, z);
    out.trailD = d;
    trail = smoothstep(17, 5.5, d) * land * smoothstep(1.5, 9, base);
    if (trail > 0.001) elev = lerp(elev, big, trail * 0.88);
  }

  // level the ground off under a village so the chalets stand square
  out.village = 0;
  if (land > 0.05) {
    const vi = villageAt(x, z);
    if (vi) {
      elev = lerp(elev, vi.v.y, vi.w);
      out.village = vi.w;
      out.villageRef = vi.v;
    }
  }

  out.h = elev;
  out.land = land;
  out.trail = trail;
  out.base = base;
  return out;
}

/** Height only — the hot path used by vehicle physics. */
export function heightAt(x, z) {
  return surface(x, z, true, _tmp).h;
}
const _tmp = { h: 0, desert: 0, land: 0, trail: 0, base: 0 };

/** Surface normal via central differences. */
export function normalAt(x, z, eps = 1.1, out = { x: 0, y: 1, z: 0 }) {
  const hl = heightAt(x - eps, z);
  const hr = heightAt(x + eps, z);
  const hd = heightAt(x, z - eps);
  const hu = heightAt(x, z + eps);
  let nx = hl - hr, ny = 2 * eps, nz = hd - hu;
  const inv = 1 / Math.hypot(nx, ny, nz);
  out.x = nx * inv; out.y = ny * inv; out.z = nz * inv;
  return out;
}

/* --- surface material classification -------------------------------
   Returns the four splat weights used by the terrain shader:
   r = grass/forest floor, g = sand, b = rock, a = packed dirt track.
------------------------------------------------------------------- */
export function splat(s, slopeY, out = [0, 0, 0, 0]) {
  const h = s.h;
  const slope = 1 - slopeY;                       // 0 flat .. 1 vertical
  const rock = smoothstep(0.30, 0.62, slope);

  // beach band hugging every shoreline
  const beach = h < 0 ? 1 : smoothstep(9.0, 1.0, h);
  const sand = clamp(Math.max(beach, s.desert * (1 - rock * 0.7)), 0, 1);
  const grass = clamp((1 - s.desert) * (1 - rock) * (1 - beach), 0, 1);
  /* The flattened trail corridor is ~11 m wide, but a real dirt road is
     about 6 m: the surface is drawn only within ~3 m of the centreline and
     the rest of the corridor is verge (grass or sand). Capped just under 1
     so every vertex keeps a trace of what the ground would be without the
     road, which the shader needs when it ruffles the road's edge. */
  const narrow = s.trailD === undefined ? 1 : smoothstep(5.2, 3.0, s.trailD);
  const dirt = clamp(s.trail * narrow * (1 - rock * 0.5), 0, 0.97);

  let r = grass * (1 - dirt);
  let g = sand * (1 - dirt * 0.85);
  let b = rock;
  let a = dirt;

  const sum = r + g + b + a || 1;
  out[0] = r / sum; out[1] = g / sum; out[2] = b / sum; out[3] = a / sum;
  return out;
}

/* --- naming for the HUD -------------------------------------------- */
export function biomeName(x, z) {
  const s = surface(x, z, false, _tmp2);
  if (s.h < -2) return 'Open Sea';
  if (s.h < 7) return 'Beach';
  if (s.desert > 0.6) return s.h > 120 ? 'High Dunes' : 'Desert Dunes';
  if (s.h > 210) return 'Ridgeline';
  if (s.trail > 0.3) return 'Off-Road Trail';
  return s.desert > 0.35 ? 'Scrubland' : 'Pine Forest';
}
const _tmp2 = { h: 0, desert: 0, land: 0, trail: 0, base: 0 };

/* --- scatter helpers ------------------------------------------------ */
/** Deterministic per-point jitter used to place trees, rocks, grass. */
export function scatterRandom(ix, iz, salt) {
  return hash2(ix * 73856093 + salt * 19349663, iz * 83492791 + salt * 2971215073);
}

/** Start the player on the outskirts of a village so there is somewhere to
    go from the first second. Falls back to open ground if none is near. */
export function findSpawnNearVillage(startX = 0, startZ = 0) {
  const vs = villagesNear(startX, startZ, 9000);
  if (vs.length) {
    vs.sort((a, b) => Math.hypot(a.cx - startX, a.cz - startZ) - Math.hypot(b.cx - startX, b.cz - startZ));
    const v = vs[0];
    // just outside the built-up edge, on the flattest side we can find
    let best = null;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const d = v.r * 1.12;
      const x = v.cx + Math.cos(a) * d, z = v.cz + Math.sin(a) * d;
      const n = normalAt(x, z, 3.0);
      if (n.y > 0.985) {
        const s = surface(x, z, true, _tmp3);
        if (s.h > 5) { best = { x, z, h: s.h, village: v }; break; }
      }
    }
    if (best) return best;
    return { x: v.cx + v.r * 0.8, z: v.cz, h: v.y, village: v };
  }
  return findSpawn(startX, startZ);
}
const _tmp3 = { h: 0, desert: 0, land: 0, trail: 0, base: 0 };

/** Find a decent spawn spot: dry land near the coast, gentle slope. */
export function findSpawn(startX = 0, startZ = 0) {
  const s = { h: 0, desert: 0, land: 0, trail: 0, base: 0 };
  let best = null;
  for (let r = 0; r < 4000; r += 60) {
    for (let a = 0; a < 12; a++) {
      const ang = a * 0.5236 + r * 0.017;
      const x = startX + Math.cos(ang) * r;
      const z = startZ + Math.sin(ang) * r;
      surface(x, z, true, s);
      if (s.h > 6 && s.h < 34) {
        const n = normalAt(x, z, 3.0);
        if (n.y > 0.992) {
          const score = Math.abs(s.h - 16) + r * 0.004 - s.trail * 12;
          if (!best || score < best.score) best = { x, z, h: s.h, score };
        }
      }
    }
    if (best && r > 700) break;
  }
  return best || { x: startX, z: startZ, h: Math.max(6, heightAt(startX, startZ)) };
}

export { noise2, fbm, smoothstep, clamp, lerp };
