# Learning Core, built on the Neural Engine

Sentinel already has a working self-improvement system — the **Neural
Engine** (`src/lib/neural-engine/*`): `Experience → Outcome → Evaluation →
LearningCandidate`, gated by `classifyRiskLevel()`, applied/rolled back via
`learning-service.ts`, with per-domain `AgentCompetency` scoring and a real
Neural Lens graph UI. It predates this document and is the canonical
foundation. **Learning Core does not replace or duplicate it — it extends
it.** A prior attempt built a parallel system with its own `Skill` and
`Hypothesis` models; it collided with Neural Engine's own `Skill` model and
was scrapped specifically because of that. This document exists so it
doesn't happen twice.

## Reconciliation — what's reused vs. genuinely new

Before adding a model, check this table. If a spec calls for something and
this table maps it to an existing model, extend that model — don't fork it.

| Concept | Backing model | Status |
|---|---|---|
| Execution trace | `Experience` | Existing — extended with `underlyingGoal`, `constraints`, `successCriteria`, `parentTraceId` |
| Hypothesis / Improvement Proposal / Experiment | `LearningCandidate` | Existing — extended with `knowledgeGapId`, `problem`, `rootCause`, `rollbackCriteria`, `testPlan`, `rolloutPlan`, `approvalRequestId`, `shadowSampleSize`, `shadowConfidence` |
| Benchmark scoring (single result) | `Evaluation` | Existing, unchanged — per-Experience multi-metric score |
| Benchmark *suites* (dataset-driven, independent of a live Experience) | `BenchmarkDefinition` / `BenchmarkResult` | New — genuine gap, `Evaluation` has no dataset/threshold concept |
| Agent trust (current state) | `AgentCompetency` | Existing, unchanged — already per-domain, not a flat number |
| Agent trust (event history) | `TrustEvent` | New — `AgentCompetency` has no log of the deltas that produced its current score |
| Skill (current version) | `Skill` | Existing — extended with `inputSchema`, `outputSchema`, `permissions`, `tests` |
| Skill (version history) | `SkillVersion` | New — `Skill.version` was a bare int with no history table |
| Generic approval flow | `ApprovalRequest` / `AuditLog` | Existing, unchanged — but Neural Engine's own review/rollback flow never used either. Now linked via `LearningCandidate.approvalRequestId`; `learning-service.ts` writes `AuditLog` rows for review/apply/rollback |
| Curiosity, Intent Discovery, Reflection, Preference Evidence, Knowledge Gaps, Learning Goals, Feature Flags, sandboxed execution, scheduler | — | All genuinely absent — confirmed by grep across `main` before writing any schema, not assumed |

## New models (all additive — no existing column renamed, retyped, or dropped)

`LearningEvent`, `CuriosityEvent`, `Reflection`, `UserPreferenceEvidence`,
`GoalAlignmentCheck`, `KnowledgeGap`, `LearningGoal`, `ExperimentRun`,
`BenchmarkDefinition`, `BenchmarkResult`, `TrustEvent`, `FeatureFlag`,
`SkillVersion`, `ExperienceReplayRun`, `LearningArtifactVersion`,
`ScheduledJobRun`. See `prisma/schema.prisma` (search "Learning Core") for
exact fields — this doc explains *why* each exists, the schema is the
source of truth for *what*.

`agentId` fields on every new model are deliberately plain `String`, no FK
relation — matching the existing `Experience`/`LearningCandidate`
convention (Neural Engine never hard-relates to `Agent` either).

No model uses a compound-unique constraint on a nullable column (e.g.
`[agentId, topic]` where `agentId` is optional) — Postgres treats every
`NULL` as distinct from every other `NULL`, so such a constraint can't
actually enforce uniqueness or be used in a `findUnique`/`upsert` lookup.
Dedup on nullable-keyed models (`KnowledgeGap`, etc.) happens at the
service layer via `findFirst` + conditional update instead.

## Known gaps this doesn't try to solve yet

- **No scheduler infra exists.** No cron, no queue, no worker process
  anywhere in this repo. `ScheduledJobRun` tracks *executions*, it doesn't
  *trigger* them — Phase A adds an authenticated API route an external
  cron can hit, not an in-process timer pretending to be a job queue.
- **Redis is provisioned but entirely unused** beyond a health check (zero
  callers of get/set/del/keys as of this writing) — available for a real
  queue (BullMQ) later, not used yet.
- **`ApprovalRequest.workspaceId` is required**, but `LearningCandidate`
  only has a `workspaceId` transitively through its optional `Experience`
  relation. Whatever creates an `ApprovalRequest` from a `LearningCandidate`
  needs a fallback for candidates with no resolvable workspace — not
  solved by the schema, a build-time decision for whoever wires that path.
- **Sandbox execution is not implemented in Phase A.** The schema has
  nowhere it *needs* to be for foundation work; it's a Phase D/G concern
  (generated skill code, experiment candidates) when that code gets built.

## Local dev database note

This branch's schema conflicts with another in-flight branch's schema at
the `Agent` model itself (that branch splits `Agent` into
`Agent`/`AgentConfiguration`; this one — matching `main` — keeps `model`/
`systemPrompt`/`toolPermissions` directly on `Agent`). They cannot share
one local Postgres database. This branch was developed against a separate
database (`hermesos_learning_core` alongside the existing `hermesos`) to
avoid a destructive reset of the other branch's local data. Whoever merges
first should reconcile the other branch onto whichever `Agent` shape wins.

## Phases

Schema for all phases below is already migrated (one migration,
`20260802002232_learning_core_on_neural_engine`) per the "finalize the
model, build incrementally" choice — later phases build against an
already-stable schema instead of evolving it per phase. **Only Phase A is
built in this pass.** B–G are scoped here so schema fields aren't
speculative, but their services/APIs/UI don't exist yet.

- **Phase A — Foundation** (this pass): module registration, `LearningEvent`
  emission + redaction, `AuditLog` integration into `learning-service.ts`,
  `ApprovalRequest` linkage, minimal scheduler route for
  `monitorAndAutoRollback`/`runDegradationSweep`, basic Overview UI, chat
  instrumentation.
- **Phase B — Curiosity & Reflection**: `CuriosityEvent` scoring and
  question policy, Intent Discovery (`Experience.underlyingGoal` etc.),
  `Reflection` engine, `UserPreferenceEvidence` confidence recalculation.
- **Phase C — Gaps & Proposals**: `KnowledgeGap` detection/merging,
  `LearningGoal`, wiring `LearningCandidate.knowledgeGapId`.
- **Phase D — Experiments & Benchmarks**: sandbox abstraction,
  `ExperimentRun`, `BenchmarkDefinition`/`BenchmarkResult`.
- **Phase E — Shadow Mode**: `ExperimentRun.variant = "shadow"` execution
  path with no-side-effect enforcement, `shadowSampleSize`/
  `shadowConfidence` promotion gating.
- **Phase F — Trust, Rollout, Rollback**: `TrustEvent` emission,
  `FeatureFlag` rollout, Evolution Timeline UI.
- **Phase G — Skills & Replay**: `SkillVersion` history, sandboxed skill
  tests, `ExperienceReplayRun` scheduler job, `LearningArtifactVersion`
  history for prompts/heuristics/routing rules.
