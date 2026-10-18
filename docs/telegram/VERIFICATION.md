# Gateway verification — 2026-10-18

Status: draft; do not deploy or cut over the working bots yet. See [GATEWAY.md](GATEWAY.md) for architecture, configuration, cutover, live verification and rollback.

Executed locally against isolated PostgreSQL and Redis (not production):

- Vitest: 14 files, 170 tests passed. Includes Telegram inbox/outbox, identity/access, duplicate delivery, real task admission/queue, approval atomicity, memory policy, adapter and queue regression coverage. Telegram and Hermes endpoints were simulated; this is not live bot verification.
- Python unittest discovery: 10 tests passed for the trusted hook and isolated profile preparation.
- TypeScript: `npm run typecheck` passed.
- ESLint: `npm run lint` passed with the existing unused VoiceSettings warning.
- Prisma validation and fresh replay of all 67 migrations passed.
- Compose overlay validation, Traefik service reference validation and `git diff --check` passed.
- Production webpack build failed at the existing client import of node:crypto through the workspace barrel. The identical failure was reproduced in a clean, untouched f5d05a0 worktree. Optional BullMQ Valkey dependency also warns.
- Production dependency audit reports 11 inherited vulnerabilities (2 critical, 6 high, 3 moderate); dependency manifests and lockfile are unchanged.

Read-only live checks confirmed both existing bot identities and webhook states. No live execution, message delivery, cutover, production migration or deployment was performed. Lisa's native gateway also hosts SMS: a verified selective Telegram shutdown remains required. Managed Hermes sessions must pass the fresh trusted plugin proof before execution. Coordinate the overlapping trusted pre-execution adapter changes with the parallel bot-authorization branch before merging.

Commands:

```sh
SENTINEL_TEST_DATABASE_URL=postgresql://postgres:sentinel_test@127.0.0.1:55639/sentinel_telegram_migration_test SENTINEL_TEST_REDIS_URL=redis://127.0.0.1:55680 SENTINEL_TEST_BULLMQ_PREFIX=telegram-gateway-final node_modules/.bin/vitest run tests/telegram tests/bots/execution.test.ts tests/bots/approval-atomicity.test.ts tests/bots/memory.test.ts tests/bots/policy.test.ts tests/bots/api.test.ts tests/bots/ui.test.tsx tests/bots/catalog.test.ts tests/agents/hermes-adapter.test.ts src/lib/agents/runtime/hermes-nathan2.test.ts tests/orchestration/queue.test.ts tests/release-audit/queue-regressions.test.ts
python3 -m unittest discover -s tests/telegram -p 'test_*.py'
npm run typecheck
npm run lint
npx prisma validate
npm run build -- --webpack
npm audit --omit=dev --audit-level=high
```

Merge recommendation: draft only pending security review, shared authorization change consolidation, inherited build/security remediation and controlled live verification. Keep all gateway enable flags off until the documented cutover gates pass.
