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

## Known limits
- Tool enforcement is detect-and-halt (see decisions.md). A denied call may already be under way.
- Per-task token budgets are checked after the task; Hermes reports usage only at the end.
- Temperature is not offered: Hermes `session.create` takes model and reasoning effort only.
- Hermes hosts add their own prompt and tool schema to every session (about 19k input tokens in the live check).
- `fallback` model applies only if the requested model is refused at session start.

## Verification
`tests/bots/*` (policy, service, execution, memory, registry, MCP, catalog, API, UI).
`tests/bots/live-smoke.test.ts` runs a real task on a real Hermes host; it is skipped unless
`BOT_LIVE_SMOKE=1` (needs `HERMES_SESSION_TOKEN`, optionally `BOT_LIVE_HOST`, `BOT_LIVE_MODEL`).
