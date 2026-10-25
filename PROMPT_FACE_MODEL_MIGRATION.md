# Prompt: migrate on-device face recognition to ResNet50 ArcFace at threshold 0.30

Read `CLAUDE.md`, `apps/mobile/AGENTS.md`, `CONTRACT.md`, the "On-device face recognition" and
"Face model evaluation" sections of `NOTES.md`, and `eval/face-models/README.md` + `RESULTS.md`
first. This change touches the demo's first beat (who is this?), so it has to land, be rebuilt
on the real phone, and be rehearsed before the Sunday 10:30 AM freeze. If it is Sunday morning,
ask before starting, per the working-style rules.

## Why

The evaluation in `eval/face-models/` ran the exact phone pipeline (Vision box, 1.3x crop, Core ML)
over the 6,000 official LFW pairs plus glasses-like 56 px and 40 px probes. Two findings drive this
task:

1. The 0.50 match threshold was carried over from InsightFace's landmark-aligned pipeline. Through
   our Vision box crop, same-person scores run lower: the shipped MobileFaceNet accepts only
   77% / 60% / 30% of same-person pairs (clean / 56 px / 40 px) at 0.50, while strangers never
   reach 0.30. That is the "it frequently misses" we see.
2. ResNet50 ArcFace (`w600k_r50` from InsightFace `buffalo_l`) has the same input contract, runs in
   1.6 ms per face on the Neural Engine, and at threshold 0.30 accepts 99.0% / 98.9% / 96.6% with
   zero stranger accepts in 9,000 comparisons. TAR at 0.1% FAR on 40 px faces is 98.6% versus
   93.3% for the shipped model.

Same license as what ships today (InsightFace model zoo, non-commercial research), so nothing
about the product story changes. See the EdgeFace-S section at the end if a permissive license
becomes the priority.

## What to build

Swap the compiled model, move every threshold that depends on the embedder to one place, make
persisted embeddings self-invalidating, update the docs and the self-test, rebuild the dev
client, and verify on the real phone.

### 1. Convert and ship the model

- Download `buffalo_l.zip` (InsightFace v0.7 release) and convert `w600k_r50.onnx` with
  `eval/face-models/convert_onnx.py` (it generalizes the module's `convert_face_model.py`; keep
  the recipe identical: onnx2torch, `torch.jit.trace`, `ct.convert(convert_to="mlprogram")`,
  fp16, `ImageType(scale=1/127.5, bias=-1)`, iOS 17 target). Output goes to
  `apps/mobile/modules/glasses/ios/Models/FaceEmbedder.mlmodelc`, replacing the MobileFaceNet.
  Set `--name "InsightFace buffalo_l ResNet50 (w600k_r50)"` and the license string.
- The conversion script must print cosine agreement with onnxruntime ≥ 0.997 (the eval got
  0.998 on random inputs; real faces agree more closely). Record the number in `NOTES.md`.
- Compiled size is about 83 MB, a single `weight.bin`. That is under GitHub's 100 MB hard limit
  but over its 50 MB warning; commit it once and do not churn it. The `.mlpackage` stays
  gitignored. Do not add Git LFS for this (nobody else clones the repo this weekend).
- Fold `convert_face_model.py` into a thin wrapper around the eval converter, or delete it and
  point `scripts/README.md` at `eval/face-models/convert_onnx.py`. One converter, not two.
- Keep `computeUnits = .all` in `FaceRecognizer.load`. `MLComputePlan` showed every compute op of
  this ResNet on the Neural Engine under `.all` (`eval/face-models/ComputePlan.swift`). Do not
  pin to `.cpuAndNeuralEngine` for this model; that is only needed for EdgeFace/LVFace.

### 2. Thresholds, in one place

Add a `FaceModel` (or similar) enum/namespace in `FaceRecognizer.swift` that names the model
(`"w600k_r50"`), its embedding dimension (512), and every score threshold the app uses, with a
comment pointing at `eval/face-models/RESULTS.md` for where each number comes from. Replace the
scattered constants with references to it:

