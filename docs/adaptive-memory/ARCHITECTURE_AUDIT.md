# Adaptive Memory architecture and conflict audit

## Executive finding

Sentinel already has a credible canonical knowledge and controlled-learning
foundation. This change must extend that foundation. It must not add a second
trusted memory store or let MCP clients write directly to canonical tables.

## Existing and functional

| Area | Existing implementation | Decision |
| --- | --- | --- |
| Canonical semantic graph | `KnowledgeObject`, temporal `KnowledgeEdge`, `Decision`, `Entity`, `Claim`, `Evidence`, and `Contradiction` | Reuse as trusted semantic memory and provenance graph. |
| Temporal history | `validFrom`, `validTo`, supersession chains, point-in-time graph APIs | Reuse; admission promotes by additive/versioned writes. |
| Episodic learning | `Experience`, `Outcome`, `Evaluation`, chat capture, evaluator, action/tool/artifact fields | Extend with immutable active-memory snapshots and run controls. |
| Controlled learning | `LearningCandidate` lifecycle, centralized risk classifier, review, apply, and rollback | Reuse for current neural-engine changes. Add a universal memory-candidate envelope in front of canonical memory writes. |
| Procedural knowledge | Canonical `Skill`, `Procedure`, `Policy` tables and promotion thresholds | Extend with candidate specifications, versions, replay results, and degradation history. |
| Retrieval | Scope-aware memory/note/decision retrieval plus a factorized neural retrieval planner | Extend with durable traces, token budgets, contradiction/staleness/security factors, and progressive disclosure. |
| Agent learning | `AgentKnowledgeProfile`, competencies, knowledge weights, degradation sweep | Extend with evidence-derived limits, trust, and routing signals. |
| Authorization | Workspace/project permission checks, roles, teams, approval requests | Mandatory service boundary for UI, APIs, MCP, and delegation. |
| Audit | Append-only `AuditLog` and `KnowledgeEvent` | Reuse; add structured adaptive event metadata without bypassing either log. |
| UI | Neural Lens with temporal replay; Mission Control with explicit live/unavailable source states | Preserve layout and honest source-state behavior. Add Knowledge Graph governance views and Mission Control rollups. |

## Incomplete or unsafe seams

1. `Memory` is an older direct-write store. It has project scope and owner text,
   but no complete organization/workspace/user/agent provenance envelope. The
   neural learning service can currently create a `Memory` row after candidate
   approval. New untrusted writes must enter the universal admission firewall;
   the old API remains compatibility-only.
2. `LearningCandidate` is intentionally generic and does not carry all required
   source trust, provenance, expiry, contradiction, or quarantine fields.
3. Working memory has no run-scoped TTL abstraction. Redis exists in the stack,
   but is not yet the explicit ephemeral memory tier.
4. Retrieval scoring is explainable in code but is not persisted as a complete
   recall trace, and selection is not governed by a hard context token budget.
5. Skill promotion checks repeated evidence, but there is no full candidate
   specification, replay corpus/result record, immutable version artifact, or
   objective baseline comparison.
6. Learning rollback is complete for only some candidate types. Skill and
   procedure rollback need first-class version activation history.
7. There is no MCP server, client identity model, idempotency ledger, rate/cost
   enforcement, or secret-isolated execution gateway.
8. Reflection exists as memory heuristics, and skill scanning exists, but there
   is no single significant-run reflection coordinator or scheduled,
   provenance-preserving consolidation job.
9. Workflow records lack durable owner/health/run/version fields required for
   non-fabricated Mission Control reporting.
10. Temporal supersession of user-owned `KnowledgeObject` rows has a documented
    uniqueness conflict. The migration in this phase must replace the broad
    unique key with a current-row-aware strategy before relying on that path.

## Duplication conflicts to avoid

- Do not create another trusted semantic-memory table. `KnowledgeObject` and
  its typed canonical tables remain authoritative.
- `MemoryCandidate` is a quarantine/admission record, not another memory store.
- Do not create an MCP-specific authorization system. MCP scopes are an
  additional client constraint; workspace/project RBAC remains authoritative.
- Do not create a second event bus. Adaptive events persist through existing
  audit/event seams with a structured envelope.
- Do not infer operational health. Mission Control may display only persisted
  run data or an explicit unavailable state.

## Migration policy

All changes are additive except for repairing the `KnowledgeObject` source
uniqueness constraint. Existing `Memory`, `LearningCandidate`, `Skill`,
`Procedure`, `Experience`, and `Workflow` rows stay readable. New agent,
import, connector, and MCP writes use candidates first. Backfill is deliberately
not automatic: legacy rows lack enough provenance to be promoted safely.

## Security boundary

Client-supplied tenant IDs are filters, never proof of access. Every mutation
must resolve the acting user or service client on the server, verify workspace
and project access, enforce trust/approval policy, write audit events, and avoid
placing credential values in prompts, database payloads, traces, or tool output.
