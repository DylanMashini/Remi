# Handoff: Recall build, Saturday Oct 24 2026 (~3:30 PM)

Read this first if you are picking up the project. `CLAUDE.md` (goals, deadlines, rules) and
`CONTRACT.md` (every route, JSON shape and Swift module function) still win if anything here
disagrees. Gotchas go in `NOTES.md`.

## Where things stand

- **Everything below is uncommitted on `master`.** Nobody has committed yet; commit only when the user asks.
- **Backend:** built and passing tests. `scripts/e2e.sh` has 26 passing checks, 0 failing, and 2 skipped (TTS and Claude answers). Those two are skipped because `apps/web/.env` has no API keys yet.
- **Phone app:** built and installed on the user's iPhone 15 Pro. The user is signing in and testing the phone-camera (Mock Device Kit) path now.
- **Untested at runtime:** the real glasses (registration, streaming, A2DP audio, glasses mic, photo capture), real audio sent to `/api/ask`, ElevenLabs, Claude, Vercel Blob, and Resend.
- **Product name:** Recall. The visual design comes from the "Kindred" design system, but the wordmark says "Recall".

## Architecture

```
Glasses ──DAT SDK (BT/Wi-Fi)──> iPhone: Swift module (modules/glasses)
                                   │  Core ML face recognition ON THE PHONE (frames discarded)
                                   │  {personId|null, score} decisions, WAV audio, enrollment multipart
                                   │  (URLSession + Bearer token; bytes never touch JS)
                                   ▼
                       Next.js 16 route handlers (apps/web)
                         │  Postgres (Docker, :5432) via Prisma 7
                         │  Vercel Blob (enrollment photos) / local disk fallback
                         │  ElevenLabs TTS + Scribe STT, OpenAI STT fallback, Claude (answers)
                         ▼
                Caregiver dashboard (same Next app) + /live projector view (SSE)
Expo JS UI ── small values only (config, ids, text, events) ── Swift module
```

### Decisions and why

