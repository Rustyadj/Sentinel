# Governed Evolutionary Self-Improvement, built on the Learning Core

Sentinel's Learning Core (`docs/LEARNING_CORE_ON_NEURAL_ENGINE.md`) is the
canonical foundation for self-improvement: `Experience → Outcome →
Evaluation → LearningCandidate`, risk-classified and applied/rolled back via
`learning-service.ts`, with per-domain `AgentCompetency` trust, `FeatureFlag`
canary rollout, and a real Neural Lens graph UI. **This pass does not
replace or duplicate any of that — it extends it** with the pieces that
genuinely didn't exist: an evolutionary archive around `LearningCandidate`,
a production-failure → permanent-eval compiler, sandboxed adversarial
self-play, an independent Guardian monitor, governed memory forgetting, and
versioned principle distillation.

## Reconciliation — what's reused vs. genuinely new

| Concept | Backing model/service | Status |
|---|---|---|
| Champion/challenger, lineage, novelty, fitness | `LearningCandidate` | Existing — extended with `parentCandidateId`, `rootCandidateId`, `generation`, `lineageDepth`, `mutationType`, `createdFrom`, `noveltyScore`, `fitnessScore`, `fitnessVector`, `survivalStatus`, `championGroup`, `evaluationCount`, `generatorModel`, `evaluatorModel` |
| Capability-specific trust | `AgentCompetency` / `TrustEvent` | Existing, unchanged — already per-domain with independent Tier-3 hard-stops (`trust.ts`). Only genuinely missing piece was decay — added as `decayStaleTrust()` |
| Canary rollout | `FeatureFlag` | Existing, unchanged — `rolloutPercentage`/`rolloutStep`/`maxRollout`/`rollbackThresholds`/`monitoringWindow` already implement progressive canary; nothing to add |
| Exact rollback | `learning-service.ts` (`rollbackCandidate`, `LearningArtifactVersion` checksums) | Existing, unchanged — already byte-exact for `prompt_change`/`tool_policy_change`. Extended (not modified) via `rollbackCandidateWithRegression()`, a wrapper that also compiles the regression into a permanent `EvalCase` |
| Safety tiers | `policy-service.ts` (`classifyRiskLevel`) | Existing, unchanged — low/medium/high already maps onto Tier 1/2/3. Guardian derives its tier from this exact classification rather than re-implementing risk logic |
| Canonical graph | `KnowledgeObject` / `KnowledgeEdge` | Existing, unchanged — new node types (`EvalCase`, `EvalSuite`, `GuardianDecision`, `Principle`, `AdversarialRun`) and edge types (`descended_from`, `competes_with`, `evaluated_by`, `failed_on`, `passed`, `promoted_to`, `distilled_from`, `protected_by`, `attacked_by`) added to `src/lib/knowledge/types.ts`; `rolled_back_to`/`supports`/`contradicts` already existed and are reused as-is. No second graph. |
| Scheduler boundary | `scheduler-service.ts` (`runRecordedScheduledJob`) | Existing, unchanged — memory-decay and trust-decay sweeps reuse it exactly like the existing degradation sweep |

## New models (all additive — no existing column renamed, retyped, or dropped)

`EvalSuite`, `EvalCase`, `EvalRun`, `EvalResult`, `GuardianDecision`,
`AdversarialRun`, `Principle`, `PrincipleVersion`, `ExperimentManifest`.
Every `agentId`/`actor` field is a plain `String`, no FK — matching the
existing Neural Engine convention. See `prisma/schema.prisma` (search
"Governed Evolutionary Self-Improvement") for exact fields.

`Memory` gained governance metadata (`valueScore`, `harmScore`,
`stalenessScore`, `provenanceTrust`, `transferability`, `retrievalCost`,
`poisonRisk`, `contradictionCount`, `confirmationCount`, `lastUsefulAt`,
`lastValidatedAt`, `state`) and `CuriosityEvent` gained the seven
uncertainty dimensions plus EV/question-quality fields. `LearningSettings`
gained budget fields (`dailyModelBudgetUsd`, `dailyTokenBudget`,
`dailyExperimentBudget`, `maxConcurrentExperiments`,
`maxCandidatesPerOpportunity`, `maxAdversarialRunsPerDay`,
`maxReplaySamples`).

Two migrations: `20260813052713_learning_core_evolution` (everything above
except curiosity) and `20260813053910_curiosity_uncertainty_engine`. Both
tested against a fresh Postgres, the current `main`-shaped dev database, and
a database pre-populated with representative pre-migration rows (old-shape
`LearningCandidate`/`Memory`/`LearningSettings` inserted before the
migration, verified intact with correctly-backfilled defaults after).

