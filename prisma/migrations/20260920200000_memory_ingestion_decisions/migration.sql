-- What Sentinel was offered, what it decided, and why.
--
-- The selective-persistence gate (src/lib/neural-engine/ingestion-gate.ts)
-- returned a verdict that nothing recorded, and a gate whose decisions cannot
-- be reviewed cannot be evaluated or improved: a rejected observation left no
-- trace at all, so "why did Sentinel not remember that?" was unanswerable, and
-- the rejection rules could never be shown to be too strict or too loose.
--
-- One row per decision, accepted or rejected. A rejection has no memoryId
-- because there is no row to point at -- that is the whole reason this table
-- cannot just be columns on memories.
--
-- Additive: a new table only. Content is stored so a decision can be reviewed,
-- and the gate refuses secret-shaped content *before* this is written, so a
-- rejected secret is recorded as a decision with its content redacted rather
-- than preserved here.
CREATE TABLE IF NOT EXISTS "memory_ingestion_decisions" (
    "id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,          -- DISCARD | EPISODIC | SEMANTIC | PROCEDURAL | PREFERENCE | ENTITY_RELATION
    "lane" TEXT,
    "accepted" BOOLEAN NOT NULL,
    "content" TEXT NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "signals" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "expectedRetrievalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "needsModelReview" BOOLEAN NOT NULL DEFAULT false,
    "owner" TEXT NOT NULL,
    "projectId" TEXT,
    "workspaceId" TEXT,
    "source" TEXT,
    "speaker" TEXT,
    -- Set only when the observation became a memory.
    "memoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_ingestion_decisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "memory_ingestion_decisions_owner_idx" ON "memory_ingestion_decisions"("owner");
CREATE INDEX IF NOT EXISTS "memory_ingestion_decisions_accepted_idx" ON "memory_ingestion_decisions"("accepted");
CREATE INDEX IF NOT EXISTS "memory_ingestion_decisions_memoryId_idx" ON "memory_ingestion_decisions"("memoryId");
CREATE INDEX IF NOT EXISTS "memory_ingestion_decisions_createdAt_idx" ON "memory_ingestion_decisions"("createdAt");

-- SET NULL, not CASCADE: forgetting a memory must not erase the record that it
-- was once accepted and on what grounds.
ALTER TABLE "memory_ingestion_decisions" ADD CONSTRAINT "memory_ingestion_decisions_memoryId_fkey"
  FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
