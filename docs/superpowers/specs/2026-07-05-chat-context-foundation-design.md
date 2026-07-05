# Chat Context Foundation — Design Spec

Date: 2026-07-05
Status: Approved (Phase 0 of "Chat is Core Shell" initiative)

## Background

Product decision: Chat is a Core Shell capability, not a workspace, not an
installable module, and not an AI Studio feature. It is the primary
conversational interface to Sentinel OS. Every module, workspace, project,
organization, agent, and memory system integrates with Chat instead of
building its own chat surface.

The full initiative (routing, automatic context inheritance, a shared
Context Service, Chat component decomposition, a Context Bar, contextual
knowledge scopes, a global Knowledge Graph with per-module filters, a
Cmd/Ctrl+K command palette, multi-agent room mechanics, and a unified voice
transport) is too large for one spec or one implementation pass. This
document covers only **Phase 0: the foundation** — the Context Service,
context-aware `/chat` routing, the Context Bar, the schema changes needed to
support workspace-scoped rooms and persisted scope, retiring the duplicate
legacy chat implementation, and wiring the Context Bar's scope selector into
real retrieval.

Later phases (not in this spec): Command Palette, automatic context
injection links from other modules ("Open in Chat"), KnowledgeGraphPanel /
SuggestedKnowledgePanel / AgentDock components, voice transport
unification, multi-agent room mechanics (add/remove/mute/promote/parallel/
round-robin/approval gates), and a real multi-tenant Organization model.

## Current State (verified in repo)

- `/chat` (`src/app/chat/page.tsx`, 564 lines) is already a top-level shell
  route, not nested under `/workspaces/*` — the routing decision is already
  half-implemented structurally.
- Partial component decomposition already exists:
  `src/components/chat/{ChatComposer,ChatHeader,ChatMessageList,ChatRoomList}.tsx`.
- A **duplicate, mock-data chat implementation** exists at
  `src/modules/chat/components/ChatPage.tsx` (953 lines), registered through
  the module manifest system (`src/modules/chat/manifest.ts`). This
  contradicts "chat is not an installable module" and must be retired.
- `ChatRoom` (prisma) has `id, name, projectId, userId, agentIds, createdAt`
  — no `workspaceId`, no persisted knowledge scope.
- `src/lib/knowledge/retrieval.ts` already implements real scope-ordered
  retrieval (`retrieveContext(ctx: RetrievalContext)`, scopes: session →
  project → workspace → organization → user → global) with strict project
  isolation. This is the Knowledge Engine's real retrieval boundary; Phase 0
  reuses it rather than replacing it.
- `src/app/api/chat/route.ts`'s `buildContextBlock` currently derives scope
  **only** from `room.projectId` and the agent's fixed `memoryScope` — there
  is no way for a client-selected scope to override this per-request.
- There is no `Organization` model in the schema. `organizationId` appears
  only as a loose, unindexed string on `KnowledgeObject`/`Memory` with no
  backing table. Per product decision, Phase 0 treats "Avraxe" as a static
  display label, not a switchable dimension — no schema change for it.
- Workspaces are global singletons (single-tenant), confirmed in prior work
  this session (default role/permission seeding).

## Design

### 1. Context Service (`src/lib/context/`)

- `types.ts` — the canonical shape:
  ```ts
  type KnowledgeScope = "conversation" | "project" | "workspace" | "organization" | "personal" | "global";
  interface AppContext {
    organizationName: string; // static, e.g. "Avraxe" — not persisted per-request
    workspaceSlug?: string;
    projectId?: string;
    agentId?: string;
    roomId?: string;
    moduleId?: string;
    knowledgeScope: KnowledgeScope;
  }
  ```
- `context-store.ts` — pure functions to read `AppContext` from a
  `URLSearchParams` and to serialize a partial `AppContext` back into
  `URLSearchParams`. No hidden state: the URL is the source of truth.
- `context-provider.ts` — a client React context (`ContextProvider`,
  `useAppContext()`) that:
  - hydrates from `useSearchParams()` on mount and on navigation,
  - exposes `setContext(partial: Partial<AppContext>)`, which merges into
    the current params and calls `router.replace` (shallow, no full
    reload),
  - is mounted once in the root shell layout so any module can call
    `useAppContext()`.

### 2. Routing

`/chat` accepts `?workspace=&project=&agent=&room=&scope=`. On mount,
`src/app/chat/page.tsx`:
1. Reads context via `useAppContext()`.
2. If `room` is present, loads that room directly.
3. Else if `workspace`/`project`/`agent` are present, resolves/creates (or
   finds the most recent matching) room scoped accordingly and updates the
   URL to include `room=` once resolved (so the URL is always a shareable,
   restorable link to that exact conversation).
