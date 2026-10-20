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

## Deployment preflight after merge/deploy authorization

PR #55 was opened against main. The host release inputs were inventoried and a
private PostgreSQL backup was created and verified. The migration rehearsal on
a disposable restored copy passed: no pending schema changes, unchanged row
counts in all 121 tables, no new drift, and compatibility with running revision
`189e144`. App, worker and browser CI run independently before merge; the GitHub
branch protection requires passing checks and an approving review.

A real coding image was built with Claude Code 2.1.226 and Codex 0.153.4. Both
version commands run as UID 10001; image home directories contain no credential
files and image environment contains no provider keys. A real Codex sandboxed
command under cap-drop ALL/no-new-privileges failed because Bubblewrap could not
create namespaces. Its deprecated Landlock mode also rejects the required
filesystem-restricted policy. Codex 0.147.0's Landlock fallback was additionally
checked in a disposable image and showed the same rejection; that test image
was removed. No sandbox bypass, privileged container, host sysctl change or
security-policy relaxation was applied.

The adapter now probes an actual credential-free Codex sandboxed command during
health checks and reports `sandbox_unavailable` rather than claiming readiness
from the version response. The probe does not refresh the idle timer. Dedicated
regressions cover rejection and success; the fixture CLI verifies probes receive
no provider keys.

Deployment and activation remain gated on the required GitHub review, secure
references for the two dedicated provider keys, and a reviewed compatible Codex
sandbox configuration. The running production app/workers, Lisa/Nathan2 services,
workspace defaults, volumes and runtime credentials have not been replaced or
modified by this preflight. Rollout records and the database backup are retained
privately under `/root/sentinel-release-prep-72e30e3`.

Automated PR review additionally identified the 16 KB shell-command limit as a
regression for valid large coding prompts. Both adapters now send prompt data
through stdin; command audit rows retain prompt length without copying prompts
to workspace files or embedding them in shell text. Two real Docker cases send
near-100,000-character prompts with shell metacharacters and verify exact input
length, completion, bounded command text, and absence of shell execution.

Follow-up validation passed 38 focused cases across four suites, including all
12 Docker integration cases and both sandbox-readiness regressions, plus
TypeScript, changed-file ESLint and diff checks. Before these follow-up changes,
PR CI passed verify, Docker, smoke, browser and the deployment gate on 72e30e3;
the updated commit must complete CI again before any merge. No production
services were replaced.
