# Build notes (feeds the Devpost write-up)

## Meta DAT SDK gotchas

- Register glasses silently did nothing after testing Mock Device Kit: MockDeviceKit stays enabled and reports "registered", so startRegistration was skipped. register() now leaves mock mode first. Also set MWDAT TeamID to $(DEVELOPMENT_TEAM) (empty TeamID counts as misconfigured) and added the HotspotConfiguration entitlement needed for Wi-Fi streaming.

<!-- Append: date/time, what broke, what fixed it. -->

- Oct 24 (integration): the `expo-camera` config plugin with `microphonePermission: false` *deletes* `NSMicrophoneUsageDescription` (createPermissionsPlugin treats false as remove), which would kill the ask mic. Pass the real mic string instead.
- Expo SDK 58 / RN 0.88 (mobile UI): `StyleSheet.absoluteFillObject` is gone (use `absoluteFill`), TextInput refs are typed `TextInputInstance`, and the bundled React Compiler lint rules reject `Date.now()` in render and `setState` directly in an effect. `npx expo install expo-secure-store` silently adds its config plugin to app.json.
- Oct 24: DAT 1.0.1 ships as binary *dynamic* xcframeworks inside a Swift package. RN 0.88's `spm_dependency` only links SPM products into the (static) `Glasses` pod target, so nothing would embed the dynamic frameworks in the app (not tried; RN itself warns about linker issues with static linkage). Chosen instead: `Glasses.podspec` runs `ios/scripts/fetch-dat.sh` at pod-install time to vendor MWDATCore/Camera/MockDevice xcframeworks (gitignored) via `vendored_frameworks`; CocoaPods embeds them. Builds on Xcode 27.1.
- Oct 24: DAT URL callback under Expo 58's scene lifecycle: `ExpoAppSceneDelegate` re-feeds `openURLContexts` to app-delegate subscribers, so an `ExpoAppDelegateSubscriber` with `application(_:open:options:)` filtering on `metaWearablesAction` is enough to call `Wearables.shared.handleUrl`.
- Oct 24: In-band glasses mic audio needs the `.microphone` DAT permission and `audioCodec: .pcm(...)` on `StreamConfiguration`; MockDeviceKit never delivers audio frames. The module falls back to AVAudioEngine on the phone mic (play-and-record, A2DP-only options so output stays hi-fi) if no in-band audio arrives within 4 s.
- Oct 24: `MWDATMockDevice.framework` contains `display-preview/preview.js`; `expo lint` on `modules/` lints it (1.6k errors). Ignore `modules/glasses/ios/Frameworks/**`.

- Oct 24 (mobile UI pass): the bundled React Compiler lint rejects `useRef(new Animated.Value(0)).current` read in render ("Cannot access refs during render"); hold the value in `useState(() => new Animated.Value(0))` instead. It also rejects `Date.now()` anywhere reachable from render, including inside a handler defined in the component; sample "now" into state on a timer.
- Oct 24: `expo start --web` cannot server-render this app: `@expo/ui/swift-ui` (used for the reminder date picker) has no web implementation and throws `requireNativeViewManager is not available on web` during SSR. Web is not a target, so the UI is verified on the device only.
- Oct 24: no iOS simulator runtime is installed on the dev Mac, so simulator builds are not an option for UI checks; JS changes are checked with `tsc`, `expo lint`, and `expo export --platform ios`, then hot-reloaded on the phone.
- Oct 24: the native stack `formSheet` + `fitToContents` presentation was avoided for the reminder sheet: with a `flex: 1` SafeAreaView root the detent has no intrinsic height to fit. Plain `modal` is reliable.
- Oct 24 (Remember feature): expo-router native tabs take `index` as the initial tab, so making Today the default meant renaming `(tabs)/today.tsx` to `index.tsx` and the Live screen to `live.tsx` (no `initialRouteName` plumbing). `router.navigate('/(tabs)/remember')` works from any tab.
- Oct 24: Prisma 7's `migrate dev` is interactive; `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/<ts>_<name>/migration.sql` then `migrate deploy` is the non-interactive path (used for `20261024223000_remember`). Adding a value to a Postgres enum (`EventType.PRACTICE`) is a plain `ALTER TYPE ... ADD VALUE`.
- Oct 24 (glasses button): DAT 1.0.1 has an Inputs capability (`MWDATInputs.xcframework`, beta, dev/beta release channels only) that reports the capture button (top right of the right temple) as one `.capture(.shortPress|.hold|.doublePress)` event per press, fired on release, plus `.button(.action)` for the action button (Meta says action-button support is unvalidated on some hardware). No user permission prompt is needed. `session.addInputs(configuration:)` must be called on a *started* session (returns nil otherwise) and throws if already attached; any error leaves it attached, so `removeInputs()` before re-adding. Events arrive on an `AsyncStream` that buffers 64 and drops the oldest. Added `MWDATInputs` to `fetch-dat.sh` and the podspec; the dev client must be rebuilt (`pnpm prebuild`, then the HANDOFF.md xcodebuild commands). A press calls `whoIsHere` on the phone: the latest matched frame (≤1.5 s old, else wait up to 2.5 s for the next) is announced with the 5 min / 60 s cooldown skipped, or "I don't see anyone right now." Open question until tried on real glasses: whether a short press still makes Meta AI take its own photo while our stream runs. MockDeviceKit may report the capability unavailable; the stream carries on and `Glasses.whoIsHere()` from JS exercises the same path.
- Oct 24: The Swift module gained `startListening`/`stopListening` (same `AudioCapture.startAsk/stopAsk` path, posts to `/api/transcribe`). Native change: the dev client must be rebuilt (`pnpm prebuild`, then the xcodebuild/devicectl commands in HANDOFF.md). Until then `glassesHas('startListening')` is false and the Remember screen falls back to typing.

