# Face embedder evaluation (LFW, phone pipeline)

Host: macOS Version 27.0.1 (Build 26A434), Apple Vision face detection median 4.7 ms per image. 16397 of 16853 images had a usable face (Vision box ≥ 36 px).

## Speed and size

| Model | Params | Compiled size | Load | Embed median, `.all` (during the run) | p90 | Embed median, `.cpuAndNeuralEngine` (isolated) | License |
|---|---|---|---|---|---|---|---|
| MobileFaceNet (InsightFace buffalo_sc) — shipped today | 1.0 M | 6.6 MB | 36 ms | 0.69 ms | 0.91 ms | 0.41 ms | InsightFace zoo, non-commercial research |
| EdgeFace-XS γ0.6 (Idiap) | 1.8 M | 3.8 MB | 248 ms | 4.82 ms | 5.45 ms | 0.29 ms | BSD-3-Clause |
| EdgeFace-S γ0.5 (Idiap) | 3.7 M | 7.6 MB | 219 ms | 5.04 ms | 5.58 ms | 0.59 ms | BSD-3-Clause |
| SFace 2021dec (OpenCV Zoo, 128-d) | 9.6 M | 19 MB | 353 ms | 1.53 ms | 2.13 ms | 0.66 ms | Apache-2.0 |
| LVFace-T (ByteDance, ViT) | 19.1 M | 38 MB | 305 ms | 5.20 ms | 7.41 ms | 1.14 ms | code MIT; weights non-commercial research |
| ResNet50 ArcFace (InsightFace buffalo_l) | 43.6 M | 83 MB | 82 ms | 2.76 ms | 3.63 ms | 1.58 ms | InsightFace zoo, non-commercial research |
| ResNet100 ArcFace (InsightFace antelopev2) | 65 M | 131 MB | 73 ms | 3.73 ms | 4.57 ms | 2.41 ms | InsightFace zoo, non-commercial research |

`.all` is what the app uses today and what FaceEval ran with, measured while Vision and six other models shared the Neural Engine. The isolated column is ComputePlan.swift with `computeUnits = .cpuAndNeuralEngine`, 50 predictions on one crop. For EdgeFace and LVFace, Core ML's automatic placement under `.all` prefers the GPU even though every op is Neural Engine capable, which is why their `.all` numbers are 5 to 10x worse; pin them to the Neural Engine if adopted.

## Clean vs clean (standard LFW)

| Model | 10-fold acc | TAR@1% FAR | TAR@0.1% FAR | acc @0.50 | end-to-end @0.50 | miss rate | same mean / p10 | diff mean / p99 | best thr |
|---|---|---|---|---|---|---|---|---|---|
| MobileFaceNet (InsightFace buffalo_sc) — shipped today | 99.35% | 99.13% | 98.50% | 88.51% | 88.50% | 0.02% | 0.58 / 0.42 | 0.00 / 0.16 | 0.22 |
| EdgeFace-XS γ0.6 (Idiap) | 99.13% | 99.17% | 98.37% | 96.10% | 96.08% | 0.02% | 0.67 / 0.52 | 0.01 / 0.23 | 0.26 |
| EdgeFace-S γ0.5 (Idiap) | 99.32% | 99.20% | 98.67% | 97.83% | 97.82% | 0.02% | 0.71 / 0.58 | 0.01 / 0.26 | 0.32 |
| SFace 2021dec (OpenCV Zoo, 128-d) | 98.92% | 98.53% | 97.90% | 95.98% | 95.97% | 0.02% | 0.66 / 0.52 | 0.11 / 0.32 | 0.33 |
| LVFace-T (ByteDance, ViT) | 99.52% | 99.30% | 99.13% | 94.28% | 94.27% | 0.02% | 0.63 / 0.49 | 0.00 / 0.15 | 0.19 |
| ResNet50 ArcFace (InsightFace buffalo_l) | 99.65% | 99.47% | 99.33% | 96.42% | 96.40% | 0.02% | 0.66 / 0.53 | 0.00 / 0.14 | 0.22 |
| ResNet100 ArcFace (InsightFace antelopev2) | 99.57% | 99.43% | 99.30% | 98.32% | 98.30% | 0.02% | 0.69 / 0.57 | 0.00 / 0.15 | 0.28 |

## Clean enrollment photo vs glasses-like frame: face ≈ 56 px wide, JPEG q50

