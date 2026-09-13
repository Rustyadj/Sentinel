# Agent workspace base image

Build once per Sentinel host:

```bash
docker build -t sentinel/agent-workspace:base docker/agent-workspace
```

Environment consumed by the Sentinel host (never by the workspace image):

| Variable | Purpose | Default |
| --- | --- | --- |
| `AGENT_WORKSPACE_IMAGE` | Image used for new workspaces | `sentinel/agent-workspace:base` |
| `AGENT_WORKSPACE_SNAPSHOT_DIR` | Host directory holding snapshot tarballs | `/var/lib/sentinel/workspace-snapshots` |
| `AGENT_WORKSPACE_HELPER_IMAGE` | Throwaway image for volume/snapshot work | `alpine:3.20` |
| `AGENT_WORKSPACE_USER` | uid:gid workspace processes run as | `10001:10001` |
| `AGENT_WORKSPACE_DOCKER_BIN` | Docker CLI path | `docker` |
| `SENTINEL_WORKSPACE_GIT_TOKEN` | Git credential injected per-exec | unset (git remotes disabled) |
| `SENTINEL_WORKSPACE_GIT_USERNAME` | Git username for the token | `x-access-token` |

The Docker socket is **never** mounted into a workspace container. Only the
Sentinel host process talks to the daemon, behind the runtime gateway.
