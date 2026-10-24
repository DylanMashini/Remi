# On-device face model

`ios/Models/FaceEmbedder.mlmodelc` is InsightFace's **buffalo_sc** recognizer (`w600k_mbf.onnx`,
MobileFaceNet trained on WebFace600K) converted to a Core ML program with fp16 weights (6.6 MB
compiled). It is what `FaceRecognizer.swift` runs on the phone when local recognition is on.

- Source: https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip
  (`w600k_mbf.onnx`, 13.6 MB fp32).
- License: InsightFace model-zoo weights are released for **non-commercial research use** (same
  terms as the `buffalo_l` pack the Python sidecar already uses). Code in this repo is ours.
- Contract: aligned 112x112 RGB crop (ArcFace 5-point template, `(x-127.5)/127.5`, done by the
  Core ML `ImageType` scale/bias), output 512-d, L2-normalized by the caller. The compiled model
  matches onnxruntime to cosine 0.99998 on the same input.
- Scores on `apps/face/testdata` (InsightFace alignment): same person 0.73, different person
  -0.06 / 0.03, so the server's 0.5 threshold carries over.

Face detection and landmarks come from Apple Vision (`VNDetectFaceLandmarksRequest`); the 5
ArcFace points are eye centres, nose tip and mouth corners, warped with a least-squares
similarity transform, so no detector model ships with the app.

## Regenerating

```sh
uv venv --python 3.12 /tmp/facevenv
uv pip install --python /tmp/facevenv/bin/python coremltools onnx onnx2torch torch onnxruntime pillow numpy
curl -L -o /tmp/buffalo_sc.zip https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip
unzip /tmp/buffalo_sc.zip -d /tmp/buffalo_sc
/tmp/facevenv/bin/python convert_face_model.py --onnx /tmp/buffalo_sc/w600k_mbf.onnx --out ../ios/Models
```

The `.mlpackage` is gitignored (same bytes as the `.mlmodelc`); only the compiled model is committed.

## Reference numbers for the simulator self-test

`reference_embeddings.py` runs InsightFace on the Mac and writes `reference.json` plus the
aligned crops the Core ML model should see. `FaceSelfTest.swift` (DEBUG builds) reads that folder
when the app is launched with `RECALL_FACE_SELFTEST=<dir>` and reports cosine agreement and timing:

```sh
uv pip install --python /tmp/facevenv/bin/python insightface opencv-python-headless
mkdir -p /tmp/isf/models && cp -R /tmp/buffalo_sc /tmp/isf/models/buffalo_sc
/tmp/facevenv/bin/python reference_embeddings.py --root /tmp/isf --out /tmp/ref ../../../../face/testdata/*.jpg
SIMCTL_CHILD_RECALL_FACE_SELFTEST=/tmp/ref xcrun simctl launch --console booted com.dylanmashini.memoryaid
```
