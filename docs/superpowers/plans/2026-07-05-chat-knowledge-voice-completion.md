# Chat/Knowledge/Voice Completion (Half B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Phase 2 (multi-agent chat) and Phase 3 (knowledge graph) work already scaffolded in the tree, and make voice input real instead of mock-by-default.

**Architecture:** Extend the existing `src/lib/knowledge/*` and `src/lib/voice/*` modules in place, following their established conventions (small file-per-responsibility, Prisma via `src/lib/db`, no test framework in this repo — verify via `npm run build`/`npm run lint` and manual exercise per the `verify` skill, not new unit tests).

**Tech Stack:** Next.js App Router, Prisma/Postgres, ioredis (`src/lib/redis.ts` already has get/set/del/keys helpers), Anthropic/OpenAI SDKs.

---

### Task 1: Real extraction instead of mock-by-default

**Files:**
- Modify: `src/lib/knowledge/extraction.ts:15-23`
- Modify: `src/app/api/knowledge/candidates/route.ts` (wherever it currently sources `anthropicKey` from)

- [ ] Change `extractCandidates` to accept the key from `process.env.ANTHROPIC_API_KEY` server-side as a fallback when no per-request key is supplied, instead of silently going to `getMockCandidates`. Keep `getMockCandidates` only as the true last-resort (no key anywhere, or parse failure).
- [ ] Update the `candidates` API route to pass `params.anthropicKey ?? process.env.ANTHROPIC_API_KEY` through.
- [ ] Run `npm run lint` and manually hit the candidates endpoint in a running dev server to confirm real Claude output appears when `ANTHROPIC_API_KEY` is set in env.
- [ ] Commit: `fix(knowledge): use server-side Anthropic key for extraction, mock only as last resort`

---

### Task 2: `projectId` on Memory/Decision + fix retrieval.ts isolation

**Files:**
- Modify: `prisma/schema.prisma` (`Memory` model, `Decision` model)
- Create: `prisma/migrations/<timestamp>_memory_decision_project_scope/`
- Modify: `src/lib/knowledge/retrieval.ts:44-105`

- [ ] Add `projectId String?` to `Memory` and `Decision` models in `prisma/schema.prisma`, plus an `@@index([projectId])` on each.
- [ ] Run `npx prisma migrate dev --name memory_decision_project_scope` to generate the migration and regenerate the client.
- [ ] Rewrite the memory query in `retrieveContext` to filter `projectId: ctx.projectId` when scope is `"project"` (OR `projectId: null` for global-scope memories), removing the TODO at line 47.
- [ ] Rewrite the decision query to filter the same way instead of returning `[]` whenever `ctx.projectId` is set, removing the TODO at line 93.
- [ ] Update `src/lib/knowledge/objects.ts` / wherever memories and decisions are created to accept and persist `projectId` when the creating context has one (e.g. `acceptCandidate` in `extraction.ts:150-188` should pass `projectId` through when creating Decision-type candidates — note `createKnowledgeObject` already takes scope/projectId, but the underlying `Memory`/`Decision` rows created via other paths need it too).
- [ ] Commit: `feat(knowledge): add projectId to Memory/Decision, enforce real project isolation in retrieval`

---

### Task 3: Wiki-link parsing + backlinks for ObsidianNote

**Files:**
- Create: `src/lib/knowledge/wikilinks.ts`
- Modify: wherever `ObsidianNote` is created/updated (find the notes API route under `src/app/api/`)

- [ ] In `src/lib/knowledge/wikilinks.ts`, write `parseWikiLinks(content: string): string[]` — regex `/\[\[([^\]]+)\]\]/g`, return the matched titles (trimmed, deduped).
- [ ] Write `resolveBacklinks(noteId: string, title: string, content: string): Promise<void>` that: parses outgoing links from `content`, looks up matching `ObsidianNote` rows by `title`, and updates each target note's `backlinks` array to include this note's id (dedupe, and remove this note's id from notes it no longer links to — diff old vs new).
- [ ] Call `resolveBacklinks` from the note create/update API route after every save.
- [ ] Commit: `feat(knowledge): wiki-link parsing and backlink resolution for notes`

---

### Task 4: Note templates + tag filtering + full-text search

**Files:**
- Create: `src/lib/knowledge/templates.ts`
- Create: `src/app/api/knowledge/search/route.ts`
- Modify: notes API route (add `?tags=` filter support)

- [ ] `templates.ts`: export a static `NOTE_TEMPLATES` array (e.g. "Meeting Notes", "Decision Record", "Project Brief") each with a title pattern and starter `content` string containing `[[links]]`-style placeholders. Export `applyTemplate(templateId, vars)`.
- [ ] `search/route.ts`: `GET` handler that takes `?q=` and does `db.obsidianNote.findMany({ where: { OR: [{ title: { contains: q, mode: "insensitive" } }, { content: { contains: q, mode: "insensitive" } }] } })`, plus a matching search over `KnowledgeObject.title`/`summary`. Merge and return ranked by simple substring match count.
- [ ] Add `tags` query param filtering (`tags: { hasSome: tagList }`) to the existing notes list route.
- [ ] Commit: `feat(knowledge): note templates, tag filtering, full-text search endpoint`

---

### Task 5: `memoryScope` enforcement in chat

**Files:**
- Modify: `src/app/api/chat/route.ts`

- [ ] Before calling the provider, look up the `Agent` row for `agentId` and read `memoryScope`. Call `retrieveContext` (from `src/lib/knowledge/retrieval.ts`) with a context built from `{ userId, roomId (as session), projectId: room.projectId }` restricted to the agent's `memoryScope` (i.e., if `memoryScope === "session"`, only pass session-scoped items in; don't fetch project/global if the agent is session-scoped).
- [ ] Inject retrieved memories/notes/decisions into the system prompt (append a "Relevant context" block) instead of only using the static `agentTemplate.systemPrompt`.
- [ ] Commit: `feat(chat): enforce agent memoryScope when injecting retrieved context`

