# System 1 (Jev) — Sentinel's reflex layer

Decision record: [decisions.md ADR-004](decisions.md). Code: `src/lib/system-one/`.

System 1 answers *what kind of thing is happening and which path should handle
it* — never *what to tell the human*. It routes between paths; it never chooses
which model thinks (the agent's configured model always does).

```
 User ─ GPT-Live (voice) / chat UI
          │
          ▼
  Sentinel route  (/api/voice/reasoning, /api/chat)
          │  begin: ONE batched Jev call (intent, route, tool, needs*, scores)
          ├──────────────┬───────────────────────────┐   concurrently:
          │              │                           │   read-only prep only
          ▼              ▼                           ▼   (memory retrieval,
   policy (confidence   memory retrieval        warm caches:  tool catalog,
   gates routing, not   (chat, model_chat)      runtime readiness, Jev conn)
   truth)
          │
   ┌──────┼───────────────────────────┬───────────────────────────┐
   ▼      ▼                           ▼                           ▼
 fast_path_tool              system2_skip_memory               system2
 read-only MCP tool of        model call starts without        today's path:
 THIS agent (readOnlyHint)    waiting for retrieval            agent runtime
 → structured data            (race: never slower)             (Hermes / Claude
 → GPT-Live presents it                                         Code / Codex)
   │ failure ──────────────────────────────────────────────────────▲
   ▼
 response  ── system_one_decisions row (decision, plan, what ran, phases, cost)
```

Hierarchy: **Jev** (System 1, routes) → **Hermes / runtimes** (agent identity,
memory, tools, writes) → **agent's configured model** (System 2) → **GPT-Live**
(realtime human interface).

## Where it runs

| Surface | Off | Shadow | Active |
|---|---|---|---|
| Voice (`/api/voice/reasoning`) | unchanged; baseline row recorded | Jev runs **alongside** System 2, adds 0 ms, records the would-be plan | awaits Jev (≤ `SYSTEM_ONE_VOICE_TIMEOUT_MS`), then read-only tool fast path or System 2 |
| Chat, direct-model agents | unchanged | Jev alongside retrieval, recorded | Jev **races** memory retrieval; a confident "no memory needed" starts the model early |
| Chat, runtime agents (Hermes, Claude Code, Codex) | unchanged | recorded, scored against the tools the runtime actually called | **same as shadow** — see limitations |

Interruption (voice): barge-in aborts the in-flight `/api/voice/reasoning`
fetch; the server aborts the Jev call, cancels the runtime session
(`adapter.cancel`, audited as `voice_interrupt`) and never speaks the stale
answer. The cancelled call gets a `superseded` output with no `response.create`.

## Configuration

All env, resolved per request (per-agent overrides need no redeploy of code,
only of env). Compose passes each variable explicitly (`docker-compose.yml`).

| Variable | Default | Meaning |
|---|---|---|
| `SYSTEM_ONE_MODE` | `off` | `off` / `shadow` / `active`, global |
| `SYSTEM_ONE_MODE_<AGENT>` | – | per-agent override, e.g. `SYSTEM_ONE_MODE_HERMES_NATHAN2=active` |
| `SYSTEM_ONE_ENABLED` | `true` | `false` = hard kill switch, beats every mode |
| `SYSTEM_ONE_API_KEY` | `OPENROUTER_API_KEY` | provider key |
| `SYSTEM_ONE_BASE_URL` | `https://openrouter.ai/api` | or `https://api.typesafe.ai` |
| `SYSTEM_ONE_MODEL` | `jev-1.13` | pinned; re-tune thresholds before changing |
| `SYSTEM_ONE_TIMEOUT_MS` / `_VOICE_TIMEOUT_MS` | 400 / 250 | hard ceiling on the wait |
| `SYSTEM_ONE_HIGH_CONFIDENCE` / `_LOW_CONFIDENCE` | 0.85 / 0.5 | global band |
| `SYSTEM_ONE_{ROUTE,TOOL}_{HIGH,LOW}_CONFIDENCE` | global band | per-decision bands |
| `SYSTEM_ONE_NOUL_THRESHOLD` | 0.9 | a yes/no is "firm" at ≥ this or ≤ 1 − this |
| `SYSTEM_ONE_FAST_PATH_SURFACES` | `voice` | surfaces allowed to fast-path |
| `SYSTEM_ONE_BREAKER_FAILURES` / `_OPEN_MS` | 5 / 30000 | circuit breaker |
| `SYSTEM_ONE_WARMUP` | `true` | warm Jev + tool catalog + runtime at voice session start |
| `SYSTEM_ONE_BASELINE_TELEMETRY` | `true` | record off-mode rows as the "current Sentinel" baseline |
| `SENTINEL_AGENT_MCP_<AGENT>_URL` / `_TOKEN` / `_NAME` | – | that agent's own MCP credential for read-only fast paths |

Nathan2's MobileOps credential is the same token Hermes Nathan2 uses
(`mcp_servers.mobileops` in its Hermes config); MobileOps authenticates it as
Nathan2 and enforces its own scopes. No other agent can resolve it.

## Rollout (do not skip shadow)

1. Deploy with `SYSTEM_ONE_MODE=off`. Apply migration `20260926120000_system_one_decisions` (additive). Off-mode rows accumulate the measured baseline.
2. Set the key, `SYSTEM_ONE_MODE=shadow`. Watch `GET /api/system-one/metrics` and the Mission Control "System 1 (Jev)" health line: fallback rate, S1 p50/p95, `shadowToolAgreement`.
3. Run `npx tsx bench/system1/run.ts --repeat 3` (add `--tools` with the Nathan2 connector set). It must report **0 unsafe fast paths**; review wrong-tool and wrong-memory-skip counts, tune thresholds.
4. Promote one agent: `SYSTEM_ONE_MODE_HERMES_NATHAN2=active`, other agents stay shadow.
5. Compare active vs off/shadow rows (`totalLatency`, `ttfa` by `executedPath`) before widening.

## Rollback

Any of these, fastest first — none needs a code change or migration rollback:

- `SYSTEM_ONE_ENABLED=false` (or `SYSTEM_ONE_MODE=off`) and restart the app container: every request takes the pre-System-1 path. Only a baseline telemetry row is written (disable with `SYSTEM_ONE_BASELINE_TELEMETRY=false`).
- Per agent: `SYSTEM_ONE_MODE_<AGENT>=shadow` or `off`.
- Remove the fast path only: `SYSTEM_ONE_FAST_PATH_SURFACES=none` or unset the agent's `SENTINEL_AGENT_MCP_*` vars.
- Full revert: revert the branch. `system_one_decisions` is unused by anything else and can be left or dropped.

The provider failing needs no action: timeouts, errors, malformed answers and
an open breaker all fall back to today's routing automatically.

## Known limitations

- **Free-text arguments.** Jev chooses; it cannot extract. A tool whose required argument is an id, a date or a name is never fast-pathed, so "what tools are assigned to Nick?" still goes to Hermes. MobileOps currently has no enum-typed arguments; its 14 no-required-argument read tools are the fast-path set, called unfiltered.
- **Runtime chat is never routed**, only observed: the runtime owns that turn's persistence and memory, and typed chat has no layer that presents raw tool data the way GPT-Live does.
- **Active voice waits for Jev** (≤ 250 ms) on turns that end up in System 2, because System 2 can take write actions and is never started speculatively. Offsets: runtime readiness is cached/warmed, and the tool catalog and Jev connection are warmed at session start.
- **Savings in dollars are null** for models without a rate card entry in `src/lib/agents/pricing.ts` — today that includes `gpt-5.6-luna` and `deepseek/deepseek-v4.1-flash`, i.e. both Hermes agents. Token savings are still recorded.
- **Tokens avoided are an estimate** from the same agent's recent System 2 turns on the same surface; no history → null.
- **TTFA** is client-measured (speech end → first answer audio) and reported best-effort.
