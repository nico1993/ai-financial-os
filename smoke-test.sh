#!/usr/bin/env bash
# End-to-end smoke test for everything built so far (SETUP -> DATA -> AUTH
# -> ING). Nothing here has ever run, so this exists to find the runtime
# problems that typecheck and unit tests structurally cannot: BullMQ API
# signatures, the hand-written Redis session store, mongoose connecting and
# building indexes, and the real Plaid round-trip.
#
#   bash smoke-test.sh              # repeatable; reuses the smoke-test user
#   bash smoke-test.sh --reset      # wipe the dev database first
#
# Stages 1-7 need no credentials. Stages 8-9 run only if .env has real
# Plaid sandbox keys, and use Plaid's sandbox endpoint to mint an Item
# without the Link UI, so the whole ingestion path runs from the terminal.
#
# --reset drops the Mongo database and flushes Redis. Only ever point this
# at a development stack.
set -uo pipefail

RESET=false
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")" 2>/dev/null || true
if [ ! -f pnpm-workspace.yaml ] && [ -d "$HOME/Projects/ai-financial-os" ]; then
  cd "$HOME/Projects/ai-financial-os"
fi
[ -f pnpm-workspace.yaml ] || { echo "Run this from inside ai-financial-os." >&2; exit 1; }

LOG_DIR=".smoke-logs"
mkdir -p "$LOG_DIR"
COOKIES="$LOG_DIR/cookies.txt"
API="http://localhost:3000"
API_PID=""
WORKER_PID=""
FAILURES=0

pass() { printf "  \033[32mPASS\033[0m  %s\n" "$1"; }
fail() { printf "  \033[31mFAIL\033[0m  %s\n" "$1"; FAILURES=$((FAILURES + 1)); }
skip() { printf "  \033[33mSKIP\033[0m  %s\n" "$1"; }
stage() { printf "\n\033[1m%s\033[0m\n" "$1"; }

# Kills a process AND its children. `pnpm start` forks tsx, and tsx is
# what actually holds the port -- killing only the pnpm parent orphans the
# child, which then survives to answer the next run's health check with
# stale code and stale config. That is precisely how a stale API kept
# serving REPLACE_ME credentials across runs.
stop_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  pkill -P "$pid" 2>/dev/null
  kill "$pid" 2>/dev/null
}

cleanup() {
  stage "Cleaning up"
  stop_tree "$API_PID" && [ -n "$API_PID" ] && echo "  stopped api"
  stop_tree "$WORKER_PID" && [ -n "$WORKER_PID" ] && echo "  stopped worker"

  # Belt and braces: whatever the trap missed (an orphan, a crash before
  # PIDs were recorded, an earlier interrupted run) gets swept by pattern
  # and then by port. Without this a failed run leaves the next one
  # testing a ghost.
  pkill -f "src/index\.ts" 2>/dev/null
  sleep 1
  local stragglers
  stragglers="$(lsof -ti tcp:3000 2>/dev/null | tr '\n' ' ')"
  if [ -n "${stragglers// /}" ]; then
    echo "  force-freeing port 3000 (pids: $stragglers)"
    # shellcheck disable=SC2086
    kill -9 $stragglers 2>/dev/null
  fi

  if lsof -ti tcp:3000 >/dev/null 2>&1; then
    printf "  \033[31mport 3000 is STILL occupied\033[0m -- kill it before re-running:\n"
    echo "    lsof -ti tcp:3000 | xargs kill -9"
  else
    echo "  port 3000 free"
  fi

  echo "  logs kept in $LOG_DIR/ (mongo+redis left running)"
}
trap cleanup EXIT

# Waits for a regex to appear in a log file, or times out.
wait_for_log() {
  local file="$1" pattern="$2" timeout="${3:-30}" i=0
  while [ "$i" -lt "$timeout" ]; do
    [ -f "$file" ] && grep -qE "$pattern" "$file" && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}

# Runs a request and checks the status code. Body lands in $BODY.
check_status() {
  local label="$1" expected="$2"; shift 2
  local out status
  out="$(curl -sS -o "$LOG_DIR/body.txt" -w "%{http_code}" "$@" 2>>"$LOG_DIR/curl.err")"
  status="$out"
  BODY="$(cat "$LOG_DIR/body.txt" 2>/dev/null)"
  if [ "$status" = "$expected" ]; then
    pass "$label ($status)"
    return 0
  fi
  fail "$label -- expected $expected, got $status: $(echo "$BODY" | head -c 200)"
  return 1
}

