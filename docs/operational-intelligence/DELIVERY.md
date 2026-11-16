# Temporal operational intelligence — delivery report

PR: [Rustyadj/Sentinel#65](https://github.com/Rustyadj/Sentinel/pull/65) (draft).

Status: implementation on `codex/temporal-operational-intelligence`, based on production/default `main` at `7b6e2e5`. Review and controlled production rollout are required. No merge, deployment, infrastructure remediation, or live-agent task was performed.

## What existed and what was reused

The pre-change, file-referenced capability matrix, production surface evidence, open-PR overlap and superseded-component inventory are in [AUDIT.md](AUDIT.md). This implementation reuses the canonical KnowledgeObject/KnowledgeEdge graph, KnowledgeEvent ledger, Memory admission and governance, provider-versioned MemoryEmbedding vectors, memory usage accounting, workspace RBAC, OAuth MCP memory tool, existing 2D graph and rotating Neural Lens. No second graph, memory database, memory API, dashboard or execution engine was created. Working legacy graph consumers remain in place.

## What was implemented

| Delivery order | Implementation | Main files |
| --- | --- | --- |
| 1. Ingestion and historical retrieval | Validated source envelopes; workspace/source/event identity; atomic serializable ingestion with bounded conflict retry; stable canonical entity IDs; source identity preservation; explicit reuse of existing operational nodes across sources; immutable observations and current projections; late backfill protection; governed episodic admission; semantic + lexical + graph ranking; event-time ordering, confirmed causes, responders, successful/unsuccessful actions, resolution duration, evidence, uncertainty | `src/lib/knowledge/operational-types.ts`, `operational-ingestion.ts`, `operational-retrieval.ts`; existing `retrieval.ts`, `src/lib/neural-engine/ingestion-gate.ts`, `memory-ingestion.ts` |
| 2. Dependency discovery | Deduplicated co-failures, one-to-one temporal matches, independent windows, baseline-rate/lift suppression, directional sequences, chronological held-out evaluation; persisted proposals and evidence; reviewed confirmation/rejection with immutable audit events | `src/lib/knowledge/operational-analysis.ts`, `operational-graph.ts` |
| 3. Blast radius | Bounded reverse traversal of explicit `depends_on` relationships; validated historical directional correlations; fresh health observations; confirmed/predicted/unknown impact annotations and explanations; conservative confidence; rejected correlations and quarantined supporting incidents excluded | Same analysis/graph files; existing graph renderers |
| 4. Graph lenses | Incident, dependency, blast-radius, team, alert, onboarding controls over both existing canvases; workspace selection; current health premise; evidence inspection; relationship timelines; source import/backfill and proposal review; demo data never supplies operational results; scoped failures remain empty | `src/modules/graph/components/OperationalLenses.tsx`, existing GraphSurface/GraphCanvas/GraphNodeInspector, NeuralLens/fromApiGraph/GlobeScene/categories/types/GraphMinimap |
| 5. Team and alert analytics | Counts from recorded classifications; evidence-linked tuning review recommendations; recorded capacity intervals and event-time ownership for normalized trends; unavailable capacity remains unknown; no team-size or incident-statistics constants | `operational-graph.ts`, `OperationalLenses.tsx` |
| 6. Authorized agents and verification | Existing `sentinel.memory_search` accepts operational context; memory scope and workspace checks run before retrieval; existing worker context gains operational candidates and ranking factors; no mutation, remediation or infrastructure tool is added to MCP | `src/lib/integrations/mcp-server.ts`, existing `retrieval.ts` / `memory-context.ts` pipeline; operational tests |

### Existing-source adapters and API

`src/lib/knowledge/operational-adapters.ts` imports actual Deployment, HealthCheck, Team and caller-owned AgentRuntimeEvent rows. Independent source cursors support repeatable pages/backfill. Replays preserve event identity. An agent error stays a Failure, not an invented service incident. An endpoint probe describes that endpoint, not whole-system availability. Unattributed repositories/probes are excluded rather than assigned to an arbitrary tenant.

Authenticated `GET/POST /api/graph/operations` extends the graph interface: bounded lenses, deployment evidence reads, historical observations, validated ingestion, discovery, proposal review and source backfill. Read uses `project.read`; mutations use the existing `project.write` permission. Only session-authenticated graph routes expose graph-data mutations. Cross-origin browser mutations are rejected. No infrastructure action is exposed.

The event envelope uses per-source `sourceEventId`, `eventTime`, evidence URLs, typed entities with source IDs/facts and typed relationships with confidence and `[validFrom, validTo)` windows. `depends_on` is the reused canonical vocabulary for SERVICE_DEPENDS_ON_SERVICE; Agent/Person represent responders. Optional `entity.objectId` reuses a matching, already operational canonical node inside the same workspace; it never adopts a node from another workspace or overwrites unrelated global knowledge. Full observations are retained in KnowledgeEvent; the unique current-edge row is a projection, not the history store. Incident updates should provide complete incident snapshots and participant/action evidence.

Operational source identities are source-specific unless an adapter supplies an explicit canonical object ID. Matching names alone never merges services across integrations. Timestamps are compared as instants, including offsets. Historical closed incident relationships remain analysis evidence; expired dependencies do not become current topology.

The existing `/api/neural/temporal` route reconstructs operational observations from event-time ledger history rather than presenting today's mutable metadata as past state. Operational data is workspace-scoped; project-only historical views retain their original project boundary. Inference/review audit history is retained in KnowledgeEvent; inferred proposals are not retrospectively asserted as past dependencies.

MCP example, using existing OAuth with `sentinel.memory.read`:

```json
{
  "name": "sentinel.memory_search",
  "arguments": {
    "query": "What happened the last three times the Sentinel gateway failed?",
    "workspaceId": "<permitted workspace>",
    "operational": "history",
    "latest": true,
    "limit": 3
  }
}
```

Other operational values: `dependency`, `blast-radius` (with canonical `serviceId`), `team`, `alert`, `onboarding`. Existing Hermes/Lisa/Nathan2/Claude Code/Codex memory-context consumers continue through the same governed worker memory pipeline. Tests exercise principal context/scope enforcement, not real remote agent execution.

## Database migration and rollback

`prisma/migrations/20261019090000_operational_graph_indexes/migration.sql` adds only:

* `knowledge_objects(workspaceId,type,validTo)`
* `knowledge_events(workspaceId,type,createdAt)`

No table, model, column, identity or uniqueness constraint is replaced. Existing data is neither fabricated nor backfilled by the migration. Regular PostgreSQL CREATE INDEX can block writes while building: assess table size, back up, and apply in a reviewed maintenance window using `prisma migrate deploy`. Retain the previous application image; it tolerates these extra indexes. Operational types are additive strings/JSON in existing models. Do not delete graph history to roll back the application.

The full existing migration chain, including the new migration, was replayed on an empty throwaway pgvector database and `prisma migrate status` reported current. The replay script reports pre-existing schema drift separately; this change does not claim to repair that drift.

## Verification

Checks completed on the implementation:

| Check | Result |
| --- | --- |
| Operational test suites | 31 tests passed across 7 files; real isolated PostgreSQL/pgvector storage |
| Focused graph/memory/MCP regressions | 163 tests passed across 23 files |
| TypeScript | `npx tsc --noEmit` passed |
| ESLint | Passed with one pre-existing unused `VoiceSettings` warning in `src/app/settings/page.tsx` |
| Production Next.js build | Passed |
| Dedicated Playwright flow | 1 passed; desktop, mobile, existing graph and rotating globe; no page errors |
| Prisma schema validation | Passed |
| Empty-database migration replay | All 68 migrations applied; migration status current |
| Worker Docker image | Built successfully; existing Node 20 dependency-engine warning recorded |
| PR CI Docker job | Passed on implementation commit `1c60541` |
| Full suite, explicit 20-second test limit | **1,385 passed across 178 suites; one opt-in live-Hermes test skipped** (`npm test -- --testTimeout=20000`) |
| Application Docker image | `docker build --target runner` passed |
| PR CI verification | Passed on implementation commit `1c60541`; browser/smoke/deploy-gate still require the PR’s final head to finish |

The default five-second full-suite run completed with 1,384 passing tests, one timeout in the existing six-case migration-validator compatibility test, and one opt-in live-Hermes test skipped. The timeout occurred at about 7.5 seconds under concurrent build load; no assertion failure was reported in that test. The full rerun with `npm test -- --testTimeout=20000` passed all 1,385 executed tests, preserving all assertions and the existing live-test opt-in policy. This timeout is not presented as a passing default-command run. All database tests use an isolated PostgreSQL/pgvector container on localhost:55521, isolated Redis on :55522, and per-run database clones. Browser tests use a separate test database. No test was pointed at the production database.

Fixtures are explicitly labeled SYNTHETIC and live only under tests. The semantic-ranking test uses labeled synthetic vectors in real pgvector storage; it does not call a paid provider or claim real-provider accuracy. Retrieval fixtures verify the expected last three incidents, semantic top result, independent evidence and denied tenant/governance states. Statistical tests verify false-correlation controls, direction, holdout partitioning and conservative confidence; these are software checks, not production calibration measurements.

The Browser plugin is not available. Playwright checks sign-in → existing graph → empty workspace evidence → ingestion → blast-radius selection → mobile view → existing rotating memory globe → return to global graph. Screenshots are local test artifacts under `test-results/operational-*.png`. Browser review caught and fixed an SSR hydration interaction race, Notes-panel overlap and stale minimap demo content during empty operational views.

## Remaining limitations and production requirements

* No external monitoring/incident/alert connector existed to configure. Existing-record adapters run on explicit import/backfill; continuous polling/webhooks and vendor credentials are not silently enabled. Future connectors must map real source identities and evidence to the same authorized envelope. There is no production incident dataset in this change.
* Health checks and agent failures are not silently grouped into synthetic production incidents. Rich incident memory requires actual incident observations and confirmed resolution evidence from an integration or authorized user.
* Semantic retrieval requires a configured, matching embedding provider/model and stored vectors. Provider outages leave lexical/graph retrieval available with explicit uncertainty. Post-commit embedding work is best effort; authoritative event ingestion remains committed if embedding is unavailable. Existing incidents need an embedding backfill when enabling a provider after ingestion.
* Reads/analysis are bounded and identify partial coverage: 500 incident/event candidates, 600 operational nodes, 2,400 relationships, 1,000 failure observations, 100 analyzed service identities, 200 emitted proposals. General graph access/governance checks also fail closed when their bounded memory-evidence pool is incomplete. Long-range history may need narrower queries or operational follow-up work; bounded samples must not be described as exhaustive.
* A correlation confirms association only. Explicit dependency ingestion remains separate. Rejection persists; discovery does not silently reopen reviewed relationships. Automatic evidence refresh/re-review of an existing proposal is not implemented.
* Wilson bounds and chronological held-out precision are reported; incomplete or small/directionless histories cannot qualify as reliable prediction evidence. Explicit dependency traversal produces conditional predictions with unknown calibrated probability. Real production retrieval relevance, false-positive rates and prediction calibration still require labeled operational history and monitored evaluation before operational reliance.
* Confidence on historical incident memory is the existing admission heuristic, explicitly labeled as such; it is not a calibrated probability that a claimed root cause is true. Unconfirmed root causes remain unconfirmed and are not returned as confirmed causes.
* Team normalization requires recorded capacity intervals and dated ownership. No capacity is inferred from headcount, and missing historic assertions produce incomplete trends. Alert actionability/duplicate/false-positive labels must come from observations; recommendations require human tuning review and never delete or modify alerts.
* The live-Hermes smoke test is opt-in and was not executed. No real Lisa/Nathan2/Codex/Claude infrastructure task, remediation, alert deletion, deployment, or production migration was performed. A real authorized read-only agent smoke test remains a rollout gate.
* Review open PR overlaps from AUDIT.md before merging, especially #17 memory governance, #41 memory-to-graph synchronization, and #53–55 agent execution. Re-run required CI on the PR head. Back up, apply additive indexes, enable a configured embedding provider if wanted, authorize source ingestion per workspace, backfill real history, and validate tenant isolation and prediction calibration before production rollout.

## Files changed

* `docs/operational-intelligence/AUDIT.md`
* `docs/operational-intelligence/DELIVERY.md`
* `playwright.config.ts`
* `playwright.operational.config.ts`
* `prisma/migrations/20261019090000_operational_graph_indexes/migration.sql`
* `prisma/schema.prisma`
* `src/app/api/graph/operations/route.ts`
* `src/app/api/neural/temporal/route.ts`
* `src/components/neural-lens/GraphMinimap.tsx`
* `src/components/neural-lens/NeuralLens.tsx`
* `src/components/neural-lens/categories.ts`
* `src/components/neural-lens/fromApiGraph.ts`
* `src/components/neural-lens/globe/GlobeScene.ts`
* `src/components/neural-lens/types.ts`
* `src/lib/graph/scoped.ts`
* `src/lib/graph/theme.ts`
* `src/lib/integrations/mcp-server.ts`
* `src/lib/knowledge/colors.ts`
* `src/lib/knowledge/graph.ts`
* `src/lib/knowledge/operational-adapters.ts`
* `src/lib/knowledge/operational-analysis.ts`
* `src/lib/knowledge/operational-graph.ts`
* `src/lib/knowledge/operational-ingestion.ts`
* `src/lib/knowledge/operational-retrieval.ts`
* `src/lib/knowledge/operational-types.ts`
* `src/lib/knowledge/retrieval.ts`
* `src/lib/knowledge/types.ts`
* `src/lib/neural-engine/ingestion-gate.ts`
* `src/lib/neural-engine/memory-ingestion.ts`
* `src/modules/graph/components/GraphCanvas.tsx`
* `src/modules/graph/components/GraphNodeInspector.tsx`
* `src/modules/graph/components/GraphSurface.tsx`
* `src/modules/graph/components/OperationalLenses.tsx`
* `tests/e2e/operational-lenses.spec.ts`
* `tests/operational-intelligence/adapters.test.ts`
* `tests/operational-intelligence/agent-authorization.test.ts`
* `tests/operational-intelligence/analysis.test.ts`
* `tests/operational-intelligence/dependency-review.test.ts`
* `tests/operational-intelligence/fixtures.ts`
* `tests/operational-intelligence/ingestion-retrieval.test.ts`
* `tests/operational-intelligence/interfaces.test.tsx`
* `tests/operational-intelligence/semantic-ranking.test.ts`