- Oct 25 ("Glasses not connected" while paired): a DAT `DeviceSession` exists only while a stream runs, so deriving the connection pill from session state said "not connected" whenever the glasses were paired and idle, and stayed that way after a hinge-close `.stopped` until the next start. `Wearables.shared.devices` + `Device.linkState` (`addLinkStateListener`, re-subscribed on `addDevicesListener`) is the Bluetooth truth; the controller now reports the best link across devices when there is no session. MockDeviceKit glasses appear in the same device list. Native change: rebuild the dev client.

- Oct 24 (TTS): ElevenLabs audio tags (`[laughs]`, `[whispers]`) are not sanitized anywhere; `eleven_flash_v2_5` simply ignores them. Only the v3/v4 family performs them, and `eleven_v4_turbo` (~100 ms, works on the free plan with the premade Bella voice: 200 on the first try) does it at Flash-like latency. `lib/tts.ts` now switches to v4 Turbo only for lines that contain a tag and keys those speech ids by model too, so the Flash-era cached MP3 of a tagged line is never replayed. Tags are stripped from the displayed/logged text, so a caregiver note of `[evil laugh]` is heard but never shown on screen.

## On-device face recognition (Oct 24 evening; now the only path)

- coremltools 9 has no ONNX frontend any more; the path that worked for InsightFace's `w600k_mbf.onnx` (MobileFaceNet, 13.6 MB) is `onnx2torch` → `torch.jit.trace` → `ct.convert(convert_to="mlprogram", ImageType(scale=1/127.5, bias=-1))`. fp16 output is 6.6 MB and agrees with onnxruntime to cosine 0.99998. Torch 2.14 works despite the "untested" warning.
- InsightFace model-zoo weights (buffalo_sc on the phone) are non-commercial research licensed. Fine for the hackathon; swap for a permissive model (e.g. OpenCV Zoo SFace, Apache-2.0, ~37 MB) before any real deployment.
- CocoaPods' resource copy step does not compile `.mlpackage`, so the module ships the precompiled `.mlmodelc` via `s.resource_bundles` (`GlassesModels.bundle`) and loads it with `MLModel(contentsOf:)`. Only the compiled model is committed (the `.mlpackage` is gitignored).
- Vision on the iOS 27 simulator: every request fails with `Could not create inference context` (code 9) unless pinned to the CPU via `supportedComputeStageDevices` + `setComputeDevice(_:for:)`; Core ML programs likewise need `computeUnits = .cpuOnly` there. `MLShapedArray<Float>(multiArray)` traps on the fp16 model's Float16 output; switch on `dataType`.
- `VNDetectFaceLandmarksRequest` returns garbage on the simulator CPU path (eye centres 4 px apart, landmark confidence 0.65, non-deterministic across revisions/upscaling), so the ArcFace 5-point alignment could not be validated and was dropped. `VNDetectFaceRectanglesRequest` is reliable; a square crop of 1.3x the box shifted up 0.2 box heights reproduces InsightFace's aligned embedding at cosine 0.94-0.97 (sweep in `FaceSelfTest.swift`). Vision boxes are bottom-left normalized; CoreGraphics draws bottom-left too, so the crop transform is wrapped in two y-flips.
- MobileFaceNet (buffalo_sc) scores on `scripts/testdata` with InsightFace alignment: same person 0.73, different -0.06/0.03 (the old server model, buffalo_l: 0.80 / -0.08). (The 0.5 threshold did not carry over; see the evaluation and migration sections below.)
- Oct 24 late: the server-side path (Python InsightFace sidecar, `/api/frames`, `FaceSample` embeddings in Postgres) was removed so recognition is fully on-device. Enrollment photos still upload to the server for the dashboard and the Remember portraits; the phone detects the face itself and sends the boxes (`faces` field) so the server can crop the avatar without running any face model. Photos enrolled from the web have no boxes: the avatar is a centre crop and the phone finds the face when it syncs the roster.
- The DAT 1.0.1 xcframeworks do ship `ios-arm64_x86_64-simulator` slices, so the dev client builds for the iOS 27 simulator with no stubs (NOTES above about "no simulator runtime" is out of date: Xcode 27.1 has the iOS 27.0 runtime). The simulator build is ~5 GB of derived data; delete `apps/mobile/ios/build` when short on disk.
- `expo prebuild` + simulator xcodebuild can be driven headless with `CI=1 pnpm prebuild`, then `xcodebuild -workspace ios/MemoryAid.xcworkspace -scheme MemoryAid -sdk iphonesimulator -destination 'id=<sim udid>' CODE_SIGNING_ALLOWED=NO`.

