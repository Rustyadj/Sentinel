# Memory Engine

## Purpose

The Memory Engine gives agents and users persistent context that survives across conversations, projects, and sessions.

Memory is not chat history. Memory is structured knowledge about the world, the project, or the user — extracted, stored, and retrieved as needed.

---

## Scopes

Memory is always scoped. A piece of memory belongs to exactly one scope:

| Scope | Lifetime | Storage | Who Can Read |
|-------|----------|---------|--------------|
| `session` | Current conversation | Redis (ephemeral) | Current session only |
| `project` | Project lifetime | PostgreSQL | Project members |
| `workspace` | Workspace lifetime | PostgreSQL | All workspace members |
| `org` | Organization lifetime | PostgreSQL | All org members |
| `user` | User lifetime | PostgreSQL | That user only |
| `public` | Permanent | PostgreSQL | Anyone |

---

## Memory Entry

```ts
interface Memory {
  id: string
  type: MemoryType           // "fact" | "preference" | "event" | "skill" | "relationship"
  scope: MemoryScope
  owner: string              // userId or agentId
  content: string            // the memory text
  tags: string[]
  embedding?: number[]       // pgvector (1536 dimensions)
  confidence: number         // 0-1, decays over time
  importanceScore: number    // 0-1, used for retrieval ranking
  source: string             // where this memory came from
  pinned: boolean            // pinned memories never expire
  archived: boolean
  createdAt: DateTime
  updatedAt: DateTime
}
```

---

## Retrieval

All retrieval goes through one governed path,
`buildMemoryContext()` in `src/lib/neural-engine/memory-context.ts`. Chat,
orchestration runs, task execution and the MCP tools all call it. No runtime
adapter retrieves memory for itself — Sentinel is the memory authority.

The path is: scoped retrieval → KnowledgeObject bridging → bounded context
assembly → usage recording, in that order.

Ranking today combines:

1. **Scope filtering** — only memory the caller may read (`buildRetrievalFilters`)
2. **Governance state** — quarantined and forgotten memory is excluded everywhere,
   including from MCP clients (`excludeFromRetrieval`)
3. **Net value** — `valueScore`, the decay policy's output, nulls last
4. **Pinning** — an explicit human override that outranks value
5. **Importance** and **recency**
6. **Lexical relevance** — token overlap, in the retrieval planner's multi-factor rank

**Semantic similarity is not yet live.** `memories.embedding` is declared
`vector(1536)` and has never been written to, and there is no ivfflat/hnsw
index on it. The retrieval planner's `semantic_similarity` factor is Jaccard
token overlap — a real relevance signal, but a lexical one.
`src/lib/neural-engine/embeddings.ts` is the provider seam that closes this;
it needs a reachable 1536-dimensional embedding provider before anything
changes. See **Embeddings** below.

### Context assembly

Retrieved memory is not dumped into prompts. `assembleContext()` renders it
into a bounded block (default ~1200 estimated tokens) and reports exactly what
was injected, at what rank, at what token cost, and what was dropped.

Retrieval and injection are recorded as **separate facts** on
`memory_retrievals` (`injected`, `injectedRank`, `contextTokens`, `consumer`).
Only an injected memory can count as evidence about its own usefulness. This
matters: orchestration runs previously retrieved memory, recorded the
retrievals, and then dispatched the bare task string — so the reconsolidation
service was crediting memories no agent had ever read.

---

## Embeddings

Configured via environment:

```
SENTINEL_EMBEDDING_PROVIDER = openai | voyage | none   (default: none)
SENTINEL_EMBEDDING_MODEL    = text-embedding-3-small
OPENAI_API_KEY / VOYAGE_API_KEY
```

Constraints, enforced in code rather than documented and hoped for:

- The store is `vector(1536)`. A model emitting a different width is rejected
  outright — vectors are never padded or truncated to fit, because that
  destroys cosine geometry and a silently wrong distance is worse than none.
  `text-embedding-3-small` emits exactly 1536. `voyage-3-lite` emits 512 and
  `voyage-3` emits 1024, so neither fits without a migration and re-index.
- No provider, an unreachable provider and a rejected request all degrade to
  the lexical signal. Retrieval never fails because an embedding API is down.

Known deployment issue: `api.voyageai.com` returns HTTP 403 at its edge from
this VPS even with no auth header, while OpenAI and Anthropic return normal
401s from the same host — Voyage appears to block this server's IP.

---

## Nightly Reflection (Planned)

A background process runs nightly to:

1. Review session memories
2. Promote important ones to project/workspace scope
3. Merge duplicate or contradictory memories
4. Decay confidence on stale memories
5. Archive low-confidence, unimportant memories

This is the "reflection" pass — same concept as the user's own memory consolidation during sleep.

---

## API

```
GET  /api/memories          — query memories (scope, tags, semantic)
POST /api/memories          — create memory
GET  /api/memories/stats    — memory counts by scope
POST /api/memories/reflect  — trigger reflection pass (manual)
PUT  /api/memories/:id      — update memory
DELETE /api/memories/:id    — delete memory
```

---

## Current State

Verified against code, not intent.

Implemented and wired:
- `Memory` model with bitemporal history, provenance class, value/harm/staleness
  signals, confirmation/disconfirmation counts and shadow-only flagging
- Governed retrieval through `buildMemoryContext()`, used by chat,
  orchestration, task execution and MCP
- Bounded context assembly with per-memory rank and token attribution
- Retrieval→outcome join (`MemoryRetrieval`), with evidence gated on injection
- Net-value decay policy (`memory-governance.ts`) and the nightly sweep
- Consolidation into generalized memories, in shadow mode
- Session memory in Redis
- Selective persistence gate (`ingestion-gate.ts`) — classification and
  rationale exist and are tested
- CRUD API (`/api/memories`), Memory Inspector UI (`/memory`), stats endpoint

Implemented but not yet connected:
- Embedding provider seam — no reachable provider, so nothing writes
  `memories.embedding` and semantic search remains lexical
- Ingestion gate — classifies correctly but is not yet called from the chat
  path, so chat still writes no durable memory

Not implemented:
- Procedural memory as a real lane. `Procedure` exists but is only read and
  deprecated; nothing writes procedures or versions them against outcomes
- Outcome-driven reconsolidation beyond reinforce/disconfirm — no REVISE,
  SUPERSEDE, MERGE, QUARANTINE or ARCHIVE decision engine
- Correction capture (user says "that's wrong" → candidate revision)
- A memory benchmark harness. `BenchmarkDefinition`/`BenchmarkResult` are CRUD
  and metric recording only; there are no datasets, no precision/recall or
  scope-leakage measurement, and therefore no baseline
- Persisted retrieval traces. `RetrievalTrace` is computed and returned but
  never stored, so "why did this outrank that" cannot be answered after the fact
