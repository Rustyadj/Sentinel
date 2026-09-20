-- Retire OpenClaw as an active Sentinel runtime.
--
-- OpenClaw is no longer part of the Sentinel agent/runtime architecture. It is
-- not a required, optional, fallback, or legacy runtime: the code that
-- registered, discovered, health-checked and dispatched to it has been removed.
--
-- This migration deliberately DEACTIVATES rather than DELETES. Historical
-- provenance must survive:
--
--   * agent_sessions.runtimeInstanceId references agent_runtimes.id, so every
--     session OpenClaw ever ran is anchored to 'runtime-openclaw'.
--   * messages, tasks, experiences and audit_logs reference agents.id =
--     'openclaw' as the actor that produced them.
--
-- Deleting either row would rewrite or cascade away real execution history.
-- Instead both rows are marked retired so nothing can dispatch to them, while
-- existing records continue to correctly say that OpenClaw produced them.

-- 1. The runtime registration: not enabled, not verified, not dispatchable.
UPDATE "agent_runtimes"
SET "enabled" = false,
    "executionVerified" = false,
    "capabilities" = '{"streaming":false,"resume":false,"cancel":false,"toolEvents":false,"fileChangeEvents":false}'::jsonb,
    "healthConfig" = '{"retired":true,"retiredReason":"openclaw_removed_from_architecture"}'::jsonb,
    "endpoint" = NULL,
    "containerName" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'runtime-openclaw' OR "kind" = 'openclaw';

-- 2. The agent identity: retained as a historical actor, marked offline and
--    stripped of routing weight so the peer-worker router can never select it.
UPDATE "agents"
SET "status" = 'retired',
    "capabilityWeights" = '{}'::jsonb
WHERE "id" = 'openclaw';

-- 3. Remove OpenClaw from any collaboration room membership. Room membership is
--    live routing state, not history; the messages it already produced in those
--    rooms are untouched and still attributed to it.
UPDATE "chat_rooms"
SET "agentIds" = array_remove("agentIds", 'openclaw')
WHERE 'openclaw' = ANY("agentIds");