## Face model evaluation (Oct 24 night; `eval/face-models/`)

- The "0.5 threshold carries over unchanged" note above was wrong. Through the Vision box crop
  (no landmark alignment) same-person cosines run lower than InsightFace's aligned numbers: on
  the 6,000 official LFW pairs only 77% of same-person pairs clear 0.50 with the shipped
  MobileFaceNet, 60% once the probe face is 56 px wide, 30% at 40 px. Different-person pairs never
  reach 0.30. `LocalRecognition.matchThreshold` should be 0.30 for this model (98% / 96% / 88%
  same-person acceptance, 0 strangers in 9,000 comparisons). Full tables in
  `eval/face-models/RESULTS.md`, chart in `results.png`.
- ResNet50 ArcFace (`w600k_r50` from buffalo_l) converts with the same script and input contract,
  83 MB fp16, 1.6 ms per face on the Neural Engine; at 0.30 it accepts 99.0% / 98.9% / 96.6%
  with zero stranger accepts. ResNet100 (antelopev2 `glintr100`) is +1 point at 40 px for 131 MB.
- `MLComputePlan` (iOS 17.4+, macOS 14.4+) is the way to prove Neural Engine placement: the
  shipped model has 100/100 compute ops on the ANE; the 3 CPU ops are the ImageType scale/bias.
  `ComputePlan.swift` prints the histogram and times each `MLComputeUnits` setting.
- With `computeUnits = .all`, Core ML's planner prefers the GPU for EdgeFace (timm EdgeNeXt) and
  LVFace (ViT) even though every op is ANE-capable: 4.8-5.2 ms instead of 0.3-1.1 ms. If either is
  adopted, set `.cpuAndNeuralEngine`. The InsightFace ResNets and MobileFaceNet land on the ANE
  under `.all`.
- EdgeFace would not convert through `torch.jit.trace` (coremltools 9.0 + torch 2.14: `aten::Int`
  from `x.shape` arithmetic, "only 0-dimensional arrays can be converted"); `torch.export.export(...)
  .run_decompositions({})` works. SFace is 128-d and its ONNX graph already contains the
  `(x-127.5)/128` normalisation, so its ImageType is scale 1, bias 0. LVFace-T converts via
  onnx2torch once the batch dim is pinned to 1.
- Apple Vision's box on a clean LFW face is a median 113 px wide; the degraded tiers were calibrated
  to Vision widths (56 px, 40 px), not image scale. 9.75% of 40 px faces fall under
  `minFaceSide = 36` and are skipped by every model alike.

## Photo library index (Oct 24 night)

Suggests library photos of the person being enrolled (`modules/glasses/ios/PhotoIndex.swift`,
`src/lib/photoIndex.ts`). Separate store from the roster; `LocalRecognition` never reads it.

- PhotoKit access level must be `.readWrite`: `.addOnly` cannot fetch assets at all. iOS 14+ also
  has `.limited`; `PHPhotoLibraryPreventAutomaticLimitedAccessAlert = true` in Info.plist (set by
  `plugins/withMetaWearables.js`) stops iOS popping its "Select More Photos" sheet on the first fetch.
- Thumbnail size decides embedding quality, not detection. Vision finds 20 px faces, but
  MobileFaceNet's 112 px input wants ~90 px faces in the source; below ~50 px the embedding drifts.
  So the first request is 1024 px (never 512), and any face box under 120 px triggers a 2048 px
  request for that asset with boxes matched by scaled centre distance. Faces still under
  `minFaceSide` (36 px) are skipped.
- `PHImageManager.requestImage` with `isSynchronous = true` must run off the main thread (it does,
  on a `.utility` serial queue). With `isNetworkAccessAllowed = false`, iCloud-only originals return
  nil with `PHImageResultIsInCloudKey = true`; they count as `skipped`. Nothing is ever downloaded
  over the hotspot.
- PhotoKit returns UIImages with EXIF orientation applied via `imageOrientation`, not pixels. Redraw
  upright before Vision (same trick as `FaceRecognizer.detectAndEmbed(UIImage)`) or boxes land on
  the wrong pixels for portrait shots. Boxes are stored with the actual returned width/height
  (`imageWidth`/`imageHeight`) because `.aspectFit` sizes are not exactly 1024/2048.
- Persistence is a flat Float32 file + JSON sidecar in Application Support (excluded from
  backup), checkpointed every 50 assets; a `processed` set (incl. zero-face and skipped assets) makes
  resume skip work. Pause on `willResignActive`, resume on `didBecomeActive`; no `BGProcessingTask`.
- The indexer also yields while a stream is running (`PhotoIndex.setStreaming` from
  `GlassesController.startStream/stopStream`) so recognition keeps its 2 s budget.
