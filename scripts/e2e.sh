#!/usr/bin/env bash
# Recall end-to-end test: fresh caregiver signup through recognition, memory log, SSE, files, and
# password reset. Runs against a live server (ideally `next start`) plus the face sidecar.
#
# Usage: BASE=http://127.0.0.1:3000 SERVER_LOG=/path/to/next-start.log scripts/e2e.sh
#   SERVER_LOG: the server's stdout. Without RESEND_API_KEY the reset link is printed there.
# Needs: jq, curl, docker (memory-aid-db-1, for File-row checks), apps/face/testdata photos.
# Key-dependent steps (ElevenLabs, Anthropic, Blob) run only when the key is set in apps/web/.env.
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:3000}"
SERVER_LOG="${SERVER_LOG:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENVF="$ROOT/apps/web/.env"
TESTDATA="$ROOT/apps/face/testdata"
DB_CONTAINER="${DB_CONTAINER:-memory-aid-db-1}"
TMP="$(mktemp -d)"
STREAM_PID=""
trap 'rm -rf "$TMP"; [ -n "$STREAM_PID" ] && kill "$STREAM_PID" 2>/dev/null' EXIT

PASS=0; FAIL=0; SKIP=0
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
skip() { echo "  SKIP  $1"; SKIP=$((SKIP+1)); }
# True when the key has a non-empty value in apps/web/.env (values are never printed).
has_key() { grep -Eq "^$1=\"?[^\"]+\"?[[:space:]]*$" "$ENVF" 2>/dev/null; }
# Read-only SQL against the dev DB; prints nothing if docker is unavailable.
sql() { docker exec "$DB_CONTAINER" psql -U memoryaid -d memoryaid -tAc "$1" 2>/dev/null; }
# JSON bodies via jq (macOS bash 3.2 mangles \" inside $(...)).
json() { jq -nc "$@"; }

echo "== Recall e2e against $BASE"
code=$(curl -s -o /dev/null -w '%{http_code}' "${FACE_URL:-http://127.0.0.1:8001}/health")
[ "$code" = 200 ] && ok "face sidecar /health" || { bad "face sidecar not reachable ($code); run pnpm dev:face"; exit 1; }

# 1. Signup a fresh caregiver (gets its own empty patient, so the roster is isolated)
EMAIL="e2e-$(date +%s)-$RANDOM@recall.local"
PASSWORD="e2e-pass-123"
resp=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/auth/signup" -H 'content-type: application/json' \
  -d "$(json --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e,password:$p,name:"E2E Caregiver",patientName:"Ruth"}')")
code=$(echo "$resp" | tail -1)
[ "$code" = 201 ] && ok "signup $EMAIL -> 201" || { bad "signup -> $code $(echo "$resp" | sed '$d')"; exit 1; }

# 2. Device login -> bearer token
TOKEN=$(curl -s -X POST "$BASE/api/auth/login?client=device" -H 'content-type: application/json' \
  -d "$(json --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e,password:$p}')" | jq -r '.token // empty')
[ -n "$TOKEN" ] && ok "device login returned token" || { bad "device login"; exit 1; }
AUTH=(-H "authorization: Bearer $TOKEN")
PATIENT=$(curl -s "${AUTH[@]}" "$BASE/api/auth/me" | jq -r '.patient.id // empty')
[ -n "$PATIENT" ] && ok "GET /api/auth/me -> patient $PATIENT" || bad "GET /api/auth/me"

# 3. Enroll a person with 2 test photos
cp "$TESTDATA/obama_a.jpg" "$TMP/enroll1.jpg"
sips -f horizontal "$TESTDATA/obama_a.jpg" --out "$TMP/enroll2.jpg" >/dev/null 2>&1 || cp "$TESTDATA/obama_a.jpg" "$TMP/enroll2.jpg"
resp=$(curl -s -w '\n%{http_code}' "${AUTH[@]}" -F name="Barack" -F relationship="old friend" \
  -F notes="You met him in Chicago." -F photos=@"$TMP/enroll1.jpg;type=image/jpeg" -F photos=@"$TMP/enroll2.jpg;type=image/jpeg" "$BASE/api/people")
code=$(echo "$resp" | tail -1); body=$(echo "$resp" | sed '$d')
PID=$(echo "$body" | jq -r '.person.id // empty')
[ "$code" = 201 ] && [ -n "$PID" ] && [ "$(echo "$body" | jq .samples)" = 2 ] \
  && ok "POST /api/people -> 201, 2 samples" || { bad "POST /api/people -> $code $body"; exit 1; }