4. `organization` is never a URL param — it's a constant read from env/config.

No other page moves. This is additive to the existing `/chat` page.

### 3. Schema changes

`ChatRoom` gains:
- `workspaceId String?` (FK to `Workspace`, `onDelete: SetNull`) — rooms can
  now be workspace-scoped directly, not only via a project.
- `knowledgeScope String @default("conversation")` — persists the
  last-selected scope for that room so reopening it restores the same
  retrieval breadth.

A **new** migration is added (not editing the earlier
`20260705010000_workspace_operating_model` migration further — that
migration is treated as closed since later, unrelated work (delegation)
already built on top of it in this session).

### 4. Context Bar (`src/components/chat/ContextBar.tsx`)

Rendered above the message list in `/chat`. Breadcrumb:

`Avraxe (static) > [Workspace ▾] > [Project ▾] > [Agent ▾] > [Scope ▾]`

- Each `▾` is a dropdown populated from existing data-fetching (workspaces
  list, projects list scoped to the selected workspace, agents list).
- Selecting an option calls `setContext()`; the resulting URL change is
  picked up by `/chat`'s effect to re-resolve/create the room per §2.
- The Scope dropdown offers the six `KnowledgeScope` values. Changing it:
  a) calls `setContext({ knowledgeScope })`, and
  b) persists it onto the current room (`PATCH` to update
  `ChatRoom.knowledgeScope`) so it's sticky per-room, not just per-tab.

### 5. Retiring the module-based chat

- Delete `src/modules/chat/` (manifest + `ChatPage.tsx`) entirely.
- Remove its registration from wherever the module registry surfaces it
  (module manifest list / any nav or module-manager reference) — confirmed
  before deletion that no other route depends on
  `src/modules/chat/components/ChatPage.tsx` (it's only reachable through
  the module system, not linked from `/chat` or any workspace page).
- No redirect needed: nothing else pointed at it as a distinct URL beyond
  the module system's own dispatch.

### 6. Retrieval wiring

`src/app/api/chat/route.ts`:
- Request body gains optional `knowledgeScope?: KnowledgeScope`.
- `buildContextBlock` is extended to accept it, and to read `room.workspaceId`
  (now available) alongside `room.projectId`.
- When `knowledgeScope` is provided, it overrides the agent's fixed
  `memoryScope` default for that single request only (the agent's own
  configured scope remains its default when the Context Bar hasn't been
  touched).
- `retrieveContext`'s existing `allowedScopes()` logic is unchanged — Phase
  0 only changes what context is passed in, not the Knowledge Engine's
  scope-ordering rules.

### 7. Documentation

`docs/CHAT_ARCHITECTURE.md` covering: why Chat is Core Shell, the Context
Service and its URL-as-source-of-truth model, context inheritance (Phase 0
gives manual selection via the Context Bar; automatic inheritance from
other modules is explicitly deferred to a later phase), the Knowledge
Engine boundary (graph/retrieval is owned by the Knowledge Engine, Chat is
a consumer), and a short "Roadmap" section listing what Phase 0 explicitly
does not cover.

## Error handling

- Unknown `workspace=`/`project=`/`agent=` slugs/ids in the URL: fall back
  to no selection for that segment (don't 404 the whole page) and surface a
  small inline notice in the Context Bar.
- `knowledgeScope` values outside the six allowed strings: reject at the API
  boundary the same way Task/Meeting/Approval status validation was added
  earlier this session (`assertOneOf`-style guard), not a silent fallback.

## Testing / Verification

No live DB access in this environment for `/chat` itself is bind-mounted to
the running containers, so verification is:
- `tsc --noEmit` and `eslint` clean (matches the standard already held for
  every change this session).
- `prisma generate` succeeds against the modified schema (validates the
  schema and migration are well-formed even without applying them to a live
  database).
- Manual code-path review of the new migration against `schema.prisma` for
  1:1 consistency (same approach used for the earlier `role_assignments`
  migration edits this session).

## Explicitly out of scope (future phases)

- Command Palette (Cmd/Ctrl+K)
- Automatic context inheritance links from other modules ("Open in Chat"
  injecting workspace/project/files/etc.)
- `KnowledgeGraphPanel`, `SuggestedKnowledgePanel`, `AgentDock` components
- Voice transport unification across typed/voice/phone/Teams-Slack
- Multi-agent room mechanics (add/remove/mute/promote lead/parallel/
  round-robin/human approval gates)
- A real, multi-tenant `Organization` model
