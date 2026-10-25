# Recall API and module contract

Single source of truth for the web API (`apps/web`) and the Swift module
(`apps/mobile/modules/glasses`). Update this file before changing either side.

## Ground rules

- **Faces are recognized on the phone.** Glasses frames are matched on-device (Core ML) and
  discarded; no camera frame is ever uploaded. The server receives only decisions
  (`POST /api/recognitions`), logs them, and returns the words to say.
- **Bytes go Swift → Next directly.** Every request carrying image or audio bytes (enrollment
  photos, ask audio, ambient audio) and every TTS download is made by Swift with
  `URLSession`. JS never sees pixels or audio. Only small values cross the JS/Swift bridge.
  JSON-only caregiver calls (login, roster, reminders poll) may use JS `fetch`.
- **Auth everywhere.** Every `/api/*` route except `/api/auth/*` calls
  `requireSession(req)` from `@/lib/auth` (already implemented). It accepts
  `Authorization: Bearer <token>` (phone) or the `recall_session` cookie (web) and returns
  `{ user, patientId }`, or throws `AuthError` (use `unauthorized(err)` to turn it into a 401).
  All queries are scoped by `patientId`.
- **Privacy.** Glasses frames never leave the phone. No face embeddings are stored anywhere.
  Enrollment photos go to Vercel Blob and are referenced by `File` rows; the UI only ever loads
  them through `/api/files/[id]` (authed). Deleting a person deletes their blobs.
- Route handlers read raw bodies with `await req.arrayBuffer()`. Do **not** add
  `export const runtime` (Next 16.4 with `cacheComponents` rejects it; Node is the default).
  Catch-all error handlers must call `unstable_rethrow(err)` first (done in `api/_lib/http.ts`).
- Errors: `{ "error": string }` with a sensible status.
- Dev backend: `http://<mac LAN IP>:3000`.
- Seeded login: `demo@recall.local` / `recall-demo` (patient "Ruth").

## Auth (`/api/auth/*`, no session required)

| Route | Body | Response |
| --- | --- | --- |
| `POST /api/auth/signup` | `{email, password, name, patientName?, role?}` | `201 {user}`; sets cookie (with `?client=device`: `201 {user, token}`, no cookie); creates User + Patient; sends verify email (Resend). `role` is `"caregiver"` (default; `patientName` required) or `"wearer"` (setting up for themselves; `patientName` defaults to `name`) |
| `POST /api/auth/login` | `{email, password}` | `200 {user}` + cookie. With `?client=device`: `200 {user, token}` and no cookie (kind DEVICE) |
| `POST /api/auth/logout` | none | `204`; deletes the session (cookie or bearer) |
| `POST /api/auth/forgot` | `{email}` | `204` always (no account enumeration); emails a reset link if the user exists |
| `POST /api/auth/reset` | `{token, password}` | `204`; one-time token, 30 min expiry; invalidates other sessions |
| `GET /api/auth/verify?token=` | | redirects to `/?verified=1` (or `/?verified=0` if expired/used) |
| `GET /api/auth/me` | | `200 {user, patient: {id, name}}` or `401`; phone uses it to check a saved token |

Passwords: bcryptjs cost 12, min 8 chars. Tokens: `newToken()` / `hashToken()` from `@/lib/auth`.
Public user shape everywhere: `{id, email, name, role: "CAREGIVER" | "WEARER", patientId, emailVerifiedAt, createdAt}`.

The phone's backend URL is fixed at build time from `EXPO_PUBLIC_BACKEND_URL` in `apps/mobile/.env.local`
(see `apps/mobile/.env.example`); there is no in-app override.

## Glasses pipeline (called by Swift)

