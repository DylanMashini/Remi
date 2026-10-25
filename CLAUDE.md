# Remi (HackPSU Fall 2026)

Remi: Ray-Ban Meta glasses as a memory prosthetic for people with dementia. The glasses see and
hear; the phone relays; the API recognizes faces, remembers, and answers; Remi whispers back.
Setup and commands are in `README.md`. Full plan, demo script, and feature tiers:
https://claude.ai/artifact/3fJURHWSzEBituLYhUowPk

## The end goal, in one line

At 2 PM Sunday a judge walks up to someone wearing the glasses and hears their own name.
Every task you take should move that moment closer or make it more reliable. If it does neither,
say so and ask before doing it.

## Hard deadlines (Eastern)

- Hacking window: 2:00 PM Sat Oct 24 to 1:45 PM Sun Oct 25.
- Devpost draft must exist by 12:00 AM Sunday (existence, not quality).
- Devpost locks at 12:00 PM Sunday. Edits allowed until 1:45 PM.
- At least one teammate presents at the expo. Devpost page quality is weighed by judges.

## How we are judged (five equal criteria, from the HackPSU Devpost)

Keep these in mind when choosing what to build and how to build it:

| Criterion | What judges ask | What that means for your work |
| --- | --- | --- |
| Implementation | Functional? Easy for the target demographic? Viable? | The wearer never touches a screen. Zero-config on the glasses side. Prefer boring, reliable code over clever code. Nothing ships that has not run end to end on the real phone. |
| Clarity | Problem and solution well-stated? Capabilities demonstrated effectively? | Everything the glasses do must be visible on the phone screen (mirrored to a laptop at the expo): the frame, the face box, the match, the spoken text. Log what you speak. |
| Creativity | New ideas? More than an API wrapper? | The product is the fusion: face memory + conversation memory + proactive reminders in one calm voice. Do not reduce it to "chatbot with a camera". |
| Growth | Learned something new? Unfamiliar tech? | The Meta Device Access Toolkit 1.0 is weeks old. Record every gotcha you hit in `NOTES.md` at the repo root; it goes in the Devpost write-up. |
| Impact | Evidence the problem exists? Viable, ambitious answer? | Caregiver side is a real second user, not an admin panel. Privacy decisions (local roster, no stranger search, frames discarded) are features; implement and name them. |

Prize targets in priority order: Grand Prize, Nittany AI Challenge (accessibility), MLH Best Use of
ElevenLabs (TTS), MLH Best Use of Gemini API (scene captions). Sponsor prizes (Auth0, Tiger Data,
Vultr, GoDaddy) only after P0 is done.

## The demo, which defines priority

Three live beats on real glasses, each one question a person with dementia asks:

1. **Who is this?** Enrolled person walks up; within 2 s the glasses say name, relationship, and a
   caregiver note. Then a judge is enrolled live in 10 s and recognized on return.
2. **What were we talking about?** After a 20 s chat, the wearer asks and gets an answer from the
   transcript.
3. **Where am I, what's next?** Orientation on demand, then a reminder fires on its own.

Then the caregiver dashboard: today's timeline, roster, reminders.

### P0, in build order (nothing else until these run on the real phone)

1. Glasses camera stream into the Expo app via the Swift module (medium preset 504x896, 7 to 15 fps).
2. Face enrollment (3 photos + name, relationship, note) and recognition with per-person debounce
   (announce once per person per 5 min).
3. Spoken output through the glasses over A2DP (ElevenLabs, Apple speech as fallback).
4. Tap-to-ask: mic capture, transcription, Claude answer from a context packet.
5. Memory log: every recognition, utterance, answer, and reminder in Postgres with timestamps.
6. Caregiver dashboard: roster, today's timeline, add reminder.

Cut lines already decided: no real stream on screen by 4:30 PM Sat means switch to Mock Device
Kit phone-camera simulation and keep building; retry real glasses at 8 PM. No ask flow by 11 PM
means beat 2 becomes a scripted question over the recognition log. Sunday 10:30 AM, feature freeze.

## Platform facts (Device Access Toolkit 1.0.1, 2026-10-09)

- Ray-Ban Meta Gen 1/2 have no display. All output is audio. The phone screen is the judges' display.
- Camera presets 720x1280 / 504x896 / 360x640 at 2, 7, 15, 24, 30 fps, HEVC, auto-downgrades over
  Bluetooth. Use medium at 7 to 15 fps. Faces do not need 30 fps.
- Mic audio: in-band with the camera stream (16 kHz PCM, not beamformed, dev/beta channels only)
  keeps output on hi-fi A2DP. Bluetooth HFP is beamformed to the wearer but drops output to voice
  quality. Start with in-band; switch to HFP if expo noise defeats transcription.
- iOS gotcha from Meta's docs: with HFP, start the mic and wait ~2 s for the route to settle before
  starting the camera stream, or the audio route fails silently.
- Verify the audio route is Bluetooth A2DP before speaking, and log it. TTS playing out of the
  phone speaker is a silent demo failure.