- Search is one `cblas_sgemv` over N x 512; threshold 0.45, greedy diversity (drop a candidate whose
  cosine to any kept one is >= 0.92) so a burst of identical shots does not fill the grid; one
  candidate per asset; max 12.
- `Enroll.run` now takes an optional `seedPhotoUri`: for other photos it embeds up to 6 faces and
  keeps the one closest to the seed (group shots), rejecting the photo below cosine 0.4.
- Live burst spacing went from 250 ms to 1,200 ms so three live photos are not near-duplicates.
- React Compiler lint (`react-hooks/set-state-in-effect`) rejects a synchronous `setState` in an
  effect body; derive "cleared" state from keys (results keyed by seed URI) instead.
- Measured on the dev phone (iPhone 15 Pro): TODO elapsed time for 2,000 photos, `upgraded` count.

## Face model migration: MobileFaceNet to ResNet50 (Oct 24 night)

Shipped model is now InsightFace buffalo_l `w600k_r50` (ResNet50 ArcFace, 83 MB compiled). Every
embedder-dependent number lives in `FaceModel` in `FaceRecognizer.swift`: match 0.50 to **0.30**,
library suggestions 0.45 to **0.40**, seed rejection 0.40 and near-duplicate 0.92 unchanged.
Evidence: `eval/face-models/RESULTS.md`.

- Conversion with `eval/face-models/convert_onnx.py` (now the only converter;
  `convert_face_model.py` was deleted): Core ML vs onnxruntime cosine on random inputs
  0.99819 / 0.99775 / 0.99713. The converter now refuses to compile below 0.997. fp16 on random
  noise is the worst case; aligned real faces agree more closely (self-test below).
- Gotcha: the compiled `weight.bin` is 87.2 MB (83 MiB). That is under GitHub's 100 MB hard limit
  and over its 50 MB warning. Committed once, no LFS; do not reconvert and recommit casually,
  because every churn adds another 87 MB to history.
- Load is now off the main thread (`FaceRecognizer.loadAsync`, kicked off in `GlassesController.setup`)
  and `startStream` awaits it before `LocalRecognition.setActive(true)`, so no frames are dropped
  while the Neural Engine compiles the model on first launch. `syncRoster` also awaits it.
- Found while checking the prompt's claim: `syncRoster` was *not* guaranteed to finish before the
  first frame (it ran in the background next to `camera.stream.start()`), so for the first second or
  two of a launch an enrolled face could be matched against an empty roster and announced as
  "someone new is here". With the slower re-embed this window grows. `startStream` now awaits the
  first sync of a launch (failure logs and continues); later syncs stay in the background.
- The loaded model's version string is checked against `FaceModel.name` and logged; a mismatch
  logs a WARNING (wrong thresholds), and an embedding that is not 512-d throws.
- `PhotoIndex` sidecar is format v3 with a `model` field; the old v2 MobileFaceNet index is discarded
  on first launch and rebuilds in the background (expected). The roster cache is in memory only and
  re-embeds on the next launch.
- Scores posted to `/api/recognitions` are on the new scale. Nothing filters or colours by them.
  The web Live view prints the raw cosine as "Match NN%", so a correct match can read "Match 41%".
- Simulator self-test (iPhone 17 sim, CPU only): InsightFace's aligned crop through Core ML
  agrees with onnxruntime at cosine 0.9999 on all three test photos. The full Vision box-crop
  pipeline agrees with InsightFace's aligned embedding at 0.97 / 0.97 / 0.97. Pair scores: same
  person 0.77 (InsightFace 0.80), strangers -0.03 / -0.06. Decisions agree 3/3 at 0.30. Load 191 ms,
  embed 22-26 ms per face, 67-135 ms per photo end to end (CPU only, so slower than the phone).
- Device (iPhone 15 Pro, real glasses): TODO model load time (first launch and warm), per-face
  embed time, roster sync time and sample count. Phone was not connected when this landed.
- Device scores, TODO: enrolled at ~1 m `?`, enrolled at ~2.5 m `?`, stranger `?`, live-enrolled on
  return `?`. If 2.5 m fails but 1 m passes, the face is under the 36 px gate: do not lower
  `minFaceSide`; try the `.high` 720x1280 preset instead.
- Rollback: the migration is one commit. `git revert <that commit>` restores MobileFaceNet and the
  old thresholds, then rebuild with the xcodebuild + devicectl commands in `HANDOFF.md`. The
  MobileFaceNet `.mlmodelc` is also retrievable alone with
  `git checkout d40635e -- apps/mobile/modules/glasses/ios/Models/FaceEmbedder.mlmodelc`.

## Decisions