### `POST /api/recognitions`
The phone matched a glasses frame on-device (`modules/glasses/ios/LocalRecognition.swift` +
`FaceRecognizer.swift`: Apple Vision detection, InsightFace buffalo_sc MobileFaceNet as a 6.6 MB
Core ML model, see `modules/glasses/scripts/README.md`). Match: cosine similarity against every
roster photo embedding; a person's score is their best photo; known if score ≥ 0.5. Debounce (on
the phone): announce a person at most once per 5 min, strangers at most once per 60 s, and
strangers only when nobody known is in frame. Only the decision is posted, as JSON:
```json
{ "events": [ { "personId": "ck..", "score": 0.71, "box": [x, y, w, h] },
              { "personId": null, "score": 0.12, "box": [x, y, w, h], "count": 1 } ] }
```
`box` is in pixels of the camera frame (504x896 typical) and is kept only as event data.
Response `{speak: {speechId, text}}` (or `{}` when nothing is said). The server logs
`RECOGNITION` / `UNKNOWN` (with `data.score`, `data.box`, `data.source = "device"`) and `SPOKEN`,
and builds the line (`knownLine` in `lib/line.ts`, including the newest memory). The phone speaks
the returned text; if the request fails it speaks the roster copy of `line` (Apple speech) so the
wearer is never left in silence. The server does **not** re-debounce; the phone is authoritative.
An unknown `personId` is `404`; an empty `events` array is `400`.

- Known line: `This is {name}, your {relationship}. {notes} {memory}` (omit missing parts).
  Unknown line: `Someone new is here.` Never guess a name below threshold.

Roster on the phone: `GET /api/people` → for every `photoUrls` entry the phone fetches
`/api/files/[id]` and embeds the largest face itself (cached per file id in memory). Synced when a
stream starts, after `enrollPerson`, and on `syncRoster()`. A photo with no detectable face is
skipped (logged), so a person enrolled from the web with a poor photo may have 0 usable samples.

### `GET /api/speech/[id]`
Returns `audio/mpeg`. `id` = sha256(text) prefix; the text is registered server-side when the
speechId is minted (`lib/tts.ts` `speechIdFor(text)`). Audio is generated with ElevenLabs once
and cached on disk (`.cache/speech/<id>.mp3`, gitignored), so the same words always sound the
same. Swift falls back to `AVSpeechSynthesizer` with the `text` it already has if this fails.

### `POST /api/ask`
Body: raw `audio/wav` (16 kHz mono PCM16) or JSON `{text}`. Server: transcribe (ElevenLabs
Scribe, OpenAI fallback) → build context packet → Claude → answer. Response:
`{question, answer, speechId}`. Logs `QUESTION` and `ANSWER` (+ `SPOKEN`). Repeated questions
get the same wording; mark `data.repeat = true` on the QUESTION event. An empty transcript
returns `200 {question: "", answer: "I didn't catch that. You can ask me again.", speechId}` and
logs no QUESTION. Missing STT/Claude keys return `503 {error}`.

### `POST /api/utterances`
Body: raw `audio/wav` ~10 s ambient chunk. Response `{text}`; logs `UTTERANCE` when non-empty.

### `GET /api/reminders/due`
Returns `{reminders: [{id, text, speechId}]}` for reminders with `dueAt <= now` and no
`firedAt`; marks them fired and logs `REMINDER` + `SPOKEN`. Phone polls every 15 s.

## People and files

### `POST /api/people`
`multipart/form-data`: `name` (required), `relationship`, `notes`, `photos` (1–3 JPEG files),
optional `faces` (JSON `[[x, y, w, h], ...]`, one box per photo in pixels of the uploaded JPEG).
The server runs no face model: it re-encodes each photo (EXIF rotation applied, metadata stripped)
and stores it in Blob as a `FACE_PHOTO` `File` (dev fallback without `BLOB_READ_WRITE_TOKEN`:
local disk under `apps/web/.cache/blobs`, `File.url = local:<path>`). The first photo is also
cropped to a 160px `AVATAR`: around the face box when `faces` is given (the phone always detects
the face first and refuses photos without one), otherwise the centre square (web enrollment).
Unreadable photos are rejected with `422 {error, index}` before anything is saved. Response
`201 {person}`. The phone re-syncs its roster right after.

### `GET /api/people` → `{people: [Person]}`
`Person = {id, name, relationship, notes, avatarUrl, photoUrl, photoUrls, photoCount, lastSeenAt, line, memoryCount, lastRememberedAt}`.
`avatarUrl` is `/api/files/<avatarFileId>` or null; `photoUrl` is the first full enrollment photo
(for the Remember portrait); `photoUrls` is every enrollment photo, oldest first (the phone embeds
these for on-device recognition). `line` is the exact sentence the glasses say for this person.

### `GET /api/people/[id]` → `{person: Person & {memories: [Memory], visits: [{id, knew, at}]}}`
### `PATCH /api/people/[id]` `{name?, relationship?, notes?}` (null clears) → `{person}`.
### `DELETE /api/people/[id]` → `204` (deletes blobs, files, memories; keeps events with personId nulled)

