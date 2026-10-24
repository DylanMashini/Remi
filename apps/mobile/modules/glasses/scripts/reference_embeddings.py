"""Reference numbers for the on-device recognizer, computed with InsightFace on the Mac.

For every image in --images: detects the largest face with buffalo_sc (det_500m), writes the
ArcFace-aligned 112x112 crop (what the Core ML model sees) and the MobileFaceNet (w600k_mbf)
embedding, plus the buffalo_l (w600k_r50, the Python sidecar's model) embedding when the pack is
available. Output: <out>/reference.json and <out>/<name>.aligned.png.

    python reference_embeddings.py --root /dir/containing/models/buffalo_sc --out /tmp/ref scripts/testdata/*.jpg

The simulator self-test (FaceSelfTest.swift) reads this folder and reports cosine agreement.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from insightface.app import FaceAnalysis
from insightface.utils import face_align


def largest(faces):
    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="insightface root containing models/buffalo_sc")
    ap.add_argument("--out", required=True)
    ap.add_argument("images", nargs="+")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    sc = FaceAnalysis(name="buffalo_sc", root=args.root, providers=["CPUExecutionProvider"], allowed_modules=["detection", "recognition"])
    sc.prepare(ctx_id=-1, det_size=(640, 640))
    try:
        big = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"], allowed_modules=["detection", "recognition"])
        big.prepare(ctx_id=-1, det_size=(640, 640))
    except Exception as e:  # noqa: BLE001
        print("buffalo_l unavailable:", e)
        big = None

    result = {}
    for path in args.images:
        name = Path(path).stem
        img = cv2.imread(path)
        faces = sc.get(img)
        if not faces:
            print(name, "no face")
            continue
        f = largest(faces)
        crop = face_align.norm_crop(img, landmark=f.kps, image_size=112)  # BGR
        cv2.imwrite(str(out / f"{name}.aligned.png"), crop)
        entry = {
            "image": str(Path(path).resolve()),
            "box": [float(v) for v in f.bbox],
            "kps": [[float(x), float(y)] for x, y in f.kps],
            "mbf": [float(v) for v in f.normed_embedding],
        }
        if big is not None:
            bf = big.get(img)
            if bf:
                entry["r50"] = [float(v) for v in largest(bf).normed_embedding]
        result[name] = entry
        print(name, "box", [round(v) for v in f.bbox])

    names = list(result)
    for model in ("mbf", "r50"):
        if not all(model in result[n] for n in names):
            continue
        print(f"\n{model} cosine matrix")
        for a in names:
            row = [float(np.dot(result[a][model], result[b][model])) for b in names]
            print(f"  {a:10s}", " ".join(f"{v:6.3f}" for v in row))

    (out / "reference.json").write_text(json.dumps(result))
    print("\nwrote", out / "reference.json")


if __name__ == "__main__":
    main()
