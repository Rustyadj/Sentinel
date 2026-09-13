# Agent Workspaces

A durable, isolated computer per Hermes agent. Closing a conversation, stopping
a runtime or destroying a container never destroys workspace data.

## Layers

```
Sentinel UI  /agent-workspaces
        ↓  /api/agent-workspaces/*            (human, tenant RBAC)
Runtime Gateway  /api/agent-workspaces/gateway (hermes | claude-code | codex)
        ↓  src/lib/agent-workspaces/gateway.ts  authorization + policy
Workspace services  service / exec / files / git / processes / snapshots / artifacts
        ↓  WorkspaceRuntimeProvider            (src/lib/agent-workspaces/types.ts)
DockerWorkspaceProvider                        (only Docker-aware file)
        ↓
container (non-root, cap-drop ALL) + named volume (persistent)
```

## Two lifecycles, never merged

| Concern | Where it lives | Destroyed by |
| --- | --- | --- |
| Runtime (compute) | `AgentWorkspaceRuntime.state` | Stop / Destroy runtime |
| Workspace data | `AgentWorkspace.status`, the named volume | Delete workspace data only |

Runtime states — `STOPPED`, `STARTING`, `RUNNING`, `PAUSED`, `STOPPING`,
`ERROR` — are always reconciled against the backend (`reconcileRuntime`), never
reported from the database alone. `ARCHIVED` is a data-lifecycle state.

## Identity

Every workspace carries `workspaceId`, `agentId`, `runtimeId`, `ownerId`,
`organizationId` and its tenant `workspaceId`. Container and volume names are
derived *from* the id; the id is never derived from a container name.

## Cross-agent and cross-client rules

* A workspace belongs to one agent. Any other agent needs an explicit
  `WorkspacePermission` grant (`read` / `write` / `admin`), which is revocable
  and can expire. Denials are recorded as `delegation.blocked` events.
* `policy.crossAgentDelegation` defaults to `"explicit-only"`: Claude Code and
  Codex never hand work to each other unless the request carries an
  operator-supplied authorization. Enforced in `policy.assertDelegationAllowed`
  and covered by tests, not by prompt wording.

## Security controls

Non-root uid 10001, `--cap-drop ALL`, `--security-opt no-new-privileges`,
per-workspace cpu/memory/pids limits, optional `network: none`, tmpfs `/tmp`,
lexical path containment before any backend call, argv-array execution (no host
shell), bounded command timeouts and output capture, per-exec secret injection
with redaction of captured output, full event + audit trail. The Docker socket
is never mounted into a workspace and agents never reach the daemon.

## Operating

Build the base image once per host and set the host env described in
`docker/agent-workspace/README.md`. Idle compute is released by
`POST /api/agent-workspaces/maintenance/idle-sweep` (or `sweepIdleWorkspaces`).

Acceptance run against real Docker:

```bash
DATABASE_URL=... npx tsx scripts/agent-workspace-acceptance.ts
```

## Browser runtime

Importing the server-only browser seam registers the Playwright provider. The
provider probes a real headless Chromium launch before reporting `attached:
true`; a missing browser executable, failed launch, or a Sentinel server
running as root is reported as unattached with the real reason. A successful
provider keeps one isolated Playwright `BrowserContext` per agent workspace in
process memory. Sessions are bound to the workspace id, are not restored after
a server restart, and remain alive until explicitly closed (or until the
browser process disconnects). The browser runs as the Sentinel server user and
the Docker socket is never exposed to it or mounted in a workspace.

Install Chromium as the same non-root operating-system user that runs Sentinel:

```bash
npx playwright install chromium
```

The browser API requires `agent_workspace.view` for screenshots and
`agent_workspace.execute` for session creation, navigation, downloads, and
closure. Network-disabled workspaces cannot navigate or download. Browser
downloads are staged in a private host temporary directory, streamed to the
authenticated caller, and then removed; they are not silently written into the
workspace volume.

## Disk-limit enforcement

The Docker provider uses an audited checked guard, not a filesystem quota.
Docker's default persistent `local` named-volume driver does not expose a
portable enforceable size option, so Sentinel does not claim that the host is
enforcing one. `resourceLimits.diskGb` is interpreted as GiB (`1024^3` bytes).
The provider measures actual workspace usage with `du`, exposes that value as
`diskUsedBytes`, serializes mutations within each Sentinel process, and:

* preflights direct file writes and copies using their projected net size;
* inspects a snapshot's expanded member sizes before restore and verifies the
  restored volume afterward; and
* checks before command execution, then watches usage while the command runs
  and terminates the command when a polling check observes the limit crossed.

Every rejected or observed quota crossing raises the stable `disk_full`
`WorkspaceError` and appends a `runtime.error` workspace/audit event containing
the measured and configured byte counts. Explicit runtime restart recreates
the container so current container-level resource settings are applied while
retaining the named volume.

This guard has real limits: it is not an atomic filesystem quota. A command or
already-running background process can briefly overshoot between 200 ms polls,
and writers that bypass this Sentinel process (for example, a host administrator
mounting the volume directly) are outside the in-process lock. Once usage is
over limit, subsequent guarded writes and execs fail until data is removed or
the limit is raised. Deployments requiring strict, zero-overshoot enforcement
must provide a storage driver/filesystem with per-volume project quotas; this
implementation deliberately does not pretend the default Docker local driver
has that capability.

Copy preflights are intentionally conservative: they count the full source
size even when the destination may replace existing data. This can reject a
near-limit copy that would have fit after replacement, but it never approves a
copy by assuming bytes will be reclaimed before Docker has actually done so.
