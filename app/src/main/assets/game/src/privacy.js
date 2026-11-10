/* ------------------------------------------------------------------
   privacy.js — the "Privacy policy" links on the start screen and in
   the settings panel.

   Google Play wants the policy reachable from inside the app. The page
   (privacy.html) ships with the game and is shown in an overlay rather
   than navigated to: the Android app has no internet permission and
   blocks navigation, and leaving index.html would end the run.
------------------------------------------------------------------ */

const overlay = document.getElementById('privacyOverlay');
const frame = document.getElementById('privacyFrame');
const closeBtn = document.getElementById('privacyClose');
let lastFocus = null;

function open() {
  if (!overlay) return;
  if (!frame.src) frame.src = './privacy.html';
  lastFocus = document.activeElement;
  overlay.hidden = false;
  closeBtn.focus();
}

function close() {
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

document.querySelectorAll('[data-privacy]').forEach((b) =>
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(); }));

if (overlay) {
  closeBtn.addEventListener('click', close);
  // tap on the dimmed backdrop closes it
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  // keep game keys (WASD, Space…) from driving the truck while reading
  addEventListener('keydown', (e) => {
    if (overlay.hidden) return;
    if (e.key === 'Escape') close();
    e.stopImmediatePropagation();
  }, true);
}