- Backend is Next.js route handlers. Face recognition runs on the phone (Core ML MobileFaceNet + Apple Vision in the Swift module). The frame never leaves the phone; only `{personId|null, score}` is posted to `/api/recognitions` for the memory log and the spoken line. An earlier Python InsightFace sidecar was removed on Oct 24 evening.
- All image/audio bytes travel Swift → Next via URLSession. JS never touches frames, to avoid the JS/Swift bridge cost.
- The phone's backend URL is a build-time env var (`EXPO_PUBLIC_BACKEND_URL`), not a setting: the wearer never configures anything and a URL field made the app look like a dev tool.
- Accounts carry a role (caregiver vs wearer) chosen during onboarding. Same data model either way; the wearer path just names the patient after the user and switches the copy to second person.
- Local Postgres (Docker) for dev and demo; laptop backend on phone hotspot, never venue Wi-Fi.

## Privacy, as implemented

- Faces are matched only against the roster the family enrolls. No stranger search.
- Glasses frames are matched in memory on the phone and discarded; recognition never uploads a frame. The one exception is a deliberate ask: the single frame the wearer is looking at travels with their question, is shown to the model, and is discarded with the request (never stored). Only events persist. Caregivers can delete any event.
- Enrollment photos live in Vercel Blob and are only served through an authenticated proxy (`/api/files/[id]`).
- Passwords are bcrypt-hashed; session tokens are stored only as SHA-256 hashes.
- Enrollment photos are re-encoded with sharp (EXIF rotation applied, all metadata including GPS stripped) before storage.

## Web (Next 16) gotchas

- With `cacheComponents: true`, Next 16.4 docs say to remove `export const runtime` (even `"nodejs"`) from routes; Node is already the default. Auth routes omit it.
- `next start -H 0.0.0.0` makes `req.url` read `http://0.0.0.0:3101/...`; links and redirects built from it are useless. Build the origin from the `Host` header (`requestOrigin` in `api/auth/_shared.ts`).
- The demo runs `next start` (NODE_ENV=production) over plain http on the LAN IP, so a `secure` session cookie would be silently dropped. Cookie is Secure only in production AND https.
- macOS `/bin/bash` is 3.2: `\"` inside `"$( ... )"` keeps the backslash and silently corrupts JSON bodies in curl test scripts. Build bodies with printf helpers.
- Several agents share `apps/web/.next`: `next build` while someone else's `next start` is running swaps the build out from under them. For isolated verification, rsync `apps/web` (minus `.next`/`node_modules`) to the gitignored `.cache/web-<port>/` and build there; hoisted root `node_modules` still resolves.
- Claude Sonnet 5.5 returns 400 for `thinking: {type: "disabled"}`; for short spoken answers use `thinking: {type: "between_tools"}` + `output_config.effort: "low"` (`lib/claude.ts`).
- Enrollment with no `BLOB_READ_WRITE_TOKEN` falls back to local disk (`apps/web/.cache/blobs`, File.url `local:<path>`), so dev works offline; with the token, blobs are `access: "private"` and read back via `get()`.
- Tailwind v4: an unlayered `a { color: ... }` in globals.css beats every utility (utilities live in `@layer utilities`), so `text-white` on a link-button rendered invisible. Put element defaults in `@layer base`.
- `react-hooks/set-state-in-effect` (eslint-config-next 16) flags calling any setState-ing function from an effect body, even async ones. Kick off fetches as `promise.then(setX)` and do per-submit values (tz offset) inside the form action wrapper instead.
- Route handlers with a catch-all `try/catch` swallowed Next's prerender bail-out during `next build` (logged as `[api] unexpected error ... needs to bail out of prerendering`). Fix: `unstable_rethrow(err)` from `next/navigation` first thing in the shared `errorResponse`.
- Adding the first dynamic page route (`/people/[id]`) made `next build` fail with `CLIENT_HOOK_DYNAMIC`: `usePathname` in the shared sidebar nav suspends while the static shell for a route with dynamic params is prerendered. Wrap the nav in `<Suspense>` in the layout (per the cache-components migration guide).
- Dashboard pages: the session read lives in an async child behind `<Suspense>` (cookies outside a boundary is a build error with cacheComponents); mutations call `refresh()` from `next/cache`.
- Oct 24 (web UI overhaul): the React Compiler lint in eslint-config-next 16 (`react-hooks/purity`) rejects `Date.now()` inside an event handler defined in a component, not just in render. Put clock reads in module-level helpers (`fromNow(minutes)`) and call those. `new Date()` inside such a helper is fine.
- Oct 24: to clear a controlled form after a server action without `setState` in an effect (`react-hooks/set-state-in-effect`), skip `useActionState` and call the action inside `useTransition`: `start(async () => { const r = await action({}, fd); setState(r); if (r.ok) clear(); })`, with `<form action={submit}>`. `useOptimistic` + a `role="switch"` button gives an instant toggle for the memory "say this" switch.
- Oct 24: `searchParams` in a page is a Promise and reading it is request-time work; with `cacheComponents` the component that awaits it must sit behind `<Suspense>` (the sign-up role choice does this). `PageProps<"/signup">` from `next typegen` types it.
- Oct 24: a fresh worktree has no `node_modules`; `pnpm install --prefer-offline` works but rewrites `pnpm-lock.yaml` (hundreds of lines). Restore it with `git checkout pnpm-lock.yaml` before committing.
- Oct 24: Tailwind v4 custom utilities (`@utility hairline-rows { & > * + * { border-top: ... } }`) are the clean way to draw iOS-style grouped-list separators without per-row conditional classes.

