#!/bin/sh
# Downloads the sherpa-onnx keyword spotter for "Hey Remi" (WakeWord.swift): the prebuilt static
# iOS xcframeworks for sherpa-onnx and onnxruntime, plus the open-vocabulary English KWS model.
# Everything is Apache 2.0; no account or key. Called by Glasses.podspec during `pod install`
# when ios/Frameworks or ios/Models/wake is missing or on another version.
set -e
VERSION="${1:-1.13.8}"
ORT_VERSION="1.28.2"
MODEL="sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FW="$IOS_DIR/Frameworks"
WAKE="$IOS_DIR/Models/wake"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Checksums come from sherpa-onnx's Package.swift (v$VERSION) and onnxruntime-libs' Package.swift.
SHERPA_SHA="6b8e769cb153343270fdccbe92e3b3db0d1c421d67fa0989ab01fdf5b2fcf2de"
ORT_SHA="2c2299acbb461d26d4bac4bc85985d40e7c7177ed6072703ae0846d88b0b4599"

check() { # file sha
  actual="$(shasum -a 256 "$1" | cut -d' ' -f1)"
  if [ "$actual" != "$2" ]; then echo "[Glasses] checksum mismatch for $1" >&2; exit 1; fi
}

echo "[Glasses] Fetching sherpa-onnx $VERSION + onnxruntime $ORT_VERSION (iOS static)"
curl -sSL -o "$TMP/sherpa.zip" "https://github.com/k2-fsa/sherpa-onnx/releases/download/xcframework/sherpa-onnx-v${VERSION}-ios-static.xcframework.zip"
check "$TMP/sherpa.zip" "$SHERPA_SHA"
curl -sSL -o "$TMP/ort.zip" "https://github.com/csukuangfj/onnxruntime-libs/releases/download/v${ORT_VERSION}/onnxruntime-ios-static-xcframework-${ORT_VERSION}.xcframework.zip"
check "$TMP/ort.zip" "$ORT_SHA"
mkdir -p "$FW"
rm -rf "$FW/sherpa-onnx.xcframework" "$FW/SherpaOnnxC.xcframework" "$FW/onnxruntime.xcframework"
# The zip is named sherpa-onnx but the framework inside is SherpaOnnxC; CocoaPods derives the
# `-framework` flag from the xcframework's file name, so it must match or the link fails.
unzip -q "$TMP/sherpa.zip" -d "$TMP/sherpa" && mv "$TMP/sherpa/sherpa-onnx.xcframework" "$FW/SherpaOnnxC.xcframework"
unzip -q "$TMP/ort.zip" -d "$TMP/ort" && mv "$TMP/ort/onnxruntime.xcframework" "$FW/"

echo "[Glasses] Fetching KWS model $MODEL"
curl -sSL -o "$TMP/model.tar.bz2" "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/${MODEL}.tar.bz2"
tar xjf "$TMP/model.tar.bz2" -C "$TMP"
mkdir -p "$WAKE"
rm -f "$WAKE"/*
# int8 everywhere: 5.3 MB total. (The "-mobile" variant of this model crashes onnxruntime on
# the first decode with a Reshape shape error; the plain one works.)
for f in encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx \
         joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx tokens.txt; do
  cp "$TMP/$MODEL/$f" "$WAKE/"
done
echo "$VERSION" > "$WAKE/VERSION"
echo "[Glasses] sherpa-onnx $VERSION ready in $FW and $WAKE"
