# Phase 0 audit — 2026-10-19

Baseline: default `main`, `7b6e2e5673a9e54779b73bc3087dc80705294049`. Audited before code changes. Read-only inspection of running `sentinel-os-app-1` reports this exact OCI image revision. Latest GitHub production deployment record (6828085498) is failed; it is not evidence of the running version.

## Implementation matrix

| Requested capability | Baseline | Existing files and reuse / gaps |
| --- | --- | --- |
| Incident intelligence | Partial foundation; operational ontology missing | `prisma/schema.prisma:995` KnowledgeObject, `:1037` KnowledgeEdge, `:1713` KnowledgeEvent, `:3125` SystemEvent. Existing source identities, temporal validity, JSON provenance and dedupe. No operational entity ingestion adapter. Deployment, Team, Agent, Failure already exist; reuse Agent/Person as responders and depends_on rather than alternate identity systems. |
| Instant incident memory | Partial foundation; incident retrieval missing | `src/lib/knowledge/retrieval.ts` scope/governance filters and temporal ranking; `src/lib/neural-engine/memory-ingestion.ts` admission gate; `memory-context.ts` agent prompt assembly; `embedding-store.ts` provider/model/version-scoped vectors. `retrieval-planner.ts` is lexical despite its semantic factor name, and lacks adequate tenant predicates: do not use it for the new path. |
| Dependency discovery | Missing | `src/lib/knowledge/edges.ts` supports unique directed typed relationships; `src/lib/neural-engine/contradiction-service.ts` is belief management, not operational co-failure analysis. No co-failure evidence, controls, or review protocol. |
| Blast radius | Missing | `src/lib/graph/scoped.ts` has bounded graph expansion but no directed service impact traversal, prediction evaluation or health inputs. |
| Operational graph lenses / analytics | Partial interface foundation; operational lenses missing | `src/modules/graph/components/GraphSurface.tsx` and `GraphCanvas.tsx` use `/api/graph/scoped`; `src/components/neural-lens/NeuralLens.tsx` uses `/api/graph` for the rotating globe in chat/memory and `LensOverview.tsx` in workspace views. Preserve both canvases. No incident/team/alert lens or capacity normalization. |
| Agent operational interfaces | Partial authorization foundation; operations missing | `src/lib/integrations/mcp-server.ts` canonical OAuth MCP, `mcp-context.ts` permitted context; `src/lib/agents/permissions.ts` and `src/lib/bots/policy.ts` runtime/tool authorization; `src/lib/neural-engine/memory-context.ts` existing governed agent memory. Extend these, never add infrastructure actions. |

## Actual graph surfaces and superseded components

* `/graph` mounts the bounded 2D `src/modules/graph/components/GraphSurface.tsx`.
* Chat's `src/components/collaboration/CollaborationOverlays.tsx`, `/memory`, and workspace `LensOverview.tsx` mount `src/components/neural-lens/NeuralLens.tsx` / `NeuralLensGraph.tsx`. This globe's rotation/layout/navigation must survive. `/neural-lens` redirects to `/chat?space=graph`.
* `src/components/graph/KnowledgeGraph.tsx` still has a Creator Studio consumer. It is legacy but not dead; retain it. Its `NeuralLens.tsx` is separate from the canonical globe.
* `src/components/home/LiveKnowledgeGraph.tsx` and `src/components/knowledge/KnowledgeGraphPanel.tsx` have no consumers found by repository-wide import/name search; superseded candidates, not deleted in this change.
* The globe currently defaults to explicit demo mode but also silently falls back to demo data on scoped fetch failure. Operational mode must use real/empty data and never inherit that fallback.

## Temporal, provenance and authorization constraints

`KnowledgeEdge` has a unique (fromObjectId,toObjectId,type) constraint, so its current row cannot itself be an append-only relationship history. Reuse append-only `KnowledgeEvent` for immutable observations/review snapshots and the existing edge validity/version fields for the current projection. `temporal-service.ts` supersession currently omits userId to avoid source uniqueness collisions; do not use it for operational identities. Source event identity must include workspace and source, and ingestion plus projection plus governed memory admission must commit atomically. Late backfills must not overwrite newer facts.

Memory must pass `classifyForIngestion`, workspace write authorization, `buildRetrievalFilters` and `excludeFromRetrieval`; quarantined/forgotten/expired/shadow memory must never reappear through graph results. Query vectors may only rank already authorized and governed memory IDs, using matching embedding provenance. Operational reads must explicitly recheck workspace permission even for objects created by the caller. Bounded scans must expose partial coverage.

## Relevant open PRs inspected

* #41: Memory-to-Graph bridge and task detail; overlaps `entity-sync.ts` and memory mutation routes. Do not duplicate its bridge.
* #17: adaptive memory / secure MCP governance; broad, unmerged alternative paths. Reuse current main, do not import another memory engine.
* #21: Learning Core release audit against `learning-core/neural-engine-extension`; relevant regression coverage, not operational implementation.
* #53/#54: governed Hermes Telegram / Jev dispatch; preserve tool approval and bot policy boundaries.
* #55: Claude/Codex persistent computers; preserve runtime authorization and isolation.
* #49: telephony; no graph implementation overlap.

No code was modified before completing this audit. Subsequent implementation and verification are tracked separately in DELIVERY.md.
