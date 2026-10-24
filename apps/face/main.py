"""Recall face embedding sidecar.

Localhost-only service used by the Next.js backend (see CONTRACT.md, "Face sidecar").
  GET  /health -> {ok: true, model: "buffalo_l"}
  POST /embed  (raw image/jpeg body) -> {faces: [{box: [x,y,w,h], det_score, embedding[512]}]}

Frames are decoded in memory and never written to disk.
Env: FACE_PROVIDERS (comma list, default "CPUExecutionProvider"), FACE_DET_SIZE (default 640).
"""

from __future__ import annotations

import logging
import os
import threading
import time
from contextlib import asynccontextmanager

import cv2
import numpy as np
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from insightface.app import FaceAnalysis

MODEL_NAME = "buffalo_l"
MAX_BODY_BYTES = 15 * 1024 * 1024

log = logging.getLogger("face")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s face: %(message)s")

_model: FaceAnalysis | None = None
# insightface/onnxruntime sessions are not guaranteed thread-safe across calls; serialize.
_lock = threading.Lock()


def load_model() -> FaceAnalysis:
    providers = [
        p.strip()
        for p in os.environ.get("FACE_PROVIDERS", "CPUExecutionProvider").split(",")
        if p.strip()
    ]
    det = int(os.environ.get("FACE_DET_SIZE", "640"))
    t0 = time.perf_counter()
    model = FaceAnalysis(
        name=MODEL_NAME,
        providers=providers,
        allowed_modules=["detection", "recognition"],
    )
    model.prepare(ctx_id=-1, det_size=(det, det))
    # Warm up so the first real request is not slow.
    model.get(np.zeros((det, det, 3), dtype=np.uint8))
    log.info("loaded %s providers=%s det=%d in %.1fs", MODEL_NAME, providers, det, time.perf_counter() - t0)
    return model


def decode_image(data: bytes) -> np.ndarray | None:
    if not data:
        return None
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)  # BGR, what insightface expects
    if img is None or img.size == 0:
        return None
    return img


def embed_image(model: FaceAnalysis, img: np.ndarray) -> list[dict]:
    with _lock:
        faces = model.get(img)
    h, w = img.shape[:2]
    out = []
    for f in faces:
        x1, y1, x2, y2 = [float(v) for v in f.bbox]
        x1, y1 = max(0.0, x1), max(0.0, y1)
        x2, y2 = min(float(w), x2), min(float(h), y2)
        bx, by = int(round(x1)), int(round(y1))
        bw, bh = max(0, int(round(x2 - x1))), max(0, int(round(y2 - y1)))
        emb = f.normed_embedding
        if emb is None:
            continue
        out.append(
            {
                "box": [bx, by, bw, bh],
                "det_score": round(float(f.det_score), 4),
                "embedding": [float(v) for v in emb.astype(np.float32)],
            }
        )
    out.sort(key=lambda d: d["box"][2] * d["box"][3], reverse=True)
    return out


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _model
    _model = load_model()
    yield


app = FastAPI(title="recall-face", lifespan=lifespan)


@app.get("/health")
def health():
    return {"ok": _model is not None, "model": MODEL_NAME}


@app.post("/embed")
async def embed(req: Request):
    if _model is None:
        return JSONResponse({"error": "model not loaded"}, status_code=503)
    data = await req.body()
    if len(data) > MAX_BODY_BYTES:
        return JSONResponse({"error": "image too large"}, status_code=413)
    img = decode_image(data)
    if img is None:
        return JSONResponse({"error": "body is not a decodable image (send raw image/jpeg)"}, status_code=400)
    t0 = time.perf_counter()
    try:
        faces = await run_in_threadpool(embed_image, _model, img)
    except Exception as e:  # report, never crash the server
        log.exception("embed failed")
        return JSONResponse({"error": f"embedding failed: {e}"}, status_code=500)
    log.info("embed %dx%d faces=%d %.0fms", img.shape[1], img.shape[0], len(faces), (time.perf_counter() - t0) * 1000)
    return {"faces": faces}
