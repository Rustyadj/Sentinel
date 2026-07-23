# Sentinel Neural Engine — Phase A: Conflicts & Reuse Audit

Written before any Phase A code, per the delivery instructions. Findings are
from `main` at commit `c1f4e57` (branch `feature/sentinel-neural-engine`
forked from there).

## Headline finding

`main` already contains a working, real "Layer 1" knowledge-graph
implementation — **not a toy**, and not what the plan calls a "single giant
graph table." It predates this task and must be reused, not duplicated.

## What already exists (reuse, do not rebuild)

**Schema** (`prisma/schema.prisma`):
- `KnowledgeObject` — a graph **index/pointer** row per entity. Content stays
  in typed tables (`ObsidianNote`, `Decision`, `Artifact`, `Entity`, `Memory`,
  `Agent`, `ChatRoom`); `KnowledgeObject.sourceType`/`sourceId` point back to
  the canonical row. This is the "materialized index over relational tables"
  pattern, not the collapsed-node-type pattern the plan warns against.
- `KnowledgeEdge` — typed relationship join table (`references`,
  `belongs_to`, `created_by`, `assigned_to`, `generated_by`, `depends_on`,
  `remembers`, `related_to`, `supersedes`), weighted, with `metadata` Json.
- `Decision` — first-class table with `status`, `rationale`, `alternatives`,
  `approvalHistory`, and self-referential `supersedesDecisionId` (an existing,
  narrower precursor to Layer 3 temporal supersession).
- `Artifact`, `Entity` — first-class tables (already distinct from notes/
  memories, consistent with "do not collapse object types").
- `KnowledgeEvent` — append-only event log (`object_created`,
  `object_updated`, `edge_created`, `candidate_proposed`,
  `candidate_accepted`, `candidate_rejected`). This is the seed of Layer 3's
  `sourceEventId` and Layer 6's live-event stream.

**Services** (`src/lib/knowledge/`):
- `objects.ts`, `edges.ts` — CRUD + `bridge*()` functions that project
  `Memory`/`Agent`/`ChatRoom` rows into `KnowledgeNode` without writing (used
  for read-time graph assembly rather than eager duplication).
- `events.ts` — `emitEvent()` / `getRecentEvents()`.
- `decisions.ts` — Decision CRUD with approval/supersession.
- `extraction.ts` + `POST /api/knowledge/candidates` — chat → candidate
  (`memory | decision | task | entity | link`) → **human accept/reject**
  → `KnowledgeObject`/`Decision` write. This is a real, working precursor to
  the plan's "human approval for consequential changes" — for
  extraction-sourced knowledge specifically, not yet for agent-experience
  learning.
- `retrieval.ts` — scope-ordered retrieval (`session → project → workspace →
  organization → user → global`) with enforced project isolation (verified by
  reading the `WHERE` clauses: project-scoped rows never leak across
  `projectId`). This is a real, working precursor to Layer 6's retrieval
  planner, minus multi-factor ranking (recency/confidence/competency/prior
  outcome weighting).
- `graph.ts`, `wikilinks.ts`, `templates.ts` — graph assembly, wiki-link
  backlinks, note templates.

**Routes**: `/api/knowledge/{objects,edges,events,search,extract,candidates}`,
`/api/graph`.

## Gaps against this plan (what Phase A actually adds)

Confirmed absent from schema and `src/lib/knowledge/*` — these are net-new,
not reimplementations:

- **Experience Graph** (Layer 2): no `Experience`, `Outcome`, `Evaluation`,
  or `LearningCandidate` models. The existing `candidates` pipeline is
  extraction-from-chat, not outcome-from-agent-task. Different concern,
  same approval-gate spirit — Phase A's `LearningCandidate` is deliberately
  a distinct model, not a rename of `ExtractionCandidate`.
- **Agent State Graph** (Layer 4): no `AgentKnowledgeProfile`,
  `AgentCompetency`, or `AgentKnowledgeWeight`. `Agent.memoryScope` is the
  only existing scoping primitive.
- **Temporal Graph** (Layer 3): no `validFrom`/`validTo`/`version`/
  `changeReason`/`changedBy` on `KnowledgeObject` or `KnowledgeEdge`.
  `Decision.supersedesDecisionId` is the only precedent, and it's a plain FK
  with no validity window.
- **Contradiction handling**: no `Contradiction`/`Claim`/`Evidence` models.
- **Skill/Procedure/Policy**: no models. `Agent.toolPermissions` is the
  closest existing primitive (a flat string array, not a governed object).
- **Organization/Department/Workspace**: `KnowledgeObject.workspaceId` /
  `organizationId` exist only as untyped scope tags (nullable strings with
  no backing table) — there is no `Organization` or `Department` row to
  point at yet, and `Workspace` is a route concept
  (`/workspaces/{cybersecurity,...}`) in the app shell, not a domain table.
- **pgvector**: the pre-existing Prisma/schema mismatch is resolved by
  `20260723010721_reconcile_memory_embedding_pgvector`. The database remains
  `vector(1536)` and Prisma now declares
  `Memory.embedding Unsupported("vector(1536)")`; the reconciliation migration
  is intentionally a no-op, so no vector data or indexes are rewritten.
  Retrieval ranking remains lexical until a future embedding pipeline is added.
- **Retrieval planner** (Layer 6): `retrieval.ts` is real but single-factor
  (scope + pin + importance + recency). Multi-factor ranking (graph
  proximity, agent competency, prior success/failure, provenance quality) is
  genuinely new — deferred to Phase C per the phased delivery plan.
- **No test framework** in `package.json` (no vitest/jest). Phase A adds
  vitest — the lightest fit for a Prisma/TS service layer, no framework churn
  for the Next.js app itself.

## Decision: how Phase A integrates

1. **Reuse, don't fork.** New Phase A code lives in `src/lib/neural-engine/`
   and imports from `src/lib/knowledge/*` where overlap exists — e.g.
   `neural-engine/knowledge-service.ts` is a thin facade over the existing
   objects/edges/events services plus the net-new pieces, not a parallel
   implementation.
2. **Additive schema only.** New models are added; existing models gain only
   new *nullable* columns (temporal fields on `KnowledgeObject`,
   `KnowledgeEdge`, `Decision`). No column is renamed, retyped, or dropped.
   Verified non-breaking against every call site in `src/lib/knowledge/*` and
   `src/app/api/knowledge/*` (they construct explicit field lists; extra
   nullable columns don't require touching them).
3. **`KnowledgeEvent.type` stays a plain string column** (no DB enum) — Phase
   A extends the *TypeScript* union in `src/lib/knowledge/types.ts`
   additively with new event names (`experience.started`,
   `learning.proposed`, etc.) rather than introducing a second event table.
4. **Organization/Department/Workspace become real tables** in Phase A
   (currently just scope-tag strings), since Agent State Graph and policy
   enforcement need a real row to attach permissions/ownership to. `Project`
   is left as-is (it already fills the "project" role well).
5. **Retrieval planner is a stub in Phase A**, matching the phased delivery
   plan (`retrieval-planner.ts` exists with real types and a documented
   `NotImplementedYet` marker, not fake ranking logic).
