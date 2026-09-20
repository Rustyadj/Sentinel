-- Retain historical agent/run relationships, but remove these runtimes from
-- every active execution path. Application-level denylisting is the fallback
-- during rolling deploys and if an old seed is replayed later.
UPDATE "agent_runtimes"
SET "enabled" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "agentId" IN ('openclaw', 'gemini');
