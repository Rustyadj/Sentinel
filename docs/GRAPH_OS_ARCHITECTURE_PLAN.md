# Graph-Native OS — Architecture Plan

Source: "Sentinel OS — Graph-Native Operating System Architecture Redesign"
vision doc provided 2026-07-30 (not committed verbatim — this is the scoped,
buildable version). This is the largest-blast-radius request in this
codebase's history: it asks for the central architecture, not a module.
Nothing in this doc is implemented yet — audit and plan only, per the pattern
established for Creator Studio and the Agent Operations Center.

## The gap between vision and reality

The vision's first principle is **"There is ONLY ONE graph... never duplicate
it."** A full code audit (not assumed — every claim below is grounded in
actual files) found the opposite is already true today:

### Three disjoint graph systems exist, not one

1. **`KnowledgeObject`/`KnowledgeEdge`/`KnowledgeEvent`** (Postgres) — the
   closest thing to what the vision describes. But it's sparsely populated:
   only `Memory` rows are ever persisted as real `KnowledgeObject`s. `Agent`
   and `ChatRoom` appear in the graph only as **ephemeral nodes synthesized
   on every read** (`src/lib/knowledge/graph.ts`'s `bridgeAgent`/
   `bridgeChatRoom` — explicitly commented "no DB write") — they're re-derived
   from scratch on each `/api/graph` call, never have real edges (edges are
   only fetched for the persisted node set), and vanish and reappear with new
   identity semantics every request. `Entity` and `Artifact` models exist in
   the schema with **zero code references anywhere** — fully dead.
   **Correction (2026-07-30, caught by a parallel cleanup task before it
   deleted the wrong thing):** `Decision` is *not* dead — `retrieveContext()`
   in `retrieval.ts` does a raw `db.decision.findMany()` to pull
   approved/proposed decisions into chat's context injection. What's
   actually dead is `src/lib/knowledge/decisions.ts`, the separate CRUD
   library (`createDecision`/`approveDecision`/etc.) — nothing calls it,
   which means the table has a live read path but no way to ever be
   populated. The model stays; only the orphaned CRUD file goes.

2. **`ObsidianNote` wiki-links/backlinks** — a completely separate system
   (`backlinks String[]`, regex-parsed `[[...]]` links) powering the
   Knowledge module's (`/obsidian`) own graph tab. Notes never become
   `KnowledgeObject` rows. This graph and graph #1 have never spoken to each
   other.

3. **Two independently-built `react-force-graph-2d` renderers** —
   `LiveKnowledgeGraph.tsx` (home page) and `KnowledgeGraphPanel.tsx` (chat
   page) — with **already-drifted color maps** (Memory is `#10b981` in one,
   `#5cc9b0` in the other), different fetch/poll cadences (8s vs. 5s +
   SSE-triggered refetch), and non-overlapping features (arrival-pulse exists
   in one, cluster-anchors/lens-filters/drag-to-pin exist only in the other).
   Plus a **fourth**, structurally different graph renderer
   (`@xyflow/react`, static grid layout, no physics) powering the Knowledge
   module's own graph tab via `/api/notes/graph` — unrelated to `/api/graph`.

### Almost nothing is wired into any of them

Beyond `Memory`, **zero** models have any relation into the knowledge graph:
not `Project`, `Workspace`, `Task`, `Document`, `Team`, `Meeting`, `OrgChart`
— and not anything built this session either. Every Creator Studio model
(`Brand`, `ContentProject`, `ContentItem`, `Asset`, `ContentHook`) and every
Agent Ops Center model (`Agent`, `AgentConfiguration`, `AgentInstance`,
`AgentHealthCheck`, `AgentEvent`) has no graph presence at all today. The
vision's example node list (Company, Task, Website, Repository, Customer,
Lead...) describes a schema that mostly doesn't exist yet, on top of a graph
substrate that mostly doesn't connect to the schema that *does* exist.

### The "workspace clusters" have no data to cluster

The vision's example clusters — Marketing, Cybersecurity, Organization,
Engineering — map to the **frozen legacy `workspaces/*` pattern**
(`docs/LEGACY_WORKSPACES.md`): thin generic wrappers around one shared
`DatabaseWorkspaceOverview` component, not distinct feature surfaces with
real data models. There is nothing there to turn into a graph cluster without
first building the features themselves — a separate, unscoped effort this
plan does not include. The two modules with genuinely rich data models today
are **Creator Studio** and **Agent Ops Center**, both built this session.