---

### Task 6: Real agent-to-agent messaging on @mention

**Files:**
- Modify: `src/app/chat/page.tsx` (`parseMention`, send handler)
- Modify: `src/app/api/chat/route.ts`

- [ ] When a user message mentions a second agent (`@AgentName`) in a room that has that agent in `agentIds`, after the first agent's response completes, automatically issue a second `POST` to `/api/chat` with the mentioned agent as `agentId` and the running transcript (including the first agent's reply) as `messages`, tagging the persisted `Message.agentId` accordingly so it's visible as a distinct participant in `ChatMessageList`.
- [ ] Guard against infinite loops: only trigger one hop per user message (don't let agent replies trigger further mentions).
- [ ] Commit: `feat(chat): real agent-to-agent handoff on @mention`

---

### Task 7: Presence indicators

**Files:**
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/components/chat/ChatMessageList.tsx` or `ChatHeader.tsx`

- [ ] Emit an SSE event `{ type: "presence", agentId, status: "thinking" }` at the start of the stream and `{ type: "presence", agentId, status: "idle" }` in the `finally` block (alongside the existing `knowledge_update` event).
- [ ] In the chat page's SSE consumer, track a `presence: Record<agentId, status>` map and pass it down so `ChatMessageList`/`ChatHeader` can show a "thinking" indicator next to the relevant agent's avatar.
- [ ] Commit: `feat(chat): presence indicators via existing SSE stream`

---

### Task 8: Redis-backed session memory

**Files:**
- Modify: `src/app/api/chat/route.ts`
- Reuse: `src/lib/redis.ts` (already has `redisGet`/`redisSet`/`redisDel`)

- [ ] After each successful response, append `{ role, content }` to a Redis list/JSON blob at key `session:${roomId}:memory` via `redisSet` with a TTL (e.g. 6 hours), capped to the last ~20 turns.
- [ ] In `retrieveContext` (or a new `retrieveSessionMemory(roomId)` in `retrieval.ts`), read that key and fold it into the `memories` array with `scope: "session"` when present, so ephemeral session memory survives across requests within the TTL without needing a DB write.
- [ ] Commit: `feat(chat): Redis-backed ephemeral session memory`

---

### Task 9: Voice provider — real by default

**Files:**
- Modify: `src/lib/voice/providers/index.ts:5-13`
- Modify: Settings page (find where API keys / integrations are configured, likely `src/app/settings/page.tsx`)

- [ ] Change `createVoiceProvider()` default from `MockVoiceProvider` to `BrowserSpeechProvider` (Web Speech API needs no server key and already exists as a real implementation) — keep `mock` selectable only as an explicit opt-in for environments without mic access (e.g. `NEXT_PUBLIC_VOICE_PROVIDER=mock`).
- [ ] Add a simple provider selector in Settings (dropdown: Browser Speech / Mock) that writes to the same env-driven config path already read by `createVoiceProvider` (if it's build-time only, instead read from `localStorage` at call time and fall back to the env var — check `browserSpeech.ts` for what config shape `VoiceDock` already passes).
- [ ] Commit: `fix(voice): default to real browser speech provider instead of mock`

---

## Self-review

- Every roadmap Phase 2/3 item assigned to Half B has a task: multi-agent messaging (6), presence (7), session memory (8), memory injection at prompt time (5) — Phase 2 covered. Wiki-links (3), backlinks (3), note templates (4), tags (4), full-text search (4) — Phase 3 covered.
- No test-framework introduction — repo has none; verification is build/lint/manual per existing convention, consistent with `verify` skill guidance to exercise the real flow.
- Tasks are ordered so schema change (Task 2) lands before anything that depends on `projectId` (Task 5 references retrieval).