| Model | 10-fold acc | TAR@1% FAR | TAR@0.1% FAR | acc @0.50 | end-to-end @0.50 | miss rate | same mean / p10 | diff mean / p99 | best thr |
|---|---|---|---|---|---|---|---|---|---|
| MobileFaceNet (InsightFace buffalo_sc) — shipped today | 99.33% | 99.16% | 97.53% | 80.20% | 80.12% | 0.27% | 0.52 / 0.36 | 0.01 / 0.17 | 0.20 |
| EdgeFace-XS γ0.6 (Idiap) | 99.10% | 99.13% | 97.76% | 92.80% | 92.68% | 0.27% | 0.63 / 0.47 | 0.01 / 0.23 | 0.25 |
| EdgeFace-S γ0.5 (Idiap) | 99.18% | 99.26% | 98.30% | 96.17% | 96.05% | 0.27% | 0.66 / 0.52 | 0.01 / 0.25 | 0.28 |
| SFace 2021dec (OpenCV Zoo, 128-d) | 98.60% | 98.16% | 95.79% | 92.11% | 92.00% | 0.27% | 0.61 / 0.46 | 0.10 / 0.31 | 0.33 |
| LVFace-T (ByteDance, ViT) | 99.40% | 99.23% | 99.00% | 86.45% | 86.35% | 0.27% | 0.56 / 0.41 | 0.00 / 0.15 | 0.18 |
| ResNet50 ArcFace (InsightFace buffalo_l) | 99.57% | 99.50% | 99.33% | 91.51% | 91.40% | 0.27% | 0.59 / 0.46 | 0.00 / 0.14 | 0.20 |
| ResNet100 ArcFace (InsightFace antelopev2) | 99.60% | 99.50% | 99.30% | 95.47% | 95.35% | 0.27% | 0.63 / 0.50 | 0.00 / 0.15 | 0.21 |

## Clean enrollment photo vs glasses-like frame: face ≈ 40 px wide, JPEG q40

| Model | 10-fold acc | TAR@1% FAR | TAR@0.1% FAR | acc @0.50 | end-to-end @0.50 | miss rate | same mean / p10 | diff mean / p99 | best thr |
|---|---|---|---|---|---|---|---|---|---|
| MobileFaceNet (InsightFace buffalo_sc) — shipped today | 98.67% | 98.27% | 93.26% | 64.86% | 63.52% | 9.75% | 0.44 / 0.29 | 0.01 / 0.16 | 0.17 |
| EdgeFace-XS γ0.6 (Idiap) | 98.82% | 98.67% | 95.03% | 85.47% | 82.12% | 9.75% | 0.55 / 0.40 | 0.01 / 0.23 | 0.24 |
| EdgeFace-S γ0.5 (Idiap) | 98.89% | 98.82% | 95.17% | 90.36% | 86.53% | 9.75% | 0.59 / 0.45 | 0.01 / 0.25 | 0.28 |
| SFace 2021dec (OpenCV Zoo, 128-d) | 97.97% | 96.98% | 93.18% | 81.33% | 78.38% | 9.75% | 0.53 / 0.39 | 0.09 / 0.30 | 0.29 |
| LVFace-T (ByteDance, ViT) | 98.91% | 98.78% | 97.68% | 69.03% | 67.28% | 9.75% | 0.46 / 0.31 | 0.00 / 0.15 | 0.16 |
| ResNet50 ArcFace (InsightFace buffalo_l) | 99.39% | 99.23% | 98.56% | 78.12% | 75.48% | 9.75% | 0.51 / 0.38 | 0.00 / 0.14 | 0.17 |
| ResNet100 ArcFace (InsightFace antelopev2) | 99.46% | 99.34% | 98.97% | 84.21% | 80.98% | 9.75% | 0.54 / 0.41 | 0.00 / 0.16 | 0.19 |

## Threshold sweep, clean vs clean: same-person accept rate / stranger accept rate (per comparison)

| Model | thr 0.20 | thr 0.25 | thr 0.30 | thr 0.35 | thr 0.40 | thr 0.50 |
|---|---|---|---|---|---|---|
| MobileFaceNet (InsightFace buffalo_sc) — shipped today | 99.1% / 0.33% | 98.6% / 0.10% | 98.0% / 0.07% | 96.3% / 0.00% | 92.5% / 0.00% | 77.0% / 0.00% |
| EdgeFace-XS γ0.6 (Idiap) | 99.3% / 2.63% | 99.1% / 0.60% | 98.6% / 0.20% | 98.2% / 0.03% | 97.1% / 0.00% | 92.2% / 0.00% |
| EdgeFace-S γ0.5 (Idiap) | 99.3% / 3.20% | 99.2% / 1.13% | 99.1% / 0.37% | 98.8% / 0.13% | 98.3% / 0.00% | 95.7% / 0.00% |
| SFace 2021dec (OpenCV Zoo, 128-d) | 99.5% / 15.77% | 99.1% / 6.03% | 98.7% / 1.63% | 98.0% / 0.10% | 97.1% / 0.03% | 92.0% / 0.00% |
| LVFace-T (ByteDance, ViT) | 99.2% / 0.10% | 99.0% / 0.03% | 98.7% / 0.00% | 97.6% / 0.00% | 96.2% / 0.00% | 88.6% / 0.00% |
| ResNet50 ArcFace (InsightFace buffalo_l) | 99.3% / 0.13% | 99.3% / 0.00% | 99.0% / 0.00% | 98.7% / 0.00% | 97.8% / 0.00% | 92.8% / 0.00% |
| ResNet100 ArcFace (InsightFace antelopev2) | 99.4% / 0.17% | 99.3% / 0.10% | 99.3% / 0.00% | 99.1% / 0.00% | 98.8% / 0.00% | 96.6% / 0.00% |

