"""SFace (OpenCV Zoo face_recognition_sface_2021dec.onnx) -> Core ML.

Usage: python convert_sface.py <onnx_path> <out_name>

Preprocessing, from opencv/modules/objdetect/src/face_recognize.cpp FaceRecognizerSFImpl::feature():
    blobFromImage(aligned, scalefactor=1, Size(112,112), mean=Scalar(0,0,0), swapRB=true, crop=false)
i.e. BGR cv::Mat -> RGB, raw 0..255 floats, no mean/scale. The ONNX graph itself then does
Sub(127.5) and Mul(1/128) as its first two nodes, so the Core ML ImageType is RGB with
scale=1, bias=0 and the folded normalization lives inside the network.
"""

from __future__ import annotations

import sys
from pathlib import Path

import coremltools as ct
import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnx2torch import convert

sys.path.insert(0, str(Path(__file__).resolve().parent))
from convert_common import convert_and_verify, param_count  # noqa: E402

onnx_path, out_name = sys.argv[1:3]
onnx_model = onnx.load(onnx_path)
torch_model = convert(onnx_model).eval()
n_params = param_count(torch_model)
print(f"[{out_name}] params (onnx2torch module): {n_params:,} ({n_params/1e6:.2f} M)")

example = torch.rand(1, 3, 112, 112) * 255
with torch.no_grad():
    traced = torch.jit.trace(torch_model, example)

sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
in_name = sess.get_inputs()[0].name


def reference(img_hwc_rgb_u8: np.ndarray) -> np.ndarray:
    # Exactly what cv2.dnn.blobFromImage(bgr, 1.0, (112,112), (0,0,0), swapRB=True) yields.
    x = img_hwc_rgb_u8.astype(np.float32).transpose(2, 0, 1)[None]
    return sess.run(None, {in_name: x})[0][0]


res = convert_and_verify(
    name=out_name,
    traced=traced,
    size=112,
    scale=1.0,
    bias=[0.0, 0.0, 0.0],
    color_layout=ct.colorlayout.RGB,
    reference=reference,
    meta={
        "description": "SFace (OpenCV Zoo face_recognition_sface_2021dec) face embedder, 112x112 aligned RGB raw 0..255 in, 128-d out",
        "author": "Yaoyao Zhong, Weihong Deng (SFace); OpenCV Zoo",
        "license": "Apache-2.0 (opencv_zoo/models/face_recognition_sface/LICENSE)",
        "version": "face_recognition_sface_2021dec",
        "params": n_params,
        "source": "https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface",
    },
)
print(res)
