#!/usr/bin/env bash
# End-to-end: venv, LFW download, InsightFace model conversion, Vision+Core ML evaluation, report.
# Run on an Apple Silicon Mac with Xcode (Vision, Core ML, the Neural Engine). ~15 min the first time.
set -euo pipefail
cd "$(dirname "$0")"

PY=.venv/bin/python
if [ ! -x "$PY" ]; then
  uv venv --python 3.12 .venv
  uv pip install --python "$PY" coremltools onnx onnx2torch torch onnxruntime pillow numpy
fi

mkdir -p data models bin
"$PY" -I prepare_lfw.py --data data/lfw

# InsightFace recognizers (non-commercial research license). buffalo_sc ships in the app already.
fetch() { [ -f "$2" ] || curl -sL -o "$2" "$1"; }
fetch https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip data/buffalo_l.zip
fetch https://github.com/deepinsight/insightface/releases/download/v0.7/antelopev2.zip data/antelopev2.zip
[ -d data/buffalo_l ] || unzip -q data/buffalo_l.zip -d data/buffalo_l
[ -d data/antelopev2 ] || unzip -q data/antelopev2.zip -d data/antelopev2
[ -d models/r50/FaceEmbedder.mlmodelc ] || "$PY" convert_onnx.py --onnx data/buffalo_l/w600k_r50.onnx --out models/r50 \
  --name "InsightFace buffalo_l ResNet50 (w600k_r50)" --license "InsightFace model zoo: non-commercial research use"
[ -d models/r100/FaceEmbedder.mlmodelc ] || "$PY" convert_onnx.py --onnx data/antelopev2/antelopev2/glintr100.onnx --out models/r100 \
  --name "InsightFace antelopev2 ResNet100 (glintr100)" --license "InsightFace model zoo: non-commercial research use"

swiftc -O -o bin/FaceEval FaceEval.swift
MODELS=(--model mbf=../../apps/mobile/modules/glasses/ios/Models/FaceEmbedder.mlmodelc
        --model r50=models/r50/FaceEmbedder.mlmodelc
        --model r100=models/r100/FaceEmbedder.mlmodelc)
# Extra candidates converted separately (see README): add --model name=path here when present.
for extra in edgeface_xs edgeface_s sface lvface_t; do
  [ -d "models/$extra/FaceEmbedder.mlmodelc" ] && MODELS+=(--model "$extra=models/$extra/FaceEmbedder.mlmodelc")
done

./bin/FaceEval --manifest data/lfw/manifest.json --out out/full "${MODELS[@]}"
"$PY" -I report.py --manifest data/lfw/manifest.json --run out/full --models models.json --out RESULTS.md

# Per-op Neural Engine placement for the shipped model (prints the histogram and timings).
swift ComputePlan.swift ../../apps/mobile/modules/glasses/ios/Models/FaceEmbedder.mlmodelc face 112
