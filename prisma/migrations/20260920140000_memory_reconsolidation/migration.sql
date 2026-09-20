-- Reconsolidation decisions: why a belief changed, what replaced it, and on
-- what evidence.
--
-- Additive and non-destructive. No existing column is altered or dropped: the
-- supersession link itself already has somewhere to live (memories.validTo,
-- memories.supersededById, memories.changeReason, all present since the
-- bitemporal migration). What was missing is the *record of the decision* —
-- without it, a memory that has been closed is indistinguishable from one that
-- was closed for a good reason, and "why did this belief change?" can only be
-- answered by asking a model to recall its own reasoning.
--
-- One row per (assessed memory, related memory, decision). The row is written
-- whether or not the decision was applied, which is what makes shadow mode
-- meaningful: in shadow mode Sentinel records what it *would* change and
-- changes nothing.

CREATE TABLE IF NOT EXISTS "memory_reconsolidations" (
    "id" TEXT NOT NULL,
    -- The memory the decision is about (the older/affected belief).
    "memoryId" TEXT NOT NULL,
    -- The memory that prompted it, when there was one.
    "relatedMemoryId" TEXT,
    -- REINFORCE | REVISE | SUPERSEDE | MERGE | QUARANTINE | ARCHIVE | NO_CHANGE
    "action" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- Short human-readable summary; mirrored into memories.changeReason when applied.
    "reason" TEXT NOT NULL,
    -- Structured, named observations with their weights. Deliberately NOT
    -- free-form model reasoning: this is the evidence, not the deliberation.
    "evidence" JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- A genuine conflict that nothing resolves. Both memories stay retrievable.
    "opensContradiction" BOOLEAN NOT NULL DEFAULT false,
    -- Recorded but deliberately not enacted.
    "shadow" BOOLEAN NOT NULL DEFAULT true,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" TIMESTAMP(3),
    -- Which sweep/ingest produced it, so a bad run can be identified wholesale.
    "origin" TEXT NOT NULL DEFAULT 'sweep',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_reconsolidations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "memory_reconsolidations_memoryId_idx"
  ON "memory_reconsolidations"("memoryId");
CREATE INDEX IF NOT EXISTS "memory_reconsolidations_relatedMemoryId_idx"
  ON "memory_reconsolidations"("relatedMemoryId");
CREATE INDEX IF NOT EXISTS "memory_reconsolidations_action_idx"
  ON "memory_reconsolidations"("action");
CREATE INDEX IF NOT EXISTS "memory_reconsolidations_shadow_applied_idx"
  ON "memory_reconsolidations"("shadow", "applied");

-- One decision per pair per action, so re-running the sweep is idempotent
-- rather than accumulating duplicate history. A NULL relatedMemoryId compares
-- as distinct in a plain unique index, so the COALESCE keeps unpaired
-- decisions deduplicated too.
CREATE UNIQUE INDEX IF NOT EXISTS "memory_reconsolidations_pair_action_key"
  ON "memory_reconsolidations"("memoryId", COALESCE("relatedMemoryId", ''), "action");

ALTER TABLE "memory_reconsolidations" ADD CONSTRAINT "memory_reconsolidations_memoryId_fkey"
  FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory_reconsolidations" ADD CONSTRAINT "memory_reconsolidations_relatedMemoryId_fkey"
  FOREIGN KEY ("relatedMemoryId") REFERENCES "memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