# ---------------------------------------------------------------- preflight
stage "0. Preflight"
[ -f .env ] || { fail ".env missing -- run 'bash dev-setup.sh' first"; exit 1; }
pass ".env present"
command -v docker >/dev/null || { fail "docker not on PATH"; exit 1; }
docker info >/dev/null 2>&1 || { fail "docker daemon not running"; exit 1; }
pass "docker running"
command -v pnpm >/dev/null || { fail "pnpm not on PATH"; exit 1; }
pass "pnpm available"

# Kill anything left over from an interrupted run. A stale API still bound
# to port 3000 is genuinely dangerous here: the new one dies with
# EADDRINUSE, the old one answers /health, and the whole suite then tests a
# process running last run's environment. That is exactly how a run passed
# stage 4 while the API was still using REPLACE_ME credentials.
STRAY="$(pgrep -f "src/index\.ts" 2>/dev/null | tr '\n' ' ')"
if [ -n "${STRAY// /}" ]; then
  printf "  \033[33mcleanup\033[0m stopping stray api/worker from a previous run: %s\n" "$STRAY"
  pgrep -fl "src/index\.ts" 2>/dev/null | sed 's/^/           /' | head -6
  pkill -f "src/index\.ts" 2>/dev/null
  sleep 2
fi

# A surviving WORKER is even nastier than a surviving API: it has no port
# to clash on, so nothing complains -- it just quietly competes for jobs
# and wins some of them, logging to a terminal nobody is reading. That is
# how a drain "never happened" while actually running elsewhere.
if pgrep -f "src/index\.ts" >/dev/null 2>&1; then
  fail "a stray api/worker survived -- kill it and re-run"
  pgrep -fl "src/index\.ts" | sed 's/^/       /' | head -6
  echo "       pkill -f 'src/index.ts'"
  exit 1
fi
pass "no stray api/worker processes"

if lsof -ti "tcp:3000" >/dev/null 2>&1; then
  fail "something else is still listening on port 3000 -- stop it and re-run"
  lsof -i "tcp:3000" | sed 's/^/       /' | head -5
  exit 1
fi
pass "port 3000 free"

