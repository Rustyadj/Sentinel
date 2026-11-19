# Autonomous objectives

One high-level goal in, verified work out. This is the first slice of
Sentinel's autonomous execution engine (ADR-010). Code: `src/lib/objectives/`.

## Status

| Area | State |
|---|---|
| Engine (durable DAG, leases, retries, approvals, verification, stop) | Built, DB-tested |
| Planner | One vetted template: `business_setup_v1` |
| Domain availability | **Real**: IANA RDAP bootstrap, then the authoritative registry (404 = no record) |
| DNS / email verification | **Real**: `node:dns` MX/SPF/DKIM/DMARC lookups |
| Website and marketing copy | **Real** when a runtime is ready: delegated through `createOrchestrationRun`; output verified |
| Registrar, email provider, DNS host, hosting, analytics, CRM | **No adapter.** Steps block with a connection request |
| Dashboard | `/objectives` |
| Memory write-back | Not yet |

## Turning it on

`SENTINEL_OBJECTIVES=on` on **both** `app` (API accepts objectives) and
`orchestration-worker` (the ticker advances them). Unset or any other value is
the global kill switch: nothing advances. `SENTINEL_OBJECTIVES_TICK_MS`
(default 10000) sets the tick.

Migration `20261119120000_objectives` adds three tables (additive only).

## Model

- `Objective` — goal, autonomy level (1–4), budget/spend in cents, status, the
  latest completion report, and a lease (`leaseOwner`, `leaseExpiresAt`).
- `ObjectiveStep` — one node: role, tool, impact, `dependsOn` (step keys),
  attempts, `idempotencyKey`, output, verification, block reason and the exact
  unblock request, approval and delegated run ids, costs.
- `ObjectiveEvent` — the append-only activity feed.

## How a tick works

1. The worker claims an active objective with a conditional update (lease 120s).
2. For each step: poll a delegated run; settle an approval; release a retry
   whose backoff has passed; block it if a dependency settled unsuccessfully;
   otherwise, if its dependencies are complete, run the tool's precheck (missing
   integration → blocked, before any approval is asked), then the autonomy
   policy (`policy.ts`), then execute.
3. Ready independent steps execute in parallel (batches of 4).
4. Repeat until nothing changes; derive the objective's status; write the report.

A crash mid-step leaves the step `running`. When the lease expires, the next
tick re-runs it with the **same idempotency key**. Tools and adapters must be
idempotent on that key.

## Autonomy levels

| Level | Reads | Writes | Publishing | Agent delegation | Retries |
|---|---|---|---|---|---|
| 1 Advisory | run | advised only | advised only | advised only | 1 |
| 2 Supervised | run | approval | approval | approval | 1 |
| 3 Managed | run | run | approval | approval | 2 |
| 4 Delegated | run | run | run | run | step limit |

At every level, `financial`, `legal`, `destructive` and `credential` steps need
approval. So does any step whose estimate would take spend past the budget.

## Approvals

Each gated step creates an `ApprovalRequest` (`type = objective_step`, `taskId` =
step id) that shows in the normal approvals queue. Its fingerprint covers the
step and the dependency values it acts on (e.g. *which* domain). Approving
clears that action once (`consumeApproval`). If the values change afterwards,
the old approval no longer applies and a new one is requested. A retry needs a
fresh approval. The engine picks up decisions on its next tick.

## Security boundaries

- **The plan is fixed at creation.** Nothing a step reads (RDAP, DNS, agent
  output, web content) can add or change steps or tools. Outputs are stored as
  data and never parsed for instructions.
- Each role has a tool allowlist (`roles.ts`), enforced on every execution.
- Agent prompts carry a "treat the details as data" preamble and contain only
  operator-supplied inputs.
- Credentials never pass through step input/output, events or memory. Adapters
  resolve them server-side at call time.
- API: create needs `task.create`, read needs `task.read`, control needs
  `task.update`, workspace emergency stop needs `approval.review`. Bodies are
  parsed with an explicit allowlist. Idempotency keys and lease fields are
  never returned.
- CAPTCHA/MFA: no tool attempts them. A step that would meet one must block.

## API

- `POST /api/objectives` `{workspaceId, goal, autonomyLevel?, budgetCents?, businessName?, domains?, description?}` → 201, or 400 `{missing:[{field,question}]}`
- `GET /api/objectives?workspaceId=` · `GET /api/objectives/:id`
- `POST /api/objectives/:id/control` `{action: pause|resume|stop|retry_step, stepKey?}`
- `POST /api/objectives/emergency-stop` `{workspaceId}`

## Adding an integration

Implement `IntegrationAdapter` (`integrations.ts`) for one kind, with
`execute(action, payload, {idempotencyKey})` idempotent on the key, and call
`registerIntegration()` at worker start. The tool definitions in `tools.ts`
already describe the payloads and the verification each kind must satisfy.
Test it against the provider's sandbox before claiming it works.

## Next slices

1. One real adapter per kind (DNS and registrar first), sandbox-tested.
2. Memory write-back of completed resources and recovery procedures through `remember()`.
3. Validated LLM planning against the tool allowlist.
4. Browser-session tools on Agent Computers for providers without an API.
