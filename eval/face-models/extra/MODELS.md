# Candidate face-embedding models converted to Core ML (2026-10-24)

All four candidates converted and verified. Every model is at `extra/<name>/FaceEmbedder.mlmodelc`
(plus the `.mlpackage` it was compiled from and a `result.json` with the raw numbers).

Shared contract (verified by reading each saved spec back with coremltools):
ML program (`specificationVersion` 8 = iOS 17, opset CoreML7), fp16 compute precision
(all activation tensors FLOAT16; the handful of FLOAT32 tensors are the ImageType pre-processing
scale/bias and I/O), `compute_units=ALL`, one `ct.ImageType` input named `face` (1,3,112,112),
one output named `embedding` shaped (1, D). Verification = Core ML `predict()` on a PIL RGB image
vs the source runtime fed the same uint8 image through that model's *own* preprocessing, 3 random
uint8 images, seed 0. The caller L2-normalizes.

| name | model | D | params | .mlmodelc | input (ImageType) | min cosine vs source (3 random) | license | training data | IJB-C TAR@FAR=1e-4 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `edgeface_xs` | EdgeFace-XS (gamma 0.6), `edgeface_xs_gamma_06` | 512 | 1,770,492 | 3.81 MB | RGB, scale 1/127.5, bias -1 | 0.99989 (0.99998, 0.99999, 0.99989) | BSD-3-Clause | WebFace12M / WebFace4M subsets of WebFace260M (paper III-D) | 94.85 (paper Table II) |
| `edgeface_s` | EdgeFace-S (gamma 0.5), `edgeface_s_gamma_05` | 512 | 3,652,520 | 7.57 MB | RGB, scale 1/127.5, bias -1 | 0.99992 (0.99992, 0.99999, 0.99996) | BSD-3-Clause | same as above | 95.63 (paper Table II) |
| `sface` | SFace, OpenCV Zoo `face_recognition_sface_2021dec.onnx` (MobileFaceNet) | **128** | 9,642,880 | 19.36 MB | RGB, scale 1.0, bias 0 (raw 0..255) | 0.99999 (0.99999, 0.99999, 1.00000) | Apache-2.0 | not stated for this checkpoint (paper uses CASIA-WebFace / VGGFace2 / MS-Celeb-1M) | not reported for this checkpoint |
| `lvface_t` | LVFace-T (Glint360K), ViT, HF `bytedance-research/LVFace` | 512 | 19,137,536 | 38.45 MB | RGB, scale 1/127.5, bias -1 | 0.99999 (0.99999, 0.99999, 0.99999) | code MIT; model card says weights "non-commercial research purposes only" | Glint360K | 96.67 (HF model card table) |

Sizes are the sum of file sizes inside the compiled `.mlmodelc` (`du -sh` shows 3.6M / 7.2M / 18M / 37M).

Scripts (all in `extra/`, run from there with the venv python):
`convert_common.py` (shared convert + verify + compile), `convert_edgeface.py`, `convert_sface.py`,
`convert_lvface.py`. Downloads are under `extra/dl/` (`edgeface/` repo, `edgeface_ckpt/`,
`sface/`, `lvface/`, `lvface_repo/`, `papers/`).

## Per-model notes

### EdgeFace-XS (gamma 0.6) and EdgeFace-S (gamma 0.5)

