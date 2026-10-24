"""Smoke test for the face sidecar.

Usage (server running on :8001):   uv run python test_embed.py
Direct model, no server:           uv run python test_embed.py --direct

Uses testdata/obama_a.jpg, obama_b.jpg (same person) and biden.jpg (different person).
Target: same-person cosine > 0.5, different-person < 0.35.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

URL = "http://127.0.0.1:8001"
HERE = Path(__file__).parent
IMAGES = ["obama_a.jpg", "obama_b.jpg", "biden.jpg"]


def embed_http(data: bytes) -> dict:
    req = urllib.request.Request(f"{URL}/embed", data=data, headers={"Content-Type": "image/jpeg"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main() -> int:
    direct = "--direct" in sys.argv
    if direct:
        import main as sidecar

        model = sidecar.load_model()

        def embed(data: bytes) -> dict:
            return {"faces": sidecar.embed_image(model, sidecar.decode_image(data))}
    else:
        with urllib.request.urlopen(f"{URL}/health", timeout=5) as r:
            print("health:", json.load(r))
        embed = embed_http
        # Bad image must be a 400 with {error}.
        try:
            embed_http(b"not a jpeg")
            print("FAIL: bad image did not error")
            return 1
        except urllib.error.HTTPError as e:
            body = json.load(e)
            ok = e.code == 400 and "error" in body
            print(f"bad image -> {e.code} {body} {'OK' if ok else 'FAIL'}")
            if not ok:
                return 1

    embs: dict[str, np.ndarray] = {}
    for name in IMAGES:
        data = (HERE / "testdata" / name).read_bytes()
        times = []
        for _ in range(5):
            t0 = time.perf_counter()
            res = embed(data)
            times.append((time.perf_counter() - t0) * 1000)
        faces = res["faces"]
        if not faces:
            print(f"FAIL: no face in {name}")
            return 1
        f = faces[0]
        e = np.asarray(f["embedding"], dtype=np.float32)
        assert e.shape == (512,), e.shape
        embs[name] = e
        print(
            f"{name}: faces={len(faces)} box={f['box']} det={f['det_score']:.3f} "
            f"|e|={np.linalg.norm(e):.3f} latency median={sorted(times)[2]:.0f}ms (first {times[0]:.0f}ms)"
        )

    same = float(embs["obama_a.jpg"] @ embs["obama_b.jpg"])
    diff1 = float(embs["obama_a.jpg"] @ embs["biden.jpg"])
    diff2 = float(embs["obama_b.jpg"] @ embs["biden.jpg"])
    print(f"same person  (obama_a vs obama_b): {same:.3f}  target > 0.5")
    print(f"diff person  (obama_a vs biden):   {diff1:.3f}  target < 0.35")
    print(f"diff person  (obama_b vs biden):   {diff2:.3f}  target < 0.35")
    ok = same > 0.5 and diff1 < 0.35 and diff2 < 0.35
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
