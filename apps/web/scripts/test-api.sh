#!/usr/bin/env bash
# End-to-end smoke test for the glasses/caregiver API.
# Usage: BASE=http://127.0.0.1:3102 apps/web/scripts/test-api.sh
# Needs: running Next server, face sidecar on :8001, seeded user, jq.
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:3102}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TESTDATA="${TESTDATA:-$HERE/../../face/testdata}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0; SKIP=0
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
skip() { echo "  SKIP  $1"; SKIP=$((SKIP+1)); }

# Reads apps/web/.env to decide which key-dependent steps to run (values are never printed).
has_key() { grep -Eq "^$1=\"?[^\"]+\"?\s*$" "$HERE/../.env" 2>/dev/null; }

echo "== Recall API smoke test against $BASE"

# Photos: enroll with obama_a + a mirrored copy, recognize from obama_b (a different photo).
cp "$TESTDATA/obama_a.jpg" "$TMP/enroll1.jpg"
sips -f horizontal "$TESTDATA/obama_a.jpg" --out "$TMP/enroll2.jpg" >/dev/null 2>&1 || cp "$TESTDATA/obama_a.jpg" "$TMP/enroll2.jpg"
cp "$TESTDATA/obama_b.jpg" "$TMP/frame.jpg"
# A face-free JPEG for the 422 check.
node -e 'require("sharp")({create:{width:200,height:200,channels:3,background:"#88aacc"}}).jpeg().toFile(process.argv[1])' "$TMP/noface.jpg" 2>/dev/null \
  || (cd "$HERE/.." && node -e 'require("sharp")({create:{width:200,height:200,channels:3,background:"#88aacc"}}).jpeg().toFile(process.argv[1])' "$TMP/noface.jpg")

# 1. Device login
TOKEN=$(curl -s -X POST "$BASE/api/auth/login?client=device" -H 'content-type: application/json' \
  -d '{"email":"demo@recall.local","password":"recall-demo"}' | jq -r '.token // empty')
[ -n "$TOKEN" ] && ok "device login returned token" || { bad "device login"; exit 1; }
AUTH=(-H "authorization: Bearer $TOKEN")

# 1b. Unauthed request is 401
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/people")
[ "$code" = 401 ] && ok "unauthenticated GET /api/people -> 401" || bad "unauthenticated GET /api/people -> $code"

# 2. Enrollment rejects a face-free photo with 422 + index, saving nothing
before=$(curl -s "${AUTH[@]}" "$BASE/api/people" | jq '.people | length')
resp=$(curl -s -w '\n%{http_code}' "${AUTH[@]}" -F name="Nobody" -F photos=@"$TMP/enroll1.jpg;type=image/jpeg" -F photos=@"$TMP/noface.jpg;type=image/jpeg" "$BASE/api/people")
code=$(echo "$resp" | tail -1); body=$(echo "$resp" | sed '$d')
after=$(curl -s "${AUTH[@]}" "$BASE/api/people" | jq '.people | length')
[ "$code" = 422 ] && [ "$(echo "$body" | jq -r .index)" = 1 ] && [ "$before" = "$after" ] \
  && ok "no-face photo -> 422 index=1, nothing saved" || bad "no-face photo -> $code $body (people $before -> $after)"

# 3. Enroll a person with 2 photos
resp=$(curl -s -w '\n%{http_code}' "${AUTH[@]}" -F name="Barack" -F relationship="old friend" \
  -F notes="You met him in Chicago." -F photos=@"$TMP/enroll1.jpg;type=image/jpeg" -F photos=@"$TMP/enroll2.jpg;type=image/jpeg" "$BASE/api/people")
code=$(echo "$resp" | tail -1); body=$(echo "$resp" | sed '$d')
PID=$(echo "$body" | jq -r '.person.id // empty')
[ "$code" = 201 ] && [ -n "$PID" ] && [ "$(echo "$body" | jq .samples)" = 2 ] && ok "POST /api/people -> 201, 2 samples ($PID)" || bad "POST /api/people -> $code $body"

# 4. Roster lists them with an avatar that loads through the authed proxy
AVATAR=$(curl -s "${AUTH[@]}" "$BASE/api/people" | jq -r --arg id "$PID" '.people[] | select(.id==$id) | .avatarUrl')
ctype=$(curl -s -o "$TMP/avatar.jpg" -w '%{content_type} %{http_code}' "${AUTH[@]}" "$BASE$AVATAR")
[[ "$ctype" == "image/jpeg 200" ]] && ok "avatar via $AVATAR ($(sips -g pixelWidth -g pixelHeight "$TMP/avatar.jpg" 2>/dev/null | awk '/pixel/{printf $2" "}'))" || bad "avatar fetch -> $ctype"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$AVATAR")
[ "$code" = 401 ] && ok "avatar without auth -> 401" || bad "avatar without auth -> $code"

# 5. Frame of the same person (different photo) -> personId + speak
resp=$(curl -s "${AUTH[@]}" -H 'content-type: image/jpeg' --data-binary @"$TMP/frame.jpg" "$BASE/api/frames")
echo "        frame: $(echo "$resp" | jq -c .)"
[ "$(echo "$resp" | jq -r '.faces[0].personId')" = "$PID" ] && ok "frame recognized person (score $(echo "$resp" | jq '.faces[0].score'))" || bad "frame recognition"
SPEECH=$(echo "$resp" | jq -r '.speak.speechId // empty')
[ -n "$SPEECH" ] && ok "frame returned speak: $(echo "$resp" | jq -r .speak.text)" || bad "no speak on first sighting"