## Voice (Oct 24 night)

- Oct 24 ~21:47 ("button stopped working"): the phone log (`sudo log collect --device-udid ...`, then `log show --predicate 'process == "MemoryAid"'`; our NSLog lines are `<private>` but the coreaudio `as_client`/`as_server` lines are not) showed Spotify, started from the lock-screen Now Playing widget, interrupting our non-mixable playback session. An interrupted `AVAudioPlayer` never calls `audioPlayerDidFinishPlaying`, so `Speaker.current` stayed set and every later line (button or passive) queued forever; the interruption never ended because Spotify kept playing. Fix: observe `AVAudioSession.interruptionNotification`, drop the current line at `.began` so the queue moves on, reactivate at `.ended`. Any interruption (call, Siri, alarm) would have done the same: a silent all-speech failure until app restart.
- Same log: `setCategory(.playback, mode: .spokenAudio, options: [.allowBluetoothA2DP])` is rejected by iOS with OSStatus -50 (`AVAudioSessionErrorCodeBadParam`, server error -12981 "Invalid parameter") on every line: `.allowBluetoothA2DP` is only valid with `.playAndRecord`. It had been failing since the ElevenLabs change and was masked because `AVAudioPlayer.play()` activates the session implicitly. Playback uses `options: []` now, so `setActive` actually runs.

- ElevenLabs had never produced a single MP3: `.cache/speech/` held only `.txt` files. The voice in `.env` ("Lauren") is a Voice Library voice and the API key is on the free plan, so every TTS call returned `402 paid_plan_required` and the phone silently fell back to Apple speech. Premade voices (Bella, Sarah, Matilda, River, ...) work on the free plan; `lib/tts.ts` now defaults to Bella and names the 402 cause in the log. Check `ls apps/web/.cache/speech/*.mp3` after a roster sync; no MP3s means TTS is broken again.
- Latency: TTS generation (flash v2.5) is 300 to 450 ms plus a download, on top of the recognition round trip. Both are now off the critical path: `GET /api/people` mints a `speechId` per roster line (which starts generation on the server), and the Swift `Speaker` downloads every one into `Library/Caches/speech/` during roster sync. A recognition plays from disk; the only network wait left is the `POST /api/recognitions` log call.
- There is no client-safe way to call ElevenLabs TTS from the phone: single-use tokens exist only for realtime Scribe (STT) and signed URLs only for Conversational AI agents, so a direct call would ship the API key in the app binary. Routing through Next also lets the server cache; a direct call would pay generation latency every time.
- Oct 24 (spatial whisper): the name is now panned to the side of the frame the face is on. `AVAudioPlayer.pan` (-1..1) is all it takes over A2DP (stereo); HFP is mono and ignores it, and `AVSpeechSynthesizer` has no pan at all, so the Apple-speech fallback stays centred. Pan = box centre offset from frame centre x1.5, clamped, averaged across the faces a line names; the glasses camera is not mirrored, so frame-left is the wearer's left. Native change: rebuild the dev client. The Live screen shows "Whispered in the left/right ear" after the line plays.

## Ask with a frame via gpt-realtime (Oct 24 night)

- Ask now sends what the wearer sees. `stopAsk` grabs the newest glasses frame from `FrameHub`
  (≤ 5 s old, else the one noted at `startAsk`), downsizes it to 768 px / JPEG 0.75 (~60 to 120 KB)
  and posts it with the WAV as multipart. The server never writes the frame anywhere; it lives in
  the request and the one WebSocket session. The privacy statement is now "frames never leave the
  phone for recognition; one frame travels with a deliberate ask and is discarded."
- Model: `gpt-realtime-2.1` (released July 6 2026; replaced `gpt-realtime`, which OpenAI shut down
  July 20 2026). It takes text, audio and image input. We use **text output** and keep speaking
  through ElevenLabs so every line has the same voice; the model's own voice would make the answer
  sound like a different person.
- Realtime API gotchas (`lib/realtime.ts`): PCM input is 24 kHz only, so the phone's 16 kHz WAV is
  linearly resampled on the server. A `conversation.item.create` with `input_audio` is **not**
  transcribed by the server; only audio committed through `input_audio_buffer` fires
  `conversation.item.input_audio_transcription.completed`, which we need for the question text in
  the log. So: image item → `input_audio_buffer.append` + `commit` → `response.create` (after
  `input_audio_buffer.committed`), with `turn_detection: null`. The transcript often lands after
  `response.done`; we wait up to 4 s for it, then fall back to our own STT for the log line.
- Repeats: the realtime answer is generated before we know the transcript, so the "same answer in
  the same words" rule is applied afterwards: if a near-identical question was asked in the last 2 h,
  its earlier answer is spoken and the fresh one is dropped.