# 3b. File rows + blobs exist
FILES=$(sql "select count(*) from \"File\" where \"personId\"='$PID'")
if [ -z "$FILES" ]; then skip "File-row check (docker/psql unavailable)"
else
  [ "$FILES" = 3 ] && ok "3 File rows (2 FACE_PHOTO + 1 AVATAR)" || bad "File rows for person: $FILES (expected 3)"
  URLS=$(sql "select url from \"File\" where \"personId\"='$PID'")
  if has_key BLOB_READ_WRITE_TOKEN; then
    echo "$URLS" | grep -q '^https://' && ok "File urls are Vercel Blob URLs" || bad "BLOB token set but urls are: $URLS"
  else
    missing=0
    for u in $URLS; do [ -f "$ROOT/apps/web/.cache/blobs/${u#local:}" ] || missing=$((missing+1)); done
    [ "$missing" = 0 ] && ok "local blob fallback: all files on disk (no BLOB_READ_WRITE_TOKEN)" || bad "$missing local blob files missing"
  fi
fi
AVATAR=$(curl -s "${AUTH[@]}" "$BASE/api/people" | jq -r --arg id "$PID" '.people[] | select(.id==$id) | .avatarUrl // empty')
[ -n "$AVATAR" ] && ok "roster lists person with avatarUrl $AVATAR" || bad "no avatarUrl in roster"
ctype=$(curl -s -o /dev/null -w '%{content_type} %{http_code}' "${AUTH[@]}" "$BASE$AVATAR")
[ "$ctype" = "image/jpeg 200" ] && ok "authed avatar fetch -> image/jpeg 200" || bad "authed avatar fetch -> $ctype"

# 4. Frame with a third (different) photo -> match + speechId
resp=$(curl -s "${AUTH[@]}" -H 'content-type: image/jpeg' --data-binary @"$TESTDATA/obama_b.jpg" "$BASE/api/frames")
echo "        frame: $(echo "$resp" | jq -c '{faces: [.faces[] | {personId, name, score}], speak}')"
[ "$(echo "$resp" | jq -r '.faces[0].personId')" = "$PID" ] && ok "frame matched person (score $(echo "$resp" | jq '.faces[0].score'))" || bad "frame did not match: $resp"
SPEECH=$(echo "$resp" | jq -r '.speak.speechId // empty')
[ -n "$SPEECH" ] && ok "speak: \"$(echo "$resp" | jq -r .speak.text)\"" || bad "no speechId on first sighting"

# 5. Speech audio
if has_key ELEVENLABS_API_KEY && has_key ELEVENLABS_VOICE_ID; then
  ctype=$(curl -s -o "$TMP/speech.mp3" -w '%{content_type} %{http_code}' "${AUTH[@]}" "$BASE/api/speech/$SPEECH")
  [ "$ctype" = "audio/mpeg 200" ] && [ "$(wc -c < "$TMP/speech.mp3")" -gt 1000 ] && ok "GET /api/speech -> audio/mpeg" || bad "GET /api/speech -> $ctype"
else
  code=$(curl -s -o "$TMP/sp.json" -w '%{http_code}' "${AUTH[@]}" "$BASE/api/speech/$SPEECH")
  [ "$code" = 503 ] && ok "no ElevenLabs key: /api/speech -> 503 \"$(jq -r .error "$TMP/sp.json")\"" || bad "no-key /api/speech -> $code"
  skip "ElevenLabs TTS audio (ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID empty)"
fi

# 6. Ask with text
resp=$(curl -s -w '\n%{http_code}' "${AUTH[@]}" -H 'content-type: application/json' -d '{"text":"Who did I just see?"}' "$BASE/api/ask")
code=$(echo "$resp" | tail -1); body=$(echo "$resp" | sed '$d')
if has_key ANTHROPIC_API_KEY; then
  [ "$code" = 200 ] && [ -n "$(echo "$body" | jq -r '.speechId // empty')" ] && ok "ask -> \"$(echo "$body" | jq -r .answer)\"" || bad "ask -> $code $body"
  ASKED=1
else
  [ "$code" = 503 ] && ok "no Anthropic key: /api/ask -> 503 \"$(echo "$body" | jq -r .error)\"" || bad "no-key ask -> $code $body"
  skip "Claude answer (ANTHROPIC_API_KEY empty)"
  ASKED=0
fi

