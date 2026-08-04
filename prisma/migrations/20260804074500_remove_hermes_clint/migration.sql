-- Hermes Clint (ICF construction estimating specialist) was decommissioned
-- on the VPS: container removed, 5.3GB data directory deleted, and the
-- agent stripped out of registry.ts/runtime config.ts/docker-compose.yml.
-- This removes its seed row from agent_runtimes (inserted by
-- 20260802120000_agent_runtime_control_plane) to match. No agent_sessions
-- ever referenced it, so nothing else needs cleanup.
DELETE FROM "agent_runtimes" WHERE "id" = 'runtime-hermes-clint';
