# Learning Core

The intelligence center every Sentinel agent reports into: recognizing
uncertainty, learning preferences, closing knowledge gaps, and turning
experience into measured, reversible improvement. Not a settings page —
every agent (Lisa, Coding, Marketing, Research, Cybersecurity, Builder,
Organization, future agents) contributes to and draws from it.

Split into two ownership halves, built in parallel:

| Half | Owner | Services | Sections |
|---|---|---|---|
| Observation | Claude | LearningService (spine), CuriosityService, ReflectionService, ReplayService, KnowledgeGapService, PreferenceService, GoalAlignmentService | Overview, Curiosity, Knowledge Gaps, Reflection, Experience Replay, Metrics |
| Improvement & Governance | Codex | HypothesisService, ExperimentService, BenchmarkService, TrustService, SkillService, EvolutionService, FeatureFlagService | Hypotheses, Experiments, Benchmarks, Skill Library, Improvement Queue, Trust Center, Feature Flags, Evolution Timeline |

Schema for both halves lives together in `prisma/schema.prisma` (search
"Learning Core") so there's one migration history, but each half only
edits its own `src/lib/learning-core/*.ts` service files, its own
`src/app/api/learning-core/*` routes, and its own view components under
`src/modules/learning-core/components/`. The only shared file either
half touches after Phase 0 is `LearningCorePage.tsx` (routing a new
section in) and the `status` field in `types.ts`'s `LEARNING_CORE_SECTIONS`.

Reference implementation for the pattern: `src/lib/learning-core/curiosity.ts`
+ `graph.ts`, `src/app/api/learning-core/curiosity/`, and
`src/modules/learning-core/components/CuriosityView.tsx`.

## Curiosity scoring (live)

`computeCuriosityScore()` in `curiosity.ts` — weighted sum of factors
(confidence gap, missing info, contradictory memory, tool failures,
unknown terminology, unusual request, missing goal, conflicting
constraints, unexpected outcome), clamped to `[0, 1]`. At `CURIOSITY_THRESHOLD`
(0.6) the event's `question` is persisted instead of dropped — below
threshold the agent should still guess, not interrupt.

## Trust score

`AgentTrustScore.score` starts at 50 (0–100 scale) and moves only via
`TrustEvent` rows — never edited directly. Each event carries a `delta`
and increments the matching counter on `AgentTrustScore`:

| Category | Delta | Counter incremented |
|---|---|---|
| `benchmark_win` (experiment beat baseline, promoted) | +3 | `benchmarkWins` |
| `approved_improvement` (Level 2/3 change approved → production) | +5 | `approvedImprovements` |
| `accuracy` (task/answer independently confirmed correct) | +1 | — (folds into `accuracy` ratio below) |
| `failed_experiment` (experiment discarded, never promoted) | −1 | `failedExperiments` |
| `user_override` (user manually reverted/corrected agent output) | −2 | `overrides` |
| `hallucination` (confirmed factual fabrication) | −4 | `hallucinations` |
| `rollback` (a promoted change had to be rolled back) | −8 | `rollbackCount` |
| `unsafe_event` (violated a Level 3 boundary or safety constraint) | −15 | `unsafeEvents` |

`score = clamp(score + delta, 0, 100)` after each event.
`accuracy = benchmarkWins / (benchmarkWins + failedExperiments)`,
recomputed whenever either counter changes (0 when both are 0).

Failed experiments are penalized lightly on purpose — a healthy
Learning Core produces far more discarded experiments than promoted
ones, and punishing that hard would suppress the hypothesis pipeline
this whole system depends on. Rollbacks and unsafe events are
penalized heavily because they mean something already reached
production and had to be undone or was actively dangerous.

Trust score gates autonomy, but **never bypasses Level 3** regardless
of score:

| Score | Level 1 | Level 2 | Level 3 |
|---|---|---|---|
| ≥ 80 | auto-deploy | auto-promote if shadow metrics clear the significance bar, still logged | always requires human approval |
| 40–79 | auto-deploy | requires human approval | always requires human approval |
| < 40 | requires human approval | requires human approval | always requires human approval |

## Approval levels (Hypothesis / Experiment / Skill)

Computed once, deterministically, at creation time — stored in
`Hypothesis.approvalLevel` / `Experiment.approvalLevel` (int columns,
default 2) rather than derived at query time, so the Improvement Queue
can filter/sort without recomputing. `Experiment.approvalLevel`
inherits its parent `Hypothesis.approvalLevel` at creation; an
experiment created without a hypothesis defaults to 2 (never assume
Level 1 for untraced work). `Skill.approvalLevel` is set the same way
by whatever created the skill (manual, or `Experiment` → `produces` →
`Skill`).

Classification takes the **max** of everything that applies — never
downgrade, and a single Level-3 signal makes the whole hypothesis
Level 3 no matter what else is true:

- **Level 1 — auto-deploy.** `risk == "low"` AND every entry in
  `affectedSystems` is one of: `prompt`, `formatting`, `memory_tags`,
  `retrieval_weights`, `question_timing`.
- **Level 2 — requires approval after successful testing.**
  `risk == "medium"`, OR `affectedSystems` intersects: `workflow`,
  `tool`, `planning`, `memory_schema`, `agent_collaboration`.
- **Level 3 — always requires approval, no exceptions.**
  `risk == "high"`, OR `affectedSystems` intersects: `security`,
  `credentials`, `production_database`, `financial_system`,
  `permissions`, `model_provider`, `core_architecture`.

```
function classify(risk, affectedSystems):
  level = risk == "high" ? 3 : risk == "medium" ? 2 : 1
  for system in affectedSystems:
    level = max(level, LEVEL_BY_SYSTEM[system] ?? 2)  // unknown system => never assume Level 1
  return level
```

Unrecognized `affectedSystems` values default their contribution to
Level 2, not Level 1 — an unclassified system is a reason to ask a
human, not a reason to skip asking.

## State machines

```
Hypothesis:  draft → testing → validated | rejected
Experiment:  shadow → running → completed → promoted | discarded
Skill:       proposed → testing → approved → installed | deprecated
```

Every transition writes an `EvolutionEvent` (`stage` matches the new
state, `relatedType`/`relatedId` point at the row).

## Improvement Queue

Rows Codex's `improvement-queue` page must surface — anything crossed
into "ready for a human," regardless of type:

- `Hypothesis` where `status == "testing"` AND `approvalLevel >= 2` AND
  it has no `Experiment` yet in `promoted`/`discarded` status
- `Experiment` where `status == "completed"` AND `approvalLevel >= 2`
  AND not yet `promoted`/`discarded`
- `Skill` where `status == "testing"` AND `approvalLevel >= 2`

## Promotion rules

The action that makes a tested change live:

- **Level 1**: automatic the moment shadow/testing metrics clear the
  baseline — no human click, still writes `EvolutionEvent`.
- **Level 2**: surfaces in the Improvement Queue; requires one human
  approval action; auto-rollback if post-promotion benchmarks regress
  past threshold within 24h of promotion.
- **Level 3**: requires explicit human approval via API/UI, never
  triggerable by any agent action, and has **no** auto-rollback
  exception — reverting a Level 3 change is always a manual act.

## Not yet specified

Everything else in the original "Sentinel Learning Core & Autonomous
Improvement Engine" spec (Skill Marketplace ratings, self tool
generation, shadow-mode statistical significance test, background job
schedule, explainability UI) is intentionally left open — build the
sections above first against these concrete rules, and raise anything
that needs a decision rather than guessing at numbers.
