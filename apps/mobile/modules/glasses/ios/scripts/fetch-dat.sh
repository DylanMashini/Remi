#!/bin/sh
# Downloads the Meta Wearables DAT SDK binary xcframeworks into ios/Frameworks.
# Called automatically by Glasses.podspec during `pod install` when they are missing.
set -e
VERSION="${1:-1.0.1}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/Frameworks"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "[Glasses] Fetching meta-wearables-dat-ios $VERSION"
git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$VERSION" https://github.com/facebook/meta-wearables-dat-ios "$TMP/dat"
mkdir -p "$DEST"
for fw in MWDATCore MWDATCamera MWDATMockDevice MWDATInputs; do
  rm -rf "$DEST/$fw.xcframework"
  cp -R "$TMP/dat/$fw.xcframework" "$DEST/"
done
echo "$VERSION" > "$DEST/VERSION"
echo "[Glasses] DAT $VERSION ready in $DEST"