# 6. Debounce: same frame again -> no speak
resp=$(curl -s "${AUTH[@]}" -H 'content-type: image/jpeg' --data-binary @"$TMP/frame.jpg" "$BASE/api/frames")
[ "$(echo "$resp" | jq 'has("speak")')" = false ] && [ "$(echo "$resp" | jq -r '.faces[0].personId')" = "$PID" ] \
  && ok "second frame debounced (no speak, still boxed)" || bad "debounce: $resp"

# 7. Unknown face -> "Someone new is here." (may be debounced if run twice within 60 s)
resp=$(curl -s "${AUTH[@]}" -H 'content-type: image/jpeg' --data-binary @"$TESTDATA/biden.jpg" "$BASE/api/frames")
echo "        unknown: $(echo "$resp" | jq -c .)"
[ "$(echo "$resp" | jq -r '.faces[0] | has("personId")')" = false ] && ok "unknown face has no personId ($(echo "$resp" | jq -r '.speak.text // "debounced"'))" || bad "unknown face matched someone"

# 8. Speech audio
if has_key ELEVENLABS_API_KEY && has_key ELEVENLABS_VOICE_ID; then
  ctype=$(curl -s -o "$TMP/speech.mp3" -w '%{content_type} %{http_code}' "${AUTH[@]}" "$BASE/api/speech/$SPEECH")
  [[ "$ctype" == "audio/mpeg 200" ]] && ok "GET /api/speech/$SPEECH -> mp3 $(wc -c <"$TMP/speech.mp3") bytes" || bad "speech -> $ctype"
else
  resp=$(curl -s -w ' %{http_code}' "${AUTH[@]}" "$BASE/api/speech/$SPEECH")
  skip "GET /api/speech (no ElevenLabs key): $resp"
fi

# 9. Ask
if has_key ANTHROPIC_API_KEY; then
  resp=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -d '{"text":"Who did I see today?"}' "$BASE/api/ask")
  echo "        ask: $(echo "$resp" | jq -c .)"
  A1=$(echo "$resp" | jq -r '.answer // empty')
  [ -n "$A1" ] && ok "POST /api/ask answered" || bad "ask: $resp"
  A2=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -d '{"text":"who did i see today"}' "$BASE/api/ask" | jq -r '.answer // empty')
  [ "$A1" = "$A2" ] && ok "repeat question got identical words" || bad "repeat answer differed"
else
  resp=$(curl -s -w ' %{http_code}' "${AUTH[@]}" -H 'content-type: application/json' -d '{"text":"Who did I see today?"}' "$BASE/api/ask")
  skip "POST /api/ask (no Anthropic key): $resp"
fi

# 10. Reminders: create one due now, poll due, it fires once
RID=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -d "{\"text\":\"Time for your afternoon tea.\",\"dueAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" "$BASE/api/reminders" | jq -r '.reminder.id // empty')
[ -n "$RID" ] && ok "POST /api/reminders" || bad "create reminder"
n1=$(curl -s "${AUTH[@]}" "$BASE/api/reminders/due" | jq --arg id "$RID" '[.reminders[] | select(.id==$id)] | length')
n2=$(curl -s "${AUTH[@]}" "$BASE/api/reminders/due" | jq --arg id "$RID" '[.reminders[] | select(.id==$id)] | length')
[ "$n1" = 1 ] && [ "$n2" = 0 ] && ok "reminder fired exactly once" || bad "reminders/due fired $n1 then $n2"
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${AUTH[@]}" "$BASE/api/reminders/$RID")
[ "$code" = 204 ] && ok "DELETE reminder" || bad "DELETE reminder -> $code"

# 11. SSE stream delivers a new event
curl -s -N --max-time 4 "${AUTH[@]}" "$BASE/api/stream" > "$TMP/sse.txt" &
SSE_PID=$!
sleep 1.5
curl -s "${AUTH[@]}" -H 'content-type: application/json' -d "{\"text\":\"SSE check\",\"dueAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" "$BASE/api/reminders" >/dev/null
curl -s "${AUTH[@]}" "$BASE/api/reminders/due" >/dev/null
wait $SSE_PID 2>/dev/null
grep -q '"text":"SSE check"' "$TMP/sse.txt" && ok "SSE /api/stream delivered REMINDER event" || bad "SSE: $(head -c 300 "$TMP/sse.txt")"

# 12. Events log
resp=$(curl -s "${AUTH[@]}" "$BASE/api/events?limit=20")
types=$(echo "$resp" | jq -r '[.events[].type] | unique | join(",")')
echo "$types" | grep -q RECOGNITION && echo "$types" | grep -q SPOKEN && ok "GET /api/events types: $types" || bad "events: $types"
EID=$(echo "$resp" | jq -r '.events[0].id')
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${AUTH[@]}" "$BASE/api/events/$EID")
[ "$code" = 204 ] && ok "DELETE event" || bad "DELETE event -> $code"

# 13. Delete person; events keep with personId nulled
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${AUTH[@]}" "$BASE/api/people/$PID")
[ "$code" = 204 ] && ok "DELETE person" || bad "DELETE person -> $code"
code=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$BASE$AVATAR")
[ "$code" = 404 ] && ok "avatar gone after delete" || bad "avatar after delete -> $code"
resp=$(curl -s "${AUTH[@]}" -H 'content-type: image/jpeg' --data-binary @"$TMP/frame.jpg" "$BASE/api/frames")
[ "$(echo "$resp" | jq -r '.faces[0] | has("personId")')" = false ] && ok "deleted person no longer recognized" || bad "still recognized after delete: $resp"

echo "== $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" = 0 ]
