"""Downloads LFW (deep-funneled) with the official 10-fold verification pairs and writes the
manifests the Swift harness consumes.

    python prepare_lfw.py --data <dir>

Produces under <dir>:
  lfw_funneled/<name>/<name>_NNNN.jpg   the 13,233 LFW images (deep-funneled release)
  pairs.txt                             official 10 x (300 same + 300 different) pairs
  degraded/face56/<file>.jpg            second image of every pair, shrunk so Vision's face box is ~56 px wide, JPEG q50
  degraded/face40/<file>.jpg            same, face box ~40 px wide, JPEG q40
  manifest.json                         {images: [{id, path}], pairs: [{fold, same, a, b, face56, face40}], tiers}

The degraded tiers imitate what the glasses deliver: a 504x896 HEVC frame compressed for Bluetooth
Classic, where a face one to three metres away is 35 to 90 px wide. The clean image stays as the
"enrollment photo" side of the pair, so clean-vs-degraded is the demo situation: a good roster
photo matched against a small, blurry frame.

URLs and checksums are the ones scikit-learn uses for fetch_lfw_pairs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import tarfile
import urllib.request
from pathlib import Path

from PIL import Image

FUNNELED_URL = "https://ndownloader.figshare.com/files/5976015"
FUNNELED_SHA256 = "b47c8422c8cded889dc5a13418c4bc2abbda121092b3533a83306f90d900100a"
PAIRS_URL = "https://ndownloader.figshare.com/files/5976006"
PAIRS_SHA256 = "ea42330c62c92989f9d7c03237ed5d591365e89b3e649747777b70e692dc1592"

# Apple Vision's face rectangle on clean LFW-funneled images is a median 113 px wide (measured over
# ~200 clean images with FaceEval; the resize is linear so tiers scale from that). Tier sizes below are Vision box widths, the same quantity the phone
# gates on (FaceRecognizer.minFaceSide = 36 px). In a 504x896 glasses frame, 56 px is roughly a face
# 1.5 m away and 40 px roughly 2.5 m; anything under 36 px is skipped on the phone by design.
LFW_FACE_PX = 113.0
TIERS = {"face56": (56, 50), "face40": (40, 40)}  # name -> (target Vision face width px, JPEG quality)


def download(url: str, dest: Path, sha256: str) -> None:
    if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() == sha256:
        return
    print(f"downloading {url} -> {dest}")
    urllib.request.urlretrieve(url, dest)
    got = hashlib.sha256(dest.read_bytes()).hexdigest()
    if got != sha256:
        raise SystemExit(f"checksum mismatch for {dest}: {got}")


def image_path(root: Path, name: str, n: int) -> Path:
    return root / "lfw_funneled" / name / f"{name}_{n:04d}.jpg"


def read_pairs(path: Path) -> list[dict]:
    lines = path.read_text().splitlines()
    folds, per = (int(x) for x in lines[0].split())
    pairs = []
    i = 1
    for fold in range(folds):
        for _ in range(per):
            name, a, b = lines[i].split("\t")
            pairs.append({"fold": fold, "same": True, "a": (name, int(a)), "b": (name, int(b))})
            i += 1
        for _ in range(per):
            n1, a, n2, b = lines[i].split("\t")
            pairs.append({"fold": fold, "same": False, "a": (n1, int(a)), "b": (n2, int(b))})
            i += 1
    return pairs


def degrade(src: Path, dst: Path, face_px: int, quality: int) -> None:
    if dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        im = im.convert("RGB")
        scale = face_px / LFW_FACE_PX
        size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
        im.resize(size, Image.Resampling.BILINEAR).save(dst, "JPEG", quality=quality)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    args = ap.parse_args()
    root = Path(args.data)
    root.mkdir(parents=True, exist_ok=True)

    tgz = root / "lfw-funneled.tgz"
    download(FUNNELED_URL, tgz, FUNNELED_SHA256)
    if not (root / "lfw_funneled").exists():
        print("extracting", tgz)
        with tarfile.open(tgz) as tf:
            tf.extractall(root, filter="data")
    download(PAIRS_URL, root / "pairs.txt", PAIRS_SHA256)

    pairs = read_pairs(root / "pairs.txt")
    ids: dict[str, str] = {}  # image id -> relative path

    def register(key: str, rel: str) -> str:
        ids.setdefault(key, rel)
        return key

    out_pairs = []
    for p in pairs:
        a = image_path(root, *p["a"])
        b = image_path(root, *p["b"])
        row = {
            "fold": p["fold"],
            "same": p["same"],
            "a": register(a.stem, str(a.relative_to(root))),
            "b": register(b.stem, str(b.relative_to(root))),
        }
        for tier, (face_px, q) in TIERS.items():
            dst = root / "degraded" / tier / f"{b.stem}.jpg"
            degrade(b, dst, face_px, q)
            row[tier] = register(f"{tier}/{b.stem}", str(dst.relative_to(root)))
        out_pairs.append(row)

    manifest = {
        "root": str(root.resolve()),
        "images": [{"id": k, "path": v} for k, v in ids.items()],
        "pairs": out_pairs,
        "tiers": {k: {"facePx": v[0], "jpegQuality": v[1]} for k, v in TIERS.items()},
    }
    (root / "manifest.json").write_text(json.dumps(manifest))
    print(f"{len(out_pairs)} pairs, {len(ids)} images (incl. degraded) -> {root / 'manifest.json'}")


if __name__ == "__main__":
    main()
