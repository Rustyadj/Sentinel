-- Seed operator execution verification for the runtimes whose task-execution
-- contract has been audited end to end. Additive and idempotent: no DROP, no
-- TRUNCATE, no DELETE, no column change. Rows not named here keep the column
-- default (false) and stay non-dispatchable until an operator verifies them.
--
-- hermes-nathan2 is deliberately excluded: its gateway returns 401 on
-- /api/auth/ws-ticket, so its execution contract is unverified.
UPDATE "agent_runtimes"
SET "executionVerified" = true
WHERE "id" IN (
  'runtime-hermes-lisa',
  'runtime-openclaw',
  'runtime-claude-code',
  'runtime-codex',
  'runtime-gemini'
);
