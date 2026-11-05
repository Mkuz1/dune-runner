/* ------------------------------------------------------------------
   diag.js — artifact hunter. Off unless you add ?diag=1 to the URL.

   Why this exists: a black square flashes past while flying, and it does
   not reproduce on my machine. Rather than keep guessing at causes, this
   watches the real frame on the real device, and when it sees a solid
   dark rectangle it fires a ray through the middle of it and reports
   *which object* is being drawn there — by name, material and distance.

   How it works each frame:
     1. Draw the WebGL canvas into a small 2D canvas (cheap, ~90×60).
     2. Flood-fill the dark pixels into connected blobs.
     3. A blob that is large and fills most of its bounding box is a
        suspect — natural shadow is ragged, an artifact is a solid slab.
     4. Raycast through the blob centre and up to four inner points, and
        record what each ray hits.

   The overlay shows the last few catches. `game.diag.dump()` in the
   console prints the whole log as JSON.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';

const W = 90, H = 60;          // probe resolution — keep small, it is read back
/* Thresholds are deliberately generous. The artifact only appears on real
   hardware, so this has one job: never miss it. False positives are cheap —
   they show up in the panel and are obviously benign — whereas a miss means
   another round trip. "Black" therefore means "much darker than anything
   this scene normally produces", not literally zero. */
const DARK = 48;               // luminance below this counts as "black"
const MIN_AREA = 14;           // in probe pixels, ~0.25% of frame
const MIN_FILL = 0.50;         // blob area / bounding-box area

export class Diag {
  constructor(game) {
    this.game = game;
    this.hits = [];
    this.frames = 0;
    this.enabled = true;

    this.cv = document.createElement('canvas');
    this.cv.width = W; this.cv.height = H;
    this.ctx = this.cv.getContext('2d', { willReadFrequently: true });

    this.ray = new THREE.Raycaster();
    this.ray.far = 20000;

    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;left:8px;top:8px;z-index:99;max-width:min(560px,92vw);' +
      'font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;color:#b9f6c4;' +
      'background:rgba(6,10,14,.92);border:1px solid rgba(120,255,170,.35);' +
      'border-radius:8px;padding:9px 11px;white-space:pre-wrap;pointer-events:none';
    this.el.textContent = 'DIAG armed — fly around. Nothing caught yet.';
    document.body.appendChild(this.el);

    this.seen = new Uint8Array(W * H);
    this.dark = new Uint8Array(W * H);
    this.stack = new Int32Array(W * H);
  }

