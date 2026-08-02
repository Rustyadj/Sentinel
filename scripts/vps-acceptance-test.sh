#!/usr/bin/env bash
set -Eeuo pipefail

# Run this ON the production VPS, not from a developer workstation.
# Required for authenticated Sentinel checks:
#   SENTINEL_SESSION_COOKIE='authjs.session-token=...'
# Optional mutation gates (both default false):
#   RUN_EXECUTION_TESTS=true RUN_RUNTIME_RESTART_TESTS=true

BASE_URL="${SENTINEL_BASE_URL:-http://127.0.0.1:3000}"
SESSION_COOKIE="${SENTINEL_SESSION_COOKIE:-}"
RUN_EXECUTION_TESTS="${RUN_EXECUTION_TESTS:-false}"
RUN_RUNTIME_RESTART_TESTS="${RUN_RUNTIME_RESTART_TESTS:-false}"
ACCEPTANCE_WORKSPACE_ID="${ACCEPTANCE_WORKSPACE_ID:-}"
ACCEPTANCE_REPOSITORY="${ACCEPTANCE_REPOSITORY:-}"
EVIDENCE_DIR="${EVIDENCE_DIR:-./runtime-acceptance-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$EVIDENCE_DIR"

pass=0
fail=0
partial=0

record() {
  local status="$1" name="$2" detail="${3:-}"
  printf '%-8s %-34s %s\n' "$status" "$name" "$detail"
  case "$status" in PASS) pass=$((pass + 1));; FAIL) fail=$((fail + 1));; PARTIAL) partial=$((partial + 1));; esac
}

run_capture() {
  local name="$1" output="$2"; shift 2
  if "$@" >"$EVIDENCE_DIR/$output" 2>&1; then record PASS "$name" "$output"; else record FAIL "$name" "see $output"; fi
}

api() {
  local path="$1"; shift
  curl --fail-with-body --silent --show-error --max-time 35 \
    ${SESSION_COOKIE:+-H "Cookie: $SESSION_COOKIE"} \
    "$@" "$BASE_URL$path"
}

printf 'Sentinel VPS runtime acceptance\nHost: %s\nStarted: %s\nEvidence: %s\n\n' "$(hostname)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$EVIDENCE_DIR"

run_capture "host process inventory" processes.txt ps aux
run_capture "Docker inventory" docker.txt docker ps --no-trunc
if command -v systemctl >/dev/null 2>&1; then
  run_capture "user systemd inventory" systemd-user.txt systemctl --user list-units --type=service --all
else
  record PARTIAL "user systemd inventory" "systemctl unavailable"
fi

for binary in claude codex; do
  if executable="$(command -v "$binary" 2>/dev/null)"; then
    run_capture "$binary version" "$binary-version.txt" "$executable" --version
    stat -c '%U:%G %a %n' "$executable" >"$EVIDENCE_DIR/$binary-owner.txt"
    if [[ "$binary" == claude ]]; then
      run_capture "$binary authentication" "$binary-auth.txt" "$executable" auth status
    else
      run_capture "$binary authentication" "$binary-auth.txt" "$executable" login status
    fi
  else
    record FAIL "$binary discovery" "binary missing from PATH"
  fi
done

# Sentinel currently executes coding adapters in the app process. A host-only
# binary is not sufficient when that process runs in Docker, so verify the
# actual app execution boundary separately and leave the runtime Partial if it
# is absent there.
if docker compose ps --status running app >/dev/null 2>&1; then
  if docker compose exec -T app sh -lc 'command -v docker' >"$EVIDENCE_DIR/docker-app-boundary.txt" 2>&1; then
    record PARTIAL "Docker control boundary" "review socket scope before enabling restart/log control"
  else
    record FAIL "Docker control boundary" "app cannot perform Docker logs/restart/reload"
  fi
  for binary in claude codex; do
    if docker compose exec -T app sh -lc "command -v '$binary' && '$binary' --version" >"$EVIDENCE_DIR/$binary-app-boundary.txt" 2>&1; then
      record PASS "$binary app boundary" "$binary-app-boundary.txt"
    else
      record FAIL "$binary app boundary" "binary/auth runtime unavailable inside app container"
    fi
  done
else
  record PARTIAL "app execution boundary" "Sentinel app container is not running"
fi

for endpoint in http://127.0.0.1:4860 http://127.0.0.1:4861 http://127.0.0.1:3001; do
  safe_name="$(printf '%s' "$endpoint" | tr -c '[:alnum:]' '-')"
  if curl --fail --silent --show-error --max-time 5 "$endpoint" >"$EVIDENCE_DIR/$safe_name.txt"; then
    record PASS "native endpoint $endpoint"
  else
    record FAIL "native endpoint $endpoint"
  fi