| Decision | Why |
| --- | --- |
| The Next.js app is both the backend and the caregiver portal | CLAUDE.md requires it. No WebSockets: the server pushes to clients over SSE (`/api/stream`), and the phone polls. |
| **Face recognition runs on the phone** (`modules/glasses/ios/FaceRecognizer.swift` + `LocalRecognition.swift`: Apple Vision detection, InsightFace buffalo_sc MobileFaceNet as a 6.6 MB Core ML model, cosine ≥ 0.5 against the roster) | User decision Oct 24 evening, replacing the earlier Python sidecar (removed). Frames are matched in memory on the device and discarded; the server never sees a camera frame, only `POST /api/recognitions {personId|null, score}`. The phone builds its roster by embedding the enrollment photos it fetches from `GET /api/people` + `/api/files/[id]`. Embedding takes 8-14 ms per face. |
| **All bytes go Swift → Next directly** | User requirement: crossing the JS/Swift bridge is expensive. Enrollment photos, ask audio, ambient audio and TTS downloads all use `URLSession` in Swift; glasses frames stay on the phone. JS only passes file URIs, IDs and text. The integration agent checked this with a grep. |
| Swift speaks the line from `/api/recognitions` itself (or the roster copy of the line if the server is unreachable) | No JS round trip, so recognition can be spoken within 2 s. It still emits `onFrameResult` so the screen shows boxes and the spoken line. |
| Accounts have a `role`: `CAREGIVER` (default; sets up for someone else, the Patient gets their name) or `WEARER` (sets up for themselves; the Patient is created with the user's own name). Mobile onboarding asks this first; copy adapts ("Ruth's glasses" vs "your glasses"). | Added Oct 24 evening with migration `user_role`. The web signup still creates caregivers. |
| Auth: email + password | bcryptjs at cost 12. Sessions live in the DB, and only SHA-256 hashes of tokens are stored. Web uses the `recall_session` httpOnly cookie; the phone uses `Authorization: Bearer` (a DEVICE session, kept in the iOS Keychain). Resend sends verify and reset emails; with no key, the link is printed to the server log. |
| Files: Vercel Blob (private) with a `File` row per object | User requirement. The UI loads photos only through the authed `/api/files/[id]`. With no `BLOB_READ_WRITE_TOKEN`, files go to `apps/web/.cache/blobs` (local fallback, which is what currently runs). |
| Frames are never stored | Privacy decision from CLAUDE.md. The old `Capture` table was dropped. Enrollment photos are rotated upright and their EXIF/GPS data is stripped. |
| Debounce | Each person is announced at most once per 5 minutes, and unknown faces at most once per 60 seconds. The debounce lives on the phone (`LocalRecognition`); the server trusts it and does not re-debounce. |
| TTS caching | `speechId` is the first 16 hex characters of sha256(text). Audio is cached in `.cache/speech/`, so the same words always sound the same (a tone rule). Swift falls back to AVSpeechSynthesizer. |
| Ask flow | Speech-to-text (Scribe, falling back to OpenAI), then a context packet (`lib/context.ts`: tone rules, people seen today, the last 10 minutes of transcript, reminders, time, place), then `claude-sonnet-5-5` with `max_tokens` 200. A repeated question within 2 hours gets the previous answer word for word, and the QUESTION event is marked with `data.repeat`. |
| Local Postgres, not SQLite | The schema needs enums and JSON. The user asked about SQLite and accepted Postgres. |
| ngrok for development | The user asked to tunnel for now and deploy behind DNS before the demo. |

## Data model (`apps/web/prisma/schema.prisma`, migration `recall_core`)

The tables are Patient, User (caregiver, belongs to one patient), Session (WEB or DEVICE), AuthToken (VERIFY or RESET), Person, File (FACE_PHOTO or AVATAR), Memory, Event, and Reminder. The old `FaceSample` table was dropped (migration `drop_face_samples`) when matching moved onto the phone; no embeddings are stored anywhere. Event types are RECOGNITION, UNKNOWN, UTTERANCE, QUESTION, ANSWER, REMINDER and SPOKEN. Every query is scoped by `patientId` from `requireSession`.

The Prisma CLI's `migrate dev` refuses to run in a non-interactive shell. Write migrations with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/<ts>_<name>/migration.sql`, then run `prisma migrate deploy`.

Seed (`pnpm --filter web db:seed`): patient "Ruth", login **demo@recall.local / recall-demo**. The e2e runs also leave `e2e-*@recall.local` users in the database; they are harmless.

## Code map

- `apps/web/src/lib/`:
  - `auth.ts`: requireSession, getSession, createSession, plus helpers.
  - `email.ts`: Resend.
  - `line.ts`: `knownLine` / `UNKNOWN_LINE`, the words the glasses say.
  - `storage.ts`: Blob or local storage.
  - `tts.ts`, `stt.ts`, `claude.ts`, `context.ts`.
  - `events.ts`: `logEvent`.
- `apps/web/src/app/api/`:
  - `auth/*`: signup, login, logout, forgot, reset, verify, and `me`.
  - recognitions (the phone posts who it saw), people, files, speech, ask, utterances, reminders, events, stream.
  - `_lib/http.ts`: error helper. It calls `unstable_rethrow` first.
- `apps/web/src/app/(auth)/`: the login, signup, forgot and reset pages.
- `apps/web/src/app/(care)/`: Overview `/`, `/people`, `/reminders`, `/live` (the projector view, fed by SSE).
- `apps/web/src/proxy.ts`: redirects signed-out page requests to `/login`. It only checks that the cookie exists; the real check is `requireSession`.
- `apps/web/scripts/test-auth.sh`, `test-api.sh`, and `scripts/e2e.sh` at the repo root: curl smoke tests (`scripts/testdata/` holds the public test photos).
- `apps/mobile/modules/glasses/ios/`:
  - `GlassesModule.swift` (the JS API), `GlassesController.swift` (DAT registration, session, stream, mock).
  - `FaceRecognizer.swift` (Vision detection + Core ML embedding), `LocalRecognition.swift` (roster, matching, debounce, posts decisions), `FaceSelfTest.swift` (DEBUG agreement check), `Models/FaceEmbedder.mlmodelc`, `BackendClient.swift`.
  - `Speaker.swift` (A2DP route check, queued playback, Apple speech fallback), `AudioCapture.swift` (glasses in-band audio, falling back to the phone mic after 4 s).
  - `GlassesPreviewView.swift`, `GlassesAppDelegateSubscriber.swift` (the `memoryaid://` callback from Meta AI).
  - The DAT SDK 1.0.1 frameworks (Core, Camera, MockDevice) are downloaded by `ios/scripts/fetch-dat.sh` during `pod install`. They are gitignored and are not an SPM dependency.
- `apps/mobile/src/`:
  - `app/(auth)/`: onboarding (`index` welcome, `who` picks wearer vs caregiver, `create`, `sign-in`).
  - `app/(tabs)/`: Live (`index`), Today (timeline + reminders), People, Settings.
  - `app/add-person.tsx` and `app/add-reminder.tsx` (modal sheets), `app/person/[id].tsx` (detail + remove).
  - `components/ui.tsx`: the UI kit (type, Button, Field, Group/Row, Notice, StatusPill, Avatar, chrome).
  - `constants/theme.ts`: tokens and type scale. `lib/api.ts`: typed caregiver calls.
  - `lib/glasses.ts`: a safe wrapper around the module.
  - `lib/session.tsx`: token + account in secure-store, `/api/auth/me` check on launch, then `Glasses.configure`.
    The backend URL is `BACKEND_URL` from `EXPO_PUBLIC_BACKEND_URL` only; no in-app override.
  - `lib/feed.ts`: event feed plus the 15 s reminder poller.
  - The Live tab's "No glasses here? Use the phone camera" calls `startStream({mock:true})`.

## Running it (current dev setup)

Logs are in `.cache/logs/`. These processes are running right now in the background on the user's Mac:

```sh
pnpm db:up                                   # Postgres (container memory-aid-db-1)
cd apps/web && pnpm build && pnpm start      # 0.0.0.0:3000 (demo uses build+start, never next dev)
ngrok http 3000                              # https://5c13-130-203-75-49.ngrok-free.app (changes on restart)
cd apps/mobile && npx expo start --dev-client --tunnel ngrok   # Metro via @expo/ngrok (Expo's signed tunnel failed)
```

- **Backend URL on the phone:** fixed at bundle time from `EXPO_PUBLIC_BACKEND_URL` in `apps/mobile/.env.local` (gitignored; template in `.env.example`), currently the ngrok URL. There is no URL field in the app anymore.
- **Email links:** `APP_URL` in `apps/web/.env` is also the ngrok URL.
- **If the ngrok URL changes:** update both values, then restart Metro and `next start`.
- **Before the demo:** the user plans to deploy behind a real domain, then switch both values to it.

### iOS signing (this took a while)

- **Team:** `C78UA9J77Y` (George Mashini; the user says it was just upgraded to paid). It is set as `ios.appleTeamId` in `app.json`.
- **Certificate fix:** the certificate showed as invalid until Apple's **WWDR G3 intermediate** was added to the login keychain. That's done now.
- **`expo run:ios --device` fails:** it can't create a provisioning profile. Build and install manually instead:
  ```sh
  cd apps/mobile && xcodebuild -workspace ios/MemoryAid.xcworkspace -scheme MemoryAid -configuration Debug \
    -destination 'id=00008130-0014595A1A92001C' -derivedDataPath ios/build \
    -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
  xcrun devicectl device install app --device 00008130-0014595A1A92001C ios/build/Build/Products/Debug-iphoneos/MemoryAid.app
  ```
- **When to rebuild:** native changes need `pnpm prebuild` (`CI=1` for non-interactive) and then the rebuild above. JS-only changes hot-reload through Metro.

## Keys (`apps/web/.env`; placeholders in `.env.example`)

None are set yet, except that `APP_URL` was added. Every feature that needs a key fails with a clear 503 instead of crashing.

| Key | What breaks without it |
| --- | --- |
| `ANTHROPIC_API_KEY` | Ask (demo beat 2/3, P0) |
| `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` | Glasses voice falls back to Apple's built-in speech; Scribe speech-to-text unavailable |
| `OPENAI_API_KEY` | No speech-to-text fallback. Without either this or ElevenLabs, audio ask and utterances return 503 |
| `BLOB_READ_WRITE_TOKEN` | Photos go to local disk instead of Vercel Blob |
| `RESEND_API_KEY` | Email links are printed to the server log instead of sent. `EMAIL_FROM` defaults to `onboarding@resend.dev`, which only delivers to the Resend account owner |
| `GEMINI_API_KEY` | Nothing yet: no code uses it |

Optional overrides: `ELEVENLABS_MODEL_ID`, `ELEVENLABS_STT_MODEL`, `OPENAI_STT_MODEL`, `APP_TIME_ZONE`, `PLACE`, `FACE_URL`, `FACE_PROVIDERS`. Restart `next start` after editing `.env`.

## Remember (added Oct 24 evening)

Duolingo-shaped, but never a quiz. The phone's **Remember** tab shows one enrolled face at a time
and asks "Do you know who this is?" with two answers: **Yes, I know them** (then "Tell me about
Sarah", mic capture through the Swift module → `/api/transcribe`, the words shown back as a quote,
**Keep this memory**) or **Tell me who it is** (plays the exact introduction through the glasses).
Every step is a `PRACTICE` event. Kept memories (`Memory` table) are distilled by Claude into one
second-person sentence (`calloutText`) and the newest one switched on is appended to the spoken
line for that person (`knownLine` in `lib/match.ts`). Name, relationship, note, and each memory's
sentence and on/off switch are editable on the phone (person screen → Edit, memory rows, sheets
`edit-person`, `edit-memory`) and on the web (`/people/[id]`). The web also has `/remember`
(visits + newest memories) and a card on the overview. **Today is now the default tab**
(`(tabs)/index.tsx`); Live moved to `(tabs)/live.tsx`.

Needs before it is demo-ready: a **native rebuild** for the new `startListening`/`stopListening`
functions (typing works without it), `ANTHROPIC_API_KEY` for good callout sentences (local
fallback otherwise), and an STT key for voice. `next build && next start` must be rerun for the
new routes.

## Next steps, in priority order

1. **Finish the device test** with the user, using the integration agent's checklist (summarized):
   1. Mock camera path: the frame appears, a box is drawn, "Someone new is here" is heard.
   2. Enroll, then recognize. Check that `/live` updates on the laptop.
   3. Register the real glasses (Settings > Register glasses; Meta AI developer mode must be on), then stream at about 7 fps.
   4. A recognized line plays through the glasses. The Xcode console must show `audio route: a2dp`.
   5. Ask, once the keys are in.
   6. A reminder fires within about 15 s of being due.
   7. Fold and unfold the glasses and confirm it recovers.

   Cut line from CLAUDE.md: if there is no real stream by 4:30 PM, keep building on the mock path and retry the glasses at 8 PM. Time-box glasses problems to 30 minutes and write them in `NOTES.md`. The DAT skills and tools are installed: `mwdat-ios:*` skills, the `search_dat_docs` MCP tool, and `mwdat-ios:live-debugging-mcp`.
2. **Get the keys into `.env`, then rerun `scripts/e2e.sh`.** The TTS and ask steps should pass.
3. **Tune the on-device match threshold and crop on real glasses frames.** It was only checked on still photos (`FaceRecognizer.cropScale` / `cropShiftY`).
4. **Deploy behind DNS** (the user's plan), then point the mobile `.env.local` and `APP_URL` at it. Recognition is on the phone, so the server only needs to be reachable for logging and speech.
5. **Devpost draft must exist by 12:00 AM Sunday.** Draft it from this file plus `NOTES.md`.
6. **P1 features**, in this order: orientation on demand, repetition-aware answers (partly done), one-tap enroll for unknown people, Gemini scene captions (MLH prize). After that, caregiver email invites and the sponsor prizes.

## Known loose ends

- `apps/web` does not export `runtime = "nodejs"` from its routes. With `cacheComponents` on, Next 16.4 says to leave it out. CONTRACT.md was updated to say so.
- The glasses in-band mic is experimental and may need a Developer Center approval. If it doesn't deliver audio, the code falls back to the phone mic, and it logs which source it used.
- The ambient-audio silence filter (RMS < 60) hasn't been tuned on real audio.
- The design canvas lives at https://claude.ai/code/artifact/5ec48133-dbbd-4ea3-9276-a3373734f0a2 and the full build plan at https://claude.ai/artifact/3fJURHWSzEBituLYhUowPk. Note that the build plan's "FastAPI backend + WebSocket" stack is superseded by CLAUDE.md and this file.