## Remember (gentle practice; never scored, never corrected)

The spoken line for a known person is `knownLine` in `lib/line.ts`:
`This is {name}, your {relationship}. {notes} {memory}` where `memory` is the `calloutText` of the
newest `Memory` with `useInCallout = true`. `lib/people.ts` and the web/mobile `knownLine` /
`introductionLine` helpers build the same string. The phone keeps a copy of `line` in its roster
as an offline fallback, but speaks the server's text from `/api/recognitions` when reachable.

`Memory = {id, personId, text, calloutText, useInCallout, source, createdAt, updatedAt}`;
`source` is `WEARER_VOICE | WEARER_TYPED | CAREGIVER`. `text` is the speaker's own words, kept
as said. `calloutText` is one second-person sentence (≤ 160 chars) distilled by Claude
(`lib/memories.ts`, `claude-sonnet-5-5`, JSON `{callout, usable}`); without `ANTHROPIC_API_KEY`
the first sentence of `text` is used and `usable` is a length check.

### `POST /api/remember` `{personId, knew: boolean}` → `{line, speechId}`
Logs `PRACTICE` with `data: {kind: "visit", knew, speechId}`. When `knew` is false also logs
`SPOKEN` (`source: "remember"`); the phone plays `speechId` through the glasses.

### `POST /api/transcribe` body raw `audio/wav` → `{text}`
Speech-to-text only (same STT chain as ask). Nothing is logged; the words persist only if kept.

### `POST /api/people/[id]/memories` `{text, calloutText?, source?, useInCallout?}` → `201 {memory, usable}`
Distills `text` unless `calloutText` is given. `useInCallout` defaults to `usable`. Logs
`PRACTICE` with `data: {kind: "memory", memoryId, source, useInCallout}`.

### `PATCH /api/memories/[id]` `{text?, calloutText?, useInCallout?}` → `{memory}`
### `DELETE /api/memories/[id]` → `204`

Event type `PRACTICE` was added to `EventType`. Caregiver web: `/remember` (visits and newest
memories), `/people/[id]` (introduction editor, memories with "say this" toggles, visit history).

### `GET /api/files/[id]` → streams the blob (authed, scoped to patient). Never expose raw blob URLs.

## Caregiver

- `GET /api/events?since=<iso>&limit=` → `{events: [{id, type, text, personId, personName, data, createdAt}]}` newest first.
- `DELETE /api/events/[id]` → `204`.
- `POST /api/reminders` `{text, dueAt}` → `201 {reminder}`; `GET /api/reminders` → `{reminders}`; `DELETE /api/reminders/[id]`.
- `GET /api/stream` → SSE (`text/event-stream`), one `event: event` per new Event row
  (`data:` = the event JSON as in `/api/events`), polling the DB every 1 s server-side, heartbeat
  comment every 15 s. Used by `/live` and the dashboard.

## Context packet (`lib/context.ts`) sent to Claude on every ask

Wearer profile and tone rules (short, warm, declarative; one fact per sentence; never correct or
quiz; same answer in same words for repeats); people recognized today with times and notes; last
10 min of UTTERANCE transcript; upcoming and recent reminders; current local time; place
(`PLACE` env, default "the ECoRE building at Penn State").

## Swift module (`modules/glasses`) JS API

