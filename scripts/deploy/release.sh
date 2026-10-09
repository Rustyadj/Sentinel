#!/usr/bin/env bash
# Deploy, verify or roll back ONE immutable release revision across everything
# that runs Sentinel code: the app, the migration job, and both workers.
#
#   release.sh deploy   <sha>         back up, snapshot what is running, build every image at <sha>, migrate, start, verify
#   release.sh restore  <backup-dir>  put every service back on the exact images that were running before that deploy
#   release.sh rollback <sha>         rebuild every service from <sha> (a revision that has all of these services)
#   release.sh verify   <sha>         check that what is running IS <sha>, and healthy
#
# `restore` is the rollback for a failed deploy and for the first deploy after this script appeared: it does not depend
# on the previous revision's compose file or source (production's running app was built from an override, its workers
# from a different compose, and the revision it reports does not even define the orchestration worker). It re-creates
# the containers from images tagged at snapshot time, and no migration is run or reverted.
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

# A revision from before this script existed (e.g. what production runs today) neither tags its images with
# the revision nor passes the revision to the workers or gives them healthchecks. Rolling BACK to one is still
# legitimate; it just cannot be proven as strictly as a release built from this compose file.
tagged_release() { grep -q 'image: sentinel-os-app:\${SENTINEL_RELEASE_SHA' docker-compose.yml 2>/dev/null; }

verify_running() {
  local sha="$1" ok=0 service cid health commit label image strict=0
  tagged_release && strict=1
  [ "$strict" -eq 1 ] || log "note: $sha predates tagged images; verifying the app's revision and health, and that each service is up"
  for service in "${SERVICES[@]}"; do
    cid="$(compose ps -q "$service" | head -n1)"
    if [ -z "$cid" ]; then log "FAIL $service: no container"; ok=1; continue; fi
    commit="$(docker inspect "$cid" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^SENTINEL_COMMIT=//p' | head -n1)"
    label="$(docker inspect "$cid" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
    image="$(docker inspect "$cid" --format '{{.Config.Image}}')"
    health="$(docker inspect "$cid" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')"
    if [ "$strict" -eq 1 ] || [ "$service" = app ]; then
      [ "$commit" = "$sha" ] || { log "FAIL $service: SENTINEL_COMMIT is '$commit', expected $sha"; ok=1; }
    fi
    if [ "$strict" -eq 1 ]; then
      [ "$label"  = "$sha" ] || { log "FAIL $service: image revision label is '$label', expected $sha"; ok=1; }
      case "$image" in *":$sha") ;; *) log "FAIL $service: image '$image' is not tagged with $sha"; ok=1 ;; esac
      [ "$health" = "healthy" ] || { log "FAIL $service: health is '$health'"; ok=1; }
    else
      case "$health" in healthy|none) ;; *) log "FAIL $service: health is '$health'"; ok=1 ;; esac
    fi
    [ "$ok" -eq 0 ] && log "ok   $service @ ${sha:0:7} ($health)"
  done
  # The app also states its own revision over HTTP.
  local reported
  reported="$(curl --noproxy '*' --fail --silent --max-time 10 "$HEALTH_URL/api/version" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p')" || reported=""
  [ "$reported" = "$sha" ] || { log "FAIL /api/version reports '$reported', expected $sha"; ok=1; }
  return "$ok"
}

