#!/usr/bin/env bash
# One-time setup: give GitHub Actions the two keys it needs to publish updates.
#
#   dune-runner-release.jks + keystore.properties  -> signs every release APK
#                                                     with the same key, so
#                                                     installed copies can update
#   releases_deploy_key                            -> lets CI push builds to the
#                                                     public dune-runner-releases repo
#
# All three files live only on this machine and are git-ignored. This script
# contains no secrets; it reads those files and stores them as encrypted
# repository secrets with the GitHub CLI. Back up dune-runner-release.jks and
# keystore.properties somewhere safe: if they are lost, installed Android
# copies can never be updated again (they would have to be reinstalled).
set -euo pipefail
cd "$(dirname "$0")"
REPO=mohamdbeam-star/dune-runner

for f in dune-runner-release.jks keystore.properties releases_deploy_key; do
  [ -f "$f" ] || { echo "Missing $f"; exit 1; }
done
prop() { grep "^$1=" keystore.properties | cut -d= -f2-; }

base64 -i dune-runner-release.jks | gh secret set ANDROID_KEYSTORE_BASE64 --repo "$REPO"
prop storePassword | tr -d '\n' | gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$REPO"
prop keyAlias      | tr -d '\n' | gh secret set ANDROID_KEY_ALIAS        --repo "$REPO"
prop keyPassword   | tr -d '\n' | gh secret set ANDROID_KEY_PASSWORD     --repo "$REPO"
gh secret set RELEASES_DEPLOY_KEY --repo "$REPO" < releases_deploy_key

echo
gh secret list --repo "$REPO"
echo
echo "Done. The next push to main will publish to https://github.com/mohamdbeam-star/dune-runner-releases"