  /** Name an object usefully: explicit name, else class + material + geometry. */
  describe(o) {
    if (!o) return 'nothing (ray hit empty space)';
    const bits = [];
    if (o.name) bits.push(`"${o.name}"`);
    bits.push(o.type);
    if (o.isInstancedMesh) bits.push(`instances=${o.count}`);
    if (o.geometry) {
      bits.push(o.geometry.type);
      const n = o.geometry.attributes?.position?.count;
      if (n) bits.push(`verts=${n}`);
    }
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m) {
      bits.push(m.type);
      if (m.name) bits.push(`mat="${m.name}"`);
      if (m.transparent) bits.push('transparent');
      if (m.depthWrite === false) bits.push('noDepthWrite');
      if (m.color) bits.push('#' + m.color.getHexString());
      if (m.map === null && 'map' in m) bits.push('map=NULL');
    }
    // walk up for context (which subsystem owns it)
    let p = o.parent, chain = [];
    while (p && chain.length < 3) { chain.push(p.name || p.type); p = p.parent; }
    if (chain.length) bits.push('under ' + chain.join('<'));
    return bits.join(' · ');
  }

  probe(nx, ny, cam) {
    this.ray.setFromCamera({ x: nx, y: ny }, cam);
    const hit = this.ray.intersectObjects(this.game.scene.children, true)
      .find(h => h.object.visible && h.object.type !== 'Points');
    return hit
      ? { what: this.describe(hit.object), dist: Math.round(hit.distance) }
      : { what: 'nothing (ray hit empty space)', dist: -1 };
  }

  update() {
    if (!this.enabled) return;
    const g = this.game;
    const src = g.renderer.domElement;
    this.frames++;

    try { this.ctx.drawImage(src, 0, 0, W, H); }
    catch (_) { return; }

    let d;
    try { d = this.ctx.getImageData(0, 0, W, H).data; }
    catch (_) { this.enabled = false; return; }

    const dark = this.dark, seen = this.seen, st = this.stack;
    let n = 0;
    for (let i = 0; i < W * H; i++) {
      const l = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
      dark[i] = l < DARK ? 1 : 0;
      seen[i] = 0;
      if (dark[i]) n++;
    }
    if (n < MIN_AREA) return;

    let best = null;
    for (let s = 0; s < W * H; s++) {
      if (!dark[s] || seen[s]) continue;
      let sp = 0, area = 0;
      st[sp++] = s; seen[s] = 1;
      let x0 = W, x1 = 0, y0 = H, y1 = 0, sx = 0, sy = 0;
      while (sp) {
        const q = st[--sp];
        const x = q % W, y = (q / W) | 0;
        area++; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0     && dark[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; st[sp++] = q - 1; }
        if (x < W - 1 && dark[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; st[sp++] = q + 1; }
        if (y > 0     && dark[q - W] && !seen[q - W]) { seen[q - W] = 1; st[sp++] = q - W; }
        if (y < H - 1 && dark[q + W] && !seen[q + W]) { seen[q + W] = 1; st[sp++] = q + W; }
      }
      if (area < MIN_AREA) continue;
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      const fill = area / (bw * bh);
      if (fill < MIN_FILL) continue;                       // ragged = real shadow
      if (!best || area > best.area) {
        best = { area, fill, x0, y0, x1, y1, cx: sx / area, cy: sy / area, bw, bh };
      }
    }
    if (!best) return;
    if (!this.worst || best.area > this.worst.area) this.worst = best;

    // sample the blob centre and four points well inside it
    const cam = g.camera;
    const pts = [[best.cx, best.cy],
                 [best.x0 + best.bw * 0.3, best.y0 + best.bh * 0.3],
                 [best.x1 - best.bw * 0.3, best.y0 + best.bh * 0.3],
                 [best.x0 + best.bw * 0.3, best.y1 - best.bh * 0.3],
                 [best.x1 - best.bw * 0.3, best.y1 - best.bh * 0.3]];
    const seenWhat = new Map();
    for (const [px, py] of pts) {
      const r = this.probe((px / W) * 2 - 1, -((py / H) * 2 - 1), cam);
      const k = r.what;
      const e = seenWhat.get(k) || { what: k, n: 0, dist: r.dist };
      e.n++; seenWhat.set(k, e);
    }

    const rec = {
      frame: this.frames,
      pctOfScreen: +(100 * best.area / (W * H)).toFixed(1),
      fill: +best.fill.toFixed(2),
      aspect: +(best.bw / best.bh).toFixed(2),
      box: `x${best.x0}-${best.x1} y${best.y0}-${best.y1} of ${W}x${H}`,
      alt: Math.round(g.phys.pos.y - g.phys.groundY),
      flying: g.phys.flying, boosting: !!g.phys.boosting,
      timeOfDay: +g.env.timeOfDay.toFixed(2),
      missingChunks: g.terrain.missingCount ? g.terrain.missingCount() : -1,
      renderScale: +g.renderer.getPixelRatio().toFixed(2),
      hitting: [...seenWhat.values()].sort((a, b) => b.n - a.n)
    };
    this.hits.push(rec);
    if (this.hits.length > 60) this.hits.shift();

    const last = this.hits.slice(-3).reverse().map(h =>
      `#${h.frame}  ${h.pctOfScreen}% of screen  fill ${h.fill}  aspect ${h.aspect}\n` +
      `   alt ${h.alt}m  ${h.flying ? 'FLYING' : 'ground'}${h.boosting ? ' TURBO' : ''}` +
      `  tod ${h.timeOfDay}  missingChunks ${h.missingChunks}\n` +
      h.hitting.map(x => `   → ${x.n}/5 rays: ${x.what}  @${x.dist}m`).join('\n')
    ).join('\n\n');
    this.el.textContent = `DIAG · ${this.hits.length} caught / ${this.frames} frames\n\n${last}`;
  }

  dump() {
    const s = JSON.stringify(this.hits, null, 1);
    console.log(s);
    return s;
  }
}
