# Publishing Dune Runner to Google Play

Everything you need, in the order you'll need it.

---

## 1. The signing key — you must create this yourself

**I can't generate your keystore or give you a password, and you shouldn't
accept one from anyone else.** That key *is* your app's identity on Google
Play. Whoever holds it can ship updates to your users. If a password came from
a chat log, an email, or any file you didn't create, treat the key as
compromised. Passwords also need to be unique and random — a memorable one is
the single weakest link in the whole chain.

So: generate it on your own machine, right now, and pick the passwords yourself
in your password manager.

```bash
cd ~/Documents/dune-runner-android
keytool -genkeypair -v \
  -keystore dune-runner-release.jks \
  -alias dunerunner \
  -keyalg RSA -keysize 4096 \
  -validity 10000 \
  -storetype PKCS12
```

`keytool` ships with the JDK, which Android Studio already installed. It will
prompt you for:

| Prompt | What to enter |
|---|---|
| Keystore password | A long random password from your password manager |
| First and last name (CN) | Your name or company |
| Organisational unit / Organisation | Optional — press Enter to skip |
| City / State / Country code | e.g. `Dubai`, `Dubai`, `AE` |
| Key password for `<dunerunner>` | Press Enter to reuse the keystore password |

### Look after it

- **Back up `dune-runner-release.jks` somewhere safe and offline.** Lose it and
  you can never update this app again — you'd have to publish a brand-new
  listing under a new package name and lose all your installs and reviews.
- **Never commit it to git.** Your `.gitignore` already covers `*.jks` and
  `keystore.properties`; keep it that way.
- Turn on **Play App Signing** when you create the app (it's the default). Google
  then holds the final signing key and your upload key becomes recoverable if
  you ever lose it. This is worth doing.

### Wire it into the build

Create `keystore.properties` next to `app/` — **not** in git:

```properties
storeFile=../dune-runner-release.jks
storePassword=THE_PASSWORD_YOU_CHOSE
keyAlias=dunerunner
keyPassword=THE_PASSWORD_YOU_CHOSE
```

The build is already set up to read it (see `app/build.gradle`). If the file
isn't there, release builds simply come out unsigned instead of failing.

Then:

```bash
./gradlew bundleRelease     # → app/build/outputs/bundle/release/app-release.aab
```

Upload the **.aab**, not an APK — Play requires App Bundles for new apps.

---

## 2. Before you upload — things that will bounce back

| Item | Status here | Action |
|---|---|---|
| Target API level | **34** ✅ | Play requires 35 from Aug 2025; bump `targetSdk` then |
| App Bundle (.aab) | ✅ | `./gradlew bundleRelease` |
| 64-bit support | ✅ n/a | no native code, so any device works |
| Permissions | **none** ✅ | nothing to justify |
| Ads / analytics / trackers | **none** ✅ | makes the Data safety form trivial |
| Package name | `dev.dunerunner.game` | **permanent once published** — change it now if you want |
| Version | `versionCode 1`, `versionName "1.0"` | must increase every upload |

---

## 3. Store listing content

**App name** (30 chars max)
```
Dune Runner: Off-Road 4x4
```

**Short description** (80 chars max)
```
Drive and fly a 4x4 across endless dunes, forests, beaches and open sea.
```

**Full description** (4000 chars max) — draft:

```
Dune Runner is an open-world off-road driving game with no edges. Point the
truck in any direction and keep going: pine forest, desert dunes, beaches and
open sea generate around you forever, threaded with winding off-road trails
and dotted with alpine log-cabin villages.

DRIVE
Real suspension, a proper tyre model and grip that depends on what's under the
wheels. Sand is loose, rock bites, packed dirt is somewhere in between. Weight
transfer, drift, jumps and landings all come out of the simulation.

FLY
Tap FLY and the truck lifts off. Climb over the ridgelines, skim the dunes,
drop back down wherever you like.

SWIM
Drive straight into the sea. The truck floats, rides the actual swell and
steers like a boat.

TURBO
Double-tap forward, or hit the turbo button, for a hard shove of speed — on
land, in the air and across the water.

FEATURES
· Endless procedurally generated world — no loading screens, no boundaries
· Full day/night cycle with a physical sky, moving sun, stars and headlights
· Four camera modes including a hood view
· Analogue thumbstick, or play with a keyboard or gamepad
· Adjustable graphics: Ultra, High, Medium, Low
· Works completely offline — no ads, no tracking, no permissions, no account
```

**Graphics you need to produce:**

| Asset | Spec | Note |
|---|---|---|
| App icon | 512×512 PNG, 32-bit | `app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` is 192px — re-export at 512 |
| Feature graphic | 1024×500 PNG/JPG | required; a wide screenshot with the title works |
| Phone screenshots | 2–8, min 320px, 16:9 or 9:16 | grab from a real device |
| Tablet screenshots | optional but improves ranking | |

Take screenshots on-device with the volume-down + power shortcut while playing.
Landscape shots of the dunes meeting the sea and a village at dusk look best.

---

## 4. Play Console setup, step by step

1. **Create the developer account** — $25 one-off. Individual accounts now need
   ID verification and, if you registered after Nov 2023, **12 testers running
   a closed test for 14 days** before you can go to production. Budget for that.
2. **Create app** → name, language, "App" (not Game… actually pick **Game →
   Racing**), Free.
3. Work through **Dashboard → set up your app**:
   - **Privacy policy** — required even with no data collection. A URL on your
     Cloudflare site is fine; a short page saying the app collects nothing.
   - **App access** — "All functionality is available without restrictions".
   - **Ads** — No.
   - **Content rating** — fill the questionnaire; this will rate as PEGI 3 /
     ESRB Everyone. Say no to violence, no user interaction, no data sharing.
   - **Target audience** — 13+ is simplest. Selecting under-13 pulls you into
     Families policy and extra review.
   - **Data safety** — "No data collected", "No data shared". True here: no
     network permission at all, and settings are stored locally only.
   - **Government apps** — No.
4. **Release → Testing → Closed testing** — upload the .aab, add your 12 testers
   by email, run it 14 days.
5. **Release → Production** — promote the build, fill the release notes, submit.

Review usually takes a few days for a first submission.

---

## 5. Shipping updates

```bash
# 1. edit the game under app/src/main/assets/game/
# 2. bump both numbers in app/build.gradle
#      versionCode 2
#      versionName "1.1"
# 3.
./gradlew bundleRelease
# 4. upload the new .aab to a release track
```

`versionCode` must be a higher integer every single upload. `versionName` is
just the label users see.
