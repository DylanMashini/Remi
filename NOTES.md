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

## Decisions

- Backend is Next.js route handlers; face embeddings run in a Python sidecar (InsightFace buffalo_l) because Node face libraries were less reliable.
- All image/audio bytes travel Swift → Next via URLSession. JS never touches frames, to avoid the JS/Swift bridge cost.
- Local Postgres (Docker) for dev and demo; laptop backend on phone hotspot, never venue Wi-Fi.
- Face sidecar: InsightFace/onnxruntime wheels lag new Pythons, so `apps/face` pins Python 3.12 via uv (system is 3.14). buffalo_l (~280 MB) downloads to `~/.insightface` on first start; CPU provider is ~50 ms per 504x896 frame on the Mac, so CoreML was not needed.

## Privacy, as implemented

- Faces are matched only against the roster the family enrolls. No stranger search.
- Glasses frames are matched in memory and discarded; only events persist. Caregivers can delete any event.
- Enrollment photos live in Vercel Blob and are only served through an authenticated proxy (`/api/files/[id]`).
- Passwords are bcrypt-hashed; session tokens are stored only as SHA-256 hashes.
- Enrollment photos are re-encoded with sharp (EXIF rotation applied, all metadata including GPS stripped) before embedding or storage.

## Web (Next 16) gotchas

- With `cacheComponents: true`, Next 16.4 docs say to remove `export const runtime` (even `"nodejs"`) from routes; Node is already the default. Auth routes omit it.
- `next start -H 0.0.0.0` makes `req.url` read `http://0.0.0.0:3101/...`; links and redirects built from it are useless. Build the origin from the `Host` header (`requestOrigin` in `api/auth/_shared.ts`).
- The demo runs `next start` (NODE_ENV=production) over plain http on the LAN IP, so a `secure` session cookie would be silently dropped. Cookie is Secure only in production AND https.
- macOS `/bin/bash` is 3.2: `\"` inside `"$( ... )"` keeps the backslash and silently corrupts JSON bodies in curl test scripts. Build bodies with printf helpers.
- Several agents share `apps/web/.next`: `next build` while someone else's `next start` is running swaps the build out from under them. For isolated verification, rsync `apps/web` (minus `.next`/`node_modules`) to the gitignored `.cache/web-<port>/` and build there; hoisted root `node_modules` still resolves.
- Claude Sonnet 5.5 returns 400 for `thinking: {type: "disabled"}`; for short spoken answers use `thinking: {type: "between_tools"}` + `output_config.effort: "low"` (`lib/claude.ts`).
- Enrollment with no `BLOB_READ_WRITE_TOKEN` falls back to local disk (`apps/web/.cache/blobs`, File.url `local:<path>`), so dev works offline; with the token, blobs are `access: "private"` and read back via `get()`.
- InsightFace buffalo_l scores on the test photos: same person, different photo 0.80; different person -0.06. Threshold 0.5 has wide margin.
- Tailwind v4: an unlayered `a { color: ... }` in globals.css beats every utility (utilities live in `@layer utilities`), so `text-white` on a link-button rendered invisible. Put element defaults in `@layer base`.
- `react-hooks/set-state-in-effect` (eslint-config-next 16) flags calling any setState-ing function from an effect body, even async ones. Kick off fetches as `promise.then(setX)` and do per-submit values (tz offset) inside the form action wrapper instead.
- Route handlers with a catch-all `try/catch` swallowed Next's prerender bail-out during `next build` (logged as `[api] unexpected error ... needs to bail out of prerendering`). Fix: `unstable_rethrow(err)` from `next/navigation` first thing in the shared `errorResponse`.
- Dashboard pages: the session read lives in an async child behind `<Suspense>` (cookies outside a boundary is a build error with cacheComponents); mutations call `refresh()` from `next/cache`.
