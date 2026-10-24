#!/usr/bin/env bash
# Smoke test for the Remember feature (memories, callouts, visits, web pages). Needs a running server.
# Usage: BASE=http://127.0.0.1:3000 scripts/remember-smoke.sh
set -uo pipefail
BASE="${BASE:-http://127.0.0.1:3000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TESTDATA="$ROOT/scripts/testdata"
PASS=0; FAIL=0
ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
json() { jq -nc "$@"; }

EMAIL="smoke-$(date +%s)-$RANDOM@recall.local"; PASSWORD="smoke-pass-123"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/signup" -H 'content-type: application/json' \
  -d "$(json --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e,password:$p,name:"Smoke",patientName:"Ruth"}')")
[ "$code" = 201 ] && ok "signup" || { bad "signup $code"; exit 1; }
TOKEN=$(curl -s -X POST "$BASE/api/auth/login?client=device" -H 'content-type: application/json' \
  -d "$(json --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e,password:$p}')" | jq -r '.token // empty')
[ -n "$TOKEN" ] && ok "device login" || { bad "login"; exit 1; }
AUTH=(-H "authorization: Bearer $TOKEN")

# Enroll
resp=$(curl -s -w '\n%{http_code}' "${AUTH[@]}" -F name="Barack" -F relationship="old friend" -F notes="You met him in Chicago." \
  -F photos=@"$TESTDATA/obama_a.jpg;type=image/jpeg" "$BASE/api/people")
code=$(echo "$resp" | tail -1); body=$(echo "$resp" | sed '$d'); PID=$(echo "$body" | jq -r '.person.id // empty')
[ "$code" = 201 ] && [ -n "$PID" ] && ok "enroll -> 201" || { bad "enroll $code $body"; exit 1; }
[ "$(echo "$body" | jq -r .person.line)" = "This is Barack, your old friend. You met him in Chicago." ] && ok "201 body has line" || bad "201 line: $(echo "$body" | jq -r .person.line)"
[ -n "$(echo "$body" | jq -r '.person.photoUrl // empty')" ] && ok "201 body has photoUrl" || bad "no photoUrl"

# List
list=$(curl -s "${AUTH[@]}" "$BASE/api/people")
P=$(echo "$list" | jq -c --arg id "$PID" '.people[] | select(.id==$id)')
[ "$(echo "$P" | jq -r .memoryCount)" = 0 ] && ok "GET /api/people memoryCount 0" || bad "memoryCount: $P"
[ "$(echo "$P" | jq -r .lastRememberedAt)" = null ] && ok "lastRememberedAt null" || bad "lastRememberedAt"
PHOTO=$(echo "$P" | jq -r .photoUrl)
ct=$(curl -s -o /dev/null -w '%{content_type} %{http_code}' "${AUTH[@]}" "$BASE$PHOTO")
[ "$ct" = "image/jpeg 200" ] && ok "photoUrl serves jpeg" || bad "photoUrl -> $ct"

# PATCH person
resp=$(curl -s -w '\n%{http_code}' "${AUTH[@]}" -X PATCH "$BASE/api/people/$PID" -H 'content-type: application/json' -d '{"relationship":"neighbor","notes":"He waves every morning"}')
code=$(echo "$resp" | tail -1); body=$(echo "$resp" | sed '$d')
[ "$code" = 200 ] && [ "$(echo "$body" | jq -r .person.line)" = "This is Barack, your neighbor. He waves every morning." ] && ok "PATCH person updates line (adds period)" || bad "PATCH person $code $(echo "$body" | jq -c .person.line)"
code=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X PATCH "$BASE/api/people/$PID" -H 'content-type: application/json' -d '{"name":""}')
[ "$code" = 400 ] && ok "PATCH empty name -> 400" || bad "PATCH empty name -> $code"

