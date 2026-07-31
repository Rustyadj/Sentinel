# Agent Operations Center — Build Plan

Source spec: "Sentinel OS — Agent Operations Center" product spec provided
2026-07-26 (not committed verbatim — this doc is the scoped, buildable version).

This is a **redesign of an existing core module** (`agents`, category `core`,
cannot be disabled, always in the nav rail) — unlike Creator Studio, there is no
"leave it alone" option here. The current implementation is what's being
replaced.

## Critical finding: three disconnected "agent" systems exist today

Before any visual redesign, this has to be resolved — an animated Ops Center
built on top of three data sources that don't talk to each other would be a
demo, not "complete visibility." Confirmed by reading the actual code, not
assumed:

| Layer | What it is | Where | Backs today |
|---|---|---|---|
| **A — Client mock** | `useAgentStore`, a Zustand store seeded once from static `AGENT_TEMPLATES` (`src/lib/constants.ts`). No persistence, no server round-trip. | [`src/store/useAgentStore.ts`](../src/store/useAgentStore.ts) | The **live** `/agents` page today ([`src/app/agents/page.tsx`](../src/app/agents/page.tsx)) |
| **B — DB model, orphaned** | Prisma `Agent` model, seeded from the same `AGENT_TEMPLATES` on first `GET`. Has real relations (`RoleAssignment`, `ApprovalRequest.requesterAgent`, `Task.agentId`) that Layer A can't see. | `/api/agents` ([`route.ts`](../src/app/api/agents/route.ts)) | **Nothing.** No UI calls `/api/agents` today. |
| **C — VPS process registry, orphaned** | Hardcoded array of 3 real infrastructure agents (`hermes-lisa`, `hermes-clint`, `openclaw`) with real ops: health, restart, reload, logs, config-file editing, permission-gated via `getControlPlaneUser`/`canViewAgent`. | [`src/lib/agents/registry.ts`](../src/lib/agents/registry.ts), `/api/agents/[id]/{health,restart,reload,logs,config-files}` | **Nothing renders it.** `src/modules/agents/components/AgentsPage.tsx` (486 lines, the more sophisticated implementation) calls this API but is never imported by any route — it's dead code sitting next to the module manifest that claims to back `/agents`. |

Notable: `"hermes-lisa"` is the **same conceptual agent** in both Layer A/B
(a chat persona: "Chief Orchestrator") and Layer C (a real VPS process with a
health endpoint and restart button) — currently two unrelated records with the
same id, in two systems that never cross-reference each other.

### Consolidation decision (must happen before the redesign, not after)

Make Prisma `Agent` (Layer B) the single canonical identity for every agent,
persona or infrastructure:

- Add optional process-binding fields to `Agent` (e.g. `vpsEndpoint`,
  `vpsConfigPath`, `vpsLogPath`, `dashboardPort`) so infra agents like
  Hermes Lisa are one row with both persona data (system prompt, skills,
  memory scope) and process data (health/restart target), not two.
- Retire `useAgentStore` as the source of truth. It can remain as a thin
  client cache, but the live `/agents` page must read from `/api/agents`
  (Layer B), not a seed-once local store — "complete visibility" is
  impossible over client-only mock state.
- Retire the static `REGISTRY` array in `registry.ts` in favor of DB rows;
  keep the file's *permission-gating logic* (`getControlPlaneUser`,
  `canViewAgent`) since that's real access-control code worth preserving,
  just repoint it at the DB.
- Delete or resurrect `src/modules/agents/components/AgentsPage.tsx` as a
  deliberate choice, not by omission — its health/restart/reload/logs/config
  UI is the best existing building block for the new Overview + Tools tabs and
  should be salvaged into the new design rather than rebuilt from scratch.

## Reuse map — don't rebuild what already exists

- **Hero Agent Graph**: `react-force-graph-2d`, already a dependency and
  already proven for exactly this visual grammar (force-directed nodes,
  pulsing/arriving-node halos, dynamic import with `ssr: false`) in
  [`src/components/home/LiveKnowledgeGraph.tsx`](../src/components/home/LiveKnowledgeGraph.tsx)
  (384 lines) and [`KnowledgeGraphPanel.tsx`](../src/components/knowledge/KnowledgeGraphPanel.tsx).
  Adapt this component rather than building a new graph renderer.
- **Agent Formations + Workflow Replay canvases**: `@xyflow/react`, already
  used by the Workflows module for node/edge editing — a better fit than
  force-graph for these since formations/replays are ordered DAGs, not free
  clusters.
- **Conversation tab**: `ChatRoom` (has `agentIds String[]` already — the
  Phase 2 roadmap item "multi-agent chat rooms" is half-modeled) + `Message`
  (has `agentId`, `toolCalls Json?`, `reasoning String?` — delegation/tool/
  reasoning-summary display needs no new columns, just UI that reads them).