### No real-time fan-out exists

No WebSocket server, no Redis pub/sub (confirmed: `ioredis` client exposes
no `.publish`/`.subscribe` calls anywhere in `src/`). The only push mechanism
is per-request SSE in `/api/chat/route.ts`, and even there the
`{type:"knowledge_update"}` events carry **no payload** — they're a "go
refetch" signal the requesting tab's own graph component polls in response
to. A second browser tab watching the same graph only finds out via its own
independent poll interval. "The user watches the operating system think" in
real time, across viewers, is infrastructure that doesn't exist yet.

### Vector search was built, then silently undone

`Memory.embedding` was a real `vector(1536)` pgvector column at initial
schema creation. A later migration — `creator_studio_phase1_brands`, whose
name has nothing to do with this — casts it to plain `TEXT` as its first
statement, an artifact of a broad Prisma `db push`/migrate diff rather than
an intentional decision. No code reads or writes that column today; no
embedding generation exists anywhere. This is a heads-up, not blame: worth
knowing before assuming vector retrieval is "already there, just needs
wiring." It's greenfield.

## Hard architectural decisions

These are the load-bearing calls this plan makes. Flagged explicitly, not
defaulted silently, per this session's established practice.

**1. `KnowledgeObject`/`KnowledgeEdge` becomes the one graph — and stops
being synthesized on read.** The vision's "no fake visualization, the graph
IS the database relationship layer" is incompatible with today's
bridge-on-every-read pattern for Agent/ChatRoom. Every node must become a
real, persisted row with a stable identity and real edges, not a
re-derived-from-scratch object with borrowed edges (or none). `Entity` and
`Decision` are retired or folded into typed `KnowledgeObject` rows rather
than resurrected as parallel systems — they're dead weight either way;
resurrecting unused code is not the same as making it useful.

**2. Every domain model needs a node-sync hook, and this must be one shared
mechanism, not dozens of hand-wired call sites.** This is the single largest
engineering lift in the whole plan: instrumenting the write path of every
module (existing and future) to upsert a `KnowledgeObject` + relevant
`KnowledgeEdge`s whenever a row is created/updated/deleted. Hand-wiring this
into every route (as Phase 0/1/2/3/4/5/6 of Creator Studio and Agent Ops did
for their own concerns) would mean touching 40+ files and guarantees drift.
Recommend a single `syncToGraph()` helper (or a Prisma Client extension
intercepting writes) that every model's write path calls through — build it
once, prove it on one module, then roll forward.

**3. Consolidate on `react-force-graph-2d` as the one graph renderer,
merging what's already built rather than starting over.** It already has
force-directed physics, pan/zoom, arrival-pulse animation with
reduced-motion support, hover-neighbor-highlighting, and (in the chat-page
variant) cluster-anchors, lens filters, and drag-to-pin — collectively
already most of what "Universe/Cluster/Context Mode" asks for, just split
across two components with drifted styling. `@xyflow/react` stays reserved
for genuinely DAG-shaped things it's already proven at (the Workflows
module's node/edge editor) — not the main graph canvas. Building a third
renderer from scratch would throw away real, working code.

**4. Real-time push ships in two stages, not one.** Stage one: extend the
existing per-request SSE pattern to carry actual node/edge delta payloads
(not just refetch markers) to the one client that triggered them — this
reuses infrastructure every module in this codebase already relies on
(Studio's generator, Creator Studio's script/hooks generation, chat itself).
Stage two — multi-viewer fan-out via Redis pub/sub so a *second* tab sees the
same live graph activity — is new infrastructure and a distinct, harder
phase. Don't build stage two speculatively before stage one is proven.

**5. Cluster Mode ships for Creator Studio and Agents first, not
Marketing/Cybersecurity/Organization.** Those three have no real data model
to cluster yet — building "clusters" for them would mean either faking node
content or first doing the (separate, unscoped) work of building out those
workspaces for real. Creator Studio and Agent Ops already have rich schemas
from this session; they're where Cluster Mode can be real on day one.

**6. Shared graph components formally become a sanctioned exception to "a
module must never import from another module."** In practice this is already
true — `LiveKnowledgeGraph`/`KnowledgeGraphPanel` already live under
`src/components/`, not inside any `src/modules/*` package, and are each
imported by exactly one page today (no existing violation). This plan makes
every module's Cluster Mode view import the *same* shared canvas component,
which needs an explicit line added to `docs/MODULE_SYSTEM.md` rather than
being an implicit precedent nobody wrote down.

