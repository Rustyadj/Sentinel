# Hermes bots

A bot is a specialised persona (instructions, model, skills, tool grants, memory policy,
delegation policy) that runs on an existing verified Hermes runtime. Other agents discover
bots in the registry and delegate work to them. Admin UI: `/bots`.

## How a task runs
1. `delegateToBot` checks who is asking (`allowedCallers`), the bot's status, the host's
   `executionVerified`, concurrency and daily budgets, and workspace scope, then creates an
   `OrchestrationRun` (`botId`, `originKey`) and enqueues it on the existing queue.
2. The orchestration worker's `executeOrchestrationRun` calls `loadBotExecution` (`src/lib/bots/execution.ts`):
   it builds the prompt (identity, instructions, skills, tool manifest, memory, requester context, task),
   asks the runtime for the bot's model via `modelOverride`, and checks every `tool_started` event
   against the bot's grants.
3. Denied tool: session interrupted, task FAILED (`policy_violation`). Approval-gated tool: session
   interrupted, task WAITING with an `ApprovalRequest`; approving starts a child task that may use it once.
   Sentinel learns of a call from the runtime's `tool_started` event and interrupts after that. It does not
   stop the call first: the tool that triggered the halt may already have started (see Known limits).
4. After success: usage and cost (only when the model has a price), assets found in the output
   (unverified links), and an offer to memory at the bot's write scope (the ingestion gate may decline).

Statuses shown to callers: QUEUED, RUNNING, WAITING, COMPLETED, FAILED, CANCELLED.

## Permissions
- **Tools**: none by default. Per server (`*`) or per tool: off, read, execute, needs approval.
  `read` admits only tools the server marks read-only; unknown read-only status is refused.
  A tool name in two servers is judged by the strictest grant. Unknown tools are denied.
- **Catalog**: Sentinel's own MCP tools, Hermes built-ins, and registered outbound MCP servers
  (real `tools/list` discovery; secrets stay in env vars, only the variable name is stored).
- **Memory**: read scopes and write scopes are separate. `bot` scope is private to (user, bot).
  Anything a bot writes carries its `botId`, even at shared scopes. `minRelevance` is a fraction
  of the ranker's maximum score.
- **Delegation**: `allowedCallers` (`user`, `agent:<id>`, `client:<externalClientId>`), `allowedChildBots`,
  `canDelegate`, `maxDepth` (max 3), loop detection. Bots cannot create bots.
- **Skills**: Hermes `SKILL.md`, stored as text and never executed. Install is propose, review, approve
  against the reviewed SHA-256; only approved skills can be assigned.

## Tool approvals
- **Atomic.** Deciding the approval, closing the waiting task and creating the continuation are one
  transaction (`resolveBotTaskApproval`). The approval flips only from `pending` and the task only from
  `waiting`, each by a conditional update, so of any number of simultaneous decisions exactly one wins and
  the rest change nothing (HTTP 409). The generic `decideApproval` is conditional the same way.
- **Enqueue after commit.** The continuation is queued only once the decision has committed, so a worker
  can never start it while the approval is undecided. If the queue is down the approval is still approved,
  the child stays `queued`, and `approval.payload.continuation.pendingEnqueue` records that it still has to
  be queued. The orchestration worker retries these every 30 s (`retryBotContinuations`); repeating the
  approve also retries. Nothing runs unqueued. Check: `payload->'continuation'->>'pendingEnqueue' = 'true'`.
- **One use, durably.** Each approved tool is a `BotToolGrant` row (`<serverId>:<catalog tool>`), spent by a
  conditional update when the first call it admits is observed. A continuation inherits only the parent's
  UNSPENT rows plus the newly approved tool; `request.approvedTools` is only a record of what was issued.
  Approve A, use A, wait for B, approve B: A needs a fresh approval. A run queued before grants existed
  (`approvedTools` with no rows) is converted once when it loads; a waiting legacy parent passes nothing on.
- **Canonical names.** Approvals are stored and matched under catalog names. An approval that only has the
  runtime's spelling is resolved against the catalog; if that is ambiguous or the tool is gone it is refused
  (409) and stays pending, so it can be denied.

## Known limits
- **Tool enforcement is detect-and-halt, not pre-execution.** Hermes runs its own tools. Sentinel sees
  `tool_started`, then interrupts the session. The tool that triggered the halt may already have begun, and
  an interrupt the runtime does not confirm leaves the task `cancelling` (in flight) until it does. An
  approval says "Sentinel interrupted the session when X was called", never "stopped before X".
- Per-task token budgets are checked after the task; Hermes reports usage only at the end.
- Temperature is not offered: Hermes `session.create` takes model and reasoning effort only.
- Hermes hosts add their own prompt and tool schema to every session (about 19k input tokens in the live check).
- `fallback` model applies only if the requested model is refused at session start.

## Verification
`tests/bots/*` (policy, service, execution, memory, registry, MCP, catalog, API, UI).
`tests/bots/live-smoke.test.ts` runs a real task on a real Hermes host; it is skipped unless
`BOT_LIVE_SMOKE=1` (needs `HERMES_SESSION_TOKEN`, optionally `BOT_LIVE_HOST`, `BOT_LIVE_MODEL`).
