<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Sentinel OS — Agent Instructions

This file is the single source of agent instructions for every tool. `CLAUDE.md`
imports it and `GEMINI.md` points here. Edit outside the managed block above;
`next dev` rewrites only the block.

Sentinel OS is the operating environment agents live and work in — not a dashboard,
chatbot wrapper, or collection of installable modules. The shell is the product.

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

## Security invariants

- New accounts are invitation-only (`src/lib/auth/signup-policy.ts`). Every code path
  that creates a `User` row must go through `isSignupAllowed()`.
- Request bodies are never passed to Prisma as-is. Parse with an explicit allowlist
  (see `src/lib/modules/custom-modules.ts`).
- Authentication is not authorization: resolve the caller's workspace role or
  permission before reading or writing tenant data.
- Nothing that reaches the host Docker daemon takes free-form input. Workspace images
  come from `AGENT_WORKSPACE_ALLOWED_IMAGES`; argv is built with `execFile`, never a shell.
- Only `workspace-runner` is meant to hold the Docker socket; `app` keeps it only
  until the rollout in `docs/SECURITY_REMEDIATION.md` §4-D completes. New Docker
  operations go through `src/lib/agent-workspaces/runner/` with guard validation,
  never a new socket mount. Do not add host credential directories or host
  networking to any service.
- Client components (`"use client"`) import only client-safe modules — never a barrel
  such as `@/lib/workspaces` that re-exports server code.
