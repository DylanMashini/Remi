# Recall API and module contract

Single source of truth for the web API (`apps/web`), the face sidecar (`apps/face`), and the
Swift module (`apps/mobile/modules/glasses`). Update this file before changing either side.

## Ground rules

- **Bytes go Swift → Next directly.** Every request carrying image or audio bytes (frames,
  enrollment photos, ask audio, ambient audio) and every TTS download is made by Swift with
  `URLSession`. JS never sees pixels or audio. Only small values cross the JS/Swift bridge.
  JSON-only caregiver calls (login, roster, reminders poll) may use JS `fetch`.
- **Auth everywhere.** Every `/api/*` route except `/api/auth/*` calls
  `requireSession(req)` from `@/lib/auth` (already implemented). It accepts
  `Authorization: Bearer <token>` (phone) or the `recall_session` cookie (web) and returns
  `{ user, patientId }`, or throws `AuthError` (use `unauthorized(err)` to turn it into a 401).
  All queries are scoped by `patientId`.
- **Privacy.** Glasses frames are matched in memory and discarded, never written to disk or Blob.
  Enrollment photos go to Vercel Blob and are referenced by `File` rows; the UI only ever loads
  them through `/api/files/[id]` (authed). Deleting a person deletes their blobs.
- Route handlers read raw bodies with `await req.arrayBuffer()`. Do **not** add
  `export const runtime` (Next 16.4 with `cacheComponents` rejects it; Node is the default).
  Catch-all error handlers must call `unstable_rethrow(err)` first (done in `api/_lib/http.ts`).
- Errors: `{ "error": string }` with a sensible status.
- Dev backend: `http://<mac LAN IP>:3000`. Face sidecar: `http://127.0.0.1:8001` (Next only).
- Seeded login: `demo@recall.local` / `recall-demo` (patient "Ruth").

## Auth (`/api/auth/*`, no session required)

| Route | Body | Response |
| --- | --- | --- |
| `POST /api/auth/signup` | `{email, password, name, patientName}` | `201 {user}`; sets cookie; creates User + Patient; sends verify email (Resend) |
| `POST /api/auth/login` | `{email, password}` | `200 {user}` + cookie. With `?client=device`: `200 {user, token}` and no cookie (kind DEVICE) |
| `POST /api/auth/logout` | none | `204`; deletes the session (cookie or bearer) |
| `POST /api/auth/forgot` | `{email}` | `204` always (no account enumeration); emails a reset link if the user exists |
| `POST /api/auth/reset` | `{token, password}` | `204`; one-time token, 30 min expiry; invalidates other sessions |
| `GET /api/auth/verify?token=` | | redirects to `/?verified=1` (or `/?verified=0` if expired/used) |
| `GET /api/auth/me` | | `200 {user, patient: {id, name}}` or `401`; phone uses it to check a saved token |

Passwords: bcryptjs cost 12, min 8 chars. Tokens: `newToken()` / `hashToken()` from `@/lib/auth`.

## Glasses pipeline (called by Swift)

### `POST /api/frames`
Body: raw `image/jpeg` (504x896 typical). Swift sends at most 2 fps and never has more than one
in flight. Response:
```json
{
  "faces": [
    { "box": [x, y, w, h], "personId": "ck..", "name": "Sarah", "relationship": "daughter", "score": 0.71 }
  ],
  "speak": { "speechId": "ab12..", "text": "This is Sarah, your daughter. She visits every Sunday." }
}
```
- `box` is in pixels of the uploaded frame. Unknown faces omit `personId`/`name`.
- Match: cosine similarity of the frame embedding against every `FaceSample`; a person's score
  is their best sample. Known if score ≥ 0.5.
- Debounce (per patient, in memory): announce a person at most once per 5 min; unknown faces at
  most once per 60 s. `speak` is present only when something should be said.
- Known line: `This is {name}, your {relationship}. {notes}` (omit missing parts).
  Unknown line: `Someone new is here.` Never guess a name below threshold.
