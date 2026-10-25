"""Converts an ArcFace-style ONNX face embedder (112x112 RGB in, (x-127.5)/127.5, 512-d out) to a
Core ML program with the contract FaceRecognizer.swift and FaceEval.swift expect: image input
"face", tensor output "embedding".

    python convert_onnx.py --onnx w600k_r50.onnx --out models/r50 --name "InsightFace buffalo_l ResNet50" \
        --license "InsightFace model zoo: non-commercial research use"

Same recipe as apps/mobile/modules/glasses/scripts/convert_face_model.py (coremltools 9 has no ONNX
frontend, so onnx2torch -> torch.jit.trace -> ct.convert), generalized over the model name.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

import coremltools as ct
import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnx2torch import convert
from PIL import Image


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--license", default="")
    ap.add_argument("--fp32", action="store_true")
    args = ap.parse_args()

    torch_model = convert(onnx.load(args.onnx)).eval()
    traced = torch.jit.trace(torch_model, torch.rand(1, 3, 112, 112) * 2 - 1)
    mlmodel = ct.convert(
        traced,
        inputs=[ct.ImageType(name="face", shape=(1, 3, 112, 112), scale=1 / 127.5, bias=[-1, -1, -1], color_layout=ct.colorlayout.RGB)],
        outputs=[ct.TensorType(name="embedding")],
        minimum_deployment_target=ct.target.iOS17,
        convert_to="mlprogram",
        compute_precision=ct.precision.FLOAT32 if args.fp32 else ct.precision.FLOAT16,
        compute_units=ct.ComputeUnit.ALL,
    )
    mlmodel.short_description = f"{args.name} face embedder, 112x112 aligned RGB in, 512-d out"
    mlmodel.license = args.license
    mlmodel.version = args.name

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    pkg = out / "FaceEmbedder.mlpackage"
    if pkg.exists():
        shutil.rmtree(pkg)
    mlmodel.save(str(pkg))

    sess = ort.InferenceSession(args.onnx, providers=["CPUExecutionProvider"])
    cosines = []
    for _ in range(3):
        img = (np.random.rand(112, 112, 3) * 255).astype(np.uint8)
        x = (img.astype(np.float32).transpose(2, 0, 1)[None] - 127.5) / 127.5
        ref = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
        got = mlmodel.predict({"face": Image.fromarray(img)})["embedding"].reshape(-1)
        cosines.append(float(np.dot(ref, got) / (np.linalg.norm(ref) * np.linalg.norm(got))))
    print(f"coreml vs onnxruntime cosine on random inputs: {', '.join(f'{c:.5f}' for c in cosines)}")

    compiled = out / "FaceEmbedder.mlmodelc"
    if compiled.exists():
        shutil.rmtree(compiled)
    subprocess.run(["xcrun", "coremlcompiler", "compile", str(pkg), str(out)], check=True)
    size = sum(f.stat().st_size for f in compiled.rglob("*") if f.is_file()) / 1e6
    print(f"wrote {compiled} ({size:.1f} MB compiled)")


if __name__ == "__main__":
    main()
