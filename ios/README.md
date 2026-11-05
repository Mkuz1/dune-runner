# Dune Runner — iPhone & iPad

A native UIKit app that hosts the game in a full-screen WKWebView. It bundles
`../app/src/main/assets/game` directly, so iOS, Android and the website always
ship the same build — there is no second copy of the game to keep in sync.

The game is served from `app://game/` by a small URL-scheme handler
(`GameViewController.swift`). WebKit refuses ES-module scripts from `file://`,
so a real origin is required — the same reason the Android build serves its
assets from `appassets.androidplatform.net`.

## Run it on your iPhone (free, with your Apple ID)

1. Open `ios/DuneRunner.xcodeproj` in Xcode.
2. Select the **DuneRunner** target ▸ **Signing & Capabilities** ▸ tick
   *Automatically manage signing* and pick your Apple ID as the Team.
   If Xcode says the bundle ID is taken, change it to something unique,
   e.g. `com.yourname.dunerunner`.
3. Plug in the iPhone, choose it as the run destination, press **Run**.
4. First launch only: on the phone, Settings ▸ General ▸ VPN & Device
   Management ▸ trust your developer certificate.

A free Apple ID signs apps for 7 days; re-run from Xcode to renew.

## The .ipa from GitHub

Every push builds `DuneRunner-unsigned.ipa` (see the repository's Releases).
Apple will not install an unsigned app, so it has to be signed first —
Sideloadly or AltStore can do that with your Apple ID.

## TestFlight / App Store

Needs a paid Apple Developer account. In Xcode: set your Team, then
Product ▸ Archive ▸ Distribute App ▸ App Store Connect.
