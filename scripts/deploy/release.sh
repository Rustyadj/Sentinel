#!/usr/bin/env bash
# Deploy, verify or roll back ONE immutable release revision across everything
# that runs Sentinel code: the app, the migration job, and both workers.
#
#   release.sh deploy   <sha>   back up, build every image at <sha>, migrate, start, verify
#   release.sh rollback <sha>   put every service back on <sha> (no migration is run or reverted)
#   release.sh verify   <sha>   check that what is running IS <sha>, and healthy
#
# Run from (or point APP_DIR at) the compose checkout on the host. The workflow pipes
# this file from the release commit itself (`git show <sha>:scripts/deploy/release.sh`),
# so the script that deploys a revision is the script from that revision.
#
# Fail-closed by design: any unmet precondition stops BEFORE anything running is touched,
# and a failure after services were replaced rolls every service back to the previously
# running revision. Nothing here prints environment, compose config or credentials, and
# `set -x` is never used.
set -Eeuo pipefail
umask 077

SERVICES=(app learning-worker orchestration-worker)
BUILD_SERVICES=(app migrate learning-worker orchestration-worker)
APP_DIR="${APP_DIR:-$PWD}"
HEALTH_URL="${SENTINEL_HEALTH_URL:-http://127.0.0.1:3000}"
HEALTH_ATTEMPTS="${SENTINEL_HEALTH_ATTEMPTS:-60}"
HEALTH_INTERVAL="${SENTINEL_HEALTH_INTERVAL:-5}"
SHA_RE='^[0-9a-f]{40}$'

log()  { printf '[release %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die()  { printf '[release] ERROR: %s\n' "$*" >&2; exit 1; }

require_sha() { [[ "${1:-}" =~ $SHA_RE ]] || die "a full 40-character commit sha is required (got '${1:-}')"; }

cd "$APP_DIR"
[ -d .git ] || die "$APP_DIR is not a git checkout"
case "$(cd "$APP_DIR" && pwd -P)" in ""|"/"|"$HOME") die "refusing unsafe APP_DIR" ;; esac

compose() { docker compose "$@"; }

# The revision a container is actually running, from its own environment — not from the checkout,
# which can disagree with it (a hand-built override, or a checkout moved after a build).
running_commit() {
  local cid
  cid="$(compose ps -q "$1" 2>/dev/null | head -n1)"
  [ -n "$cid" ] || { echo ""; return 0; }
  docker inspect "$cid" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^SENTINEL_COMMIT=//p' | head -n1
}

verify_running() {
  local sha="$1" ok=0 service cid health commit label image
  for service in "${SERVICES[@]}"; do
    cid="$(compose ps -q "$service" | head -n1)"
    if [ -z "$cid" ]; then log "FAIL $service: no container"; ok=1; continue; fi
    commit="$(docker inspect "$cid" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^SENTINEL_COMMIT=//p' | head -n1)"
    label="$(docker inspect "$cid" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
    image="$(docker inspect "$cid" --format '{{.Config.Image}}')"
    health="$(docker inspect "$cid" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')"
    [ "$commit" = "$sha" ] || { log "FAIL $service: SENTINEL_COMMIT is '$commit', expected $sha"; ok=1; }
    [ "$label"  = "$sha" ] || { log "FAIL $service: image revision label is '$label', expected $sha"; ok=1; }
    case "$image" in *":$sha") ;; *) log "FAIL $service: image '$image' is not tagged with $sha"; ok=1 ;; esac
    [ "$health" = "healthy" ] || { log "FAIL $service: health is '$health'"; ok=1; }
    [ "$ok" -eq 0 ] && log "ok   $service @ ${sha:0:7} (healthy)"
  done
  # The app also states its own revision over HTTP.
  local reported
  reported="$(curl --noproxy '*' --fail --silent --max-time 10 "$HEALTH_URL/api/version" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p')" || reported=""
  [ "$reported" = "$sha" ] || { log "FAIL /api/version reports '$reported', expected $sha"; ok=1; }
  return "$ok"
}

wait_ready() {
  local attempt service cid health pending
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    pending=""
    curl --noproxy '*' --fail --silent --max-time 5 "$HEALTH_URL/api/health" >/dev/null 2>&1 || pending="$pending app-health"
    curl --noproxy '*' --fail --silent --max-time 5 "$HEALTH_URL/api/ready"  >/dev/null 2>&1 || pending="$pending app-ready"
    for service in "${SERVICES[@]}"; do
      cid="$(compose ps -q "$service" | head -n1)"
      health="$([ -n "$cid" ] && docker inspect "$cid" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' || echo missing)"
      [ "$health" = "healthy" ] || pending="$pending $service($health)"
    done
    [ -z "$pending" ] && return 0
    [ $((attempt % 6)) -eq 0 ] && log "waiting (attempt $attempt/$HEALTH_ATTEMPTS):$pending"
    sleep "$HEALTH_INTERVAL"
  done
  log "not ready after $HEALTH_ATTEMPTS attempts:$pending"
  return 1
}

