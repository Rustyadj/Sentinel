-- Minimal multi-agent handoff lineage. A delegated session retains its
-- target runtime/agent ownership while pointing back to the source session.
ALTER TABLE "agent_sessions" ADD COLUMN "parentSessionId" TEXT;

CREATE INDEX "agent_sessions_parentSessionId_idx" ON "agent_sessions"("parentSessionId");

ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_parentSessionId_fkey"
  FOREIGN KEY ("parentSessionId") REFERENCES "agent_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
