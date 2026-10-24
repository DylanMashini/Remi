# Memory Aid

Dementia memory aid built on Meta Ray-Ban glasses. pnpm monorepo:

| Path | What |
| --- | --- |
| `apps/web` | Next.js 16 caregiver portal + backend route handlers (Prisma 7, Postgres 18) |
| `apps/mobile` | Expo SDK 58 / React Native 0.88 app (Expo Router), iOS dev build |
| `apps/mobile/modules/glasses` | Local Expo module (Swift) for glasses + photo processing |

## Prerequisites

- Node 22.13+ (24 LTS is fine), pnpm 10, Docker
- Xcode **26.4+** for the Meta Wearables DAT SDK (26.2 builds the stub module but not the SDK), CocoaPods
- A physical iPhone (iOS 17.2+) with Meta AI installed and glasses paired, for real glasses work

## Setup (once)

```sh
pnpm install                     # also runs `prisma generate`
[ -f apps/web/.env ] || cp apps/web/.env.example apps/web/.env   # then fill in keys (see below)
pnpm db:up                       # Postgres 18 in Docker on :5432 (container memory-aid-db-1)
pnpm --filter web db:migrate     # apply migrations
pnpm --filter web db:seed        # demo login demo@recall.local / recall-demo (patient "Ruth"); idempotent
```

Dev uses the local Docker Postgres; no hosted DB needed. Without `BLOB_READ_WRITE_TOKEN`,
enrollment photos are stored on local disk under `apps/web/.cache/blobs`.

## Run (three processes, plus the phone)

```sh
pnpm db:up                                   # 1. Postgres (if not already up)
pnpm dev:face                                # 2. face sidecar on 127.0.0.1:8001 (first start downloads buffalo_l, ~15 s)
cd apps/web && pnpm build && pnpm start      # 3. web + API on 0.0.0.0:3000 (production build; use for demo)
```

`pnpm dev:web` (next dev) works for UI work, but compiles each route on first hit, so never demo on it.

Phone (first time, and whenever app.json, plugins, podspec, or native deps change):

```sh
cd apps/mobile
pnpm prebuild          # regenerates ios/, pod install fetches the Meta DAT 1.0.1 frameworks
pnpm ios:device        # build + install the dev client on the iPhone (needs a signing team)
pnpm start             # Metro for later JS-only changes
```

In the app, sign in with backend URL `http://<Mac LAN IP>:3000` (`ipconfig getifaddr en0`; use the
phone hotspot, never venue Wi-Fi). On the Live tab, "No glasses? Start with the phone camera" runs the
same pipeline on Mock Device Kit.

Caregiver dashboard: `http://<host>:3000/` (Overview, People, Reminders) and `/live` for the projector.

### Keys (`apps/web/.env`)

Everything runs without keys, but: no `ELEVENLABS_API_KEY`/`ELEVENLABS_VOICE_ID` means the phone falls
back to Apple speech; no `ANTHROPIC_API_KEY` means Ask returns 503; no `ELEVENLABS_API_KEY` or
`OPENAI_API_KEY` means no speech-to-text; no `RESEND_API_KEY` prints email links to the server log.

### Tests

```sh
BASE=http://127.0.0.1:3000 SERVER_LOG=<next start log> scripts/e2e.sh   # full slice, fresh user
BASE=http://127.0.0.1:3000 apps/web/scripts/test-api.sh                  # API smoke (demo user)
BASE=http://127.0.0.1:3000 SERVER_LOG=<log> apps/web/scripts/test-auth.sh
pnpm typecheck && (cd apps/mobile && npx expo lint)
```

This app uses a **development build**, not Expo Go: Expo Go can't load custom native modules.

## The Swift module

`apps/mobile/modules/glasses` is a [local Expo module](https://docs.expo.dev/modules/get-started/) and is autolinked, with no install step.

- `ios/GlassesModule.swift`: module definition (functions, events, views)
- `ios/Glasses.podspec`: add native deps here (e.g. the Meta DAT SDK), iOS 17.2 minimum
- `src/GlassesModule.ts`: typed JS binding; import it in the app with `import Glasses from '@/../modules/glasses'` or a relative path

To edit Swift with autocomplete, open `apps/mobile/ios/MemoryAid.xcworkspace` in Xcode. The module's files are under `Pods > Development Pods > Glasses`. After adding Swift files or podspec deps, run `pnpm prebuild` (regenerates `ios/`, which is gitignored) and rebuild.

`plugins/withMetaWearables.js` writes the Info.plist keys the Meta SDK needs (`MWDAT`, Bluetooth, external accessory, background modes). Pass real `appId`/`clientToken`/`teamId` in `app.json` for non-developer-mode use. Never edit `ios/` by hand. Change config through `app.json` or plugins.

For sending photos to the backend, Next route handlers can read raw `Content-Type: image/jpeg` bodies with `await req.arrayBuffer()`, so Swift can upload bytes directly with `URLSession` instead of passing them through JS.

For the demo, run the production server (`pnpm --filter web build && pnpm --filter web start`). `next dev` compiles each route on first request, which is too slow for live recognition.

## Notes

- The phone can't reach `localhost`. Use your Mac's LAN IP or an ngrok tunnel for the backend URL.
- Add packages to the mobile app with `pnpm exec expo install <pkg>` (picks SDK-compatible versions), and to the web app with `pnpm --filter web add <pkg>`.
- `nodeLinker: hoisted` in `pnpm-workspace.yaml` is intentional: some React Native native libraries still break with pnpm's isolated layout.