done

if api /api/version >"$EVIDENCE_DIR/version.json"; then
  if jq -e '.commit != "unknown" and .builtAt != "unknown" and .environment == "production"' "$EVIDENCE_DIR/version.json" >/dev/null; then
    record PASS "immutable version identity" "$(jq -r '.commit' "$EVIDENCE_DIR/version.json")"
  else
    record FAIL "immutable version identity" "commit/builtAt/environment invalid"
  fi
else
  record FAIL "version endpoint"
fi

if [[ -z "$SESSION_COOKIE" ]]; then
  record PARTIAL "authenticated control plane" "set SENTINEL_SESSION_COOKIE to continue"
else
  if api /api/agent-runtimes >"$EVIDENCE_DIR/runtimes.json"; then
    record PASS "runtime inventory API" "$(jq '.runtimes | length' "$EVIDENCE_DIR/runtimes.json") runtimes"
    while IFS=$'\t' read -r runtime_id kind control; do
      api "/api/agent-runtimes/$runtime_id/health" >"$EVIDENCE_DIR/$runtime_id-health.json" \
        && record PASS "$runtime_id health" || record FAIL "$runtime_id health"
      api "/api/agent-runtimes/$runtime_id/readiness" >"$EVIDENCE_DIR/$runtime_id-readiness.json" \
        && record PASS "$runtime_id readiness" || record FAIL "$runtime_id readiness"
      api "/api/agent-runtimes/$runtime_id/capabilities" >"$EVIDENCE_DIR/$runtime_id-capabilities.json" \
        && record PASS "$runtime_id capabilities" || record FAIL "$runtime_id capabilities"
      [[ "$control" != verified ]] || record FAIL "$runtime_id pre-acceptance status" "must not start Verified"

      if [[ "$RUN_EXECUTION_TESTS" == true && ( "$kind" == claude-code || "$kind" == codex ) ]]; then
        if [[ -z "$ACCEPTANCE_WORKSPACE_ID" || -z "$ACCEPTANCE_REPOSITORY" ]]; then
          record FAIL "$runtime_id execution" "set ACCEPTANCE_WORKSPACE_ID and ACCEPTANCE_REPOSITORY"
          continue
        fi
        payload="$(jq -cn --arg workspaceId "$ACCEPTANCE_WORKSPACE_ID" --arg workingDirectory "$ACCEPTANCE_REPOSITORY" '{workspaceId:$workspaceId,workingDirectory:$workingDirectory}')"
        if api "/api/agent-runtimes/$runtime_id/sessions" -X POST -H 'Content-Type: application/json' --data "$payload" >"$EVIDENCE_DIR/$runtime_id-session.json"; then
          session_id="$(jq -r '.session.id' "$EVIDENCE_DIR/$runtime_id-session.json")"
          record PASS "$runtime_id session creation" "$session_id"
          api "/api/agent-sessions/$session_id/messages" -X POST -H 'Content-Type: application/json' \
            --data '{"prompt":"Report the current git branch and make no changes."}' >"$EVIDENCE_DIR/$runtime_id-events.sse" \
            && record PASS "$runtime_id execution stream" || record FAIL "$runtime_id execution stream"
          api "/api/agent-sessions/$session_id/logs" >"$EVIDENCE_DIR/$runtime_id-logs.json" \
            && record PASS "$runtime_id session logs" || record FAIL "$runtime_id session logs"
        else
          record FAIL "$runtime_id session creation"
        fi
      fi

      if [[ "$RUN_RUNTIME_RESTART_TESTS" == true && ( "$kind" == hermes || "$kind" == openclaw ) ]]; then
        api "/api/agent-runtimes/$runtime_id/restart" -X POST >"$EVIDENCE_DIR/$runtime_id-restart.json" \
          && record PASS "$runtime_id restart" || record FAIL "$runtime_id restart"
      fi
    done < <(jq -r '.runtimes[] | [.id,.kind,.sentinelControl] | @tsv' "$EVIDENCE_DIR/runtimes.json")
  else
    record FAIL "runtime inventory API"
  fi
fi

printf '\nSummary: %s passed, %s failed, %s partial\n' "$pass" "$fail" "$partial" | tee "$EVIDENCE_DIR/summary.txt"
printf 'Completed: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$EVIDENCE_DIR/summary.txt"

if (( fail > 0 || partial > 0 )); then
  printf 'NOT VERIFIED — fix failures and rerun every gated check.\n'
  exit 1
fi
printf 'Acceptance evidence is green. A human must review artifacts and audit logs before changing Sentinel Control to Verified.\n'
