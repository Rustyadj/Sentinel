# PR #21 Post-Merge Reconciliation

PR #21 (`codex/learning-core-release-audit` → `learning-core/neural-engine-extension`) was an
independent audit performed **before** PR #20 merged into `main`. Its base branch no longer
exists as an open target — PR #20 merged as `8ab38e8` on current `main`. This document inspects
every PR #21 commit against current `main` (branched here as
`production/final-agent-control-plane`) rather than merging it mechanically, per the explicit
instruction not to trust stale PR metadata.

Audit doc reviewed for content (not ported as a file — superseded by this doc and by PR #20's
own final release report, both of which already exist for this repo):
`docs/reviews/LEARNING_CORE_RELEASE_AUDIT.md` at commit `444fcddc`.

## Classification legend

- **PORT UNCHANGED** — cherry-picked cleanly, no reconciliation needed.
- **PORT WITH RECONCILIATION** — applied with a manual conflict resolution or partial port.
- **ALREADY PRESENT** — the defect it fixes doesn't exist on current `main`.
- **OBSOLETE** — branch-housekeeping commit (merge commit), not a real change.
- **REJECT** — not ported; reasoning given per commit.

## Commit-by-commit disposition

| PR #21 SHA | Summary | Defect still on `main` before this branch? | Action | Resulting commit |
|---|---|---|---|---|
| `1c7708c` | fix: close proven Learning Core governance bypasses | **Yes** — no `src/lib/learning/authorization.ts` existed; benchmark results/creation, trust reads, reflection mutation, feature-flag mutation, shadow access, and Neural rollback had no resource-level authorization. | PORT UNCHANGED | `04a0b35` |
| `c5125ee` | fix: harden the Learning Core sandbox boundary | **Yes** — secret/traversal path checks, credential-shaped env stripping were incomplete. | PORT UNCHANGED | `cf96010` |
| `064eb74` | fix: restore the exact prior skill version on rollback | **Yes** — `rollbackCandidate` did not restore `SkillVersion`'s exact prior state/convenience fields. | PORT UNCHANGED | `52f1cf3` |
| `665212f` | fix: bound Learning Core queue retries and shutdown | **Yes** — job options had no persisted retry/backoff, worker concurrency was unbounded, no job deadline, Queue connections stayed open on shutdown. | PORT WITH RECONCILIATION — conflicted with this session's later `queue.ts`/`learning-worker.ts` comment updates (both were top-of-file doc-comment collisions, no logic conflict); resolved by keeping both the live-verification record and the audit's hardening. | `46d0140` |
| `643f0908` | Merge remote-tracking branch (PR #21 internal) | N/A — branch housekeeping. | OBSOLETE | not ported |
| `f532ba5` | fix: enforce sandbox policy at execution time | **Yes** — policy was checked at proposal time only, not re-verified at execution. | PORT UNCHANGED | `0b3398d` |
| `7f264a2` | fix: accept standard requests in candidate rollback route | **Yes** — route rejected standard request shapes. | PORT UNCHANGED | `1c91454` |
| `444fcddc` | docs: add Learning Core release audit | N/A — documentation. | REJECT — content reviewed in full; every actionable finding is either already resolved by a ported commit above, tracked below under "Remaining defects," or explicitly evaluated (see index-drop finding). Not ported as a standalone file to avoid two competing audit narratives; this document supersedes it. | not ported |
| `61dc1521` | docs: audit PR17 unique capabilities | N/A — documentation. | REJECT — duplicates the independent PR #17 audit already performed and recorded during the PR #20 release process (see the PR #20 final release report; PR #17 disposition: kept open, not merged, unique MCP-gateway/portable-packages/workflow-discovery work deferred). | not ported |
| `0662ff81` | docs: define safe deployment requirements | N/A — documentation. | REJECT — deployment-gate policy narrative; the actual gate (`deploy-production` requiring `verify`+`docker`+`smoke`) is already live on `main` and was independently verified during the PR #20 merge. | not ported |
| `509b840f` | docs: record final release validation evidence | N/A — documentation, validation log for a pre-merge head. | REJECT — superseded by this session's own post-merge validation of the actual merged head (`8ab38e8`), which is authoritative since the pre-merge head was never what shipped. | not ported |
| `49ba0f91` | Merge remote-tracking branch (PR #21 internal) | N/A — branch housekeeping. | OBSOLETE | not ported |
| `980f7dee` | test: cover Learning Core overview tenant isolation | **No** for the test's specific target — `/api/learning/overview` was already fixed independently in this session (commit `fd8329e`, folded into `main` via `8ab38e8`) before this audit commit's test was written against it. The test is still valuable as independent regression coverage of that fix. | PORT WITH RECONCILIATION — ported only the test-file diff; the commit's accompanying docs-file edits (to `LEARNING_CORE_RELEASE_AUDIT.md` and `PR17_UNIQUE_VALUE_AUDIT.md`) were dropped since neither file is being ported (see above). | `3e36e81` |
| `a3956fea` | docs: record final merged-head validation | N/A — documentation, validation log for `c5d9509` (a pre-merge head; the actual merge added one more commit, `fd8329e`, and then the real merge commit `8ab38e8`). | REJECT — superseded for the same reason as `509b840f`. | not ported |

## Separate finding investigated: unrelated index drop

The audit flagged that `prisma/migrations/20260802002232_learning_core_on_neural_engine/migration.sql`
opens with `DROP INDEX "knowledge_objects_sourceType_sourceId_idx"`, unrelated to Learning Core.
Traced the index's history:

- Created as `knowledge_objects_source_type_source_id_idx` in `20260704000000_knowledge_engine_foundation`.
- Renamed to `knowledge_objects_sourceType_sourceId_idx` in `20260706000000_neural_engine_phase_a`.
- Superseded by `20260713010000_knowledge_object_user_scope`, which adds
  `UNIQUE (sourceType, sourceId, userId)` — a composite index whose leading two columns already
  serve any query that the old two-column index served, per Postgres's leading-column index-prefix
  matching.

**Verdict: safe.** This is legitimate redundant-index cleanup (schema.prisma no longer declares
the plain 2-column index, only the 3-column unique constraint), not an accidental regression. Not
restored.

## Remaining defects from the audit — carried into this branch's own workstreams

Everything below was true on `main` before this branch and is **not** resolved by the ported
commits above. These map directly to Workstreams 2–4 and 15 of the current task and are tracked
as separate work in this same branch, not folded into the PR #21 port itself:

1. **Widespread authenticated-but-unscoped reads** remain on `curiosity`, `reflections` (list),
   `learning goals`, `knowledge gaps`, `replay`, `benchmark definitions` (list), `feature flags`
   (list), `skills`/`skill versions`, `scheduler status`, `improvement queue`, `evolution
   timeline`, and `candidates` (list/create). Commit `1c7708c` closed the *mutation*-side bypasses
   for a subset of these; the *read*-side global-list problem across the full route surface is
   this branch's Workstream 2.
2. **Shadow mode does not execute the candidate** — `runShadowSample()` still scores from the
   historical Experience's baseline outcome, not real candidate execution. Workstream 3.
3. **Candidate apply is not atomic** — canonical mutation still happens before final
   candidate/audit persistence in `applyLearningCandidate()`. Workstream 4.
4. **Rollback is exact only for `SkillVersion`** (fixed by `064eb74`) — procedure, contradiction,
   prompt-change, and tool-policy-change candidate types have no defined exact inverse. Workstream 4.
5. **UI honesty gaps**: misleading "Experiments" label (actually Experience Replay), `Settings`
   tab still `NotYetBuiltView`, several views swallow fetch/mutation failures into a
   misleadingly-empty state, `FeatureFlag` has no activation/expiry fields, global feature-flag
   default in the UI fails closed with no admin authority path. Workstream 15.

## Tests ported

`tests/release-audit/governance-regressions.test.ts`, `learning-api-authorization.test.ts`,
`sandbox-security.test.ts`, `rollback-restoration.test.ts`, `queue-regressions.test.ts` — all
present on this branch via the ported commits, plus the overview-tenant-isolation addition from
`980f7dee`. Full suite run recorded once Workstreams 2–4 land (a subset of these tests will need
extension as the remaining route-scoping work lands, since they currently only cover the routes
`1c7708c` touched).