# Reads one value out of .env, tolerating the things a hand-edited file
# picks up: a trailing CR (if it was ever touched on Windows or pasted
# from a browser), surrounding quotes, and stray whitespace. A credential
# with an invisible \r on the end authenticates as garbage and Plaid
# rejects it with a message that says nothing about whitespace.
env_value() {
  grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- \
    | tr -d '\r' \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
          -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

PLAID_ID="$(env_value PLAID_CLIENT_ID)"
PLAID_SECRET_VAL="$(env_value PLAID_SECRET)"
PLAID_READY=true
if [ -z "$PLAID_ID" ] || [ "$PLAID_ID" = "REPLACE_ME" ] ||
   [ -z "$PLAID_SECRET_VAL" ] || [ "$PLAID_SECRET_VAL" = "REPLACE_ME" ]; then
  PLAID_READY=false
fi

# ------------------------------------------------------------ infrastructure
stage "1. Mongo + Redis"
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mongo redis \
  >"$LOG_DIR/compose.log" 2>&1 || { fail "compose up failed -- see $LOG_DIR/compose.log"; exit 1; }
printf "  waiting for healthchecks"
for i in $(seq 1 30); do
  healthy="$(docker compose ps --format '{{.Health}}' mongo redis 2>/dev/null | grep -c healthy)"
  [ "$healthy" = "2" ] && break
  printf "."; sleep 2
done
echo
if [ "$healthy" = "2" ]; then pass "mongo + redis healthy"; else fail "not healthy after 60s"; exit 1; fi

if [ "$RESET" = true ]; then
  printf "  \033[33m--reset\033[0m dropping the dev database and flushing Redis\n"
  docker compose exec -T mongo mongosh --quiet --eval \
    'db.getSiblingDB("ai-financial-os").dropDatabase()' >/dev/null 2>&1 \
    && pass "mongo database dropped" || fail "could not drop the mongo database"
  docker compose exec -T redis redis-cli FLUSHALL >/dev/null 2>&1 \
    && pass "redis flushed (sessions and queues)" || fail "could not flush redis"
fi

stage "2. Dependencies"
pnpm install >"$LOG_DIR/install.log" 2>&1 && pass "pnpm install" || { fail "install failed -- see $LOG_DIR/install.log"; exit 1; }

# ------------------------------------------------------------------- worker
stage "3. Worker boot  (validates the BullMQ scheduler API)"
pnpm --filter @financial-os/worker start >"$LOG_DIR/worker.log" 2>&1 &
WORKER_PID=$!
if wait_for_log "$LOG_DIR/worker.log" "started [0-9]+ queue worker" 40; then
  pass "worker started"
else
  fail "worker did not start -- see $LOG_DIR/worker.log"
  tail -20 "$LOG_DIR/worker.log" | sed 's/^/       /'
fi
# This is the line that proves upsertJobScheduler took the arguments we gave it.
if wait_for_log "$LOG_DIR/worker.log" "polling every [0-9]+ minutes" 15; then
  pass "repeatable schedule registered (upsertJobScheduler)"
else
  fail "schedule not registered -- upsertJobScheduler signature is the prime suspect"
  tail -20 "$LOG_DIR/worker.log" | sed 's/^/       /'
fi

# ---------------------------------------------------------------------- api
stage "4. API boot"
pnpm --filter @financial-os/api start >"$LOG_DIR/api.log" 2>&1 &
API_PID=$!
printf "  waiting for /health"
for i in $(seq 1 30); do
  curl -sf "$API/health" >/dev/null 2>&1 && break
  printf "."; sleep 1
done
echo
# Check for a port clash BEFORE trusting /health. Otherwise a surviving
# older process answers, every later stage silently tests it instead, and
# the failures surface much further downstream as confusing API errors.
if grep -aq "EADDRINUSE" "$LOG_DIR/api.log" 2>/dev/null; then
  fail "the API we started died -- port 3000 was already taken"
  echo "       Something is answering /health, but it is NOT this run's process,"
  echo "       so every later stage would be testing stale code and stale config."
  echo "       Stop it with:  lsof -ti tcp:3000 | xargs kill"
  exit 1
fi

if curl -sf "$API/health" >/dev/null 2>&1; then
  pass "GET /health"
else
  fail "api never became healthy -- see $LOG_DIR/api.log"
  tail -20 "$LOG_DIR/api.log" | sed 's/^/       /'
  exit 1
fi

# --------------------------------------------------------------------- auth
stage "5. Auth  (validates the hand-written Redis session store)"
rm -f "$COOKIES"
# A stable identity, not a timestamped one: ADR-0018 closes registration
# once any user exists, so a fresh email each run would work exactly once
# and then lock itself out. First run registers; every later run logs in.
EMAIL="smoke-test@example.com"
PASSWORD="smoke-test-password-123"

REG_STATUS="$(curl -sS -o "$LOG_DIR/body.txt" -w "%{http_code}" \
  -c "$COOKIES" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  "$API/api/auth/register" 2>>"$LOG_DIR/curl.err")"

case "$REG_STATUS" in
  201)
    pass "POST /api/auth/register (bootstrap user created)"
    ;;
  403 | 409)
    # Not a failure -- this is the bootstrap rule doing its job.
    pass "registration refused as designed ($REG_STATUS); logging in instead"
    if ! check_status "POST /api/auth/login" 200 \
      -c "$COOKIES" -H "Content-Type: application/json" \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$API/api/auth/login"; then
      echo "       A different user already owns this database, so registration is"
      echo "       closed and these credentials don't exist. Re-run with --reset."
    fi
    ;;
  *)
    fail "POST /api/auth/register -- unexpected $REG_STATUS: $(head -c 200 "$LOG_DIR/body.txt")"
    ;;
esac

check_status "GET /api/auth/me (session persisted through Redis)" 200 \
  -b "$COOKIES" "$API/api/auth/me"

if echo "$BODY" | grep -q "passwordHash"; then
  fail "/api/auth/me leaked passwordHash"
else
  pass "no passwordHash in the response"
fi

check_status "POST /api/auth/logout" 204 -b "$COOKIES" -c "$COOKIES" -X POST "$API/api/auth/logout"
check_status "GET /api/auth/me after logout is rejected" 401 -b "$COOKIES" "$API/api/auth/me"

stage "6. Route protection"
# No Content-Type header: this endpoint takes no body, and Fastify parses
# the body BEFORE preHandler hooks run -- so sending an empty body with
# `Content-Type: application/json` gets rejected at the parsing stage and
# never reaches requireAuth. That would be testing the JSON parser, not
# route protection.
check_status "POST /api/plaid/link-token without a session" 401 \
  -X POST "$API/api/plaid/link-token"

# Again with a well-formed body, to prove the 401 comes from the auth
# hook rather than from anything about how the request was shaped.
check_status "POST /api/plaid/exchange without a session" 401 \
  -X POST -H "Content-Type: application/json" \
  -d '{"publicToken":"public-sandbox-irrelevant"}' "$API/api/plaid/exchange"

stage "7. Webhook verification"
check_status "unsigned webhook is rejected" 401 \
  -X POST -H "Content-Type: application/json" \
  -d '{"webhook_type":"TRANSACTIONS","webhook_code":"SYNC_UPDATES_AVAILABLE","item_id":"fake"}' \
  "$API/api/webhooks/plaid"

