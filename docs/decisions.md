# Architecture Decision Records

Newest first. One entry per significant technical choice: the decision, why, and
what was rejected. No implementation detail — that belongs in the topic doc.

## ADR-009 — One release revision drives the app, the migration job and both workers

**Date:** 2026-10-09
**Status:** Accepted

**Decision.** Deploy, verify and roll back are one script (`scripts/deploy/release.sh`) that builds
`app`, `migrate`, `learning-worker` and `orchestration-worker` at a single sha, tags every image
`sentinel-os-<service>:<sha>`, and calls the release deployed only when each running container reports that
sha (env, image label, tag, health) and `/api/version` agrees. Any failure after services were replaced rolls
all of them back to the *exact images that were running*, pinned under `sentinel-os-rollback-*` tags before anything
was replaced — not rebuilt from the previous revision, whose compose file may not even define every service. Rollback never
runs or reverts a migration; migrations stay additive. Production deploys on `workflow_dispatch`, or on a push to
main while the repository variable `SENTINEL_AUTODEPLOY` is `true`, in addition to the `production`
environment's reviewers.

**Why.** The previous deploy rebuilt `app` and `migrate` only. The workers kept running images from days
earlier, with no revision, no CLI mounts (11 claude-code runs failed `binary_missing`), no route to the
Hermes dashboards, and credentials baked into their image layers. A deploy that can leave half the system
on old code and call itself green is not a gate.

**Rejected.** *A per-release checkout directory* — compose binds `./runtime-agents` and `./runtime-projects`
relative to the project directory, so moving it moves the credentials and agent data with it. *Tagging only
the app image.* *Making the workers `latest`.*