## Services (`src/lib/learning/*`)

- **`evolution.ts`** — lineage-aware proposal (`proposeEvolutionCandidate`,
  wraps the existing `proposeCandidate` rather than reimplementing risk
  classification), multi-objective fitness (`computeFitnessScore`,
  configurable weights, hard guardrails via `evaluateGuardrails` — a fitness
  win never overrides a guardrail regression), novelty search
  (`computeNoveltyScore`, structural key-set/value heuristic over sibling
  payloads), champion/challenger promotion (`promoteChallenger` — atomic,
  advisory-locked, demotes rather than deletes the previous champion),
  archive queries with diversity preservation (`getEvolutionArchive`),
  lineage traversal (`getCandidateLineage`).
- **`eval-compiler.ts`** — `compileEvalCase` (general entry point: redacts,
  dedupes by content hash, groups into a suite) plus concrete wrappers tied
  to signals that already exist in this codebase:
  `compileEvalCaseFromUserCorrection`, `compileEvalCaseFromRejectedCandidate`,
  `rollbackCandidateWithRegression`, `compileEvalCaseFromAdversarialBreach`.
  `runEvalSuite` grades a candidate against a suite; clarification-policy
  candidates (modeled as `procedure`-typed `LearningCandidate`s carrying a
  `strategy` field — see below) are graded by replaying the case's stored
  ambiguity factors through the *real* `computeCuriosityScore` from
  `curiosity.ts`, not a stub.
- **`guardian.ts`** — `evaluateGuardian` derives OBSERVE/REVIEW/BLOCK from
  the same `classifyRiskLevel` the rest of the codebase already trusts,
  persists structured `GuardianDecision` evidence (no hidden reasoning),
  hard-blocks a narrow set of deterministic high-confidence patterns
  (prompt-hierarchy override, credential exfiltration, path traversal, fake
  approval markers), and refuses self-elevation unconditionally.
  `resolveGuardianReview` requires a real, different human user.