# -------------------------------------------------------------------- plaid
stage "8. Plaid round-trip"
if [ "$PLAID_READY" != true ]; then
  skip "no Plaid sandbox keys in .env -- add PLAID_CLIENT_ID / PLAID_SECRET and re-run"
else
  rm -f "$COOKIES"
  check_status "log back in" 200 \
    -c "$COOKIES" -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$API/api/auth/login"

  if check_status "POST /api/plaid/link-token" 200 -b "$COOKIES" -X POST "$API/api/plaid/link-token"; then
    echo "$BODY" | grep -q "linkToken" && pass "link token returned" || fail "no linkToken in response"
  fi

  # Mint a sandbox Item directly, so the whole ingestion path can run
  # without a browser. This talks to Plaid rather than to our adapter --
  # it's test scaffolding, not app code.
  PLAID_HTTP="$(curl -sS -o "$LOG_DIR/plaid-sandbox.json" -w "%{http_code}" \
    -X POST https://sandbox.plaid.com/sandbox/public_token/create \
    -H 'Content-Type: application/json' \
    -d "{\"client_id\":\"$PLAID_ID\",\"secret\":\"$PLAID_SECRET_VAL\",\"institution_id\":\"ins_109508\",\"initial_products\":[\"transactions\"]}" \
    2>>"$LOG_DIR/curl.err")"

  # tr -d '\n' first: the extraction is line-based, so it would miss the
  # field entirely if Plaid ever pretty-prints. The [[:space:]]* around
  # the colon covers `"public_token": "..."` as well as the compact form.
  PUBLIC_TOKEN="$(tr -d '\n' < "$LOG_DIR/plaid-sandbox.json" \
    | sed -n 's/.*"public_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"

  if [ -z "$PUBLIC_TOKEN" ]; then
    fail "could not mint a sandbox public_token (HTTP $PLAID_HTTP)"
    # Print what Plaid actually said. Its error bodies name the problem
    # exactly (INVALID_API_KEYS, INVALID_FIELD, ...) and never echo the
    # secret back, so there is nothing to redact.
    echo "       Plaid replied:"
    sed 's/^/         /' "$LOG_DIR/plaid-sandbox.json" | head -20
    echo "       Keys being sent: client_id ${#PLAID_ID} chars, secret ${#PLAID_SECRET_VAL} chars"
    echo "       (both should be 24-32 chars; a wrong length usually means a"
    echo "        truncated paste, and INVALID_API_KEYS usually means the"
    echo "        Production or Development secret instead of the Sandbox one)"
  else
    pass "sandbox public_token minted"

    if check_status "POST /api/plaid/exchange" 201 \
      -b "$COOKIES" -H "Content-Type: application/json" \
      -d "{\"publicToken\":\"$PUBLIC_TOKEN\"}" "$API/api/plaid/exchange"; then

      CONNECTION_ID="$(echo "$BODY" | sed -n 's/.*"connectionId":"\([^"]*\)".*/\1/p')"
      ACCOUNTS="$(echo "$BODY" | grep -o '"providerAccountId"' | wc -l | tr -d ' ')"
      [ -n "$CONNECTION_ID" ] && pass "connection created ($CONNECTION_ID)" || fail "no connectionId returned"
      [ "$ACCOUNTS" -gt 0 ] && pass "$ACCOUNTS account(s) fetched" || fail "no accounts fetched"

      stage "9. Sync drain  (the ING-4 pagination loop, for real)"
      if [ -n "$CONNECTION_ID" ]; then
        pnpm --filter @financial-os/worker exec tsx src/scripts/enqueueSync.ts "$CONNECTION_ID" \
          >"$LOG_DIR/enqueue.log" 2>&1 && pass "sync job enqueued" || {
            fail "enqueue failed"; tail -10 "$LOG_DIR/enqueue.log" | sed 's/^/       /'; }

        if wait_for_log "$LOG_DIR/worker.log" "connection=$CONNECTION_ID pages=" 60; then
          pass "drain completed"
          grep "connection=$CONNECTION_ID pages=" "$LOG_DIR/worker.log" | tail -1 | sed 's/^/       /'
        else
          fail "no drain in 60s -- see $LOG_DIR/worker.log"
          tail -25 "$LOG_DIR/worker.log" | sed 's/^/       /'
        fi
      fi
    fi
  fi
fi

# ------------------------------------------------------------------ summary
stage "Summary"
if [ "$FAILURES" -eq 0 ]; then
  printf "  \033[32mEverything passed.\033[0m\n"
else
  printf "  \033[31m%d check(s) failed.\033[0m Logs are in %s/\n" "$FAILURES" "$LOG_DIR"
fi
exit "$FAILURES"