**Consequences.** Production today (an app built from an override of PR #41's commit, workers from another compose file)
can be restored exactly. Rebuilding from a revision that predates tagged images is verified by its app revision and
health only, and the script says so.

## ADR-008 — Retention is `memories.expiresAt`, not `validTo`

**Date:** 2026-10-09
**Status:** Accepted

**Decision.** A bot memory kept for N days gets `expiresAt = now + N days`. `validTo` keeps its bitemporal
meaning, "this belief was superseded". `excludeFromRetrieval()` hides a memory past `expiresAt` for every
question, historical ones included, and never makes a superseded, quarantined, forgotten or shadow memory
visible because it has a deadline.

**Why.** Retention was written into `validTo`, which every current-truth read treats as superseded, so a
memory kept for 30 days was invisible from the moment it was written.

**Rejected.** *Teaching every `validTo: null` filter about future dates* (a dozen sites, and a replacement
with a future `validFrom` legitimately closes its predecessor in the future).

**Consequences.** Migration `20261008000000_memory_expiry` adds a nullable column and moves bot rows that
carried a future `validTo` and no successor. The previous revision ignores the column, so rollback is safe;
under it retained memories fall back to its (broken) behaviour.

## ADR-007 — A runtime that will not confirm it stopped keeps its task open

**Date:** 2026-10-09
**Status:** Accepted

**Decision.** When Sentinel interrupts a bot's session (a denied tool, an approval gate, a user cancel) and the
runtime does not confirm, after bounded retries, the task stays in flight (`cancelling`, shown as running) with
its execution lease held. No approval is created, nothing is parked as waiting, and no replacement session can
start. A reconciler on the orchestration worker re-asks, and only a confirmation moves the task to what it
would have been.

**Why.** Marking such a task halted or waiting releases ownership while the original session may still be
running the very tool that was refused, and approving a waiting task would start a second session beside it.

**Rejected.** *Failing the task immediately* (still releases ownership). *Retrying forever in the executor*
(pins a worker slot).

## ADR-006 — `parentTaskId` is lineage, never authority

**Date:** 2026-10-09
**Status:** Accepted

**Decision.** Delegation is judged against the authenticated caller. `parentTaskId` is honoured only when that
caller is the bot executing the named task; any other caller naming it is refused with 403.

**Why.** Honouring it for any caller let an MCP client inherit a running bot's identity and its
`allowedChildBots` by naming that bot's task. **Consequence:** bot-to-bot delegation over MCP needs a
bot-bound credential, which does not exist yet; until then it is unavailable, not unsafe.

## ADR-005 — Hermes bots are governed personas on existing runtimes, not new processes

**Date:** 2026-09-30
**Status:** Accepted

**Decision.** A Bot (`bots` table) is a persona hosted on an existing, verified Hermes
runtime. Its tasks are ordinary `OrchestrationRun`s with `botId` set, so queueing, the
Redis lease, cancellation and audit are the existing ones. Bot memory goes through
`buildMemoryContext` / `remember()` with `Memory.botId` for attribution. Delegation is five
tools on the one SDK MCP server. See [BOTS.md](BOTS.md).

**Why.**
- Sentinel already owns durable execution, memory governance and the MCP surface; a second
  copy of any of them would drift.
- Spawning a container per bot needs Docker control and multiplies credentials for no gain
  a per-session model override and prompt do not already give.

**Rejected.**
- *A parallel bot task table and executor.* Would need its own lease, cancel and retry logic.
- *A separate bot memory store.* Explicitly ruled out; scope and retention are policy over
  the existing store.
- *Bot creation over MCP.* Creating bots and granting tools is an admin action in the UI only.

**Consequences.**
- Tool permissions are enforced by observing each tool call Hermes reports and interrupting
  the session on a denial. Hermes calls tools itself, so this is detect-and-halt, not
  pre-emptive; the prompt manifest is advisory. Ambiguous or unknown tool names are denied.
- Hermes ships tools that bypass Sentinel (`memory`, `delegate_task`, `cronjob`); the catalog
  marks them high risk and they are off unless granted.
- Bot tasks never retry after a session has started, because a retry could repeat tool effects.

## ADR-005 — Live voice runs on GPT-Live (`/v1/live/sessions`) with client delegation

**Date:** 2026-10-02
**Status:** Accepted (amends ADR-003's transport; its principle stands)

**Decision.** The live voice provider uses `POST /v1/live/sessions` with
`delegation: { type: "client" }`, exchanging the browser's SDP offer on the
server. Substantive turns arrive as `session.delegation.created` and are
answered with `session.commentary.append`.

**Why.**
- Gleam and Meridian, the chosen voices, are GPT-Live voices. `/v1/realtime`
  rejects them (verified), so the previous transport could not use them.
- Client delegation keeps ADR-003 intact: the live model has no backend of its
  own, and every turn runs on the agent's own model, memory and tools.
- Server-side offer exchange means the project key never reaches the browser;
  the old path minted an ephemeral token instead.

**Rejected.**
- *Responses delegation.* GPT-Live would call an OpenAI-hosted model for the
  turn, putting a different mind behind the agent's identity — what ADR-003
  exists to prevent.
- *Older realtime voices (marin, cedar).* Works on the old transport but is not
  the voice that was chosen.

**Consequences.** A delegation carries no text, so the request is rebuilt from
transcript fragments by timestamp, and transcripts may contain mistakes. The
separate transcription model setting was removed (GPT-Live streams its own
transcripts). Spoken context for short replies such as "yes" comes from the
room's history, so a call with no room has none.

## ADR-004 — A System 1 decision layer routes paths, never models

**Date:** 2026-09-26
**Status:** Accepted (amends ADR-003; does not supersede it)

**Decision.** Sentinel gains a System 1 layer (`src/lib/system-one/`, first
provider: TypeSafe's Jev via OpenRouter) that answers typed questions about a
request — intent, route, whether memory, a tool or real reasoning is needed —
in one batched call. It chooses between *paths*: answer from a read-only tool,
skip memory retrieval, or hand the turn to the agent's own runtime. It never
chooses *which model thinks*: `suggestedModel` is always the agent's configured
model, and the no-substitution guarantee in `model-policy` is unchanged. The
layer runs `off`, `shadow` (decides and records, controls nothing) or `active`,
per agent, and any failure falls back to today's path.

The one amendment to ADR-003: a spoken turn may be answered from a
deterministic, read-only tool result instead of a runtime turn. The live layer
speaks structured data it was handed; it still reasons about nothing, so the
"whose mind answers" rule holds — no mind answered.

**Why.**
- Most of the cost and latency of a turn like "what's checked out right now"
  is the agent's model deciding to call one read-only tool and then rephrasing
  its output. A calibrated classifier answers the routing question in ~100ms
  for a fraction of a cent.
- Confidence gates routing, never truth: nothing is ever *answered* by System
  1, only *routed*.
- Authorization stays deterministic. System 1 only ever chooses among tools
  the agent already holds a credential for, and only tools the tool's own
  server annotates `readOnlyHint: true` are eligible. Writes always go through
  the agent's runtime.

**Rejected.**
- *Per-request model selection, including tiers within an allowlist.* That is
  the automatic model swapping ADR-003 and `model-policy` forbid, and it would
  let spoken and typed turns of the same agent think with different minds.
- *System 1 synchronously in front of every request.* A slow classifier would
  make Sentinel slower than it was. It runs concurrently with read-only
  preparation, under a strict timeout and a circuit breaker.
- *Reusing `learning/feature-flags` for the mode.* `evaluateFlag` writes on
  every read and is boolean; mode is env-resolved per agent instead.

**Consequences.** One additive table (`system_one_decisions`). A fast path for
a tool needs every required argument to be enumerable, because System 1
chooses and cannot extract free text; "tools assigned to Nick" still reaches
the runtime. Savings in dollars are null for any model without a rate card
entry, which today includes both Hermes agents' models.

## ADR-003 — The live voice model carries audio; the agent's own model thinks

**Date:** 2026-09-22
**Status:** Accepted

**Decision.** GPT-Live-1 is the conversational audio layer for Hermes Lisa and
Hermes Nathan2 and holds no reasoning authority. It is given one tool,
`sentinel_reasoning`, which routes the turn through `routeRuntimeChat()` — the
same entry point a typed message uses. Voice and text therefore share one
conversation, memory, permission model and tool path. Per-agent voice and
reasoning configuration is declarative in `src/lib/voice/agent-voice-config.ts`.
See [voice/GPT_LIVE_ARCHITECTURE.md](voice/GPT_LIVE_ARCHITECTURE.md).

**Why.**
- The previous design let the live model answer directly and "escalate" to a
  larger realtime model for hard turns. That put two different minds behind one
  identity, neither being the agent's configured brain, and neither able to
  reach its memory, MCP tools or permissions. Spoken Lisa and typed Lisa were
  not the same agent.
- Routing every substantive turn out of the live layer is the only way the two
  stay identical, and it means no voice-specific memory or tool system has to
  exist to be kept in sync.
- Identity must be named, never inferred. Four separate code paths silently
  substituted Lisa when no agent was given; each is now a refusal, and
  `VoiceControls`' `agentId` is required so omission is a compile error.

**Rejected.**
- *Keeping realtime-model escalation.* It is a quality dial on the wrong axis:
  the question is never "how hard is this turn" but "whose mind answers it".
- *A voice-specific memory or tool surface.* Two systems to keep in sync, and
  the spoken agent would drift from the typed one.
- *Letting the session request name a reasoning model.* That is precisely the
  automatic model swapping between the two agents that must not be possible.

**Consequences.** One additive table (`voice_session_telemetry`), which keeps
live audio minutes and reasoning tokens separate because they are billed
differently. `estimatedCostUsd` is null for models with no rate card entry —
currently both agents' — because a confident zero is worse than an honest gap.
The live provider's model and voice ids (`gpt-live-1`, `gleam`, `meridian`) are
configuration. (Verified against the live API on 2026-10-02; see ADR-005, which
also moved the transport.)

## ADR-002 — An unscoped client registration ceilings at every scope, not read-only

**Date:** 2026-09-22
**Status:** Accepted

**Decision.** When a client registers without naming scopes, its ceiling is the
full scope list. The set that arrives pre-ticked on the consent screen stays
read-only, and the two now live in separate constants (`DEFAULT_CLIENT_SCOPES`
vs `PRE_TICKED_SCOPES`). See [MCP_GATEWAY.md](MCP_GATEWAY.md).

**Why.**
- ChatGPT's dynamic registration sends no `scope`. Under the old shared
  constant its ceiling came out read-only, and since the consent screen can
  only offer the ceiling, `sentinel:tasks.write` was never displayed and never
  grantable. `sentinel_create_task` was unreachable by construction — a
  capability the operator believed was shipped but no human could switch on.
- A ceiling is not a grant. ADR-001 already established that registration
  grants nothing; widening it moves no authority, because every scope still
  has to be ticked by a signed-in human for one named workspace.
- Splitting the constants makes the conflation unrepeatable: widening what a
  client *may* ask for can no longer quietly widen what a human is nudged to
  approve.

**Rejected.**
- *Pre-ticking write once the ceiling widened.* That would trade a capability
  bug for a consent bug — the human would grant task creation by not reading.
- *Special-casing ChatGPT's client name at registration.* Tools are gated on
  scopes, never on client identity; an allowlist of names would reintroduce
  exactly the coupling the scope model exists to avoid.
- *Telling operators to pre-register ChatGPT with an explicit scope string.*
  Defeats dynamic registration, and silently fails open to read-only for
  anyone who skips the step.

**Consequences.** No migration and no token format change. Existing grants are
unaffected; clients registered before this keep their stored read-only ceiling
and must re-register (in ChatGPT, remove and re-add the connector) to be
offered write.

## ADR-001 — External MCP gateway authenticates with OAuth 2.1, not a shared token

**Date:** 2026-09-17
**Status:** Accepted

**Decision.** Sentinel acts as an MCP *server*. External clients (ChatGPT first)
authenticate with OAuth 2.1 — authorization code + PKCE S256, dynamic client
registration, rotating refresh tokens — and every tool call is gated on scopes a
human consented to for their Sentinel identity. See
[CHATGPT_INTEGRATION.md](CHATGPT_INTEGRATION.md).

**Why.**
- ChatGPT connectors expect discovery + OAuth; a static token would require every
  user to hand-copy a secret, and there is no consent step to scope it.
- Scopes make the blast radius a decision the human makes, not a property of the
  deployment. A connector can be given search without ever being able to write.
- Per-grant revocation is immediate because access tokens carry their grant id and
  the grant is loaded on every request.

**Rejected.**
- *Static bearer token with a scope list* (the `avraxeai-gateway-secret` pattern
  used for the agent gateway). Faster to ship, but single-tenant in practice, no
  per-client revocation, and no consent surface — the operator, not the data owner,
  would be deciding what an external LLM may read.
- *Reusing the mobile bearer token.* It identifies a user with full app authority;
  handing that to a third-party connector is the opposite of scoping.
- *Sentinel as MCP client instead.* A different product, not this one: the ask was
  to expose Sentinel's tools outward.

**Consequences.** The SDK-backed server at `/api/mcp` and the OAuth implementation
under `/api/integrations/oauth/*` are the canonical public surface. `AUTH_URL`
defines the trusted public origin. Legacy `/api/mcp/oauth/*` and `/mcp/authorize`
URLs are compatibility aliases only and contain no independent protocol logic.
