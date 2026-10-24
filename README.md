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

## Setup

```sh
pnpm install          # also runs `prisma generate`
pnpm db:up            # Postgres in Docker on :5432
pnpm --filter web db:migrate
```

## Run

```sh
pnpm dev:web          # http://localhost:3000, listens on 0.0.0.0
pnpm dev:mobile       # Metro for the dev client
```

First time (and whenever native code / plugins change), build the dev client:

```sh
cd apps/mobile
pnpm ios              # simulator
pnpm ios:device       # physical iPhone (needs signing team in Xcode)
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
