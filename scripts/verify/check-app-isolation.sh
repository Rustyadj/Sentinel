#!/usr/bin/env bash
# Asserts on the rendered compose config that the internet-facing `app` service
# holds no Docker socket, no CLI runtime binaries or credentials, and no host
# group (docs/SECURITY_REMEDIATION.md C1/H3), and that the services which took
# those over are in the default stack.
#
#   scripts/verify/check-app-isolation.sh            # docker-compose.yml
#   COMPOSE_FILE=other.yml scripts/verify/check-app-isolation.sh
#
# The rendered config contains the environment, so it is never printed.
set -euo pipefail

config="$(docker compose config --format json 2>/dev/null)"
fail=0
check() { # <description> <jq filter that must be true>
  if ! jq -e "$2" >/dev/null <<<"$config"; then
    echo "::error::$1"
    fail=1
  fi
}

check "app mounts the Docker socket" \
  '[.services.app.volumes[]? | "\(.source // ""):\(.target // "")"] | any(test("docker\\.sock")) | not'
check "app mounts the CLI runtime home or binaries" \
  '[.services.app.volumes[]? | "\(.source // ""):\(.target // "")"] | any(test("runtime-home|runtime-agents|runtime-bin")) | not'
check "app joins a host group (group_add)" \
  '(.services.app.group_add // []) | length == 0'
check "app points HOME/CLAUDE_CONFIG_DIR/CODEX_HOME at a runtime home" \
  '(.services.app.environment // {}) | (has("HOME") or has("CLAUDE_CONFIG_DIR") or has("CODEX_HOME")) | not'
check "app may execute CLI runtimes in-process" \
  '(.services.app.environment.SENTINEL_CLI_RUNTIME_HOST // "false") != "true"'
check "app has no workspace runner URL" \
  '(.services.app.environment.WORKSPACE_RUNNER_URL // "") != ""'
check "workspace-runner is not in the default stack" \
  '.services | has("workspace-runner")'
check "orchestration-worker is not the CLI runtime host" \
  '.services["orchestration-worker"].environment.SENTINEL_CLI_RUNTIME_HOST == "true"'

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "app isolation: ok"