- Node 22's built-in `WebSocket` cannot set an `Authorization` header, so `apps/web` depends on
  `ws` 8. The hoisted root `node_modules/ws` is still 7.5 (an Expo transitive); `apps/web` resolves
  its own 8.22, so the API is the same for the client, but `WebSocketServer` as a named export only
  exists in 8 (bit me in a scratch test).
- Verified with a mock Realtime server (full event sequence, image data URL, 24 kHz byte count,
  text path, 503 without a key). Not yet run against OpenAI: `OPENAI_API_KEY` is empty in `.env`.
  Native change (`GlassesController.stopAsk`, `FrameHub`): rebuild the dev client.

## Live conversation via the Realtime API (Oct 24 night)

- Ask is now a conversation, not a tap/Done pair. `RealtimeChat.swift` opens the WebSocket to OpenAI
  **from the phone** with a 10 min client secret from `/api/realtime/session`; `apps/web` never sees
  the audio. `URLSessionWebSocketTask` can set `Authorization: Bearer ek_...` directly (browsers need
  the `openai-insecure-api-key.<key>` subprotocol trick; we do not). The whole session config
  (instructions, voice, VAD) rides inside the client secret, so the phone sends no `session.update`.
- Turn detection: `server_vad` with `silence_duration_ms` 1500 (`REALTIME_SILENCE_MS`). The API
  default of 500 ms cuts off anyone who pauses to find a word. `semantic_vad` with `eagerness: low`
  is the other option (`REALTIME_TURN_DETECTION=semantic_vad`); it has no silence knob, it tunes a
  "maximum wait" from the words themselves. Both are a one-line env change; try semantic on the real
  wearer if 1.5 s still feels rushed, and raise the threshold at a loud expo.
- Half-duplex on purpose: the glasses' speakers are open-ear and centimetres from the temple mics,
  so with the mic open during playback the model would hear itself and VAD would start a turn on the
  echo (a self-talk loop). The phone drops mic audio from `response.created` until the last buffer has
  played plus 300 ms. `REALTIME_BARGE_IN=1` reopens it (and sends `conversation.item.truncate` with the
  played ms on `speech_started`, since over WebSocket the server does not know what was heard).
- The conversation answers in the realtime model's own voice (`marin`, speed 0.9), not ElevenLabs:
  streaming TTS per turn would add a server round trip and could not be truncated in sync with the
  model's idea of what was heard. Recognitions/reminders stay on ElevenLabs. Two voices in the demo;
  judged acceptable for a live back-and-forth. `OPENAI_REALTIME_VOICE` switches it.
- Logging: the phone posts each finished turn to `/api/realtime/turns`. The user transcript usually
  arrives before `response.done`, but not always: 4 s grace, then the turn is logged as
  `(not transcribed)`. The "same answer in the same words" rule is pushed into the instructions (last
  2 h of Q/A pairs) because the words are spoken before the server can compare.
- Audio out is an `AVAudioEngine` + `AVAudioPlayerNode` fed Float32 buffers converted from the API's
  PCM16; `.dataPlayedBack` completions count what actually left the speaker (for the mic reopen and
  truncation). A route change stops the engine (`AVAudioEngineConfigurationChange`): it is restarted.
- Input: `AudioCapture` gained a second converter to 24 kHz (the only PCM rate the API takes) and a
  `chatActive` flag; ambient `/api/utterances` chunks pause during a conversation. Chunks are coalesced
  to ~100 ms before `input_audio_buffer.append`.
- Native change (new file `RealtimeChat.swift`): `pod install`/`pnpm prebuild`, then rebuild the dev
  client. Until then `Glasses.startChat` rejects and the Live screen falls back to tap-to-ask.
- Verified Oct 24 23:50 against the real API from a Node probe playing the phone's part (isolated
  build in `.cache/web-3107`): `/api/realtime/session` 200 with the config echoed back by
  `session.created` (server_vad, 1500 ms); the ephemeral key works in the `Authorization` header;
  the out-of-band greeting produced 1.1 s of audio; a `say`-generated "What were we talking about
  just now?" was committed 1.5 s after the speech ended, transcribed in 1.3 s, and answered with 8.4 s
  of audio 2.3 s after the commit. `/api/realtime/turns` logs QUESTION/ANSWER/SPOKEN with
  `source: "chat"`. The Swift side compiled for the simulator (`xcodebuild -scheme Glasses`); it has
  not yet run on the phone. `.env` does have an `OPENAI_API_KEY` (the earlier note was stale).
- Oct 25 00:10, first run on the phone: the conversation worked but the voice stuttered. Cause: the
  player scheduled every `response.output_audio.delta` the instant it arrived, with nothing buffered
  ahead, so each late packet was a gap. `RealtimeAudioOut` now stages audio and schedules 200 ms
  pieces after a 400 ms head start per response (re-primed after an underrun; underruns are counted
  in the log as `[Chat] audio: N underrun(s)`). If stutter persists with 0 underruns logged, it is
  the Bluetooth link (camera stream + A2DP share it): compare with an ElevenLabs recognition line,
  which plays from disk; if that stutters too, the radio is the bottleneck, not the network.

## "Hey Remi" wake word on the phone (Oct 25, ~1 AM)