**7. pgvector reinstatement is deferred, not bundled in.** The vision is
about graph *structure* (nodes/edges/clusters), not semantic similarity
search. Restoring `Memory.embedding` to a real vector column and building an
embedding-generation pipeline is real, separate greenfield work — sequence
it only if/when a concrete feature needs it (e.g., semantic node search),
not as a prerequisite for the graph architecture itself.

## Phased delivery

### Phase 0 — Consolidate the graph substrate — partially done (2026-07-31)
The prerequisite. No rendering work yet. Split into two parallel,
file-disjoint slices and executed simultaneously (one in this session, one
via a separate Codex task) — no worktree needed since the slices never
touched the same files.

**✅ Cleanup slice (Codex):** Removed `Entity` (migration
`20260731025316_retire_entity`, drops only the `entities` table) and deleted
the orphaned `src/lib/knowledge/decisions.ts` CRUD layer. **Caught a real
error in this plan's own audit along the way**: the original claim that
`Decision` was fully dead was wrong — `retrieveContext()` in `retrieval.ts`
does a live `db.decision.findMany()` for chat context injection. Codex
correctly stopped and reported instead of deleting a live model; the task
was rescoped and `Decision` was left untouched. Corrected in the audit
section above.

**✅ Core infra slice (this session):**
- Built `syncToGraph()` (`src/lib/knowledge/sync.ts`) — the shared write-path
  helper from decision #2. Idempotent upsert-by-`(sourceType, sourceId)`
  (no unique DB constraint added, to stay file-disjoint from the parallel
  schema cleanup — a `findFirst`-then-create-or-update, fine at this scale).
  Persisted node ids keep the existing `type:sourceId` convention (e.g.
  `agent:hermes-lisa`) for continuity with prior virtual-node ids.
- Replaced `bridgeAgent`/`bridgeChatRoom` virtual synthesis in `graph.ts`
  with real persisted nodes, wired via `src/lib/agents/graph.ts`
  (`syncAgentToGraph`/`removeAgentFromGraph`) into every Agent write path:
  `ensureAgentsSeeded()`, `POST`/`PUT`/`DELETE /api/agents`. ChatRoom
  creation (`POST /api/rooms` and the auto-created default room) now syncs
  too, with real `related_to` edges to each agent in `agentIds`.
- `buildGraphData()`'s stored-object query now always includes
  `scope: "global"` nodes (agents) alongside whatever project/workspace/room
  filter is active, and explicitly includes the filtered room's own node —
  necessary since Agent nodes are global-scoped and would otherwise be
  excluded by a project-scoped query.
- **Found and fixed a real bug while verifying live**: `ensureAgentsSeeded()`
  had a DB-row-count short-circuit that skipped its entire upsert loop
  (including the new sync calls) whenever agents already existed from a
  prior process — meaning agents seeded before this change would *never*
  get backfilled into the graph. Removed the count-based skip; the
  in-memory `seeded` flag alone is enough to avoid repeat work within a
  process's lifetime, and the loop self-heals on next server start.
- Verified live end-to-end: all 6 seeded agents got real `KnowledgeObject`
  rows; a created chat room produced real edges to exactly the agents in
  its `agentIds` (confirmed the other 4 agents were *not* edge-connected);
  create/rename/delete on an agent correctly created/updated/removed its
  graph node. Zero unexpected server errors.
- **Known gap, not yet closed**: there's no `DELETE /api/rooms/[id]` route
  in this codebase today, so ChatRoom deletion has no corresponding
  `removeFromGraph` call site yet — noted, not blocking, pick up when that
  route exists.

