# Claude Code and Codex personal computers

## Existing system and integration points

Lisa and Nathan2 are canonical Agent identities (`hermes-lisa`,
`hermes-nathan2`), backed by `runtime-hermes-*` AgentRuntime rows. The runtime
control-plane, collaboration-room and agent-model-control migrations seed them;
`agents/registry.ts` supplies UI metadata, and `agents/runtime/config.ts` supplies
compatibility configuration. `runtime/service.ts` resolves persisted runtime
rows. Hermes uses its existing authenticated WebSocket JSON-RPC adapter:
`hermes.ts` and `transports/hermes-websocket.ts`. Agent-specific credentials are
resolved on the control plane. Neither adapter nor either Hermes service is
replaced by this change.

Their personal-computer mechanism is the existing `agent_workspaces` subsystem:
`defaults.ts` resolves a canonical default (or promotes one unambiguous legacy
candidate); `service.ts` controls compute independently of data; `gateway.ts`
authorizes agent identity/client policy; `authorization.ts` checks tenant RBAC,
owner/grants, expiry and lock/archive state. `providers/docker.ts` provisions a
labelled named volume and an unprivileged container. Workspace APIs and UI use
these same services for files, commands/terminal, processes, permissions, events,
artifacts, snapshots and optional browser contexts. The default-workspace partial
unique index already exists. No additional schema or parallel computer registry
is needed.

Previously Claude Code and Codex's CLI adapters and task Git operations spawned
on Sentinel's host, commonly under the same `AGENT_PROJECT_ROOT`. Now
`runtime/workspace-runner.ts` binds them to their own default AgentWorkspace.
Direct chat, runtime API sessions, room turns, task worktrees, task merges and
explicit session delegation all reach that binding. Each execution checks agent
ownership/client policy and the session user's workspace execute access; grants
and locks are checked again before each command. Existing upstream runtime,
Guardian, task-lock and delegation authorization still apply.

Sessions persist `metadata.agentWorkspaceId`; sends and Claude resume reject
legacy/unbound sessions and sessions belonging to a different default computer.
Start a **new session/room** after rollout rather than attaching an old host
session. Old transcripts and project directories are retained. Codex's model and
usage provenance is read inside its computer, never from the host Codex home.
Task branches merge into that agent's own projects repository. Changes are shared
through existing messages/artifacts or explicitly granted workspace operations;
computers do not share a Git object directory.

## Configuration and provisioning

Run these steps only during an approved rollout. This feature does not provision
computers on app startup and never automatically copies a host checkout or home.
Both app and orchestration worker need the same database, Docker daemon/socket,
socket group (`DOCKER_GID`), snapshot directory and per-agent secret settings.
The worker image now includes the Docker CLI. Use the shipped Compose changes;
Docker is available only to the control plane, never inside an agent computer.

Build the existing base and a coding image with reviewed exact CLI versions:

```bash
docker build -t sentinel/agent-workspace:base docker/agent-workspace
docker build -f docker/coding-agent/Dockerfile \
  --build-arg CLAUDE_CODE_VERSION=YOUR_REVIEWED_VERSION \
  --build-arg CODEX_VERSION=YOUR_REVIEWED_VERSION \
  -t sentinel/coding-agent:YOUR_RELEASE .
```

Set `SENTINEL_CLAUDE_CODE_API_KEY` and `SENTINEL_CODEX_API_KEY` independently in
the app and orchestration worker's protected deployment environment. Use separate
provider keys/accounts as appropriate. No fallback to host login files or the
other runtime's key exists. The host values become `ANTHROPIC_API_KEY` only for
Claude execution and `CODEX_API_KEY` only for Codex execution. Keys travel via
per-exec environment injection, with names rather than values in Docker CLI
arguments. Version checks, Git worktree operations and file/provenance reads
receive no provider key. Neither image build nor provisioning needs provider
credentials. Never run a CLI login or copy `.credentials.json`, `auth.json`, a
host `.claude`/`.codex` directory or a secret-bearing config into a volume.
Nonsecret model/effort settings use the existing per-Agent model policy and CLI
arguments. `HOME`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are set per command to
paths in the selected agent's home; host config directories are ignored.

For authenticated Git operations, optionally set `SENTINEL_CLAUDE_CODE_GIT_TOKEN`
and `SENTINEL_CODEX_GIT_TOKEN` independently, with corresponding `_GIT_USERNAME`
settings (default `x-access-token`). These keys are injected only by the existing
Git controls for clone/pull/fetch. Coding computers never fall back to the shared
legacy workspace Git token; Hermes keeps its existing Git credential behavior.

With the reviewed application/worker images installed, run from a control-plane
checkout/container that has `tsx`, DB access and the same Docker access:

```bash
npx tsx scripts/provision-coding-computers.ts TENANT_ID OWNER_USER_ID sentinel/coding-agent:YOUR_RELEASE
```

The user ID must be the tenant owner. The command ensures the two canonical
Agent identities/runtime assignments, resolves their default computers, starts
compute and initializes an empty Git repository in `<home>/projects` if none
exists. For new computers the home is `/workspace`, on a separate named volume
for each agent, with a ten-minute command limit and only the owning coding
client plus Sentinel UI allowed by default. Add project files or clone reviewed
repositories through each computer's Files/Git controls. Initializing an empty
repository does not import Sentinel source or create a shared repository.
For task orchestration, populate `<home>/projects` itself with the intended
project: add a credential-free HTTPS remote in the terminal, fetch through that
computer's Git controls (which inject its Git key), and check out the intended
remote branch. A nested clone under `projects/<name>` is available to sessions
with an explicitly selected cwd; it does not populate the root repository used
by task worktrees.

