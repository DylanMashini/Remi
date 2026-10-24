#!/usr/bin/env bash
# End-to-end auth check against a running server (works with macOS bash 3.2).
#   BASE=http://127.0.0.1:3101 SERVER_LOG=/path/to/server.log ./scripts/test-auth.sh
# SERVER_LOG is the server's stdout; with no RESEND_API_KEY the email links are printed there.
set -uo pipefail
BASE="${BASE:-http://127.0.0.1:3101}"
SERVER_LOG="${SERVER_LOG:-}"
JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
EMAIL="test+$(date +%s)$RANDOM@recall.local"
UPPER_EMAIL="$(printf '%s' "$EMAIL" | tr a-z A-Z)"
PASS="first-password-1"
NEWPASS="second-password-2"
fail=0

ok()   { echo "PASS  $1"; }
bad()  { echo "FAIL  $1"; fail=1; }
check() { if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1: expected $2 got $3"; fi; }
# post PATH BODY [curl args...] -> prints status code
post() { local p="$1" b="$2"; shift 2; curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d "$b" "$@" "$BASE$p"; }
get()  { local p="$1"; shift; curl -s -o /dev/null -w '%{http_code}' "$@" "$BASE$p"; }
creds() { printf '{"email":"%s","password":"%s"}' "$1" "$2"; }
reset_body() { printf '{"token":"%s","password":"%s"}' "$1" "$2"; }
email_body() { printf '{"email":"%s"}' "$1"; }
# Note: never write \" inside "$( ... )" here; bash 3.2 keeps the backslashes. Use the helpers.

# 1. signup -> 201 + cookie, normalized email, no passwordHash
B=$(printf '{"email":"  %s  ","password":"%s","name":"Test Carer","patientName":"Ruth"}' "$UPPER_EMAIL" "$PASS")
OUT=$(curl -s -c "$JAR" -w '\n%{http_code}' -H 'content-type: application/json' -d "$B" "$BASE/api/auth/signup")
check "signup status" 201 "$(printf '%s' "$OUT" | tail -n1)"
if printf '%s' "$OUT" | grep -q passwordHash; then bad "signup leaked passwordHash"; else ok "signup hides passwordHash"; fi
if printf '%s' "$OUT" | grep -q "\"email\":\"$EMAIL\""; then ok "email lowercased+trimmed"; else bad "email not normalized: $OUT"; fi
if grep -q recall_session "$JAR"; then ok "signup set recall_session cookie"; else bad "signup set no cookie"; fi
check "duplicate signup" 409 "$(post /api/auth/signup "$B")"
check "short password signup" 400 "$(post /api/auth/signup '{"email":"a@b.co","password":"short","name":"x","patientName":"y"}')"

# 2. session checks via /api/auth/me (always present) and /api/people (non-401 = auth passed)
check "me with cookie" 200 "$(get /api/auth/me -b "$JAR")"
check "me without auth" 401 "$(get /api/auth/me)"
S=$(get /api/people -b "$JAR"); if [ "$S" != 401 ] && [ "$S" != 000 ]; then ok "cookie accepted by /api/people ($S)"; else bad "cookie rejected by /api/people"; fi

# 3. login
check "wrong password" 401 "$(post /api/auth/login "$(creds "$EMAIL" nope-nope-nope)")"
check "unknown email" 401 "$(post /api/auth/login "$(creds nobody@nowhere.example "$PASS")")"
DEV=$(curl -s -D - -H 'content-type: application/json' -d "$(creds "$EMAIL" "$PASS")" "$BASE/api/auth/login?client=device")
TOKEN=$(printf '%s' "$DEV" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -n "$TOKEN" ]; then ok "device login returned token"; else bad "no device token: $DEV"; fi
if printf '%s' "$DEV" | grep -qi '^set-cookie: recall_session'; then bad "device login set a cookie"; else ok "device login set no cookie"; fi

# 4. bearer, logout
check "me with bearer" 200 "$(get /api/auth/me -H "authorization: Bearer $TOKEN")"
S=$(get /api/people -H "authorization: Bearer $TOKEN"); if [ "$S" != 401 ] && [ "$S" != 000 ]; then ok "bearer accepted by /api/people ($S)"; else bad "bearer rejected by /api/people"; fi
check "logout (bearer)" 204 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $TOKEN" "$BASE/api/auth/logout")"
check "bearer after logout" 401 "$(get /api/auth/me -H "authorization: Bearer $TOKEN")"
check "logout (cookie)" 204 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -b "$JAR" -c "$JAR" "$BASE/api/auth/logout")"
check "cookie after logout" 401 "$(get /api/auth/me -b "$JAR")"

# 5. forgot: always 204
check "forgot unknown email" 204 "$(post /api/auth/forgot '{"email":"nobody@nowhere.example"}')"
check "forgot real email" 204 "$(post /api/auth/forgot "$(email_body "$EMAIL")")"
sleep 1
RESET=""
[ -n "$SERVER_LOG" ] && RESET=$(grep "reset link for $EMAIL" "$SERVER_LOG" | tail -n1 | sed -n 's/.*reset?token=\([A-Za-z0-9_-]*\).*/\1/p')
if [ -z "$RESET" ]; then bad "no reset link in SERVER_LOG (with RESEND_API_KEY set, check the inbox instead)"; echo "SOME CHECKS FAILED"; exit 1; fi
ok "reset link found in server log"

# 6. reset kills sessions, is one-time
curl -s -o /dev/null -c "$JAR" -H 'content-type: application/json' -d "$(creds "$EMAIL" "$PASS")" "$BASE/api/auth/login"
check "me with fresh cookie" 200 "$(get /api/auth/me -b "$JAR")"
check "reset short password" 400 "$(post /api/auth/reset "$(reset_body "$RESET" short)")"
check "reset bad token" 400 "$(post /api/auth/reset "$(reset_body bogus "$NEWPASS")")"
check "reset" 204 "$(post /api/auth/reset "$(reset_body "$RESET" "$NEWPASS")")"
check "reset token reuse" 400 "$(post /api/auth/reset "$(reset_body "$RESET" "$NEWPASS")")"
check "old session after reset" 401 "$(get /api/auth/me -b "$JAR")"
check "login old password" 401 "$(post /api/auth/login "$(creds "$EMAIL" "$PASS")")"
check "login new password" 200 "$(post /api/auth/login "$(creds "$EMAIL" "$NEWPASS")")"

# 7. verify link, proxy, demo account
if [ -n "$SERVER_LOG" ]; then
  VERIFY=$(grep "verify link for $EMAIL" "$SERVER_LOG" | tail -n1 | sed -n 's/.*verify?token=\([A-Za-z0-9_-]*\).*/\1/p')
  LOC=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$BASE/api/auth/verify?token=$VERIFY")
  case "$LOC" in 303*"/?verified=1") ok "verify redirects ($LOC)";; *) bad "verify: $LOC";; esac
  LOC=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$BASE/api/auth/verify?token=$VERIFY")
  case "$LOC" in 303*"/?verified=0") ok "verify token is one-time";; *) bad "verify reuse: $LOC";; esac
fi
LOC=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$BASE/people")
case "$LOC" in 307*"/login?next=%2Fpeople") ok "proxy redirects /people ($LOC)";; *) bad "proxy: $LOC";; esac
for p in /login /signup /forgot "/reset?token=x"; do check "proxy leaves $p" 200 "$(get "$p")"; done
check "demo login" 200 "$(post /api/auth/login "$(creds demo@recall.local recall-demo)")"

if [ $fail = 0 ]; then echo "ALL PASSED"; else echo "SOME CHECKS FAILED"; exit 1; fi