## Threshold sweep, clean vs face ≈ 56 px: same-person accept rate / stranger accept rate (per comparison)

| Model | thr 0.20 | thr 0.25 | thr 0.30 | thr 0.35 | thr 0.40 | thr 0.50 |
|---|---|---|---|---|---|---|
| MobileFaceNet (InsightFace buffalo_sc) — shipped today | 98.9% / 0.30% | 98.0% / 0.10% | 95.8% / 0.00% | 91.9% / 0.00% | 85.6% / 0.00% | 60.4% / 0.00% |
| EdgeFace-XS γ0.6 (Idiap) | 99.3% / 2.51% | 98.9% / 0.57% | 98.5% / 0.27% | 97.5% / 0.00% | 95.4% / 0.00% | 85.6% / 0.00% |
| EdgeFace-S γ0.5 (Idiap) | 99.5% / 3.81% | 99.3% / 1.07% | 98.9% / 0.37% | 98.4% / 0.13% | 97.6% / 0.00% | 92.3% / 0.00% |
| SFace 2021dec (OpenCV Zoo, 128-d) | 99.3% / 13.27% | 99.0% / 5.58% | 98.5% / 1.57% | 97.4% / 0.20% | 95.4% / 0.00% | 84.2% / 0.00% |
| LVFace-T (ByteDance, ViT) | 99.0% / 0.03% | 98.5% / 0.00% | 97.5% / 0.00% | 95.0% / 0.00% | 90.8% / 0.00% | 72.9% / 0.00% |
| ResNet50 ArcFace (InsightFace buffalo_l) | 99.4% / 0.17% | 99.2% / 0.03% | 98.9% / 0.00% | 97.6% / 0.00% | 95.5% / 0.00% | 83.0% / 0.00% |
| ResNet100 ArcFace (InsightFace antelopev2) | 99.5% / 0.23% | 99.3% / 0.07% | 99.1% / 0.00% | 98.6% / 0.00% | 97.8% / 0.00% | 90.9% / 0.00% |

## Threshold sweep, clean vs face ≈ 40 px: same-person accept rate / stranger accept rate (per comparison)

| Model | thr 0.20 | thr 0.25 | thr 0.30 | thr 0.35 | thr 0.40 | thr 0.50 |
|---|---|---|---|---|---|---|
| MobileFaceNet (InsightFace buffalo_sc) — shipped today | 97.2% / 0.22% | 94.8% / 0.07% | 88.3% / 0.00% | 79.1% / 0.00% | 65.6% / 0.00% | 29.9% / 0.00% |
| EdgeFace-XS γ0.6 (Idiap) | 98.9% / 2.89% | 98.5% / 0.78% | 97.1% / 0.19% | 94.7% / 0.04% | 89.9% / 0.00% | 71.0% / 0.00% |
| EdgeFace-S γ0.5 (Idiap) | 99.1% / 3.41% | 98.8% / 1.00% | 98.0% / 0.30% | 96.8% / 0.15% | 94.0% / 0.00% | 80.8% / 0.00% |
| SFace 2021dec (OpenCV Zoo, 128-d) | 98.9% / 12.11% | 98.2% / 4.18% | 97.0% / 1.04% | 94.2% / 0.22% | 88.8% / 0.00% | 62.7% / 0.00% |
| LVFace-T (ByteDance, ViT) | 97.9% / 0.07% | 96.0% / 0.00% | 91.6% / 0.00% | 84.7% / 0.00% | 72.2% / 0.00% | 38.2% / 0.00% |
| ResNet50 ArcFace (InsightFace buffalo_l) | 98.7% / 0.11% | 98.2% / 0.04% | 96.6% / 0.00% | 92.8% / 0.00% | 86.7% / 0.00% | 56.3% / 0.00% |
| ResNet100 ArcFace (InsightFace antelopev2) | 99.1% / 0.11% | 98.5% / 0.04% | 97.7% / 0.04% | 95.9% / 0.00% | 92.3% / 0.00% | 68.5% / 0.00% |
