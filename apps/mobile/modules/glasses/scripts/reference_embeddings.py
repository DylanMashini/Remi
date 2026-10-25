"""Reference numbers for the on-device recognizer, computed with InsightFace on the Mac.

For every image: detects the largest face with buffalo_l's detector (det_10g), writes the
ArcFace-aligned 112x112 crop (what the Core ML model should see) and the ResNet50 (w600k_r50)
embedding that ships on the phone. Output: <out>/reference.json and <out>/<name>.aligned.png.

    python reference_embeddings.py --root /dir/containing/models/buffalo_l --out /tmp/ref scripts/testdata/*.jpg

Each entry carries `model` ("w600k_r50") and `embedding`; FaceSelfTest.swift refuses a reference
made by a different model than `FaceModel.name`, then reports cosine agreement and timing.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from insightface.app import FaceAnalysis
from insightface.utils import face_align

MODEL = "w600k_r50"


def largest(faces):
    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="insightface root containing models/buffalo_l")
    ap.add_argument("--out", required=True)
    ap.add_argument("images", nargs="+")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    app = FaceAnalysis(name="buffalo_l", root=args.root, providers=["CPUExecutionProvider"], allowed_modules=["detection", "recognition"])
    app.prepare(ctx_id=-1, det_size=(640, 640))

    result = {}
    for path in args.images:
        name = Path(path).stem
        img = cv2.imread(path)
        faces = app.get(img)
        if not faces:
            print(name, "no face")
            continue
        f = largest(faces)
        crop = face_align.norm_crop(img, landmark=f.kps, image_size=112)  # BGR
        cv2.imwrite(str(out / f"{name}.aligned.png"), crop)
        result[name] = {
            "image": str(Path(path).resolve()),
            "model": MODEL,
            "box": [float(v) for v in f.bbox],
            "kps": [[float(x), float(y)] for x, y in f.kps],
            "embedding": [float(v) for v in f.normed_embedding],
        }
        print(name, "box", [round(v) for v in f.bbox])

    names = list(result)
    print(f"\n{MODEL} cosine matrix")
    for a in names:
        row = [float(np.dot(result[a]["embedding"], result[b]["embedding"])) for b in names]
        print(f"  {a:10s}", " ".join(f"{v:6.3f}" for v in row))

    (out / "reference.json").write_text(json.dumps(result))
    print("\nwrote", out / "reference.json")


if __name__ == "__main__":
    main()
