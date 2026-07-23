# Post-Codex Production Review

**Reviewed range:** `origin/main` (`58f3096a64975ae5b52b3fcf0ef8ea2685d6b27e`) → `origin/agent/trustworthy-control-plane` (`c81d2402084b26fabb6f6670aa41ba84251b8c3c`), PR #13 "Make Sentinel control plane trustworthy".

This review covers the diff listed below. It does **not** cover Phases 3–8 of the full production-readiness brief (manual workflow verification across every module, viewport/accessibility QA, new workspace feature builds, voice architecture review, or a Playwright E2E pass) — those are out of scope for this pass and are called out explicitly rather than silently skipped.

## 1. Reviewed commit range

```
git diff --stat origin/main..origin/agent/trustworthy-control-plane
```

30 files changed, 973 insertions(+), 754 deletions(-). Touches: Mission Control data layer (`src/lib/mission-control/*`), the Mission Control UI components, `RightPanel.tsx`, `TopBar.tsx`, `ModuleTabs.tsx`, the Organization chart (`OrgPage.tsx` + `/api/org`), `/api/ready`, a new Redis health helper, a new authenticated VPS telemetry collector (`scripts/vps-telemetry.mjs`), a CI workflow, and docs.

## 2. Verified fixes

All of the following were read in full diff form and cross-checked against the pre-image on `main`, not taken on the PR description's word:

- **Fake success on attention-queue actions (fixed).** `resolveAttention` previously did `await new Promise((r) => setTimeout(r, 250)); return { ok: true }` unconditionally — a UI control reporting success without any server call. It now makes a real `PATCH /api/approvals/:id` or `POST /api/neural/learning-candidates/:id/review` and only returns `{ok:true}` when `response.ok`; on failure it throws with the server's error message. The client (`AttentionQueue.tsx`) does not mark an item resolved until that promise succeeds, and renders a visible `role="alert"` error otherwise. Covered by real tests in `service.test.ts` (`does not report success when the decision API rejects the write`).
- **Fabricated Mission Control data (fixed).** `src/lib/mission-control/mock.ts` (103 lines of hand-authored fake agents/tasks/feed items) is deleted. `buildMissionControlData` in the new `server.ts` queries Postgres directly (workspaces, projects, rooms, tasks, agents, approvals, learning candidates, audit log, knowledge events/objects, experiences) and returns a `sources` map with an explicit `live | stale | unavailable | demo` state per card. Agent runtime fields (CPU, memory, progress, voice state, cost) are sourced only from an optional telemetry payload (`SENTINEL_TELEMETRY_URL`); when that env var is unset the `agents` source is explicitly `unavailable` with a stated reason, and no CPU/memory/progress/cost values are invented.
- **Hardcoded org chart (fixed).** `OrgPage.tsx`'s `DEFAULT_NODES`/`DEFAULT_EDGES` previously hardcoded a fake org ("Rusty Johnson — CEO", "CodeGuardian", "Campaign Studio", etc.). Both are now empty arrays; the chart loads from `/api/org`, which is backed by `OrgChart` in Postgres, scoped by `workspaceId`.
- **Silent failure + fake-success save on Organization (fixed).** The old `save()` wrote to `localStorage` unconditionally *before* attempting the network call, and swallowed fetch failures in an empty `catch {}` while still flipping the UI to "Saved". The new `save()` only writes `localStorage` after a confirmed `response.ok`, surfaces `saveError` visibly on failure, and disables the Save button when no `workspaceId` is resolved — directly addressing the brief's "never show saved after a rejected request" and API/UI `workspaceId` agreement requirements. `/api/org` GET/PUT now both echo `workspaceId` in the response so the client can bind to the server's value rather than assume its own.
- **Hardcoded right-panel activity feed (fixed).** `RightPanel.tsx`'s `ActivityTab` had a static `PANEL_EVENTS` array ("Hermes Lisa — Analyzed project requirements", etc.) computed against a module-level `PANEL_NOW = new Date()`. It's replaced with the same `missionControlService.load()` used by the dashboard, rendering real feed/agent data with per-section source-state labels, and an explicit "no live adapter" message for the Memory/Files/Tasks tabs rather than continuing to show sample content.
- **VPS telemetry collector is real and authenticated.** `scripts/vps-telemetry.mjs` reads actual `/proc/net/dev`, `os.cpus()`, `df`, and `docker stats`/`docker ps`; the HTTP endpoint requires a Bearer token matching `SENTINEL_TELEMETRY_TOKEN` (constructor throws if unset) and returns 401 on mismatch, 404 on any other route. No fabricated fallback values.

