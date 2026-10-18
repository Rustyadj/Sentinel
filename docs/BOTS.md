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
   asks the runtime for the bot's model via `modelOverride`, and starts the session with `toolGate: "bot"`.
   The runtime records which tool gate the session got (`metadata.toolGate`, also the task's `tool_gate` event):
   - `pre-execution`: Hermes asks Sentinel before each tool call runs (see Tool enforcement). The decision
     is made there, from the same grants and one-use approvals.
   - `observed`: Sentinel checks each `tool_started` event, i.e. after the runtime has started the call.
3. Denied tool: task FAILED (`policy_violation`). Approval-gated tool: task WAITING with an `ApprovalRequest`;
   approving starts a child task that may use it once. Either way the session is interrupted. Under
   `pre-execution` the refused call never ran; under `observed` it may already have started. Each tool call
   in the task view says which (`stage`).
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

## Tool enforcement
The gate is per Hermes host and off until an operator turns it on.

- **What runs where.** `deploy/hermes/plugins/sentinel-bot-gate` is a Hermes plugin (written against Hermes
  0.21.5). In sessions whose source is `sentinel-bot` its `pre_tool_call` hook sends every tool call to
  Hermes's own approval gate. That gate asks the connected client before the tool runs. Sentinel's bot
  connection says it answers such requests (`client.capabilities {server_requests: true}`), evaluates the call
  with `evaluateObservedTool` (spending a `BotToolGrant` if one admits it) and answers `once` or `deny`. Hermes
  blocks the call on `deny`, on timeout (`approvals.timeout`), when the request is withdrawn, or if the
  connection drops. Other sessions on the host, including ordinary Sentinel chat, are untouched.
- **Turning it on.** Install the plugin in `$HERMES_HOME/plugins/sentinel-bot-gate`, add `sentinel-bot-gate` to
  `plugins.enabled`, restart Hermes, then set `<AGENT>_BOT_TOOL_GATE=pre-execution` for Sentinel's app and
  workers (e.g. `HERMES_LISA_BOT_TOOL_GATE`). Only then are bot sessions created with source `sentinel-bot`.
  Sentinel cannot detect the plugin, so the variable is the operator saying it is installed.
- **Fail closed.** In a bot session the plugin blocks every call if the host would auto-approve (`yolo`,
  `approvals.mode: off`) or if the plugin itself errors. Sentinel refuses any approval kind it does not
  recognise as its own (a command Hermes flagged as dangerous is refused and the task fails) and answers every
  other server request (clarify, sudo, secret) with an error. Hermes treats that the same as when no client
  answers. A gated session started without an authorizer refuses to run.
- **Bypass detection.** If a call starts in a gated session without having been asked about, the plugin
  was missing, disabled, or skipped. Sentinel fails the task and says the call ran without its check. That is
  detect-and-halt again: the call had already started.
- **Bot definition generation** needs no tools. On a gated host every call it attempts is refused before it runs.

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
  conditional update when the first call it admits is authorized (pre-execution) or observed. A continuation inherits only the parent's
  UNSPENT rows plus the newly approved tool; `request.approvedTools` is only a record of what was issued.
  Approve A, use A, wait for B, approve B: A needs a fresh approval. A run queued before grants existed
  (`approvedTools` with no rows) is converted once when it loads; a waiting legacy parent passes nothing on.
- **Canonical names.** Approvals are stored and matched under catalog names. An approval that only has the
  runtime's spelling is resolved against the catalog; if that is ambiguous or the tool is gone it is refused
  (409) and stays pending, so it can be denied.

## Known limits
- **Without the gate, tool enforcement is detect-and-halt.** On a host without `<AGENT>_BOT_TOOL_GATE=pre-execution`
  Hermes runs its tools and Sentinel only sees `tool_started`, then interrupts the session. The tool that
  triggered the halt may already have begun. An approval then says "Sentinel interrupted the session when X was
  called". Only a pre-execution refusal says "refused X before it ran".
- **The gate covers what passes through Hermes's `pre_tool_call` hook.** It does not cover what a permitted
  tool then does. An allowed `terminal` or `execute_code` call can run anything, an allowed MCP tool acts on its
  own server, and Hermes's sub-agents (`delegate_task`) and scheduled jobs (`cronjob`) run later in other
  sessions without the bot's source. Grant those tools only with that in mind.
- **Gated matching uses the runtime's tool names.** A call is matched to its `tool_started` event by the name
  Hermes reports for both. If they ever differ, every permitted call looks like a bypass and the task fails
  (closed, not open).
- An interrupt the runtime does not confirm leaves the task `cancelling` (in flight) until it does, in both modes.
- Per-task token budgets are checked after the task; Hermes reports usage only at the end.
- Temperature is not offered: Hermes `session.create` takes model and reasoning effort only.
- Hermes hosts add their own prompt and tool schema to every session (about 19k input tokens in the live check).
- `fallback` model applies only if the requested model is refused at session start.

## Verification
`tests/bots/*` (policy, service, execution, memory, registry, MCP, catalog, API, UI).
`tests/bots/live-smoke.test.ts` runs a real task on a real Hermes host; it is skipped unless
`BOT_LIVE_SMOKE=1` (needs `HERMES_SESSION_TOKEN`, optionally `BOT_LIVE_HOST`, `BOT_LIVE_MODEL`).