| Constant | Today | New | Reason |
|---|---|---|---|
| `LocalRecognition.matchThreshold` | 0.50 | **0.30** | ResNet50 clean/56/40 px same-person acceptance 99.0 / 98.9 / 96.6% with 0 strangers in 9,000 comparisons; different-person p99 is 0.14. |
| `PhotoIndex.matchThreshold` (library suggestions) | 0.45 | **0.40** | Suggestions are human-filtered, so recall matters more; ResNet50 same-person p10 on clean photos is 0.53, strangers p99 0.14. |
| `PhotoIndex.diversityThreshold` | 0.92 | 0.92 | Near-duplicate detection, model-independent enough. Leave it. |
| `Enroll` seed rejection (`PhotoIndex`, cosine to seed < 0.4) | 0.40 | 0.40 | Already below same-person p10. Leave it. |

Do not change the debounce windows or the "someone new is here" rules.

### 3. Persisted embeddings must know which model made them

- `PhotoIndex` writes `index.json` with `formatVersion = 2` and MobileFaceNet embeddings. Those
  are meaningless to the new model. Add a `model` string to the sidecar, bump `formatVersion`
  to 3, and discard the checkpoint when either mismatches (the existing version check already
  logs and rebuilds). The index then rebuilds in the background on next launch; that is expected.
- `LocalRecognition.embeddingByFile` is in-memory only and refilled by `syncRoster`, so the
  roster re-embeds on the next launch. Confirm that `syncRoster` runs after `FaceRecognizer.load`
  and before the first stream frame; it does today via `GlassesController`.
- Nothing on the server stores embeddings (the Python sidecar was removed Oct 24), and
  `apps/web` has no score threshold of its own. Scores posted to `/api/recognitions` will simply
  be on the new scale; check the dashboard does not colour or filter by score anywhere.

### 4. Load time on the phone

The eval measured 82 ms to load the compiled ResNet50 on a Mac once cached, but the first load
on a device compiles for the Neural Engine and can take seconds for an 83 MB model.
`GlassesController` already calls `FaceRecognizer.shared.load()` at init; make sure that call is
off the main thread (it is synchronous today) and that `startStream` waits for it rather than
dropping the first frames with "model not loaded". Log the load time with `NSLog` the way
`FaceRecognizer.load` already does, and record the device number in `NOTES.md`.

### 5. Docs and self-test

- `FaceRecognizer.swift` header comment: it says MobileFaceNet (buffalo_sc). Update.
- `apps/mobile/modules/glasses/scripts/README.md`: model, source, size, license, the new
  reference numbers.
- `reference_embeddings.py` and `FaceSelfTest.swift`: the self-test compares against the `mbf`
  key from `buffalo_sc`. Switch the reference to `buffalo_l` (`w600k_r50`) so the DEBUG self-test
  still proves Core ML agrees with onnxruntime, and rerun it on the simulator (CPU-only there).
- `CONTRACT.md`, "Glasses pipeline": names buffalo_sc, 6.6 MB, and "known if score ≥ 0.5". Update
  all three.
- `NOTES.md`: add a "Face model migration" entry with the device load time, per-face embed time,
  roster sync time, and any gotcha.

### 6. Rebuild and verify on the real phone

Changing the resource bundle contents does not need `pnpm prebuild`; the device build commands
in `HANDOFF.md` (xcodebuild + `devicectl install`) are enough. Then, with the glasses:

1. Launch, watch the log for the model load time and the roster sync count.
2. Enrolled person at about 1 m: expect a score around 0.6 or higher and the spoken line within
   2 s. Note the score.
3. Same person at about 2.5 m (face roughly 40 px in the 504x896 frame): expect recognition.
   Note the score.
4. A non-enrolled person: expect "someone new is here" and a score under 0.2.
5. Enroll someone live from the add-person screen, confirm library suggestions still appear
   (index rebuilt) and recognition on return.

Write the four scores into `NOTES.md`. If step 3 fails but step 2 passes, the face is under the
36 px gate; do not lower `minFaceSide`, consider the `.high` stream preset instead and say so.

### 7. Rollback

One commit, so one revert. Keep the MobileFaceNet `.mlmodelc` retrievable from git history and
note the revert command in `NOTES.md`.

## Hard rules

1. Do not edit `apps/mobile/ios/` by hand. The model is a podspec resource bundle; that stays.
2. Do not restructure the frame path (`handleVideoFrame` → `LocalRecognition.offer`). This is a
   model and threshold swap.
3. Frames still never leave the phone; nothing new is uploaded.
4. Update `CONTRACT.md` before changing either side, as always.
5. Run `pnpm typecheck` and `npx expo lint` before declaring done, even though this is mostly
   Swift. Done means it ran end to end on the real phone with the real glasses.

## 
