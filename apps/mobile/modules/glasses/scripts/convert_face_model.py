"""Converts InsightFace's MobileFaceNet recognizer (buffalo_sc / w600k_mbf.onnx) to Core ML.

Output: FaceEmbedder.mlpackage (fp16, ~7 MB) and the compiled FaceEmbedder.mlmodelc that the
Glasses pod ships as a resource. Run from a scratch venv (see README in this folder):

    python convert_face_model.py --onnx /path/to/w600k_mbf.onnx --out ../ios/Models

Model contract (mirrors insightface ArcFaceONNX): input is an aligned 112x112 RGB face crop
(ArcFace 5-point template), pixels normalized as (x - 127.5) / 127.5; output is a 512-d
embedding that the caller L2-normalizes. onnx2torch is used because coremltools dropped its
ONNX frontend; the graph is plain Conv/PReLU/Add/Gemm so the round trip is lossless.
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", required=True)
    ap.add_argument("--out", required=True, help="directory for FaceEmbedder.mlpackage/.mlmodelc")
    ap.add_argument("--fp32", action="store_true", help="keep fp32 weights (default fp16)")
    args = ap.parse_args()

    onnx_model = onnx.load(args.onnx)
    torch_model = convert(onnx_model).eval()

    example = torch.rand(1, 3, 112, 112) * 2 - 1
    traced = torch.jit.trace(torch_model, example)

    # ImageType input: Core ML takes an RGB CVPixelBuffer and applies scale/bias itself,
    # so Swift never touches pixel arrays. (x - 127.5) / 127.5 == x/127.5 - 1.
    inputs = [ct.ImageType(name="face", shape=(1, 3, 112, 112), scale=1 / 127.5, bias=[-1, -1, -1], color_layout=ct.colorlayout.RGB)]
    mlmodel = ct.convert(
        traced,
        inputs=inputs,
        outputs=[ct.TensorType(name="embedding")],
        minimum_deployment_target=ct.target.iOS17,
        convert_to="mlprogram",
        compute_precision=ct.precision.FLOAT32 if args.fp32 else ct.precision.FLOAT16,
        compute_units=ct.ComputeUnit.ALL,
    )
    mlmodel.short_description = "InsightFace buffalo_sc MobileFaceNet (w600k_mbf) face embedder, 112x112 aligned RGB in, 512-d out"
    mlmodel.author = "InsightFace (deepinsight), converted for Recall"
    mlmodel.license = "InsightFace model zoo: non-commercial research use"
    mlmodel.version = "buffalo_sc/w600k_mbf"

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    pkg = out / "FaceEmbedder.mlpackage"
    if pkg.exists():
        shutil.rmtree(pkg)
    mlmodel.save(str(pkg))

    # Sanity check against onnxruntime on the same random input.
    img = (np.random.rand(112, 112, 3) * 255).astype(np.uint8)
    x = (img.astype(np.float32).transpose(2, 0, 1)[None] - 127.5) / 127.5
    sess = ort.InferenceSession(args.onnx, providers=["CPUExecutionProvider"])
    ref = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
    from PIL import Image

    got = mlmodel.predict({"face": Image.fromarray(img)})["embedding"].reshape(-1)
    cos = float(np.dot(ref, got) / (np.linalg.norm(ref) * np.linalg.norm(got)))
    print(f"coreml vs onnxruntime cosine on random input: {cos:.5f}")

    compiled = out / "FaceEmbedder.mlmodelc"
    if compiled.exists():
        shutil.rmtree(compiled)
    subprocess.run(["xcrun", "coremlcompiler", "compile", str(pkg), str(out)], check=True)
    size = sum(p.stat().st_size for p in compiled.rglob("*") if p.is_file())
    print(f"wrote {pkg} and {compiled} ({size / 1e6:.1f} MB compiled)")


if __name__ == "__main__":
    main()