- Source: https://github.com/otroshi/edgeface (torch hub `otroshi/edgeface`, hubconf names
  `edgeface_xs_gamma_06`, `edgeface_s_gamma_05`). Weights downloaded from the URLs in hubconf:
  `https://gitlab.idiap.ch/bob/bob.paper.tbiom2023_edgeface/-/raw/master/checkpoints/<name>.pt`
  (byte-identical copies are also committed in the GitHub repo's `checkpoints/`).
- Built with the repo's `backbones.get_model(name)`: `timm.create_model('edgenext_x_small'|'edgenext_small')`,
  `reset_classifier(512)`, then non-head `nn.Linear` layers replaced by low-rank `LoRaLin` pairs
  (rank ratio 0.6 / 0.5). `load_state_dict(strict=True)` succeeded with timm 1.0.30. Param counts
  above are `sum(p.numel())` of the loaded module and match the README (1.77 M / 3.65 M).
- Normalization: README/paper use mean 0.5, std 0.5 on 0..1 RGB == (x-127.5)/127.5, folded as
  scale 1/127.5, bias [-1,-1,-1]. Verified end to end (the reference fed the torch model with that
  exact arithmetic on the same uint8 image Core ML received).
- Conversion gotcha: `torch.jit.trace` + `ct.convert` FAILED with coremltools 9.0 / torch 2.14.1:
  `TypeError: only 0-dimensional arrays can be converted to Python scalars` at an `aten::Int` node.
  timm's EdgeNeXt `SplitTransposeBlock` computes `H*W` from `x.shape`, which the tracer records as a
  Long tensor + `aten::Int`; coremltools' `_cast` got a 1-element array instead of a scalar
  (torch 2.14 is newer than coremltools 9.0's tested 2.7). Fix that worked: export with
  `torch.export.export(model, (x,)).run_decompositions({})` (static shapes, so the shape math
  specializes to constants) and pass the ExportedProgram to `ct.convert`. Without
  `run_decompositions({})` coremltools rejects the TRAINING dialect. Exported-vs-eager cosine was
  1.000000 for both models before conversion.
- License: BSD-3-Clause (repo `LICENSE`, copyright 2024 Idiap authors). Verified from the file.
- Training data: paper (arXiv 2307.01838, IEEE T-BIOM 2024) section III-D says the models were
  trained on the WebFace12M and WebFace4M subsets of WebFace260M. Which subset produced the two
  released checkpoints is not stated in the text I read; assume WebFace12M for the headline models
  but treat as unconfirmed.
- IJB-C TAR@FAR=1e-4 (paper Table II, read from the arXiv HTML): EdgeFace-S gamma 0.5 = 95.63,
  EdgeFace-XS gamma 0.6 = 94.85 (abstract repeats 94.85 for the 1.77 M model). Table IV (ablation)
  lists 94.28 for XS gamma 0.6 under a different training run; Table II is the headline number.
- Core ML cosine is slightly lower than the others (min 0.99989 on XS); plausible fp16 effect on a
  hybrid attention network, still well above the 0.99 bar.

### SFace (OpenCV Zoo)

- Source: https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface
  (`face_recognition_sface_2021dec.onnx`, 38.7 MB fp32 ONNX, opset 11, MXNet export). The zoo README
  says the file is a MobileFaceNet trained with the SFace loss (Zhong & Deng, TIP 2021), converted by
  Chengrui Wang from https://github.com/zhongyy/SFace.
- Preprocessing verified from OpenCV `modules/objdetect/src/face_recognize.cpp`
  (`FaceRecognizerSFImpl::feature`): `blobFromImage(aligned, 1, Size(112,112), Scalar(0,0,0),
  swapRB=true, crop=false)`, i.e. BGR Mat -> RGB, raw 0..255 floats, no mean/scale. The ONNX graph
  then starts with `Sub(127.5)` and `Mul(0.0078125 = 1/128)` (confirmed by reading the initializers),
  so the normalization is already inside the network. Core ML ImageType is therefore RGB with
  scale=1.0, bias=[0,0,0]; the folded (x-127.5)/128 happens in-graph. Reference check fed
  onnxruntime the raw float RGB CHW image, exactly what `blobFromImage(..., swapRB=true)` yields.
- **Output is 128-d, not 512-d** (`fc1` [1,128] in the ONNX; Core ML `embedding` shape [1,128]).
  The benchmark harness must handle D=128 for this model.
- Converted via onnx2torch -> `torch.jit.trace` -> `ct.convert` exactly like the reference recipe.
  onnxruntime prints warnings that initializers appear as graph inputs (old export style); harmless.
- Params: 9,642,880 counted from ONNX float initializers excluding BN running mean/var
  (9,667,072 including them; onnx2torch's `nn.Parameter` count was 9,631,936). About 6.4 M of this is
  the single `pre_fc1` 128x50176 fully-connected layer, which is also why the fp16 `.mlmodelc` is
  19 MB despite being a MobileFaceNet.
- License: Apache-2.0 (`models/face_recognition_sface/LICENSE` in opencv_zoo). Verified from the file.
- Training data: NOT stated in the zoo README or the model file. The SFace paper trains on
  CASIA-WebFace, VGGFace2 and MS-Celeb-1M; which one this checkpoint used is unknown.
- IJB-C: the zoo reports only 0.9940 "accuracy" from its own eval tool (LFW-style). No IJB-C
  TAR@FAR=1e-4 for this checkpoint was found. Not reported.

### LVFace-T (Glint360K)

- Source: https://huggingface.co/bytedance-research/LVFace, files
  `LVFace-T_Glint360K/LVFace-T_Glint360K.onnx` (and `.pt`, a plain state_dict with keys
  `pos_embed`, `mask_token`, `patch_embed.proj.weight`, ...). Code: https://github.com/bytedance/LVFace
  (ICCV 2025 Highlight, arXiv 2501.13420). Architecture per `backbones/__init__.py` `vit_t`:
  ViT, img 112, patch 9, embed_dim 256, depth 12, heads 8, 512-d output.
- Preprocessing verified from `inference_onnx.py`: BGR->RGB, CHW, `((x/255)-0.5)/0.5`, which equals
  (x-127.5)/127.5 -> scale 1/127.5, bias [-1,-1,-1], RGB.
- Conversion path that worked on the first try: onnx2torch on the HF ONNX (opset 17, including
  `LayerNormalization`, dynamic `Shape/Gather/Reshape` chains) after pinning the dynamic
  `batch_size` dim to 1 in the graph I/O, then `torch.jit.trace` and `ct.convert`. onnx2torch
  emitted TracerWarnings about constant-folding Slice/Reshape shapes, which is exactly what we want
  for a fixed (1,3,112,112) input. torch-vs-onnxruntime cosine before conversion 1.000000.
  The PyTorch-weights fallback path (`convert_lvface.py ... pt`) is implemented but was not needed
  and was not run.
- Params: 19,137,536 from ONNX float initializers excluding BN running stats (.pt state_dict total
  19,139,330 including `mask_token` and BN stats). onnx2torch's own parameter count (76,800) is wrong
  because it registers MatMul weights as buffers; ignore the `params` line printed by the script.
- License: ambiguous. `LICENSE_CODE.txt` is MIT and the model card says "The code of LVFace is
  released under the MIT License. There is no limitation for both academic and commercial usage.",
  then immediately "The models downloaded from our repo follow the above license policy (which is
  for non-commercial research purposes only)." Treat the weights as non-commercial research only
  until clarified.
- Training data: Glint360K (in the model name and the model card table). Verified.
- IJB-C TAR@FAR=1e-4: 96.67 (model card table; also 95.63 @1e-5, 88.53 @1e-6, IJB-B 95.41 @1e-4).
  Verified from the HF README.
- Largest and slowest candidate (38 MB fp16, ~19 M params, 12 transformer blocks on 144 tokens).

## Verified vs assumed, in short

Verified: every number in the table except the two "training data" cells for EdgeFace (paper
names two subsets, release not pinned) and SFace (unknown); the EdgeFace/LVFace preprocessing
(from README/code) and SFace preprocessing (from OpenCV C++ source + ONNX initializers); input/output
names and shapes, spec version, fp16 dtypes, compiled sizes, and the cosine checks (all run here).
Assumed/not checked: Core ML numbers were produced on this Mac (macOS, compute_units ALL); on-device
ANE/GPU fp16 behavior may differ slightly. No alignment or real-face accuracy was measured; only
random-input agreement with the source runtime.
