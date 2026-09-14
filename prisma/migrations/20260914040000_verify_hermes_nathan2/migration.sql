-- Record the operator verification of hermes-nathan2's execution contract.
--
-- Evidence (2026-09-14, live container, through Sentinel's own Hermes adapter):
--   POST /auth/password-login  (provider=basic)      -> 200, session cookie
--   POST /api/auth/ws-ticket                         -> 200, ticket ttl 30s
--   session.create                                   -> external session id
--   prompt.submit                                    -> assistant_delta + completed
--   normalized session status                        -> completed
--
-- Prerequisite carried by deployment, not by this migration:
-- HERMES_NATHAN2_USERNAME / HERMES_NATHAN2_PASSWORD must match the container's
-- HERMES_DASHBOARD_BASIC_AUTH_USERNAME / _PASSWORD. hermesAuth() now refuses a
-- half-configured pair, so a missing username fails loudly instead of silently
-- degrading to the session-token path the gateway rejects.
--
-- Additive and idempotent: no DROP, no TRUNCATE, no DELETE, no column change.
UPDATE "agent_runtimes"
SET "executionVerified" = true
WHERE "id" = 'runtime-hermes-nathan2';
