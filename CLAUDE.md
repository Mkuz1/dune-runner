# Dune Runner: notes for Claude

## Keep PROJECT_STATUS.md current

`PROJECT_STATUS.md` at the repo root is what this app's claude.ai chat reads (via Project knowledge, GitHub). With every change to this app (code, release, version bump, store submission, website, or a decision), update `PROJECT_STATUS.md` in the same commit or PR: version table, recent changes (dated), and open items. Keep it factual and short.

Every push to `main` builds and ships a new APK/IPA. For commits that only touch docs (like PROJECT_STATUS.md), add `[skip ci]` to the commit message.