- Logs `RECOGNITION` / `UNKNOWN` events only when announcing (with `data.score`), plus a
  `SPOKEN` event for every `speak`.

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
`multipart/form-data`: `name` (required), `relationship`, `notes`, `photos` (1–3 JPEG files).
Each photo → face sidecar `/embed` → largest face → `FaceSample`; photo stored in Blob as
`FACE_PHOTO` `File` (dev fallback without `BLOB_READ_WRITE_TOKEN`: local disk under
`apps/web/.cache/blobs`, `File.url = local:<path>`); first photo also cropped/resized to a 160px `AVATAR`. Photos with no face are
rejected with `422 {error, index}` before anything is saved. Response `201 {person, samples}`.

### `GET /api/people` → `{people: [{id, name, relationship, notes, avatarUrl, samples, lastSeenAt}]}`
`avatarUrl` is `/api/files/<avatarFileId>` or null.

### `DELETE /api/people/[id]` → `204` (deletes blobs, files, samples; keeps events with personId nulled)

### `GET /api/files/[id]` → streams the blob (authed, scoped to patient). Never expose raw blob URLs.

## Caregiver

- `GET /api/events?since=<iso>&limit=` → `{events: [{id, type, text, personId, personName, data, createdAt}]}` newest first.
- `DELETE /api/events/[id]` → `204`.
- `POST /api/reminders` `{text, dueAt}` → `201 {reminder}`; `GET /api/reminders` → `{reminders}`; `DELETE /api/reminders/[id]`.
- `GET /api/stream` → SSE (`text/event-stream`), one `event: event` per new Event row
  (`data:` = the event JSON as in `/api/events`), polling the DB every 1 s server-side, heartbeat
  comment every 15 s. Used by `/live` and the dashboard.

## Face sidecar (`apps/face`, localhost only)

- `GET /health` → `{ok: true, model: "buffalo_l"}`
- `POST /embed` body raw `image/jpeg` → `{faces: [{box: [x, y, w, h], det_score, embedding: number[512]}]}`
  sorted by box area, largest first. Embeddings are L2-normalized (`normed_embedding`).

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
  // camera 504x896 @ 7 fps, frames → /api/frames. mock=true runs the same pipeline on
  // MockDeviceKit with the phone's back camera (fallback demo path); status.mock becomes true.
stopStream(): Promise<void>
getStatus(): Promise<GlassesStatus>
enrollPerson(p: { name: string; relationship?: string; notes?: string; photoUris: string[] }):
  Promise<{ personId: string; samples: number }>   // Swift reads file URIs, multipart upload
captureGlassesPhoto(): Promise<string>       // file:// URI of a glasses photo
startAsk(): Promise<void>                    // begins mic capture
stopAsk(): Promise<{ question: string; answer: string }>  // uploads to /api/ask, speaks answer
speak(speechId: string, text: string): Promise<void>      // downloads /api/speech/id, plays over A2DP

type GlassesStatus = {
  registration: "unregistered" | "registering" | "registered";
  connection: "disconnected" | "connecting" | "connected";
  streaming: boolean;
  audioRoute: "a2dp" | "hfp" | "speaker" | "other";
  mock: boolean;
};

Events:
onStatus(status: GlassesStatus)
onFrameResult({ faces: Face[]; speak?: { speechId: string; text: string }; frameWidth: number; frameHeight: number })
onAudioRoute({ route: GlassesStatus["audioRoute"]; portName: string })
onSpoken({ text: string; route: string })      // after each line plays
onError({ message: string })

View: <GlassesPreview style={...} />           // renders latest frame natively
```
Swift speaks `speak` from frame results itself (no JS round trip) and still emits
`onFrameResult` so the UI can draw boxes and show the line.

## Environment (`apps/web/.env`, see `.env.example`)

`DATABASE_URL`, `FACE_URL`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`,
`OPENAI_API_KEY` (STT fallback), `BLOB_READ_WRITE_TOKEN` (optional in dev), `RESEND_API_KEY`,
`EMAIL_FROM`, `APP_URL` (defaults to request Host), `PLACE`. Optional overrides:
`APP_TIME_ZONE` (default `America/New_York`), `ELEVENLABS_MODEL_ID`, `ELEVENLABS_STT_MODEL`,
`OPENAI_STT_MODEL`. Missing keys yield `503 {error}`, never a crash.
