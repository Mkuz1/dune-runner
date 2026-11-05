#!/usr/bin/env bash
# Copy the web build into the Android assets folder.
# Run this after changing anything under fj-cruiser-offroad/.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WEB="${1:-$HERE/../fj-cruiser-offroad}"
DEST="$HERE/app/src/main/assets/game"
[ -f "$WEB/index.html" ] || { echo "No index.html in $WEB"; exit 1; }
rm -rf "$DEST"; mkdir -p "$DEST"
rsync -a --exclude '_headers' --exclude 'README.md' --exclude 'sw.js' "$WEB/" "$DEST/"
echo "Synced $(find "$DEST" -type f | wc -l) files into app/src/main/assets/game"