**Still open from this phase:**
- Decide `ObsidianNote`'s fate: bridge wiki-links into real `KnowledgeEdge`
  rows (so the Knowledge module's graph and the main graph become one), or
  explicitly leave it as a documented second system with a stated reason.
  Don't leave this undecided by omission.
- Whether accepted `Decision`s should also sync as typed `KnowledgeObject`
  rows via `syncToGraph()` — flagged, not decided.

### Phase 1 — Wire Creator Studio + Agent Ops into the graph ✅ done
- Real, persisted `KnowledgeObject` + `KnowledgeEdge` rows now exist for:
  `Brand` (Organization), `ContentProject` (Project), `ContentItem`
  (Artifact, with `belongs_to` edges to brand/project and `generated_by` to
  its source item for Shorts), `Asset` (File), `Task` (Task, `belongs_to`
  its `ContentProject` and `assigned_to` its agent when set — only wired for
  Creator Studio's project-task routes, the frozen legacy `/api/tasks/*`
  routes still have no graph presence, a known gap not a collision), `Agent`
  (enriched with its `AgentConfiguration` data as metadata rather than a
  redundant 1:1 node), `AgentInstance` (Module, `belongs_to` its Agent).
  `ContentHook` and `AgentHealthCheck`/`AgentEvent` were deliberately *not*
  synced as nodes — see decisions above (too granular / too high-frequency
  for static graph substrate, the latter is Phase 5's material instead).
- **`Idea` (Idea Vault) also now wired in** — mapped to `Note` (closest
  conceptual fit per the vision's own description of ideas as captured
  knowledge), `belongs_to` its brand. Closes a real gap: `Idea` had a schema
  since Creator Studio's Phase 1 but **zero API** — only a `count()` call
  backing the dashboard's "Ideas Waiting" stat, no way to ever create one.
  Built the full CRUD (`/api/creator-studio/ideas`). Also populates the
  `Idea.knowledgeObjectId` column (which existed in the schema, unused,
  reserved for exactly this) as a denormalized direct pointer to the synced
  node, on top of the usual `sourceType`/`sourceId` lookup every other model
  here uses.
- **Bug found and fixed during live verification**: the idea create/update
  routes returned the DB row captured *before* `syncIdeaToGraph`'s
  `knowledgeObjectId` backfill wrote back to it — so `POST`'s response body
  showed `knowledgeObjectId: null` even though the DB had the correct value
  a moment later (confirmed via a separate `GET`). Fixed by re-fetching
  after sync before responding. This staleness pattern is unique to `Idea`
  — none of the other sync helpers (`Brand`/`ContentProject`/`ContentItem`/
  `Asset`/`Task`/`Agent`/`AgentInstance`) write back to their own source
  row, so this bug class doesn't exist anywhere else.
- Verified live end-to-end multiple times: full `task → project → brand`
  and `content_item → project/brand` edge chains, `AgentInstance → Agent`
  edges, `idea → brand` edges with correct `knowledgeObjectId` backfill,
  create/update/delete lifecycle correctly creating/updating/removing graph
  nodes on every route.

### Phase 2 — Unify the graph renderer ✅ done
- Merged `LiveKnowledgeGraph` and `KnowledgeGraphPanel` into one shared
  `GraphCanvas` (`src/components/graph/GraphCanvas.tsx`), one color map via
  `KNOWLEDGE_NODE_COLORS`, both prior call sites (`/`, `/chat`) migrated
  with behavior preserved. Old components deleted. Module-boundary
  exception (decision #6) written into `docs/MODULE_SYSTEM.md`.

### Phase 3 — Cluster Mode for Creator Studio ✅ done (Agents still open)
- `CreatorStudioShell` now docks a `GraphCanvas` (~28% width) scoped to the
  active brand via a new `sourceType`/`sourceId` filter on `buildGraphData()`
  — real one-hop graph traversal from the brand's node (root + everything
  directly edge-connected), not a crude "all global nodes" leak. Verified
  live with two separate brands: each cluster showed exactly its own nodes,
  zero cross-brand bleed.
- Agents Cluster Mode still open — no Agent Ops Center UI redesign has
  happened yet (only the Phase 0 backend consolidation from earlier this
  session), so there's no shell to dock a panel into yet. Blocked on that
  UI work existing, not on graph plumbing.

### Graph coverage — ongoing, beyond the original two-module scope
Phase 1 named Creator Studio + Agent Ops as the proving ground, but the
`syncToGraph()` primitive generalizes cleanly to any model with a real write
path, so coverage has kept expanding opportunistically to models with clean,
non-legacy-entangled API routes:
- **`Workflow`** ✅ synced (`src/lib/knowledge/workflowgraph.ts`) — exact
  type match (`Workflow` is already a `KnowledgeObjectType`), `belongs_to`
  edge to its project when set. `/api/workflows/*` routes were confirmed
  clean (no `@/lib/workspaces/*` imports) before touching them — the
  Workflows *module*'s nav entry redirects into the frozen legacy system,
  but its underlying API routes don't, so this was safe. Verified live:
  full create/update/delete lifecycle, real node with correct title/summary/
  metadata, correct removal on delete.
- **Legacy `/api/tasks/*`** — checked and explicitly **not** wired: these
  routes import `requireWorkspacePermission`/`writeAuditLog` from
  `@/lib/workspaces/*`, unlike `/api/workflows/*` — functionally part of
  the frozen system even though the file path isn't literally under
  `src/app/workspaces/`. Left alone per the freeze.

### Phase 4 — Context Mode
- Extract the "nearby connected nodes" view as a reusable panel for
  inspectors/right-panels/detail drawers — `KnowledgeNodeDrawer` already
  exists as a starting point, generalize it beyond the chat page

### Phase 5 — Real-time push, stage one (single viewer) — backend half done
- **Done**: chat's SSE stream (`/api/chat/route.ts`) now carries real node
  references instead of a bare `{type:"knowledge_update", roomId}` marker.
  Two real event types emitted:
  - `event: "retrieval"` — fired as soon as context retrieval completes,
    `nodes` lists the real `memory:<id>`/`note:<id>` graph objects actually
    pulled into the prompt (not every candidate, only what was used).
    `retrieveContext()` didn't return ids at all before this — added them
    (additive, `id?` on memories since Redis-backed session-memory turns
    have no DB id and are correctly excluded, not faked).
  - `event: "conversation_turn"` — fired at turn end, `nodes` lists the real
    `chat_room:<id>`/`agent:<id>` objects. Deliberately does **not** claim a
    "memory write" pulse: this turn's messages aren't synced as graph
    objects and session memory is Redis-only/ephemeral, so there's no real
    node to reference for that yet — noted in code rather than faked.
  - Verified live: confirmed the enriched retrieval path executes cleanly
    end-to-end (with a real memory in the DB) before hitting the expected
    missing-API-key error — proves the new code runs without crashing.
    Payload-level inspection blocked on not having a live Anthropic key
    configured in this environment, same constraint as every other AI
    feature built this session.
  - Purely additive: the frontend's SSE type still only declares
    `{type, roomId}` and ignores the new `event`/`nodes` fields, so nothing
    consuming the old shape broke.
- **Still open**: implementing the light-language taxonomy (retrieval =
  blue pulse, memory write = purple, tool execution = orange, failure =
  red, success = green) as real frontend animation driven by these events
  — the backend now emits real data to drive it, but `GraphCanvas` doesn't
  consume `event`/`nodes` yet. That's the natural next slice.
- Tool-execution and failure/success events aren't emitted anywhere yet —
  there's no tool-calling in the current chat implementation to hook into.

### Phase 6 — Real-time push, stage two (multi-viewer fan-out)
- Redis pub/sub → SSE broadcast so any open graph view sees the same live
  activity, not just the triggering tab
- New infrastructure, sequence only after Phase 5 proves the event
  taxonomy and payload shape are right — don't build the hard distribution
  layer before the thing being distributed is settled

### Phase 7 — Intent Engine
- "Every object contains purpose" (goals, supporting nodes) needs new
  schema design — what a Goal node looks like, how it attaches to Brand/
  Agent/Project — **needs your input on scope before any schema work**,
  not a default

### Phase 8 — Adaptive OS recommendations
- Usage tracking (workflows, prompts, agent combos, graph paths) feeding
  human-approved suggestions — needs a decision on what's tracked and
  where suggestions surface before building; flagged, not defaulted

### Explicitly out of scope / blocked on separate work
- **Marketing/Cybersecurity/Organization Cluster Mode** — blocked on those
  workspaces getting real feature data first (unscoped, separate effort)
- **pgvector reinstatement** — deferred per decision #7 until a concrete
  feature needs semantic search
- **Legacy `workspaces/*` migration** — still frozen per
  `docs/LEGACY_WORKSPACES.md`; this plan doesn't change that

## Suggested next step

Phase 0 alone: retire the dead models, replace virtual Agent/ChatRoom
bridging with real persisted nodes, and build+prove `syncToGraph()` against
the `Agent` model. Nothing about rendering or real-time push should start
until there's one real, non-synthesized graph to render — building the
"universe" visualization on top of today's ephemeral bridge-on-read nodes
would mean animating something that doesn't actually persist.