Repeat the command safely after interruption. It reuses existing defaults,
volumes, homes, policies, images and projects; it does not reset or replace them.
An incomplete volume allocation is retried against the same workspace ID.
Multiple candidates without a default, tenant/owner mismatches, locked/archived
computers and conflicting runtime assignments require explicit operator repair.
If an existing default uses a base image without the CLIs, snapshot its data,
set its image to the reviewed coding image through authorized administration,
then destroy **compute only** and start it again. Rerunning provisioning does
not overwrite an existing image choice. No migration changes Lisa or Nathan2.

## Controls and health

Open `/agent-workspaces`, select **Claude Code Personal Computer** or **Codex
Personal Computer**, and use the existing lifecycle, Files, terminal/commands,
Processes, Permissions, Activity and Snapshots controls. Resource limits, idle
pause, lock/archive and data deletion protections apply. The optional Browser
tab uses the existing per-workspace Playwright context on the Sentinel server;
it reports unattached when Chromium is unavailable. Browser sessions are not a
persistent desktop or an in-container browser. See `AGENT_WORKSPACES.md` for
installation and current browser limitations.

The existing Agent Runtime Console/operations status calls adapter health against
the computer's actual CLI, not the host binary. Healthy status names the computer
ID. Missing/ambiguous defaults, stopped/paused compute, lock/archive, unavailable
backend, missing binary and missing credentials fail closed with diagnostic
codes. A configured API key permits an execution attempt; health explicitly
reports provider authentication as unverified (`authenticated: null`) until real
execution is checked. A version response or historic `executionVerified` row is
not acceptance evidence for the new computer. Task commands and session events
are audited; provider key values are redacted before output is persisted or
streamed. Cancellation and deadlines terminate the in-container process group;
an internal timeout also bounds commands if the control-plane process dies.

## Acceptance and recovery

Before enabling live traffic, verify both **app and worker** paths:

1. Record each default workspace ID, container ID and volume. Verify distinct
   identities/volumes; inspect Docker mount and ownership labels. Confirm no
   Docker socket, host source or credential-home mount inside either computer.
2. Send a harmless real task through direct chat and the orchestration worker
   for each agent. Have it write a unique file in its own projects directory.
   Check AgentSession metadata, WorkspaceCommand cwd/origin and observed process
   location. Confirm each provider account accepts the selected model; then mark
   runtime execution verified through existing operator procedures if needed.
3. Stop/start and destroy/recreate each runtime. Verify the file and home survive.
   Snapshot, change a test file, explicitly restore, start and verify recovery.
4. Check user RBAC/grants, cross-agent denial, client restrictions, locks and
   archive state; test a separately authorized delegation. No shared host cwd
   should appear. A switched default must reject old session sends/resumes.
5. Check key rotation/revocation, absence of the peer key and credential files,
   output redaction, cancellation, timeout, disk limits and backend failure.
   Refresh operations status after stopping compute or removing credentials.
6. Smoke-test Lisa and Nathan2 using their existing Hermes endpoints and existing
   computers. Their IDs, data, defaults, credentials and transports must match
   the pre-rollout inventory.

Recovery uses existing workspace controls. Start/unpause stopped compute;
unlock/unarchive only intentionally. For `default_workspace_conflict`, select
the intended existing default through the authorized default-workspace API;
do not delete candidate data. For `volume_missing`, restore the original volume
and ownership labels or recover its backup before starting compute. Starting
compute now refuses a missing/mismatched volume instead of allowing Docker to
silently create an empty replacement. For an image upgrade, preserve the volume
and replace compute explicitly. For expired credentials rotate only the owning
agent's host setting and refresh app/worker environment. Retry in a new session
when legacy session binding is rejected. Preserve old host projects for a
reviewed, secret-free transfer through existing files/artifacts; no automatic
migration of host credentials or worktrees occurs.

If the control plane restarts mid-task, inspect its persisted running sessions,
workspace command records and processes. The existing stale-session diagnostic
requires operator reconciliation; automatic execution replay is not introduced.
Use process controls to terminate stragglers before retrying. Roll back app and
worker together, retain volumes/snapshots/transcripts, and suspend coding traffic
until routing has been reverified; an older release uses the old host transport.

## Automated checks

Protocol/model-policy tests isolate the transport; the opt-in integration suite
uses real Docker, PostgreSQL, default resolution, gateway, command audit and both
CLI adapters with deterministic fixture executables. It makes no provider calls.
It verifies repeated provisioning, task/session routing, credential separation
and redaction, persistence, authorization failures, snapshot recovery and process
termination. Use a dedicated test database/template, never the live DB:

```bash
docker build -t sentinel/coding-computers:test tests/agents/fixtures/coding-computer
SENTINEL_TEST_TEMPLATE_URL=postgresql://postgres:sentinel_test@127.0.0.1:55449/sentinel_vitest_template \
SENTINEL_TEST_CODING_DOCKER=1 \
AGENT_WORKSPACE_SNAPSHOT_DIR=/tmp/sentinel-coding-computers-test-snapshots \
npx vitest run tests/agents/coding-computers.integration.test.ts
```

Prepare an isolated PostgreSQL template with `scripts/test/prepare-test-template.sh`
and its `SENTINEL_TEST_PG_CONTAINER`/`SENTINEL_TEST_PG_HOSTPORT` overrides first.
Vitest clones and drops one DB per run. The integration suite cleans up only its
own coding computers/volumes. The fixture image intentionally imitates CLI
protocols; approved real CLI versions, model access, live provider auth, browser
availability and deployed worker routing still require rollout acceptance.