- **`adversarial.ts`** — Attacker/Defender/Judge/Guardian self-play.
  `generateAdversarialBattery` covers all sixteen listed attack categories;
  `judgeAttack` is a deterministic judge reusing the *same* production
  detectors (Guardian's hard-block patterns, memory governance's injection
  signature, the sandbox's path/command patterns) rather than a second copy.
  Every attack is judged, never executed against a live tool, a real
  sandbox `execute()`, or canonical state. A breach compiles a permanent
  `EvalCase`.
- **`memory-governance.ts`** — configurable/versioned net-value formula
  (`computeMemoryNetValue`, `MEMORY_VALUE_POLICY_VERSION`), the eight-state
  machine, quarantine/validate/forget transitions, and
  `runMemoryDecaySweep`. The retrieval boundary itself
  (`src/lib/knowledge/retrieval.ts`) now excludes quarantined/forgotten
  memories via `excludeFromRetrieval()` — governance is enforced at the real
  query, not just documented as a state.
- **`principles.ts`** — `distillPrinciple` enforces evidence-count,
  confidence, and no-unresolved-contradiction gates before creating
  anything; a second call for the same statement reinforces rather than
  duplicates. `evolvePrinciple` always creates a new `PrincipleVersion` and
  bumps `currentVersion` — never an in-place overwrite.
- **`retrieval-hooks.ts`** — one function per lifecycle stage
  (`before_plan`, `before_tool`, `before_external_action`,
  `before_deployment`, `before_code_change`, `before_response`,
  `after_failure`, `after_success`), each a narrow, real query for one
  memory/principle/policy class, not a dump of everything.
- **`curiosity-ev.ts`** — extends (does not replace) `curiosity.ts`. Folds
  the seven uncertainty dimensions into the existing scoring model,
  computes `EV(clarification)` vs. `cost(interruption)` as a real number,
  and scores question quality independently of whether a question gets
  asked — three independent gates, any of which can suppress asking.
- **`experiment-orchestrator.ts`** — `runExperiment` walks static
  validation → sandbox → eval suites → adversarial → replay → shadow →
  fitness → Guardian → promotion decision, persisting one
  `ExperimentManifest` per invocation. Stops immediately (recording
  `stopReason`) on budget exhaustion, a critical eval/adversarial failure,
  no measurable fitness improvement, or a Guardian block/hold.
- **`budgets.ts`** — `checkLearningBudget` resolves
  organization → workspace → agent limits and reports today's usage against
  them; the orchestrator's first stage is this check.
- **`weight-adaptation.ts`** — the `WeightAdaptationProvider` interface
  boundary, `WEIGHT_ADAPTATION_ENABLED = false`, both entry points throw
  unconditionally. No code path in this repository reaches model-weight
  training.

## Clarification-policy candidates — how they're modeled

The spec's acceptance scenario needs "multiple clarification-policy
candidates" (lower ambiguity threshold, add intent verification, add
contradiction detection, improve question-selection policy). Rather than
adding a new `LearningCandidateType` (which would require re-auditing
`policy-service.ts`'s risk classification and `learning-service.ts`'s
`applyLearningCandidate` switch — both deliberately narrow, heavily-audited
surfaces per `docs/LEARNING_CORE_ON_NEURAL_ENGINE.md`'s risk-policy audit),
these are modeled as `type: "procedure"` candidates whose `proposedPayload`
carries a `strategy` field (`lower_ambiguity_threshold`,
`intent_verification`, `contradiction_detection`,
`question_selection_policy`) plus strategy-specific parameters. `procedure`
is already a handled type in `applyLearningCandidate` (delegates to
`promoteFromPayload("procedure", ...)` in `skill-service.ts`), so nothing in
that audited switch changed.

**Known limitation:** committing a promoted clarification-policy champion's
threshold into production `LearningSettings.curiosityThreshold` is a manual
human action in this pass, not auto-applied — extending
`applyLearningCandidate`'s switch for a new canonical effect is real,
scoped follow-up work, not something to bolt on without the same review
rigor the rest of that function already has.

## Known gaps this doesn't try to solve yet

- **Production call-site wiring for every `EvalCase` source is not
  exhaustive.** `compileEvalCase` is the general entry point and four
  concrete wrappers are built and tested (user correction, rejected
  candidate, rollback, adversarial breach). Wiring the remaining sources the
  spec lists (thumbs-down, failed tool call, failed workflow, failed
  deployment, unauthorized action, rejected approval, malformed code
  change, failing test, delegation failure) into their actual chat/tool/CI
  call sites is real, separate work — each requires locating and safely
  instrumenting an existing code path per source.
- **Range Console's dedicated "AI Security" cluster is not built.** The
  adversarial self-play engine, its models, and its API exist and are
  tested; a Range Console UI panel surfacing them (vs. the Learning Core's
  own Adversarial tab, which does exist) was not added this pass.
- **Model diversity is schema-level only.** `generatorModel`/
  `evaluatorModel` fields exist on `LearningCandidate`; no orchestration
  layer actually calls out to multiple different model providers for
  generation vs. evaluation yet — that requires real multi-provider
  plumbing beyond this pass's scope.
- **E2E (Playwright) verification of the new UI could not be executed in
  this sandbox** — the pre-installed headless Chromium's outbound
  connections to the local dev server are reset by this environment's
  network policy (a sandbox constraint, not an application defect); the
  route was verified instead via `curl` (200 from `/api/health` and the
  Next.js production build compiling every new route, including `/learning`
  and all new `/api/learning/*` endpoints) and via the Vitest integration
  suite. Re-running `npm run test:e2e` in a normal CI environment should
  work unmodified.
- **API-route tenant-authorization parity is partial.** The new routes all
  require authentication (`requireUser`) and use `requireLearning*Access`
  where a resource resolves to a workspace/candidate; a few list endpoints
  (e.g. `GET /api/learning/adversarial`, `GET /api/learning/guardian`)
  accept an optional `workspaceId`/`candidateId` filter without the full
  accessible-scope join every existing Learning Core list route uses. Real
  gap, not a design choice — bringing these to the same tenant-isolation
  rigor as `getAccessibleLearningScope` is follow-up work.

## Testing

`tests/learning/*.test.ts` — 64 new integration/unit tests (real Postgres,
following the existing `tests/neural-engine/db-setup.ts` fixture
convention): lineage preservation, champion-never-disappears,
rejected-candidates-stay-archived, novelty scoring, guardrail-blocks-fitness-
win; eval-case dedup, redaction, rollback-creates-regression,
clarification grading; Guardian's three tiers and self-elevation refusal;
adversarial detection, sandbox-never-violated, discovered-attack-becomes-
eval-case, memory quarantine; memory decay/quarantine/contradiction/
forgetting-excluded-from-retrieval; principle distillation gating and
version history; step-specific retrieval and forgotten-memory exclusion at
the real `retrieveContext()` boundary; orchestrator stop conditions, budget
enforcement, trust decay, weight-adaptation refusal. All 321 tests in the
full suite (existing + new) pass; `tsc --noEmit`, `eslint`, and
`next build` are clean.
