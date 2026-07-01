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

Memory retrieval uses a combination of:

1. **Semantic search** — pgvector cosine similarity against embeddings
2. **Tag filtering** — exact tag matches narrow the result set
3. **Scope filtering** — only return memories the caller has access to
4. **Recency** — recent memories are weighted higher
5. **Importance** — high-importance memories float to the top
6. **Confidence** — low-confidence memories are shown with caveats

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

## Current State (Phase 1)

Implemented:
- Full `Memory` model with pgvector embedding column
- CRUD API (`/api/memories`)
- Memory Inspector UI (`/memory`)
- Stats endpoint
- Manual reflect endpoint (stub)

Not yet implemented:
- Embedding generation on write (requires embedding API key)
- Semantic similarity search (requires embeddings)
- Nightly reflection cron
- Session memory in Redis
- Memory injection into agent prompts at runtime

These are Phase 2-3 targets.
