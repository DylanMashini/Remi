# Remi API and module contract

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
- **Privacy.** Glasses frames never leave the phone for recognition. The one exception is a
  deliberate ask: when the wearer taps Ask, the single frame they are looking at rides along with
  their question to `/api/ask`, is shown to the model, and is discarded with the request (never
  stored). No face embeddings are stored anywhere.
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
`FaceRecognizer.swift`: Apple Vision detection, InsightFace buffalo_l ResNet50 ArcFace (`w600k_r50`)
as an 83 MB Core ML model, see `modules/glasses/scripts/README.md`). Match: cosine similarity against
every roster photo embedding; a person's score is their best photo; known if score ≥ 0.30
(`FaceModel.matchThreshold`; source `eval/face-models/RESULTS.md`). Debounce (on
the phone): announce a person at most once per 5 min, strangers at most once per 60 s, and
strangers only when nobody known is in frame. Only the decision is posted, as JSON:
```json
{ "events": [ { "personId": "ck..", "score": 0.71, "box": [x, y, w, h] },
              { "personId": null, "score": 0.12, "box": [x, y, w, h], "count": 1 } ] }
```
`box` is in pixels of the camera frame (504x896 typical) and is kept only as event data. `score`
is on the ResNet50 scale since Oct 24 night (strangers rarely above 0.15, same person 0.4 to 0.8);
the server stores it as data only and nothing filters or colours by it.
Response `{speak: {speechId, text}}` (or `{}` when nothing is said). The server logs
`RECOGNITION` / `UNKNOWN` (with `data.score`, `data.box`, `data.source = "device"`) and `SPOKEN`,
and builds the line (`knownLine` in `lib/line.ts`, including the newest memory). The phone speaks
the returned text; if the request fails it speaks the roster copy of `line` (Apple speech) so the
wearer is never left in silence. The server does **not** re-debounce; the phone is authoritative.
An unknown `personId` is `404`; an empty `events` array is `400` (unless `trigger` is set, below).

- Known line: `This is {name}, your {relationship}. {notes} {memory}` (omit missing parts).
  Unknown line: `Someone new is here.` Never guess a name below threshold.
- Audio tags: a bracketed stage direction in a note, memory, or reminder (`[laughs]`,
  `[whispers]`, `[sighs]`) is performed by the voice, not read. The server generates that line
  with `eleven_v4_turbo` instead of Flash (which ignores tags) and strips the tags from every
  `line` / `text` it returns or logs, so the phone screen, the timeline, and the Apple-speech
  fallback show plain words. `speechId` is still minted from the tagged text.

**On demand (glasses button).** A short press of the capture button (top right of the right
temple, DAT Inputs capability, beta) or the phone's `Glasses.whoIsHere()` makes the phone answer
"who is here?" from the latest frame with the debounce skipped. It posts the same body plus
`"trigger": "glasses" | "phone"`; `events` may then be empty. The server names every known person,
adds `Someone new is here too.` when a stranger stands next to them (or `Someone new is here.`
alone), and says `I don't see anyone right now.` for an empty frame. Every logged event carries
`data.source = "button"` and `data.trigger`; the timeline labels the SPOKEN row "asked who was here".
The phone restarts the passive cooldown for everyone it named, so the stream does not repeat them.
Offline, the phone speaks its roster copies (`nobody.speechId` from `GET /api/people` is cached).

Roster on the phone: `GET /api/people` → for every `photoUrls` entry the phone fetches
`/api/files/[id]` and embeds the largest face itself (cached per file id in memory). Synced when a
stream starts, after `enrollPerson`, and on `syncRoster()`. A photo with no detectable face is
skipped (logged), so a person enrolled from the web with a poor photo may have 0 usable samples.

### `GET /api/speech/[id]`
Returns `audio/mpeg`. `id` = sha256(text) prefix; the text is registered server-side when the
speechId is minted (`lib/tts.ts` `speechIdFor(text)`). Audio is generated with ElevenLabs once
(`eleven_flash_v2_5`, voice `ELEVENLABS_VOICE_ID`, default premade "Bella"; Voice Library voices
need a paid plan and return 402) and cached on disk (`.cache/speech/<id>.mp3`, gitignored), so
the same words always sound the same. The ElevenLabs key never leaves the server; the phone only
ever calls this route. Swift caches each download in `Library/Caches/speech/<id>.mp3` and
prefetches every roster `speechId` (plus `unknown.speechId`) when the roster syncs, so a
recognition normally plays from disk with no network wait. Swift falls back to
`AVSpeechSynthesizer` with the `text` it already has if the audio cannot be fetched or decoded.

