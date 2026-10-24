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
- Oct 24: The Swift module gained `startListening`/`stopListening` (same `AudioCapture.startAsk/stopAsk` path, posts to `/api/transcribe`). Native change: the dev client must be rebuilt (`pnpm prebuild`, then the xcodebuild/devicectl commands in HANDOFF.md). Until then `glassesHas('startListening')` is false and the Remember screen falls back to typing.

## On-device face recognition (Oct 24 evening; now the only path)

- coremltools 9 has no ONNX frontend any more; the path that worked for InsightFace's `w600k_mbf.onnx` (MobileFaceNet, 13.6 MB) is `onnx2torch` → `torch.jit.trace` → `ct.convert(convert_to="mlprogram", ImageType(scale=1/127.5, bias=-1))`. fp16 output is 6.6 MB and agrees with onnxruntime to cosine 0.99998. Torch 2.14 works despite the "untested" warning.
- InsightFace model-zoo weights (buffalo_sc on the phone) are non-commercial research licensed. Fine for the hackathon; swap for a permissive model (e.g. OpenCV Zoo SFace, Apache-2.0, ~37 MB) before any real deployment.
- CocoaPods' resource copy step does not compile `.mlpackage`, so the module ships the precompiled `.mlmodelc` via `s.resource_bundles` (`GlassesModels.bundle`) and loads it with `MLModel(contentsOf:)`. Only the compiled model is committed (the `.mlpackage` is gitignored).
- Vision on the iOS 27 simulator: every request fails with `Could not create inference context` (code 9) unless pinned to the CPU via `supportedComputeStageDevices` + `setComputeDevice(_:for:)`; Core ML programs likewise need `computeUnits = .cpuOnly` there. `MLShapedArray<Float>(multiArray)` traps on the fp16 model's Float16 output; switch on `dataType`.
- `VNDetectFaceLandmarksRequest` returns garbage on the simulator CPU path (eye centres 4 px apart, landmark confidence 0.65, non-deterministic across revisions/upscaling), so the ArcFace 5-point alignment could not be validated and was dropped. `VNDetectFaceRectanglesRequest` is reliable; a square crop of 1.3x the box shifted up 0.2 box heights reproduces InsightFace's aligned embedding at cosine 0.94-0.97 (sweep in `FaceSelfTest.swift`). Vision boxes are bottom-left normalized; CoreGraphics draws bottom-left too, so the crop transform is wrapped in two y-flips.
- MobileFaceNet (buffalo_sc) scores on `scripts/testdata` with InsightFace alignment: same person 0.73, different -0.06/0.03 (the old server model, buffalo_l: 0.80 / -0.08). The 0.5 threshold carries over unchanged.
- Oct 24 late: the server-side path (Python InsightFace sidecar, `/api/frames`, `FaceSample` embeddings in Postgres) was removed so recognition is fully on-device. Enrollment photos still upload to the server for the dashboard and the Remember portraits; the phone detects the face itself and sends the boxes (`faces` field) so the server can crop the avatar without running any face model. Photos enrolled from the web have no boxes: the avatar is a centre crop and the phone finds the face when it syncs the roster.
- The DAT 1.0.1 xcframeworks do ship `ios-arm64_x86_64-simulator` slices, so the dev client builds for the iOS 27 simulator with no stubs (NOTES above about "no simulator runtime" is out of date: Xcode 27.1 has the iOS 27.0 runtime). The simulator build is ~5 GB of derived data; delete `apps/mobile/ios/build` when short on disk.
- `expo prebuild` + simulator xcodebuild can be driven headless with `CI=1 pnpm prebuild`, then `xcodebuild -workspace ios/MemoryAid.xcworkspace -scheme MemoryAid -sdk iphonesimulator -destination 'id=<sim udid>' CODE_SIGNING_ALLOWED=NO`.

## Decisions

- Backend is Next.js route handlers. Face recognition runs on the phone (Core ML MobileFaceNet + Apple Vision in the Swift module). The frame never leaves the phone; only `{personId|null, score}` is posted to `/api/recognitions` for the memory log and the spoken line. An earlier Python InsightFace sidecar was removed on Oct 24 evening.
- All image/audio bytes travel Swift → Next via URLSession. JS never touches frames, to avoid the JS/Swift bridge cost.
- The phone's backend URL is a build-time env var (`EXPO_PUBLIC_BACKEND_URL`), not a setting: the wearer never configures anything and a URL field made the app look like a dev tool.
- Accounts carry a role (caregiver vs wearer) chosen during onboarding. Same data model either way; the wearer path just names the patient after the user and switches the copy to second person.
- Local Postgres (Docker) for dev and demo; laptop backend on phone hotspot, never venue Wi-Fi.

## Privacy, as implemented

- Faces are matched only against the roster the family enrolls. No stranger search.
- Glasses frames are matched in memory on the phone and discarded; they are never uploaded. Only events persist. Caregivers can delete any event.
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
