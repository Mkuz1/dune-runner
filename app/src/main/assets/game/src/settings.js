/* ------------------------------------------------------------------
   settings.js — the in-game settings panel: mute, volume and the
   graphics tier. Choices are remembered in localStorage.
------------------------------------------------------------------ */

import { presetList, loadSettings, saveSettings } from './quality.js';

export class Settings {
  constructor(game) {
    this.game = game;
    const s = loadSettings();
    this.muted = s.muted === true;
    this.volume = typeof s.volume === 'number' ? s.volume : 0.55;

    this.btnSound = document.getElementById('btnSound');
    this.btnGfx = document.getElementById('btnGfx');
    this.panel = document.getElementById('gfxPanel');
    this.gfxSeg = document.getElementById('gfxSeg');
    this.sndSeg = document.getElementById('sndSeg');
    this.vol = document.getElementById('volRange');

    /* graphics buttons */
    const current = game.q.tier;
    for (const p of presetList()) {
      const b = document.createElement('button');
      b.textContent = p.label;
      b.dataset.q = p.key;
      if (p.key === current) b.classList.add('on');
      b.addEventListener('click', () => this.setQuality(p.key));
      this.gfxSeg.appendChild(b);
    }

    /* sound buttons */
    this.sndSeg.querySelectorAll('[data-snd]').forEach(b => {
      b.addEventListener('click', () => this.setMuted(b.dataset.snd === 'off'));
    });

    this.vol.value = Math.round(this.volume * 100);
    this.vol.addEventListener('input', () => {
      this.volume = this.vol.value / 100;
      if (this.volume > 0 && this.muted) this.setMuted(false, true);
      this.apply();
      saveSettings({ volume: this.volume });
    });

    this.btnSound.addEventListener('click', () => this.setMuted(!this.muted));
    this.btnGfx.addEventListener('click', () => this.toggle());
    const bench = document.getElementById('benchBtn');
    if (bench) bench.addEventListener('click', () => this.runBench());
    document.addEventListener('pointerdown', (e) => {
      if (this.panel.hidden) return;
      if (!this.panel.contains(e.target) && e.target !== this.btnGfx && !this.btnGfx.contains(e.target)) {
        this.toggle(false);
      }
    }, true);

    this.refresh();
    this.apply();
  }

  /** Settings ▸ Run performance test: times each part of the scene. */
  async runBench() {
    this.toggle(false);
    let box = document.getElementById('benchBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'benchBox';
      document.body.appendChild(box);
    }
    box.innerHTML = '<pre></pre><button type="button" hidden>Close</button>';
    const pre = box.firstChild, close = box.lastChild;
    box.hidden = false;
    pre.textContent = 'Starting the performance test — about 20 seconds. Keep the tablet still.';
    close.onclick = () => { box.hidden = true; };
    try {
      const { runBenchmark } = await import('./bench.js');
      pre.textContent = await runBenchmark(this.game, (m) => { pre.textContent = m; });
      pre.textContent += '\n\nTake a screenshot of this and send it.';
    } catch (e) {
      pre.textContent = 'The test failed: ' + (e && e.message ? e.message : e);
    }
    close.hidden = false;
  }

  toggle(force) {
    const open = force === undefined ? this.panel.hidden : force;
    this.panel.hidden = !open;
    if (open) this.showInfo();
    this.btnGfx.classList.toggle('active', open);
  }

  setMuted(m, silent = false) {
    this.muted = m;
    saveSettings({ muted: m });
    this.refresh();
    this.apply();
    if (!silent) this.flash(m ? 'Sound muted' : 'Sound on');
  }

  setQuality(key) {
    saveSettings({ quality: key });
    if (key === this.game.q.tier) { this.refresh(); return; }
    // terrain resolution and texture size are baked at load, so reload
    const url = new URL(location.href);
    url.searchParams.delete('q');
    location.replace(url.toString());
  }

  /** Version, GPU and live numbers, for bug reports from real devices. */
  showInfo() {
    const el = document.getElementById('gfxInfo');
    if (!el) return;
    const g = this.game, r = g.renderer;
    let gpu = '?';
    try {
      const gl = r.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    } catch (_) {}
    const b = window.__build || {};
    const w = r.domElement.width, h = r.domElement.height;
    el.textContent =
      `v${b.versionName || '?'} · ${g.q.tier}${g.q.isPhone ? ' (mobile)' : ''}\n` +
      `${gpu}\n` +
      `${w}×${h} px · scale ${(g.gov ? g.gov.scale : 1).toFixed(2)} · ${g.gov && g.gov.fps ? Math.round(g.gov.fps) : '…'} fps` +
      `${g.q.bloom ? '' : ' · no bloom'}${g.shaderErrors && g.shaderErrors.length ? ' · shader errors: ' + g.shaderErrors.length : ''}` +
      `${g.vehicle && g.vehicle.modelLoaded ? '' : ' · truck model missing'}`;
  }

  apply() {
    const a = this.game.audio;
    if (a) a.setVolume(this.muted ? 0 : this.volume);
  }

  refresh() {
    this.btnSound.classList.toggle('muted', this.muted);
    this.btnSound.setAttribute('aria-label', this.muted ? 'Unmute' : 'Mute');
    this.sndSeg.querySelectorAll('[data-snd]').forEach(b => {
      b.classList.toggle('on', (b.dataset.snd === 'off') === this.muted);
    });
    this.gfxSeg.querySelectorAll('[data-q]').forEach(b => {
      b.classList.toggle('on', b.dataset.q === this.game.q.tier);
    });
  }

  /** brief toast on the HUD hint line */
  flash(text) {
    const el = document.getElementById('hint');
    if (!el) return;
    el.innerHTML = text;
    el.classList.remove('hide');
    clearTimeout(this._t);
    this._t = setTimeout(() => el.classList.add('hide'), 1400);
  }
}