### `POST /api/ask`
Body, preferred: `multipart/form-data` with `audio` (`audio/wav`, 16 kHz mono PCM16) **or** `text`,
plus an optional `frame` (`image/jpeg`, ≤ 4 MB): the latest glasses frame, what the wearer is
looking at as they ask. Legacy bodies still work: raw `audio/wav`, or JSON `{text}` (no frame).

Server (`lib/realtime.ts`): one OpenAI Realtime WebSocket session per question, model
`OPENAI_REALTIME_MODEL` (default `gpt-realtime-2.1`). The session gets the tone rules plus the
context packet as `instructions`, `output_modalities: ["text"]`, and `turn_detection: null`. The
frame goes in as an `input_image` user item; the audio is resampled 16 → 24 kHz (the only PCM rate
the API takes) and sent through `input_audio_buffer.append` + `commit` so the server-side
transcription (`OPENAI_REALTIME_TRANSCRIBE_MODEL`, default `gpt-4o-mini-transcribe`) produces the
question text for the log; then `response.create`. The answer is **text**, spoken through the same
ElevenLabs `speechId` path as every other line (one voice everywhere; the realtime model's own
voice is not used). The frame lives in server memory for the request only: never written to disk,
Blob, or the DB.

Fallback: if `OPENAI_API_KEY` is missing or the realtime call fails (5xx/timeout) and
`ANTHROPIC_API_KEY` is set, the old chain runs: transcribe (ElevenLabs Scribe, OpenAI fallback) →
context packet → Claude, without the frame. Neither key → `503 {error}`.

Response: `{question, answer, speechId, frame: boolean}` (`frame` = a picture was used). Logs
`QUESTION` (`data: {normalized, source: "audio"|"text", frame, model, repeat, repeatOf?}`),
`ANSWER` (`data.model`) and `SPOKEN`. Repeated questions (near-identical in the last 2 h) get the
earlier answer word for word, whatever the model said this time. An empty transcript returns
`200 {question: "", answer: "I didn't catch that. You can ask me again.", speechId}` and logs no
QUESTION.

### Live conversation: `POST /api/realtime/session` and `POST /api/realtime/turns`

Turns are automatic: the wearer talks, pauses, and the glasses answer; nobody taps between turns.
The audio path is **phone ↔ OpenAI directly**: `/api/realtime/session` mints a short-lived client
secret (`POST https://api.openai.com/v1/realtime/client_secrets`, 10 min, API key stays on the
server) whose session config carries everything (tone rules + `CHAT_RULES`, the context packet, the
last 2 h of question/answer pairs so repeats get the same words, voice, turn detection). The Swift
module (`RealtimeChat.swift`) opens `wss://api.openai.com/v1/realtime?model=...` with
`Authorization: Bearer <clientSecret>` from `URLSessionWebSocketTask`; no conversation audio ever
touches `apps/web`. The model answers in **its own voice** (`OPENAI_REALTIME_VOICE`, default
`marin`, speed `REALTIME_SPEECH_SPEED` 0.9): 24 kHz PCM16 streamed to the phone and played through
`AVAudioEngine` over the current route (A2DP). Recognitions and reminders keep the ElevenLabs voice.

- `POST /api/realtime/session` (body `{}`) → `{sessionId, clientSecret, expiresAt, url, model, voice,
  turnDetection, bargeIn, greeting, farewell}`. `503` without `OPENAI_API_KEY`, `502` if OpenAI refuses.
- Turn detection (`lib/realtime.ts` `turnDetection()`): `server_vad` by default with
  `silence_duration_ms` **1500** (API default 500; older speakers pause mid-sentence), threshold 0.5,
  prefix 400 ms. Env: `REALTIME_TURN_DETECTION` (`server_vad` | `semantic_vad`), `REALTIME_SILENCE_MS`,
  `REALTIME_VAD_THRESHOLD`, `REALTIME_PREFIX_MS`, `REALTIME_EAGERNESS` (semantic: `low` default).
