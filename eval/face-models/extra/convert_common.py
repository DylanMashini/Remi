"""Shared Core ML conversion + verification recipe for the face-embedder benchmark.

Mirrors eval/face-models/convert_onnx.py (the one converter for the app and the eval):
  - ML program, fp16, iOS17 minimum, compute_units ALL
  - one ImageType input "face" (1,3,H,W) with pixel normalization folded into scale/bias
  - one TensorType output "embedding" (1, D)
  - compiled with `xcrun coremlcompiler compile` to <out>/FaceEmbedder.mlmodelc
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import coremltools as ct
import numpy as np
import torch
from PIL import Image

EXTRA = Path(__file__).resolve().parent


def param_count(model: torch.nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())


def dir_size_mb(p: Path) -> float:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) / 1e6


def convert_and_verify(
    *,
    name: str,
    traced: torch.jit.ScriptModule,
    size: int,
    scale: float,
    bias: list[float],
    color_layout,
    reference: Callable[[np.ndarray], np.ndarray],
    meta: dict,
    n_checks: int = 3,
    seed: int = 0,
) -> dict:
    """Convert `traced` and verify against `reference(img_hwc_uint8_rgb) -> (D,)`.

    `reference` must apply the *source* preprocessing itself (it receives the raw RGB uint8
    HWC image that Core ML will also receive as a CVPixelBuffer), so the check covers the
    scale/bias/color_layout folding, not just the network body.
    """
    out = EXTRA / name
    out.mkdir(parents=True, exist_ok=True)

    inputs = [ct.ImageType(name="face", shape=(1, 3, size, size), scale=scale, bias=bias, color_layout=color_layout)]
    mlmodel = ct.convert(
        traced,
        inputs=inputs,
        outputs=[ct.TensorType(name="embedding")],
        minimum_deployment_target=ct.target.iOS17,
        convert_to="mlprogram",
        compute_precision=ct.precision.FLOAT16,
        compute_units=ct.ComputeUnit.ALL,
    )
    mlmodel.short_description = meta.get("description", name)
    mlmodel.author = meta.get("author", "")
    mlmodel.license = meta.get("license", "")
    mlmodel.version = meta.get("version", name)

    pkg = out / "FaceEmbedder.mlpackage"
    if pkg.exists():
        shutil.rmtree(pkg)
    mlmodel.save(str(pkg))

    spec = mlmodel.get_spec()
    out_desc = spec.description.output[0]
    in_desc = spec.description.input[0]
    print(f"[{name}] input: {in_desc.name} {in_desc.type.WhichOneof('Type')} "
          f"{in_desc.type.imageType.width}x{in_desc.type.imageType.height} "
          f"colorspace={in_desc.type.imageType.colorSpace}")
    print(f"[{name}] output: {out_desc.name} shape={list(out_desc.type.multiArrayType.shape)}")

    rng = np.random.default_rng(seed)
    cosines = []
    for i in range(n_checks):
        img = rng.integers(0, 256, size=(size, size, 3), dtype=np.uint8)
        ref = np.asarray(reference(img), dtype=np.float32).reshape(-1)
        got = mlmodel.predict({"face": Image.fromarray(img, mode="RGB")})["embedding"]
        got_shape = tuple(got.shape)
        got = np.asarray(got, dtype=np.float32).reshape(-1)
        cos = float(np.dot(ref, got) / (np.linalg.norm(ref) * np.linalg.norm(got)))
        cosines.append(cos)
        print(f"[{name}] check {i}: coreml shape={got_shape} D={got.size} cosine vs source = {cos:.5f}")

    compiled = out / "FaceEmbedder.mlmodelc"
    if compiled.exists():
        shutil.rmtree(compiled)
    subprocess.run(["xcrun", "coremlcompiler", "compile", str(pkg), str(out)], check=True)
    size_mb = dir_size_mb(compiled)
    print(f"[{name}] compiled {compiled} ({size_mb:.2f} MB)")

    result = {
        "name": name,
        "input": {"name": "face", "shape": [1, 3, size, size], "scale": scale, "bias": bias,
                  "color_layout": str(color_layout)},
        "output": {"name": "embedding", "shape": list(got_shape), "D": int(got.size)},
        "cosines": cosines,
        "min_cosine": min(cosines),
        "mlmodelc_mb": round(size_mb, 2),
        "mlpackage_mb": round(dir_size_mb(pkg), 2),
        **meta,
    }
    (out / "result.json").write_text(json.dumps(result, indent=2))
    return result
