#!/usr/bin/env bash
set -u
S="$FAKE_STATE"
echo "$*" >> "$S/calls.log"
svc_file() { echo "$S/svc.$1"; }
sha_of()    { cat "$(svc_file "$1").sha" 2>/dev/null || true; }
# Services a "compose" argument list names, after the verb: drop flags.
named() { for a in "$@"; do case "$a" in -*) ;; *) echo "$a" ;; esac; done; }
img_file() { echo "$S/svc.$1.img"; }
tag_dir="$S/tags"; mkdir -p "$tag_dir"
case "$1" in
  compose)
    shift
    # Leading "-f file" pairs (the restore override) are part of the project definition, not the verb.
    override=""
    while [ "${1:-}" = "-f" ]; do [ "$(basename "$2")" = "restore.compose.yml" ] && override="$2"; shift 2; done
    verb="$1"; shift
    case "$verb" in
      config)
        # A real "docker compose config" prints the resolved environment, secrets included.
        case " $* " in *" --quiet "*) exit 0 ;; *) echo "AUTH_SECRET=SUPER-SECRET-VALUE"; exit 0 ;; esac ;;
      build)  [ "${FAKE_BUILD_FAIL:-}" = 1 ] && { echo "build failed" >&2; exit 1; }; exit 0 ;;
      run)    [ "${FAKE_MIGRATE_FAIL:-}" = 1 ] && { echo "migration failed" >&2; exit 1; }; echo migrated >> "$S/events.log"; exit 0 ;;
      up)
        for name in $(named "$@" | grep -v '^d$'); do
          case "$name" in app|learning-worker|orchestration-worker)
            if [ -n "$override" ]; then
              [ "${FAKE_RESTORE_FAIL:-}" = 1 ] && { echo "compose up failed" >&2; exit 1; }
              # Re-create from the snapshot image the override names for this service.
              tag="$(awk -v svc="  $name:" '$0==svc{f=1;next} /^  [a-z-]+:$/{f=0} f&&/image:/{print $2}' "$override")"
              [ -f "$tag_dir/$tag" ] || { echo "no such image $tag" >&2; exit 1; }
              IFS=' ' read -r imgid commit < "$tag_dir/$tag"
              echo "$commit" > "$(svc_file "$name").sha"; echo "$imgid" > "$(img_file "$name")"
              echo "restored $name $commit" >> "$S/events.log"
            else
              echo "$SENTINEL_RELEASE_SHA" > "$(svc_file "$name").sha"; echo "sha256:img-$name-$SENTINEL_RELEASE_SHA" > "$(img_file "$name")"
              echo "up $name $SENTINEL_RELEASE_SHA" >> "$S/events.log"
            fi ;;
          esac
        done; exit 0 ;;
      ps)
        name="$(named "$@" | grep -v '^q$' | head -n1)"
        [ -f "$(svc_file "$name").sha" ] && echo "cid-$name"; exit 0 ;;
      exec)
        case "$*" in
          *pg_dump*)    head -c 4096 /dev/zero | tr '\0' 'x'; exit 0 ;;
          *pg_restore*) cat >/dev/null; [ "${FAKE_BAD_DUMP:-}" = 1 ] && exit 1; exit 0 ;;
          *) exit 0 ;;
        esac ;;
      cp) dest="${@: -1}"; mkdir -p "$(dirname "$dest")" 2>/dev/null; [ -d "$dest" ] || echo rdb > "$dest"; exit 0 ;;
    esac ;;
  tag)
    # docker tag <image-id> <tag>: remember which image (and commit) the tag points at.
    for n in app learning-worker orchestration-worker; do
      if [ "$(cat "$(img_file "$n")" 2>/dev/null)" = "$2" ]; then echo "$2 $(sha_of "$n")" > "$tag_dir/$3"; fi
    done; exit 0 ;;
  image)
    # docker image inspect <tag>
    [ "${FAKE_IMAGE_GONE:-}" = 1 ] && exit 1; [ -f "$tag_dir/$3" ]; exit $? ;;
  inspect)
    cid="$2"; name="${cid#cid-}"; sha="$(sha_of "$name")"; fmt="$4"
    health=healthy
    [ "${FAKE_UNHEALTHY:-}" = "$name" ] && [ "$sha" = "${FAKE_UNHEALTHY_SHA:-$sha}" ] && health=unhealthy
    legacy=0; [ -n "${FAKE_LEGACY_SHA:-}" ] && [ "$sha" = "$FAKE_LEGACY_SHA" ] && legacy=1
    # A revision from before tagged images: untagged image, no label, no healthcheck, workers never told their revision.
    [ "$legacy" = 1 ] && [ "$name" != app ] && health=none
    case "$fmt" in
      *Config.Env*)    override_var="FAKE_ENV_COMMIT_$(echo "$name" | tr - _)"
                       echo "PATH=/usr/bin"; c="${!override_var:-$sha}"; [ "$legacy" = 1 ] && [ "$name" != app ] && c=unknown; echo "SENTINEL_COMMIT=$c"; exit 0 ;;
      *Labels*)        [ "$legacy" = 1 ] && echo "" || echo "$sha"; exit 0 ;;
      *Config.Image*)  if [ "$legacy" = 1 ]; then echo "sentinel-os-$name"; else case "$name" in app) echo "sentinel-os-app:$sha" ;; *) echo "sentinel-os-worker:$sha" ;; esac; fi; exit 0 ;;
      *"{{.Image}}"*)  cat "$(img_file "$name")" 2>/dev/null || echo "sha256:img-$name-$sha"; exit 0 ;;
      *"State.Health}}1"*) [ "$legacy" = 1 ] && echo 0 || echo 1; exit 0 ;;
      *Health*)        echo "$health"; exit 0 ;;
    esac ;;
esac
exit 0
