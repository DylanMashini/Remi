"""LVFace-T (Glint360K) -> Core ML.

Usage: python convert_lvface.py <onnx_path> <pt_path> <lvface_repo_dir> <out_name> [onnx2torch|pt]

Preprocessing (LVFace/inference_onnx.py): BGR->RGB, CHW, ((x/255)-0.5)/0.5 == (x-127.5)/127.5
-> ImageType RGB, scale 1/127.5, bias -1.

Path A ("onnx2torch"): convert the HF ONNX graph with onnx2torch and trace.
Path B ("pt"): load the pickled PyTorch model from the HF repo with the LVFace repo's
backbones/vit.py on sys.path, eval(), trace.
Reference for the cosine check is always onnxruntime on the HF ONNX file.
"""

from __future__ import annotations

import sys
from pathlib import Path

import coremltools as ct
import numpy as np
import onnx
import onnxruntime as ort
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from convert_common import convert_and_verify, param_count  # noqa: E402

onnx_path, pt_path, repo, out_name = sys.argv[1:5]
path = sys.argv[5] if len(sys.argv) > 5 else "onnx2torch"

sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
in_name = sess.get_inputs()[0].name


def reference(img_hwc_rgb_u8: np.ndarray) -> np.ndarray:
    x = ((img_hwc_rgb_u8.astype(np.float32).transpose(2, 0, 1)[None] / 255.0) - 0.5) / 0.5
    return sess.run(None, {in_name: x})[0][0]


example = torch.rand(1, 3, 112, 112) * 2 - 1

if path == "onnx2torch":
    from onnx2torch import convert

    onnx_model = onnx.load(onnx_path)
    # Pin the dynamic batch dim so Shape/Gather/Reshape chains fold to constants.
    for t in list(onnx_model.graph.input) + list(onnx_model.graph.output):
        d = t.type.tensor_type.shape.dim[0]
        if d.dim_param:
            d.ClearField("dim_param")
            d.dim_value = 1
    torch_model = convert(onnx_model).eval()
else:
    sys.path.insert(0, repo)
    import backbones  # noqa: F401  (LVFace repo code, needed to unpickle)

    obj = torch.load(pt_path, map_location="cpu", weights_only=False)
    if isinstance(obj, dict):
        from backbones import get_model

        torch_model = get_model("vit_t", dropout=0.0, fp16=False, num_features=512)
        torch_model.load_state_dict(obj, strict=True)
    else:
        torch_model = obj
    torch_model = torch_model.float().eval()
    if hasattr(torch_model, "fp16"):
        torch_model.fp16 = False

n_params = param_count(torch_model)
print(f"[{out_name}] params: {n_params:,} ({n_params/1e6:.2f} M) via {path}")

with torch.no_grad():
    a = torch_model(example).float().numpy().reshape(-1)
    traced = torch.jit.trace(torch_model, example)
    b = traced(example).float().numpy().reshape(-1)
    r = sess.run(None, {in_name: example.numpy()})[0].reshape(-1)
    print(f"[{out_name}] torch vs onnxruntime cosine: {float(a @ r / (np.linalg.norm(a) * np.linalg.norm(r))):.6f}; "
          f"trace vs eager: {float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b))):.6f}")

res = convert_and_verify(
    name=out_name,
    traced=traced,
    size=112,
    scale=1 / 127.5,
    bias=[-1, -1, -1],
    color_layout=ct.colorlayout.RGB,
    reference=reference,
    meta={
        "description": "LVFace-T (Glint360K) ViT face embedder (ByteDance), 112x112 aligned RGB in, 512-d out",
        "author": "Jinghan You et al. (ByteDance), ICCV 2025",
        "license": "Code MIT (LICENSE_CODE.txt); model card says weights are 'for non-commercial research purposes only'",
        "version": "LVFace-T_Glint360K",
        "params": n_params,
        "source": "https://huggingface.co/bytedance-research/LVFace (LVFace-T_Glint360K/*.onnx|*.pt), code https://github.com/bytedance/LVFace",
        "conversion_path": path,
    },
)
print(res)
