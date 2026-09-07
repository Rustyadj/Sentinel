# Sentinel OS — Gemini Instructions

Sentinel OS is the operating environment agents live and work in — not a dashboard,
chatbot wrapper, or collection of installable modules. The shell is the product.

Read `AGENTS.md` too: this repo runs a Next.js version with breaking changes, and you
must consult `node_modules/next/dist/docs/` before writing routing or page code.

## Do not build parallel systems

Extend what is already on `main`. Never create a second:

- agent system (`src/lib/agents/registry.ts` is canonical)
- runtime system (`src/lib/agents/runtime/` is canonical)
- Learning Core (`src/lib/learning/` is canonical)
- model registry or resolver (`src/lib/agents/model-policy.ts` is canonical)
- knowledge/security graph (`src/lib/lensRegistry.ts` is canonical)

## Model configuration is one hierarchy

`resolveEffectiveAgentModel(agentId, runtimeKind)` in `src/lib/agents/model-policy.ts`
is the single authority. Resolution order, never reversed:

1. explicit session override (must be authorized)
2. persisted `Agent.model` / `Agent.reasoningEffort` in Postgres
3. environment deployment default
4. Sentinel built-in default

Environment variables are bootstrap defaults, not the operator UI. Editing an agent in
the registry changes the persisted row, and that must change the **next real execution**.

**A dropdown that saves a database label but does not change what the runtime executes
is a bug, not a feature.** Prove behavior by running the runtime, not by reading code.

If a model is unavailable, raise `MODEL_UNAVAILABLE` carrying `runtime`,
`requestedModel`, `requestedEffort`, `reason`. **Never silently substitute another
model, and never add a runtime fallback flag.**

## Runtimes

Each runtime is an adapter under `src/lib/agents/runtime/` registered in `service.ts`,
with its definition in `config.ts`. Verified CLI contracts on this VPS:

| runtime | model flag | effort | structured output | notes |
|---|---|---|---|---|
| Claude Code 2.1.226/2.1.263 | `--model` | `--effort` (low/medium/high/xhigh/max) | `--output-format stream-json` | reports `assistant.model` back |
| Codex 0.153.4 | `--model` | `-c model_reasoning_effort="…"` | `exec --json` | needs `--skip-git-repo-check` outside a git repo; does not report model back |
| Gemini 0.58.0 | `-m/--model` | none | `-o stream-json` | needs `--skip-trust`; reports actual models in `result.stats.models` |
| Hermes (Lisa, Nathan2) | `session.create({model})` | `reasoning_effort` | WebSocket RPC | recreated sessions must reuse the pinned model |

Hermes Lisa listens on `127.0.0.1:4862`, Nathan2 on `0.0.0.0:4864` — **not** the 4860/4861
that older config defaulted to.

## Session provenance

Every session records `requestedModel`, `requestedEffort`, and `configSource`, plus
`actualModel`/`actualEffort` **when the runtime reports them**. Historical sessions keep
the configuration they actually ran with, even after the operator changes the agent
default. Never claim a requested model was used just because Sentinel asked for it —
if the runtime does not report it, say "not reported".

## Database

- Production is `hermesos` in container `sentinel-os-postgres-1`, reachable only as
  `postgres:5432`. **Never migrate it.** Use a throwaway Postgres with an explicit
  `DATABASE_URL` on every command.
- Migrations are **additive only**. No `DROP`, no `TRUNCATE`, no `migrate reset`.
- Preserve history: superseded rows get `enabled = false`, they are not deleted.
- Test migrations against both a fresh database and a current-main-shaped one.
- Do not run `npx prisma format` — it reflows unrelated models and pollutes the diff.

## Learning Core

Reuse `compileEvalCase()` in `src/lib/learning/eval-compiler.ts` for every production
failure signal; it already deduplicates and redacts. Failure emission must never break
the path it observes — wrap it and swallow.

Every `/api/learning/*` list route must scope through `getAccessibleLearningScope()`.
Authentication alone is not tenant authorization.

## Validation before claiming done

```
npx prisma validate && npx prisma generate
npm run typecheck && npm run lint && npm test && npm run build
```

Known pre-existing failure: `tests/release-audit/queue-regressions.test.ts` times out
because Redis is not published to the host. Establish the baseline on the merge-base
before claiming a regression is yours.