```ts
configure(opts: { backendUrl: string; token: string }): Promise<void>  // token kept in Keychain
register(): Promise<void>                    // DAT registration via Meta AI app
startStream(opts?: { mock?: boolean }): Promise<void>
  // camera 504x896 @ 7 fps, faces matched on the phone. mock=true runs the same pipeline on
  // MockDeviceKit with the phone's back camera (fallback demo path); status.mock becomes true.
stopStream(): Promise<void>
getStatus(): Promise<GlassesStatus>
enrollPerson(p: { name: string; relationship?: string; notes?: string; photoUris: string[]; seedPhotoUri?: string }):
  Promise<{ personId: string; photos: number }>    // detects faces on-device, multipart upload with boxes
  // seedPhotoUri (optional, normally photoUris[0]): in every other photo the face closest to the
  // seed's largest face is chosen (group shots from the library); a photo whose best face scores
  // < 0.4 against the seed is rejected ("That photo does not look like the same person").
  // Without a seed each photo's largest face is used (live capture, unchanged).
captureGlassesPhoto(): Promise<string>       // file:// URI of a glasses photo
startAsk(): Promise<void>                    // begins mic capture
stopAsk(): Promise<{ question: string; answer: string }>  // uploads to /api/ask, speaks answer
startListening(): Promise<void>              // begins mic capture for a Remember memory
stopListening(): Promise<{ text: string }>   // uploads to /api/transcribe, returns the words (nothing spoken)
speak(speechId: string, text: string): Promise<void>      // downloads /api/speech/id, plays over A2DP
syncRoster(): Promise<{ people: number; samples: number }>  // re-embed the roster from the enrollment photos

// Photo library index (PhotoIndex.swift). Phone-local, role-agnostic, never synced or uploaded.
// Indexes faces in the newest 2,000 library photos with the same on-device model so that whoever
// is enrolling a person can pick real photos of them (different days, angles, light) for the
// remaining enrollment slots. It is a SEPARATE store from the roster: LocalRecognition never
// reads it, and a library face joins the roster only when the enroller taps it and saves.
photoIndexStatus(): Promise<PhotoIndexStatus>
photoIndexStart(): Promise<PhotoIndexStatus>   // requests Photos permission (readWrite) if needed, starts or resumes
photoIndexPause(): Promise<PhotoIndexStatus>   // stops after the current asset; checkpoint kept
photoIndexClear(): Promise<void>               // deletes the index files and exported thumbnails
photoIndexSearch(seedPhotoUri: string): Promise<PhotoCandidate[]>
  // embeds the largest face in the seed photo and searches the index: score >= 0.45, greedy
  // diversity (cosine < 0.92 to every kept candidate), up to 12, best first
photoIndexExport(candidateId: string): Promise<string>
  // file:// JPEG (1280 px max) of that candidate's asset in tmp, for enrollPerson.photoUris

type PhotoIndexStatus = {
  permission: 'notDetermined' | 'denied' | 'limited' | 'authorized';
  state: 'idle' | 'indexing' | 'paused' | 'done';
  indexed: number;      // assets processed (incl. zero-face and skipped)
  total: number;        // assets in scope (max 2000)
  faces: number;        // face entries stored
  skipped: number;      // not on this device (iCloud originals are never downloaded)
  upgraded: number;     // assets that needed the 2048 px pass for a small face
};
type PhotoCandidate = { id: string; score: number; thumbUri: string; takenAt: string };
  // id = "<assetLocalIdentifier>#<faceIndex>"; thumbUri = 256 px square face crop in tmp

type GlassesStatus = {
  registration: "unregistered" | "registering" | "registered";
  connection: "disconnected" | "connecting" | "connected";
  streaming: boolean;
  audioRoute: "a2dp" | "hfp" | "speaker" | "other";
  mock: boolean;
  rosterPeople: number;        // on-device roster size (people, embedded photos)
  rosterSamples: number;
};

Events:
onStatus(status: GlassesStatus)
onFrameResult({ faces: Face[]; speak?: { speechId: string; text: string }; frameWidth: number; frameHeight: number })
  // matched on the phone; speak.speechId is "" until /api/recognitions answers
onAudioRoute({ route: GlassesStatus["audioRoute"]; portName: string })
onSpoken({ text: string; route: string })      // after each line plays
onError({ message: string })
onPhotoIndex(status: PhotoIndexStatus)        // at most every 500 ms while indexing, and on every state change

View: <GlassesPreview style={...} />           // renders latest frame natively
```
Swift speaks the line itself (no JS round trip) and still emits `onFrameResult` so the UI can
draw boxes and show the line.

## Environment (`apps/web/.env`, see `.env.example`)

`DATABASE_URL`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`,
`OPENAI_API_KEY` (STT fallback), `BLOB_READ_WRITE_TOKEN` (optional in dev), `RESEND_API_KEY`,
`EMAIL_FROM`, `APP_URL` (defaults to request Host), `PLACE`. Optional overrides:
`APP_TIME_ZONE` (default `America/New_York`), `ELEVENLABS_MODEL_ID`, `ELEVENLABS_STT_MODEL`,
`OPENAI_STT_MODEL`. Missing keys yield `503 {error}`, never a crash.