# 7. Memory log
TYPES=$(curl -s "${AUTH[@]}" "$BASE/api/events" | jq -r '[.events[].type] | unique | join(",")')
WANT="RECOGNITION SPOKEN"; [ "$ASKED" = 1 ] && WANT="$WANT QUESTION ANSWER"
miss=""; for t in $WANT; do echo ",$TYPES," | grep -q ",$t," || miss="$miss $t"; done
[ -z "$miss" ] && ok "GET /api/events has $WANT ($TYPES)" || bad "events missing:$miss (have $TYPES)"
PN=$(curl -s "${AUTH[@]}" "$BASE/api/events" | jq -r '[.events[] | select(.type=="RECOGNITION")][0].personName')
[ "$PN" = "Barack" ] && ok "RECOGNITION event carries personName" || bad "RECOGNITION personName = $PN"

# 8. SSE stream delivers a new event within 5 s (trigger: unknown face -> UNKNOWN + SPOKEN)
curl -s -N --max-time 6 "${AUTH[@]}" "$BASE/api/stream" > "$TMP/sse.txt" &
STREAM_PID=$!; disown "$STREAM_PID" 2>/dev/null
sleep 1.5
curl -s -o /dev/null "${AUTH[@]}" -H 'content-type: image/jpeg' --data-binary @"$TESTDATA/biden.jpg" "$BASE/api/frames"
for _ in 1 2 3 4 5 6 7 8 9 10; do grep -q '^event: event' "$TMP/sse.txt" && break; sleep 0.5; done
if grep -q '^event: event' "$TMP/sse.txt"; then
  ok "SSE delivered: $(grep -m1 '^data:' "$TMP/sse.txt" | sed 's/^data: //' | jq -r '.type + " " + .text')"
else bad "SSE got no event within 5 s"; fi
kill "$STREAM_PID" 2>/dev/null; STREAM_PID=""

# 9. Logged-out file fetch is 401
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$AVATAR")
[ "$code" = 401 ] && ok "logged-out GET $AVATAR -> 401" || bad "logged-out file fetch -> $code"

# 10. DELETE person removes files, blobs, samples; keeps events with personId nulled
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${AUTH[@]}" "$BASE/api/people/$PID")
[ "$code" = 204 ] && ok "DELETE /api/people -> 204" || bad "DELETE /api/people -> $code"
code=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$BASE$AVATAR")
[ "$code" = 404 ] && ok "avatar gone after delete (404)" || bad "avatar after delete -> $code"
if [ -n "$FILES" ]; then
  left=$(sql "select count(*) from \"File\" where \"personId\"='$PID'")
  [ "$left" = 0 ] && ok "File rows deleted" || bad "$left File rows remain"
  if ! has_key BLOB_READ_WRITE_TOKEN; then
    remain=0; for u in $URLS; do [ -f "$ROOT/apps/web/.cache/blobs/${u#local:}" ] && remain=$((remain+1)); done
    [ "$remain" = 0 ] && ok "local blob files deleted" || bad "$remain local blob files remain"
  fi
fi
resp=$(curl -s "${AUTH[@]}" -H 'content-type: image/jpeg' --data-binary @"$TESTDATA/obama_b.jpg" "$BASE/api/frames")
[ "$(echo "$resp" | jq -r '.faces[0] | has("personId")')" = false ] && ok "deleted person no longer recognized" || bad "deleted person still matched: $resp"

# 11. Forgot / reset
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/forgot" -H 'content-type: application/json' -d "$(json --arg e "$EMAIL" '{email:$e}')")
[ "$code" = 204 ] && ok "forgot -> 204" || bad "forgot -> $code"
RESET=""
if [ -n "$SERVER_LOG" ]; then
  sleep 1
  RESET=$(grep "reset link for $EMAIL" "$SERVER_LOG" | tail -n1 | sed -n 's/.*reset?token=\([A-Za-z0-9_-]*\).*/\1/p')
fi
if [ -z "$RESET" ]; then
  skip "reset (no SERVER_LOG link; with RESEND_API_KEY set, check the inbox)"
else
  NEWPW="e2e-new-pass-456"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/reset" -H 'content-type: application/json' -d "$(json --arg t "$RESET" --arg p "$NEWPW" '{token:$t,password:$p}')")
  [ "$code" = 204 ] && ok "reset -> 204" || bad "reset -> $code"
  code=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$BASE/api/auth/me")
  [ "$code" = 401 ] && ok "old device token revoked after reset" || bad "old token after reset -> $code"
  T2=$(curl -s -X POST "$BASE/api/auth/login?client=device" -H 'content-type: application/json' \
    -d "$(json --arg e "$EMAIL" --arg p "$NEWPW" '{email:$e,password:$p}')" | jq -r '.token // empty')
  [ -n "$T2" ] && ok "login with new password" || bad "login with new password failed"
fi

echo "== $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" = 0 ]
