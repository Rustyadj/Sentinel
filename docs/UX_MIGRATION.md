# Sentinel shell restructuring — migration map

Backend, data and APIs are the source of truth for functionality. This document
covers only the product shell.

## Audit: what exists today

30 page routes, 13 module manifests, one dark shell
(`components/layout/AppShell` = TopBar + Sidebar + ModuleTabs + RightPanel +
StatusBar). Chat was `/chat` → `CollaborationRoom`, and `/` was Mission Control.
Chat behaviour (rooms, SSE streaming, agent mentions, knowledge candidates)
lives in `src/lib/chat/useChatSession.ts` and is fully reusable — it was reused
verbatim, not rewritten.

## Target information architecture

| Surface | Route | Meaning |
| --- | --- | --- |
| Chat | `/` and `/chat` | interaction (default landing) |
| Graph | `/graph` | understanding |
| Workspaces | `/agent-workspaces` | execution |
| Agents | `/agents` | management |
| Activity | `/activity` | accountability |

Global, never primary: search/command palette (⌘K), settings.
Projects, files, memories, tools, conversations, sources, tasks, decisions and
artifacts are objects surfaced contextually — not destinations.

## Consolidation decisions

| Old surface | Disposition |
| --- | --- |
| Mission Control (`/`) | no longer the landing page; still at `/dashboard` pending fold-in to Activity + Agents |
| CollaborationRoom chat | moved to `/chat/classic`, retained only until the Graph space and collaboration lanes it still owns are ported |
| Neural Lens | already a redirect; folds into Graph |
| Memory / Knowledge / Projects / Tasks pages | remain routable; become contextual objects reached from Chat, Graph and the palette |
| Legacy dark shell | unchanged for unmigrated routes; dark tokens now scoped to `.sentinel-app-shell` |

## Theme

`:root` is now the light system (warm neutral canvas, white surfaces, soft
shadows, few borders) plus semantic entity and status tokens. The previous dark
values were moved verbatim under `.sentinel-app-shell`, so every unmigrated
screen renders exactly as before while new surfaces are light.

## Phase 1 — delivered

New shell (`src/components/shell/`): `AppShell`, `NavRail`, `TopBar`,
`AgentSelector`, `ContextChip`, `ConversationDrawer`, `CommandPalette`,
`ContextInspector`, shared primitives, `useShellShortcuts`, `useShellStore`.
New chat surface (`src/modules/chat/components/surface/`): `ChatSurface`,
`ConversationMessage`, `Composer`.

Shortcuts: ⌘/Ctrl+K palette, ⌘/Ctrl+N new chat, ⌘/Ctrl+Shift+G graph,
⌘/Ctrl+Shift+W workspaces, ⌘/Ctrl+Shift+O conversations, Escape closes.

## Phase 2 — delivered (graph)

Scoped retrieval (`src/lib/graph/scoped.ts`) plus three routes:
`/api/graph/scoped` (bounded entry view or depth-limited neighbourhood around a
focus), `/api/graph/search`, `/api/graph/node/[id]`. Access is the existing
knowledge rule — the caller's own objects plus readable projects — and every
read is capped (default 120 nodes, hard ceiling 400). There is no "load
everything" mode.

Visual language lives in `src/lib/graph/semantics.ts`: entity type maps to a
semantic cluster, cluster maps to a `--entity-*` token, node radius comes from
degree, glow from recency, link width from edge weight. No colour literals in
components.

Surface (`src/modules/graph/components/`): `GraphSurface`, `GraphCanvas`
(2D canvas on a light ground, curved links, animated particles only on strong
edges), `GraphControls` (collapsing search + cluster filters + time window),
`GraphNodeInspector` (opens in the shell inspector), `useGraphData`
(progressive expansion — clicking a node merges its neighbourhood into the
current view rather than refetching the world). `prefers-reduced-motion` is read
through `useSyncExternalStore` and disables particles, drag and animated zoom.

Nodes with neighbours that have not been loaded carry a small marker, so an
unexpanded node never reads as a leaf. Connections to objects the caller cannot
read are counted, never shown.

## Phase 3+ — not started

Graph redesign (light canvas, semantic clusters, scoped retrieval, progressive
expansion, node inspector, temporal modes), workspace UX polish, agent
management redesign, unified activity stream, deletion of `/chat/classic`,
`/dashboard` and the legacy shell once their capabilities are ported.

## Honest gaps in Phase 1

* Composer "+" lists attach / project / workspace / tool as **unavailable** —
  they are not wired to this surface yet and do nothing rather than pretending.
* The legacy `KnowledgeGraph` component (and its env-gated
  `NEXT_PUBLIC_GRAPH_DEMO` sample data) is still used by `/chat/classic`; it is
  removed when that route goes.
* Temporal windows filter by object creation time only. Sentinel does not yet
  record "became stale" or "became connected" transitions, so the graph offers
  no control that would imply it does.
* Inspector opens for conversations and agents; per-type bodies come with the
  surfaces that own them.