- "Hey Meta" launching our app is experimental and Meta's FAQ says it is out of scope this year.
  Never depend on it. Ask-mode is triggered by a phone tap.
- Developer Mode: Meta AI app > Settings > App Info > tap version 5 times. No publishing needed.
- Mock Device Kit can use the phone camera as the video source. It is the fallback demo path and
  the way to develop without the glasses in hand.
- The DAT SDK needs Xcode 26.4+. Meta ships a Claude Code plugin with an MCP server that searches
  the current DAT docs. Use it instead of memory for any SDK call; the API changed at 1.0.

## Repo conventions

- pnpm monorepo. `apps/web` is Next.js 16 (App Router) + Prisma 7 + Postgres 18: it is both the
  caregiver portal and the backend for the mobile app (route handlers). Follow `apps/web/AGENTS.md`;
  this Next version differs from training data, so read `node_modules/next/dist/docs/` first.
  Import the DB client only from `@/lib/prisma` (singleton). `apps/mobile` is Expo SDK 58
  with Expo Router; `apps/mobile/modules/glasses` is the local Swift module that owns everything
  DAT-related. Follow `apps/mobile/AGENTS.md` for Expo rules (versioned docs, `expo install`).
- Route handlers read raw `image/jpeg` bodies (`await req.arrayBuffer()`, `runtime = "nodejs"`), so
  Swift uploads frames with `URLSession` directly.
  Do not route frames through JS; keep the Swift module as the glasses-to-API path.
- Never edit `apps/mobile/ios/` by hand. Native config goes through `app.json` and
  `plugins/withMetaWearables.js`. Run `pnpm prebuild` after podspec or plugin changes.
- The phone cannot reach `localhost`. The web app listens on 0.0.0.0; use the Mac's LAN IP on the
  phone hotspot. Never depend on venue Wi-Fi.
- Schema changes go through `prisma migrate dev` with a named migration. Do not edit generated code
  under `apps/web/src/generated`.
- No WebSockets (Next route handlers cannot upgrade). Server-to-phone pushes use SSE or polling.
- Demo and rehearse on `next build && next start`, never `next dev` (first-hit compile is slow).
- Run `pnpm typecheck` before declaring a task done. Lint the mobile app with `npx expo lint`.
- Keep the API and mobile contract in `CONTRACT.md` (routes, WebSocket messages, JSON shapes).
  Update it before changing either side so parallel sessions stay in sync.
- Secrets live in `apps/web/.env` (gitignored). Never commit API keys; put placeholders in
  `.env.example`.

## Brand rules (Remi)

- The product and the voice are both "Remi". Copy says "Remi says", "Remi recognizes", "Remi
  reminded". "The glasses" is reserved for hardware: connecting, streaming, audio route, the button.
  Remi takes no gendered pronoun; use "it" or repeat the name.
- The chat feature is "Ask Remi" everywhere: the button, the event labels, the Devpost.
- Wordmark: lowercase "remi" in Nunito 800, dusk plum, with the sun as the dot of the i. It is
  drawn in code (`apps/mobile/src/components/brand.tsx`, `apps/web/src/components/Logo.tsx`),
  never as an image. The standalone mark is the same sun half-risen over a horizon line.
- Motif is sunrise, not sunset: caregivers know the word "sundowning". The sky gradient shifts
  with the hour (dawn, day, evening, night) but evenings stay warm amber and nothing goes dark.
- The gradient appears in exactly three places: the Today header, the surface where Remi speaks or
  listens, and nowhere else. Everything else is flat linen and white. Scarcity is the brand.
- Color meanings: apricot = a person, dusk = Remi acting, sun = the mark only, attention =
  caregiver should fix something. Red never appears in the wearer's path.
- Tokens live in `apps/mobile/src/constants/theme.ts` and are mirrored in `apps/web/src/app/globals.css`.

## Voice and tone rules for anything Remi says

- Short, warm, declarative. One fact per sentence. Name, relationship, then one note.
- Never correct, quiz, or say "you already asked that". Repeated questions get the same answer in
  the same words; consistency is comfort. Log the repetition for the caregiver instead.
- Say "someone new is here" for unknown faces. Never guess a name below the match threshold.
- Everything spoken is also written to the memory log and shown on the phone screen.

## Privacy decisions (implement, do not just promise)

- Faces are matched only against the roster the family enrolls. No search of strangers.
- Frames are discarded after matching; only events (who, when, summary) persist, and the caregiver
  can delete any event.
- The caregiver sees patterns and a timeline, not a live camera feed.

## Working style

- Ship vertical slices that run on the real phone, then widen. A feature that works in the
  simulator only is not done.
- When the glasses, the SDK, or the Bluetooth route misbehave, time-box to 30 minutes, write it in
  `NOTES.md`, and fall back to Mock Device Kit so the rest of the pipeline keeps moving.
- Before any demo-facing change on Sunday morning, ask whether it could break a rehearsal.
  After 10:30 AM Sunday the answer is no; polish the Devpost page instead.
