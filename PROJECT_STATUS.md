# Dune Runner: project status

_Source of truth for this app's claude.ai chat. As of 2026-11-27._

Open-world off-road driving and flight game: one game, three targets (web, Android, iPhone/iPad).

## Current state

| | |
|---|---|
| Version | **1.2.41** (versionCode 51, commit 2af5fa0, 2026-11-26) |
| Platforms | Web, Android APK, iPhone/iPad IPA |
| Downloads | Public repo **Mkuz1/dune-runner-release** (`DuneRunner.apk`, `DuneRunner.ipa`, `version.json` read by the in-app updater) |
| Website | **https://dunerunner.pages.dev**; the site IS the game folder `app/src/main/assets/game` |
| App Store / Play | Not live (Play Store graphics are in the repo, PR #1) |

## Rules specific to this app

- **Every push to `main` builds and ships a new APK/IPA** (`build.yml`) and players get an update prompt. Ask Mohamad before merging site-only changes. For a docs-only commit such as this file, put `[skip ci]` in the commit message.

## Recent changes

- 2026-11-26: Play Store graphics (PR #1); koussa.net invite (PR #2); SEO/share previews (PR #3), shipped as build 1.2.41.
- 2026-11-18: More realistic look (sky, clouds, daylight, desert scrub); iOS black-square fixes.

## Open items

- Google Play submission if wanted.

## Rules for every MK app (decided in the MK APPS project)

- **This file is the hand-off to the app's own Claude chat.** That chat reads it from GitHub through Project knowledge. Every change to this app (code, release, store, website, decision) must also update this file in the same PR or commit.
- **Nothing local-only.** Every asset, store file and site file lives in the app's GitHub repo. Signing keys and passwords are the only exception and are never committed (they stay in `~/keys` on the Mac).
- **Websites deploy themselves** to Cloudflare Pages from GitHub Actions on push (secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` are set on the repo). No manual or terminal deploys.
- **Every app site invites visitors to https://www.koussa.net** (the MK Apps showcase, source in `Mkuz1/MK-APPS`, served by Cloudflare project `mkuzapps`). Keep that card when editing the site, and update the app's row in `MK-APPS/build.py` when platforms, versions or store links change.
- **SEO and share previews (done 2026-11-26):** keep the OG + Twitter tags with an absolute 1200x630 image under 300 KB, canonical, favicon.ico + 192/512 icons + 180 px touch icon, web manifest, robots.txt, sitemap.xml and SoftwareApplication JSON-LD. When replacing a share image, give it a new file name so WhatsApp refreshes its cache.
- **Store badges only for what is really live.** Re-check the App Store / Play page before adding a badge.
- **Mohamad merges pull requests himself** (Claude Code's auto mode on the Mac blocks `gh pr merge`).

---
_Last updated 2026-11-27. Update this file with every change to the app._
