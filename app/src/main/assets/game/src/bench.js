/* ------------------------------------------------------------------
   bench.js — on-device performance test (Settings ▸ Performance test).

   Mobile GPUs differ too much to tune blind. This parks the truck,
   then renders the same view with one part of the scene switched off
   at a time and times each run. The difference to the full scene is
   what that part costs on *this* device. The result is shown as a
   table the player can screenshot and send.
------------------------------------------------------------------ */

import * as THREE from '../libs/three/three.module.js';

// frames to settle (and compile) before timing, and frames timed per run;
// window.__benchFrames = [warm, timed] shortens it for automated tests
const [WARM, TIMED] = window.__benchFrames || [24, 90];

const frame = () => new Promise(r => requestAnimationFrame(r));

export async function runBenchmark(game, onProgress) {
  const R = game.renderer;
  const wasRunning = game.running;
  game.running = false;                       // stop the game loop
  await frame(); await frame();

  const terrainMeshes = [], propMeshes = [];
  for (const rec of game.terrain.chunks.values()) {
    terrainMeshes.push(rec.mesh);
    for (const p of rec.props) propMeshes.push(p);
  }
  const villageGroups = [...game.villages.active.values()].map(v => v.group);
  const flat = new THREE.MeshLambertMaterial({ color: 0xb8a27a });
  const prPrev = R.getPixelRatio();

  const render = () => {
    game.props.windClock.value += 1 / 60;
    if (game.benchDirect) R.render(game.scene, game.camera);
    else game.post.render(1 / 60);
  };

  async function time(label) {
    for (let i = 0; i < WARM; i++) { render(); await frame(); }
    const d = [];
    let last = performance.now();
    for (let i = 0; i < TIMED; i++) {
      render();
      await frame();
      const now = performance.now();
      d.push(now - last); last = now;
    }
    d.sort((a, b) => a - b);
    return { label, ms: d[d.length >> 1] };
  }

  const runs = [
    ['Full scene', null],
    ['Without trees and plants', () => { propMeshes.forEach(m => m.visible = false); return () => propMeshes.forEach(m => m.visible = true); }],
    ['Without grass tufts', () => { if (!game.grass.mesh) return () => {}; game.grass.mesh.visible = false; return () => { game.grass.mesh.visible = true; }; }],
    ['Without villages', () => { villageGroups.forEach(g => g.visible = false); return () => villageGroups.forEach(g => g.visible = true); }],
    ['Without sea', () => { game.ocean.mesh.visible = false; return () => { game.ocean.mesh.visible = true; }; }],
    ['Plain ground shader', () => {
      const keep = terrainMeshes.map(m => m.material);
      terrainMeshes.forEach(m => { m.material = flat; });
      return () => terrainMeshes.forEach((m, i) => { m.material = keep[i]; });
    }],
    ['Without shadows', () => {
      const a = R.shadowMap.autoUpdate; R.shadowMap.autoUpdate = false;
      return () => { R.shadowMap.autoUpdate = a; R.shadowMap.needsUpdate = true; };
    }],
    ['Without post-processing', () => { game.benchDirect = true; return () => { game.benchDirect = false; }; }],
    ['Half resolution', () => { R.setPixelRatio(prPrev * 0.5); game.post.resize(); return () => { R.setPixelRatio(prPrev); game.post.resize(); }; }]
  ];

  const out = [];
  for (let i = 0; i < runs.length; i++) {
    const [label, apply] = runs[i];
    onProgress && onProgress(`Testing ${i + 1}/${runs.length}: ${label}…`);
    const undo = apply ? apply() : null;
    try { out.push(await time(label)); }
    finally { if (undo) undo(); }
  }
  flat.dispose();

  R.info.autoReset = false; R.info.reset(); render();
  const calls = R.info.render.calls, tris = R.info.render.triangles;
  R.info.autoReset = true;

  game.last = performance.now();
  game.running = wasRunning;
  if (wasRunning) requestAnimationFrame(game.loop);

  const base = out[0].ms;
  const b = window.__build || {};
  const lines = [
    `Performance test · v${b.versionName || '?'} · ${game.q.tier}${game.q.isPhone ? ' (mobile)' : ''}`,
    `${R.domElement.width}×${R.domElement.height} px · ${calls} draw calls · ${(tris / 1e6).toFixed(2)} M triangles`,
    ''
  ];
  for (const r of out) {
    const fps = Math.min(999, Math.round(1000 / r.ms));
    const save = r === out[0] ? '' : `  (saves ${Math.max(0, base - r.ms).toFixed(1)} ms)`;
    lines.push(`${r.label.padEnd(26)} ${r.ms.toFixed(1).padStart(5)} ms  ${String(fps).padStart(3)} fps${save}`);
  }
  return lines.join('\n');
}