- Barge-in is **off** by default (`REALTIME_BARGE_IN=1` to allow): the phone closes the mic from
  `response.created` until the last audio buffer has played (+300 ms), so the open-ear speakers next to
  the temple mics cannot echo into a new turn. With barge-in, the phone stops playback on
  `speech_started` and sends `conversation.item.truncate` with the ms actually played.
- Greeting/farewell: the model says `greeting` ("I'm listening.") as soon as the session opens (an
  out-of-band `response.create` with `conversation: "none"`), and `farewell` after 90 s with nobody
  speaking, then the phone closes the socket. The screen shows "Conversation ended".
- Frames: when the wearer starts a turn (`input_audio_buffer.speech_started`) and a glasses frame
  ≤ 5 s old exists, the phone adds one `input_image` user item (768 px JPEG) before the audio item, so
  "what is this?" works. OpenAI discards it with the session; nothing is stored anywhere.
- `POST /api/realtime/turns` `{sessionId, question, answer, frame: boolean, model}` → `{ok, questionEventId,
  repeat}`. Posted by the phone for every finished turn (the wearer's transcript from
  `conversation.item.input_audio_transcription.completed`, the answer from the output transcript).
  Logs `QUESTION` (`data: {normalized, source: "chat", sessionId, frame, transcribed, repeat, repeatOf?}`),
  `ANSWER` and `SPOKEN` (`source: "chat"`, `speechId: null`, the words were spoken by the model). A
  turn whose transcript never arrived (4 s grace) is logged with the question `(not transcribed)`.
  The repeat rule can only be *encouraged* here (recent pairs are in the instructions); the server flags
  `repeat` but cannot swap the words after they were spoken.
- While a conversation runs, ambient `/api/utterances` chunks pause (the exchange would be logged twice).
  Tap-to-ask (`/api/ask`) stays as the fallback the Live screen switches to if `startChat` fails.

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

### `GET /api/people` → `{people: [Person], unknown: {line, speechId}, nobody: {line, speechId}}`
`Person = {id, name, relationship, notes, avatarUrl, photoUrl, photoUrls, photoCount, lastSeenAt, line, speechId, memoryCount, lastRememberedAt}`.
`speechId` is the `/api/speech/[id]` id for `line`; minting it here starts ElevenLabs generation on
the server, and the phone downloads every one during roster sync. `unknown` is the same for the
stranger line and `nobody` for the glasses-button line when no one is in view. When the server is unreachable at recognition time the phone speaks its roster
copy with that cached audio.
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

## Context packet (`lib/context.ts`) sent to the model on every ask (realtime instructions, or Claude in the fallback)

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
startAsk(): Promise<void>                    // begins mic capture; notes the frame on screen
stopAsk(): Promise<{ question: string; answer: string; sawFrame: boolean }>
  // multipart to /api/ask: the audio plus the newest glasses frame (≤ 5 s old, downscaled to
  // 768 px, JPEG 0.75; falls back to the frame noted at startAsk), speaks the answer
startChat(): Promise<{ sessionId; model; voice; bargeIn; turnDetection; silenceMs; micSource; trigger }>
  // live conversation (above): mic → OpenAI directly, automatic turns, answers in the model's voice.
  // Progress arrives as onChat events; ends on stopChat, 90 s of silence, or a dropped connection.
  // trigger: "phone" (this call) or "wake" ("Hey Remi" heard; see setWakeWord).
stopChat(): Promise<{ ended: boolean; turns: number }>
setWakeWord(on: boolean): Promise<{ enabled: boolean; phrase: "Hey Remi" }>
  // "Hey Remi" (WakeWord.swift): sherpa-onnx open-vocabulary keyword spotter on the phone, fed the
  // same 16 kHz mic audio as ambient transcription, only while a stream runs and no conversation or
  // ask owns the mic. Nothing leaves the phone until the phrase is heard. Off by default; survives
  // stream stop/start. On a hit: onWake, then startChat(trigger "wake") with the last 3 s of audio
  // (so "Hey Remi, who is this?" said in one breath is heard whole), no greeting, and audio said
  // while the socket opens is held rather than dropped. Muted while Remi speaks; 5 s cooldown after
  // a conversation ends. The client secret is prefetched while wake is on so the chat opens faster.