build_all() {
  local sha="$1"
  export SENTINEL_RELEASE_SHA="$sha"
  export SENTINEL_BUILT_AT="${SENTINEL_BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  compose config --quiet
  compose build --pull "${BUILD_SERVICES[@]}"
}

start_all() {
  # --no-deps: bring up exactly the app and the workers on this revision. Whether `migrate` runs is the caller's decision.
  compose up -d --no-deps --remove-orphans "${SERVICES[@]}"
}

backup() {
  local dir="$1"
  mkdir -p "$dir/agents"
  compose exec -T postgres pg_dump -U hermes -d hermesos --format=custom > "$dir/postgres.dump"
  # A dump that cannot be listed cannot be restored; stop here rather than find out during a rollback.
  [ "$(stat -c %s "$dir/postgres.dump")" -gt 1024 ] || die "postgres dump is implausibly small"
  compose exec -T postgres pg_restore --list < "$dir/postgres.dump" >/dev/null || die "postgres dump is not a readable archive"
  compose exec -T redis redis-cli SAVE >/dev/null
  compose cp redis:/data/dump.rdb "$dir/redis.rdb"
  compose cp app:/opt/sentinel-os/agents/. "$dir/agents/" 2>/dev/null || log "no agents directory to back up"
}

cmd_verify() {
  require_sha "${1:-}"
  verify_running "$1"
}

cmd_rollback() {
  local target="${1:-}"
  require_sha "$target"
  git cat-file -e "$target^{commit}" 2>/dev/null || die "$target is not a commit in this checkout"
  log "rolling every service back to $target (database is left as it is; migrations are additive)"
  git checkout --quiet --detach "$target"
  build_all "$target"
  start_all
  wait_ready || die "rollback to $target did not become ready"
  verify_running "$target" || die "rollback to $target did not verify"
  log "rolled back to $target"
}

cmd_deploy() {
  local release="${1:-}"
  require_sha "$release"

  # ---- gates: nothing running has been touched yet ----------------------------------
  [ -f .env ] || die ".env is missing in $APP_DIR"
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "the checkout has uncommitted changes; refusing to deploy over them (see git status)"
  git fetch --quiet --prune origin main
  git cat-file -e "$release^{commit}" 2>/dev/null || die "$release is not a commit on origin"
  [ "$(git rev-parse 'origin/main^{commit}')" = "$release" ] || die "$release is not the head of origin/main"

  local checkout_sha running_sha previous stamp dir
  checkout_sha="$(git rev-parse HEAD)"
  running_sha="$(running_commit app)"
  # Roll back to what is RUNNING when that is a known commit, otherwise to what is checked out.
  previous="$checkout_sha"
  if [[ "$running_sha" =~ $SHA_RE ]] && git cat-file -e "$running_sha^{commit}" 2>/dev/null; then previous="$running_sha"; fi
  [ "$running_sha" = "$checkout_sha" ] || log "note: running revision '${running_sha:-none}' differs from the checkout '${checkout_sha:0:7}'; rollback target is ${previous:0:7}"

  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  dir="$APP_DIR/backups/releases/$stamp-$release"
  mkdir -p "$dir"
  printf '%s\n' "$previous" > "$dir/previous-sha"
  log "release $release (previous $previous); backup in $dir"
  backup "$dir"

  # ---- build and migrate: still no running service replaced ---------------------------
  local replaced=0
  rollback_on_failure() {
    trap - ERR
    log "FAILED. $([ "$replaced" -eq 1 ] && echo "Services were replaced; rolling every service back to $previous." || echo "No running service had been replaced; restoring the checkout only.")"
    if [ "$replaced" -eq 1 ]; then
      cmd_rollback "$previous" || log "ROLLBACK ALSO FAILED. Manual recovery needed; backups are in $dir."
    else
      git checkout --quiet --detach "$checkout_sha" || true
    fi
    exit 1
  }
  trap rollback_on_failure ERR

  git checkout --quiet --detach "$release"
  build_all "$release"
  compose run --rm migrate

  # ---- replace, then prove it ---------------------------------------------------------
  replaced=1
  start_all
  wait_ready
  verify_running "$release"
  trap - ERR
  [ "$(git rev-parse HEAD)" = "$release" ] || die "checkout moved during the deploy"

  printf '{"release":"%s","previous":"%s","deployedAt":"%s","backup":"%s"}\n' "$release" "$previous" "$stamp" "$dir" > "$dir/release.json"
  log "deployed immutable release $release to app and both workers"
}

case "${1:-}" in
  deploy)   shift; cmd_deploy "$@" ;;
  rollback) shift; cmd_rollback "$@" ;;
  verify)   shift; cmd_verify "$@" ;;
  *) die "usage: release.sh deploy|rollback|verify <40-char-sha>" ;;
esac