wait_ready() {
  local attempt service cid health state pending
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    pending=""
    curl --noproxy '*' --fail --silent --max-time 5 "$HEALTH_URL/api/health" >/dev/null 2>&1 || pending="$pending app-health"
    curl --noproxy '*' --fail --silent --max-time 5 "$HEALTH_URL/api/ready"  >/dev/null 2>&1 || pending="$pending app-ready"
    for service in "${SERVICES[@]}"; do
      cid="$(compose ps -q "$service" | head -n1)"
      if [ -z "$cid" ]; then pending="$pending $service(missing)"; continue; fi
      health="$(docker inspect "$cid" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')"
      # A revision without a healthcheck for this service can only be required to be running.
      if [ "$health" = none ] && ! tagged_release; then continue; fi
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

# Pin the exact images the running services use, under tags nothing else will reuse, and write the compose override that
# re-creates them. This is what a rollback restores: not "whatever the previous source builds to".
snapshot_running() {
  local dir="$1" stamp="$2" service cid image tag commit
  : > "$dir/snapshot.tsv"
  printf 'services:\n' > "$dir/restore.compose.yml"
  for service in "${SERVICES[@]}"; do
    cid="$(compose ps -q "$service" | head -n1)"
    [ -n "$cid" ] || { log "snapshot: $service is not running; a restore will leave it stopped"; continue; }
    image="$(docker inspect "$cid" --format '{{.Image}}')"
    commit="$(docker inspect "$cid" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^SENTINEL_COMMIT=//p' | head -n1)"
    tag="sentinel-os-rollback-$service:$stamp"
    docker tag "$image" "$tag"
    printf '%s\t%s\t%s\t%s\n' "$service" "$image" "$tag" "${commit:-unknown}" >> "$dir/snapshot.tsv"
    printf '  %s:\n    image: %s\n    pull_policy: never\n' "$service" "$tag" >> "$dir/restore.compose.yml"
    # An image from before the heartbeat existed cannot satisfy the heartbeat healthcheck the new compose file declares.
    [ "$(docker inspect "$cid" --format '{{if .State.Health}}1{{else}}0{{end}}')" = 1 ] || printf '    healthcheck:\n      disable: true\n' >> "$dir/restore.compose.yml"
  done
}

cmd_restore() {
  local dir="${1:-}" service image tag commit running want_app="" ok=0
  [ -n "$dir" ] && [ -f "$dir/snapshot.tsv" ] && [ -f "$dir/restore.compose.yml" ] || { log "ERROR: restore needs a backup directory written by a deploy (snapshot.tsv, restore.compose.yml)"; return 1; }
  log "restoring app and workers to the images recorded in $dir (database is left as it is; migrations are additive)"
  local services=()
  while IFS=$'\t' read -r service image tag commit; do
    docker image inspect "$tag" >/dev/null 2>&1 || { log "ERROR: snapshot image $tag is gone; cannot restore $service from it"; return 1; }
    services+=("$service"); [ "$service" = app ] && want_app="$commit"
  done < "$dir/snapshot.tsv"
  [ "${#services[@]}" -gt 0 ] || { log "ERROR: the snapshot contains no services"; return 1; }
  # Layer the override onto whatever compose file(s) this host uses (COMPOSE_FILE is path-list separated).
  export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}${COMPOSE_PATH_SEPARATOR:-:}$dir/restore.compose.yml"
  compose up -d --no-deps --remove-orphans "${services[@]}" || { log "ERROR: docker compose could not re-create the services from their snapshot images"; return 1; }
  while IFS=$'\t' read -r service image tag commit; do
    running="$(docker inspect "$(compose ps -q "$service" | head -n1)" --format '{{.Image}}' 2>/dev/null || true)"
    if [ "$running" = "$image" ]; then log "ok   $service is back on its snapshot image ($commit)"; else log "FAIL $service runs '$running', expected $image"; ok=1; fi
  done < "$dir/snapshot.tsv"
  [ "$ok" -eq 0 ] || { log "ERROR: restore did not put every service back on its snapshot image"; return 1; }
  # What the snapshot's app reports must be what is answering.
  local waited=0 reported=""
  until [ "$waited" -ge "$HEALTH_ATTEMPTS" ]; do
    curl --noproxy '*' --fail --silent --max-time 5 "$HEALTH_URL/api/health" >/dev/null 2>&1 && {
      reported="$(curl --noproxy '*' --fail --silent --max-time 10 "$HEALTH_URL/api/version" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p')" || reported=""
      break; }
    waited=$((waited+1)); sleep "$HEALTH_INTERVAL"
  done
  [ -z "$want_app" ] || [ "$reported" = "$want_app" ] || { log "ERROR: after restore the app reports '$reported', expected '$want_app'"; return 1; }
  log "restored: app reports ${reported:-unknown}; workers are on their snapshot images"
}

cmd_verify() {
  require_sha "${1:-}"
  verify_running "$1"
}

cmd_rollback() {
  local target="${1:-}" service
  require_sha "$target"
  git cat-file -e "$target^{commit}" 2>/dev/null || die "$target is not a commit in this checkout"
  # Rebuilding from a revision only works if that revision's compose file knows every service being replaced; otherwise
  # `--remove-orphans` would delete the one it does not define. Such a revision is rolled back with `restore` instead.
  for service in "${SERVICES[@]}" migrate; do
    git show "$target:docker-compose.yml" 2>/dev/null | grep -q "^  $service:" || die "$target's compose file has no '$service' service; roll back with 'restore <backup-dir>' (see backups/releases/*) instead"
  done
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

  local checkout_sha running_sha stamp dir
  checkout_sha="$(git rev-parse HEAD)"
  running_sha="$(running_commit app)"
  [ "$running_sha" = "$checkout_sha" ] || log "note: running app revision '${running_sha:-none}' differs from the checkout '${checkout_sha:0:7}'; the rollback is the exact running images, not either revision"

  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  dir="$APP_DIR/backups/releases/$stamp-$release"
  mkdir -p "$dir"
  printf '%s\n' "${running_sha:-$checkout_sha}" > "$dir/previous-sha"
  log "release $release (running ${running_sha:-none}); backup and snapshot in $dir"
  backup "$dir"
  snapshot_running "$dir" "$stamp"

  # ---- build and migrate: still no running service replaced ---------------------------
  local replaced=0
  rollback_on_failure() {
    trap - ERR
    log "FAILED. $([ "$replaced" -eq 1 ] && echo "Services were replaced; restoring every service to the images that were running." || echo "No running service had been replaced; restoring the checkout only.")"
    # Restore first, while the release's compose file (which defines every service) is still checked out; the
    # checkout goes back afterwards, so the repository ends where it started.
    if [ "$replaced" -eq 1 ]; then
      cmd_restore "$dir" || log "RESTORE ALSO FAILED. Manual recovery needed; backups and the snapshot are in $dir."
    fi
    git checkout --quiet --detach "$checkout_sha" || true
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

  printf '{"release":"%s","previous":"%s","deployedAt":"%s","backup":"%s"}\n' "$release" "${running_sha:-$checkout_sha}" "$stamp" "$dir" > "$dir/release.json"
  log "deployed immutable release $release to app and both workers"
  log "to roll back: release.sh restore $dir"
}

# Tests and rehearsals can load the functions without running a command.
[ -z "${RELEASE_SH_SOURCE_ONLY:-}" ] || return 0 2>/dev/null || exit 0

case "${1:-}" in
  deploy)   shift; cmd_deploy "$@" ;;
  restore)  shift; cmd_restore "$@" || exit 1 ;;
  rollback) shift; cmd_rollback "$@" ;;
  verify)   shift; cmd_verify "$@" ;;
  *) die "usage: release.sh deploy|rollback|verify <40-char-sha>  |  release.sh restore <backup-dir>" ;;
esac
