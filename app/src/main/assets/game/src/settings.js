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
    document.addEventListener('pointerdown', (e) => {
      if (this.panel.hidden) return;
      if (!this.panel.contains(e.target) && e.target !== this.btnGfx && !this.btnGfx.contains(e.target)) {
        this.toggle(false);
      }
    }, true);

    this.refresh();
    this.apply();
  }

  toggle(force) {
    const open = force === undefined ? this.panel.hidden : force;
    this.panel.hidden = !open;
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