- **Tasks tab**: `Task.agentId` relation already exists.
- **Memory tab**: `Memory` model exists (scope, importanceScore, confidence,
  source, pinned) but `owner` is a bare string with no FK — needs an
  additive `agentId String?` column to reliably filter "this agent's
  memories" instead of string-matching `owner`.
- **Knowledge Integration**: `KnowledgeObject`/`KnowledgeEdge` (pgvector-backed,
  already used by the Knowledge module) — highlighting an agent's nodes is a
  filtered query, not new infrastructure.
- **Human Approval Queue**: `ApprovalRequest.requesterAgentId` already exists
  — but `workspaceId` on that model is **required, not nullable**. Every
  approval must belong to a workspace today. Agent-originated approvals that
  aren't tied to a real workspace need a decision (see below) before this tab
  can be built — not silently worked around.

## Real-time requirement — needs an explicit decision, not a default

The spec repeatedly demands live behavior: "Updates stream in real time,"
"Charts update live," "Messages animate." `ioredis` is already a dependency
(used for session memory per `docs/ROADMAP.md` Phase 2), which makes
Redis pub/sub → SSE a natural fit, but that's real infrastructure work, not a
styling change.

Recommendation: ship early phases on **polling** (2–5s interval, matching this
codebase's existing `fetch`-in-`useEffect` convention throughout Creator
Studio and elsewhere) to prove the data model and UI first, and add a real
SSE/WebSocket push layer as its own later phase once there's something
real to stream. Don't build streaming infrastructure before the thing it
would stream exists.

## Phased delivery

### Phase 0 — Consolidate the three agent layers ✅ done
Executed as a proper identity/control-plane hub, not a flat row with bolted-on
fields — per explicit direction, volatile runtime metrics were kept out of
`Agent` entirely:

- **`Agent`** — trimmed to pure identity: name, role, avatar, color,
  description, `skills` (capabilities), a coarse hand-set/derived `status`,
  `ownerId`, `version`, `promptVersion`. No model/prompt/tool-permission
  fields left on it.
- **`AgentConfiguration`** (1:1) — everything that used to live flat on
  `Agent`: `model`, `systemPrompt`, `memoryScope`, `instructionFiles`,
  `promptHistory`, plus new `temperature`, `reasoningMode`, `workspaceAccess`,
  `allowedTools`, `allowedMcpServers`, `budgets`, `rateLimits`.
- **`AgentInstance`** (1:many) — replaces the static VPS `REGISTRY` array:
  `kind`, `type`, `provider`, `authMode`, `model`, `endpoint`, `configPath`,
  `logPath`, `dashboardPort`, `vpsWorkspaceTag`, `enabled`.
- **`AgentHealthCheck`** — discrete check results (status/latency/details),
  explicitly *not* a metrics time series.
- **`AgentEvent`** — append-only event history for the future activity
  feed/replay work.
- New `src/lib/agents/seed.ts` (`ensureAgentsSeeded()`) merges the two old
  static sources by id: `AGENT_TEMPLATES` → `Agent` + `AgentConfiguration`,
  then the old VPS registry entries → `AgentInstance` attached to the *same*
  row where ids overlap (confirmed live: `hermes-lisa` and `openclaw` each
  end up as one row with a persona configuration **and** a bound instance,
  not two records — the persona's description wins since personas seed
  first and the instance pass no-ops on an existing identity).
- `registry.ts` rewritten as async DB reads (`getAllVpsAgents`, `getVpsAgent`,
  `isAllowedVpsAgentId`), permission-gating logic in `permissions.ts`
  untouched. All 8 consumers (health/restart/reload/logs/config-files ×2/
  ready/vps-agents routes) updated to `await`.
- **Critical correctness fix**: `/api/chat/route.ts` previously always read
  `dbAgent` as `null` in practice — nothing ever called the seed path before
  it, so real chat completions silently ran entirely on the static
  `AGENT_TEMPLATES` fallback. Now calls `ensureAgentsSeeded()` first and reads
  `dbAgent.configuration.{model,systemPrompt,memoryScope}` — verified live via
  SSE that the request pipeline resolves correctly before failing cleanly on
  the (expected, unrelated) missing-API-key check.

**Scope adjustment made during execution, flagged rather than silently
dropped**: repointing the live `/agents` page off `useAgentStore` was
originally listed under Phase 0. Investigation showed `useAgentStore` and
`AGENT_TEMPLATES` are pure client-side constants never touched by this schema
change, and the page's only relocated-field usage is a display-only
`.model` read in two other components (`ChatPage.tsx`, `DashboardPage.tsx`).
Repointing the UI is a separate, larger visual-layer task — folded into
Phase 1 (which already covers building real UI on top of real data) instead
of done here. Nothing broke by deferring it; it just wasn't attempted.

**Not done, unchanged**: the fate of the orphaned
`src/modules/agents/components/AgentsPage.tsx` (486-line VPS ops UI) is still
undecided — its backing API routes now read from the DB correctly, but the
component itself isn't wired into any route yet. Still recommend salvaging it
into Phase 3 rather than rebuilding its health/restart/logs/config UI from
scratch.

