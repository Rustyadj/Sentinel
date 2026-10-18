# Jev default router verification — 2026-10-18

Dedicated branch: `codex/jev-default-router`. Based on the separate [Telegram gateway PR #53](https://github.com/Rustyadj/Sentinel/pull/53); the Jev PR's base excludes that gateway diff. No merge, deployment, production migration, agent execution or Telegram cutover was performed.

## Executed checks

- **242 tests passed in 26 files**, covering System-1 provider/policy/telemetry and UI, Telegram's actual task admission/executor with simulated external runtimes, bot authorization/one-use approvals/memory, adapters, orchestration, runtime chat model provenance, Mission Control and voice worker entry authorization.
- After the final stream observer update, **21 tests passed in 3 files** (dispatch, routing panel, Telegram gateway). Lisa and Nathan2 each execute through the existing executor and persist an `ok` Jev decision while retaining their binding. External Hermes and Telegram endpoints in these tests are simulated; PostgreSQL/Redis are real isolated test instances.
- Final model-provenance checks: **4 tests passed in 2 files**. Voice decision reuse and its existing bridge/route checks: **24 tests passed in 4 files** after adding the server-owned reuse scope.
- TypeScript passed (`npm run typecheck`). ESLint passed (`npm run lint`) with the existing unused `VoiceSettings` warning.
- Compose configuration and `git diff --check` passed. No Jev migration is needed.
- Production webpack build **failed** through the pre-existing WorkspaceHeader → workspace barrel → authorization → current-user → mobile-auth → `node:crypto` client import. Identical failure reproduced on untouched main `f5d05a0` during the prerequisite gateway work. The optional BullMQ Valkey module also warns.
- `npm audit --omit=dev --audit-level=high` **failed**: 11 inherited findings, 2 critical / 6 high / 3 moderate. No package manifest or lockfile changed.

Commands, with isolated test database/Redis URLs supplied through `SENTINEL_TEST_DATABASE_URL` and `SENTINEL_TEST_REDIS_URL` (local verification used ports 55639 and 55680):

```sh
node_modules/.bin/vitest run tests/system-one tests/telegram tests/bots/execution.test.ts tests/bots/approval-atomicity.test.ts tests/bots/memory.test.ts tests/bots/policy.test.ts tests/agents/hermes-adapter.test.ts tests/agents/runtime-chat-routing.test.ts tests/agents/chat-routing-provenance.test.ts src/lib/agents/runtime/hermes-nathan2.test.ts tests/orchestration tests/mission-control/server.test.ts src/modules/mission-control/components/MissionControlPage.test.tsx src/app/api/chat/voiceWorkerTurn.test.ts
node_modules/.bin/vitest run tests/system-one/dispatch.test.ts tests/system-one/panel.test.tsx tests/telegram/gateway.test.ts
npm run typecheck
npm run lint
docker compose -f docker-compose.yml config --quiet
git diff --check
npm run build -- --webpack
npm audit --omit=dev --audit-level=high
```

## Actual provider checks

A credential-safe read-only inspection of running containers found:

| Process | Actual configuration before changes |
|---|---|
| App | Global shadow; Nathan2 active override; Lisa inherits shadow; TypeSafe direct; `jev-latest`; key present |
| Orchestration worker | No System-1 mode, provider settings or key |

Using the running app's existing provider credentials in memory (never command arguments or files), the final synthetic full-bundle probe returned:

| Assigned agent | Outcome | Served model | Latency | Route |
|---|---|---|---|---|
| Lisa | ok | jev-1.13.0 | 201 ms | agent_runtime |
| Nathan2 | ok | jev-1.13.0 | 126 ms | agent_runtime |
| Claude Code | ok | jev-1.13.0 | 100 ms | agent_runtime |
| Codex | ok | jev-1.13.0 | 76 ms | agent_runtime |

All four preserved the supplied model constraint; all recommended workspace context. These are provider decisions on synthetic requests, not executions of those four agents. The TypeSafe response did not report price.

The existing labeled evaluation ran against the actual provider with **55 cases, one call per case**, a static tool catalog and **no tool execution**:

```sh
node_modules/.bin/tsx scripts/system-one/probe.ts
node_modules/.bin/tsx bench/system1/run.ts --repeat 1 --out /tmp/sentinel-jev-live-eval
```

Measured results:

- Route labels correct: **51/55 (93%)**. Overall benchmark routing verdict correct: **39/55**.
- **0 unsafe fast paths**, **0 wrong-tool fast paths**, **0/55 provider failures**.
- **0/16 eligible tool fast paths taken**; no System-2 calls avoided. Confidence policy was kept conservative; this does not establish cost savings.
- Memory: **2 correct skips, 0 wrong skips**, 9 kept among 11 labeled cases.
- Decision latency: **p50 97 ms / p95 198 ms**, including network; benchmark uses its existing generous 5-second budget, while the four final probes above used the proposed 400 ms routing budget.
- Provider price absent. The benchmark's previous absent-price-as-zero rendering is fixed in this branch. Unknown prices remain unknown in Mission Control and net savings.

Raw local evaluation artifacts: `/tmp/sentinel-jev-live-eval/2026-10-18T01-25-57-197Z.json` and `.md`. The original Markdown was generated before the absent-price rendering fix; its zero-dollar line must be read as unknown. No current end-to-end System-2 baseline or live Telegram result was measured. The existing benchmark's production baseline is historical and its projections are not new measurements.

## Release recommendation and limits

**Keep draft; do not merge/deploy yet.** Resolve inherited build/security gates; review the shared gateway authorization changes against newly opened bot release [#51](https://github.com/Rustyadj/Sentinel/pull/51) and environment follow-up [#52](https://github.com/Rustyadj/Sentinel/pull/52). Preserve their routine service and approval behavior when consolidating overlaps.

Production's explicit global `shadow` setting still requires an intentional release configuration change. Native Hermes Telegram consumers remain the gateway cutover dependency; Lisa's Telegram shutdown must preserve its SMS integration. No claim of exclusive Telegram routing or comprehensive native-runtime tool mediation is made before those gates pass. Jev is not an authorization boundary and cannot remedy an uncontrolled native tool path by classifying a request.

Default routing does not dynamically replace models, reassign explicit agents, execute privileged actions or expand memory scopes. Memory category is advisory; existing ACL/provenance/retention rules remain authoritative. Existing capability/workload worker selection is retained. New runtime dispatches always escalate to that selected System-2 agent; only the pre-existing explicitly permitted voice tool path can return without System-2. Health and maintenance do not depend on Jev availability. Decision persistence remains best effort as in the existing telemetry service.

See [architecture, configuration, deployment and rollback](SYSTEM_ONE.md) and the separate [Telegram live cutover/rollback procedure](telegram/GATEWAY.md).

## Changed files in the Jev branch

```text
.env.example
bench/system1/run.ts
docker-compose.yml
docs/SYSTEM_ONE.md
docs/SYSTEM_ONE_VERIFICATION.md
scripts/system-one/probe.ts
src/app/api/agent-sessions/[sessionId]/messages/route.ts
src/app/api/chat/route.ts
src/app/api/system-one/metrics/route.ts
src/app/api/voice/reasoning/route.ts
src/app/system-one/page.tsx
src/lib/agents/runtime/chat-routing.ts
src/lib/bots/generate.ts
src/lib/orchestration/agent-turn.ts
src/lib/orchestration/executor.ts
src/lib/system-one/config.ts
src/lib/system-one/dispatch.ts
src/lib/system-one/health.ts
src/lib/system-one/providers/jev.ts
src/lib/system-one/questions.ts
src/lib/system-one/service.ts
src/lib/system-one/telemetry.ts
src/lib/system-one/turn.ts
src/lib/system-one/types.ts
src/modules/mission-control/components/SystemHealth.tsx
src/modules/mission-control/components/SystemOnePanel.tsx
tests/agents/runtime-chat-routing.test.ts
tests/system-one/dispatch.test.ts
tests/system-one/panel.test.tsx
tests/system-one/policy-and-config.test.ts
tests/system-one/provider-and-service.test.ts
tests/telegram/gateway.test.ts
```
