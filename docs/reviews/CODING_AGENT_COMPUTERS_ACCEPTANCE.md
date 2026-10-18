# Coding agent computers: implementation verification

Branch: `feature/coding-agent-computers`, isolated checkout
`/root/sentinel-coding-computers`. Baseline: active checkout `87f8b50`.

The baseline contains two commits ahead of fetched `origin/main`: `189e144`
(Lisa Sentinel/Jev ingress) and `87f8b50` (Telegram reply/adapter contract).
Preserve this dependency when preparing a PR or rebase; those commits were not
reimplemented by this feature. Open PRs #17, #21, #41, #49, #53 and #54 were
inspected before editing. None supplied coding personal computers. The gateway,
Jev and telephony branches remain independent; nothing was merged or deployed.

## Checks performed

All checks below passed against the final implementation on 2026-10-18:

- 68 focused provisioning/default-resolution, model-policy adapter,
  runtime protocol, worktree recovery, Lisa-loop and delegation tests.
- 27 additional model-control, runtime authorization, chat routing and session
  security regression tests.
- Two scoped Git credential tests, including refusal to borrow the peer or
  legacy credential while retaining Hermes behavior.
- Ten integration cases with real Docker, a disposable PostgreSQL template and
  per-run database clones, the real workspace services/gateway/provider, and
  both adapters using deterministic fixture CLI executables. Cases cover
  repeat provisioning, distinct identities/volumes, session/task cwd, credential
  isolation/redaction, capability evidence inside the computer, delegated
  session binding/audit, stop/start/compute recreation, permission/lock/path and
  stopped-state denial, snapshots, missing/mismatched volume bindings, detached
  process controls, cancellation even when TERM is ignored, and timeout.
- `npx tsc --noEmit --pretty false`.
- ESLint across modified TypeScript source/tests and provisioning entrypoint.
- `docker compose config --quiet` (only the expected unset local AUTH_SECRET
  warning; no deployment configuration or secrets were supplied).
- `git diff --check`.

Total: 107 distinct focused tests, including 10 Docker integration cases.
Test databases and workspace volumes were isolated from application data. No
live agent session, production provisioning, provider request, migration,
service restart, merge or deployment was performed. The deterministic fixture
executables deliberately validate routing/protocols without claiming a real
provider/model acceptance result.

## Remaining rollout work

Follow [the operator runbook](../CODING_AGENT_COMPUTERS.md). Build the derived
image with approved exact CLI versions, supply separate provider and optional
Git keys to app and worker, verify Docker permissions, explicitly provision the
two computers, and populate each root project repository. Existing defaults and
images are preserved and may require an explicit image upgrade with compute
recreation. Start new sessions for the new binding; retain old host data and
transcripts for reviewed transfer. Verify real authenticated tasks through both
app and deployed worker, persistence/recovery, browser attachment where needed,
and unchanged Lisa/Nathan2 operation. A configured key or historic runtime
verification flag alone is not evidence that this live acceptance passed.