- Picovoice Porcupine was the obvious pick but its free tier is non-commercial/eval only. sherpa-onnx
  (Apache 2.0) has an **open-vocabulary keyword spotter**: a 3.3M-param streaming Zipformer transducer
  trained on GigaSpeech that scores audio against the BPE token sequence of any phrase, so there is
  no training step and no account. The phrase is a string in `WakeWord.swift`
  (`▁HE Y ▁RE M I @HEY_REMI`; tokens from the model's `bpe.model` via sentencepiece). openWakeWord
  was ruled out: its training pipeline is 2022-era packages plus a GPU, and nothing runs it on iOS.
- Prebuilt static iOS xcframeworks exist but not under the versioned GitHub release: they live under
  the `xcframework` release tag (`sherpa-onnx-v1.13.8-ios-static.xcframework.zip`), with onnxruntime
  from `csukuangfj/onnxruntime-libs` (`v1.28.2`). The checksums in sherpa's `Package.swift` match;
  `ios/scripts/fetch-sherpa.sh` verifies them. Both are vendored like the DAT frameworks (gitignored,
  fetched during `pod install`). The module map is `SherpaOnnxC`; link `c++`.
- The `-mobile` variant of the KWS model crashes onnxruntime on the first decode (Reshape
  `{17,1,128}` vs `{8,2,1,128}`). The plain `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01`
  int8 files work and total 5 MB; they ship as the `GlassesWake` resource bundle.
- Tuning on the Mac (`say` voices, white noise at -34 dB, threshold / score): 0.25 / 1.5 caught 5/5
  "Hey Remi" + "Hey Remy" clips and fired on no sentence that merely contained "Remi" ("Remi
  recognizes...", "Remind me what Remi does") or "Hey" ("Hey, remember to..."). Only "Hey Ramy"
  fired, which sounds identical. 0.4 missed two voices. Expo noise untested at the time of writing.
- Design: the detector is a third consumer of `AudioCapture`'s buffers (next to ambient chunks and
  the chat), active only while streaming and idle otherwise, muted while `Speaker` plays a line.
  A 3 s ring buffer at 24 kHz is handed to `RealtimeChat` as pre-roll and `feed` holds audio until
  `session.created`, so the question said in the same breath as the phrase arrives whole and the
  greeting is skipped. The realtime client secret is prefetched while wake is on (saves ~0.5 to 1 s).
- Off by default. The phone tap and the glasses button remain the demo's primary ask path; turn the
  switch on for a rehearsed beat only once it has proven itself in the room.
- Oct 25 01:00 (first on-device "Hey Remi"): the phrase was heard and the UI switched, then the app
  trapped in `RealtimeChat.handle` (`Data._Representation.subscript.getter`, EXC_BREAKPOINT). The
  3 s pre-roll ring is trimmed with `Data.removeFirst(_:)`, which leaves the Data with a non-zero
  `startIndex`; the backlog was then sliced `backlog[0..<48000]` by absolute index and went out of
  bounds. Swift `Data` slices and trimmed Datas keep their parent indices. Fix: copy into a fresh
  `Data()` (`Data(preroll)` / `append`) and iterate `startIndex..<endIndex` with `subdata(in:)`.
  Crash reports came off the phone with `idevicecrashreport -k <dir>` (brew libimobiledevice); the
  `.ips` is JSON after the first line.

## Web dashboard pass (Oct 25, 12:30 to 2 AM)

- Next 16.4 dev: after adding new `"use server"` exports to an existing actions file, calling the new action from a client component failed with `Cannot read properties of undefined (reading 'apply')` (the action logged as `ƒ createInvite() in 0ms` and never ran) until `next dev` was restarted. Same for a regenerated Prisma client (`prisma.medication` undefined): HMR reloads neither manifest.
- Turbopack `next build` fails on a symlink inside the project that points outside it (`.cache -> ../../apps/web/.cache` in a worktree: "symlink target leaves the filesystem root"). Copy the folder instead.
- The React Compiler lint (`react-hooks/set-state-in-effect`) flags `void loadEvents()` at the top of an effect even when `loadEvents` only sets state after `await fetch`. Kicking the loads off from `Promise.resolve().then(...)` satisfies it without changing behaviour. It also rejects reading `ref.current` during render (used to mark "fresh" rows); keep that in state.
- Medication doses ride the existing reminder pipeline: `ensureDoses()` materializes Reminder rows per local time of day (unique on `medicationId + dueAt`) and `GET /api/reminders/due` calls it first, so the phone needed no change. Verified live: a 12:57 AM dose was returned by the poll route and the REMINDER and SPOKEN events landed on `/live` over SSE within two seconds.
- Local clock times to UTC without a date library: format the guess in the zone with `Intl.DateTimeFormat(..., hourCycle: "h23")`, compute the offset, correct, repeat once for DST edges (`instantAt` in `lib/medications.ts`). Postgres `timestamp(3)` columns hold UTC; `AT TIME ZONE 'America/New_York'` in psql reinterprets them as local and misleads by the offset.