# Remember: knew, then told
resp=$(curl -s -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/api/remember" -H 'content-type: application/json' -d "$(json --arg id "$PID" '{personId:$id,knew:true}')")
code=$(echo "$resp" | tail -1); body=$(echo "$resp" | sed '$d')
[ "$code" = 200 ] && [ -n "$(echo "$body" | jq -r '.speechId // empty')" ] && ok "POST /api/remember knew -> line+speechId" || bad "remember knew $code $body"
resp=$(curl -s -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/api/remember" -H 'content-type: application/json' -d "$(json --arg id "$PID" '{personId:$id,knew:false}')")
code=$(echo "$resp" | tail -1)
[ "$code" = 200 ] && ok "POST /api/remember told -> 200" || bad "remember told $code"
code=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X POST "$BASE/api/remember" -H 'content-type: application/json' -d '{"personId":"nope","knew":true}')
[ "$code" = 404 ] && ok "remember unknown person -> 404" || bad "remember unknown -> $code"

# Memory (no ANTHROPIC key expected: local distill)
resp=$(curl -s -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/api/people/$PID/memories" -H 'content-type: application/json' \
  -d '{"text":"he taught me how to make a proper cup of coffee. we would sit on the porch","source":"WEARER_VOICE"}')
code=$(echo "$resp" | tail -1); body=$(echo "$resp" | sed '$d'); MID=$(echo "$body" | jq -r '.memory.id // empty')
[ "$code" = 201 ] && [ -n "$MID" ] && ok "POST memory -> 201 ($(echo "$body" | jq -r .memory.calloutText))" || { bad "POST memory $code $body"; exit 1; }
[ "$(echo "$body" | jq -r .memory.useInCallout)" = true ] && ok "usable memory defaults on" || bad "useInCallout: $body"
LINE=$(curl -s "${AUTH[@]}" "$BASE/api/people/$PID" | jq -r .person.line)
echo "$LINE" | grep -q "He waves every morning. He taught me how" && ok "line now includes the memory: $LINE" || bad "line without memory: $LINE"

# Vague memory should be kept but not spoken
resp=$(curl -s -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/api/people/$PID/memories" -H 'content-type: application/json' -d '{"text":"I dont know","source":"WEARER_VOICE"}')
body=$(echo "$resp" | sed '$d'); VID=$(echo "$body" | jq -r '.memory.id // empty')
[ "$(echo "$body" | jq -r .memory.useInCallout)" = false ] && ok "vague memory kept but not spoken" || bad "vague memory: $body"
LINE2=$(curl -s "${AUTH[@]}" "$BASE/api/people/$PID" | jq -r .person.line)
[ "$LINE2" = "$LINE" ] && ok "line unchanged by unspoken memory" || bad "line changed: $LINE2"

# Toggle off, line drops it
code=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X PATCH "$BASE/api/memories/$MID" -H 'content-type: application/json' -d '{"useInCallout":false}')
LINE3=$(curl -s "${AUTH[@]}" "$BASE/api/people/$PID" | jq -r .person.line)
[ "$code" = 200 ] && [ "$LINE3" = "This is Barack, your neighbor. He waves every morning." ] && ok "toggle off removes memory from line" || bad "toggle off $code: $LINE3"
# Edit callout
resp=$(curl -s "${AUTH[@]}" -X PATCH "$BASE/api/memories/$MID" -H 'content-type: application/json' -d '{"calloutText":"He taught you to make coffee","useInCallout":true}')
[ "$(echo "$resp" | jq -r .memory.calloutText)" = "He taught you to make coffee." ] && ok "edit callout adds period" || bad "edit callout: $resp"
LINE4=$(curl -s "${AUTH[@]}" "$BASE/api/people/$PID" | jq -r .person.line)
[ "$LINE4" = "This is Barack, your neighbor. He waves every morning. He taught you to make coffee." ] && ok "spoken line = $LINE4" || bad "line: $LINE4"

# Detail: visits + memories + list count
detail=$(curl -s "${AUTH[@]}" "$BASE/api/people/$PID")
[ "$(echo "$detail" | jq '.person.visits | length')" = 2 ] && ok "detail has 2 visits" || bad "visits: $(echo "$detail" | jq -c .person.visits)"
[ "$(echo "$detail" | jq -c '[.person.visits[].knew] | sort')" = "[false,true]" ] && ok "visits record knew/told" || bad "knew flags"
[ "$(echo "$detail" | jq '.person.memories | length')" = 2 ] && ok "detail has 2 memories" || bad "memories count"
P=$(curl -s "${AUTH[@]}" "$BASE/api/people" | jq -c --arg id "$PID" '.people[] | select(.id==$id)')
[ "$(echo "$P" | jq -r .memoryCount)" = 2 ] && [ "$(echo "$P" | jq -r .lastRememberedAt)" != null ] && ok "list memoryCount 2 + lastRememberedAt" || bad "list: $P"

# Events
ev=$(curl -s "${AUTH[@]}" "$BASE/api/events?limit=50")
[ "$(echo "$ev" | jq '[.events[] | select(.type=="PRACTICE")] | length')" = 4 ] && ok "4 PRACTICE events (2 visits, 2 memories)" || bad "PRACTICE events: $(echo "$ev" | jq '[.events[] | select(.type=="PRACTICE")] | length')"
[ "$(echo "$ev" | jq '[.events[] | select(.type=="SPOKEN" and .data.source=="remember")] | length')" = 1 ] && ok "told step logged SPOKEN" || bad "SPOKEN remember"

# Delete memory
code=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X DELETE "$BASE/api/memories/$VID")
[ "$code" = 204 ] && ok "DELETE memory -> 204" || bad "DELETE memory $code"
code=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X DELETE "$BASE/api/memories/$VID")
[ "$code" = 404 ] && ok "DELETE again -> 404" || bad "DELETE again $code"

# Transcribe without keys -> 503 with a clear error
resp=$(curl -s -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/api/transcribe" -H 'content-type: audio/wav' --data-binary 'RIFFxxxxWAVE')
code=$(echo "$resp" | tail -1)
[ "$code" = 503 ] || [ "$code" = 200 ] && ok "POST /api/transcribe -> $code" || bad "transcribe $code $(echo "$resp" | sed '$d')"

# Web pages with a cookie session
JAR=$(mktemp)
curl -s -c "$JAR" -o /dev/null -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d "$(json --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e,password:$p}')"
for path in / /people "/people/$PID" /remember; do
  code=$(curl -s -b "$JAR" -o "$JAR.html" -w '%{http_code}' "$BASE$path")
  [ "$code" = 200 ] && ok "GET $path -> 200" || bad "GET $path -> $code"
done
grep -q "He taught you to make coffee" "$JAR.html" && ok "/remember shows the memory" || bad "/remember missing memory text"
curl -s -b "$JAR" "$BASE/people/$PID" > "$JAR.html"
grep -q "Say this through the glasses" "$JAR.html" && grep -q "Knew right away" "$JAR.html" && ok "/people/[id] has toggles and visits" || bad "/people/[id] content"
curl -s -b "$JAR" "$BASE/people/doesnotexist" > "$JAR.html"
grep -q "no longer in the roster" "$JAR.html" && ok "/people/unknown shows a gentle not-found" || bad "/people/unknown content"
rm -f "$JAR" "$JAR.html"

# Cleanup person
code=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X DELETE "$BASE/api/people/$PID")
[ "$code" = 204 ] && ok "DELETE person cascades memories" || bad "DELETE person $code"
echo "== $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
