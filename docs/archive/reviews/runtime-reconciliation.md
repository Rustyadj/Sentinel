# Runtime Control Plane Reconciliation

Produced for the "Sentinel OS — Complete the Unified Runtime Control Plane" spec's Phase 1
repository audit. Written after the fact, describing the real reconciliation that was performed
(not a theoretical plan) — every classification below reflects an actual merge, actual conflict
resolution, and actual validation run on `production/runtime-control-final`.

## The real finding: the runtime control plane existed, but had never reached GitHub

Before this branch, the entire unified runtime adapter layer — `src/lib/agents/runtime/`
(Hermes, OpenClaw, Claude Code, and Codex adapters), the `AgentRuntime`/`AgentRuntimeSession`/
`AgentRuntimeEvent` persistence models, the full `/api/agent-runtimes/**` and
`/api/agent-sessions/**` API surface, the runtime console UI, and Learning Core hardening
(tenant isolation, real shadow execution, atomic candidate application, exact rollback) — existed
**only in a local git repository**, on branch `production/final-agent-control-plane`. It had
never reached `origin` on GitHub.

Root cause: one commit in that branch's history (`3568001`, "feat: expose immutable release
identity") touched `.github/workflows/ci.yml`. GitHub's OAuth App restriction blocks any push
that touches a workflow file without the `workflow` OAuth scope, which this session's git
credentials don't have — so the entire branch (20+ commits) was rejected on every push attempt,
silently sitting local-only since early in this effort.

**Fix applied on `production/final-agent-control-plane`** (commit `dfdbf06`): reverted just the
`.github/workflows/ci.yml` portion of `3568001` (the commit-SHA/build-time build-arg wiring
itself stays in the app code — `src/app/api/version/route.ts` already degrades gracefully to
`"unknown"` without it) so the rest of the branch could push cleanly. This unblocked the push
immediately; the small workflow diff (adding `SENTINEL_COMMIT`/`SENTINEL_BUILT_AT` build-args to
the CI docker build step) needs to be applied separately, either via the GitHub web UI or a token
that already carries the `workflow` scope — see "Deferred: workflow-file diff" below for the
exact patch.

Meanwhile, `main` had independently absorbed a *different* reconciliation — merging
`codex/preserve-vps-sentinel-state` (the branch actually deployed on the VPS, which had its own
7 unique commits: workspace operating model, live knowledge-graph chat, Redis session memory)
into an *earlier, pre-runtime-adapter* snapshot of `production/final-agent-control-plane`, then
porting the deployed UI on top. That merge is real and valid — it's why `main` now has correct
UI/chat-layout code and the Learning Core hardening — but because it was built from what was
actually reachable on GitHub at the time, it could not have included the runtime adapter layer,
which had never left this local machine.

## Classification

