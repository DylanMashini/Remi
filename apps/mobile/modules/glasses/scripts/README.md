# On-device face model

`ios/Models/FaceEmbedder.mlmodelc` is InsightFace's **buffalo_l** recognizer (`w600k_r50.onnx`,
ResNet50 ArcFace trained on WebFace600K) converted to a Core ML program with fp16 weights (83 MB
compiled, one `weight.bin`). It is what `FaceRecognizer.swift` runs on the phone: all face
recognition happens on-device. It replaced buffalo_sc MobileFaceNet (6.6 MB) on Oct 24; the reasons
and measurements are in `eval/face-models/README.md` and `RESULTS.md`.

- Source: https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip
  (`w600k_r50.onnx`, 174 MB fp32, sha256 `4c06341c…9e43`).
- License: InsightFace model-zoo weights are released for **non-commercial research use**, same as
  the model it replaced. Code in this repo is ours. For a permissive license, EdgeFace-S
  (BSD-3-Clause) is the evaluated alternative; it needs its own thresholds and `.cpuAndNeuralEngine`.
- Contract: 112x112 RGB crop, `(x-127.5)/127.5` done by the Core ML `ImageType` scale/bias, output
  512-d, L2-normalized by the caller. Core ML vs onnxruntime on random inputs: cosine 0.998 / 0.998 /
  0.997 (the converter refuses anything below 0.997).
- Compute units: `.all`. `MLComputePlan` places every compute op of this ResNet on the Neural Engine
  (`eval/face-models/ComputePlan.swift`); 1.6 ms per face on an M4 Pro.
- Thresholds: all of them live in `FaceModel` in `FaceRecognizer.swift` (match 0.30, library
  suggestions 0.40, enrollment seed 0.40, near-duplicate 0.92). Change them with the model, never alone.
- Scores on `scripts/testdata` (repo root; InsightFace alignment): same person 0.80, different
  person -0.08 / -0.05.

Face detection comes from Apple Vision (`VNDetectFaceRectanglesRequest`), so no detector model
ships with the app. There is no landmark alignment: a square crop of 1.3x the face box, shifted up
by 0.2 box heights, resized to 112x112 (`FaceRecognizer.cropScale` / `cropShiftY`, tuned by the
sweep in `FaceSelfTest`). Vision's landmark request returned garbage on the iOS 27 simulator, which
is why the box crop won. The box crop scores same-person pairs lower than aligned crops, which is why
the match threshold is 0.30 and not InsightFace's usual 0.5.

## Regenerating

One converter for the app and the evaluation: `eval/face-models/convert_onnx.py`.

```sh
uv venv --python 3.12 /tmp/facevenv
uv pip install --python /tmp/facevenv/bin/python coremltools onnx onnx2torch torch onnxruntime pillow numpy
curl -L -o /tmp/buffalo_l.zip https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip
unzip /tmp/buffalo_l.zip -d /tmp/buffalo_l
/tmp/facevenv/bin/python -I eval/face-models/convert_onnx.py --onnx /tmp/buffalo_l/w600k_r50.onnx \
  --out apps/mobile/modules/glasses/ios/Models --name "InsightFace buffalo_l ResNet50 (w600k_r50)" \
  --license "InsightFace model zoo: non-commercial research use"
```

Run from the repo root. The `.mlpackage` is gitignored (same bytes as the `.mlmodelc`); only the
compiled model is committed, once. Do not churn it: it is over GitHub's 50 MB warning.

## Reference numbers for the simulator self-test

`reference_embeddings.py` runs InsightFace buffalo_l on the Mac and writes `reference.json` (each
entry tagged `model: "w600k_r50"`) plus the aligned crops the Core ML model should see.
`FaceSelfTest.swift` (DEBUG builds) reads that folder when the app is launched with
`RECALL_FACE_SELFTEST=<dir>`, refuses a reference from a different model, and reports cosine
agreement and timing:

```sh
uv pip install --python /tmp/facevenv/bin/python insightface opencv-python-headless
mkdir -p /tmp/isf/models && cp -R /tmp/buffalo_l /tmp/isf/models/buffalo_l
/tmp/facevenv/bin/python -I apps/mobile/modules/glasses/scripts/reference_embeddings.py --root /tmp/isf --out /tmp/ref scripts/testdata/*.jpg
SIMCTL_CHILD_RECALL_FACE_SELFTEST=/tmp/ref xcrun simctl launch --console booted com.dylanmashini.memoryaid
```

Measured on the iPhone 17 simulator (iOS 27, CPU only, Debug), Oct 24: model load 191 ms,
embedding 22-26 ms per face, Vision + crop + embedding 67-135 ms per photo. Aligned crop vs
onnxruntime: cosine 0.9999 on all three photos. Box-crop pipeline vs InsightFace aligned: 0.97 each.
Pair cosines: same person 0.77, different people -0.03 / -0.06 (InsightFace: 0.80, -0.08 / -0.05);
match decisions agree 3/3 at 0.30.
