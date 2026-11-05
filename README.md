# Dune Runner — Android app

A complete Android Studio project. The whole game ships inside
`app/src/main/assets/game`, so the app runs **fully offline** — no network
permission, no server, nothing downloaded at runtime. The finished APK is
around **1.6 MB**.

> **Note on how the assets are loaded.** The game is built from ES modules,
> and browsers refuse to load modules from a `file://` URL — the origin is
> `null` and the fetch is blocked by CORS, so the page loads but the script
> silently never runs. Loading `file:///android_asset/...` therefore leaves
> the app stuck on the loading screen. `MainActivity` instead intercepts every
> request to the reserved host `appassets.androidplatform.net` and answers it
> straight out of the APK, which gives the page a real `https` origin. That
> also makes it a secure context, so `localStorage` and the rest behave
> exactly as they do on the web build.

---

## Build it

**You need:** [Android Studio](https://developer.android.com/studio)
(Koala or newer) with the Android SDK 34 platform. That's it.

1. **Open Android Studio → Open** → pick this `dune-runner-android` folder.
2. Android Studio will say the Gradle wrapper is missing and offer to set it
   up — accept. (Or, if you have Gradle installed: run `gradle wrapper` in
   this folder first. The wrapper `.jar` is a binary and isn't included here.)
3. Let it sync. It downloads the Android Gradle Plugin the first time.
4. Plug in your phone with USB debugging on, or start an emulator.
5. Press **▶ Run**.

### Release APK / Play Store bundle

```bash
./gradlew assembleRelease      # → app/build/outputs/apk/release/
./gradlew bundleRelease        # → app/build/outputs/bundle/release/  (Play Store)
```

Before publishing, add your signing key to `app/build.gradle`:

```gradle
android {
    signingConfigs {
        release {
            storeFile file("your-keystore.jks")
            storePassword System.getenv("KS_PASS")
            keyAlias "dunerunner"
            keyPassword System.getenv("KEY_PASS")
        }
    }
    buildTypes {
        release { signingConfig signingConfigs.release }
    }
}
```

---

## Device support

| | |
|---|---|
| Minimum | **Android 7.0** (API 24) — covers roughly 98% of active devices |
| Target | Android 14 (API 34) |
| Requires | OpenGL ES 3.0 and Android System WebView (both standard since 2016) |
| Permissions | **none** |
| Architecture | any — there is no native code, so one APK fits every device |

### Phones, tablets, foldables

The Activity declares `resizeableActivity`, `supports_size_changes`, and a
`configChanges` list that covers `screenSize`, `smallestScreenSize`,
`screenLayout`, `orientation`, `density` and `uiMode`. That means:

- **Folding or unfolding does not restart the app.** The Activity survives the
  configuration change, so the WebGL context is never destroyed and you don't
  lose your position in the world. `onConfigurationChanged` re-asserts
  immersive mode and fires a `resize` at the game, which re-lays-out the HUD
  and adjusts the camera aspect on the next frame.
- **Split-screen and free-form windowing** (foldables, Chromebooks, Samsung
  DeX) work for the same reason.
- **Tablets and unfolded foldables** get larger touch controls — the CSS has a
  `min-height: 620px and pointer: coarse` breakpoint that scales the
  thumbstick and buttons up.
- **Notches and hole-punch cameras** are handled with
  `LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES` plus `env(safe-area-inset-*)`
  in the CSS, so no control ever lands under the cutout.

### Orientation

`screenOrientation` is **`fullSensor`**: the app follows the device in all four
orientations and is genuinely full screen in every one of them.

This matters for more than preference. A *fixed* orientation is exactly what
makes Android 12L and newer **letterbox** an app on large screens, tablets and
unfolded foldables — you get black pillars down the sides instead of a full
screen. Following the device avoids that entirely.

The HUD has a dedicated **portrait layout**: the clock and FPS chips drop out
to make room, the gauge and minimap move to the second row, and both thumbs
keep their controls at the bottom. The camera also widens its vertical field of
view on tall aspect ratios — three.js `fov` is vertical, so without that the
world would look zoomed in and cramped in portrait.

To force landscape instead, set `android:screenOrientation="sensorLandscape"`
in `AndroidManifest.xml`.

---

## Updating the game inside the app

The assets are a plain copy of the web build. After editing anything under
`fj-cruiser-offroad/`:

```bash
./sync-game-assets.sh                       # assumes ../fj-cruiser-offroad
./sync-game-assets.sh /path/to/web/build    # or point it somewhere else
```

Then rebuild. Bump `versionCode` and `versionName` in `app/build.gradle` for
each release you ship.

---

## Two other ways to get it on Android

**1. Install straight from the website.** The web build is now a PWA — it has
a manifest, maskable icons and a service worker that precaches the whole game.
Open the site in Chrome on Android and use **⋮ → Add to Home screen**. It
launches fullscreen with its own icon and works offline afterwards. No Play
Store, no APK, and updates land automatically.

**2. Wrap the hosted site instead of bundling it.** If you'd rather the app
track your Cloudflare deployment, use
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) to generate a
Trusted Web Activity:

```bash
npx @bubblewrap/cli init --manifest https://your-site.pages.dev/manifest.webmanifest
npx @bubblewrap/cli build
```

That needs Digital Asset Links set up on the domain to hide the URL bar. The
bundled project in this folder avoids all of that and works with no network at
all, which is why it's the default.

---

## What's in here

```
settings.gradle, build.gradle, gradle.properties   Gradle setup
app/build.gradle                                   minSdk 24, targetSdk 34, no deps
app/src/main/AndroidManifest.xml                   fullscreen, resizeable, no permissions
app/src/main/java/dev/dunerunner/game/
  MainActivity.java                                WebView host: immersive mode,
                                                   fold handling, lifecycle, back key
app/src/main/res/                                  icons, themes, backup rules
app/src/main/assets/game/                          the game itself
sync-game-assets.sh                                refresh the assets from the web build
```

`MainActivity` deliberately extends the framework `Activity` and pulls in **no
libraries at all** — not even AndroidX. That keeps the APK tiny and the build
fast, and there is nothing to keep up to date.