startListening(): Promise<void>              // begins mic capture for a Remember memory
stopListening(): Promise<{ text: string }>   // uploads to /api/transcribe, returns the words (nothing spoken)
speak(speechId: string, text: string): Promise<void>      // downloads /api/speech/id, plays over A2DP
syncRoster(): Promise<{ people: number; samples: number }>  // re-embed the roster from the enrollment photos

// Photo library index (PhotoIndex.swift). Phone-local, role-agnostic, never synced or uploaded.
// Indexes faces in the newest 2,000 library photos with the same on-device model (the sidecar
// records the model name; a different model or format version discards and rebuilds it) so that whoever
// is enrolling a person can pick real photos of them (different days, angles, light) for the
// remaining enrollment slots. It is a SEPARATE store from the roster: LocalRecognition never
// reads it, and a library face joins the roster only when the enroller taps it and saves.
photoIndexStatus(): Promise<PhotoIndexStatus>
photoIndexStart(): Promise<PhotoIndexStatus>   // requests Photos permission (readWrite) if needed, starts or resumes
photoIndexPause(): Promise<PhotoIndexStatus>   // stops after the current asset; checkpoint kept
photoIndexClear(): Promise<void>               // deletes the index files and exported thumbnails
photoIndexSearch(seedPhotoUri: string): Promise<PhotoCandidate[]>
  // embeds the largest face in the seed photo and searches the index: score >= 0.40, greedy
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
  wakeWord: boolean;           // "Hey Remi" listening is on (setWakeWord)
};

Events:
onStatus(status: GlassesStatus)
onFrameResult({ faces: Face[]; speak?: { speechId: string; text: string; pan: number }; frameWidth: number; frameHeight: number })
  // matched on the phone; speak.speechId is "" until /api/recognitions answers
onAudioRoute({ route: GlassesStatus["audioRoute"]; portName: string })
onSpoken({ text: string; route: string; pan: number })      // after each line plays
onError({ message: string })
onPhotoIndex(status: PhotoIndexStatus)        // at most every 500 ms while indexing, and on every state change
onChat(ev)  // { kind: "state", state: "connecting"|"listening"|"hearing"|"thinking"|"speaking"|"ended", reason?, sessionId }
            // | { kind: "transcript", role: "user"|"assistant", text, final, sessionId }   (text = the turn so far)
            // | { kind: "turn", question, answer, frame, route, sessionId }                 (also posted to /api/realtime/turns)
            // | { kind: "started", ...startChat result }   (a conversation JS did not start: trigger "wake")
onWake({ keyword: "HEY_REMI"; source: "glasses-inband" | "phone-mic" })  // heard; a conversation is starting

View: <GlassesPreview style={...} />           // renders latest frame natively
```
Swift speaks the line itself (no JS round trip) and still emits `onFrameResult` so the UI can
draw boxes and show the line.

**Spatial whisper.** `pan` is -1 (hard left) to 1 (hard right), 0 centre. The phone computes it from
the horizontal centre of the announced face box in the camera frame (`LocalRecognition.pan(for:)`:
offset from frame centre, times 1.5, clamped), averaged when one line names several people; answers
and reminders are 0. `Speaker` applies it as `AVAudioPlayer.pan` on the ElevenLabs audio, so over
A2DP the glasses say the name from the side the person is on. Only the phone-side event carries it;
nothing is sent to the server. The Apple-speech fallback plays centred (AVSpeechSynthesizer has no pan).

## Environment (`apps/web/.env`, see `.env.example`)

`DATABASE_URL`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`,
`OPENAI_API_KEY` (ask answers via Realtime, and STT fallback), `BLOB_READ_WRITE_TOKEN` (optional in dev), `RESEND_API_KEY`,
`EMAIL_FROM`, `APP_URL` (defaults to request Host), `PLACE`. Optional overrides:
`APP_TIME_ZONE` (default `America/New_York`), `ELEVENLABS_MODEL_ID`, `ELEVENLABS_STT_MODEL`,
`OPENAI_STT_MODEL`, `OPENAI_REALTIME_MODEL` (default `gpt-realtime-2.1`),
`OPENAI_REALTIME_TRANSCRIBE_MODEL` (default `gpt-4o-mini-transcribe`). Missing keys yield `503 {error}`, never a crash.