### Phase 1 — New shell: toolbar, filters, Mission Strip, agent list
- Search + status filters (All/Online/Working/Waiting/Needs Approval/Errors/
  Offline/Pinned) over the consolidated `Agent` rows
- Mission Strip (small status cards, click to focus) — reads the same list
- Still a plain list/grid at this point, not the graph yet — prove the
  filtered, real data layer before the hero visual goes on top of it

### Phase 2 — Interactive Agent Graph (hero)
- Adapt `LiveKnowledgeGraph`'s `react-force-graph-2d` setup: nodes = agents,
  links = derived from `ChatRoom.agentIds` co-membership and `Task.agentId`
  delegation, initially a static/polled snapshot (no live animation yet)
- Click node → opens the context panel (Phase 3), reusing the existing
  slide-in panel pattern from today's `/agents` page

### Phase 3 — Context panel: Overview, Configuration, Tools tabs
- Lowest lift, mostly static/config reads: model, workspace, capabilities,
  owner, version, prompt version — straight `Agent` row fields plus the
  salvaged Tools-tab data from Phase 0's retained health/restart code
- Health/restart/reload/logs/config-file editing for infra-bound agents
  (those with `vpsEndpoint` set) reuses the salvaged Phase 0 component

### Phase 4 — Conversation, Memory, Knowledge Integration tabs
- Conversation tab reads `ChatRoom`/`Message` filtered by agent, rendering
  `toolCalls`/`reasoning` as the spec's "summarized reasoning, not
  chain-of-thought"
- Memory tab: add `agentId` to `Memory` (additive), reuse Knowledge module's
  existing retrieval/scope UI patterns rather than building new ones
- Knowledge Integration: filtered `KnowledgeObject`/`KnowledgeEdge` query,
  highlighted in the Phase 2 graph or a secondary panel

### Phase 5 — Performance tab, Live Activity Feed, Live Status Bar
- First real "live" surface — ship on polling per the recommendation above
- Performance metrics (tasks completed, success %, avg runtime/cost/tokens)
  need aggregation queries over `Task` and whatever cost/token logging exists
  today — **audit needed**: confirm whether token/cost is logged anywhere
  currently (not found in this pass) before promising real numbers here

### Phase 6 — Human Approval Queue
- Resolve the `ApprovalRequest.workspaceId` requirement first: either
  introduce a system/default workspace for agent-originated approvals, or
  loosen the column to nullable (a shared-table change — flag it the same
  way Creator Studio flagged `Task`/`Document` changes, don't do it silently)
- Diff viewer, approve/reject/edit/comment/retry/escalate over the resolved
  model

### Phase 7 — Workflow Replay
- The existing `Workflow` model stores *definitions* (nodes/edges a user
  authored), not *execution history* — a replay timeline needs a new
  execution-log concept (e.g. `WorkflowRun` + ordered `ReplayEvent` rows),
  not a repurposing of `Workflow` itself
- Render with `@xyflow/react` per the reuse map above

### Phase 8 — Agent Formations
- New `Formation` model (named, versioned, shareable node graphs of agents)
- Builder UI on `@xyflow/react`, drag-to-compose per the spec's example
  (Lisa → Marketing → SEO → Claude Code → Designer → Publisher → Analytics)

### Phase 9 — Health Dashboard (CPU/GPU/RAM/Storage/Network/Docker/Redis/Postgres)
- The most infrastructure-heavy phase — no existing metrics collection exists
  in this codebase today. Needs a decision on collection method (host-level
  agent, Docker stats API, `/proc` reads from the Next.js server, etc.)
  before UI work starts. Sequence last; don't guess at a collection strategy.

### Phase 10 — Agent Marketplace (Installed/Updates/Templates/Community)
- "Community" implies some notion of sharing across tenants/users — same
  category of decision as Creator Studio's deferred platform-OAuth question.
  Needs your call on scope before committing schema; "Installed/Templates"
  alone (no real community backend) is a much smaller, shippable slice.

## Explicitly deferred / needs a decision, not a default

- **Real-time transport** (polling vs. SSE vs. WebSocket) — recommended:
  polling first, see above
- **`ApprovalRequest.workspaceId` nullability** — blocks Phase 6 until decided
- **Fate of `src/modules/agents/components/AgentsPage.tsx`** — salvage
  (recommended) vs. delete, blocks Phase 0
- **System metrics collection method** — blocks Phase 9
- **Marketplace "Community" scope** — blocks Phase 10

## Suggested next step

Phase 0 alone, as its own PR: consolidate the three agent layers into one
canonical `Agent` model and repoint the live `/agents` page at it. Nothing
about the visual redesign should start until an agent selected in the UI is
the same row everywhere — chat, tasks, approvals, and infra ops alike.