## 3. Defect found and fixed in this pass

**Unscoped, unbounded `experience` and `learningCandidate` queries in `buildMissionControlData`** (`src/lib/mission-control/server.ts`). Both queries fetched rows with no workspace/project scoping at the database level and filtered down to the caller's accessible workspaces/projects only afterward in application memory:

- `db.learningCandidate.findMany({ where: { status: "proposed" }, take: 100, ... })` — global, `take: 100` applied *before* the in-memory workspace/project filter. On a system with more than 100 proposed candidates system-wide, another tenant's more recent candidates could push a user's own out of the window entirely — a silent completeness bug, not a client-visible leak, but real attention items could disappear without any error.
- `db.experience.findMany({ where: { createdAt: { gte: sinceToday } }, ... })` — global, **no `take` limit at all**. Every experience created today across every tenant is pulled into server memory on every Mission Control load before being filtered down. Unbounded-query/scale risk, and pulls cross-tenant rows into the request's memory even though they're never returned to the client.

**Fix applied:** added a lightweight `db.project.findMany({ where: projectScope, select: { id: true } })` query (accessible project ids, unbounded — this one is fine, it's already scoped by `projectScope`) ahead of the main `Promise.all`, and used its result plus `workspaceIds` to scope both queries at the database level (`experience.workspaceId in workspaceIds OR experience.projectId in accessibleProjectIds`, and the same via a nested `experience: { is: { OR: [...] } }` filter for `learningCandidate`). Added a `take: 200` cap to the `experience` query. The existing in-memory filters (`visibleCandidates`, `experiences`) were left in place as defense-in-depth rather than removed.

Verified: `npx tsc --noEmit` clean, `npx eslint src/lib/mission-control/server.ts` clean, `npm run build` succeeds.

## 4. Remaining defects (not fixed in this pass)

- `scripts/vps-telemetry.mjs` compares the Bearer token with `!==` (non-constant-time string comparison). Low severity for an internal telemetry endpoint behind `SENTINEL_TELEMETRY_URL`, but worth a `crypto.timingSafeEqual` swap if this endpoint is ever exposed beyond the VPS's internal network.
- `TopBar.tsx`, `ModuleTabs.tsx`, `.github/workflows/ci.yml`, and `docker-compose.yml` diffs were read but not exhaustively re-derived line-by-line the way `server.ts`/`OrgPage.tsx`/`RightPanel.tsx` were.
- No new automated test covers `buildMissionControlData`'s workspace/project scoping directly (the existing `service.test.ts` only covers the client `HttpMissionControlService`, which is real and correct, but doesn't reach the server aggregation function this pass touched). Recommend a Postgres-backed integration test asserting that `buildMissionControlData` for user A never returns another workspace's experiences/candidates — this is the kind of "cross-workspace isolation" test Phase 8 of the full brief calls for and it does not exist yet.

## 5. Security risks

- None found that weren't already being fixed by this PR. The one addressed above (cross-tenant rows entering server memory unscoped) was a completeness/scale risk, not a confirmed client-visible data leak — the in-memory filter was correct, just inefficient and silently lossy under load.

## 6. Data-integrity risks

- None found beyond the query-scoping issue above.

## 7. UX failures

- None found in the reviewed diff; the two previously-existing UX failures this PR fixes (fake "Saved" state, fake attention-queue resolution) are covered in §2.

## 8. Deployment risks

- No Prisma migrations in this diff — schema-safe to deploy.
- `scripts/vps-telemetry.mjs` and `SENTINEL_TELEMETRY_URL`/`SENTINEL_TELEMETRY_TOKEN` are new required-for-full-functionality but optional-at-runtime pieces: Mission Control degrades to an explicit `unavailable` agent-telemetry state rather than failing if they're not deployed alongside this change. Safe to ship the app change ahead of the telemetry collector.
- `.github/workflows/ci.yml` was added in this diff; not independently re-run in this pass (no access to trigger GitHub Actions from this session in a way that reflects the target repo's actual runner environment).

## 9. Recommended priorities

1. Merge this PR's honesty fixes — they remove multiple confirmed "lies about working" defects (fake save, fake approve/reject, fabricated dashboard data) that the mission brief treats as the one hard line.
2. Add the cross-workspace isolation integration test called out in §4 before the next Mission Control change touches `server.ts` again.
3. Treat Phases 3–8 of the full audit brief (manual workflow verification, viewport QA, workspace feature builds, voice review, Playwright E2E) as separate follow-up work, not part of this pass.