| Item | Location | Defect on `main` before this branch? | Decision | Resulting commit |
|---|---|---|---|---|
| Unified runtime adapter layer (Hermes/OpenClaw/Claude Code/Codex) | `src/lib/agents/runtime/` | **Yes** — did not exist on `main` at all. | PORT | brought in via merge `1aad67f` |
| `AgentRuntime`/`AgentRuntimeSession`/`AgentRuntimeEvent` models + migrations | `prisma/schema.prisma`, 5 migrations | **Yes** — schema had no runtime persistence beyond `Agent`. | PORT | `1aad67f` |
| `/api/agent-runtimes/**`, `/api/agent-sessions/**` API surface | `src/app/api/agent-runtimes/`, `src/app/api/agent-sessions/` | **Yes** — routes did not exist. | PORT | `1aad67f` |
| Runtime console UI | `src/app/agents/page.tsx` and related | **Yes** — no live runtime status/session UI existed. | PORT | `1aad67f` |
| Learning Core tenant isolation / real shadow execution / atomic apply / exact rollback | `src/lib/learning/*`, `src/lib/neural-engine/*` | Partially — `main`'s independent reconciliation already had some of this (via the `codex/preserve-vps-sentinel-state` merge path, which itself absorbed PR #21 hardening). | ALREADY PRESENT for the overlapping subset; PORT for the rest (self-improvement engine, Task/Workflow graph sync, cross-tenant enumeration-resistance tests — none of which existed on either lineage until this session). | `1aad67f` |
| `docker-compose.yml` OpenClaw endpoint / Hermes Clint toggle | `docker-compose.yml`, `src/lib/agents/registry.ts` | **Real conflict** — both `main` and `production/final-agent-control-plane` had independently added a different, non-overlapping half of the same config (main: container-name/native-URL fallback vars; this branch: corrected port default + Clint enable flag). | PORT WITH RECONCILIATION — union of both sides, not a pick. | `1aad67f` (merge commit) |
| Workflow-file portion of `3568001` (CI build-arg wiring) | `.github/workflows/ci.yml` | N/A — CI-only, blocks push. | DEFERRED — see below. | reverted in `dfdbf06`, not yet reapplied |
| Everything else in the 20-commit `production/final-agent-control-plane` history not called out above (security scoping for `/api/neural/**`, queue/worker hardening, scheduler-history recording, etc.) | various | **Yes**, each individually real per this session's own commit-by-commit work. | PORT | `1aad67f` |

No commits were classified OBSOLETE or REJECT in this pass — unlike the PR #21 reconciliation
(which dealt with a stale audit branch with genuine duplicate/superseded commits), this
reconciliation is a straight two-parent merge of two branches that had each done real,
non-overlapping work since their common ancestor. Everything on both sides was worth keeping.

## Deferred: workflow-file diff

Apply this to `.github/workflows/ci.yml` via the GitHub web UI (or any token with the `workflow`
OAuth scope) — it was reverted from this branch's history purely to unblock the push, not because
it's wrong:

```diff
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -53,7 +53,12 @@ jobs:
     steps:
       - uses: actions/checkout@v4
       - uses: docker/setup-buildx-action@v3
-      - run: docker build --target runner -t sentinel-os:ci .
+      - name: Build immutable application image
+        run: |
+          docker build \
+            --build-arg SENTINEL_COMMIT="$GITHUB_SHA" \
+            --build-arg SENTINEL_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
+            --target runner -t sentinel-os:ci .
 
   smoke:
     runs-on: ubuntu-latest
@@ -184,6 +189,7 @@ jobs:
 
           git checkout --detach "$SENTINEL_RELEASE_SHA"
           export SENTINEL_RELEASE_SHA
+          export SENTINEL_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
           docker compose config --quiet
           docker compose build --pull app migrate
           docker compose run --rm migrate
```

## Validation performed on the merged result (`production/runtime-control-final`)

- `npx prisma validate` — schema valid
- `npx prisma migrate deploy` — 16 migrations found, all applied, zero drift, zero pending
- `npx tsc --noEmit` — clean, zero errors, across the entire merged codebase
- `npm run lint` — zero errors (31 pre-existing warnings, none introduced by this merge; several
  pre-existing lint errors from earlier in this session were independently fixed by `main`'s own
  reconciliation and are now gone)
- `npx vitest run` (full suite) — **243/243 tests passing across 48 files**, including every
  Learning Core tenant-isolation, shadow-execution, atomic-apply, rollback, and enumeration-
  resistance test from both lineages
- `npm run build` — succeeds; the full runtime control plane API surface
  (`/api/agent-runtimes/**`, `/api/agent-sessions/**`, `/api/version`) is present in the build
  output

## Not performed — and cannot be from this environment

Phase 14 (Live VPS Validation) and the live-runtime portions of Phase 13 (Security) require
network access to the actual VPS running Hermes Lisa, Hermes Clint, OpenClaw, Claude Code, and
Codex. This sandbox has never had that access. Everything above is real and locally/CI-verifiable;
what remains is running the actual runtime discovery/health/session/cancel/logs/restart/reload
flows against the real installed binaries and containers, which only the live VPS can prove.
