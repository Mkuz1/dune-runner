/* ------------------------------------------------------------------
   updates.js — the version line on the start screen, and the "new
   version available" notice for the website.

   build.json is stamped by CI with the version every platform ships
   (Android versionName, iOS CFBundleShortVersionString, the website),
   so the start screen always says which build is running.

   Update checks: the Android and iOS apps do their own natively
   (Updater.java / Updater.swift), because only native code can download
   and install a new build. The website checks here, against the same
   version.json those apps read, and offers a one-tap reload.
------------------------------------------------------------------ */

export const UPDATE_URL =
  'https://raw.githubusercontent.com/Mkuz1/dune-runner-releases/main/version.json';
const RECHECK_MS = 30 * 60 * 1000;

const inApp = location.hostname === 'appassets.androidplatform.net' || location.protocol === 'app:';

async function json(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

let current = { versionName: 'dev', versionCode: 0 };
let shown = false;
let lastCheck = 0;

function showVersion() {
  const el = document.getElementById('bootVer');
  if (!el) return;
  const v = current.versionName;
  el.textContent = v === 'dev' ? 'Development build' : 'Version ' + v;
}

async function check() {
  if (shown || inApp || !current.versionCode) return;
  if (!navigator.onLine || Date.now() - lastCheck < RECHECK_MS) return;
  lastCheck = Date.now();
  try {
    const r = await json(UPDATE_URL);
    if (r && r.versionCode > current.versionCode) notify(r);
  } catch (_) { /* offline or not published yet: try again later */ }
}

function notify(r) {
  shown = true;
  const bar = document.createElement('div');
  bar.id = 'updateBar';
  bar.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = 'Dune Runner ' + (r.versionName || r.versionCode) +
    ' is available — you have ' + current.versionName + '.';
  const go = document.createElement('button');
  go.textContent = 'Update now';
  go.addEventListener('click', async () => {
    go.disabled = true;
    go.textContent = 'Updating…';
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    } catch (_) {}
    location.reload();
  });
  const later = document.createElement('button');
  later.className = 'later';
  later.textContent = 'Later';
  later.setAttribute('aria-label', 'Dismiss update notice');
  later.addEventListener('click', () => bar.remove());
  const acts = document.createElement('div');
  acts.className = 'acts';
  acts.append(later, go);
  bar.append(text, acts);
  document.body.appendChild(bar);
}

(async () => {
  try { current = { ...current, ...(await json('./build.json')) }; } catch (_) {}
  showVersion();
  window.__build = current;
  if (inApp) return;
  setTimeout(check, 4000);
  setInterval(check, RECHECK_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
})();
