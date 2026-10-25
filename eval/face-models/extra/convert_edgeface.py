"""EdgeFace (otroshi/edgeface) -> Core ML.

Usage: python convert_edgeface.py <edgeface_repo_dir> <checkpoint.pt> <hub_name> <out_name>
Normalization: mean 0.5 / std 0.5 on 0..1 RGB == (x-127.5)/127.5 -> scale 1/127.5, bias -1.
"""

from __future__ import annotations

import sys
from pathlib import Path

import coremltools as ct
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from convert_common import convert_and_verify, param_count  # noqa: E402

repo, ckpt, hub_name, out_name = sys.argv[1:5]
sys.path.insert(0, repo)
from backbones import get_model  # noqa: E402  (EdgeFace repo code)

model = get_model(hub_name)
sd = torch.load(ckpt, map_location="cpu", weights_only=True)
missing, unexpected = model.load_state_dict(sd, strict=True), None
model.eval()
n_params = param_count(model)
print(f"[{out_name}] params: {n_params:,} ({n_params/1e6:.2f} M)")

example = torch.rand(1, 3, 112, 112) * 2 - 1
# torch.jit.trace of timm EdgeNeXt records H*W from x.shape as a Long tensor + aten::Int, which
# coremltools 9.0 (with torch 2.14) rejects ("only 0-dimensional arrays can be converted").
# torch.export with static shapes specializes that arithmetic to constants, so use it instead.
with torch.no_grad():
    traced = torch.export.export(model, (example,)).run_decompositions({})
    a = model(example).numpy().reshape(-1)
    b = traced.module()(example).numpy().reshape(-1)
    print(f"[{out_name}] exported vs eager cosine: {float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b))):.6f}")


def reference(img_hwc_rgb_u8: np.ndarray) -> np.ndarray:
    x = (img_hwc_rgb_u8.astype(np.float32).transpose(2, 0, 1)[None] - 127.5) / 127.5
    with torch.no_grad():
        return model(torch.from_numpy(x)).numpy()[0]


res = convert_and_verify(
    name=out_name,
    traced=traced,
    size=112,
    scale=1 / 127.5,
    bias=[-1, -1, -1],
    color_layout=ct.colorlayout.RGB,
    reference=reference,
    meta={
        "description": f"EdgeFace {hub_name} face embedder (Idiap), 112x112 aligned RGB in, 512-d out",
        "author": "Anjith George, Christophe Ecabert, Hatef Otroshi Shahreza, Ketan Kotwal, Sebastien Marcel (Idiap)",
        "license": "BSD-3-Clause (repo LICENSE)",
        "version": hub_name,
        "params": n_params,
        "conversion_path": "torch.export (static shapes) -> ct.convert",
        "source": "https://github.com/otroshi/edgeface (torch hub otroshi/edgeface), weights https://gitlab.idiap.ch/bob/bob.paper.tbiom2023_edgeface/-/raw/master/checkpoints/" + Path(ckpt).name,
    },
)
print(res)
