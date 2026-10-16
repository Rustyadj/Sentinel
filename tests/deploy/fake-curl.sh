#!/usr/bin/env bash
S="$FAKE_STATE"
url="${@: -1}"
case "$url" in
  */api/version) sha="$(cat "$S/svc.app.sha" 2>/dev/null)"; [ -n "${FAKE_VERSION_LIE:-}" ] && sha="$FAKE_VERSION_LIE"; echo "{\"commit\":\"$sha\",\"builtAt\":\"x\"}" ;;
  */api/health|*/api/ready) [ "${FAKE_APP_DOWN:-}" = 1 ] && exit 22; echo ok ;;
  *) echo ok ;;
esac
